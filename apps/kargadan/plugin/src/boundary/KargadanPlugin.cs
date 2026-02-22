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
[BoundaryImperativeExemption(
    ruleId: "CSP0009",
    reason: BoundaryImperativeReason.ProtocolRequired,
    ticket: "KARG-BOUNDARY-001",
    expiresOnUtc: "2099-12-31T00:00:00Z")]
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
                supportedCapabilities: CommandOperation.SupportedCapabilities,
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
    public static Fin<CommandResultEnvelope> RouteCommand(
        JsonElement envelope,
        EnvelopeIdentity sessionIdentity,
        Func<CommandEnvelope, Fin<CommandResultEnvelope>> onCommand) =>
        CommandRouter.Route(
            envelope: envelope,
            sessionIdentity: sessionIdentity,
            onCommand: onCommand);
    public Fin<CommandResultEnvelope> HandleCommand(
        JsonElement envelope,
        EnvelopeIdentity sessionIdentity,
        Func<CommandEnvelope, Fin<CommandResultEnvelope>> onCommand) =>
        ReadState().Bind(state =>
            RouteCommand(
                envelope: envelope,
                sessionIdentity: sessionIdentity,
                onCommand: onCommand).Bind(result => {
                    Instant publishedAt = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
                    Fin<CommandResultEnvelope> PublishSessionLifecycleEvent(
                        EnvelopeIdentity identity,
                        int sourceRevision,
                        TelemetryContext resultTelemetryContext,
                        JsonElement delta) =>
                        DomainBridge.ParseValueObject<EventId, Guid>(Guid.NewGuid()).Bind(eventId =>
                            EventEnvelope.Create(
                                eventId: eventId,
                                eventType: EventType.SessionLifecycle,
                                identity: identity,
                                sourceRevision: sourceRevision,
                                causationRequestId: Some(identity.RequestId),
                                delta: delta,
                                telemetryContext: resultTelemetryContext)).Bind(eventEnvelope =>
                            state.EventPublisher.Publish(eventEnvelope, publishedAt).Map(_ => result));
                    return result.Switch(
                        success: success =>
                            PublishSessionLifecycleEvent(
                                identity: success.Identity,
                                sourceRevision: success.Execution.SourceRevision,
                                resultTelemetryContext: success.TelemetryContext,
                                delta: JsonSerializer.SerializeToElement(new {
                                    dedupeDecision = success.Dedupe.Decision.Key,
                                    status = CommandResultStatus.Ok.Key,
                                })),
                        failure: failure =>
                            PublishSessionLifecycleEvent(
                                identity: failure.Identity,
                                sourceRevision: failure.Execution.SourceRevision,
                                resultTelemetryContext: failure.TelemetryContext,
                                delta: JsonSerializer.SerializeToElement(new {
                                    errorCode = failure.Error.Reason.Code.Key,
                                    failureClass = failure.Error.Reason.FailureClass.Key,
                                    status = CommandResultStatus.Error.Key,
                                })));
                }));
    public Fin<HeartbeatEnvelope> HandleHeartbeat(HeartbeatEnvelope heartbeat) =>
        ReadState().Bind(state => {
            Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
            return state.SessionHost.Timeout(now).Bind(_ =>
                state.SessionHost.Beat(heartbeat).Bind(_ =>
                    heartbeat.Mode.Map(
                        ping: Fin.Succ(Heartbeat.Pong(
                            ping: heartbeat,
                            telemetryContext: heartbeat.TelemetryContext,
                            now: now)),
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
