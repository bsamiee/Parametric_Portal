# Phase 1: Platform API Adoption - Research

**Researched:** 2026-01-27
**Domain:** Effect.Service patterns for CacheService (L1/L2) and StreamingService with intelligent defaults
**Confidence:** HIGH

## Summary

This research addresses the key technical decisions for building two proper Effect.Service implementations following the MetricsService polymorphic pattern. The phase requires understanding four Effect APIs: `@effect/experimental` Redis/PersistedCache for L2 cache, `Effect.Cache` for L1 memory, `Effect.Stream` for backpressure and chunking, and `@effect/platform` Worker APIs for Phase 3 preparation.

The codebase already uses `@effect/experimental` RateLimiter with Redis store via ioredis, but the current cache.ts and stream.ts are loose wrappers, not dense services. The refactor must follow the MetricsService pattern: single Effect.Service class with static methods, polymorphic functions for common operations, and all logic internalized.

Key findings:
- `@effect/experimental` provides `Persistence/Redis` for L2 storage but lacks pub/sub; ioredis must handle cross-instance invalidation
- `PersistedCache` provides L1+L2 architecture with automatic tiering; can be extended for custom needs
- `Effect.Cache` provides request deduplication via concurrent lookup coalescing
- `Stream.buffer` with `sliding`/`suspend` strategies handles backpressure; `Stream.grouped` and `Stream.rechunk` handle chunking
- FiberRef context propagation is automatic in Effect; services can read tenant/user from RequestContext

**Primary recommendation:** Build CacheService using `@effect/experimental/PersistedCache` as foundation with ioredis pub/sub for invalidation; build StreamingService as unified facade over Stream operations with intelligent defaults per stream type.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `effect` | 3.19.15 | Runtime, Cache, Stream, PubSub primitives | Already in catalog; foundation of codebase |
| `@effect/experimental` | 0.58.0 | PersistedCache, Persistence/Redis, RateLimiter | Already in catalog; official L2 cache backend |
| `@effect/platform` | 0.94.2 | Worker, SerializedWorkerPool | Already in catalog; Phase 3 worker preparation |
| `@effect/workflow` | 0.16.0 | Durable workflow execution | Already in catalog; Phase 3 workflow preparation |
| `ioredis` | 5.9.2 | Redis client for pub/sub invalidation | Already in catalog; used by rate-limit.ts |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `cockatiel` | 3.2.1 | Circuit breaker | Already used in circuit.ts; resilience patterns |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ioredis for pub/sub | Effect PubSub | Effect PubSub is in-memory only; Redis needed for cross-instance |
| PersistedCache | Custom L1/L2 | PersistedCache handles tiering automatically; less code |
| Manual chunking | Stream.grouped/rechunk | Stream APIs are optimized and tested |

**Installation:** All dependencies already in `pnpm-workspace.yaml` catalog.

## Architecture Patterns

### Recommended Project Structure

```
packages/server/src/
+-- platform/                    # New: Platform services (Phase 1)
|   +-- cache.ts                 # CacheService Effect.Service class
|   +-- streaming.ts             # StreamingService Effect.Service class
+-- utils/                       # Existing: Utilities used by services
|   +-- circuit.ts               # Circuit breaker (unchanged)
|   +-- resilience.ts            # Resilience wrapper (unchanged)
+-- http/                        # Existing: HTTP-specific (thin wrappers)
|   +-- cache.ts                 # DELETED: absorbed into platform/cache.ts
|   +-- stream.ts                # DELETED: absorbed into platform/streaming.ts
+-- security/
|   +-- rate-limit.ts            # REFACTORED: uses CacheService.redis
|   +-- totp-replay.ts           # REFACTORED: uses CacheService.redis
```

### Pattern 1: Effect.Service with Static Methods (MetricsService Pattern)

**What:** All service logic inside a single class extending `Effect.Service<T>()()`. Static methods provide the public API.

**When to use:** Always for services in this codebase. This is the established pattern.

**Example:**
```typescript
// Source: packages/server/src/observe/metrics.ts (existing codebase)
class MetricsService extends Effect.Service<MetricsService>()('server/Metrics', {
  effect: Effect.succeed({
    cache: {
      hits: Metric.counter('cache_hits_total'),
      misses: Metric.counter('cache_misses_total'),
      // ...
    },
  }),
}) {
  // Polymorphic label function - single function for all label needs
  static readonly label = (pairs: Record<string, string | undefined>): HashSet.HashSet<MetricLabel.MetricLabel> =>
    HashSet.fromIterable(/* ... */);

  // Static methods provide API surface
  static readonly inc = (counter, labels, value = 1) => /* ... */;
  static readonly trackEffect = <A, E, R>(effect, config) => /* ... */;
}
```

### Pattern 2: L1/L2 Cache Architecture with PersistedCache

**What:** Memory cache fronts Redis cache. `PersistedCache` handles tiering automatically; custom invalidation via ioredis pub/sub.

**When to use:** CacheService implementation.

**Example:**
```typescript
// Source: @effect/experimental/PersistedCache (Context7 docs)
import * as PersistedCache from "@effect/experimental/PersistedCache"
import * as Redis from "@effect/experimental/Persistence/Redis"

const cache = PersistedCache.make({
  storeId: "sessions",
  lookup: (key) => findSession(key),
  timeToLive: (key) => Duration.minutes(30),
  inMemoryCapacity: 1000,     // L1 size
  inMemoryTTL: 10_000,        // L1 validity in ms
});
```

### Pattern 3: Auto-Scope via FiberRef Context

**What:** Services read tenant/user context from FiberRef automatically. No namespace parameters in public API.

**When to use:** All cache and streaming operations.

**Example:**
```typescript
// Source: packages/server/src/context.ts (existing codebase)
const _ref = FiberRef.unsafeMake<Context.Request.Data>(_default);

class Request extends Effect.Tag('server/RequestContext')<Request, Context.Request.Data>() {
  static readonly tenantId = FiberRef.get(_ref).pipe(Effect.map((ctx) => ctx.tenantId));
  static readonly session = FiberRef.get(_ref).pipe(Effect.flatMap((ctx) => Option.match(ctx.session, { /* ... */ })));
}

// CacheService reads context internally:
const scopedKey = Effect.gen(function* () {
  const tenantId = yield* Context.Request.tenantId;
  const session = yield* Effect.serviceOption(Context.Request.session);
  const userId = Option.map(session, s => s.userId).pipe(Option.getOrElse(() => ''));
  return userId ? `${tenantId}:${userId}:${key}` : `${tenantId}:${key}`;
});
```

### Pattern 4: Intelligent Backpressure Defaults

**What:** Different stream types get different buffering strategies. SSE uses sliding (drop stale), downloads/exports use suspend (wait).

**When to use:** StreamingService entry points.

**Example:**
```typescript
// Source: Context7 Effect.Stream docs
const _buffers = {
  sse:      { capacity: 64,  strategy: 'sliding'  },  // Drop stale events
  download: { capacity: 256, strategy: 'suspend'  },  // Wait for consumer
  export:   { capacity: 128, strategy: 'suspend'  },  // Wait for consumer
} as const;

// Applied internally, not configurable by consumer
Stream.buffer(stream, { capacity: _buffers.sse.capacity, strategy: 'sliding' });
```

### Pattern 5: Redis Pub/Sub for Cross-Instance Invalidation

**What:** ioredis handles pub/sub for cache invalidation across server instances. Memory cache cleared when invalidation message received.

**When to use:** CacheService invalidation.

**Example:**
```typescript
// Source: Context7 ioredis docs
import Redis from "ioredis";

const sub = new Redis();
const pub = new Redis();

// Subscribe to invalidation channel
sub.subscribe("cache:invalidate", (err, count) => {
  if (err) Effect.runFork(Effect.logError("Pub/sub subscribe failed", { error: err.message }));
});

sub.on("message", (channel, message) => {
  const { key, tenantId } = JSON.parse(message);
  // Clear L1 cache for this key
  Effect.runFork(l1Cache.invalidate(`${tenantId}:${key}`));
});

// Publish invalidation when key is invalidated
const invalidate = (key: string) => Effect.gen(function* () {
  const tenantId = yield* Context.Request.tenantId;
  yield* Effect.promise(() => pub.publish("cache:invalidate", JSON.stringify({ key, tenantId })));
  yield* l1Cache.invalidate(`${tenantId}:${key}`);
});
```

### Anti-Patterns to Avoid

- **Loose const/function exports:** DO NOT export standalone `const make = ...` or `function lookup()`. All logic goes inside Effect.Service class with static methods.
- **Consumer-facing namespaces:** DO NOT require consumers to pass `namespace: 'sessions'`. Derive from context.
- **Consumer-configurable resilience:** DO NOT let consumers pass `timeout`, `retry`, `circuit` options. Internalize with intelligent defaults.
- **Buffer configuration in API:** DO NOT expose `buffer: { capacity, strategy }` to consumers. Intelligent defaults per stream type.
- **Multiple helpers per file:** Maximum ONE internal helper function. Ideally zero.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| L1/L2 cache tiering | Custom cache wrapper | `@effect/experimental/PersistedCache` | Handles tiering, TTL, capacity automatically |
| Request deduplication | Custom Map with locks | `Effect.Cache` concurrent lookup | Built-in coalescing of concurrent lookups for same key |
| Stream backpressure | Custom queuing | `Stream.buffer` with strategy | Tested, optimized, supports sliding/suspend/dropping |
| Stream chunking | Manual batching | `Stream.grouped`, `Stream.rechunk` | Handles edge cases, integrates with flow control |
| Redis pub/sub | Custom socket management | ioredis pub/sub | Connection management, reconnection, pattern matching |
| Circuit breaker | Custom state machine | cockatiel via circuit.ts | Already in codebase, battle-tested |

**Key insight:** The Effect ecosystem provides composable primitives for all these concerns. The job is composition with intelligent defaults, not reimplementation.

## Common Pitfalls

### Pitfall 1: Mixing Effect.Cache with PersistedCache

**What goes wrong:** Wrapping `Effect.Cache` around `PersistedCache` creates double-caching and inconsistent state.

**Why it happens:** Misunderstanding that `PersistedCache` already includes an L1 memory tier via `inMemoryCapacity`.

**How to avoid:** Use `PersistedCache` as the single cache abstraction. It handles L1 (memory) and L2 (Redis) internally.

**Warning signs:** Two `Cache.make` calls in the same service; TTL applied at multiple layers.

### Pitfall 2: Redis Pub/Sub on Same Connection

**What goes wrong:** Using same ioredis connection for commands and pub/sub causes blocking or dropped messages.

**Why it happens:** ioredis connection enters "subscriber mode" when `subscribe()` is called; other commands fail.

**How to avoid:** Create separate connections: one for pub/sub, one for commands. The `@effect/experimental/Persistence/Redis` layer handles command connections; create separate pub/sub connections.

**Warning signs:** "ERR only (P)SUBSCRIBE / (P)UNSUBSCRIBE / PING / QUIT allowed in this context" errors.

### Pitfall 3: Stream.buffer After Encoding

**What goes wrong:** Buffering after encoding (e.g., JSON.stringify) means buffer holds strings, not domain objects. Can't drop/coalesce intelligently.

**Why it happens:** Natural to buffer at the end of the pipeline, but backpressure works best when buffer holds semantic units.

**How to avoid:** Buffer before encoding. Let sliding strategy drop stale domain events, then encode remaining.

**Warning signs:** High memory usage despite "sliding" strategy; stale data not being dropped.

### Pitfall 4: FiberRef Not Propagating to Background Fibers

**What goes wrong:** Background fibers (e.g., write-behind to Redis) lose tenant context.

**Why it happens:** `Effect.forkDaemon` doesn't inherit FiberRefs by default in some scenarios.

**How to avoid:** Use `Effect.forkScoped` or explicitly inherit FiberRefs. For write-behind, capture context before forking.

**Warning signs:** "Unknown tenant" in background job logs; cross-tenant data leaks.

### Pitfall 5: Exposing Service Instance Shape

**What goes wrong:** Consumers depend on internal structure (e.g., `cache.internal.size`).

**Why it happens:** Returning Effect.Cache instance directly instead of wrapping in service API.

**How to avoid:** Service exposes only documented API via static methods. No access to internal Effect.Cache or PersistedCache instances.

**Warning signs:** Type exports like `type CacheInstance = Effect.Effect.Success<...>`.

## Code Examples

### CacheService Shell Structure

```typescript
// Source: Derived from MetricsService pattern in packages/server/src/observe/metrics.ts
import { PersistedCache, Persistence } from "@effect/experimental";
import { Redis as RedisStore } from "@effect/experimental/Persistence/Redis";
import { Effect, Layer, Option, PubSub } from "effect";
import Redis from "ioredis";
import { Context } from "../context.ts";
import { MetricsService } from "../observe/metrics.ts";
import { Resilience } from "../utils/resilience.ts";

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
  defaults: { capacity: 1000, ttl: Duration.minutes(5), inMemoryTTL: 10_000 },
  pubsub: { channel: "cache:invalidate" },
} as const;

// --- [SERVICES] --------------------------------------------------------------

class CacheService extends Effect.Service<CacheService>()("server/CacheService", {
  scoped: Effect.gen(function* () {
    const redisOptions = yield* Config.all({ host: Config.string("REDIS_HOST"), /* ... */ });
    const pub = new Redis(redisOptions);
    const sub = new Redis(redisOptions);

    // Setup pub/sub for cross-instance invalidation
    yield* Effect.acquireRelease(
      Effect.sync(() => sub.subscribe(_config.pubsub.channel)),
      () => Effect.sync(() => { sub.unsubscribe(); sub.disconnect(); pub.disconnect(); }),
    );

    // Internal L1/L2 cache store
    const store = yield* RedisStore.layer(redisOptions);

    return { _pub: pub, _sub: sub, _store: store };
  }),
}) {
  // --- [POLYMORPHIC] ---------------------------------------------------------

  // Single get() function - internally handles L1/L2, resilience, metrics, auto-scope
  static readonly get = <K, V>(
    domain: string,
    lookup: (key: K) => Effect.Effect<V, never, never>,
  ) => (key: K): Effect.Effect<Option.Option<V>, never, CacheService | MetricsService> =>
    Effect.gen(function* () {
      const service = yield* CacheService;
      const tenantId = yield* Context.Request.tenantId;
      const sessionOpt = yield* Effect.serviceOption(Context.Request);
      const userId = Option.flatMap(sessionOpt, s => s.session).pipe(Option.map(s => s.userId), Option.getOrElse(() => ""));
      const scopedKey = userId ? `${tenantId}:${userId}:${domain}:${key}` : `${tenantId}:${domain}:${key}`;

      // Lookup with resilience
      const resilientLookup = Resilience.wrap(lookup(key), {
        operation: `cache:${domain}:lookup`,
        timeout: Duration.seconds(5),
        retry: "fast",
      });

      // ... PersistedCache integration
      return Option.some(value);
    });

  // Invalidate with pub/sub broadcast
  static readonly invalidate = (domain: string, key: string): Effect.Effect<void, never, CacheService> =>
    Effect.gen(function* () {
      const service = yield* CacheService;
      const tenantId = yield* Context.Request.tenantId;
      yield* Effect.promise(() => service._pub.publish(_config.pubsub.channel, JSON.stringify({ domain, key, tenantId })));
    });

  // Health check for L1 and L2
  static readonly health = (): Effect.Effect<{ l1: boolean; l2: boolean }, never, CacheService> =>
    Effect.gen(function* () {
      const service = yield* CacheService;
      const l2 = yield* Effect.tryPromise(() => service._pub.ping()).pipe(Effect.map(() => true), Effect.orElseSucceed(() => false));
      return { l1: true, l2 };
    });

  // Expose Redis client for specialized services (ReplayGuard)
  static readonly redis = Effect.map(CacheService, (s) => s._pub);
}
```

### StreamingService Shell Structure

```typescript
// Source: Derived from existing stream.ts with MetricsService pattern
import { Headers, HttpServerResponse } from "@effect/platform";
import { Sse } from "@effect/experimental";
import { Duration, Effect, Match, Option, Schedule, Stream } from "effect";
import { Context } from "../context.ts";
import { MetricsService } from "../observe/metrics.ts";

// --- [CONSTANTS] -------------------------------------------------------------

const _buffers = {
  sse:      { capacity: 64,  strategy: "sliding"  },
  download: { capacity: 256, strategy: "suspend"  },
  export:   { capacity: 128, strategy: "suspend"  },
} as const;

// --- [SERVICES] --------------------------------------------------------------

class StreamingService extends Effect.Service<StreamingService>()("server/StreamingService", {
  effect: Effect.succeed({}),
}) {
  // --- [ENTRY POINTS] --------------------------------------------------------

  // SSE with intelligent defaults: sliding buffer, heartbeat, auto-metrics
  static readonly sse = <A, E>(
    name: string,
    events: Stream.Stream<A, E, never>,
    serialize: (a: A) => { data: string; event?: string; id?: string },
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, never, MetricsService> =>
    Effect.gen(function* () {
      const metrics = yield* MetricsService;
      const tenantId = yield* Context.Request.tenantId.pipe(Effect.orElseSucceed(() => "system"));
      const labels = MetricsService.label({ stream: name, tenant: tenantId });

      const pipeline = events.pipe(
        // Metrics before buffer (track all produced, not just consumed)
        Stream.tap(() => MetricsService.inc(metrics.stream.elements, labels)),
        // Buffer with intelligent defaults
        Stream.buffer({ capacity: _buffers.sse.capacity, strategy: "sliding" }),
        // Encode to SSE format
        Stream.map((a) => /* ... */),
        // Heartbeat
        Stream.merge(Stream.schedule(Stream.repeatValue(heartbeat), Schedule.spaced(Duration.seconds(30)))),
        // Cleanup
        Stream.ensuring(Effect.logDebug("SSE stream closed", { name, tenant: tenantId })),
      );

      return HttpServerResponse.stream(pipeline, { contentType: "text/event-stream" });
    });

  // Binary download with suspend backpressure
  static readonly download = <E>(
    stream: Stream.Stream<Uint8Array, E, never>,
    config: { filename: string; contentType: string; size?: number },
  ): HttpServerResponse.HttpServerResponse =>
    HttpServerResponse.stream(
      Stream.buffer(stream, { capacity: _buffers.download.capacity, strategy: "suspend" }),
      { contentType: config.contentType, headers: /* ... */ },
    );

  // Formatted export (json/csv/ndjson) with suspend backpressure
  static readonly export = <A, E>(
    name: string,
    stream: Stream.Stream<A, E, never>,
    format: "json" | "csv" | "ndjson",
    serialize?: (a: A) => string,
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, never, MetricsService> =>
    Effect.gen(function* () {
      // Similar pattern: metrics, intelligent buffering, format encoding
    });
}
```

### Stream Chunking Patterns

```typescript
// Source: Context7 Effect.Stream docs

// Group into fixed-size chunks (batching)
const batched = Stream.range(0, 100).pipe(Stream.grouped(10));
// Output: Stream of Chunks, each containing 10 elements

// Rechunk to optimal sizes for downstream
const rechunked = stream.pipe(Stream.rechunk(64));
// Useful when upstream produces single elements, downstream wants chunks

// Weight-based chunking (for variable-size items)
const weightedBatch = stream.pipe(
  Stream.transduce(
    Sink.foldWeighted({
      initial: Chunk.empty<Item>(),
      maxCost: 1_000_000,  // 1MB batch
      cost: (item) => item.size,
      body: (acc, item) => Chunk.append(acc, item),
    }),
  ),
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Effect.Cache` for all caching | `PersistedCache` for L1+L2 | Effect 3.x | Single abstraction handles tiering |
| Manual stream encoding | `@effect/experimental/Sse` | Effect 3.x | SSE encoding helper |
| `Stream.toReadableStream` | `Stream.toReadableStreamEffect` | Effect 3.2 | Supports Effect context in conversion |
| `RateLimiter` core module | `@effect/experimental/RateLimiter` | Effect 3.x | Redis-backed rate limiting |

**Deprecated/outdated:**
- `Cache.make` with manual L2 wrapper: Use `PersistedCache` instead
- Manual SSE encoding: Use `Sse.encoder` from `@effect/experimental`

## Open Questions

1. **PersistedCache invalidation API**
   - What we know: `PersistedCache` has `invalidate(key)` method
   - What's unclear: Does it clear both L1 and L2? Does it support broadcast?
   - Recommendation: Verify in source; may need custom invalidation layer with ioredis pub/sub

2. **RateLimiter Store Sharing**
   - What we know: `@effect/experimental/RateLimiter/Redis` uses ioredis internally
   - What's unclear: Can we share the Redis connection with CacheService?
   - Recommendation: Investigate `RateLimiterStore` interface; may need to create custom store using CacheService.redis

3. **Worker Pool Serialization Constraints**
   - What we know: `SerializedWorkerPool` requires `Schema.TaggedRequest` for type-safe message passing
   - What's unclear: How to design StreamingService API to support future offloading without breaking changes
   - Recommendation: Ensure stream source Effects are serializable (no closures over runtime state)

## Sources

### Primary (HIGH confidence)
- Context7 `/llmstxt/effect_website_llms-full_txt` - Effect.Cache, Stream.buffer, Stream.grouped, PubSub, FiberRef
- Context7 `/redis/ioredis` - Pub/sub patterns, separate connections
- Context7 `/effect-ts/website` - Stream.toReadableStreamEffect, RateLimiter module
- GitHub raw `@effect/experimental/PersistedCache.ts` - L1+L2 architecture, configuration options
- GitHub raw `@effect/experimental/Persistence/Redis.ts` - Redis store API surface
- GitHub raw `@effect/experimental/RateLimiter.ts` - Algorithms, store interface
- GitHub raw `@effect/platform/Worker.ts` - SerializedWorker, WorkerPool options

### Secondary (MEDIUM confidence)
- Existing codebase `packages/server/src/observe/metrics.ts` - MetricsService pattern
- Existing codebase `packages/server/src/utils/circuit.ts` - Utility const+namespace pattern
- Existing codebase `packages/server/src/context.ts` - FiberRef context pattern

### Tertiary (LOW confidence)
- WebSearch Redis pub/sub vs Streams - General patterns (not Effect-specific)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in catalog, verified via Context7
- Architecture: HIGH - Patterns derived from existing codebase (MetricsService, circuit.ts)
- Pitfalls: MEDIUM - Derived from API docs and common Effect patterns; some need validation

**Research date:** 2026-01-27
**Valid until:** 2026-02-27 (30 days - stable APIs)
