using System;
using System.Collections.Generic;
using System.Drawing.Imaging;
using System.IO;
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
        internal const string Detail = "detail";
        internal const string Dpi = "dpi";
        internal const string From = "from";
        internal const string Height = "height";
        internal const string IncludeHidden = "includeHidden";
        internal const string LayerIndex = "layerIndex";
        internal const string Limit = "limit";
        internal const string Line = "line";
        internal const string Name = "name";
        internal const string Point = "point";
        internal const string RealtimePasses = "realtimePasses";
        internal const string Script = "script";
        internal const string To = "to";
        internal const string TransparentBackground = "transparentBackground";
        internal const string Translation = "translation";
        internal const string Width = "width";
    }
    private static class ParameterTypes {
        internal const string Boolean = "boolean";
        internal const string Integer = "integer";
        internal const string Line = "{from:number[3],to:number[3]}";
        internal const string Number = "number";
        internal const string Number3 = "number[3]";
        internal const string String = "string";
    }
    private static class TextValues {
        internal const string AgentAction = "Agent Action";
        internal const string AgentStateSnapshot = "Agent State Snapshot";
        internal const string AttributesModified = "attributes-modified";
        internal const string Compact = "compact";
        internal const string Deleted = "deleted";
        internal const string Full = "full";
        internal const string Standard = "standard";
        internal const string Transformed = "transformed";
    }
    private static readonly Error ScriptNotExecuted =
        CommandError(code: ErrorCode.UnexpectedRuntime, message: "Rhino did not execute the script.");
    private const int MaxReadListLimit = 200;
    private const int MinCaptureDimension = 256;
    private const int MaxCaptureDimension = 4096;
    private const int MinRealtimePasses = 1;
    private const int MaxRealtimePasses = 32;
    private const int DefaultCaptureWidth = 1600;
    private const int DefaultCaptureHeight = 900;
    private const int DefaultRealtimePasses = 2;
    private const double MinCaptureDpi = 72d;
    private const double MaxCaptureDpi = 600d;
    private const double DefaultCaptureDpi = 144d;
    private static readonly Seq<string> NoAliases = Seq<string>();
    private static readonly Seq<CommandCatalogParameter> NoParams = Seq<CommandCatalogParameter>();
    private static readonly double[] ZeroPoint = [0d, 0d, 0d];
    private static double[] ProjectPoint(Point3d pt) => [pt.X, pt.Y, pt.Z];
    private static double[] ProjectPointOrZero(BoundingBox box, Func<BoundingBox, Point3d> selector) =>
        box.IsValid ? ProjectPoint(selector(box)) : ZeroPoint;
    private static readonly Seq<CommandRoute> Routes = Seq(
        Route(CommandOperation.SceneSummary, "Read Scene Summary", "Returns active viewport, object count, layer count, and compact Layer-0 scene fields.",
            requiresObjectRefs: false, examples: Seq1(new CommandCatalogExample("{}", "Summarize the active scene.")), handler: ReadSceneSummary),
        Route(CommandOperation.ObjectMetadata, "Read Object Metadata", "Returns metadata for the first object reference in the command envelope.",
            requiresObjectRefs: true,
            @params: Params(Parameter(JsonFields.Detail, ParameterTypes.String, false, "Detail level: compact|standard|full. Defaults to standard.")),
            examples: Seq1(new CommandCatalogExample("{}", "Read metadata from objectRefs[0].")), handler: ReadObjectMetadata),
        Route(CommandOperation.ObjectGeometry, "Read Object Geometry", "Returns geometric bounds for the first object reference in the command envelope.",
            requiresObjectRefs: true,
            @params: Params(Parameter(JsonFields.Detail, ParameterTypes.String, false, "Detail level: compact|standard|full. Defaults to standard.")),
            examples: Seq1(new CommandCatalogExample("{}", "Read geometric bounds from objectRefs[0].")), handler: ReadObjectGeometry),
        Route(CommandOperation.LayerState, "Read Layer State", "Lists layer visibility and names.",
            requiresObjectRefs: false,
            @params: Params(
                Parameter(JsonFields.IncludeHidden, ParameterTypes.Boolean, false, "When true, hidden layers are included. Defaults to false."),
                Parameter(JsonFields.Limit, ParameterTypes.Integer, false, "Caps layer entries returned. Must be >= 1.")),
            examples: Seq1(new CommandCatalogExample("{}", "Enumerate layers.")), handler: ReadLayerState),
        Route(CommandOperation.ViewState, "Read View State", "Returns active view and known viewport names.",
            requiresObjectRefs: false,
            @params: Params(
                Parameter(JsonFields.IncludeHidden, ParameterTypes.Boolean, false, "When true, page views are included. Defaults to false."),
                Parameter(JsonFields.Limit, ParameterTypes.Integer, false, "Caps viewport entries returned. Must be >= 1.")),
            examples: Seq1(new CommandCatalogExample("{}", "Inspect viewport state.")), handler: ReadViewState),
        Route(CommandOperation.ToleranceUnits, "Read Tolerance Units", "Returns model tolerances and unit system.",
            requiresObjectRefs: false, examples: Seq1(new CommandCatalogExample("{}", "Read document tolerance settings.")), handler: ReadToleranceUnits),
        Route(CommandOperation.ViewCapture, "Capture View", "Captures the active view as a bounded PNG artifact for verification.",
            requiresObjectRefs: false,
            @params: Params(
                Parameter(JsonFields.Width, ParameterTypes.Integer, false, $"Capture width in pixels. Clamped to [{MinCaptureDimension}, {MaxCaptureDimension}]."),
                Parameter(JsonFields.Height, ParameterTypes.Integer, false, $"Capture height in pixels. Clamped to [{MinCaptureDimension}, {MaxCaptureDimension}]."),
                Parameter(JsonFields.Dpi, ParameterTypes.Number, false, $"Capture DPI. Clamped to [{MinCaptureDpi}, {MaxCaptureDpi}]."),
                Parameter(JsonFields.TransparentBackground, ParameterTypes.Boolean, false, "When true, capture uses transparent background."),
                Parameter(JsonFields.RealtimePasses, ParameterTypes.Integer, false, $"Realtime render passes. Clamped to [{MinRealtimePasses}, {MaxRealtimePasses}].")),
            examples: Seq1(new CommandCatalogExample("{}", "Capture active view using defaults.")), handler: ReadViewCapture),
        Route(CommandOperation.ObjectCreate, "Create Object", "Creates a point or line object with optional layer/name attributes.",
            requiresObjectRefs: false,
            @params: Params(
                Parameter(JsonFields.Point, ParameterTypes.Number3, false, "Point coordinates [x,y,z]. Required when 'line' is absent."),
                Parameter(JsonFields.Line, ParameterTypes.Line, false, "Line endpoints. Required when 'point' is absent."),
                Parameter(JsonFields.LayerIndex, ParameterTypes.Integer, false, "Target layer index."),
                Parameter(JsonFields.Name, ParameterTypes.String, false, "Object name metadata.")),
            examples: Seq1(new CommandCatalogExample("""{"point":[0,0,0]}""", "Create a point at origin.")), handler: HandleObjectCreate),
        Route(CommandOperation.ObjectDelete, "Delete Object", "Deletes the first referenced object.",
            requiresObjectRefs: true, examples: Seq1(new CommandCatalogExample("{}", "Delete objectRefs[0].")), handler: HandleObjectDelete),
        Route(CommandOperation.ObjectUpdate, "Update Object", "Transforms object translation or updates basic attributes.",
            requiresObjectRefs: true,
            @params: Params(
                Parameter(JsonFields.Translation, ParameterTypes.Number3, false, "Translation vector [x,y,z]."),
                Parameter(JsonFields.LayerIndex, ParameterTypes.Integer, false, "Target layer index."),
                Parameter(JsonFields.Name, ParameterTypes.String, false, "Updated object name.")),
            examples: Seq1(new CommandCatalogExample("""{"translation":[0,10,0]}""", "Move object by +10 in Y.")), handler: HandleObjectUpdate),
        Route(CommandOperation.ScriptRun, "Run Rhino Script", "Runs a Rhino command script through RhinoApp.RunScript.",
            requiresObjectRefs: false,
            @params: Params(Parameter(JsonFields.Script, ParameterTypes.String, true, "Rhino command script to execute.")),
            examples: Seq1(new CommandCatalogExample("""{"script":"_Line 0,0,0 10,0,0 _Enter"}""", "Run a Rhino line command script.")),
            handler: static (RhinoDoc doc, CommandEnvelope envelope) =>
                ExecuteScriptOperation(doc: doc, payload: envelope.Payload)));
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
    private static CommandRoute Route(
        CommandOperation operation,
        string name,
        string description,
        bool requiresObjectRefs,
        Seq<CommandCatalogExample> examples,
        Func<RhinoDoc, CommandEnvelope, Fin<JsonElement>> handler,
        Seq<CommandCatalogParameter> @params = default) =>
        new(
            Operation: operation,
            Name: name,
            Description: description,
            Requirements: new CommandEnvelopeRequirements(
                RequiresTelemetryContext: true,
                RequiresObjectRefs: requiresObjectRefs,
                MinimumObjectRefCount: requiresObjectRefs ? 1 : 0),
            Parameters: @params.IsEmpty ? NoParams : @params,
            Examples: examples,
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
                Mode: route.DispatchMode),
            Requirements: route.Requirements,
            Params: route.Parameters,
            Examples: route.Examples);
    private static Fin<CommandRoute> ResolveRoute(CommandEnvelope envelope) =>
        RoutesByOperation.TryGetValue(
            envelope.Operation,
            out CommandRoute route) switch {
                true => FinSucc(route),
                _ => FinFail<CommandRoute>(CommandError(code: ErrorCode.CapabilityUnsupported, message: $"Operation '{envelope.Operation.Key}' is unsupported.")),
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
        CommandEnvelope _) {
        Layer? activeLayer = doc.Layers.CurrentLayer;
        BoundingBox worldBox = doc.Objects.BoundingBox;
        int annotationCount = checked(
            doc.Objects.GetObjectList(ObjectType.Annotation).Count()
            + doc.Objects.GetObjectList(ObjectType.TextDot).Count());
        return FinSucc(JsonSerializer.SerializeToElement(new {
            activeView = doc.Views.ActiveView?.ActiveViewport.Name ?? string.Empty,
            layerCount = doc.Layers.Count,
            objectCount = doc.Objects.Count,
            objectCountsByType = new Dictionary<string, int>(StringComparer.Ordinal) {
                [SceneObjectType.Brep.Key] = doc.Objects.GetObjectList(ObjectType.Brep).Count(),
                [SceneObjectType.Mesh.Key] = doc.Objects.GetObjectList(ObjectType.Mesh).Count(),
                [SceneObjectType.Curve.Key] = doc.Objects.GetObjectList(ObjectType.Curve).Count(),
                [SceneObjectType.Surface.Key] = doc.Objects.GetObjectList(ObjectType.Surface).Count(),
                [SceneObjectType.Annotation.Key] = annotationCount,
                [SceneObjectType.Instance.Key] = doc.Objects.GetObjectList(ObjectType.InstanceReference).Count(),
                [SceneObjectType.LayoutDetail.Key] = doc.Objects.GetObjectList(ObjectType.Detail).Count(),
            },
            activeLayer = new {
                index = activeLayer?.Index ?? -1,
                name = activeLayer?.Name ?? string.Empty,
            },
            tolerances = new {
                unitSystem = doc.ModelUnitSystem.ToString(),
                absoluteTolerance = doc.ModelAbsoluteTolerance,
                angleToleranceRadians = doc.ModelAngleToleranceRadians,
            },
            worldBoundingBox = new {
                min = ProjectPointOrZero(worldBox, static b => b.Min),
                max = ProjectPointOrZero(worldBox, static b => b.Max),
            },
        }));
    }
    private static Dictionary<string, object> CompactBase(RhinoObject found) =>
        new(StringComparer.Ordinal) {
            ["id"] = found.Id,
            ["objectType"] = found.ObjectType.ToString(),
        };
    private static Fin<JsonElement> ReadObjectMetadata(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        ReadObjectWith(
            doc: doc,
            envelope: envelope,
            project: static (RhinoObject found, RhinoDoc d, ReadDetailLevel detail) => {
                Dictionary<string, object> props = CompactBase(found);
                string layerName = d.Layers[found.Attributes.LayerIndex]?.Name ?? string.Empty;
                return detail switch {
                    ReadDetailLevel.Compact => JsonSerializer.SerializeToElement(props),
                    ReadDetailLevel.Standard or ReadDetailLevel.Full => AccumulateMetadata(
                        props: props, found: found, layerName: layerName, detail: detail),
                    _ => JsonSerializer.SerializeToElement(props),
                };
            });
    private static JsonElement AccumulateMetadata(
        Dictionary<string, object> props,
        RhinoObject found,
        string layerName,
        ReadDetailLevel detail) {
        props["layerIndex"] = found.Attributes.LayerIndex;
        props["layerName"] = layerName;
        props["name"] = found.Attributes.Name;
        return detail switch {
            ReadDetailLevel.Full => AccumulateFullMetadata(props: props, found: found),
            _ => JsonSerializer.SerializeToElement(props),
        };
    }
    private static JsonElement AccumulateFullMetadata(
        Dictionary<string, object> props,
        RhinoObject found) {
        props["isDeleted"] = found.IsDeleted;
        props["isHidden"] = found.IsHidden;
        props["isLocked"] = found.IsLocked;
        props["isReference"] = found.IsReference;
        props["isVisible"] = found.Attributes.Visible;
        props["displayOrder"] = found.Attributes.DisplayOrder;
        props["materialIndex"] = found.Attributes.MaterialIndex;
        props["materialSource"] = found.Attributes.MaterialSource.ToString();
        return JsonSerializer.SerializeToElement(props);
    }
    private static Fin<JsonElement> ReadObjectGeometry(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        ReadObjectWith(
            doc: doc,
            envelope: envelope,
            project: static (RhinoObject found, RhinoDoc _, ReadDetailLevel detail) => {
                Dictionary<string, object> props = CompactBase(found);
                BoundingBox box = found.Geometry.GetBoundingBox(accurate: true);
                return detail switch {
                    ReadDetailLevel.Compact => JsonSerializer.SerializeToElement(props),
                    ReadDetailLevel.Standard or ReadDetailLevel.Full => AccumulateGeometry(
                        props: props, box: box, detail: detail),
                    _ => JsonSerializer.SerializeToElement(props),
                };
            });
    private static JsonElement AccumulateGeometry(
        Dictionary<string, object> props,
        BoundingBox box,
        ReadDetailLevel detail) {
        props["min"] = ProjectPointOrZero(box, static b => b.Min);
        props["max"] = ProjectPointOrZero(box, static b => b.Max);
        props["boxIsValid"] = box.IsValid;
        return detail switch {
            ReadDetailLevel.Full => AccumulateFullGeometry(props: props, box: box),
            _ => JsonSerializer.SerializeToElement(props),
        };
    }
    private static JsonElement AccumulateFullGeometry(
        Dictionary<string, object> props,
        BoundingBox box) {
        props["center"] = ProjectPointOrZero(box, static b => b.Center);
        props["diagonalLength"] = box.IsValid ? box.Diagonal.Length : 0.0;
        props["area"] = box.IsValid ? box.Area : 0.0;
        props["volume"] = box.IsValid ? box.Volume : 0.0;
        return JsonSerializer.SerializeToElement(props);
    }
    private static Fin<JsonElement> ReadObjectWith(
        RhinoDoc doc,
        CommandEnvelope envelope,
        Func<RhinoObject, RhinoDoc, ReadDetailLevel, JsonElement> project) =>
        from detail in ParseDetailLevel(envelope.Payload)
        from objectId in GetPrimaryObjectId(envelope)
        from found in FindById(doc, objectId)
        select project(found, doc, detail);
    private static Fin<JsonElement> ReadLayerState(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        ParseListReadOptions(payload: envelope.Payload).Map((ListReadOptions options) =>
            JsonSerializer.SerializeToElement(new {
                layers = doc.Layers
                    .Where(layer => options.IncludeHidden || layer.IsVisible)
                    .Take(options.Limit.IfNone(int.MaxValue))
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
        ParseListReadOptions(payload: envelope.Payload).Map((ListReadOptions options) =>
            JsonSerializer.SerializeToElement(new {
                activeView = doc.Views.ActiveView?.ActiveViewport.Name ?? string.Empty,
                viewports = doc.Views
                    .GetViewList(options.IncludeHidden switch {
                        true => (Rhino.Display.ViewTypeFilter)3,
                        _ => Rhino.Display.ViewTypeFilter.Model,
                    })
                    .Take(options.Limit.IfNone(int.MaxValue))
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
    private static Fin<JsonElement> ReadViewCapture(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        ParseViewCaptureOptions(payload: envelope.Payload).Bind((ViewCaptureOptions options) =>
            Optional(doc.Views.ActiveView)
                .ToFin(Error.New(message: "No active view available for capture."))
                .Bind((Rhino.Display.RhinoView activeView) => {
                    Rhino.Display.ViewCapture capture = new() {
                        DrawAxes = false,
                        DrawGrid = false,
                        DrawGridAxes = false,
                        Height = options.Height,
                        RealtimeRenderPasses = options.RealtimePasses,
                        TransparentBackground = options.TransparentBackground,
                        Width = options.Width,
                    };
                    using System.Drawing.Bitmap? bitmap = capture.CaptureToBitmap(activeView);
                    return bitmap switch {
                        null => FinFail<JsonElement>(CommandError(code: ErrorCode.UnexpectedRuntime, message: "Direct API operation 'ViewCapture.CaptureToBitmap' failed.")),
                        _ => SerializeViewCapture(
                            bitmap: bitmap,
                            activeView: activeView,
                            options: options),
                    };
                }));
    private static Fin<ViewCaptureOptions> ParseViewCaptureOptions(JsonElement payload) =>
        from width in ParseClamped(payload, JsonFields.Width, DefaultCaptureWidth, MinCaptureDimension, MaxCaptureDimension, TryParseInt, "an integer")
        from height in ParseClamped(payload, JsonFields.Height, DefaultCaptureHeight, MinCaptureDimension, MaxCaptureDimension, TryParseInt, "an integer")
        from dpi in ParseClamped(payload, JsonFields.Dpi, DefaultCaptureDpi, MinCaptureDpi, MaxCaptureDpi, TryParseFiniteDouble, "a finite number")
        from transparentBackground in ParseBoolean(payload, JsonFields.TransparentBackground, false)
        from realtimePasses in ParseClamped(payload, JsonFields.RealtimePasses, DefaultRealtimePasses, MinRealtimePasses, MaxRealtimePasses, TryParseInt, "an integer")
        select new ViewCaptureOptions(width, height, dpi, transparentBackground, realtimePasses);
    private static Fin<JsonElement> SerializeViewCapture(
        System.Drawing.Bitmap bitmap,
        Rhino.Display.RhinoView activeView,
        ViewCaptureOptions options) {
        bitmap.SetResolution(
            xDpi: (float)options.Dpi,
            yDpi: (float)options.Dpi);
        using MemoryStream stream = new();
        bitmap.Save(
            stream: stream,
            format: ImageFormat.Png);
        byte[] pngBytes = stream.ToArray();
        return FinSucc(JsonSerializer.SerializeToElement(new {
            activeView = activeView.ActiveViewport.Name,
            byteLength = pngBytes.Length,
            dpi = options.Dpi,
            height = options.Height,
            imageBase64 = Convert.ToBase64String(pngBytes),
            mimeType = "image/png",
            realtimePasses = options.RealtimePasses,
            transparentBackground = options.TransparentBackground,
            width = options.Width,
        }));
    }
    private delegate bool TryParseNumeric<T>(JsonElement element, out T value);
    private static Fin<T> ParseClamped<T>(
        JsonElement payload,
        string propertyName,
        T defaultValue,
        T minInclusive,
        T maxInclusive,
        TryParseNumeric<T> tryParse,
        string typeLabel) where T : IComparable<T> =>
        payload.TryGetProperty(propertyName, out JsonElement element) switch {
            true when element.ValueKind == JsonValueKind.Number && tryParse(element, out T parsed) =>
                FinSucc(parsed.CompareTo(minInclusive) < 0 ? minInclusive : parsed.CompareTo(maxInclusive) > 0 ? maxInclusive : parsed),
            true when element.ValueKind == JsonValueKind.Number => FinFail<T>(ParseError(propertyName, typeLabel)),
            true => FinFail<T>(ParseError(propertyName, "numeric")),
            _ => FinSucc(defaultValue),
        };
    private static bool TryParseInt(JsonElement element, out int value) =>
        element.TryGetInt32(out value);
    private static bool TryParseFiniteDouble(JsonElement element, out double value) {
        bool parsed = element.TryGetDouble(out value);
        return parsed && double.IsFinite(value);
    }
    private static Fin<bool> ParseBoolean(
        JsonElement payload,
        string propertyName,
        bool defaultValue) =>
        payload.TryGetProperty(propertyName, out JsonElement element) switch {
            true when element.ValueKind is JsonValueKind.True or JsonValueKind.False => FinSucc(element.GetBoolean()),
            true => FinFail<bool>(ParseError(propertyName, "a boolean")),
            _ => FinSucc(defaultValue),
        };
    private static Fin<ReadDetailLevel> ParseDetailLevel(JsonElement payload) =>
        payload.TryGetProperty(JsonFields.Detail, out JsonElement el) switch {
            true when el.ValueKind == JsonValueKind.String =>
                (el.GetString() ?? string.Empty).Trim().ToUpperInvariant() switch {
                    "COMPACT" => FinSucc(ReadDetailLevel.Compact),
                    "STANDARD" => FinSucc(ReadDetailLevel.Standard),
                    "FULL" => FinSucc(ReadDetailLevel.Full),
                    _ => FinFail<ReadDetailLevel>(Error.New($"{JsonFields.Detail} must be '{TextValues.Compact}', '{TextValues.Standard}', or '{TextValues.Full}'.")),
                },
            true => FinFail<ReadDetailLevel>(ParseError(JsonFields.Detail, "a string")),
            _ => FinSucc(ReadDetailLevel.Standard),
        };
    private static Fin<ListReadOptions> ParseListReadOptions(JsonElement payload) =>
        from includeHidden in ParseBoolean(payload, JsonFields.IncludeHidden, false)
        from limit in ParseLimit(payload)
        select new ListReadOptions(includeHidden, limit);
    private static Fin<Option<int>> ParseLimit(JsonElement payload) =>
        payload.TryGetProperty(JsonFields.Limit, out JsonElement el) switch {
            true when el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out int v) && v >= 1 && v <= MaxReadListLimit =>
                FinSucc<Option<int>>(Some(v)),
            true when el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out int v2) =>
                FinFail<Option<int>>(Error.New(v2 < 1
                    ? $"{JsonFields.Limit} must be >= 1."
                    : $"{JsonFields.Limit} must be <= {MaxReadListLimit}.")),
            true when el.ValueKind == JsonValueKind.Number => FinFail<Option<int>>(ParseError(JsonFields.Limit, "an integer")),
            true => FinFail<Option<int>>(ParseError(JsonFields.Limit, "numeric")),
            _ => FinSucc<Option<int>>(None),
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
            true => ParseTriple(
                element: pointElement,
                label: JsonFields.Point).Map(static (Triple point) =>
                (GeometryBase)new Point(new Point3d(point.X, point.Y, point.Z))),
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
                true => FinFail<JsonElement>(CommandError(code: ErrorCode.UnexpectedRuntime, message: "Direct API operation 'AddObject' failed.")),
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
                    false => FinFail<Unit>(CommandError(code: ErrorCode.PayloadMalformed, message: $"Object {objectId} not found.")),
                },
                objectId: objectId,
                status: TextValues.Deleted));
    private static Fin<JsonElement> HandleObjectUpdate(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        GetPrimaryObjectId(envelope: envelope).Bind((Guid objectId) =>
            envelope.Payload.TryGetProperty(JsonFields.Translation, out JsonElement translationElement) switch {
                true => ParseTriple(
                    element: translationElement,
                    label: JsonFields.Translation).Bind((Triple translation) =>
                    MapObjectStatus(
                        operation: (doc.Objects.Transform(
                            objectId: objectId,
                            xform: Transform.Translation(new Vector3d(translation.X, translation.Y, translation.Z)),
                            deleteOriginal: true) == Guid.Empty) switch {
                                true => FinFail<Unit>(CommandError(code: ErrorCode.PayloadMalformed, message: $"Object {objectId} not found.")),
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
                                    false => FinFail<Unit>(CommandError(code: ErrorCode.PayloadMalformed, message: $"Object {objectId} not found.")),
                                },
                            objectId: objectId,
                            status: TextValues.AttributesModified));
                    }),
            });
    private static Fin<Unit> ApplyOptionalAttribute(
        JsonElement payload,
        string field,
        Func<JsonElement, Fin<Unit>> validate) =>
        payload.TryGetProperty(field, out JsonElement element) switch {
            true => validate(element),
            _ => FinSucc(unit),
        };
    private static Fin<Unit> ApplyAttributesFromPayload(
        RhinoDoc doc,
        ObjectAttributes attributes,
        JsonElement payload) =>
        ApplyOptionalAttribute(payload, JsonFields.LayerIndex, (JsonElement element) =>
            element.TryGetInt32(out int layerIndex) switch {
                true when layerIndex >= 0 && layerIndex < doc.Layers.Count =>
                    FinSucc(attributes).Map((ObjectAttributes current) => { current.LayerIndex = layerIndex; return unit; }),
                true => FinFail<Unit>(Error.New(message: $"{JsonFields.LayerIndex} {layerIndex} is out of range [0, {doc.Layers.Count}).")),
                _ => FinFail<Unit>(Error.New(message: $"{JsonFields.LayerIndex} must be an integer when provided.")),
            })
        .Bind((_) => ApplyOptionalAttribute(payload, JsonFields.Name, (JsonElement element) =>
            element.ValueKind switch {
                JsonValueKind.String => FinSucc(attributes).Map((ObjectAttributes current) => { current.Name = element.GetString() ?? string.Empty; return unit; }),
                _ => FinFail<Unit>(Error.New(message: $"{JsonFields.Name} must be a string when provided.")),
            }));
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
                            CommandError(code: ErrorCode.TransientIo, message: $"Command '{commandArgs.CommandEnglishName}' was cancelled.")),
                        _ => FinFail<ScriptResult>(
                            Error.New(message: $"Command '{commandArgs.CommandEnglishName}' failed: {commandArgs.CommandResult}")),
                    }),
        };
    }
    internal static Fin<RhinoObject> FindById(
        RhinoDoc doc,
        Guid objectId) =>
        Optional(doc.Objects.FindId(objectId))
            .ToFin(CommandError(code: ErrorCode.PayloadMalformed, message: $"Object {objectId} not found."));
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
    private static Error ParseError(string field, string expectedType) =>
        Error.New(message: $"{field} must be {expectedType} when provided.");
    private static Error CommandError(ErrorCode code, string message) =>
        FailureMapping.ToError(FailureMapping.FromCode(code: code, message: message));
    private enum ReadDetailLevel {
        Compact,
        Standard,
        Full,
    }
    [StructLayout(LayoutKind.Auto)]
    private readonly record struct ViewCaptureOptions(
        int Width,
        int Height,
        double Dpi,
        bool TransparentBackground,
        int RealtimePasses);
    [StructLayout(LayoutKind.Auto)]
    private readonly record struct ListReadOptions(
        bool IncludeHidden,
        Option<int> Limit);
    [StructLayout(LayoutKind.Auto)]
    private readonly record struct Triple(double X, double Y, double Z);
}
