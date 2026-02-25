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

internal delegate Fin<Unit> AgentStateCallback(AgentUndoState state, bool isUndo);
internal static class CommandExecutor {
    private static class JsonFields {
        internal const string From = "from";
        internal const string LayerIndex = "layerIndex";
        internal const string Line = "line";
        internal const string Name = "name";
        internal const string Point = "point";
        internal const string Script = "script";
        internal const string To = "to";
        internal const string Translation = "translation";
    }
    private static class TextValues {
        internal const string AgentAction = "Agent Action";
        internal const string AgentStateSnapshot = "Agent State Snapshot";
        internal const string AttributesModified = "attributes-modified";
        internal const string Deleted = "deleted";
        internal const string Transformed = "transformed";
    }
    private static readonly Error ScriptNotExecuted =
        Error.New(message: "Rhino did not execute the script.");
    private static Fin<Unit> DoEffect(Action effect) { effect(); return FinSucc(unit); }
    private static Error ScriptCancelled(string commandName) =>
        Error.New(message: $"Command '{commandName}' was cancelled.");
    private static Error ObjectNotFound(Guid objectId) =>
        Error.New(message: $"Object {objectId} not found.");
    private static Error DirectApiOperationFailed(string operation) =>
        Error.New(message: $"Direct API operation '{operation}' failed.");
    private static Error UnsupportedOperation(string operation) =>
        Error.New(message: $"Operation '{operation}' is unsupported.");
    private static readonly Dictionary<string, Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>>> OperationHandlers =
        new(StringComparer.Ordinal) {
            [CommandOperation.SceneSummary.Key] = ReadSceneSummary,
            [CommandOperation.ObjectMetadata.Key] = ReadObjectMetadata,
            [CommandOperation.ObjectGeometry.Key] = ReadObjectGeometry,
            [CommandOperation.LayerState.Key] = ReadLayerState,
            [CommandOperation.ViewState.Key] = ReadViewState,
            [CommandOperation.ToleranceUnits.Key] = ReadToleranceUnits,
            [CommandOperation.ObjectCreate.Key] = HandleObjectCreate,
            [CommandOperation.ObjectDelete.Key] = HandleObjectDelete,
            [CommandOperation.ObjectUpdate.Key] = HandleObjectUpdate,
        };
    internal static Fin<JsonElement> Execute(
        RhinoDoc doc,
        CommandEnvelope envelope,
        AgentStateCallback onUndoRedo) =>
        envelope.Operation.ExecutionMode.Equals(CommandExecutionMode.Script) switch {
            true =>
                ExecuteScriptOperation(
                    doc: doc,
                    payload: envelope.Payload),
            _ => ResolveOperationHandler(envelope: envelope).Bind((Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>> handler) =>
                envelope.Operation.Category.Equals(CommandCategory.Write) switch {
                    true => ExecuteDirectApi(
                        doc: doc,
                        envelope: envelope,
                        handler: handler,
                        onUndoRedo: onUndoRedo),
                    _ => handler(doc, envelope),
                }),
        };
    private static Fin<JsonElement> ExecuteScriptOperation(
        RhinoDoc doc,
        JsonElement payload) {
        string script = payload.TryGetProperty(JsonFields.Script, out JsonElement scriptElement) switch {
            true when scriptElement.ValueKind == JsonValueKind.String =>
                (scriptElement.GetString() ?? string.Empty).Trim(),
            _ => string.Empty,
        };
        return script.Length switch {
            0 => FinFail<JsonElement>(
                Error.New(message: $"Payload '{JsonFields.Script}' property must be a non-empty string.")),
            _ => ExecuteScript(
                doc: doc,
                commandScript: script,
                echo: true)
                .Map(static (ScriptResult scriptResult) =>
                    JsonSerializer.SerializeToElement(value: scriptResult)),
        };
    }
    private static Fin<JsonElement> ReadSceneSummary(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        FinSucc(JsonSerializer.SerializeToElement(new {
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
        FinSucc(JsonSerializer.SerializeToElement(new {
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
        FinSucc(JsonSerializer.SerializeToElement(new {
            activeView = doc.Views.ActiveView?.ActiveViewport.Name ?? string.Empty,
            viewports = doc.Views
                .Select(static view => view.ActiveViewport.Name)
                .ToArray(),
        }));
    private static Fin<JsonElement> ReadToleranceUnits(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        FinSucc(JsonSerializer.SerializeToElement(new {
            absoluteTolerance = doc.ModelAbsoluteTolerance,
            angleToleranceRadians = doc.ModelAngleToleranceRadians,
            unitSystem = doc.ModelUnitSystem.ToString(),
        }));
    private static Fin<Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>>> ResolveOperationHandler(
        CommandEnvelope envelope) =>
        OperationHandlers.TryGetValue(
            envelope.Operation.Key,
            out Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>>? handler) switch {
                true when handler is not null => FinSucc(handler),
                _ => FinFail<Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>>>(
                    UnsupportedOperation(operation: envelope.Operation.Key)),
            };
    private static JsonElement SerializeObjectResult(Guid objectId, Option<string> status) =>
        status.Match(
            Some: statusValue => JsonSerializer.SerializeToElement(new {
                objectId,
                status = statusValue,
            }),
            None: () => JsonSerializer.SerializeToElement(new {
                objectId,
            }));
    private static Fin<JsonElement> MapObjectStatus(
        Fin<Unit> operation,
        Guid objectId,
        string status) =>
        operation.Map((_) =>
            SerializeObjectResult(
                objectId: objectId,
                status: Some(status)));
    private static Fin<JsonElement> HandleObjectCreate(
        RhinoDoc doc,
        CommandEnvelope envelope) {
        using ObjectAttributes attributes = new();
        return ApplyAttributesFromPayload(
            doc: doc,
            attributes: attributes,
            payload: envelope.Payload)
        .Bind((_) => envelope.Payload.TryGetProperty(JsonFields.Point, out JsonElement pointElement) switch {
            true => ParsePoint3d(pointElement).Map(static (Point3d point) => (GeometryBase)new Point(point)),
            _ => envelope.Payload.TryGetProperty(JsonFields.Line, out JsonElement lineElement) switch {
                true => ParseLine(lineElement).Map(static (Line line) => (GeometryBase)new LineCurve(line)),
                _ => FinFail<GeometryBase>(
                    Error.New(message: $"write.object.create requires payload.{JsonFields.Point} or payload.{JsonFields.Line}.")),
            },
        })
        .Bind((GeometryBase geometry) =>
            AddObject(
                    doc: doc,
                    geometry: geometry,
                    attributes: attributes)
                .Map((Guid objectId) => SerializeObjectResult(objectId, None)));
    }
    private static Fin<JsonElement> HandleObjectDelete(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        GetPrimaryObjectId(envelope: envelope).Bind((Guid objectId) =>
            MapObjectStatus(
                operation: DeleteObject(
                    doc: doc,
                    objectId: objectId),
                objectId: objectId,
                status: TextValues.Deleted));
    private static Fin<JsonElement> HandleObjectUpdate(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        GetPrimaryObjectId(envelope: envelope).Bind((Guid objectId) =>
            envelope.Payload.TryGetProperty(JsonFields.Translation, out JsonElement translationElement) switch {
                true => ParseVector3d(translationElement).Bind((Vector3d translation) =>
                    MapObjectStatus(
                        operation: TransformObject(
                            doc: doc,
                            objectId: objectId,
                            transform: Transform.Translation(translation)),
                        objectId: objectId,
                        status: TextValues.Transformed)),
                _ => FindById(
                    doc: doc,
                    objectId: objectId).Bind((RhinoObject found) => {
                        using ObjectAttributes attributes = found.Attributes.Duplicate();
                        return ApplyAttributesFromPayload(
                            doc: doc,
                            attributes: attributes,
                            payload: envelope.Payload)
                        .Bind((_) => MapObjectStatus(
                                operation: ModifyAttributes(
                                    doc: doc,
                                    objectId: objectId,
                                    attributes: attributes),
                            objectId: objectId,
                            status: TextValues.AttributesModified));
                    }),
            });
    private static Fin<Unit> ApplyAttributesFromPayload(
        RhinoDoc doc,
        ObjectAttributes attributes,
        JsonElement payload) {
        Fin<Unit> layerResult = payload.TryGetProperty(JsonFields.LayerIndex, out JsonElement layerElement) switch {
            true when layerElement.TryGetInt32(out int layerIndex) =>
                (layerIndex >= 0 && layerIndex < doc.Layers.Count) switch {
                    true => DoEffect(() => attributes.LayerIndex = layerIndex),
                    false => FinFail<Unit>(
                        Error.New(message: $"{JsonFields.LayerIndex} {layerIndex} is out of range [0, {doc.Layers.Count}).")),
                },
            _ => FinSucc(unit),
        };
        return layerResult.Bind((_) =>
            payload.TryGetProperty(JsonFields.Name, out JsonElement nameElement) switch {
                true when nameElement.ValueKind == JsonValueKind.String =>
                    DoEffect(() => attributes.Name = nameElement.GetString() ?? string.Empty),
                _ => FinSucc(unit),
            });
    }
    internal static Fin<JsonElement> ExecuteDirectApi(
        RhinoDoc doc,
        CommandEnvelope envelope,
        Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>> handler,
        AgentStateCallback onUndoRedo) {
        string description = envelope.UndoScope
            .Map(static (UndoScope scope) => (string)scope)
            .IfNone(noneValue: TextValues.AgentAction);
        uint undoSerial = doc.BeginUndoRecord(description: description);
        Fin<JsonElement> result = handler(doc, envelope);
        _ = doc.AddCustomUndoEvent(
            description: TextValues.AgentStateSnapshot,
            handler: MakeUndoHandler(onUndoRedo: onUndoRedo),
            tag: new AgentUndoState(
                RequestId: envelope.Identity.RequestId,
                UndoSerial: undoSerial));
        _ = doc.EndUndoRecord(undoRecordSerialNumber: undoSerial);
        return result.Match(
            Succ: FinSucc,
            Fail: (Error error) => {
                _ = doc.Undo();
                return FinFail<JsonElement>(error);
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
        Option<CommandEventArgs> captured = None;
        void OnEndCommand(object? sender, CommandEventArgs args) =>
            captured = Some(args);
        Command.EndCommand += OnEndCommand;
        uint serialBefore = RhinoObject.NextRuntimeSerialNumber;
        bool ran;
        try {
            ran = RhinoApp.RunScript(script: commandScript, echo: echo);
        } finally {
            Command.EndCommand -= OnEndCommand;
        }
        RhinoObject[]? objectsSince = doc.Objects.AllObjectsSince(runtimeSerialNumber: serialBefore);
        int objectsCreatedCount = objectsSince?.Length ?? 0;
        return ran switch {
            false => FinFail<ScriptResult>(ScriptNotExecuted),
            true => captured
                .ToFin(Error.New(message: "RunScript completed without Command.EndCommand result."))
                .Bind((CommandEventArgs commandArgs) =>
                    commandArgs.CommandResult switch {
                        Result.Success => ScriptResult.Create(
                            commandName: commandArgs.CommandEnglishName,
                            commandResult: (int)commandArgs.CommandResult,
                            objectsCreatedCount: objectsCreatedCount),
                        Result.Cancel => FinFail<ScriptResult>(
                            ScriptCancelled(commandName: commandArgs.CommandEnglishName)),
                        _ => FinFail<ScriptResult>(
                            Error.New(message: $"Command '{commandArgs.CommandEnglishName}' failed: {commandArgs.CommandResult}")),
                    }),
        };
    }
    internal static Fin<Guid> AddObject(
        RhinoDoc doc,
        GeometryBase geometry,
        ObjectAttributes attributes) {
        Guid objectId = doc.Objects.Add(geometry: geometry, attributes: attributes);
        return (objectId == Guid.Empty) switch {
            true => FinFail<Guid>(DirectApiOperationFailed(operation: "AddObject")),
            false => FinSucc(objectId),
        };
    }
    internal static Fin<Unit> DeleteObject(
        RhinoDoc doc,
        Guid objectId) =>
        doc.Objects.Delete(objectId: objectId, quiet: true) switch {
            true => FinSucc(unit),
            false => FinFail<Unit>(ObjectNotFound(objectId: objectId)),
        };
    internal static Fin<Unit> TransformObject(
        RhinoDoc doc,
        Guid objectId,
        Transform transform) =>
        (doc.Objects.Transform(objectId: objectId, xform: transform, deleteOriginal: true) == Guid.Empty) switch {
            true => FinFail<Unit>(ObjectNotFound(objectId: objectId)),
            false => FinSucc(unit),
        };
    internal static Fin<RhinoObject> FindById(
        RhinoDoc doc,
        Guid objectId) =>
        doc.Objects.FindId(objectId) switch {
            null => FinFail<RhinoObject>(ObjectNotFound(objectId: objectId)),
            RhinoObject found => FinSucc(found),
        };
    internal static Fin<Unit> ModifyAttributes(
        RhinoDoc doc,
        Guid objectId,
        ObjectAttributes attributes) =>
        doc.Objects.ModifyAttributes(objectId: objectId, newAttributes: attributes, quiet: true) switch {
            true => FinSucc(unit),
            false => FinFail<Unit>(ObjectNotFound(objectId: objectId)),
        };
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
                description: TextValues.AgentStateSnapshot,
                handler: MakeUndoHandler(onUndoRedo: onUndoRedo),
                tag: state);
            bool isUndo = !args.CreatedByRedo;
            _ = onUndoRedo(state: state, isUndo: isUndo)
                .IfFail(error => RhinoApp.WriteLine(
                    $"[Kargadan] UndoRedo publish failed: isUndo={isUndo}, requestId={state.RequestId}, undoSerial={state.UndoSerial}, error={error}"));
        };
    private static Fin<Guid> GetPrimaryObjectId(CommandEnvelope envelope) =>
        envelope.ObjectRefs.HeadOrNone()
            .ToFin(Error.New(message: $"Operation '{envelope.Operation.Key}' requires at least one object reference."))
            .Map(static (SceneObjectRef sceneObjectRef) => (Guid)sceneObjectRef.ObjectId);
    private static Fin<Point3d> ParsePoint3d(JsonElement element) =>
        element.ValueKind switch {
            JsonValueKind.Array when element.GetArrayLength() == 3 =>
                (element[0].TryGetDouble(out double x), element[1].TryGetDouble(out double y), element[2].TryGetDouble(out double z)) switch {
                    (true, true, true) => FinSucc(new Point3d(x, y, z)),
                    _ => FinFail<Point3d>(Error.New(message: "Point array values must be numeric.")),
                },
            _ => FinFail<Point3d>(Error.New(message: "Point must be a 3-item numeric array.")),
        };
    private static Fin<Vector3d> ParseVector3d(JsonElement element) =>
        ParsePoint3d(element).Map((Point3d point) => new Vector3d(point));
    private static Fin<Line> ParseLine(JsonElement element) =>
        element.TryGetProperty(JsonFields.From, out JsonElement fromElement)
            && element.TryGetProperty(JsonFields.To, out JsonElement toElement)
            ? ParsePoint3d(fromElement).Bind((Point3d from) =>
                ParsePoint3d(toElement).Map((Point3d to) =>
                    new Line(from, to)))
            : FinFail<Line>(Error.New(message: $"Line must include {JsonFields.From}/{JsonFields.To} point arrays."));
}
