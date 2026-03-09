using System;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using NodaTime;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using ParametricPortal.Kargadan.Plugin.src.execution;
using static LanguageExt.Prelude;
namespace ParametricPortal.Kargadan.Plugin.src.protocol;

internal static class CommandRouter {
    private static readonly JsonElement EmptyJsonElement = JsonSerializer.SerializeToElement(new { });
    private const int MinimumDeadlineMs = 1;
    private static class JsonFields {
        internal const string AppId = "appId";
        internal const string Tag = "_tag";
        internal const string CorrelationId = "correlationId";
        internal const string Operation = "operation";
        internal const string CommandId = "commandId";
        internal const string DeadlineMs = "deadlineMs";
        internal const string Payload = "payload";
        internal const string Args = "args";
        internal const string RequestId = "requestId";
        internal const string SessionId = "sessionId";
        internal const string ProtocolVersion = "protocolVersion";
        internal const string Major = "major";
        internal const string Minor = "minor";
        internal const string Capabilities = "capabilities";
        internal const string Required = "required";
        internal const string Optional = "optional";
        internal const string Auth = "auth";
        internal const string Mode = "mode";
        internal const string Token = "token";
        internal const string TokenExpiresAt = "tokenExpiresAt";
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
    internal static Fin<CommandEnvelope> Decode(
        JsonElement envelope,
        EnvelopeIdentity sessionIdentity) =>
        EnsureEnvelopeObject(envelope: envelope).Bind((JsonElement commandEnvelope) =>
            EnsureCommandTag(envelope: commandEnvelope).Bind((_) =>
                DecodeCommandEnvelope(
                    envelope: commandEnvelope,
                    sessionIdentity: sessionIdentity)));
    internal static Fin<HandshakeEnvelope.Init> DecodeHandshake(
        JsonElement envelope,
        Instant now) =>
        EnsureEnvelopeObject(envelope: envelope).Bind((JsonElement handshakeEnvelope) =>
            EnsureEnvelopeTag(
                envelope: handshakeEnvelope,
                expectedTag: TransportMessageTag.HandshakeInit).Bind((_) =>
                    from protocolVersion in DecodeProtocolVersion(handshakeEnvelope)
                    from identity in DecodeIdentity(handshakeEnvelope, protocolVersion, now)
                    from capabilities in DecodeCapabilities(handshakeEnvelope)
                    from auth in DecodeAuthToken(handshakeEnvelope, now)
                    from telemetryContext in DecodeTelemetryContext(handshakeEnvelope)
                    select new HandshakeEnvelope.Init(
                        Identity: identity,
                        Capabilities: capabilities,
                        Auth: auth,
                        TelemetryContext: telemetryContext)));
    internal static Fin<HeartbeatEnvelope> DecodeHeartbeat(
        JsonElement envelope,
        ProtocolVersion protocolVersion,
        Instant now) =>
        EnsureEnvelopeObject(envelope: envelope).Bind((JsonElement heartbeatEnvelope) =>
            EnsureEnvelopeTag(
                envelope: heartbeatEnvelope,
                expectedTag: TransportMessageTag.Heartbeat).Bind((_) =>
                    from identity in DecodeIdentity(heartbeatEnvelope, protocolVersion, now)
                    from modeRaw in RequireStringProperty(
                        parent: heartbeatEnvelope,
                        propertyName: JsonFields.Mode,
                        errorMessage: "mode must be a string on heartbeat envelopes.")
                    from mode in DomainBridge.ParseSmartEnum<HeartbeatMode, string>(candidate: modeRaw)
                    from telemetryContext in BuildTransportTelemetry(
                        identity: identity,
                        operationTagRaw: $"heartbeat.{mode.Key}")
                    select new HeartbeatEnvelope(
                        Identity: identity,
                        Mode: mode,
                        ServerTime: now,
                        TelemetryContext: telemetryContext)));
    private static Fin<JsonElement> EnsureEnvelopeObject(JsonElement envelope) =>
        envelope.ValueKind switch {
            JsonValueKind.Object => FinSucc(envelope),
            _ => FinFail<JsonElement>(
                Error.New(message: $"Envelope root must be an object; observed {envelope.ValueKind}.")),
        };
    private static Fin<Unit> EnsureEnvelopeTag(
        JsonElement envelope,
        TransportMessageTag expectedTag) =>
        from tagRaw in RequireStringProperty(
            parent: envelope,
            propertyName: JsonFields.Tag,
            errorMessage: $"Envelope {JsonFields.Tag} must be '{expectedTag.Key}'.")
        from tag in DomainBridge.ParseSmartEnum<TransportMessageTag, string>(candidate: tagRaw)
            .BiMap(
                Succ: static t => t,
                Fail: _ => Error.New(message: $"Envelope {JsonFields.Tag} must be '{expectedTag.Key}'."))
        from _ in tag.Equals(expectedTag)
            ? FinSucc(unit)
            : FinFail<Unit>(Error.New(message: $"Envelope {JsonFields.Tag} must be '{expectedTag.Key}'; observed '{tag.Key}'."))
        select unit;
    private static Fin<Unit> EnsureCommandTag(JsonElement envelope) =>
        EnsureEnvelopeTag(
            envelope: envelope,
            expectedTag: TransportMessageTag.Command);
    private static Fin<CommandEnvelope> DecodeCommandEnvelope(
        JsonElement envelope,
        EnvelopeIdentity sessionIdentity) =>
        from requestIdRaw in RequireStringProperty(
            parent: envelope,
            propertyName: JsonFields.RequestId,
            errorMessage: "requestId must be a GUID string on command envelopes.")
        from requestIdGuid in DecodeGuid(requestIdRaw, "requestId must be a valid GUID.")
        from requestId in DomainBridge.ParseValueObject<RequestId, Guid>(candidate: requestIdGuid)
        from operation in DecodeOperation(envelope: envelope)
        from deadlineMs in DecodeDeadlineMs(
            envelope: envelope,
            operation: operation)
        from payload in DecodePayload(envelope: envelope)
        from objectRefs in DecodeObjectRefs(envelope: envelope)
        from idempotency in DecodeIdempotency(envelope: envelope)
        from undoScope in DecodeUndoScope(envelope: envelope)
        from telemetryContext in DecodeTelemetryContext(envelope: envelope)
        select new CommandEnvelope(
            Identity: sessionIdentity with { RequestId = requestId },
            Operation: operation,
            ObjectRefs: objectRefs,
            Idempotency: idempotency,
            UndoScope: undoScope,
            Payload: payload,
            TelemetryContext: telemetryContext,
            DeadlineMs: deadlineMs);
    private static Fin<CommandOperation> DecodeOperation(JsonElement envelope) =>
        from operationKey in DecodeOperationKey(envelope: envelope)
        from operation in DomainBridge.ParseSmartEnum<CommandOperation, string>(
            candidate: operationKey)
            .BiMap(
                Succ: static (CommandOperation operation) => operation,
                Fail: (Error _) => Error.New(
                    message: $"Unsupported operation '{operationKey}' on command envelope."))
        from supportedOperation in CommandExecutor.Supports(operation) switch {
            true => FinSucc(operation),
            _ => FinFail<CommandOperation>(Error.New(message: $"Operation '{operationKey}' is not enabled in the current command route table.")),
        }
        select supportedOperation;
    private static Fin<EnvelopeIdentity> DecodeIdentity(
        JsonElement envelope,
        ProtocolVersion protocolVersion,
        Instant now) =>
        from appIdRaw in RequireStringProperty(
            parent: envelope,
            propertyName: JsonFields.AppId,
            errorMessage: "appId must be a GUID string.")
        from correlationIdRaw in RequireStringProperty(
            parent: envelope,
            propertyName: JsonFields.CorrelationId,
            errorMessage: "correlationId must be a GUID string.")
        from requestIdRaw in RequireStringProperty(
            parent: envelope,
            propertyName: JsonFields.RequestId,
            errorMessage: "requestId must be a GUID string.")
        from sessionIdRaw in RequireStringProperty(
            parent: envelope,
            propertyName: JsonFields.SessionId,
            errorMessage: "sessionId must be a GUID string.")
        from appIdGuid in DecodeGuid(appIdRaw, "appId must be a valid GUID.")
        from correlationIdGuid in DecodeGuid(correlationIdRaw, "correlationId must be a valid GUID or 32-hex string.")
        from requestIdGuid in DecodeGuid(requestIdRaw, "requestId must be a valid GUID.")
        from sessionIdGuid in DecodeGuid(sessionIdRaw, "sessionId must be a valid GUID.")
        from appId in DomainBridge.ParseValueObject<AppId, Guid>(candidate: appIdGuid)
        from runId in DomainBridge.ParseValueObject<RunId, Guid>(candidate: correlationIdGuid)
        from sessionId in DomainBridge.ParseValueObject<SessionId, Guid>(candidate: sessionIdGuid)
        from requestId in DomainBridge.ParseValueObject<RequestId, Guid>(candidate: requestIdGuid)
        select new EnvelopeIdentity(
            AppId: appId,
            RunId: runId,
            SessionId: sessionId,
            RequestId: requestId,
            IssuedAt: now,
            ProtocolVersion: protocolVersion);
    private static Fin<ProtocolVersion> DecodeProtocolVersion(JsonElement envelope) =>
        from protocolVersionElement in RequireObjectProperty(
            parent: envelope,
            propertyName: JsonFields.ProtocolVersion,
            missingMessage: "protocolVersion must be provided on handshake envelopes.",
            invalidMessage: "protocolVersion must be an object when provided.")
        from major in RequireInt32Property(
            parent: protocolVersionElement,
            propertyName: JsonFields.Major,
            errorMessage: "protocolVersion.major must be an integer.")
        from minor in RequireInt32Property(
            parent: protocolVersionElement,
            propertyName: JsonFields.Minor,
            errorMessage: "protocolVersion.minor must be an integer.")
        from protocolVersion in ProtocolVersion.Create(
            major: major,
            minor: minor).Match(
                Succ: FinSucc,
                Fail: errors => FinFail<ProtocolVersion>(errors.HeadOrNone().IfNone(
                    Error.New(message: "protocolVersion is invalid."))))
        select protocolVersion;
    private static Fin<CapabilitySet> DecodeCapabilities(JsonElement envelope) =>
        from capabilitiesElement in RequireObjectProperty(
            parent: envelope,
            propertyName: JsonFields.Capabilities,
            missingMessage: "capabilities must be provided on handshake envelopes.",
            invalidMessage: "capabilities must be an object when provided.")
        from required in ReadStringArrayProperty(
            parent: capabilitiesElement,
            propertyName: JsonFields.Required,
            errorMessage: "capabilities.required must be an array of strings when provided.")
        from optional in ReadStringArrayProperty(
            parent: capabilitiesElement,
            propertyName: JsonFields.Optional,
            errorMessage: "capabilities.optional must be an array of strings when provided.")
        select new CapabilitySet(
            Required: required,
            Optional: optional);
    private static Fin<AuthToken> DecodeAuthToken(
        JsonElement envelope,
        Instant now) =>
        from authElement in RequireObjectProperty(
            parent: envelope,
            propertyName: JsonFields.Auth,
            missingMessage: "auth must be provided on handshake envelopes.",
            invalidMessage: "auth must be an object when provided.")
        from tokenRaw in RequireStringProperty(
            parent: authElement,
            propertyName: JsonFields.Token,
            errorMessage: "auth.token must be a string.")
        from expiresAtRaw in RequireStringProperty(
            parent: authElement,
            propertyName: JsonFields.TokenExpiresAt,
            errorMessage: "auth.tokenExpiresAt must be an ISO datetime string.")
        from token in DomainBridge.ParseValueObject<TokenValue, string>(candidate: tokenRaw)
        from expiresAt in DateTimeOffset.TryParse(
            input: expiresAtRaw,
            formatProvider: System.Globalization.CultureInfo.InvariantCulture,
            styles: System.Globalization.DateTimeStyles.RoundtripKind,
            result: out DateTimeOffset parsedExpiresAt)
            ? FinSucc(Instant.FromDateTimeOffset(parsedExpiresAt))
            : FinFail<Instant>(Error.New(message: "auth.tokenExpiresAt must be a valid ISO datetime string."))
        from auth in AuthToken.Create(
            token: token,
            issuedAt: now,
            expiresAt: expiresAt)
        select auth;
    private static Fin<TelemetryContext> BuildTransportTelemetry(
        EnvelopeIdentity identity,
        string operationTagRaw) =>
        from traceId in DomainBridge.ParseValueObject<TraceId, string>(((Guid)identity.RunId).ToString("N"))
        from spanId in DomainBridge.ParseValueObject<SpanId, string>(((Guid)identity.RequestId).ToString("N")[..16])
        from operationTag in DomainBridge.ParseValueObject<OperationTag, string>(candidate: operationTagRaw)
        from context in TelemetryContext.Create(
            traceId: traceId,
            spanId: spanId,
            operationTag: operationTag,
            attempt: 1)
        select context;
    private static Fin<string> DecodeOperationKey(JsonElement envelope) =>
        (cmdId: ReadOptionalString(parent: envelope, propertyName: JsonFields.CommandId),
         legacy: ReadOptionalString(parent: envelope, propertyName: JsonFields.Operation)) switch {
             ( { IsSome: true } cmd, { IsSome: true } leg) when string.Equals((string)cmd, (string)leg, StringComparison.Ordinal) =>
                 FinSucc((string)cmd),
             ( { IsSome: true }, { IsSome: true } leg) =>
                 FinFail<string>(Error.New(
                     message: $"Envelope command identity mismatch: '{JsonFields.CommandId}' and '{JsonFields.Operation}'='{(string)leg}'.")),
             ( { IsSome: true } cmd, _) => FinSucc((string)cmd),
             (_, { IsSome: true } leg) => FinSucc((string)leg),
             _ => FinFail<string>(Error.New(
                 message: $"Command envelope must include '{JsonFields.CommandId}' (preferred) or '{JsonFields.Operation}'.")),
         };
    private static Fin<int> DecodeDeadlineMs(
        JsonElement envelope,
        CommandOperation operation) =>
        envelope.TryGetProperty(JsonFields.DeadlineMs, out JsonElement deadlineElement) switch {
            false => FinSucc(operation.Category.DefaultDeadlineMs),
            true when deadlineElement.TryGetInt32(out int parsedDeadlineMs) =>
                FinSucc(Math.Max(MinimumDeadlineMs, parsedDeadlineMs)),
            true => FinFail<int>(Error.New(message: "deadlineMs must be an integer when provided.")),
        };
    private static Fin<JsonElement> DecodePayload(JsonElement envelope) {
        bool hasArgs = envelope.TryGetProperty(JsonFields.Args, out JsonElement argsElement);
        bool hasPayload = envelope.TryGetProperty(JsonFields.Payload, out JsonElement payloadElement);
        return (hasArgs, hasPayload) switch {
            (true, true) when !JsonElement.DeepEquals(argsElement, payloadElement) =>
                FinFail<JsonElement>(Error.New(
                    message: $"Envelope contains both '{JsonFields.Args}' and '{JsonFields.Payload}' with different values.")),
            (true, _) => EnsurePayloadObject(
                payload: argsElement,
                source: JsonFields.Args),
            (false, true) => EnsurePayloadObject(
                payload: payloadElement,
                source: JsonFields.Payload),
            _ => FinSucc(EmptyJsonElement),
        };
    }
    private static Fin<JsonElement> EnsurePayloadObject(
        JsonElement payload,
        string source) =>
        payload.ValueKind switch {
            JsonValueKind.Object => FinSucc(payload),
            _ => FinFail<JsonElement>(Error.New(
                message: $"Envelope '{source}' must be an object when provided.")),
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
            false => FinSucc<Option<IdempotencyToken>>(None),
            true when idempotencyElement.ValueKind != JsonValueKind.Object =>
                FinFail<Option<IdempotencyToken>>(Error.New(message: "idempotency must be an object when provided.")),
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
            false => FinSucc(Seq<SceneObjectRef>()),
            true when objectRefsElement.ValueKind == JsonValueKind.Array =>
                toSeq(objectRefsElement.EnumerateArray()).Map(DecodeSceneObjectRef).Sequence(),
            _ => FinFail<Seq<SceneObjectRef>>(Error.New(message: "objectRefs must be an array when provided.")),
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
                    true => FinSucc(parsedObjectId),
                    _ => FinFail<Guid>(Error.New(message: "objectId must be a valid GUID.")),
                }
                from objectId in DomainBridge.ParseValueObject<ObjectId, Guid>(candidate: objectIdGuid)
                from typeTag in DomainBridge.ParseSmartEnum<SceneObjectType, string>(candidate: typeTagRaw)
                from sceneObjectRef in SceneObjectRef.Create(
                    objectId: objectId,
                    sourceRevision: sourceRevision,
                    typeTag: typeTag)
                select sceneObjectRef,
            _ => FinFail<SceneObjectRef>(Error.New(message: "objectRefs entries must be objects.")),
        };
    private static Fin<Option<UndoScope>> DecodeUndoScope(JsonElement envelope) =>
        envelope.TryGetProperty(JsonFields.UndoScope, out JsonElement undoScopeElement) switch {
            false => FinSucc<Option<UndoScope>>(None),
            true when undoScopeElement.ValueKind == JsonValueKind.String =>
                from undoScope in DomainBridge.ParseValueObject<UndoScope, string>(
                    candidate: undoScopeElement.GetString() ?? string.Empty)
                select Some(undoScope),
            true => FinFail<Option<UndoScope>>(Error.New(message: "undoScope must be a string when provided.")),
        };
    private static Fin<JsonElement> RequireObjectProperty(
        JsonElement parent,
        string propertyName,
        string missingMessage,
        string invalidMessage) =>
        parent.TryGetProperty(propertyName, out JsonElement propertyElement) switch {
            false => FinFail<JsonElement>(Error.New(message: missingMessage)),
            true when propertyElement.ValueKind != JsonValueKind.Object =>
                FinFail<JsonElement>(Error.New(message: invalidMessage)),
            _ => FinSucc(propertyElement),
        };
    private static Fin<string> RequireStringProperty(
        JsonElement parent,
        string propertyName,
        string errorMessage) =>
        parent.TryGetProperty(propertyName, out JsonElement propertyElement) switch {
            true when propertyElement.ValueKind == JsonValueKind.String =>
                FinSucc((propertyElement.GetString() ?? string.Empty).Trim()),
            _ => FinFail<string>(Error.New(message: errorMessage)),
        };
    private static Fin<Seq<string>> ReadStringArrayProperty(
        JsonElement parent,
        string propertyName,
        string errorMessage) =>
        parent.TryGetProperty(propertyName, out JsonElement propertyElement) switch {
            false => FinSucc(Seq<string>()),
            true when propertyElement.ValueKind == JsonValueKind.Array =>
                toSeq(propertyElement.EnumerateArray()).Map((JsonElement element) =>
                    element.ValueKind switch {
                        JsonValueKind.String => FinSucc((element.GetString() ?? string.Empty).Trim()),
                        _ => FinFail<string>(Error.New(message: errorMessage)),
                    }).Sequence().Map(values => values.Filter(value => !string.IsNullOrWhiteSpace(value))),
            _ => FinFail<Seq<string>>(Error.New(message: errorMessage)),
        };
    private static Fin<int> RequireInt32Property(
        JsonElement parent,
        string propertyName,
        string errorMessage) =>
        parent.TryGetProperty(propertyName, out JsonElement propertyElement) switch {
            true when propertyElement.TryGetInt32(out int propertyValue) => FinSucc(propertyValue),
            _ => FinFail<int>(Error.New(message: errorMessage)),
        };
    private static Fin<Guid> DecodeGuid(
        string raw,
        string errorMessage) =>
        Guid.TryParse(raw, out Guid value) switch {
            true => FinSucc(value),
            _ => FinFail<Guid>(Error.New(message: errorMessage)),
        };
    private static Option<string> ReadOptionalString(
        JsonElement parent,
        string propertyName) =>
        parent.TryGetProperty(propertyName, out JsonElement propertyElement) switch {
            true when propertyElement.ValueKind == JsonValueKind.String =>
                Optional((propertyElement.GetString() ?? string.Empty).Trim())
                    .Filter(static value => value.Length > 0),
            _ => None,
        };
}
