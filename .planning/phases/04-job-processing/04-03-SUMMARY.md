---
phase: 04-job-processing
plan: 03
subsystem: observability
tags: [effect, metrics, prometheus, job-tracking]

# Dependency graph
requires:
  - phase: 01-cluster-foundation
    provides: MetricsService foundation with trackCluster pattern
  - phase: 04-01
    provides: JobDlq model requiring dlqSize metric
provides:
  - MetricsService.jobs.cancellations counter
  - MetricsService.jobs.dlqSize gauge
  - MetricsService.jobs.processingSeconds histogram
  - MetricsService.trackJob static helper
affects: [04-02, 04-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pipeable combinator pattern for trackJob (config first, effect as pipe target)"
    - "Match.exhaustive for operation dispatch in tracking helpers"

key-files:
  created: []
  modified:
    - packages/server/src/observe/metrics.ts

key-decisions:
  - "trackJob as pipeable combinator matching codebase pattern"
  - "processingSeconds histogram distinct from duration (active vs end-to-end)"

patterns-established:
  - "Job metrics: cancellations counter, dlqSize gauge, processingSeconds histogram"
  - "trackJob helper with operation/jobType/priority labels"

# Metrics
duration: 4min
completed: 2026-01-30
---

# Phase 04 Plan 03: Job Metrics Extension Summary

**Job metrics (cancellations, dlqSize, processingSeconds) and trackJob pipeable combinator for standardized job instrumentation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-30T16:45:00Z
- **Completed:** 2026-01-30T16:49:00Z
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments

- Added cancellations counter (jobs_cancelled_total) for cancel handler tracking
- Added dlqSize gauge (jobs_dlq_size) for dead-letter queue observability
- Added processingSeconds histogram (jobs_processing_seconds) for active processing time
- Created trackJob static helper as pipeable combinator matching Plan 04-02 usage signature

## Task Commits

Each task was committed atomically:

1. **Task 1: Verify Match import exists** - No commit (verification only, Match already present)
2. **Task 2: Add missing job metrics** - `7a16e6a` (feat)
3. **Task 3: Add trackJob static helper** - `7a16e6a` (feat)

Tasks 2 and 3 committed together as single coherent change.

## Files Created/Modified

- `packages/server/src/observe/metrics.ts` - Extended jobs metrics object with cancellations, dlqSize, processingSeconds; added trackJob static helper

## Decisions Made

- **trackJob as pipeable combinator:** Signature `(config) => (effect) => Effect` matches codebase pattern (trackCluster uses effect-first, but pipeable is more ergonomic for Plan 04-02 usage)
- **processingSeconds vs duration:** processingSeconds tracks active processing time distinct from duration which is end-to-end (includes queue wait time)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Job metrics infrastructure complete for Plan 04-02 JobEntityLive implementation
- trackJob helper ready for use with signature: `effect.pipe(MetricsService.trackJob({ jobType, operation, priority }))`
- All job operations (submit, process, cancel, replay) supported

---
*Phase: 04-job-processing*
*Completed: 2026-01-30*
