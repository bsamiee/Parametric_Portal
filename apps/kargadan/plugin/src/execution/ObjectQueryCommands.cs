using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using Rhino;
using Rhino.DocObjects;
using Rhino.Geometry;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.execution;

// --- [TYPES] -----------------------------------------------------------------

[StructLayout(LayoutKind.Auto)]
internal readonly record struct SceneObjectRefProjection(
    Guid ObjectId,
    string TypeTag);
[StructLayout(LayoutKind.Auto)]
internal readonly record struct ObjectProjection(
    Guid Id,
    string ObjectType,
    Option<SceneObjectRefProjection> ObjectRef,
    Option<int> LayerIndex,
    Option<string> LayerName,
    Option<string> Name,
    Option<double[]> Min,
    Option<double[]> Max,
    Option<bool> BoxIsValid,
    Option<bool> IsDeleted,
    Option<bool> IsHidden,
    Option<bool> IsLocked,
    Option<bool> IsReference,
    Option<bool> IsVisible,
    Option<int> DisplayOrder,
    Option<int> MaterialIndex,
    Option<string> MaterialSource,
    Option<double[]> Center,
    Option<double> DiagonalLength,
    Option<double> Area,
    Option<double> Volume);

// --- [FUNCTIONS] -------------------------------------------------------------

internal static class ObjectQueryCommands {
    internal static Fin<JsonElement> ReadObjectMetadata(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        ReadObjectWith(
            doc: doc,
            envelope: envelope,
            project: static (RhinoObject found, RhinoDoc d, ReadDetailLevel detail) => {
                string layerName = d.Layers[found.Attributes.LayerIndex]?.Name ?? string.Empty;
                ObjectProjection compact = new(
                    Id: found.Id,
                    ObjectType: found.ObjectType.ToString(),
                    ObjectRef: ProjectSceneObjectRef(found),
                    LayerIndex: None, LayerName: None, Name: None,
                    Min: None, Max: None, BoxIsValid: None,
                    IsDeleted: None, IsHidden: None, IsLocked: None,
                    IsReference: None, IsVisible: None, DisplayOrder: None,
                    MaterialIndex: None, MaterialSource: None,
                    Center: None, DiagonalLength: None, Area: None, Volume: None);
                ObjectProjection standard = compact with {
                    LayerIndex = Some(found.Attributes.LayerIndex),
                    LayerName = Some(layerName),
                    Name = Optional(found.Attributes.Name),
                };
                ObjectProjection full = standard with {
                    IsDeleted = Some(found.IsDeleted),
                    IsHidden = Some(found.IsHidden),
                    IsLocked = Some(found.IsLocked),
                    IsReference = Some(found.IsReference),
                    IsVisible = Some(found.Attributes.Visible),
                    DisplayOrder = Some(found.Attributes.DisplayOrder),
                    MaterialIndex = Some(found.Attributes.MaterialIndex),
                    MaterialSource = Some(found.Attributes.MaterialSource.ToString()),
                };
                return SerializeProjection(detail switch {
                    ReadDetailLevel.Full => full,
                    ReadDetailLevel.Standard => standard,
                    _ => compact,
                });
            });
    internal static Fin<JsonElement> ReadObjectGeometry(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        ReadObjectWith(
            doc: doc,
            envelope: envelope,
            project: static (RhinoObject found, RhinoDoc _, ReadDetailLevel detail) => {
                BoundingBox box = found.Geometry.GetBoundingBox(accurate: true);
                ObjectProjection compact = new(
                    Id: found.Id,
                    ObjectType: found.ObjectType.ToString(),
                    ObjectRef: ProjectSceneObjectRef(found),
                    LayerIndex: None, LayerName: None, Name: None,
                    Min: None, Max: None, BoxIsValid: None,
                    IsDeleted: None, IsHidden: None, IsLocked: None,
                    IsReference: None, IsVisible: None, DisplayOrder: None,
                    MaterialIndex: None, MaterialSource: None,
                    Center: None, DiagonalLength: None, Area: None, Volume: None);
                ObjectProjection standard = compact with {
                    Min = Some(CommandExecutor.ProjectPointOrZero(box, static b => b.Min)),
                    Max = Some(CommandExecutor.ProjectPointOrZero(box, static b => b.Max)),
                    BoxIsValid = Some(box.IsValid),
                };
                ObjectProjection full = standard with {
                    Center = Some(CommandExecutor.ProjectPointOrZero(box, static b => b.Center)),
                    DiagonalLength = Some(box.IsValid ? box.Diagonal.Length : 0.0),
                    Area = Some(box.IsValid ? box.Area : 0.0),
                    Volume = Some(box.IsValid ? box.Volume : 0.0),
                };
                return SerializeProjection(detail switch {
                    ReadDetailLevel.Full => full,
                    ReadDetailLevel.Standard => standard,
                    _ => compact,
                });
            });
    internal static Fin<JsonElement> ReadObjectList(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        CommandParsers.ParseLimit(envelope.Args).Map((Option<int> limit) => {
            ObjectType typeFilter = CommandParsers.ParseObjectTypeFilter(envelope.Args);
            Option<int> layerFilter = CommandParsers.ParseOptional(envelope.Args, JsonFields.LayerIndex, CommandParsers.TryParseOptionalInt);
            Option<string> nameFilter = CommandParsers.ParseOptional(envelope.Args, JsonFields.NamePattern, CommandParsers.TryParseOptionalString);
            return JsonSerializer.SerializeToElement(new {
                objects = doc.Objects
                    .GetObjectList(typeFilter)
                    .Where((RhinoObject rhinoObject) =>
                        layerFilter.Match(
                            Some: (int idx) => rhinoObject.Attributes.LayerIndex == idx,
                            None: () => true)
                        && nameFilter.Match(
                            Some: (string pattern) => (rhinoObject.Attributes.Name ?? string.Empty).Contains(pattern, StringComparison.OrdinalIgnoreCase),
                            None: () => true))
                    .Take(limit.IfNone(CaptureDefaults.MaxReadListLimit))
                    .Select(SerializeListProjection)
                    .ToArray(),
            });
        });
    private static Fin<JsonElement> ReadObjectWith(
        RhinoDoc doc,
        CommandEnvelope envelope,
        Func<RhinoObject, RhinoDoc, ReadDetailLevel, JsonElement> project) =>
        from detail in CommandParsers.ParseDetailLevel(envelope.Args)
        from objectId in CommandExecutor.GetPrimaryObjectId(doc: doc, envelope: envelope)
        from found in CommandExecutor.FindById(doc, objectId)
        select project(found, doc, detail);
    private static JsonElement SerializeProjection(ObjectProjection projection) {
        Dictionary<string, object> props = new(StringComparer.Ordinal) {
            ["id"] = projection.Id,
            ["objectType"] = projection.ObjectType,
        };
        _ = projection.ObjectRef.IfSome((SceneObjectRefProjection v) => props["objectRef"] = new {
            objectId = v.ObjectId,
            typeTag = v.TypeTag,
        });
        _ = projection.LayerIndex.IfSome((int v) => props["layerIndex"] = v);
        _ = projection.LayerName.IfSome((string v) => props["layerName"] = v);
        _ = projection.Name.IfSome((string v) => props["name"] = v);
        _ = projection.Min.IfSome((double[] v) => props["min"] = v);
        _ = projection.Max.IfSome((double[] v) => props["max"] = v);
        _ = projection.BoxIsValid.IfSome((bool v) => props["boxIsValid"] = v);
        _ = projection.IsDeleted.IfSome((bool v) => props["isDeleted"] = v);
        _ = projection.IsHidden.IfSome((bool v) => props["isHidden"] = v);
        _ = projection.IsLocked.IfSome((bool v) => props["isLocked"] = v);
        _ = projection.IsReference.IfSome((bool v) => props["isReference"] = v);
        _ = projection.IsVisible.IfSome((bool v) => props["isVisible"] = v);
        _ = projection.DisplayOrder.IfSome((int v) => props["displayOrder"] = v);
        _ = projection.MaterialIndex.IfSome((int v) => props["materialIndex"] = v);
        _ = projection.MaterialSource.IfSome((string v) => props["materialSource"] = v);
        _ = projection.Center.IfSome((double[] v) => props["center"] = v);
        _ = projection.DiagonalLength.IfSome((double v) => props["diagonalLength"] = v);
        _ = projection.Area.IfSome((double v) => props["area"] = v);
        _ = projection.Volume.IfSome((double v) => props["volume"] = v);
        return JsonSerializer.SerializeToElement(props);
    }
    private static Dictionary<string, object> SerializeListProjection(RhinoObject rhinoObject) {
        Dictionary<string, object> projection = new(StringComparer.Ordinal) {
            ["id"] = rhinoObject.Id,
            ["objectType"] = rhinoObject.ObjectType.ToString(),
            ["layerIndex"] = rhinoObject.Attributes.LayerIndex,
            ["name"] = rhinoObject.Attributes.Name ?? string.Empty,
        };
        _ = ProjectSceneObjectRef(rhinoObject).IfSome((SceneObjectRefProjection objectRef) =>
            projection["objectRef"] = new {
                objectId = objectRef.ObjectId,
                typeTag = objectRef.TypeTag,
            });
        return projection;
    }
    private static Option<SceneObjectRefProjection> ProjectSceneObjectRef(RhinoObject rhinoObject) =>
        ResolveSceneObjectType(rhinoObject.ObjectType).Map((SceneObjectType typeTag) =>
            new SceneObjectRefProjection(
                ObjectId: rhinoObject.Id,
                TypeTag: typeTag.Key));
    internal static Option<SceneObjectType> ResolveSceneObjectType(ObjectType objectType) {
        (
            bool isPoint,
            bool isBrep,
            bool isMesh,
            bool isCurve,
            bool isSurface,
            bool isAnnotation,
            bool isInstance,
            bool isLayoutDetail
        ) = (
            (objectType & ObjectType.Point) == ObjectType.Point,
            (objectType & ObjectType.Brep) == ObjectType.Brep || (objectType & ObjectType.Extrusion) == ObjectType.Extrusion,
            (objectType & ObjectType.Mesh) == ObjectType.Mesh || (objectType & ObjectType.SubD) == ObjectType.SubD,
            (objectType & ObjectType.Curve) == ObjectType.Curve,
            (objectType & ObjectType.Surface) == ObjectType.Surface,
            (objectType & ObjectType.Annotation) == ObjectType.Annotation || (objectType & ObjectType.TextDot) == ObjectType.TextDot,
            (objectType & ObjectType.InstanceReference) == ObjectType.InstanceReference,
            (objectType & ObjectType.Detail) == ObjectType.Detail
        );
        return (isPoint, isBrep, isMesh, isCurve, isSurface, isAnnotation, isInstance, isLayoutDetail) switch {
            (true, _, _, _, _, _, _, _) => Some(SceneObjectType.Point),
            (_, true, _, _, _, _, _, _) => Some(SceneObjectType.Brep),
            (_, _, true, _, _, _, _, _) => Some(SceneObjectType.Mesh),
            (_, _, _, true, _, _, _, _) => Some(SceneObjectType.Curve),
            (_, _, _, _, true, _, _, _) => Some(SceneObjectType.Surface),
            (_, _, _, _, _, true, _, _) => Some(SceneObjectType.Annotation),
            (_, _, _, _, _, _, true, _) => Some(SceneObjectType.Instance),
            (_, _, _, _, _, _, _, true) => Some(SceneObjectType.LayoutDetail),
            _ => None,
        };
    }
}
