# Refinements - Effect APIs Group 3
**APIs**: Function, HKT, KeyedPool, List, Mailbox, Match, Number, Order, Ordering, Scheduler, Sink, STM, Tuple, Hash, HashMap, HashRing, HashSet

## HIGH Priority

- [Line 147-151] Current: `Match.value(e.reason).pipe(Match.when(...), Match.orElse(...))` for isRetryable | Use: `Match.type<SingletonError>()` at class level with `discriminator('reason')` | Reason: discriminator provides exhaustive checking on literal union without manual when chains
- [Line 289-292] Current: `Match.value(envelope.payload.type).pipe(Match.when('urgent', ...), Match.when('batch', ...), Match.orElse(...))` | Use: `Match.type<Payload>().pipe(Match.tag(...tags, handler))` if payload has `_tag`, or `Match.discriminator('type')('urgent', 'batch')(handler)` | Reason: discriminator collapses multiple Match.when calls into single exhaustive pattern
- [Line 312-313] Current: `Date.now() - lastExec < Duration.toMillis(interval) * 2` manual staleness check | Use: `Number.between({ minimum: 0, maximum: Duration.toMillis(interval) * 2 })(elapsed)` | Reason: Number.between is self-documenting for range validation
- [Line 564-567] Current: `Match.value('version' in raw).pipe(Match.when(true, ...), Match.orElse(...))` | Use: `Match.type<typeof StateUnion.Type>().pipe(Match.discriminator('version')(2)(v2Handler), Match.orElse(migrateV1))` | Reason: discriminator on version field is idiomatic for schema evolution

## MEDIUM Priority

- [Line 198-221] Current: Singleton factory creates inline gauge per invocation | Use: `HashMap.make([name, gauge])` to cache gauges and prevent duplicate metric registration | Reason: HashMap provides O(1) lookup for gauge reuse across multiple singleton invocations
- [Line 316-328] Current: `pipe(config, A.map(...), Effect.all, Effect.map(...))` for health aggregation | Use: `HashSet.fromIterable(config.map(c => c.name))` for O(1) deduplication if names could repeat, then aggregate | Reason: HashSet prevents duplicate singleton health checks
- [Line 447-450] Current: `KeyValueStore.prefix(store, 'singleton:${tenantId}:')` manual prefix construction | Use: `Tuple.make(tenantId, store)` to pair tenant context with store, enabling typed extraction via `Tuple.getFirst`/`Tuple.getSecond` | Reason: Tuple provides typed pair semantics for context propagation
- [Line 796] Current: `Metric.gauge(\`singleton.${name}.last_execution\`)` inline gauge creation | Use: `Function.constant(Metric.gauge(...))` wrapped in module-level cache or `HashMap` | Reason: constant ensures referential stability; HashMap provides keyed caching
- [Lines 108-123] Current: `_CONFIG` object with nested `health.threshold` multiplier | Use: `Number.clamp({ minimum: 1, maximum: 5 })` for threshold validation | Reason: clamp ensures threshold stays within reasonable bounds

## LOW Priority

- [Line 238-241] Current: `Schedule.addDelay((count) => count > 0 ? Duration.millis(100) : Duration.zero)` | Use: `Number.sign(count)` to determine delay category before mapping | Reason: sign provides canonical -1/0/1 output for cleaner branching
- [Line 323] Current: `B.match(state.value > 0, { onTrue: ..., onFalse: ... })` | Use: `Ordering.match(Number.sign(state.value), { onLessThan: () => 'never', onEqual: () => 'never', onGreaterThan: () => new Date(state.value).toISOString() })` | Reason: Ordering.match aligns with numeric comparison semantics
- [Line 287] Current: `EntityId.make(String(yield* sharding.getSnowflake))` | Use: `Function.pipe(sharding.getSnowflake, Effect.map(String), Effect.map(EntityId.make))` with `Function.flow` for composition | Reason: flow provides point-free composition without intermediate pipe
- [Line 486-499] Current: SQL-backed KeyValueStore `modify` uses inline `[current, next] as const` | Use: `Tuple.make(current, next)` | Reason: Tuple.make is explicit constructor for typed pairs

## New Patterns to Add

- **KeyedPool for entity resources** | API: `KeyedPool.makeWithTTL` | Why: Pattern 3 uses EntityResource.make for per-entity DB connections; KeyedPool provides built-in TTL shrinking, size limits per key, and automatic invalidation across entities of same type
- **STM for atomic singleton state** | API: `STM.commit`, `TRef` | Why: Decision 5 notes KeyValueStore.modify is not atomic; STM provides transactional guarantees for critical state updates within singleton without SQL transaction overhead
- **Mailbox for singleton work queue** | API: `Mailbox.make({ capacity: 100, strategy: 'dropping' })` | Why: Singletons processing work items benefit from bounded buffering with backpressure; Mailbox.toStream enables downstream Stream processing with capacity control
- **HashRing for shard distribution** | API: `HashRing.make().pipe(HashRing.addMany(runners), HashRing.getShards(shardCount))` | Why: Line 614 mentions `sharding.getShardId` for routing; HashRing provides explicit consistent hashing if custom shard distribution needed beyond built-in cluster sharding
- **Function.dual for factory polymorphism** | API: `Function.dual(2, (name, options) => ...)` | Why: ClusterService.singleton and cron factories (lines 786-841) would benefit from data-first/data-last polymorphism enabling both `singleton(name, run)` and `pipe(run, singleton(name))`
- **Order.mapInput for entity sorting** | API: `Order.mapInput(Order.number, (entity) => entity.priority)` | Why: Entity processing order can use typed Order composition rather than inline comparators
- **Scheduler.makeBatched for singleton batching** | API: `Scheduler.makeBatched((callback) => setTimeout(callback, 0))` | Why: Singleton execution timing can use custom batched scheduler for coalescing rapid state updates
- **Hash.cached for entity identity** | API: `Hash.cached` on entity state objects | Why: Entities with frequently-compared state benefit from cached hash values for HashMap/HashSet operations
