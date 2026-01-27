# Roadmap: HTTP Foundation Refactor

## Overview

Consolidate the existing 7-layer architecture into a clean 4-layer structure while maximizing official Effect platform APIs for cookies, SSE encoding, caching, and worker pools. This refactor reduces cognitive load, eliminates hand-rolled patterns, and establishes the foundation for horizontal scaling via Effect Cluster without breaking existing functionality.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Platform API Adoption** - Create CacheService and StreamingService following MetricsService pattern
- [ ] **Phase 2: Layer Architecture Consolidation** - Restructure 7 layers into 4 clean boundaries
- [ ] **Phase 3: Advanced Platform Features** - Add worker pools and unified caching

## Phase Details

### Phase 1: Platform API Adoption (REVISED 2026-01-27)
**Goal**: Create proper Effect.Service implementations for CacheService and StreamingService following the polymorphic pattern established in MetricsService. Full migration of consumers.
**Depends on**: Nothing (first phase)
**Requirements**: CACHE-01, STREAM-01, RESILIENCE-01 (integrated)
**Success Criteria** (what must be TRUE):
  1. CacheService is Effect.Service class with L1 (memory) / L2 (Redis) architecture
  2. CacheService auto-scopes by tenant/user from FiberRef context — consumers never pass namespace
  3. CacheService provides single `get()` with internal resilience, metrics, lookup, sliding expiration
  4. CacheService absorbs rate limiting — no separate RateLimit.apply needed
  5. StreamingService is Effect.Service class with `sse()`, `download()`, `export()` entry points
  6. StreamingService has intelligent backpressure defaults per type (no consumer config)
  7. StreamingService always tracks metrics automatically via MetricsService
  8. rate-limit.ts and totp-replay.ts refactored to use CacheService (shared Redis client)
  9. All code follows polymorphic unity pattern — no loose const/function spam, max 1 helper per file
**Plans**: 3 plans in 2 waves

Plans:
- [ ] 01-01-PLAN.md — Create CacheService with L1/L2 architecture (Wave 1)
- [ ] 01-02-PLAN.md — Create StreamingService with unified streaming API (Wave 1)
- [ ] 01-03-PLAN.md — Migrate consumers and delete absorbed files (Wave 2)

### Phase 2: Layer Architecture Consolidation
**Goal**: Restructure 7 layers into 4 clean boundaries with clear dependency direction and no circular references
**Depends on**: Phase 1
**Requirements**: LAYER-01, LAYER-02, HTTP-01, HTTP-04, STREAM-01
**Success Criteria** (what must be TRUE):
  1. main.ts composes exactly 4 layers: Platform → Infra → Domain → HTTP
  2. All HTTP concerns (context, middleware, errors, cookies) import from single consistent location
  3. Tenant isolation propagates correctly via FiberRef through all middleware and services
  4. Rate limit state (remaining quota, retry-after) accessible in request context without per-handler computation
  5. All streaming operations (file export, SSE, AI responses) use consistent Effect Stream pattern
**Plans**: TBD

Plans:
- TBD (populated during planning phase)

### Phase 3: Advanced Platform Features
**Goal**: Add CPU offload via worker pools and unified cache abstraction for backend flexibility
**Depends on**: Phase 2
**Requirements**: CACHE-02, WORKER-01, WORKER-02
**Success Criteria** (what must be TRUE):
  1. Transfer parsing (xlsx, zip, csv) executes in worker pool off main thread
  2. API health endpoint responds under 100ms during heavy transfer parsing operations
  3. Session/token cache entries have compile-time type validation via KeyValueStore.forSchema
  4. Single KeyValueStore interface allows swapping between memory and Redis backends via Layer
**Plans**: 4 plans in 4 waves

Plans:
- [ ] 03-01-PLAN.md — RPC contract schemas + CacheService forSchema extension (Wave 1)
- [ ] 03-02-PLAN.md — Worker script with RPC server for transfer parsing (Wave 2)
- [ ] 03-03-PLAN.md — WorkerPoolService main thread service (Wave 3)
- [ ] 03-04-PLAN.md — Integration and health endpoint verification (Wave 4)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Platform API Adoption | 0/3 | Planned (3 plans, 2 waves) | - |
| 2. Layer Architecture Consolidation | 0/TBD | Not started | - |
| 3. Advanced Platform Features | 0/4 | Planned (4 plans, 4 waves) | - |

---
*Last updated: 2026-01-27 after Phase 3 planning complete*
