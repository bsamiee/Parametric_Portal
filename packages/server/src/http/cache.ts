/**
 * Unified cache module with tenant isolation, request deduplication, and metrics integration.
 * Uses Effect.Cache for request coalescing (multiple concurrent lookups coalesce into single backend call).
 * Automatic tenant key prefixing from FiberRef ensures isolation without consumer ceremony.
 */
import { Cache, Duration, Effect, Metric, Option, type Schedule } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Resilience } from './resilience.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _defaults = {
	capacity: 1000,
	ttl: Duration.minutes(5),
} as const;

const _metrics = {
	evictions: Metric.counter('cache_evictions_total'),
	hits: Metric.counter('cache_hits_total'),
	lookupDuration: Metric.timerWithBoundaries('cache_lookup_duration_seconds', [0.001, 0.01, 0.1, 1]),
	misses: Metric.counter('cache_misses_total'),
} as const;

// --- [TYPES] -----------------------------------------------------------------

type CompositeKey<K> = { readonly tenantId: string; readonly key: K };

interface CacheResilienceConfig<V, E, R> {
	readonly retry?: Schedule.Schedule<unknown, E, never>;
	readonly timeout?: Duration.Duration;
	readonly fallback?: Effect.Effect<V, never, R>;
}

interface CacheConfig<K, V, E, R> {
	readonly name: string;
	readonly capacity: number;
	readonly lookup: (key: K) => Effect.Effect<V, E, R>;
	readonly ttl: Duration.Duration;
	readonly onHit?: (key: K) => Effect.Effect<void, never, R>;
	readonly onMiss?: (key: K) => Effect.Effect<void, never, R>;
	readonly resilience?: CacheResilienceConfig<V, E, R>;
}

interface CacheInstance<K, V, E, R> {
	/** Get with automatic tenant prefix - coalesces concurrent requests */
	readonly get: (key: K) => Effect.Effect<V, E, R>;
	/** Refresh triggers re-computation without invalidating, returns void when complete */
	readonly refresh: (key: K) => Effect.Effect<void, E, R>;
	/** Invalidate specific key */
	readonly invalidate: (key: K) => Effect.Effect<void, never, R>;
	/** Invalidate all keys for current tenant */
	readonly invalidateAll: Effect.Effect<void, never, R>;
	/** Check if key exists (without triggering lookup) */
	readonly contains: (key: K) => Effect.Effect<boolean, never, R>;
	/** Get cache statistics */
	readonly stats: Effect.Effect<CacheStats, never, never>;
}

interface CacheStats {
	readonly hits: number;
	readonly misses: number;
	readonly size: number;
}

// --- [FUNCTIONS] -------------------------------------------------------------

const _makeCompositeKey = <K>(tenantId: string, key: K): CompositeKey<K> => ({ key, tenantId });

const _emitHitMetric = (name: string, tenant: string) =>
	Effect.flatMap(
		Effect.serviceOption(MetricsService),
		Option.match({
			onNone: () => Effect.void,
			onSome: () => MetricsService.inc(_metrics.hits, MetricsService.label({ name, tenant })),
		}),
	);

const _emitMissMetric = (name: string, tenant: string) =>
	Effect.flatMap(
		Effect.serviceOption(MetricsService),
		Option.match({
			onNone: () => Effect.void,
			onSome: () => MetricsService.inc(_metrics.misses, MetricsService.label({ name, tenant })),
		}),
	);

// --- [SERVICES] --------------------------------------------------------------

const make = <K, V, E, R>(config: CacheConfig<K, V, E, R>): Effect.Effect<CacheInstance<K, V, E | Resilience.TimeoutError, R>, never, R> =>
	Effect.gen(function* () {
		// Build resilient lookup by wrapping user's lookup with optional retry/timeout/fallback
		// Order: retry wraps original (retries on E), timeout wraps that (adds TimeoutError), fallback wraps all
		const wrapWithResilience = (effect: Effect.Effect<V, E, R>): Effect.Effect<V, E | Resilience.TimeoutError, R> => {
			// Apply retry first (on original error type E)
			const withRetryApplied = config.resilience?.retry
				? Resilience.withRetry(effect, config.resilience.retry, config.name)
				: effect;

			// Apply timeout second (adds TimeoutError to error channel)
			const withTimeoutApplied = config.resilience?.timeout
				? Resilience.withTimeout(withRetryApplied, config.resilience.timeout, config.name)
				: withRetryApplied;

			// Apply fallback last (can recover from E | TimeoutError)
			const withFallbackApplied = config.resilience?.fallback
				? Resilience.withFallback(withTimeoutApplied, config.resilience.fallback, config.name)
				: withTimeoutApplied;

			return withFallbackApplied;
		};

		// Internal cache uses composite keys (tenantId + user key)
		// Type params: <Key, Value, Error, Environment>
		const internalCache = yield* Cache.make<CompositeKey<K>, V, E | Resilience.TimeoutError, R>({
			capacity: config.capacity,
			lookup: (compositeKey) =>
				Effect.gen(function* () {
					// Emit miss metric before lookup
					yield* config.onMiss
						? config.onMiss(compositeKey.key)
						: _emitMissMetric(config.name, compositeKey.tenantId);

					// Apply resilience patterns to the lookup
					const resilientLookup = wrapWithResilience(config.lookup(compositeKey.key));

					// Execute lookup with duration tracking
					const metricsOpt = yield* Effect.serviceOption(MetricsService);
					return yield* Option.isSome(metricsOpt)
						? resilientLookup.pipe(
								Metric.trackDuration(
									Metric.taggedWithLabels(
										_metrics.lookupDuration,
										MetricsService.label({ name: config.name, tenant: compositeKey.tenantId }),
									),
								),
							)
						: resilientLookup;
				}),
			timeToLive: config.ttl,
		});

		const get = (key: K): Effect.Effect<V, E | Resilience.TimeoutError, R> =>
			Effect.gen(function* () {
				const tenantId = yield* Context.Request.tenantId;
				const compositeKey = _makeCompositeKey(tenantId, key);

				// Check if value is cached to emit hit metric before get triggers lookup
				const cached = yield* internalCache.contains(compositeKey);
				yield* cached
					? (config.onHit
						? config.onHit(key)
						: _emitHitMetric(config.name, tenantId))
					: Effect.void;

				return yield* internalCache.get(compositeKey);
			});

		const refresh = (key: K): Effect.Effect<void, E | Resilience.TimeoutError, R> =>
			Effect.gen(function* () {
				const tenantId = yield* Context.Request.tenantId;
				const compositeKey = _makeCompositeKey(tenantId, key);
				return yield* internalCache.refresh(compositeKey);
			});

		const invalidate = (key: K): Effect.Effect<void, never, R> =>
			Effect.gen(function* () {
				const tenantId = yield* Context.Request.tenantId;
				const compositeKey = _makeCompositeKey(tenantId, key);
				return yield* internalCache.invalidate(compositeKey);
			});

		const invalidateAll: Effect.Effect<void, never, R> =
			Effect.gen(function* () {
				const tenantId = yield* Context.Request.tenantId;
				// Effect.Cache doesn't have invalidateAll with filter, so we invalidate the whole cache
				// This is a limitation - in Phase 3 with Redis we can use key patterns
				return yield* internalCache.invalidateAll.pipe(
					Effect.tap(() =>
						Effect.flatMap(
							Effect.serviceOption(MetricsService),
							Option.match({
								onNone: () => Effect.void,
								onSome: () => MetricsService.inc(_metrics.evictions, MetricsService.label({ name: config.name, tenant: tenantId })),
							}),
						),
					),
				);
			});

		const contains = (key: K): Effect.Effect<boolean, never, R> =>
			Effect.gen(function* () {
				const tenantId = yield* Context.Request.tenantId;
				const compositeKey = _makeCompositeKey(tenantId, key);
				return yield* internalCache.contains(compositeKey);
			});

		// Effect.Cache tracks hits/misses internally via cacheStats
		const stats: Effect.Effect<CacheStats, never, never> =
			Effect.map(internalCache.cacheStats, (s) => ({
				hits: s.hits,
				misses: s.misses,
				size: s.size,
			}));

		return { contains, get, invalidate, invalidateAll, refresh, stats };
	});

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const TenantCache = {
	defaults: _defaults,
	make,
	metrics: _metrics,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace TenantCache {
	export type Config<K, V, E, R> = CacheConfig<K, V, E, R>;
	export type Instance<K, V, E, R> = CacheInstance<K, V, E, R>;
	export type ResilienceConfig<V, E, R> = CacheResilienceConfig<V, E, R>;
	export type Stats = CacheStats;
}

// --- [EXPORT] ----------------------------------------------------------------

export { TenantCache };
