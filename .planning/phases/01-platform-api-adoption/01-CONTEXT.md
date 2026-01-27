# Phase 1: Platform API Adoption - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the unified HTTP foundation for packages/server/ by replacing all hand-rolled patterns with official Effect APIs. This phase creates four polymorphic modules (cookies, stream, cache, resilience) that form the base layer for hundreds of multi-tenant apps with cluster deployment capability.

**Expanded scope:** This phase now includes resilience/circuit breaker rebuild to ensure streaming and cache have proper retry/fallback/circuit patterns integrated.

</domain>

<decisions>
## Implementation Decisions

### Cookie Migration
- ALL cookies go through @effect/platform Cookies with schema validation at boundary
- Encryption as separate Crypto step - Cookies handles typed I/O, Crypto service layers encryption on top
- Migration approach: all at once (breaking change, single PR, clean cutover)
- Cookie schemas live in `packages/server/src/http/cookies.ts`
- Follow metrics.ts polymorphic pattern: dense FP+Effect code, unified API export, no type wrapping

### Unified Streaming Engine
- Single `packages/server/src/http/stream.ts` module
- Covers ALL streaming primitives: HttpServerResponse.stream, Sse, Transferable, Stream.*, Channel
- Unified polymorphic API - NOT separate functions per operation type
- Serves clients, internal streaming, infrastructure, jobs - all use cases
- Built-in retry with backoff, circuit breaker integration, graceful termination on exhausted retries
- NO partial results on failure - data integrity priority, clean up resources
- Built-in metrics/observability - every stream auto-emits to observation stack
- Delegate multipart uploads to @effect-aws/client-s3 - streaming engine coordinates, S3 client handles chunking
- Backpressure: Claude decides per stream type using Effect patterns, intelligent defaults, no consumer ceremony
- Heavy parsing (xlsx/zip/csv): Refactor to streaming in Phase 1, worker pools in Phase 3 - establish foundation now

### Unified Cache
- Single polymorphic cache module for external/internal, client/backend, workers/jobs
- Comprehensive research needed on ALL Effect cache APIs: Effect.Cache, KeyValueStore, and others
- Memory-first with Redis fallback - intelligent behavior optimizing performance/cost
- Built-in retry/graceful fallback/cleanup/circuit integration (same patterns as streaming)
- Automatic tenantId prefix from FiberRef context - zero-effort tenant isolation
- Built-in metrics: hits/misses/latency auto-emit
- Smart lookup defaults: cached by default, easy override for direct access (e.g., session.lookup() cached, session.lookup.direct() uncached)

### Resilience Module (NEW - Expanded Scope)
- Single `packages/server/src/http/resilience.ts` for circuit, retry, timeout, fallback
- Full rebuild - deep research on ALL Effect + cockatiel APIs
- Honest comparison: pure Effect vs cockatiel-based implementation
- Must properly use 12-15+ imports from effect/cockatiel - no hand-rolling
- Unified polymorphic API - integrates into streaming, cache, backpressure
- Built-in metrics

### Backpressure Configuration
- Part of streaming engine's intelligent behavior
- Buffer configuration per stream type - Claude decides sensible defaults
- Overflow behavior intelligent per use case
- Built-in metrics: buffer utilization, overflow events
- Circuit breaker integration for cascade failure prevention

### File Organization
- New modules in `packages/server/src/http/` directory:
  - `http/cookies.ts`
  - `http/stream.ts`
  - `http/cache.ts`
  - `http/resilience.ts`
- Existing files remain at `src/` root (context.ts, middleware.ts, errors.ts, api.ts) - refactored in place
- All modules export Layers (e.g., Cookies.Default, Stream.Default) for composition in main.ts

### Effect API Deep-Dive
- Minimum research scope: effect (core) + @effect/platform + @effect/experimental
- Add @effect/opentelemetry for metrics integration
- CRUCIAL: Don't overlook core effect package for code bodies
- Use Effect capabilities A to Z: Array, Match, Channel, BigInt, BigDecimal, Chunk, Config, Context, Data, Encoding, Fiber*, Hash*, time-related, etc.
- Lean toward 100% Effect patterns for traceable pipelines and Railway-Oriented Programming
- First map EVERYTHING in each module, then determine relevance - don't overlook useful APIs

### Integration Patterns
- Modules integrate internally (resilience → stream → backpressure → etc.)
- Export clean unified APIs - consumers don't compose manually, no boilerplate
- Internal intelligence, external simplicity
- Full/aggressive clean break from original patterns - new server/ folder dictates new API
- Route refactoring comes AFTER Phase 2 (layer consolidation) - server/ rebuilt first, then main.ts, then routes

### Claude's Discretion
- Backpressure defaults per stream type
- Cache location (http/ vs infra/) based on layer architecture
- Effect vs cockatiel decision for resilience after research
- Test organization (co-located vs centralized)
- Schema.TaggedRequest preparation for Phase 3 workers

</decisions>

<specifics>
## Specific Ideas

- "We want unified polymorphic approach - ONE file following metrics.ts pattern, dense FP+Effect code, unified API export"
- "State what you're doing, and it's done - no ceremony or dev overhead"
- "Automatic tenantId, automatic metrics, automatic retry/circuit - intelligent behavior everywhere"
- "Cookie → Crypto integration without extra layers - keep it simple"
- "NO partial results - data integrity over availability"
- "100% Effect patterns might be better for traceable Railway-Oriented Programming"
- "12-15+ imports from effect/cockatiel - must properly use official capabilities"
- "First understand all fundamental operations (stream, export, import, upload, copy, etc.), then build focused API"

</specifics>

<deferred>
## Deferred Ideas

- Effect Cluster migration - Phase 3+ (after foundation stable)
- Machine abstraction for jobs - experimental API, evaluate later
- Redis KeyValueStore adapter implementation - needs custom work, evaluate in Phase 3
- Route handler refactoring - after Phase 2 layer consolidation
- @effect/workflow integration - evaluate after cluster foundation

</deferred>

## Roadmap Updates Required

Phase 1 scope expanded to include:
- RESILIENCE-01: Unified resilience module (circuit, retry, timeout, fallback)
- Broader streaming scope (full engine, not just SSE cleanup)
- Circuit breaker integration throughout

---

*Phase: 01-platform-api-adoption*
*Context gathered: 2026-01-26*
