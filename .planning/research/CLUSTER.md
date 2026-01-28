# @effect/cluster Research

**Version:** 0.56.1 (catalog)
**Researched:** 2026-01-28
**Confidence:** HIGH (official docs + verified examples)

## Executive Summary

@effect/cluster provides cluster-native distributed coordination via entity sharding, message persistence, and automatic failover. Replaces DB-locked job queues with consistent-hash routing, advisory-lock shard ownership, and at-least-once delivery. No central ShardManager required since v0.51.0 — RunnerStorage handles shard coordination via database advisory locks.

**Primary recommendation:** Use `SqlMessageStorage` + `SqlRunnerStorage` with PostgreSQL, `NodeClusterSocket` layer for pod communication, and `Entity.make` for distributed actors. Integrate `ClusterMetrics` with existing `MetricsService`.

## Core Imports

| Import | Provides | When to Use |
|--------|----------|-------------|
| `Entity` | Actor definition, message handlers, client | Define distributed stateful entities |
| `Sharding` | Shard assignment, entity routing, send/broadcast | Entry point for cluster operations |
| `ShardingConfig` | Configuration layer | Tune shard count, timeouts, intervals |
| `SqlMessageStorage` | Durable message queue | Production message persistence |
| `SqlRunnerStorage` | Runner registry + shard locks | Production shard coordination |
| `Singleton` | Cluster-wide unique instance | Leader election, singleton processes |
| `ClusterCron` | Distributed scheduled tasks | Cron jobs that run once across cluster |
| `ClusterWorkflowEngine` | Durable workflow execution | Long-running saga orchestration |
| `ClusterMetrics` | Gauge metrics (entities, runners, shards) | Observability integration |
| `ClusterError` | Typed error taxonomy | Error handling in message flows |
| `Snowflake` | Distributed ID generation | Unique IDs across nodes |
| `NodeClusterSocket` | Node.js socket-based communication | Production inter-pod messaging |

## Entity Model

Entities are distributed stateful actors with typed RPC protocols. Define via `Entity.make`:

```typescript
// Source: https://effect-ts.github.io/effect/cluster/Entity.ts.html
const Counter = Entity.make("Counter", [
  Rpc.make("increment", { payload: Schema.Void, success: Schema.Number }),
  Rpc.make("get", { payload: Schema.Void, success: Schema.Number }),
])
```

**Handler registration via `toLayer`:**
```typescript
const CounterLive = Counter.toLayer(Effect.gen(function*() {
  let count = 0
  return {
    increment: () => Effect.succeed(++count),
    get: () => Effect.succeed(count),
  }
}), { maxIdleTime: Duration.minutes(5), concurrency: 1 })
```

**Layer options:**
| Option | Type | Purpose |
|--------|------|---------|
| `maxIdleTime` | Duration | Deactivate idle entities |
| `concurrency` | number \| "unbounded" | Message processing parallelism |
| `mailboxCapacity` | number \| "unbounded" | Queue size per entity |
| `defectRetryPolicy` | Schedule | Failure recovery schedule |

**Client usage:**
```typescript
const client = yield* Counter.client
const result = yield* client("entity-id-123").increment()
```

## Sharding Architecture

Consistent hashing distributes entities: `hash(entityId) % numberOfShards -> shardId -> runner`.

**Shard ownership:** Database advisory locks (PostgreSQL `pg_advisory_lock`). Stable connections required.

**Sharding service operations:**
```typescript
interface Sharding {
  readonly register: (entity: Entity<...>) => Effect<void>
  readonly send: <R>(entityId: string, request: R) => Effect<Reply>
  readonly broadcast: (entityType: string, request: R) => Effect<void>
  readonly messenger: (entityType: string) => Messenger
  readonly isEntityOnLocalRunner: (entityId: string) => Effect<boolean>
  readonly isShuttingDown: Effect<boolean>
}
```

**HashRing distribution:** Same entityId always routes to same runner. Runner changes trigger minimal reshuffling.

## Message Patterns

**Request-Response (default):**
```typescript
yield* client(entityId).someRpc({ payload })  // Waits for reply
```

**Fire-and-Forget:**
```typescript
yield* Sharding.send(entityId, request, { discard: true })
```

**Scheduled Delivery via `DeliverAt`:**
```typescript
// Object implements DeliverAt interface
const scheduled = { [DeliverAt.symbol]: () => DateTime.add(DateTime.now(), { minutes: 5 }) }
yield* Sharding.send(entityId, { ...request, ...scheduled })
```

**Reply types:**
- `Reply.WithExit<R>` — Final result with success/failure
- `Reply.Chunk<R>` — Streaming response with sequence ordering

## Storage Configuration

**PostgreSQL production setup:**
```typescript
import { SqlMessageStorage, SqlRunnerStorage } from "@effect/cluster"
import { PgClient } from "@effect/sql-pg"

const StorageLive = Layer.mergeAll(
  SqlMessageStorage.layer,      // Uses default table prefix
  SqlRunnerStorage.layer,       // Uses default table prefix
).pipe(Layer.provide(PgClient.layer({ ... })))
```

**Custom table prefix:**
```typescript
SqlMessageStorage.layerWith({ prefix: "myapp_cluster_" })
SqlRunnerStorage.layerWith({ prefix: "myapp_cluster_" })
```

**SqlMessageStorage operations:**
| Method | Purpose |
|--------|---------|
| `saveRequest` | Persist outgoing request (returns Success \| Duplicate) |
| `saveEnvelope` | Store envelope with delivery timing |
| `saveReply` | Archive reply to request |
| `repliesFor` | Retrieve replies matching request |
| `unprocessedMessages` | Fetch pending messages for shard |
| `resetShards` | Reset state across shards |

**SqlRunnerStorage operations:**
| Method | Purpose |
|--------|---------|
| `register` / `unregister` | Runner lifecycle |
| `getRunners` | All runners with health status |
| `setRunnerHealth` | Update runner availability |
| `acquire` / `refresh` / `release` | Shard ownership via advisory locks |

## Kubernetes Integration

**K8sHttpClient for pod discovery:**
```typescript
import { K8sHttpClient } from "@effect/cluster"

const getPods = K8sHttpClient.makeGetPods({
  namespace: "production",
  labelSelector: "app=myservice"
})
const pods = yield* getPods  // Map<string, Pod>
```

**RunnerHealth with K8s API:**
```typescript
import { RunnerHealth } from "@effect/cluster"
const HealthLive = RunnerHealth.layerK8s  // Uses K8s API for liveness
```

**Full Kubernetes layer:**
```typescript
import { NodeClusterSocket } from "@effect/cluster"

const ClusterLive = NodeClusterSocket.layer({ storage: "sql" }).pipe(
  Layer.provide(SqlMessageStorage.layer),
  Layer.provide(SqlRunnerStorage.layer),
  Layer.provide(PgClient.layer(pgConfig)),
  Layer.provide(RunnerHealth.layerK8s),
)
```

## Integration Points

**With existing `Context.Request`:**
```typescript
// Extend request context with cluster state
const clusterState = yield* Sharding.isEntityOnLocalRunner(entityId)
yield* Context.Request.update({
  cluster: Option.some({ shardId, runnerId, isLocal: clusterState })
})
```

**With existing `MetricsService`:**
```typescript
import { ClusterMetrics } from "@effect/cluster"

// ClusterMetrics exposes gauges: entities, singletons, runners, runnersHealthy, shards
// Wire to MetricsService polling:
const clusterMetrics = yield* Effect.all({
  entities: Metric.value(ClusterMetrics.entities),
  runners: Metric.value(ClusterMetrics.runners),
  shards: Metric.value(ClusterMetrics.shards),
})
```

**Singleton for leader election:**
```typescript
import { Singleton } from "@effect/cluster"

const LeaderJobLive = Singleton.make("leader-job",
  Effect.gen(function*() {
    yield* Effect.logInfo("I am the leader")
    yield* leaderOnlyWork
    yield* Effect.never  // Keep running
  })
)
```

**ClusterCron for scheduled tasks:**
```typescript
import { ClusterCron } from "@effect/cluster"
import { Cron } from "effect"

const DailyCleanupLive = ClusterCron.make({
  name: "daily-cleanup",
  cron: Cron.parse("0 2 * * *"),  // 2 AM daily
  execute: Effect.gen(function*() { yield* cleanupOldData }),
  skipIfOlderThan: Duration.hours(1),  // Skip if >1hr late
})
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Distributed locks | Redis SETNX / DB FOR UPDATE | Shard ownership via `SqlRunnerStorage` | Advisory locks + failover |
| Leader election | Custom Raft/consensus | `Singleton.make` | Automatic via shard assignment |
| Job queues | DB polling + SELECT FOR UPDATE | Entity message handlers | Sharding distributes load |
| Cross-pod messaging | Redis pub/sub DIY | `Sharding.send` / `broadcast` | Typed, persistent, traced |
| Unique IDs | UUID v4 | `Snowflake.Generator` | Sortable, machine-aware |
| Scheduled tasks | Cron daemon / DB polling | `ClusterCron.make` | Single execution guarantee |
| Workflow orchestration | DIY saga manager | `ClusterWorkflowEngine` | Durable, resumable |
| Health aggregation | Custom ping loops | `RunnerHealth` + K8s layer | Native K8s integration |

## Configuration

**ShardingConfig options:**
| Parameter | Default | Purpose |
|-----------|---------|---------|
| `shardsPerGroup` | 300 | Shard count per entity group |
| `entityMaxIdleTime` | unlimited | Entity deactivation timeout |
| `entityMailboxCapacity` | unbounded | Per-entity message queue |
| `entityTerminationTimeout` | 10s | Shutdown grace period |
| `entityRegistrationTimeout` | 30s | Registration deadline |
| `sendRetryInterval` | varies | Message retry wait |
| `shardLockRefreshInterval` | varies | Advisory lock refresh |
| `shardLockExpiration` | varies | Lock expiry duration |
| `preemptiveShutdown` | false | Early shutdown signal |
| `simulateRemoteSerialization` | false | Test serialization locally |

**Environment-based config:**
```typescript
import { ShardingConfig } from "@effect/cluster"
const ConfigLive = ShardingConfig.layerFromEnv()  // Reads EFFECT_CLUSTER_* vars
```

## Error Taxonomy

| Error | Cause | Recovery |
|-------|-------|----------|
| `AlreadyProcessingMessage` | Entity busy with same request | Retry or deduplicate |
| `EntityNotAssignedToRunner` | Routing failure | Re-resolve shard assignment |
| `MailboxFull` | Entity queue saturated | Back-pressure, increase capacity |
| `MalformedMessage` | Deserialization failed | Check schema compatibility |
| `PersistenceError` | Storage operation failed | Retry, check DB connection |
| `RunnerNotRegistered` | Runner unknown to cluster | Wait for registration |
| `RunnerUnavailable` | Runner unresponsive | Failover to other runner |

**Type guards:**
```typescript
import { ClusterError } from "@effect/cluster"
if (ClusterError.MailboxFull.is(error)) { /* handle */ }
if (ClusterError.RunnerUnavailable.is(error)) { /* handle */ }
```

## Code Patterns

**Complete entity setup (dense style):**
```typescript
// Source: pattern from official docs + DeepWiki
const Job = Entity.make("Job", [
  Rpc.make("execute", { payload: Schema.Struct({ data: Schema.String }), success: Schema.Void, error: JobError }),
  Rpc.make("status", { payload: Schema.Void, success: JobStatus }),
])

const JobLive = Job.toLayer(Effect.gen(function*() {
  const db = yield* SqlClient.SqlClient
  let state: JobState = { status: "pending" }
  return {
    execute: ({ data }) => Effect.gen(function*() {
      state = { status: "running" }
      yield* db.execute(sql`INSERT INTO job_runs ...`)
      state = { status: "complete" }
    }).pipe(Effect.catchTag("SqlError", (e) => new JobError({ cause: e }))),
    status: () => Effect.succeed(state),
  }
}), { maxIdleTime: Duration.minutes(10), concurrency: 1 })
```

**Cluster bootstrap:**
```typescript
const ClusterLive = Layer.mergeAll(
  NodeClusterSocket.layer({ storage: "sql" }),
  JobLive,
  SingletonLive,
  CronLive,
).pipe(
  Layer.provide(SqlMessageStorage.layer),
  Layer.provide(SqlRunnerStorage.layer),
  Layer.provide(PgClient.layer(pgConfig)),
  Layer.provide(RunnerHealth.layerK8s),
  Layer.provide(ShardingConfig.layer({ shardsPerGroup: 100 })),
)

NodeRuntime.runMain(Effect.never.pipe(Effect.provide(ClusterLive)))
```

## Common Pitfalls

**1. Unstable DB connections break shard locks**
Advisory locks require persistent connections. Connection pooling with aggressive recycling causes lock loss. Use dedicated connection for runner storage.

**2. Entity mailbox overflow**
Default unbounded mailbox can OOM. Set explicit `mailboxCapacity` in `toLayer` options. Handle `MailboxFull` errors at sender.

**3. Forgetting idempotency**
Messages may be redelivered. Entity handlers must be idempotent or use `SqlMessageStorage.saveRequest` deduplication (returns `Duplicate` for seen requests).

**4. Singleton cold start**
Singleton migrates when runner fails. Design for re-initialization. Use external state (DB) not in-memory state for singletons.

**5. Missing graceful shutdown**
Without `preemptiveShutdown: true`, entities terminate abruptly. In-flight messages lost. Enable preemptive shutdown in K8s deployments.

## Migration Notes (v0.51.0+)

| Before | After |
|--------|-------|
| `@effect/platform-node/NodeClusterSocketRunner` | `@effect/cluster/NodeClusterSocket` |
| `@effect/platform-node/NodeClusterHttpRunner` | `@effect/cluster/NodeClusterHttp` |
| Central ShardManager deployment | Removed — RunnerStorage handles coordination |
| Manual shard rebalancing | Automatic via advisory lock expiry |

## Sources

### Primary (HIGH confidence)
- https://effect-ts.github.io/effect/cluster/Entity.ts.html
- https://effect-ts.github.io/effect/cluster/Sharding.ts.html
- https://effect-ts.github.io/effect/cluster/ShardingConfig.ts.html
- https://effect-ts.github.io/effect/cluster/SqlMessageStorage.ts.html
- https://effect-ts.github.io/effect/cluster/SqlRunnerStorage.ts.html
- https://effect-ts.github.io/effect/cluster/Singleton.ts.html
- https://effect-ts.github.io/effect/cluster/ClusterCron.ts.html
- https://effect-ts.github.io/effect/cluster/ClusterMetrics.ts.html
- https://effect-ts.github.io/effect/cluster/ClusterError.ts.html

### Secondary (MEDIUM confidence)
- https://deepwiki.com/Effect-TS/effect/5.2-cluster-management
- https://mufraggi.eu/articles/effect-cluster-etl
- https://github.com/sellooh/effect-cluster-via-sst

### Tertiary (LOW confidence)
- Twitter/X announcements from @EffectTS_

## Confidence Breakdown

| Area | Level | Reason |
|------|-------|--------|
| Core APIs (Entity, Sharding) | HIGH | Official TypeDoc + multiple sources |
| Storage backends | HIGH | Official TypeDoc |
| Kubernetes integration | MEDIUM | Official docs but less detailed |
| Configuration | HIGH | TypeDoc enumerates all options |
| Migration notes | HIGH | Official 3.19 release notes |
| Error handling | HIGH | TypeDoc + error class documentation |

**Research date:** 2026-01-28
**Valid until:** 2026-02-28 (30 days — stable package)
