# Cluster-Native Server Infrastructure

## What This Is

Unified cluster-native backend infrastructure for multi-tenant monorepo deployment. Replaces ad-hoc DB-locked job queues with @effect/cluster sharding, adds distributed EventBus with outbox/sagas, and enables horizontal scaling with cross-pod real-time messaging. Targets hundreds of independent apps deployed to Kubernetes clusters.

## Core Value

**Apps can deploy multi-pod with zero coordination code** — cluster sharding, distributed events, and cross-pod real-time work automatically via unified infrastructure layer.

## Requirements

### Validated

- ✓ Multi-tenant request context (Context.Request) — existing
- ✓ Circuit breaker resilience (Circuit) — existing
- ✓ Redis-backed caching (CacheService) — existing
- ✓ Full observability stack (Telemetry, Metrics) — existing
- ✓ Crypto/security primitives (Crypto, ReplayGuard) — existing

### Active

- [ ] **CLUS-01**: Cluster coordination via @effect/cluster (sharding, pods, presence)
- [ ] **CLUS-02**: Distributed locking (replaces DB SELECT FOR UPDATE pattern)
- [ ] **CLUS-03**: Leader election for singleton processes
- [ ] **CLUS-04**: Context.Request extended with cluster state (shard ID, node ID, leader status)
- [ ] **EVNT-01**: EventBus with typed domain events (Schema-based contracts)
- [ ] **EVNT-02**: Transactional outbox for reliable event publishing
- [ ] **EVNT-03**: Saga orchestration via @effect/workflow
- [ ] **EVNT-04**: Event idempotency (deduplication via Redis-backed keys)
- [ ] **EVNT-05**: State machines via @effect/experimental/Machine
- [ ] **JOBS-01**: Distributed job processing via cluster sharding (replaces DB polling)
- [ ] **JOBS-02**: Webhook delivery with retry/dead-letter (built on EventBus)
- [ ] **STRM-01**: StreamingService refactored to pure SSE/format delivery
- [ ] **STRM-02**: Pub/sub delegated to EventBus (not internal channels)
- [ ] **WS-01**: WebSocket service via @effect/platform Socket
- [ ] **WS-02**: Typed RPC over WebSocket via @effect/rpc
- [ ] **WS-03**: Cross-pod message fan-out via cluster messaging
- [ ] **HLTH-01**: Aggregated health checks (Redis, Postgres, S3, cluster)
- [ ] **HLTH-02**: K8s readiness/liveness probe support

### Out of Scope

- Per-tenant quotas/billing integration — defer to later milestone, would extend existing rate-limits
- Multi-region tenant routing — defer, requires geo-routing infrastructure
- Feature flags service — defer, would be cache-backed tenant config in Context
- CPU-offload worker threads — Effect doesn't have native support, wrap if needed later

## Context

**Existing Infrastructure (Solid):**
- `context.ts` — Multi-tenant FiberRef, session state, request context
- `middleware.ts` — Auth, rate limiting, tenant resolution
- `platform/cache.ts` — Redis-backed persistence, cross-instance invalidation
- `platform/streaming.ts` — SSE, channels, broadcast (to be refactored)
- `infra/jobs.ts` — DB-backed queue with SELECT FOR UPDATE (to be replaced)
- `observe/telemetry.ts` — OTLP export, intelligent span
- `observe/metrics.ts` — Polymorphic label function, unified tracking
- `utils/circuit.ts` — Cockatiel-based circuit breaker
- `utils/resilience.ts` — Bulkhead, timeout, hedge, retry

**Effect Ecosystem Available:**
- `@effect/cluster` — Sharding, Pods, Presence, MessageState, Singleton
- `@effect/workflow` — Durable execution, sagas, compensation
- `@effect/experimental` — Machine (FSM), EventStore
- `@effect/platform` — Socket, HttpClient
- `@effect/rpc` — Typed request/response over transport
- `@effect/sql-pg` — PostgreSQL client (existing)

**Architecture:**
```
ClusterService (infra/cluster.ts) — @effect/cluster foundation
    │
    ├── Context.Request (extended) — cluster state per-request
    │
    └── EventBus (infra/events.ts) — distributed pub/sub, outbox, sagas
            │
            ├── JobService (infra/jobs.ts) — thin facade, sharding-based
            │
            ├── StreamingService (platform/streaming.ts) — SSE delivery only
            │
            └── WebSocketService (platform/websocket.ts) — WS delivery + RPC

HealthService (observe/health.ts) — aggregated dependency checks
```

## Constraints

- **LOC**: Each file <225 lines — enforces density, no padding
- **Export**: Single const+namespace merge per file — `export { X }` pattern
- **Polymorphic**: No `get`/`getMany`, `emit`/`emitBatch` — one function handles all cases
- **Types**: No loose types — branded, schema-derived, or properly constrained
- **Comments**: Minimal — code is self-documenting via types and naming
- **Imports**: 100% Effect ecosystem usage — research must enumerate ALL relevant APIs
- **Integration**: Extend existing Context/Middleware — no parallel patterns
- **Migration**: Gut + replace — old code doesn't dictate new code

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| @effect/cluster as foundation | Native distributed coordination vs DIY DB locks | ✓ Confirmed |
| Extend Context.Request with cluster state | Consistent access pattern, per-request context | ✓ Confirmed |
| Gut + replace jobs.ts | Poll-based queue incompatible with Entity model | ✓ Confirmed |
| Keep cache.ts rate limiting | DurableRateLimiter is workflow-context only | ✓ Confirmed |
| Keep streaming.ts for SSE | Add Entity routing for cross-pod, keep local delivery | ✓ Confirmed |
| EventBus owns pub/sub | StreamingService becomes pure delivery, single source of truth | ✓ Confirmed |
| <225 LOC constraint | Enforces algorithmic density, prevents helper spam | ✓ Confirmed |

---
*Last updated: 2026-01-28 after requirements definition*
