using System;
using System.Linq;
using System.Text.Json;
using LanguageExt;
using NodaTime;
using ParametricPortal.CSharp.Analyzers.Contracts;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using ParametricPortal.Kargadan.Plugin.src.execution;
using ParametricPortal.Kargadan.Plugin.src.observation;
using ParametricPortal.Kargadan.Plugin.src.transport;
using static LanguageExt.Prelude;
namespace ParametricPortal.Kargadan.Plugin.src.boundary;

[BoundaryAdapter]
internal sealed class SessionEventPublisher {
    private static class OperationTags {
        internal const string EventBatch = "event.batch";
        internal const string UndoRedo = "undo.redo";
    }
    private readonly EventPublisher _eventPublisher;
    private readonly SessionHost _sessionHost;
    private readonly TimeProvider _timeProvider;
    internal SessionEventPublisher(
        EventPublisher eventPublisher,
        SessionHost sessionHost,
        TimeProvider timeProvider) {
        _eventPublisher = eventPublisher;
        _sessionHost = sessionHost;
        _timeProvider = timeProvider;
    }
    internal Fin<Unit> PublishCommandLifecycleEvent(CommandResultEnvelope result) {
        return result.Switch(
            success: (CommandResultEnvelope.Success success) =>
                PublishEventEnvelope(
                    eventType: EventType.CommandLifecycle,
                    identity: success.Identity,
                    causationRequestId: Some(success.Identity.RequestId),
                    delta: JsonSerializer.SerializeToElement(new {
                        dedupeDecision = success.Dedupe.Decision.Key,
                        status = CommandResultStatus.Ok.Key,
                    }),
                    telemetryContext: success.TelemetryContext),
            failure: (CommandResultEnvelope.Failure failure) =>
                PublishEventEnvelope(
                    eventType: EventType.CommandLifecycle,
                    identity: failure.Identity,
                    causationRequestId: Some(failure.Identity.RequestId),
                    delta: JsonSerializer.SerializeToElement(new {
                        errorCode = failure.Error.Reason.Code.Key,
                        failureClass = failure.Error.Reason.FailureClass.Key,
                        status = CommandResultStatus.Error.Key,
                    }),
                    telemetryContext: failure.TelemetryContext));
    }
    internal Fin<Unit> PublishBatchEvent(
        EventBatchSummary batch,
        Instant flushedAt) =>
        DomainBridge.ParseValueObject<RequestId, Guid>(Guid.NewGuid()).Bind((RequestId requestId) =>
            DomainBridge.ParseValueObject<OperationTag, string>(OperationTags.EventBatch).Bind((OperationTag operationTag) =>
                PublishSessionEvent(
                    eventType: EventType.StreamCompacted,
                    requestId: requestId,
                    causationRequestId: None,
                    operationTag: operationTag,
                    publishedAt: flushedAt,
                    buildDelta: _ => BuildBatchDelta(batch))));
    internal Fin<Unit> EmitUndoEnvelope(
        AgentUndoState undoState,
        bool isUndo) {
        Instant publishedAt = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
        return DomainBridge.ParseValueObject<OperationTag, string>(OperationTags.UndoRedo).Bind((OperationTag operationTag) =>
            PublishSessionEvent(
                eventType: EventType.UndoRedo,
                requestId: undoState.RequestId,
                causationRequestId: Some(undoState.RequestId),
                operationTag: operationTag,
                publishedAt: publishedAt,
                buildDelta: _ => BuildUndoDelta(
                    undoState: undoState,
                    isUndo: isUndo)));
    }
    private Fin<Unit> PublishSessionEvent(
        EventType eventType,
        RequestId requestId,
        Option<RequestId> causationRequestId,
        OperationTag operationTag,
        Instant publishedAt,
        Func<SessionSnapshot, JsonElement> buildDelta) =>
        _sessionHost.Snapshot().Match(
            Succ: (SessionSnapshot snapshot) =>
                BuildTelemetryContext(
                    requestId: requestId,
                    operationTag: operationTag).Bind((TelemetryContext telemetryContext) =>
                    PublishEventEnvelope(
                        eventType: eventType,
                        identity: snapshot.Identity with {
                            RequestId = requestId,
                            IssuedAt = publishedAt,
                        },
                        causationRequestId: causationRequestId,
                        delta: buildDelta(snapshot),
                        telemetryContext: telemetryContext)),
            Fail: FinFail<Unit>);
    private Fin<Unit> PublishEventEnvelope(
        EventType eventType,
        EnvelopeIdentity identity,
        Option<RequestId> causationRequestId,
        JsonElement delta,
        TelemetryContext telemetryContext) =>
        DomainBridge.ParseValueObject<EventId, Guid>(Guid.NewGuid()).Bind((EventId eventId) =>
            EventEnvelope.Create(
                eventId: eventId,
                eventType: eventType,
                identity: identity,
                causationRequestId: causationRequestId,
                delta: delta,
                telemetryContext: telemetryContext)
            .Map((EventEnvelope eventEnvelope) => {
                _ = _eventPublisher.Publish(eventEnvelope);
                return unit;
            }));
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
        OperationTag operationTag) {
        Guid requestGuid = (Guid)requestId;
        string traceIdValue = requestGuid.ToString("N");
        string spanIdValue = Guid.NewGuid().ToString("N")[..16];
        return DomainBridge.ParseValueObject<TraceId, string>(traceIdValue).Bind((TraceId traceId) =>
            DomainBridge.ParseValueObject<SpanId, string>(spanIdValue).Bind((SpanId spanId) =>
                TelemetryContext.Create(
                    traceId: traceId,
                    spanId: spanId,
                    operationTag: operationTag,
                    attempt: 1)));
    }
}
