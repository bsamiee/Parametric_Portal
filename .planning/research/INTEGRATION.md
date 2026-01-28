# Integration Research: Cluster-Native Infrastructure

**Researched:** 2026-01-28
**Confidence:** MEDIUM (official docs verified, some APIs inferred from source)

## Executive Summary

Integration strategy: **Extend context.ts, gut jobs.ts/streaming.ts channels, preserve cache.ts rate limiting**.

The codebase has solid foundations: FiberRef-based Context.Request, Redis-backed caching with `@effect/experimental` RateLimiter, and well-structured telemetry. Cluster integration requires extending these patterns rather than replacing them. The DB-backed JobService must be gutted entirely since Entity-based message dispatch is fundamentally different from poll-based claiming. In-memory PubSub channels in streaming.ts serve SSE delivery (not cross-pod coordination) and should remain for that purpose, with cluster messaging handled separately via Sharding.

**Primary recommendation:** Add cluster state to Context.Request.Data, replace JobService with Entity-based dispatch, preserve cache.ts rate limiting for API boundaries, use DurableRateLimiter only within workflow contexts.

## Context.Request Extension

### Current State
```typescript
interface Data {
  readonly circuit: Option.Option<Circuit>;
  readonly ipAddress: Option.Option<string>;
  readonly rateLimit: Option.Option<RateLimit>;
  readonly requestId: string;
  readonly session: Option.Option<Session>;
  readonly tenantId: string;
  readonly userAgent: Option.Option<string>;
}
```

### Recommended Extension
```typescript
interface ClusterState {
  readonly shardId: Option.Option<string>;     // Current shard handling request
  readonly runnerId: Option.Option<string>;    // Runner processing this
  readonly isLeader: boolean;                  // Singleton leadership
  readonly entityType: Option.Option<string>;  // If within entity context
  readonly entityId: Option.Option<string>;    // Specific entity instance
}

interface Data {
  // ... existing fields
  readonly cluster: Option.Option<ClusterState>;
}
```

### Population Pattern
```typescript
// Within entity handler, extract from Sharding service
const populateCluster = Sharding.pipe(
  Effect.flatMap((sharding) => Effect.all({
    shardId: sharding.getShardId(entityId, group).pipe(Effect.map(Option.some), Effect.orElseSucceed(() => Option.none())),
    // runnerId from environment or Sharding.getSnowflake
    // isLeader from singleton registration context
  })),
  Effect.flatMap((cluster) => Context.Request.update({ cluster: Option.some(cluster) }))
);
```

### Scope Decision
Cluster context should be **per-fiber**, not per-request. Entity handlers run in dedicated fibers, and cluster state changes during entity lifecycle. Use FiberRef (already in place) with local updates when entering entity context.

## Rate Limiting Decision

### Analysis of Three Options

| Implementation | Location | Distributed | Durable | Use Case |
|----------------|----------|-------------|---------|----------|
| cache.ts | `@effect/experimental/RateLimiter/Redis` | YES | NO | API boundaries, HTTP middleware |
| DurableRateLimiter | `@effect/workflow` | NO* | YES | Workflow activities, long-running ops |
| Standard effect RateLimiter | `effect` core | NO | NO | In-process throttling |

*DurableRateLimiter uses Activity persistence, not Redis distribution

### Recommendation: Keep cache.ts for API Rate Limiting

**Rationale:**
1. cache.ts already uses `@effect/experimental/RateLimiter/Redis` with proper Lua atomics
2. DurableRateLimiter is for *workflow* contexts where delays become durable sleeps
3. Multi-tenant API rate limiting needs Redis distribution (multiple pods share state)
4. Existing preset system (`api`, `auth`, `mfa`, `mutation`) maps to tenant+IP keys

**Do NOT Replace:** The cache.ts implementation is correct for its purpose. DurableRateLimiter solves a different problem (workflow compensation) not API throttling.

### Integration Pattern
```typescript
// API routes: continue using cache.ts
CacheService.rateLimit('api', handler)

// Workflows: use DurableRateLimiter within Activity
Activity.make({
  name: "CallExternalApi",
  execute: DurableRateLimiter.rateLimit({
    name: "external-api",
    key: tenantId,
    limit: 10,
    window: "1 minutes"
  }).pipe(Effect.andThen(callApi))
})
```

## PubSub/Channels Migration

### Current streaming.ts Architecture
- In-memory `PubSub.sliding<A>` with tenant-scoped keys
- Global `_channels` Map for reference counting
- SSE delivery via `Stream.merge` with heartbeat
- No cross-pod coordination

### Assessment: Streaming Channels Are Fine

The current `StreamingService.channel` serves **SSE delivery within a single pod**. This is correct architecture. Clients connect to a pod and receive events from that pod's memory.

**What cluster adds:** If a mutation happens on Pod A but the SSE client is connected to Pod B, the event won't reach them. This is a *separate problem* from channel management.

### Cross-Pod Event Propagation Pattern
```typescript
// Option 1: Entity-based event routing (recommended)
const NotificationEntity = Entity.make("Notification", [
  Rpc.make("broadcast", { payload: EventSchema, success: Schema.Void })
]);

// Mutation handler publishes to entity
await Sharding.send(NotificationEntity, tenantId, { event });

// Entity handler pushes to local SSE channels
Sharding.registerEntity(NotificationEntity, Effect.gen(function*() {
  const channel = yield* StreamingService.channel("events");
  return { broadcast: (event) => channel.publish(event) };
}));
```

**Decision:** Keep streaming.ts for SSE delivery, add Entity-based routing for cross-pod events.

## Jobs Migration

### Current jobs.ts Architecture
```
SELECT FOR UPDATE SKIP LOCKED --> claim batch --> process --> transition
```

This is poll-based with DB as queue. Fundamentally incompatible with Entity model.

### Entity-Based Replacement

**Core Concept:** Jobs become Entity messages, not DB rows.

```typescript
// Define job entity with RPC protocol
const JobEntity = Entity.make("Job", [
  Rpc.make("execute", {
    payload: { type: Schema.String, data: Schema.Unknown },
    success: Schema.Void,
    error: JobError
  })
]);

// Register with handler map (replaces registerHandler)
Sharding.registerEntity(JobEntity, Effect.gen(function*() {
  const handlers = yield* Ref.make(HashMap.empty<string, Handler>());
  return {
    execute: ({ type, data }) => Ref.get(handlers).pipe(
      Effect.flatMap((m) => HashMap.get(m, type)),
      Effect.flatMap((handler) => handler(data))
    )
  };
}));

// Enqueue becomes message send (replaces db.jobs.put)
const enqueue = (type: string, payload: unknown) =>
  Sharding.sendOutgoing({
    entity: JobEntity,
    entityId: crypto.randomUUID(),
    payload: { type, data: payload }
  }, false); // discard=false for durability
```

### Migration Path
1. Keep JobService interface for consumers
2. Replace internals with Entity dispatch
3. MessageStorage replaces DB queue (built into cluster)
4. Remove poll loop, SELECT FOR UPDATE, semaphore

### What Changes
| Current | Entity-Based |
|---------|--------------|
| Poll every 1-10s | Message push |
| SELECT FOR UPDATE SKIP LOCKED | Shard assignment |
| Semaphore concurrency | Entity mailbox capacity |
| Circuit breaker wrapper | Built-in defect retry policy |
| DB-backed queue | MessageStorage (SQL) |

## Metrics Integration

### ClusterMetrics (from @effect/cluster)
```typescript
entities: Metric.gauge("effect_cluster_entities", { bigint: true })
singletons: Metric.gauge("effect_cluster_singletons", { bigint: true })
runners: Metric.gauge("effect_cluster_runners", { bigint: true })
runnersHealthy: Metric.gauge("effect_cluster_runners_healthy", { bigint: true })
shards: Metric.gauge("effect_cluster_shards", { bigint: true })
```

### Integration with Existing MetricsService

**Approach:** Merge cluster metrics into MetricsService namespace.

```typescript
// In metrics.ts, add cluster section
cluster: {
  entities: Metric.gauge('cluster_entities'),
  singletons: Metric.gauge('cluster_singletons'),
  runners: Metric.gauge('cluster_runners'),
  runnersHealthy: Metric.gauge('cluster_runners_healthy'),
  shards: Metric.gauge('cluster_shards'),
  messageLatency: Metric.timerWithBoundaries('cluster_message_latency_seconds', _boundaries.rateLimit),
  redeliveries: Metric.counter('cluster_redeliveries_total'),
}
```

**Layer Composition:**
```typescript
const MetricsLayer = MetricsService.Default.pipe(
  Layer.provideMerge(ClusterMetrics.layer) // if cluster provides layer
);
```

## Telemetry Integration

### Cross-Pod Trace Propagation

Cluster uses RPC under the hood. Effect RPC propagates trace context automatically via headers. No manual work needed.

### Workflow Execution Tracing

Workflows create spans for each Activity. The existing `Telemetry.span` pattern applies.

```typescript
Activity.make({
  name: "ProcessPayment",
  execute: Effect.gen(function*() {
    // Activity creates span automatically
    // Add custom attributes via existing pattern
    yield* Effect.annotateCurrentSpan("payment.amount", amount);
  })
});
```

### Additional Spans
- Entity activation/deactivation
- Shard rebalancing
- Message persistence/acknowledgment

These are handled by cluster internals. Telemetry.Default layer already provides OTLP export.

## File-by-File Recommendations

| File | Recommendation | Rationale |
|------|----------------|-----------|
| context.ts | **EXTEND** | Add `cluster: Option.Option<ClusterState>` to Data interface |
| middleware.ts | **EXTEND** | Add cluster context population in makeRequestContext |
| cache.ts | **KEEP** | Rate limiting is correct for API boundaries; Redis store already used |
| streaming.ts | **KEEP** | SSE delivery stays in-memory; add Entity routing for cross-pod |
| jobs.ts | **GUT+REPLACE** | Entity dispatch replaces poll-based queue; same file path |
| telemetry.ts | **KEEP** | OTLP export sufficient; cluster adds automatic span propagation |
| metrics.ts | **EXTEND** | Add cluster metrics namespace alongside existing metrics |
| circuit.ts | **KEEP** | Cockatiel-based breaker still useful for non-cluster external calls |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Distributed rate limiting | Custom Redis Lua scripts | `@effect/experimental/RateLimiter/Redis` (already in cache.ts) |
| Message persistence | DB-backed queue with polling | `MessageStorage` from @effect/cluster |
| Shard assignment | Custom consistent hashing | `Sharding.getShardId` |
| Cross-pod messaging | Redis pub/sub bridge | Entity routing via Sharding |
| Workflow compensation | Manual saga orchestration | `Workflow.withCompensation` |
| Durable delays | setTimeout with DB persistence | `DurableClock.sleep` |
| Unique ID generation | UUID v4 | `Sharding.getSnowflake` (cluster-aware) |
| Entity lifecycle | Manual activation/deactivation | `Sharding.registerEntity` |

## Code Patterns

### Entity Definition
```typescript
import { Entity, Rpc } from "@effect/cluster";
import { Schema as S } from "effect";

const UserEntity = Entity.make("User", [
  Rpc.make("getProfile", { payload: { id: S.String }, success: UserProfile, error: NotFound }),
  Rpc.make("updateProfile", { payload: UpdatePayload, success: S.Void, error: ValidationError })
]);
```

### Entity Registration with Options
```typescript
Sharding.registerEntity(UserEntity, handlers, {
  maxIdleTime: "5 minutes",
  concurrency: 10,
  mailboxCapacity: 100,
  defectRetryPolicy: Schedule.exponential("100 millis").pipe(Schedule.intersect(Schedule.recurs(3)))
});
```

### Workflow with Compensation
```typescript
const TransferWorkflow = Workflow.make({
  name: "Transfer",
  payload: { from: S.String, to: S.String, amount: S.Number },
  success: S.Void,
  error: TransferError,
  idempotencyKey: ({ from, to, amount }) => `${from}-${to}-${amount}`
});

const execute = TransferWorkflow.execute.pipe(
  Workflow.withCompensation(Effect.fn(function*(value, cause) {
    yield* reverseDebit(value.from, value.amount);
    yield* AuditService.log("transfer_compensated", { cause: Cause.pretty(cause) });
  }))
);
```

### Cluster Context Access
```typescript
const withClusterContext = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    const sharding = yield* Sharding;
    const shardId = yield* sharding.getShardId(entityId, group);
    const runnerId = yield* sharding.getSnowflake.pipe(Effect.map((s) => s.toString()));
    yield* Context.Request.update({
      cluster: Option.some({ shardId: Option.some(shardId), runnerId: Option.some(runnerId), isLeader: false, entityType: Option.none(), entityId: Option.none() })
    });
    return yield* effect;
  });
```

## Open Questions

1. **Shard count configuration:** Default is 300. Should this be configurable per entity type?
   - Recommendation: Start with default, tune based on entity cardinality

2. **Message acknowledgment strategy:** Cluster supports at-least-once. For exactly-once, use idempotency keys.
   - Recommendation: Add idempotency key to job payload schema

3. **Singleton leader election:** How to detect leadership for cron jobs?
   - Cluster provides `registerSingleton` which handles this

4. **Storage backend:** SqlMessageStorage vs custom. Currently using Postgres.
   - Recommendation: Use `SqlMessageStorage` from @effect/cluster with existing PgClient

## Sources

### Primary (HIGH confidence)
- Effect Cluster source: `github.com/Effect-TS/effect/packages/cluster/src/Sharding.ts`
- Effect Cluster source: `github.com/Effect-TS/effect/packages/cluster/src/Entity.ts`
- Effect Cluster source: `github.com/Effect-TS/effect/packages/cluster/src/ClusterMetrics.ts`
- Effect experimental RateLimiter: `github.com/Effect-TS/effect/packages/experimental/src/RateLimiter`
- Effect workflow DurableRateLimiter: `github.com/Effect-TS/effect/packages/workflow/src/DurableRateLimiter.ts`

### Secondary (MEDIUM confidence)
- [DeepWiki Cluster Documentation](https://deepwiki.com/Effect-TS/effect/5.2-cluster-management)
- [Effect Cluster ETL Tutorial](https://mufraggi.eu/articles/effect-cluster-etl)
- [Effect RateLimiter Docs](https://effect-ts.github.io/effect/effect/RateLimiter.ts.html)

### Codebase (HIGH confidence)
- `/packages/server/src/context.ts` - Context.Request.Data interface
- `/packages/server/src/middleware.ts` - Request context population
- `/packages/server/src/platform/cache.ts` - Redis rate limiting, PersistedCache
- `/packages/server/src/platform/streaming.ts` - In-memory PubSub channels
- `/packages/server/src/infra/jobs.ts` - DB-backed job queue
- `/packages/server/src/observe/metrics.ts` - MetricsService
- `/packages/server/src/observe/telemetry.ts` - OTLP export

## Metadata

**Confidence breakdown:**
- Context.Request extension: HIGH (direct FiberRef pattern, well-understood)
- Rate limiting decision: HIGH (existing code correct, clear separation of concerns)
- Jobs migration: MEDIUM (Entity pattern clear, migration details need validation)
- Metrics integration: MEDIUM (ClusterMetrics API verified, composition pattern inferred)
- PubSub decision: HIGH (architecture analysis sound, separation of concerns clear)

**Research date:** 2026-01-28
**Valid until:** 2026-02-28 (30 days - stable APIs, active development)
