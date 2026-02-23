# Phase 2: RhinoDoc Execution and Events - Research

**Researched:** 2026-02-22
**Domain:** RhinoCommon SDK -- command execution, undo system, document events, direct API access
**Confidence:** MEDIUM-HIGH

## Summary

The RhinoCommon SDK provides a well-defined but constraint-heavy API surface for command execution, undo management, and document event observation. The undo system (`BeginUndoRecord`/`EndUndoRecord`/`AddCustomUndoEvent`) works outside of formal Rhino commands as confirmed by McNeel engineers, which is critical since all agent operations execute from plugin code via WebSocket dispatch, not from Rhino command classes. `RunScript` returns only a boolean (did Rhino run the script, not did the command succeed), making `Command.EndCommand` event subscription mandatory for reliable error detection. Document events fire on the UI thread, which simplifies event aggregation but reinforces the existing `ThreadMarshaler` pattern.

The most significant constraint is that **there is no programmatic way to cancel a running Rhino command**. McNeel has explicitly stated this. Timeout enforcement must therefore wrap the entire `ThreadMarshaler.RunOnUiThreadAsync` call with `CancellationTokenSource` on the calling side, not attempt to interrupt Rhino internals. For direct RhinoCommon API calls this is manageable; for `RunScript` calls, the only escape hatch is simulating an Escape key via `RhinoApp.SendKeystrokes`, which is unreliable.

**Primary recommendation:** Use direct RhinoCommon API (`doc.Objects.Add*`, `doc.Objects.Replace`, `doc.Objects.Delete`, `doc.Layers`) for all typed operations; reserve `RunScript` as escape hatch for commands without API equivalents. Wrap all document-modifying operations in `BeginUndoRecord`/`EndUndoRecord` pairs with `AddCustomUndoEvent` for agent state snapshots. Subscribe to `Command.UndoRedo` event (not just object events) to detect when the user presses Cmd+Z.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- One tool call = one undo record -- each discrete tool call (create, set material, move) gets its own `BeginUndoRecord`/`EndUndoRecord` pair
- Cmd+Z steps back through individual tool calls, not entire user instructions
- Agent state snapshots stored via `AddCustomUndoEvent` so undo/redo keeps agent's internal model consistent with the document
- When user presses Cmd+Z, plugin notifies the harness AND the agent updates its internal model to reflect the reversal
- Agent acknowledges undone actions proactively in its next response ("I see you undid the box creation")
- Subscribe to ALL document change events: object add/delete/modify, layer changes, undo/redo, selection changes, material changes, view changes
- No distinction between agent-triggered and user-triggered events -- all events processed uniformly regardless of source
- Events are consolidated into summarized batches -- total count of events with tagged categories (e.g., "3 objects added, 1 layer changed"), not raw event dumps
- Agent can drill down into specific event categories on demand if it needs detail
- API-first: prefer RhinoCommon API for typed inputs/outputs and precision; RunScript as escape hatch for commands without API equivalents
- RunScript commands echo to Rhino's command line -- user sees what's being run (transparency)
- Support scripted input for interactive commands -- agent can feed responses to mid-execution prompts (coordinates, selections)
- One command per WebSocket message -- no batch sequences; aligns with per-tool-call undo boundaries
- Pass through raw Rhino error output -- whatever Rhino reports goes to the harness as-is
- All-or-nothing execution: if any sub-operation in a command fails, roll back everything and report failure -- no partial success
- Configurable timeout: plugin enforces a timeout on command execution (default configurable) and cancels if exceeded
- Two-phase response: "command started" acknowledgment sent immediately, then final result (success or failure) when execution completes

### Claude's Discretion
- Whether read-only tool calls create undo records (or only writes)
- Concurrency model for user changes during agent mid-operation (interrupt vs queue)
- Default timeout value and cancellation mechanism based on Rhino's capabilities
- Event debounce window tuning (200ms baseline from requirements)
- Exact event summary format and drill-down protocol

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXEC-01 | Plugin wraps `RhinoApp.RunScript(commandString, echo)` for executing arbitrary Rhino commands by string | RunScript API verified: `bool RunScript(string script, bool echo)` returns boolean (script ran, not success). Must pair with `Command.EndCommand` event for result detection. Scripted input via `"-_CommandName param1 param2"` syntax. |
| EXEC-02 | Plugin provides direct RhinoCommon API access for precise geometry operations | ObjectTable API verified: `Add*`, `Replace`, `Delete`, `Transform`, `FindId`, `FindByLayer`, `ModifyAttributes`. Full typed API for create/modify/query. |
| EXEC-03 | Plugin subscribes to RhinoDoc events and pushes them to the harness with 200ms debounce batching | 35 events verified on RhinoDoc class. Event args provide ObjectId, TheObject, OldRhinoObject/NewRhinoObject. Events fire on UI thread. |
| EXEC-04 | Each logical AI action wraps in a single BeginUndoRecord/EndUndoRecord pair | API verified: `uint BeginUndoRecord(string description)` + `bool EndUndoRecord(uint sn)`. Works outside commands (confirmed by McNeel). Cannot nest inside commands. |
| EXEC-05 | Agent state snapshots stored via AddCustomUndoEvent | API verified: `bool AddCustomUndoEvent(string description, EventHandler<CustomUndoEventArgs> handler, object tag)`. CustomUndoEventArgs has Tag, Document, CreatedByRedo properties. Callback must re-register for redo support. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| RhinoCommon SDK | 8.x (Rhino 9 WIP) | Plugin SDK for Rhino document manipulation | The only official SDK; all Rhino plugins use it |
| System.Text.Json | (built-in) | JSON serialization for event payloads and protocol messages | Already used in Phase 1 plugin code; no additional dependency |
| LanguageExt.Core | 5.0.0-beta-77 | Functional combinators (Fin, Option, Seq, Atom, Ref) | Already used in Phase 1; workspace-pinned version |
| NodaTime | 3.3.0 | Timestamp precision for event batching and execution timing | Already used in Phase 1; workspace-pinned version |
| Thinktecture.Runtime.Extensions | 10.0.0 | SmartEnum for command operation tags, event types | Already used in Phase 1; workspace-pinned version |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| System.Threading.Channels | (built-in) | Bounded channel for event aggregation pipeline | Event debounce/batch accumulation before WebSocket push |
| System.Timers.Timer | (built-in) | Debounce timer for event batching (200ms window) | Timer-based flush of accumulated event batch |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| System.Threading.Channels | ConcurrentQueue + polling | Channels have built-in backpressure; ConcurrentQueue requires manual polling loop |
| System.Timers.Timer | System.Threading.Timer | System.Timers.Timer auto-marshals to sync context; Threading.Timer does not. Either works since we explicitly marshal to UI thread anyway |

## Architecture Patterns

### Recommended Project Structure

```
apps/kargadan/plugin/src/
  boundary/
    KargadanPlugin.cs          # [EXISTING] Plugin entry point; gains command dispatch routing
    EventPublisher.cs          # [EXISTING] Lock-gated event queue; gains RhinoDoc event subscriptions
  contracts/
    ProtocolEnvelopes.cs       # [EXISTING] Gains execution result envelope variants
    ProtocolEnums.cs           # [EXISTING] Gains new CommandOperation variants (RunScript, etc.)
    ProtocolModels.cs          # [EXISTING] Gains event batch models
    ProtocolValueObjects.cs    # [EXISTING] Gains UndoRecordId value object
  protocol/
    Router.cs                  # [EXISTING] Command envelope decoding
  transport/
    ThreadMarshaler.cs         # [EXISTING] UI thread dispatch
    WebSocketHost.cs           # [EXISTING] WebSocket listener
    SessionHost.cs             # [EXISTING] Session state machine
  execution/
    CommandExecutor.cs         # [NEW] Orchestrates command execution with undo wrapping
    ScriptRunner.cs            # [NEW] RunScript wrapper with Command.EndCommand tracking
    DocumentApi.cs             # [NEW] Direct RhinoCommon API facade (Objects, Layers, Views)
  observation/
    EventSubscriber.cs         # [NEW] RhinoDoc event subscription manager
    EventAggregator.cs         # [NEW] Debounce/batch/summarize event stream
    UndoObserver.cs            # [NEW] Command.UndoRedo event handler; notifies harness on undo
```

### Pattern 1: Undo-Wrapped Command Execution

**What:** Every document-modifying tool call brackets all operations within a single `BeginUndoRecord`/`EndUndoRecord` pair, with an `AddCustomUndoEvent` for agent state.

**When to use:** All write operations (object create, modify, delete, layer changes, etc.)

**Example:**
```csharp
// Source: RhinoCommon API + McNeel forum confirmation
// https://discourse.mcneel.com/t/rhinocommon-beginundorecord-and-endundorecord/7213
// https://discourse.mcneel.com/t/can-addcustomundoevent-be-used-outside-of-a-rhino-command/141123

// CommandExecutor.cs
public Fin<CommandResultEnvelope> Execute(
    RhinoDoc doc,
    CommandEnvelope envelope,
    Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>> handler) {
    uint undoSerial = doc.BeginUndoRecord(envelope.UndoScope.Map(s => s.Value).IfNone("Agent Action"));
    Fin<JsonElement> result = handler(doc, envelope);
    doc.AddCustomUndoEvent(
        "Agent State Snapshot",
        OnAgentUndoRedo,
        new AgentUndoState(envelope.Identity.RequestId, /* snapshot data */));
    _ = doc.EndUndoRecord(undoSerial);
    return result.Match(
        Succ: payload => BuildSuccess(envelope, payload),
        Fail: error => { doc.Undo(); return BuildFailure(envelope, error); });
}

// Callback must re-register itself for redo support
static void OnAgentUndoRedo(object sender, CustomUndoEventArgs e) {
    AgentUndoState state = (AgentUndoState)e.Tag;
    e.Document.AddCustomUndoEvent("Agent State Snapshot", OnAgentUndoRedo, /* current state */);
    // Notify harness that undo/redo occurred for this agent action
    // Push notification via EventPublisher
}
```

**Confidence:** HIGH -- `BeginUndoRecord`/`EndUndoRecord` outside commands confirmed by Dale Fugier (McNeel). `AddCustomUndoEvent` outside commands confirmed. Callback re-registration pattern from official RhinoCommon custom undo sample.

### Pattern 2: RunScript with Result Detection via Command.EndCommand

**What:** `RunScript` returns only a bool (did Rhino attempt to run), not whether the command succeeded. Subscribe to `Command.EndCommand` to capture `CommandResult` for actual success/failure detection.

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
    uint snBefore = doc.Objects.NextRuntimeSerialNumber;
    bool ran = RhinoApp.RunScript(commandScript, echo);
    Command.EndCommand -= OnEndCommand;

    return ran switch {
        false => Fin.Fail<ScriptResult>(Error.New("Rhino did not execute the script.")),
        true => capturedResult switch {
            Commands.Result.Success => Fin.Succ(new ScriptResult(
                CommandName: capturedCommandName,
                ObjectsCreated: doc.Objects.AllObjectsSince(snBefore))),
            Commands.Result.Cancel => Fin.Fail<ScriptResult>(
                Error.New($"Command '{capturedCommandName}' was cancelled.")),
            _ => Fin.Fail<ScriptResult>(
                Error.New($"Command '{capturedCommandName}' failed: {capturedResult}")),
        },
    };
}
```

**Confidence:** HIGH -- RunScript boolean-only return confirmed by McNeel (Dale Fugier). `Command.EndCommand` + `CommandEventArgs.CommandResult` is the documented approach for result detection. `AllObjectsSince` confirmed for tracking created objects.

### Pattern 3: Event Aggregation with Debounced Batching

**What:** Subscribe to all RhinoDoc events, accumulate into a tagged event log, flush as a summarized batch after the debounce window (200ms) expires.

**When to use:** Continuous document observation.

**Example:**
```csharp
// EventAggregator.cs -- accumulates events, flushes as batched summary
// Uses System.Threading.Channels for thread-safe accumulation

// Channel acts as bounded buffer between event callbacks (UI thread) and flush timer
Channel<RawDocEvent> _channel = Channel.CreateBounded<RawDocEvent>(capacity: 256);

// Event handlers write to channel (fast, non-blocking on UI thread)
void OnAddRhinoObject(object sender, RhinoObjectEventArgs e) {
    _ = _channel.Writer.TryWrite(new RawDocEvent(
        Type: EventType.ObjectsChanged,
        SubType: "added",
        ObjectId: e.ObjectId,
        IsUndoRedo: e.Document.UndoActive || e.Document.RedoActive));
}

// Timer-triggered flush reads from channel and builds summary
EventBatchSummary Flush() {
    Seq<RawDocEvent> pending = /* drain channel */;
    return new EventBatchSummary(
        TotalCount: pending.Count,
        ByCategory: pending.GroupBy(e => e.Type)
            .ToSeq()
            .Map(g => new CategoryCount(Category: g.Key, Count: g.Count())),
        ContainsUndoRedo: pending.Any(e => e.IsUndoRedo));
}
```

**Confidence:** MEDIUM-HIGH -- Event subscription patterns verified from SampleCsEventWatcher reference implementation. `UndoActive`/`RedoActive` properties confirmed for distinguishing undo/redo operations from normal operations. Channel-based aggregation is standard .NET pattern.

### Pattern 4: Undo Detection and Harness Notification

**What:** Subscribe to `Command.UndoRedo` event to detect when the user presses Cmd+Z/Cmd+Shift+Z. The `UndoRedoEventArgs` provides `IsBeginUndo`/`IsEndUndo`/`IsBeginRedo`/`IsEndRedo` flags plus `UndoSerialNumber`.

**When to use:** Always active while plugin is loaded.

**Example:**
```csharp
// Source: RhinoCommon source (rhinosdkcommand.cs)
// UndoObserver.cs

void OnUndoRedo(object sender, UndoRedoEventArgs e) {
    // IsBeginUndo = event_type 3, IsEndUndo = event_type 4
    // IsBeginRedo = event_type 5, IsEndRedo = event_type 6
    if (e.IsEndUndo || e.IsEndRedo) {
        _eventPublisher.Publish(EventEnvelope.Create(
            eventType: EventType.UndoRedo,
            delta: new { isUndo: e.IsEndUndo, isRedo: e.IsEndRedo, serial: e.UndoSerialNumber }));
    }
}

// Subscribe in plugin OnLoad:
Command.UndoRedo += _undoObserver.OnUndoRedo;
```

**Confidence:** HIGH -- `UndoRedoEventArgs` properties verified from RhinoCommon source code (rhinosdkcommand.cs). `IsBeginUndo`/`IsEndUndo`/`IsBeginRedo`/`IsEndRedo`/`IsPurgeRecord` all confirmed with exact event type codes.

### Anti-Patterns to Avoid

- **Nested undo records inside commands:** McNeel explicitly states `BeginUndoRecord` cannot be used inside a running command. Since our plugin dispatches from WebSocket (not from a Rhino command), this is not a concern -- but never wrap `RunScript` calls with additional `BeginUndoRecord` because `RunScript` creates its own undo record for the command it runs.
- **Holding RhinoDoc object references across RunScript calls:** `RunScript` invalidates all pointers and references to runtime database objects. After `RunScript`, re-query any objects needed. This is an explicit warning from McNeel.
- **Polling for command completion:** `RunScript` is asynchronous when called outside a command context. Use `Command.EndCommand` event, not post-call polling.
- **Modifying RhinoDoc objects inside `AddCustomUndoEvent` callbacks:** McNeel explicitly warns "NEVER change any setting in the Rhino document or application" inside the undo handler. Only modify private plugin data.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Undo/redo record management | Custom undo stack | `RhinoDoc.BeginUndoRecord` / `EndUndoRecord` | Rhino's native undo system handles all document operations atomically; custom undo stacks will drift from actual document state |
| Object creation | Manual geometry construction + doc insertion | `doc.Objects.AddBrep()`, `AddMesh()`, `AddCurve()`, etc. | ObjectTable provides 30+ typed Add methods that handle document integration, display pipeline notification, and undo recording |
| Object querying | Manual iteration over all objects | `doc.Objects.FindId()`, `FindByLayer()`, `FindByFilter()`, `AllObjectsSince()` | Built-in query methods handle deleted/hidden objects, layer filtering, and runtime serial number tracking |
| Command result detection | Parsing Rhino command line output | `Command.EndCommand` event + `CommandEventArgs.CommandResult` | The only reliable way to detect command success/failure; `RunScript` boolean is insufficient |
| Event debouncing | Custom timer + lock + manual batching | `System.Threading.Channels` + `System.Timers.Timer` | Standard .NET infrastructure with built-in backpressure and thread safety |
| UI thread marshaling | Custom synchronization context | `RhinoApp.InvokeOnUiThread` (already in Phase 1 `ThreadMarshaler`) | Rhino provides the marshaling primitive; Phase 1 already wraps it |
| Command cancellation | Thread.Abort or manual interruption | `CancellationTokenSource` wrapping `WaitAsync` on the marshaled task | Rhino has no internal cancellation; wrap externally with cooperative cancellation |

**Key insight:** Rhino's document model is a closed system. Every attempt to maintain parallel state (shadow undo stack, cached object lists, synthetic event streams) will eventually diverge from Rhino's truth. Use Rhino's built-in primitives for everything document-related; only build aggregation/batching/protocol layers on top.

## Common Pitfalls

### Pitfall 1: RunScript Returns Bool, Not Command Result
**What goes wrong:** Developer assumes `RunScript` returning `true` means the command succeeded. It does not -- it means Rhino attempted to run the script.
**Why it happens:** The API signature `bool RunScript(string, bool)` implies success/failure semantics.
**How to avoid:** Always subscribe to `Command.EndCommand` event before calling `RunScript`. Check `CommandEventArgs.CommandResult` for actual success/failure.
**Warning signs:** Objects expected to be created are missing after `RunScript` returns `true`.

### Pitfall 2: Object References Invalidated After RunScript
**What goes wrong:** Code holds a reference to a `RhinoObject` before calling `RunScript`, then accesses it after. Crash or stale data.
**Why it happens:** `RunScript` modifies Rhino's internal dynamic arrays, invalidating all existing pointers and references.
**How to avoid:** Never cache `RhinoObject` references across `RunScript` calls. Re-query objects by GUID or use `doc.Objects.AllObjectsSince(serialNumber)` to find new objects.
**Warning signs:** `NullReferenceException` or `ObjectDisposedException` after `RunScript` calls.

### Pitfall 3: Undo Callback Modifying Document
**What goes wrong:** `AddCustomUndoEvent` callback attempts to modify `RhinoDoc` objects, causing corruption or crashes.
**Why it happens:** Developers naturally want to sync document state in the undo handler.
**How to avoid:** Undo handler MUST only modify private plugin data (agent state snapshots). Document state is restored by Rhino's own undo mechanism. The handler just needs to notify the harness.
**Warning signs:** Document corruption, infinite undo loops, or crashes during Cmd+Z.

### Pitfall 4: RunScript Async Behavior Outside Commands
**What goes wrong:** `RunScript` is called from a plugin (not a command), and the developer expects synchronous execution. The script may not complete before the next line runs.
**Why it happens:** `RunScript` is synchronous only when called from within a `ScriptRunner`-style command. Outside commands, behavior may differ.
**How to avoid:** Our architecture calls `RunScript` from within `ThreadMarshaler.RunOnUiThreadAsync`, which already runs on the UI thread. For commands that have async behavior, use `Command.EndCommand` event for completion detection.
**Warning signs:** Command appears to succeed but objects are not yet in the document.

### Pitfall 5: BeginUndoRecord Inside a Running Command
**What goes wrong:** Calling `BeginUndoRecord` while a Rhino command is already executing (e.g., during a `RunScript` call) silently fails or creates conflicting undo state.
**Why it happens:** The undo record pair is meant for operations outside of commands.
**How to avoid:** Do NOT wrap `RunScript` calls in `BeginUndoRecord`/`EndUndoRecord`. `RunScript` creates its own undo record for the command it runs. Only use `BeginUndoRecord`/`EndUndoRecord` when directly using RhinoCommon API calls (`doc.Objects.Add*`, etc.) outside a command context.
**Warning signs:** Undo history shows duplicate entries or Cmd+Z skips operations.

### Pitfall 6: No Programmatic Command Cancellation
**What goes wrong:** Developer attempts to cancel a running Rhino command (e.g., a long Boolean operation via RunScript) and finds no API for it.
**Why it happens:** McNeel has explicitly stated there is no programmatic cancellation for running commands.
**How to avoid:** Implement timeout at the transport layer: `ThreadMarshaler.RunOnUiThreadAsync(...).WaitAsync(timeout)`. If timeout expires, the Rhino command continues running but the harness receives a timeout error. For best-effort cancellation, `RhinoApp.SendKeystrokes` can simulate Escape but is unreliable.
**Warning signs:** Plugin appears hung on a long-running command with no way to abort.

### Pitfall 7: Event Handler Thread Assumptions
**What goes wrong:** Event handlers assume they run on a specific thread, leading to race conditions or UI crashes.
**Why it happens:** RhinoDoc events fire on the main UI thread, but developers may not realize this constrains handler duration.
**How to avoid:** Keep event handlers fast -- write to a `Channel<T>` and return immediately. Do NOT perform blocking operations, WebSocket writes, or JSON serialization in the event handler itself.
**Warning signs:** Rhino UI freezes during rapid document changes.

## Code Examples

### Complete Event Subscription Setup

```csharp
// Source: SampleCsEventWatcher reference implementation
// https://github.com/gtalarico/apidocs.samples/.../SampleCsEventHandlers.cs

// EventSubscriber.cs -- subscribes to all RhinoDoc events in OnLoad, unsubscribes in OnShutdown
public sealed class EventSubscriber {
    private readonly Channel<RawDocEvent> _channel;

    public void Subscribe() {
        RhinoDoc.AddRhinoObject += OnAddObject;
        RhinoDoc.DeleteRhinoObject += OnDeleteObject;
        RhinoDoc.UndeleteRhinoObject += OnUndeleteObject;
        RhinoDoc.ReplaceRhinoObject += OnReplaceObject;
        RhinoDoc.ModifyObjectAttributes += OnModifyAttributes;
        RhinoDoc.SelectObjects += OnSelectObjects;
        RhinoDoc.DeselectObjects += OnDeselectObjects;
        RhinoDoc.DeselectAllObjects += OnDeselectAll;
        RhinoDoc.LayerTableEvent += OnLayerTable;
        RhinoDoc.MaterialTableEvent += OnMaterialTable;
        RhinoDoc.DimensionStyleTableEvent += OnDimensionStyleTable;
        RhinoDoc.InstanceDefinitionTableEvent += OnInstanceDefinitionTable;
        RhinoDoc.LightTableEvent += OnLightTable;
        RhinoDoc.GroupTableEvent += OnGroupTable;
        RhinoDoc.DocumentPropertiesChanged += OnDocPropertiesChanged;
        Command.UndoRedo += OnUndoRedo;
        Command.EndCommand += OnEndCommand;
    }

    public void Unsubscribe() {
        RhinoDoc.AddRhinoObject -= OnAddObject;
        RhinoDoc.DeleteRhinoObject -= OnDeleteObject;
        // ... mirror of Subscribe
        Command.UndoRedo -= OnUndoRedo;
        Command.EndCommand -= OnEndCommand;
    }

    private void OnAddObject(object sender, RhinoObjectEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.ObjectsChanged,
            SubType: "added",
            ObjectId: Some(e.ObjectId),
            ObjectType: e.TheObject.ObjectType.ToString()));

    private void OnReplaceObject(object sender, RhinoReplaceObjectEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.ObjectsChanged,
            SubType: "replaced",
            ObjectId: Some(e.ObjectId),
            OldObjectId: Some(e.OldRhinoObject.Id)));

    private void OnUndoRedo(object sender, UndoRedoEventArgs e) {
        // Only emit on completion (not begin)
        if (e.IsEndUndo)
            _ = _channel.Writer.TryWrite(new RawDocEvent(Type: EventType.UndoRedo, SubType: "undo"));
        else if (e.IsEndRedo)
            _ = _channel.Writer.TryWrite(new RawDocEvent(Type: EventType.UndoRedo, SubType: "redo"));
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

public Fin<Unit> DeleteObject(RhinoDoc doc, Guid objectId) {
    RhinoObject obj = doc.Objects.FindId(objectId);
    return obj switch {
        null => Fin.Fail<Unit>(Error.New($"Object {objectId} not found.")),
        _ => doc.Objects.Delete(obj) switch {
            true => Fin.Succ(unit),
            false => Fin.Fail<Unit>(Error.New($"Failed to delete object {objectId}.")),
        },
    };
}

public Fin<RhinoObject[]> QueryByLayer(RhinoDoc doc, string layerName) {
    RhinoObject[] objects = doc.Objects.FindByLayer(layerName);
    return Fin.Succ(objects ?? Array.Empty<RhinoObject>());
}
```

### RunScript with Scripted Input

```csharp
// Source: https://developer.rhino3d.com/guides/rhinocommon/run-rhino-command-from-plugin/

// The dash prefix suppresses dialog boxes for scripted mode
// Coordinates are space-separated (space = Enter at command line)
// The underscore prefix forces English command name

// Create a line from origin to (10,10,10):
RhinoApp.RunScript("_-Line 0,0,0 10,10,10", echo: true);

// Create a box with corner and dimensions:
RhinoApp.RunScript("_-Box 0,0,0 10,20,30", echo: true);

// Boolean union with pre-selected objects:
RhinoApp.RunScript("_-BooleanUnion _Enter", echo: true);

// Export to specific format (scripted input for file dialog):
RhinoApp.RunScript("_-Export \"C:\\output.stl\" _Enter", echo: true);
```

### Two-Phase Response Pattern

```csharp
// Ack immediately, then execute and send result
// This maps to the WebSocket protocol: ack before execution + result after

public async Task<Fin<JsonElement>> DispatchCommandAsync(
    JsonElement message,
    CancellationToken cancellationToken) {

    // Phase 1: Send ack immediately (before UI thread dispatch)
    await SendAckAsync(message);

    // Phase 2: Execute on UI thread with timeout
    using CancellationTokenSource timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
    timeoutCts.CancelAfter(TimeSpan.FromMilliseconds(deadlineMs));

    Fin<JsonElement> result = await ThreadMarshaler.RunOnUiThreadAsync(() => {
        // Execute within undo record
        return _executor.Execute(doc, envelope, handler);
    }).WaitAsync(timeoutCts.Token).ConfigureAwait(false);

    return result;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| .NET Framework + Mono (macOS) | .NET Core / .NET 8 unified runtime | Rhino 8 (2023) | Plugins use modern .NET; same runtime on macOS and Windows |
| Sandcastle-hosted API docs | New API docs platform (developer.rhino3d.com) | 2024 | Some old API doc URLs return 404; use new platform |
| `Thread.Abort()` for cancellation | `CancellationTokenSource` + cooperative cancellation | .NET Core deprecation | `Thread.Abort()` throws `PlatformNotSupportedException` on .NET Core; must use cooperative patterns |

**Deprecated/outdated:**
- **Old Sandcastle API docs URLs** (`mcneel.github.io/rhinocommon-api-docs`): Many return 404. Use `developer.rhino3d.com/api/rhinocommon/` instead.
- **Thread.Abort()**: Does not work on .NET Core. Some forum posts suggest it for cancellation; this is no longer viable.
- **Mono-specific macOS workarounds**: No longer applicable since Rhino 8 uses .NET Core on macOS.

## Open Questions

1. **RunScript synchronicity guarantee from UI thread**
   - What we know: RunScript is synchronous when called from a `ScriptRunner` command. Our dispatch runs on UI thread via `InvokeOnUiThread`.
   - What's unclear: Whether UI-thread invocation via `InvokeOnUiThread` guarantees synchronous RunScript behavior identical to a ScriptRunner command.
   - Recommendation: Implement `Command.EndCommand` event tracking regardless (it's needed for result detection anyway). If synchronous behavior is confirmed empirically, the EndCommand handler simply runs before the next line. If async, the handler catches it.
   - Confidence: MEDIUM

2. **BeginUndoRecord + RunScript interaction**
   - What we know: `BeginUndoRecord` is for operations outside commands. `RunScript` creates its own undo record for the command it runs.
   - What's unclear: If we call `BeginUndoRecord`, then `RunScript`, then `EndUndoRecord` -- does the RunScript undo record nest inside ours, or do they conflict?
   - Recommendation: Do NOT wrap RunScript in BeginUndoRecord. For RunScript-based operations, let RunScript's own undo record be the record. Only use BeginUndoRecord/EndUndoRecord for direct API calls. This means RunScript commands and direct API commands use different undo strategies.
   - Confidence: MEDIUM -- based on McNeel's statement that "all document modifications including those from nested RunScript calls are grouped into one undo operation automatically" when in a ScriptRunner command, but our context is different (InvokeOnUiThread, not ScriptRunner).

3. **Event delivery during RunScript execution**
   - What we know: Events fire on the UI thread. RunScript executes on the UI thread.
   - What's unclear: Whether events fire during RunScript execution (inline) or are queued until RunScript returns.
   - Recommendation: Design the event aggregator to tolerate both behaviors. The debounce window (200ms) naturally handles both cases -- events are accumulated regardless of timing.
   - Confidence: LOW -- no documentation found on this specific behavior.

4. **macOS-specific event ordering for ActiveDocumentChanged**
   - What we know: STATE.md notes this as a research blocker. The RhinoDoc API docs note "behavior differs between Mac and Windows" for ActiveDocumentChanged.
   - What's unclear: Exact differences; whether this affects single-document scenarios (Phase 2 is single-doc).
   - Recommendation: Defer. Phase 2 operates on `RhinoDoc.ActiveDoc` (single document). Multi-document support is v2 (ADVN-02). Do not subscribe to `ActiveDocumentChanged` in Phase 2.
   - Confidence: HIGH (for deferral decision)

5. **Default timeout value**
   - What we know: Command.EndCommand gives completion signal. No programmatic cancellation exists.
   - What's unclear: Reasonable default timeout for commands like BooleanUnion that can take minutes.
   - Recommendation: 30 seconds default, configurable per-command-category. Read operations: 5s. Write operations: 30s. Geometric operations (boolean, mesh): 120s. Always configurable via the envelope's `deadlineMs` field (already in protocol).
   - Confidence: MEDIUM -- based on community reports of BooleanUnion taking "several hours" in extreme cases.

## Discretion Recommendations

Based on research findings, recommendations for areas left to Claude's discretion:

1. **Read-only tool calls and undo records:** Do NOT create undo records for read operations. Read operations (`doc.Objects.FindId`, `doc.Objects.FindByLayer`, scene summary queries) do not modify the document and therefore have nothing to undo. Creating empty undo records pollutes the undo stack.

2. **Concurrency model:** Queue user changes during agent mid-operation. Since all operations run on the UI thread via `InvokeOnUiThread`, Rhino naturally serializes access. User operations wait until the agent's current tool call completes (or times out). No explicit concurrency model needed -- Rhino's UI thread acts as the serialization point.

3. **Default timeout:** 30 seconds for write operations. The `deadlineMs` field already exists in `CommandEnvelope` (from Phase 1) with a default of 5000ms. Increase default to 30000ms for write operations. Allow per-command override via the envelope.

4. **Event debounce window:** Keep 200ms as specified in requirements. This is fast enough for responsive feedback but slow enough to batch rapid changes (e.g., multi-object selection, undo that touches many objects).

5. **Event summary format:** Tagged counts with drill-down capability.
   ```json
   {
     "totalCount": 7,
     "categories": [
       { "type": "objects.changed", "count": 4, "subtypes": { "added": 3, "replaced": 1 } },
       { "type": "layers.changed", "count": 2 },
       { "type": "undo.redo", "count": 1, "subtypes": { "undo": 1 } }
     ],
     "containsUndoRedo": true,
     "batchWindowMs": 200
   }
   ```
   Drill-down: harness sends a `read.events.detail` command with category filter to get full event data for a specific category.

## Sources

### Primary (HIGH confidence)
- [RhinoCommon API - RhinoDoc class](https://developer.rhino3d.com/api/rhinocommon/rhino.rhinodoc) -- 35 events, BeginUndoRecord/EndUndoRecord/AddCustomUndoEvent methods
- [RhinoCommon API - ObjectTable class](https://developer.rhino3d.com/api/rhinocommon/rhino.docobjects.tables.objecttable) -- Add/Delete/Replace/Find/Transform methods
- [RhinoCommon API - CommandEventArgs](https://developer.rhino3d.com/api/rhinocommon/rhino.commands.commandeventargs) -- CommandResult property
- [RhinoCommon source - rhinosdkcommand.cs](https://github.com/mcneel/rhinocommon/blob/master/dotnet/rhino/rhinosdkcommand.cs) -- UndoRedoEventArgs class with IsBeginUndo/IsEndUndo/IsBeginRedo/IsEndRedo
- [RhinoCommon source - rhinosdkdoc.cs](https://github.com/mcneel/rhinocommon/blob/master/dotnet/rhino/rhinosdkdoc.cs) -- BeginUndoRecord/EndUndoRecord signatures, event definitions
- [SampleCsEventWatcher](https://github.com/gtalarico/apidocs.samples/blob/master/repos/rhinocommon/mcneel/rhino-developer-samples/rhinocommon/cs/SampleCsEventWatcher/SampleCsEventHandlers.cs) -- Complete event subscription reference implementation
- [Official Custom Undo Sample](https://developer.rhino3d.com/en/samples/rhinocommon/custom-undo/) -- AddCustomUndoEvent callback pattern with redo support
- [Run Rhino Command from Plugin Guide](https://developer.rhino3d.com/guides/rhinocommon/run-rhino-command-from-plugin/) -- RunScript usage, ScriptRunner attribute, warnings

### Secondary (MEDIUM confidence)
- [McNeel Forum - AddCustomUndoEvent outside commands](https://discourse.mcneel.com/t/can-addcustomundoevent-be-used-outside-of-a-rhino-command/141123) -- Dale Fugier confirms works outside commands; must use BeginUndoRecord/EndUndoRecord
- [McNeel Forum - BeginUndoRecord/EndUndoRecord](https://discourse.mcneel.com/t/rhinocommon-beginundorecord-and-endundorecord/7213) -- Dale Fugier: "only time you should need to call these is if modifying the document from outside of a running command"
- [McNeel Forum - RunScript return value](https://discourse.mcneel.com/t/return-from-rhinoapp-runscript/194275) -- Dale Fugier: boolean "is not an indication of whether or not the command completed successfully"
- [McNeel Forum - Cancelling commands](https://discourse.mcneel.com/t/how-to-cancel-a-long-running-operation-like-booleandifference-or-booleanunion-in-rhinocommon/97483) -- McNeel confirms no built-in cancellation
- [McNeel Forum - Escape command](https://discourse.mcneel.com/t/how-to-escape-a-running-command-i-e-booleanunion/32137) -- Dale Fugier: "There is no programatic way ... of canceling one"
- [McNeel Forum - Undo inside commands](https://discourse.mcneel.com/t/undo-record-insid-command/87894) -- Dale Fugier: "it is not possible to create an undo record inside of a command"
- [RhinoCommon Event Watchers Guide](https://developer.rhino3d.com/guides/rhinocommon/event-watchers/) -- Threading considerations for event handlers

### Tertiary (LOW confidence)
- [McNeel Forum - Undo/Redo on RhinoCommon](https://discourse.mcneel.com/t/undo-redo-on-rhinocommon/127353) -- Dale Fugier advises against custom undo handling for document objects; let Rhino handle it
- [McNeel Forum - Rhino 9 WIP](https://discourse.mcneel.com/t/rhino-9-wip-available-now/180749) -- Rhino 9 WIP released April 2024; no specific SDK changes documented

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- RhinoCommon is the only option; all APIs verified from source or official docs
- Architecture (undo system): MEDIUM-HIGH -- API signatures verified, McNeel engineer confirmations, but BeginUndoRecord + RunScript interaction has a gap
- Architecture (event system): HIGH -- 35 events documented, event args verified from source, SampleCsEventWatcher reference implementation available
- Architecture (command execution): MEDIUM-HIGH -- RunScript limitations well-documented, result detection via EndCommand confirmed, but async behavior from InvokeOnUiThread context not verified
- Pitfalls: HIGH -- Multiple McNeel engineer statements about common mistakes
- Cancellation: HIGH -- Confirmed absence of programmatic cancellation by McNeel

**Research date:** 2026-02-22
**Valid until:** 2026-04-22 (RhinoCommon API is stable; Rhino 9 WIP may add APIs but unlikely to remove)
