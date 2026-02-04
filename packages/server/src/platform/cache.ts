/**
 * Cache infrastructure: PersistedCache + Redis.
 * ResultPersistence layer, cross-instance invalidation, rate limiting, health.
 */
import { PersistedCache, type Persistence, Reactivity } from '@effect/experimental';
import * as PersistenceRedis from '@effect/experimental/Persistence/Redis';
import { layer as rateLimiterLayer, layerStoreMemory, RateLimitExceeded, RateLimiter } from '@effect/experimental/RateLimiter';
import { layerStore as layerStoreRedis } from '@effect/experimental/RateLimiter/Redis';
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import type { SqlClient } from '@effect/sql';
import { Config, Duration, Effect, Function as F, Layer, Match, Metric, Number as N, Option, PrimaryKey, Redacted, Schedule, Schema as S, type Scope } from 'effect';
import { unsafeCoerce } from 'effect/Function';
import Redis from 'ioredis';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { AuditService } from '../observe/audit.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	defaults: { inMemoryCapacity: 1000, inMemoryTTL: Duration.seconds(30), ttl: Duration.minutes(5) },
	presence: { ttlSeconds: 120 },
	pubsub: { channel: 'cache:invalidate' },
	rateLimit: {
		api: 	  { algorithm: 'token-bucket', limit: 100, onExceeded: 'fail', 	recovery: undefined, 	  tokens: 1, window: Duration.minutes(1)  },
		auth: 	  { algorithm: 'fixed-window', limit: 5, onExceeded: 'fail', 	recovery: 'email-verify', tokens: 1, window: Duration.minutes(15) },
		mfa: 	  { algorithm: 'fixed-window', limit: 5, onExceeded: 'fail', 	recovery: 'email-verify', tokens: 1, window: Duration.minutes(15) },
		mutation: { algorithm: 'token-bucket', limit: 100, onExceeded: 'delay', recovery: undefined, 	  tokens: 5, window: Duration.minutes(1)  },
	},
	redis: { connectTimeout: 5000, enableReadyCheck: true, host: 'localhost', lazyConnect: false, maxRetriesPerRequest: 3, port: 6379, prefix: 'persist:' },
} as const;
const _redisConfig = Config.all({
	connectTimeout: Config.integer('REDIS_CONNECT_TIMEOUT').pipe(Config.withDefault(_CONFIG.redis.connectTimeout)),
	enableReadyCheck: Config.boolean('REDIS_READY_CHECK').pipe(Config.withDefault(_CONFIG.redis.enableReadyCheck)),
	host: Config.string('REDIS_HOST').pipe(Config.withDefault(_CONFIG.redis.host)),
	lazyConnect: Config.boolean('REDIS_LAZY_CONNECT').pipe(Config.withDefault(_CONFIG.redis.lazyConnect)),
	// maxRetriesPerRequest: 3 → ~300ms total wait (3 x ~100ms), fail-fast for API serving
	maxRetriesPerRequest: Config.integer('REDIS_MAX_RETRIES').pipe(Config.withDefault(_CONFIG.redis.maxRetriesPerRequest)),
	password: Config.redacted('REDIS_PASSWORD').pipe(Config.option, Config.map(Option.match({ onNone: () => undefined, onSome: Redacted.value }))),
	port: Config.integer('REDIS_PORT').pipe(Config.withDefault(_CONFIG.redis.port)),
	prefix: Config.string('CACHE_PREFIX').pipe(Config.withDefault(_CONFIG.redis.prefix)),
	// socketTimeout: Faster dead socket detection (default 15s)
	socketTimeout: Config.integer('REDIS_SOCKET_TIMEOUT').pipe(Config.withDefault(15000)),
});

// --- [SERVICES] --------------------------------------------------------------

class CacheService extends Effect.Service<CacheService>()('server/CacheService', {
	scoped: Effect.gen(function* () {
		const configuration = yield* _redisConfig;
		const redisOpts = { connectTimeout: configuration.connectTimeout, enableReadyCheck: configuration.enableReadyCheck, host: configuration.host, lazyConnect: configuration.lazyConnect, maxRetriesPerRequest: configuration.maxRetriesPerRequest, password: configuration.password, port: configuration.port, socketTimeout: configuration.socketTimeout };
		// Effect.acquireRelease for proper resource lifecycle with graceful quit()
		const redis = yield* Effect.acquireRelease(
			Effect.sync(() => new Redis(redisOpts)),
			(connection) => Effect.promise(() => connection.quit()),
		);
		// Redis error handler for observability
		redis.on('error', (error) => { Effect.runFork(Effect.logError('Redis connection error', { error: String(error), host: configuration.host, port: configuration.port })); });
		const sub = yield* Effect.acquireRelease(
			Effect.sync(() => redis.duplicate()),
			(subscriber) => Effect.sync(() => subscriber.unsubscribe()).pipe(Effect.andThen(Effect.promise(() => subscriber.quit()))),
		);
		const reactivity = yield* Reactivity.make;
		// Bridge: Redis pub/sub → local Reactivity with schema validation and retry
		yield* Effect.tryPromise(() => sub.subscribe(_CONFIG.pubsub.channel)).pipe(
			Effect.retry(Schedule.exponential(Duration.millis(100)).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(3)))),
			Effect.catchAll((error) => Effect.logWarning('Redis pub/sub unavailable', { error: String(error) })),
		);
		sub.on('message', (ch, msg) => ch === _CONFIG.pubsub.channel && Effect.runFork(
			S.decodeUnknown(S.Struct({ key: S.String, storeId: S.String }))(JSON.parse(msg)).pipe(
				Effect.flatMap(({ key, storeId }) => reactivity.invalidate([`${storeId}:${key}`])),
				Effect.catchAll((error) => Effect.logWarning('Malformed invalidation message', { channel: ch, error: String(error) })),
			),
		));
		yield* Effect.logInfo('CacheService initialized', { host: configuration.host, port: configuration.port });
		return { _prefix: configuration.prefix, _reactivity: reactivity, _redis: redis, _redisOpts: redisOpts };
	}),
}) {
	// --- [PERSISTENCE_LAYER] - ResultPersistence backed by Redis -------------
	static readonly Persistence: Layer.Layer<Persistence.ResultPersistence, never, CacheService> = Layer.unwrapScoped(
		CacheService.pipe(Effect.map((service) => PersistenceRedis.layerResult(service._redisOpts))),
	);
	// --- [CACHE] - Factory for typed PersistedCache with infrastructure -------
	static readonly cache: {
		<K extends Persistence.ResultPersistence.KeyAny, R>(options: {
			readonly storeId: string;
			readonly lookup: (key: K) => Effect.Effect<S.WithResult.Success<K>, S.WithResult.Failure<K>, R>;
			readonly timeToLive?: Duration.DurationInput;
			readonly inMemoryCapacity?: number;
			readonly inMemoryTTL?: Duration.DurationInput;
		}): Effect.Effect<PersistedCache.PersistedCache<K>, never, CacheService | S.SerializableWithResult.Context<K> | R | Persistence.ResultPersistence | Scope.Scope>;
		<K extends Persistence.ResultPersistence.KeyAny, A, R>(options: {
			readonly storeId: string;
			readonly lookup: (key: K) => Effect.Effect<Option.Option<A>, S.WithResult.Failure<K>, R>;
			readonly map: (value: A) => S.WithResult.Success<K> extends Option.Option<infer B> ? B : never;
			readonly onSome?: (value: A) => Effect.Effect<void, never, R>;
			readonly timeToLive?: Duration.DurationInput;
			readonly inMemoryCapacity?: number;
			readonly inMemoryTTL?: Duration.DurationInput;
		}): Effect.Effect<PersistedCache.PersistedCache<K>, never, CacheService | S.SerializableWithResult.Context<K> | R | Persistence.ResultPersistence | Scope.Scope>;
	} = <K extends Persistence.ResultPersistence.KeyAny, A, R>(options:
		| {
			readonly storeId: string;
			readonly lookup: (key: K) => Effect.Effect<S.WithResult.Success<K>, S.WithResult.Failure<K>, R>;
			readonly timeToLive?: Duration.DurationInput;
			readonly inMemoryCapacity?: number;
			readonly inMemoryTTL?: Duration.DurationInput;
		}
		| {
			readonly storeId: string;
			readonly lookup: (key: K) => Effect.Effect<Option.Option<A>, S.WithResult.Failure<K>, R>;
			readonly map: (value: A) => S.WithResult.Success<K> extends Option.Option<infer B> ? B : never;
			readonly onSome?: (value: A) => Effect.Effect<void, never, R>;
			readonly timeToLive?: Duration.DurationInput;
			readonly inMemoryCapacity?: number;
			readonly inMemoryTTL?: Duration.DurationInput;
		}): Effect.Effect<PersistedCache.PersistedCache<K>, never, CacheService | S.SerializableWithResult.Context<K> | R | Persistence.ResultPersistence | Scope.Scope> =>
		Effect.gen(function* () {
			const _svc = yield* CacheService;
			const { _reactivity, _redis } = _svc;
			const lookup = (key: K): Effect.Effect<S.WithResult.Success<K>, S.WithResult.Failure<K>, R> =>
				Match.value(options).pipe(
					Match.when((opts): opts is {
						readonly storeId: string;
						readonly lookup: (key: K) => Effect.Effect<Option.Option<A>, S.WithResult.Failure<K>, R>;
						readonly map: (value: A) => S.WithResult.Success<K> extends Option.Option<infer B> ? B : never;
						readonly onSome?: (value: A) => Effect.Effect<void, never, R>;
						readonly timeToLive?: Duration.DurationInput;
						readonly inMemoryCapacity?: number;
						readonly inMemoryTTL?: Duration.DurationInput;
					} => 'map' in opts, (opts) =>
						opts.lookup(key).pipe(
							Effect.tap(Option.match({ onNone: () => Effect.void, onSome: opts.onSome ?? (() => Effect.void) })),
							Effect.map(Option.map(opts.map)),
							Effect.map((mapped) => unsafeCoerce<unknown, S.WithResult.Success<K>>(mapped)),
						),
					),
					Match.orElse((opts) => opts.lookup(key)),
				);
			const cache = yield* PersistedCache.make({
				inMemoryCapacity: options.inMemoryCapacity ?? _CONFIG.defaults.inMemoryCapacity,
				inMemoryTTL: options.inMemoryTTL ?? _CONFIG.defaults.inMemoryTTL,
				lookup,
				storeId: options.storeId,
				timeToLive: () => options.timeToLive ?? _CONFIG.defaults.ttl,
			});
			const registrations = new Map<string, () => void>();
			const makeInvalidator = (id: string, key: K) => () => {
				const cleanup = registrations.get(id);
				registrations.delete(id);
				cleanup?.();
				Effect.runFork(cache.invalidate(key).pipe(Effect.ignore));
			};
			const register = (key: K) => Effect.sync(() => {
				const id = `${options.storeId}:${PrimaryKey.value(key)}`;
				return registrations.has(id) || registrations.set(id, _reactivity.unsafeRegister([id], makeInvalidator(id, key)));
			});
			yield* Effect.addFinalizer(() => Effect.sync(() => { registrations.forEach((cleanup) => { cleanup(); }); registrations.clear(); }));
			return {
				get: (key) => register(key).pipe(Effect.andThen(cache.get(key))),
				invalidate: (key) => register(key).pipe(Effect.andThen(CacheService.invalidate(options.storeId, PrimaryKey.value(key))), Effect.provideService(CacheService, _svc)),
			} as const satisfies PersistedCache.PersistedCache<K>;
		});
	// --- [PRESENCE] - WebSocket presence operations via Redis hashes ----------
	static readonly presence = {
		getAll: (tenantId: string) =>
			CacheService.pipe(Effect.flatMap(({ _redis }) =>
				Effect.tryPromise(() => _redis.hgetall(`presence:${tenantId}`)).pipe(
					Effect.map((data) => Object.entries(data).map(([socketId, json]) => ({ socketId, ...JSON.parse(json) as { connectedAt: number; userId: string } }))),
					Effect.orElseSucceed(() => []),
				),
			)),
		refresh: (tenantId: string) =>
			CacheService.pipe(Effect.flatMap(({ _redis }) =>
				Effect.tryPromise(() => _redis.expire(`presence:${tenantId}`, _CONFIG.presence.ttlSeconds)).pipe(Effect.ignore),
			)),
		remove: (tenantId: string, socketId: string) => CacheService.pipe(Effect.flatMap(({ _redis }) => Effect.tryPromise(() => _redis.hdel(`presence:${tenantId}`, socketId)).pipe(Effect.ignore),)),
		set: (tenantId: string, socketId: string, data: { userId: string; connectedAt: number }) =>
			CacheService.pipe(Effect.flatMap(({ _redis }) =>
				Effect.tryPromise(() => _redis.hset(`presence:${tenantId}`, socketId, JSON.stringify(data))).pipe(
					Effect.zipRight(Effect.tryPromise(() => _redis.expire(`presence:${tenantId}`, _CONFIG.presence.ttlSeconds))),
					Effect.ignore,
				),
			)),
	} as const;
	// --- [INVALIDATE] - Cross-instance via Reactivity + Redis pub/sub --------
	static readonly invalidate = (storeId: string, key: string) =>
		CacheService.pipe(Effect.flatMap(({ _reactivity, _redis }) => Effect.all([
			_reactivity.invalidate([`${storeId}:${key}`]),
			Effect.tryPromise(() => _redis.publish(_CONFIG.pubsub.channel, JSON.stringify({ key, storeId }))).pipe(Effect.timeout(Duration.seconds(2)), Effect.ignore),
			Effect.serviceOption(MetricsService).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (metrics) => MetricsService.inc(metrics.cache.evictions, MetricsService.label({ storeId })) }))),
		], { discard: true })));
	// --- [RATE_LIMIT] - Token bucket / fixed window --------------------------
	static readonly rateLimit: {
		<A, E, R>(preset: CacheService.RateLimitPreset, handler: Effect.Effect<A, E, R>): Effect.Effect<A, E | HttpError.RateLimit, R | AuditService | CacheService | MetricsService | RateLimiter | SqlClient.SqlClient>;
		(preset: CacheService.RateLimitPreset): <A, E, R>(handler: Effect.Effect<A, E, R>) => Effect.Effect<A, E | HttpError.RateLimit, R | AuditService | CacheService | MetricsService | RateLimiter | SqlClient.SqlClient>;
	} = F.dual(2, <A, E, R>(preset: CacheService.RateLimitPreset, handler: Effect.Effect<A, E, R>) => _rateLimit(preset, handler));
	// --- [HEADERS] - HTTP middleware for X-RateLimit-* -----------------------
	static readonly headers = HttpMiddleware.make((app) =>
		Effect.gen(function* () {
			const response = yield* app;
			const ctx = yield* Context.Request.current;
			return Option.match(ctx.rateLimit, {
				onNone: () => response,
				onSome: (rateLimit) => HttpServerResponse.setHeaders(response, {
					'X-RateLimit-Limit': String(rateLimit.limit),
					'X-RateLimit-Remaining': String(N.clamp({ maximum: rateLimit.limit, minimum: 0 })(rateLimit.remaining)),
					'X-RateLimit-Reset': String(Math.ceil(Duration.toMillis(rateLimit.resetAfter) / 1000)),
				}),
			});
		}));
	// --- [HEALTH] - Redis connection + latency via Effect.timed --------------
	static readonly health = () =>
		CacheService.pipe(
			Effect.flatMap((service) => Effect.tryPromise(() => service._redis.ping()).pipe(Effect.timed)),
			Effect.map(([duration, result]) => ({ connected: result === 'PONG', latencyMs: Math.round(Duration.toMillis(duration)) })),
			Effect.orElseSucceed(F.constant({ connected: false, latencyMs: 0 })),
		);
	// --- [SET_NX] - Atomic set-if-not-exists (replay protection) -------------
	static readonly setNX = (key: string, value: string, ttl: Duration.Duration) =>
		CacheService.pipe(
			Effect.flatMap((service) => Effect.tryPromise(() => service._redis.set(`${service._prefix}${key}`, value, 'PX', Duration.toMillis(ttl), 'NX'))),
			Effect.map((result) => ({ alreadyExists: result === null, key })),
		// [CRITICAL] Fail-closed: treat Redis failure as "already exists" to prevent TOTP replay attacks
		Effect.catchAll((error) => Effect.logWarning('Redis SET NX failed (fail-closed)', { error: String(error) }).pipe(Effect.as({ alreadyExists: true, key }))),
		);
	// --- [REDIS] - Raw access for specialized ops ----------------------------
	static readonly redis = CacheService.pipe(Effect.map((service) => service._redis));
	// --- [LAYER] - Full cache infrastructure ---------------------------------
	static readonly Layer = CacheService.Default.pipe(	// Unified Redis connection - RateLimiter uses memory store by default, Redis store shares config
		Layer.provideMerge(rateLimiterLayer),
		Layer.provideMerge(Layer.unwrapEffect(
			Config.all({ prefix: Config.string('RATE_LIMIT_PREFIX').pipe(Config.withDefault('rl:')), redis: _redisConfig, store: Config.string('RATE_LIMIT_STORE').pipe(Config.withDefault('redis')) }).pipe(
				Effect.map(({ prefix, redis, store }) => Match.value(store).pipe(
					Match.when('redis', () => layerStoreRedis({ host: redis.host, password: redis.password, port: redis.port, prefix })),
					Match.orElse(() => layerStoreMemory),
				)),
			),
		)),
	);
	static readonly LayerWithPersistence = CacheService.Layer.pipe(Layer.provideMerge(CacheService.Persistence));	// Full layer adds ResultPersistence for PersistedCache consumers
}

// --- [FUNCTIONS] -------------------------------------------------------------

const _rateLimit = <A, E, R>(preset: CacheService.RateLimitPreset, handler: Effect.Effect<A, E, R>) =>
	Effect.all([RateLimiter, Context.Request.current, HttpServerRequest.HttpServerRequest, MetricsService, AuditService]).pipe(
		Effect.flatMap(([limiter, ctx, request, metrics, audit]) => {
			const config = _CONFIG.rateLimit[preset];
			const ip = ctx.ipAddress.pipe(Option.orElse(() => request.remoteAddress), Option.getOrElse(() => 'unknown'));
			const tenantId = ctx.tenantId;
			const userId = Option.match(ctx.session, { onNone: () => 'anonymous', onSome: (session) => session.userId });
			const labels = MetricsService.label({ preset });
			return limiter.consume({ algorithm: config.algorithm, key: `${preset}:${tenantId}:${userId}:${ip}`, limit: config.limit, onExceeded: config.onExceeded, tokens: config.tokens, window: config.window }).pipe(
				Metric.trackDuration(Metric.taggedWithLabels(metrics.rateLimit.checkDuration, labels)),
				Effect.catchAll((error) => error instanceof RateLimitExceeded
					? Effect.all([
						Context.Request.update({ rateLimit: Option.some({ delay: Duration.zero, limit: error.limit, remaining: error.remaining, resetAfter: error.retryAfter }) }),
						MetricsService.inc(metrics.rateLimit.rejections, labels),
						Context.Request.withinSync(ctx.tenantId, audit.log('rate_limited', { details: { limit: error.limit, preset, remaining: error.remaining, resetAfterMs: Duration.toMillis(error.retryAfter) } })).pipe(
							Effect.catchAll(() => Effect.void),
						),
					], { discard: true }).pipe(Effect.andThen(Effect.fail(HttpError.RateLimit.of(Duration.toMillis(error.retryAfter), {
						limit: error.limit, remaining: error.remaining, resetAfterMs: Duration.toMillis(error.retryAfter),
						...(config.recovery ? { recoveryAction: config.recovery } : {}),
					}))))
					: Effect.all([
						Effect.logWarning('Rate limit store unavailable (fail-open)', { error: String(error), preset }),
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

declare namespace CacheService {
	type RateLimitPreset = keyof typeof _CONFIG.rateLimit;
}

// --- [EXPORT] ----------------------------------------------------------------

export { CacheService };
