# Project Research Summary

**Project:** HTTP Foundation Refactor (packages/server/)
**Domain:** Effect-based HTTP server infrastructure
**Researched:** 2026-01-26
**Confidence:** HIGH

## Executive Summary

The HTTP Foundation Refactor aims to consolidate the existing 7-layer architecture into a cleaner 4-layer structure (Platform → Infra → Domain → HTTP) while maximizing the use of official @effect/platform and @effect/experimental APIs. The research reveals that the codebase is already 80% aligned with Effect best practices, but has opportunities to eliminate hand-rolled patterns in favor of platform primitives for cookies, SSE encoding, worker pools, and caching.

The recommended approach consolidates RateLimit, Data, and Core layers into a unified Infra layer, moves business logic services (MfaService, OAuthService) from Core to Domain, and adopts platform APIs like Cookies module, KeyValueStore, and SerializedWorkerPool for CPU-intensive operations. This restructuring improves testability, dependency clarity, and sets the foundation for future Effect Cluster compatibility without breaking existing functionality.

Key risks center on preserving FiberRef propagation for tenant isolation during middleware refactoring, avoiding circular layer dependencies during consolidation, and maintaining OAuth state encryption flows during cookie API migration. These risks are mitigated by incremental refactoring with telemetry-based validation, dependency graph mapping before layer merges, and comprehensive integration testing of critical paths.

## Key Findings

### Recommended Stack

The codebase already uses current versions of the Effect ecosystem (@effect/platform 0.94.2, @effect/experimental 0.58.0, effect 3.19.15). The research identifies specific APIs to maximize and patterns to eliminate rather than suggesting new dependencies.

**Platform APIs to adopt:**
- **Cookies module** (@effect/platform/Cookies) — type-safe cookie handling with validation, replacing manual wrappers
- **KeyValueStore** (@effect/platform/KeyValueStore) — unified cache interface with swappable backends (memory/file/custom Redis)
- **SerializedWorkerPool** (@effect/platform/Worker) — CPU offload for xlsx/zip parsing that currently blocks event loop
- **Sse encoder** (@effect/experimental/Sse) — already partially used, needs cleanup of manual TextEncoder
- **Cache module** (effect/Cache) — request deduplication for session/app lookups
- **Etag.Generator** (@effect/platform/Etag) — standardized ETag generation for cacheable responses

**Critical version notes:**
- All documented APIs are stable in current versions
- Machine API is experimental, defer complex workflow migration to later phase

For detailed API references and current usage analysis, see [STACK.md](/Users/bardiasamiee/Documents/99.Github/Parametric_Portal/.planning/research/STACK.md).

### Expected Features

The refactor focuses on maximizing platform primitives rather than building new features. Research identifies table stakes (must adopt), differentiators (high value), and anti-features (must avoid).

**Must have (table stakes):**
- Typed cookies via Cookies module — security and consistency
- SSE cleanup with platform encoding — reliability
- Effect caching layer — performance and request deduplication
- Stream backpressure tuning — prevent memory growth under load

**Should have (competitive):**
- KeyValueStore abstraction — testability and backend flexibility
- SerializedWorkerPool for transfers — scalability for CPU-bound operations
- Schema-validated stores — type-safe cache entries
- ETag middleware — bandwidth savings

**Defer (v2+):**
- Effect Cluster migration — complex distributed workflows
- Machine abstraction for jobs — experimental API, wait for stabilization
- Redis KeyValueStore adapter — custom implementation needed

**Anti-features (explicitly avoid):**
- Manual byte encoding for SSE — platform handles this
- try/catch in Effect code — breaks error channel composition
- Synchronous file I/O in handlers — blocks event loop
- Manual cookie parsing — error-prone and inconsistent

For feature rationale and migration priorities, see [FEATURES.md](/Users/bardiasamiee/Documents/99.Github/Parametric_Portal/.planning/research/FEATURES.md).

### Architecture Approach

The refactor consolidates the current 7-layer structure (Platform, BaseInfra, RateLimit, Data, Core, Domain, HTTP) into 4 layers with clearer boundaries. Platform layer provides external resources (DB/S3/FileSystem), Infra layer adapts infrastructure for domain use (repositories/rate limiting/crypto), Domain layer implements business logic (session/MFA/OAuth/storage), and HTTP layer handles request concerns (routes/middleware/auth).

**Major components and reorganization:**
1. **Platform Layer** (unchanged) — Client.layer, S3ClientLayer, NodeFileSystem, Telemetry
2. **Infra Layer** (consolidates RateLimit + Data + parts of Core) — DatabaseService, StorageAdapter, RateLimit, ReplayGuard, Crypto, Metrics, Audit
3. **Domain Layer** (absorbs MfaService/OAuthService from Core) — SessionService, MfaService, OAuthService, StorageService, SearchService, JobService, PollingService
4. **HTTP Layer** (unchanged conceptually) — Routes, SessionAuth middleware, ApiLayer, ServerLayer

**Key architectural decisions:**
- FiberRef-based context propagation preserved (not Effect Context) for async safety and tenant isolation
- Service composition via Effect.Service with factory layers for dependency injection
- Dependency direction: lower layers never depend on higher (Platform ← Infra ← Domain ← HTTP)
- Scoped services for lifecycle management (JobService, PollingService with background fibers)

For layer composition patterns and FiberRef propagation details, see [ARCHITECTURE.md](/Users/bardiasamiee/Documents/99.Github/Parametric_Portal/.planning/research/ARCHITECTURE.md).

### Critical Pitfalls

Research identified pitfalls from official Effect patterns and current codebase analysis:

1. **Wrapping platform APIs unnecessarily** — context.ts cookie wrapper duplicates HttpServerResponse and Cookies module functionality. Prevention: use platform APIs directly, only wrap when adding domain logic (encryption).

2. **Breaking FiberRef propagation** — tenant isolation depends on FiberRef flowing through middleware. Prevention: never use Effect.fork without forkScoped, avoid async/await in middleware, test propagation with telemetry assertions.

3. **Circular layer dependencies** — Service A requiring Service B requiring Service A causes type errors or deadlock. Prevention: map dependencies before coding, follow layer hierarchy (Platform → Infra → Domain → HTTP), extract shared logic to separate service.

4. **Mixing async/await with Effect** — using JavaScript await inside Effect.gen breaks error tracking, interruption, and context. Prevention: wrap Promises with Effect.tryPromise, use yield* exclusively in generators, prefer Effect-native libraries.

5. **Over-granular layer composition** — current 7 layers make dependency graph hard to understand. Prevention: target 4 layers, group related services, document layer responsibilities, question each new layer.

For detailed warning signs, recovery paths, and phase-specific warnings, see [PITFALLS.md](/Users/bardiasamiee/Documents/99.Github/Parametric_Portal/.planning/research/PITFALLS.md).

## Implications for Roadmap

Based on combined research, the refactor should proceed in 3 phases with clear dependencies and risk mitigation.

### Phase 1: Platform API Adoption
**Rationale:** Low-risk cleanup with immediate value. Establishes patterns before structural changes. No layer dependencies affected.

**Delivers:**
- SSE cleanup (remove manual TextEncoder in jobs.ts)
- Cookies module alignment (refactor context.ts wrapper to use Cookies APIs)
- Cache.make integration (add request deduplication for SessionService, SearchService)
- Stream backpressure tuning (explicit buffering for SSE endpoints)

**Addresses:**
- Table stakes: typed cookies, SSE encoding, caching layer
- Anti-patterns: manual byte encoding, scattered cache logic

**Avoids:**
- Pitfall 1: wrapping platform APIs unnecessarily
- Pitfall 5: manual SSE encoding instead of platform utilities

**Implementation notes:**
- Start with SSE (lowest risk, single file)
- Cookies refactor requires OAuth flow testing
- Cache integration needs session lookup performance benchmarking

### Phase 2: Layer Architecture Consolidation
**Rationale:** Structural improvement enables Phase 3 features. Must complete before worker pools or KeyValueStore integration. Addresses maintainability debt.

**Delivers:**
- 4-layer structure (Platform → Infra → Domain → HTTP)
- RateLimit + Data layers merged into Infra
- MfaService, OAuthService moved from Core to Domain
- Dependency graph documentation
- Layer composition tests

**Uses:**
- Effect.Service composition patterns from STACK.md
- FiberRef propagation patterns from ARCHITECTURE.md
- Layer.provideMerge for dependency hierarchy

**Implements:**
- Infra layer: infrastructure adapters with no business logic
- Domain layer: business logic with no direct external system access
- Dependency direction rules from ARCHITECTURE.md

**Avoids:**
- Pitfall 2: breaking FiberRef propagation during middleware reorder
- Pitfall 3: circular layer dependencies during consolidation
- Pitfall 6: over-granular layers (reducing from 7 to 4)

**Implementation notes:**
- Map full dependency graph before merging layers
- Add telemetry assertions for tenant.id propagation
- Test OAuth flows, session validation, rate limiting after each layer change
- Verify RateLimit.Default exports RateLimiterStore for ReplayGuard

### Phase 3: Advanced Platform Features
**Rationale:** Builds on clean architecture from Phase 2. High-value optimizations that require stable foundation. Optional enhancements.

**Delivers:**
- KeyValueStore abstraction (with memory implementation, Redis adapter deferred)
- SerializedWorkerPool for xlsx/zip parsing in transfer.ts
- Schema-validated stores for session/token caching
- ETag middleware for cacheable responses (optional)

**Uses:**
- KeyValueStore.layerMemory for testing, custom Redis adapter for production
- Worker.makePoolSerialized with Schema.TaggedRequest for transfer operations
- KeyValueStore.forSchema for type-safe cache entries

**Implements:**
- CPU offload pattern for event loop protection
- Unified cache abstraction for backend flexibility
- HTTP caching semantics (ETag/If-None-Match)

**Avoids:**
- Pitfall 9: hand-rolled worker management vs. platform pool
- Pitfall 8: scattered cache logic vs. unified abstraction

**Deferred to later:**
- Effect Cluster migration (scope creep risk)
- Machine abstraction for jobs (experimental API)
- Redis KeyValueStore production adapter (custom implementation needed)

**Implementation notes:**
- Worker pool requires worker script setup and request/response schemas
- KeyValueStore needs Redis adapter implementation (not in @effect/platform)
- ETag middleware optional, evaluate bandwidth impact first

### Phase Ordering Rationale

- **Phase 1 before 2:** Platform API adoption has no layer dependencies, establishes patterns for Phase 2 refactoring, provides immediate value with low risk
- **Phase 2 before 3:** Clean architecture required for KeyValueStore/Worker integration, circular dependency risk too high without consolidation, testing strategy depends on clear layer boundaries
- **Phase 3 optional:** Advanced features not required for baseline functionality, can defer based on performance needs, KeyValueStore Redis adapter requires custom implementation

**Critical path:** Phase 1 → Phase 2 → selective Phase 3 features based on profiling

**Risk mitigation per phase:**
- Phase 1: Comprehensive OAuth flow testing, telemetry validation of SSE streams
- Phase 2: Dependency graph mapping, FiberRef propagation tests, incremental layer merges
- Phase 3: Worker pool isolation testing, cache backend swap verification

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 3 (Worker pools):** Schema.TaggedRequest patterns for transfer operations, worker script lifecycle, error propagation across worker boundary
- **Phase 3 (KeyValueStore):** Redis adapter implementation (not provided by @effect/platform), connection pooling, serialization strategy

Phases with standard patterns (skip research-phase):

- **Phase 1 (SSE cleanup):** Well-documented in STACK.md, single file change
- **Phase 1 (Cookies):** Official Cookies module documented, migration path clear
- **Phase 2 (Layer consolidation):** Clear dependency mapping in ARCHITECTURE.md, standard Layer.provideMerge patterns

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All APIs verified against official Effect documentation and current codebase usage |
| Features | HIGH | Platform primitives well-documented, current gaps identified via code analysis |
| Architecture | HIGH | Layer patterns verified in codebase, FiberRef propagation understood from context.ts |
| Pitfalls | HIGH | Based on official Effect patterns and codebase anti-pattern analysis |

**Overall confidence:** HIGH

The codebase already demonstrates strong Effect patterns, research focused on identifying incremental improvements rather than fundamental changes. All recommended APIs are in stable packages (except Machine which is explicitly deferred).

### Gaps to Address

**KeyValueStore Redis adapter:** Official @effect/platform provides memory and file implementations but not Redis. Requires custom adapter implementing KeyValueStore interface. Impact: Phase 3 delivery depends on custom implementation effort.

**Worker pool integration complexity:** Research covers API surface but not practical integration with existing transfer.ts logic. Will need spike during Phase 3 planning to estimate effort for schema definitions and worker script setup.

**Effect Cluster readiness:** ARCHITECTURE.md identifies gaps (context serialization, sharded job processing) but defers to later phase. If multi-node deployment becomes requirement, revisit research on cluster layer composition.

**Performance baselines:** Research doesn't establish current performance metrics (session lookup latency, transfer parsing duration). Phase planning should include profiling to validate optimization impact.

## Sources

### Primary (HIGH confidence)
- [Effect KeyValueStore Documentation](https://effect.website/docs/platform/key-value-store/) — cache abstraction patterns
- [Effect Managing Layers](https://effect.website/docs/requirements-management/layers/) — layer composition and dependencies
- [Effect Managing Services](https://effect.website/docs/requirements-management/services/) — service patterns and dependency injection
- [Effect Using Generators](https://effect.website/docs/getting-started/using-generators/) — Effect.gen patterns and anti-patterns
- [Effect Cookies Module](https://effect-ts.github.io/effect/platform/Cookies.ts.html) — cookie API reference
- [Effect HttpServerResponse](https://effect-ts.github.io/effect/platform/HttpServerResponse.ts.html) — streaming and response helpers
- [Effect Worker Module](https://effect-ts.github.io/effect/platform/Worker.ts.html) — worker pool construction and patterns
- [Effect Cache Documentation](https://effect.website/docs/caching/cache/) — request deduplication
- [@effect/experimental Modules](https://effect-ts.github.io/effect/docs/experimental) — Sse, Machine, PersistedCache
- [@effect/workflow npm](https://www.npmjs.com/package/@effect/workflow) — durable workflow patterns
- [@effect/cluster docs](https://effect-ts.github.io/effect/docs/cluster) — distributed entity management

### Secondary (MEDIUM confidence)
- [Effect Cluster DeepWiki](https://deepwiki.com/Effect-TS/effect/5.2-cluster-management) — cluster patterns and readiness
- [Effect HTTP API Builder DeepWiki](https://deepwiki.com/Effect-TS/effect/4.3-http-api-builder) — middleware composition
- [Building Robust TypeScript APIs with Effect](https://dev.to/martinpersson/building-robust-typescript-apis-with-the-effect-ecosystem-1m7c) — practical patterns
- [ZIO FiberRef](https://zio.dev/reference/state-management/fiberref/) — similar patterns for context propagation
- [Effect Myths](https://effect.website/docs/additional-resources/myths/) — common misconceptions

### Codebase Analysis (HIGH confidence)
- `/Users/bardiasamiee/Documents/99.Github/Parametric_Portal/apps/api/src/main.ts` — current 7-layer structure
- `/Users/bardiasamiee/Documents/99.Github/Parametric_Portal/packages/server/src/context.ts` — FiberRef patterns, cookie wrapper
- `/Users/bardiasamiee/Documents/99.Github/Parametric_Portal/apps/api/src/routes/jobs.ts` — SSE usage
- `/Users/bardiasamiee/Documents/99.Github/Parametric_Portal/packages/server/src/middleware.ts` — middleware composition
- `/Users/bardiasamiee/Documents/99.Github/Parametric_Portal/packages/server/src/errors.ts` — error handling patterns
- `/Users/bardiasamiee/Documents/99.Github/Parametric_Portal/pnpm-workspace.yaml` — current dependency versions

---
*Research completed: 2026-01-26*
*Ready for roadmap: yes*
