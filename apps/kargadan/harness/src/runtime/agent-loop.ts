import { Duration, Effect, Fiber, Match, Option, Ref, Schema as S, pipe } from 'effect';
import { AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { NonNegInt, Operation, type Envelope } from '../protocol/schemas';
import { HarnessConfig } from '../config';
import { CommandDispatch, CommandDispatchError } from '../protocol/dispatch';

// --- [TYPES] -----------------------------------------------------------------

type LoopState = typeof _LoopStateCodec.Type & {
    readonly command:      Option.Option<Envelope.Command>;
    readonly identityBase: Envelope.IdentityBase;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _RecoveryPolicy = {
    compensatable: { canRetry: false, preAction: 'compensate', usesCorrections: false },
    correctable:   { canRetry: true,  preAction: 'none',       usesCorrections: true  },
    fatal:         { canRetry: false, preAction: 'log',        usesCorrections: false },
    retryable:     { canRetry: true,  preAction: 'none',       usesCorrections: false },
} as const satisfies Record<Envelope.FailureClass, { canRetry: boolean; preAction: 'compensate' | 'log' | 'none'; usesCorrections: boolean }>;

// --- [SCHEMA] ----------------------------------------------------------------

const _LoopStateCodec = S.Struct({
    attempt:          S.Int.pipe(S.greaterThanOrEqualTo(1)),
    correctionCycles: NonNegInt,
    operations:       S.Array(Operation),
    sequence:         NonNegInt,
    status:           S.Literal('Planning', 'Completed', 'Failed'),
});

// --- [FUNCTIONS] -------------------------------------------------------------

const _loopSnapshot = ({ attempt, correctionCycles, operations, sequence, status }: LoopState) =>
    ({ attempt, correctionCycles, operations, sequence, status });
const _elapsed = (start: number) => Math.max(0, Math.round(performance.now() - start));

// --- [SERVICES] --------------------------------------------------------------

class AgentLoop extends Effect.Service<AgentLoop>()('kargadan/AgentLoop', {
    effect: Effect.gen(function* () {
        const [dispatch, persistence, commandDeadlineMs, retryMax, correctionMax, heartbeatIntervalMs, operations, writeObjectRef] = yield* Effect.all([
            CommandDispatch, AgentPersistenceService, HarnessConfig.commandDeadlineMs,   HarnessConfig.retryMaxAttempts,
            HarnessConfig.correctionCycles,           HarnessConfig.heartbeatIntervalMs, HarnessConfig.resolveLoopOperations,
            HarnessConfig.resolveWriteObjectRef,
        ]);
        const eventSequence = yield* Ref.make(1_000_000);
        const persistInboundEvent = (eventEnvelope: Envelope.Event) =>
            Effect.gen(function* () {
                const start = performance.now();
                const sequence = yield* Ref.modify(eventSequence, (current) => [current, current + 1] as const);
                const [batchSummary, totalCount] = Match.value(eventEnvelope).pipe(
                    Match.when({ eventType: 'stream.compacted' }, (e) => [e.delta, e.delta.totalCount] as const),
                    Match.orElse(() => [undefined, 0] as const));
                yield* persistence.persistCall(eventEnvelope, { eventType: eventEnvelope.eventType, sequence }, {
                    durationMs: _elapsed(start), error: Option.none(), operation: `transport.event.${eventEnvelope.eventType}`,
                    params: { causationRequestId: eventEnvelope.causationRequestId, delta: eventEnvelope.delta,
                        eventType: eventEnvelope.eventType, sourceRevision: eventEnvelope.sourceRevision, ...(batchSummary ? { batchSummary } : {}) },
                    result: Option.some({ eventId: eventEnvelope.eventId }), sequence, status: 'ok',
                });
                return { eventEnvelope, sequence, totalCount } as const;
            });
        const persistResult = (state: LoopState, command: Envelope.Command, result: Envelope.Result, start: number) => {
            const ok = result.status === 'ok';
            const seq = state.sequence + 1;
            const next = { ...state, command: Option.some(command), sequence: seq };
            const failed: LoopState = { ...next, status: 'Failed' };
            const remaining = state.operations.slice(1);
            const done: LoopState = remaining.length === 0
                ? { ...next, command: Option.none(), operations: [], status: 'Completed' }
                : { ...next, attempt: 1, command: Option.none(), correctionCycles: 0, operations: remaining, status: 'Planning' };
            const fc = result.error?.failureClass ?? ('fatal' as const);
            const policy = _RecoveryPolicy[fc];
            const withinLimit = policy.canRetry && (policy.usesCorrections ? state.correctionCycles < correctionMax : state.attempt < retryMax);
            const retried: LoopState = { ...next, attempt: state.attempt + 1, correctionCycles: state.correctionCycles + (policy.usesCorrections ? 1 : 0), status: 'Planning' };
            const failureState: LoopState = withinLimit ? retried : failed;
            const nextState: LoopState = ok ? done : failureState;
            const compensateCall = persistence.persistCall(state.identityBase, _loopSnapshot(failed), {
                durationMs: 0, error: Option.some(result.error?.code ?? 'UNKNOWN_FAILURE'), operation: 'command.compensate',
                params: { code: result.error?.code ?? 'UNKNOWN_FAILURE', compensation: 'required' },
                result: Option.none(), sequence: seq + 1, status: 'error' as const,
            }).pipe(Effect.asVoid);
            const preEffect = ok ? Effect.void : Match.value(policy.preAction).pipe(
                Match.when('compensate', () => compensateCall),
                Match.when('log', () => Effect.logError('kargadan.fatal', { code: result.error?.code, message: result.error?.message })),
                Match.when('none', () => Effect.void),
                Match.exhaustive);
            return preEffect.pipe(Effect.as(nextState), Effect.flatMap((resolved) =>
                persistence.persistCall(state.identityBase, _loopSnapshot(resolved), {
                    durationMs: _elapsed(start), error: ok ? Option.none() : Option.some(result.error?.message ?? 'Result error payload is missing'),
                    operation: ok ? 'command.completed' : 'command.failed', params: { dedupe: result.dedupe, operation: command.operation, status: result.status },
                    result: Option.some({ dedupe: result.dedupe, status: result.status, verified: ok }), sequence: seq, status: ok ? 'ok' as const : 'error' as const,
                }).pipe(Effect.as(resolved))));
        };
        const execute = (state: LoopState, command: Envelope.Command) => {
            const start = performance.now();
            return dispatch.execute(command).pipe(
                Effect.catchTag('CommandDispatchError', (error) => Effect.succeed({
                    _tag: 'result', appId: command.appId, correlationId: command.correlationId,
                    dedupe: { decision: 'rejected', originalRequestId: command.requestId },
                    error: { code: 'DISPATCH_ERROR', details: error, failureClass: error.failureClass ?? 'retryable', message: error.message },requestId: command.requestId, sessionId: command.sessionId,status: 'error',
                } satisfies Envelope.Result)),
                Effect.flatMap((result) => persistResult(state, command, result as Envelope.Result, start)),
            );
        };
        const plan = (state: LoopState) =>
            Effect.gen(function* () {
                const start = performance.now();
                const { identityBase: base, sequence } = state;
                const fallback = pipe(Option.fromNullable(state.operations[0]), Option.map((operation): Envelope.Command => {
                    const isWrite = operation.startsWith('write.');
                    const payload = isWrite ? { operationId: `${base.correlationId}:${sequence}`, patch: { layer: 'default', name: 'phase-3' } } as const
                        : { includeAttributes: true, scope: 'active' } as const;
                    return { _tag: 'command', ...base, deadlineMs: commandDeadlineMs,
                        idempotency: isWrite ? persistence.idempotency(base.correlationId, payload, sequence) : undefined, objectRefs: [writeObjectRef], operation, payload, requestId: crypto.randomUUID(),undoScope: isWrite ? 'kargadan.phase3' : undefined };
                }));
                const command = yield* pipe(state.command, Option.orElse(() => fallback),
                    Option.match({ onNone: () => Effect.fail(new CommandDispatchError({ details: { message: 'No operation available for PLAN' }, reason: 'protocol' })), onSome: Effect.succeed }));
                yield* persistence.persistCall(state.identityBase, _loopSnapshot(state), {
                    durationMs: _elapsed(start), error: Option.none(), operation: 'command.plan',
                    params: { operation: command.operation, status: state.status }, result: Option.some({ operation: command.operation }), sequence: state.sequence + 1, status: 'ok' as const,
                });
                return yield* execute(state, command);
            });
        const run = Effect.fn('AgentLoop.handle')((input: { readonly identityBase: Envelope.IdentityBase; readonly resume: Option.Option<{ readonly sequence: number; readonly state: unknown }>; readonly token: string }) =>
            Effect.gen(function* () {
                const ack = yield* dispatch.handshake({ ...input.identityBase, requestId: crypto.randomUUID(), token: input.token });
                const base: Envelope.IdentityBase = { ...input.identityBase, appId: ack.appId, correlationId: ack.correlationId, sessionId: ack.sessionId };
                const baseline: LoopState = { attempt: 1, command: Option.none(), correctionCycles: 0, identityBase: base, operations, sequence: 0, status: 'Planning' };
                const resumeData = Option.getOrNull(input.resume);
                const initialState: LoopState = resumeData === null ? baseline
                    : yield* S.decodeUnknown(_LoopStateCodec)(resumeData.state).pipe(
                        Effect.map((restored): LoopState => ({ ...restored, command: Option.none(), identityBase: base, sequence: Math.max(restored.sequence, resumeData.sequence) })),
                        Effect.tap((r) => Effect.log('kargadan.harness.resume.restored', { operations: r.operations.length, sequence: r.sequence, status: r.status })),
                        Effect.catchAll((e) => Effect.logWarning('kargadan.harness.resume.decode.failed', { error: String(e) }).pipe(Effect.as({ ...baseline, sequence: resumeData.sequence }))),
                    );
                yield* Ref.set(eventSequence, Math.max(1_000_000, initialState.sequence + 1));
                const heartbeatLoop = dispatch.heartbeat(base).pipe(
                    Effect.tap(() => Effect.logDebug('kargadan.harness.heartbeat')),
                    Effect.catchAll((error) => Effect.logWarning('kargadan.harness.heartbeat.failed', { error: String(error) })),
                    Effect.zipRight(Effect.sleep(Duration.millis(heartbeatIntervalMs))), Effect.forever);
                const inboundLoop = dispatch.takeEvent().pipe(Effect.flatMap(persistInboundEvent),
                    Effect.tap((es) => Effect.logDebug('kargadan.harness.transport.event', { eventType: es.eventEnvelope.eventType, sequence: es.sequence })),
                    Effect.catchAll((error) => Effect.logWarning('kargadan.harness.transport.event.failed', { error: String(error) })), Effect.forever);
                const fibers = yield* Effect.all([Effect.fork(inboundLoop), Effect.fork(heartbeatLoop)]);
                const finalState = yield* Effect.iterate(initialState, { body: plan, while: (s) => s.status !== 'Completed' && s.status !== 'Failed' })
                    .pipe(Effect.ensuring(Effect.forEach(fibers, Fiber.interrupt, { discard: true })));
                const trace = yield* persistence.trace(finalState.identityBase.sessionId);
                return { state: finalState, trace } as const;
            }),
        );
        return { handle: run } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AgentLoop };
