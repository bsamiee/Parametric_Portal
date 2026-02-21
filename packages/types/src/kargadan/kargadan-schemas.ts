/**
 * Defines Effect Schema contracts for Kargadan WebSocket protocol envelopes and run orchestration artifacts.
 * Exports single Kargadan namespace merging runtime schemas with derived TypeScript types; decode at all inbound boundaries.
 */
import { Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const ProtocolVersionSchema = S.Struct({
    major: S.Int.pipe(S.greaterThanOrEqualTo(0)),
    minor: S.Int.pipe(S.greaterThanOrEqualTo(0)),
});
const TelemetryContextSchema = S.Struct({
    attempt:      S.Int.pipe(S.greaterThanOrEqualTo(1)),
    operationTag: S.NonEmptyTrimmedString,
    spanId:       S.String.pipe(S.pattern(/^[A-Fa-f0-9]{8,64}$/)),
    traceId:      S.String.pipe(S.pattern(/^[A-Fa-f0-9]{8,64}$/)),
});
const EnvelopeIdentitySchema = S.Struct({
    appId:           S.UUID,
    issuedAt:        S.DateFromString,
    protocolVersion: ProtocolVersionSchema,
    requestId:       S.UUID,
    runId:           S.UUID,
    sessionId:       S.UUID,
});
const FailureClassSchema = S.Literal('retryable', 'correctable', 'compensatable', 'fatal');
const IdempotencySchema = S.Struct({
    idempotencyKey: S.String.pipe(S.pattern(/^[A-Za-z0-9:_-]{8,128}$/)),
    payloadHash:    S.String.pipe(S.pattern(/^[a-f0-9]{64}$/)),
});
const CommandOperationSchema = S.Literal(
    'read.scene.summary',    'read.object.metadata', 'read.object.geometry', 'read.layer.state',    'read.view.state',
    'read.tolerance.units',  'write.object.create',  'write.object.update',  'write.object.delete', 'write.layer.update',
    'write.viewport.update', 'write.annotation.update',
);
const SceneObjectTypeSchema = S.Literal('Brep', 'Mesh', 'Curve', 'Surface', 'Annotation', 'Instance', 'LayoutDetail');
const SceneObjectRefSchema = S.Struct({
    objectId:       S.UUID,
    sourceRevision: S.Int.pipe(S.greaterThanOrEqualTo(0)),
    typeTag:        SceneObjectTypeSchema,
});
const FailureReasonSchema = S.Struct({
    code:         S.NonEmptyTrimmedString,
    failureClass: FailureClassSchema,
    message:      S.NonEmptyTrimmedString,
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
    objectRefs:       S.optional(S.Array(SceneObjectRefSchema)),
    operation:        CommandOperationSchema,
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
    eventType:          S.Literal('objects.changed', 'layers.changed', 'view.changed', 'undo.redo', 'session.lifecycle', 'stream.compacted'),
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
const RunStatusSchema =    S.Literal('Created', 'Planning', 'Executing', 'Verifying', 'Persisting', 'Paused', 'Compensating', 'Completed', 'Failed');
const ArtifactTypeSchema = S.Literal('decision', 'constraint', 'fact', 'verification', 'incident');
const RunEventSchema = S.Struct({
    appId:            S.UUID,
    createdAt:        S.DateFromSelf,
    eventId:          S.UUID,
    eventType:        S.NonEmptyTrimmedString,
    idempotency:      S.optional(IdempotencySchema),
    payload:          S.Unknown,
    requestId:        S.UUID,
    runId:            S.UUID,
    sequence:         S.Int.pipe(S.greaterThanOrEqualTo(1)),
    sessionId:        S.UUID,
    telemetryContext: TelemetryContextSchema,
});
const RunSnapshotSchema = S.Struct({
    appId:        S.UUID,
    createdAt:    S.DateFromSelf,
    runId:        S.UUID,
    sequence:     S.Int.pipe(S.greaterThanOrEqualTo(1)),
    snapshotHash: S.NonEmptyTrimmedString,
    state:        S.Unknown,
});
const RetrievalArtifactSchema = S.Struct({
    appId:               S.UUID,
    artifactId:          S.UUID,
    artifactType:        ArtifactTypeSchema,
    body:                S.NonEmptyString,
    createdAt:           S.DateFromSelf,
    metadata:            S.Unknown,
    runId:               S.UUID,
    sourceEventSequence: S.Int.pipe(S.greaterThanOrEqualTo(1)),
    title:               S.NonEmptyTrimmedString,
    updatedAt:           S.DateFromSelf,
});

// --- [UNIONS] ----------------------------------------------------------------

const InboundEnvelopeSchema = S.Union(
    HandshakeEnvelopeSchema, HeartbeatEnvelopeSchema, EventEnvelopeSchema,
    ResultEnvelopeSchema,
);
const OutboundEnvelopeSchema = S.Union(
    HandshakeEnvelopeSchema, HeartbeatEnvelopeSchema, CommandEnvelopeSchema,
);

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Kargadan = {
    CommandEnvelopeSchema, CommandOperationSchema, EventEnvelopeSchema, FailureReasonSchema, HandshakeEnvelopeSchema, HeartbeatEnvelopeSchema,
    IdempotencySchema, InboundEnvelopeSchema, OutboundEnvelopeSchema, ProtocolVersionSchema, ResultEnvelopeSchema, RetrievalArtifactSchema,
    RunEventSchema, RunSnapshotSchema, RunStatusSchema, TelemetryContextSchema,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Kargadan {
    export type CommandEnvelope =   typeof CommandEnvelopeSchema.Type;
    export type CommandOperation =  typeof CommandOperationSchema.Type;
    export type EnvelopeIdentity =  typeof EnvelopeIdentitySchema.Type;
    export type EventEnvelope =     typeof EventEnvelopeSchema.Type;
    export type FailureClass =      typeof FailureClassSchema.Type;
    export type FailureReason =     typeof FailureReasonSchema.Type;
    export type HandshakeEnvelope = typeof HandshakeEnvelopeSchema.Type;
    export type HeartbeatEnvelope = typeof HeartbeatEnvelopeSchema.Type;
    export type InboundEnvelope =   typeof InboundEnvelopeSchema.Type;
    export type OutboundEnvelope =  typeof OutboundEnvelopeSchema.Type;
    export type ProtocolVersion =   typeof ProtocolVersionSchema.Type;
    export type ResultEnvelope =    typeof ResultEnvelopeSchema.Type;
    export type RetrievalArtifact = typeof RetrievalArtifactSchema.Type;
    export type RunEvent =          typeof RunEventSchema.Type;
    export type RunSnapshot =       typeof RunSnapshotSchema.Type;
    export type TelemetryContext =  typeof TelemetryContextSchema.Type;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Kargadan };
