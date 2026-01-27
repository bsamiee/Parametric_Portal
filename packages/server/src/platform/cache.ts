/**
 * Unified cache service with L1 (memory) / L2 (Redis) tiering.
 * Auto-scopes keys by tenant + user from FiberRef context.
 * Integrates rate limiting and cross-instance invalidation via Redis pub/sub.
 */
import {layer as rateLimiterLayer, layerStoreMemory, RateLimiter, type RateLimiterError,} from '@effect/experimental/RateLimiter';
import { layerStoreConfig as layerStoreRedis } from '@effect/experimental/RateLimiter/Redis';
import { HttpServerRequest } from '@effect/platform';
import { Cache as EffectCache, Config, Data, Duration, Effect, Layer, Match, Option, pipe, Redacted, Schema as S } from 'effect';
import Redis from 'ioredis';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _Cache = (() => {
	const ttl = Duration.minutes(5);
	const redis = { connectTimeout: 5000, enableReadyCheck: true, host: 'localhost', lazyConnect: false, maxRetriesPerRequest: 3, port: 6379, prefix: 'cache:' } as const;
	return {
		defaults: 	  { capacity: 1000, inMemoryTTL: Duration.seconds(10), ttl, ttlSeconds: Math.floor(Duration.toMillis(ttl) / 1000) },
		pubsub: 	  { channel: 'cache:invalidate' },
		rateLimit: {
			api: 	  { algorithm: 'token-bucket', limit: 100, 	onExceeded: 'fail',  recoveryAction: undefined, 			  tokens: 1, window: Duration.minutes(1)  },
			auth: 	  { algorithm: 'fixed-window', limit: 5, 	onExceeded: 'fail',  recoveryAction: 'email-verify' as const, tokens: 1, window: Duration.minutes(15) },
			mfa: 	  { algorithm: 'fixed-window', limit: 5, 	onExceeded: 'fail',  recoveryAction: 'email-verify' as const, tokens: 1, window: Duration.minutes(15) },
			mutation: { algorithm: 'token-bucket', limit: 100, 	onExceeded: 'delay', recoveryAction: undefined, 			  tokens: 5, window: Duration.minutes(1)  },
		} satisfies Record<string, { algorithm: 'fixed-window' | 'token-bucket'; limit: number; onExceeded: 'delay' | 'fail'; recoveryAction: 'email-verify' | 'support-ticket' | undefined; tokens: number; window: Duration.Duration }>,
		redis,
	} as const;
})();
const _domains = new Map<string, S.Schema<unknown, unknown, never>>();
const _redisConfig = Config.all({
	connectTimeout: Config.integer('REDIS_CONNECT_TIMEOUT').pipe(Config.withDefault(_Cache.redis.connectTimeout)),
	enableReadyCheck: Config.boolean('REDIS_READY_CHECK').pipe(Config.withDefault(_Cache.redis.enableReadyCheck)),
	host: Config.string('REDIS_HOST').pipe(Config.withDefault(_Cache.redis.host)),
	lazyConnect: Config.boolean('REDIS_LAZY_CONNECT').pipe(Config.withDefault(_Cache.redis.lazyConnect)),
	maxRetriesPerRequest: Config.integer('REDIS_MAX_RETRIES').pipe(Config.withDefault(_Cache.redis.maxRetriesPerRequest)),
	password: Config.redacted('REDIS_PASSWORD').pipe(Config.option, Config.map((opt) => Option.match(opt, { onNone: () => undefined, onSome: (r) => Redacted.value(r) }))),
	port: Config.integer('REDIS_PORT').pipe(Config.withDefault(_Cache.redis.port)),
	prefix: Config.string('CACHE_PREFIX').pipe(Config.withDefault(_Cache.redis.prefix)),
});

// --- [ERRORS] ----------------------------------------------------------------

class CacheError extends Data.TaggedError('CacheError')<{
	readonly cause: unknown;
	readonly operation: string;
}> {override get message() {return `CacheError: ${this.operation} - ${String(this.cause)}`;}}

// --- [SERVICES] --------------------------------------------------------------

class CacheService extends Effect.Service<CacheService>()('server/CacheService', {
	scoped: Effect.gen(function* () {
		const cfg = yield* _redisConfig;
		const pub = new Redis({ connectTimeout: cfg.connectTimeout, enableReadyCheck: cfg.enableReadyCheck, host: cfg.host, lazyConnect: cfg.lazyConnect, maxRetriesPerRequest: cfg.maxRetriesPerRequest, password: cfg.password, port: cfg.port });
		yield* Effect.addFinalizer(() => Effect.sync(() => pub.disconnect()));
		const sub = pub.duplicate();
		yield* Effect.addFinalizer(() => Effect.sync(() => { sub.unsubscribe(); sub.disconnect(); }));
		yield* Effect.tryPromise({
			catch: (e) => new CacheError({ cause: e, operation: 'subscribe' }),
			try: () => sub.subscribe(_Cache.pubsub.channel),
		}).pipe(Effect.catchAll((err) => Effect.logWarning('Redis pub/sub unavailable', { error: String(err) })));
		const caches = new Map<string, EffectCache.Cache<{ readonly domain: string; readonly key: string; readonly tenantId: string }, unknown, Resilience.Error<unknown>>>();
		sub.on('message', (channel, message) => pipe(
			Option.liftPredicate(channel, (ch) => ch === _Cache.pubsub.channel),
			Option.map(() => JSON.parse(message) as { readonly domain: string; readonly key: string; readonly tenantId: string }),
			Option.flatMap((p) => pipe(Option.fromNullable(caches.get(p.domain)), Option.map((c) => ({ c, p })))),
			Option.match({ onNone: () => {}, onSome: ({ c, p }) => Effect.runFork(c.invalidate(p)) }),
		));
		yield* Effect.logInfo('CacheService initialized', { host: cfg.host, port: cfg.port });
		return { _caches: caches, _prefix: cfg.prefix, _pub: pub, _sub: sub };
	}),
}) {
	// --- [GET] ---------------------------------------------------------------
	static readonly get = <V, E, R>(domain: string, lookup: (key: string) => Effect.Effect<V, E, R>) =>
		(key: string): Effect.Effect<Option.Option<V>, Resilience.Error<E>, R | CacheService> =>
			Effect.flatMap(
				Effect.all({ ctx: Context.Request.current, metricsOpt: Effect.serviceOption(MetricsService), state: CacheService }),
				({ ctx, metricsOpt, state }) => {
					type CK = { readonly domain: string; readonly key: string; readonly tenantId: string };
					const userSuffix = Option.match(ctx.session, { onNone: () => '', onSome: (s) => `:${s.userId}` });
					const scopedKey = `${state._prefix}${ctx.tenantId}${userSuffix}:${domain}:${key}`;
					const ck: CK = { domain, key: scopedKey, tenantId: ctx.tenantId };
					const labels = MetricsService.label({ domain, tenant: ctx.tenantId });
					const labelsL2 = MetricsService.label({ domain, layer: 'l2', tenant: ctx.tenantId });
					const incHit = Option.match(metricsOpt, { onNone: () => Effect.void, onSome: (m) => MetricsService.inc(m.cache.hits, labels) });
					const incHitL2 = Option.match(metricsOpt, { onNone: () => Effect.void, onSome: (m) => MetricsService.inc(m.cache.hits, labelsL2) });
					const incMiss = Option.match(metricsOpt, { onNone: () => Effect.void, onSome: (m) => MetricsService.inc(m.cache.misses, labels) });
					const existing = state._caches.get(domain) as EffectCache.Cache<CK, V, Resilience.Error<E>> | undefined;
					const makeLookup = (cacheKey: CK) => Resilience.run(`cache:${domain}`, lookup(cacheKey.key.split(':').pop() ?? cacheKey.key), { retry: 'fast', timeout: Duration.seconds(5) });
					const makeCache = EffectCache.make<CK, V, Resilience.Error<E>, R>({ capacity: _Cache.defaults.capacity, lookup: makeLookup, timeToLive: _Cache.defaults.ttl });
					const cacheEffect = existing === undefined ? Effect.tap(makeCache, (c) => Effect.sync(() => state._caches.set(domain, c as EffectCache.Cache<CK, unknown, Resilience.Error<unknown>>))) : Effect.succeed(existing);
					const tryL1 = (cache: EffectCache.Cache<CK, V, Resilience.Error<E>>) => cache.getOption(ck).pipe(
						Effect.orElseSucceed(() => Option.none<V>()),
						Effect.flatMap(Option.match({ onNone: () => Effect.fail('L1Miss' as const), onSome: (v) => Effect.as(incHit, v) })),
					);
					const tryL2 = (cache: EffectCache.Cache<CK, V, Resilience.Error<E>>) => Effect.flatMap(
						Effect.tryPromise({ catch: () => 'L2Miss' as const, try: () => state._pub.get(scopedKey) }),
						(raw) => pipe(Option.fromNullable(raw), Option.match({
							onNone: () => Effect.fail('L2Miss' as const),
							onSome: (r) => { const v = JSON.parse(r) as V; return Effect.as(Effect.tap(cache.set(ck, v), () => incHitL2), v); },
						})),
					);
					const writeBehind = (v: V) => Effect.runFork(Effect.catchAll(
						Effect.tryPromise({ catch: (e) => new CacheError({ cause: e, operation: 'redis-set' }), try: () => state._pub.setex(scopedKey, _Cache.defaults.ttlSeconds, JSON.stringify(v)) }),
						(err) => Effect.logWarning('Redis write-behind failed', { error: String(err) }),
					));
					const doLookup = (cache: EffectCache.Cache<CK, V, Resilience.Error<E>>) => Effect.tap(Effect.tap(cache.get(ck), () => incMiss), (v) => Effect.sync(() => writeBehind(v)));
					return Effect.flatMap(cacheEffect, (cache) => Effect.option(Effect.firstSuccessOf([tryL1(cache), tryL2(cache), doLookup(cache)])));
				},
			);
	// --- [INVALIDATE] --------------------------------------------------------
	static readonly invalidate = (domain: string, key: string) =>
		Effect.gen(function* () {
			type CK = { readonly domain: string; readonly key: string; readonly tenantId: string };
			const state = yield* CacheService;
			const metricsOpt = yield* Effect.serviceOption(MetricsService);
			const ctx = yield* Context.Request.current;
			const userSuffix = Option.match(ctx.session, { onNone: () => '', onSome: (s) => `:${s.userId}` });
			const scopedKey = `${state._prefix}${ctx.tenantId}${userSuffix}:${domain}:${key}`;
			const ck: CK = { domain, key: scopedKey, tenantId: ctx.tenantId };
			yield* Effect.transposeMapOption(Option.fromNullable(state._caches.get(domain)), (c) => c.invalidate(ck));
			yield* Effect.tryPromise({ catch: (e) => new CacheError({ cause: e, operation: 'redis-del' }), try: () => state._pub.del(scopedKey) }).pipe(Effect.catchAll((err) => Effect.logWarning('Redis del failed', { error: String(err) })));
			yield* Effect.tryPromise({ catch: (e) => new CacheError({ cause: e, operation: 'redis-publish' }), try: () => state._pub.publish(_Cache.pubsub.channel, JSON.stringify(ck)) }).pipe(Effect.catchAll((err) => Effect.logWarning('Redis publish failed', { error: String(err) })));
			yield* Effect.transposeMapOption(metricsOpt, (m) => MetricsService.inc(m.cache.evictions, MetricsService.label({ domain, tenant: ctx.tenantId })));
		});
	// --- [HEALTH] ------------------------------------------------------------
	static readonly health = () =>
		Effect.gen(function* () {
			const state = yield* CacheService;
			const l2 = yield* Effect.tryPromise({ catch: () => false as const, try: () => state._pub.ping().then((pong) => pong === 'PONG') }).pipe(Effect.orElseSucceed(() => false as const));
			return { l1: true as const, l2 };
		});
	// --- [SCHEMA_REGISTER] ---------------------------------------------------
	static readonly register = <A, I>(domain: string, schema: S.Schema<A, I>) =>
		Effect.sync(() => { _domains.set(domain, schema as S.Schema<unknown, unknown, never>); });
	// --- [SCHEMA_GET] --------------------------------------------------------
	static readonly getSchema = <A, I = A>(domain: string) => (key: string): Effect.Effect<Option.Option<A>, never, CacheService> =>
		pipe(
			Option.fromNullable(_domains.get(domain) as S.Schema<A, I> | undefined),
			Option.match({
				onNone: () => Effect.succeed(Option.none<A>()),
				onSome: (schema) => Effect.flatMap(
					Effect.all({ ctx: Context.Request.current, state: CacheService }),
					({ ctx, state }) => {
						const userSuffix = Option.match(ctx.session, { onNone: () => '', onSome: (s) => `:${s.userId}` });
						const scopedKey = `${state._prefix}${ctx.tenantId}${userSuffix}:${domain}:${key}`;
						return pipe(
							Effect.tryPromise({ catch: () => 'L2Miss' as const, try: () => state._pub.get(scopedKey) }),
							Effect.orElseSucceed(() => null),
							Effect.flatMap((raw) => Option.match(Option.fromNullable(raw), {
								onNone: () => Effect.succeed(Option.none<A>()),
								onSome: (r) => S.decodeUnknown(S.parseJson(schema))(r).pipe(Effect.map(Option.some), Effect.catchTag('ParseError', () => Effect.succeed(Option.none<A>()))),
							})),
						);
					},
				),
			}),
		);
	// --- [SCHEMA_SET] --------------------------------------------------------
	static readonly setSchema = <A, I = A>(domain: string, ttlOverride?: Duration.Duration) => (key: string, value: A): Effect.Effect<void, CacheError, CacheService> =>
		pipe(
			Option.fromNullable(_domains.get(domain) as S.Schema<A, I> | undefined),
			Option.match({
				onNone: () => Effect.void,
				onSome: (schema) => Effect.flatMap(
					Effect.all({ ctx: Context.Request.current, state: CacheService }),
					({ ctx, state }) => {
						const userSuffix = Option.match(ctx.session, { onNone: () => '', onSome: (s) => `:${s.userId}` });
						const scopedKey = `${state._prefix}${ctx.tenantId}${userSuffix}:${domain}:${key}`;
						const ttlSeconds = ttlOverride ? Math.floor(Duration.toMillis(ttlOverride) / 1000) : _Cache.defaults.ttlSeconds;
						return pipe(
							S.encode(schema)(value),
							Effect.orDie,
							Effect.flatMap((encoded) => Effect.tryPromise({ catch: (e) => new CacheError({ cause: e, operation: 'redis-set-schema' }), try: () => state._pub.setex(scopedKey, ttlSeconds, JSON.stringify(encoded)) })),
							Effect.asVoid,
						);
					},
				),
			}),
		);
	// --- [RATE_LIMIT] --------------------------------------------------------
	static readonly rateLimit = (preset: keyof typeof _Cache.rateLimit) =>
		Effect.gen(function* () {
			const limiter = yield* RateLimiter;
			const metricsOpt = yield* Effect.serviceOption(MetricsService);
			const ctx = yield* Context.Request.current;
			const request = yield* HttpServerRequest.HttpServerRequest;
			const config = _Cache.rateLimit[preset];
			const ip = Option.getOrElse(ctx.ipAddress, () => Option.getOrElse(request.remoteAddress, () => 'unknown'));
			const result = yield* limiter.consume({ algorithm: config.algorithm, key: `${preset}:${ip}`, limit: config.limit, onExceeded: config.onExceeded, tokens: config.tokens, window: config.window }).pipe(
				Effect.catchAll((err: RateLimiterError) => Match.value(err).pipe(
					Match.when({ reason: 'Exceeded' }, (e) => Effect.zipRight(
						Context.Request.update({ rateLimit: Option.some({ delay: Duration.zero, limit: e.limit, remaining: e.remaining, resetAfter: e.retryAfter }) }),
						Effect.fail(HttpError.RateLimit.of(Duration.toMillis(e.retryAfter), { limit: e.limit, remaining: e.remaining, resetAfterMs: Duration.toMillis(e.retryAfter), ...pipe(config.recoveryAction, Option.fromNullable, Option.match({ onNone: () => ({}), onSome: (ra) => ({ recoveryAction: ra }) })) })),
					)),
					Match.orElse(() => Effect.zipRight(
						Effect.all([Effect.logWarning('Rate limit store unavailable (fail-open)', { error: String(err), preset }), Effect.transposeMapOption(metricsOpt, (m) => MetricsService.inc(m.rateLimit.storeFailures, MetricsService.label({ preset })))], { discard: true }),
						Effect.succeed({ delay: Duration.zero, limit: config.limit, remaining: config.limit, resetAfter: config.window }),
					)),
				)),
			);
			yield* Context.Request.update({ rateLimit: pipe(result, Option.some) });
			return result;
		}).pipe(Effect.withSpan(`cache.rateLimit.${preset}`));
	// --- [REDIS] -------------------------------------------------------------
	static readonly redis = CacheService.pipe(Effect.map((s) => s._pub));
	// --- [LAYER] -------------------------------------------------------------
	static readonly Layer = CacheService.Default.pipe(
		Layer.provideMerge(rateLimiterLayer),
		Layer.provideMerge(Layer.unwrapEffect(
			Config.string('RATE_LIMIT_STORE').pipe(
				Config.withDefault('memory'),
				Effect.flatMap((store) => Match.value(store).pipe(
					Match.when('redis', () => _redisConfig.pipe(Effect.map((cfg) => layerStoreRedis({
						connectTimeout: Config.succeed(cfg.connectTimeout),
						enableReadyCheck: Config.succeed(cfg.enableReadyCheck),
						host: Config.succeed(cfg.host),
						lazyConnect: Config.succeed(cfg.lazyConnect),
						maxRetriesPerRequest: Config.succeed(cfg.maxRetriesPerRequest),
						password: Config.succeed(cfg.password),
						port: Config.succeed(cfg.port),
						prefix: Config.string('RATE_LIMIT_PREFIX').pipe(Config.withDefault('rl:')),
						retryStrategy: Config.integer('REDIS_RETRY_DELAY').pipe(Config.withDefault(100), Config.map((delay) => (tries: number) => Match.value(tries > 3).pipe(Match.when(true, () => null), Match.orElse(() => Math.min(tries * delay, 2000))))),
					})))),
					Match.orElse(() => Effect.succeed(layerStoreMemory)),
				)),
			),
		)),
	);
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace CacheService {
	export type Error = CacheError;
	export type RateLimitPreset = keyof typeof _Cache.rateLimit;
}

// --- [EXPORT] ----------------------------------------------------------------

export { CacheService };
