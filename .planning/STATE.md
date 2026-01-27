# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-26)

**Core value:** Polymorphic patterns that maximize @effect/platform APIs
**Current focus:** Phase 1: Platform API Adoption (revised)

## Current Position

Phase: 1 of 3 (Platform API Adoption)
Plan: 2 of 4 (completed)
Status: In progress
Last activity: 2026-01-27 - Completed 01-02-PLAN.md (StreamingService)

Progress: [##########..........] 50% (2/4 plans)

## Phase 1 Revision Notes

Original Phase 1 created wrapper utilities (cache.ts, stream.ts, resilience.ts, circuit.ts).
After execution and review, the approach was deemed insufficient:
- Created loose const/function exports instead of proper Effect.Service classes
- Did not follow MetricsService polymorphic pattern
- Required consumer configuration instead of intelligent internal defaults
- Did not achieve the unified service vision

**New direction:**
- CacheService: Proper Effect.Service with L1/L2 architecture, auto-scope from context
- StreamingService: Unified service for SSE/download/export with intelligent defaults
- Full migration of rate-limit.ts, totp-replay.ts consumers
- Code quality: Dense services, polymorphic unity, no loose const spam

See: `.planning/phases/01-platform-api-adoption/01-CONTEXT.md` for full decisions.

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Phase 1: 4-layer architecture (Platform -> Infra -> Domain -> HTTP) - Reduces cognitive load
- Phase 1: L1/L2 cache architecture with lazy write-behind to Redis
- Phase 1: Context-aware auto-scope (tenant + user when session exists)
- Phase 1: Rate limiting absorbed into CacheService
- Phase 1: Resilience stays as utilities, used internally by services
- Phase 1 Plan 02: No consumer-configurable buffer options - intelligent defaults baked in
- Phase 1 Plan 02: Buffer BEFORE encoding for SSE - drop stale domain objects efficiently
- Phase 3: SerializedWorkerPool for parsing - Off-thread CPU work, non-blocking API
- Phase 3: Effect Cluster for jobs - Replace hand-rolled queue with official APIs

### Pending Todos

None.

### Blockers/Concerns

**Phase 1 readiness:**
- Need deep research on @effect/experimental Redis API for L2 cache
- Need to understand Effect pub/sub for cross-instance invalidation

**Phase 2 readiness:**
- Must map full dependency graph before merging layers to avoid circular references
- FiberRef propagation testing critical for tenant isolation

**Phase 3 readiness:**
- Worker pool integration complexity unknown (needs spike for schema definitions and worker script setup)

## Session Continuity

Last session: 2026-01-27
Stopped at: Completed 01-02-PLAN.md (StreamingService)
Resume file: None
