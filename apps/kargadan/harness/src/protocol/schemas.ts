/**
 * Protocol envelope schemas for the Kargadan harness WebSocket protocol.
 */
import { Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const FailureReasonSchema = S.Struct({
    code:         S.NonEmptyTrimmedString,
    failureClass: S.Literal('retryable', 'correctable', 'compensatable', 'fatal'),
    message:      S.NonEmptyTrimmedString,
});
const EventSubtypeSchema = S.Literal('added', 'deleted', 'replaced', 'modified', 'undeleted', 'selected', 'deselected', 'deselect_all', 'properties_changed');
const EventTypeSchema =    S.Literal('objects.changed', 'layers.changed', 'view.changed', 'undo.redo', 'session.lifecycle', 'stream.compacted', 'selection.changed', 'material.changed', 'properties.changed', 'tables.changed');
const OperationSchema =    S.Literal(
    'read.scene.summary', 'read.object.metadata', 'read.object.geometry', 'read.layer.state', 'read.view.state',
    'read.tolerance.units', 'write.object.create', 'write.object.update', 'write.object.delete', 'write.layer.update',
    'write.viewport.update', 'write.annotation.update', 'script.run',
);
const DEFAULT_LOOP_OPERATIONS = ['read.object.metadata', 'write.object.update'] as const satisfies ReadonlyArray<typeof OperationSchema.Type>;
const ObjectRefSchema = S.Struct({ objectId: S.UUID, sourceRevision: S.Int.pipe(S.greaterThanOrEqualTo(0)), typeTag: S.Literal('Brep', 'Mesh', 'Curve', 'Surface', 'Annotation', 'Instance', 'LayoutDetail') });
const _envelope =       S.Struct({ appId: S.UUID, requestId: S.UUID, runId: S.UUID, sessionId: S.UUID, traceId: S.String.pipe(S.pattern(/^[A-Fa-f0-9]{8,64}$/)) });
const StreamCompactedDeltaSchema = S.Struct({
    batchWindowMs:    S.Int.pipe(S.greaterThanOrEqualTo(0)),
    categories:       S.Array(S.Struct({ category: EventTypeSchema, count: S.Int.pipe(S.greaterThanOrEqualTo(0)), subtypes: S.Array(S.Struct({ count: S.Int.pipe(S.greaterThanOrEqualTo(0)), subtype: EventSubtypeSchema })) })),
    containsUndoRedo: S.Boolean,
    totalCount:       S.Int.pipe(S.greaterThanOrEqualTo(0)),
});
const UndoRedoDeltaSchema = S.Struct({ isUndo: S.Boolean, requestId: S.UUID, undoSerial: S.Int.pipe(S.greaterThanOrEqualTo(0)) });
const SessionLifecycleDeltaSchema = S.Union(
    S.Struct({ dedupeDecision: S.Literal('executed', 'duplicate', 'rejected'), status: S.Literal('ok') }),
    S.Struct({ errorCode: S.NonEmptyTrimmedString, failureClass: S.Literal('retryable', 'correctable', 'compensatable', 'fatal'), status: S.Literal('error') }),
);
const ObservationDeltaSchema = S.Struct({
    isUndoRedo:  S.optional(S.Boolean),
    objectId:    S.optional(S.UUID),
    objectType:  S.optional(S.NonEmptyTrimmedString),
    oldObjectId: S.optional(S.UUID),
    subtype:     EventSubtypeSchema,
});
const EventEnvelopeSchema = S.Union(
    S.extend(_envelope, S.Struct({
        _tag:               S.Literal('event'),
        causationRequestId: S.optional(S.UUID),
        delta:              ObservationDeltaSchema,
        eventId:            S.UUID,
        eventType:          S.Literal('objects.changed', 'layers.changed', 'view.changed', 'selection.changed', 'material.changed', 'properties.changed', 'tables.changed'),
        sourceRevision:     S.Int.pipe(S.greaterThanOrEqualTo(0)),
    })),
    S.extend(_envelope, S.Struct({
        _tag:               S.Literal('event'),
        causationRequestId: S.optional(S.UUID),
        delta:              UndoRedoDeltaSchema,
        eventId:            S.UUID,
        eventType:          S.Literal('undo.redo'),
        sourceRevision:     S.Int.pipe(S.greaterThanOrEqualTo(0)),
    })),
    S.extend(_envelope, S.Struct({
        _tag:               S.Literal('event'),
        causationRequestId: S.optional(S.UUID),
        delta:              SessionLifecycleDeltaSchema,
        eventId:            S.UUID,
        eventType:          S.Literal('session.lifecycle'),
        sourceRevision:     S.Int.pipe(S.greaterThanOrEqualTo(0)),
    })),
    S.extend(_envelope, S.Struct({
        _tag:               S.Literal('event'),
        causationRequestId: S.optional(S.UUID),
        delta:              StreamCompactedDeltaSchema,
        eventId:            S.UUID,
        eventType:          S.Literal('stream.compacted'),
        sourceRevision:     S.Int.pipe(S.greaterThanOrEqualTo(0)),
    })),
);
const EnvelopeSchema =  S.Union(
    S.extend(_envelope, S.Struct({
        _tag:        S.Literal('command'),
        attempt:     S.Int.pipe(S.greaterThanOrEqualTo(1)),
        deadlineMs:  S.Int.pipe(S.greaterThan(0)),
        idempotency: S.optional(S.Struct({ idempotencyKey: S.String.pipe(S.pattern(/^[A-Za-z0-9:_-]{8,128}$/)), payloadHash: S.String.pipe(S.pattern(/^[a-f0-9]{64}$/)) })),
        objectRefs:  S.optional(S.Array(ObjectRefSchema)),
        operation:   OperationSchema,
        payload:     S.Unknown,
        undoScope:   S.optional(S.NonEmptyTrimmedString),
    })),
    S.extend(_envelope,  S.Struct({
        _tag:            S.Literal('handshake.init'),
        auth:            S.Struct({ token: S.NonEmptyTrimmedString, tokenExpiresAt: S.DateFromString }),
        capabilities:    S.Struct({ optional: S.Array(S.NonEmptyTrimmedString), required: S.Array(S.NonEmptyTrimmedString) }),
        protocolVersion: S.Struct({ major: S.Int.pipe(S.greaterThanOrEqualTo(0)), minor: S.Int.pipe(S.greaterThanOrEqualTo(0)) }),
    })),
    S.extend(_envelope, S.Struct({ _tag: S.Literal('handshake.ack'), protocolVersion: S.Struct({ major: S.Int.pipe(S.greaterThanOrEqualTo(0)), minor: S.Int.pipe(S.greaterThanOrEqualTo(0)) }) })),
    S.extend(_envelope, S.Struct({ _tag: S.Literal('handshake.reject'), reason: FailureReasonSchema })),
    S.extend(_envelope, S.Struct({ _tag: S.Literal('command.ack') })),
    S.extend(_envelope, S.Struct({ _tag: S.Literal('heartbeat'), mode: S.Literal('ping', 'pong') })),
    EventEnvelopeSchema,
    S.extend(_envelope, S.Struct({
        _tag:   S.Literal('result'),
        dedupe: S.Struct({ decision: S.Literal('executed', 'duplicate', 'rejected'), originalRequestId: S.UUID }),
        error:  S.optional(S.Struct({ details: S.optional(S.Unknown), reason: FailureReasonSchema })),
        status: S.Literal('ok', 'error'),
    })),
);

// --- [EXPORT] ----------------------------------------------------------------

export { DEFAULT_LOOP_OPERATIONS, EnvelopeSchema, ObjectRefSchema, OperationSchema, StreamCompactedDeltaSchema };
