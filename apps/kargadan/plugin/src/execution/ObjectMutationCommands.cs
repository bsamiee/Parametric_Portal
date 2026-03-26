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
    private static Seq<AgentUndoState> _pendingAgentUndoStates = Empty;
    internal static Unit RememberUndoState(AgentUndoState undoState) {
        _pendingAgentUndoStates = Seq1(undoState).Append(
            _pendingAgentUndoStates.Filter((AgentUndoState state) => !state.RequestId.Equals(undoState.RequestId)));
        return unit;
    }
    internal static Unit TrackUndoTransition(
        AgentUndoState undoState,
        bool isUndo) {
        _pendingAgentUndoStates = isUndo switch {
            true => _pendingAgentUndoStates.Filter((AgentUndoState state) => !state.RequestId.Equals(undoState.RequestId)),
            _ => Seq1(undoState).Append(
                _pendingAgentUndoStates.Filter((AgentUndoState state) => !state.RequestId.Equals(undoState.RequestId))),
        };
        return unit;
    }
    internal static Fin<JsonElement> HandleObjectCreate(
        RhinoDoc doc,
        CommandEnvelope envelope) {
        using ObjectAttributes attributes = new();
        return ApplyAttributesFromPayload(
            doc: doc,
            attributes: attributes,
            payload: envelope.Args)
        .Bind((_) => envelope.Args.TryGetProperty(JsonFields.Point, out JsonElement pointElement) switch {
            true => CommandParsers.ParseTriple(
                element: pointElement,
                label: JsonFields.Point).Map(static (Triple point) =>
                (GeometryBase)new Point(new Point3d(point.X, point.Y, point.Z))),
            _ => envelope.Args.TryGetProperty(JsonFields.Line, out JsonElement lineElement) switch {
                true => CommandParsers.ParseLine(lineElement).Map(static (Line line) => (GeometryBase)new LineCurve(line)),
                _ => FinFail<GeometryBase>(
                    Error.New(message: $"write.object.create requires args.{JsonFields.Point} or args.{JsonFields.Line}.")),
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
        CommandExecutor.GetPrimaryObjectId(doc: doc, envelope: envelope).Bind((Guid objectId) =>
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
        CommandExecutor.GetPrimaryObjectId(doc: doc, envelope: envelope).Bind((Guid objectId) =>
            CommandParsers.ResolveTransform(envelope.Args).Match(
                Some: (Fin<TransformSpec> specFin) => specFin.Bind((TransformSpec spec) =>
                    ApplyTransform(doc: doc, objectId: objectId, xform: spec.Xform, status: spec.Status)),
                None: () => ApplyAttributeUpdate(doc: doc, objectId: objectId, payload: envelope.Args)));
    internal static Fin<JsonElement> HandleUndoExecution(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        CommandParsers.ParseGuid(envelope.Args, JsonFields.RequestId).Bind((Guid requestId) =>
            _pendingAgentUndoStates.HeadOrNone().Match(
                Some: (AgentUndoState undoState) => ((Guid)undoState.RequestId == requestId) switch {
                    true => doc.Undo() switch {
                        true => FinSucc(JsonSerializer.SerializeToElement(new {
                            requestId,
                            status = "undone",
                        })),
                        false => FinFail<JsonElement>(CommandParsers.CommandError(code: ErrorCode.UnexpectedRuntime, message: "Rhino undo failed.")),
                    },
                    false => _pendingAgentUndoStates.Exists((AgentUndoState state) => ((Guid)state.RequestId) == requestId) switch {
                        true => FinFail<JsonElement>(CommandParsers.CommandError(
                            code: ErrorCode.PayloadMalformed,
                            message: $"RequestId '{requestId}' is not the latest pending agent-owned mutation. Latest pending requestId is '{(Guid)undoState.RequestId}'.")),
                        _ => FinFail<JsonElement>(CommandParsers.CommandError(code: ErrorCode.PayloadMalformed, message: $"No pending agent-owned mutation matches requestId '{requestId}'.")),
                    },
                },
                None: () => FinFail<JsonElement>(CommandParsers.CommandError(code: ErrorCode.PayloadMalformed, message: "No agent-owned mutation is available for rollback."))));
    private static Fin<JsonElement> ApplyTransform(
        RhinoDoc doc,
        Guid objectId,
        Transform xform,
        string status) {
        Guid transformedObjectId = doc.Objects.Transform(
            objectId: objectId,
            xform: xform,
            deleteOriginal: true);
        return MapObjectStatus(
            operation: transformedObjectId == Guid.Empty
                ? FinFail<Unit>(CommandParsers.CommandError(code: ErrorCode.PayloadMalformed, message: $"Object {objectId} not found."))
                : FinSucc(unit),
            objectId: transformedObjectId,
            status: status);
    }
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
