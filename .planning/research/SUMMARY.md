# Project Research Summary

**Project:** Cluster-Native Server Infrastructure
**Domain:** Distributed systems / Multi-tenant backend
**Researched:** 2026-01-28
**Confidence:** HIGH

## Executive Summary

The Effect ecosystem provides a complete cluster-native infrastructure stack that directly addresses all 17 active requirements without hand-rolling distributed primitives. `@effect/cluster` replaces DB-locked job queues with Entity-based message dispatch, consistent-hash sharding, and advisory-lock shard ownership. `@effect/workflow` provides saga orchestration with compensation. `@effect/rpc` enables typed WebSocket communication with MsgPack serialization.

The recommended approach: **extend existing patterns, gut jobs.ts**. Context.Request gains ClusterState, cache.ts rate limiting stays (correct for API boundaries), streaming.ts keeps SSE delivery (cross-pod handled via Sharding.broadcaster). The DB-polling JobService is fundamentally incompatible with Entity model and must be fully replaced.

Key risk: Advisory locks require stable DB connections. Connection pooling with aggressive recycling breaks shard ownership. Mitigate via dedicated connection for RunnerStorage and explicit mailbox capacity to prevent OOM.

## Key Findings

### Recommended Stack

Core technologies verified across 7 research files:

- `@effect/cluster` (v0.56.1): Entity sharding, SqlMessageStorage, SqlRunnerStorage, Singleton, ClusterCron, Snowflake — replaces all distributed coordination DIY
- `@effect/workflow` (v0.16.0): Workflow.make, Activity, withCompensation, DurableClock, DurableDeferred — saga orchestration
- `@effect/rpc` (v0.73.0): RpcGroup, RpcServer.toHttpAppWebsocket, RpcSerialization.layerMsgPack — typed WebSocket RPC
- `@effect/experimental` (v0.58.0): Machine for FSM, existing RateLimiter/Redis integration (cache.ts already uses this)
- `@effect/platform` (v0.94.2): Socket, MsgPack.duplexSchema, HttpApiBuilder — existing patterns continue

### Architecture Decisions (Confirmed)

| Decision | Outcome | Research File |
|----------|---------|---------------|
| @effect/cluster as foundation | **CONFIRMED** — Entity dispatch, shard coordination, no ShardManager needed | CLUSTER.md |
| Extend Context.Request | **CONFIRMED** — Add ClusterState (shardId, runnerId, isLeader, entityType, entityId) | INTEGRATION.md |
| Gut + replace jobs.ts | **CONFIRMED** — Poll-based queue incompatible with Entity model | INTEGRATION.md |
| Keep cache.ts rate limiting | **CONFIRMED** — DurableRateLimiter is workflow-context only | WORKFLOW.md, EXPERIMENTAL.md |
| Keep streaming.ts for SSE | **CONFIRMED** — Add Entity routing for cross-pod, keep local delivery | PLATFORM-REALTIME.md |
| <225 LOC constraint | **CONFIRMED** — Dense patterns documented in INTEGRATION.md | INTEGRATION.md |

### Don't Hand-Roll (Consolidated)

| Problem | Use Instead | Source |
|---------|-------------|--------|
| Distributed locks | Shard ownership via SqlRunnerStorage | CLUSTER.md |
| Leader election | Singleton.make | CLUSTER.md |
| Job queues | Entity message handlers | CLUSTER.md |
| Cross-pod messaging | Sharding.send / broadcaster | CLUSTER.md, PLATFORM-REALTIME.md |
| Unique IDs | Snowflake.Generator | CLUSTER.md |
| Scheduled tasks | ClusterCron.make | CLUSTER.md |
| Workflow persistence | ClusterWorkflowEngine.layer | WORKFLOW.md |
| Activity idempotency | Activity.make + idempotencyKey | WORKFLOW.md |
| Compensation ordering | Workflow.withCompensation | WORKFLOW.md |
| WS message routing | RpcServer.layerProtocolWebsocket | RPC.md |
| Request/response correlation | Built into RpcMessage | RPC.md |
| Stream serialization | RpcSchema.Stream + RpcSerialization | RPC.md |
| Binary WS messaging | MsgPack.duplexSchema | PLATFORM-REALTIME.md |
| SSE streaming | StreamingService.sse() | PLATFORM-HTTP.md |
| State machines | Machine.makeSerializable | EXPERIMENTAL.md |
| L1/L2 cache | PersistedCache | EXPERIMENTAL.md |

### File Migration Plan

| File | Action | Rationale |
|------|--------|-----------|
| context.ts | EXTEND | Add `cluster: Option.Option<ClusterState>` |
| middleware.ts | EXTEND | Populate cluster context in makeRequestContext |
| cache.ts | KEEP | Rate limiting correct for API boundaries |
| streaming.ts | KEEP | SSE delivery stays; Entity routing for cross-pod |
| jobs.ts | GUT+REPLACE | Entity dispatch replaces poll-based queue |
| telemetry.ts | KEEP | OTLP export sufficient; cluster adds auto spans |
| metrics.ts | EXTEND | Add cluster metrics namespace |
| circuit.ts | KEEP | Cockatiel still useful for external calls |

### Critical Pitfalls

1. **Unstable DB connections break shard locks** — Advisory locks require persistent connections. Use dedicated connection for RunnerStorage.
2. **Entity mailbox overflow** — Default unbounded can OOM. Set explicit `mailboxCapacity` in toLayer options.
3. **Forgetting idempotency** — Messages may redeliver. Handlers must be idempotent or use saveRequest deduplication.
4. **Non-deterministic workflow code** — Random values, timestamps in workflow body cause replay divergence. Use Activities.
5. **Compensation without Activities** — Compensating effects re-execute on replay. Wrap in Activity.make.
6. **Missing graceful shutdown** — Without `preemptiveShutdown: true`, in-flight messages lost. Enable in K8s.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Cluster Foundation
**Rationale:** Everything depends on cluster coordination layer
**Delivers:** ClusterService with SqlMessageStorage, SqlRunnerStorage, ShardingConfig
**Addresses:** CLUS-01 (cluster coordination)
**Avoids:** Unstable connections via dedicated pool

### Phase 2: Context & Middleware Integration
**Rationale:** Subsequent phases need cluster state in request context
**Delivers:** Context.Request.ClusterState, middleware population
**Addresses:** CLUS-04 (context extension)
**Uses:** Sharding.getShardId, isEntityOnLocalRunner

### Phase 3: Singleton & Leader Election
**Rationale:** Cron jobs and leader-only processes need this before jobs
**Delivers:** Singleton.make integration, ClusterCron.make
**Addresses:** CLUS-03 (leader election)
**Avoids:** Singleton cold start via external state design

### Phase 4: JobService Migration
**Rationale:** Core functionality replacement, blocks EventBus work
**Delivers:** Entity-based job dispatch, same JobService interface
**Addresses:** JOBS-01 (distributed jobs), CLUS-02 (distributed locking)
**Uses:** Entity.make, Sharding.send, MessageStorage

### Phase 5: EventBus & Sagas
**Rationale:** Depends on cluster for cross-pod events
**Delivers:** EventBus with outbox pattern, saga orchestration
**Addresses:** EVNT-01 (EventBus), EVNT-02 (outbox), EVNT-03 (sagas), EVNT-04 (idempotency)
**Uses:** Workflow.make, withCompensation, DurableDeferred

### Phase 6: State Machines
**Rationale:** Complex entity lifecycles after core eventing works
**Delivers:** Machine-based entity FSM patterns
**Addresses:** EVNT-05 (state machines)
**Uses:** Machine.makeSerializable, serializable state

### Phase 7: WebSocket Service
**Rationale:** Needs EventBus for cross-pod fan-out
**Delivers:** WebSocketService with RpcGroup, cross-pod messaging
**Addresses:** WS-01 (WebSocket), WS-02 (typed RPC), WS-03 (cross-pod), STRM-01, STRM-02
**Uses:** RpcServer.toHttpAppWebsocket, Sharding.broadcaster

### Phase 8: Webhook Delivery
**Rationale:** Built on EventBus and job infrastructure
**Delivers:** Webhook delivery with retry/dead-letter
**Addresses:** JOBS-02 (webhooks)
**Uses:** Entity handlers, DurableQueue

### Phase 9: Health & Observability
**Rationale:** Final integration, needs all services running
**Delivers:** HealthService, K8s probes, ClusterMetrics integration
**Addresses:** HLTH-01 (health checks), HLTH-02 (K8s probes)
**Uses:** ClusterMetrics, RunnerHealth.layerK8s

### Phase Ordering Rationale

- **Cluster first:** All distributed features depend on shard coordination
- **Context before features:** Request context propagation needed for tenant isolation
- **Singleton before jobs:** Leader election pattern established before job dispatch
- **Jobs before events:** JobService is simpler migration, validates Entity pattern
- **Events before WS:** WebSocket fan-out needs EventBus cross-pod routing
- **Health last:** Aggregates status of all services

### Research Flags

Phases needing deeper research during planning:
- **Phase 4 (Jobs):** Migration strategy for in-flight jobs during deployment
- **Phase 5 (EventBus):** Transactional outbox implementation details with existing SQL client

Phases with standard patterns (skip research-phase):
- **Phase 1 (Cluster):** Well-documented, copy patterns from CLUSTER.md
- **Phase 3 (Singleton):** Simple Singleton.make, ClusterCron.make
- **Phase 9 (Health):** Standard aggregation pattern

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Cluster APIs | HIGH | Official TypeDoc verified, multiple examples |
| Workflow APIs | MEDIUM | Alpha package, limited production examples |
| RPC APIs | HIGH | Official docs, existing HttpApiGroup pattern match |
| Integration | HIGH | Codebase patterns clear, extension straightforward |
| Migration | MEDIUM | Jobs migration strategy needs validation |

**Overall confidence:** HIGH

### Gaps to Address

- **In-flight job migration:** How to drain existing DB queue during deployment — validate via staging
- **Transactional outbox:** Exact SQL pattern for outbox with existing PgClient — may need custom Activity
- **Workflow schema versioning:** Migration strategy for long-running workflows when schemas change

## Sources

### Primary (HIGH confidence)
- CLUSTER.md — Entity, Sharding, SqlMessageStorage, SqlRunnerStorage, Singleton, ClusterCron
- WORKFLOW.md — Workflow, Activity, DurableClock, withCompensation, DurableRateLimiter analysis
- RPC.md — RpcGroup, RpcServer, RpcClient, RpcMiddleware, RpcSerialization
- PLATFORM-REALTIME.md — Socket, MsgPack, Sharding.broadcaster integration
- PLATFORM-HTTP.md — HttpApiBuilder, handleRaw, StreamingService.sse patterns
- EXPERIMENTAL.md — Machine, RateLimiter/Redis, PersistedCache, VariantSchema
- INTEGRATION.md — Context extension, file migration plan, Effect patterns

### Official Documentation
- https://effect-ts.github.io/effect/cluster/
- https://effect-ts.github.io/effect/workflow/
- https://effect-ts.github.io/effect/rpc/
- https://effect-ts.github.io/effect/platform/
- https://effect-ts.github.io/effect/experimental/

### Codebase Verification
- packages/server/src/context.ts — FiberRef patterns confirmed
- packages/server/src/platform/cache.ts — RateLimiter/Redis already integrated
- packages/server/src/platform/streaming.ts — SSE delivery confirmed
- packages/server/src/infra/jobs.ts — Poll-based queue confirmed for replacement

---
*Research completed: 2026-01-28*
*Ready for roadmap: yes*
