import { Data, Duration, Effect, Match, Ref } from 'effect';
import { HarnessConfig } from '../config';
import { KargadanSocketClient } from '../socket';
import type { Envelope } from './schemas';
// --- [CONSTANTS] -------------------------------------------------------------

const _DispatchPolicy = {
    disconnected: { retryable: true  },
    protocol:     { retryable: false },
    rejected:     { retryable: false },
    transport:    { retryable: true  },
} as const satisfies Record<string, { retryable: boolean }>;

// --- [ERRORS] ----------------------------------------------------------------

class CommandDispatchError extends Data.TaggedError('CommandDispatchError')<{
    readonly reason:        keyof typeof _DispatchPolicy;
    readonly details?:      unknown;
    readonly failureClass?: Envelope.FailureClass;
}> {
    get retryable() { return _DispatchPolicy[this.reason].retryable; }
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
        const _protocolError = (expected: string) => (actual: Envelope.PendingReply) =>
            Effect.fail(new CommandDispatchError({ details: { expected, received: actual._tag }, reason: 'protocol' }));
        const _request = Effect.fn('CommandDispatch.request')((envelope: Envelope.Outbound) =>
            socket.request(envelope).pipe(
                Effect.catchTag('SocketClientError', (error) => Ref.set(phaseRef, 'closed').pipe(
                    Effect.andThen(Effect.fail(new CommandDispatchError({
                        details: { socketDetails: error.details, socketReason: error.reason },
                        reason:  error.terminal ? 'disconnected' : 'transport',
                    }))))),
            ));
        const handshake = Effect.fn('CommandDispatch.handshake')(
            ({ token, ...identity }: Envelope.Identity & { readonly token: string }) =>
                _request({ _tag: 'handshake.init', ...identity, auth: { token, tokenExpiresAt: new Date(Date.now() + Duration.toMillis(Duration.minutes(15))) }, capabilities, protocolVersion }).pipe(
                    Effect.flatMap((response) => Match.value(response).pipe(
                        Match.tag('handshake.ack', (ack) => Ref.set(phaseRef, 'active').pipe(Effect.andThen(Effect.log('kargadan.session.authenticated')), Effect.as(ack))),
                        Match.tag('handshake.reject', (r) => Effect.fail(new CommandDispatchError({ details: { code: r.code, message: r.message }, failureClass: r.failureClass, reason: 'rejected' }))),
                        Match.orElse(_protocolError('handshake.ack|handshake.reject'))))));
        const execute = Effect.fn('CommandDispatch.execute')((command: Envelope.Command) =>
            _request(command).pipe(Effect.flatMap((response) => Match.value(response).pipe(
                Match.tag('result', Effect.succeed), Match.orElse(_protocolError('result'))))));
        const heartbeat = Effect.fn('CommandDispatch.heartbeat')((base: Envelope.IdentityBase) =>
            _request({ _tag: 'heartbeat', ...base, mode: 'ping', requestId: crypto.randomUUID() }).pipe(
                Effect.flatMap((response) => Match.value(response).pipe(
                    Match.when({ _tag: 'heartbeat', mode: 'pong' }, Effect.succeed), Match.orElse(_protocolError('heartbeat.pong'))))));
        return { execute, handshake, heartbeat, phase: Ref.get(phaseRef), start: socket.start, takeEvent: socket.takeEvent } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { CommandDispatch, CommandDispatchError };
