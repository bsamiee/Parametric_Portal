/**
 * Apply rate limiting via @effect/experimental RateLimiter.
 * Table-driven presets; Redis primary, memory fallback; FiberRef propagates headers.
 */
import { type ConsumeResult, layer as rateLimiterLayer, layerStoreMemory, RateLimiter, type RateLimiterError } from '@effect/experimental/RateLimiter';
import { layerStoreConfig as layerStoreRedis } from '@effect/experimental/RateLimiter/Redis';
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Config, Duration, Effect, FiberRef, Layer, Metric, Option, Redacted } from 'effect';
import { Tenant } from '../tenant.ts';
import { HttpError } from '../errors.ts';
import { MetricsService } from './metrics.ts';

// --- [TABLE] -----------------------------------------------------------------

const presets = {
	api: { algorithm: 'token-bucket', limit: 100, recoveryAction: undefined, tokens: 1, window: Duration.minutes(1) },
	auth: { algorithm: 'fixed-window', limit: 5, recoveryAction: 'email-verify' as const, tokens: 1, window: Duration.minutes(15) },
	mfa: { algorithm: 'fixed-window', limit: 5, recoveryAction: 'email-verify' as const, tokens: 1, window: Duration.minutes(15) },
	mutation: { algorithm: 'token-bucket', limit: 100, recoveryAction: undefined, tokens: 5, window: Duration.minutes(1) },
} as const satisfies Record<string, {
	algorithm: 'fixed-window' | 'token-bucket';
	limit: number;
	recoveryAction: 'email-verify' | 'support-ticket' | undefined;
	tokens: number;
	window: Duration.Duration;
}>;

// --- [STATE] -----------------------------------------------------------------

const _headerRef = FiberRef.unsafeMake(Option.none<ConsumeResult>());

// --- [LAYER] -----------------------------------------------------------------

const Default = rateLimiterLayer.pipe(Layer.provide(Layer.unwrapEffect(
	Config.string('RATE_LIMIT_STORE').pipe(Config.withDefault('memory'), Effect.map((store) => store === 'redis'
		? layerStoreRedis({
			connectTimeout: Config.integer('REDIS_CONNECT_TIMEOUT').pipe(Config.withDefault(5000)),
			enableReadyCheck: Config.boolean('REDIS_READY_CHECK').pipe(Config.withDefault(true)),
			host: Config.string('REDIS_HOST').pipe(Config.withDefault('localhost')),
			lazyConnect: Config.boolean('REDIS_LAZY_CONNECT').pipe(Config.withDefault(false)),
			maxRetriesPerRequest: Config.integer('REDIS_MAX_RETRIES').pipe(Config.withDefault(3)),
			password: Config.redacted('REDIS_PASSWORD').pipe(Config.option, Config.map(Option.map(Redacted.value)), Config.map(Option.getOrUndefined)),
			port: Config.integer('REDIS_PORT').pipe(Config.withDefault(6379)),
			prefix: Config.string('RATE_LIMIT_PREFIX').pipe(Config.withDefault('rl:')),
			retryStrategy: Config.integer('REDIS_RETRY_DELAY').pipe(Config.withDefault(100), Config.map((delay) => (tries: number) => tries > 3 ? null : Math.min(tries * delay, 2000))),
		})
		: layerStoreMemory,
	)),
)));

// --- [FUNCTIONS] -------------------------------------------------------------

const apply = <A, E, R>(preset: keyof typeof presets, handler: Effect.Effect<A, E, R>) => Effect.gen(function* () {
	const metrics = yield* MetricsService;
	const limiter = yield* RateLimiter;
	const { ipAddress } = yield* Tenant.Context;
	const request = yield* HttpServerRequest.HttpServerRequest;
	const config = presets[preset];
	const key = `${preset}:${ipAddress ?? Option.getOrElse(request.remoteAddress, () => 'unknown')}`;
	const result = yield* limiter.consume({ algorithm: config.algorithm, key, limit: config.limit, onExceeded: 'fail', tokens: config.tokens, window: config.window }).pipe(
		Metric.trackDuration(metrics.rateLimit.checkDuration.pipe(Metric.tagged('preset', preset))),
		Effect.catchAll((err: RateLimiterError) => err.reason === 'Exceeded' ? Effect.gen(function* () {
			const headerResult = { delay: Duration.zero, limit: err.limit, remaining: err.remaining, resetAfter: err.retryAfter };
			yield* FiberRef.set(_headerRef, Option.some(headerResult));
			yield* Metric.update(metrics.rateLimit.rejections, preset);
			return yield* Effect.fail(HttpError.rateLimit(Duration.toMillis(err.retryAfter), {
				limit: err.limit, remaining: err.remaining, resetAfterMs: Duration.toMillis(err.retryAfter),
				...(presets[preset].recoveryAction ? { recoveryAction: presets[preset].recoveryAction } : {}),
			}));
		}) : Effect.gen(function* () {
			yield* Effect.logWarning('Rate limit store unavailable (fail-open)', { error: String(err), preset });
			yield* Metric.update(metrics.rateLimit.storeFailures.pipe(Metric.tagged('preset', preset)), 1);
			return { delay: Duration.zero, limit: config.limit, remaining: config.limit, resetAfter: config.window };
		})),
	);
	yield* FiberRef.set(_headerRef, Option.some(result));
	return yield* handler;
}).pipe(Effect.withSpan(`rate-limit.${preset}`, { attributes: { 'rate-limit.preset': preset } }));
const headers = HttpMiddleware.make((app) =>
	Effect.locally(_headerRef, Option.none<ConsumeResult>())(
		app.pipe(
			Effect.flatMap((response) => FiberRef.get(_headerRef).pipe(
				Effect.map((opt) => Option.match(opt, {
					onNone: () => response,
					onSome: (result) => HttpServerResponse.setHeaders(response, {
						'X-RateLimit-Limit': String(result.limit),
						'X-RateLimit-Remaining': String(Math.max(0, result.remaining)),
						'X-RateLimit-Reset': String(Math.ceil(Duration.toMillis(result.resetAfter) / 1000)),
					}),
				})),
			)),
		),
	),
);

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const RateLimit = {
	apply,
	Default,
	headers,
	presets,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace RateLimit {
	export type Preset = keyof typeof RateLimit.presets;
	export type PresetConfig = typeof RateLimit.presets[Preset];
}

// --- [EXPORT] ----------------------------------------------------------------

export { RateLimit };
