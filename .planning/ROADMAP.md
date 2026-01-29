# Roadmap: Cluster-Native Server Infrastructure

## Overview

Transform monorepo backend from DB-locked job queues to cluster-native infrastructure via @effect/cluster. Eight phases deliver distributed coordination, typed events with reliability guarantees, saga orchestration, cross-pod real-time delivery, and production-ready health checks. Each phase builds on prior foundation, culminating in apps that deploy multi-pod with zero coordination code. Old code adjusts to fit new patterns (not vice versa).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Cluster Foundation** - Entity sharding, shard coordination, distributed locking
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
**Effect APIs**: `Entity.make`, `SqlMessageStorage`, `SqlRunnerStorage`, `NodeClusterSocket.layer`, `ShardingConfig`, `preemptiveShutdown`, `ClusterError`
**Success Criteria** (what must be TRUE):
  1. Entity message sent on Pod A reaches handler on Pod B within 100ms (verifiable via telemetry span)
  2. Shard ownership persists across pod restarts without message loss (SqlRunnerStorage advisory locks hold)
  3. Work claims via shard ownership without `SELECT FOR UPDATE` patterns in codebase
  4. ClusterService exports single `const + namespace` merge under 225 LOC
  5. `preemptiveShutdown: true` configured for K8s graceful shutdown (prevents in-flight message loss)
  6. Entity handlers implement idempotent pattern via `SqlMessageStorage.saveRequest` deduplication
  7. Dedicated DB connection for RunnerStorage (prevents shard lock loss from connection recycling)
  8. `ClusterError` type guards used for typed error handling (no `instanceof` checks)
**Plans**: 3 plans

Plans:
- [ ] 01-01-PLAN.md - ClusterService facade, ClusterError, Entity schema
- [ ] 01-02-PLAN.md - Entity layer, SQL storage backends, sharding config
- [ ] 01-03-PLAN.md - Cluster metrics integration with MetricsService

### Phase 2: Context Integration
**Goal**: Request handlers access shard ID, runner ID, and leader status via standard Context.Request pattern. Middleware populates context; handlers consume.
**Depends on**: Phase 1
**Requirements**: CLUS-04
**Effect APIs**: `Sharding.getShardId`, `isEntityOnLocalRunner`, `FiberRef`, `Context.Request`
**Success Criteria** (what must be TRUE):
  1. Handler accesses `Context.Request.cluster.shardId` with branded type (not loose string)
  2. Handler accesses `Context.Request.cluster.runnerId` for observability tagging
  3. Handler accesses `Context.Request.cluster.isLeader` for conditional logic
  4. Context population occurs in middleware with no handler boilerplate
**Plans**: TBD

Plans:
- [ ] 02-01: TBD

### Phase 3: Singleton & Scheduling
**Goal**: Scheduled tasks and leader-only processes execute exactly once across cluster regardless of pod count. External state (DB-backed) for singleton recovery, not in-memory Effect state.
**Depends on**: Phase 2
**Requirements**: CLUS-03
**Effect APIs**: `Singleton.make`, `ClusterCron.make`, `Snowflake.Generator`, `skipIfOlderThan`
**Success Criteria** (what must be TRUE):
  1. Cron job configured for 1-minute interval fires exactly once per minute with 3+ pods running
  2. Leader-only process migrates to surviving pod within 30 seconds after leader pod death
  3. Singleton cold start uses external state (DB-backed, not in-memory Effect state) for recovery
  4. Snowflake IDs generated cluster-wide without collisions
  5. `ClusterCron` uses `skipIfOlderThan` for late execution handling (no accumulated job burst)
  6. Singleton external state design explicit (DB-backed state loaded on startup, not reconstructed from events)
**Plans**: TBD

Plans:
- [ ] 03-01: TBD

### Phase 4: Job Processing
**Goal**: Jobs process via Entity mailbox dispatch with instant delivery instead of DB poll loops. Old jobs.ts gut + replace; JobService interface unchanged for consumers.
**Depends on**: Phase 3
**Requirements**: JOBS-01
**Effect APIs**: `Entity.make("Job", [...])`, `Sharding.send`, `mailboxCapacity`, `MessageState`, `defectRetryPolicy`, `Schedule`, `Match.type`
**Success Criteria** (what must be TRUE):
  1. Job submission to processing latency under 50ms (no poll interval)
  2. JobService interface unchanged for existing callers (same `submit`/`schedule` API)
  3. In-flight jobs survive pod restart via message persistence (SqlMessageStorage)
  4. No `SELECT FOR UPDATE` or poll loop in jobs.ts (gut + replace complete)
  5. File under 225 LOC with polymorphic `submit` handling single/batch
  6. `defectRetryPolicy` with exponential+jitter configured via `Schedule.compose` (exponential, jitter, cap)
  7. Job result handling uses `Match.type` exhaustively (no if/else chains)
  8. Migration: existing JobService interface unchanged for consumers (drop-in replacement)
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

### Phase 5: EventBus & Reliability
**Goal**: Domain events publish reliably with at-least-once delivery and automatic deduplication. Transactional outbox via Activity.make + DurableDeferred.
**Depends on**: Phase 4
**Requirements**: EVNT-01, EVNT-02, EVNT-04
**Effect APIs**: `Entity.make` for routing, `Activity.make`, `DurableDeferred`, `SqlMessageStorage.saveRequest`, `Schema.TaggedRequest`
**Success Criteria** (what must be TRUE):
  1. Event emitted in handler reaches all subscribers across cluster within 200ms
  2. Event publishes only after database transaction commits (no phantom events on rollback)
  3. Duplicate event delivery returns `Duplicate` status without handler re-execution
  4. EventBus exports typed domain event contracts via Schema (not untyped JSON)
  5. Single polymorphic `emit` function handles single event or batch
  6. Event emission wrapped in `Activity.make` for replay-safe idempotency
  7. Transactional outbox uses `DurableDeferred` for commit acknowledgment (event waits for DB commit)
**Plans**: TBD

Plans:
- [ ] 05-01: TBD

### Phase 6: Workflows & State Machines
**Goal**: Multi-step processes automatically compensate on failure; entity lifecycles are explicit and recoverable. All compensation logic wrapped in Activity.make. No if/else chains in state transitions.
**Depends on**: Phase 5
**Requirements**: EVNT-03, EVNT-05
**Effect APIs**: `Workflow.make`, `Activity.make`, `withCompensation`, `ClusterWorkflowEngine.layer`, `Machine.makeSerializable`, `Machine.procedures.make`, `Match.type`
**Success Criteria** (what must be TRUE):
  1. Saga with 3 steps compensates steps 1-2 when step 3 fails (verified via test)
  2. Workflow state persists across pod restarts (DurableDeferred acknowledgment)
  3. Entity state machine serializes current state to database (recoverable after restart)
  4. State transitions use `Match.type` exhaustively (no if/else chains, no unhandled cases)
  5. Workflow code contains no non-deterministic operations (timestamps, random via Activities)
  6. Compensation handlers MUST wrap in `Activity.make` (prevents re-execution on replay)
  7. Machine state schemas derive types via `typeof StateSchema.Type` (no separate type declarations)
**Plans**: TBD

Plans:
- [ ] 06-01: TBD

### Phase 7: Real-Time Delivery
**Goal**: Events reach connected clients in real-time regardless of which pod they connected to. RpcGroup as shared contract. MsgPack serialization for efficiency.
**Depends on**: Phase 6
**Requirements**: STRM-01, STRM-02, WS-01, WS-02, WS-03, JOBS-02
**Effect APIs**: `StreamingService.sse()`, `handleRaw()`, `Socket.run`, `RpcServer.toHttpAppWebsocket`, `RpcGroup.make`, `RpcSerialization.layerMsgPack`, `RpcMiddleware.Tag`, `Sharding.broadcaster`, `DurableQueue.worker`, `Activity.retry`
**Success Criteria** (what must be TRUE):
  1. SSE endpoint streams events with 30s heartbeat through proxy (connection stays alive)
  2. SSE backpressure prevents OOM on slow clients (sliding buffer verified)
  3. WebSocket client reconnects automatically within 5 seconds after disconnect
  4. WebSocket messages validate against Schema (invalid messages rejected with typed error)
  5. Event published on Pod A reaches SSE/WebSocket clients on Pod B within 200ms
  6. Webhook delivery retries 3x with exponential backoff, then dead-letters
  7. All real-time services use `Sharding.broadcaster` for cross-pod fan-out (no Redis pub/sub)
  8. `RpcSerialization.layerMsgPack` for binary efficiency (not JSON serialization)
  9. `RpcMiddleware.Tag` for auth context injection (no manual header parsing)
  10. `RpcGroup` as shared contract between server/client (packages/shared export)
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD
- [ ] 07-03: TBD

### Phase 8: Health & Observability
**Goal**: Kubernetes can determine pod health and route traffic only to ready instances. Cluster metrics integrate with existing MetricsService pattern.
**Depends on**: Phase 7
**Requirements**: HLTH-01, HLTH-02
**Effect APIs**: `Effect.all({ db, cache, cluster }, { concurrency: "unbounded" })`, `Effect.timeout`, `HttpApiGroup.make("health")`, `RunnerHealth.layerK8s`, `ClusterMetrics`, `MetricsService.label`
**Success Criteria** (what must be TRUE):
  1. `/health` endpoint returns aggregate status of all dependencies with per-dependency latency
  2. `/health/live` returns 200 when process runs (liveness probe)
  3. `/health/ready` returns 200 only when all dependencies healthy (readiness probe)
  4. Unhealthy dependency causes readiness failure within 10 seconds (not stale cache)
  5. Cluster metrics (shard count, message throughput) exported to existing metrics infrastructure
  6. `ClusterMetrics` gauges integrated with existing `MetricsService.label` pattern (no parallel metrics system)
  7. `Effect.timeout` on readiness checks prevents K8s probe failures from slow dependencies
**Plans**: TBD

Plans:
- [ ] 08-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Cluster Foundation | 0/3 | Planning complete | - |
| 2. Context Integration | 0/TBD | Not started | - |
| 3. Singleton & Scheduling | 0/TBD | Not started | - |
| 4. Job Processing | 0/TBD | Not started | - |
| 5. EventBus & Reliability | 0/TBD | Not started | - |
| 6. Workflows & State Machines | 0/TBD | Not started | - |
| 7. Real-Time Delivery | 0/TBD | Not started | - |
| 8. Health & Observability | 0/TBD | Not started | - |

---
*Roadmap created: 2026-01-28*
*Depth: comprehensive (8 phases)*
*Coverage: 18/18 v1 requirements mapped*
