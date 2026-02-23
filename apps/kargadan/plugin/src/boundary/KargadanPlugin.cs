using System;
using System.Linq;
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
    // --- [TYPES] -------------------------------------------------------------
    private readonly record struct BoundaryState(
        EventPublisher EventPublisher,
        SessionHost SessionHost,
        WebSocketHost WebSocketHost,
        ObservationPipeline ObservationPipeline);
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
            HandshakeEnvelope negotiated = global::ParametricPortal.Kargadan.Plugin.src.transport.SessionHost.Negotiate(
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
    private static Fin<Unit> PublishBatchEvent(
        SessionHost sessionHost,
        EventPublisher eventPublisher,
        EventBatchSummary batch,
        Instant flushedAt) =>
        DomainBridge.ParseValueObject<RequestId, Guid>(Guid.NewGuid()).Bind((RequestId requestId) =>
            PublishSessionEvent(
                sessionHost: sessionHost,
                eventPublisher: eventPublisher,
                eventType: EventType.StreamCompacted,
                requestId: requestId,
                causationRequestId: None,
                operationTag: "event.batch",
                publishedAt: flushedAt,
                buildDelta: _ => BuildBatchDelta(batch)));
    private void EmitUndoEnvelope(
        SessionHost sessionHost,
        EventPublisher eventPublisher,
        AgentUndoState undoState,
        bool isUndo) {
        Instant publishedAt = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
        _ = PublishSessionEvent(
            sessionHost: sessionHost,
            eventPublisher: eventPublisher,
            eventType: EventType.UndoRedo,
            requestId: undoState.RequestId,
            causationRequestId: Some(undoState.RequestId),
            operationTag: "undo.redo",
            publishedAt: publishedAt,
            buildDelta: _ => BuildUndoDelta(
                undoState: undoState,
                isUndo: isUndo));
    }
    private static Fin<Unit> PublishSessionEvent(
        SessionHost sessionHost,
        EventPublisher eventPublisher,
        EventType eventType,
        RequestId requestId,
        Option<RequestId> causationRequestId,
        string operationTag,
        Instant publishedAt,
        Func<SessionSnapshot, JsonElement> buildDelta) =>
        sessionHost.Snapshot().Bind((SessionSnapshot snapshot) =>
            DomainBridge.ParseValueObject<EventId, Guid>(Guid.NewGuid()).Bind((EventId eventId) =>
                BuildTelemetryContext(
                    requestId: requestId,
                    operationTag: operationTag).Bind((TelemetryContext telemetryContext) =>
                    EventEnvelope.Create(
                        eventId: eventId,
                        eventType: eventType,
                        identity: snapshot.Identity with {
                            RequestId = requestId,
                            IssuedAt = publishedAt,
                        },
                        sourceRevision: 0,
                        causationRequestId: causationRequestId,
                        delta: buildDelta(snapshot),
                        telemetryContext: telemetryContext)
                    .Map((EventEnvelope eventEnvelope) => {
                        _ = eventPublisher.Publish(eventEnvelope, publishedAt);
                        return unit;
                    }))));
    private static JsonElement BuildBatchDelta(EventBatchSummary batch) =>
        JsonSerializer.SerializeToElement(new {
            totalCount = batch.TotalCount,
            containsUndoRedo = batch.ContainsUndoRedo,
            batchWindowMs = batch.BatchWindowMs,
            categories = batch.Categories.Select(category => new {
                category = category.Category.Key,
                count = category.Count,
                subtypes = category.Subtypes.Select(sub => new {
                    subtype = sub.Subtype.Key,
                    count = sub.Count,
                }).ToArray(),
            }).ToArray(),
        });
    private static JsonElement BuildUndoDelta(AgentUndoState undoState, bool isUndo) =>
        JsonSerializer.SerializeToElement(new {
            requestId = (Guid)undoState.RequestId,
            undoSerial = undoState.UndoSerial,
            isUndo,
        });
    private static Fin<TelemetryContext> BuildTelemetryContext(
        RequestId requestId,
        string operationTag) {
        Guid requestGuid = (Guid)requestId;
        string idValue = requestGuid.ToString("N");
        return DomainBridge.ParseValueObject<TraceId, string>(idValue).Bind((TraceId traceId) =>
            DomainBridge.ParseValueObject<SpanId, string>(idValue).Bind((SpanId spanId) =>
                DomainBridge.ParseValueObject<OperationTag, string>(operationTag).Bind((OperationTag parsedOperationTag) =>
                    TelemetryContext.Create(
                        traceId: traceId,
                        spanId: spanId,
                        operationTag: parsedOperationTag,
                        attempt: 1))));
    }

    // --- [DISPATCH] ----------------------------------------------------------
    private async Task<Fin<JsonElement>> DispatchMessageAsync(
        TransportMessageTag tag,
        JsonElement message,
        Func<JsonElement, Task> sendAckAsync,
        CancellationToken cancellationToken) =>
        tag switch {
            _ when tag.Equals(TransportMessageTag.HandshakeInit) => await DispatchHandshakeAsync(message: message, cancellationToken: cancellationToken).ConfigureAwait(false),
            _ when tag.Equals(TransportMessageTag.Command) => await DispatchCommandAsync(message: message, sendAckAsync: sendAckAsync, cancellationToken: cancellationToken).ConfigureAwait(false),
            _ when tag.Equals(TransportMessageTag.Heartbeat) => SerializeHeartbeat(message: message),
            _ => Fin.Fail<JsonElement>(Error.New(message: $"Unknown message tag: {tag.Key}")),
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
                    HandleCommand(
                        envelope: message,
                        sessionIdentity: snapshot.Identity,
                        onCommand: (CommandEnvelope envelope) => ExecuteCommand(
                            state: state,
                            envelope: envelope))
                    .Map((CommandResultEnvelope resultEnvelope) =>
                        JsonSerializer.SerializeToElement(value: resultEnvelope, options: JsonOptions)));
            })
        ).WaitAsync(timeoutCts.Token).ConfigureAwait(false);
        return result;
    }
    private Fin<CommandResultEnvelope> ExecuteCommand(
        BoundaryState state,
        CommandEnvelope envelope) {
        RhinoDoc? doc = RhinoDoc.ActiveDoc;
        return doc switch {
            null => Fin.Fail<CommandResultEnvelope>(
                Error.New(message: "No active Rhino document.")),
            _ => BuildCommandResult(
                envelope: envelope,
                executionResult: CommandExecutor.Execute(
                    doc: doc,
                    envelope: envelope,
                    onUndoRedo: (AgentUndoState undoState, bool isUndo) =>
                        EmitUndoEnvelope(
                            sessionHost: state.SessionHost,
                            eventPublisher: state.EventPublisher,
                            undoState: undoState,
                            isUndo: isUndo))),
        };
    }
    private static JsonElement ExtractAckPayload(JsonElement message) {
        string requestId = message.TryGetProperty("identity", out JsonElement identity)
            && identity.TryGetProperty("requestId", out JsonElement reqId)
            && reqId.ValueKind == JsonValueKind.String
                ? reqId.GetString() ?? string.Empty
                : string.Empty;
        return JsonSerializer.SerializeToElement(new {
            _tag = "command.ack",
            requestId,
        });
    }
    private static int ExtractDeadlineMs(JsonElement message) =>
        message.TryGetProperty("deadlineMs", out JsonElement deadlineElement)
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
        .ToFin()
        .Bind((ExecutionMetadata metadata) =>
            executionResult.Match(
                Succ: (JsonElement payload) => Fin.Succ((CommandResultEnvelope)new CommandResultEnvelope.Success(
                    Identity: envelope.Identity,
                    Dedupe: new DedupeMetadata(
                        Decision: DedupeDecision.Executed,
                        OriginalRequestId: envelope.Identity.RequestId),
                    Result: payload,
                    Execution: metadata,
                    TelemetryContext: envelope.TelemetryContext)),
                Fail: (Error error) => Fin.Succ((CommandResultEnvelope)new CommandResultEnvelope.Failure(
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
                    TelemetryContext: envelope.TelemetryContext))));
    private Fin<JsonElement> SerializeHeartbeat(JsonElement message) {
        HeartbeatEnvelope? heartbeat = JsonSerializer.Deserialize<HeartbeatEnvelope>(
            element: message,
            options: JsonOptions);
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
        _ = _state.Swap((previousState) => {
            EventPublisher eventPublisher = new();
            SessionHost sessionHost = new();
            ObservationPipeline observationPipeline = new(
                onBatchFlushed: (EventBatchSummary batch, Instant flushedAt) =>
                    _ = PublishBatchEvent(
                        sessionHost: sessionHost,
                        eventPublisher: eventPublisher,
                        batch: batch,
                        flushedAt: flushedAt),
                timeProvider: _timeProvider);
            WebSocketHost webSocketHost = new(dispatcher: DispatchMessageAsync);
            BoundaryState boundaryState = new(
                EventPublisher: eventPublisher,
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
