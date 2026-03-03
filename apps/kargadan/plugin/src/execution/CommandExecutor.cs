using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using ParametricPortal.CSharp.Analyzers.Contracts;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using ParametricPortal.Kargadan.Plugin.src.protocol;
using Rhino;
using Rhino.Commands;
using Rhino.DocObjects;
using Rhino.Geometry;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.execution;

internal delegate Fin<Unit> AgentStateCallback(AgentUndoState state, bool isUndo);

internal static class CommandExecutor {
    private readonly record struct CommandRoute(
        CommandOperation Operation,
        string Name,
        string Description,
        CommandEnvelopeRequirements Requirements,
        Seq<CommandCatalogParameter> Parameters,
        Seq<CommandCatalogExample> Examples,
        Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>> Handler) {
        internal bool IsDestructive => !Operation.Category.Equals(CommandCategory.Read);
        internal CommandDispatchMode DispatchMode => Operation.ExecutionMode.Equals(CommandExecutionMode.Script)
            ? CommandDispatchMode.Script
            : CommandDispatchMode.Direct;
        internal bool RequiresUndoScope => Operation.ExecutionMode.Equals(CommandExecutionMode.DirectApi)
            && Operation.Category.Equals(CommandCategory.Write);
    }
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
    private static class ParameterTypes {
        internal const string Integer = "integer";
        internal const string Line = "{from:number[3],to:number[3]}";
        internal const string Number3 = "number[3]";
        internal const string String = "string";
    }
    private static class TextValues {
        internal const string AgentAction = "Agent Action";
        internal const string AgentStateSnapshot = "Agent State Snapshot";
        internal const string AttributesModified = "attributes-modified";
        internal const string Deleted = "deleted";
        internal const string Transformed = "transformed";
    }
    private static readonly Error ScriptNotExecuted =
        FailureMapping.ToError(FailureMapping.FromCode(
            code: ErrorCode.UnexpectedRuntime,
            message: "Rhino did not execute the script."));
    private static readonly Seq<string> NoAliases = Seq<string>();
    private static readonly Seq<CommandCatalogParameter> NoParams = Seq<CommandCatalogParameter>();
    private static readonly Seq<CommandRoute> Routes = Seq(
        Read(CommandOperation.SceneSummary, "Read Scene Summary", "Returns active viewport, object count, and layer count.", "Summarize the active scene.", false, ReadSceneSummary),
        Read(CommandOperation.ObjectMetadata, "Read Object Metadata", "Returns metadata for the first object reference in the command envelope.", "Read metadata from objectRefs[0].", true, ReadObjectMetadata),
        Read(CommandOperation.ObjectGeometry, "Read Object Geometry", "Returns bounding box and object type for the first object reference in the command envelope.", "Read geometric bounds from objectRefs[0].", true, ReadObjectGeometry),
        Read(CommandOperation.LayerState, "Read Layer State", "Lists layer visibility and names.", "Enumerate layers.", false, ReadLayerState),
        Read(CommandOperation.ViewState, "Read View State", "Returns active view and known viewport names.", "Inspect viewport state.", false, ReadViewState),
        Read(CommandOperation.ToleranceUnits, "Read Tolerance Units", "Returns model tolerances and unit system.", "Read document tolerance settings.", false, ReadToleranceUnits),
        Mutation(
            operation: CommandOperation.ObjectCreate,
            name: "Create Object",
            description: "Creates a point or line object with optional layer/name attributes.",
            @params: Params(
                Parameter(JsonFields.Point, ParameterTypes.Number3, false, "Point coordinates [x,y,z]. Required when 'line' is absent."),
                Parameter(JsonFields.Line, ParameterTypes.Line, false, "Line endpoints. Required when 'point' is absent."),
                Parameter(JsonFields.LayerIndex, ParameterTypes.Integer, false, "Target layer index."),
                Parameter(JsonFields.Name, ParameterTypes.String, false, "Object name metadata.")),
            exampleInput: """{"point":[0,0,0]}""",
            exampleDescription: "Create a point at origin.",
            requiresObjectRefs: false,
            handler: HandleObjectCreate),
        Read(CommandOperation.ObjectDelete, "Delete Object", "Deletes the first referenced object.", "Delete objectRefs[0].", true, HandleObjectDelete),
        Mutation(
            operation: CommandOperation.ObjectUpdate,
            name: "Update Object",
            description: "Transforms object translation or updates basic attributes.",
            @params: Params(
                Parameter(JsonFields.Translation, ParameterTypes.Number3, false, "Translation vector [x,y,z]."),
                Parameter(JsonFields.LayerIndex, ParameterTypes.Integer, false, "Target layer index."),
                Parameter(JsonFields.Name, ParameterTypes.String, false, "Updated object name.")),
            exampleInput: """{"translation":[0,10,0]}""",
            exampleDescription: "Move object by +10 in Y.",
            requiresObjectRefs: true,
            handler: HandleObjectUpdate),
        Mutation(
            operation: CommandOperation.ScriptRun,
            name: "Run Rhino Script",
            description: "Runs a Rhino command script through RhinoApp.RunScript.",
            @params: Params(
                Parameter(JsonFields.Script, ParameterTypes.String, true, "Rhino command script to execute.")),
            exampleInput: """{"script":"_Line 0,0,0 10,0,0 _Enter"}""",
            exampleDescription: "Run a Rhino line command script.",
            requiresObjectRefs: false,
            handler: static (RhinoDoc doc, CommandEnvelope envelope) =>
                ExecuteScriptOperation(
                    doc: doc,
                    payload: envelope.Payload)));
    private static readonly Dictionary<CommandOperation, CommandRoute> RoutesByOperation =
        Routes.ToDictionary(static route => route.Operation);
    internal static Seq<string> SupportedCapabilities { get; } =
        Routes
            .Map(static route => route.Operation.Key)
            .Distinct();
    internal static Seq<CommandCatalogEntry> CommandCatalog { get; } =
        Routes.Map(ToCatalogEntry);
    internal static bool Supports(CommandOperation operation) =>
        RoutesByOperation.ContainsKey(operation);
    internal static Fin<JsonElement> Execute(
        RhinoDoc doc,
        CommandEnvelope envelope,
        AgentStateCallback onUndoRedo) =>
        ResolveRoute(envelope: envelope).Bind((CommandRoute route) =>
            route.RequiresUndoScope switch {
                true => ExecuteDirectApi(
                    doc: doc,
                    envelope: envelope,
                    handler: route.Handler,
                    onUndoRedo: onUndoRedo),
                _ => route.Handler(doc, envelope),
            });
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
        return result.Match(
            Succ: (JsonElement payload) => {
                _ = doc.AddCustomUndoEvent(
                    description: TextValues.AgentStateSnapshot,
                    handler: MakeUndoHandler(onUndoRedo: onUndoRedo),
                    tag: new AgentUndoState(
                        RequestId: envelope.Identity.RequestId,
                        UndoSerial: undoSerial));
                _ = doc.EndUndoRecord(undoRecordSerialNumber: undoSerial);
                return FinSucc(payload);
            },
            Fail: (Error error) => {
                _ = doc.EndUndoRecord(undoRecordSerialNumber: undoSerial);
                _ = doc.Undo();
                return FinFail<JsonElement>(error);
            });
    }
    private static CommandRoute Read(
        CommandOperation operation,
        string name,
        string description,
        string exampleDescription,
        bool requiresObjectRefs,
        Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>> handler) =>
        new(
            Operation: operation,
            Name: name,
            Description: description,
            Requirements: new CommandEnvelopeRequirements(
                RequiresTelemetryContext: true,
                RequiresObjectRefs: requiresObjectRefs,
                MinimumObjectRefCount: requiresObjectRefs ? 1 : 0),
            Parameters: NoParams,
            Examples: Seq1(ReadExample(exampleDescription)),
            Handler: handler);
    private static CommandRoute Mutation(
        CommandOperation operation,
        string name,
        string description,
        Seq<CommandCatalogParameter> @params,
        string exampleInput,
        string exampleDescription,
        bool requiresObjectRefs,
        Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>> handler) =>
        new(
            Operation: operation,
            Name: name,
            Description: description,
            Requirements: new CommandEnvelopeRequirements(
                RequiresTelemetryContext: true,
                RequiresObjectRefs: requiresObjectRefs,
                MinimumObjectRefCount: requiresObjectRefs ? 1 : 0),
            Parameters: @params,
            Examples: Seq1(new CommandCatalogExample(exampleInput, exampleDescription)),
            Handler: handler);
    private static Seq<CommandCatalogParameter> Params(params CommandCatalogParameter[] parameters) =>
        toSeq(parameters);
    private static CommandCatalogParameter Parameter(
        string name,
        string type,
        bool required,
        string description) =>
        new(
            Name: name,
            Type: type,
            Required: required,
            Description: description);
    private static CommandCatalogExample ReadExample(string description) =>
        new(
            Input: "{}",
            Description: description);
    private static CommandCatalogEntry ToCatalogEntry(CommandRoute route) =>
        new(
            Id: route.Operation.Key,
            Name: route.Name,
            Description: route.Description,
            Category: route.Operation.Category.Key,
            IsDestructive: route.IsDestructive,
            Aliases: NoAliases,
            Dispatch: new CommandDispatchMetadata(
                Mode: route.DispatchMode),
            Requirements: route.Requirements,
            Params: route.Parameters,
            Examples: route.Examples);
    private static Fin<CommandRoute> ResolveRoute(CommandEnvelope envelope) =>
        RoutesByOperation.TryGetValue(
            envelope.Operation,
            out CommandRoute route) switch {
                true => FinSucc(route),
                _ => FinFail<CommandRoute>(UnsupportedOperation(operation: envelope.Operation.Key)),
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
        CommandEnvelope _) =>
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
        CommandEnvelope _) =>
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
        CommandEnvelope _) =>
        FinSucc(JsonSerializer.SerializeToElement(new {
            activeView = doc.Views.ActiveView?.ActiveViewport.Name ?? string.Empty,
            viewports = doc.Views
                .Select(static view => view.ActiveViewport.Name)
                .ToArray(),
        }));
    private static Fin<JsonElement> ReadToleranceUnits(
        RhinoDoc doc,
        CommandEnvelope _) =>
        FinSucc(JsonSerializer.SerializeToElement(new {
            absoluteTolerance = doc.ModelAbsoluteTolerance,
            angleToleranceRadians = doc.ModelAngleToleranceRadians,
            unitSystem = doc.ModelUnitSystem.ToString(),
        }));
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
        .Bind((GeometryBase geometry) => {
            Guid objectId = doc.Objects.Add(
                geometry: geometry,
                attributes: attributes);
            return (objectId == Guid.Empty) switch {
                true => FinFail<JsonElement>(DirectApiOperationFailed(operation: "AddObject")),
                _ => FinSucc(SerializeObjectResult(objectId: objectId, status: None)),
            };
        });
    }
    private static Fin<JsonElement> HandleObjectDelete(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        GetPrimaryObjectId(envelope: envelope).Bind((Guid objectId) =>
            MapObjectStatus(
                operation: doc.Objects.Delete(objectId: objectId, quiet: true) switch {
                    true => FinSucc(unit),
                    false => FinFail<Unit>(ObjectNotFound(objectId: objectId)),
                },
                objectId: objectId,
                status: TextValues.Deleted));
    private static Fin<JsonElement> HandleObjectUpdate(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        GetPrimaryObjectId(envelope: envelope).Bind((Guid objectId) =>
            envelope.Payload.TryGetProperty(JsonFields.Translation, out JsonElement translationElement) switch {
                true => ParseTranslation(translationElement).Bind((Vector3d translation) =>
                    MapObjectStatus(
                        operation: (doc.Objects.Transform(
                            objectId: objectId,
                            xform: Transform.Translation(translation),
                            deleteOriginal: true) == Guid.Empty) switch {
                                true => FinFail<Unit>(ObjectNotFound(objectId: objectId)),
                                false => FinSucc(unit),
                            },
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
                            operation: doc.Objects.ModifyAttributes(
                                objectId: objectId,
                                newAttributes: attributes,
                                quiet: true) switch {
                                    true => FinSucc(unit),
                                    false => FinFail<Unit>(ObjectNotFound(objectId: objectId)),
                                },
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
                (layerIndex >= 0 && layerIndex < doc.Layers.Count)
                    ? FinSucc(attributes).Map((ObjectAttributes current) => {
                        current.LayerIndex = layerIndex;
                        return unit;
                    })
                    : FinFail<Unit>(
                        Error.New(message: $"{JsonFields.LayerIndex} {layerIndex} is out of range [0, {doc.Layers.Count}).")),
            true => FinFail<Unit>(
                Error.New(message: $"{JsonFields.LayerIndex} must be an integer when provided.")),
            _ => FinSucc(unit),
        };
        return layerResult.Bind((_) =>
            payload.TryGetProperty(JsonFields.Name, out JsonElement nameElement) switch {
                true when nameElement.ValueKind == JsonValueKind.String =>
                    FinSucc(attributes).Map((ObjectAttributes current) => {
                        current.Name = nameElement.GetString() ?? string.Empty;
                        return unit;
                    }),
                true => FinFail<Unit>(
                    Error.New(message: $"{JsonFields.Name} must be a string when provided.")),
                _ => FinSucc(unit),
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
                            objectsCreatedCount: objectsCreatedCount).Match(
                                Succ: FinSucc,
                                Fail: static (Seq<Error> errors) => FinFail<ScriptResult>(
                                    errors.HeadOrNone().IfNone(
                                        Error.New(message: "Script result validation failed.")))),
                        Result.Cancel => FinFail<ScriptResult>(
                            ScriptCancelled(commandName: commandArgs.CommandEnglishName)),
                        _ => FinFail<ScriptResult>(
                            Error.New(message: $"Command '{commandArgs.CommandEnglishName}' failed: {commandArgs.CommandResult}")),
                    }),
        };
    }
    internal static Fin<RhinoObject> FindById(
        RhinoDoc doc,
        Guid objectId) =>
        Optional(doc.Objects.FindId(objectId))
            .ToFin(ObjectNotFound(objectId: objectId));
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
        ParseTriple(
            element: element,
            label: JsonFields.Point).Map(static (Triple triple) =>
            new Point3d(triple.X, triple.Y, triple.Z));
    private static Fin<Vector3d> ParseTranslation(JsonElement element) =>
        ParseTriple(
            element: element,
            label: JsonFields.Translation).Map(static (Triple triple) =>
            new Vector3d(triple.X, triple.Y, triple.Z));
    private static Fin<Line> ParseLine(JsonElement element) =>
        element.TryGetProperty(JsonFields.From, out JsonElement fromElement)
            && element.TryGetProperty(JsonFields.To, out JsonElement toElement)
            ? ParseTriple(
                element: fromElement,
                label: JsonFields.From).Bind((Triple from) =>
                ParseTriple(
                    element: toElement,
                    label: JsonFields.To).Map((Triple to) =>
                    new Line(
                        from: new Point3d(from.X, from.Y, from.Z),
                        to: new Point3d(to.X, to.Y, to.Z))))
            : FinFail<Line>(Error.New(message: $"Line must include {JsonFields.From}/{JsonFields.To} point arrays."));
    private static Fin<Triple> ParseTriple(
        JsonElement element,
        string label) =>
        element.ValueKind switch {
            JsonValueKind.Array when element.GetArrayLength() == 3 =>
                (element[0].TryGetDouble(out double x),
                 element[1].TryGetDouble(out double y),
                 element[2].TryGetDouble(out double z)) switch {
                     (true, true, true) => FinSucc(new Triple(X: x, Y: y, Z: z)),
                     _ => FinFail<Triple>(Error.New(message: $"{label} array values must be numeric.")),
                 },
            _ => FinFail<Triple>(Error.New(message: $"{label} must be a 3-item numeric array.")),
        };
    private static Error ScriptCancelled(string commandName) =>
        FailureMapping.ToError(FailureMapping.FromCode(
            code: ErrorCode.TransientIo,
            message: $"Command '{commandName}' was cancelled."));
    private static Error ObjectNotFound(Guid objectId) =>
        FailureMapping.ToError(FailureMapping.FromCode(
            code: ErrorCode.PayloadMalformed,
            message: $"Object {objectId} not found."));
    private static Error DirectApiOperationFailed(string operation) =>
        FailureMapping.ToError(FailureMapping.FromCode(
            code: ErrorCode.UnexpectedRuntime,
            message: $"Direct API operation '{operation}' failed."));
    private static Error UnsupportedOperation(string operation) =>
        FailureMapping.ToError(FailureMapping.FromCode(
            code: ErrorCode.CapabilityUnsupported,
            message: $"Operation '{operation}' is unsupported."));
    [StructLayout(LayoutKind.Auto)]
    private readonly record struct Triple(double X, double Y, double Z);
}
