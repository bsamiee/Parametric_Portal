# Cache Consolidation Research

**Researched:** 2026-02-02
**Domain:** @effect/experimental Persistence, PersistedCache, Reactivity
**Package Version:** @effect/experimental 0.58.0
**Confidence:** HIGH (verified via source code + official docs)

## Summary

The @effect/experimental library provides a complete caching infrastructure through three core modules: `Persistence`, `PersistedCache`, and `Reactivity`. The architecture supports a polymorphic approach where the same caching interface works with different backends (memory, Redis, KeyValueStore) through Effect's Layer system.

The existing codebase (`cache.ts`) already leverages most of these APIs correctly. The consolidation opportunity lies in unifying the three current patterns (PersistedCache, Redis hash presence, Ref<HashMap> memoization) into a single factory abstraction that handles:
1. **L1/L2 tiered caching** (in-memory + persistence)
2. **Schema validation** at boundaries
3. **Cross-instance invalidation** via Reactivity + pub/sub bridge

**Primary recommendation:** Create a unified `Cache.make<K>()` factory that internally selects backing persistence (memory vs Redis) based on configuration, with built-in Reactivity integration for cross-pod invalidation.

## Standard Stack

### Core (Already in Catalog)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @effect/experimental | 0.58.0 | PersistedCache, Persistence, Reactivity | Official Effect caching infra |
| ioredis | catalog: | Redis client | Used by Persistence/Redis |
| effect | 3.19.x | Core Effect runtime | Effect.Cache, Schema, PrimaryKey |

### Key Modules from @effect/experimental

| Module | Purpose | When to Use |
|--------|---------|-------------|
| `PersistedCache` | L1/L2 cache with schema-validated persistence | Primary cache for domain entities |
| `Persistence.ResultPersistence` | Schema-aware Exit storage | Backend for PersistedCache |
| `Persistence.BackingPersistence` | Raw key-value storage | Lower-level, when schema not needed |
| `Reactivity` | In-process invalidation coordination | Cross-query cache invalidation |
| `Persistence/Redis` | Redis-backed BackingPersistence | Production distributed caching |
| `Persistence.layerMemory` | In-memory BackingPersistence | Testing, local-only caching |

## Architecture Patterns

### Pattern 1: PersistedCache L1/L2 Architecture

```
+------------------+     miss     +---------------------+     miss     +----------------+
|   L1 (Memory)    |  -------->   |  L2 (Persistence)   |  -------->   |    Lookup      |
|  Effect.Cache    |              |  ResultPersistence  |              |    Function    |
+------------------+              +---------------------+              +----------------+
        |                                   |
        | cache.invalidate(key)             |
        +-----------------------------------+
                        |
                        v
              +-------------------+
              |    Reactivity     |
              | (local handlers)  |
              +-------------------+
                        |
                        v (pub/sub bridge)
              +-------------------+
              |  Redis Pub/Sub    |
              | (cross-instance)  |
              +-------------------+
```

**Source code reference:** `/node_modules/@effect/experimental/src/PersistedCache.ts` lines 66-102

The PersistedCache internally creates:
1. An Effect.Cache (L1) with configurable `capacity` and `timeToLive`
2. A ResultPersistenceStore (L2) for durable storage
3. Lookup happens: L1 miss -> L2 miss -> execute lookup function -> store in L2 -> store in L1

### Pattern 2: Persistable Key Schema (Required Interface)

Keys must implement both `Schema.WithResult` and `PrimaryKey.PrimaryKey`:

```typescript
// Source: @effect/experimental/src/Persistence.ts lines 182-191
interface Persistable<A extends Schema.Schema.Any, E extends Schema.Schema.All>
  extends Schema.WithResult<A["Type"], A["Encoded"], E["Type"], E["Encoded"], A["Context"] | E["Context"]>,
          PrimaryKey.PrimaryKey {}
```

**Concrete example from existing codebase:**
```typescript
import { PrimaryKey, Schema as S } from 'effect';

class UserCacheKey extends S.Class<UserCacheKey>('UserCacheKey')({
  userId: S.String,
}) implements S.WithResult<
  typeof User.Type,           // Success type
  string,                     // Encoded success
  typeof UserNotFound.Type,   // Failure type
  unknown,                    // Encoded failure
  never                       // Context
>, PrimaryKey.PrimaryKey {
  get [PrimaryKey.symbol](): string {
    return `user:${this.userId}`;
  }
  get [S.symbolResult]() {
    return { success: User, failure: UserNotFound };
  }
}
```

### Pattern 3: Polymorphic Backend Selection

The architecture supports swapping backends via Layer composition:

```typescript
// Memory-only (testing, local dev)
const TestLayer = PersistedCache.make(options).pipe(
  Effect.provide(Persistence.layerResultMemory)
);

// Redis-backed (production)
const ProdLayer = PersistedCache.make(options).pipe(
  Effect.provide(PersistenceRedis.layerResult(redisOptions))
);
```

**Source:** `/node_modules/@effect/experimental/src/Persistence.ts` lines 448-450

### Pattern 4: Reactivity Integration for Cross-Instance Invalidation

Reactivity provides LOCAL invalidation coordination. For CROSS-INSTANCE, you need a pub/sub bridge (exactly what `cache.ts` already implements).

```typescript
// Source: @effect/experimental/src/Reactivity.ts lines 29-88
// Reactivity.make creates a local handler registry:
// - handlers: Map<number | string, Set<() => void>>
// - unsafeRegister(keys, handler) -> unsubscribe function
// - invalidate(keys) -> triggers all handlers for those keys
```

**Cross-instance pattern (from existing cache.ts):**
```typescript
// Bridge: Redis pub/sub -> local Reactivity
sub.on('message', (ch, msg) => {
  const { key, storeId } = JSON.parse(msg);
  reactivity.invalidate([`${storeId}:${key}`]);
});

// On invalidate: local + broadcast
const invalidate = (key) => Effect.all([
  reactivity.invalidate([`${storeId}:${key}`]),
  redis.publish(channel, JSON.stringify({ key, storeId })),
], { discard: true });
```

## PersistedCache.make() Complete API

**Source:** `/node_modules/@effect/experimental/src/PersistedCache.ts` lines 47-57

```typescript
PersistedCache.make<K extends Persistence.ResultPersistence.KeyAny, R>(options: {
  // REQUIRED
  readonly storeId: string;  // Unique identifier for this cache store
  readonly lookup: (key: K) => Effect.Effect<
    Schema.WithResult.Success<K>,  // Success type derived from key schema
    Schema.WithResult.Failure<K>,  // Failure type derived from key schema
    R                              // Requirements
  >;
  readonly timeToLive: (
    ...args: Persistence.ResultPersistence.TimeToLiveArgs<K>
  ) => Duration.DurationInput;  // TTL per (key, exit) tuple

  // OPTIONAL (with defaults)
  readonly inMemoryCapacity?: number;      // Default: 64
  readonly inMemoryTTL?: Duration.DurationInput;  // Default: 10_000ms (10s)
}): Effect.Effect<
  PersistedCache<K>,
  never,
  Schema.SerializableWithResult.Context<K> | R | Persistence.ResultPersistence | Scope.Scope
>
```

**Key insight:** `timeToLive` receives BOTH the key AND the exit (success/failure), allowing conditional TTL:
```typescript
timeToLive: (key, exit) =>
  Exit.isSuccess(exit) ? Duration.minutes(5) : Duration.seconds(30)
```

## Handling Option<T> Lookups

PersistedCache stores `Exit<A, E>`, meaning:
- Success: the value exists
- Failure: domain error (e.g., NotFound)

For `Option<T>` semantics, two approaches:

### Approach 1: Encode None as Domain Error (Recommended)

```typescript
class EntityNotFound extends Data.TaggedError('EntityNotFound')<{ id: string }> {}

// Key schema defines failure as EntityNotFound
class EntityKey implements PrimaryKey.PrimaryKey, S.WithResult<Entity, ..., EntityNotFound, ...> { }

// Lookup returns Entity | EntityNotFound
const lookup = (key: EntityKey) =>
  db.findById(key.id).pipe(
    Effect.flatMap(Option.match({
      onNone: () => Effect.fail(new EntityNotFound({ id: key.id })),
      onSome: Effect.succeed,
    }))
  );

// Consumer handles NotFound
cache.get(key).pipe(
  Effect.catchTag('EntityNotFound', () => Effect.succeed(Option.none()))
);
```

**Pro:** Cache stores the "not found" result, preventing repeated lookups for missing entities.

### Approach 2: CacheService.cacheOption Pattern (Existing)

The codebase already has `CacheService.cacheOption`:

```typescript
// Source: cache.ts lines 128-138
static readonly cacheOption = <K, A, B, R>(options: {
  readonly storeId: string;
  readonly lookup: (key: K) => Effect.Effect<Option.Option<A>, Failure<K>, R>;
  readonly map: (value: A) => B;
  readonly onSome?: (value: A) => Effect.Effect<void, unknown, R>;
  // ...
}) => CacheService.cache<K, R>({
  // Wraps Option handling internally
  lookup: (key) => options.lookup(key).pipe(
    Effect.tap(Option.match({ onNone: () => Effect.void, onSome: options.onSome })),
    Effect.map(Option.map(options.map))
  ),
});
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| In-memory LRU cache | Custom Map with eviction | `Effect.Cache` | Built-in capacity, TTL, stampede prevention |
| Schema-validated persistence | JSON.stringify + manual parse | `Persistence.ResultPersistence` | Exit serialization, parse errors, type safety |
| L1/L2 cache tiering | Custom layered cache | `PersistedCache` | Handles L1 miss -> L2 miss -> lookup chain |
| Cross-instance invalidation | Custom pub/sub handlers | Reactivity + pub/sub bridge | Standard pattern, handler cleanup on scope finalize |
| TTL-based expiration | setTimeout/setInterval | Persistence TTL | Backend handles expiration (Redis PXEXPIRE) |

## Common Pitfalls

### Pitfall 1: Missing PrimaryKey Implementation

**What goes wrong:** TypeScript compiles, but runtime fails with "Cannot read symbol" or incorrect cache keys
**Why it happens:** `Persistable` requires `[PrimaryKey.symbol]()` method
**How to avoid:**
```typescript
class MyKey extends S.Class<MyKey>('MyKey')({ ... }) implements PrimaryKey.PrimaryKey {
  get [PrimaryKey.symbol](): string {
    return `prefix:${this.id}`;  // MUST return unique string
  }
}
```
**Warning signs:** All keys hitting same cache entry, or no cache hits at all

### Pitfall 2: Not Providing ResultPersistence Layer

**What goes wrong:** `Effect.Die` or unhandled service error
**Why it happens:** PersistedCache requires `Persistence.ResultPersistence` in context
**How to avoid:** Always provide persistence layer:
```typescript
PersistedCache.make(options).pipe(
  Effect.provide(PersistenceRedis.layerResult(redisOptions))  // or layerResultMemory
)
```

### Pitfall 3: Reactivity is Local-Only

**What goes wrong:** Cache invalidation doesn't propagate to other pods
**Why it happens:** Reactivity uses in-process Map, not distributed
**How to avoid:** Bridge Reactivity to Redis pub/sub (as cache.ts does)
**Warning signs:** Stale data in multi-instance deployments

### Pitfall 4: TTL Function Ignores Exit

**What goes wrong:** Failed lookups cached for too long, or not cached at all
**Why it happens:** `timeToLive` receives `(key, exit)` but developer ignores exit
**How to avoid:**
```typescript
timeToLive: (key, exit) =>
  Exit.isFailure(exit) ? Duration.seconds(30) : Duration.minutes(5)
```

### Pitfall 5: Schema Context Not Provided

**What goes wrong:** Effect fails to serialize/deserialize
**Why it happens:** Key schema requires context (e.g., `MyService`) but layer not provided
**How to avoid:** Check `Schema.SerializableWithResult.Context<K>` and provide required layers

## Code Examples

### Example 1: Complete PersistedCache Setup

```typescript
import { PersistedCache, Persistence, Reactivity } from '@effect/experimental';
import * as PersistenceRedis from '@effect/experimental/Persistence/Redis';
import { Data, Duration, Effect, Exit, PrimaryKey, Schema as S, type Scope } from 'effect';

// 1. Define domain types
class User extends S.Class<User>('User')({ id: S.String, name: S.String }) {}
class UserNotFound extends Data.TaggedError('UserNotFound')<{ id: string }> {}

// 2. Define cache key (implements Persistable)
class UserKey extends S.Class<UserKey>('UserKey')({
  userId: S.String,
}) implements PrimaryKey.PrimaryKey {
  get [PrimaryKey.symbol]() { return `user:${this.userId}`; }
  get [S.symbolResult]() {
    return { failure: UserNotFound, success: User };
  }
}

// 3. Create cache factory
const makeUserCache = PersistedCache.make({
  storeId: 'users',
  lookup: (key: UserKey) =>
    db.findUser(key.userId).pipe(
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(new UserNotFound({ id: key.userId })),
        onSome: Effect.succeed,
      }))
    ),
  timeToLive: (key, exit) =>
    Exit.isSuccess(exit) ? Duration.minutes(10) : Duration.seconds(60),
  inMemoryCapacity: 1000,
  inMemoryTTL: Duration.seconds(30),
});

// 4. Provide layers
const program = Effect.gen(function* () {
  const cache = yield* makeUserCache;
  const user = yield* cache.get(new UserKey({ userId: '123' }));
  return user;
}).pipe(
  Effect.provide(PersistenceRedis.layerResult({ host: 'localhost', port: 6379 }))
);
```

### Example 2: Polymorphic Cache Factory (Unified Approach)

```typescript
// Unified factory that handles all three current patterns
const UnifiedCache = {
  // Pattern 1: Full PersistedCache with L1/L2
  make: <K extends Persistence.ResultPersistence.KeyAny, R>(options: {
    storeId: string;
    lookup: (key: K) => Effect.Effect<S.WithResult.Success<K>, S.WithResult.Failure<K>, R>;
    ttl?: Duration.DurationInput;
    mode?: 'local' | 'distributed';
  }) => Effect.gen(function* () {
    const reactivity = yield* Reactivity.Reactivity;
    const cache = yield* PersistedCache.make({
      storeId: options.storeId,
      lookup: options.lookup,
      timeToLive: () => options.ttl ?? Duration.minutes(5),
      inMemoryCapacity: 1000,
      inMemoryTTL: Duration.seconds(30),
    });

    // Wrap with Reactivity for cross-instance invalidation
    return {
      get: (key: K) =>
        reactivity.unsafeRegister([`${options.storeId}:${PrimaryKey.value(key)}`], () => {})
          .pipe(() => cache.get(key)),
      invalidate: (key: K) =>
        Effect.all([
          cache.invalidate(key),
          reactivity.invalidate([`${options.storeId}:${PrimaryKey.value(key)}`]),
        ], { discard: true }),
    };
  }),

  // Pattern 2: Simple in-memory memoization (replaces Ref<HashMap>)
  memoize: <A, E, R>(options: {
    key: string;
    effect: Effect.Effect<A, E, R>;
    ttl: Duration.DurationInput;
  }) => Effect.cachedWithTTL(options.effect, options.ttl),

  // Pattern 3: Hash-based presence (replaces raw Redis hget/hset)
  presence: {
    layer: (options: { prefix: string }) =>
      // Use BackingPersistence for non-schema data
      Persistence.BackingPersistence.pipe(
        Effect.map((backing) => backing.make(options.prefix)),
        Layer.unwrapScoped,
      ),
  },
};
```

### Example 3: Layer Composition for Mode Switching

```typescript
// Config-driven backend selection
const CacheBackend = Layer.unwrapEffect(
  Config.string('CACHE_BACKEND').pipe(
    Config.withDefault('redis'),
    Effect.map((backend) =>
      backend === 'memory'
        ? Persistence.layerResultMemory
        : PersistenceRedis.layerResult({ host: 'localhost', port: 6379 })
    ),
  )
);

// Full cache layer with Reactivity
const CacheLayer = CacheBackend.pipe(
  Layer.provideMerge(Reactivity.layer),
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual Effect.Cache + Redis calls | PersistedCache with layered persistence | @effect/experimental 0.15+ | Unified L1/L2, schema validation |
| Custom invalidation handlers | Reactivity.make + unsafeRegister | @effect/experimental 0.20+ | Standard invalidation patterns |
| Raw JSON.stringify/parse | Schema.serializeExit/deserializeExit | Effect 3.x | Type-safe persistence |

**Current best practice (from source analysis):**
- Use `PersistedCache` for entity caching with schema validation
- Use `Reactivity` for local invalidation coordination
- Bridge to Redis pub/sub for cross-instance invalidation
- Use `Persistence.layerMemory` for testing, `PersistenceRedis.layerResult` for production

## Open Questions

1. **Batch invalidation performance**
   - What we know: Reactivity.invalidate accepts arrays
   - What's unclear: Performance impact of large batch invalidations
   - Recommendation: Profile with expected workload

2. **Memory pressure from L1 cache**
   - What we know: `inMemoryCapacity` defaults to 64
   - What's unclear: Optimal capacity for high-throughput scenarios
   - Recommendation: Monitor cache hit rates, adjust capacity

3. **Presence data schema requirement**
   - What we know: Current presence uses raw Redis hashes
   - What's unclear: Whether to migrate to PersistedCache or keep separate
   - Recommendation: Keep separate for now; presence is ephemeral, not entity data

## Sources

### Primary (HIGH confidence)
- `/node_modules/@effect/experimental/src/PersistedCache.ts` - Source code analysis
- `/node_modules/@effect/experimental/src/Persistence.ts` - Source code analysis
- `/node_modules/@effect/experimental/src/Persistence/Redis.ts` - Source code analysis
- `/node_modules/@effect/experimental/src/Reactivity.ts` - Source code analysis
- [Effect-TS Experimental Docs](https://effect-ts.github.io/effect/docs/experimental)
- [Persistence/Redis API](https://effect-ts.github.io/effect/experimental/Persistence/Redis.ts.html)

### Secondary (MEDIUM confidence)
- [Effect Cache Documentation](https://effect.website/docs/caching/cache/)
- [This Week in Effect 2025-08-15](https://effect.website/blog/this-week-in-effect/2025/08/15/) - Reactivity bug fix

### Existing Codebase (HIGH confidence)
- `/packages/server/src/platform/cache.ts` - Current implementation reference
- `/packages/server/src/utils/resilience.ts` - Memoization pattern reference

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified via source code and catalog
- Architecture patterns: HIGH - verified via source code implementation
- API surface: HIGH - extracted directly from TypeScript source
- Pitfalls: MEDIUM - derived from source analysis + common Effect patterns

**Research date:** 2026-02-02
**Valid until:** 2026-03-02 (30 days - stable library)

## Unified Cache Consolidation Recommendation

Based on research, the recommended approach for consolidating the three cache patterns:

### 1. Keep PersistedCache for Entity Caching

The existing `CacheService.cache()` pattern is correct. Enhance with:
- Explicit mode selection (`local` vs `distributed`)
- Configurable L1 capacity per cache instance
- Built-in Reactivity registration (current manual approach is fine)

### 2. Replace Ref<HashMap> Memoization with Effect.cachedWithTTL

```typescript
// Before (resilience.ts)
const _memoStore = Ref.make(HashMap.empty<string, Effect.Effect<...>>());

// After
const memoized = Effect.cachedWithTTL(effect, Duration.minutes(5));
```

Effect.cachedWithTTL provides the same semantics with simpler code.

### 3. Consider Migrating Presence to BackingPersistence

```typescript
// Optional: Use BackingPersistence for type safety
const presenceStore = yield* Persistence.BackingPersistence;
const store = yield* presenceStore.make('presence');
yield* store.set(`${tenantId}:${socketId}`, { userId, connectedAt }, Option.some(Duration.seconds(120)));
```

However, current raw Redis hash approach is acceptable for ephemeral presence data.

### Final Architecture

```
+---------------------+
|   UnifiedCache      |  <-- Single factory, multiple modes
+---------------------+
         |
         |-- mode: 'entity'    --> PersistedCache (L1/L2, schema)
         |-- mode: 'memo'      --> Effect.cachedWithTTL (in-memory only)
         |-- mode: 'presence'  --> BackingPersistence (Redis hash, no schema)
         |
         v
+---------------------+
|     Reactivity      |  <-- Local invalidation
+---------------------+
         |
         v (pub/sub bridge)
+---------------------+
|   Redis Pub/Sub     |  <-- Cross-instance invalidation
+---------------------+
```
