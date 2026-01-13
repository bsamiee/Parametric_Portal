/**
 * Rate limiting via @effect/experimental with pluggable backend.
 * Config-driven: RATE_LIMIT_STORE=redis uses Redis, otherwise in-memory.
 * Fail-open pattern when store unavailable for better availability.
 * Exposes full ConsumeResult (limit, remaining, resetAfter) for response headers.
 */
import { layerStoreMemory, makeWithRateLimiter, RateLimitExceeded, type RateLimiter, RateLimitStoreError, layer as rateLimiterLayer } from '@effect/experimental/RateLimiter';
import { layerStoreConfig as layerStoreRedis } from '@effect/experimental/RateLimiter/Redis';
import { Headers, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { DurationMs } from '@parametric-portal/types/types';
import { Config, Duration, Effect, Layer, Metric, Option } from 'effect';
import { HttpError } from './http-errors.ts';
import { MetricsService } from './metrics.ts';

// --- [TYPES] -----------------------------------------------------------------

type RateLimitPreset = {
    readonly algorithm: 'fixed-window' | 'token-bucket';
    readonly limit: number;
    readonly recoveryAction?: 'email-verify' | 'support-ticket';
    readonly tokens: number;
    readonly window: Duration.Duration;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    presets: {
        api: { algorithm: 'token-bucket', limit: 100, tokens: 1, window: Duration.minutes(1) },
        auth: { algorithm: 'fixed-window', limit: 5, recoveryAction: 'email-verify', tokens: 1, window: Duration.minutes(15) },
        mfa: { algorithm: 'fixed-window', limit: 5, recoveryAction: 'email-verify', tokens: 1, window: Duration.minutes(15) },
        mutation: { algorithm: 'token-bucket', limit: 100, tokens: 5, window: Duration.minutes(1) },
    } as const satisfies Record<string, RateLimitPreset>,
    redis: { prefix: 'rl:' },
} as const);
type Preset = keyof typeof B.presets;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const extractClientKey = (request: HttpServerRequest.HttpServerRequest, prefix: string): string =>`${prefix}:${Option.getOrElse(Headers.get(request.headers, 'x-forwarded-for'), () => 'unknown')}`;
const addRateLimitHeaders = (
    response: HttpServerResponse.HttpServerResponse,
    result: { limit: number; remaining: number; resetAfterMs: number },
): HttpServerResponse.HttpServerResponse =>
    HttpServerResponse.setHeaders(response, {
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.resetAfterMs / 1000)),
    });

// --- [LAYERS] ----------------------------------------------------------------

const storeLayerMemory = layerStoreMemory;
const storeLayerRedis = layerStoreRedis({
    host: Config.string('REDIS_HOST').pipe(Config.withDefault('localhost')),
    password: Config.string('REDIS_PASSWORD').pipe(Config.option, Config.map(Option.getOrUndefined)),
    port: Config.integer('REDIS_PORT').pipe(Config.withDefault(6379)),
    prefix: Config.string('RATE_LIMIT_PREFIX').pipe(Config.withDefault(B.redis.prefix)),
});
const storeLayer = Layer.unwrapEffect(
    Config.string('RATE_LIMIT_STORE').pipe(
        Config.withDefault('memory'),
        Effect.map((store) => (store === 'redis' ? storeLayerRedis : storeLayerMemory)),
    ),
);

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const applyRateLimit = <A, E, R>(
    preset: Preset,
    handler: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | InstanceType<typeof HttpError.RateLimit>, R | HttpServerRequest.HttpServerRequest | RateLimiter | MetricsService> =>
    Effect.gen(function* () {
        const metrics = yield* MetricsService;
        const limiter = yield* makeWithRateLimiter;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const key = extractClientKey(request, preset);
        const config = B.presets[preset];
        const labeledCheckDuration = metrics.rateLimit.checkDuration.pipe(Metric.tagged('preset', preset));
        return yield* limiter({ ...config, key, onExceeded: 'fail' })(handler).pipe(Metric.trackDuration(labeledCheckDuration));
    }).pipe(
        Effect.catchIf(
            (e): e is RateLimitExceeded => e instanceof RateLimitExceeded,
            (e) => {
                const config: RateLimitPreset = B.presets[preset];
                return MetricsService.track({ _tag: 'RateLimitRejection', preset, remaining: e.remaining }).pipe(
                    Effect.zipRight(Effect.fail(new HttpError.RateLimit({
                        limit: config.limit,
                        recoveryAction: config.recoveryAction,
                        remaining: e.remaining,
                        resetAfterMs: DurationMs.fromMillis(Duration.toMillis(e.retryAfter)),
                        retryAfterMs: DurationMs.fromMillis(Duration.toMillis(e.retryAfter)),
                    }))),
                );
            },
        ),
        Effect.catchIf(
            (e): e is RateLimitStoreError => e instanceof RateLimitStoreError,
            (e) =>
                Effect.logWarning('Rate limit store unavailable, allowing request (fail-open)', { error: String(e), preset }).pipe(
                    Effect.andThen(MetricsService.track({ _tag: 'RateLimitStoreFailure', preset })),
                    Effect.andThen(handler),
                ),
        ),
        Effect.withSpan(`rate-limit.${preset}`, { attributes: { 'rate-limit.preset': preset } }),
    ) as Effect.Effect<A, E | InstanceType<typeof HttpError.RateLimit>, R | HttpServerRequest.HttpServerRequest | RateLimiter | MetricsService>;

// --- [DISPATCH_TABLES] -------------------------------------------------------

const middleware = Object.freeze({
    api: <A, E, R>(handler: Effect.Effect<A, E, R>) => applyRateLimit('api', handler),
    auth: <A, E, R>(handler: Effect.Effect<A, E, R>) => applyRateLimit('auth', handler),
    mfa: <A, E, R>(handler: Effect.Effect<A, E, R>) => applyRateLimit('mfa', handler),
    mutation: <A, E, R>(handler: Effect.Effect<A, E, R>) => applyRateLimit('mutation', handler),
} as const);
const RateLimit = Object.freeze({
    addHeaders: addRateLimitHeaders,
    layer: rateLimiterLayer.pipe(Layer.provide(storeLayer)),
    middleware,
    storeLayerMemory,
    storeLayerRedis,
} as const);

// --- [EXPORT] ----------------------------------------------------------------

export { RateLimit };
