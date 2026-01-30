/**
 * Cache infrastructure backed by PersistedCache + Redis.
 * Provides: ResultPersistence layer, cross-instance invalidation, rate limiting, health.
 *
 * [ARCHITECTURE]:
 * - PersistedCache: Schema-validated L1/L2 tiering with stampede prevention (Effect built-in)
 * - Persistence.ResultPersistence: Backed by Redis via Persistence/Redis.layerResult
 * - Reactivity: Cross-instance invalidation via Redis pub/sub bridge
 * - RateLimiter: Token bucket / fixed window rate limiting (shared Redis connection)
 */
import { PersistedCache, type Persistence, Reactivity } from '@effect/experimental';
import * as PersistenceRedis from '@effect/experimental/Persistence/Redis';
import { layer as rateLimiterLayer, layerStoreMemory, RateLimitExceeded, RateLimiter } from '@effect/experimental/RateLimiter';
import { layerStore as layerStoreRedis } from '@effect/experimental/RateLimiter/Redis';
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Config, Duration, Effect, Either, Function as F, Layer, Match, Metric, Number as N, Option, pipe, PrimaryKey, Redacted, Schedule, Schema as S, type Scope } from 'effect';
import Redis from 'ioredis';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { AuditService } from '../observe/audit.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _Cache = {
	defaults: { inMemoryCapacity: 1000, inMemoryTTL: Duration.seconds(30), ttl: Duration.minutes(5) },
	pubsub: { channel: 'cache:invalidate' },
	rateLimit: {
		api: { algorithm: 'token-bucket', limit: 100, onExceeded: 'fail', recovery: undefined, tokens: 1, window: Duration.minutes(1) },
		auth: { algorithm: 'fixed-window', limit: 5, onExceeded: 'fail', recovery: 'email-verify', tokens: 1, window: Duration.minutes(15) },
		mfa: { algorithm: 'fixed-window', limit: 5, onExceeded: 'fail', recovery: 'email-verify', tokens: 1, window: Duration.minutes(15) },
		mutation: { algorithm: 'token-bucket', limit: 100, onExceeded: 'delay', recovery: undefined, tokens: 5, window: Duration.minutes(1) },
	},
	redis: { connectTimeout: 5000, enableReadyCheck: true, host: 'localhost', lazyConnect: false, maxRetriesPerRequest: 3, port: 6379, prefix: 'persist:' },
} as const satisfies {
	readonly defaults: { readonly inMemoryCapacity: number; readonly inMemoryTTL: Duration.Duration; readonly ttl: Duration.Duration };
	readonly pubsub: { readonly channel: string };
	readonly rateLimit: Record<string, { readonly algorithm: 'token-bucket' | 'fixed-window'; readonly limit: number; readonly onExceeded: 'fail' | 'delay'; readonly recovery: 'email-verify' | undefined; readonly tokens: number; readonly window: Duration.Duration }>;
	readonly redis: { readonly connectTimeout: number; readonly enableReadyCheck: boolean; readonly host: string; readonly lazyConnect: boolean; readonly maxRetriesPerRequest: number; readonly port: number; readonly prefix: string };
};

const _redisConfig = Config.all({
	connectTimeout: Config.integer('REDIS_CONNECT_TIMEOUT').pipe(Config.withDefault(_Cache.redis.connectTimeout)),
	enableReadyCheck: Config.boolean('REDIS_READY_CHECK').pipe(Config.withDefault(_Cache.redis.enableReadyCheck)),
	host: Config.string('REDIS_HOST').pipe(Config.withDefault(_Cache.redis.host)),
	lazyConnect: Config.boolean('REDIS_LAZY_CONNECT').pipe(Config.withDefault(_Cache.redis.lazyConnect)),
	// maxRetriesPerRequest: 3 → ~300ms total wait (3 x ~100ms), fail-fast for API serving
	maxRetriesPerRequest: Config.integer('REDIS_MAX_RETRIES').pipe(Config.withDefault(_Cache.redis.maxRetriesPerRequest)),
	password: Config.redacted('REDIS_PASSWORD').pipe(Config.option, Config.map(Option.match({ onNone: () => undefined, onSome: Redacted.value }))),
	port: Config.integer('REDIS_PORT').pipe(Config.withDefault(_Cache.redis.port)),
	prefix: Config.string('CACHE_PREFIX').pipe(Config.withDefault(_Cache.redis.prefix)),
	// socketTimeout: Faster dead socket detection (default 15s)
	socketTimeout: Config.integer('REDIS_SOCKET_TIMEOUT').pipe(Config.withDefault(15000)),
});

// --- [SCHEMA] ----------------------------------------------------------------

const _InvalidationMessage = S.Struct({ key: S.String, storeId: S.String });

// --- [SERVICES] --------------------------------------------------------------

class CacheService extends Effect.Service<CacheService>()('server/CacheService', {
	scoped: Effect.gen(function* () {
		const cfg = yield* _redisConfig;
		const redisOpts = { connectTimeout: cfg.connectTimeout, enableReadyCheck: cfg.enableReadyCheck, host: cfg.host, lazyConnect: cfg.lazyConnect, maxRetriesPerRequest: cfg.maxRetriesPerRequest, password: cfg.password, port: cfg.port, socketTimeout: cfg.socketTimeout };
		// Effect.acquireRelease for proper resource lifecycle with graceful quit()
		const redis = yield* Effect.acquireRelease(
			Effect.sync(() => new Redis(redisOpts)),
			(r) => Effect.promise(() => r.quit()),
		);
		// Redis error handler for observability
		redis.on('error', (err) => { Effect.runFork(Effect.logError('Redis connection error', { error: String(err), host: cfg.host, port: cfg.port })); });
		const sub = yield* Effect.acquireRelease(
			Effect.sync(() => redis.duplicate()),
			(s) => Effect.sync(() => s.unsubscribe()).pipe(Effect.andThen(Effect.promise(() => s.quit()))),
		);
		const reactivity = yield* Reactivity.make;
		// Bridge: Redis pub/sub → local Reactivity with schema validation and retry
		yield* Effect.tryPromise(() => sub.subscribe(_Cache.pubsub.channel)).pipe(
			Effect.retry(Schedule.exponential(Duration.millis(100)).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(3)))),
			Effect.catchAll((err) => Effect.logWarning('Redis pub/sub unavailable', { error: String(err) })),
		);
		sub.on('message', (channel, message) => {
		pipe(
			Option.liftPredicate(channel, (c) => c === _Cache.pubsub.channel),
			Option.map(() => pipe(
				Either.try({ catch: (err) => err, try: () => JSON.parse(message) }),
				Either.flatMap(S.decodeUnknownEither(_InvalidationMessage)),
				Either.match({
					onLeft: (err) => { Effect.runFork(Effect.logWarning('Malformed invalidation message', { channel, error: String(err) })); },
					onRight: (msg) => {
						const invalidateKey = `${msg.storeId}:${msg.key}`;
						Effect.runFork(reactivity.invalidate([invalidateKey]));
					},
				}),
			)),
		);
	});
		yield* Effect.logInfo('CacheService initialized', { host: cfg.host, port: cfg.port });
		return { _prefix: cfg.prefix, _reactivity: reactivity, _redis: redis, _redisOpts: redisOpts };
	}),
}) {
	// --- [PERSISTENCE_LAYER] - ResultPersistence backed by Redis -------------
	static readonly Persistence: Layer.Layer<Persistence.ResultPersistence, never, CacheService> = Layer.unwrapScoped(
		CacheService.pipe(Effect.map((s) => PersistenceRedis.layerResult(s._redisOpts))),
	);
	// --- [CACHE] - Factory for typed PersistedCache with infrastructure -------
	static readonly cache = <K extends Persistence.ResultPersistence.KeyAny, R>(options: {
		readonly storeId: string;
		readonly lookup: (key: K) => Effect.Effect<S.WithResult.Success<K>, S.WithResult.Failure<K>, R>;
		readonly timeToLive?: Duration.DurationInput;
		readonly inMemoryCapacity?: number;
		readonly inMemoryTTL?: Duration.DurationInput;
	}): Effect.Effect<PersistedCache.PersistedCache<K>, never, CacheService | S.SerializableWithResult.Context<K> | R | Persistence.ResultPersistence | Scope.Scope> =>
		Effect.gen(function* () {
			const { _reactivity, _redis } = yield* CacheService;
			const cache = yield* PersistedCache.make({
				inMemoryCapacity: options.inMemoryCapacity ?? _Cache.defaults.inMemoryCapacity,
				inMemoryTTL: options.inMemoryTTL ?? _Cache.defaults.inMemoryTTL,
				lookup: options.lookup,
				storeId: options.storeId,
				timeToLive: () => options.timeToLive ?? _Cache.defaults.ttl,
			});
			const registrations = new Map<string, () => void>();
			const makeInvalidator = (id: string, key: K) => () => {
				const c = registrations.get(id);
				registrations.delete(id);
				c?.();
				Effect.runFork(cache.invalidate(key).pipe(Effect.ignore));
			};
			const register = (key: K) => {
				const id = `${options.storeId}:${PrimaryKey.value(key)}`;
				return Effect.sync(() => registrations.has(id) || registrations.set(id, _reactivity.unsafeRegister([id], makeInvalidator(id, key))));
			};
			const invalidateLocal = (storeId: string, key: string) => Effect.all([
				_reactivity.invalidate([`${storeId}:${key}`]),
				Effect.tryPromise(() => _redis.publish(_Cache.pubsub.channel, JSON.stringify({ key, storeId }))).pipe(Effect.timeout(Duration.seconds(2)), Effect.ignore),
				Effect.serviceOption(MetricsService).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (m) => MetricsService.inc(m.cache.evictions, MetricsService.label({ storeId })) }))),
			], { discard: true });
			const cleanup = () => { registrations.forEach((c) => { c(); }); registrations.clear(); };
			yield* Effect.addFinalizer(() => Effect.sync(cleanup));
			return {
				get: (key) => register(key).pipe(Effect.andThen(cache.get(key))),
				invalidate: (key) => register(key).pipe(Effect.andThen(invalidateLocal(options.storeId, PrimaryKey.value(key)))),
			} as const satisfies PersistedCache.PersistedCache<K>;
		});
	// --- [INVALIDATE] - Cross-instance via Reactivity + Redis pub/sub --------
	static readonly invalidate = (storeId: string, key: string) =>
		CacheService.pipe(Effect.flatMap(({ _reactivity, _redis }) => Effect.all([
			_reactivity.invalidate([`${storeId}:${key}`]),
			Effect.tryPromise(() => _redis.publish(_Cache.pubsub.channel, JSON.stringify({ key, storeId }))).pipe(Effect.timeout(Duration.seconds(2)), Effect.ignore),
			Effect.serviceOption(MetricsService).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (m) => MetricsService.inc(m.cache.evictions, MetricsService.label({ storeId })) }))),
		], { discard: true })));
	// --- [RATE_LIMIT] - Token bucket / fixed window --------------------------
	static readonly rateLimit: {
		<A, E, R>(preset: CacheService.RateLimitPreset, handler: Effect.Effect<A, E, R>): Effect.Effect<A, E | HttpError.RateLimit, R | AuditService | CacheService | MetricsService | RateLimiter>;
		(preset: CacheService.RateLimitPreset): <A, E, R>(handler: Effect.Effect<A, E, R>) => Effect.Effect<A, E | HttpError.RateLimit, R | AuditService | CacheService | MetricsService | RateLimiter>;
	} = F.dual(2, <A, E, R>(preset: CacheService.RateLimitPreset, handler: Effect.Effect<A, E, R>) => _rateLimit(preset, handler));
	// --- [HEADERS] - HTTP middleware for X-RateLimit-* -----------------------
	static readonly headers = HttpMiddleware.make((app) =>
		Effect.gen(function* () {
			const response = yield* app;
			const ctx = yield* Context.Request.current;
			return Option.match(ctx.rateLimit, {
				onNone: () => response,
				onSome: (r) => HttpServerResponse.setHeaders(response, {
					'X-RateLimit-Limit': String(r.limit),
					'X-RateLimit-Remaining': String(N.clamp({ maximum: r.limit, minimum: 0 })(r.remaining)),
					'X-RateLimit-Reset': String(Math.ceil(Duration.toMillis(r.resetAfter) / 1000)),
				}),
			});
		}));
	// --- [HEALTH] - Redis connection + latency via Effect.timed --------------
	// [FIX #4] Use Effect.timed instead of manual Clock operations
	static readonly health = (): Effect.Effect<CacheService.Health, never, CacheService> =>
		CacheService.pipe(
			Effect.flatMap((s) => Effect.tryPromise(() => s._redis.ping()).pipe(Effect.timed)),
			Effect.map(([duration, result]) => ({ connected: result === 'PONG', latencyMs: Math.round(Duration.toMillis(duration)) })),
			Effect.orElseSucceed(F.constant({ connected: false, latencyMs: 0 })),
		);
	// --- [SET_NX] - Atomic set-if-not-exists (replay protection) -------------
	static readonly setNX = (key: string, value: string, ttl: Duration.Duration): Effect.Effect<CacheService.SetNXResult, never, CacheService> =>
		CacheService.pipe(
			Effect.flatMap((s) => Effect.tryPromise(() => s._redis.set(`${s._prefix}${key}`, value, 'PX', Duration.toMillis(ttl), 'NX'))),
			Effect.map((result) => ({ alreadyExists: result === null, key })),
		// [CRITICAL] Fail-closed: treat Redis failure as "already exists" to prevent TOTP replay attacks
		Effect.catchAll((err) => Effect.logWarning('Redis SET NX failed (fail-closed)', { error: String(err) }).pipe(Effect.as({ alreadyExists: true, key }))),
		);
	// --- [REDIS] - Raw access for specialized ops ----------------------------
	static readonly redis = CacheService.pipe(Effect.map((s) => s._redis));
	// --- [LAYER] - Full cache infrastructure ---------------------------------
	// [FIX #2] Unified Redis connection - RateLimiter uses memory store by default, Redis store shares config
	static readonly Layer = CacheService.Default.pipe(
		Layer.provideMerge(rateLimiterLayer),
		Layer.provideMerge(Layer.unwrapEffect(
			// [FIX] Use layerStore (runtime values) instead of layerStoreConfig (Config objects)
			Config.all({ prefix: Config.string('RATE_LIMIT_PREFIX').pipe(Config.withDefault('rl:')), redis: _redisConfig, store: Config.string('RATE_LIMIT_STORE').pipe(Config.withDefault('memory')) }).pipe(
				Effect.map(({ prefix, redis, store }) => Match.value(store).pipe(
					Match.when('redis', () => layerStoreRedis({ host: redis.host, password: redis.password, port: redis.port, prefix })),
					Match.orElse(() => layerStoreMemory),
				)),
			),
		)),
	);
	// Full layer adds ResultPersistence for PersistedCache consumers
	static readonly LayerWithPersistence = CacheService.Layer.pipe(Layer.provideMerge(CacheService.Persistence));
}

// --- [FUNCTIONS] -------------------------------------------------------------

// Proper type-safe error handling using RateLimitExceeded discriminant
const _rateLimit = <A, E, R>(preset: CacheService.RateLimitPreset, handler: Effect.Effect<A, E, R>) =>
	Effect.all([RateLimiter, Context.Request.current, HttpServerRequest.HttpServerRequest, MetricsService, AuditService]).pipe(
		Effect.flatMap(([limiter, ctx, request, metrics, audit]) => {
			const config = _Cache.rateLimit[preset];
			const ip = pipe(ctx.ipAddress, Option.orElse(() => request.remoteAddress), Option.getOrElse(() => 'unknown'));
			const labels = MetricsService.label({ preset });
			return limiter.consume({ algorithm: config.algorithm, key: `${preset}:${ip}`, limit: config.limit, onExceeded: config.onExceeded, tokens: config.tokens, window: config.window }).pipe(
				Metric.trackDuration(Metric.taggedWithLabels(metrics.rateLimit.checkDuration, labels)),
				Effect.catchAll((err) => err instanceof RateLimitExceeded
					? Effect.all([
						Context.Request.update({ rateLimit: Option.some({ delay: Duration.zero, limit: err.limit, remaining: err.remaining, resetAfter: err.retryAfter }) }),
						MetricsService.inc(metrics.rateLimit.rejections, labels),
						audit.log('rate_limited', { details: { limit: err.limit, preset, remaining: err.remaining, resetAfterMs: Duration.toMillis(err.retryAfter) } }),
					], { discard: true }).pipe(Effect.andThen(Effect.fail(HttpError.RateLimit.of(Duration.toMillis(err.retryAfter), {
						limit: err.limit, remaining: err.remaining, resetAfterMs: Duration.toMillis(err.retryAfter),
						...pipe(Option.fromNullable(config.recovery), Option.match({ onNone: () => ({}), onSome: (ra) => ({ recoveryAction: ra }) })),
					}))))
					: Effect.all([
						Effect.logWarning('Rate limit store unavailable (fail-open)', { error: String(err), preset }),
						MetricsService.inc(metrics.rateLimit.storeFailures, labels),
					], { discard: true }).pipe(Effect.as({ delay: Duration.zero, limit: config.limit, remaining: config.limit, resetAfter: config.window })),
				),
				Effect.tap((result) => Context.Request.update({ rateLimit: Option.some(result) })), // NOSONAR S3358
				Effect.andThen(handler),
			);
		}),
		Telemetry.span(`cache.rateLimit.${preset}`),
	);

// --- [NAMESPACE] -------------------------------------------------------------

// [FIX #6] Removed CacheError - use Persistence.PersistenceError directly
interface CacheServiceTypes {
	RateLimitPreset: keyof typeof _Cache.rateLimit;
	SetNXResult: { readonly alreadyExists: boolean; readonly key: string };
	Health: { readonly connected: boolean; readonly latencyMs: number };
}
declare namespace CacheService {
	type RateLimitPreset = CacheServiceTypes['RateLimitPreset'];
	type SetNXResult = CacheServiceTypes['SetNXResult'];
	type Health = CacheServiceTypes['Health'];
}

// --- [EXPORT] ----------------------------------------------------------------

export { CacheService };
