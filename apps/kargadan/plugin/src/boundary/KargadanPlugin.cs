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
using Rhino.PlugIns;
using static LanguageExt.Prelude;
using Duration = NodaTime.Duration;
namespace ParametricPortal.Kargadan.Plugin.src.boundary;

[BoundaryAdapter]
public sealed class KargadanPlugin : PlugIn {
    private static class JsonFields {
        internal const string CommandAckTag = "command.ack";
        internal const string DeadlineMs = "deadlineMs";
        internal const string Identity = "identity";
        internal const string RequestId = "requestId";
    }
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
    public static Fin<KargadanPlugin> Instance =>
        _instance.Value.ToFin(Error.New(message: "KargadanPlugin has not been loaded."));
    public Fin<HandshakeEnvelope> HandleHandshake(HandshakeEnvelope.Init init) =>
        ReadState().Bind((BoundaryState state) => {
            Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
            Fin<SessionSnapshot> opened = state.SessionHost.Open(
                identity: init.Identity,
                heartbeatInterval: HandshakeHeartbeatInterval,
                heartbeatTimeout: HandshakeHeartbeatTimeout,
                now: now);
            HandshakeEnvelope negotiated = global::ParametricPortal.Kargadan.Plugin.src.transport.SessionHost.Negotiate(
                init: init,
                supportedMajor: 1,
                supportedMinor: 0,
                server: new ServerInfo(
                    RhinoVersion: VersionString.Create(RhinoApp.Version.ToString()),
                    PluginRevision: VersionString.Create(Version.ToString())),
                now: now);
            return opened.Bind((_) =>
                negotiated switch {
                    HandshakeEnvelope.Init => FinFail<HandshakeEnvelope>(
                        Error.New(message: "Handshake negotiation cannot return init envelope.")),
                    HandshakeEnvelope.Ack ack => state.SessionHost.Activate(ack, now).Map((_) => negotiated),
                    HandshakeEnvelope.Reject reject => state.SessionHost.Reject(reject.Reason, now).Map((_) => negotiated),
                    _ => FinFail<HandshakeEnvelope>(Error.New(message: "Unexpected handshake envelope variant.")),
                });
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
                state.SessionEvents.PublishLifecycleEvent(result: result).Map((_) => result)));
    public Fin<HeartbeatEnvelope> HandleHeartbeat(HeartbeatEnvelope heartbeat) =>
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
        RhinoApp.InvokeOnUiThread(new Action(() => {
            Task<Fin<T>> operationTask = new(operation);
            operationTask.RunSynchronously();
            _ = operationTask.Status switch {
                TaskStatus.RanToCompletion => tcs.TrySetResult(operationTask.Result),
                TaskStatus.Faulted when operationTask.Exception is not null =>
                    tcs.TrySetException(operationTask.Exception.InnerExceptions),
                TaskStatus.Canceled => tcs.TrySetCanceled(CancellationToken.None),
                _ => tcs.TrySetCanceled(CancellationToken.None),
            };
        }));
        return tcs.Task;
    }
    private async Task<Fin<JsonElement>> DispatchHandshakeAsync(
        JsonElement message,
        CancellationToken cancellationToken) {
        Fin<JsonElement> result = await RunOnUiThreadAsync(() => {
            HandshakeEnvelope.Init? init = JsonSerializer.Deserialize<HandshakeEnvelope.Init>(
                element: message,
                options: JsonOptions);
            return init switch {
                null => FinFail<JsonElement>(
                    Error.New(message: "Failed to deserialize handshake init envelope.")),
                _ => HandleHandshake(init: init).Map(
                    (HandshakeEnvelope envelope) => JsonSerializer.SerializeToElement(value: envelope, options: JsonOptions)),
            };
        }).WaitAsync(cancellationToken).ConfigureAwait(false);
        return result;
    }
    private async Task<Fin<JsonElement>> DispatchCommandAsync(
        JsonElement message,
        Func<JsonElement, Task> sendAckAsync,
        CancellationToken cancellationToken) {
        JsonElement ackPayload = ExtractAckPayload(message: message);
        await sendAckAsync(ackPayload).ConfigureAwait(false);
        int deadlineMs = ExtractDeadlineMs(message: message);
        using CancellationTokenSource timeoutCts =
            CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(millisecondsDelay: deadlineMs);
        Fin<JsonElement> result = await RunOnUiThreadAsync(() =>
            ReadState().Bind((BoundaryState state) => {
                Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
                return state.SessionHost.Timeout(now).Bind((SessionSnapshot snapshot) =>
                    snapshot.Phase switch {
                        SessionPhase.Active => HandleCommand(
                                envelope: message,
                                sessionIdentity: snapshot.Identity,
                                onCommand: (CommandEnvelope envelope) => ExecuteCommand(
                                    state: state,
                                    envelope: envelope))
                            .Map((CommandResultEnvelope resultEnvelope) =>
                                JsonSerializer.SerializeToElement(value: resultEnvelope, options: JsonOptions)),
                        SessionPhase.Connected => FinFail<JsonElement>(
                            Error.New(message: "Session is not active; handshake is not fully negotiated.")),
                        SessionPhase.Terminal terminal => FinFail<JsonElement>(
                            Error.New(message: $"Session is not active; current state is '{terminal.StateTag.Key}'.")),
                        _ => FinFail<JsonElement>(
                            Error.New(message: "Session is not active.")),
                    });
            })
        ).WaitAsync(timeoutCts.Token).ConfigureAwait(false);
        return result;
    }
    private Fin<CommandResultEnvelope> ExecuteCommand(
        BoundaryState state,
        CommandEnvelope envelope) {
        RhinoDoc? doc = RhinoDoc.ActiveDoc;
        return doc switch {
            null => FinFail<CommandResultEnvelope>(
                Error.New(message: "No active Rhino document.")),
            _ => BuildCommandResult(
                envelope: envelope,
                executionResult: CommandExecutor.Execute(
                    doc: doc,
                    envelope: envelope,
                    onUndoRedo: state.SessionEvents.EmitUndoEnvelope)),
        };
    }
    private static JsonElement ExtractAckPayload(JsonElement message) {
        string requestId = message.TryGetProperty(JsonFields.Identity, out JsonElement identity)
            && identity.TryGetProperty(JsonFields.RequestId, out JsonElement reqId)
            && reqId.ValueKind == JsonValueKind.String
                ? reqId.GetString() ?? string.Empty
                : string.Empty;
        return JsonSerializer.SerializeToElement(new {
            _tag = JsonFields.CommandAckTag,
            requestId,
        });
    }
    private static int ExtractDeadlineMs(JsonElement message) =>
        message.TryGetProperty(JsonFields.DeadlineMs, out JsonElement deadlineElement)
            && deadlineElement.TryGetInt32(out int deadline)
            && deadline > 0
                ? deadline
                : 30_000;
    private Fin<CommandResultEnvelope> BuildCommandResult(
        CommandEnvelope envelope,
        Fin<JsonElement> executionResult) =>
        ExecutionMetadata.Create(
            durationMs: 0,
            pluginRevision: VersionString.Create(Version.ToString()),
            sourceRevision: 0)
        .Match(
            Succ: (ExecutionMetadata metadata) =>
                executionResult.Match(
                    Succ: (JsonElement payload) => FinSucc((CommandResultEnvelope)new CommandResultEnvelope.Success(
                        Identity: envelope.Identity,
                        Dedupe: new DedupeMetadata(
                            Decision: DedupeDecision.Executed,
                            OriginalRequestId: envelope.Identity.RequestId),
                        Result: payload,
                        Execution: metadata,
                        TelemetryContext: envelope.TelemetryContext)),
                    Fail: (Error error) => FinSucc((CommandResultEnvelope)new CommandResultEnvelope.Failure(
                        Identity: envelope.Identity,
                        Dedupe: new DedupeMetadata(
                            Decision: DedupeDecision.Executed,
                            OriginalRequestId: envelope.Identity.RequestId),
                        Result: JsonSerializer.SerializeToElement(new { error = error.Message }),
                        Execution: metadata,
                        Error: new CommandErrorEnvelope(
                            Reason: new FailureReason(
                                Code: ErrorCode.UnexpectedRuntime,
                                Message: error.Message),
                            Details: None),
                        TelemetryContext: envelope.TelemetryContext))),
            Fail: static (Seq<Error> errors) =>
                FinFail<CommandResultEnvelope>(errors.HeadOrNone().IfNone(
                    Error.New(message: "Execution metadata is invalid."))));
    private Fin<JsonElement> SerializeHeartbeat(JsonElement message) {
        HeartbeatEnvelope? heartbeat = JsonSerializer.Deserialize<HeartbeatEnvelope>(
            element: message,
            options: JsonOptions);
        return heartbeat switch {
            null => FinFail<JsonElement>(
                Error.New(message: "Failed to deserialize heartbeat envelope.")),
            _ => HandleHeartbeat(heartbeat: heartbeat).Map(
                (HeartbeatEnvelope envelope) => JsonSerializer.SerializeToElement(value: envelope, options: JsonOptions)),
        };
    }
    private Fin<BoundaryState> ReadState() =>
        _state.Value.ToFin(Error.New(message: "Plugin boundary state is unavailable before plugin load."));
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
                    _ = sessionEvents.PublishBatchEvent(
                        batch: batch,
                        flushedAt: flushedAt),
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
