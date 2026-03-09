using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using LanguageExt;
using LanguageExt.Common;
using NodaTime;
using ParametricPortal.CSharp.Analyzers.Contracts;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using ParametricPortal.Kargadan.Plugin.src.execution;
using ParametricPortal.Kargadan.Plugin.src.observation;
using ParametricPortal.Kargadan.Plugin.src.protocol;
using ParametricPortal.Kargadan.Plugin.src.transport;
using Rhino;
using Rhino.DocObjects;
using Rhino.PlugIns;
using static LanguageExt.Prelude;
using Duration = NodaTime.Duration;
namespace ParametricPortal.Kargadan.Plugin.src.boundary;

[BoundaryAdapter]
public sealed class KargadanPlugin : PlugIn {
    private readonly record struct DecodedCommand(BoundaryState State, CommandEnvelope Envelope);
    private readonly record struct BoundaryState(
        SessionEventPublisher SessionEvents,
        SessionHost SessionHost,
        WebSocketHost WebSocketHost,
        ObservationPipeline ObservationPipeline);
    private static readonly Duration HandshakeHeartbeatInterval = Duration.FromSeconds(5);
    private static readonly Duration HandshakeHeartbeatTimeout = Duration.FromSeconds(15);
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };
    private static readonly Atom<Option<KargadanPlugin>> _instance = Atom(Option<KargadanPlugin>.None);
    private readonly TimeProvider _timeProvider;
    private readonly Atom<Option<BoundaryState>> _state = Atom(Option<BoundaryState>.None);
    public KargadanPlugin() : this(timeProvider: TimeProvider.System) { }
    internal KargadanPlugin(TimeProvider timeProvider) => _timeProvider = timeProvider;
    public override PlugInLoadTime LoadTime => PlugInLoadTime.AtStartup;
    internal static Fin<KargadanPlugin> Instance =>
        _instance.Value.ToFin(Error.New(message: "KargadanPlugin has not been loaded."));
    private Fin<HandshakeEnvelope> HandleHandshake(HandshakeEnvelope.Init init) =>
        ReadState().Bind((BoundaryState state) => {
            Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
            Fin<SessionSnapshot> opened = state.SessionHost.Open(
                identity: init.Identity,
                heartbeatInterval: HandshakeHeartbeatInterval,
                heartbeatTimeout: HandshakeHeartbeatTimeout,
                now: now);
            HandshakeEnvelope negotiated = global::ParametricPortal.Kargadan.Plugin.src.transport.SessionHost.Negotiate(
                new NegotiationContext(
                    Init: init,
                    SupportedMajor: 1,
                    SupportedMinor: 0,
                    Server: new ServerInfo(
                        RhinoVersion: VersionString.Create(RhinoApp.Version.ToString()),
                        PluginRevision: VersionString.Create(Version.ToString())),
                    SupportedCapabilities: CommandExecutor.SupportedCapabilities,
                    Catalog: CommandExecutor.CommandCatalog,
                    Now: now));
            return opened.Bind((_) =>
                negotiated switch {
                    HandshakeEnvelope.Init => FinFail<HandshakeEnvelope>(
                        Error.New(message: "Handshake negotiation cannot return init envelope.")),
                    HandshakeEnvelope.Ack ack => state.SessionHost.Activate(ack, now).Map((_) => negotiated),
                    HandshakeEnvelope.Reject reject => state.SessionHost.Reject(reject.Reason, now).Map((_) => negotiated),
                    _ => FinFail<HandshakeEnvelope>(Error.New(message: "Unexpected handshake envelope variant.")),
                });
        });
    private Fin<HeartbeatEnvelope> HandleHeartbeat(HeartbeatEnvelope heartbeat) =>
        ReadState().Bind((BoundaryState state) => {
            Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
            return state.SessionHost.Timeout(now).Bind((_) =>
                state.SessionHost.Beat(now).Bind((_) =>
                    heartbeat.Mode.Map(
                        ping: FinSucc(new HeartbeatEnvelope(
                            Identity: heartbeat.Identity,
                            Mode: HeartbeatMode.Pong,
                            ServerTime: now,
                            TelemetryContext: heartbeat.TelemetryContext)),
                        pong: FinSucc(heartbeat))));
        });
    private async Task<Fin<JsonElement>> DispatchMessageAsync(
        TransportMessageTag tag,
        JsonElement message,
        Func<JsonElement, Task> sendAckAsync,
        CancellationToken cancellationToken) =>
        tag switch {
            _ when tag.Equals(TransportMessageTag.HandshakeInit) => await DispatchHandshakeAsync(message: message, cancellationToken: cancellationToken).ConfigureAwait(false),
            _ when tag.Equals(TransportMessageTag.Command) => await DispatchCommandAsync(message: message, sendAckAsync: sendAckAsync, cancellationToken: cancellationToken).ConfigureAwait(false),
            _ when tag.Equals(TransportMessageTag.Heartbeat) => SerializeHeartbeat(message: message),
            _ => FinFail<JsonElement>(Error.New(message: $"Unknown message tag: {tag.Key}")),
        };
    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.ProtocolRequired,
        ticket: "TRAN-03",
        expiresOnUtc: "2026-08-22T00:00:00Z")]
    private static Task<Fin<T>> RunOnUiThreadAsync<T>(Func<Fin<T>> operation) {
        TaskCompletionSource<Fin<T>> tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        RhinoApp.InvokeOnUiThread(new Action(() => tcs.TrySetResult(operation())));
        return tcs.Task;
    }
    private async Task<Fin<JsonElement>> DispatchHandshakeAsync(
        JsonElement message,
        CancellationToken cancellationToken) {
        Fin<JsonElement> result = await RunOnUiThreadAsync(() => {
            Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
            return CommandRouter.DecodeHandshake(
                envelope: message,
                now: now).Bind((HandshakeEnvelope.Init init) =>
                    HandleHandshake(init: init).Map(
                        (HandshakeEnvelope envelope) => TransportJson.Response(envelope, JsonOptions)));
        }).WaitAsync(cancellationToken).ConfigureAwait(false);
        return result;
    }
    private async Task<Fin<JsonElement>> DispatchCommandAsync(
        JsonElement message,
        Func<JsonElement, Task> sendAckAsync,
        CancellationToken cancellationToken) {
        Fin<DecodedCommand> decoded = await RunOnUiThreadAsync(() =>
            ReadState().Bind((BoundaryState state) => {
                Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
                return state.SessionHost.Timeout(now).Bind((SessionSnapshot snapshot) =>
                    snapshot.Phase switch {
                        SessionPhase.Active => CommandRouter.Decode(
                                envelope: message,
                                sessionIdentity: snapshot.Identity)
                            .Map((CommandEnvelope envelope) => new DecodedCommand(
                                State: state,
                                Envelope: envelope)),
                        SessionPhase.Connected => FinFail<DecodedCommand>(
                            Error.New(message: "Session is not active; handshake is not fully negotiated.")),
                        SessionPhase.Terminal terminal => FinFail<DecodedCommand>(
                            Error.New(message: $"Session is not active; current state is '{terminal.StateTag.Key}'.")),
                        _ => FinFail<DecodedCommand>(
                            Error.New(message: "Session is not active.")),
                    });
            })
        ).WaitAsync(cancellationToken).ConfigureAwait(false);
        async Task<Fin<JsonElement>> ExecuteDecodedAsync(DecodedCommand command) {
            await sendAckAsync(BuildCommandAckPayload(envelope: command.Envelope)).ConfigureAwait(false);
            using CancellationTokenSource timeoutCts =
                CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(millisecondsDelay: command.Envelope.DeadlineMs);
            return await RunOnUiThreadAsync(() =>
                ExecuteCommand(
                    state: command.State,
                    envelope: command.Envelope)
                .Map((CommandResultEnvelope resultEnvelope) =>
                    TransportJson.Response(resultEnvelope, JsonOptions))
            ).WaitAsync(timeoutCts.Token).ConfigureAwait(false);
        }
        return await (decoded.IsFail
            ? Task.FromResult(FinFail<JsonElement>(Error.New(message: "Command envelope decode failed.")))
            : ExecuteDecodedAsync(decoded.IfFail(default(DecodedCommand)))).ConfigureAwait(false);
    }
    private static JsonElement BuildCommandAckPayload(CommandEnvelope envelope) =>
        TransportJson.CommandAck(envelope, JsonOptions);
    private static FailureReason ResolveFailureReason(Error error) =>
        FailureMapping.FromError(error);
    private Fin<CommandResultEnvelope> ExecuteCommand(
        BoundaryState state,
        CommandEnvelope envelope) =>
        Optional(RhinoDoc.ActiveDoc)
            .ToFin(Error.New(message: "No active Rhino document."))
            .Bind((RhinoDoc doc) =>
                state.SessionHost.RegisterIdempotency(envelope).Bind((Option<RequestId> duplicateRequestId) =>
                    duplicateRequestId.Match(
                        Some: (RequestId originalRequestId) =>
                            BuildResult(
                                envelope: envelope,
                                durationMs: 0,
                                build: (ExecutionMetadata metadata) => new CommandResultEnvelope.Success(
                                    Identity: envelope.Identity,
                                    Dedupe: new DedupeMetadata(
                                        Decision: DedupeDecision.Duplicate,
                                        OriginalRequestId: originalRequestId),
                                    Result: JsonSerializer.SerializeToElement(new { duplicate = true }),
                                    Execution: metadata,
                                    TelemetryContext: envelope.TelemetryContext))
                            .Bind((CommandResultEnvelope result) =>
                                state.SessionEvents.PublishLifecycleEvent(result: result).Map((_) => result)),
                        None: () => {
                            long startedAtTimestamp = _timeProvider.GetTimestamp();
                            Fin<JsonElement> executionResult = CommandExecutor.Execute(
                                doc: doc,
                                envelope: envelope,
                                onUndoRedo: state.SessionEvents.EmitUndoEnvelope);
                            return BuildResult(
                                envelope: envelope,
                                durationMs: DurationMilliseconds(startedAtTimestamp),
                                build: (ExecutionMetadata metadata) =>
                                    executionResult.Match(
                                        Succ: (JsonElement payload) => (CommandResultEnvelope)new CommandResultEnvelope.Success(
                                            Identity: envelope.Identity,
                                            Dedupe: new DedupeMetadata(
                                                Decision: DedupeDecision.Executed,
                                                OriginalRequestId: envelope.Identity.RequestId),
                                            Result: payload,
                                            Execution: metadata,
                                            TelemetryContext: envelope.TelemetryContext),
                                        Fail: (Error error) => new CommandResultEnvelope.Failure(
                                            Identity: envelope.Identity,
                                            Dedupe: new DedupeMetadata(
                                                Decision: DedupeDecision.Rejected,
                                                OriginalRequestId: envelope.Identity.RequestId),
                                            Result: JsonSerializer.SerializeToElement(new { error = error.Message }),
                                            Execution: metadata,
                                            Error: new CommandErrorEnvelope(
                                                Reason: ResolveFailureReason(error),
                                                Details: None),
                                            TelemetryContext: envelope.TelemetryContext)))
                                .Bind((CommandResultEnvelope result) =>
                                    state.SessionEvents.PublishLifecycleEvent(result: result).Map((_) => result));
                        })));
    private Fin<CommandResultEnvelope> BuildResult(
        CommandEnvelope envelope,
        int durationMs,
        Func<ExecutionMetadata, CommandResultEnvelope> build) =>
        ExecutionMetadata.Create(
            durationMs: durationMs,
            pluginRevision: VersionString.Create(Version.ToString()),
            sourceRevision: CurrentSourceRevision())
        .Match(
            Succ: (ExecutionMetadata metadata) => FinSucc(build(metadata)),
            Fail: static (Seq<Error> errors) =>
                FinFail<CommandResultEnvelope>(errors.HeadOrNone().IfNone(
                    Error.New(message: "Execution metadata is invalid."))));
    private int DurationMilliseconds(long startedAtTimestamp) =>
        Math.Max(
            0,
            (int)Math.Round(_timeProvider.GetElapsedTime(startedAtTimestamp).TotalMilliseconds));
    private static int CurrentSourceRevision() =>
        (int)Math.Min((long)RhinoObject.NextRuntimeSerialNumber, int.MaxValue);
    private Fin<JsonElement> SerializeHeartbeat(JsonElement message) {
        Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
        return ReadState().Bind((BoundaryState state) =>
            state.SessionHost.Snapshot().Bind((SessionSnapshot snapshot) =>
                CommandRouter.DecodeHeartbeat(
                    envelope: message,
                    protocolVersion: snapshot.Identity.ProtocolVersion,
                    now: now).Bind((HeartbeatEnvelope heartbeat) =>
                    HandleHeartbeat(heartbeat: heartbeat).Map(
                        (HeartbeatEnvelope envelope) => TransportJson.Response(envelope, JsonOptions)))));
    }
    private Fin<BoundaryState> ReadState() =>
        _state.Value.ToFin(Error.New(message: "Plugin boundary state is unavailable before plugin load."));
    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.ProtocolRequired,
        ticket: "TRAN-03",
        expiresOnUtc: "2026-08-22T00:00:00Z")]
    protected override LoadReturnCode OnLoad(ref string errorMessage) {
        _ = _instance.Swap((_) => Some(this));
        _ = _state.Swap((previousState) => {
            EventPublisher eventPublisher = new();
            SessionHost sessionHost = new();
            SessionEventPublisher sessionEvents = new(
                eventPublisher: eventPublisher,
                sessionHost: sessionHost,
                timeProvider: _timeProvider);
            ObservationPipeline observationPipeline = new(
                onBatchFlushed: (EventBatchSummary batch, Instant flushedAt) =>
                    sessionEvents.PublishBatchEvent(
                        batch: batch,
                        flushedAt: flushedAt)
                    .IfFail(error => RhinoApp.WriteLine(
                        $"[Kargadan] Batch publish failed: totalCount={batch.TotalCount}, flushedAt={flushedAt}, error={error}")),
                timeProvider: _timeProvider);
            WebSocketHost webSocketHost = new(
                dispatcher: DispatchMessageAsync,
                drainPublishedEvents: eventPublisher.Drain,
                requeueEvents: eventPublisher.Requeue);
            BoundaryState boundaryState = new(
                SessionEvents: sessionEvents,
                SessionHost: sessionHost,
                WebSocketHost: webSocketHost,
                ObservationPipeline: observationPipeline);
            observationPipeline.Start();
            webSocketHost.Start();
            return Some(boundaryState);
        });
        return LoadReturnCode.Success;
    }
    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.ProtocolRequired,
        ticket: "TRAN-03",
        expiresOnUtc: "2026-08-22T00:00:00Z")]
    protected override void OnShutdown() {
        Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
        _ = ReadState().Bind((BoundaryState state) => {
            state.ObservationPipeline.Stop();
            state.ObservationPipeline.Dispose();
            state.WebSocketHost.Dispose();
            return state.SessionHost.Close(reason: "plugin-shutdown", now: now).Map((_) => unit);
        });
        _ = _state.Swap(static (_) => None);
        _ = _instance.Swap(static (_) => None);
        base.OnShutdown();
    }
}
