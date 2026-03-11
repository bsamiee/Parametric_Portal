using System;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using Rhino;
using Rhino.DocObjects;
using Rhino.Geometry;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.execution;

internal static class ObjectMutationCommands {
    internal static Fin<JsonElement> HandleObjectCreate(
        RhinoDoc doc,
        CommandEnvelope envelope) {
        using ObjectAttributes attributes = new();
        return ApplyAttributesFromPayload(
            doc: doc,
            attributes: attributes,
            payload: envelope.Payload)
        .Bind((_) => envelope.Payload.TryGetProperty(JsonFields.Point, out JsonElement pointElement) switch {
            true => CommandParsers.ParseTriple(
                element: pointElement,
                label: JsonFields.Point).Map(static (Triple point) =>
                (GeometryBase)new Point(new Point3d(point.X, point.Y, point.Z))),
            _ => envelope.Payload.TryGetProperty(JsonFields.Line, out JsonElement lineElement) switch {
                true => CommandParsers.ParseLine(lineElement).Map(static (Line line) => (GeometryBase)new LineCurve(line)),
                _ => FinFail<GeometryBase>(
                    Error.New(message: $"write.object.create requires payload.{JsonFields.Point} or payload.{JsonFields.Line}.")),
            },
        })
        .Bind((GeometryBase geometry) => {
            Guid objectId = doc.Objects.Add(
                geometry: geometry,
                attributes: attributes);
            return (objectId == Guid.Empty) switch {
                true => FinFail<JsonElement>(CommandParsers.CommandError(code: ErrorCode.UnexpectedRuntime, message: "Direct API operation 'AddObject' failed.")),
                _ => FinSucc(SerializeObjectResult(objectId: objectId, status: None)),
            };
        });
    }
    internal static Fin<JsonElement> HandleObjectDelete(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        CommandExecutor.GetPrimaryObjectId(envelope: envelope).Bind((Guid objectId) =>
            MapObjectStatus(
                operation: doc.Objects.Delete(objectId: objectId, quiet: true) switch {
                    true => FinSucc(unit),
                    false => FinFail<Unit>(CommandParsers.CommandError(code: ErrorCode.PayloadMalformed, message: $"Object {objectId} not found.")),
                },
                objectId: objectId,
                status: TextValues.Deleted));
    internal static Fin<JsonElement> HandleObjectUpdate(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        CommandExecutor.GetPrimaryObjectId(envelope: envelope).Bind((Guid objectId) =>
            CommandParsers.ResolveTransform(envelope.Payload).Match(
                Some: (Fin<TransformSpec> specFin) => specFin.Bind((TransformSpec spec) =>
                    ApplyTransform(doc: doc, objectId: objectId, xform: spec.Xform, status: spec.Status)),
                None: () => ApplyAttributeUpdate(doc: doc, objectId: objectId, payload: envelope.Payload)));
    private static Fin<JsonElement> ApplyTransform(
        RhinoDoc doc,
        Guid objectId,
        Transform xform,
        string status) =>
        MapObjectStatus(
            operation: (doc.Objects.Transform(
                objectId: objectId,
                xform: xform,
                deleteOriginal: true) == Guid.Empty) switch {
                    true => FinFail<Unit>(CommandParsers.CommandError(code: ErrorCode.PayloadMalformed, message: $"Object {objectId} not found.")),
                    false => FinSucc(unit),
                },
            objectId: objectId,
            status: status);
    private static Fin<JsonElement> ApplyAttributeUpdate(
        RhinoDoc doc,
        Guid objectId,
        JsonElement payload) =>
        CommandExecutor.FindById(doc: doc, objectId: objectId).Bind((RhinoObject found) => {
            using ObjectAttributes attributes = found.Attributes.Duplicate();
            return ApplyAttributesFromPayload(doc: doc, attributes: attributes, payload: payload)
                .Bind((_) => MapObjectStatus(
                    operation: doc.Objects.ModifyAttributes(objectId: objectId, newAttributes: attributes, quiet: true) switch {
                        true => FinSucc(unit),
                        false => FinFail<Unit>(CommandParsers.CommandError(code: ErrorCode.PayloadMalformed, message: $"Object {objectId} not found.")),
                    },
                    objectId: objectId,
                    status: TextValues.AttributesModified));
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
    internal static JsonElement SerializeObjectResult(Guid objectId, Option<string> status) =>
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
}
