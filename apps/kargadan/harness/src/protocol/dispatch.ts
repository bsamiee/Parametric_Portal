import { Data, Duration, Effect, Match, Ref } from 'effect';
import { HarnessConfig } from '../config';
import { KargadanSocketClient } from '../socket';
import type { Envelope } from './schemas';

// --- [ERRORS] ----------------------------------------------------------------

class CommandDispatchError extends Data.TaggedError('CommandDispatchError')<{
    readonly reason:        'disconnected' | 'protocol' | 'rejected' | 'transport';
    readonly details?:      unknown;
    readonly failureClass?: Envelope.FailureClass;
}> {
    override get message() {
        const prefix = `CommandDispatch/${this.reason}`;
        return this.details === undefined ? prefix : `${prefix}: ${JSON.stringify(this.details)}`;
    }
}

// --- [SERVICES] --------------------------------------------------------------

class CommandDispatch extends Effect.Service<CommandDispatch>()('kargadan/CommandDispatch', {
    effect: Effect.gen(function* () {
        const socket = yield* KargadanSocketClient;
        const [capabilities, protocolVersion] = yield* Effect.all([HarnessConfig.resolveCapabilities, HarnessConfig.protocolVersion]);
        const phaseRef = yield* Ref.make<'connecting' | 'active' | 'closed'>('connecting');
        const _request = Effect.fn('CommandDispatch.request')((envelope: Envelope.Outbound) =>
            socket.write.request(envelope).pipe(
                Effect.catchTag('SocketClientError', (error) =>
                    Ref.set(phaseRef, 'closed').pipe(
                        Effect.andThen(Effect.fail(new CommandDispatchError(
                            error.reason === 'disconnected'
                                ? { details: error.details, reason: 'disconnected' as const }
                                : { details: { details: error.details, reason: error.reason }, reason: 'transport' as const },
                        ))),
                    ),
                ),
            ),
        );
        const handshake = Effect.fn('CommandDispatch.handshake')(
            ({ token, ...identity }: Envelope.Identity & { readonly token: string }) =>
                _request({ _tag: 'handshake.init', ...identity, auth: { token, tokenExpiresAt: new Date(Date.now() + Duration.toMillis(Duration.minutes(15))) }, capabilities, protocolVersion }).pipe(
                    Effect.flatMap((response) =>
                        Match.value(response).pipe(
                            Match.tag('handshake.ack', (ack) =>
                                Ref.set(phaseRef, 'active').pipe(Effect.andThen(Effect.log('kargadan.session.authenticated')), Effect.as(ack))),
                            Match.tag('handshake.reject', (reject) =>
                                Effect.fail(new CommandDispatchError({ details: reject.reason, failureClass: reject.reason.failureClass, reason: 'rejected' }))),
                            Match.orElse((other) =>
                                Effect.fail(new CommandDispatchError({ details: { expected: 'handshake.ack|handshake.reject', received: other._tag }, reason: 'protocol' }))),
                        ),
                    ),
                ),
        );
        const execute = Effect.fn('CommandDispatch.execute')((command: Envelope.Command) =>
            _request(command).pipe(
                Effect.flatMap((response) =>
                    Match.value(response).pipe(
                        Match.tag('result', (result) => Effect.succeed(result)),
                        Match.orElse((other) => Effect.fail(new CommandDispatchError({ details: { expected: 'result', received: other._tag }, reason: 'protocol' }))),
                    ),
                ),
            ),
        );
        const heartbeat = Effect.fn('CommandDispatch.heartbeat')((base: Envelope.IdentityBase) =>
            _request({ _tag: 'heartbeat', ...base, mode: 'ping', requestId: crypto.randomUUID() }).pipe(
                Effect.flatMap((response) =>
                    Match.value(response).pipe(
                        Match.when({ _tag: 'heartbeat', mode: 'pong' }, (heartbeat) => Effect.succeed(heartbeat)),
                        Match.orElse((other) => Effect.fail(new CommandDispatchError({ details: { expected: 'heartbeat.pong', received: other._tag }, reason: 'protocol' }))),
                    ),
                ),
            ),
        );
        return { execute, handshake, heartbeat, phase: Ref.get(phaseRef), start: socket.lifecycle.start, takeEvent: socket.read.takeEvent } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { CommandDispatch, CommandDispatchError };
