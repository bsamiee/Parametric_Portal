using System;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.protocol;

public static class CommandRouter {
    private static readonly JsonElement EmptyJsonElement = JsonSerializer.SerializeToElement(new { });
    private const int DefaultDeadlineMs = 5_000;
    private const int MinimumDeadlineMs = 1;

    private static class JsonFields {
        internal const string Tag = "_tag";
        internal const string Operation = "operation";
        internal const string DeadlineMs = "deadlineMs";
        internal const string Payload = "payload";
        internal const string Idempotency = "idempotency";
        internal const string IdempotencyKey = "idempotencyKey";
        internal const string PayloadHash = "payloadHash";
        internal const string ObjectRefs = "objectRefs";
        internal const string ObjectId = "objectId";
        internal const string TypeTag = "typeTag";
        internal const string SourceRevision = "sourceRevision";
        internal const string UndoScope = "undoScope";
        internal const string TelemetryContext = "telemetryContext";
        internal const string Attempt = "attempt";
        internal const string OperationTag = "operationTag";
        internal const string SpanId = "spanId";
        internal const string TraceId = "traceId";
    }

    public static Fin<CommandEnvelope> Decode(
        JsonElement envelope,
        EnvelopeIdentity sessionIdentity) =>
        EnsureEnvelopeObject(envelope: envelope).Bind((JsonElement commandEnvelope) =>
            EnsureCommandTag(envelope: commandEnvelope).Bind((_) =>
                DecodeCommandEnvelope(
                    envelope: commandEnvelope,
                    sessionIdentity: sessionIdentity)));

    private static Fin<JsonElement> EnsureEnvelopeObject(JsonElement envelope) =>
        envelope.ValueKind switch {
            JsonValueKind.Object => Fin.Succ(envelope),
            _ => Fin.Fail<JsonElement>(
                Error.New(message: $"Envelope root must be an object; observed {envelope.ValueKind}.")),
        };

    private static Fin<Unit> EnsureCommandTag(JsonElement envelope) =>
        envelope.TryGetProperty(JsonFields.Tag, out JsonElement tagElement) switch {
            false => Fin.Fail<Unit>(
                Error.New(message: $"Envelope {JsonFields.Tag} must be 'command'; observed '<missing>'.")),
            true when tagElement.ValueKind != JsonValueKind.String =>
                Fin.Fail<Unit>(
                    Error.New(message: $"Envelope {JsonFields.Tag} must be 'command'; observed '<{tagElement.ValueKind}>'.")),
            true =>
                DomainBridge.ParseSmartEnum<TransportMessageTag, string>(
                    candidate: tagElement.GetString() ?? string.Empty)
                .MapFail((Error _) => Error.New(
                    message: $"Envelope {JsonFields.Tag} must be 'command'; observed '{tagElement.GetString() ?? string.Empty}'."))
                .Bind((TransportMessageTag tag) =>
                    tag.Equals(TransportMessageTag.Command) switch {
                        true => Fin.Succ(unit),
                        _ => Fin.Fail<Unit>(
                            Error.New(message: $"Envelope {JsonFields.Tag} must be 'command'; observed '{tag.Key}'.")),
                    }),
        };

    private static Fin<CommandEnvelope> DecodeCommandEnvelope(
        JsonElement envelope,
        EnvelopeIdentity sessionIdentity) =>
        from operation in DecodeOperation(envelope: envelope)
        from deadlineMs in DecodeDeadlineMs(envelope: envelope)
        from objectRefs in DecodeObjectRefs(envelope: envelope)
        from idempotency in DecodeIdempotency(envelope: envelope)
        from undoScope in DecodeUndoScope(envelope: envelope)
        from telemetryContext in DecodeTelemetryContext(envelope: envelope)
        select new CommandEnvelope(
            Identity: sessionIdentity,
            Operation: operation,
            ObjectRefs: objectRefs,
            Idempotency: idempotency,
            UndoScope: undoScope,
            Payload: DecodePayload(envelope: envelope),
            TelemetryContext: telemetryContext,
            DeadlineMs: deadlineMs);

    private static Fin<CommandOperation> DecodeOperation(JsonElement envelope) =>
        from operationKey in RequireStringProperty(
            parent: envelope,
            propertyName: JsonFields.Operation,
            errorMessage: "Command operation field must be a string and is required.")
        from operation in DomainBridge.ParseSmartEnum<CommandOperation, string>(
            candidate: operationKey)
            .MapFail((Error _) => Error.New(
                message: $"Unsupported operation '{operationKey}' on command envelope."))
        select operation;

    private static Fin<int> DecodeDeadlineMs(JsonElement envelope) =>
        envelope.TryGetProperty(JsonFields.DeadlineMs, out JsonElement deadlineElement) switch {
            false => Fin.Succ(DefaultDeadlineMs),
            true when deadlineElement.TryGetInt32(out int parsedDeadlineMs) =>
                Fin.Succ(Math.Max(MinimumDeadlineMs, parsedDeadlineMs)),
            true => Fin.Fail<int>(Error.New(message: "deadlineMs must be an integer when provided.")),
        };

    private static JsonElement DecodePayload(JsonElement envelope) =>
        envelope.TryGetProperty(JsonFields.Payload, out JsonElement payloadElement) switch {
            true => payloadElement,
            false => EmptyJsonElement,
        };

    private static Fin<TelemetryContext> DecodeTelemetryContext(JsonElement envelope) =>
        from telemetryContextElement in RequireObjectProperty(
            parent: envelope,
            propertyName: JsonFields.TelemetryContext,
            missingMessage: "telemetryContext must be provided on command envelopes.",
            invalidMessage: "telemetryContext must be an object when provided.")
        from traceIdRaw in RequireStringProperty(
            parent: telemetryContextElement,
            propertyName: JsonFields.TraceId,
            errorMessage: "telemetryContext.traceId must be a string.")
        from spanIdRaw in RequireStringProperty(
            parent: telemetryContextElement,
            propertyName: JsonFields.SpanId,
            errorMessage: "telemetryContext.spanId must be a string.")
        from operationTagRaw in RequireStringProperty(
            parent: telemetryContextElement,
            propertyName: JsonFields.OperationTag,
            errorMessage: "telemetryContext.operationTag must be a string.")
        from attempt in RequireInt32Property(
            parent: telemetryContextElement,
            propertyName: JsonFields.Attempt,
            errorMessage: "telemetryContext.attempt must be an integer.")
        from traceId in DomainBridge.ParseValueObject<TraceId, string>(candidate: traceIdRaw)
        from spanId in DomainBridge.ParseValueObject<SpanId, string>(candidate: spanIdRaw)
        from operationTag in DomainBridge.ParseValueObject<OperationTag, string>(candidate: operationTagRaw)
        from context in TelemetryContext.Create(
            traceId: traceId,
            spanId: spanId,
            operationTag: operationTag,
            attempt: attempt)
        select context;

    private static Fin<Option<IdempotencyToken>> DecodeIdempotency(JsonElement envelope) =>
        envelope.TryGetProperty(JsonFields.Idempotency, out JsonElement idempotencyElement) switch {
            false => Fin.Succ<Option<IdempotencyToken>>(None),
            true when idempotencyElement.ValueKind != JsonValueKind.Object =>
                Fin.Fail<Option<IdempotencyToken>>(Error.New(message: "idempotency must be an object when provided.")),
            true =>
                from idempotencyKeyRaw in RequireStringProperty(
                    parent: idempotencyElement,
                    propertyName: JsonFields.IdempotencyKey,
                    errorMessage: "idempotency.idempotencyKey must be a string when idempotency is provided.")
                from payloadHashRaw in RequireStringProperty(
                    parent: idempotencyElement,
                    propertyName: JsonFields.PayloadHash,
                    errorMessage: "idempotency.payloadHash must be a string when idempotency is provided.")
                from key in DomainBridge.ParseValueObject<IdempotencyKey, string>(candidate: idempotencyKeyRaw)
                from hash in DomainBridge.ParseValueObject<PayloadHash, string>(candidate: payloadHashRaw)
                select Some(new IdempotencyToken(
                    Key: key,
                    PayloadHash: hash)),
        };

    private static Fin<Seq<SceneObjectRef>> DecodeObjectRefs(JsonElement envelope) =>
        envelope.TryGetProperty(JsonFields.ObjectRefs, out JsonElement objectRefsElement) switch {
            false => Fin.Succ(Seq<SceneObjectRef>()),
            true when objectRefsElement.ValueKind == JsonValueKind.Array =>
                toSeq(objectRefsElement.EnumerateArray())
                    .Traverse(DecodeSceneObjectRef)
                    .As(),
            _ => Fin.Fail<Seq<SceneObjectRef>>(Error.New(message: "objectRefs must be an array when provided.")),
        };

    private static Fin<SceneObjectRef> DecodeSceneObjectRef(JsonElement element) =>
        element.ValueKind switch {
            JsonValueKind.Object =>
                from objectIdRaw in RequireStringProperty(
                    parent: element,
                    propertyName: JsonFields.ObjectId,
                    errorMessage: "objectRefs entries require objectId as a string.")
                from typeTagRaw in RequireStringProperty(
                    parent: element,
                    propertyName: JsonFields.TypeTag,
                    errorMessage: "objectRefs entries require typeTag as a string.")
                from sourceRevision in RequireInt32Property(
                    parent: element,
                    propertyName: JsonFields.SourceRevision,
                    errorMessage: "objectRefs entries require sourceRevision as an integer.")
                from objectIdGuid in Guid.TryParse(objectIdRaw, out Guid parsedObjectId) switch {
                    true => Fin.Succ(parsedObjectId),
                    _ => Fin.Fail<Guid>(Error.New(message: "objectId must be a valid GUID.")),
                }
                from objectId in DomainBridge.ParseValueObject<ObjectId, Guid>(candidate: objectIdGuid)
                from typeTag in DomainBridge.ParseSmartEnum<SceneObjectType, string>(candidate: typeTagRaw)
                from sceneObjectRef in SceneObjectRef.Create(
                    objectId: objectId,
                    sourceRevision: sourceRevision,
                    typeTag: typeTag)
                select sceneObjectRef,
            _ => Fin.Fail<SceneObjectRef>(Error.New(message: "objectRefs entries must be objects.")),
        };

    private static Fin<Option<UndoScope>> DecodeUndoScope(JsonElement envelope) =>
        envelope.TryGetProperty(JsonFields.UndoScope, out JsonElement undoScopeElement) switch {
            false => Fin.Succ<Option<UndoScope>>(None),
            true when undoScopeElement.ValueKind == JsonValueKind.String =>
                from undoScope in DomainBridge.ParseValueObject<UndoScope, string>(
                    candidate: undoScopeElement.GetString() ?? string.Empty)
                select Some(undoScope),
            true => Fin.Fail<Option<UndoScope>>(Error.New(message: "undoScope must be a string when provided.")),
        };

    private static Fin<JsonElement> RequireObjectProperty(
        JsonElement parent,
        string propertyName,
        string missingMessage,
        string invalidMessage) =>
        parent.TryGetProperty(propertyName, out JsonElement propertyElement) switch {
            false => Fin.Fail<JsonElement>(Error.New(message: missingMessage)),
            true when propertyElement.ValueKind != JsonValueKind.Object =>
                Fin.Fail<JsonElement>(Error.New(message: invalidMessage)),
            _ => Fin.Succ(propertyElement),
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
}

internal static class FailureMapping {
    private readonly record struct FailureTemplate(
        ErrorCode Code,
        string Fallback);

    internal static FailureReason FromCode(ErrorCode code, string message) =>
        BuildFailure(
            code: code,
            message: message,
            fallback: code.Key);

    internal static FailureReason FromException(Exception exception) =>
        SelectTemplate(exception: exception) switch {
            FailureTemplate template => BuildFailure(
                code: template.Code,
                message: exception.Message,
                fallback: template.Fallback),
        };

    internal static Error ToError(FailureReason reason) =>
        Error.New(message: $"{reason.Code.Key}:{reason.FailureClass.Key}:{reason.Message}");

    private static FailureTemplate SelectTemplate(Exception exception) =>
        exception switch {
            JsonException => new FailureTemplate(
                Code: ErrorCode.PayloadMalformed,
                Fallback: "Invalid JSON envelope."),
            TimeoutException => new FailureTemplate(
                Code: ErrorCode.TransientIo,
                Fallback: "Operation timed out."),
            FormatException => new FailureTemplate(
                Code: ErrorCode.PayloadMalformed,
                Fallback: "Invalid formatted payload value."),
            ArgumentException => new FailureTemplate(
                Code: ErrorCode.PayloadMalformed,
                Fallback: "Invalid argument in protocol envelope."),
            InvalidOperationException => new FailureTemplate(
                Code: ErrorCode.PayloadMalformed,
                Fallback: "Invalid protocol operation."),
            _ => new FailureTemplate(
                Code: ErrorCode.UnexpectedRuntime,
                Fallback: "Unhandled transport/runtime exception."),
        };

    private static FailureReason BuildFailure(
        ErrorCode code,
        string message,
        string fallback) =>
        new(
            Code: code,
            Message: Normalize(message: message, fallback: fallback));

    private static string Normalize(string message, string fallback) =>
        Optional(message)
            .Map(static m => m.Trim())
            .Bind(static trimmed => trimmed.Length switch {
                0 => None,
                _ => Some(trimmed),
            })
            .IfNone(fallback);
}
