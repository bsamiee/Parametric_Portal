---
phase: 05-eventbus-reliability
plan: 01
subsystem: database
tags: [postgres, outbox-pattern, event-sourcing, dlq, transactional]

# Dependency graph
requires:
  - phase: 04-job-processing
    provides: JobDlq model and migration infrastructure
provides:
  - EventOutbox model and table for transactional outbox pattern
  - Unified DLQ table supporting both job and event sources
  - Repository methods for outbox offer/take/markPublished pattern
affects: [05-02, 05-03, phase-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Transactional outbox pattern for reliable event publishing
    - Unified DLQ with source discriminator for jobs and events
    - UUIDv7 BRIN indexing for time-ordered scans

key-files:
  created:
    - packages/database/migrations/0003_event_outbox.ts
  modified:
    - packages/database/migrations/0002_job_dlq.ts
    - packages/database/src/models.ts
    - packages/database/src/repos.ts

key-decisions:
  - "Unified DLQ: Single job_dlq table with source discriminator (job|event) rather than separate tables"
  - "EventOutbox uses Model.FieldOption for publishedAt (Option<Date> in insert schema)"
  - "offer() method requires Option.none() for publishedAt since Model.FieldOption creates required Option field"

patterns-established:
  - "Transactional outbox: offer() called within db.withTransaction() scope"
  - "Source discriminator: DLQ unified for both jobs and events with error_reason scoped by source"

# Metrics
duration: 2min
completed: 2026-02-01
---

# Phase 05 Plan 01: Database Infrastructure Summary

**EventOutbox model and migration for transactional outbox pattern with unified DLQ supporting both job and event sources**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-01T11:38:00Z
- **Completed:** 2026-02-01T11:40:20Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Extended DLQ table with source discriminator for unified dead-letter handling (job | event)
- Created EventOutbox model with id, appId, eventId, eventType, payload, status, publishedAt
- Created migration 0003_event_outbox.ts with BRIN indexes, partial indexes, RLS, purge function
- Added eventOutbox repository with offer(), takePending(), markPublished(), markFailed() methods
- offer() method documented with JSDoc explaining transactional scope requirement

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend DLQ table with source discriminator** - `28e9960` (feat)
2. **Task 2: Create EventOutbox model and migration** - `cd85516` (feat)
3. **Task 3: Create eventOutbox repository with transactional integration** - `50395ff` (feat)

## Files Created/Modified
- `packages/database/migrations/0002_job_dlq.ts` - Added source column, CHECK constraint, source+error_reason index
- `packages/database/migrations/0003_event_outbox.ts` - New migration for event_outbox table
- `packages/database/src/models.ts` - Added EventOutbox Model.Class definition
- `packages/database/src/repos.ts` - Added makeEventOutboxRepo, updated DatabaseService

## Decisions Made
- **Unified DLQ:** Single job_dlq table with source discriminator (job|event) rather than separate event_dlq table. Simplifies DLQ management and querying.
- **Model.FieldOption behavior:** EventOutbox.publishedAt uses Model.FieldOption which creates Option<Date> in insert schema. offer() passes Option.none() for initial insert.
- **Error reason expansion:** Extended job_dlq error_reason CHECK to include event-specific reasons: DeliveryFailed, DeserializationFailed, DuplicateEvent, HandlerMissing (shared), HandlerTimeout.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- **Type error with Model.FieldOption:** Initial offer() implementation omitted publishedAt, but Model.FieldOption makes it required as Option<Date> in insert schema. Fixed by passing Option.none() explicitly.
- **Page options API:** Plan specified `order: 'asc'` but factory uses `asc: boolean`. Fixed to `asc: true`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- EventOutbox table ready for EventBus transactional writes
- DLQ unified for both job and event dead-letter handling
- Repository methods ready for EventBus outbox worker integration in 05-02

---
*Phase: 05-eventbus-reliability*
*Completed: 2026-02-01*
