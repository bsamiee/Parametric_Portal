---
phase: 01-platform-api-adoption
plan: 01
subsystem: http
tags: [effect, resilience, retry, timeout, circuit-breaker, cockatiel, metrics]

# Dependency graph
requires:
  - phase: none
    provides: foundation plan - no prior dependencies
provides:
  - Unified resilience primitives: withTimeout, withRetry, withFallback, withCircuit, withResilience
  - Pre-built retry schedules: defaultRetry, fastRetry, slowRetry
  - Typed errors: TimeoutError, CircuitOpenError
  - Optional metrics integration for observability
affects: [01-02-stream, 01-03-cache, oauth, external-api-calls]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Effect.timeoutFail for typed timeout errors
    - Effect.retry with Schedule composition for configurable retry
    - Effect.catchAll for fallback composition
    - Effect.serviceOption for optional dependency injection
    - Schedule.tapInput for side-effects during retry
    - Data.TaggedError for typed resilience errors

key-files:
  created:
    - packages/server/src/http/resilience.ts
  modified: []

key-decisions:
  - "Keep cockatiel for circuit breaker state machine, use Effect for retry/timeout"
  - "Metrics are optional via Effect.serviceOption - module works without MetricsService"
  - "Use Data.TaggedError for TimeoutError and CircuitOpenError"
  - "Schedule.tapInput for retry metrics instead of attempt counting"

patterns-established:
  - "Resilience composition: timeout -> retry -> circuit -> fallback"
  - "Optional metrics via Effect.serviceOption pattern"
  - "Typed resilience errors with Data.TaggedError"

# Metrics
duration: 5min
completed: 2026-01-27
---

# Phase 1 Plan 01: Resilience Module Summary

**Effect-native resilience primitives with retry schedules, timeout, circuit breaker integration, and optional metrics**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-27T04:08:18Z
- **Completed:** 2026-01-27T04:13:31Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Created unified resilience module at `packages/server/src/http/resilience.ts` (214 LOC)
- Implemented Effect-native timeout with typed TimeoutError via Effect.timeoutFail
- Implemented retry with pre-built schedules (default, fast, slow) using Schedule composition
- Integrated cockatiel circuit breaker via existing Circuit module with CircuitOpenError
- Added optional metrics for retries, timeouts, and fallbacks using Effect.serviceOption pattern

## Task Commits

Each task was committed atomically:

1. **Task 1: Create resilience module with Effect-native primitives** - `64e7e9f` (feat)
2. **Task 2: Add resilience metrics integration** - `0e04f53` (feat)

## Files Created/Modified

- `packages/server/src/http/resilience.ts` - Unified resilience primitives with retry, timeout, circuit breaker, fallback composition, and optional metrics

## Decisions Made

1. **Keep cockatiel for circuit breaker** - The existing Circuit module in security/circuit.ts already wraps cockatiel with Effect integration and metrics. Reused it via Circuit.make rather than duplicating.

2. **Metrics are optional** - Used Effect.serviceOption(MetricsService) so the resilience module works without metrics in context. This allows standalone usage and testing.

3. **Use Data.TaggedError for errors** - TimeoutError and CircuitOpenError use Data.TaggedError for proper Effect error channel integration and catchTag support.

4. **Schedule.tapInput for retry metrics** - Initially tried tapOutput with attempt count, but the API takes only the output value. Used tapInput which fires on each retry attempt.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

1. **Schedule.tapOutput API mismatch** - Plan suggested using Schedule.tapOutput with (_, attempt) signature, but the API only takes the output value. Resolved by switching to Schedule.tapInput which receives the error that triggered retry.

2. **Non-null assertion lint error** - Using config.retry! triggered biome lint. Resolved by extracting to a const before the conditional.

3. **Imperative if statement lint error** - Using if (Option.isSome(metricsOpt)) violated the functional patterns rule. Resolved by using ternary with Effect.void fallback.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Resilience module ready for stream.ts and cache.ts to import
- All primitives composable with Effect.gen and pipe patterns
- Circuit breaker integration preserves existing cockatiel behavior from security/circuit.ts
- Metrics integrate with existing MetricsService pattern

---
*Phase: 01-platform-api-adoption*
*Completed: 2026-01-27*
