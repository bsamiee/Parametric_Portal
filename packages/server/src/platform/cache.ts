/**
 * Unified cache service with L1 (memory) / L2 (Redis) tiering.
 * Auto-scopes keys by tenant + user from FiberRef context.
 * Integrates rate limiting and cross-instance invalidation via Redis pub/sub.
 */
import {
	layer as rateLimiterLayer,
	layerStoreMemory,
	RateLimiter,
	type RateLimiterError,
} from '@effect/experimental/RateLimiter';
import { layerStoreConfig as layerStoreRedis } from '@effect/experimental/RateLimiter/Redis';
import { HttpServerRequest } from '@effect/platform';
import {
	Cache as EffectCache,
	Config,
	Data,
	Duration,
	Effect,
	Layer,
	Match,
	Option,
	Redacted,
} from 'effect';
import Redis from 'ioredis';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
	defaults: {
		capacity: 1000,
		inMemoryTTL: Duration.seconds(10),
		ttl: Duration.minutes(5),
	},
	pubsub: { channel: 'cache:invalidate' },
	redis: {
		connectTimeout: 5000,
		enableReadyCheck: true,
		host: 'localhost',
		lazyConnect: false,
		maxRetriesPerRequest: 3,
		port: 6379,
		prefix: 'cache:',
	},
} as const;

const _rateLimitPresets = {
	api: {
		algorithm: 'token-bucket' as const,
		limit: 100,
		onExceeded: 'fail' as const,
		tokens: 1,
		window: Duration.minutes(1),
	},
	auth: {
		algorithm: 'fixed-window' as const,
		limit: 5,
		onExceeded: 'fail' as const,
		recoveryAction: 'email-verify' as const,
		tokens: 1,
		window: Duration.minutes(15),
	},
	mfa: {
		algorithm: 'fixed-window' as const,
		limit: 5,
		onExceeded: 'fail' as const,
		recoveryAction: 'email-verify' as const,
		tokens: 1,
		window: Duration.minutes(15),
	},
	mutation: {
		algorithm: 'token-bucket' as const,
		limit: 100,
		onExceeded: 'delay' as const,
		tokens: 5,
		window: Duration.minutes(1),
	},
} as const;

const _redisConfig = Config.all({
	connectTimeout: Config.integer('REDIS_CONNECT_TIMEOUT').pipe(
		Config.withDefault(_config.redis.connectTimeout),
	),
	enableReadyCheck: Config.boolean('REDIS_READY_CHECK').pipe(
		Config.withDefault(_config.redis.enableReadyCheck),
	),
	host: Config.string('REDIS_HOST').pipe(Config.withDefault(_config.redis.host)),
	lazyConnect: Config.boolean('REDIS_LAZY_CONNECT').pipe(
		Config.withDefault(_config.redis.lazyConnect),
	),
	maxRetriesPerRequest: Config.integer('REDIS_MAX_RETRIES').pipe(
		Config.withDefault(_config.redis.maxRetriesPerRequest),
	),
	password: Config.redacted('REDIS_PASSWORD').pipe(
		Config.option,
		Config.map((opt) => opt.pipe(Option.map(Redacted.value), Option.getOrUndefined)),
	),
	port: Config.integer('REDIS_PORT').pipe(Config.withDefault(_config.redis.port)),
	prefix: Config.string('CACHE_PREFIX').pipe(Config.withDefault(_config.redis.prefix)),
});

// --- [ERRORS] ----------------------------------------------------------------

class CacheError extends Data.TaggedError('CacheError')<{
	readonly cause: unknown;
	readonly operation: string;
}> {
	override get message() {
		return `CacheError: ${this.operation} - ${String(this.cause)}`;
	}
}

// --- [SERVICES] --------------------------------------------------------------

type CacheKey = { readonly domain: string; readonly key: string; readonly tenantId: string };
type CacheState = {
	readonly _caches: Map<string, EffectCache.Cache<CacheKey, unknown, Resilience.Error<unknown>>>;
	readonly _prefix: string;
	readonly _pub: Redis;
	readonly _sub: Redis;
};

class CacheService extends Effect.Service<CacheService>()('server/CacheService', {
	scoped: Effect.gen(function* () {
		const cfg = yield* _redisConfig;
		const redisOpts = {
			connectTimeout: cfg.connectTimeout,
			enableReadyCheck: cfg.enableReadyCheck,
			host: cfg.host,
			lazyConnect: cfg.lazyConnect,
			maxRetriesPerRequest: cfg.maxRetriesPerRequest,
			password: cfg.password,
			port: cfg.port,
		};

		// Pub client for commands + publishing
		const pub = new Redis(redisOpts);
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				pub.disconnect();
			}),
		);

		// Sub client for subscriptions (must be separate)
		const sub = new Redis(redisOpts);
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				sub.unsubscribe();
				sub.disconnect();
			}),
		);

		// Subscribe to invalidation channel
		yield* Effect.tryPromise({
			catch: (e) => new CacheError({ cause: e, operation: 'subscribe' }),
			try: () => sub.subscribe(_config.pubsub.channel),
		}).pipe(
			Effect.catchAll((err) =>
				Effect.logWarning('Redis pub/sub unavailable, continuing with memory-only', {
					error: String(err),
				}),
			),
		);

		const caches = new Map<
			string,
			EffectCache.Cache<CacheKey, unknown, Resilience.Error<unknown>>
		>();

		// Handle invalidation messages - dispatched via external callback
		sub.on('message', (channel, message) =>
			Match.value(channel).pipe(
				Match.when(_config.pubsub.channel, () => {
					const parsed = JSON.parse(message) as {
						domain: string;
						key: string;
						tenantId: string;
					};
					const cache = caches.get(parsed.domain);
					return cache
						? Effect.runFork(
								cache.invalidate({
									domain: parsed.domain,
									key: parsed.key,
									tenantId: parsed.tenantId,
								}),
							)
						: undefined;
				}),
				Match.orElse(() => undefined),
			),
		);

		yield* Effect.logInfo('CacheService initialized', { host: cfg.host, port: cfg.port });

		return {
			_caches: caches,
			_prefix: cfg.prefix,
			_pub: pub,
			_sub: sub,
		} satisfies CacheState;
	}),
}) {
	// --- [GET] ---------------------------------------------------------------
	static readonly get = <V, E, R>(
		domain: string,
		lookup: (key: string) => Effect.Effect<V, E, R>,
	) => {
		return (
			key: string,
		): Effect.Effect<Option.Option<V>, Resilience.Error<E>, R | CacheService> =>
			Effect.gen(function* () {
				const state = yield* CacheService;
				const tenantId = yield* Context.Request.tenantId;
				const sessionOpt = yield* Context.Request.current.pipe(
					Effect.map((ctx) => ctx.session),
				);
				const userId = Option.map(sessionOpt, (s) => s.userId).pipe(
					Option.getOrElse(() => ''),
				);
				const scopedKey = userId
					? `${state._prefix}${tenantId}:${userId}:${domain}:${key}`
					: `${state._prefix}${tenantId}:${domain}:${key}`;
				const ck: CacheKey = { domain, key: scopedKey, tenantId };

				// Get or create L1 cache for this domain
				const existingCache = state._caches.get(domain) as
					| EffectCache.Cache<CacheKey, V, Resilience.Error<E>>
					| undefined;
				const cache =
					existingCache ??
					(yield* EffectCache.make<CacheKey, V, Resilience.Error<E>, R>({
						capacity: _config.defaults.capacity,
						lookup: (cacheKey) =>
							Resilience.wrap(lookup(cacheKey.key.split(':').pop() ?? cacheKey.key), {
								operation: `${domain}:lookup`,
								retry: 'fast',
								timeout: Duration.seconds(5),
							}),
						timeToLive: _config.defaults.ttl,
					}));

				// Register cache if new
				yield* existingCache
					? Effect.void
					: Effect.sync(() =>
							state._caches.set(
								domain,
								cache as EffectCache.Cache<CacheKey, unknown, Resilience.Error<unknown>>,
							),
						);

				const emitHitMetric = (layer?: string) =>
					Effect.flatMap(Effect.serviceOption(MetricsService), (opt) =>
						Option.match(opt, {
							onNone: () => Effect.void,
							onSome: (m) =>
								MetricsService.inc(
									m.cache.hits,
									MetricsService.label({ domain, layer, tenant: tenantId }),
								),
						}),
					);

				const emitMissMetric = () =>
					Effect.flatMap(Effect.serviceOption(MetricsService), (opt) =>
						Option.match(opt, {
							onNone: () => Effect.void,
							onSome: (m) =>
								MetricsService.inc(
									m.cache.misses,
									MetricsService.label({ domain, tenant: tenantId }),
								),
						}),
					);

				const writeBehindL2 = (value: V) =>
					Effect.tryPromise({
						catch: (e) => new CacheError({ cause: e, operation: 'redis-set' }),
						try: () =>
							state._pub.setex(
								scopedKey,
								Math.floor(Duration.toMillis(_config.defaults.ttl) / 1000),
								JSON.stringify(value),
							),
					}).pipe(
						Effect.catchAll((err) =>
							Effect.logWarning('Redis write-behind failed', { error: String(err) }),
						),
						Effect.fork,
					);

				// Try L1 first
				const l1Result = yield* cache.getOption(ck);

				// L1 hit: emit metric and return
				return yield* Option.match(l1Result, {
					onNone: () =>
						// L1 miss - try L2
						Effect.tryPromise({
							catch: () => Option.none<V>(),
							try: () =>
								state._pub.get(scopedKey).then((raw) =>
									raw ? Option.some(JSON.parse(raw) as V) : Option.none<V>(),
								),
						}).pipe(
							Effect.catchAll(() => Effect.succeed(Option.none<V>())),
							Effect.flatMap((l2Result) =>
								Option.match(l2Result, {
									onNone: () =>
										// Full miss - run lookup via L1 cache
										emitMissMetric().pipe(
											Effect.andThen(
												cache.get(ck).pipe(
													Effect.map(Option.some),
													Effect.catchAll(() => Effect.succeed(Option.none<V>())),
												),
											),
											Effect.tap((result) =>
												Option.match(result, {
													onNone: () => Effect.void,
													onSome: writeBehindL2,
												}),
											),
										),
									onSome: (value) =>
										// L2 hit - populate L1 and emit metric
										Effect.all([cache.set(ck, value), emitHitMetric('l2')], {
											discard: true,
										}).pipe(Effect.as(l2Result)),
								}),
							),
						),
					onSome: () => emitHitMetric().pipe(Effect.as(l1Result)),
				});
			});
	};

	// --- [INVALIDATE] --------------------------------------------------------
	static readonly invalidate = (domain: string, key: string) =>
		Effect.gen(function* () {
			const state = yield* CacheService;
			const tenantId = yield* Context.Request.tenantId;
			const sessionOpt = yield* Context.Request.current.pipe(Effect.map((ctx) => ctx.session));
			const userId = Option.map(sessionOpt, (s) => s.userId).pipe(Option.getOrElse(() => ''));
			const scopedKey = userId
				? `${state._prefix}${tenantId}:${userId}:${domain}:${key}`
				: `${state._prefix}${tenantId}:${domain}:${key}`;
			const ck: CacheKey = { domain, key: scopedKey, tenantId };

			// Invalidate L1 if cache exists
			const cache = state._caches.get(domain);
			yield* cache ? cache.invalidate(ck) : Effect.void;

			// Invalidate L2
			yield* Effect.tryPromise({
				catch: (e) => new CacheError({ cause: e, operation: 'redis-del' }),
				try: () => state._pub.del(scopedKey),
			}).pipe(Effect.catchAll(() => Effect.void));

			// Broadcast invalidation to other instances
			yield* Effect.tryPromise({
				catch: (e) => new CacheError({ cause: e, operation: 'redis-publish' }),
				try: () =>
					state._pub.publish(
						_config.pubsub.channel,
						JSON.stringify({ domain, key: scopedKey, tenantId }),
					),
			}).pipe(
				Effect.catchAll((err) =>
					Effect.logWarning('Redis publish failed', { error: String(err) }),
				),
			);

			// Emit eviction metric
			yield* Effect.flatMap(Effect.serviceOption(MetricsService), (opt) =>
				Option.match(opt, {
					onNone: () => Effect.void,
					onSome: (m) =>
						MetricsService.inc(
							m.cache.evictions,
							MetricsService.label({ domain, tenant: tenantId }),
						),
				}),
			);
		});

	// --- [HEALTH] ------------------------------------------------------------
	static readonly health = () =>
		Effect.gen(function* () {
			const state = yield* CacheService;
			const l2 = yield* Effect.tryPromise({
				catch: () => false,
				try: () => state._pub.ping().then((pong) => pong === 'PONG'),
			}).pipe(Effect.catchAll(() => Effect.succeed(false)));
			return { l1: true, l2 };
		});

	// --- [RATE_LIMIT] --------------------------------------------------------
	static readonly rateLimit = (preset: keyof typeof _rateLimitPresets) =>
		Effect.gen(function* () {
			const limiter = yield* RateLimiter;
			const ctx = yield* Context.Request.current;
			const request = yield* HttpServerRequest.HttpServerRequest;
			const config = _rateLimitPresets[preset];
			const ip = Option.getOrElse(ctx.ipAddress, () =>
				Option.getOrElse(request.remoteAddress, () => 'unknown'),
			);
			const key = `${preset}:${ip}`;

			const result = yield* limiter
				.consume({
					algorithm: config.algorithm,
					key,
					limit: config.limit,
					onExceeded: config.onExceeded,
					tokens: config.tokens,
					window: config.window,
				})
				.pipe(
					Effect.catchAll((err: RateLimiterError) =>
						err.reason === 'Exceeded'
							? Effect.gen(function* () {
									yield* Context.Request.update({
										rateLimit: Option.some({
											delay: Duration.zero,
											limit: err.limit,
											remaining: err.remaining,
											resetAfter: err.retryAfter,
										}),
									});
									const recovery =
										'recoveryAction' in config ? config.recoveryAction : undefined;
									return yield* Effect.fail(
										HttpError.RateLimit.of(Duration.toMillis(err.retryAfter), {
											limit: err.limit,
											remaining: err.remaining,
											resetAfterMs: Duration.toMillis(err.retryAfter),
											...(recovery ? { recoveryAction: recovery } : {}),
										}),
									);
								})
							: Effect.gen(function* () {
									// Fail-open on store errors
									yield* Effect.logWarning('Rate limit store unavailable (fail-open)', {
										error: String(err),
										preset,
									});
									yield* Effect.flatMap(Effect.serviceOption(MetricsService), (opt) =>
										Option.match(opt, {
											onNone: () => Effect.void,
											onSome: (m) =>
												MetricsService.inc(
													m.rateLimit.storeFailures,
													MetricsService.label({ preset }),
												),
										}),
									);
									return {
										delay: Duration.zero,
										limit: config.limit,
										remaining: config.limit,
										resetAfter: config.window,
									};
								}),
					),
				);

			yield* Context.Request.update({ rateLimit: Option.some(result) });

			// Emit metric for successful check
			yield* Effect.flatMap(Effect.serviceOption(MetricsService), (opt) =>
				Option.match(opt, {
					onNone: () => Effect.void,
					onSome: (m) =>
						MetricsService.inc(
							m.rateLimit.rejections,
							MetricsService.label({ outcome: 'allowed', preset }),
						),
				}),
			);

			return result;
		}).pipe(Effect.withSpan(`cache.rateLimit.${preset}`));

	// --- [REDIS] -------------------------------------------------------------
	static readonly redis = Effect.map(CacheService, (s) => s._pub);

	// --- [LAYER] -------------------------------------------------------------
	static readonly Layer = CacheService.Default.pipe(
		Layer.provideMerge(
			rateLimiterLayer.pipe(
				Layer.provideMerge(
					Layer.unwrapEffect(
						Config.string('RATE_LIMIT_STORE').pipe(
							Config.withDefault('memory'),
							Effect.map((store) =>
								store === 'redis'
									? layerStoreRedis({
											connectTimeout: Config.integer('REDIS_CONNECT_TIMEOUT').pipe(
												Config.withDefault(5000),
											),
											enableReadyCheck: Config.boolean('REDIS_READY_CHECK').pipe(
												Config.withDefault(true),
											),
											host: Config.string('REDIS_HOST').pipe(
												Config.withDefault('localhost'),
											),
											lazyConnect: Config.boolean('REDIS_LAZY_CONNECT').pipe(
												Config.withDefault(false),
											),
											maxRetriesPerRequest: Config.integer('REDIS_MAX_RETRIES').pipe(
												Config.withDefault(3),
											),
											password: Config.redacted('REDIS_PASSWORD').pipe(
												Config.option,
												Config.map((opt) =>
													opt.pipe(Option.map(Redacted.value), Option.getOrUndefined),
												),
											),
											port: Config.integer('REDIS_PORT').pipe(Config.withDefault(6379)),
											prefix: Config.string('RATE_LIMIT_PREFIX').pipe(
												Config.withDefault('rl:'),
											),
											retryStrategy: Config.integer('REDIS_RETRY_DELAY').pipe(
												Config.withDefault(100),
												Config.map(
													(delay) => (tries: number) =>
														tries > 3 ? null : Math.min(tries * delay, 2000),
												),
											),
										})
									: layerStoreMemory,
							),
						),
					),
				),
			),
		),
	);
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace CacheService {
	export type Error = CacheError;
	export type RateLimitPreset = keyof typeof _rateLimitPresets;
}

// --- [EXPORT] ----------------------------------------------------------------

export { CacheService };
