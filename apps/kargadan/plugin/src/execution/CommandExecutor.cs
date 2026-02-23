// Bifurcated command execution engine: undo-wrapped direct RhinoCommon API calls and
// RunScript with Command.EndCommand result tracking. Stateless static methods; state lives in caller.
using System;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using ParametricPortal.CSharp.Analyzers.Contracts;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using Rhino;
using Rhino.Commands;
using Rhino.DocObjects;
using Rhino.Geometry;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.execution;

// --- [TYPES] -----------------------------------------------------------------

internal delegate void AgentStateCallback(AgentUndoState state, bool isUndo);

// --- [CONSTANTS] -------------------------------------------------------------

internal static partial class CommandExecutor {
    private static readonly Error ScriptNotExecuted =
        Error.New(message: "Rhino did not execute the script.");
    private static Error ScriptCancelled(string commandName) =>
        Error.New(message: $"Command '{commandName}' was cancelled.");
    private static Error ObjectNotFound(Guid objectId) =>
        Error.New(message: $"Object {objectId} not found.");
    private static Error DirectApiOperationFailed(string operation) =>
        Error.New(message: $"Direct API operation '{operation}' failed.");

    // --- [FUNCTIONS] ---------------------------------------------------------

    // --- Group 1: Execution orchestration ------------------------------------

    internal static Fin<JsonElement> ExecuteDirectApi(
        RhinoDoc doc,
        CommandEnvelope envelope,
        Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>> handler,
        AgentStateCallback onUndoRedo) {
        string description = envelope.UndoScope
            .Map(static (UndoScope scope) => (string)scope)
            .IfNone(noneValue: "Agent Action");
        uint undoSerial = doc.BeginUndoRecord(description: description);
        Fin<JsonElement> result = handler(doc, envelope);
        _ = doc.AddCustomUndoEvent(
            description: "Agent State Snapshot",
            handler: MakeUndoHandler(onUndoRedo: onUndoRedo),
            tag: new AgentUndoState(
                RequestId: envelope.Identity.RequestId,
                UndoSerial: undoSerial));
        _ = doc.EndUndoRecord(undoRecordSerialNumber: undoSerial);
        return result.Match(
            Succ: (JsonElement payload) => Fin.Succ(payload),
            Fail: (Error error) => {
                _ = doc.Undo();
                return Fin.Fail<JsonElement>(error);
            });
    }

    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.ProtocolRequired,
        ticket: "EXEC-01",
        expiresOnUtc: "2026-08-22")]
    internal static Fin<ScriptResult> ExecuteScript(
        RhinoDoc doc,
        string commandScript,
        bool echo) {
        Result capturedResult = Result.Nothing;
        string capturedCommandName = string.Empty;

        // why: Command.EndCommand requires imperative event handler subscribe/unsubscribe
        // and the local capture pattern is inherently stateful -- RhinoCommon constraint
        void OnEndCommand(object? sender, CommandEventArgs args) {
            capturedResult = args.CommandResult;
            capturedCommandName = args.CommandEnglishName;
        }
        Command.EndCommand += OnEndCommand;
        uint snBefore = RhinoObject.NextRuntimeSerialNumber;
        bool ran = RhinoApp.RunScript(script: commandScript, echo: echo);
        Command.EndCommand -= OnEndCommand;

        RhinoObject[]? objectsSince = doc.Objects.AllObjectsSince(runtimeSerialNumber: snBefore);
        int objectsCreatedCount = objectsSince?.Length ?? 0;

        // why: CA1508 false positive -- capturedResult is mutated by Command.EndCommand event
        // handler during RunScript execution; flow analysis cannot see the side-effect
#pragma warning disable CA1508
        return ran switch {
            false => Fin.Fail<ScriptResult>(ScriptNotExecuted),
            true => capturedResult switch {
                Result.Success => ScriptResult.Create(
                    commandName: capturedCommandName,
                    commandResult: (int)capturedResult,
                    objectsCreatedCount: objectsCreatedCount),
                Result.Cancel => Fin.Fail<ScriptResult>(
                    ScriptCancelled(commandName: capturedCommandName)),
                _ => Fin.Fail<ScriptResult>(
                    Error.New(message: $"Command '{capturedCommandName}' failed: {capturedResult}")),
            },
        };
#pragma warning restore CA1508
    }

    // --- Group 2: Direct RhinoCommon API facades -----------------------------

    internal static Fin<Guid> AddObject(
        RhinoDoc doc,
        GeometryBase geometry,
        ObjectAttributes attributes) {
        Guid objectId = doc.Objects.Add(geometry: geometry, attributes: attributes);
        return (objectId == Guid.Empty) switch {
            true => Fin.Fail<Guid>(DirectApiOperationFailed(operation: "AddObject")),
            false => Fin.Succ(objectId),
        };
    }

    internal static Fin<Unit> DeleteObject(
        RhinoDoc doc,
        Guid objectId,
        bool quiet) =>
        doc.Objects.Delete(objectId: objectId, quiet: quiet) switch {
            true => Fin.Succ(unit),
            false => Fin.Fail<Unit>(ObjectNotFound(objectId: objectId)),
        };

    internal static Fin<Unit> ReplaceObject(
        RhinoDoc doc,
        Guid objectId,
        GeometryBase geometry) =>
        doc.Objects.Replace(objectId: objectId, geometry: geometry, ignoreModes: false) switch {
            true => Fin.Succ(unit),
            false => Fin.Fail<Unit>(ObjectNotFound(objectId: objectId)),
        };

    internal static Fin<Unit> TransformObject(
        RhinoDoc doc,
        Guid objectId,
        Transform transform) =>
        (doc.Objects.Transform(objectId: objectId, xform: transform, deleteOriginal: true) == Guid.Empty) switch {
            true => Fin.Fail<Unit>(ObjectNotFound(objectId: objectId)),
            false => Fin.Succ(unit),
        };

    internal static Fin<RhinoObject> FindById(
        RhinoDoc doc,
        Guid objectId) =>
        doc.Objects.FindId(objectId) switch {
            null => Fin.Fail<RhinoObject>(ObjectNotFound(objectId: objectId)),
            RhinoObject found => Fin.Succ(found),
        };

    internal static Fin<Seq<RhinoObject>> FindByLayer(
        RhinoDoc doc,
        string layerName) {
        RhinoObject[]? objects = doc.Objects.FindByLayer(layerName: layerName);
        return objects switch {
            null => Fin.Fail<Seq<RhinoObject>>(
                Error.New(message: $"Layer '{layerName}' not found or contains no objects.")),
            _ => Fin.Succ(toSeq(objects)),
        };
    }

    internal static Fin<Unit> ModifyAttributes(
        RhinoDoc doc,
        Guid objectId,
        ObjectAttributes attributes) =>
        doc.Objects.ModifyAttributes(objectId: objectId, newAttributes: attributes, quiet: true) switch {
            true => Fin.Succ(unit),
            false => Fin.Fail<Unit>(ObjectNotFound(objectId: objectId)),
        };

    // --- Group 3: Internal helpers -------------------------------------------

    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.CancellationGuard,
        ticket: "EXEC-05",
        expiresOnUtc: "2026-08-22")]
    private static EventHandler<CustomUndoEventArgs> MakeUndoHandler(
        AgentStateCallback onUndoRedo) =>
        // why: RhinoCommon's EventHandler<CustomUndoEventArgs> requires imperative void
        // callback signature -- re-registration for redo support is the McNeel-prescribed pattern
        (object? sender, CustomUndoEventArgs args) => {
            AgentUndoState state = (AgentUndoState)args.Tag;
            _ = args.Document.AddCustomUndoEvent(
                description: "Agent State Snapshot",
                handler: MakeUndoHandler(onUndoRedo: onUndoRedo),
                tag: state);
            bool isUndo = !args.CreatedByRedo;
            onUndoRedo(state: state, isUndo: isUndo);
        };
}
