import { Data, Duration, Effect, Match, Ref } from 'effect';
import { HarnessConfig } from '../config';
import { KargadanSocketClient } from '../socket';
import type { EnvelopeSchema, FailureReasonSchema } from './schemas';

// --- [ERRORS] ----------------------------------------------------------------

class CommandDispatchError extends Data.TaggedError('CommandDispatchError')<{
    readonly reason: 'disconnected' | 'protocol' | 'rejected' | 'transport';
    readonly details?: unknown;
    readonly failureClass?: typeof FailureReasonSchema.fields.failureClass.Type;
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
        const _request = Effect.fn('CommandDispatch.request')((envelope: typeof EnvelopeSchema.Type) =>
            socket.write.request(envelope).pipe(
                Effect.catchTag('SocketClientError', (error) =>
                    Ref.set(phaseRef, 'closed').pipe(
                        Effect.andThen(Effect.fail(new CommandDispatchError(
                            error.issue._tag === 'Disconnected'
                                ? { details: { reason: error.issue.reason }, reason: 'disconnected' }
                                : { details: { issue: error.issue }, reason: 'transport' },
                        ))),
                    ),
                ),
            ),
        );
        const handshake = Effect.fn('CommandDispatch.handshake')(
            ({ token, ...identity }: { readonly appId: string; readonly requestId: string; readonly runId: string; readonly sessionId: string; readonly token: string; readonly traceId: string }) =>
                _request({ _tag: 'handshake.init', ...identity, auth: { token, tokenExpiresAt: new Date(Date.now() + Duration.toMillis(Duration.minutes(15))) }, capabilities, protocolVersion } satisfies typeof EnvelopeSchema.Type).pipe(
                    Effect.flatMap((response) =>
                        Match.value(response).pipe(
                            Match.tag('handshake.ack', (ack) => Ref.set(phaseRef, 'active').pipe(Effect.andThen(Effect.log('kargadan.session.authenticated')), Effect.as(ack))),
                            Match.tag('handshake.reject', (reject) => Effect.fail(new CommandDispatchError({ details: reject.reason, failureClass: reject.reason.failureClass, reason: 'rejected' }))),
                            Match.orElse((other) => Effect.fail(new CommandDispatchError({ details: { expected: 'handshake.ack|handshake.reject', received: other._tag }, reason: 'protocol' }))),
                        ),
                    ),
                ),
        );
        const execute = Effect.fn('CommandDispatch.execute')((command: Extract<typeof EnvelopeSchema.Type, {_tag: 'command'}>) =>
            _request(command).pipe(
                Effect.flatMap((response) =>
                    response._tag === 'result'
                        ? Effect.succeed(response)
                        : Effect.fail(new CommandDispatchError({ details: { expected: 'result', received: response._tag }, reason: 'protocol' })),
                ),
            ),
        );
        const heartbeat = Effect.fn('CommandDispatch.heartbeat')((base: { readonly appId: string; readonly runId: string; readonly sessionId: string; readonly traceId: string }) =>
            _request({ _tag: 'heartbeat', ...base, mode: 'ping', requestId: crypto.randomUUID() } satisfies Extract<typeof EnvelopeSchema.Type, {_tag: 'heartbeat'}>).pipe(
                Effect.flatMap((response) =>
                    response._tag === 'heartbeat' && response.mode === 'pong'
                        ? Effect.succeed(response)
                        : Effect.fail(new CommandDispatchError({ details: { expected: 'heartbeat.pong', received: response._tag }, reason: 'protocol' })),
                ),
            ),
        );
        return { execute, handshake, heartbeat, phase: Ref.get(phaseRef), start: socket.lifecycle.start, takeEvent: socket.read.takeEvent } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { CommandDispatch, CommandDispatchError };
