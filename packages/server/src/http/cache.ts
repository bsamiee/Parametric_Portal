/**
 * Tenant-isolated cache with request deduplication and automatic metrics.
 * Wraps Effect.Cache with resilience via Resilience.wrap.
 *
 * Usage: Cache.make({ name, lookup, capacity?, ttl?, timeout?, retry?, circuit?, fallback? })
 */
import { Array as A, Cache as EffectCache, Duration, Effect, Either, Exit, Match, Metric, Option } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _defaults = { capacity: 1000, ttl: Duration.minutes(5) } as const;

// --- [SERVICES] --------------------------------------------------------------

const make = <K, V, E, R>(config: {
	readonly name: string;
	readonly lookup: (key: K) => Effect.Effect<V, E, R>;
	readonly capacity?: number;
	readonly circuit?: Resilience.Config<V, E, R>['circuit'];
	readonly fallback?: (key: K, error: Resilience.Error<E>) => Effect.Effect<V, never, R>;
	readonly retry?: Resilience.RetryMode;
	readonly timeout?: Duration.Duration;
	readonly ttl?: Duration.Duration | ((exit: Exit.Exit<V, E>) => Duration.Duration);
}) =>
	Effect.gen(function* () {
		type CK = { readonly tenantId: string; readonly key: K };
		const capacity = config.capacity ?? _defaults.capacity;
		// Lookup wraps user's function with resilience + metrics
		const lookup = (ck: CK): Effect.Effect<V, Resilience.Error<E>, R> => {
			const labels = MetricsService.label({ name: config.name, tenant: ck.tenantId });
			const resilient = Resilience.wrap(config.lookup(ck.key), {
				circuit: config.circuit,
				operation: `${config.name}:lookup`,
				retry: config.retry,
				timeout: config.timeout,
			});
			// Metrics: miss counter + duration (lookup only called on cache miss)
			const withMetrics = Effect.flatMap(Effect.serviceOption(MetricsService), (opt) =>
				Option.match(opt, {
					onNone: () => resilient,
					onSome: (m) =>
						resilient.pipe(
							Effect.tap(() => MetricsService.inc(m.cache.misses, labels)),
							Metric.trackDuration(Metric.taggedWithLabels(m.cache.lookupDuration, labels)),
						),
				}),
			);
			const fb = config.fallback;							// Fallback on error
			return fb === undefined ? withMetrics : withMetrics.pipe(Effect.catchAll((err) => fb(ck.key, err)));
		};
		const internal = yield* Match.value(config.ttl).pipe(	// Create internal Effect.Cache with tenant-scoped composite key
			Match.when(Match.undefined, () => EffectCache.make<CK, V, Resilience.Error<E>, R>({ capacity, lookup, timeToLive: _defaults.ttl }),),
			Match.when(Duration.isDuration, (ttl) => EffectCache.make<CK, V, Resilience.Error<E>, R>({ capacity, lookup, timeToLive: ttl }),),
			Match.orElse((ttlFn) =>
				EffectCache.makeWith<CK, V, Resilience.Error<E>, R>({
					capacity,
					lookup,
					timeToLive: (exit) => ttlFn(Exit.mapError(exit, (e) => e as E)),
				}),
			),
		);
		// Composite key builder: tenantId + user key
		const ck = (key: K) => Effect.andThen(Context.Request.tenantId, (tenantId): CK => ({ key, tenantId }));
		return {
			cacheStats: internal.cacheStats,
			contains: (key: K) => Effect.flatMap(ck(key), (c) => internal.contains(c)),
			entryStats: (key: K) => Effect.flatMap(ck(key), (c) => internal.entryStats(c)),
			// Effect.Cache.getEither returns Left on cache HIT, Right on cache MISS (lookup invoked). We increment hit counter only on Left (actual cache hit)
			get: (key: K): Effect.Effect<V, Resilience.Error<E>, R> =>
				Effect.gen(function* () {
					const c = yield* ck(key);
					const either = yield* internal.getEither(c);
					const metricsOpt = yield* Effect.serviceOption(MetricsService);
					// Emit hit metric only on actual cache hit (Either.isLeft)
					if (Option.isSome(metricsOpt) && Either.isLeft(either)) {
						yield* MetricsService.inc(metricsOpt.value.cache.hits, MetricsService.label({ name: config.name, tenant: c.tenantId }));
					}
					return Either.merge(either);
				}),
			getEither: (key: K) => Effect.flatMap(ck(key), (c) => internal.getEither(c)),
			getOption: (key: K) => Effect.flatMap(ck(key), (c) => internal.getOption(c)),
			invalidate: (key: K) => Effect.flatMap(ck(key), (c) => internal.invalidate(c)),
			invalidateAll: Effect.gen(function* () {
				yield* internal.invalidateAll;
				const metricsOpt = yield* Effect.serviceOption(MetricsService);
				if (Option.isSome(metricsOpt)) {
					const tenantId = yield* Context.Request.tenantId;
					yield* MetricsService.inc(metricsOpt.value.cache.evictions, MetricsService.label({ name: config.name, tenant: tenantId }));
				}
			}),
			invalidateWhen: (key: K, predicate: (value: V) => boolean) =>
				Effect.flatMap(ck(key), (c) => internal.invalidateWhen(c, predicate)),
			keys: internal.keys.pipe(Effect.map(A.map((c) => c.key))),
			refresh: (key: K) => Effect.flatMap(ck(key), (c) => internal.refresh(c)),
			set: (key: K, value: V) => Effect.flatMap(ck(key), (c) => internal.set(c, value)),
			size: internal.size,
		};
	});

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Cache = { defaults: _defaults, make } as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Cache {
	export type Config<K, V, E, R> = Parameters<typeof make<K, V, E, R>>[0];
	export type Instance<K, V, E, R> = Effect.Effect.Success<ReturnType<typeof make<K, V, E, R>>>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Cache };
