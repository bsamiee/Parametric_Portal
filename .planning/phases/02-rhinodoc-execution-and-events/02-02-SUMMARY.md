---
phase: 02-rhinodoc-execution-and-events
plan: 02
subsystem: observation
tags: [rhinocommon, event-pipeline, channel, debounce, undo-detection, two-phase-ack, csharp, effect-schema]

# Dependency graph
requires:
  - phase: 02-rhinodoc-execution-and-events
    plan: 01
    provides: CommandExecutor with bifurcated undo strategy, extended protocol enums and models
provides:
  - ObservationPipeline with 16 event subscriptions, Channel-based aggregation, 200ms debounce timer
  - Two-phase WebSocket response pattern via sendAckAsync delegate on MessageDispatcher
  - Command execution routing through CommandExecutor in KargadanPlugin.DispatchCommandAsync
  - Extended kargadan-schemas.ts with execution-specific types matching C# contracts
affects: [03-schema-redesign, agent-core]

# Tech tracking
tech-stack:
  added: [System.Threading.Channels, System.Timers.Timer]
  patterns: [Channel-based event aggregation with timer flush, two-phase WebSocket ack, observation pipeline lifecycle in boundary adapter]

key-files:
  created:
    - apps/kargadan/plugin/src/observation/ObservationPipeline.cs
  modified:
    - apps/kargadan/plugin/src/transport/WebSocketHost.cs
    - apps/kargadan/plugin/src/boundary/KargadanPlugin.cs
    - packages/types/src/kargadan/kargadan-schemas.ts

key-decisions:
  - "RhinoObjectEventArgs lacks Document property -- used RhinoDoc.ActiveDoc static for UndoActive/RedoActive detection on object add/delete/undelete events"
  - "DimensionStyleTableEventArgs does not exist in RhinoCommon 9.0.25350.305-wip SDK -- used base EventArgs for DimensionStyleTableEvent handler"
  - "System.Timers.Timer fully qualified to avoid ambiguity with System.Threading.Timer present via Channel imports"
  - "CA1812 suppressed on ObservationPipeline -- internal class instantiated by KargadanPlugin.OnLoad but analyzer cannot see cross-file usage"
  - "OnBatchFlushed extracted to static method to avoid nested lambda type inference issues with Atom.Swap"
  - "Individual operation handlers use stub Fin.Fail responses per plan -- ScriptRun is the fully wired critical path"

patterns-established:
  - "ObservationPipeline: single class composing event subscription, Channel aggregation, timer flush, and undo detection -- no separate files"
  - "Two-phase response: sendAckAsync delegate threaded from WebSocketHost through MessageDispatcher to DispatchCommandAsync"
  - "Channel<RawDocEvent> with BoundedChannelOptions(256, DropOldest) for non-blocking UI thread event capture"
  - "GroupBy on SmartEnum Key strings with StringComparer.Ordinal for event batch categorization"

requirements-completed: [EXEC-03, EXEC-05]

# Metrics
duration: 11min
completed: 2026-02-23
---

# Phase 2 Plan 02: Event Observation Pipeline, Execution Dispatch Wiring, and TS Schema Extension Summary

**ObservationPipeline with 16 RhinoDoc event subscriptions, Channel-based 200ms debounce batching, two-phase WebSocket ack, and CommandExecutor dispatch routing in KargadanPlugin**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-02-23T05:02:16Z
- **Completed:** 2026-02-23T05:12:47Z
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- Created ObservationPipeline.cs (347 lines) with 15 RhinoDoc event subscriptions + Command.UndoRedo, Channel-based aggregation, and 200ms debounce timer that flushes EventBatchSummary batches
- Rewrote KargadanPlugin.DispatchCommandAsync to route commands through CommandExecutor with two-phase ack and per-command deadline timeout via CancellationTokenSource.CreateLinkedTokenSource
- Updated WebSocketHost.MessageDispatcher delegate with sendAckAsync parameter and added SendAckAsync helper that safely drops acks when WebSocket is not open
- Extended kargadan-schemas.ts with 8 new schemas (CommandExecutionMode, CommandCategory, EventSubtype, ScriptResult, SubtypeCount, CategoryCount, EventBatchSummary, CommandAck) and extended CommandOperationSchema and EventEnvelopeSchema.eventType

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ObservationPipeline with event subscription, aggregation, and undo detection** - `1716606` (feat)
2. **Task 2: Wire execution dispatch and observation lifecycle into KargadanPlugin and update WebSocketHost** - `076f5bb` (feat)

## Files Created/Modified
- `apps/kargadan/plugin/src/observation/ObservationPipeline.cs` - New: 16 event subscriptions, Channel<RawDocEvent> with bounded backpressure, Timer-driven flush, undo/redo detection via UndoRedoEventArgs
- `apps/kargadan/plugin/src/transport/WebSocketHost.cs` - Updated MessageDispatcher delegate with sendAckAsync, added SendAckAsync with WebSocket state guard
- `apps/kargadan/plugin/src/boundary/KargadanPlugin.cs` - Added ObservationPipeline to BoundaryState, rewrote DispatchCommandAsync with CommandExecutor routing and two-phase ack, added OnLoad/OnShutdown lifecycle wiring
- `packages/types/src/kargadan/kargadan-schemas.ts` - Added CommandExecutionModeSchema, CommandCategorySchema, EventSubtypeSchema, ScriptResultSchema, SubtypeCountSchema, CategoryCountSchema, EventBatchSummarySchema, CommandAckSchema; extended CommandOperationSchema with 'script.run'; extended EventEnvelopeSchema.eventType with 4 new types

## Decisions Made

1. **RhinoDoc.ActiveDoc for undo detection on object events** -- RhinoObjectEventArgs (used by AddRhinoObject, DeleteRhinoObject, UndeleteRhinoObject) does not expose a Document property. Used `RhinoDoc.ActiveDoc` static property to access UndoActive/RedoActive. RhinoReplaceObjectEventArgs and RhinoModifyObjectAttributesEventArgs do have Document properties and use those directly.

2. **Base EventArgs for DimensionStyleTableEvent** -- RhinoCommon 9.0.25350.305-wip SDK does not define a DimensionStyleTableEventArgs type. The event uses the base System.EventArgs. Other table events (Layer, Material, InstanceDefinition, Light, Group) have their own EventArgs types in Rhino.DocObjects.Tables namespace.

3. **Fully qualified System.Timers.Timer** -- Importing System.Threading.Channels brings System.Threading.Timer into scope, creating ambiguity. Used `System.Timers.Timer` and `System.Timers.ElapsedEventArgs` with full qualification instead of a using directive.

4. **Static OnBatchFlushed method** -- Nested lambda in Atom.Swap caused type inference failure (compiler confused inner Fin<Unit> with outer Option<BoundaryState>). Extracted to static method for clean compilation.

5. **Stub approach for individual operation handlers** -- Per plan guidance, ScriptRun is the fully wired critical path through CommandExecutor.ExecuteScript. Read operations and direct API write operations return Fin.Fail stubs -- these will be implemented as specific DocumentApi facades are wired in future phases.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] RhinoObjectEventArgs.Document does not exist**
- **Found during:** Task 1 (ObservationPipeline event handlers)
- **Issue:** Plan specified `e.Document.UndoActive || e.Document.RedoActive` for handlers 1-5, but RhinoObjectEventArgs only has ObjectId and TheObject -- no Document property
- **Fix:** Created static `IsUndoRedoActive()` helper using `RhinoDoc.ActiveDoc` for object events; used `e.Document` directly for Replace and ModifyAttributes events which do have it
- **Files modified:** `apps/kargadan/plugin/src/observation/ObservationPipeline.cs`
- **Verification:** Build passes with 0 errors
- **Committed in:** `1716606`

**2. [Rule 1 - Bug] DimensionStyleTableEventArgs type does not exist in SDK**
- **Found during:** Task 1 (ObservationPipeline table event handlers)
- **Issue:** Plan assumed all table events have typed EventArgs, but DimensionStyleTableEvent uses base EventArgs
- **Fix:** Used `EventArgs` for DimensionStyleTableEvent handler; confirmed all other table events have typed args
- **Files modified:** `apps/kargadan/plugin/src/observation/ObservationPipeline.cs`
- **Verification:** Build passes with 0 errors
- **Committed in:** `1716606`

**3. [Rule 1 - Bug] Timer type ambiguity between System.Timers and System.Threading**
- **Found during:** Task 1 (ObservationPipeline state fields)
- **Issue:** `using System.Timers;` combined with `System.Threading.Channels` import caused CS0104 ambiguous reference for `Timer`
- **Fix:** Used fully qualified `System.Timers.Timer` and `System.Timers.ElapsedEventArgs`
- **Files modified:** `apps/kargadan/plugin/src/observation/ObservationPipeline.cs`
- **Verification:** Build passes with 0 errors
- **Committed in:** `1716606`

**4. [Rule 1 - Bug] LanguageExt Seq.GroupBy returns IEnumerable, not Seq**
- **Found during:** Task 1 (ObservationPipeline aggregation)
- **Issue:** Plan specified LanguageExt `.GroupBy().Map().ToSeq()` chain, but GroupBy on Seq returns IEnumerable<IGrouping> which lacks .Map()
- **Fix:** Used LINQ `.Select()` with `toSeq()` wrapper and `StringComparer.Ordinal` for MA0002 compliance
- **Files modified:** `apps/kargadan/plugin/src/observation/ObservationPipeline.cs`
- **Verification:** Build passes with 0 errors
- **Committed in:** `1716606`

**5. [Rule 1 - Bug] CA1812 false positive on internal ObservationPipeline**
- **Found during:** Task 1 (build verification)
- **Issue:** CA1812 flagged ObservationPipeline as never instantiated -- it's instantiated by KargadanPlugin.OnLoad in the boundary layer
- **Fix:** Added `#pragma warning disable CA1812` with explanatory comment
- **Files modified:** `apps/kargadan/plugin/src/observation/ObservationPipeline.cs`
- **Verification:** Build passes with 0 warnings
- **Committed in:** `1716606`

**6. [Rule 1 - Bug] Nested lambda type inference failure in Atom.Swap**
- **Found during:** Task 2 (KargadanPlugin.OnLoad ObservationPipeline wiring)
- **Issue:** Inline EventBatchFlushed lambda with nested `batchEventId.Map(...)` confused compiler -- `Fin<Unit>` could not convert to `Option<BoundaryState>` for outer Swap lambda
- **Fix:** Extracted to static `OnBatchFlushed` method, eliminating nested lambda
- **Files modified:** `apps/kargadan/plugin/src/boundary/KargadanPlugin.cs`
- **Verification:** Build passes with 0 errors
- **Committed in:** `076f5bb`

---

**Total deviations:** 6 auto-fixed (all Rule 1 bugs)
**Impact on plan:** All auto-fixes necessary for RhinoCommon SDK correctness. Event arg types, Timer disambiguation, and LanguageExt API differences from research are consistent with Plan 01 findings. No scope creep.

## Issues Encountered

- **RhinoCommon event arg type asymmetry:** Object events (Add, Delete, Undelete) use RhinoObjectEventArgs which lacks Document property, while Replace and ModifyAttributes events have it. This is a RhinoCommon API design inconsistency -- the same UndoActive/RedoActive detection requires different access patterns depending on event type.

- **Missing typed EventArgs for DimensionStyleTableEvent:** Most table events have specialized EventArgs in Rhino.DocObjects.Tables namespace, but DimensionStyleTableEvent uses base EventArgs. This appears to be a gap in the RhinoCommon SDK -- the event exists since version 6.0 but was never given a typed EventArgs class.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness
- Full Phase 2 execution pipeline is operational: commands route through CommandExecutor, events flow through ObservationPipeline
- ScriptRun is the end-to-end critical path; individual direct API operation handlers are stubbed for future wiring
- TS schemas are in sync with C# contracts -- all new SmartEnum keys and model shapes have matching Effect Schema declarations
- Phase 3 (schema redesign) can proceed; ObservationPipeline and CommandExecutor are stable integration points

## Self-Check: PASSED

- All 4 source files verified present on disk
- SUMMARY.md verified present on disk
- All 2 task commits verified in git history (1716606, 076f5bb)
- C# build passes with 0 warnings, 0 errors
- TS typecheck passes for types package

---
*Phase: 02-rhinodoc-execution-and-events*
*Completed: 2026-02-23*
