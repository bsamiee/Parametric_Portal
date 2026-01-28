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

## Advanced Effect Patterns

Patterns for achieving <225 LOC density in cluster-native services. These assume familiarity with Effect.gen, pipe, and Effect.Service.

### Effect.fn for Traced Functions

`Effect.fn` creates functions with automatic tracing spans. Use instead of raw `Effect.gen` when:
- Function needs observability via OpenTelemetry
- You want automatic span creation with function name
- Stack traces should show definition location (Effect 3.12+)

```typescript
// Dense: traced function with automatic span
const processPayment = Effect.fn("processPayment")(function* (amount: number, tenantId: string) {
  yield* Effect.annotateCurrentSpan("payment.amount", amount);
  yield* Effect.annotateCurrentSpan("tenant.id", tenantId);
  const result = yield* PaymentService.charge(amount);
  return result;
});

// Integrates with existing Telemetry.span pattern
// Use Effect.fn for service methods, Telemetry.span for ad-hoc spans
```

**When to use Effect.fn vs Effect.gen:**
| Scenario | Use |
|----------|-----|
| Service method needing traces | `Effect.fn('methodName')` |
| Internal helper, no tracing needed | `Effect.gen` |
| Compensation handlers in workflows | `Effect.fn` (trace failures) |
| One-off transformations | `Effect.gen` or `pipe` |

### Stream Operators for Dense Pipelines

| Operator | Purpose | Concurrency |
|----------|---------|-------------|
| `Stream.buffer({ capacity: n })` | Decouple producer/consumer speed | N/A |
| `Stream.sliding(n)` | Fixed-size windows, drop oldest | N/A |
| `Stream.throttle({ elements: n, duration })` | Rate limit output | N/A |
| `Stream.debounce(duration)` | Emit after quiet period | N/A |
| `Stream.groupByKey(f)` | Partition by key, process parallel | Per-group |
| `Stream.merge(other)` | Interleave two streams | Unbounded |
| `Stream.mergeAll({ concurrency: n })` | Flatten stream-of-streams | Bounded |

```typescript
// Dense pipeline: rate-limited parallel processing with backpressure
const processEvents = (events: Stream.Stream<Event>) =>
  events.pipe(
    Stream.groupByKey((e) => e.tenantId),                    // Partition by tenant
    Stream.flatMap(([_key, group]) =>                        // Process each tenant
      group.pipe(
        Stream.throttle({ elements: 100, duration: "1 second" }),  // Per-tenant rate limit
        Stream.mapEffect((e) => processEvent(e), { concurrency: 10 }),
      ),
      { concurrency: "unbounded" }                           // All tenants in parallel
    ),
    Stream.buffer({ capacity: 1000 }),                       // Backpressure buffer
  );

// Broadcasting: use SubscriptionRef for multi-consumer reactive state
const broadcast = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make(initialState);
  // Producers update via Ref operations
  yield* SubscriptionRef.set(ref, newState);
  // Consumers subscribe to changes stream
  const changes = SubscriptionRef.changes(ref);
  return { ref, changes };
});
```

### Schedule Composition

Compose retry policies using intersection (both must allow) and union (either allows):

| Combinator | Behavior | Delay Selection |
|------------|----------|-----------------|
| `Schedule.intersect(a, b)` | Continue only if both allow | Longer delay |
| `Schedule.union(a, b)` | Continue if either allows | Shorter delay |
| `Schedule.andThen(a, b)` | Run a fully, then switch to b | Sequential |
| `Schedule.jittered` | Add 80%-120% random variance | Prevents thundering herd |

```typescript
// Production retry policy: exponential + jitter + max attempts + max duration
const retryPolicy = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,                                    // Prevent thundering herd
  Schedule.intersect(Schedule.recurs(5)),               // Max 5 attempts
  Schedule.intersect(Schedule.elapsed.pipe(             // Max 30s total
    Schedule.whileOutput(Duration.lessThanOrEqualTo(Duration.seconds(30)))
  )),
);

// Entity registration with policy (from defectRetryPolicy option)
Sharding.registerEntity(MyEntity, handlers, {
  defectRetryPolicy: retryPolicy,
});
```

### Ref Family: When to Use Which

| Type | Atomicity | Reactivity | Use Case |
|------|-----------|------------|----------|
| `Ref.make` | Single update | None | Simple mutable state, counters |
| `Ref.Synchronized` | Effect-based update | None | Updates requiring effects (e.g., validation) |
| `SubscriptionRef` | Single update | Stream of changes | UI state, multi-observer patterns |
| `PubSub` | N/A | Broadcast | Message fanout, event distribution |

```typescript
// Ref: simple counter (existing circuit.ts pattern)
const counter = yield* Ref.make(0);
yield* Ref.update(counter, (n) => n + 1);

// SubscriptionRef: reactive state with observers
const state = yield* SubscriptionRef.make(initialConfig);
// Producer side
yield* SubscriptionRef.update(state, (cfg) => ({ ...cfg, updated: true }));
// Consumer side - each run gets current + all future changes
const configStream = SubscriptionRef.changes(state);

// PubSub: event broadcast (existing streaming.ts pattern)
const pubsub = yield* PubSub.sliding<Event>(100);
yield* PubSub.publish(pubsub, event);  // Broadcast to all subscribers
```

### FiberRef in Cluster Context

FiberRef has copy-on-fork semantics: child fibers inherit parent values at fork time, updates are fiber-local.

```typescript
// Context propagation in entity handlers
const withEntityContext = <A, E, R>(
  entityType: string,
  entityId: string,
  effect: Effect.Effect<A, E, R>
) => Effect.locallyWith(effect, _ref, (ctx) => ({
  ...ctx,
  cluster: Option.some({
    ...Option.getOrElse(ctx.cluster, () => defaultClusterState),
    entityType: Option.some(entityType),
    entityId: Option.some(entityId),
  })
}));

// FiberRef.locally for scoped updates (does not persist after scope)
const withTemporaryTenant = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>) =>
  FiberRef.locally(_ref, { ..._default, tenantId })(effect);
```

### Layer Composition Patterns

| Function | Behavior | Use Case |
|----------|----------|----------|
| `Layer.memoize` | Explicit singleton, scoped | Cross-test resource sharing |
| `Layer.fresh` | New instance per provision | Per-request services |
| `Layer.scoped` | Resource with lifecycle | DB connections, HTTP clients |
| `Layer.effect` | Dynamic layer from effect | Conditional service construction |

```typescript
// Singleton service (default behavior - layers memoize by reference)
const DbLayer = Layer.scoped(DbService, Effect.gen(function* () {
  const pool = yield* Effect.acquireRelease(
    createPool(),
    (p) => Effect.promise(() => p.end())
  );
  return { pool };
}));

// Fresh per-request (for stateful per-request services)
const RequestLayer = Layer.fresh(Layer.effect(RequestService, Effect.gen(function* () {
  const requestId = crypto.randomUUID();
  return { requestId };
})));

// Test substitution pattern
const TestDbLayer = Layer.succeed(DbService, { pool: mockPool });

// Production composition
const AppLayer = DbLayer.pipe(
  Layer.provideMerge(CacheLayer),
  Layer.provideMerge(TelemetryLayer),
);
```

### Match Patterns

Use `Match.type` for exhaustive union matching, `Match.tag` for discriminated unions with `_tag`:

```typescript
// Match.type: exhaustive on type parameter (existing circuit.ts pattern)
const toCircuitError = (err: unknown): CircuitError => Match.value(err).pipe(
  Match.when(isBrokenCircuitError, (e) => CircuitError.fromBroken(name, e)),
  Match.when(isTaskCancelledError, (e) => CircuitError.fromCancelled(name, e)),
  Match.when(isIsolatedCircuitError, (e) => CircuitError.fromIsolated(name, e)),
  Match.orElse((e) => CircuitError.fromExecution(name, e instanceof Error ? e : new Error(String(e)))),
);

// Match.tag: for _tag discriminated unions (Effect convention)
const handleJobResult = (result: JobResult) => Match.value(result).pipe(
  Match.tag("Success", ({ data }) => Effect.succeed(data)),
  Match.tag("Retry", ({ delay }) => Effect.sleep(delay).pipe(Effect.andThen(retryJob))),
  Match.tag("DeadLetter", ({ reason }) => deadLetterQueue.add(reason)),
  Match.exhaustive,  // Compile error if case missing
);

// Match.tagsExhaustive: shorthand for all-tags-required matching
const statusCode = Match.value(error).pipe(
  Match.tagsExhaustive({
    NotFound: () => 404,
    Unauthorized: () => 401,
    ValidationError: () => 400,
    InternalError: () => 500,
  })
);
```

**When to use Match vs alternatives:**
| Scenario | Use |
|----------|-----|
| 2 cases, simple values | Ternary |
| 3+ discriminated union cases | `Match.tag` + `Match.exhaustive` |
| Type guards / predicates | `Match.when` |
| Simple key-value mapping | Dispatch table (object lookup) |

### Effect.all with Structures

Object form provides named results; concurrency options control parallelism:

```typescript
// Object form: named concurrent effects
const { user, permissions, quota } = yield* Effect.all({
  user: UserService.get(userId),
  permissions: PermissionService.list(userId),
  quota: QuotaService.remaining(tenantId),
}, { concurrency: "unbounded" });

// Tuple form with bounded concurrency
const results = yield* Effect.all(
  tasks.map((t) => processTask(t)),
  { concurrency: 10 }
);

// Discard for side-effects (no result collection)
yield* Effect.all(
  auditEvents.map((e) => AuditService.log(e)),
  { concurrency: "unbounded", discard: true }
);

// Short-circuit vs collect-all
// Default: stops on first error
// mode: "either" - returns Either for each, continues on errors
// mode: "validate" - collects all errors into Cause
```

## Sources

### Primary (HIGH confidence)
- Effect Cluster source: `github.com/Effect-TS/effect/packages/cluster/src/Sharding.ts`
- Effect Cluster source: `github.com/Effect-TS/effect/packages/cluster/src/Entity.ts`
- Effect Cluster source: `github.com/Effect-TS/effect/packages/cluster/src/ClusterMetrics.ts`
- Effect experimental RateLimiter: `github.com/Effect-TS/effect/packages/experimental/src/RateLimiter`
- Effect workflow DurableRateLimiter: `github.com/Effect-TS/effect/packages/workflow/src/DurableRateLimiter.ts`
- [Schedule Combinators](https://effect.website/docs/scheduling/schedule-combinators/) - Official Effect docs
- [SubscriptionRef](https://effect.website/docs/state-management/subscriptionref/) - Official Effect docs
- [Stream Operations](https://effect.website/docs/stream/operations/) - Official Effect docs
- [Pattern Matching](https://effect.website/docs/code-style/pattern-matching/) - Official Effect docs
- [Layer Memoization](https://effect.website/docs/requirements-management/layer-memoization/) - Official Effect docs
- [Basic Concurrency](https://effect.website/docs/concurrency/basic-concurrency/) - Official Effect docs

### Secondary (MEDIUM confidence)
- [DeepWiki Cluster Documentation](https://deepwiki.com/Effect-TS/effect/5.2-cluster-management)
- [Effect Cluster ETL Tutorial](https://mufraggi.eu/articles/effect-cluster-etl)
- [Effect RateLimiter Docs](https://effect-ts.github.io/effect/effect/RateLimiter.ts.html)
- [DeepWiki Stream Processing](https://deepwiki.com/Effect-TS/effect/2.2-stream-processing) - Stream architecture
- [DeepWiki Scheduling](https://deepwiki.com/Effect-TS/effect/3.2-scheduling) - Schedule composition

### Codebase (HIGH confidence)
- `/packages/server/src/context.ts` - Context.Request.Data interface, FiberRef patterns
- `/packages/server/src/middleware.ts` - Request context population
- `/packages/server/src/platform/cache.ts` - Redis rate limiting, PersistedCache
- `/packages/server/src/platform/streaming.ts` - In-memory PubSub channels
- `/packages/server/src/infra/jobs.ts` - DB-backed job queue
- `/packages/server/src/observe/metrics.ts` - MetricsService, Match patterns
- `/packages/server/src/observe/telemetry.ts` - OTLP export
- `/packages/server/src/utils/circuit.ts` - Circuit breaker, Match.value patterns

## Metadata

**Confidence breakdown:**
- Context.Request extension: HIGH (direct FiberRef pattern, well-understood)
- Rate limiting decision: HIGH (existing code correct, clear separation of concerns)
- Jobs migration: MEDIUM (Entity pattern clear, migration details need validation)
- Metrics integration: MEDIUM (ClusterMetrics API verified, composition pattern inferred)
- PubSub decision: HIGH (architecture analysis sound, separation of concerns clear)
- Advanced Effect patterns: HIGH (verified against official docs and codebase patterns)

**Research date:** 2026-01-28
**Valid until:** 2026-02-28 (30 days - stable APIs, active development)
