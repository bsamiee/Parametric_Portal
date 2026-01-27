/** Tenant-isolated cache with request deduplication and automatic metrics via MetricsService. */
import { Cache as EffectCache, Duration, Effect, Match, Metric, Option } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _defaults = { capacity: 1000, ttl: Duration.minutes(5) } as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _emitMetric = (type: 'hit' | 'miss' | 'eviction', name: string, tenant: string) =>
	Effect.serviceOption(MetricsService).pipe(
		Effect.flatMap(Option.match({
			onNone: () => Effect.void,
			onSome: (m) => MetricsService.inc(
				Match.value(type).pipe(
					Match.when('hit', () => m.cache.hits),
					Match.when('miss', () => m.cache.misses),
					Match.orElse(() => m.cache.evictions),
				),
				MetricsService.label({ name, tenant }),
			),
		})),
	);
const _trackDuration = <A, E, R>(effect: Effect.Effect<A, E, R>, name: string, tenant: string): Effect.Effect<A, E, R> =>
	Effect.flatMap(
		Effect.serviceOption(MetricsService),
		Option.match({
			onNone: () => effect,
			onSome: (m) => effect.pipe(Metric.trackDuration(Metric.taggedWithLabels(m.cache.lookupDuration, MetricsService.label({ name, tenant })))),
		}),
	);

// --- [SERVICES] --------------------------------------------------------------

const make = <K, V, E, R>(config: {
	readonly name: string;
	readonly lookup: (key: K) => Effect.Effect<V, E, R>;
	readonly capacity?: number;
	readonly ttl?: Duration.Duration;}) =>
	Effect.gen(function* () {
		const capacity = config.capacity ?? _defaults.capacity;
		const ttl = config.ttl ?? _defaults.ttl;
		type CompositeKey = { readonly tenantId: string; readonly key: K };
		const internal = yield* EffectCache.make<CompositeKey, V, E, R>({
			capacity,
			lookup: (ck) => Effect.gen(function* () {
				yield* _emitMetric('miss', config.name, ck.tenantId);
				return yield* _trackDuration(config.lookup(ck.key), config.name, ck.tenantId);
			}),
			timeToLive: ttl,
		});
		const _compositeKey = (key: K) => Context.Request.tenantId.pipe(Effect.map((tenantId): CompositeKey => ({ key, tenantId })));
		const get = (key: K): Effect.Effect<V, E, R> =>
			Effect.gen(function* () {
				const ck = yield* _compositeKey(key);
				const cached = yield* internal.contains(ck);
				yield* cached ? _emitMetric('hit', config.name, ck.tenantId) : Effect.void;
				return yield* internal.get(ck);
			});
		const refresh = (key: K): Effect.Effect<void, E, R> => Effect.flatMap(_compositeKey(key), (ck) => internal.refresh(ck));
		const invalidate = (key: K): Effect.Effect<void, never, R> => Effect.flatMap(_compositeKey(key), (ck) => internal.invalidate(ck));
		const invalidateAll: Effect.Effect<void, never, R> =
			Effect.gen(function* () {
				const tenantId = yield* Context.Request.tenantId;
				yield* internal.invalidateAll;
				yield* _emitMetric('eviction', config.name, tenantId);
			});
		const contains = (key: K): Effect.Effect<boolean, never, R> => Effect.flatMap(_compositeKey(key), (ck) => internal.contains(ck));
		const stats = internal.cacheStats.pipe(Effect.map((s) => ({ hits: s.hits, misses: s.misses, size: s.size })));
		return { contains, get, invalidate, invalidateAll, refresh, stats };
	});

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Cache = { defaults: _defaults, make } as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Cache {
	export type Config<K, V, E, R> = Parameters<typeof make<K, V, E, R>>[0];
	export type Instance<K, V, E, R> = Effect.Effect.Success<ReturnType<typeof make<K, V, E, R>>>;
	export type Stats = { readonly hits: number; readonly misses: number; readonly size: number };
}

// --- [EXPORT] ----------------------------------------------------------------

export { Cache };
