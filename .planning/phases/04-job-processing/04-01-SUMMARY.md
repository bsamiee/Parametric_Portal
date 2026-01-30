---
phase: 04-job-processing
plan: 01
subsystem: database
tags: [effect-sql, dead-letter-queue, job-processing, postgres, rls]

# Dependency graph
requires:
  - phase: 01-cluster-foundation
    provides: ClusterError, RunnerStorage patterns
  - phase: 03-singleton-scheduling
    provides: KeyValueStore for state persistence
provides:
  - JobDlq Model.Class with all dead-letter tracking fields
  - DatabaseService.jobDlq repo methods (get, insert, markReplayed, listPending)
  - SQL migration for job_dlq table with indexes and RLS
affects: [04-job-processing, 06-saga-orchestration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Model.JsonFromString for JSONB error history array
    - DateTimeInsertFromDate for dlq_at timestamp
    - Partial indexes for pending queue queries

key-files:
  created:
    - packages/database/migrations/0002_job_dlq.ts
  modified:
    - packages/database/src/models.ts
    - packages/database/src/repos.ts

key-decisions:
  - "listPending uses page() method with keyset pagination instead of find() (find lacks limit/order options)"
  - "error_history stored as JSONB array with CHECK constraint validation"

patterns-established:
  - "DLQ model pattern: originalJobId links to source, errorReason discriminant for classification"
  - "Partial index pattern: WHERE replayed_at IS NULL for efficient pending queries"

# Metrics
duration: 6min
completed: 2026-01-30
---

# Phase 4 Plan 1: Job DLQ Database Infrastructure Summary

**JobDlq Model.Class with Model.JsonFromString error history, DatabaseService.jobDlq repo with keyset pagination, and SQL migration with RLS tenant isolation**

## Performance

- **Duration:** 6 min
- **Started:** 2026-01-30T09:00:00Z
- **Completed:** 2026-01-30T09:06:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- JobDlq Model.Class with 12 fields matching research spec (id, originalJobId, appId, type, payload, errorReason, attempts, errorHistory, dlqAt, replayedAt, requestId, userId)
- DatabaseService.jobDlq exposes get, insert, markReplayed, listPending methods
- SQL migration creates job_dlq table with CHECK constraint, partial indexes, purge function, and RLS policy

## Task Commits

Each task was committed atomically:

1. **Task 1: Add JobDlq Model to models.ts** - `7ff6a8a` (feat)
2. **Task 2: Add jobDlq repo methods to DatabaseService** - `b220d91` (feat)
3. **Task 3: Create SQL migration for job_dlq table** - `6b69d27` (feat)

## Files Created/Modified
- `packages/database/src/models.ts` - Added JobDlq Model.Class with dead-letter tracking fields
- `packages/database/src/repos.ts` - Added makeJobDlqRepo factory and integrated into DatabaseService
- `packages/database/migrations/0002_job_dlq.ts` - SQL migration with table, indexes, purge function, RLS

## Decisions Made
- **listPending uses page() instead of find():** The repo factory's find() method only supports predicate-based queries without limit/order options. Used page() method which provides keyset pagination with proper limit and cursor support.
- **error_history as JSONB with CHECK constraint:** Enforces array type at database level via `jsonb_typeof(error_history) = 'array'`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] listPending method signature adjustment**
- **Found during:** Task 2 (Add jobDlq repo methods)
- **Issue:** Plan specified `find()` with `{ limit, order }` options but repo factory's find() only accepts `{ asc?: boolean }`
- **Fix:** Changed to page() method which properly supports limit and cursor-based pagination
- **Files modified:** packages/database/src/repos.ts
- **Verification:** Typecheck passes
- **Committed in:** b220d91 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (blocking - API mismatch)
**Impact on plan:** Necessary adjustment to match actual repo factory API. Result is equivalent (pagination-based listing of pending entries).

## Issues Encountered
None - all tasks completed successfully after API adjustment.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- JobDlq database infrastructure complete
- Ready for Phase 4 Plan 2: JobEntity implementation
- JobEntity can now persist failed jobs to DLQ table for debugging and replay

---
*Phase: 04-job-processing*
*Plan: 01*
*Completed: 2026-01-30*
