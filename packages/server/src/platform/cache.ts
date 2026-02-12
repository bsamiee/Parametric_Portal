/** Cache infrastructure: PersistedCache + Redis (standalone/sentinel). */
import { PersistedCache, type Persistence, Reactivity } from '@effect/experimental';
import * as PersistenceRedis from '@effect/experimental/Persistence/Redis';
import { layer as rateLimiterLayer, layerStoreMemory, RateLimitExceeded, RateLimiter } from '@effect/experimental/RateLimiter';
import { layerStore as layerStoreRedis } from '@effect/experimental/RateLimiter/Redis';
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Clock, Config, Data, Duration, Effect, Layer, Match, Metric, Option, PrimaryKey, Redacted, Schedule, Schema as S, type Scope } from 'effect';
import { constant, flow } from 'effect/Function';
import Redis, { type RedisOptions } from 'ioredis';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [ERRORS] ----------------------------------------------------------------

class RedisError extends Data.TaggedError('RedisError')<{ readonly operation: string; readonly cause: unknown }> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _runRedis = <A>(operation: string, execute: () => Promise<A>) => Effect.tryPromise({ catch: (cause) => new RedisError({ cause, operation }), try: execute });
const _parseNodes = (raw: string) => raw.split(',').flatMap((entry) => {
    const [hostRaw, portRaw] = entry.trim().split(':');
    const host = hostRaw?.trim() ?? '';
    const port = Number(portRaw);
    return host !== '' && Number.isInteger(port) && port >= 1 && port <= 65_535 ? [{ host, port }] : [];
});

// --- [CONSTANTS] -------------------------------------------------------------

const _redisConfig = Config.all({
    autoPipeline:                   Config.boolean('REDIS_AUTO_PIPELINE').pipe(Config.withDefault(false)),
    autoResendUnfulfilledCommands:  Config.boolean('REDIS_AUTO_RESEND_UNFULFILLED').pipe(Config.withDefault(true)),
    autoResubscribe:                Config.boolean('REDIS_AUTO_RESUBSCRIBE').pipe(Config.withDefault(true)),
    blockingTimeout:                Config.integer('REDIS_BLOCKING_TIMEOUT').pipe(Config.option),
    commandTimeout:                 Config.integer('REDIS_COMMAND_TIMEOUT').pipe(Config.option),
    connectionName:                 Config.string('REDIS_CONNECTION_NAME').pipe(Config.withDefault('parametric-portal')),
    connectTimeout:                 Config.integer('REDIS_CONNECT_TIMEOUT').pipe(Config.withDefault(5000)),
    db:                             Config.integer('REDIS_DB').pipe(Config.option),
    disableClientInfo:              Config.boolean('REDIS_DISABLE_CLIENT_INFO').pipe(Config.withDefault(false)),
    enableOfflineQueue:             Config.boolean('REDIS_ENABLE_OFFLINE_QUEUE').pipe(Config.withDefault(true)),
    enableReadyCheck:               Config.boolean('REDIS_READY_CHECK').pipe(Config.withDefault(true)),
    host:                           Config.string('REDIS_HOST').pipe(Config.withDefault('localhost')),
    keepAlive:                      Config.integer('REDIS_KEEP_ALIVE').pipe(Config.withDefault(0)),
    lazyConnect:                    Config.boolean('REDIS_LAZY_CONNECT').pipe(Config.withDefault(false)),
    maxLoadingRetryTime:            Config.integer('REDIS_MAX_LOADING_RETRY_TIME').pipe(Config.withDefault(10000)),
    maxRetriesPerRequest:           Config.integer('REDIS_MAX_RETRIES_PER_REQUEST').pipe(Config.withDefault(20)),
    mode:                           Config.literal('standalone', 'sentinel')('REDIS_MODE').pipe(Config.withDefault('standalone' as const)),
    noDelay:                        Config.boolean('REDIS_NO_DELAY').pipe(Config.withDefault(true)),
    password:                       Config.redacted('REDIS_PASSWORD').pipe(Config.option),
    port:                           Config.integer('REDIS_PORT').pipe(Config.withDefault(6379)),
    prefix:                         Config.string('CACHE_PREFIX').pipe(Config.withDefault('persist:')),
    retryBaseMs:                    Config.integer('REDIS_RETRY_BASE_MS').pipe(Config.withDefault(50)),
    retryCapMs:                     Config.integer('REDIS_RETRY_CAP_MS').pipe(Config.withDefault(2000)),
    retryMaxAttempts:               Config.integer('REDIS_MAX_RETRIES').pipe(Config.withDefault(3)),
    sentinelCommandTimeout:         Config.integer('REDIS_SENTINEL_COMMAND_TIMEOUT').pipe(Config.option),
    sentinelFailoverDetector:       Config.boolean('REDIS_SENTINEL_FAILOVER_DETECTOR').pipe(Config.withDefault(false)),
    sentinelName:                   Config.string('REDIS_SENTINEL_NAME').pipe(Config.withDefault('mymaster')),
    sentinelNodes:                  Config.string('REDIS_SENTINEL_NODES').pipe(Config.withDefault('')),
    sentinelPassword:               Config.redacted('REDIS_SENTINEL_PASSWORD').pipe(Config.option),
    sentinelRole:                   Config.literal('master', 'slave')('REDIS_SENTINEL_ROLE').pipe(Config.withDefault('master' as const)),
    sentinelTls:                    Config.boolean('REDIS_SENTINEL_TLS').pipe(Config.withDefault(false)),
    sentinelUsername:               Config.redacted('REDIS_SENTINEL_USERNAME').pipe(Config.option),
    socketTimeout:                  Config.integer('REDIS_SOCKET_TIMEOUT').pipe(Config.withDefault(15000)),
    tlsCa:                          Config.redacted('REDIS_TLS_CA').pipe(Config.option),
    tlsCert:                        Config.redacted('REDIS_TLS_CERT').pipe(Config.option),
    tlsEnabled:                     Config.boolean('REDIS_TLS').pipe(Config.withDefault(false)),
    tlsKey:                         Config.redacted('REDIS_TLS_KEY').pipe(Config.option),
    tlsRejectUnauthorized:          Config.boolean('REDIS_TLS_REJECT_UNAUTHORIZED').pipe(Config.withDefault(true)),
    tlsServername:                  Config.string('REDIS_TLS_SERVERNAME').pipe(Config.option),
    username:                       Config.string('REDIS_USERNAME').pipe(Config.option),
}).pipe(Config.map((config) => {
    const optValue = (opt: Option.Option<Redacted.Redacted>) => Option.getOrUndefined(Option.map(opt, Redacted.value));
    const tls = config.tlsEnabled ? { ca: optValue(config.tlsCa), cert: optValue(config.tlsCert), key: optValue(config.tlsKey), rejectUnauthorized: config.tlsRejectUnauthorized, servername: Option.getOrUndefined(config.tlsServername) } : undefined;
    const retryStrategy = (times: number) => times > config.retryMaxAttempts ? null : Math.min(times * config.retryBaseMs, config.retryCapMs);
    const baseOpts = {
        autoResendUnfulfilledCommands: config.autoResendUnfulfilledCommands, autoResubscribe: config.autoResubscribe,
        blockingTimeout: Option.getOrUndefined(config.blockingTimeout), commandTimeout: Option.getOrElse(config.commandTimeout, () => config.socketTimeout),
        connectionName: config.connectionName, connectTimeout: config.connectTimeout, db: Option.getOrUndefined(config.db),
        disableClientInfo: config.disableClientInfo, enableAutoPipelining: config.autoPipeline,
        enableOfflineQueue: config.enableOfflineQueue, enableReadyCheck: config.enableReadyCheck,
        keepAlive: config.keepAlive, keyPrefix: config.prefix, lazyConnect: config.lazyConnect,
        maxLoadingRetryTime: config.maxLoadingRetryTime, maxRetriesPerRequest: config.maxRetriesPerRequest,
        noDelay: config.noDelay, password: optValue(config.password), retryStrategy, socketTimeout: config.socketTimeout,
        tls, username: Option.getOrUndefined(config.username),
    } as const;
    const withHost = { ...baseOpts, host: config.host, port: config.port };
        return Match.value(config.mode).pipe(
            Match.when('standalone', () => ({
                connect: () => new Redis(withHost),
                mode: 'standalone' as const,
                redisOpts: withHost satisfies RedisOptions,
            })),
            Match.when('sentinel', () => {
                const sentinels = _parseNodes(config.sentinelNodes);
            const sentinelList = sentinels.length > 0 ? [...sentinels] : [{ host: config.host, port: 26379 }];
            const sentinelOpts = {
                ...baseOpts,
                enableTLSForSentinelMode: config.sentinelTls, failoverDetector: config.sentinelFailoverDetector,host: config.host,
                name: config.sentinelName, port: config.port,role: config.sentinelRole,
                sentinelCommandTimeout: Option.getOrUndefined(config.sentinelCommandTimeout),
                sentinelPassword: optValue(config.sentinelPassword), sentinels: sentinelList, sentinelUsername: optValue(config.sentinelUsername),
            } satisfies RedisOptions;
                return { connect: () => new Redis(sentinelOpts), mode: 'sentinel' as const, redisOpts: sentinelOpts };
            }),
        Match.exhaustive,
    );
}));

// --- [SERVICES] --------------------------------------------------------------

class CacheService extends Effect.Service<CacheService>()('server/CacheService', {
    scoped: Effect.gen(function* () {
        const config = yield* _redisConfig;
        const redis = yield* Effect.acquireRelease(
            Effect.sync(() => config.connect()),
            (connection) => Effect.promise(() => connection.quit()),
        );
        redis.on('error', (error) => { Effect.runFork(Effect.logError('Redis connection error', { error: String(error), mode: config.mode })); });
        const subscriber = yield* Effect.acquireRelease(
            Effect.sync(() => redis.duplicate()),
            (connection) => Effect.sync(() => { connection.unsubscribe(); }).pipe(Effect.andThen(Effect.promise(() => connection.quit()))),
        );
        subscriber.on('error', (error) => { Effect.runFork(Effect.logError('Redis subscriber error', { error: String(error), mode: config.mode })); });
        const reactivity = yield* Reactivity.make;
        const invalidationChannel = `${config.redisOpts.keyPrefix}cache:invalidate`;
        const registeredKeyRefs = new Map<string, Map<string, number>>();
        const registerCacheKey = (storeId: string, key: string) => {
            const storeKeys = registeredKeyRefs.get(storeId) ?? new Map<string, number>();
            storeKeys.set(key, (storeKeys.get(key) ?? 0) + 1);
            registeredKeyRefs.set(storeId, storeKeys);
        };
        const unregisterCacheKey = (storeId: string, key: string) => {
            const storeKeys = registeredKeyRefs.get(storeId) ?? new Map<string, number>();
            const nextRefs = Math.max(0, (storeKeys.get(key) ?? 0) - 1);
            nextRefs === 0 ? storeKeys.delete(key) : storeKeys.set(key, nextRefs);
            storeKeys.size === 0 ? registeredKeyRefs.delete(storeId) : registeredKeyRefs.set(storeId, storeKeys);
        };
        const invalidateLocal = (mode: 'key' | 'pattern', storeId: string, target: string) => {
            const keys = mode === 'key'
                ? [target]
                : [...(registeredKeyRefs.get(storeId)?.keys() ?? [])].filter((key) => new RegExp(`^${target.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`).replaceAll(String.raw`\*`, '.*')}$`).test(key)); // NOSONAR S3358
            return Effect.forEach(keys, (key) => reactivity.invalidate([`${storeId}:${key}`]), { discard: true }).pipe(Effect.as(keys.length));
        };
        const _InvSchema = S.parseJson(S.Struct({ mode: S.Literal('key', 'pattern'), storeId: S.String, target: S.String }));
        const publishInvalidation = (payload: typeof _InvSchema.Type) => S.encode(_InvSchema)(payload).pipe(
            Effect.flatMap((json) => _runRedis('publish', () => redis.publish(invalidationChannel, json))), Effect.timeout(Duration.seconds(2)), Effect.ignore,
        );
        yield* _runRedis('subscribe', () => subscriber.subscribe(invalidationChannel)).pipe(Effect.retry(Resilience.schedule('default')), Effect.catchAll((error) => Effect.logWarning('Redis pub/sub unavailable', { error: String(error) })));
        subscriber.on('message', (channel, raw) => channel === invalidationChannel && Effect.runFork(
            S.decode(_InvSchema)(raw).pipe(Effect.flatMap((payload) => invalidateLocal(payload.mode, payload.storeId, payload.target)), Effect.catchAll((error) => Effect.logWarning('Malformed invalidation message', { channel, error: String(error) }))),
        ));
        const kv = {
            del: (key: string) => _runRedis('del', () => redis.del(key)).pipe(Effect.ignore),
                get: <A, I = A, R = never>(key: string, schema: S.Schema<A, I, R>) => _runRedis('get', () => redis.get(key)).pipe(
                    Effect.flatMap((value) => value === null ? Effect.succeed(Option.none<A>()) : S.decode(S.parseJson(schema))(value).pipe(Effect.map(Option.some))),
                    Effect.catchAll((error) => Effect.logWarning('cache.kv.get failed', { error: String(error), key }).pipe(Effect.as(Option.none<A>()))),
                ),
            set: (key: string, value: unknown, ttl: Duration.Duration) => S.encode(S.parseJson(S.Unknown))(value).pipe(Effect.flatMap((json) => _runRedis('set', () => redis.set(key, json, 'PX', Duration.toMillis(ttl)))), Effect.ignore),
        } as const;
        const sets = {
            add: (key: string, ...members: readonly string[]) => Match.value(members.length).pipe(
                Match.when(0, () => Effect.void),
                Match.orElse(() => _runRedis('sadd', () => redis.sadd(key, ...members)).pipe(Effect.ignore)),
            ),
            members: (key: string) => _runRedis('smembers', () => redis.smembers(key)).pipe(Effect.orElseSucceed(() => [] as readonly string[])),
            remove: (key: string, ...members: readonly string[]) => Match.value(members.length).pipe(
                Match.when(0, () => Effect.void),
                Match.orElse(() => _runRedis('srem', () => redis.srem(key, ...members)).pipe(Effect.ignore)),
            ),
            touch: (key: string, ttl: Duration.Duration) =>
                _runRedis('expire', () => redis.expire(key, Math.max(1, Math.ceil(Duration.toSeconds(ttl))))).pipe(Effect.ignore),
        } as const;
            const pubsub = {
                duplicate: Effect.sync(() => redis.duplicate()),
                publish: (channel: string, payload: string) => _runRedis('publish', () => redis.publish(channel, payload)),
                subscribe: (connection: Redis, channel: string) => _runRedis('subscribe', () => connection.subscribe(channel)),
            } as const;
        yield* Effect.logInfo('CacheService initialized', { mode: config.mode });
        return {
            _invalidateLocal: invalidateLocal,
            _invalidationChannel: invalidationChannel,
            _prefix: config.redisOpts.keyPrefix,
            _publishInvalidation: publishInvalidation,
            _reactivity: reactivity,
            _redis: redis,
            _redisOpts: config.redisOpts,
            _registerCacheKey: registerCacheKey,
            _unregisterCacheKey: unregisterCacheKey,
            kv,
            pubsub,
            sets,
        };
    }),
}) {
    static readonly _rateLimits = {
        api:      { algorithm: 'token-bucket', failMode: 'open',   limit: 100, onExceeded: 'fail',  recovery: undefined,      tokens: 1, window: Duration.minutes(1)  },
        auth:     { algorithm: 'fixed-window', failMode: 'closed', limit: 5,   onExceeded: 'fail',  recovery: 'email-verify', tokens: 1, window: Duration.minutes(15) },
        health:   { algorithm: 'token-bucket', failMode: 'open',   limit: 300, onExceeded: 'fail',  recovery: undefined,      tokens: 1, window: Duration.minutes(1)  },
        mfa:      { algorithm: 'fixed-window', failMode: 'closed', limit: 5,   onExceeded: 'fail',  recovery: 'email-verify', tokens: 1, window: Duration.minutes(15) },
        mutation: { algorithm: 'token-bucket', failMode: 'open',   limit: 100, onExceeded: 'delay', recovery: undefined,      tokens: 5, window: Duration.minutes(1)  },
        realtime: { algorithm: 'token-bucket', failMode: 'open',   limit: 300, onExceeded: 'fail',  recovery: undefined,      tokens: 1, window: Duration.minutes(1)  },
    } as const;
    static readonly _presenceSchema = S.Struct({ connectedAt: S.Number, userId: S.String });
    static readonly Persistence: Layer.Layer<Persistence.ResultPersistence, never, CacheService> = Layer.unwrapScoped(CacheService.pipe(Effect.map((service) => PersistenceRedis.layerResult(service._redisOpts))),);
    static readonly cache = <K extends Persistence.ResultPersistence.KeyAny, A = never, R = never>(options: {
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
            const metricsOpt = yield* Effect.serviceOption(MetricsService);
            const labels = MetricsService.label({ storeId: options.storeId });
                const lookup = (key: K): Effect.Effect<S.WithResult.Success<K>, S.WithResult.Failure<K>, R> =>
                    'map' in options
                        ? Option.match(metricsOpt, {
                            onNone: () => options.lookup(key).pipe(
                                Effect.tap(Option.match({ onNone: constant(Effect.void), onSome: options.onSome ?? Effect.succeed })),
                                Effect.map(Option.match({ onNone: constant(Option.none()), onSome: flow(options.map, Option.some) }) as unknown as (opt: Option.Option<A>) => S.WithResult.Success<K>),
                            ),
                            onSome: (metrics) => options.lookup(key).pipe(
                                Effect.tap(Option.match({ onNone: constant(Effect.void), onSome: options.onSome ?? Effect.succeed })),
                                Effect.tap(Option.match({
                                    onNone: constant(MetricsService.inc(metrics.cache.misses, labels)),
                                    onSome: constant(MetricsService.inc(metrics.cache.hits, labels)),
                                })),
                                Effect.map(Option.match({ onNone: constant(Option.none()), onSome: flow(options.map, Option.some) }) as unknown as (opt: Option.Option<A>) => S.WithResult.Success<K>),
                                Metric.trackDuration(Metric.taggedWithLabels(metrics.cache.lookupDuration, labels)),
                                Effect.tapError(constant(MetricsService.inc(metrics.cache.misses, labels))),
                            ),
                        })
                        : Option.match(metricsOpt, {
                            onNone: () => options.lookup(key),
                            onSome: (metrics) => options.lookup(key).pipe(
                                Metric.trackDuration(Metric.taggedWithLabels(metrics.cache.lookupDuration, labels)),
                                Effect.tapBoth({
                                    onFailure: constant(MetricsService.inc(metrics.cache.misses, labels)),
                                    onSuccess: constant(MetricsService.inc(metrics.cache.hits, labels)),
                                }),
                            ),
                        });
                const memTtl = Duration.decode(options.inMemoryTTL ?? Duration.seconds(30));
                const persistedTtl = Duration.decode(options.timeToLive ?? Duration.minutes(5));
                const registrationTtlMs = Math.max(Duration.toMillis(memTtl), Duration.toMillis(persistedTtl));
                const cache = yield* PersistedCache.make({ inMemoryCapacity: options.inMemoryCapacity ?? 1000, inMemoryTTL: memTtl, lookup, storeId: options.storeId, timeToLive: () => persistedTtl });
                const registered = new Map<string, { expiresAt: number; primary: string; unregister: () => unknown }>();
                const pruneOnce = Clock.currentTimeMillis.pipe(Effect.flatMap((now) => Effect.forEach(
                    [...registered.entries()].filter(([, entry]) => entry.expiresAt <= now),
                    ([id, entry]) => Effect.sync(entry.unregister).pipe(
                        Effect.andThen(Effect.sync(service._unregisterCacheKey.bind(null, options.storeId, entry.primary))),
                        Effect.andThen(Effect.sync(registered.delete.bind(registered, id))),
                        Effect.asVoid,
                    ),
                    { discard: true },
                ).pipe(Effect.as(now))));
                yield* Effect.forkScoped(pruneOnce.pipe(Effect.repeat(Schedule.spaced(memTtl))));
                const ensureRegistered = (key: K, primary: string) => {
                    const id = `${options.storeId}:${primary}`;
                    return pruneOnce.pipe(Effect.flatMap((now) => {
                        registered.get(id) ?? service._registerCacheKey(options.storeId, primary);
                        const entry = registered.get(id) ?? { expiresAt: now, primary, unregister: service._reactivity.unsafeRegister([id], Effect.runFork.bind(null, cache.invalidate(key).pipe(Effect.ignore))) };
                        registered.set(id, { ...entry, expiresAt: now + registrationTtlMs });
                        return Effect.void;
                    }));
                };
                yield* Effect.addFinalizer(() => Effect.forEach([...registered.values()], (entry) => Effect.sync(entry.unregister).pipe(
                    Effect.andThen(Effect.sync(service._unregisterCacheKey.bind(null, options.storeId, entry.primary))),
                    Effect.asVoid,
                ), { discard: true }).pipe(Effect.andThen(Effect.sync(registered.clear.bind(registered)))));
            return {
                get: (key) => { const primary = PrimaryKey.value(key); return ensureRegistered(key, primary).pipe(Effect.andThen(cache.get(key))); },
                invalidate: (key) => { const primary = PrimaryKey.value(key); return ensureRegistered(key, primary).pipe(Effect.andThen(CacheService.invalidate(options.storeId, primary)), Effect.provideService(CacheService, service), Effect.asVoid); },
            } as const satisfies PersistedCache.PersistedCache<K>;
        });
    static readonly presence = {
        getAll: (tenantId: string) => CacheService.pipe(
            Effect.flatMap(({ _redis }) => _runRedis('hgetall', () => _redis.hgetall(`presence:${tenantId}`))),
            Effect.flatMap((data) => Effect.forEach(Object.entries(data), ([socketId, json]) => S.decode(S.parseJson(CacheService._presenceSchema))(json).pipe(Effect.map((payload) => ({ socketId, ...payload })), Effect.option), { concurrency: 'unbounded' })),
            Effect.map((items) => items.flatMap(Option.toArray)), Effect.orElseSucceed(() => []),
        ),
        refresh: (tenantId: string) => CacheService.pipe(Effect.flatMap(({ _redis }) => _runRedis('expire', () => _redis.expire(`presence:${tenantId}`, 120)))).pipe(Effect.ignore),
        remove: (tenantId: string, socketId: string) => CacheService.pipe(Effect.flatMap(({ _redis }) => _runRedis('hdel', () => _redis.hdel(`presence:${tenantId}`, socketId)))).pipe(Effect.ignore),
        set: (tenantId: string, socketId: string, data: { userId: string; connectedAt: number }) => S.encode(S.parseJson(CacheService._presenceSchema))(data).pipe(
            Effect.flatMap((json) => CacheService.pipe(Effect.flatMap(({ _redis }) => _runRedis('multi:hset+expire', () => _redis.multi().hset(`presence:${tenantId}`, socketId, json).expire(`presence:${tenantId}`, 120).exec())))), Effect.ignore,
        ),
    } as const;
    static readonly kv = {
        del: (key: string) => CacheService.pipe(Effect.flatMap((service) => service.kv.del(key))),
        get: <A, I = A, R = never>(key: string, schema: S.Schema<A, I, R>) => CacheService.pipe(Effect.flatMap((service) => service.kv.get(key, schema))),
        set: (key: string, value: unknown, ttl: Duration.Duration) => CacheService.pipe(Effect.flatMap((service) => service.kv.set(key, value, ttl))),
    } as const;
    static readonly sets = {
        add: (key: string, ...members: readonly string[]) => CacheService.pipe(Effect.flatMap((service) => service.sets.add(key, ...members))),
        members: (key: string) => CacheService.pipe(Effect.flatMap((service) => service.sets.members(key))),
        remove: (key: string, ...members: readonly string[]) => CacheService.pipe(Effect.flatMap((service) => service.sets.remove(key, ...members))),
        touch: (key: string, ttl: Duration.Duration) => CacheService.pipe(Effect.flatMap((service) => service.sets.touch(key, ttl))),
    } as const;
    static readonly _invalidateImpl = (mode: 'key' | 'pattern', storeId: string, target: string) =>
        CacheService.pipe(Effect.flatMap((service) => Effect.all([
            service._invalidateLocal(mode, storeId, target),
            service._publishInvalidation({ mode, storeId, target }),
            Effect.serviceOption(MetricsService).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (metrics) => MetricsService.inc(metrics.cache.evictions, MetricsService.label({ storeId })) }))),
        ], { concurrency: 'unbounded' }).pipe(Effect.map(([count]) => count))));
    static readonly invalidate = (storeId: string, key: string) => CacheService._invalidateImpl('key', storeId, key);
    static readonly invalidatePattern = (storeId: string, pattern: string) => CacheService._invalidateImpl('pattern', storeId, pattern);
    static readonly rateLimit = <A, E, R>(preset: CacheService.RateLimitPreset, handler: Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
            const [limiter, requestContext, request, metrics] = yield* Effect.all([RateLimiter, Context.Request.current, HttpServerRequest.HttpServerRequest, MetricsService]);
            const config = CacheService._rateLimits[preset], labels = MetricsService.label({ preset });
            const ipAddress = requestContext.ipAddress.pipe(Option.orElse(() => request.remoteAddress), Option.getOrElse(() => 'unknown'));
            const tenantId = requestContext.tenantId, userId = Option.match(requestContext.session, { onNone: () => 'anonymous', onSome: (session) => session.userId });
            const recoveryFields = config.recovery ? { recoveryAction: config.recovery } : {};
            const failWithLimit = (retryAfterMs: number, limit: number, remaining: number, preEffects: Effect.Effect<void, never, never>[]) => Effect.all(preEffects, { discard: true }).pipe(Effect.andThen(Effect.fail(HttpError.RateLimit.of(retryAfterMs, { limit, remaining, resetAfterMs: retryAfterMs, ...recoveryFields }))));
            const result = yield* limiter.consume({ algorithm: config.algorithm, key: `${preset}:${tenantId}:${userId}:${ipAddress}`, limit: config.limit, onExceeded: config.onExceeded, tokens: config.tokens, window: config.window }).pipe(
                Metric.trackDuration(Metric.taggedWithLabels(metrics.rateLimit.checkDuration, labels)),
                Effect.catchAll((error) => error instanceof RateLimitExceeded
                    ? failWithLimit(Duration.toMillis(error.retryAfter), error.limit, error.remaining, [
                        Context.Request.update({ rateLimit: Option.some({ delay: Duration.zero, limit: error.limit, remaining: error.remaining, resetAfter: error.retryAfter }) }),
                        MetricsService.inc(metrics.rateLimit.rejections, labels),
                        Effect.logWarning('Rate limit exceeded', { limit: error.limit, preset, remaining: error.remaining, resetAfterMs: Duration.toMillis(error.retryAfter), tenantId }),
                    ])
                    : ({
                        closed: failWithLimit(Duration.toMillis(config.window), config.limit, 0, [
                            Effect.logWarning('Rate limit store unavailable (fail-closed)', { error: String(error), preset }),
                            MetricsService.inc(metrics.rateLimit.storeFailures, labels),
                            Context.Request.update({ rateLimit: Option.some({ delay: Duration.zero, limit: config.limit, remaining: 0, resetAfter: config.window }) }),
                        ]),
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
    static readonly headers = HttpMiddleware.make((app) => Effect.gen(function* () {
        const response = yield* app;
        const requestContext = yield* Context.Request.current;
        return Option.match(requestContext.rateLimit, {
            onNone: () => response,
                onSome: (rateLimit) => {
                    const resetSec = String(Math.ceil(Duration.toMillis(rateLimit.resetAfter) / 1000));
                    return HttpServerResponse.setHeaders(response, {
                        [Context.Request.Headers.rateLimit.retryAfter]: resetSec,
                        [Context.Request.Headers.rateLimit.limit]: String(rateLimit.limit),
                        [Context.Request.Headers.rateLimit.remaining]: String(Math.max(0, Math.min(rateLimit.limit, rateLimit.remaining))),
                        [Context.Request.Headers.rateLimit.reset]: resetSec,
                    });
                },
            });
        }));
    static readonly health = () =>
        CacheService.pipe(Effect.flatMap(({ _redis }) => _runRedis('ping', () => _redis.ping()))).pipe(
            Effect.timed,
            Effect.map(([duration, result]) => ({ connected: result === 'PONG', latencyMs: Math.round(Duration.toMillis(duration)) })),
            Effect.orElseSucceed(() => ({ connected: false, latencyMs: 0 })),
        );
    static readonly setNX = (key: string, value: string, ttl: Duration.Duration) =>
        CacheService.pipe(
            Effect.flatMap((service) => _runRedis('setNX', () => service._redis.set(key, value, 'PX', Duration.toMillis(ttl), 'NX'))),
            Effect.map((result) => ({ alreadyExists: result === null, key })),
            // [CRITICAL] Fail-closed: treat Redis failure as "already exists" to prevent TOTP replay attacks
            Effect.catchAll((error) => Effect.logWarning('Redis SET NX failed (fail-closed)', { error: String(error) }).pipe(Effect.as({ alreadyExists: true, key }))),
        );
    static readonly Layer = CacheService.Default.pipe(Layer.provideMerge(rateLimiterLayer), Layer.provideMerge(Layer.unwrapEffect(
        Config.all({ prefix: Config.string('RATE_LIMIT_PREFIX').pipe(Config.withDefault('rl:')), redisOpts: _redisConfig, store: Config.literal('redis', 'memory')('RATE_LIMIT_STORE').pipe(Config.withDefault('redis' as const)) }).pipe(
            Effect.map(({ prefix, redisOpts, store }) => Match.value(store).pipe(
                Match.when('redis', () => layerStoreRedis({ ...redisOpts.redisOpts, prefix })),
                Match.when('memory', () => layerStoreMemory),
                Match.exhaustive,
            )),
        ),
    )), Layer.provideMerge(CacheService.Persistence));
}

// --- [NAMESPACE] -------------------------------------------------------------

declare namespace CacheService {
    type RateLimitPreset = keyof typeof CacheService._rateLimits;
}

// --- [EXPORT] ----------------------------------------------------------------

export { CacheService };
