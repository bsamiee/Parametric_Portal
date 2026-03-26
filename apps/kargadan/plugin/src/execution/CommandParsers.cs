using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using Rhino.DocObjects;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.execution;

// --- [TYPES] -----------------------------------------------------------------

[StructLayout(LayoutKind.Auto)]
internal readonly record struct Triple(double X, double Y, double Z);
[StructLayout(LayoutKind.Auto)]
internal readonly record struct ViewCaptureOptions(
    int Width,
    int Height,
    double Dpi,
    bool TransparentBackground,
    int RealtimePasses);
[StructLayout(LayoutKind.Auto)]
internal readonly record struct ListReadOptions(
    bool IncludeHidden,
    Option<int> Limit);
[StructLayout(LayoutKind.Auto)]
internal readonly record struct TransformSpec(Rhino.Geometry.Transform Xform, string Status);
internal enum ReadDetailLevel {
    Compact,
    Standard,
    Full,
}

// --- [CONSTANTS] -------------------------------------------------------------

internal static class JsonFields {
    internal const string Action = "action";
    internal const string Angle = "angle";
    internal const string Axis = "axis";
    internal const string Center = "center";
    internal const string CommandId = "commandId";
    internal const string Detail = "detail";
    internal const string Dpi = "dpi";
    internal const string Factor = "factor";
    internal const string From = "from";
    internal const string Height = "height";
    internal const string IncludeHidden = "includeHidden";
    internal const string LayerIndex = "layerIndex";
    internal const string Limit = "limit";
    internal const string Line = "line";
    internal const string Name = "name";
    internal const string NamePattern = "namePattern";
    internal const string ObjectId = "objectId";
    internal const string ObjectIds = "objectIds";
    internal const string ObjectRefs = "objectRefs";
    internal const string ObjectType = "objectType";
    internal const string Origin = "origin";
    internal const string PlaneNormal = "planeNormal";
    internal const string PlaneOrigin = "planeOrigin";
    internal const string Point = "point";
    internal const string RealtimePasses = "realtimePasses";
    internal const string RequestId = "requestId";
    internal const string To = "to";
    internal const string Transform = "transform";
    internal const string TransparentBackground = "transparentBackground";
    internal const string Translation = "translation";
    internal const string TypeTag = "typeTag";
    internal const string Width = "width";
}
internal static class ParameterTypes {
    internal const string Boolean = "boolean";
    internal const string Integer = "integer";
    internal const string Line = "{from:number[3],to:number[3]}";
    internal const string Number = "number";
    internal const string Number3 = "number[3]";
    internal const string ObjectRef = "{objectId:uuid,typeTag:string}";
    internal const string ObjectRefArray = "{objectId:uuid,typeTag:string}[]";
    internal const string String = "string";
    internal const string StringArray = "string[]";
}
internal static class TextValues {
    internal const string AgentAction = "Agent Action";
    internal const string AgentStateSnapshot = "Agent State Snapshot";
    internal const string AttributesModified = "attributes-modified";
    internal const string Compact = "compact";
    internal const string Deleted = "deleted";
    internal const string Full = "full";
    internal const string Mirrored = "mirrored";
    internal const string Rotated = "rotated";
    internal const string Scaled = "scaled";
    internal const string SelectionAdded = "selection-added";
    internal const string SelectionCleared = "selection-cleared";
    internal const string SelectionSet = "selection-set";
    internal const string Standard = "standard";
    internal const string Transformed = "transformed";
}

// --- [CONSTANTS_CAPTURE] -----------------------------------------------------

internal static class CaptureDefaults {
    internal const int MinCaptureDimension = 256;
    internal const int MaxCaptureDimension = 4096;
    internal const int MinRealtimePasses = 1;
    internal const int MaxRealtimePasses = 32;
    internal const int DefaultCaptureWidth = 1600;
    internal const int DefaultCaptureHeight = 900;
    internal const int DefaultRealtimePasses = 2;
    internal const double MinCaptureDpi = 72d;
    internal const double MaxCaptureDpi = 600d;
    internal const double DefaultCaptureDpi = 144d;
    internal const int MaxReadListLimit = 200;
}

// --- [FUNCTIONS] -------------------------------------------------------------

internal static class CommandParsers {
    internal static Fin<T> ParseRequired<T>(
        JsonElement payload,
        string field,
        Func<JsonElement, Fin<T>> tryParse,
        string typeLabel) =>
        payload.TryGetProperty(field, out JsonElement element) switch {
            true => tryParse(element).BiMap(
                Succ: static (T value) => value,
                Fail: (_) => ParseError(field, typeLabel)),
            _ => FinFail<T>(Error.New($"{field} is required.")),
        };
    internal static Option<T> ParseOptional<T>(
        JsonElement payload,
        string field,
        Func<JsonElement, Option<T>> tryParse) =>
        payload.TryGetProperty(field, out JsonElement element) switch {
            true => tryParse(element),
            _ => None,
        };
    internal static Fin<string> TryParseString(JsonElement element) =>
        element.ValueKind switch {
            JsonValueKind.String => FinSucc((element.GetString() ?? string.Empty).Trim()),
            _ => FinFail<string>(Error.New("Expected a string.")),
        };
    internal static Fin<double> TryParseFiniteDouble(JsonElement element) =>
        element.ValueKind switch {
            JsonValueKind.Number when element.TryGetDouble(out double value) && double.IsFinite(value) =>
                FinSucc(value),
            JsonValueKind.Number => FinFail<double>(Error.New("Expected a finite number.")),
            _ => FinFail<double>(Error.New("Expected numeric.")),
        };
    internal static Fin<Triple> TryParseTriple(JsonElement element) =>
        ParseTriple(element: element, label: "value");
    internal static Option<int> TryParseOptionalInt(JsonElement element) =>
        element.TryGetInt32(out int value) ? Some(value) : None;
    internal static Option<string> TryParseOptionalString(JsonElement element) =>
        element.ValueKind == JsonValueKind.String
            ? Some(element.GetString() ?? string.Empty)
            : None;
    internal static Fin<T> ParseClamped<T>(
        JsonElement payload,
        string propertyName,
        T defaultValue,
        T minInclusive,
        T maxInclusive,
        Func<JsonElement, Fin<T>> tryParse,
        string typeLabel) where T : IComparable<T> =>
        payload.TryGetProperty(propertyName, out JsonElement element) switch {
            true when element.ValueKind == JsonValueKind.Number =>
                tryParse(element).Match(
                    Succ: (T parsed) => FinSucc(
                        parsed.CompareTo(minInclusive) < 0 ? minInclusive
                        : parsed.CompareTo(maxInclusive) > 0 ? maxInclusive
                        : parsed),
                    Fail: (_) => FinFail<T>(ParseError(propertyName, typeLabel))),
            true => FinFail<T>(ParseError(propertyName, "numeric")),
            _ => FinSucc(defaultValue),
        };
    private static Fin<int> TryParseInt(JsonElement element) =>
        element.TryGetInt32(out int value) ? FinSucc(value) : FinFail<int>(Error.New("Expected integer."));
    internal static Fin<bool> ParseBoolean(
        JsonElement payload,
        string propertyName,
        bool defaultValue) =>
        payload.TryGetProperty(propertyName, out JsonElement element) switch {
            true when element.ValueKind is JsonValueKind.True or JsonValueKind.False => FinSucc(element.GetBoolean()),
            true => FinFail<bool>(ParseError(propertyName, "a boolean")),
            _ => FinSucc(defaultValue),
        };
    internal static Fin<Triple> ParseTriple(
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
    internal static Fin<Rhino.Geometry.Line> ParseLine(JsonElement element) =>
        element.TryGetProperty(JsonFields.From, out JsonElement fromElement)
            && element.TryGetProperty(JsonFields.To, out JsonElement toElement)
            ? ParseTriple(
                element: fromElement,
                label: JsonFields.From).Bind((Triple from) =>
                ParseTriple(
                    element: toElement,
                    label: JsonFields.To).Map((Triple to) =>
                    new Rhino.Geometry.Line(
                        from: new Rhino.Geometry.Point3d(from.X, from.Y, from.Z),
                        to: new Rhino.Geometry.Point3d(to.X, to.Y, to.Z))))
            : FinFail<Rhino.Geometry.Line>(Error.New(message: $"Line must include {JsonFields.From}/{JsonFields.To} point arrays."));

    // --- [VOCABULARY_DISPATCH] ------------------------------------------------

    private static readonly Dictionary<string, ReadDetailLevel> DetailLevelVocabulary =
        new(StringComparer.OrdinalIgnoreCase) {
            ["compact"] = ReadDetailLevel.Compact,
            ["standard"] = ReadDetailLevel.Standard,
            ["full"] = ReadDetailLevel.Full,
        };
    private static readonly Dictionary<string, ObjectType> ObjectTypeVocabulary =
        new(StringComparer.OrdinalIgnoreCase) {
            ["brep"] = ObjectType.Brep,
            ["mesh"] = ObjectType.Mesh,
            ["curve"] = ObjectType.Curve,
            ["surface"] = ObjectType.Surface,
            ["point"] = ObjectType.Point,
            ["annotation"] = ObjectType.Annotation,
            ["instance"] = ObjectType.InstanceReference,
        };
    private static readonly Dictionary<string, string> SelectionActionVocabulary =
        new(StringComparer.OrdinalIgnoreCase) {
            ["clear"] = "clear",
            ["set"] = "set",
            ["add"] = "add",
        };
    internal static Fin<ReadDetailLevel> ParseDetailLevel(JsonElement payload) =>
        payload.TryGetProperty(JsonFields.Detail, out JsonElement el) switch {
            true when el.ValueKind == JsonValueKind.String =>
                DetailLevelVocabulary.TryGetValue((el.GetString() ?? string.Empty).Trim(), out ReadDetailLevel level)
                    ? FinSucc(level)
                    : FinFail<ReadDetailLevel>(Error.New($"{JsonFields.Detail} must be '{TextValues.Compact}', '{TextValues.Standard}', or '{TextValues.Full}'.")),
            true => FinFail<ReadDetailLevel>(ParseError(JsonFields.Detail, "a string")),
            _ => FinSucc(ReadDetailLevel.Standard),
        };
    internal static ObjectType ParseObjectTypeFilter(JsonElement payload) =>
        payload.TryGetProperty(JsonFields.ObjectType, out JsonElement element) switch {
            true when element.ValueKind == JsonValueKind.String =>
                ObjectTypeVocabulary.TryGetValue((element.GetString() ?? string.Empty).Trim(), out ObjectType objectType)
                    ? objectType
                    : ObjectType.AnyObject,
            _ => ObjectType.AnyObject,
        };
    internal static Fin<string> ParseSelectionAction(JsonElement payload) =>
        ParseRequired(payload, JsonFields.Action, TryParseString, "a string").Bind((string action) =>
            SelectionActionVocabulary.TryGetValue(action, out string? normalized) switch {
                true => FinSucc(normalized!),
                _ => FinFail<string>(Error.New($"{JsonFields.Action} must be: set|add|clear.")),
            });

    // --- [COMPOSITE_PARSERS] -------------------------------------------------

    internal static Fin<ListReadOptions> ParseListReadOptions(JsonElement payload) =>
        from includeHidden in ParseBoolean(payload, JsonFields.IncludeHidden, false)
        from limit in ParseLimit(payload)
        select new ListReadOptions(includeHidden, limit);
    internal static Fin<Option<int>> ParseLimit(JsonElement payload) =>
        payload.TryGetProperty(JsonFields.Limit, out JsonElement el) switch {
            true when el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out int v) && v >= 1 && v <= CaptureDefaults.MaxReadListLimit =>
                FinSucc<Option<int>>(Some(v)),
            true when el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out int v2) =>
                FinFail<Option<int>>(Error.New(v2 < 1
                    ? $"{JsonFields.Limit} must be >= 1."
                    : $"{JsonFields.Limit} must be <= {CaptureDefaults.MaxReadListLimit}.")),
            true when el.ValueKind == JsonValueKind.Number => FinFail<Option<int>>(ParseError(JsonFields.Limit, "an integer")),
            true => FinFail<Option<int>>(ParseError(JsonFields.Limit, "numeric")),
            _ => FinSucc<Option<int>>(None),
        };
    internal static Fin<ViewCaptureOptions> ParseViewCaptureOptions(JsonElement payload) =>
        from width in ParseClamped(payload, JsonFields.Width, CaptureDefaults.DefaultCaptureWidth, CaptureDefaults.MinCaptureDimension, CaptureDefaults.MaxCaptureDimension, TryParseInt, "an integer")
        from height in ParseClamped(payload, JsonFields.Height, CaptureDefaults.DefaultCaptureHeight, CaptureDefaults.MinCaptureDimension, CaptureDefaults.MaxCaptureDimension, TryParseInt, "an integer")
        from dpi in ParseClamped(payload, JsonFields.Dpi, CaptureDefaults.DefaultCaptureDpi, CaptureDefaults.MinCaptureDpi, CaptureDefaults.MaxCaptureDpi, TryParseFiniteDouble, "a finite number")
        from transparentBackground in ParseBoolean(payload, JsonFields.TransparentBackground, false)
        from realtimePasses in ParseClamped(payload, JsonFields.RealtimePasses, CaptureDefaults.DefaultRealtimePasses, CaptureDefaults.MinRealtimePasses, CaptureDefaults.MaxRealtimePasses, TryParseInt, "an integer")
        select new ViewCaptureOptions(width, height, dpi, transparentBackground, realtimePasses);
    internal static Fin<Seq<Guid>> ParseGuidArray(JsonElement payload, string field) =>
        payload.TryGetProperty(field, out JsonElement element) switch {
            true when element.ValueKind == JsonValueKind.Array =>
                toSeq(element.EnumerateArray().ToArray())
                    .Map((JsonElement item) =>
                        item.ValueKind == JsonValueKind.String && Guid.TryParse(item.GetString(), out Guid guid)
                            ? FinSucc(guid)
                            : FinFail<Guid>(Error.New($"{field} entries must be valid GUID strings.")))
                    .Sequence()
                    .Map(static (Seq<Guid> guids) => guids),
            true => FinFail<Seq<Guid>>(ParseError(field, "an array of GUID strings")),
            _ => FinFail<Seq<Guid>>(Error.New($"{field} is required.")),
        };
    internal static Fin<Guid> ParseGuid(JsonElement payload, string field) =>
        payload.TryGetProperty(field, out JsonElement element) switch {
            true when element.ValueKind == JsonValueKind.String && Guid.TryParse(element.GetString(), out Guid guid) => FinSucc(guid),
            true => FinFail<Guid>(ParseError(field, "a GUID string")),
            _ => FinFail<Guid>(Error.New($"{field} is required.")),
        };
    internal static Fin<Option<Seq<SceneObjectRef>>> ParseOptionalSceneObjectRefs(JsonElement payload) =>
        payload.TryGetProperty(JsonFields.ObjectRefs, out JsonElement element) switch {
            false => FinSucc<Option<Seq<SceneObjectRef>>>(None),
            true => ParseSceneObjectRefArray(element).Map(Some),
        };
    private static Fin<Seq<SceneObjectRef>> ParseSceneObjectRefArray(JsonElement element) =>
        element.ValueKind switch {
            JsonValueKind.Array =>
                toSeq(element.EnumerateArray().ToArray())
                    .Map(ParseSceneObjectRef)
                    .Sequence()
                    .Map(static (Seq<SceneObjectRef> refs) => refs),
            _ => FinFail<Seq<SceneObjectRef>>(Error.New($"{JsonFields.ObjectRefs} must be an array when provided.")),
        };
    private static Fin<SceneObjectRef> ParseSceneObjectRef(JsonElement element) =>
        element.ValueKind switch {
            JsonValueKind.Object =>
                from objectIdRaw in ParseRequiredPropertyAsString(
                    parent: element,
                    propertyName: JsonFields.ObjectId,
                    errorMessage: $"{JsonFields.ObjectRefs} entries require {JsonFields.ObjectId} as a string.")
                from typeTagRaw in ParseRequiredPropertyAsString(
                    parent: element,
                    propertyName: JsonFields.TypeTag,
                    errorMessage: $"{JsonFields.ObjectRefs} entries require {JsonFields.TypeTag} as a string.")
                from objectIdGuid in Guid.TryParse(objectIdRaw, out Guid parsedObjectId) switch {
                    true => FinSucc(parsedObjectId),
                    _ => FinFail<Guid>(Error.New($"{JsonFields.ObjectRefs} entries require {JsonFields.ObjectId} to be a valid GUID.")),
                }
                from objectId in DomainBridge.ParseValueObject<ObjectId, Guid>(candidate: objectIdGuid)
                from typeTag in DomainBridge.ParseSmartEnum<SceneObjectType, string>(candidate: typeTagRaw)
                    .BiMap(
                        Succ: static (SceneObjectType parsedType) => parsedType,
                        Fail: static (_) => Error.New($"{JsonFields.ObjectRefs} entries require a supported {JsonFields.TypeTag}."))
                from sceneObjectRef in SceneObjectRef.Create(
                    objectId: objectId,
                    typeTag: typeTag)
                select sceneObjectRef,
            _ => FinFail<SceneObjectRef>(Error.New($"{JsonFields.ObjectRefs} entries must be objects.")),
        };
    private static Fin<string> ParseRequiredPropertyAsString(
        JsonElement parent,
        string propertyName,
        string errorMessage) =>
        parent.TryGetProperty(propertyName, out JsonElement element) switch {
            true when element.ValueKind == JsonValueKind.String => FinSucc((element.GetString() ?? string.Empty).Trim()),
            _ => FinFail<string>(Error.New(errorMessage)),
        };
    private static Fin<int> ParseRequiredPropertyAsInt(
        JsonElement parent,
        string propertyName,
        string errorMessage) =>
        parent.TryGetProperty(propertyName, out JsonElement element) switch {
            true when element.TryGetInt32(out int value) => FinSucc(value),
            _ => FinFail<int>(Error.New(errorMessage)),
        };

    // --- [TRANSFORM_PARSING] -------------------------------------------------

    private static readonly Dictionary<string, Func<JsonElement, Fin<TransformSpec>>> TransformVocabulary =
        new(StringComparer.OrdinalIgnoreCase) {
            ["rotate"] = static (JsonElement payload) =>
                ParseRequired(payload, JsonFields.Angle, TryParseFiniteDouble, "a finite number").Bind((double angle) =>
                ParseRequired(payload, JsonFields.Axis, TryParseTriple, "a 3-item numeric array").Bind((Triple axis) =>
                ParseRequired(payload, JsonFields.Center, TryParseTriple, "a 3-item numeric array").Map((Triple center) =>
                    new TransformSpec(
                        Rhino.Geometry.Transform.Rotation(
                            angleRadians: angle * Math.PI / 180.0,
                            rotationAxis: new Rhino.Geometry.Vector3d(axis.X, axis.Y, axis.Z),
                            rotationCenter: new Rhino.Geometry.Point3d(center.X, center.Y, center.Z)),
                        TextValues.Rotated)))),
            ["scale"] = static (JsonElement payload) =>
                ParseRequired(payload, JsonFields.Factor, TryParseFiniteDouble, "a finite number").Bind((double factor) =>
                ParseRequired(payload, JsonFields.Origin, TryParseTriple, "a 3-item numeric array").Map((Triple origin) =>
                    new TransformSpec(
                        Rhino.Geometry.Transform.Scale(
                            anchor: new Rhino.Geometry.Point3d(origin.X, origin.Y, origin.Z),
                            scaleFactor: factor),
                        TextValues.Scaled))),
            ["mirror"] = static (JsonElement payload) =>
                ParseRequired(payload, JsonFields.PlaneOrigin, TryParseTriple, "a 3-item numeric array").Bind((Triple planeOrigin) =>
                ParseRequired(payload, JsonFields.PlaneNormal, TryParseTriple, "a 3-item numeric array").Map((Triple planeNormal) =>
                    new TransformSpec(
                        Rhino.Geometry.Transform.Mirror(
                            pointOnMirrorPlane: new Rhino.Geometry.Point3d(planeOrigin.X, planeOrigin.Y, planeOrigin.Z),
                            normalToMirrorPlane: new Rhino.Geometry.Vector3d(planeNormal.X, planeNormal.Y, planeNormal.Z)),
                        TextValues.Mirrored))),
        };
    internal static Fin<TransformSpec> ParseTransformPayload(JsonElement payload) =>
        ParseRequired(payload, JsonFields.Transform, TryParseString, "a string").Bind((string kind) =>
            TransformVocabulary.TryGetValue(kind, out Func<JsonElement, Fin<TransformSpec>>? parser) switch {
                true => parser!(payload),
                _ => FinFail<TransformSpec>(Error.New($"Unknown transform: '{kind}'. Expected: rotate|scale|mirror.")),
            });
    internal static Option<Fin<TransformSpec>> ResolveTransform(JsonElement payload) =>
        payload.TryGetProperty(JsonFields.Transform, out _) switch {
            true => Some(ParseTransformPayload(payload)),
            _ => payload.TryGetProperty(JsonFields.Translation, out JsonElement translationElement) switch {
                true => Some(ParseTriple(element: translationElement, label: JsonFields.Translation)
                    .Map((Triple translation) => new TransformSpec(
                        Rhino.Geometry.Transform.Translation(new Rhino.Geometry.Vector3d(translation.X, translation.Y, translation.Z)),
                        TextValues.Transformed))),
                _ => None,
            },
        };

    // --- [ERROR_HELPERS] -----------------------------------------------------

    internal static Error ParseError(string field, string expectedType) =>
        Error.New(message: $"{field} must be {expectedType} when provided.");
    internal static Error CommandError(contracts.ErrorCode code, string message) =>
        protocol.FailureMapping.ToError(protocol.FailureMapping.FromCode(code: code, message: message));
}
