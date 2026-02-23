# Phase 2: RhinoDoc Execution and Events - Research

**Researched:** 2026-02-22
**Updated:** 2026-02-22 (re-research -- verified all claims against official docs, corrected UndoActive/RedoActive sourcing, refined RunScript undo strategy, added ObjectTable API coverage)
**Domain:** RhinoCommon SDK -- command execution, undo system, document events, direct API access
**Confidence:** MEDIUM-HIGH

## Summary

The RhinoCommon SDK provides a well-defined but constraint-heavy API surface for command execution, undo management, and document event observation. The undo system (`BeginUndoRecord`/`EndUndoRecord`/`AddCustomUndoEvent`) works outside of formal Rhino commands -- confirmed by Dale Fugier (McNeel) -- which is critical since all agent operations execute from plugin code via WebSocket dispatch, not from Rhino command classes. `RunScript` returns only a boolean (did Rhino attempt to run, not did the command succeed), making `Command.EndCommand` event subscription mandatory for reliable result detection. Document events fire on the UI thread, which simplifies event aggregation but reinforces the existing `ThreadMarshaler` pattern from Phase 1.

The bifurcated undo strategy (CONTEXT.md decision) is the most architecturally significant constraint. Direct API calls use `BeginUndoRecord`/`EndUndoRecord` with `AddCustomUndoEvent` for agent state snapshots. RunScript calls must NOT be wrapped in `BeginUndoRecord`/`EndUndoRecord` because RunScript internally delegates to a command that creates its own undo record -- nesting them risks conflict. For RunScript operations, agent state tracking must use an alternative mechanism keyed to the undo serial number.

There is **no programmatic way to cancel a running Rhino command**. McNeel has explicitly stated this (Dale Fugier: "There is no programatic way... of canceling one"). Timeout enforcement wraps `WaitAsync()` on the calling side -- the harness receives a timeout error, but the Rhino command may still be running. `RhinoApp.SendKeystrokes` with Escape is unreliable best-effort only.

**Primary recommendation:** Use direct RhinoCommon API (`doc.Objects.Add*`, `doc.Objects.Replace`, `doc.Objects.Delete`, `doc.Layers`) for all typed operations; reserve `RunScript` as escape hatch for commands without API equivalents. Wrap all document-modifying direct API operations in `BeginUndoRecord`/`EndUndoRecord` pairs with `AddCustomUndoEvent` for agent state snapshots. Subscribe to `Command.UndoRedo` event to detect Cmd+Z/Cmd+Shift+Z.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- One tool call = one undo record -- each discrete tool call (create, set material, move) gets its own `BeginUndoRecord`/`EndUndoRecord` pair
- **Bifurcated undo strategy**: Direct API calls use `BeginUndoRecord`/`EndUndoRecord` with `AddCustomUndoEvent`. RunScript calls must NOT be wrapped (RunScript creates its own undo record). Agent state for RunScript ops needs alternative tracking keyed to undo serial number.
- `AddCustomUndoEvent` callback must re-register itself for redo support, and must NEVER modify RhinoDoc -- only private plugin data
- When user presses Cmd+Z, plugin detects via `Command.UndoRedo` event and notifies the harness -- agent updates its internal model
- Agent acknowledges undone actions proactively in its next response
- Subscribe to ALL document change events: object add/delete/modify, layer changes, undo/redo, selection changes, material changes, view changes
- No distinction between agent-triggered and user-triggered events -- all processed uniformly
- Events consolidated into summarized batches -- total count with tagged categories, not raw event dumps
- Agent can drill down into specific event categories on demand
- API-first: prefer RhinoCommon API for typed inputs/outputs; RunScript as escape hatch
- RunScript commands echo to Rhino's command line (transparency)
- Support scripted input for interactive commands
- One command per WebSocket message -- aligns with per-tool-call undo boundaries
- **Typed error passthrough**: RunScript returns boolean only -- actual success/failure via `Command.EndCommand` event's `CommandResult` enum. Direct API calls return typed values (Guid.Empty, false, null).
- All-or-nothing execution: if any sub-operation fails, roll back and report failure
- **Timeout = harness gives up, not command cancellation**: No programmatic cancellation exists. Timeout wraps `WaitAsync()` on calling side.
- Two-phase response: "command started" ack immediately, then final result when execution completes

### Claude's Discretion
- Whether read-only tool calls create undo records (recommendation: no -- reads do not modify document)
- Concurrency model for user changes during agent mid-operation (recommendation: Rhino UI thread serializes naturally)
- Default timeout values per command category (recommendation: reads 5s, writes 30s, geometric ops 120s)
- Event debounce window tuning (200ms baseline from requirements)
- Exact event summary format and drill-down protocol
- Agent state snapshot mechanism for RunScript-based operations

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXEC-01 | Plugin wraps `RhinoApp.RunScript(commandString, echo)` for executing arbitrary Rhino commands by string | RunScript API verified: `bool RunScript(string script, bool echo)` returns boolean (script attempted, not success). Must pair with `Command.EndCommand` event for actual `CommandResult` detection. Scripted input via `"-_CommandName param1 param2"` syntax. Object references invalidated after call. |
| EXEC-02 | Plugin provides direct RhinoCommon API access for precise geometry operations | ObjectTable API verified: 40+ `Add*` methods (AddBrep, AddMesh, AddCurve, AddSurface, AddExtrusion, AddPoint, AddLine, AddArc, AddCircle, AddEllipse, AddPolyline, AddText, AddClippingPlane), `Replace`, `Delete`, `Transform`, `FindId`, `FindByLayer`, `FindByFilter`, `ModifyAttributes`, `GetObjectList`, `AllObjectsSince`. All return typed values. |
| EXEC-03 | Plugin subscribes to RhinoDoc events and pushes them to the harness with 200ms debounce batching | 35 events verified on RhinoDoc class. Event args provide ObjectId, TheObject (for object events), OldRhinoObject (for replace events). Events fire on UI thread. `UndoActive`/`RedoActive` boolean properties confirmed on RhinoDoc for distinguishing undo/redo-triggered events. |
| EXEC-04 | Each logical AI action wraps in a single BeginUndoRecord/EndUndoRecord pair | API verified: `uint BeginUndoRecord(string description)` + `bool EndUndoRecord(uint sn)`. Works outside commands (Dale Fugier confirmed). Must NOT nest inside RunScript calls. Bifurcated strategy required per CONTEXT.md. |
| EXEC-05 | Agent state snapshots stored via AddCustomUndoEvent | API verified: `bool AddCustomUndoEvent(string description, EventHandler<CustomUndoEventArgs> handler, object tag)`. CustomUndoEventArgs has Tag (object), Document (RhinoDoc), CreatedByRedo (bool), UndoSerialNumber (uint), ActionDescription (string), CommandId (Guid). Callback must re-register for redo. Works outside commands ONLY when bracketed by BeginUndoRecord/EndUndoRecord. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| RhinoCommon SDK | 8.x (Rhino 9 WIP) | Plugin SDK for Rhino document manipulation | The only official SDK; all Rhino plugins use it |
| System.Text.Json | (built-in) | JSON serialization for event payloads and protocol messages | Already used in Phase 1 plugin code; no additional dependency |
| LanguageExt.Core | 5.0.0-beta-77 | Functional combinators (Fin, Option, Seq, Atom, Ref) | Already used in Phase 1; workspace-pinned version |
| NodaTime | 3.3.0 | Timestamp precision for event batching and execution timing | Already used in Phase 1; workspace-pinned version |
| Thinktecture.Runtime.Extensions | 10.0.0 | SmartEnum for command operation tags, event category types | Already used in Phase 1; workspace-pinned version |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| System.Threading.Channels | (built-in) | Bounded channel for event aggregation pipeline | Event debounce/batch accumulation before WebSocket push |
| System.Timers.Timer | (built-in) | Debounce timer for event batching (200ms window) | Timer-triggered flush of accumulated event batch |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| System.Threading.Channels | ConcurrentQueue + polling | Channels have built-in backpressure and async read; ConcurrentQueue requires manual polling loop |
| System.Timers.Timer | System.Threading.Timer | System.Timers.Timer auto-marshals to sync context; Threading.Timer does not. Either works since we explicitly marshal to UI thread anyway |

## Architecture Patterns

### Recommended Project Structure

```
apps/kargadan/plugin/src/
  boundary/
    KargadanPlugin.cs          # [EXISTING] Plugin entry point; gains command execution dispatch routing
    EventPublisher.cs          # [EXISTING] Lock-gated event queue; gains RhinoDoc event subscriptions
  contracts/
    ProtocolEnvelopes.cs       # [EXISTING] Gains execution result envelope variants and event batch envelope
    ProtocolEnums.cs           # [EXISTING] Gains new CommandOperation variants (RunScript, DirectApi) and EventCategory
    ProtocolModels.cs          # [EXISTING] Gains event batch models (EventBatchSummary, CategoryCount)
    ProtocolValueObjects.cs    # [EXISTING] Gains UndoRecordId value object
  protocol/
    Router.cs                  # [EXISTING] Command envelope decoding -- gains new operation routing
  transport/
    ThreadMarshaler.cs         # [EXISTING] UI thread dispatch -- no changes needed
    WebSocketHost.cs           # [EXISTING] WebSocket listener -- no changes needed
    SessionHost.cs             # [EXISTING] Session state machine -- no changes needed
  execution/
    CommandExecutor.cs         # [NEW] Orchestrates command execution with undo wrapping and rollback
    ScriptRunner.cs            # [NEW] RunScript wrapper with Command.EndCommand result tracking
    DocumentApi.cs             # [NEW] Direct RhinoCommon API facade (Objects, Layers, Views)
  observation/
    EventSubscriber.cs         # [NEW] RhinoDoc event subscription manager (subscribe/unsubscribe lifecycle)
    EventAggregator.cs         # [NEW] Debounce/batch/summarize event stream via Channel + Timer
    UndoObserver.cs            # [NEW] Command.UndoRedo event handler; notifies harness of undo/redo
```

### Pattern 1: Undo-Wrapped Direct API Execution

**What:** Every document-modifying direct API tool call brackets all operations within a single `BeginUndoRecord`/`EndUndoRecord` pair, with an `AddCustomUndoEvent` for agent state. Reads do not create undo records.

**When to use:** All write operations via direct RhinoCommon API (object create, modify, delete, layer changes, etc.)

**Example:**
```csharp
// Source: RhinoCommon API + McNeel forum confirmation
// https://discourse.mcneel.com/t/rhinocommon-beginundorecord-and-endundorecord/7213
// https://discourse.mcneel.com/t/can-addcustomundoevent-be-used-outside-of-a-rhino-command/141123

// CommandExecutor.cs -- direct API path
public Fin<CommandResultEnvelope> ExecuteDirectApi(
    RhinoDoc doc,
    CommandEnvelope envelope,
    Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>> handler) {

    string description = envelope.UndoScope.Map(scope => scope.Value).IfNone("Agent Action");
    uint undoSerial = doc.BeginUndoRecord(description);

    Fin<JsonElement> result = handler(doc, envelope);

    // Agent state snapshot -- callback re-registers itself for redo support
    doc.AddCustomUndoEvent(
        "Agent State Snapshot",
        OnAgentUndoRedo,
        new AgentUndoState(envelope.Identity.RequestId, undoSerial));

    _ = doc.EndUndoRecord(undoSerial);

    return result.Match(
        Succ: payload => BuildSuccess(envelope, payload, undoSerial),
        Fail: error => {
            // Roll back on failure -- all-or-nothing
            _ = doc.Undo();
            return BuildFailure(envelope, error);
        });
}

// CRITICAL: Callback must re-register for redo; must NEVER modify RhinoDoc
static void OnAgentUndoRedo(object sender, CustomUndoEventArgs e) {
    AgentUndoState state = (AgentUndoState)e.Tag;
    // Re-register with current state for the reverse operation
    e.Document.AddCustomUndoEvent(
        "Agent State Snapshot",
        OnAgentUndoRedo,
        new AgentUndoState(state.RequestId, state.UndoSerial));
    // Notify harness that agent state changed due to undo/redo
    // EventPublisher enqueues notification for WebSocket push
}
```

**Confidence:** HIGH -- `BeginUndoRecord`/`EndUndoRecord` outside commands confirmed by Dale Fugier (McNeel). `AddCustomUndoEvent` outside commands works when bracketed by `BeginUndoRecord`/`EndUndoRecord` (McNeel forum confirmation). Callback re-registration pattern from official RhinoCommon custom undo sample.

### Pattern 2: RunScript with Result Detection via Command.EndCommand

**What:** `RunScript` returns only a bool (did Rhino attempt to run), not whether the command succeeded. Subscribe to `Command.EndCommand` to capture `CommandResult` enum for actual success/failure detection. Do NOT wrap in `BeginUndoRecord` -- RunScript creates its own undo record.

**When to use:** All `RunScript` invocations.

**Example:**
```csharp
// Source: https://discourse.mcneel.com/t/return-from-rhinoapp-runscript/194275
// Source: https://developer.rhino3d.com/api/rhinocommon/rhino.commands.commandeventargs

// ScriptRunner.cs
public Fin<ScriptResult> RunScripted(RhinoDoc doc, string commandScript, bool echo) {
    Commands.Result capturedResult = Commands.Result.Nothing;
    string capturedCommandName = string.Empty;

    void OnEndCommand(object sender, CommandEventArgs args) {
        capturedResult = args.CommandResult;
        capturedCommandName = args.CommandEnglishName;
    }

    Command.EndCommand += OnEndCommand;
    // Snapshot serial number before execution to track new objects
    uint snBefore = doc.Objects.NextRuntimeSerialNumber;
    bool ran = RhinoApp.RunScript(commandScript, echo);
    Command.EndCommand -= OnEndCommand;

    // Do NOT use BeginUndoRecord here -- RunScript creates its own undo record
    return ran switch {
        false => Fin.Fail<ScriptResult>(Error.New("Rhino did not execute the script.")),
        true => capturedResult switch {
            Commands.Result.Success => Fin.Succ(new ScriptResult(
                CommandName: capturedCommandName,
                CommandResult: capturedResult,
                ObjectsCreated: doc.Objects.AllObjectsSince(snBefore))),
            Commands.Result.Cancel => Fin.Fail<ScriptResult>(
                Error.New($"Command '{capturedCommandName}' was cancelled.")),
            Commands.Result.Nothing => Fin.Fail<ScriptResult>(
                Error.New($"Command '{capturedCommandName}' did nothing.")),
            _ => Fin.Fail<ScriptResult>(
                Error.New($"Command '{capturedCommandName}' failed: {capturedResult}")),
        },
    };
}
```

**Confidence:** HIGH -- RunScript boolean-only return confirmed by Dale Fugier (McNeel). `Command.EndCommand` + `CommandEventArgs.CommandResult` is the documented approach. `Commands.Result` enum values: Success(0), Cancel(1), Nothing(2), Failure(3), UnknownCommand(4), CancelModelessDialog(5), ExitRhino(0x0FFFFFFF). `AllObjectsSince(uint32)` returns `IEnumerable<RhinoObject>`.

### Pattern 3: Event Aggregation with Debounced Batching

**What:** Subscribe to all RhinoDoc events, write to a bounded `Channel<RawDocEvent>` immediately (fast on UI thread), flush as a summarized batch after the debounce window (200ms) expires.

**When to use:** Continuous document observation.

**Example:**
```csharp
// EventAggregator.cs -- accumulates events, flushes as batched summary
// Uses System.Threading.Channels for thread-safe accumulation with backpressure

Channel<RawDocEvent> _channel = Channel.CreateBounded<RawDocEvent>(
    new BoundedChannelOptions(256) {
        FullMode = BoundedChannelFullMode.DropOldest,
        SingleWriter = false,
        SingleReader = true
    });

// Event handlers write to channel -- fast, non-blocking on UI thread
void OnAddRhinoObject(object sender, RhinoObjectEventArgs e) {
    _ = _channel.Writer.TryWrite(new RawDocEvent(
        Type: EventType.ObjectsChanged,
        SubType: "added",
        ObjectId: Option<Guid>.Some(e.ObjectId),
        ObjectType: e.TheObject.ObjectType.ToString(),
        IsUndoRedo: e.Document.UndoActive || e.Document.RedoActive));
}

void OnReplaceRhinoObject(object sender, RhinoReplaceObjectEventArgs e) {
    _ = _channel.Writer.TryWrite(new RawDocEvent(
        Type: EventType.ObjectsChanged,
        SubType: "replaced",
        ObjectId: Option<Guid>.Some(e.ObjectId),
        OldObjectId: Option<Guid>.Some(e.OldRhinoObject.Id)));
}

// Timer-triggered flush (200ms) drains channel and builds summary
EventBatchSummary Flush() {
    Seq<RawDocEvent> pending = DrainChannel();
    return new EventBatchSummary(
        TotalCount: pending.Count,
        Categories: pending
            .GroupBy(static e => e.Type)
            .Map(group => new CategoryCount(
                Category: group.Key,
                Count: group.Count(),
                Subtypes: group
                    .GroupBy(static e => e.SubType)
                    .Map(sub => new SubtypeCount(sub.Key, sub.Count())))),
        ContainsUndoRedo: pending.Any(static e => e.IsUndoRedo),
        BatchWindowMs: 200);
}
```

**Confidence:** HIGH -- 35 events verified on RhinoDoc class from official API docs. Event args provide ObjectId, TheObject. `UndoActive`/`RedoActive` boolean properties confirmed on RhinoDoc for distinguishing undo/redo events. Channel-based aggregation is standard .NET pattern. SampleCsEventWatcher reference implementation confirms event subscription pattern.

### Pattern 4: Undo Detection and Harness Notification

**What:** Subscribe to `Command.UndoRedo` event to detect Cmd+Z/Cmd+Shift+Z. `UndoRedoEventArgs` provides `IsBeginUndo`/`IsEndUndo`/`IsBeginRedo`/`IsEndRedo` flags plus `UndoSerialNumber`.

**When to use:** Always active while plugin is loaded.

**Example:**
```csharp
// Source: RhinoCommon source (rhinosdkcommand.cs)
// Source: https://developer.rhino3d.com/api/rhinocommon/rhino.commands.command/undoredo
// UndoObserver.cs

void OnUndoRedo(object sender, UndoRedoEventArgs e) {
    // Emit only on completion, not on begin
    // IsBeginUndo = event_type 3, IsEndUndo = event_type 4
    // IsBeginRedo = event_type 5, IsEndRedo = event_type 6
    (e.IsEndUndo, e.IsEndRedo) switch {
        (true, _) => _eventPublisher.Publish(EventEnvelope.Create(
            eventType: EventType.UndoRedo,
            delta: new { isUndo = true, serial = e.UndoSerialNumber })),
        (_, true) => _eventPublisher.Publish(EventEnvelope.Create(
            eventType: EventType.UndoRedo,
            delta: new { isRedo = true, serial = e.UndoSerialNumber })),
        _ => unit, // Ignore begin events
    };
}

// Subscribe in plugin OnLoad:
Command.UndoRedo += _undoObserver.OnUndoRedo;
```

**Confidence:** HIGH -- `UndoRedoEventArgs` properties verified from RhinoCommon source code and official API docs. Properties: `IsBeginUndo`, `IsEndUndo`, `IsBeginRedo`, `IsEndRedo`, `IsPurgeRecord`, `UndoSerialNumber`, `IsBeginRecording`, `IsEndRecording`.

### Pattern 5: Two-Phase Response with Timeout

**What:** Send "command started" acknowledgment immediately before UI thread dispatch, then execute with timeout and send final result. Timeout wraps `WaitAsync()` -- Rhino command may still be running.

**When to use:** All command dispatch from WebSocket to UI thread.

**Example:**
```csharp
// Integrates with existing KargadanPlugin.DispatchCommandAsync pattern from Phase 1
public async Task<Fin<JsonElement>> DispatchCommandAsync(
    JsonElement message,
    CancellationToken cancellationToken) {

    // Phase 1: Send ack immediately (before UI thread dispatch)
    await SendAckAsync(message);

    // Phase 2: Execute on UI thread with per-command timeout
    int deadlineMs = ExtractDeadlineMs(message);
    using CancellationTokenSource timeoutCts =
        CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
    timeoutCts.CancelAfter(TimeSpan.FromMilliseconds(deadlineMs));

    Fin<JsonElement> result = await ThreadMarshaler.RunOnUiThreadAsync(() =>
        _executor.Execute(doc, envelope, handler)
    ).WaitAsync(timeoutCts.Token).ConfigureAwait(false);

    return result;
}
```

**Confidence:** HIGH -- `ThreadMarshaler.RunOnUiThreadAsync` already implemented in Phase 1. `WaitAsync(CancellationToken)` is standard .NET Task extension. Two-phase response is a CONTEXT.md locked decision.

### Anti-Patterns to Avoid

- **Wrapping RunScript in BeginUndoRecord/EndUndoRecord:** RunScript delegates to a command that creates its own undo record. Nesting `BeginUndoRecord` around it risks conflicting undo state. Use `BeginUndoRecord`/`EndUndoRecord` ONLY for direct API calls.
- **Holding RhinoDoc object references across RunScript calls:** `RunScript` invalidates all pointers and references to runtime database objects. After `RunScript`, re-query any objects needed. This is an explicit warning from McNeel's official guide.
- **Polling for command completion:** Use `Command.EndCommand` event for result detection, not post-call polling.
- **Modifying RhinoDoc inside AddCustomUndoEvent callbacks:** McNeel explicitly warns "NEVER change any setting in the Rhino document or application" inside the undo handler. Only modify private plugin data and notify harness.
- **Creating undo records for read operations:** Read operations do not modify the document. Creating empty undo records pollutes the undo stack and confuses users.
- **Blocking the UI thread in event handlers:** Event handlers fire on the UI thread. Keep them fast -- write to `Channel<T>` and return immediately. No WebSocket writes, JSON serialization, or blocking operations.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Undo/redo record management | Custom undo stack | `RhinoDoc.BeginUndoRecord` / `EndUndoRecord` | Rhino's native undo system handles all document operations atomically; custom stacks drift from document state |
| Object creation | Manual geometry construction + doc insertion | `doc.Objects.AddBrep()`, `AddMesh()`, `AddCurve()`, etc. | ObjectTable provides 40+ typed Add methods with document integration, display pipeline notification, and undo recording |
| Object querying | Manual iteration over all objects | `doc.Objects.FindId()`, `FindByLayer()`, `FindByFilter()`, `AllObjectsSince()`, `GetObjectList()` | Built-in query methods handle deleted/hidden objects, layer filtering, runtime serial number tracking |
| Command result detection | Parsing Rhino command line output | `Command.EndCommand` event + `CommandEventArgs.CommandResult` | The only reliable way to detect command success/failure; `RunScript` boolean is insufficient |
| Event debouncing | Custom timer + lock + manual batching | `System.Threading.Channels` + `System.Timers.Timer` | Standard .NET infrastructure with built-in backpressure and thread safety |
| UI thread marshaling | Custom synchronization context | `RhinoApp.InvokeOnUiThread` (already in Phase 1 `ThreadMarshaler`) | Rhino provides the marshaling primitive; Phase 1 already wraps it |
| Command cancellation | Thread.Abort or manual interruption | `CancellationTokenSource` wrapping `WaitAsync` on the marshaled task | Rhino has no internal cancellation; Thread.Abort throws PlatformNotSupportedException on .NET Core |
| Object attribute modification | Manual property-by-property updates | `doc.Objects.ModifyAttributes(guid, newAttributes, quiet)` | ObjectTable.ModifyAttributes handles undo recording and display pipeline updates |

**Key insight:** Rhino's document model is a closed system. Every attempt to maintain parallel state (shadow undo stack, cached object lists, synthetic event streams) will eventually diverge from Rhino's truth. Use Rhino's built-in primitives for everything document-related; only build aggregation/batching/protocol layers on top.

## Common Pitfalls

### Pitfall 1: RunScript Returns Bool, Not Command Result
**What goes wrong:** Developer assumes `RunScript` returning `true` means the command succeeded. It does not -- it means Rhino attempted to run the script.
**Why it happens:** The API signature `bool RunScript(string, bool)` implies success/failure semantics.
**How to avoid:** Always subscribe to `Command.EndCommand` event before calling `RunScript`. Check `CommandEventArgs.CommandResult` for actual success/failure. The `Commands.Result` enum has 7 values: Success, Cancel, Nothing, Failure, UnknownCommand, CancelModelessDialog, ExitRhino.
**Warning signs:** Objects expected to be created are missing after `RunScript` returns `true`.

### Pitfall 2: Object References Invalidated After RunScript
**What goes wrong:** Code holds a reference to a `RhinoObject` before calling `RunScript`, then accesses it after. Crash or stale data.
**Why it happens:** `RunScript` can "change the dynamic arrays in the run-time database," making all existing pointers and references invalid. McNeel official guide: "Rhino will probably crash."
**How to avoid:** Never cache `RhinoObject` references across `RunScript` calls. Re-query objects by GUID via `doc.Objects.FindId(guid)` or use `doc.Objects.AllObjectsSince(serialNumber)` to find newly created objects.
**Warning signs:** `NullReferenceException` or `ObjectDisposedException` after `RunScript` calls.

### Pitfall 3: Undo Callback Modifying Document
**What goes wrong:** `AddCustomUndoEvent` callback attempts to modify `RhinoDoc` objects, causing corruption or crashes.
**Why it happens:** Developers naturally want to sync document state in the undo handler.
**How to avoid:** Undo handler MUST only modify private plugin data (agent state snapshots). Document state is restored by Rhino's own undo mechanism. The handler just needs to re-register itself and notify the harness. McNeel explicitly warns against document modification in callback.
**Warning signs:** Document corruption, infinite undo loops, redo stops working, or crashes during Cmd+Z.

### Pitfall 4: Nesting BeginUndoRecord Around RunScript
**What goes wrong:** Calling `BeginUndoRecord`, then `RunScript`, then `EndUndoRecord` creates conflicting undo state because RunScript creates its own undo record for the command it runs.
**Why it happens:** Developers want uniform undo wrapping for all operations.
**How to avoid:** Use the bifurcated strategy: `BeginUndoRecord`/`EndUndoRecord` ONLY for direct API calls. For RunScript, let the command create its own undo record. Track agent state for RunScript operations via alternative mechanism (undo serial number tracking).
**Warning signs:** Undo history shows duplicate entries, Cmd+Z skips operations, or redo breaks.

### Pitfall 5: No Programmatic Command Cancellation
**What goes wrong:** Developer attempts to cancel a running Rhino command (e.g., a long BooleanUnion via RunScript) and finds no API for it.
**Why it happens:** McNeel has explicitly stated: "There is no programatic way... of canceling one."
**How to avoid:** Implement timeout at the transport layer: `ThreadMarshaler.RunOnUiThreadAsync(...).WaitAsync(timeout)`. If timeout expires, the Rhino command continues running but the harness receives a timeout error. `RhinoApp.SendKeystrokes` with Escape is unreliable best-effort only -- particularly on macOS where Apple restricts keystroke automation.
**Warning signs:** Plugin appears hung on a long-running command with no way to abort.

### Pitfall 6: Event Handler Thread Blocking
**What goes wrong:** Event handlers perform blocking operations (WebSocket writes, JSON serialization, waiting on async results), freezing the Rhino UI.
**Why it happens:** RhinoDoc events fire on the main UI thread, but developers may not realize handler duration directly impacts UI responsiveness.
**How to avoid:** Keep event handlers fast -- write a struct to a `Channel<T>` via `TryWrite` and return immediately. All serialization, WebSocket writes, and aggregation happen on the consumer side of the channel, off the UI thread critical path.
**Warning signs:** Rhino UI freezes during rapid document changes (multi-object creation, complex undo).

### Pitfall 7: AddCustomUndoEvent Without BeginUndoRecord
**What goes wrong:** Calling `AddCustomUndoEvent` without first calling `BeginUndoRecord` silently fails -- the custom undo event is not recorded.
**Why it happens:** The API does not throw an error; it simply returns false.
**How to avoid:** Always bracket `AddCustomUndoEvent` within `BeginUndoRecord`/`EndUndoRecord` when calling from outside a command context (which is our case -- we dispatch from WebSocket handler, not from a Rhino command).
**Warning signs:** Undo/redo does not restore agent state; `AddCustomUndoEvent` returns false.

## Code Examples

### Complete Event Subscription Setup

```csharp
// Source: SampleCsEventWatcher reference implementation
// https://github.com/gtalarico/apidocs.samples/.../SampleCsEventHandlers.cs
// Verified against official RhinoDoc events list (35 events)

// EventSubscriber.cs -- subscribes to all phase-relevant RhinoDoc events
public sealed class EventSubscriber {
    private readonly Channel<RawDocEvent> _channel;

    public void Subscribe() {
        // Object events
        RhinoDoc.AddRhinoObject += OnAddObject;
        RhinoDoc.DeleteRhinoObject += OnDeleteObject;
        RhinoDoc.UndeleteRhinoObject += OnUndeleteObject;
        RhinoDoc.ReplaceRhinoObject += OnReplaceObject;
        RhinoDoc.ModifyObjectAttributes += OnModifyAttributes;
        // Selection events
        RhinoDoc.SelectObjects += OnSelectObjects;
        RhinoDoc.DeselectObjects += OnDeselectObjects;
        RhinoDoc.DeselectAllObjects += OnDeselectAll;
        // Table events
        RhinoDoc.LayerTableEvent += OnLayerTable;
        RhinoDoc.MaterialTableEvent += OnMaterialTable;
        RhinoDoc.DimensionStyleTableEvent += OnDimensionStyleTable;
        RhinoDoc.InstanceDefinitionTableEvent += OnInstanceDefinitionTable;
        RhinoDoc.LightTableEvent += OnLightTable;
        RhinoDoc.GroupTableEvent += OnGroupTable;
        // Document events
        RhinoDoc.DocumentPropertiesChanged += OnDocPropertiesChanged;
        // Command events
        Command.UndoRedo += OnUndoRedo;
        Command.EndCommand += OnEndCommand;
    }

    public void Unsubscribe() {
        RhinoDoc.AddRhinoObject -= OnAddObject;
        RhinoDoc.DeleteRhinoObject -= OnDeleteObject;
        RhinoDoc.UndeleteRhinoObject -= OnUndeleteObject;
        RhinoDoc.ReplaceRhinoObject -= OnReplaceObject;
        RhinoDoc.ModifyObjectAttributes -= OnModifyAttributes;
        RhinoDoc.SelectObjects -= OnSelectObjects;
        RhinoDoc.DeselectObjects -= OnDeselectObjects;
        RhinoDoc.DeselectAllObjects -= OnDeselectAll;
        RhinoDoc.LayerTableEvent -= OnLayerTable;
        RhinoDoc.MaterialTableEvent -= OnMaterialTable;
        RhinoDoc.DimensionStyleTableEvent -= OnDimensionStyleTable;
        RhinoDoc.InstanceDefinitionTableEvent -= OnInstanceDefinitionTable;
        RhinoDoc.LightTableEvent -= OnLightTable;
        RhinoDoc.GroupTableEvent -= OnGroupTable;
        RhinoDoc.DocumentPropertiesChanged -= OnDocPropertiesChanged;
        Command.UndoRedo -= OnUndoRedo;
        Command.EndCommand -= OnEndCommand;
    }

    // Object event handlers -- fast channel write, no blocking
    private void OnAddObject(object sender, RhinoObjectEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.ObjectsChanged,
            SubType: "added",
            ObjectId: Option<Guid>.Some(e.ObjectId),
            ObjectType: e.TheObject.ObjectType.ToString(),
            IsUndoRedo: e.Document.UndoActive || e.Document.RedoActive));

    private void OnDeleteObject(object sender, RhinoObjectEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.ObjectsChanged,
            SubType: "deleted",
            ObjectId: Option<Guid>.Some(e.ObjectId)));

    private void OnReplaceObject(object sender, RhinoReplaceObjectEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.ObjectsChanged,
            SubType: "replaced",
            ObjectId: Option<Guid>.Some(e.ObjectId),
            OldObjectId: Option<Guid>.Some(e.OldRhinoObject.Id)));

    private void OnUndoRedo(object sender, UndoRedoEventArgs e) {
        // Only emit on completion events, not begin events
        (bool isEnd, string subType) = (e.IsEndUndo, e.IsEndRedo) switch {
            (true, _) => (true, "undo"),
            (_, true) => (true, "redo"),
            _ => (false, string.Empty),
        };
        _ = isEnd switch {
            true => _channel.Writer.TryWrite(new RawDocEvent(
                Type: EventType.UndoRedo,
                SubType: subType,
                UndoSerial: Option<uint>.Some(e.UndoSerialNumber))),
            false => false,
        };
    }
}
```

### Direct RhinoCommon API: Object Operations

```csharp
// Source: https://developer.rhino3d.com/api/rhinocommon/rhino.docobjects.tables.objecttable

// DocumentApi.cs -- typed facade over RhinoDoc.Objects and RhinoDoc.Layers
public Fin<Guid> CreateObject(RhinoDoc doc, GeometryBase geometry, ObjectAttributes attributes) {
    Guid id = doc.Objects.Add(geometry, attributes);
    return (id == Guid.Empty) switch {
        true => Fin.Fail<Guid>(Error.New("Failed to add object to document.")),
        false => Fin.Succ(id),
    };
}

public Fin<Unit> DeleteObject(RhinoDoc doc, Guid objectId, bool quiet) {
    bool deleted = doc.Objects.Delete(objectId, quiet);
    return deleted switch {
        true => Fin.Succ(unit),
        false => Fin.Fail<Unit>(Error.New($"Failed to delete object {objectId}.")),
    };
}

public Fin<RhinoObject[]> QueryByLayer(RhinoDoc doc, string layerName) {
    RhinoObject[] objects = doc.Objects.FindByLayer(layerName);
    return Fin.Succ(objects ?? Array.Empty<RhinoObject>());
}

public Fin<RhinoObject> QueryById(RhinoDoc doc, Guid objectId) {
    RhinoObject obj = doc.Objects.FindId(objectId);
    return obj switch {
        null => Fin.Fail<RhinoObject>(Error.New($"Object {objectId} not found.")),
        _ => Fin.Succ(obj),
    };
}

public Fin<bool> ModifyAttributes(RhinoDoc doc, Guid objectId, ObjectAttributes newAttributes) {
    bool modified = doc.Objects.ModifyAttributes(objectId, newAttributes, quiet: true);
    return modified switch {
        true => Fin.Succ(true),
        false => Fin.Fail<bool>(Error.New($"Failed to modify attributes of object {objectId}.")),
    };
}

public Fin<Guid> TransformObject(RhinoDoc doc, Guid objectId, Transform transform, bool deleteOriginal) {
    Guid newId = doc.Objects.Transform(objectId, transform, deleteOriginal);
    return (newId == Guid.Empty) switch {
        true => Fin.Fail<Guid>(Error.New($"Failed to transform object {objectId}.")),
        false => Fin.Succ(newId),
    };
}
```

### RunScript with Scripted Input

```csharp
// Source: https://developer.rhino3d.com/guides/rhinocommon/run-rhino-command-from-plugin/

// The dash prefix suppresses dialog boxes for scripted mode
// The underscore prefix forces English command name regardless of locale
// Coordinates are space-separated (space = Enter at command line)

// Create a line from origin to (10,10,10):
RhinoApp.RunScript("_-Line 0,0,0 10,10,10", echo: true);

// Create a box with corner and dimensions:
RhinoApp.RunScript("_-Box 0,0,0 10,20,30", echo: true);

// Boolean union with pre-selected objects:
RhinoApp.RunScript("_-BooleanUnion _Enter", echo: true);

// Set material to specific layer:
RhinoApp.RunScript("_-Layer _Material \"Default\" _Enter", echo: true);

// Export to specific format (scripted file path):
RhinoApp.RunScript("_-Export \"/path/to/output.stl\" _Enter", echo: true);
```

### Event Batch Summary Format

```json
{
    "totalCount": 7,
    "categories": [
        {
            "type": "objects.changed",
            "count": 4,
            "subtypes": { "added": 3, "replaced": 1 }
        },
        {
            "type": "layers.changed",
            "count": 2
        },
        {
            "type": "undo.redo",
            "count": 1,
            "subtypes": { "undo": 1 }
        }
    ],
    "containsUndoRedo": true,
    "batchWindowMs": 200
}
```

Drill-down: harness sends a `read.events.detail` command with category filter to get full event data for a specific category from the retained batch.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| .NET Framework + Mono (macOS) | .NET Core / .NET 8+ unified runtime | Rhino 8 (2023) | Plugins use modern .NET; same runtime on macOS and Windows |
| Sandcastle-hosted API docs | New API docs platform (developer.rhino3d.com) | 2024 | Some old API doc URLs return 404; use new platform |
| `Thread.Abort()` for cancellation | `CancellationTokenSource` + cooperative cancellation | .NET Core deprecation | `Thread.Abort()` throws `PlatformNotSupportedException` on .NET Core |
| Separate ScriptRunner command class | Direct `InvokeOnUiThread` + `RunScript` | Current approach for plugins | Our dispatch runs from WebSocket handler, not from a Rhino command class |

**Deprecated/outdated:**
- **Old Sandcastle API docs URLs** (`mcneel.github.io/rhinocommon-api-docs`): Many return 404. Use `developer.rhino3d.com/api/rhinocommon/` instead.
- **Thread.Abort()**: Does not work on .NET Core. Some forum posts suggest it for cancellation; this is no longer viable.
- **Mono-specific macOS workarounds**: No longer applicable since Rhino 8 uses .NET Core on macOS.

## Open Questions

1. **RunScript synchronicity from InvokeOnUiThread context**
   - What we know: RunScript is synchronous when called from within a `ScriptRunner` command's `RunCommand()`. Our dispatch runs on the UI thread via `InvokeOnUiThread`, which is functionally the same thread but not within a command context.
   - What's unclear: Whether `InvokeOnUiThread` dispatch guarantees fully synchronous `RunScript` behavior identical to `RunCommand()`. McNeel forum thread on "RunScript in a thread" shows `RunScript` returns false from background threads but succeeds via UI dispatcher.
   - Recommendation: Implement `Command.EndCommand` event tracking regardless (needed for result detection). If `RunScript` is synchronous from our context, the `EndCommand` handler fires inline before the next line. If async, the handler catches completion. No behavioral difference in our architecture.
   - Confidence: MEDIUM -- evidence supports synchronous behavior from UI thread, but no explicit McNeel confirmation for `InvokeOnUiThread` specifically.

2. **Event delivery timing during RunScript execution**
   - What we know: Events fire on the UI thread. RunScript executes on the UI thread (via our `InvokeOnUiThread` dispatch).
   - What's unclear: Whether events fire during RunScript execution (inline, between sub-operations of the command) or are queued until RunScript returns.
   - Recommendation: The 200ms debounce window and Channel-based aggregation tolerate both behaviors. Events accumulate in the channel regardless of timing. No architectural change needed.
   - Confidence: LOW -- no documentation found on this specific behavior. Empirical testing needed.

3. **macOS ActiveDocumentChanged event ordering**
   - What we know: STATE.md notes this as a research concern. RhinoDoc API docs note "behavior differs between Mac and Windows" for ActiveDocumentChanged.
   - What's unclear: Exact differences in event ordering on macOS.
   - Recommendation: Defer. Phase 2 operates on `RhinoDoc.ActiveDoc` (single document). Multi-document support is v2 (ADVN-02). Do NOT subscribe to `ActiveDocumentChanged` in Phase 2.
   - Confidence: HIGH (for deferral decision)

4. **Agent state snapshot mechanism for RunScript operations**
   - What we know: `AddCustomUndoEvent` requires `BeginUndoRecord`/`EndUndoRecord` bracketing. RunScript must NOT be wrapped in `BeginUndoRecord`/`EndUndoRecord`. Therefore, `AddCustomUndoEvent` cannot be used for RunScript operations.
   - What's unclear: The best alternative mechanism for tracking agent state across RunScript undo/redo.
   - Recommendation: Use undo serial number tracking. Before RunScript, read `doc.UndoRecordCount` or track the serial number from the subsequent `Command.UndoRedo` event. Maintain a harness-side map of `undoSerialNumber -> agentStateSnapshot`. When `Command.UndoRedo` fires with `IsEndUndo`/`IsEndRedo`, harness looks up the serial number to restore/advance agent state.
   - Confidence: MEDIUM -- serial number tracking is architecturally sound, but requires harness-side bookkeeping rather than Rhino-native undo integration.

## Discretion Recommendations

1. **Read-only tool calls and undo records:** Do NOT create undo records for read operations. Reads (`doc.Objects.FindId`, `doc.Objects.FindByLayer`, scene summary queries) do not modify the document. Creating empty undo records pollutes the undo stack.

2. **Concurrency model:** Queue user changes during agent mid-operation. Since all operations run on the UI thread via `InvokeOnUiThread`, Rhino naturally serializes access. User operations wait until the agent's current tool call completes (or times out). No explicit concurrency model needed.

3. **Default timeouts:** Configured per command category via `deadlineMs` in `CommandEnvelope` (already exists from Phase 1):
   - Read operations: 5,000ms (5s)
   - Write operations: 30,000ms (30s)
   - Geometric operations (boolean, mesh, sweep): 120,000ms (2min)
   - Default (unspecified): 30,000ms

4. **Event debounce window:** 200ms as specified in requirements. Fast enough for responsive feedback, slow enough to batch rapid changes (multi-object selection, undo that touches many objects).

5. **Event summary format:** Tagged counts with drill-down capability. See Code Examples section for JSON format. Drill-down via `read.events.detail` command with category filter.

## Sources

### Primary (HIGH confidence)
- [RhinoCommon API - RhinoDoc class](https://developer.rhino3d.com/api/rhinocommon/rhino.rhinodoc) -- 35 events verified, BeginUndoRecord/EndUndoRecord/AddCustomUndoEvent methods, UndoActive/RedoActive properties
- [RhinoCommon API - ObjectTable class](https://developer.rhino3d.com/api/rhinocommon/rhino.docobjects.tables.objecttable) -- 40+ Add methods, Delete/Replace/Transform/Find/ModifyAttributes/AllObjectsSince methods
- [RhinoCommon API - CommandEventArgs](https://developer.rhino3d.com/api/rhinocommon/rhino.commands.commandeventargs) -- CommandResult, CommandEnglishName, CommandId, Document, DocumentRuntimeSerialNumber
- [RhinoCommon API - Commands.Result enum](https://developer.rhino3d.com/api/rhinocommon/rhino.commands.result) -- Success(0), Cancel(1), Nothing(2), Failure(3), UnknownCommand(4), CancelModelessDialog(5), ExitRhino(0x0FFFFFFF)
- [RhinoCommon API - Command.UndoRedo event](https://developer.rhino3d.com/api/rhinocommon/rhino.commands.command/undoredo) -- UndoRedoEventArgs with IsBeginUndo/IsEndUndo/IsBeginRedo/IsEndRedo/IsPurgeRecord/UndoSerialNumber
- [RhinoCommon source - rhinosdkdoc.cs](https://github.com/mcneel/rhinocommon/blob/master/dotnet/rhino/rhinosdkdoc.cs) -- BeginUndoRecord/EndUndoRecord/AddCustomUndoEvent signatures, event definitions
- [RhinoCommon source - rhinosdkcommand.cs](https://github.com/mcneel/rhinocommon/blob/master/dotnet/rhino/rhinosdkcommand.cs) -- UndoRedoEventArgs class implementation
- [SampleCsEventWatcher](https://github.com/gtalarico/apidocs.samples/blob/master/repos/rhinocommon/mcneel/rhino-developer-samples/rhinocommon/cs/SampleCsEventWatcher/SampleCsEventHandlers.cs) -- Complete event subscription reference implementation
- [Official Custom Undo Sample](https://developer.rhino3d.com/en/samples/rhinocommon/custom-undo/) -- AddCustomUndoEvent callback pattern with redo re-registration
- [Run Rhino Command from Plugin Guide](https://developer.rhino3d.com/guides/rhinocommon/run-rhino-command-from-plugin/) -- RunScript usage, ScriptRunner attribute, object reference invalidation warning

### Secondary (MEDIUM confidence)
- [McNeel Forum - AddCustomUndoEvent outside commands](https://discourse.mcneel.com/t/can-addcustomundoevent-be-used-outside-of-a-rhino-command/141123) -- Dale Fugier confirms works outside commands when bracketed by BeginUndoRecord/EndUndoRecord
- [McNeel Forum - BeginUndoRecord/EndUndoRecord](https://discourse.mcneel.com/t/rhinocommon-beginundorecord-and-endundorecord/7213) -- Dale Fugier: "only time you should need to call these is if modifying the document from outside of a running command". ScriptRunner commands group all RunScript modifications into one undo record automatically.
- [McNeel Forum - Redo with AddCustomUndoEvent](https://discourse.mcneel.com/t/redo-is-not-possible-after-using-addcustomundoevent-with-command/127569) -- Callback must re-register for redo; creates toggle between undo/redo handlers
- [McNeel Forum - RunScript return value](https://discourse.mcneel.com/t/return-from-rhinoapp-runscript/194275) -- Dale Fugier: boolean "is not an indication of whether or not the command completed successfully"
- [McNeel Forum - Cancelling commands](https://discourse.mcneel.com/t/how-to-escape-a-running-command-i-e-booleanunion/32137) -- Dale Fugier: "There is no programatic way... of canceling one"
- [McNeel Forum - RunScript in a thread](https://discourse.mcneel.com/t/runscript-in-a-thread/11683) -- RunScript returns false from background threads; succeeds via UI dispatcher
- [McNeel Forum - Document modification in undo callback](https://discourse.mcneel.com/t/updating-document-in-customundo-callback-method/106281) -- Dale Fugier advises against document modification in callback; use RhinoApp.Idle for deferred updates
- [McNeel Forum - Undo inside commands](https://discourse.mcneel.com/t/undo-record-insid-command/87894) -- Dale Fugier: "it is not possible to create an undo record inside of a command"

### Tertiary (LOW confidence)
- [McNeel Forum - Undo/Redo on RhinoCommon](https://discourse.mcneel.com/t/undo-redo-on-rhinocommon/127353) -- General discussion; Dale Fugier advises against custom undo handling for document objects
- [McNeel Forum - Rhino 9 WIP](https://discourse.mcneel.com/t/rhino-9-wip-available-now/180749) -- Rhino 9 WIP released April 2024; no specific SDK breaking changes documented for execution/undo APIs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- RhinoCommon is the only option; all APIs verified from source or official docs
- Architecture (undo system): MEDIUM-HIGH -- API signatures verified, McNeel engineer confirmations for BeginUndoRecord outside commands and AddCustomUndoEvent with bracket requirement. Bifurcated strategy for RunScript is MEDIUM (no direct McNeel confirmation of conflict, but inferred from "do not create undo record inside command" guidance).
- Architecture (event system): HIGH -- 35 events documented on official RhinoDoc page, event args verified from source, SampleCsEventWatcher reference implementation available, UndoActive/RedoActive confirmed as boolean properties
- Architecture (command execution): MEDIUM-HIGH -- RunScript limitations well-documented, result detection via EndCommand confirmed, Commands.Result enum verified with all 7 values. Synchronous behavior from InvokeOnUiThread context is MEDIUM (inferred, not explicitly confirmed).
- Pitfalls: HIGH -- Multiple McNeel engineer statements about common mistakes, verified across multiple forum threads
- Cancellation: HIGH -- Confirmed absence of programmatic cancellation by Dale Fugier in multiple threads

**Research date:** 2026-02-22
**Valid until:** 2026-04-22 (RhinoCommon API is stable; Rhino 9 WIP may add APIs but unlikely to remove or change execution/undo APIs)
