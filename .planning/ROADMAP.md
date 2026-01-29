# Roadmap: Cluster-Native Server Infrastructure

## Overview

Transform monorepo backend from DB-locked job queues to cluster-native infrastructure via @effect/cluster. Eight phases deliver distributed coordination, typed events with reliability guarantees, saga orchestration, cross-pod real-time delivery, and production-ready health checks. Each phase builds on prior foundation, culminating in apps that deploy multi-pod with zero coordination code. Old code adjusts to fit new patterns (not vice versa).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Cluster Foundation** - Entity sharding, shard coordination, distributed locking (completed 2026-01-29)
- [ ] **Phase 2: Context Integration** - Request context extended with cluster state
- [ ] **Phase 3: Singleton & Scheduling** - Leader election, cluster cron for scheduled tasks
- [ ] **Phase 4: Job Processing** - Entity-based job dispatch replacing DB polling
- [ ] **Phase 5: EventBus & Reliability** - Typed domain events, transactional outbox, idempotency
- [ ] **Phase 6: Workflows & State Machines** - Saga orchestration, entity FSM patterns
- [ ] **Phase 7: Real-Time Delivery** - SSE streaming, WebSocket RPC, cross-pod fan-out, webhooks
- [ ] **Phase 8: Health & Observability** - Aggregated health checks, K8s probes

## Phase Details

### Phase 1: Cluster Foundation
**Goal**: Multi-pod deployments coordinate automatically via cluster sharding with no application-level code. Old code adjusts to fit cluster patterns.
**Depends on**: Nothing (first phase)
**Requirements**: CLUS-01, CLUS-02
**Effect APIs**: `Entity.make`, `SqlMessageStorage`, `SqlRunnerStorage`, `NodeClusterSocket.layer`, `ShardingConfig`, `ShardingConfig.layerFromEnv` (12-factor alternative), `preemptiveShutdown`, `ClusterError`, `Entity.keepAlive` (long operations)
**Success Criteria** (what must be TRUE):
  1. Entity message sent on Pod A reaches handler on Pod B within 100ms (verifiable via telemetry span)
  2. Shard ownership persists across pod restarts without message loss (SqlRunnerStorage advisory locks hold)
  3. Work claims via shard ownership without `SELECT FOR UPDATE` patterns in codebase
  4. ClusterService exports single `const + namespace` merge under 225 LOC
  5. `preemptiveShutdown: true` configured for K8s graceful shutdown (prevents in-flight message loss)
  6. Entity handlers implement idempotent pattern via `Rpc.make({ primaryKey })` (automatic deduplication)
  7. Dedicated DB connection for RunnerStorage (prevents shard lock loss from connection recycling)
  8. `ClusterError` type guards used for typed error handling (no `instanceof` checks)
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md - ClusterService facade, ClusterError, Entity schema
- [x] 01-02-PLAN.md - Entity layer, SQL storage backends, sharding config
- [x] 01-03-PLAN.md - Cluster metrics integration with MetricsService

### Phase 2: Context Integration
**Goal**: Request handlers access shard ID, runner ID, and leader status via standard Context.Request pattern. Middleware populates context; handlers consume.
**Depends on**: Phase 1
**Requirements**: CLUS-04
**Effect APIs**: `ShardId` (class with Equal/Hash), `Sharding.getShardId`, `sharding.getSnowflake`, `ShardId.toString/fromString`, `FiberRef.locally/locallyWith`, `Effect.serviceOption`, `Schema.Class` (Serializable extension)
**Success Criteria** (what must be TRUE):
  1. Handler accesses `Context.Request.cluster.shardId` with `ShardId` class type (not loose string)
  2. Handler accesses `Context.Request.cluster.runnerId` with branded `RunnerId` type
  3. Handler accesses `Context.Request.cluster.isLeader` for conditional logic (updated on singleton entry)
  4. Context population occurs in middleware with graceful degradation via `Effect.serviceOption`
  5. `Context.Serializable` extended with optional runnerId/shardId for cross-pod traces
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md - ClusterState schema, Context.Request extension with cluster accessors
- [ ] 02-02-PLAN.md - Middleware cluster population, Serializable extension, observability

### Phase 3: Singleton & Scheduling
**Goal**: Scheduled tasks and leader-only processes execute exactly once with automatic state persistence, health tracking, and dead man's switch. Not wrappers — intelligent coordination that handles state handoff across leader migrations.
**Depends on**: Phase 2
**Requirements**: CLUS-03
**Effect APIs**: `Singleton.make`, `ClusterCron.make`, `Snowflake.Generator`, `skipIfOlderThan`, `KeyValueStore.layerSchema` (state persistence), `Metric.gauge` (heartbeat tracking)
**Pre-wired from Phase 1**: `ClusterService.singleton()` and `ClusterService.cron()` factory methods exist — extend with state/health capabilities
**Success Criteria** (what must be TRUE):
  1. Cron job configured for 1-minute interval fires exactly once per minute with 3+ pods running
  2. Leader-only process migrates to surviving pod within 30 seconds after leader pod death
  3. `ClusterService.singleton()` accepts optional typed `state` schema — persisted to DB via KeyValueStore
  4. Singleton state survives leader migration without reconstruction (DB-backed, loaded on startup)
  5. Singleton heartbeat tracked as gauge (`singleton.{name}.last_execution`) — updated after each run
  6. Health check integration: singleton considered unhealthy if no execution in 2x expected interval
  7. `ClusterService.cron()` merges Singleton + ClusterCron when schedule provided (single factory)
  8. `skipIfOlderThan` prevents accumulated job burst after downtime
  9. Snowflake IDs generated cluster-wide without collisions
**Plans**: TBD

Plans:
- [ ] 03-01: TBD

### Phase 4: Job Processing
**Goal**: Jobs process via Entity mailbox with priority, deduplication, dead-letter handling, and batch efficiency. Single polymorphic `submit` handles all cases. Interface unchanged for existing callers.
**Depends on**: Phase 3
**Requirements**: JOBS-01
**Effect APIs**: `Entity.make("Job", [...])`, `Sharding.send`, `mailboxCapacity`, `MessageState`, `defectRetryPolicy`, `Schedule`, `Match.type`, `Entity.keepAlive` (batch jobs), `EntityResource` (per-job resources), `Effect.interrupt` (cancellation), `Ref` (status tracking)
**Pattern from Phase 1**: Follow ClusterEntity structure — ProcessPayload/StatusPayload, EntityState, defectRetryPolicy composition
**Success Criteria** (what must be TRUE):
  1. Job submission to processing latency under 50ms (no poll interval)
  2. JobService interface unchanged for existing callers (same `submit`/`schedule` API)
  3. `submit` is polymorphic — single job or batch array, same function
  4. Priority levels (high/normal/low) affect processing order via weighted scheduling
  5. Deduplication via optional `dedupeKey` — uses `Rpc.make({ primaryKey })` internally
  6. Failed jobs dead-letter to `job_dlq` table after configurable max retries
  7. `JobService.cancel(jobId)` interrupts in-flight job via Effect.interrupt
  8. `JobService.status(jobId)` returns current state (queued/processing/complete/failed/cancelled)
  9. In-flight jobs survive pod restart via message persistence (SqlMessageStorage)
  10. No `SELECT FOR UPDATE` or poll loop in jobs.ts (gut + replace complete)
  11. File under 225 LOC with `const + namespace` merge pattern
  12. Metrics: `job.queue_depth`, `job.processing_seconds`, `job.failures_total`, `job.dlq_size`
  13. Long-running jobs use `Entity.keepAlive` automatically when duration > maxIdleTime
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

### Phase 5: EventBus & Reliability
**Goal**: Domain events publish reliably with at-least-once delivery and automatic deduplication. EventBus replaces `StreamingService.channel()` for cross-pod pub/sub. Transactional outbox via Activity.make + DurableDeferred.
**Depends on**: Phase 4
**Requirements**: EVNT-01, EVNT-02, EVNT-04
**Effect APIs**: `Entity.make` for routing, `Activity.make`, `DurableDeferred`, `SqlMessageStorage.saveRequest`, `Schema.TaggedRequest`, `Sharding.broadcaster` (replaces local PubSub)
**Streaming.ts Impact**: `StreamingService.channel()` deprecated — use `EventBus.subscribe()` for cross-pod events. Local SSE delivery via `sse()` remains unchanged.
**Success Criteria** (what must be TRUE):
  1. Event emitted in handler reaches all subscribers across cluster within 200ms
  2. Event publishes only after database transaction commits (no phantom events on rollback)
  3. Duplicate event delivery returns `Duplicate` status without handler re-execution
  4. EventBus exports typed domain event contracts via Schema (not untyped JSON)
  5. Single polymorphic `emit` function handles single event or batch
  6. Event emission wrapped in `Activity.make` for replay-safe idempotency
  7. Transactional outbox uses `DurableDeferred` for commit acknowledgment
  8. `StreamingService.channel()` marked deprecated with migration path to EventBus
**Plans**: TBD

Plans:
- [ ] 05-01: TBD

### Phase 6: Workflows & State Machines
**Goal**: Multi-step processes automatically compensate on failure; entity lifecycles are explicit and recoverable. All compensation logic wrapped in Activity.make. No if/else chains in state transitions.
**Depends on**: Phase 5
**Requirements**: EVNT-03, EVNT-05, EVNT-06
**Effect APIs**: `Workflow.make`, `Activity.make`, `withCompensation`, `Workflow.addFinalizer` (runs once on completion, not on suspend), `ClusterWorkflowEngine.layer`, `Machine.makeSerializable`, `Machine.procedures.make`, `Match.type`, `VariantSchema` (polymorphic state schemas), `Persistence.layerResult` (state snapshots with TTL)
**Layer Composition**: ClusterWorkflowEngine.layer depends on Phase 1 ClusterLive - compose as `Layer.provide(ClusterWorkflowEngine.layer).pipe(Layer.provide(ClusterLive))`
**Success Criteria** (what must be TRUE):
  1. Saga with 3 steps compensates steps 1-2 when step 3 fails (verified via test)
  2. Workflow state persists across pod restarts (DurableDeferred acknowledgment)
  3. Entity state machine serializes current state to database (recoverable after restart)
  4. State transitions use `Match.type` exhaustively (no if/else chains, no unhandled cases)
  5. Workflow code contains no non-deterministic operations (timestamps, random via Activities)
  6. Compensation handlers MUST wrap in `Activity.make` (prevents re-execution on replay)
  7. Machine state schemas derive types via `typeof StateSchema.Type` (no separate type declarations)
  8. Error handling preserves Cause structure (no flattening - required for `withCompensation` callbacks)
  9. `Workflow.addFinalizer` used for cleanup on completion (not `Effect.ensuring` which runs on each suspend)
**Plans**: TBD

Plans:
- [ ] 06-01: TBD

### Phase 7: Real-Time Delivery
**Goal**: Events reach connected clients in real-time regardless of which pod they connected to. New WebSocketService via RpcServer.toHttpAppWebsocket. SSE via existing StreamingService.sse(). Cross-pod via EventBus (Phase 5).
**Depends on**: Phase 6
**Requirements**: STRM-01, STRM-02, WS-01, WS-02, WS-03, JOBS-02
**Effect APIs**: `Socket.run`, `Socket.toChannel`, `RpcServer.toHttpAppWebsocket`, `RpcGroup.make`, `RpcClient.make(RpcGroup)`, `RpcSerialization.layerMsgPack`, `RpcMiddleware.Tag`, `DurableQueue.worker`, `Activity.retry`, `Entity.keepAlive`
**File Changes**:
  - `streaming.ts`: Keep `sse()`, `emit()`, `ingest()`. Remove deprecated `channel()`, `broadcast()` (replaced by EventBus Phase 5)
  - `websocket.ts`: NEW — WebSocketService with RpcGroup contract
  - `webhooks.ts`: NEW — DurableQueue.worker with retry + dead-letter
**Pre-wired from Phase 1**: `_websocketTransport` and `RpcSerialization.layerMsgPack` already configured in cluster.ts
**Success Criteria** (what must be TRUE):
  1. SSE endpoint streams events with 30s heartbeat (uses existing StreamingService.sse)
  2. SSE backpressure prevents OOM on slow clients (sliding buffer verified)
  3. WebSocket client reconnects automatically within 5 seconds after disconnect
  4. WebSocket messages validate against Schema (invalid messages rejected with typed error)
  5. Event published on Pod A reaches SSE/WebSocket clients on Pod B within 200ms (via EventBus)
  6. Webhook delivery retries 3x with exponential backoff, then dead-letters
  7. Cross-pod fan-out uses EventBus.broadcast (no Redis pub/sub, no local PubSub)
  8. `RpcGroup` as shared contract in packages/shared (server + client import same types)
  9. WebSocketService under 225 LOC with `const + namespace` merge
  10. Long-lived connections use `Entity.keepAlive` to prevent eviction
**Plans**: TBD

Plans (suggested):
- [ ] 07-01: TBD (likely WebSocketService with RpcGroup contract)
- [ ] 07-02: TBD (likely streaming.ts cleanup — remove deprecated channel/broadcast)
- [ ] 07-03: TBD (likely WebhookService with DurableQueue)

### Phase 8: Health & Observability
**Goal**: Kubernetes can determine pod health and route traffic only to ready instances. Singleton health integration from Phase 3.
**Depends on**: Phase 7
**Requirements**: HLTH-01, HLTH-02
**Effect APIs**: `Effect.all({ db, cache, cluster }, { concurrency: "unbounded" })`, `Effect.timeout`, `HttpApiGroup.make("health")`, `DevTools.layer` (dev-time state inspection)
**Pre-wired from Phase 1**: `RunnerHealth.layerK8s` already configured in cluster.ts; `effect_cluster_*` gauges auto-exported via OTLP
**Success Criteria** (what must be TRUE):
  1. `/health` endpoint returns aggregate status of all dependencies with per-dependency latency
  2. `/health/live` returns 200 when process runs (liveness probe)
  3. `/health/ready` returns 200 only when all dependencies healthy (readiness probe)
  4. Unhealthy dependency causes readiness failure within 10 seconds (not stale cache)
  5. Singleton health checks integrated — dead man's switch from Phase 3 feeds into readiness
  6. `effect_cluster_*` gauges auto-exported via Telemetry.Default OTLP layer (no manual integration)
  7. `Effect.timeout` on readiness checks prevents K8s probe failures from slow dependencies
**Plans**: TBD

Plans:
- [ ] 08-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Cluster Foundation | 3/3 | Complete | 2026-01-29 |
| 2. Context Integration | 0/2 | Planned | - |
| 3. Singleton & Scheduling | 0/TBD | Not started | - |
| 4. Job Processing | 0/TBD | Not started | - |
| 5. EventBus & Reliability | 0/TBD | Not started | - |
| 6. Workflows & State Machines | 0/TBD | Not started | - |
| 7. Real-Time Delivery | 0/TBD | Not started | - |
| 8. Health & Observability | 0/TBD | Not started | - |

---
*Roadmap created: 2026-01-28*
*Refined: 2026-01-29 (Phase 3, 4, 8 enhanced with Phase 1 learnings)*
*Depth: comprehensive (8 phases)*
*Coverage: 19/19 v1 requirements mapped*
