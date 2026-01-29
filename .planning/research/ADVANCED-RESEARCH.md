# Phase 1: Cluster Foundation - Research

**Researched:** 2026-01-28
**Domain:** @effect/cluster Entity sharding, distributed coordination, SQL-backed persistence
**Confidence:** HIGH

> **Note:** This research file is comprehensive and contains patterns used beyond Phase 1.
> Patterns 1-4, 6 are Phase 1 specific. Patterns 5, 7-17 document APIs for later phases.
> For domain-specific research, see also: `.planning/research/` (CLUSTER.md, WORKFLOW.md, RPC.md, etc.)

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
| `@effect/platform` | 0.94.2 | HttpTraceContext, KeyValueStore, MsgPack, Socket | Cross-cutting platform primitives |
| `@effect/workflow` | 0.16.0 | Durable workflows (Phase 5+) | Not needed in Phase 1 |
| `@effect/experimental` | 0.58.0 | Machine, VariantSchema, Persistence | Complex state machines (Phase 6), polymorphic schemas |

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
  const stateRef = yield* Ref.make<EntityState>({ status: "idle" })
  return {
    process: ({ data }) => Effect.gen(function*() {
      yield* Ref.set(stateRef, { status: "processing" })
      // Handler logic with Match.type for variants
      yield* Ref.set(stateRef, { status: "complete" })
    }),
    status: () => Ref.get(stateRef),
  }
}), {
  maxIdleTime: Duration.minutes(5),
  concurrency: 1,
  mailboxCapacity: 100,
  defectRetryPolicy: Schedule.exponential(Duration.millis(100)).pipe(
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

### Pattern 3: ClusterError Discrimination (no instanceof)
**What:** Use Match.value on `error.reason` field for error discrimination
**When to use:** All ClusterError handling
**Example:**
```typescript
// Source: Plan 01-01 - single Schema.TaggedError with reason discriminant
// Match on reason field - all 11 variants for exhaustive matching
const handleClusterError = (error: ClusterError) => Match.value(error.reason).pipe(
  Match.when('AlreadyProcessingMessage', () => /* retry later */),
  Match.when('EntityNotAssignedToRunner', () => /* route to correct runner */),
  Match.when('MailboxFull', () => /* back-pressure, retry */),
  Match.when('MalformedMessage', () => /* log and fail */),
  Match.when('PersistenceError', () => /* log and fail */),
  Match.when('RunnerNotRegistered', () => /* wait for registration */),
  Match.when('RunnerUnavailable', () => /* failover */),
  Match.when('SendTimeout', () => /* retry with backoff */),
  Match.when('Suspended', () => /* resume via DurableDeferred */),
  Match.when('RpcClientError', () => /* handle RPC failure */),
  Match.when('SerializationError', () => /* log and fail */),
  Match.exhaustive,
);

// Or use Effect.catchTags at call site (converts to ClusterError first):
sharding.send(...).pipe(
  Effect.catchTags({
    MailboxFull: (e) => Effect.fail(ClusterError.fromMailboxFull(entityId, e)),
    SendTimeout: (e) => Effect.fail(ClusterError.fromSendTimeout(entityId, e)),
  }),
);
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

### Pattern 5: Entity.keepAlive (Long Operations)
**What:** Prevent idle deactivation during long-running operations
**When to use:** File uploads, batch processing, external API calls >maxIdleTime
**Example:**
```typescript
// Source: @effect/cluster Entity.ts - keepAlive prevents maxIdleTime eviction
const processLargeFile = (entityId: EntityId, file: FileChunk) =>
  client(Snowflake.toString(entityId)).process({ file }).pipe(
    Entity.keepAlive,  // Resets idle timer for duration of effect
  )
```

### Pattern 6: toLayerMailbox (Bounded Concurrency)
**What:** Bounded mailbox with queue semantics, backpressure on overflow
**When to use:** Rate-limited entities, prevent OOM, explicit concurrency control
**Example:**
```typescript
// Source: @effect/cluster Entity.ts - toLayerMailbox vs toLayer
const ClusterEntityLive = ClusterEntity.toLayerMailbox(Effect.gen(function*() {
  return { process: ..., status: ... }
}), {
  maxIdleTime: Duration.minutes(5),
  mailboxCapacity: 100,  // MailboxFull error when exceeded (vs unbounded default)
  concurrency: 1,        // Single message at a time per entity
})
```

### Pattern 7: EntityResource (Lifecycle Resources)
**What:** Acquire/release resources per entity lifecycle (DB connections, file handles)
**When to use:** Per-entity state that needs cleanup on deactivation
**Example:**
```typescript
// Source: @effect/cluster EntityResource - scoped per entity instance
const entityWithResource = Entity.toLayer(
  Entity.CurrentAddress.pipe(
    Effect.flatMap((addr) => Effect.acquireRelease(
      openConnection(addr.entityId),        // Acquire on activation
      (conn) => closeConnection(conn),       // Release on deactivation
    )),
    Effect.flatMap((conn) => Effect.succeed({
      process: ({ data }) => conn.execute(data),
      status: () => conn.getState(),
    })),
  ),
  { maxIdleTime: Duration.minutes(5) },
)
```

### Pattern 8: Streaming RPC (Rpc.make stream: true)
**What:** Server-streaming responses for large result sets
**When to use:** Paginated queries, live feeds, batch exports
**Example:**
```typescript
// Source: @effect/rpc - modern Rpc.make with stream: true (not deprecated Rpc.StreamRequest)
import { Rpc } from '@effect/rpc'

const ListEvents = Rpc.make('ListEvents', {
  payload: {
    entityId: Snowflake.SnowflakeFromString,
    cursor: S.optional(S.String),
    limit: S.optionalWith(S.Int, { default: () => 100 }),
  },
  success: EventSchema,
  error: ClusterError,
  stream: true,  // Enables Stream<EventSchema> return type
  // primaryKey for stream resumption (cursor-based)
  primaryKey: (p) => `${Snowflake.toString(p.entityId)}:${p.cursor ?? 'initial'}`,
})

// In entity handler - return Stream directly
ListEvents: ({ entityId, cursor, limit }) => Stream.paginateChunkEffect(cursor, (c) =>
  db.execute(sql`SELECT * FROM events WHERE entity_id = ${entityId} AND id > ${c ?? '0'} LIMIT ${limit + 1}`)
    .pipe(Effect.map((rows) => {
      const hasMore = rows.length > limit
      const items = Chunk.fromIterable(hasMore ? rows.slice(0, limit) : rows)
      const nextCursor = hasMore ? Option.some(rows[limit - 1]?.id) : Option.none()
      return [items, nextCursor]
    })),
)
```

### Pattern 9: ShardingConfig.layerFromEnv
**What:** Environment-based cluster configuration
**When to use:** K8s deployments, 12-factor apps, external config
**Example:**
```typescript
// Source: @effect/cluster ShardingConfig.ts - layerFromEnv reads EFFECT_CLUSTER_* vars
// EFFECT_CLUSTER_SHARDS_PER_GROUP=100
// EFFECT_CLUSTER_PREEMPTIVE_SHUTDOWN=true
// EFFECT_CLUSTER_ENTITY_TERMINATION_TIMEOUT=30000
const ClusterLive = Layer.mergeAll(
  NodeClusterSocket.layer,  // Storage configured via Layer.provide below
  ClusterEntityLive,
).pipe(
  Layer.provide(SqlMessageStorage.layer),
  Layer.provide(SqlRunnerStorage.layer),
  Layer.provide(ShardingConfig.layerFromEnv()),  // Reads from process.env
)
```

### Pattern 10: DurableQueue.worker (Phase 4 Job Processing)
**What:** Durable job queue with concurrency control and completion signaling
**When to use:** Phase 4 job processing replacement for DB-polling queues
**Example:**
```typescript
// Source: @effect/workflow DurableQueue.ts - worker pattern for job processing
import { DurableQueue } from '@effect/workflow'

const JobQueue = DurableQueue.make({
  name: 'JobQueue',
  payload: JobPayload,
  success: JobResult,
  error: JobError,
  idempotencyKey: (p) => p.jobId,
})

// Worker layer - processes jobs with concurrency control
const JobWorkerLayer = DurableQueue.worker(JobQueue, {
  concurrency: 10,  // Matches current jobs.ts CONCURRENCY
  execute: (payload) => processJob(payload),
})

// Producer - enqueues job and awaits completion
const submitJob = (payload: JobPayload) =>
  DurableQueue.process(JobQueue, payload)  // Blocks until complete
```

### Pattern 11: Workflow.addFinalizer (Cleanup on Completion)
**What:** Finalization that runs once on workflow completion, not on each suspension
**When to use:** Cleanup that should only run when workflow truly completes (Phase 6)
**Example:**
```typescript
// Source: @effect/workflow Workflow.ts - addFinalizer vs Effect.ensuring
// Effect.ensuring runs after EVERY effect, including on suspend
// Workflow.addFinalizer runs ONLY on workflow completion (success or failure)

// Phase 1: Entity pattern (runs on every suspension)
const entityHandler = effect.pipe(
  Effect.ensuring(cleanup)
)

// Phase 6: Workflow pattern (runs once on completion)
const workflowHandler = Effect.gen(function* () {
  yield* Workflow.addFinalizer((exit) =>
    Exit.isSuccess(exit) ? Effect.void : compensate()
  )
  // ... workflow logic
})
```

### Pattern 12: KeyValueStore.layerSchema (Entity State Snapshots)
**What:** Schema-backed persistent key-value storage for entity state recovery
**When to use:** Entity crash recovery, distributed state checkpointing (EVNT-05)
**Example:**
```typescript
// Source: @effect/platform KeyValueStore.ts - schema-validated persistence
import { KeyValueStore } from '@effect/platform'
import { SubscriptionRef, Stream } from 'effect'

const EntityStateStoreLive = KeyValueStore.layerSchema(EntityState, {
  prefix: 'cluster:entity:state:',  // Namespace isolation
})

// In entity handler - persist state on changes
// NOTE: Use SubscriptionRef (not Ref) - standard Ref has no .changes property
const stateRef = yield* SubscriptionRef.make(EntityState.idle())
yield* stateRef.changes.pipe(
  Stream.debounce(Duration.millis(100)),
  Stream.tap((state) => store.set(entityId, state)),
  Stream.runDrain,
  Effect.forkScoped,
)
```

### Pattern 13: RpcClient.withHeaders (Context Propagation - Phase 2)
**What:** Propagate request context (tenantId, requestId, sessionId) via RPC headers
**When to use:** Phase 2 context integration - cross-pod context propagation without schema changes
**Example:**
```typescript
// Source: @effect/rpc/RpcClient - FiberRef-based header propagation
import { RpcClient } from '@effect/rpc'
import { Headers } from '@effect/platform'

// FiberRef for current headers
const currentHeaders: FiberRef.FiberRef<Headers.Headers> = RpcClient.currentHeaders

// Set headers for an RPC call scope (dual API)
const withHeaders: {
  (headers: Headers.Input): <A, E, R>(effect: Effect<A, E, R>) => Effect<A, E, R>
  <A, E, R>(effect: Effect<A, E, R>, headers: Headers.Input): Effect<A, E, R>
} = RpcClient.withHeaders

// In send method - propagate context via headers
const send = (entityId: string, payload: ProcessPayload) =>
  Context.Request.current.pipe(
    Effect.flatMap((ctx) =>
      getClient(entityId)['process'](payload).pipe(
        RpcClient.withHeaders({
          'x-tenant-id': ctx.tenantId,
          'x-request-id': ctx.requestId,
          ...Option.match(ctx.session, {
            onNone: () => ({}),
            onSome: (s) => ({ 'x-session-id': s.id, 'x-user-id': s.userId }),
          }),
        }),
      )
    ),
    Effect.orElse(() => getClient(entityId)['process'](payload)),
  )

// In entity handler - access headers from envelope
const process = (envelope) => Effect.gen(function* () {
  const tenantId = Headers.get(envelope.headers, 'x-tenant-id')
  const requestId = Headers.get(envelope.headers, 'x-request-id')
  yield* Effect.logDebug('Processing', { tenantId, requestId })
})
```
**Note:** This is the PROPER Phase 2 approach. Do NOT extend ProcessPayload schema with context fields - use RPC headers instead for cleaner separation.

### Pattern 14: Socket.toChannel (Backpressure-Aware Messaging)
**What:** Convert raw socket to Effect Channel for typed message handling with backpressure
**When to use:** Entity message buffering, mailbox capacity enforcement
**Example:**
```typescript
// Source: @effect/platform Socket.ts - socket to channel conversion
import { Socket } from '@effect/platform'

const EntitySocketChannel = Socket.toChannelMap(
  socket,
  (bytes) => S.decodeUnknown(EntityMessage)(bytes),
)

// Backpressure-aware message processing
const processMessages = Stream.fromChannel(EntitySocketChannel).pipe(
  Stream.buffer({ capacity: 100, strategy: 'sliding' }),
  Stream.mapEffect(handleMessage),
)
```

### Pattern 15: Entity.fromRpcGroup (Shared Contract)
**What:** Create entity from RpcGroup for shared contract between entity messaging and WebSocket RPC
**When to use:** When entity protocol will also be exposed via WebSocket RPC (Phase 7)
**Example:**
```typescript
// Source: @effect/rpc RpcGroup.make - shared contract pattern
import { Entity } from '@effect/cluster'
import { RpcGroup, Rpc } from '@effect/rpc'

// Define protocol as RpcGroup (shared contract)
class ClusterProtocol extends RpcGroup.make(
  Rpc.make('process', {
    payload: ProcessPayload,
    success: S.Void,
    error: EntityProcessError,
    primaryKey: (p) => p.idempotencyKey ?? Snowflake.toString(p.entityId),
  }),
  Rpc.make('status', {
    payload: StatusPayload,
    success: StatusResponse,
  }),
) {}

// Create entity from RpcGroup - single source of truth
const ClusterEntity = Entity.fromRpcGroup('Cluster', ClusterProtocol)

// Benefits:
// 1. Shared contract between entity messaging and WebSocket RPC
// 2. Single source of truth for payload/success/error schemas
// 3. Direct RpcServer.toHttpAppWebsocket integration in Phase 7
```

### Pattern 16: Entity + Machine Integration (Complex State)
**What:** Entity handles cross-pod messaging; Machine handles local state machine logic
**When to use:** Complex entity lifecycles requiring typed state transitions (Phase 6)
**Example:**
```typescript
// Source: @effect/experimental Machine.ts + @effect/cluster Entity.ts
import { Machine } from '@effect/experimental/Machine'
import { Entity } from '@effect/cluster'

// Define state machine for complex entity lifecycle
const EntityMachine = Machine.makeSerializable({
  id: 'EntityMachine',
}, {
  // State schema
  state: S.Struct({
    status: S.Literal('idle', 'processing', 'suspended', 'complete', 'failed'),
    data: S.optional(S.Unknown),
  }),
  // Event/request schemas
  events: {
    Process: S.Struct({ data: S.Unknown }),
    Complete: S.Struct({}),
    Fail: S.Struct({ reason: S.String }),
  },
  // Typed transitions
  transitions: Machine.procedures.make((s) => ({
    Process: (event) => s.status === 'idle' ? { ...s, status: 'processing', data: event.data } : s,
    Complete: () => s.status === 'processing' ? { ...s, status: 'complete' } : s,
    Fail: () => ({ ...s, status: 'failed' }),
  })),
})

// Entity handler delegates to local Machine
const ClusterEntityLive = ClusterEntity.toLayer(Effect.gen(function* () {
  const actor = yield* Machine.boot(EntityMachine)  // Local machine
  return {
    process: (payload) => actor.send(new Process(payload)).pipe(
      Effect.map(() => undefined),  // Entity RPC expects void
    ),
    status: () => actor.send(new StatusRequest()),
  }
}), entityOptions)
```
**Note:** Entity (Rpc.make) is for cluster-wide distributed messaging. Machine (procedures.make) is for local state machine logic. They complement each other - don't confuse them.

### Pattern 17: Rpc.make with primaryKey (Idempotency)
**What:** Schema-level idempotency key extraction for automatic deduplication
**When to use:** All entity operations requiring idempotency
**Example:**
```typescript
// Source: @effect/rpc Rpc.make - primaryKey for automatic deduplication
const ProcessRequest = Rpc.make('process', {
  payload: ProcessPayload,
  success: S.Void,
  error: EntityProcessError,
  // primaryKey integrates with SqlMessageStorage.saveRequest automatically
  primaryKey: (p) => p.idempotencyKey ?? `${Snowflake.toString(p.entityId)}:${Date.now()}`,
})

// Handler receives automatic deduplication - no manual requestIdForPrimaryKey needed
```

### Anti-Patterns to Avoid
- **`instanceof` checks for errors:** Use Match.value(error.reason) or Effect.catchTags
- **Effect.withSpan for tracing:** Use Telemetry.span which auto-captures context, metrics, errors
- **Separate entity types per operation:** Use polymorphic messages with Match.type routing
- **`if/else` chains for error handling:** Use Match.type for exhaustive variant handling
- **`async/await` mixing:** Use Effect.promise for interop, never raw async in Effect code
- **Loose string entity IDs:** Use branded Snowflake types for entity identification
- **Missing SLA enforcement:** Use Effect.timeout for all cross-pod operations
- **Missing Entity.keepAlive:** Long operations may be evicted mid-processing
- **Non-deterministic entity handlers:** Entity handlers wrapped in Activities must be deterministic for replay. Avoid Date.now(), Math.random(), crypto.randomUUID() - use Snowflake.Generator or pass timestamps via payload
- **Error flattening in handlers:** Preserve Cause structure for Phase 6 Workflow.withCompensation compatibility - don't squash typed errors to single error type

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
| Keep-alive during long ops | Manual timer resets | Entity.keepAlive | Automatic idle timer management |
| Large result streaming | Manual chunking + pagination | Rpc.StreamRequest | Backpressure, typed streams |
| Per-entity connections | Manual pool management | EntityResource + acquireRelease | Automatic cleanup on deactivation |
| Trace propagation | Manual header parsing | HttpTraceContext.toHeaders/fromHeaders | W3C/B3 standards compliant |
| Binary serialization | JSON.stringify/parse | MsgPack.duplexSchema | 30-50% size reduction |
| Callback integration | Effect.promise | Effectify.effectify | Handles overloads, precise errors |
| Entity state persistence | Manual DB queries | KeyValueStore.layerSchema | Schema-validated, namespace isolated |
| Request correlation | Manual ID tracking | `Rpc.make({ primaryKey })` | Automatic deduplication, distributed tracing |
| Client type safety | Manual type casts | `RpcClient.make(RpcGroup)` | Full type inference from shared contract |
| RPC middleware | Manual pre/post hooks | `RpcMiddleware.Tag({ provides, failure })` | Context injection, typed errors |
| Error serialization | Custom error envelope | `Rpc.make({ error: S.TaggedError })` | Schema-based error propagation |
| Polymorphic unions | Manual S.Union discrimination | `VariantSchema.make` | Compile-time variant discrimination |
| State machines | Manual transition logic | `Machine.makeSerializable` | Typed transitions, auto-serialization |
| State snapshots | Manual JSON serialization | `Persistence.layerResult` | Schema-validated with TTL, Exit storage |

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
  const stateRef = yield* Ref.make<typeof StatusResponse.Type>({ status: "idle" })
  return {
    process: ({ data }) => Effect.gen(function*() {
      yield* Ref.set(stateRef, { status: "processing" })
      yield* db.execute(sql`INSERT INTO processed ...`)
      yield* Ref.set(stateRef, { status: "complete" })
    }).pipe(Effect.catchTag("SqlError", (e) => new EntityProcessError({ message: e.message, cause: e }))),
    status: () => Ref.get(stateRef),
  }
}), {
  maxIdleTime: Duration.minutes(5),
  concurrency: 1,
  mailboxCapacity: 100,
  defectRetryPolicy: Schedule.exponential(Duration.millis(100)).pipe(
    Schedule.jittered,
    Schedule.intersect(Schedule.recurs(5)),
  ),
})
```

### Cluster Layer Composition
```typescript
// Source: Effect 3.19 release notes + CLUSTER.md research
// NOTE: NodeClusterSocket.layer no longer takes { storage: "sql" } - storage is via Layer.provide
const ClusterLive = Layer.mergeAll(
  NodeClusterSocket.layer,
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
// IMPORTANT: @effect/cluster/ClusterMetrics provides state gauges automatically:
// - effect_cluster_entities (bigint gauge) - auto-updated by Sharding on entity changes
// - effect_cluster_singletons (bigint gauge) - auto-updated during singleton sync
// - effect_cluster_runners (bigint gauge) - auto-updated on runner registration
// - effect_cluster_runners_healthy (bigint gauge) - auto-updated on health changes
// - effect_cluster_shards (bigint gauge) - auto-updated on shard acquisition
//
// These are updated internally via ClusterMetrics.*.unsafeUpdate() in Sharding.ts
// and exported automatically via Telemetry.Default OTLP layer (Otlp.layerJson).
//
// DO NOT duplicate these in MetricsService - only add APP-SPECIFIC metrics:

// Source: metrics.ts pattern - APP-SPECIFIC metrics only
// Add to MetricsService in observe/metrics.ts
cluster: {
  // Counters for app-level operations (ClusterMetrics doesn't track these)
  messagesSent: Metric.counter("cluster_messages_sent_total"),
  messagesReceived: Metric.counter("cluster_messages_received_total"),
  redeliveries: Metric.counter("cluster_redeliveries_total"),

  // Histogram for message latency (SLA target: <100ms)
  messageLatency: Metric.timerWithBoundaries("cluster_message_latency_seconds", _boundaries.cluster),

  // Error counter - labeled by type (MailboxFull, RunnerUnavailable, etc.)
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

### Unresolved

1. **ShardingConfig.preemptiveShutdown behavior**
   - What we know: Documented as "Start shutdown before shard release"
   - What's unclear: Exact timing and coordination with K8s terminationGracePeriodSeconds
   - Recommendation: Set preemptiveShutdown: true, configure K8s grace period >= entityTerminationTimeout

### Resolved During Research

| Question | Resolution |
|----------|------------|
| **Dedicated RunnerStorage connection** | PgClient: `maxSize: 1`, `minSize: 1`, `idleTimeout: 24h`, `timeToLive: 24h`, `applicationName: 'cluster-runner-storage'` |
| **ClusterMetrics integration** | ClusterMetrics auto-exports `effect_cluster_*` gauges via OTLP. Do NOT duplicate in MetricsService - only add app-specific counters/histograms. |

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
