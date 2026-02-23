// Rhino PlugIn entry point; wires EventPublisher, SessionHost, and WebSocketHost in OnLoad; routes handshake and command dispatch to transport and protocol layers.
// Singleton constraint is Rhino-imposed — mutability is confined to this adapter; all internal state is Option<T> with None as the unloaded sentinel.
using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
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
    private readonly record struct BoundaryState(
        EventPublisher EventPublisher,
        SessionHost SessionHost,
        WebSocketHost WebSocketHost);
    private readonly record struct LifecycleEventPayload(
        EnvelopeIdentity Identity,
        int SourceRevision,
        RequestId RequestId,
        JsonElement Delta,
        TelemetryContext TelemetryContext);
    // --- [CONSTANTS] ---------------------------------------------------------
    private static readonly Duration HandshakeHeartbeatInterval = Duration.FromSeconds(5);
    private static readonly Duration HandshakeHeartbeatTimeout = Duration.FromSeconds(15);
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };
    // --- [STATE] -------------------------------------------------------------
    private static readonly Atom<Option<KargadanPlugin>> _instance = Atom(Option<KargadanPlugin>.None);
    private readonly TimeProvider _timeProvider;
    private readonly Atom<Option<BoundaryState>> _state = Atom(Option<BoundaryState>.None);
    // --- [LIFECYCLE] ---------------------------------------------------------
    public KargadanPlugin() : this(timeProvider: TimeProvider.System) { }
    internal KargadanPlugin(TimeProvider timeProvider) => _timeProvider = timeProvider;
    public override PlugInLoadTime LoadTime => PlugInLoadTime.AtStartup;
    // --- [INTERFACE] ---------------------------------------------------------
    public static Fin<KargadanPlugin> Instance =>
        _instance.Value.ToFin(Error.New(message: "KargadanPlugin has not been loaded."));
    public Fin<EventPublisher> EventPublisher =>
        ReadState().Map(static (BoundaryState state) => state.EventPublisher);
    public Fin<SessionHost> SessionHost =>
        ReadState().Map(static (BoundaryState state) => state.SessionHost);
    public Fin<Seq<PublishedEvent>> DrainPublishedEvents() =>
        ReadState().Map(static (BoundaryState state) => state.EventPublisher.Drain());
    public Fin<HandshakeEnvelope> HandleHandshake(HandshakeEnvelope.Init init) =>
        ReadState().Bind((BoundaryState state) => {
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
            return opened.Bind((_) =>
                negotiated.Switch(
                    init: (_) => Fin.Fail<HandshakeEnvelope>(
                        Error.New(message: "Handshake negotiation cannot return init envelope.")),
                    ack: (HandshakeEnvelope.Ack ack) => state.SessionHost.Activate(ack, now).Map((_) => negotiated),
                    reject: (HandshakeEnvelope.Reject reject) => state.SessionHost.Reject(reject.Reason, now).Map((_) => negotiated)));
        });
    public Fin<CommandResultEnvelope> HandleCommand(
        JsonElement envelope,
        EnvelopeIdentity sessionIdentity,
        Func<CommandEnvelope, Fin<CommandResultEnvelope>> onCommand) =>
        ReadState().Bind((BoundaryState state) =>
            CommandRouter.Decode(
                envelope: envelope,
                sessionIdentity: sessionIdentity)
            .Bind(onCommand)
            .Bind((CommandResultEnvelope result) =>
                PublishLifecycleEvent(state: state, result: result).Map((_) => result)));
    public Fin<HeartbeatEnvelope> HandleHeartbeat(HeartbeatEnvelope heartbeat) =>
        ReadState().Bind((BoundaryState state) => {
            Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
            return state.SessionHost.Timeout(now).Bind((_) =>
                state.SessionHost.Beat(now).Bind((_) =>
                    heartbeat.Mode.Map(
                        ping: Fin.Succ(new HeartbeatEnvelope(
                            Identity: heartbeat.Identity,
                            Mode: HeartbeatMode.Pong,
                            ServerTime: now,
                            TelemetryContext: heartbeat.TelemetryContext)),
                        pong: Fin.Succ(heartbeat))));
        });
    // --- [FUNCTIONS] ---------------------------------------------------------
    // why: consolidates success/failure lifecycle event publishing — both arms share
    // identical EventEnvelope.Create structure, differing only in delta payload
    private Fin<Unit> PublishLifecycleEvent(BoundaryState state, CommandResultEnvelope result) {
        Instant publishedAt = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
        Fin<EventId> eventId = DomainBridge.ParseValueObject<EventId, Guid>(Guid.NewGuid());
        return eventId.Bind((EventId lifecycleEventId) =>
            BuildLifecycleEventDelta(result: result).Bind((LifecycleEventPayload payload) =>
                EventEnvelope.Create(
                    eventId: lifecycleEventId,
                    eventType: EventType.SessionLifecycle,
                    identity: payload.Identity,
                    sourceRevision: payload.SourceRevision,
                    causationRequestId: Some(payload.RequestId),
                    delta: payload.Delta,
                    telemetryContext: payload.TelemetryContext).Bind((EventEnvelope eventEnvelope) => {
                        _ = state.EventPublisher.Publish(eventEnvelope, publishedAt);
                        return Fin.Succ(unit);
                    })));
    }
    private static Fin<LifecycleEventPayload>
        BuildLifecycleEventDelta(CommandResultEnvelope result) =>
        result.Switch(
            success: (CommandResultEnvelope.Success success) => Fin.Succ(
                new LifecycleEventPayload(
                    Identity: success.Identity,
                    SourceRevision: success.Execution.SourceRevision,
                    RequestId: success.Identity.RequestId,
                    Delta: JsonSerializer.SerializeToElement(new {
                        dedupeDecision = success.Dedupe.Decision.Key,
                        status = CommandResultStatus.Ok.Key,
                    }),
                    TelemetryContext: success.TelemetryContext)),
            failure: (CommandResultEnvelope.Failure failure) => Fin.Succ(
                new LifecycleEventPayload(
                    Identity: failure.Identity,
                    SourceRevision: failure.Execution.SourceRevision,
                    RequestId: failure.Identity.RequestId,
                    Delta: JsonSerializer.SerializeToElement(new {
                        errorCode = failure.Error.Reason.Code.Key,
                        failureClass = failure.Error.Reason.FailureClass.Key,
                        status = CommandResultStatus.Error.Key,
                    }),
                    TelemetryContext: failure.TelemetryContext)));
    // --- [DISPATCH] ----------------------------------------------------------
    // why: typed smart-enum dispatch keeps protocol tags explicit at the adapter seam and
    // avoids stringly routing branches while preserving transport behavior.
    private async Task<Fin<JsonElement>> DispatchMessageAsync(
        TransportMessageTag tag,
        JsonElement message,
        CancellationToken cancellationToken) =>
        tag switch {
            _ when tag.Equals(TransportMessageTag.HandshakeInit) => await DispatchHandshakeAsync(message: message, cancellationToken: cancellationToken).ConfigureAwait(false),
            _ when tag.Equals(TransportMessageTag.Command) => await DispatchCommandAsync(message: message, cancellationToken: cancellationToken).ConfigureAwait(false),
            _ when tag.Equals(TransportMessageTag.Heartbeat) => SerializeHeartbeat(message: message),
            _ => Fin.Fail<JsonElement>(Error.New(message: $"Unknown message tag: {tag.Key}")),
        };
    // [BOUNDARY ADAPTER -- async dispatch to UI thread via ThreadMarshaler for RhinoDoc safety]
    private async Task<Fin<JsonElement>> DispatchHandshakeAsync(
        JsonElement message,
        CancellationToken cancellationToken) {
        Fin<JsonElement> result = await ThreadMarshaler.RunOnUiThreadAsync(() => {
            HandshakeEnvelope.Init? init = JsonSerializer.Deserialize<HandshakeEnvelope.Init>(
                element: message, options: JsonOptions);
            return init switch {
                null => Fin.Fail<JsonElement>(
                    Error.New(message: "Failed to deserialize handshake init envelope.")),
                _ => HandleHandshake(init: init).Map(
                    (HandshakeEnvelope envelope) => JsonSerializer.SerializeToElement(value: envelope, options: JsonOptions)),
            };
        }).WaitAsync(cancellationToken).ConfigureAwait(false);
        return result;
    }
    private async Task<Fin<JsonElement>> DispatchCommandAsync(
        JsonElement message,
        CancellationToken cancellationToken) {
        Fin<JsonElement> result = await ThreadMarshaler.RunOnUiThreadAsync(() =>
            ReadState().Bind((BoundaryState state) => {
                Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
                return state.SessionHost.Timeout(now).Bind((SessionSnapshot snapshot) =>
                    HandleCommand(
                        envelope: message,
                        sessionIdentity: snapshot.Identity,
                        onCommand: static (_) => Fin.Fail<CommandResultEnvelope>(
                            Error.New(message: "Command execution not yet implemented."))
                    ).Map((CommandResultEnvelope envelope) =>
                        JsonSerializer.SerializeToElement(value: envelope, options: JsonOptions)));
            })
        ).WaitAsync(cancellationToken).ConfigureAwait(false);
        return result;
    }
    private Fin<JsonElement> SerializeHeartbeat(JsonElement message) {
        HeartbeatEnvelope? heartbeat = JsonSerializer.Deserialize<HeartbeatEnvelope>(
            element: message, options: JsonOptions);
        return heartbeat switch {
            null => Fin.Fail<JsonElement>(
                Error.New(message: "Failed to deserialize heartbeat envelope.")),
            _ => HandleHeartbeat(heartbeat: heartbeat).Map(
                (HeartbeatEnvelope envelope) => JsonSerializer.SerializeToElement(value: envelope, options: JsonOptions)),
        };
    }
    // --- [INTERNAL] ----------------------------------------------------------
    private Fin<BoundaryState> ReadState() =>
        _state.Value.ToFin(Error.New(message: "Plugin boundary state is unavailable before plugin load."));
    protected override LoadReturnCode OnLoad(ref string errorMessage) {
        _ = _instance.Swap((_) => Some(this));
        _ = _state.Swap((_) => {
            WebSocketHost webSocketHost = new(dispatcher: DispatchMessageAsync);
            BoundaryState boundaryState = new(
                EventPublisher: new EventPublisher(),
                SessionHost: new SessionHost(),
                WebSocketHost: webSocketHost);
            webSocketHost.Start();
            return Some(boundaryState);
        });
        return LoadReturnCode.Success;
    }
    protected override void OnShutdown() {
        Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
        _ = ReadState().Bind((BoundaryState state) => {
            state.WebSocketHost.Dispose();
            return state.SessionHost.Close(reason: "plugin-shutdown", now: now).Map((_) => unit);
        });
        _ = _state.Swap(static (_) => None);
        _ = _instance.Swap(static (_) => None);
        base.OnShutdown();
    }
}
