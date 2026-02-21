// Decodes raw JsonElement into CommandEnvelope via Fin<T> combinators; routes decoded envelope to caller-supplied handler.
// All field extraction returns Fin<T> — decode failure surfaces as a Correctable protocol error, not an exception.
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.protocol;

// --- [FUNCTIONS] -------------------------------------------------------------

public static class CommandRouter {
    private static readonly JsonElement EmptyJsonElement = CreateEmptyJsonElement();
    private static JsonElement CreateEmptyJsonElement() {
        using JsonDocument document = JsonDocument.Parse("{}");
        return document.RootElement.Clone();
    }
    public static Fin<CommandResultEnvelope> Route(
        JsonElement envelope,
        EnvelopeIdentity sessionIdentity,
        TelemetryContext telemetryContext,
        Func<CommandEnvelope, Fin<CommandResultEnvelope>> onCommand) =>
        Decode(
            envelope: envelope,
            sessionIdentity: sessionIdentity,
            telemetryContext: telemetryContext).Bind(onCommand);
    public static Fin<CommandEnvelope> Decode(
        JsonElement envelope,
        EnvelopeIdentity sessionIdentity,
        TelemetryContext telemetryContext) {
        return envelope.ValueKind switch {
            JsonValueKind.Object => DecodeObject(
                envelope: envelope,
                sessionIdentity: sessionIdentity,
                telemetryContext: telemetryContext),
            _ => Fin.Fail<CommandEnvelope>(
                Error.New(message: $"Envelope root must be an object; observed {envelope.ValueKind}.")),
        };

        Fin<CommandEnvelope> DecodeObject(
            JsonElement envelope,
            EnvelopeIdentity sessionIdentity,
            TelemetryContext telemetryContext) {
            string observedTag = envelope.TryGetProperty("_tag", out JsonElement tagElement) switch {
                true when tagElement.ValueKind == JsonValueKind.String => tagElement.GetString() ?? string.Empty,
                true => $"<{tagElement.ValueKind}>",
                false => "<missing>",
            };
            Fin<string> operationKey = RequireStringProperty(
                parent: envelope,
                propertyName: "operation",
                errorMessage: "Command operation field must be a string and is required.");
            Fin<int> deadlineMs = envelope.TryGetProperty("deadlineMs", out JsonElement deadlineElement) switch {
                false => Fin.Succ(5_000),
                true when deadlineElement.TryGetInt32(out int parsedDeadlineMs) =>
                    Fin.Succ(Math.Max(1, parsedDeadlineMs)),
                true => Fin.Fail<int>(Error.New(message: "deadlineMs must be an integer when provided.")),
            };
            JsonElement payload = envelope.TryGetProperty("payload", out JsonElement payloadElement) switch {
                true => payloadElement,
                false => EmptyJsonElement,
            };
            return observedTag switch {
                "command" =>
                    from operationKeyValue in operationKey
                    from deadlineMsValue in deadlineMs
                    from operationTag in DomainBridge.ParseSmartEnum<CommandOperation, string>(operationKeyValue)
                    from objectRefs in DecodeObjectRefs(envelope)
                    from idempotency in DecodeIdempotency(envelope)
                    from undoScope in DecodeUndoScope(envelope)
                    select new CommandEnvelope(
                        Identity: sessionIdentity,
                        Operation: operationTag,
                        ObjectRefs: objectRefs,
                        Idempotency: idempotency,
                        UndoScope: undoScope,
                        Payload: payload,
                        TelemetryContext: telemetryContext,
                        DeadlineMs: deadlineMsValue),
                _ => Fin.Fail<CommandEnvelope>(
                    Error.New(message: $"Envelope _tag must be 'command'; observed '{observedTag}'.")),
            };
        }
    }
    private static Fin<Option<IdempotencyToken>> DecodeIdempotency(JsonElement envelope) =>
        envelope.TryGetProperty("idempotency", out JsonElement idempotencyElement) switch {
            false => Fin.Succ<Option<IdempotencyToken>>(None),
            true when idempotencyElement.ValueKind != JsonValueKind.Object =>
                Fin.Fail<Option<IdempotencyToken>>(Error.New(message: "idempotency must be an object when provided.")),
            true =>
                from idempotencyKeyRaw in RequireStringProperty(
                    parent: idempotencyElement,
                    propertyName: "idempotencyKey",
                    errorMessage: "idempotency.idempotencyKey must be a string when idempotency is provided.")
                from payloadHashRaw in RequireStringProperty(
                    parent: idempotencyElement,
                    propertyName: "payloadHash",
                    errorMessage: "idempotency.payloadHash must be a string when idempotency is provided.")
                from key in DomainBridge.ParseValueObject<IdempotencyKey, string>(candidate: idempotencyKeyRaw)
                from hash in DomainBridge.ParseValueObject<PayloadHash, string>(candidate: payloadHashRaw)
                select Some(
                    new IdempotencyToken(
                        Key: key,
                        PayloadHash: hash)),
        };
    private static Fin<Seq<SceneObjectRef>> DecodeObjectRefs(JsonElement envelope) {
        bool hasRefs = envelope.TryGetProperty("objectRefs", out JsonElement objectRefsElement);
        return hasRefs switch {
            false => Fin.Succ(Seq<SceneObjectRef>()),
            true => objectRefsElement.ValueKind switch {
                JsonValueKind.Array => toSeq(objectRefsElement.EnumerateArray()).Traverse(DecodeSceneObjectRef).As(),
                _ => Fin.Fail<Seq<SceneObjectRef>>(Error.New(message: "objectRefs must be an array when provided.")),
            },
        };
    }
    private static Fin<SceneObjectRef> DecodeSceneObjectRef(JsonElement element) =>
        element.ValueKind switch {
            JsonValueKind.Object =>
                from objectIdRaw in RequireStringProperty(
                    parent: element,
                    propertyName: "objectId",
                    errorMessage: "objectRefs entries require objectId as a string.")
                from typeTagRaw in RequireStringProperty(
                    parent: element,
                    propertyName: "typeTag",
                    errorMessage: "objectRefs entries require typeTag as a string.")
                from sourceRevision in RequireInt32Property(
                    parent: element,
                    propertyName: "sourceRevision",
                    errorMessage: "objectRefs entries require sourceRevision as an integer.")
                from objectId in ParseObjectId(objectIdRaw)
                from typeTag in DomainBridge.ParseSmartEnum<SceneObjectType, string>(candidate: typeTagRaw)
                from sceneObjectRef in SceneObjectRef.Create(
                    objectId: objectId,
                    sourceRevision: sourceRevision,
                    typeTag: typeTag)
                select sceneObjectRef,
            _ => Fin.Fail<SceneObjectRef>(Error.New(message: "objectRefs entries must be objects.")),
        };
    private static Fin<Option<UndoScope>> DecodeUndoScope(JsonElement envelope) =>
        envelope.TryGetProperty("undoScope", out JsonElement undoScopeElement) switch {
            false => Fin.Succ<Option<UndoScope>>(None),
            true when undoScopeElement.ValueKind == JsonValueKind.String =>
                from undoScope in DomainBridge.ParseValueObject<UndoScope, string>(
                    candidate: undoScopeElement.GetString() ?? string.Empty)
                select Some(undoScope),
            true => Fin.Fail<Option<UndoScope>>(Error.New(message: "undoScope must be a string when provided.")),
        };
    private static Fin<string> RequireStringProperty(
        JsonElement parent,
        string propertyName,
        string errorMessage) =>
        parent.TryGetProperty(propertyName, out JsonElement propertyElement) switch {
            true when propertyElement.ValueKind == JsonValueKind.String =>
                Fin.Succ(propertyElement.GetString() ?? string.Empty),
            _ => Fin.Fail<string>(Error.New(message: errorMessage)),
        };
    private static Fin<int> RequireInt32Property(
        JsonElement parent,
        string propertyName,
        string errorMessage) =>
        parent.TryGetProperty(propertyName, out JsonElement propertyElement) switch {
            true when propertyElement.TryGetInt32(out int propertyValue) => Fin.Succ(propertyValue),
            _ => Fin.Fail<int>(Error.New(message: errorMessage)),
        };
    private static Fin<ObjectId> ParseObjectId(string raw) =>
        Guid.TryParse(raw, out Guid parsedGuid) switch {
            true => DomainBridge.ParseValueObject<ObjectId, Guid>(candidate: parsedGuid),
            false => Fin.Fail<ObjectId>(Error.New(message: "objectId must be a valid GUID.")),
        };
}
