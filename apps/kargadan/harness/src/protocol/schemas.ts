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
const OperationSchema = S.Literal(
    'read.scene.summary', 'read.object.metadata', 'read.object.geometry', 'read.layer.state', 'read.view.state',
    'read.tolerance.units', 'write.object.create', 'write.object.update', 'write.object.delete', 'write.layer.update',
    'write.viewport.update', 'write.annotation.update', 'script.run',
);
const ObjectRefSchema = S.Struct({ objectId: S.UUID, sourceRevision: S.Int.pipe(S.greaterThanOrEqualTo(0)), typeTag: S.Literal('Brep', 'Mesh', 'Curve', 'Surface', 'Annotation', 'Instance', 'LayoutDetail') });
const _envelope =       S.Struct({ appId: S.UUID, requestId: S.UUID, runId: S.UUID, sessionId: S.UUID, traceId: S.String.pipe(S.pattern(/^[A-Fa-f0-9]{8,64}$/)) });
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
    S.extend(_envelope, S.Struct({
        _tag:               S.Literal('event'),
        causationRequestId: S.optional(S.UUID),
        delta:              S.Unknown,
        eventId:            S.UUID,
        eventType:          S.Literal('objects.changed', 'layers.changed', 'view.changed', 'undo.redo', 'session.lifecycle', 'stream.compacted', 'selection.changed', 'material.changed', 'properties.changed', 'tables.changed'),
        sourceRevision:     S.Int.pipe(S.greaterThanOrEqualTo(0)),
    })),
    S.extend(_envelope, S.Struct({
        _tag:   S.Literal('result'),
        dedupe: S.Struct({ decision: S.Literal('executed', 'duplicate', 'rejected'), originalRequestId: S.UUID }),
        error:  S.optional(S.Struct({ details: S.optional(S.Unknown), reason: FailureReasonSchema })),
        status: S.Literal('ok', 'error'),
    })),
);

// --- [EXPORT] ----------------------------------------------------------------

export { EnvelopeSchema, FailureReasonSchema, ObjectRefSchema, OperationSchema };
