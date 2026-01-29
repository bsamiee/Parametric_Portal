# Phase 1: Cluster Foundation - Research

**Researched:** 2026-01-28
**Domain:** @effect/cluster Entity sharding, distributed coordination, SQL-backed persistence
**Confidence:** HIGH

## Summary

Phase 1 establishes multi-pod coordination via @effect/cluster. The architecture replaces DB-locked job queues with consistent-hash entity routing, advisory-lock shard ownership, and at-least-once message delivery. Since v0.51.0, no central ShardManager is required - RunnerStorage handles shard coordination via PostgreSQL advisory locks.

The codebase already has solid foundations: FiberRef-based Context.Request, Data.TaggedError patterns in circuit.ts, and Match.type exhaustive handling. ClusterService will follow the established `const + namespace` merge pattern, exposing send/broadcast/singleton operations under a single import.

**Primary recommendation:** Use Entity.make with polymorphic message types routed via Match.type, SqlMessageStorage + SqlRunnerStorage with dedicated DB connection for runner storage, and NodeClusterSocket.layer for pod communication. Follow existing error patterns from circuit.ts for ClusterError handling.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@effect/cluster` | 0.56.1 | Entity sharding, distributed messaging | Official Effect cluster package |
| `@effect/sql-pg` | 0.50.1 | PostgreSQL client for storage backends | Already in catalog, SqlRunnerStorage requires stable connections |
| `effect` | 3.19.15 | Core runtime, Schedule, Match, Schema | Foundation for all Effect code |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@effect/rpc` | 0.73.0 | RPC protocol for Entity messages | Already used for typed request/response |
| `@effect/workflow` | 0.16.0 | Durable workflows (Phase 5+) | Not needed in Phase 1 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SqlRunnerStorage advisory locks | Redis SETNX | PostgreSQL already primary store, advisory locks have automatic failover |
| Entity message routing | Redis pub/sub | Entity routing is typed, persistent, traced - Redis is fire-and-forget |
| Snowflake IDs | UUID v4 | Snowflake is sortable, machine-aware, cluster-native |

**Installation:**
All packages already in pnpm-workspace.yaml catalog. No new dependencies required.

## Architecture Patterns

### Recommended Project Structure
```
packages/server/src/infra/
├── cluster.ts           # ClusterService (const + namespace merge, <225 LOC)
└── jobs.ts              # Gutted and replaced with Entity-based dispatch
```

### Pattern 1: Entity with Polymorphic Messages
**What:** Single entity type with union message types, routed via Match.type
**When to use:** Multiple related operations on same entity identity
**Example:**
```typescript
// Source: CONTEXT.md decision + @effect/cluster docs
const ClusterEntity = Entity.make("Cluster", [
  Rpc.make("process", { payload: ProcessPayload, success: Schema.Void, error: ClusterProcessError }),
  Rpc.make("status", { payload: Schema.Void, success: StatusResponse }),
])

const ClusterEntityLive = ClusterEntity.toLayer(Effect.gen(function*() {
  let state: EntityState = { status: "idle" }
  return {
    process: ({ data }) => Effect.gen(function*() {
      // Handler logic with Match.type for variants
    }),
    status: () => Effect.succeed(state),
  }
}), {
  maxIdleTime: Duration.minutes(5),
  concurrency: 1,
  mailboxCapacity: 100,
  defectRetryPolicy: Schedule.exponential("100 millis").pipe(
    Schedule.jittered,
    Schedule.intersect(Schedule.recurs(5))
  ),
})
```

### Pattern 2: ClusterService Facade (const + namespace merge)
**What:** Single facade merging all cluster ops under one import
**When to use:** Consumer-facing API surface
**Example:**
```typescript
// Source: CONTEXT.md decision + circuit.ts pattern
// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const ClusterService = {
  send: <R>(entityId: string, request: R) => /* Sharding.send */,
  broadcast: (entityType: string, request: R) => /* Sharding.broadcast */,
  singleton: (name: string, effect: Effect.Effect<void>) => /* Singleton.make */,
  isLocal: (entityId: string) => /* Sharding.isEntityOnLocalRunner */,
} as const

namespace ClusterService {
  export type Error = ClusterError
  export type Config = ShardingConfig
}

export { ClusterService }
```

### Pattern 3: ClusterError Type Guards (no instanceof)
**What:** Use static `.is()` methods for error discrimination
**When to use:** All ClusterError handling
**Example:**
```typescript
// Source: circuit.ts pattern + ClusterError.ts docs
const handleClusterError = (error: ClusterError) => Match.value(error).pipe(
  Match.when(ClusterError.MailboxFull.is, () => /* back-pressure */),
  Match.when(ClusterError.RunnerUnavailable.is, () => /* failover */),
  Match.when(ClusterError.PersistenceError.is, () => /* retry */),
  Match.orElse(() => /* log and fail */),
)
```

### Pattern 4: Snowflake IDs for Entity Routing
**What:** Opaque Snowflake IDs for entity routing, context carries metadata separately
**When to use:** All entity identification
**Example:**
```typescript
// Source: CONTEXT.md decision + Snowflake.ts docs
const EntityId = Schema.brand("EntityId")(Snowflake.SnowflakeFromString)
type EntityId = typeof EntityId.Type

// Sharding routes by Snowflake; context carries tenant/domain separately
const sendToEntity = (id: EntityId, payload: ProcessPayload) =>
  client(Snowflake.toString(id)).process(payload).pipe(
    Context.Request.within(tenantId, /* effect */),
  )
```

### Anti-Patterns to Avoid
- **`instanceof` checks for ClusterError:** Use static `.is()` type guards - ClusterError.MailboxFull.is(error)
- **Separate entity types per operation:** Use polymorphic messages with Match.type routing
- **`if/else` chains for error handling:** Use Match.type for exhaustive variant handling
- **`async/await` mixing:** Use Effect.promise for interop, never raw async in Effect code
- **Loose string entity IDs:** Use branded Snowflake types for entity identification

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Distributed locks | Redis SETNX / DB FOR UPDATE | Shard ownership via SqlRunnerStorage | Advisory locks + automatic failover |
| Leader election | Custom Raft/consensus | Singleton.make | Automatic via shard assignment |
| Job queues | DB polling + SELECT FOR UPDATE | Entity message handlers | Sharding distributes load |
| Cross-pod messaging | Redis pub/sub DIY | Sharding.send / broadcast | Typed, persistent, traced |
| Unique IDs | UUID v4 | Snowflake.Generator | Sortable, machine-aware |
| Message deduplication | Manual Redis-based | SqlMessageStorage.saveRequest | Returns Success/Duplicate |
| Shard coordination | Custom consistent hashing | SqlRunnerStorage.acquire | Automatic via advisory locks |

**Key insight:** The cluster package provides all coordination primitives. Hand-rolling any of these creates subtle bugs around failover, redelivery, and distributed state that the official implementation handles correctly.

## Common Pitfalls

### Pitfall 1: Unstable DB Connections Break Shard Locks
**What goes wrong:** Advisory locks require persistent connections. Connection pooling with aggressive recycling causes lock loss, leading to shard reassignment storms.
**Why it happens:** PgBouncer or aggressive pool settings recycle connections, releasing advisory locks unexpectedly.
**How to avoid:** Dedicate a separate connection for RunnerStorage - do not share the application's connection pool. Use `PgClient.layer` with separate config.
**Warning signs:** Frequent shard rebalancing, "RunnerNotRegistered" errors, entities migrating between pods unexpectedly.

### Pitfall 2: Entity Mailbox Overflow (OOM)
**What goes wrong:** Default unbounded mailbox can exhaust memory under load.
**Why it happens:** toLayer options default to `mailboxCapacity: "unbounded"`.
**How to avoid:** Set explicit `mailboxCapacity: 100` (or tuned value) in toLayer options. Handle `MailboxFull` errors at sender with back-pressure.
**Warning signs:** Increasing memory usage, slow entity responses, eventual pod crashes.

### Pitfall 3: Missing preemptiveShutdown in K8s
**What goes wrong:** Entities terminate abruptly during pod shutdown, losing in-flight messages.
**Why it happens:** K8s sends SIGTERM, pod shuts down before entities complete work.
**How to avoid:** Enable `preemptiveShutdown: true` in ShardingConfig for K8s deployments. Combine with terminationGracePeriodSeconds in K8s manifest.
**Warning signs:** Message loss during deployments, incomplete transactions after rollouts.

### Pitfall 4: Forgetting Idempotency
**What goes wrong:** Duplicate side effects from redelivered messages.
**Why it happens:** At-least-once delivery means messages may arrive multiple times after failures.
**How to avoid:** Use `SqlMessageStorage.saveRequest` deduplication - returns `Duplicate` for seen requests. Design handlers to be naturally idempotent or check dedup status.
**Warning signs:** Duplicate records, double-processing, inconsistent state across pods.

### Pitfall 5: ClusterError instanceof Checks
**What goes wrong:** Type narrowing fails, error handling becomes unreliable.
**Why it happens:** Effect errors use branded types with symbols, not class inheritance.
**How to avoid:** Use static `.is()` type guards: `ClusterError.MailboxFull.is(error)`. Use Match.type for exhaustive handling.
**Warning signs:** Compile errors about type narrowing, runtime errors from incorrect error handling.

### Pitfall 6: Mixing async/await with Effect
**What goes wrong:** Runtime errors, lost context, fiber interruption issues.
**Why it happens:** Effect uses fibers, not promises - mixing breaks the execution model.
**How to avoid:** Use `Effect.promise` for external async interop. Never use `await` inside Effect.gen.
**Warning signs:** "Effect is not a Promise" errors, lost trace context, interrupted fibers.

## Code Examples

Verified patterns from official sources and codebase conventions:

### Complete Entity Setup (Dense Style)
```typescript
// Source: @effect/cluster docs + CLAUDE.md constraints
import { Entity, Rpc, Sharding, SqlMessageStorage, SqlRunnerStorage, NodeClusterSocket, ClusterError } from "@effect/cluster"
import { PgClient } from "@effect/sql-pg"
import { Duration, Effect, Layer, Match, Schema as S } from "effect"

// --- [SCHEMA] ----------------------------------------------------------------

const ProcessPayload = S.Struct({ entityId: Snowflake.SnowflakeFromString, data: S.String })
const StatusResponse = S.Struct({ status: S.Literal("idle", "processing", "complete") })

// --- [ERRORS] ----------------------------------------------------------------

class EntityProcessError extends S.TaggedError<EntityProcessError>()("EntityProcessError", {
  message: S.String,
  cause: S.optional(S.Unknown),
}) {}

// --- [ENTITY] ----------------------------------------------------------------

const ClusterEntity = Entity.make("Cluster", [
  Rpc.make("process", { payload: ProcessPayload, success: S.Void, error: EntityProcessError }),
  Rpc.make("status", { payload: S.Void, success: StatusResponse }),
])

const ClusterEntityLive = ClusterEntity.toLayer(Effect.gen(function*() {
  const db = yield* SqlClient.SqlClient
  let state: typeof StatusResponse.Type = { status: "idle" }
  return {
    process: ({ data }) => Effect.gen(function*() {
      state = { status: "processing" }
      yield* db.execute(sql`INSERT INTO processed ...`)
      state = { status: "complete" }
    }).pipe(Effect.catchTag("SqlError", (e) => new EntityProcessError({ message: e.message, cause: e }))),
    status: () => Effect.succeed(state),
  }
}), {
  maxIdleTime: Duration.minutes(5),
  concurrency: 1,
  mailboxCapacity: 100,
  defectRetryPolicy: Schedule.exponential("100 millis").pipe(
    Schedule.jittered,
    Schedule.intersect(Schedule.recurs(5)),
  ),
})
```

### Cluster Layer Composition
```typescript
// Source: Effect 3.19 release notes + CLUSTER.md research
const ClusterLive = Layer.mergeAll(
  NodeClusterSocket.layer({ storage: "sql" }),
  ClusterEntityLive,
).pipe(
  Layer.provide(SqlMessageStorage.layer),
  Layer.provide(SqlRunnerStorage.layer),
  Layer.provide(PgClient.layer(runnerStorageConfig)), // Dedicated connection!
  Layer.provide(ShardingConfig.layer({
    shardsPerGroup: 100,
    preemptiveShutdown: true, // K8s graceful shutdown
  })),
)
```

### ClusterError Handling with Match.type
```typescript
// Source: circuit.ts pattern + ClusterError docs
const withClusterErrorHandling = <A, E, R>(
  effect: Effect.Effect<A, E | ClusterError, R>
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.catchTags({
      MailboxFull: (e) => Effect.gen(function*() {
        yield* MetricsService.inc(metrics.cluster.errors, MetricsService.label({ type: "MailboxFull" }), 1)
        yield* Effect.sleep(Duration.millis(100))
        return yield* Effect.fail(e) // Let caller retry
      }),
      RunnerUnavailable: (e) => Effect.gen(function*() {
        yield* MetricsService.inc(metrics.cluster.errors, MetricsService.label({ type: "RunnerUnavailable" }), 1)
        yield* Effect.logWarning("Runner unavailable, will failover", { entityId: e.entityId })
        return yield* Effect.fail(e)
      }),
      PersistenceError: (e) => Effect.gen(function*() {
        yield* MetricsService.inc(metrics.cluster.errors, MetricsService.label({ type: "PersistenceError" }), 1)
        yield* Effect.logError("Persistence error", { cause: e.cause })
        return yield* Effect.fail(e)
      }),
    }),
  )
```

### Metrics Integration Pattern
```typescript
// Source: metrics.ts pattern + INTEGRATION.md research
// Add to MetricsService in observe/metrics.ts
cluster: {
  entities: Metric.gauge("cluster_entities"),
  singletons: Metric.gauge("cluster_singletons"),
  runners: Metric.gauge("cluster_runners"),
  runnersHealthy: Metric.gauge("cluster_runners_healthy"),
  shards: Metric.gauge("cluster_shards"),
  messageLatency: Metric.timerWithBoundaries("cluster_message_latency_seconds", _boundaries.rateLimit),
  redeliveries: Metric.counter("cluster_redeliveries_total"),
  errors: Metric.counter("cluster_errors_total"), // With type label
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Central ShardManager | RunnerStorage advisory locks | Effect 3.19 (v0.51.0) | No separate deployment needed |
| NodeClusterSocketRunner in platform-node | NodeClusterSocket in @effect/cluster | Effect 3.19 | Unified import path |
| EntityNotManagedByRunner error | Removed | Effect 3.19 | Simplifies error taxonomy |
| SELECT FOR UPDATE SKIP LOCKED | Entity mailbox dispatch | Cluster adoption | Eliminates poll loops |

**Deprecated/outdated:**
- `@effect/platform-node/NodeClusterSocketRunner`: Moved to `@effect/cluster/NodeClusterSocket`
- ShardManager deployment: Removed - RunnerStorage handles coordination
- Manual shard rebalancing: Automatic via advisory lock expiry

## Open Questions

Things that couldn't be fully resolved:

1. **Dedicated RunnerStorage connection configuration**
   - What we know: Advisory locks require stable connections, cannot share with application pool
   - What's unclear: Exact PgClient configuration to ensure connection stability
   - Recommendation: Create separate PgClient.layer with `max: 1` pool size for RunnerStorage

2. **ShardingConfig.preemptiveShutdown behavior**
   - What we know: Documented as "Start shutdown before shard release"
   - What's unclear: Exact timing and coordination with K8s terminationGracePeriodSeconds
   - Recommendation: Set preemptiveShutdown: true, configure K8s grace period >= entityTerminationTimeout

3. **ClusterMetrics integration with existing MetricsService**
   - What we know: ClusterMetrics provides gauges for entities, runners, shards
   - What's unclear: Whether to use ClusterMetrics.layer or poll manually
   - Recommendation: Add cluster namespace to MetricsService, poll ClusterMetrics values on schedule

## Sources

### Primary (HIGH confidence)
- [Entity.ts documentation](https://effect-ts.github.io/effect/cluster/Entity.ts.html) - toLayer options, mailboxCapacity, defectRetryPolicy
- [ClusterError.ts documentation](https://effect-ts.github.io/effect/cluster/ClusterError.ts.html) - Error types and `.is()` type guards
- [ShardingConfig.ts documentation](https://effect-ts.github.io/effect/cluster/ShardingConfig.ts.html) - preemptiveShutdown, shardsPerGroup
- [SqlRunnerStorage.ts documentation](https://effect-ts.github.io/effect/cluster/SqlRunnerStorage.ts.html) - Layer configuration, prefix options
- [SqlMessageStorage.ts documentation](https://effect-ts.github.io/effect/cluster/SqlMessageStorage.ts.html) - saveRequest deduplication
- [Snowflake.ts documentation](https://effect-ts.github.io/effect/cluster/Snowflake.ts.html) - Generator service, ID structure
- [Effect 3.19 Release Notes](https://effect.website/blog/releases/effect/319/) - Breaking changes, RunnerStorage migration

### Secondary (MEDIUM confidence)
- [DeepWiki Cluster Management](https://deepwiki.com/Effect-TS/effect/5.2-cluster-management) - ShardingConfig options, advisory locks
- [Effect Cluster ETL Tutorial](https://mufraggi.eu/articles/effect-cluster-etl) - Real-world usage patterns

### Codebase (HIGH confidence)
- `/packages/server/src/context.ts` - Context.Request.Data interface, FiberRef patterns
- `/packages/server/src/utils/circuit.ts` - Data.TaggedError pattern, Match.value usage
- `/packages/server/src/observe/metrics.ts` - MetricsService.label pattern, counter/gauge conventions
- `/packages/server/src/observe/telemetry.ts` - Span patterns, error attributes
- `/packages/server/src/middleware.ts` - const + namespace merge pattern
- `/packages/server/src/infra/jobs.ts` - Current job queue (to be replaced)
- `.planning/research/CLUSTER.md` - Prior research on cluster APIs
- `.planning/research/INTEGRATION.md` - Context extension, jobs migration strategy

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages in catalog, versions verified
- Architecture patterns: HIGH - Verified against official docs and codebase conventions
- Pitfalls: HIGH - Documented in official release notes and DeepWiki
- Code examples: MEDIUM - Synthesized from docs + codebase patterns, needs validation

**Research date:** 2026-01-28
**Valid until:** 2026-02-28 (30 days - stable package, active development)
