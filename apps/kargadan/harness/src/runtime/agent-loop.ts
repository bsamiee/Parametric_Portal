import { Duration, Effect, Fiber, Match, Option, Ref, Schema as S, pipe } from 'effect';
import { AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Operation, type Envelope } from '../protocol/schemas';
import { HarnessConfig } from '../config';
import { CommandDispatch, CommandDispatchError } from '../protocol/dispatch';

// --- [TYPES] -----------------------------------------------------------------

type LoopState = typeof _LoopStateCodec.Type & {
    readonly command:      Option.Option<Envelope.Command>;
    readonly identityBase: Envelope.IdentityBase;
};

// --- [SCHEMA] ----------------------------------------------------------------

const _LoopStateCodec = S.Struct({
    attempt:          S.Int.pipe(S.greaterThanOrEqualTo(1)),
    correctionCycles: S.Int.pipe(S.greaterThanOrEqualTo(0)),
    operations:       S.Array(Operation),
    sequence:         S.Int.pipe(S.greaterThanOrEqualTo(0)),
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
        const _persistCall = (
            identity: { readonly appId: string; readonly correlationId: string; readonly sessionId: string },
            loopState: unknown,
            call: { readonly durationMs: number; readonly error: Option.Option<string>; readonly operation: string; readonly params: Record<string, unknown>; readonly result: Option.Option<unknown>; readonly sequence: number; readonly status: 'ok' | 'error' },
        ) => persistence.persist({
            appId: identity.appId,
            checkpoint: { chatJson: '', loopState, sceneSummary: Option.none(), sequence: call.sequence, sessionId: identity.sessionId },
            toolCall: { ...call, correlationId: identity.correlationId, sessionId: identity.sessionId },
        });
        const persistInboundEvent = (eventEnvelope: Envelope.Event) =>
            Effect.gen(function* () {
                const start = performance.now();
                const sequence = yield* Ref.modify(eventSequence, (current) => [current, current + 1] as const);
                const batchSummary = Match.value(eventEnvelope).pipe(
                    Match.when({ eventType: 'stream.compacted' }, (streamEvent) => Option.some(streamEvent.delta)),
                    Match.orElse(() => Option.none()),
                );
                yield* _persistCall(eventEnvelope, { eventType: eventEnvelope.eventType, sequence }, {
                    durationMs: _elapsed(start),
                    error:      Option.none(),
                    operation:  `transport.event.${eventEnvelope.eventType}`,
                    params:     {
                        causationRequestId: eventEnvelope.causationRequestId,
                        delta:              eventEnvelope.delta,
                        eventType:          eventEnvelope.eventType,
                        sourceRevision:     eventEnvelope.sourceRevision,
                        ...(Option.isSome(batchSummary) ? { batchSummary: batchSummary.value } : {}),
                    },
                    result:   Option.some({ eventId: eventEnvelope.eventId }),
                    sequence,
                    status:   'ok',
                });
                return { eventEnvelope, sequence, totalCount: Option.isSome(batchSummary) ? batchSummary.value.totalCount : 0 } as const;
            });
        const persistResult = (state: LoopState, command: Envelope.Command, result: Envelope.Result, start: number) => {
            const verified = result.status === 'ok';
            const failureReason = {
                code:         result.error?.code ?? ('UNKNOWN_FAILURE' as const),
                details:      result.error?.details,
                failureClass: result.error?.failureClass ?? ('fatal' as const),
                message:      result.error?.message ?? 'Result error payload is missing',
            };
            const seq = state.sequence + 1;
            const next = { ...state, command: Option.some(command), sequence: seq };
            const failed: LoopState = { ...next, status: 'Failed' };
            const remaining = state.operations.slice(1);
            const done: LoopState = remaining.length === 0
                ? { ...next, command: Option.none(), operations: [], status: 'Completed' }
                : { ...next, attempt: 1, command: Option.none(), correctionCycles: 0, operations: remaining, status: 'Planning' };
            const decide = verified
                ? Effect.succeed(done)
                : Match.value(failureReason.failureClass).pipe(
                    Match.when('compensatable', () =>
                        _persistCall(state.identityBase, _loopSnapshot(failed), {
                            durationMs: 0,
                            error:      Option.some(failureReason.code),
                            operation:  'command.compensate',
                            params:     { code: failureReason.code, compensation: 'required' },
                            result:     Option.none(),
                            sequence:   seq + 1,
                            status:     'error' as const,
                        }).pipe(Effect.as(failed)),
                    ),
                    Match.when('correctable', () =>
                        Effect.succeed(
                            state.correctionCycles < correctionMax
                                ? ({ ...next, attempt: state.attempt + 1, correctionCycles: state.correctionCycles + 1, status: 'Planning' } satisfies LoopState)
                                : failed,
                        ),
                    ),
                    Match.when('fatal', () => Effect.logError('kargadan.fatal', failureReason).pipe(Effect.as(failed))),
                    Match.when('retryable', () =>
                        Effect.succeed(
                            state.attempt < retryMax
                                ? ({ ...next, attempt: state.attempt + 1, status: 'Planning' } satisfies LoopState)
                                : failed,
                        ),
                    ),
                    Match.exhaustive,
                );
            return decide.pipe(
                Effect.flatMap((resolvedState) =>
                    _persistCall(state.identityBase, _loopSnapshot(resolvedState), {
                        durationMs: _elapsed(start),
                        error:      verified ? Option.none() : Option.some(failureReason.message),
                        operation:  verified ? 'command.completed' : 'command.failed',
                        params:     { dedupe: result.dedupe, operation: command.operation, status: result.status },
                        result:     Option.some({ dedupe: result.dedupe, status: result.status, verified }),
                        sequence:   seq,
                        status:     verified ? 'ok' as const : 'error' as const,
                    }).pipe(Effect.as(resolvedState)),
                ),
            );
        };
        const execute = (state: LoopState, command: Envelope.Command) => {
            const start = performance.now();
            return dispatch.execute(command).pipe(
                Effect.catchTag('CommandDispatchError', (error) =>
                    Effect.succeed({
                        _tag:          'result',
                        appId:         command.appId,
                        correlationId: command.correlationId,
                        dedupe:        { decision: 'rejected', originalRequestId: command.requestId },
                        error:         { code: 'DISPATCH_ERROR', details: error, failureClass: error.failureClass ?? 'retryable', message: error.message },
                        requestId:     command.requestId,
                        sessionId:     command.sessionId,
                        status:        'error',
                    } satisfies Envelope.Result),
                ),
                Effect.flatMap((result) => persistResult(state, command, result, start)),
            );
        };
        const plan = (state: LoopState) =>
            Effect.gen(function* () {
                const start = performance.now();
                const { identityBase: base, sequence } = state;
                const existingCommand = state.command;
                const buildFallback = (operation: typeof Operation.Type): Envelope.Command => {
                    const isWrite = operation.startsWith('write.');
                    const payload = isWrite
                        ? ({ operationId: `${base.correlationId}:${sequence}`, patch: { layer: 'default', name: 'phase-3' } } as const)
                        : ({ includeAttributes: true, scope: 'active' } as const);
                    return {
                        _tag:        'command', ...base, deadlineMs: commandDeadlineMs,
                        idempotency: isWrite ? persistence.idempotency({ correlationId: base.correlationId, payload, sequence }) : undefined,
                        objectRefs:  [writeObjectRef], operation, payload, requestId: crypto.randomUUID(),
                        undoScope:   isWrite ? 'kargadan.phase3' : undefined,
                    };
                };
                const fallbackCommand = pipe(Option.fromNullable(state.operations[0]), Option.map(buildFallback));
                const command = yield* pipe(
                    existingCommand,
                    Option.orElse(() => fallbackCommand),
                    Option.match({ onNone: () => Effect.fail(new CommandDispatchError({ details: { message: 'No operation available for PLAN' }, reason: 'protocol' })), onSome: Effect.succeed }),
                );
                yield* _persistCall(state.identityBase, _loopSnapshot(state), {
                    durationMs: _elapsed(start),
                    error:      Option.none(),
                    operation:  'command.plan',
                    params:     { operation: command.operation, status: state.status },
                    result:     Option.some({ operation: command.operation }),
                    sequence:   state.sequence + 1,
                    status:     'ok' as const,
                });
                return yield* execute(state, command);
            });
        const run = Effect.fn('AgentLoop.handle')((input: { readonly identityBase: Envelope.IdentityBase; readonly resume: Option.Option<{ readonly sequence: number; readonly state: unknown }>; readonly token: string }) =>
            Effect.gen(function* () {
                const ack = yield* dispatch.handshake({ ...input.identityBase, requestId: crypto.randomUUID(), token: input.token });
                const base: Envelope.IdentityBase = { ...input.identityBase, appId: ack.appId, correlationId: ack.correlationId, sessionId: ack.sessionId };
                const baselineState: LoopState = { attempt: 1, command: Option.none(), correctionCycles: 0, identityBase: base, operations, sequence: 0, status: 'Planning' };
                const resumeData = Option.getOrNull(input.resume);
                const initialState: LoopState = resumeData === null
                    ? baselineState
                    : yield* S.decodeUnknown(_LoopStateCodec)(resumeData.state).pipe(
                        Effect.map((restored): LoopState => ({ ...restored, command: Option.none(), identityBase: base, sequence: Math.max(restored.sequence, resumeData.sequence) })),
                        Effect.tap((r) => Effect.log('kargadan.harness.resume.restored', { operations: r.operations.length, sequence: r.sequence, sessionId: r.identityBase.sessionId, status: r.status })),
                        Effect.catchAll((e) => Effect.logWarning('kargadan.harness.resume.decode.failed', { error: String(e), sequence: resumeData.sequence, sessionId: base.sessionId }).pipe(Effect.as({ ...baselineState, sequence: resumeData.sequence }))),
                    );
                yield* Ref.set(eventSequence, Math.max(1_000_000, initialState.sequence + 1));
                const heartbeatLoop = dispatch.heartbeat(base).pipe(
                    Effect.tap((hb) => Effect.logDebug('kargadan.harness.heartbeat', { correlationId: hb.correlationId, mode: hb.mode, requestId: hb.requestId })),
                    Effect.catchAll((error) => Effect.logWarning('kargadan.harness.heartbeat.failed', { correlationId: base.correlationId, error: String(error) })),
                    Effect.zipRight(Effect.sleep(Duration.millis(heartbeatIntervalMs))),
                    Effect.forever,
                );
                const inboundLoop = dispatch.takeEvent().pipe(
                    Effect.flatMap(persistInboundEvent),
                    Effect.tap((es) => Effect.logDebug('kargadan.harness.transport.event', { batchCount: es.totalCount, correlationId: es.eventEnvelope.correlationId, eventId: es.eventEnvelope.eventId, eventType: es.eventEnvelope.eventType, requestId: es.eventEnvelope.requestId, sequence: es.sequence })),
                    Effect.catchAll((error) => Effect.logWarning('kargadan.harness.transport.event.failed', { correlationId: base.correlationId, error: String(error) })),
                    Effect.forever,
                );
                const fibers = yield* Effect.all([Effect.fork(inboundLoop), Effect.fork(heartbeatLoop)]);
                const finalState = yield* Effect.iterate(initialState, { body: plan, while: (state) => state.status !== 'Completed' && state.status !== 'Failed' }).pipe(Effect.ensuring(Effect.forEach(fibers, Fiber.interrupt, { discard: true })));
                const trace = yield* persistence.sessionTrace({
                    appId:     finalState.identityBase.appId,
                    sessionId: finalState.identityBase.sessionId,
                });
                return { state: finalState, trace } as const;
            }),
        );
        return { handle: run } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AgentLoop };
