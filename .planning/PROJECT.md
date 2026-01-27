# HTTP Foundation Refactor

## What This Is

A fundamental restructure of `packages/server/` to create a unified HTTP foundation, consolidate scattered context/middleware/cookie patterns into cohesive modules, and enable true horizontal scaling via @effect/cluster. This is infrastructure work enabling hundreds of isolated multi-tenant apps on a single K8s cluster.

## Core Value

**Polymorphic patterns that maximize @effect/platform APIs** — every HTTP concern (context, cookies, streaming, caching) uses official Effect APIs directly, no wrappers, no hand-rolling, enabling consistent behavior across all tenant apps without code duplication.

## Requirements

### Validated

- Existing Effect-based layered architecture with Layer composition
- FiberRef-based tenant isolation via Context.Request.tenantId
- Schema.TaggedError for typed HTTP errors
- Repository factory pattern with CRUD + custom resolvers
- @effect/sql-pg for PostgreSQL with connection pooling
- MetricsService with polymorphic label pattern (target architecture example)
- Multi-provider OAuth (GitHub, Google, Apple, Microsoft)
- TOTP-based MFA with backup codes
- S3-compatible storage with multipart uploads
- Background job processing with circuit breaker

### Active

- [ ] **HTTP-01**: Unified HTTP context providing request identity (tenantId, userId, sessionId, requestId) via FiberRef
- [ ] **HTTP-02**: Cookies as typed Effects with schema validation at boundary using @effect/platform Cookies module
- [ ] **HTTP-03**: Response helpers (SSE, streaming, ETags) as composable functions using @effect/experimental Sse
- [ ] **HTTP-04**: Rate limit state accessible in request context (remaining quota, retry-after)
- [ ] **LAYER-01**: 4-layer architecture: Platform → Infra → Domain → HTTP (down from 7)
- [ ] **LAYER-02**: Eliminate unnecessary Default layers, better dependency organization
- [ ] **CACHE-01**: Unified KeyValueStore interface with memory-first, Redis fallback
- [ ] **CACHE-02**: Remove scattered redis/cache imports, single service for distributed state
- [ ] **STREAM-01**: Polymorphic streaming pattern for file export, SSE events, AI responses
- [ ] **STREAM-02**: Backpressure-aware primitives using @effect/platform
- [ ] **WORKER-01**: SerializedWorkerPool for CPU-intensive operations (xlsx, zip, csv parsing)
- [ ] **WORKER-02**: Off main thread, non-blocking API during heavy processing
- [ ] **CLUSTER-01**: @effect/cluster Entity pattern for job execution (replace hand-rolled jobs.ts)
- [ ] **CLUSTER-02**: Horizontal scaling with ShardManager and PostgreSQL persistence

### Out of Scope

- API contract changes (endpoints remain stable) — frontend regenerates from unchanged OpenAPI
- Database schema modifications (except Effect Cluster tables if needed)
- Frontend client changes
- @effect/workflow durable workflows — deferred to after cluster foundation
- Multi-region deployment — single K8s cluster with tenant isolation first

## Context

**Current State Issues:**
- 7 layers in main.ts with confusing dependency ordering (Platform → BaseInfra → RateLimit → Data → Core → Domain → HTTP)
- Scattered HTTP concerns across 4+ files: context.ts, middleware.ts, errors.ts, api.ts
- Manual cookie wrapper instead of @effect/platform Cookies
- SSE encoding with manual TextEncoder instead of @effect/experimental Sse
- Hand-rolled job queue in infra/jobs.ts duplicating @effect/cluster functionality
- Redis/cache logic scattered across files, no unified interface
- CPU-intensive xlsx/zip parsing blocks event loop

**Target State:**
- 4 clean layers: Platform → Infra → Domain → HTTP
- Single import path for HTTP concerns with polymorphic patterns
- All HTTP primitives use @effect/platform and @effect/experimental APIs directly
- Unified cache service with memory → Redis → PG fallback strategy
- Worker pools for CPU-intensive operations
- Effect Cluster for horizontally scalable job processing

**Existing Code to Maximize:**
- `observe/metrics.ts` — exemplifies target pattern: single polymorphic label function, maximizes Metric.* APIs
- `database/models.ts` — canonical schema source, semantic field naming
- FiberRef-based Context.Request pattern — keep and extend

**External APIs to Use:**
- `@effect/platform`: Cookies, HttpServerResponse, Etag, KeyValueStore, Headers
- `@effect/experimental`: Sse, SerializedWorkerPool, Transferable
- `@effect/cluster`: Entity, Sharding, SqlMessageStorage
- `@effect/opentelemetry`: Tracing spans across services
- `@effect/rpc`: Type-safe RPC between workers (if needed)

## Constraints

- **No barrel files**: Direct imports from source files, never index.ts aggregators
- **No wrappers**: Never add delegation layers over Effect APIs
- **No re-exports**: Consumers import @effect/platform directly, not via server package
- **Breaking imports acceptable**: Clean restructure, fix all consumers
- **K8s single cluster**: All tenants share infrastructure, isolated by tenant ID in Effect context
- **Existing packages**: All Effect packages already in pnpm-workspace.yaml catalog

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 4-layer architecture | Reduce cognitive load, clearer dependencies | — Pending |
| Memory-first cache with Redis fallback | Local fast path, distributed only when needed | — Pending |
| SerializedWorkerPool for parsing | Off-thread CPU work, non-blocking API | — Pending |
| Effect Cluster for jobs | Replace 200+ LOC hand-rolled queue with official APIs | — Pending |
| Single K8s cluster | Simpler ops, tenant isolation via FiberRef | — Pending |

---
*Last updated: 2026-01-26 after initialization*
