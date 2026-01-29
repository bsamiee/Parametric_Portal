# Requirements: Cluster-Native Server Infrastructure

**Defined:** 2026-01-28
**Core Value:** Apps deploy multi-pod with zero coordination code

## Quality Standards

Implementation must adhere to these constraints across all deliverables:

| Standard | Rule | Rationale |
|----------|------|-----------|
| **Density** | <225 LOC per file | Forces algorithmic thinking, prevents helper spam |
| **Export** | Single `const` + `namespace` merge | `export { X }` pattern, one public surface per file |
| **Polymorphic** | One function handles all arities | No `get`/`getMany`, `emit`/`emitBatch` — use overloads or union inputs |
| **Types** | Branded, schema-derived, or constrained | No `any`, no loose `string` where `TenantId` applies |
| **Functional** | No imperative control flow | No `if`/`else` chains — use `Match.type`, ternary, dispatch tables |
| **Private** | Prefix internal symbols with `_` | `_ref`, `_default`, `_boundaries` — not exported |
| **Effect-only** | 100% Effect ecosystem | No mixing async/await, no hand-rolled primitives |
| **Extend** | Augment existing patterns | No parallel implementations — extend Context, Middleware, etc. |

---

## v1 Requirements

### Cluster Coordination

Foundation layer enabling distributed infrastructure.

- [ ] **CLUS-01**: App deploys multi-pod with automatic shard coordination and message routing
  - Why: Zero coordination code in apps — cluster handles entity distribution automatically
  - Uses: `NodeClusterSocket.layer`, `Entity.make`, `SqlMessageStorage.layer`, `SqlRunnerStorage.layer` (storage via Layer.provide)
  - File: `infra/cluster.ts`

- [ ] **CLUS-02**: Work claims via shard ownership instead of DB row locking
  - Why: Advisory locks scale better than `SELECT FOR UPDATE SKIP LOCKED`, automatic failover on pod death
  - Uses: `SqlRunnerStorage.acquire` (automatic via cluster layer)
  - Replaces: `SELECT FOR UPDATE SKIP LOCKED` in jobs.ts
  - File: Implicit via ClusterService

- [ ] **CLUS-03**: Scheduled task runs exactly once across cluster regardless of pod count
  - Why: Cron jobs and leader-only processes must not duplicate execution
  - Uses: `Singleton.make`, `ClusterCron.make`
  - Replaces: Manual leader election, external cron daemons
  - File: `infra/cluster.ts`

- [ ] **CLUS-04**: Handler accesses shard ID, runner ID, and leader status via request context
  - Why: Request-scoped cluster awareness enables routing decisions and observability
  - Uses: `Sharding.getShardId`, `isEntityOnLocalRunner`
  - Extends: `context.ts` Data interface with `cluster: Option<ClusterState>`
  - File: `context.ts`, `middleware.ts`

### Event Infrastructure

Typed domain events with reliability guarantees.

- [ ] **EVNT-01**: Handler emits typed domain events that route to subscribers across cluster
  - Why: Decouples producers from consumers, enables cross-pod event delivery
  - Uses: `Entity.make` for routing, `Rpc.make` for typed contracts
  - Replaces: Ad-hoc PubSub patterns in streaming.ts
  - File: `infra/events.ts`

- [ ] **EVNT-02**: Event publishes only after database transaction commits successfully
  - Why: Prevents phantom events on rollback, ensures consistency between state and events
  - Uses: `Activity.make` with SQL transaction, `DurableDeferred` for acknowledgment
  - Replaces: Fire-and-forget event emission
  - File: `infra/events.ts`

- [ ] **EVNT-03**: Multi-step process automatically compensates prior steps on failure
  - Why: Distributed transactions need rollback; manual compensation logic is error-prone
  - Uses: `Workflow.make`, `withCompensation`, `Workflow.addFinalizer`, `ClusterWorkflowEngine.layer`
  - Pattern: Compensation handlers wrap in `Activity.make`; preserve Cause structure (no flattening)
  - Replaces: Manual rollback logic scattered across handlers
  - File: `infra/workflows.ts`

- [ ] **EVNT-04**: Duplicate event delivery does not cause duplicate side effects
  - Why: At-least-once delivery requires idempotent handlers; deduplication prevents double-processing
  - Uses: `SqlMessageStorage.saveRequest` returns `Success | Duplicate`
  - Replaces: Manual Redis-based deduplication
  - File: Implicit via EventBus handlers

- [ ] **EVNT-05**: Entity state transitions are serializable and recoverable after pod restart
  - Why: Complex lifecycles need explicit state; implicit DB column state is fragile
  - Uses: `Machine.makeSerializable`, `Machine.procedures.make`, `KeyValueStore.layerSchema` (simple state), `Persistence.layerResult` (Exit storage with TTL)
  - Replaces: Implicit state via DB columns
  - File: Per-domain entity files

- [ ] **EVNT-06**: Workflow payload schemas support backward-compatible evolution
  - Why: Long-running workflows (days/weeks) may span schema changes
  - Uses: `S.optional` for new fields, `S.Union` for versioned types
  - Pattern: `S.Union(PayloadV1, PayloadV2)` accepts both versions
  - File: Per-workflow schema definitions

### Job Processing

Distributed work execution replacing DB-polling queues.

- [ ] **JOBS-01**: Handler processes jobs via message dispatch without DB polling
  - Why: Poll loops waste resources and add latency; Entity mailboxes provide instant dispatch
  - Uses: `Entity.make("Job", [...])`, `Sharding.send`, `mailboxCapacity`, `Entity.keepAlive` (batch jobs)
  - Replaces: Poll loop, `SELECT FOR UPDATE`, semaphore in jobs.ts
  - File: `infra/jobs.ts` (gut + replace)

- [ ] **JOBS-02**: Webhook delivery retries failed attempts with backoff and dead-letters undeliverable
  - Why: External endpoints fail transiently; retries with backoff prevent thundering herd
  - Uses: `DurableQueue.worker`, `Activity.retry({ times: N })`, `Activity.raceAll` for timeout+fallback
  - Pattern: Primary delivery races against dead-letter timeout; first to complete wins
  - Replaces: Custom webhook retry logic
  - File: `infra/webhooks.ts`

### Streaming & Delivery

Real-time message delivery to connected clients.

- [ ] **STRM-01**: SSE endpoint streams events to client with heartbeat and backpressure
  - Why: Keeps connection alive through proxies, prevents memory exhaustion on slow clients
  - Uses: `StreamingService.sse()`, `handleRaw()` for HttpApiBuilder
  - Keeps: Existing SSE encoding, heartbeat, sliding buffer
  - File: `platform/streaming.ts` (refactor)

- [ ] **STRM-02**: Event published on one pod reaches SSE clients connected to other pods
  - Why: Users connect to any pod; events must fan out cluster-wide
  - Uses: `Sharding.broadcaster`, Entity-based event dispatch
  - Replaces: In-memory PubSub (single-pod only)
  - File: `platform/streaming.ts`, `infra/events.ts`

### WebSocket Service

Typed bidirectional communication with cross-pod fan-out.

- [ ] **WS-01**: Client connects via WebSocket with automatic reconnection on disconnect
  - Why: Persistent connections enable server push; reconnect handles network blips
  - Uses: `Socket.run`, `RpcServer.toHttpAppWebsocket`
  - File: `platform/websocket.ts`

- [ ] **WS-02**: WebSocket messages are schema-validated with typed request/response contracts
  - Why: Catches protocol errors at boundary, enables client code generation
  - Uses: `RpcGroup.make`, `RpcClient.make(RpcGroup)` (typed client), `RpcSerialization.layerMsgPack`, `RpcMiddleware`
  - Replaces: Untyped JSON message protocols
  - File: `platform/websocket.ts`

- [ ] **WS-03**: Message sent to user reaches their WebSocket regardless of which pod they connected to
  - Why: Load balancer routes users to any pod; messages must find correct connection
  - Uses: `Sharding.broadcaster`, Entity per-connection routing
  - File: `platform/websocket.ts`, `infra/events.ts`

### Health & Observability

Production readiness for Kubernetes deployment.

- [ ] **HLTH-01**: Health endpoint reports aggregate status of all dependencies with latency
  - Why: Single endpoint for monitoring; latency metrics identify slow dependencies
  - Uses: `Effect.all({ db, cache, cluster }, { concurrency: "unbounded" })`
  - Replaces: Individual health endpoints
  - File: `observe/health.ts`

- [ ] **HLTH-02**: K8s liveness probe passes when process runs; readiness probe passes when dependencies healthy
  - Why: Kubernetes restarts unhealthy pods, routes traffic only to ready pods
  - Uses: `HttpApiGroup.make("health")`, `RunnerHealth.layerK8s`
  - File: `observe/health.ts`, `api.ts`

---

## v2 Requirements

Deferred to future milestone. Tracked for planning awareness.

### Tenant Operations

- **QUOT-01**: Per-tenant rate limit quotas with billing integration
- **QUOT-02**: Usage metrics aggregation per tenant
- **FEAT-01**: Feature flags service with cache-backed tenant config

### Distribution

- **GEO-01**: Multi-region tenant routing
- **GEO-02**: Regional shard affinity

### Performance

- **PERF-01**: CPU-offload worker threads for compute-heavy operations

---

## Out of Scope

Explicitly excluded from this milestone.

| Feature | Reason |
|---------|--------|
| Per-tenant billing integration | Requires billing system integration, defer to quota milestone |
| Multi-region routing | Requires geo-routing infrastructure not yet available |
| Feature flags service | Cache-backed config is straightforward extension, not cluster-native |
| Worker threads | Effect lacks native support; if needed, wrap later |
| Custom consensus/Raft | Cluster provides Singleton; don't hand-roll leader election |
| Redis pub/sub for cross-pod | Cluster messaging is typed, traced, persistent — use that |
| Manual shard management | SqlRunnerStorage handles via advisory locks automatically |
| Custom message deduplication | Use `Rpc.make({ primaryKey })` + SqlMessageStorage |
| Manual trace propagation | Use `HttpTraceContext.toHeaders/fromHeaders` |
| Custom state machines | Use `Machine.makeSerializable` from @effect/experimental |
| Manual binary serialization | Use `MsgPack.duplexSchema` or `RpcSerialization.layerMsgPack` |

---

## Research References

Deep-dive documentation informing implementation approach.

| File | Covers | Key Patterns |
|------|--------|--------------|
| [CLUSTER.md](research/CLUSTER.md) | Entity, Sharding, SqlMessageStorage, SqlRunnerStorage, Singleton, ClusterCron, Snowflake | Entity.make, toLayer options, Sharding.send/broadcast |
| [WORKFLOW.md](research/WORKFLOW.md) | Workflow, Activity, DurableClock, DurableDeferred, compensation | Workflow.make, withCompensation, idempotencyKey |
| [RPC.md](research/RPC.md) | RpcGroup, RpcServer, RpcClient, RpcMiddleware, RpcSerialization | toHttpAppWebsocket, layerMsgPack, stream: true |
| [EXPERIMENTAL.md](research/EXPERIMENTAL.md) | Machine, RateLimiter/Redis, PersistedCache, VariantSchema | Machine.makeSerializable, procedures.make |
| [PLATFORM-REALTIME.md](research/PLATFORM-REALTIME.md) | Socket, MsgPack, Worker, Sharding.broadcaster | Socket.run, MsgPack.duplexSchema |
| [PLATFORM-HTTP.md](research/PLATFORM-HTTP.md) | HttpApiBuilder, handleRaw, StreamingService.sse | Existing patterns, SSE delivery |
| [INTEGRATION.md](research/INTEGRATION.md) | Context extension, file migration, Effect patterns | ClusterState, Effect.fn, Match, Schedule |
| [SUMMARY.md](research/SUMMARY.md) | Synthesis, phase suggestions, don't-hand-roll consolidated | Architecture decisions, pitfalls |

---

## Traceability

Maps requirements to phases. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CLUS-01 | Phase 1: Cluster Foundation | Pending |
| CLUS-02 | Phase 1: Cluster Foundation | Pending |
| CLUS-03 | Phase 3: Singleton & Scheduling | Pending |
| CLUS-04 | Phase 2: Context Integration | Pending |
| EVNT-01 | Phase 5: EventBus & Reliability | Pending |
| EVNT-02 | Phase 5: EventBus & Reliability | Pending |
| EVNT-03 | Phase 6: Workflows & State Machines | Pending |
| EVNT-04 | Phase 5: EventBus & Reliability | Pending |
| EVNT-05 | Phase 6: Workflows & State Machines | Pending |
| EVNT-06 | Phase 6: Workflows & State Machines | Pending |
| JOBS-01 | Phase 4: Job Processing | Pending |
| JOBS-02 | Phase 7: Real-Time Delivery | Pending |
| STRM-01 | Phase 7: Real-Time Delivery | Pending |
| STRM-02 | Phase 7: Real-Time Delivery | Pending |
| WS-01 | Phase 7: Real-Time Delivery | Pending |
| WS-02 | Phase 7: Real-Time Delivery | Pending |
| WS-03 | Phase 7: Real-Time Delivery | Pending |
| HLTH-01 | Phase 8: Health & Observability | Pending |
| HLTH-02 | Phase 8: Health & Observability | Pending |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0

---
*Requirements defined: 2026-01-28*
*Last updated: 2026-01-28 after roadmap creation*
