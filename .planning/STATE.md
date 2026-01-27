# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-26)

**Core value:** Polymorphic patterns that maximize @effect/platform APIs
**Current focus:** Phase 3: Advanced Platform Features

## Current Position

Phase: 3 of 3 (Advanced Platform Features)
Plan: 1 of 4 (completed)
Status: In progress
Last activity: 2026-01-27 - Completed 03-01-PLAN.md (RPC Contracts + Schema Cache)

Progress: [####################] 100% Phase 1, [#####...............] 25% Phase 3

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
- Phase 1 Plan 01: Effect.Cache for L1, manual Redis for L2 (PersistedCache too complex)
- Phase 1 Plan 01: err.reason === 'Exceeded' for RateLimiterError type narrowing
- Phase 3: SerializedWorkerPool for parsing - Off-thread CPU work, non-blocking API
- Phase 3: Effect Cluster for jobs - Replace hand-rolled queue with official APIs
- Phase 3 Plan 01: S.TaggedError for RPC errors (not Data.TaggedError) - Required for serialization
- Phase 3 Plan 01: Duration as milliseconds in worker errors - Duration.Duration not JSON-serializable
- Phase 3 Plan 01: Schema stores bypass L1 Effect.Cache - Direct Redis for simplicity

### Pending Todos

None.

### Blockers/Concerns

**Phase 1 readiness:**
- CacheService complete, ready for consumer migration

**Phase 2 readiness:**
- Must map full dependency graph before merging layers to avoid circular references
- FiberRef propagation testing critical for tenant isolation

**Phase 3 readiness:**
- RPC contracts complete, ready for worker pool implementation
- CacheService schema methods available for typed storage

## Session Continuity

Last session: 2026-01-27
Stopped at: Completed 03-01-PLAN.md (RPC Contracts + Schema Cache)
Resume file: None
