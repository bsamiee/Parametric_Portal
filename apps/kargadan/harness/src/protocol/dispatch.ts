/**
 * Consolidates Kargadan session state supervision and protocol dispatch in one service module.
 * Orchestrates handshake negotiation, command execution, heartbeat round-trips, and inbound event streaming.
 */
import { Data, Duration, Effect, Match, Ref } from 'effect';
import { HarnessConfig } from '../config';
import { KargadanSocketClient } from '../socket';
import {
    CommandAckSchema, CommandEnvelopeSchema, EnvelopeIdentitySchema, EventEnvelopeSchema,
    FailureReasonSchema, HandshakeEnvelopeSchema, HeartbeatEnvelopeSchema,
    InboundEnvelopeSchema, OutboundEnvelopeSchema, ResultEnvelopeSchema, TelemetryContextSchema,
} from './schemas';

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
    readonly failureClass?: typeof FailureReasonSchema.fields.failureClass.Type;
}> {
    static readonly of = (
        reason: CommandDispatchError['reason'],
        details?: unknown,
        failureClass?: typeof FailureReasonSchema.fields.failureClass.Type,
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
        const _request = Effect.fn('CommandDispatch.request')((envelope: Extract<typeof OutboundEnvelopeSchema.Type, { readonly identity: unknown }>) =>
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
            (input: { readonly identity: typeof EnvelopeIdentitySchema.Type; readonly token: string; readonly traceId: string }) =>
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
                    } satisfies typeof HandshakeEnvelopeSchema.Type;
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
        const _execute = Effect.fn('CommandDispatch.execute')((command: typeof CommandEnvelopeSchema.Type) =>
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
        const _heartbeat = Effect.fn('CommandDispatch.heartbeat')((identity: typeof EnvelopeIdentitySchema.Type, traceId: string, attempt = 1) => {
            const requestId = crypto.randomUUID();
            const envelope: typeof HeartbeatEnvelopeSchema.Type = {
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
