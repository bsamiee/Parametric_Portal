# Requirements: HTTP Foundation Refactor

**Milestone:** v1.0 — HTTP Foundation
**Created:** 2026-01-26
**Source:** PROJECT.md + research synthesis

## Scope Categories

### Must Have (v1)

Requirements essential for milestone completion.

#### HTTP-01: Unified HTTP Context
**Description:** Request identity (tenantId, userId, sessionId, requestId) accessible via FiberRef
**Acceptance:** All route handlers access identity without explicit parameter passing
**Source:** PROJECT.md, validated in ARCHITECTURE.md

#### HTTP-02: Typed Cookie Effects
**Description:** Cookies as typed Effects with schema validation using @effect/platform Cookies module
**Acceptance:** No manual cookie parsing; all cookies validated at boundary
**Source:** PROJECT.md, FEATURES.md table stakes

#### HTTP-03: Response Helpers
**Description:** SSE, streaming, ETags as composable functions using @effect/experimental Sse
**Acceptance:** Remove manual TextEncoder; use platform encoding
**Source:** PROJECT.md, FEATURES.md table stakes

#### HTTP-04: Rate Limit State in Context
**Description:** Remaining quota and retry-after accessible in request context
**Acceptance:** Rate limit headers populated from context, not computed per-handler
**Source:** PROJECT.md

#### LAYER-01: 4-Layer Architecture
**Description:** Consolidate 7 layers to Platform → Infra → Domain → HTTP
**Acceptance:** main.ts shows 4 layer compositions; dependency graph documented
**Source:** PROJECT.md, ARCHITECTURE.md

#### LAYER-02: Dependency Organization
**Description:** Eliminate unnecessary Default layers; clear dependency direction
**Acceptance:** No circular dependencies; lower layers never import higher
**Source:** PROJECT.md, PITFALLS.md

#### CACHE-01: Unified KeyValueStore Interface
**Description:** Memory-first cache with Redis fallback via single abstraction
**Acceptance:** Consumers use KeyValueStore API; backend swappable via Layer
**Source:** PROJECT.md, FEATURES.md competitive differentiator

#### STREAM-01: Polymorphic Streaming
**Description:** Single pattern for file export, SSE events, AI responses
**Acceptance:** All streaming uses Effect Stream with backpressure
**Source:** PROJECT.md, FEATURES.md table stakes

#### STREAM-02: Backpressure Primitives
**Description:** Explicit buffering configuration for streaming endpoints
**Acceptance:** Memory bounded under load; configurable buffer sizes
**Source:** FEATURES.md table stakes

### Should Have (v1)

Requirements that improve quality but can slip if needed.

#### CACHE-02: Schema-Validated Stores
**Description:** Type-safe cache entries via KeyValueStore.forSchema
**Acceptance:** Compile-time validation of cached values
**Source:** FEATURES.md competitive differentiator

#### WORKER-01: SerializedWorkerPool
**Description:** CPU-intensive operations (xlsx, zip, csv) off main thread
**Acceptance:** transfer.ts parsing uses worker pool; event loop unblocked
**Source:** PROJECT.md, FEATURES.md competitive differentiator

#### WORKER-02: Non-blocking API
**Description:** API responsiveness during heavy parsing operations
**Acceptance:** Health endpoint responds < 100ms during transfer parsing
**Source:** PROJECT.md

### Nice to Have (v2+)

Deferred to future milestones.

#### CLUSTER-01: Entity Pattern for Jobs
**Description:** @effect/cluster Entity for job execution replacing hand-rolled jobs.ts
**Acceptance:** Job processing distributed across nodes
**Source:** PROJECT.md, deferred per SUMMARY.md

#### CLUSTER-02: Horizontal Scaling
**Description:** ShardManager with PostgreSQL persistence for multi-node
**Acceptance:** Jobs balanced across Kubernetes pods
**Source:** PROJECT.md, deferred per SUMMARY.md

#### CACHE-03: Redis KeyValueStore Adapter
**Description:** Production Redis backend for KeyValueStore
**Acceptance:** Custom adapter implementing KeyValueStore interface
**Source:** SUMMARY.md gap — requires custom implementation

#### HTTP-05: ETag Middleware
**Description:** Automatic ETag generation for cacheable responses
**Acceptance:** 304 Not Modified for unchanged resources
**Source:** FEATURES.md optional

### Out of Scope

Explicitly excluded from this milestone.

- API contract changes (endpoints remain stable)
- Database schema modifications
- Frontend client changes
- @effect/workflow durable workflows
- Multi-region deployment
- Machine abstraction for complex workflows (experimental API)

## Dependency Graph

```
Phase 1 (API Adoption)
├── HTTP-02 (Cookies) → standalone
├── HTTP-03 (SSE) → standalone
├── STREAM-02 (Backpressure) → standalone
└── CACHE-01 (KeyValueStore) → enables CACHE-02

Phase 2 (Layer Consolidation) — requires Phase 1 complete
├── LAYER-01 (4 layers) → requires HTTP-02, HTTP-03 cleanup
├── LAYER-02 (Dependencies) → requires LAYER-01
├── HTTP-01 (Context) → requires LAYER-01
├── HTTP-04 (Rate limit) → requires LAYER-01, LAYER-02
└── STREAM-01 (Polymorphic) → requires LAYER-01

Phase 3 (Advanced Features) — requires Phase 2 complete
├── CACHE-02 (Schema stores) → requires CACHE-01
├── WORKER-01 (Pool) → requires LAYER-01
└── WORKER-02 (Non-blocking) → requires WORKER-01
```

## Research Flags

**Standard patterns (skip research):**
- HTTP-02, HTTP-03, STREAM-02: Well-documented platform APIs
- LAYER-01, LAYER-02: Clear patterns in ARCHITECTURE.md

**Needs spike during planning:**
- WORKER-01: Schema.TaggedRequest patterns, worker script setup
- CACHE-01: Redis adapter implementation details

## Success Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| Layer count | 7 | 4 |
| Cookie wrapper LOC | ~100 | 0 (use platform) |
| SSE encoding LOC | ~50 | 0 (use platform) |
| Session lookup latency | TBD | < 5ms (cached) |
| Transfer parsing blocking | Yes | No (worker pool) |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| HTTP-02 | Phase 1 | Pending |
| HTTP-03 | Phase 1 | Pending |
| STREAM-02 | Phase 1 | Pending |
| CACHE-01 | Phase 1 | Pending |
| LAYER-01 | Phase 2 | Pending |
| LAYER-02 | Phase 2 | Pending |
| HTTP-01 | Phase 2 | Pending |
| HTTP-04 | Phase 2 | Pending |
| STREAM-01 | Phase 2 | Pending |
| CACHE-02 | Phase 3 | Pending |
| WORKER-01 | Phase 3 | Pending |
| WORKER-02 | Phase 3 | Pending |

---
*Requirements derived from PROJECT.md and research synthesis*
