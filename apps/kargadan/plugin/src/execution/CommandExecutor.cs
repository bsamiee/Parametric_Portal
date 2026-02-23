using System;
using System.Collections.Generic;
using System.Linq;
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

internal delegate void AgentStateCallback(AgentUndoState state, bool isUndo);

internal static class CommandExecutor {
    // --- [TYPES] -------------------------------------------------------------
    private readonly record struct OperationRoute(
        Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>> Handler,
        bool RequiresUndoScope);

    // --- [CONSTANTS] ---------------------------------------------------------
    private static readonly Error ScriptNotExecuted =
        Error.New(message: "Rhino did not execute the script.");
    private static Error ScriptCancelled(string commandName) =>
        Error.New(message: $"Command '{commandName}' was cancelled.");
    private static Error ObjectNotFound(Guid objectId) =>
        Error.New(message: $"Object {objectId} not found.");
    private static Error DirectApiOperationFailed(string operation) =>
        Error.New(message: $"Direct API operation '{operation}' failed.");
    private static Error UnsupportedOperation(string operation) =>
        Error.New(message: $"Operation '{operation}' is unsupported.");
    private static readonly IReadOnlyDictionary<string, Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>>> ReadHandlers =
        new Dictionary<string, Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>>>(StringComparer.Ordinal) {
            [CommandOperation.SceneSummary.Key] = ReadSceneSummary,
            [CommandOperation.ObjectMetadata.Key] = ReadObjectMetadata,
            [CommandOperation.ObjectGeometry.Key] = ReadObjectGeometry,
            [CommandOperation.LayerState.Key] = ReadLayerState,
            [CommandOperation.ViewState.Key] = ReadViewState,
            [CommandOperation.ToleranceUnits.Key] = ReadToleranceUnits,
        };
    private static readonly IReadOnlyDictionary<string, Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>>> WriteHandlers =
        new Dictionary<string, Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>>>(StringComparer.Ordinal) {
            [CommandOperation.ObjectCreate.Key] = HandleObjectCreate,
            [CommandOperation.ObjectDelete.Key] = HandleObjectDelete,
            [CommandOperation.ObjectUpdate.Key] = HandleObjectUpdate,
        };

    // --- [ENTRY] -------------------------------------------------------------
    internal static Fin<JsonElement> Execute(
        RhinoDoc doc,
        CommandEnvelope envelope,
        AgentStateCallback onUndoRedo) =>
        envelope.Operation.Equals(CommandOperation.ScriptRun) switch {
            true =>
                ExecuteScriptOperation(
                    doc: doc,
                    payload: envelope.Payload),
            _ => ResolveOperationRoute(envelope: envelope).Bind((OperationRoute route) =>
                route.RequiresUndoScope switch {
                    true => ExecuteDirectApi(
                        doc: doc,
                        envelope: envelope,
                        handler: route.Handler,
                        onUndoRedo: onUndoRedo),
                    _ => route.Handler(doc, envelope),
                }),
        };

    // --- [SCRIPT] ------------------------------------------------------------
    private static Fin<JsonElement> ExecuteScriptOperation(
        RhinoDoc doc,
        JsonElement payload) {
        string script = payload.TryGetProperty("script", out JsonElement scriptElement) switch {
            true when scriptElement.ValueKind == JsonValueKind.String =>
                scriptElement.GetString() ?? string.Empty,
            _ => string.Empty,
        };
        return ExecuteScript(
            doc: doc,
            commandScript: script,
            echo: true)
            .Map(static (ScriptResult scriptResult) =>
                JsonSerializer.SerializeToElement(value: scriptResult));
    }

    // --- [READ] --------------------------------------------------------------
    private static Fin<OperationRoute> ResolveOperationRoute(
        CommandEnvelope envelope) =>
        envelope.Operation.Key.StartsWith("read.", StringComparison.Ordinal) switch {
            true => ResolveOperationHandler(
                handlers: ReadHandlers,
                envelope: envelope).Map((Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>> handler) =>
                new OperationRoute(
                    Handler: handler,
                    RequiresUndoScope: false)),
            _ => envelope.Operation.Key.StartsWith("write.", StringComparison.Ordinal) switch {
                true => ResolveOperationHandler(
                    handlers: WriteHandlers,
                    envelope: envelope).Map((Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>> handler) =>
                    new OperationRoute(
                        Handler: handler,
                        RequiresUndoScope: true)),
                _ => Fin.Fail<OperationRoute>(
                    UnsupportedOperation(operation: envelope.Operation.Key)),
            },
        };
    private static Fin<JsonElement> ReadSceneSummary(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        Fin.Succ(JsonSerializer.SerializeToElement(new {
            activeView = doc.Views.ActiveView?.ActiveViewport.Name ?? string.Empty,
            layerCount = doc.Layers.Count,
            objectCount = doc.Objects.Count,
        }));
    private static Fin<JsonElement> ReadObjectMetadata(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        GetPrimaryObjectId(envelope: envelope).Bind((Guid objectId) =>
            FindById(
                doc: doc,
                objectId: objectId).Map((RhinoObject found) =>
                JsonSerializer.SerializeToElement(new {
                    id = found.Id,
                    layerIndex = found.Attributes.LayerIndex,
                    layerName = doc.Layers[found.Attributes.LayerIndex]?.Name ?? string.Empty,
                    name = found.Attributes.Name,
                    objectType = found.ObjectType.ToString(),
                })));
    private static Fin<JsonElement> ReadObjectGeometry(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        GetPrimaryObjectId(envelope: envelope).Bind((Guid objectId) =>
            FindById(
                doc: doc,
                objectId: objectId).Map((RhinoObject found) => {
                    BoundingBox box = found.Geometry.GetBoundingBox(accurate: true);
                    return JsonSerializer.SerializeToElement(new {
                        id = found.Id,
                        max = new[] { box.Max.X, box.Max.Y, box.Max.Z },
                        min = new[] { box.Min.X, box.Min.Y, box.Min.Z },
                        objectType = found.ObjectType.ToString(),
                    });
                }));
    private static Fin<JsonElement> ReadLayerState(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        Fin.Succ(JsonSerializer.SerializeToElement(new {
            layers = doc.Layers
                .Select(static layer => new {
                    index = layer.Index,
                    isVisible = layer.IsVisible,
                    name = layer.Name,
                })
                .ToArray(),
        }));
    private static Fin<JsonElement> ReadViewState(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        Fin.Succ(JsonSerializer.SerializeToElement(new {
            activeView = doc.Views.ActiveView?.ActiveViewport.Name ?? string.Empty,
            viewports = doc.Views
                .Select(static view => view.ActiveViewport.Name)
                .ToArray(),
        }));
    private static Fin<JsonElement> ReadToleranceUnits(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        Fin.Succ(JsonSerializer.SerializeToElement(new {
            absoluteTolerance = doc.ModelAbsoluteTolerance,
            angleToleranceRadians = doc.ModelAngleToleranceRadians,
            unitSystem = doc.ModelUnitSystem.ToString(),
        }));

    // --- [WRITE] -------------------------------------------------------------
    private static Fin<Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>>> ResolveOperationHandler(
        IReadOnlyDictionary<string, Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>>> handlers,
        CommandEnvelope envelope) =>
        handlers.TryGetValue(
            envelope.Operation.Key,
            out Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>>? handler) switch {
                true when handler is not null => Fin.Succ(handler),
                _ => Fin.Fail<Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>>>(
                    UnsupportedOperation(operation: envelope.Operation.Key)),
            };
    private static JsonElement SerializeObjectCreated(Guid objectId) =>
        JsonSerializer.SerializeToElement(new {
            objectId,
        });
    private static JsonElement SerializeObjectStatus(Guid objectId, string status) =>
        JsonSerializer.SerializeToElement(new {
            objectId,
            status,
        });
    private static Fin<JsonElement> MapObjectStatus(
        Fin<Unit> operation,
        Guid objectId,
        string status) =>
        operation.Map((_) =>
            SerializeObjectStatus(
                objectId: objectId,
                status: status));
    private static Fin<JsonElement> HandleObjectCreate(
        RhinoDoc doc,
        CommandEnvelope envelope) {
        using ObjectAttributes attributes = new();
        _ = ApplyAttributesFromPayload(
            attributes: attributes,
            payload: envelope.Payload);

        return envelope.Payload.TryGetProperty("point", out JsonElement pointElement) switch {
            true => ParsePoint3d(pointElement)
                .Map(static (Point3d point) => (GeometryBase)new Point(point))
                .Bind((GeometryBase geometry) =>
                    AddObject(
                        doc: doc,
                        geometry: geometry,
                        attributes: attributes).Map(SerializeObjectCreated)),
            false => envelope.Payload.TryGetProperty("line", out JsonElement lineElement) switch {
                true => ParseLine(lineElement)
                    .Map(static (Line line) => (GeometryBase)new LineCurve(line))
                    .Bind((GeometryBase geometry) =>
                        AddObject(
                            doc: doc,
                            geometry: geometry,
                            attributes: attributes).Map(SerializeObjectCreated)),
                _ => Fin.Fail<JsonElement>(
                    Error.New(message: "write.object.create requires payload.point or payload.line.")),
            },
        };
    }
    private static Fin<JsonElement> HandleObjectDelete(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        GetPrimaryObjectId(envelope: envelope).Bind((Guid objectId) =>
            MapObjectStatus(
                operation: DeleteObject(
                    doc: doc,
                    objectId: objectId,
                    quiet: true),
                objectId: objectId,
                status: "deleted"));
    private static Fin<JsonElement> HandleObjectUpdate(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        GetPrimaryObjectId(envelope: envelope).Bind((Guid objectId) =>
            envelope.Payload.TryGetProperty("translation", out JsonElement translationElement) switch {
                true => ParseVector3d(translationElement).Bind((Vector3d translation) =>
                    MapObjectStatus(
                        operation: TransformObject(
                            doc: doc,
                            objectId: objectId,
                            transform: Transform.Translation(translation)),
                        objectId: objectId,
                        status: "transformed")),
                _ => FindById(
                    doc: doc,
                    objectId: objectId).Bind((RhinoObject found) => {
                        using ObjectAttributes attributes = found.Attributes.Duplicate();
                        _ = ApplyAttributesFromPayload(
                            attributes: attributes,
                            payload: envelope.Payload);
                        return MapObjectStatus(
                            operation: ModifyAttributes(
                                doc: doc,
                                objectId: objectId,
                                attributes: attributes),
                            objectId: objectId,
                            status: "attributes-modified");
                    }),
            });
    private static Unit ApplyAttributesFromPayload(
        ObjectAttributes attributes,
        JsonElement payload) {
        _ = payload.TryGetProperty("layerIndex", out JsonElement layerElement) switch {
            true when layerElement.TryGetInt32(out int layerIndex) => SetLayerIndex(
                attributes: attributes,
                layerIndex: layerIndex),
            _ => unit,
        };
        _ = payload.TryGetProperty("name", out JsonElement nameElement) switch {
            true when nameElement.ValueKind == JsonValueKind.String => SetName(
                attributes: attributes,
                name: nameElement.GetString() ?? string.Empty),
            _ => unit,
        };
        return unit;
    }
    private static Unit SetName(ObjectAttributes attributes, string name) {
        attributes.Name = name;
        return unit;
    }
    private static Unit SetLayerIndex(ObjectAttributes attributes, int layerIndex) {
        attributes.LayerIndex = layerIndex;
        return unit;
    }

    // --- [UNDO_WRAPPED_DIRECT_API] ------------------------------------------
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
            Succ: Fin.Succ,
            Fail: (Error error) => {
                _ = doc.Undo();
                return Fin.Fail<JsonElement>(error);
            });
    }

    // --- [SCRIPT_EXECUTION] --------------------------------------------------
    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.ProtocolRequired,
        ticket: "EXEC-01",
        expiresOnUtc: "2026-08-22")]
    internal static Fin<ScriptResult> ExecuteScript(
        RhinoDoc doc,
        string commandScript,
        bool echo) {
        Option<CommandEventArgs> captured = None;
        void OnEndCommand(object? sender, CommandEventArgs args) =>
            captured = Some(args);

        Command.EndCommand += OnEndCommand;
        uint serialBefore = RhinoObject.NextRuntimeSerialNumber;
        bool ran = RhinoApp.RunScript(script: commandScript, echo: echo);
        Command.EndCommand -= OnEndCommand;

        RhinoObject[]? objectsSince = doc.Objects.AllObjectsSince(runtimeSerialNumber: serialBefore);
        int objectsCreatedCount = objectsSince?.Length ?? 0;

        return ran switch {
            false => Fin.Fail<ScriptResult>(ScriptNotExecuted),
            true => captured
                .ToFin(Error.New(message: "RunScript completed without Command.EndCommand result."))
                .Bind((CommandEventArgs commandArgs) =>
                    commandArgs.CommandResult switch {
                        Result.Success => ScriptResult.Create(
                            commandName: commandArgs.CommandEnglishName,
                            commandResult: (int)commandArgs.CommandResult,
                            objectsCreatedCount: objectsCreatedCount),
                        Result.Cancel => Fin.Fail<ScriptResult>(
                            ScriptCancelled(commandName: commandArgs.CommandEnglishName)),
                        _ => Fin.Fail<ScriptResult>(
                            Error.New(message: $"Command '{commandArgs.CommandEnglishName}' failed: {commandArgs.CommandResult}")),
                    }),
        };
    }

    // --- [DIRECT_API_FACADES] ------------------------------------------------
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

    // --- [INTERNAL] ----------------------------------------------------------
    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.CancellationGuard,
        ticket: "EXEC-05",
        expiresOnUtc: "2026-08-22")]
    private static EventHandler<CustomUndoEventArgs> MakeUndoHandler(
        AgentStateCallback onUndoRedo) =>
        (object? sender, CustomUndoEventArgs args) => {
            AgentUndoState state = (AgentUndoState)args.Tag;
            _ = args.Document.AddCustomUndoEvent(
                description: "Agent State Snapshot",
                handler: MakeUndoHandler(onUndoRedo: onUndoRedo),
                tag: state);
            bool isUndo = !args.CreatedByRedo;
            onUndoRedo(state: state, isUndo: isUndo);
        };
    private static Fin<Guid> GetPrimaryObjectId(CommandEnvelope envelope) =>
        envelope.ObjectRefs.Head
            .ToFin(Error.New(message: $"Operation '{envelope.Operation.Key}' requires at least one object reference."))
            .Map(static (SceneObjectRef sceneObjectRef) => (Guid)sceneObjectRef.ObjectId);
    private static Fin<Point3d> ParsePoint3d(JsonElement element) =>
        element.ValueKind switch {
            JsonValueKind.Array when element.GetArrayLength() == 3 =>
                (element[0].TryGetDouble(out double x), element[1].TryGetDouble(out double y), element[2].TryGetDouble(out double z)) switch {
                    (true, true, true) => Fin.Succ(new Point3d(x, y, z)),
                    _ => Fin.Fail<Point3d>(Error.New(message: "Point array values must be numeric.")),
                },
            _ => Fin.Fail<Point3d>(Error.New(message: "Point must be a 3-item numeric array.")),
        };
    private static Fin<Vector3d> ParseVector3d(JsonElement element) =>
        ParsePoint3d(element).Map((Point3d point) => new Vector3d(point));
    private static Fin<Line> ParseLine(JsonElement element) =>
        element.TryGetProperty("from", out JsonElement fromElement)
            && element.TryGetProperty("to", out JsonElement toElement)
            ? ParsePoint3d(fromElement).Bind((Point3d from) =>
                ParsePoint3d(toElement).Map((Point3d to) =>
                    new Line(from, to)))
            : Fin.Fail<Line>(Error.New(message: "Line must include from/to point arrays."));
}
