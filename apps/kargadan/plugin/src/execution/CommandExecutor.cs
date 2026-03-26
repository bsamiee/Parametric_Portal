using System;
using System.Collections.Generic;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using Rhino;
using Rhino.Commands;
using Rhino.DocObjects;
using Rhino.Geometry;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.execution;

internal delegate Fin<Unit> AgentStateCallback(AgentUndoState state, bool isUndo);

internal static class CommandExecutor {
    internal static readonly JsonSerializerOptions CamelCaseOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };
    private readonly record struct CommandRoute(
        CommandOperation Operation,
        string Name,
        string Description,
        bool Advertise,
        CommandEnvelopeRequirements Requirements,
        Seq<CommandCatalogParameter> Parameters,
        Seq<CommandCatalogExample> Examples,
        bool WrapUndo,
        Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>> Handler) {
        internal bool IsDestructive => !Operation.Category.Equals(CommandCategory.Read);
    }
    private static readonly Seq<string> NoAliases = Seq<string>();
    private static readonly Seq<CommandCatalogParameter> NoParams = Seq<CommandCatalogParameter>();
    private static readonly double[] ZeroPoint = [0d, 0d, 0d];
    internal static double[] ProjectPoint(Point3d pt) => [pt.X, pt.Y, pt.Z];
    internal static double[] ProjectPointOrZero(BoundingBox box, Func<BoundingBox, Point3d> selector) =>
        box.IsValid ? ProjectPoint(selector(box)) : (double[])ZeroPoint.Clone();
    private static readonly Seq<CommandRoute> Routes = Seq(
        Route(CommandOperation.SceneSummary, "Read Scene Summary", "Returns active viewport, object count, layer count, and compact Layer-0 scene fields.",
            requiresObjectRefs: false, examples: Seq1(new CommandCatalogExample("{}", "Summarize the active scene.")), handler: SceneQueryCommands.ReadSceneSummary),
        Route(CommandOperation.ObjectMetadata, "Read Object Metadata", "Returns metadata for the first resolved scene object reference.",
            requiresObjectRefs: true,
            @params: Params(
                Parameter(JsonFields.ObjectRefs, ParameterTypes.ObjectRefArray, false, "Optional explicit scene object references copied from read.object.list."),
                Parameter(JsonFields.Detail, ParameterTypes.String, false, "Detail level: compact|standard|full. Defaults to standard.")),
            examples: Seq1(new CommandCatalogExample("""{"objectRefs":[{"objectId":"<guid>","typeTag":"Brep"}]}""", "Read metadata from args.objectRefs[0].")), handler: ObjectQueryCommands.ReadObjectMetadata),
        Route(CommandOperation.ObjectGeometry, "Read Object Geometry", "Returns geometric bounds for the first resolved scene object reference.",
            requiresObjectRefs: true,
            @params: Params(
                Parameter(JsonFields.ObjectRefs, ParameterTypes.ObjectRefArray, false, "Optional explicit scene object references copied from read.object.list."),
                Parameter(JsonFields.Detail, ParameterTypes.String, false, "Detail level: compact|standard|full. Defaults to standard.")),
            examples: Seq1(new CommandCatalogExample("""{"objectRefs":[{"objectId":"<guid>","typeTag":"Brep"}]}""", "Read geometric bounds from args.objectRefs[0].")), handler: ObjectQueryCommands.ReadObjectGeometry),
        Route(CommandOperation.LayerState, "Read Layer State", "Lists layer visibility and names.",
            requiresObjectRefs: false,
            @params: Params(
                Parameter(JsonFields.IncludeHidden, ParameterTypes.Boolean, false, "When true, hidden layers are included. Defaults to false."),
                Parameter(JsonFields.Limit, ParameterTypes.Integer, false, "Caps layer entries returned. Must be >= 1.")),
            examples: Seq1(new CommandCatalogExample("{}", "Enumerate layers.")), handler: SceneQueryCommands.ReadLayerState),
        Route(CommandOperation.ViewState, "Read View State", "Returns active view and known viewport names.",
            requiresObjectRefs: false,
            @params: Params(
                Parameter(JsonFields.IncludeHidden, ParameterTypes.Boolean, false, "When true, page views are included. Defaults to false."),
                Parameter(JsonFields.Limit, ParameterTypes.Integer, false, "Caps viewport entries returned. Must be >= 1.")),
            examples: Seq1(new CommandCatalogExample("{}", "Inspect viewport state.")), handler: SceneQueryCommands.ReadViewState),
        Route(CommandOperation.ToleranceUnits, "Read Tolerance Units", "Returns model tolerances and unit system.",
            requiresObjectRefs: false, examples: Seq1(new CommandCatalogExample("{}", "Read document tolerance settings.")), handler: SceneQueryCommands.ReadToleranceUnits),
        Route(CommandOperation.ViewCapture, "Capture View", "Captures the active view as a bounded PNG artifact for verification.",
            requiresObjectRefs: false,
            @params: Params(
                Parameter(JsonFields.Width, ParameterTypes.Integer, false, $"Capture width in pixels. Clamped to [{CaptureDefaults.MinCaptureDimension}, {CaptureDefaults.MaxCaptureDimension}]."),
                Parameter(JsonFields.Height, ParameterTypes.Integer, false, $"Capture height in pixels. Clamped to [{CaptureDefaults.MinCaptureDimension}, {CaptureDefaults.MaxCaptureDimension}]."),
                Parameter(JsonFields.Dpi, ParameterTypes.Number, false, $"Capture DPI. Clamped to [{CaptureDefaults.MinCaptureDpi}, {CaptureDefaults.MaxCaptureDpi}]."),
                Parameter(JsonFields.TransparentBackground, ParameterTypes.Boolean, false, "When true, capture uses transparent background."),
                Parameter(JsonFields.RealtimePasses, ParameterTypes.Integer, false, $"Realtime render passes. Clamped to [{CaptureDefaults.MinRealtimePasses}, {CaptureDefaults.MaxRealtimePasses}].")),
            examples: Seq1(new CommandCatalogExample("{}", "Capture active view using defaults.")), handler: SceneQueryCommands.ReadViewCapture),
        Route(CommandOperation.ObjectCreate, "Create Object", "Creates a point or line object with optional layer/name attributes.",
            requiresObjectRefs: false,
            @params: Params(
                Parameter(JsonFields.Point, ParameterTypes.Number3, false, "Point coordinates [x,y,z]. Required when 'line' is absent."),
                Parameter(JsonFields.Line, ParameterTypes.Line, false, "Line endpoints. Required when 'point' is absent."),
                Parameter(JsonFields.LayerIndex, ParameterTypes.Integer, false, "Target layer index."),
                Parameter(JsonFields.Name, ParameterTypes.String, false, "Object name metadata.")),
            examples: Seq1(new CommandCatalogExample("""{"point":[0,0,0]}""", "Create a point at origin.")), handler: ObjectMutationCommands.HandleObjectCreate),
        Route(CommandOperation.ObjectDelete, "Delete Object", "Deletes the first resolved scene object reference.",
            requiresObjectRefs: true,
            @params: Params(
                Parameter(JsonFields.ObjectRefs, ParameterTypes.ObjectRefArray, false, "Optional explicit scene object references copied from read.object.list.")),
            examples: Seq1(new CommandCatalogExample("""{"objectRefs":[{"objectId":"<guid>","typeTag":"Brep"}]}""", "Delete args.objectRefs[0].")), handler: ObjectMutationCommands.HandleObjectDelete),
        Route(CommandOperation.ObjectUpdate, "Update Object", "Transforms or updates the first resolved scene object reference. Supports translation, rotation, scale, mirror via 'transform' field, or attribute updates.",
            requiresObjectRefs: true,
            @params: Params(
                Parameter(JsonFields.ObjectRefs, ParameterTypes.ObjectRefArray, false, "Optional explicit scene object references copied from read.object.list."),
                Parameter(JsonFields.Transform, ParameterTypes.String, false, "Transform type: rotate|scale|mirror."),
                Parameter(JsonFields.Translation, ParameterTypes.Number3, false, "Translation vector [x,y,z]."),
                Parameter(JsonFields.Angle, ParameterTypes.Number, false, "Rotation angle in degrees (rotate)."),
                Parameter(JsonFields.Axis, ParameterTypes.Number3, false, "Rotation axis [x,y,z] (rotate)."),
                Parameter(JsonFields.Center, ParameterTypes.Number3, false, "Rotation center [x,y,z] (rotate)."),
                Parameter(JsonFields.Factor, ParameterTypes.Number, false, "Scale factor (scale)."),
                Parameter(JsonFields.Origin, ParameterTypes.Number3, false, "Scale origin [x,y,z] (scale)."),
                Parameter(JsonFields.PlaneOrigin, ParameterTypes.Number3, false, "Mirror plane origin (mirror)."),
                Parameter(JsonFields.PlaneNormal, ParameterTypes.Number3, false, "Mirror plane normal (mirror)."),
                Parameter(JsonFields.LayerIndex, ParameterTypes.Integer, false, "Target layer index."),
                Parameter(JsonFields.Name, ParameterTypes.String, false, "Updated object name.")),
            examples: Seq(
                new CommandCatalogExample("""{"objectRefs":[{"objectId":"<guid>","typeTag":"Brep"}],"translation":[0,10,0]}""", "Move object by +10 in Y."),
                new CommandCatalogExample("""{"objectRefs":[{"objectId":"<guid>","typeTag":"Curve"}],"transform":"rotate","angle":45,"axis":[0,0,1],"center":[0,0,0]}""", "Rotate 45 around Z.")),
            handler: ObjectMutationCommands.HandleObjectUpdate),
        Route(CommandOperation.ObjectList, "List Objects", "Enumerates scene objects matching optional type, layer, and name filters, and returns objectRef for command-addressable objects.",
            requiresObjectRefs: false,
            @params: Params(
                Parameter(JsonFields.ObjectType, ParameterTypes.String, false, "Filter by object type: brep|mesh|curve|surface|point|annotation|instance."),
                Parameter(JsonFields.LayerIndex, ParameterTypes.Integer, false, "Filter by layer index."),
                Parameter(JsonFields.NamePattern, ParameterTypes.String, false, "Filter by name substring (case-insensitive)."),
                Parameter(JsonFields.Limit, ParameterTypes.Integer, false, $"Caps entries returned. Must be >= 1, <= {CaptureDefaults.MaxReadListLimit}.")),
            examples: Seq1(new CommandCatalogExample("""{"objectType":"brep","limit":50}""", "List up to 50 Brep objects.")),
            handler: ObjectQueryCommands.ReadObjectList),
        Route(CommandOperation.SelectionManage, "Manage Selection", "Sets, adds to, or clears the object selection.",
            requiresObjectRefs: false,
            @params: Params(
                Parameter(JsonFields.Action, ParameterTypes.String, true, "Selection action: set|add|clear."),
                Parameter(JsonFields.ObjectIds, ParameterTypes.StringArray, false, "Array of object GUIDs (required for set/add).")),
            examples: Seq(
                new CommandCatalogExample("""{"action":"clear"}""", "Clear all selection."),
                new CommandCatalogExample("""{"action":"set","objectIds":["<guid>"]}""", "Select specific objects.")),
            handler: SelectionCommands.HandleSelection,
            wrapUndo: false),
        Route(CommandOperation.InternalUndoExecution, "Internal Undo Execution", "Rolls back the latest agent-owned write using typed execution metadata.",
            advertise: false,
            requiresObjectRefs: false,
            @params: Params(
                Parameter(JsonFields.RequestId, ParameterTypes.String, true, "Original request id.")),
            examples: Seq1(new CommandCatalogExample("""{"requestId":"<guid>"}""", "Rollback the latest pending matching write.")),
            handler: ObjectMutationCommands.HandleUndoExecution,
            wrapUndo: false));
    private static readonly Dictionary<CommandOperation, CommandRoute> RoutesByOperation =
        Routes.ToDictionary(static route => route.Operation);
    internal static Seq<string> SupportedCapabilities { get; } =
        Routes
            .Filter(static route => route.Advertise)
            .Map(static route => route.Operation.Key)
            .Distinct();
    internal static Seq<CommandCatalogEntry> CommandCatalog { get; } =
        Routes.Filter(static route => route.Advertise).Map(ToCatalogEntry);
    internal static bool Supports(CommandOperation operation) =>
        RoutesByOperation.ContainsKey(operation);
    internal static Fin<JsonElement> Execute(
        RhinoDoc doc,
        CommandEnvelope envelope,
        AgentStateCallback onUndoRedo) =>
        ResolveRoute(envelope: envelope).Bind((CommandRoute route) =>
            route.WrapUndo switch {
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
                AgentUndoState undoState = new(
                    RequestId: envelope.Identity.RequestId,
                    UndoSerial: undoSerial);
                _ = doc.AddCustomUndoEvent(
                    description: TextValues.AgentStateSnapshot,
                    handler: MakeUndoHandler(onUndoRedo: onUndoRedo),
                    tag: undoState);
                _ = ObjectMutationCommands.RememberUndoState(undoState);
                _ = doc.EndUndoRecord(undoRecordSerialNumber: undoSerial);
                return FinSucc(payload);
            },
            Fail: (Error error) => {
                _ = doc.EndUndoRecord(undoRecordSerialNumber: undoSerial);
                _ = doc.Undo();
                return FinFail<JsonElement>(error);
            });
    }
    internal static Fin<RhinoObject> FindById(
        RhinoDoc doc,
        Guid objectId) =>
        Optional(doc.Objects.FindId(objectId))
            .ToFin(CommandParsers.CommandError(code: ErrorCode.PayloadMalformed, message: $"Object {objectId} not found."));
    internal static Fin<Seq<SceneObjectRef>> ResolveObjectRefs(CommandEnvelope envelope) =>
        CommandParsers.ParseOptionalSceneObjectRefs(envelope.Args).Map(option =>
            option.Match(
                Some: static refs => refs,
                None: () => envelope.ObjectRefs));
    internal static Fin<Seq<SceneObjectRef>> ResolveValidatedObjectRefs(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        ResolveObjectRefs(envelope).Bind(objectRefs =>
            objectRefs.Map(objectRef => ValidateObjectRef(
                doc: doc,
                objectRef: objectRef)).Sequence());
    internal static Fin<Guid> GetPrimaryObjectId(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        ResolveValidatedObjectRefs(doc: doc, envelope: envelope).Bind(objectRefs =>
            objectRefs.HeadOrNone()
                .ToFin(CommandParsers.CommandError(code: ErrorCode.PayloadMalformed, message: $"CommandId '{envelope.CommandId.Key}' requires at least one object reference in args.objectRefs or envelope.objectRefs."))
                .Map(static sceneObjectRef => (Guid)sceneObjectRef.ObjectId));
    private static Fin<SceneObjectRef> ValidateObjectRef(
        RhinoDoc doc,
        SceneObjectRef objectRef) =>
        FindById(doc: doc, objectId: (Guid)objectRef.ObjectId).Bind(found =>
            ObjectQueryCommands.ResolveSceneObjectType(found.ObjectType).ToFin(
                CommandParsers.CommandError(
                    code: ErrorCode.PayloadMalformed,
                    message: $"Object {(Guid)objectRef.ObjectId} resolves to unsupported Rhino object type '{found.ObjectType}'."))
            .Bind(actualType =>
                string.Equals(actualType.Key, objectRef.TypeTag.Key, StringComparison.Ordinal)
                    ? FinSucc(objectRef)
                    : FinFail<SceneObjectRef>(CommandParsers.CommandError(
                        code: ErrorCode.PayloadMalformed,
                        message: $"Object {(Guid)objectRef.ObjectId} is '{actualType.Key}' but objectRef.typeTag declared '{objectRef.TypeTag.Key}'."))));
    private static CommandRoute Route(
        CommandOperation operation,
        string name,
        string description,
        bool requiresObjectRefs,
        Seq<CommandCatalogExample> examples,
        Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>> handler,
        Seq<CommandCatalogParameter> @params = default,
        bool advertise = true,
        bool wrapUndo = true) =>
        new(
            Operation: operation,
            Name: name,
            Description: description,
            Advertise: advertise,
            Requirements: new CommandEnvelopeRequirements(
                RequiresTelemetryContext: true,
                RequiresObjectRefs: requiresObjectRefs,
                MinimumObjectRefCount: requiresObjectRefs ? 1 : 0),
            Parameters: @params.IsEmpty ? NoParams : @params,
            Examples: examples,
            WrapUndo: wrapUndo && operation.Category.Equals(CommandCategory.Write),
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
    private static CommandCatalogEntry ToCatalogEntry(CommandRoute route) =>
        new(
            Id: route.Operation.Key,
            Name: route.Name,
            Description: route.Description,
            Category: route.Operation.Category.Key,
            IsDestructive: route.IsDestructive,
            Aliases: NoAliases,
            Dispatch: new CommandDispatchMetadata(
                Mode: CommandDispatchMode.Direct),
            Requirements: route.Requirements,
            Params: route.Parameters,
            Examples: route.Examples);
    private static Fin<CommandRoute> ResolveRoute(CommandEnvelope envelope) =>
        RoutesByOperation.TryGetValue(
            envelope.CommandId,
            out CommandRoute route) switch {
                true => FinSucc(route),
                _ => FinFail<CommandRoute>(CommandParsers.CommandError(code: ErrorCode.CapabilityUnsupported, message: $"CommandId '{envelope.CommandId.Key}' is unsupported.")),
            };
    private static EventHandler<CustomUndoEventArgs> MakeUndoHandler(
        AgentStateCallback onUndoRedo) =>
        (object? sender, CustomUndoEventArgs args) => {
            AgentUndoState state = (AgentUndoState)args.Tag;
            _ = args.Document.AddCustomUndoEvent(
                description: TextValues.AgentStateSnapshot,
                handler: MakeUndoHandler(onUndoRedo: onUndoRedo),
                tag: state);
            bool isUndo = !args.CreatedByRedo;
            _ = ObjectMutationCommands.TrackUndoTransition(state, isUndo);
            _ = onUndoRedo(state: state, isUndo: isUndo)
                .IfFail(error => RhinoApp.WriteLine(
                    $"[Kargadan] UndoRedo publish failed: isUndo={isUndo}, requestId={state.RequestId}, undoSerial={state.UndoSerial}, error={error}"));
        };
}
