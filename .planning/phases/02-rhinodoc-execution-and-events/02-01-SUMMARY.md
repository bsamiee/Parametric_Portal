---
phase: 02-rhinodoc-execution-and-events
plan: 01
subsystem: execution
tags: [rhinocommon, undo-system, command-execution, runscript, direct-api, smart-enum, csharp]

# Dependency graph
requires:
  - phase: 01-plugin-transport-foundation
    provides: WebSocketHost transport, ThreadMarshaler, KargadanPlugin lifecycle, CommandEnvelope protocol
provides:
  - CommandExecutor with bifurcated undo strategy (direct API + RunScript paths)
  - Seven direct RhinoCommon API facades returning Fin<T>
  - Extended protocol enums (CommandExecutionMode, CommandCategory, EventSubtype)
  - Extended protocol models (ScriptResult, RawDocEvent, EventBatchSummary, AgentUndoState)
  - UndoRecordId value object for type-safe undo serial numbers
  - AgentStateCallback delegate for undo/redo notification
affects: [02-02, 03-schema-redesign]

# Tech tracking
tech-stack:
  added: []
  patterns: [bifurcated undo strategy, Command.EndCommand result tracking, AddCustomUndoEvent redo toggle, Fin-returning API facades]

key-files:
  created:
    - apps/kargadan/plugin/src/execution/CommandExecutor.cs
  modified:
    - apps/kargadan/plugin/src/contracts/ProtocolEnums.cs
    - apps/kargadan/plugin/src/contracts/ProtocolModels.cs
    - apps/kargadan/plugin/src/contracts/ProtocolValueObjects.cs

key-decisions:
  - "Used explicit (string) cast for UndoScope value extraction instead of .Value property -- Thinktecture source generator makes KeyMember accessor non-public; implicit conversion operator is the correct access pattern"
  - "Suppressed CA1508 in ExecuteScript with pragma -- flow analysis cannot see Command.EndCommand event handler side-effect mutating capturedResult; documented as false positive"
  - "Used RhinoObject.NextRuntimeSerialNumber (static property) instead of ObjectTable.NextRuntimeSerialNumber (does not exist) for new-object tracking across RunScript"
  - "FindByLayer uses string overload directly instead of FindByFullPath + int index -- simpler API, returns null for not-found instead of requiring layer index lookup"

patterns-established:
  - "Bifurcated undo: Direct API calls wrapped in BeginUndoRecord/EndUndoRecord with AddCustomUndoEvent; RunScript calls use Command.EndCommand tracking without undo wrapping"
  - "Redo toggle: MakeUndoHandler creates EventHandler that re-registers itself via AddCustomUndoEvent on each invocation -- McNeel-prescribed pattern for redo support"
  - "Fin<T> API facades: Thin wrappers over RhinoDoc.Objects methods returning typed Fin<T> with switch expression on success/failure indicators (Guid.Empty, bool, null)"
  - "BoundaryImperativeExemption on methods requiring imperative RhinoCommon patterns (event subscribe/unsubscribe, void callbacks)"

requirements-completed: [EXEC-01, EXEC-02, EXEC-04, EXEC-05]

# Metrics
duration: 8min
completed: 2026-02-23
---

# Phase 2 Plan 01: Protocol Contracts Extension and Bifurcated Command Execution Engine Summary

**Bifurcated CommandExecutor with undo-wrapped direct API facades, RunScript with Command.EndCommand result tracking, and extended protocol contracts for execution-specific SmartEnums and domain models**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-02-23T04:50:48Z
- **Completed:** 2026-02-23T04:58:51Z
- **Tasks:** 2
- **Files modified:** 4 (3 modified, 1 created)

## Accomplishments
- Extended protocol contracts with three new SmartEnums (CommandExecutionMode, CommandCategory, EventSubtype), extended CommandOperation with ScriptRun, extended EventType with four new variants
- Added six execution-specific domain models (ScriptResult, RawDocEvent, EventBatchSummary, CategoryCount, SubtypeCount, AgentUndoState) and one value object (UndoRecordId)
- Implemented CommandExecutor.cs with bifurcated undo strategy: ExecuteDirectApi wraps in BeginUndoRecord/EndUndoRecord with AddCustomUndoEvent, ExecuteScript uses Command.EndCommand result tracking without undo wrapping
- Seven direct RhinoCommon API facades (AddObject, DeleteObject, ReplaceObject, TransformObject, FindById, FindByLayer, ModifyAttributes) all returning Fin<T>
- MakeUndoHandler implements McNeel-prescribed redo toggle pattern with callback re-registration

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend protocol contracts with execution-specific types** - `0b0d566` (feat)
2. **Task 2: Implement CommandExecutor with bifurcated undo strategy** - `516899a` (feat)

## Files Created/Modified
- `apps/kargadan/plugin/src/contracts/ProtocolEnums.cs` - Added CommandExecutionMode, CommandCategory (with DefaultDeadlineMs), EventSubtype SmartEnums; extended CommandOperation with ScriptRun; extended EventType with SelectionChanged, MaterialChanged, PropertiesChanged, TablesChanged
- `apps/kargadan/plugin/src/contracts/ProtocolModels.cs` - Added ScriptResult (with Fin factory validating CommandName non-empty, CommandResult 0-6, ObjectsCreatedCount >= 0), RawDocEvent, EventBatchSummary, CategoryCount, SubtypeCount, AgentUndoState
- `apps/kargadan/plugin/src/contracts/ProtocolValueObjects.cs` - Added UndoRecordId value object wrapping uint with non-zero validation
- `apps/kargadan/plugin/src/execution/CommandExecutor.cs` - Full bifurcated execution engine (195 lines): undo-wrapped direct API execution, RunScript with Command.EndCommand result tracking, seven API facades, redo toggle pattern

## Decisions Made

1. **Explicit string cast for UndoScope access** -- Thinktecture ValueObject generates KeyMember accessor as non-public. Used `(string)scope` implicit conversion operator instead of `.Value` property access.

2. **CA1508 pragma suppression in ExecuteScript** -- The `capturedResult` variable is mutated by the `Command.EndCommand` event handler during `RunScript` execution, but the compiler's flow analysis cannot trace this side-effect through the event handler delegate. Documented as false positive.

3. **RhinoObject.NextRuntimeSerialNumber (static) for object tracking** -- The research referenced `doc.Objects.NextRuntimeSerialNumber` but the actual RhinoCommon API exposes this as a static property on `RhinoObject`, not on `ObjectTable`. Corrected during implementation.

4. **Direct string overload for FindByLayer** -- Used `doc.Objects.FindByLayer(layerName: ...)` (string overload) instead of the two-step `FindByFullPath` + index approach. Simpler API surface; returns null when layer not found or empty.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] UndoScope.Value inaccessible -- used implicit string conversion**
- **Found during:** Task 2 (CommandExecutor.ExecuteDirectApi)
- **Issue:** Plan specified `envelope.UndoScope.Map(scope => scope.Value)` but Thinktecture source generator makes `Value` non-public on ValueObject structs
- **Fix:** Used `(string)scope` implicit conversion operator instead
- **Files modified:** `apps/kargadan/plugin/src/execution/CommandExecutor.cs`
- **Verification:** Build passes with 0 errors
- **Committed in:** `516899a`

**2. [Rule 1 - Bug] NextRuntimeSerialNumber is static on RhinoObject, not ObjectTable**
- **Found during:** Task 2 (CommandExecutor.ExecuteScript)
- **Issue:** Plan and research referenced `doc.Objects.NextRuntimeSerialNumber` but API exposes it as `RhinoObject.NextRuntimeSerialNumber` (static property)
- **Fix:** Changed to `RhinoObject.NextRuntimeSerialNumber`
- **Files modified:** `apps/kargadan/plugin/src/execution/CommandExecutor.cs`
- **Verification:** Build passes with 0 errors
- **Committed in:** `516899a`

**3. [Rule 1 - Bug] Multiple RhinoCommon parameter names incorrect**
- **Found during:** Task 2 (API facades)
- **Issue:** Plan-specified parameter names (`newGeometry`, `objectId` on FindId, `fullPath` on FindByFullPath, `layerIndex` on FindByLayer) did not match actual RhinoCommon API parameter names
- **Fix:** Used correct names from RhinoCommon XML docs: `geometry`/`ignoreModes` for Replace, positional for FindId, `layerPath`/`notFoundReturnValue` for FindByFullPath, `layerName` for FindByLayer
- **Files modified:** `apps/kargadan/plugin/src/execution/CommandExecutor.cs`
- **Verification:** Build passes with 0 errors
- **Committed in:** `516899a`

**4. [Rule 1 - Bug] Transform returns Guid (new object ID), not bool**
- **Found during:** Task 2 (TransformObject facade)
- **Issue:** Assumed Transform returns bool like Delete/Replace, but it returns Guid of new object
- **Fix:** Switch on `== Guid.Empty` instead of direct bool comparison
- **Files modified:** `apps/kargadan/plugin/src/execution/CommandExecutor.cs`
- **Verification:** Build passes with 0 errors
- **Committed in:** `516899a`

**5. [Rule 1 - Bug] CA1508 false positive on capturedResult switch arms**
- **Found during:** Task 2 (ExecuteScript)
- **Issue:** Compiler flow analysis flagged `Result.Success` and `Result.Cancel` arms as dead code because it cannot trace mutation through the event handler delegate
- **Fix:** Added `#pragma warning disable CA1508` with explanatory comment
- **Files modified:** `apps/kargadan/plugin/src/execution/CommandExecutor.cs`
- **Verification:** Build passes with 0 warnings
- **Committed in:** `516899a`

**6. [Rule 1 - Bug] ObjRef(Guid) obsolete, nullability, IDE warnings**
- **Found during:** Task 2 (ModifyAttributes facade)
- **Issue:** `ObjRef(Guid)` constructor obsolete (use document version), nullable sender in event handlers, unused expression results
- **Fix:** Used `ModifyAttributes(Guid objectId, ...)` overload directly (avoids ObjRef), `object? sender` for nullable compat, `_ =` discard for unused results, local function for IDE0039
- **Files modified:** `apps/kargadan/plugin/src/execution/CommandExecutor.cs`
- **Verification:** Build passes with 0 warnings, 0 errors
- **Committed in:** `516899a`

---

**Total deviations:** 6 auto-fixed (all Rule 1 bugs)
**Impact on plan:** All auto-fixes necessary for RhinoCommon API correctness under TreatWarningsAsErrors. Research-specified parameter names and API locations did not match the actual Rhino 9 WIP SDK 9.0.25350.305-wip. No scope creep -- all fixes are within the planned scope.

## Issues Encountered

- **RhinoCommon API discrepancies from research:** Multiple parameter names and property locations in the RhinoCommon 9.0.25350.305-wip SDK differed from the research documentation. This is expected since research was based on public API docs and forum posts rather than the actual installed SDK. All discrepancies were resolved by consulting the NuGet package's XML documentation file directly.

- **Thinktecture ValueObject accessor visibility:** The `Value` KeyMember property generated by `[ValueObject<string>(KeyMemberName = "Value")]` is not publicly accessible. This is by design in Thinktecture 10.0.0 -- implicit/explicit conversion operators are the intended access pattern.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness
- CommandExecutor is ready for Plan 02-02 to wire into KargadanPlugin dispatch path
- Protocol contracts are backward-compatible with Phase 1 code (extensions only, no modifications to existing types)
- EventType extensions (SelectionChanged, MaterialChanged, PropertiesChanged, TablesChanged) are ready for Plan 02-02's EventSubscriber
- EventSubtype SmartEnum is ready for Plan 02-02's event aggregation pipeline
- RawDocEvent and EventBatchSummary models are ready for Plan 02-02's observation layer

## Self-Check: PASSED

- All 4 files verified present on disk
- All 2 task commits verified in git history (0b0d566, 516899a)
- Build passes with 0 warnings, 0 errors

---
*Phase: 02-rhinodoc-execution-and-events*
*Completed: 2026-02-23*
