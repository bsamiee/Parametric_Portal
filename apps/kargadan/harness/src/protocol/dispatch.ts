import { Data, Duration, Effect, Match, Ref } from 'effect';
import { HarnessConfig } from '../config';
import { KargadanSocketClient } from '../socket';
import type { Envelope } from './schemas';

// --- [CONSTANTS] -------------------------------------------------------------

const _DispatchPolicy = {
    disconnected: { code: 'DISPATCH_DISCONNECTED',  failureClass: 'retryable' },
    protocol:     { code: 'DISPATCH_PROTOCOL',      failureClass: 'fatal'     },
    rejected:     { code: 'DISPATCH_REJECTED',      failureClass: 'fatal'     },
    transport:    { code: 'DISPATCH_TRANSPORT',     failureClass: 'retryable' },
} as const satisfies Record<string, { code: string; failureClass: Envelope.FailureClass }>;

// --- [ERRORS] ----------------------------------------------------------------

class CommandDispatchError extends Data.TaggedError('CommandDispatchError')<{
    readonly reason:        keyof typeof _DispatchPolicy;
    readonly details?:      unknown;
    readonly failureClass?: Envelope.FailureClass;
}> {
    get code() { return _DispatchPolicy[this.reason].code; }
    get retryable() { return this.resolvedFailureClass === 'retryable'; }
    get resolvedFailureClass(): Envelope.FailureClass { return this.failureClass ?? _DispatchPolicy[this.reason].failureClass; }
    get errorPayload() { return { code: this.code, details: this.details, failureClass: this.resolvedFailureClass, message: this.message } as const; }
    override get message() {
        const prefix = `CommandDispatch/${this.reason}`;
        return this.details === undefined ? prefix : `${prefix}: ${JSON.stringify(this.details)}`;
    }
}

// --- [SERVICES] --------------------------------------------------------------

class CommandDispatch extends Effect.Service<CommandDispatch>()('kargadan/CommandDispatch', {
    effect: Effect.gen(function* () {
        const socket = yield* KargadanSocketClient;
        const cfg = yield* HarnessConfig;
        const { commandDeadlineMs, protocolVersion, resolveCapabilities: capabilities, tokenExpiryMinutes } = cfg;
        const catalogRef = yield* Ref.make<ReadonlyArray<Envelope.CatalogEntry>>([]);
        const phaseRef = yield* Ref.make<'connecting' | 'active' | 'closed'>('connecting');
        const _request = Effect.fn('CommandDispatch.request')((envelope: Envelope.Outbound) =>
            socket.request(envelope).pipe(
                Effect.catchTag('SocketClientError', (error) => Ref.set(phaseRef, 'closed').pipe(
                    Effect.andThen(Effect.fail(new CommandDispatchError({
                        details: { socketDetails: error.details, socketReason: error.reason },
                        reason: Match.value(error.reason).pipe(
                            Match.when('protocol', () => 'protocol' as const),
                            Match.orElse(() => error.terminal ? 'disconnected' as const : 'transport' as const)),
                    }))))),
            ));
        const handshake = Effect.fn('CommandDispatch.handshake')(
            ({ token, ...identity }: Envelope.Identity & { readonly token: string }) =>
                _request({ _tag: 'handshake.init', ...identity,
                    auth: { token, tokenExpiresAt: new Date(Date.now() + Duration.toMillis(Duration.minutes(tokenExpiryMinutes))) },
                    capabilities, protocolVersion,
                    telemetryContext: { attempt: 1, operationTag: 'handshake.init', spanId: identity.requestId.replaceAll('-', ''), traceId: identity.correlationId },
                }).pipe(Effect.flatMap((response) => Match.value(response).pipe(
                    Match.tag('handshake.ack', (ack) => Effect.all([
                        Ref.set(phaseRef, 'active'), Ref.set(catalogRef, ack.catalog), Effect.log('kargadan.session.authenticated'),
                    ], { discard: true }).pipe(Effect.as(ack))),
                    Match.tag('handshake.reject', (r) => Effect.fail(new CommandDispatchError({ details: { code: r.code, message: r.message }, failureClass: r.failureClass, reason: 'rejected' }))),
                    Match.orElse((reply) => Effect.fail(new CommandDispatchError({ details: { expected: 'handshake.ack|handshake.reject', received: reply._tag }, reason: 'protocol' })))))));
        const execute = Effect.fn('CommandDispatch.execute')((command: Envelope.Command) =>
            _request(command).pipe(Effect.flatMap((response) => Match.value(response).pipe(
                Match.tag('result', Effect.succeed),
                Match.orElse((reply) => Effect.fail(new CommandDispatchError({ details: { expected: 'result', received: reply._tag }, reason: 'protocol' })))))));
        const heartbeat = Effect.fn('CommandDispatch.heartbeat')((base: Envelope.IdentityBase) =>
            _request({ _tag: 'heartbeat', ...base, mode: 'ping', requestId: crypto.randomUUID() }).pipe(
                Effect.flatMap((response) => Match.value(response).pipe(
                    Match.when({ _tag: 'heartbeat', mode: 'pong' as const }, Effect.succeed),
                    Match.orElse((reply) => Effect.fail(new CommandDispatchError({ details: { expected: 'heartbeat.pong', received: reply._tag }, reason: 'protocol' })))))));
        const receiveCatalog = Effect.fn('CommandDispatch.receiveCatalog')(() => Ref.get(catalogRef));
        const buildCommand = (identityBase: Envelope.IdentityBase, commandId: string, args: Record<string, unknown>, options?: {
            readonly attempt?:    number; readonly deadlineMs?: number; readonly idempotency?: Envelope.Command['idempotency'];
            readonly objectRefs?: Envelope.Command['objectRefs']; readonly operationTag?: string;
            readonly requestId?:  string; readonly undoScope?: Envelope.Command['undoScope'];
        }): Envelope.Command => {
            const requestId = options?.requestId ?? crypto.randomUUID();
            return {
                _tag: 'command', ...identityBase, args, commandId, deadlineMs: options?.deadlineMs ?? commandDeadlineMs,
                idempotency: options?.idempotency, objectRefs: options?.objectRefs, requestId,
                telemetryContext: { attempt: Math.max(1, options?.attempt ?? 1), operationTag: options?.operationTag ?? commandId,
                    spanId: requestId.replaceAll('-', ''), traceId: identityBase.correlationId },
                undoScope:  options?.undoScope,
            };
        };
        const buildErrorResult = (command: Envelope.Command, error: Envelope.ErrorPayload): Envelope.Result => ({
            _tag: 'result', appId: command.appId, correlationId: command.correlationId,
            dedupe: { decision: 'rejected', originalRequestId: command.requestId },
            error, requestId: command.requestId, sessionId: command.sessionId, status: 'error',
        });
        return { buildCommand, buildErrorResult, execute, handshake, heartbeat, phase: Ref.get(phaseRef), receiveCatalog, start: socket.start, takeEvent: socket.takeEvent } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { CommandDispatch, CommandDispatchError };
