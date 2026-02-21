// Rhino PlugIn entry point; wires EventPublisher and SessionHost in OnLoad; routes handshake and command dispatch to transport and protocol layers.
// Singleton constraint is Rhino-imposed — mutability is confined to this adapter; all internal state is Option<T> with None as the unloaded sentinel.
using System;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using NodaTime;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using ParametricPortal.Kargadan.Plugin.src.protocol;
using ParametricPortal.Kargadan.Plugin.src.transport;
using Rhino;
using Rhino.PlugIns;
using static LanguageExt.Prelude;
using Duration = NodaTime.Duration;

namespace ParametricPortal.Kargadan.Plugin.src.boundary;

// --- [ADAPTER] ---------------------------------------------------------------

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
    public Fin<HandshakeEnvelope> HandleHandshake(HandshakeInit init) =>
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
                negotiated switch {
                    HandshakeAck ack => state.SessionHost.Activate(ack, now).Map(_ => negotiated),
                    HandshakeReject reject => state.SessionHost.Reject(reject.Reason, now).Map(_ => negotiated),
                    _ => Fin.Fail<HandshakeEnvelope>(
                        Error.New(message: "Unexpected handshake result variant.")),
                });
        });
    public static Fin<CommandResultEnvelope> RouteCommand(
        JsonElement envelope,
        EnvelopeIdentity sessionIdentity,
        TelemetryContext telemetryContext,
        Func<CommandEnvelope, Fin<CommandResultEnvelope>> onCommand) =>
        CommandRouter.Route(
            envelope: envelope,
            sessionIdentity: sessionIdentity,
            telemetryContext: telemetryContext,
            onCommand: onCommand);
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
        _ = _state.Swap(static _ => None);
        _ = _instance.Swap(static _ => None);
        base.OnShutdown();
    }
}
