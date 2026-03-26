using System;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using LanguageExt;
using LanguageExt.Common;
using NodaTime;
using Thinktecture;

namespace ParametricPortal.Kargadan.Plugin.src.contracts;

// --- [ENVELOPES] -------------------------------------------------------------

public sealed record CommandErrorEnvelope(FailureReason Reason, Option<JsonElement> Details);
public sealed record CommandAckEnvelope(
    [property: JsonPropertyName("_tag")] string Tag,
    Guid RequestId);
public sealed record CommandEnvelope(
    EnvelopeIdentity Identity,
    CommandOperation CommandId,
    Seq<SceneObjectRef> ObjectRefs,
    Option<IdempotencyToken> Idempotency,
    Option<UndoScope> UndoScope,
    JsonElement Args,
    TelemetryContext TelemetryContext,
    int DeadlineMs);
[Union]
public abstract partial record CommandResultEnvelope {
    private CommandResultEnvelope() { }
    public sealed record Success(
        EnvelopeIdentity Identity,
        DedupeMetadata Dedupe,
        JsonElement Result,
        ExecutionMetadata Execution,
        TelemetryContext TelemetryContext) : CommandResultEnvelope;
    public sealed record Failure(
        EnvelopeIdentity Identity,
        DedupeMetadata Dedupe,
        JsonElement Result,
        ExecutionMetadata Execution,
        CommandErrorEnvelope Error,
        TelemetryContext TelemetryContext) : CommandResultEnvelope;
}
[Union]
public abstract partial record HandshakeEnvelope {
    private HandshakeEnvelope() { }
    public sealed record Init(
        EnvelopeIdentity Identity,
        CapabilitySet Capabilities,
        AuthToken Auth,
        TelemetryContext TelemetryContext) : HandshakeEnvelope;
    public sealed record Ack(
        EnvelopeIdentity Identity,
        Seq<string> AcceptedCapabilities,
        ServerInfo Server,
        Seq<CommandCatalogEntry> Catalog,
        TelemetryContext TelemetryContext) : HandshakeEnvelope;
    public sealed record Reject(
        EnvelopeIdentity Identity,
        FailureReason Reason,
        TelemetryContext TelemetryContext) : HandshakeEnvelope;
}
public sealed record HeartbeatEnvelope(
    EnvelopeIdentity Identity,
    HeartbeatMode Mode,
    Instant ServerTime,
    TelemetryContext TelemetryContext);

// --- [EVENT_ENVELOPE] --------------------------------------------------------

public sealed record EventEnvelope {
    // --- [STATE] --------------------------------------------------------------

    public EventId EventId { get; }
    public EventType EventType { get; }
    public EnvelopeIdentity Identity { get; }
    public Option<RequestId> CausationRequestId { get; }
    public JsonElement Delta { get; }
    public TelemetryContext TelemetryContext { get; }

    // --- [LIFECYCLE] ----------------------------------------------------------

    private EventEnvelope(
        EventId eventId,
        EventType eventType,
        EnvelopeIdentity identity,
        Option<RequestId> causationRequestId,
        JsonElement delta,
        TelemetryContext telemetryContext) {
        EventId = eventId;
        EventType = eventType;
        Identity = identity;
        CausationRequestId = causationRequestId;
        Delta = delta;
        TelemetryContext = telemetryContext;
    }

    // --- [FACTORIES] ----------------------------------------------------------

    public static Fin<EventEnvelope> Create(
        EventId eventId,
        EventType eventType,
        EnvelopeIdentity identity,
        Option<RequestId> causationRequestId,
        JsonElement delta,
        TelemetryContext telemetryContext) =>
        FinSucc(new EventEnvelope(
            eventId: eventId,
            eventType: eventType,
            identity: identity,
            causationRequestId: causationRequestId,
            delta: delta,
            telemetryContext: telemetryContext));
}

internal static class TransportJson {
    private const string CommandAckTag = "command.ack";
    private const string EventTag = "event";
    private const string HandshakeAckTag = "handshake.ack";
    private const string HandshakeRejectTag = "handshake.reject";
    private const string ResultTag = "result";
    internal static JsonElement CommandAck(CommandEnvelope envelope, JsonSerializerOptions options) =>
        JsonSerializer.SerializeToElement(new {
            _tag = CommandAckTag,
            appId = (Guid)envelope.Identity.AppId,
            correlationId = ((Guid)envelope.Identity.RunId).ToString("N"),
            requestId = (Guid)envelope.Identity.RequestId,
            sessionId = (Guid)envelope.Identity.SessionId,
        }, options);
    internal static JsonElement Event(EventEnvelope envelope, JsonSerializerOptions options) =>
        envelope.CausationRequestId.Match(
            Some: (RequestId causationRequestId) => JsonSerializer.SerializeToElement(new {
                _tag = EventTag,
                appId = (Guid)envelope.Identity.AppId,
                causationRequestId = (Guid)causationRequestId,
                correlationId = ((Guid)envelope.Identity.RunId).ToString("N"),
                delta = envelope.Delta,
                eventId = (Guid)envelope.EventId,
                eventType = envelope.EventType.Key,
                requestId = (Guid)envelope.Identity.RequestId,
                sessionId = (Guid)envelope.Identity.SessionId,
            }, options),
            None: () => JsonSerializer.SerializeToElement(new {
                _tag = EventTag,
                appId = (Guid)envelope.Identity.AppId,
                correlationId = ((Guid)envelope.Identity.RunId).ToString("N"),
                delta = envelope.Delta,
                eventId = (Guid)envelope.EventId,
                eventType = envelope.EventType.Key,
                requestId = (Guid)envelope.Identity.RequestId,
                sessionId = (Guid)envelope.Identity.SessionId,
            }, options));
    internal static JsonElement Response(CommandResultEnvelope envelope, JsonSerializerOptions options) =>
        envelope switch {
            CommandResultEnvelope.Success success => JsonSerializer.SerializeToElement(new {
                _tag = ResultTag,
                appId = (Guid)success.Identity.AppId,
                correlationId = ((Guid)success.Identity.RunId).ToString("N"),
                execution = new { durationMs = success.Execution.DurationMs, pluginRevision = (string)success.Execution.PluginRevision },
                dedupe = new { decision = success.Dedupe.Decision.Key, originalRequestId = (Guid)success.Dedupe.OriginalRequestId },
                requestId = (Guid)success.Identity.RequestId,
                result = success.Result,
                sessionId = (Guid)success.Identity.SessionId,
                status = CommandResultStatus.Ok.Key,
            }, options),
            CommandResultEnvelope.Failure failure => failure.Error.Details.Match(
                Some: details => JsonSerializer.SerializeToElement(new {
                    _tag = ResultTag,
                    appId = (Guid)failure.Identity.AppId,
                    correlationId = ((Guid)failure.Identity.RunId).ToString("N"),
                    execution = new { durationMs = failure.Execution.DurationMs, pluginRevision = (string)failure.Execution.PluginRevision },
                    dedupe = new { decision = failure.Dedupe.Decision.Key, originalRequestId = (Guid)failure.Dedupe.OriginalRequestId },
                    error = new { code = failure.Error.Reason.Code.Key, details, failureClass = failure.Error.Reason.FailureClass.Key, message = failure.Error.Reason.Message },
                    requestId = (Guid)failure.Identity.RequestId,
                    result = failure.Result,
                    sessionId = (Guid)failure.Identity.SessionId,
                    status = CommandResultStatus.Error.Key,
                }, options),
                None: () => JsonSerializer.SerializeToElement(new {
                    _tag = ResultTag,
                    appId = (Guid)failure.Identity.AppId,
                    correlationId = ((Guid)failure.Identity.RunId).ToString("N"),
                    execution = new { durationMs = failure.Execution.DurationMs, pluginRevision = (string)failure.Execution.PluginRevision },
                    dedupe = new { decision = failure.Dedupe.Decision.Key, originalRequestId = (Guid)failure.Dedupe.OriginalRequestId },
                    error = new { code = failure.Error.Reason.Code.Key, failureClass = failure.Error.Reason.FailureClass.Key, message = failure.Error.Reason.Message },
                    requestId = (Guid)failure.Identity.RequestId,
                    result = failure.Result,
                    sessionId = (Guid)failure.Identity.SessionId,
                    status = CommandResultStatus.Error.Key,
                }, options)),
            _ => throw new InvalidOperationException($"Exhaustive match failure: unexpected {envelope.GetType().Name} variant in CommandResultEnvelope."),
        };
    internal static JsonElement Response(HandshakeEnvelope envelope, JsonSerializerOptions options) =>
        envelope switch {
            HandshakeEnvelope.Ack ack => JsonSerializer.SerializeToElement(new {
                _tag = HandshakeAckTag,
                acceptedCapabilities = ack.AcceptedCapabilities.ToArray(),
                appId = (Guid)ack.Identity.AppId,
                catalog = ack.Catalog.Map(entry => CatalogEntry(entry, options)).ToArray(),
                correlationId = ((Guid)ack.Identity.RunId).ToString("N"),
                requestId = (Guid)ack.Identity.RequestId,
                server = new {
                    pluginRevision = (string)ack.Server.PluginRevision,
                    rhinoVersion = (string)ack.Server.RhinoVersion,
                },
                sessionId = (Guid)ack.Identity.SessionId,
                telemetryContext = Telemetry(ack.TelemetryContext, options),
            }, options),
            HandshakeEnvelope.Reject reject => JsonSerializer.SerializeToElement(new {
                _tag = HandshakeRejectTag,
                appId = (Guid)reject.Identity.AppId,
                code = reject.Reason.Code.Key,
                correlationId = ((Guid)reject.Identity.RunId).ToString("N"),
                failureClass = reject.Reason.FailureClass.Key,
                message = reject.Reason.Message,
                requestId = (Guid)reject.Identity.RequestId,
                sessionId = (Guid)reject.Identity.SessionId,
                telemetryContext = Telemetry(reject.TelemetryContext, options),
            }, options),
            _ => throw new InvalidOperationException($"Exhaustive match failure: unexpected {envelope.GetType().Name} variant in HandshakeEnvelope response serialization."),
        };
    internal static JsonElement Response(HeartbeatEnvelope envelope, JsonSerializerOptions options) =>
        JsonSerializer.SerializeToElement(new {
            _tag = TransportMessageTag.Heartbeat.Key,
            appId = (Guid)envelope.Identity.AppId,
            correlationId = ((Guid)envelope.Identity.RunId).ToString("N"),
            mode = envelope.Mode.Key,
            requestId = (Guid)envelope.Identity.RequestId,
            sessionId = (Guid)envelope.Identity.SessionId,
        }, options);
    private static JsonElement CatalogEntry(CommandCatalogEntry entry, JsonSerializerOptions options) =>
        JsonSerializer.SerializeToElement(new {
            aliases = entry.Aliases.ToArray(),
            category = entry.Category,
            description = entry.Description,
            dispatch = new { mode = entry.Dispatch.Mode.Key },
            examples = entry.Examples.Map(example => new { description = example.Description, input = example.Input }).ToArray(),
            id = entry.Id,
            isDestructive = entry.IsDestructive,
            name = entry.Name,
            @params = entry.Params.Map(parameter => new {
                description = parameter.Description,
                name = parameter.Name,
                required = parameter.Required,
                type = parameter.Type,
            }).ToArray(),
            requirements = new {
                minimumObjectRefCount = entry.Requirements.MinimumObjectRefCount,
                requiresObjectRefs = entry.Requirements.RequiresObjectRefs,
                requiresTelemetryContext = entry.Requirements.RequiresTelemetryContext,
            },
        }, options);
    private static JsonElement Telemetry(TelemetryContext context, JsonSerializerOptions options) =>
        JsonSerializer.SerializeToElement(new {
            attempt = context.Attempt,
            operationTag = (string)context.OperationTag,
            spanId = (string)context.SpanId,
            traceId = (string)context.TraceId,
        }, options);
}
