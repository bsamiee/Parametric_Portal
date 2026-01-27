/**
 * Apply rate limiting via @effect/experimental RateLimiter.
 * Table-driven presets; Redis primary, memory fallback; reads from RequestContext.
 */
import { layer as rateLimiterLayer, layerStoreMemory, RateLimiter, type RateLimiterError } from '@effect/experimental/RateLimiter';
import { layerStoreConfig as layerStoreRedis } from '@effect/experimental/RateLimiter/Redis';
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Config, Duration, Effect, Layer, Metric, Option, pipe, Redacted } from 'effect';
import { Context } from '../context.ts';
import { AuditService } from '../observe/audit.ts';
import { HttpError } from '../errors.ts';
import { MetricsService } from '../observe/metrics.ts';

// --- [TABLE] -----------------------------------------------------------------

const presets = {
	api: { algorithm: 'token-bucket', limit: 100, onExceeded: 'fail', recoveryAction: undefined, tokens: 1, window: Duration.minutes(1) },
	auth: { algorithm: 'fixed-window', limit: 5, onExceeded: 'fail', recoveryAction: 'email-verify' as const, tokens: 1, window: Duration.minutes(15) },
	mfa: { algorithm: 'fixed-window', limit: 5, onExceeded: 'fail', recoveryAction: 'email-verify' as const, tokens: 1, window: Duration.minutes(15) },
	mutation: { algorithm: 'token-bucket', limit: 100, onExceeded: 'delay', recoveryAction: undefined, tokens: 5, window: Duration.minutes(1) },
} as const satisfies Record<string, {
	algorithm: 'fixed-window' | 'token-bucket';
	limit: number;
	onExceeded: 'delay' | 'fail';
	recoveryAction: 'email-verify' | 'support-ticket' | undefined;
	tokens: number;
	window: Duration.Duration;
}>;

// --- [LAYER] -----------------------------------------------------------------

const Default = rateLimiterLayer.pipe(Layer.provideMerge(Layer.unwrapEffect(
	Config.string('RATE_LIMIT_STORE').pipe(Config.withDefault('memory'), Effect.map((store) => store === 'redis'
		? layerStoreRedis({
			connectTimeout: Config.integer('REDIS_CONNECT_TIMEOUT').pipe(Config.withDefault(5000)),
			enableReadyCheck: Config.boolean('REDIS_READY_CHECK').pipe(Config.withDefault(true)),
			host: Config.string('REDIS_HOST').pipe(Config.withDefault('localhost')),
			lazyConnect: Config.boolean('REDIS_LAZY_CONNECT').pipe(Config.withDefault(false)),
			maxRetriesPerRequest: Config.integer('REDIS_MAX_RETRIES').pipe(Config.withDefault(3)),
			password: Config.redacted('REDIS_PASSWORD').pipe(Config.option, Config.map((opt) => opt.pipe(Option.map((v) => Redacted.value(v)), Option.getOrUndefined))),
			port: Config.integer('REDIS_PORT').pipe(Config.withDefault(6379)),
			prefix: Config.string('RATE_LIMIT_PREFIX').pipe(Config.withDefault('rl:')),
			retryStrategy: Config.integer('REDIS_RETRY_DELAY').pipe(Config.withDefault(100), Config.map((delay) => (tries: number) => tries > 3 ? null : Math.min(tries * delay, 2000))),
		})
		: layerStoreMemory,
	)),
)));

// --- [FUNCTIONS] -------------------------------------------------------------

const apply = <A, E, R>(preset: keyof typeof presets, handler: Effect.Effect<A, E, R>) => Effect.gen(function* () {
	const [audit, metrics] = yield* Effect.all([AuditService, MetricsService]);
	const limiter = yield* RateLimiter;
	const ctx = yield* Context.Request.current;
	const request = yield* HttpServerRequest.HttpServerRequest;
	const config = presets[preset];
	const key = `${preset}:${Option.getOrElse(ctx.ipAddress, () => Option.getOrElse(request.remoteAddress, () => 'unknown'))}`;
	const result = yield* limiter.consume({ algorithm: config.algorithm, key, limit: config.limit, onExceeded: config.onExceeded, tokens: config.tokens, window: config.window }).pipe(
		Metric.trackDuration(Metric.taggedWithLabels(metrics.rateLimit.checkDuration, MetricsService.label({ preset }))),
		Effect.catchAll((err: RateLimiterError) => err.reason === 'Exceeded' ? Effect.gen(function* () {
			yield* Context.Request.update({ rateLimit: Option.some({ delay: Duration.zero, limit: err.limit, remaining: err.remaining, resetAfter: err.retryAfter }) });
			yield* Effect.all([
				MetricsService.inc(metrics.rateLimit.rejections, MetricsService.label({ preset }), 1),
				audit.log('rate_limited', { details: { limit: err.limit, preset, remaining: err.remaining, resetAfterMs: Duration.toMillis(err.retryAfter) } }),
			], { discard: true });
			return yield* Effect.fail(HttpError.RateLimit.of(Duration.toMillis(err.retryAfter), {
				limit: err.limit, remaining: err.remaining, resetAfterMs: Duration.toMillis(err.retryAfter),
				...(presets[preset].recoveryAction ? { recoveryAction: presets[preset].recoveryAction } : {}),
			}));
		}) : Effect.gen(function* () {
			yield* Effect.logWarning('Rate limit store unavailable (fail-open)', { error: String(err), preset });
			yield* MetricsService.inc(metrics.rateLimit.storeFailures, MetricsService.label({ preset }), 1);
			return { delay: Duration.zero, limit: config.limit, remaining: config.limit, resetAfter: config.window };
		})),
	);
	yield* Context.Request.update({ rateLimit: pipe(result, Option.some) });
	return yield* handler;
}).pipe(Effect.withSpan(`rate-limit.${preset}`, { attributes: { 'rate-limit.preset': preset } }));
const headers = HttpMiddleware.make((app) =>
	app.pipe(
		Effect.flatMap((response) => Context.Request.current.pipe(
			Effect.map((ctx) => Option.match(ctx.rateLimit, {
				onNone: () => response,
				onSome: (result) => HttpServerResponse.setHeaders(response, {
					'X-RateLimit-Limit': String(result.limit),
					'X-RateLimit-Remaining': String(Math.max(0, result.remaining)),
					'X-RateLimit-Reset': String(Math.ceil(Duration.toMillis(result.resetAfter) / 1000)),
				}),
			})),
		)),
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
