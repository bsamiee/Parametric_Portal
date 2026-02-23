/**
 * Orchestrates Kargadan WebSocket protocol surface: handshake negotiation, command execution, heartbeat round-trips, and inbound event streaming.
 * Bridges KargadanSocketClient and SessionSupervisor into a single typed service; all failure paths surface as CommandDispatchError variants.
 * Propagates DisconnectedError from transport layer as CommandDispatchError('disconnected') so callers can trigger reconnection flow.
 */
import type { Kargadan } from '@parametric-portal/types/kargadan';
import { Data, Duration, Effect, Match } from 'effect';
import { HarnessConfig } from '../config';
import { SessionSupervisor, SessionTransition } from './supervisor';
import { KargadanSocketClient } from '../socket';
import { DisconnectedError } from '../transport/reconnect';

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
                Effect.catchIf(
                    (error): error is DisconnectedError => error instanceof DisconnectedError,
                    (error) => Effect.fail(CommandDispatchError.of('disconnected', error.reason)),
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
                            token:   input.token,
                            tokenExpiresAt: new Date(Date.now() + Duration.toMillis(Duration.minutes(15))),
                            tokenIssuedAt:  new Date(),
                        },
                        capabilities,
                        identity:    input.identity,
                        telemetryContext: {
                            attempt: 1,
                            operationTag: 'handshake',
                            spanId:  input.identity.requestId.replaceAll('-', ''),
                            traceId: input.traceId,
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
                        Match.tag('handshake.reject', (reject) =>
                            session.transition(SessionTransition.Reject({ reason: reject.reason.message })).pipe(
                                Effect.zipRight(
                                    Effect.fail(CommandDispatchError.of('rejected', reject.reason, reject.reason.failureClass)),
                                ),
                            ),
                        ),
                        Match.orElse((other) =>
                            Effect.fail(
                                CommandDispatchError.of('protocol', { expected: 'handshake.ack|handshake.reject', received: other._tag }),
                            ),
                        ),
                    );
                }),
        );
        const _execute = Effect.fn('CommandDispatch.execute')((command: Kargadan.CommandEnvelope) =>
            _request(command).pipe(
                Effect.flatMap((response) =>
                    Match.value(response).pipe(
                        Match.tag('result', (result) => Effect.succeed(result)),
                        Match.tag('handshake.reject', (reject) =>
                            Effect.fail(CommandDispatchError.of('rejected', reject.reason, reject.reason.failureClass)),
                        ),
                        Match.orElse((other) =>
                            Effect.fail(CommandDispatchError.of('protocol', { expected: 'result', received: other._tag })),
                        ),
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
                        Match.when({ _tag: 'heartbeat', mode: 'pong' }, (hb) =>
                            session.transition(SessionTransition.Beat({ at: new Date() })).pipe(Effect.as(hb)),
                        ),
                        Match.tag('heartbeat', (hb) =>
                            session.transition(SessionTransition.Timeout({ reason: 'heartbeat-missing-pong' })).pipe(
                                Effect.zipRight(
                                    Effect.fail(CommandDispatchError.of('protocol', { expected: 'pong', received: hb.mode })),
                                ),
                            ),
                        ),
                        Match.orElse((other) =>
                            session.transition(SessionTransition.Timeout({ reason: 'heartbeat-invalid-response' })).pipe(
                                Effect.zipRight(
                                    Effect.fail(CommandDispatchError.of('protocol', { expected: 'heartbeat', received: other._tag })),
                                ),
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

export { CommandDispatch, CommandDispatchError };
