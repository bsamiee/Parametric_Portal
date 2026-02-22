// Rhino PlugIn entry point; wires EventPublisher and SessionHost in OnLoad; routes handshake and command dispatch to transport and protocol layers.
// Singleton constraint is Rhino-imposed — mutability is confined to this adapter; all internal state is Option<T> with None as the unloaded sentinel.
using System;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using NodaTime;
using ParametricPortal.CSharp.Analyzers.Contracts;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using ParametricPortal.Kargadan.Plugin.src.protocol;
using ParametricPortal.Kargadan.Plugin.src.transport;
using Rhino;
using Rhino.PlugIns;
using static LanguageExt.Prelude;
using Duration = NodaTime.Duration;

namespace ParametricPortal.Kargadan.Plugin.src.boundary;

// --- [ADAPTER] ---------------------------------------------------------------

[BoundaryAdapter]
public sealed class KargadanPlugin : PlugIn {
    // --- [TYPES] -------------------------------------------------------------
    private readonly record struct BoundaryState(EventPublisher EventPublisher, SessionHost SessionHost);
    // --- [CONSTANTS] ---------------------------------------------------------
    private static readonly Duration HandshakeHeartbeatInterval = Duration.FromSeconds(5);
    private static readonly Duration HandshakeHeartbeatTimeout = Duration.FromSeconds(15);
    // --- [STATE] -------------------------------------------------------------
    private static readonly Atom<Option<KargadanPlugin>> _instance = Atom(Option<KargadanPlugin>.None);
    private readonly TimeProvider _timeProvider;
    private readonly Atom<Option<BoundaryState>> _state = Atom(Option<BoundaryState>.None);
    // --- [LIFECYCLE] ---------------------------------------------------------
    public KargadanPlugin() : this(timeProvider: TimeProvider.System) { }
    internal KargadanPlugin(TimeProvider timeProvider) => _timeProvider = timeProvider;
    // --- [INTERFACE] ---------------------------------------------------------
    public static Fin<KargadanPlugin> Instance =>
        _instance.Value.ToFin(Error.New(message: "KargadanPlugin has not been loaded."));
    public Fin<EventPublisher> EventPublisher =>
        ReadState().Map(static state => state.EventPublisher);
    public Fin<SessionHost> SessionHost =>
        ReadState().Map(static state => state.SessionHost);
    public Fin<Seq<PublishedEvent>> DrainPublishedEvents() =>
        ReadState().Map(static state => state.EventPublisher.Drain());
    public Fin<HandshakeEnvelope> HandleHandshake(HandshakeEnvelope.Init init) =>
        ReadState().Bind(state => {
            Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
            Fin<SessionSnapshot> opened = state.SessionHost.Open(
                identity: init.Identity,
                heartbeatInterval: HandshakeHeartbeatInterval,
                heartbeatTimeout: HandshakeHeartbeatTimeout,
                now: now);
            HandshakeEnvelope negotiated = Handshake.Negotiate(
                init: init,
                supportedMajor: 1,
                supportedMinor: 0,
                server: new ServerInfo(
                    RhinoVersion: VersionString.Create(RhinoApp.Version.ToString()),
                    PluginRevision: VersionString.Create(Version.ToString())),
                now: now);
            return opened.Bind(_ =>
                negotiated.Switch(
                    init: _ => Fin.Fail<HandshakeEnvelope>(
                        Error.New(message: "Handshake negotiation cannot return init envelope.")),
                    ack: ack => state.SessionHost.Activate(ack, now).Map(_ => negotiated),
                    reject: reject => state.SessionHost.Reject(reject.Reason, now).Map(_ => negotiated)));
        });
    public Fin<CommandResultEnvelope> HandleCommand(
        JsonElement envelope,
        EnvelopeIdentity sessionIdentity,
        Func<CommandEnvelope, Fin<CommandResultEnvelope>> onCommand) =>
        ReadState().Bind(state =>
            CommandRouter.Decode(
                envelope: envelope,
                sessionIdentity: sessionIdentity).Bind(onCommand).Bind(result => {
                    Instant publishedAt = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
                    Fin<EventId> eventId = DomainBridge.ParseValueObject<EventId, Guid>(Guid.NewGuid());
                    return eventId.Bind(lifecycleEventId =>
                        result.Switch(
                            success: success =>
                                EventEnvelope.Create(
                                    eventId: lifecycleEventId,
                                    eventType: EventType.SessionLifecycle,
                                    identity: success.Identity,
                                    sourceRevision: success.Execution.SourceRevision,
                                    causationRequestId: Some(success.Identity.RequestId),
                                    delta: JsonSerializer.SerializeToElement(new {
                                        dedupeDecision = success.Dedupe.Decision.Key,
                                        status = CommandResultStatus.Ok.Key,
                                    }),
                                    telemetryContext: success.TelemetryContext),
                            failure: failure =>
                                EventEnvelope.Create(
                                    eventId: lifecycleEventId,
                                    eventType: EventType.SessionLifecycle,
                                    identity: failure.Identity,
                                    sourceRevision: failure.Execution.SourceRevision,
                                    causationRequestId: Some(failure.Identity.RequestId),
                                    delta: JsonSerializer.SerializeToElement(new {
                                        errorCode = failure.Error.Reason.Code.Key,
                                        failureClass = failure.Error.Reason.FailureClass.Key,
                                        status = CommandResultStatus.Error.Key,
                                    }),
                                    telemetryContext: failure.TelemetryContext)).Bind(eventEnvelope => {
                                        _ = state.EventPublisher.Publish(eventEnvelope, publishedAt);
                                        return Fin.Succ(result);
                                    }));
                }));
    public Fin<HeartbeatEnvelope> HandleHeartbeat(HeartbeatEnvelope heartbeat) =>
        ReadState().Bind(state => {
            Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
            return state.SessionHost.Timeout(now).Bind(_ =>
                state.SessionHost.Beat(now).Bind(_ =>
                    heartbeat.Mode.Map(
                        ping: Fin.Succ(new HeartbeatEnvelope(
                            Identity: heartbeat.Identity,
                            Mode: HeartbeatMode.Pong,
                            ServerTime: now,
                            TelemetryContext: heartbeat.TelemetryContext)),
                        pong: Fin.Succ(heartbeat))));
        });
    // --- [INTERNAL] ----------------------------------------------------------
    private Fin<BoundaryState> ReadState() =>
        _state.Value.ToFin(Error.New(message: "Plugin boundary state is unavailable before plugin load."));
    protected override LoadReturnCode OnLoad(ref string errorMessage) {
        _ = _instance.Swap(_ => Some(this));
        _ = _state.Swap(static _ => Some(new BoundaryState(
            EventPublisher: new EventPublisher(),
            SessionHost: new SessionHost())));
        return LoadReturnCode.Success;
    }
    protected override void OnShutdown() {
        Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
        _ = ReadState().Bind(state =>
            state.SessionHost.Close(reason: "plugin-shutdown", now: now).Map(_ => unit));
        _ = _state.Swap(static _ => None);
        _ = _instance.Swap(static _ => None);
        base.OnShutdown();
    }
}
