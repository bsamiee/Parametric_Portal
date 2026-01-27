# Roadmap: HTTP Foundation Refactor

## Overview

Consolidate the existing 7-layer architecture into a clean 4-layer structure while maximizing official Effect platform APIs for cookies, SSE encoding, caching, and worker pools. This refactor reduces cognitive load, eliminates hand-rolled patterns, and establishes the foundation for horizontal scaling via Effect Cluster without breaking existing functionality.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Platform API Adoption** - Replace manual patterns with official Effect APIs
- [ ] **Phase 2: Layer Architecture Consolidation** - Restructure 7 layers into 4 clean boundaries
- [ ] **Phase 3: Advanced Platform Features** - Add worker pools and unified caching

## Phase Details

### Phase 1: Platform API Adoption
**Goal**: Eliminate hand-rolled patterns by adopting official Effect platform primitives for cookies, SSE, caching, and streaming backpressure
**Depends on**: Nothing (first phase)
**Requirements**: HTTP-02, HTTP-03, STREAM-02, CACHE-01
**Success Criteria** (what must be TRUE):
  1. All SSE endpoints use @effect/experimental Sse encoder without manual TextEncoder
  2. Cookie operations use @effect/platform Cookies module with schema validation at boundary
  3. Session and app lookups use Effect.Cache for request deduplication
  4. All streaming endpoints have explicit buffer configuration preventing unbounded memory growth
**Plans**: TBD

Plans:
- TBD (populated during planning phase)

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
**Plans**: TBD

Plans:
- TBD (populated during planning phase)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Platform API Adoption | 0/TBD | Not started | - |
| 2. Layer Architecture Consolidation | 0/TBD | Not started | - |
| 3. Advanced Platform Features | 0/TBD | Not started | - |

---
*Last updated: 2026-01-26 after roadmap creation*
