/**
 * Protocol envelope schemas for the Kargadan harness WebSocket protocol.
 * Pure schema definitions with zero service/config dependencies -- imported by dispatch, socket, config, and agent-loop.
 */
import { Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const TelemetryContextSchema = S.Struct({
    attempt:      S.Int.pipe(S.greaterThanOrEqualTo(1)),
    operationTag: S.NonEmptyTrimmedString,
    spanId:       S.String.pipe(S.pattern(/^[A-Fa-f0-9]{8,64}$/)),
    traceId:      S.String.pipe(S.pattern(/^[A-Fa-f0-9]{8,64}$/)),
});
const EnvelopeIdentitySchema = S.Struct({
    appId:           S.UUID,
    issuedAt:        S.DateFromString,
    protocolVersion: S.Struct({ major: S.Int.pipe(S.greaterThanOrEqualTo(0)), minor: S.Int.pipe(S.greaterThanOrEqualTo(0)) }),
    requestId:       S.UUID,
    runId:           S.UUID,
    sessionId:       S.UUID,
});
const FailureReasonSchema = S.Struct({
    code:         S.NonEmptyTrimmedString,
    failureClass: S.Literal('retryable', 'correctable', 'compensatable', 'fatal'),
    message:      S.NonEmptyTrimmedString,
});
const IdempotencySchema = S.Struct({
    idempotencyKey: S.String.pipe(S.pattern(/^[A-Za-z0-9:_-]{8,128}$/)),
    payloadHash:    S.String.pipe(S.pattern(/^[a-f0-9]{64}$/)),
});
const HandshakeEnvelopeSchema = S.Union(
    S.Struct({
        _tag:             S.Literal('handshake.init'),
        auth:             S.Struct({ token: S.NonEmptyTrimmedString, tokenExpiresAt: S.DateFromString, tokenIssuedAt: S.DateFromString }),
        capabilities:     S.Struct({ optional: S.Array(S.NonEmptyTrimmedString), required: S.Array(S.NonEmptyTrimmedString) }),
        identity:         EnvelopeIdentitySchema,
        telemetryContext: TelemetryContextSchema,
    }),
    S.Struct({
        _tag:                 S.Literal('handshake.ack'),
        acceptedCapabilities: S.Array(S.NonEmptyTrimmedString),
        identity:             EnvelopeIdentitySchema,
        server:               S.Struct({ pluginRevision: S.NonEmptyTrimmedString, rhinoVersion: S.NonEmptyTrimmedString }),
        telemetryContext:     TelemetryContextSchema,
    }),
    S.Struct({
        _tag:             S.Literal('handshake.reject'),
        identity:         EnvelopeIdentitySchema,
        reason:           FailureReasonSchema,
        telemetryContext: TelemetryContextSchema,
    }),
);
const CommandEnvelopeSchema = S.Struct({
    _tag:             S.Literal('command'),
    deadlineMs:       S.Int.pipe(S.greaterThan(0)),
    idempotency:      S.optional(IdempotencySchema),
    identity:         EnvelopeIdentitySchema,
    objectRefs:       S.optional(S.Array(S.Struct({
        objectId:       S.UUID,
        sourceRevision: S.Int.pipe(S.greaterThanOrEqualTo(0)),
        typeTag:        S.Literal('Brep', 'Mesh', 'Curve', 'Surface', 'Annotation', 'Instance', 'LayoutDetail'),
    }))),
    operation:        S.Literal(
        'read.scene.summary', 'read.object.metadata', 'read.object.geometry', 'read.layer.state', 'read.view.state',
        'read.tolerance.units', 'write.object.create', 'write.object.update', 'write.object.delete', 'write.layer.update',
        'write.viewport.update', 'write.annotation.update', 'script.run',
    ),
    payload:          S.Unknown,
    telemetryContext: TelemetryContextSchema,
    undoScope:        S.optional(S.NonEmptyTrimmedString),
});
const ResultEnvelopeSchema = S.Struct({
    _tag:             S.Literal('result'),
    dedupe:           S.Struct({ decision: S.Literal('executed', 'duplicate', 'rejected'), originalRequestId: S.UUID }),
    error:            S.optional(S.Struct({ details: S.optional(S.Unknown), reason: FailureReasonSchema })),
    execution:        S.Struct({ durationMs: S.Int.pipe(S.greaterThanOrEqualTo(0)), pluginRevision: S.NonEmptyTrimmedString, sourceRevision: S.Int.pipe(S.greaterThanOrEqualTo(0)) }),
    identity:         EnvelopeIdentitySchema,
    result:           S.Unknown,
    status:           S.Literal('ok', 'error'),
    telemetryContext: TelemetryContextSchema,
});
const EventEnvelopeSchema = S.Struct({
    _tag:               S.Literal('event'),
    causationRequestId: S.optional(S.UUID),
    delta:              S.Unknown,
    eventId:            S.UUID,
    eventType:          S.Literal('objects.changed', 'layers.changed', 'view.changed', 'undo.redo', 'session.lifecycle', 'stream.compacted', 'selection.changed', 'material.changed', 'properties.changed', 'tables.changed'),
    identity:           EnvelopeIdentitySchema,
    sourceRevision:     S.Int.pipe(S.greaterThanOrEqualTo(0)),
    telemetryContext:   TelemetryContextSchema,
});
const HeartbeatEnvelopeSchema = S.Struct({
    _tag:             S.Literal('heartbeat'),
    identity:         EnvelopeIdentitySchema,
    mode:             S.Literal('ping', 'pong'),
    serverTime:       S.DateFromString,
    telemetryContext: TelemetryContextSchema,
});
const CommandAckSchema = S.Struct({
    _tag:      S.Literal('command.ack'),
    requestId: S.UUID,
});
const InboundEnvelopeSchema = S.Union(
    HandshakeEnvelopeSchema, HeartbeatEnvelopeSchema, EventEnvelopeSchema, ResultEnvelopeSchema,
);
const OutboundEnvelopeSchema = S.Union(
    HandshakeEnvelopeSchema, CommandEnvelopeSchema, HeartbeatEnvelopeSchema, CommandAckSchema,
);

// --- [EXPORT] ----------------------------------------------------------------

export {
    CommandAckSchema, CommandEnvelopeSchema, EnvelopeIdentitySchema, EventEnvelopeSchema,
    FailureReasonSchema, HandshakeEnvelopeSchema, HeartbeatEnvelopeSchema, IdempotencySchema,
    InboundEnvelopeSchema, OutboundEnvelopeSchema, ResultEnvelopeSchema, TelemetryContextSchema,
};
