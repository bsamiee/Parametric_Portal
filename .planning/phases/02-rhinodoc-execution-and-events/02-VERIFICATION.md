---
phase: 02-rhinodoc-execution-and-events
verified: 2026-02-22T10:45:00Z
status: gaps_found
score: 9/12 must-haves verified
gaps:
  - truth: "Plugin subscribes to 15 RhinoDoc events and pushes them as summarized batches to the harness within 200ms debounce window"
    status: partial
    reason: "Subscription and aggregation are fully implemented. The 200ms debounce timer fires and builds EventBatchSummary correctly. However, OnBatchFlushed only calls RhinoApp.WriteLine — it never sends the batch to the harness via WebSocket or EventPublisher. The push to harness is missing."
    artifacts:
      - path: "apps/kargadan/plugin/src/boundary/KargadanPlugin.cs"
        issue: "OnBatchFlushed (line 113-114) logs to RhinoApp.WriteLine only. It does not call state.EventPublisher.Publish or send via WebSocket. The harness never receives the batched events."
    missing:
      - "OnBatchFlushed must wrap EventBatchSummary into an EventEnvelope and call state.EventPublisher.Publish (or push directly via WebSocketHost active socket)"
      - "The flush callback needs access to BoundaryState to reach EventPublisher — currently it is a static method with no state access"
  - truth: "Command.UndoRedo event detected and the harness is notified when Cmd+Z or Cmd+Shift+Z completes"
    status: partial
    reason: "Command.UndoRedo is correctly subscribed and OnUndoRedo fires into the Channel. However, PublishUndoEvent in KargadanPlugin builds a delta JsonElement but never calls EventPublisher.Publish — the eventId.Map block returns unit without publishing."
    artifacts:
      - path: "apps/kargadan/plugin/src/boundary/KargadanPlugin.cs"
        issue: "PublishUndoEvent (lines 257-271): eventId.Map block builds delta but ends with 'return unit' — EventPublisher.Publish is never invoked. The harness receives no undo notification."
    missing:
      - "PublishUndoEvent must call state.EventPublisher.Publish(eventEnvelope, publishedAt) inside the eventId.Map block, mirroring the PublishLifecycleEvent pattern"
  - truth: "Direct API facade methods return Fin<T> for all RhinoCommon ObjectTable/LayerTable operations"
    status: partial
    reason: "The 7 facade methods in CommandExecutor.cs all return Fin<T> correctly and are substantive. However, DispatchOperation in KargadanPlugin never calls them for write operations — it passes a handler that immediately returns Fin.Fail('not yet implemented'). The facades exist but are not wired into the dispatch path."
    artifacts:
      - path: "apps/kargadan/plugin/src/boundary/KargadanPlugin.cs"
        issue: "DispatchOperation (lines 248-255): the DirectApi branch passes a static handler returning Fin.Fail('Direct API handler for ... not yet implemented') instead of routing to CommandExecutor.AddObject, DeleteObject, etc."
    missing:
      - "DispatchOperation must decode the envelope payload and route to the appropriate CommandExecutor facade: AddObject for ObjectCreate, DeleteObject for ObjectDelete, ReplaceObject/ModifyAttributes for ObjectUpdate"
      - "Note: the plan documents this as intentional partial scope — 'ScriptRun is the fully wired critical path'. This gap must be evaluated against the phase goal."
---

# Phase 2: RhinoDoc Execution and Events Verification Report

**Phase Goal:** The agent can execute arbitrary Rhino commands and direct API calls, receive document change events, and undo any AI action atomically
**Verified:** 2026-02-22T10:45:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | CommandExecutor.ExecuteDirectApi wraps document-modifying operations in BeginUndoRecord/EndUndoRecord with AddCustomUndoEvent | VERIFIED | Lines 45, 47, 53 in CommandExecutor.cs confirm BeginUndoRecord, AddCustomUndoEvent, EndUndoRecord in that order |
| 2 | CommandExecutor.ExecuteScript runs RunScript with Command.EndCommand result tracking and does NOT wrap in BeginUndoRecord/EndUndoRecord | VERIFIED | Lines 67-105 show Command.EndCommand subscribe/unsubscribe around RhinoApp.RunScript; no BeginUndoRecord present in ExecuteScript |
| 3 | Direct API facade methods return Fin<T> for all RhinoCommon ObjectTable/LayerTable operations | PARTIAL | All 7 facades in CommandExecutor.cs exist and return correct Fin<T> types. BUT DispatchOperation in KargadanPlugin never invokes them — write operations return Fin.Fail stub. Facades exist, wiring is absent. |
| 4 | AddCustomUndoEvent callback re-registers itself for redo support and never modifies RhinoDoc | VERIFIED | MakeUndoHandler (lines 182-194) re-registers via args.Document.AddCustomUndoEvent on each invocation (redo toggle). No RhinoDoc modifications. |
| 5 | Protocol enums and models include execution-specific types: CommandExecutionMode, EventSubtype, ScriptResult, EventBatchSummary | VERIFIED | ProtocolEnums.cs lines 136-162 confirm CommandExecutionMode, CommandCategory, EventSubtype. ProtocolModels.cs lines 132-179 confirm ScriptResult, RawDocEvent, EventBatchSummary, CategoryCount, SubtypeCount, AgentUndoState. |
| 6 | Plugin subscribes to 15 RhinoDoc events and pushes them as summarized batches to the harness within 200ms debounce window | PARTIAL | ObservationPipeline.cs subscribes to 15 RhinoDoc events (lines 84-101) + Command.UndoRedo (line 51). Timer fires at 200ms. FlushBatch builds correct EventBatchSummary. BUT OnBatchFlushed (KargadanPlugin line 113-114) only calls RhinoApp.WriteLine — never sends batch to harness. |
| 7 | Command.UndoRedo event detected and the harness is notified when Cmd+Z or Cmd+Shift+Z completes | PARTIAL | OnUndoRedo (ObservationPipeline line 329) correctly detects IsEndUndo/IsEndRedo via tuple switch and writes to Channel. BUT PublishUndoEvent (KargadanPlugin lines 257-271) builds a delta but never calls EventPublisher.Publish — harness receives nothing. |
| 8 | Event handlers write to Channel immediately — no blocking on UI thread | VERIFIED | Every event handler (lines 133-266 in ObservationPipeline.cs) calls _channel.Writer.TryWrite() only. No blocking, no serialization, no WebSocket writes on UI thread. |
| 9 | KargadanPlugin.DispatchCommandAsync routes commands to CommandExecutor instead of returning 'not yet implemented' | VERIFIED | DispatchCommandAsync (lines 188-214) sends immediate ack, applies deadline timeout, and calls ExecuteCommand -> ExecuteCommandWithDoc -> DispatchOperation. DispatchOperation calls CommandExecutor.ExecuteScript (line 239) and CommandExecutor.ExecuteDirectApi (line 248). ScriptRun path is fully wired. |
| 10 | WebSocketHost supports two-phase response: immediate ack then final result | VERIFIED | MessageDispatcher delegate (WebSocketHost.cs line 23-27) includes Func<JsonElement,Task> sendAckAsync parameter. DispatchByTagAsync (line 294-304) passes SendAckAsync closure. KargadanPlugin.DispatchCommandAsync calls sendAckAsync before UI thread marshal (line 194). |
| 11 | ObservationPipeline lifecycle is started on plugin load and stopped on plugin shutdown | VERIFIED | OnLoad (KargadanPlugin line 356) calls observationPipeline.Start(). OnShutdown (lines 365-366) calls Stop() and Dispose(). ObservationPipeline is in BoundaryState (line 33). |
| 12 | TS schemas in kargadan-schemas.ts are extended with execution-specific types matching C# contracts | VERIFIED | kargadan-schemas.ts lines 144-179 contain CommandExecutionModeSchema, CommandCategorySchema, EventSubtypeSchema, ScriptResultSchema, SubtypeCountSchema, CategoryCountSchema, EventBatchSummarySchema, CommandAckSchema. CommandOperationSchema includes 'script.run' (line 35). EventEnvelopeSchema.eventType includes all 4 new variants (line 96). All literals match C# SmartEnum Key values. |

**Score:** 9/12 truths verified (3 partial — 2 are hard gaps, 1 is documented partial scope)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/kargadan/plugin/src/execution/CommandExecutor.cs` | Bifurcated command execution with undo wrapping, RunScript result tracking, and direct API facades | VERIFIED | 195 lines. ExecuteDirectApi, ExecuteScript, 7 API facades, MakeUndoHandler. All substantive. No stubs in the executor itself. |
| `apps/kargadan/plugin/src/contracts/ProtocolEnums.cs` | Extended with CommandExecutionMode, CommandCategory, EventSubtype SmartEnums; extended CommandOperation with script.run | VERIFIED | Lines 136-162 confirm all 3 new SmartEnums. CommandOperation includes ScriptRun = new("script.run") (line 77). SupportedCapabilities Seq includes ScriptRun (line 97). |
| `apps/kargadan/plugin/src/contracts/ProtocolModels.cs` | ScriptResult, RawDocEvent, EventBatchSummary, CategoryCount, SubtypeCount, AgentUndoState models | VERIFIED | Lines 132-179 contain all 6 models. ScriptResult has Fin factory with validation. RawDocEvent is plain struct. AgentUndoState is plain struct. |
| `apps/kargadan/plugin/src/contracts/ProtocolValueObjects.cs` | UndoRecordId value object wrapping uint for type-safe undo serial numbers | VERIFIED | Lines 124-131 define UndoRecordId with [ValueObject<uint>] and ValidateFactoryArguments enforcing value > 0. |
| `apps/kargadan/plugin/src/observation/ObservationPipeline.cs` | Event subscription, Channel-based aggregation with Timer flush, UndoRedo observer, and lifecycle management | PARTIAL | 347 lines. Subscribe/Unsubscribe cover 15 RhinoDoc events. Timer at 200ms. FlushBatch aggregates correctly. But the flush callback registered is OnBatchFlushed which only logs — not actual harness push. |
| `apps/kargadan/plugin/src/transport/WebSocketHost.cs` | Updated MessageDispatcher delegate with sendAckAsync parameter for two-phase response | VERIFIED | Line 23-27: delegate includes Func<JsonElement,Task> sendAckAsync. SendAckAsync (lines 305-320) guards on WebSocket.State == Open before sending. |
| `apps/kargadan/plugin/src/boundary/KargadanPlugin.cs` | Command execution routing via CommandExecutor, ObservationPipeline lifecycle wiring, two-phase dispatch | PARTIAL | ObservationPipeline lifecycle and two-phase ack are wired correctly. CommandExecutor.ExecuteScript is fully wired. BUT OnBatchFlushed is a logging stub and PublishUndoEvent never calls Publish. |
| `packages/types/src/kargadan/kargadan-schemas.ts` | Extended with CommandExecutionMode, CommandCategory, EventSubtype, EventBatchSummary, ScriptResult schemas | VERIFIED | Lines 144-179 confirm all schemas present and exported in Kargadan const object (line 193-198) and namespace (lines 202-228). |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| CommandExecutor.cs | RhinoCommon SDK | doc.BeginUndoRecord, EndUndoRecord, AddCustomUndoEvent, RhinoApp.RunScript, Command.EndCommand | WIRED | Lines 45, 53, 47-52 (BeginUndoRecord/EndUndoRecord/AddCustomUndoEvent in ExecuteDirectApi); lines 80-83 (Command.EndCommand subscribe/RunScript/unsubscribe in ExecuteScript) |
| CommandExecutor.cs | ProtocolModels.cs | ScriptResult, AgentUndoState model consumption | WIRED | ScriptResult.Create called at line 94. AgentUndoState constructed at line 50. |
| ObservationPipeline.cs | RhinoCommon SDK | 15 RhinoDoc event subscriptions + Command.UndoRedo | WIRED | Subscribe() lines 84-101 wire 15 RhinoDoc events. Command.UndoRedo += OnUndoRedo at line 51. |
| ObservationPipeline.cs | EventPublisher | EventPublisher.Publish for flushed event batches | NOT_WIRED | OnBatchFlushed (KargadanPlugin line 113-114) is a static method that only calls RhinoApp.WriteLine. No EventPublisher.Publish call exists in the batch flush path. The link between observation output and harness delivery is broken. |
| KargadanPlugin.cs | CommandExecutor.cs | CommandExecutor.ExecuteDirectApi and ExecuteScript invocation | PARTIAL | ExecuteScript is wired (line 239). ExecuteDirectApi is invoked (line 248) but the handler delegate passed to it returns Fin.Fail("not yet implemented") for all write operations — none of the 7 API facades are called from the dispatch path. |
| kargadan-schemas.ts | ProtocolEnums.cs | Schema literals match C# SmartEnum Key values | WIRED | All EventSubtype literals match: 'added', 'deleted', 'replaced', 'modified', 'undeleted', 'selected', 'deselected', 'deselect_all', 'properties_changed'. CommandExecutionMode: 'direct_api', 'script'. CommandCategory: 'read', 'write', 'geometric'. |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| EXEC-01 | 02-01 | Plugin wraps RhinoApp.RunScript(commandString, echo) for executing arbitrary Rhino commands | SATISFIED | ExecuteScript in CommandExecutor.cs (lines 67-105) wraps RhinoApp.RunScript with Command.EndCommand result tracking. Called from DispatchOperation when operation is CommandOperation.ScriptRun. |
| EXEC-02 | 02-01 | Plugin provides direct RhinoCommon API access for precise geometry operations | PARTIAL | 7 Fin<T>-returning facades exist in CommandExecutor.cs (AddObject, DeleteObject, ReplaceObject, TransformObject, FindById, FindByLayer, ModifyAttributes). However, DispatchOperation never invokes them — write operations return a stub Fin.Fail. The facades are implemented but not connected to the dispatch path. |
| EXEC-03 | 02-02 | Plugin subscribes to RhinoDoc events and pushes them to the harness with 200ms debounce batching | PARTIAL | Subscription (15 events) and 200ms debounce aggregation are fully implemented. The push to harness is missing: OnBatchFlushed only logs. Batches never reach the harness. |
| EXEC-04 | 02-01 | Each logical AI action wraps in a single BeginUndoRecord/EndUndoRecord pair so Cmd+Z undoes the entire action atomically | SATISFIED | ExecuteDirectApi (CommandExecutor.cs lines 37-60) wraps handler in BeginUndoRecord/EndUndoRecord pair. On handler failure, doc.Undo() is called to roll back. RunScript correctly does NOT use this path (creates its own record). |
| EXEC-05 | 02-01, 02-02 | Agent state snapshots stored via AddCustomUndoEvent so undo/redo keeps agent model consistent | PARTIAL | AddCustomUndoEvent is called in ExecuteDirectApi (line 47) with AgentUndoState tag. MakeUndoHandler re-registers correctly for redo. BUT PublishUndoEvent in KargadanPlugin never calls EventPublisher.Publish — the harness notification of undo/redo state changes is a stub. |

**Orphaned Requirements Check:** REQUIREMENTS.md Traceability table maps EXEC-01 through EXEC-05 to Phase 2 and marks all as Complete. These all appear in the plan frontmatter. No orphaned requirements for this phase.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| KargadanPlugin.cs | 113-114 | OnBatchFlushed logs only — `RhinoApp.WriteLine(...)` with no Publish call | BLOCKER | Event batches from ObservationPipeline never reach the harness. EXEC-03 goal ("pushes them to the harness") is not achieved. |
| KargadanPlugin.cs | 257-270 | PublishUndoEvent builds delta but `eventId.Map` block returns `unit` without calling EventPublisher.Publish | BLOCKER | Undo/redo notifications never reach the harness. EXEC-05 agent state consistency goal is not achieved. |
| KargadanPlugin.cs | 247-253 | DispatchOperation: read ops return Fin.Fail("not yet implemented"); write ops pass a handler that returns Fin.Fail("not yet implemented") | WARNING | Direct API write operations (ObjectCreate, ObjectDelete, ObjectUpdate) cannot execute. Only ScriptRun works end-to-end. Documented as intentional per plan but directly undermines EXEC-02. |

---

## Human Verification Required

### 1. ScriptRun End-to-End Execution

**Test:** Connect harness to plugin and send a `script.run` command with `"script": "Box 0,0,0 10,10,10"`. Observe Rhino viewport.
**Expected:** Box appears in document; harness receives CommandResultEnvelope.Success with ScriptResult containing commandName="Box", commandResult=0, objectsCreatedCount=1.
**Why human:** Requires live Rhino 9 WIP instance with plugin loaded; cannot verify RhinoApp.RunScript behavior programmatically.

### 2. Cmd+Z Atomic Undo

**Test:** Execute a `write.object.create` command (when wired), then press Cmd+Z in Rhino.
**Expected:** Created object disappears from document; harness receives undo notification.
**Why human:** Requires live Rhino instance; undo behavior depends on BeginUndoRecord/EndUndoRecord interaction with Rhino's undo stack.

### 3. Command.EndCommand Result Capture

**Test:** Execute a script command that the user cancels mid-execution (press Escape during RunScript).
**Expected:** Harness receives Fin.Fail with ScriptCancelled error, not a success result.
**Why human:** CA1508 pragma suppression on capturedResult — requires live test to confirm the event handler side-effect actually mutates capturedResult before the switch expression evaluates.

---

## Gaps Summary

Three gaps block full goal achievement. Two are hard blockers that prevent the harness from receiving any event or undo notification:

**Gap 1 (BLOCKER — EXEC-03): Event batches never pushed to harness.**
`OnBatchFlushed` in KargadanPlugin.cs is a static logging callback. It does not have access to BoundaryState and cannot call EventPublisher.Publish. The plan specified wrapping EventBatchSummary into an EventEnvelope and publishing through EventPublisher, but the implementation used a simple `RhinoApp.WriteLine`. The subscription, aggregation, and timer flush are all correct — only the terminal delivery step is missing.

**Gap 2 (BLOCKER — EXEC-05): Undo notifications never pushed to harness.**
`PublishUndoEvent` builds the delta JSON correctly but its `eventId.Map` block never calls `state.EventPublisher.Publish`. The comment "best-effort publish -- undo event notification failure should not block undo operation" is present but the publish call itself is absent. The pattern exists correctly in `PublishLifecycleEvent` (line 117-133) and must be replicated here.

**Gap 3 (WARNING — EXEC-02): Direct API write facades are unreachable from dispatch.**
`DispatchOperation` passes a static handler that always returns Fin.Fail for non-ScriptRun write operations. The 7 CommandExecutor facades (AddObject, DeleteObject, etc.) are substantively implemented but no dispatch path connects CommandEnvelope to them. This was documented as intentional partial scope in the plan ("ScriptRun is the fully wired critical path") but means EXEC-02 ("direct RhinoCommon API access for precise geometry operations") is not satisfied end-to-end.

The two blocker gaps share a root cause: the observation/notification delivery paths were stubbed during implementation and the stubs were not flagged as gaps in the SUMMARY. The fixes are targeted: OnBatchFlushed needs BoundaryState access + EventEnvelope wrapping, and PublishUndoEvent needs a single Publish call added inside the Map block.

---

_Verified: 2026-02-22T10:45:00Z_
_Verifier: Claude (gsd-verifier)_
