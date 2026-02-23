---
phase: 04-session-persistence-and-knowledge-base
plan: 01
subsystem: persistence
tags: [effect, postgresql, model-class, sql-schema, checkpoint, session, tool-call, migration]

# Dependency graph
requires:
  - phase: 01-plugin-transport-foundation
    provides: "CheckpointService with raw SQL persistence and PgClient.layerConfig"
  - phase: 03-schema-redesign-and-topology
    provides: "Clean protocol schema topology and LoopState type"
provides:
  - "Model.Class definitions for KargadanSession, KargadanToolCall, KargadanCheckpoint"
  - "PersistenceService with atomic persist(), hydrate(), createSession(), completeSession(), listSessions(), sessionTrace(), findResumable()"
  - "PostgreSQL migration creating kargadan_sessions, kargadan_tool_calls, kargadan_checkpoints tables"
  - "KargadanMigratorLive with separate kargadan_migrations tracking table"
  - "Silent resume with corruption fallback via hydrate()"
  - "Session lifecycle tracking (create, complete, find resumable)"
affects: [05-agent-intelligence-pipeline, 06-kb-extraction-and-embedding]

# Tech tracking
tech-stack:
  added: ["@effect/ai 0.33.2 (dependency for Phase 5 Chat.exportJson/fromJson)"]
  patterns: ["Model.Class with SqlSchema for typed persistence", "SqlClient.withTransaction for atomic multi-table writes", "Write-through Ref cache", "PgMigrator.fromFileSystem with separate migration table", "findResumable auto-resume pattern"]

key-files:
  created:
    - "apps/kargadan/harness/src/persistence/models.ts"
    - "apps/kargadan/harness/migrations/0001_kargadan.ts"
  modified:
    - "apps/kargadan/harness/src/persistence/checkpoint.ts"
    - "apps/kargadan/harness/src/runtime/agent-loop.ts"
    - "apps/kargadan/harness/src/harness.ts"
    - "apps/kargadan/harness/package.json"

key-decisions:
  - "Changed KargadanToolCall.createdAt from Model.DateTimeInsertFromDate to Model.Generated(S.DateFromSelf) -- DB DEFAULT now() handles insert; excludes field from insert variant to simplify tool call record construction"
  - "Used sql.in() instead of sql.array() for status filtering in listSessions -- sql.array is not available on SqlClient; sql.in matches existing factory.ts patterns"
  - "chatJson placeholder is empty string until Phase 5 wires Chat.exportJson -- column and wiring established now, populated later"
  - "KargadanMigratorLive composed via Layer.provideMerge ordering -- migrator runs before PersistenceService so tables exist"

patterns-established:
  - "Atomic persist: tool call insert + checkpoint upsert in single SqlClient.withTransaction"
  - "Write-through cache: Ref updated after successful DB transaction commit"
  - "findResumable: most-recent running/interrupted session selected for auto-resume (locked decision)"
  - "hydrate corruption fallback: log warning, return fresh, preserve corrupted row"
  - "Separate migration tracking: kargadan_migrations table avoids collision with platform migrations"

requirements-completed: [PERS-01, PERS-02, PERS-03, PERS-04]

# Metrics
duration: 5min
completed: 2026-02-23
---

# Phase 4 Plan 1: Session Persistence Summary

**Model.Class-based PersistenceService with atomic PostgreSQL transactions, write-through cache, silent resume with corruption fallback, and session listing/replay queries**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-23T20:04:50Z
- **Completed:** 2026-02-23T20:09:42Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- PersistenceService replaces CheckpointService as the single persistence surface with 7 methods: persist, hydrate, createSession, completeSession, listSessions, sessionTrace, findResumable
- Every tool call triggers an atomic PostgreSQL transaction writing both tool call log and checkpoint snapshot via SqlClient.withTransaction
- Three Model.Class definitions (KargadanSession, KargadanToolCall, KargadanCheckpoint) with typed SqlSchema queries replace raw SQL
- KargadanMigratorLive runs migrations from harness/migrations/ using separate kargadan_migrations tracking table
- Session lifecycle tracked end-to-end: findResumable on startup, createSession for new runs, completeSession on loop exit
- Silent resume with corruption fallback: hydrate() decodes loop state, logs corruption, starts fresh, preserves data

## Task Commits

Each task was committed atomically:

1. **Task 1: Model definitions and PostgreSQL migration** - `295f574` (feat)
2. **Task 2: PersistenceService, migrator layer, harness rewire, and agent loop integration** - `140ba2a` (feat)

## Files Created/Modified
- `apps/kargadan/harness/src/persistence/models.ts` - KargadanSession, KargadanToolCall, KargadanCheckpoint Model.Class definitions
- `apps/kargadan/harness/migrations/0001_kargadan.ts` - PostgreSQL migration creating three tables with indexes
- `apps/kargadan/harness/src/persistence/checkpoint.ts` - PersistenceService replacing CheckpointService with atomic transactions and write-through cache
- `apps/kargadan/harness/src/runtime/agent-loop.ts` - Agent loop using PersistenceService.persist() per tool call instead of appendTransition()
- `apps/kargadan/harness/src/harness.ts` - KargadanMigratorLive layer, findResumable/hydrate/createSession/completeSession lifecycle
- `apps/kargadan/harness/package.json` - Added @effect/ai catalog dependency

## Decisions Made
- Changed KargadanToolCall.createdAt from DateTimeInsertFromDate to Generated(DateFromSelf) -- the insert variant of DateTimeInsertFromDate requires the field to be present (as optional), but DB DEFAULT now() makes it truly generated, so Generated is the correct modifier
- Used sql.in() for status array filtering instead of sql.array() which does not exist on SqlClient -- matches the existing factory.ts pattern
- chatJson is empty string placeholder in all persist calls until Phase 5 wires Chat.exportJson/fromJson
- KargadanMigratorLive placed before PersistenceService in layer composition via Layer.provideMerge ordering

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Changed KargadanToolCall.createdAt field modifier**
- **Found during:** Task 2 (typecheck)
- **Issue:** Model.DateTimeInsertFromDate includes createdAt in insert variant requiring it to be provided; all tool call record constructions in agent-loop.ts were missing the field
- **Fix:** Changed to Model.Generated(S.DateFromSelf) since DB column has DEFAULT now() -- Generated excludes from insert variant
- **Files modified:** apps/kargadan/harness/src/persistence/models.ts
- **Committed in:** 140ba2a

**2. [Rule 1 - Bug] Replaced sql.array() with sql.in() in listSessions**
- **Found during:** Task 2 (typecheck)
- **Issue:** sql.array() method does not exist on SqlClient; TS2339 error
- **Fix:** Used sql.in() matching existing packages/database/src/factory.ts patterns
- **Files modified:** apps/kargadan/harness/src/persistence/checkpoint.ts
- **Committed in:** 140ba2a

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both auto-fixes necessary for compilation correctness. No scope creep.

## Issues Encountered
None beyond the two auto-fixed type errors resolved during Task 2.

## User Setup Required
None - PostgreSQL connection is configured via KARGADAN_CHECKPOINT_DATABASE_URL environment variable at runtime (established in Phase 01).

## Next Phase Readiness
- Persistence infrastructure is complete: sessions, tool calls, and checkpoints are durably stored
- Phase 5 (Agent Intelligence Pipeline) can wire Chat.exportJson into the chatJson column established here
- Knowledge base seeding (Plan 02) can proceed independently -- it uses the same PgClientLayer
- All Model.Class definitions are available for contract testing

## Self-Check: PASSED

All files verified present. Both task commits verified in git log.

---
*Phase: 04-session-persistence-and-knowledge-base*
*Completed: 2026-02-23*
