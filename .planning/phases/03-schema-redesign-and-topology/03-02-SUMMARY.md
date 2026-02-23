---
phase: 03-schema-redesign-and-topology
plan: 02
subsystem: protocol
tags: [effect-schema, kargadan, websocket-protocol, topology, schema-migration]

# Dependency graph
requires:
  - phase: 03-schema-redesign-and-topology
    plan: 01
    provides: "12 protocol schemas in dispatch.ts, 3 persistence schemas in checkpoint.ts"
  - phase: 01-transport-and-execution
    provides: "Protocol envelope types and persistence service"
  - phase: 02-csharp-cutover
    provides: "C# plugin consuming protocol envelopes"
provides:
  - "Zero Kargadan namespace references in codebase"
  - "All consumer files import schemas from colocated protocol/schemas.ts"
  - "Typecheck passes with zero errors for kargadan-harness"
  - "56-LOC net reduction across modified files vs pre-Phase-3 baseline"
affects: [persistence, agent-loop, config, socket, dispatch]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Extract<Union, Filter> for narrowing union types at function boundaries", "Schema extraction into cycle-free leaf module"]

key-files:
  created:
    - "apps/kargadan/harness/src/protocol/schemas.ts"
  modified:
    - "apps/kargadan/harness/src/protocol/dispatch.ts"
    - "apps/kargadan/harness/src/socket.ts"
    - "apps/kargadan/harness/src/persistence/checkpoint.ts"
    - "apps/kargadan/harness/src/config.ts"
    - "apps/kargadan/harness/src/runtime/agent-loop.ts"

key-decisions:
  - "Extracted schemas from dispatch.ts into protocol/schemas.ts to break circular import cycles detected by biome noImportCycles"
  - "Used Extract<Union, Filter> to narrow _request parameter type -- CommandAckSchema lacks identity field"
  - "Inline EventBatchSummarySchema at decode site in agent-loop.ts instead of separate schema const"
  - "Inline RunStatus literal union in LoopState type -- no standalone schema needed for 9-variant status enum"
  - "dispatch.ts re-exports all schemas from schemas.ts for backward compatibility"

patterns-established:
  - "Schema leaf module pattern: pure schema definitions in protocol/schemas.ts with zero service/config dependencies"
  - "typeof XSchema.Type for all type annotations -- no separate type declarations"
  - "Field access pattern: CommandEnvelopeSchema.fields.operation for sub-schema extraction instead of standalone schemas"
  - "Extract<Union, {filter}> for narrowing protocol union types at function boundaries"

requirements-completed: [SCHM-03, SCHM-04, SCHM-05]

# Metrics
duration: 9min
completed: 2026-02-23
---

# Phase 3 Plan 2: Consumer Rewiring and Typecheck Gate Summary

**Eliminated all 37 Kargadan namespace references across 5 consumer files, extracted schemas into cycle-free leaf module, and restored typecheck with 56-LOC net reduction**

## Performance

- **Duration:** 9 min
- **Started:** 2026-02-23T13:57:20Z
- **Completed:** 2026-02-23T14:07:19Z
- **Tasks:** 2
- **Files modified:** 6 (5 modified + 1 created)

## Accomplishments
- Replaced all 37 `Kargadan.*` namespace references with `typeof XSchema.Type` derivation across dispatch.ts, socket.ts, config.ts, agent-loop.ts
- Deleted all `@parametric-portal/types/kargadan` imports from 4 consumer files
- Extracted 12 protocol schemas into `protocol/schemas.ts` to break circular import cycles
- config.ts uses field access pattern (`CommandEnvelopeSchema.fields.operation`, `EnvelopeIdentitySchema.fields.protocolVersion`)
- Typecheck passes with zero errors for kargadan-harness
- Net 56-LOC reduction (1017 -> 961 LOC across all schema-related files)

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewire all consumer imports and type annotations** - `a2f415a` (feat)
2. **Task 2: Typecheck gate and LOC reduction verification** - `66da5b0` (fix)

## Files Created/Modified
- `apps/kargadan/harness/src/protocol/schemas.ts` - CREATED: 12 protocol schemas extracted from dispatch.ts (117 LOC, zero dependencies beyond effect)
- `apps/kargadan/harness/src/protocol/dispatch.ts` - Removed schema definitions (now imports from schemas.ts), replaced Kargadan.* with typeof XSchema.Type
- `apps/kargadan/harness/src/socket.ts` - Replaced Kargadan namespace with schema imports from schemas.ts, narrowed _request type
- `apps/kargadan/harness/src/config.ts` - Replaced Kargadan.ProtocolVersionSchema/CommandOperationSchema with field access pattern
- `apps/kargadan/harness/src/runtime/agent-loop.ts` - Replaced 19 Kargadan.* references, inlined EventBatchSummarySchema and RunStatus union
- `apps/kargadan/harness/src/persistence/checkpoint.ts` - Updated TelemetryContextSchema import path to schemas.ts

## Decisions Made
- Extracted schemas into `protocol/schemas.ts` instead of keeping them in dispatch.ts -- biome `noImportCycles` rule detected circular dependencies between dispatch.ts <-> config.ts and dispatch.ts <-> socket.ts. Pure schema definitions have zero service/config dependencies, making them a natural leaf module.
- Used `Extract<typeof OutboundEnvelopeSchema.Type, { readonly identity: unknown }>` to narrow the `_request` parameter type -- `CommandAckSchema` has `{_tag, requestId}` without an `identity` field, so accessing `envelope.identity.requestId` on the full union was unsound.
- Inlined `EventBatchSummarySchema` at the single decode site in agent-loop.ts rather than creating a module-level schema const -- follows the principle of schema colocated with usage.
- Inlined `RunStatus` as a literal union (`'Created' | 'Planning' | ... | 'Compensating'`) in `LoopState` type -- 9 variants are small enough for inline.
- dispatch.ts re-exports all schemas from schemas.ts to maintain backward compatibility for any external consumers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extracted schemas to break circular import cycles**
- **Found during:** Task 1 (Consumer rewiring)
- **Issue:** Biome `noImportCycles` rule detected bidirectional cycles: config.ts <-> dispatch.ts and socket.ts <-> dispatch.ts. Pre-commit hook rejected commit.
- **Fix:** Created `protocol/schemas.ts` as a cycle-free leaf module containing all 12 protocol schema definitions. Updated dispatch.ts to import from `./schemas` and re-export. Updated socket.ts, config.ts, checkpoint.ts to import from schemas.ts directly.
- **Files modified:** All 6 files (schemas.ts created, dispatch.ts/socket.ts/config.ts/checkpoint.ts/agent-loop.ts updated)
- **Verification:** `biome check` passes with no import cycle errors
- **Committed in:** `a2f415a` (Task 1 commit)

**2. [Rule 1 - Bug] Narrowed _request type to exclude CommandAck**
- **Found during:** Task 2 (Typecheck gate)
- **Issue:** `typeof OutboundEnvelopeSchema.Type` includes `CommandAckSchema` which lacks `identity` field. Accessing `envelope.identity.requestId` caused TS2339.
- **Fix:** Used `Extract<typeof OutboundEnvelopeSchema.Type, { readonly identity: unknown }>` in both socket.ts and dispatch.ts _request parameters.
- **Files modified:** `socket.ts`, `dispatch.ts`
- **Verification:** `pnpm exec nx run kargadan-harness:typecheck` passes with zero errors
- **Committed in:** `66da5b0` (Task 2 commit)

**3. [Rule 1 - Bug] Added missing CommandAckSchema import in dispatch.ts**
- **Found during:** Task 2 (Typecheck gate)
- **Issue:** dispatch.ts re-exported `CommandAckSchema` but didn't import it from schemas.ts. Biome auto-fixed it to `type CommandAckSchema` which caused TS2304 (value not found).
- **Fix:** Added `CommandAckSchema` to the import statement from `./schemas`.
- **Files modified:** `dispatch.ts`
- **Verification:** Typecheck passes
- **Committed in:** `66da5b0` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 bugs)
**Impact on plan:** Schema extraction is architecturally sound and follows Effect ecosystem patterns. The _request narrowing fixes a pre-existing type unsoundness. No scope creep.

## Issues Encountered
- Net LOC reduction is 56 lines (vs plan target of 100+). The delta comes from: `typeof XSchema.Type` annotations being longer than `Kargadan.X`, inlined EventBatchSummarySchema adding 4 lines, and persistence schemas legitimately adding ~36 LOC to checkpoint.ts. The 227-LOC barrel was redistributed, not purely eliminated. The reduction is still net positive.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 3 complete: all schema topology migrations done
- Zero Kargadan namespace references remain in codebase
- Zero @parametric-portal/types/kargadan imports remain
- Typecheck passes for kargadan-harness
- Ready for Phase 4 (persistence and state machine)

---
*Phase: 03-schema-redesign-and-topology*
*Completed: 2026-02-23*
