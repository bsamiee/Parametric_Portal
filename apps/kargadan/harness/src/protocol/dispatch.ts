/**
 * Consolidates Kargadan session state supervision and protocol dispatch in one service module.
 * Orchestrates handshake negotiation, command execution, heartbeat round-trips, and inbound event streaming.
 */
import type { Kargadan } from '@parametric-portal/types/kargadan';
import { Data, Duration, Effect, Match, Ref, Schema as S } from 'effect';
import { HarnessConfig } from '../config';
import { KargadanSocketClient } from '../socket';

// --- [TYPES] -----------------------------------------------------------------

type _SessionTransition = Data.TaggedEnum<{
    Activate:     { readonly at:        Date   };
    Authenticate: { readonly at:        Date   };
    Beat:         { readonly at:        Date   };
    Close:        { readonly reason?:   string };
    Connect:      { readonly sessionId: string };
    Reap:         { readonly reason:    string };
    Reject:       { readonly reason:    string };
    Timeout:      { readonly reason:    string };
}>;
type _SessionState = {
    readonly heartbeatAt: Date | undefined;
    readonly phase: 'idle' | 'connected' | 'authenticated' | 'active' | 'closed' | 'timed_out' | 'reaped' | 'rejected';
    readonly reason:      string | undefined;
    readonly sessionId:   string | undefined;
};

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

// --- [CONSTANTS] -------------------------------------------------------------

const SessionTransition = Data.taggedEnum<_SessionTransition>();

// --- [SUPERVISOR] ------------------------------------------------------------

class SessionSupervisor extends Effect.Service<SessionSupervisor>()('kargadan/SessionSupervisor', {
    effect: Effect.gen(function* () {
        const state = yield* Ref.make<_SessionState>({ heartbeatAt: undefined, phase: 'idle', reason: undefined, sessionId: undefined });
        const _transition = Effect.fn('kargadan.session.transition')((event: _SessionTransition) =>
            Ref.update(state, (current) => ({
                ...current,
                ...Match.valueTags(event, {
                    Activate:     ({ at }) => ({ heartbeatAt: at, phase: 'active' as const, reason: undefined }),
                    Authenticate: ({ at }) => ({ heartbeatAt: at, phase: 'authenticated' as const, reason: undefined }),
                    Beat:         ({ at }) => ({ heartbeatAt: at }),
                    Close:        ({ reason }) => ({ heartbeatAt: undefined, phase: 'closed' as const, reason, sessionId: undefined }),
                    Connect:      ({ sessionId }) => ({ heartbeatAt: undefined, phase: 'connected' as const, reason: undefined, sessionId }),
                    Reap:         ({ reason }) => ({ heartbeatAt: undefined, phase: 'reaped' as const, reason, sessionId: undefined }),
                    Reject:       ({ reason }) => ({ heartbeatAt: undefined, phase: 'rejected' as const, reason, sessionId: undefined }),
                    Timeout:      ({ reason }) => ({ heartbeatAt: undefined, phase: 'timed_out' as const, reason, sessionId: undefined }),
                }),
            })),
        );
        const _snapshot = Effect.fn('kargadan.session.snapshot')(() => Ref.get(state));
        return { read: { snapshot: _snapshot }, transition: _transition } as const;
    }),
}) {}

// --- [ERRORS] ----------------------------------------------------------------

class CommandDispatchError extends Data.TaggedError('CommandDispatchError')<{
    readonly reason: 'disconnected' | 'protocol' | 'rejected' | 'transport';
    readonly details?: unknown;
    readonly failureClass?: Kargadan.FailureClass;
}> {
    static readonly of = (
        reason: CommandDispatchError['reason'],
        details?: unknown,
        failureClass?: Kargadan.FailureClass,
    ) => new CommandDispatchError({ details, reason, ...(failureClass === undefined ? {} : { failureClass }) });
    override get message() {
        const formatted = typeof this.details === 'string' ? this.details : JSON.stringify(this.details);
        const detail = this.details === undefined ? '' : `: ${formatted}`;
        return `CommandDispatch/${this.reason}${detail}`;
    }
}

// --- [SERVICES] --------------------------------------------------------------

class CommandDispatch extends Effect.Service<CommandDispatch>()('kargadan/CommandDispatch', {
    effect: Effect.gen(function* () {
        const [session, socket] = yield* Effect.all([SessionSupervisor, KargadanSocketClient]);
        const _request = Effect.fn('CommandDispatch.request')((envelope: Kargadan.OutboundEnvelope) =>
            socket.write.request(envelope).pipe(
                Effect.catchTag('SocketClientError', (error) =>
                    Match.value(error.issue).pipe(
                        Match.tag('Disconnected', ({ reason }) => Effect.fail(CommandDispatchError.of('disconnected', { reason })),),
                        Match.orElse((issue) => Effect.fail(CommandDispatchError.of('transport', { issue })),),
                    ),
                ),
            ),
        );
        const _handshake = Effect.fn('CommandDispatch.handshake')(
            (input: { readonly identity: Kargadan.EnvelopeIdentity; readonly token: string; readonly traceId: string }) =>
                Effect.gen(function* () {
                    const capabilities = yield* HarnessConfig.resolveCapabilities;
                    yield* session.transition(SessionTransition.Connect({ sessionId: input.identity.sessionId }));
                    const envelope = {
                        _tag: 'handshake.init',
                        auth: {
                            token:         input.token,
                            tokenExpiresAt: new Date(Date.now() + Duration.toMillis(Duration.minutes(15))),
                            tokenIssuedAt:  new Date(),
                        },
                        capabilities,
                        identity: input.identity,
                        telemetryContext: {
                            attempt:      1,
                            operationTag: 'handshake',
                            spanId:       input.identity.requestId.replaceAll('-', ''),
                            traceId:      input.traceId,
                        },
                    } satisfies Kargadan.HandshakeEnvelope;
                    const response = yield* _request(envelope);
                    return yield* Match.value(response).pipe(
                        Match.tag('handshake.ack', (ack) =>
                            session.transition(SessionTransition.Authenticate({ at: new Date() })).pipe(
                                Effect.zipRight(session.transition(SessionTransition.Activate({ at: new Date() }))),
                                Effect.as(ack),
                            ),
                        ),
                        Match.tag('handshake.reject', (reject) => session.transition(SessionTransition.Reject({ reason: reject.reason.message })).pipe(Effect.zipRight(Effect.fail(CommandDispatchError.of('rejected', reject.reason, reject.reason.failureClass)))),),
                        Match.orElse((other) => Effect.fail(CommandDispatchError.of('protocol', { expected: 'handshake.ack|handshake.reject', received: other._tag }))),
                    );
                }),
        );
        const _execute = Effect.fn('CommandDispatch.execute')((command: Kargadan.CommandEnvelope) =>
            _request(command).pipe(
                Effect.flatMap((response) =>
                    Match.value(response).pipe(
                        Match.tag('result', (result) => Effect.succeed(result)),
                        Match.tag('handshake.reject', (reject) => Effect.fail(CommandDispatchError.of('rejected', reject.reason, reject.reason.failureClass))),
                        Match.orElse((other) => Effect.fail(CommandDispatchError.of('protocol', { expected: 'result', received: other._tag }))),
                    ),
                ),
            ),
        );
        const _heartbeat = Effect.fn('CommandDispatch.heartbeat')((identity: Kargadan.EnvelopeIdentity, traceId: string, attempt = 1) => {
            const requestId = crypto.randomUUID();
            const envelope: Kargadan.HeartbeatEnvelope = {
                _tag: 'heartbeat',
                identity: { ...identity, issuedAt: new Date(), requestId },
                mode: 'ping',
                serverTime: new Date(),
                telemetryContext: { attempt, operationTag: 'heartbeat', spanId: requestId.replaceAll('-', ''), traceId },
            };
            return _request(envelope).pipe(
                Effect.flatMap((response) =>
                    Match.value(response).pipe(
                        Match.when({ _tag: 'heartbeat', mode: 'pong' }, (hb) => session.transition(SessionTransition.Beat({ at: new Date() })).pipe(Effect.as(hb)),),
                        Match.tag('heartbeat', (hb) =>
                            session.transition(SessionTransition.Timeout({ reason: 'heartbeat-missing-pong' })).pipe(
                                Effect.zipRight(Effect.fail(CommandDispatchError.of('protocol', { expected: 'pong', received: hb.mode }))),
                            ),
                        ),
                        Match.orElse((other) =>
                            session.transition(SessionTransition.Timeout({ reason: 'heartbeat-invalid-response' })).pipe(
                                Effect.zipRight(Effect.fail(CommandDispatchError.of('protocol', { expected: 'heartbeat', received: other._tag }))),
                            ),
                        ),
                    ),
                ),
            );
        });
        const _start = Effect.fn('CommandDispatch.start')(() => socket.lifecycle.start());
        const _takeEvent = Effect.fn('CommandDispatch.takeEvent')(() => socket.read.takeEvent());
        return {
            command:   { execute: _execute },
            protocol:  { handshake: _handshake, heartbeat: _heartbeat },
            transport: { start: _start, takeEvent: _takeEvent },
        } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export {
    CommandAckSchema, CommandDispatch, CommandDispatchError, CommandEnvelopeSchema,
    EnvelopeIdentitySchema, EventEnvelopeSchema, FailureReasonSchema,
    HandshakeEnvelopeSchema, HeartbeatEnvelopeSchema, InboundEnvelopeSchema,
    OutboundEnvelopeSchema, ResultEnvelopeSchema, SessionSupervisor, SessionTransition,
    TelemetryContextSchema,
};
