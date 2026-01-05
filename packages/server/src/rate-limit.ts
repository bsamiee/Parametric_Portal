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

type Preset = keyof typeof B.presets;
type RateLimitError = InstanceType<typeof HttpError.RateLimit>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    presets: {
        api: { algorithm: 'token-bucket', limit: 100, tokens: 1, window: Duration.minutes(1) },
        auth: { algorithm: 'fixed-window', limit: 5, tokens: 1, window: Duration.minutes(15) },
        mutation: { algorithm: 'token-bucket', limit: 100, tokens: 5, window: Duration.minutes(1) },
    },
    redis: { prefix: 'rl:' },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const extractClientKey = (request: HttpServerRequest.HttpServerRequest, prefix: string): string =>
    `${prefix}:${Option.getOrElse(Headers.get(request.headers, 'x-forwarded-for'), () => 'unknown')}`;
const addRateLimitHeaders = (response: HttpServerResponse.HttpServerResponse, result: { limit: number; remaining: number; resetAfterMs: number }): HttpServerResponse.HttpServerResponse =>
    HttpServerResponse.setHeaders(response, {
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.resetAfterMs / 1000)),
    });

// --- [LAYERS] ----------------------------------------------------------------

const storeLayerRedis = layerStoreRedis({
    host: Config.string('REDIS_HOST').pipe(Config.withDefault('localhost')),
    password: Config.string('REDIS_PASSWORD').pipe(Config.option, Config.map(Option.getOrUndefined)),
    port: Config.integer('REDIS_PORT').pipe(Config.withDefault(6379)),
    prefix: Config.string('RATE_LIMIT_PREFIX').pipe(Config.withDefault(B.redis.prefix)),
});
const storeLayerMemory = layerStoreMemory;
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
): Effect.Effect<A, E | RateLimitError, R | HttpServerRequest.HttpServerRequest | RateLimiter | MetricsService> =>
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
            (e) =>
                MetricsService.track({ _tag: 'RateLimitRejection', preset, remaining: e.remaining }).pipe(
                    Effect.zipRight(Effect.fail(new HttpError.RateLimit({
                        limit: B.presets[preset].limit,
                        remaining: e.remaining,
                        resetAfterMs: DurationMs.fromMillis(Duration.toMillis(e.retryAfter)),
                        retryAfterMs: DurationMs.fromMillis(Duration.toMillis(e.retryAfter)),
                    }))),
                ),
        ),
        Effect.catchIf(
            (e): e is RateLimitStoreError => e instanceof RateLimitStoreError,
            (e) =>
                Effect.gen(function* () {
                    yield* Effect.logWarning('Rate limit store unavailable, allowing request (fail-open)', { error: String(e), preset });
                    yield* MetricsService.track({ _tag: 'RateLimitStoreFailure', preset });
                    return yield* handler;
                }),
        ),
        Effect.withSpan(`rate-limit.${preset}`, { attributes: { 'rate-limit.preset': preset } }),
    ) as Effect.Effect<A, E | RateLimitError, R | HttpServerRequest.HttpServerRequest | RateLimiter | MetricsService>;

// --- [DISPATCH_TABLES] -------------------------------------------------------

const middleware = Object.freeze({
    api: <A, E, R>(handler: Effect.Effect<A, E, R>) => applyRateLimit('api', handler),
    auth: <A, E, R>(handler: Effect.Effect<A, E, R>) => applyRateLimit('auth', handler),
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

export { B as RATE_LIMIT_TUNING, RateLimit };
