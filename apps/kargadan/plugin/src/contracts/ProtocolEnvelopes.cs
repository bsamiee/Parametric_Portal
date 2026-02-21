using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using NodaTime;
using Thinktecture;

namespace ParametricPortal.Kargadan.Plugin.src.contracts;

// --- [ENVELOPES] -------------------------------------------------------------

public sealed record CommandErrorEnvelope(FailureReason Reason, Option<JsonElement> Details);

public sealed record CommandEnvelope(
    EnvelopeIdentity Identity,
    CommandOperation Operation,
    Seq<SceneObjectRef> ObjectRefs,
    Option<IdempotencyToken> Idempotency,
    Option<UndoScope> UndoScope,
    JsonElement Payload,
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
    public int SourceRevision { get; }
    public Option<RequestId> CausationRequestId { get; }
    public JsonElement Delta { get; }
    public TelemetryContext TelemetryContext { get; }

    // --- [LIFECYCLE] ----------------------------------------------------------

    private EventEnvelope(
        EventId eventId,
        EventType eventType,
        EnvelopeIdentity identity,
        int sourceRevision,
        Option<RequestId> causationRequestId,
        JsonElement delta,
        TelemetryContext telemetryContext) {
        EventId = eventId;
        EventType = eventType;
        Identity = identity;
        SourceRevision = sourceRevision;
        CausationRequestId = causationRequestId;
        Delta = delta;
        TelemetryContext = telemetryContext;
    }

    // --- [FACTORIES] ----------------------------------------------------------

    public static Fin<EventEnvelope> Create(
        EventId eventId,
        EventType eventType,
        EnvelopeIdentity identity,
        int sourceRevision,
        Option<RequestId> causationRequestId,
        JsonElement delta,
        TelemetryContext telemetryContext) =>
        (sourceRevision < 0) switch {
            true => Fin.Fail<EventEnvelope>(Error.New(message: "SourceRevision must be non-negative.")),
            false => Fin.Succ(new EventEnvelope(
                eventId: eventId,
                eventType: eventType,
                identity: identity,
                sourceRevision: sourceRevision,
                causationRequestId: causationRequestId,
                delta: delta,
                telemetryContext: telemetryContext))
        };
}
