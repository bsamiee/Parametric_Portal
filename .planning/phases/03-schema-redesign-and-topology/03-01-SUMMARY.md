---
phase: 03-schema-redesign-and-topology
plan: 01
subsystem: protocol
tags: [effect-schema, kargadan, websocket-protocol, topology]

# Dependency graph
requires:
  - phase: 01-transport-and-execution
    provides: "Protocol envelope types and persistence service"
  - phase: 02-csharp-cutover
    provides: "C# plugin consuming protocol envelopes"
provides:
  - "12 protocol schemas colocated in dispatch.ts"
  - "3 persistence schemas colocated in checkpoint.ts"
  - "Single cross-file dependency: TelemetryContextSchema from dispatch.ts to checkpoint.ts"
affects: [03-02-PLAN, agent-loop, socket, config]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Colocated schemas in domain files instead of centralized barrel", "Inline S.Literal for all variant types"]

key-files:
  created: []
  modified:
    - "apps/kargadan/harness/src/protocol/dispatch.ts"
    - "apps/kargadan/harness/src/persistence/checkpoint.ts"
    - "packages/types/package.json"
    - "apps/kargadan/harness/vite.config.ts"

key-decisions:
  - "Deleted centralized kargadan-schemas.ts barrel (227 LOC) -- app-specific schemas must not live in packages/"
  - "All literal types (FailureClass, CommandOperation, EventType, etc.) inlined into parent Struct -- no standalone S.Literal schemas"
  - "Persistence schemas private to checkpoint.ts -- consumed locally, not exported"
  - "Wired local schemas into checkpoint.ts consumers in same commit to satisfy linter (no unused variables)"

patterns-established:
  - "Schema colocated with domain service: protocol schemas in dispatch.ts, persistence schemas in checkpoint.ts"
  - "Inline literal types in parent S.Struct instead of standalone module-level S.Literal definitions"
  - "Single cross-file schema import (TelemetryContextSchema) between persistence and protocol layers"

requirements-completed: [SCHM-01, SCHM-04, SCHM-06]

# Metrics
duration: 4min
completed: 2026-02-23
---

# Phase 3 Plan 1: Schema Deletion and Root Group Definition Summary

**Deleted 227-LOC centralized kargadan-schemas.ts barrel; rebuilt 15 canonical schemas across 2 colocated domain files (dispatch.ts + checkpoint.ts) with all literal types inlined**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-23T13:50:42Z
- **Completed:** 2026-02-23T13:54:31Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Deleted legacy `packages/types/src/kargadan/kargadan-schemas.ts` (227 LOC, 26 schema exports + 25 type aliases)
- Removed `./kargadan` export entry from `packages/types/package.json` and `@parametric-portal/types` from vite externals
- Defined 12 protocol schemas in `dispatch.ts` (TelemetryContext, EnvelopeIdentity, FailureReason, Idempotency, 5 envelope schemas, CommandAck, Inbound/Outbound unions)
- Defined 3 persistence schemas in `checkpoint.ts` (RunEvent, RunSnapshot, RetrievalArtifact) with single cross-file TelemetryContextSchema import

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete legacy schema file and infrastructure wiring** - `e1e338d` (chore)
2. **Task 2: Define root protocol and persistence schema groups** - `2ed0bce` (feat)

## Files Created/Modified
- `packages/types/src/kargadan/kargadan-schemas.ts` - DELETED (227 LOC legacy barrel)
- `packages/types/package.json` - Removed `./kargadan` export entry
- `apps/kargadan/harness/vite.config.ts` - Cleared `@parametric-portal/types` from externals array
- `apps/kargadan/harness/src/protocol/dispatch.ts` - Added 12 protocol schemas in [SCHEMA] section, 9 schema exports
- `apps/kargadan/harness/src/persistence/checkpoint.ts` - Added 3 persistence schemas, replaced Kargadan.* refs with local schemas

## Decisions Made
- Deleted centralized schema barrel per topology rule: app-specific schemas must not live in `packages/`
- All literal types (FailureClass, CommandOperation, EventType, SceneObjectType, HeartbeatMode, ArtifactType) inlined into parent `S.Struct` definitions -- no standalone `S.Literal` schemas at module level
- Persistence schemas kept private (not exported) -- consumers access through CheckpointService interface
- CommandAckSchema retained despite RESEARCH.md deletion note -- it is a member of OutboundEnvelopeSchema decoded by socket.ts

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wired local schemas into checkpoint.ts consumers**
- **Found during:** Task 2 (Define root schema groups)
- **Issue:** Pre-commit hook (biome) rejected commit due to unused variables: RunEventSchema, RunSnapshotSchema, RetrievalArtifactSchema were defined but existing code still referenced `Kargadan.*` variants
- **Fix:** Replaced `Kargadan.RunEventSchema` / `Kargadan.RunSnapshotSchema` / `Kargadan.RetrievalArtifactSchema` and corresponding type references with local schema names in checkpoint.ts
- **Files modified:** `apps/kargadan/harness/src/persistence/checkpoint.ts`
- **Verification:** `biome check` passes, no unused variable warnings
- **Committed in:** `2ed0bce` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix to pass pre-commit linter. No scope creep -- these are same-file consumer references that logically belong with the schema definition task.

## Issues Encountered
None beyond the linter deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema groups defined and ready for Plan 02 consumer migration
- dispatch.ts still has dead `import type { Kargadan }` that Plan 02 will remove
- Codebase does NOT compile (expected) -- remaining `Kargadan.*` references in dispatch.ts, socket.ts, config.ts, agent-loop.ts to be updated in Plan 02

---
*Phase: 03-schema-redesign-and-topology*
*Completed: 2026-02-23*
