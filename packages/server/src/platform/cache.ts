/**
 * Cache infrastructure: PersistedCache + Redis.
 * ResultPersistence layer, cross-instance invalidation, rate limiting, health.
 *
 * Supports three Redis modes via REDIS_MODE config:
 * - standalone (default): single Redis instance
 * - cluster: Redis Cluster via ioredis Cluster constructor
 * - sentinel: Redis Sentinel via ioredis sentinels option
 */
import { PersistedCache, type Persistence, Reactivity } from '@effect/experimental';
import * as PersistenceRedis from '@effect/experimental/Persistence/Redis';
import { layer as rateLimiterLayer, layerStoreMemory, RateLimitExceeded, RateLimiter } from '@effect/experimental/RateLimiter';
import { layerStore as layerStoreRedis } from '@effect/experimental/RateLimiter/Redis';
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Clock, Config, Data, Duration, Effect, Layer, Match, Metric, Option, PrimaryKey, Redacted, Schedule, Schema as S, type Scope } from 'effect';
import { constant, flow } from 'effect/Function';
import Redis, { Cluster, type ClusterNode, type RedisOptions } from 'ioredis';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { AuditService } from '../observe/audit.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [TYPES] -----------------------------------------------------------------

type RedisConnection = Redis | Cluster;

// --- [CONSTANTS] -------------------------------------------------------------

const _INVALIDATION_CHANNEL = 'cache:invalidate';
const _tlsConfig = Config.all({
	ca: 					Config.redacted('REDIS_TLS_CA').pipe(Config.option),
	cert: 					Config.redacted('REDIS_TLS_CERT').pipe(Config.option),
	enabled: 				Config.boolean('REDIS_TLS').pipe(Config.withDefault(false)),
	key: 					Config.redacted('REDIS_TLS_KEY').pipe(Config.option),
	rejectUnauthorized: 	Config.boolean('REDIS_TLS_REJECT_UNAUTHORIZED').pipe(Config.withDefault(true)),
	servername: 			Config.string('REDIS_TLS_SERVERNAME').pipe(Config.option),
});
const _commonConfig = Config.all({
	commandTimeout: 		Config.integer('REDIS_COMMAND_TIMEOUT').pipe(Config.option),
	connectTimeout: 		Config.integer('REDIS_CONNECT_TIMEOUT').pipe(Config.withDefault(5000)),
	db: 					Config.integer('REDIS_DB').pipe(Config.option),
	enableReadyCheck: 		Config.boolean('REDIS_READY_CHECK').pipe(Config.withDefault(true)),
	lazyConnect: 			Config.boolean('REDIS_LAZY_CONNECT').pipe(Config.withDefault(false)),
	maxRetriesPerRequest: 	Config.integer('REDIS_MAX_RETRIES').pipe(Config.withDefault(3)),
	password: 				Config.redacted('REDIS_PASSWORD').pipe(Config.option, Config.map(Option.match({ onNone: () => undefined, onSome: Redacted.value }))),
	prefix: 				Config.string('CACHE_PREFIX').pipe(Config.withDefault('persist:')),
	socketTimeout: 			Config.integer('REDIS_SOCKET_TIMEOUT').pipe(Config.withDefault(15000)),
	tls: 					_tlsConfig,
	username: 				Config.string('REDIS_USERNAME').pipe(Config.option),
});
const _modeConfig = Config.all({
	clusterNodes: 			Config.string('REDIS_CLUSTER_NODES').pipe(Config.withDefault('')),
	host: 					Config.string('REDIS_HOST').pipe(Config.withDefault('localhost')),
	mode: 					Config.literal('standalone', 'cluster', 'sentinel')('REDIS_MODE').pipe(Config.withDefault('standalone' as const)),
	port: 					Config.integer('REDIS_PORT').pipe(Config.withDefault(6379)),
	sentinelName: 			Config.string('REDIS_SENTINEL_NAME').pipe(Config.withDefault('mymaster')),
	sentinelNodes: 			Config.string('REDIS_SENTINEL_NODES').pipe(Config.withDefault('')),
	sentinelPassword: 		Config.redacted('REDIS_SENTINEL_PASSWORD').pipe(Config.option, Config.map(Option.match({ onNone: () => undefined, onSome: Redacted.value }))),
});
const _redisConfig = Config.all({ common: _commonConfig, mode: _modeConfig }).pipe(Config.map(({ common, mode }) => {
	const tls = _buildTls(common.tls);
	const baseOpts = {
		commandTimeout: 		Option.getOrElse(common.commandTimeout, () => common.socketTimeout),
		connectTimeout: 		common.connectTimeout,
		db: 					Option.getOrUndefined(common.db),
		enableReadyCheck: 		common.enableReadyCheck,
		keyPrefix: 				common.prefix,
		lazyConnect: 			common.lazyConnect,
		maxRetriesPerRequest: 	common.maxRetriesPerRequest,
		password: 				common.password,
		socketTimeout: 			common.socketTimeout,
		tls,
		username: 				Option.getOrUndefined(common.username),
	} as const;
	return Match.value(mode.mode).pipe(
		Match.when('standalone', () => ({
			clusterNodes: [] as ReadonlyArray<ClusterNode>,
			mode: 'standalone' as const,
			redisOpts: { ...baseOpts, host: mode.host, port: mode.port } satisfies RedisOptions,
		})),
		Match.when('cluster', () => {
			const nodes = _parseNodes(mode.clusterNodes);
			const clusterNodes: ReadonlyArray<ClusterNode> = nodes.length > 0 ? nodes : [{ host: mode.host, port: mode.port }];
			return {
				clusterNodes,
				mode: 'cluster' as const,
				// For layers that only accept RedisOptions (Persistence, RateLimiter), use first node as standalone fallback
				redisOpts: { ...baseOpts, host: (clusterNodes[0] as { host: string; port: number }).host, port: (clusterNodes[0] as { host: string; port: number }).port } satisfies RedisOptions,
			};
		}),
		Match.when('sentinel', () => {
			const sentinels = _parseNodes(mode.sentinelNodes);
			const sentinelList = sentinels.length > 0 ? [...sentinels] : [{ host: mode.host, port: 26379 }];
			return {
				clusterNodes: [] as ReadonlyArray<ClusterNode>,
				mode: 'sentinel' as const,
				redisOpts: { ...baseOpts, host: mode.host, name: mode.sentinelName, port: mode.port, sentinelPassword: mode.sentinelPassword, sentinels: sentinelList } satisfies RedisOptions,
			};
		}),
		Match.exhaustive,
	);
}));

// --- [SCHEMA] ----------------------------------------------------------------

const _InvalidationSchema = S.Struct({ key: S.String, storeId: S.String });
const _PresenceSchema = S.Struct({ connectedAt: S.Number, userId: S.String });

// --- [CLASSES] ---------------------------------------------------------------

class RedisError extends Data.TaggedError('RedisError')<{ readonly operation: string; readonly cause: unknown }> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _encodeJsonUnknown = S.encode(S.parseJson(S.Unknown));
const _encodeInvalidation = S.encode(S.parseJson(_InvalidationSchema));
const _runRedis = <A>(operation: string, execute: () => Promise<A>) => Effect.tryPromise({ catch: (cause) => new RedisError({ cause, operation }), try: execute });
const _quitConnection = (connection: RedisConnection) => Effect.promise(() => connection.quit());
const _duplicateConnection = (connection: RedisConnection): RedisConnection => connection instanceof Cluster ? connection.duplicate() : connection.duplicate();
const _parseNodes = (raw: string): ReadonlyArray<{ host: string; port: number }> =>
	raw.split(',').flatMap((entry) => {
		const trimmed = entry.trim();
		const [host, portStr] = trimmed.split(':');
		return (host && portStr) ? [{ host, port: Number(portStr) }] : [];
	});
const _buildTls = (tls: typeof _tlsConfig extends Config.Config<infer A> ? A : never) =>
	tls.enabled ? {
		ca: 				Option.getOrUndefined(Option.map(tls.ca, Redacted.value)),
		cert: 				Option.getOrUndefined(Option.map(tls.cert, Redacted.value)),
		key: 				Option.getOrUndefined(Option.map(tls.key, Redacted.value)),
		rejectUnauthorized: tls.rejectUnauthorized,
		servername: 		Option.getOrUndefined(tls.servername),
	} : undefined;
const _makeConnection = (config: typeof _redisConfig extends Config.Config<infer A> ? A : never): RedisConnection =>
	Match.value(config.mode).pipe(
		Match.when('cluster', () => new Cluster([...config.clusterNodes], {
			enableReadyCheck: config.redisOpts.enableReadyCheck,
			lazyConnect: config.redisOpts.lazyConnect,
			redisOptions: {
				commandTimeout: config.redisOpts.commandTimeout,
				connectTimeout: config.redisOpts.connectTimeout,
				db: config.redisOpts.db,
				keyPrefix: config.redisOpts.keyPrefix,
				maxRetriesPerRequest: config.redisOpts.maxRetriesPerRequest,
				password: config.redisOpts.password,
				socketTimeout: config.redisOpts.socketTimeout,
				tls: config.redisOpts.tls,
				username: config.redisOpts.username,
			},
		})),
		Match.orElse(() => new Redis(config.redisOpts)),
	);

// --- [SERVICES] --------------------------------------------------------------

class CacheService extends Effect.Service<CacheService>()('server/CacheService', {
	scoped: Effect.gen(function* () {
		const config = yield* _redisConfig;
		const redis = yield* Effect.acquireRelease(
			Effect.sync(() => _makeConnection(config)),
			_quitConnection,
		);
		redis.on('error', (error) => { Effect.runFork(Effect.logError('Redis connection error', { error: String(error), mode: config.mode })); });
		const subscriber = yield* Effect.acquireRelease(
			Effect.sync(() => _duplicateConnection(redis)),
			(connection) => Effect.sync(() => { connection.unsubscribe(); }).pipe(Effect.andThen(_quitConnection(connection))),
		);
		subscriber.on('error', (error) => { Effect.runFork(Effect.logError('Redis subscriber error', { error: String(error), mode: config.mode })); });
		const reactivity = yield* Reactivity.make;
		const invalidationChannel = `${config.redisOpts.keyPrefix}${_INVALIDATION_CHANNEL}`;
		yield* _runRedis('subscribe', () => subscriber.subscribe(invalidationChannel)).pipe(
			Effect.retry(Resilience.schedule('default')),
			Effect.catchAll((error) => Effect.logWarning('Redis pub/sub unavailable', { error: String(error) })),
		);
		const decodeInvalidation = S.decode(S.parseJson(_InvalidationSchema));
		subscriber.on('message', (channel, raw) => channel === invalidationChannel && Effect.runFork(
			decodeInvalidation(raw).pipe(
				Effect.flatMap(({ key, storeId }) => reactivity.invalidate([`${storeId}:${key}`])),
				Effect.catchAll((error) => Effect.logWarning('Malformed invalidation message', { channel, error: String(error) })),
			),
		));
		const kv = {
			del: (key: string) => _runRedis('del', () => redis.del(key)).pipe(Effect.ignore),
			get: <A, I = A, R = never>(key: string, schema: S.Schema<A, I, R>) =>
				_runRedis('get', () => redis.get(key)).pipe(
					Effect.flatMap((value) => value === null
						? Effect.succeed(Option.none<A>())
						: S.decode(S.parseJson(schema))(value).pipe(Effect.map(Option.some))),
					Effect.catchAll(() => Effect.succeed(Option.none<A>())),
				),
			set: (key: string, value: unknown, ttl: Duration.Duration) => _encodeJsonUnknown(value).pipe(
				Effect.flatMap((json) => _runRedis('set', () => redis.set(key, json, 'PX', Duration.toMillis(ttl)))),
				Effect.ignore,
			),
		} as const;
		const sets = {
			add: (key: string, ...members: readonly string[]) => _runRedis('sadd', () => redis.sadd(key, ...members)).pipe(Effect.ignore),
			members: (key: string) => _runRedis('smembers', () => redis.smembers(key)).pipe(Effect.orElseSucceed(() => [] as readonly string[])),
			remove: (key: string, ...members: readonly string[]) => _runRedis('srem', () => redis.srem(key, ...members)).pipe(Effect.ignore),
		} as const;
		yield* Effect.logInfo('CacheService initialized', { mode: config.mode });
		return { _invalidationChannel: invalidationChannel, _prefix: config.redisOpts.keyPrefix, _reactivity: reactivity, _redis: redis, _redisOpts: config.redisOpts, kv, sets };
	}),
}) {
	// --- [RATE_LIMITS_PRESETS] -----------------------------------------------
		static readonly _rateLimits = {
			api:      { algorithm: 'token-bucket', failMode: 'open',   limit: 100, onExceeded: 'fail',  recovery: undefined,      tokens: 1, window: Duration.minutes(1)  },
			auth:     { algorithm: 'fixed-window', failMode: 'closed', limit: 5,   onExceeded: 'fail',  recovery: 'email-verify', tokens: 1, window: Duration.minutes(15) },
			health:   { algorithm: 'token-bucket', failMode: 'open',   limit: 300, onExceeded: 'fail',  recovery: undefined,      tokens: 1, window: Duration.minutes(1)  },
			mfa:      { algorithm: 'fixed-window', failMode: 'closed', limit: 5,   onExceeded: 'fail',  recovery: 'email-verify', tokens: 1, window: Duration.minutes(15) },
			mutation: { algorithm: 'token-bucket', failMode: 'open',   limit: 100, onExceeded: 'delay', recovery: undefined,      tokens: 5, window: Duration.minutes(1)  },
			realtime: { algorithm: 'token-bucket', failMode: 'open',   limit: 300, onExceeded: 'fail',  recovery: undefined,      tokens: 1, window: Duration.minutes(1)  },
		} as const;
	// --- [PERSISTENCE_LAYER] -------------------------------------------------
	static readonly Persistence: Layer.Layer<Persistence.ResultPersistence, never, CacheService> = Layer.unwrapScoped(
		CacheService.pipe(Effect.map((service) => PersistenceRedis.layerResult(service._redisOpts))),
	);
	// --- [CACHE] -------------------------------------------------------------
	static readonly cache: {
		<K extends Persistence.ResultPersistence.KeyAny, R>(options: {
			readonly storeId: string;
			readonly lookup: (key: K) => Effect.Effect<S.WithResult.Success<K>, S.WithResult.Failure<K>, R>;
			readonly timeToLive?: Duration.DurationInput;
			readonly inMemoryCapacity?: number;
			readonly inMemoryTTL?: Duration.DurationInput;
		}): Effect.Effect<PersistedCache.PersistedCache<K>, never, CacheService | S.SerializableWithResult.Context<K> | R | Persistence.ResultPersistence | Scope.Scope>; // NOSONAR S3358
		<K extends Persistence.ResultPersistence.KeyAny, A, R>(options: {
			readonly storeId: string;
			readonly lookup: (key: K) => Effect.Effect<Option.Option<A>, S.WithResult.Failure<K>, R>;
			readonly map: (value: A) => S.WithResult.Success<K> extends Option.Option<infer B> ? B : never;
			readonly onSome?: (value: A) => Effect.Effect<void, never, R>;
			readonly timeToLive?: Duration.DurationInput;
			readonly inMemoryCapacity?: number;
			readonly inMemoryTTL?: Duration.DurationInput;
		}): Effect.Effect<PersistedCache.PersistedCache<K>, never, CacheService | S.SerializableWithResult.Context<K> | R | Persistence.ResultPersistence | Scope.Scope>;
	} = <K extends Persistence.ResultPersistence.KeyAny, A, R>(options: {
		readonly storeId: string; readonly timeToLive?: Duration.DurationInput; readonly inMemoryCapacity?: number; readonly inMemoryTTL?: Duration.DurationInput;
	} & ({
		readonly lookup: (key: K) => Effect.Effect<S.WithResult.Success<K>, S.WithResult.Failure<K>, R>;
	} | {
		readonly lookup: (key: K) => Effect.Effect<Option.Option<A>, S.WithResult.Failure<K>, R>;
		readonly map: (value: A) => S.WithResult.Success<K> extends Option.Option<infer B> ? B : never;
		readonly onSome?: (value: A) => Effect.Effect<void, never, R>;
	})): Effect.Effect<PersistedCache.PersistedCache<K>, never, CacheService | S.SerializableWithResult.Context<K> | R | Persistence.ResultPersistence | Scope.Scope> =>
		Effect.gen(function* () {
			const service = yield* CacheService;
			const { _reactivity } = service;
			const metricsOpt = yield* Effect.serviceOption(MetricsService);
			const labels = MetricsService.label({ storeId: options.storeId });
			const lookup = (key: K): Effect.Effect<S.WithResult.Success<K>, S.WithResult.Failure<K>, R> => {
				const run = 'map' in options
					? options.lookup(key).pipe(
						Effect.tap((opt) => Option.match(opt, {
							onNone: constant(Effect.void),
							onSome: options.onSome ?? Effect.succeed,
						})),
						Effect.map((opt) => Option.match(opt, {
							onNone: constant(Option.none<S.WithResult.Success<K> extends Option.Option<infer B> ? B : never>()),
							onSome: flow(options.map, Option.some),
						}) as S.WithResult.Success<K>),
					)
					: options.lookup(key);
				return Option.match(metricsOpt, {
					onNone: constant(run),
					onSome: (metrics) => run.pipe(
						Metric.trackDuration(Metric.taggedWithLabels(metrics.cache.lookupDuration, labels)),
						Effect.tapBoth({ onFailure: constant(MetricsService.inc(metrics.cache.misses, labels)), onSuccess: constant(MetricsService.inc(metrics.cache.hits, labels)) }),
					),
				});
			};
			const inMemoryCapacity = options.inMemoryCapacity ?? 1000;
			const inMemoryTTL = Duration.decode(options.inMemoryTTL ?? Duration.seconds(30));
			const cache = yield* PersistedCache.make({
				inMemoryCapacity,
				inMemoryTTL,
				lookup,
				storeId: options.storeId,
				timeToLive: () => options.timeToLive ?? Duration.minutes(5),
			});
			const registered = new Map<string, { cleanup: () => void; expiresAt: number }>();
			const ttlMs = Duration.toMillis(inMemoryTTL);
			const pruneSingleEntry = ([id, entry]: [string, { cleanup: () => void; expiresAt: number }], now: number) =>
				Effect.when(
					Effect.sync(() => { entry.cleanup(); registered.delete(id); }),
					() => entry.expiresAt <= now
				);
			const pruneOnce = Clock.currentTimeMillis.pipe(Effect.tap((now) =>
				Effect.forEach(
					[...registered.entries()],
					(entry) => pruneSingleEntry(entry, now),
					{ discard: true }
				)
			));
			yield* Effect.forkScoped(pruneOnce.pipe(Effect.repeat(Schedule.spaced(inMemoryTTL))));
			const ensureRegistered = (key: K, primary: string) => {
				const id = `${options.storeId}:${primary}`;
				const newCleanup = () => { registered.delete(id); Effect.runFork(cache.invalidate(key).pipe(Effect.ignore)); };
				return Effect.gen(function* () {
					const now = yield* pruneOnce;
					const existing = registered.get(id);
					registered.set(id, { cleanup: existing?.cleanup ?? _reactivity.unsafeRegister([id], newCleanup), expiresAt: now + ttlMs });
				});
			};
			yield* Effect.addFinalizer(() =>
				Effect.forEach(
					[...registered.values()],
					(entry) => Effect.sync(entry.cleanup),
					{ discard: true }
				).pipe(Effect.andThen(Effect.sync(() => { registered.clear(); })))
			);
			return {
				get: (key) => {
					const primary = PrimaryKey.value(key);
					return ensureRegistered(key, primary).pipe(Effect.andThen(cache.get(key)));
				},
				invalidate: (key) => {
					const primary = PrimaryKey.value(key);
					return ensureRegistered(key, primary).pipe(Effect.andThen(CacheService.invalidate(options.storeId, primary)), Effect.provideService(CacheService, service));
				},
			} as const satisfies PersistedCache.PersistedCache<K>;
		});
	// --- [WEBSOCKET_PRESENCE] ------------------------------------------------
	static readonly presence = {
		getAll: (tenantId: string) =>
			CacheService.pipe(
				Effect.flatMap(({ _redis }) => _runRedis('hgetall', () => _redis.hgetall(`presence:${tenantId}`))),
				Effect.flatMap((data) => Effect.forEach(Object.entries(data), ([socketId, json]) =>
					S.decode(S.parseJson(_PresenceSchema))(json).pipe(Effect.map((payload) => ({ socketId, ...payload })), Effect.option),
					{ concurrency: 'unbounded' })),
				Effect.map((items) => items.flatMap(Option.toArray)),
				Effect.orElseSucceed(() => []),
			),
		refresh: (tenantId: string) => CacheService.pipe(Effect.flatMap(({ _redis }) => _runRedis('expire', () => _redis.expire(`presence:${tenantId}`, 120)))).pipe(Effect.ignore),
		remove: (tenantId: string, socketId: string) => CacheService.pipe(Effect.flatMap(({ _redis }) => _runRedis('hdel', () => _redis.hdel(`presence:${tenantId}`, socketId)))).pipe(Effect.ignore),
		set: (tenantId: string, socketId: string, data: { userId: string; connectedAt: number }) =>
			S.encode(S.parseJson(_PresenceSchema))(data).pipe(
				Effect.flatMap((json) => CacheService.pipe(Effect.flatMap(({ _redis }) =>
					_runRedis('multi:hset+expire', () => _redis.multi()
						.hset(`presence:${tenantId}`, socketId, json)
						.expire(`presence:${tenantId}`, 120)
						.exec())))),
				Effect.ignore,
			),
	} as const;
	// --- [KV] ----------------------------------------------------------------
	static readonly kv = {
		del: (key: string) => CacheService.pipe(Effect.flatMap((service) => service.kv.del(key))),
		get: <A, I = A, R = never>(key: string, schema: S.Schema<A, I, R>) => CacheService.pipe(Effect.flatMap((service) => service.kv.get(key, schema))),
		set: (key: string, value: unknown, ttl: Duration.Duration) => CacheService.pipe(Effect.flatMap((service) => service.kv.set(key, value, ttl))),
	} as const;
	// --- [REDIS_SETS] --------------------------------------------------------
	static readonly sets = {
		add: (key: string, ...members: readonly string[]) => CacheService.pipe(Effect.flatMap((service) => service.sets.add(key, ...members))),
		members: (key: string) => CacheService.pipe(Effect.flatMap((service) => service.sets.members(key))),
		remove: (key: string, ...members: readonly string[]) => CacheService.pipe(Effect.flatMap((service) => service.sets.remove(key, ...members))),
	} as const;
	// --- [CROSS_INSTANCE_REACTIVITY] -----------------------------------------
	static readonly invalidate = (storeId: string, key: string) =>
		CacheService.pipe(Effect.flatMap(({ _invalidationChannel, _reactivity, _redis }) => Effect.all([
			_reactivity.invalidate([`${storeId}:${key}`]),
			_encodeInvalidation({ key, storeId }).pipe(Effect.flatMap((json) => _runRedis('publish', () => _redis.publish(_invalidationChannel, json))), Effect.timeout(Duration.seconds(2)), Effect.ignore),
			Effect.serviceOption(MetricsService).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (metrics) => MetricsService.inc(metrics.cache.evictions, MetricsService.label({ storeId })) }))),
		], { discard: true })));
	// --- [RATE_LIMIT] --------------------------------------------------------
	static readonly rateLimit = <A, E, R>(preset: CacheService.RateLimitPreset, handler: Effect.Effect<A, E, R>) =>
		Effect.gen(function* () {
			const [limiter, requestContext, request, metrics, audit] = yield* Effect.all([RateLimiter, Context.Request.current, HttpServerRequest.HttpServerRequest, MetricsService, AuditService]);
			const config = CacheService._rateLimits[preset];
			const ipAddress = requestContext.ipAddress.pipe(Option.orElse(() => request.remoteAddress), Option.getOrElse(() => 'unknown'));
			const tenantId = requestContext.tenantId;
			const userId = Option.match(requestContext.session, { onNone: () => 'anonymous', onSome: (session) => session.userId });
			const labels = MetricsService.label({ preset });
			const result = yield* limiter.consume({ algorithm: config.algorithm, key: `${preset}:${tenantId}:${userId}:${ipAddress}`, limit: config.limit, onExceeded: config.onExceeded, tokens: config.tokens, window: config.window }).pipe(
				Metric.trackDuration(Metric.taggedWithLabels(metrics.rateLimit.checkDuration, labels)),
				Effect.catchAll((error) => error instanceof RateLimitExceeded
					? Effect.all([
						Context.Request.update({ rateLimit: Option.some({ delay: Duration.zero, limit: error.limit, remaining: error.remaining, resetAfter: error.retryAfter }) }),
						MetricsService.inc(metrics.rateLimit.rejections, labels),
						Context.Request.withinSync(requestContext.tenantId, audit.log('rate_limited', { details: { limit: error.limit, preset, remaining: error.remaining, resetAfterMs: Duration.toMillis(error.retryAfter) } })).pipe(Effect.ignore),
					], { discard: true }).pipe(Effect.andThen(Effect.fail(HttpError.RateLimit.of(Duration.toMillis(error.retryAfter), {
						limit: error.limit, remaining: error.remaining, resetAfterMs: Duration.toMillis(error.retryAfter),
						...(config.recovery ? { recoveryAction: config.recovery } : {}),
					}))))
					: ({
						closed: Effect.all([
							Effect.logWarning('Rate limit store unavailable (fail-closed)', { error: String(error), preset }),
							MetricsService.inc(metrics.rateLimit.storeFailures, labels),
							Context.Request.update({ rateLimit: Option.some({ delay: Duration.zero, limit: config.limit, remaining: 0, resetAfter: config.window }) }),
						], { discard: true }).pipe(Effect.andThen(Effect.fail(HttpError.RateLimit.of(Duration.toMillis(config.window), {
							limit: config.limit, remaining: 0, resetAfterMs: Duration.toMillis(config.window),
							...(config.recovery ? { recoveryAction: config.recovery } : {}),
						})))),
						open: Effect.all([
							Effect.logWarning('Rate limit store unavailable (fail-open)', { error: String(error), preset }),
							MetricsService.inc(metrics.rateLimit.storeFailures, labels),
						], { discard: true }).pipe(Effect.as({ delay: Duration.zero, limit: config.limit, remaining: config.limit, resetAfter: config.window })),
					})[config.failMode]),
			);
			yield* Context.Request.update({ rateLimit: Option.some(result) });
			yield* Effect.when(Effect.sleep(result.delay), () => Duration.toMillis(result.delay) > 0);
			return yield* handler;
			}).pipe(Telemetry.span(`cache.rateLimit.${preset}`, { metrics: false }));
	// --- [HEADERS] -----------------------------------------------------------
	static readonly headers = HttpMiddleware.make((app) =>
		Effect.gen(function* () {
			const response = yield* app;
			const requestContext = yield* Context.Request.current;
				return Option.match(requestContext.rateLimit, {
					onNone: () => response,
					onSome: (rateLimit) => HttpServerResponse.setHeaders(response, {
						'Retry-After': String(Math.ceil(Duration.toMillis(rateLimit.resetAfter) / 1000)),
						'X-RateLimit-Limit': String(rateLimit.limit),
						'X-RateLimit-Remaining': String(Math.max(0, Math.min(rateLimit.limit, rateLimit.remaining))),
						'X-RateLimit-Reset': String(Math.ceil(Duration.toMillis(rateLimit.resetAfter) / 1000)),
					}),
				});
		}));
	// --- [HEALTH] ------------------------------------------------------------
	static readonly health = () =>
		CacheService.pipe(Effect.flatMap(({ _redis }) => _runRedis('ping', () => _redis.ping()))).pipe(
			Effect.timed,
			Effect.map(([duration, result]) => ({ connected: result === 'PONG', latencyMs: Math.round(Duration.toMillis(duration)) })),
			Effect.orElseSucceed(() => ({ connected: false, latencyMs: 0 })),
		);
	// --- [SET_NX] ------------------------------------------------------------
	static readonly setNX = (key: string, value: string, ttl: Duration.Duration) =>
		CacheService.pipe(
			Effect.flatMap((service) => _runRedis('setNX', () => service._redis.set(key, value, 'PX', Duration.toMillis(ttl), 'NX'))),
			Effect.map((result) => ({ alreadyExists: result === null, key })),
			// [CRITICAL] Fail-closed: treat Redis failure as "already exists" to prevent TOTP replay attacks
			Effect.catchAll((error) => Effect.logWarning('Redis SET NX failed (fail-closed)', { error: String(error) }).pipe(Effect.as({ alreadyExists: true, key }))),
		);
	// --- [LAYER] -------------------------------------------------------------
	static readonly Layer = CacheService.Default.pipe(
		Layer.provideMerge(rateLimiterLayer),
		Layer.provideMerge(Layer.unwrapEffect(
			Config.all({ prefix: Config.string('RATE_LIMIT_PREFIX').pipe(Config.withDefault('rl:')), redisOpts: _redisConfig, store: Config.string('RATE_LIMIT_STORE').pipe(Config.withDefault('redis')) }).pipe(
				Effect.map(({ prefix, redisOpts, store }) => Match.value(store).pipe(
					Match.when('redis', () => layerStoreRedis({ ...redisOpts.redisOpts, prefix })),
					Match.orElse(() => layerStoreMemory),
				)),
			),
		)),
		Layer.provideMerge(CacheService.Persistence),
	);
}

// --- [NAMESPACE] -------------------------------------------------------------

declare namespace CacheService {
	type RateLimitPreset = keyof typeof CacheService._rateLimits;
}

// --- [EXPORT] ----------------------------------------------------------------

export { CacheService };
