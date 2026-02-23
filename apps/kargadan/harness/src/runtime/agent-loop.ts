import { Duration, Effect, Fiber, Match, Option, Ref, Schema as S, pipe } from 'effect';
import type { EnvelopeSchema, OperationSchema } from '../protocol/schemas';
import { HarnessConfig } from '../config';
import { PersistenceService } from '../persistence/checkpoint';
import type { KargadanCheckpoint } from '../persistence/models';
import { CommandDispatch, CommandDispatchError } from '../protocol/dispatch';

// --- [TYPES] -----------------------------------------------------------------

type Command = Extract<typeof EnvelopeSchema.Type, {_tag: 'command'}>;
type Result = Extract<typeof EnvelopeSchema.Type, {_tag: 'result'}>;
type IdentityBase = { readonly appId: string; readonly runId: string; readonly sessionId: string; readonly traceId: string };
type LoopState = { readonly attempt: number; readonly command: Command | undefined; readonly correctionCycles: number; readonly identityBase: IdentityBase; readonly operations: ReadonlyArray<typeof OperationSchema.Type>; readonly sequence: number; readonly status: 'Planning' | 'Completed' | 'Failed' };

// --- [CONSTANTS] -------------------------------------------------------------

const _writeOperations = new Set<typeof OperationSchema.Type>(['write.annotation.update', 'write.layer.update', 'write.object.create', 'write.object.delete', 'write.object.update', 'write.viewport.update']);

// --- [FUNCTIONS] -------------------------------------------------------------

const _compactedDeltaSchema = S.Struct({
    batchWindowMs:    S.Int.pipe(S.greaterThanOrEqualTo(0)),
    categories:       S.Array(S.Struct({ category: S.NonEmptyTrimmedString, count: S.Int.pipe(S.greaterThanOrEqualTo(0)), subtypes: S.Array(S.NonEmptyTrimmedString) })),
    containsUndoRedo: S.Boolean,
    totalCount:       S.Int.pipe(S.greaterThanOrEqualTo(0)),
});

const _buildCheckpoint = (state: LoopState, sequence: number): typeof KargadanCheckpoint.insert.Type => ({
    chatJson: '',
    loopState: { attempt: state.attempt, correctionCycles: state.correctionCycles, operations: state.operations, sequence: state.sequence, status: state.status },
    sceneSummary: Option.none(),
    sequence,
    sessionId: state.identityBase.sessionId,
} as unknown as typeof KargadanCheckpoint.insert.Type);

const _elapsed = (start: number) => Math.max(0, Math.round(performance.now() - start));

const _planCommand = (input: { readonly deadline: number; readonly hash: (state: unknown) => string; readonly state: LoopState; readonly writeObjectRef: NonNullable<Command['objectRefs']>[number] }) =>
    pipe(
        Option.fromNullable(input.state.command),
        Option.map((command) => ({ ...command, attempt: input.state.attempt }) satisfies Command),
        Option.orElse(() => Option.fromNullable(input.state.operations[0]).pipe(Option.map((operation) => {
            const { identityBase: base, sequence } = input.state;
            const isWrite = _writeOperations.has(operation);
            const payload = isWrite
                ? ({ operationId: `${base.runId}:${sequence}`, patch: { layer: 'default', name: 'phase-3' } } as const)
                : ({ includeAttributes: true, scope: 'active' } as const);
            return {
                _tag: 'command',
                ...base,
                attempt: input.state.attempt,
                deadlineMs: input.deadline,
                idempotency: isWrite ? { idempotencyKey: `run:${base.runId.slice(0, 8)}:seq:${String(sequence).padStart(4, '0')}`, payloadHash: input.hash(payload) } : undefined,
                objectRefs: [input.writeObjectRef],
                operation,
                payload,
                requestId: crypto.randomUUID(),
                undoScope: isWrite ? 'kargadan.phase3' : undefined,
            } satisfies Command;
        }))),
        Option.match({ onNone: () => Effect.fail(new CommandDispatchError({ details: { message: 'No operation available for PLAN' }, reason: 'protocol' })), onSome: Effect.succeed }),
    );

// --- [SERVICES] --------------------------------------------------------------

class AgentLoop extends Effect.Service<AgentLoop>()('kargadan/AgentLoop', {
    effect: Effect.gen(function* () {
        const [dispatch, persistence, commandDeadlineMs, retryMax, correctionMax, heartbeatIntervalMs, operations, writeObjectRef] = yield* Effect.all([
            CommandDispatch,
            PersistenceService,
            HarnessConfig.commandDeadlineMs,
            HarnessConfig.retryMaxAttempts,
            HarnessConfig.correctionCycles,
            HarnessConfig.heartbeatIntervalMs,
            HarnessConfig.resolveLoopOperations,
            HarnessConfig.resolveWriteObjectRef,
        ]);
        const eventSequence = yield* Ref.make(1_000_000);
        const persistInboundEvent = (eventEnvelope: Extract<typeof EnvelopeSchema.Type, {_tag: 'event'}>) =>
            Effect.gen(function* () {
                const start = performance.now();
                const sequence = yield* Ref.modify(eventSequence, (current) => [current, current + 1] as const);
                const batchSummary = eventEnvelope.eventType === 'stream.compacted'
                    ? yield* S.decodeUnknown(_compactedDeltaSchema)(eventEnvelope.delta)
                    : undefined;
                yield* persistence.persist({
                    chatJson: '',
                    checkpoint: {
                        chatJson: '',
                        loopState: { eventType: eventEnvelope.eventType, sequence },
                        sceneSummary: Option.none(),
                        sequence,
                        sessionId: eventEnvelope.sessionId,
                    } as unknown as typeof KargadanCheckpoint.insert.Type,
                    toolCall: {
                        durationMs: _elapsed(start),
                        error: Option.none(),
                        operation: `transport.event.${eventEnvelope.eventType}`,
                        params: { causationRequestId: eventEnvelope.causationRequestId, delta: eventEnvelope.delta, eventType: eventEnvelope.eventType, sourceRevision: eventEnvelope.sourceRevision, ...(batchSummary && { batchSummary }) },
                        result: Option.some({ eventId: eventEnvelope.eventId }),
                        runId: eventEnvelope.runId,
                        sequence,
                        sessionId: eventEnvelope.sessionId,
                        status: 'ok' as const,
                    },
                });
                return { eventEnvelope, sequence, totalCount: batchSummary?.totalCount ?? 0 } as const;
            });
        const dispatchFailure = (command: Command, error: unknown): Result => {
            const dError = error instanceof CommandDispatchError ? error : new CommandDispatchError({ details: { error: String(error) }, reason: 'transport' });
            return {
                _tag:      'result',
                appId:     command.appId,
                dedupe: {  decision: 'rejected', originalRequestId: command.requestId },
                error: {   details: dError, reason: { code: 'DISPATCH_ERROR', failureClass: dError.failureClass ?? 'retryable', message: dError.message } },
                requestId: command.requestId,
                runId:     command.runId,
                sessionId: command.sessionId,
                status:    'error',
                traceId:   command.traceId,
            };
        };
        const persistResult = (state: LoopState, command: Command, result: Result, start: number): Effect.Effect<LoopState, unknown, never> => {
            const verified = result.status === 'ok';
            const failureError = {
                code:         result.error?.reason.code ?? ('UNKNOWN_FAILURE' as const),
                details:      result.error?.details,
                failureClass: result.error?.reason.failureClass ?? ('fatal' as const),
                message:      result.error?.reason.message ?? 'Result error payload is missing',
            };
            const seq = state.sequence + 1;
            const next = { ...state, command, sequence: seq };
            const failed: LoopState = { ...next, status: 'Failed' };
            const remaining = state.operations.slice(1);
            const done: LoopState = remaining.length === 0
                ? { ...next, command: undefined, operations: [], status: 'Completed' }
                : { ...next, attempt: 1, command: undefined, correctionCycles: 0, operations: remaining, status: 'Planning' };
            const decide = verified
                ? Effect.succeed(done)
                : Match.value(failureError.failureClass).pipe(
                    Match.when('compensatable', () =>
                        persistence.persist({
                            chatJson: '',
                            checkpoint: _buildCheckpoint(failed, seq + 1),
                            toolCall: { durationMs: 0, error: Option.some(failureError.code), operation: 'command.compensate', params: { code: failureError.code, compensation: 'required' }, result: Option.none(), runId: state.identityBase.runId, sequence: seq + 1, sessionId: state.identityBase.sessionId, status: 'error' as const },
                        }).pipe(Effect.as(failed)),
                    ),
                    Match.when('correctable', () => Effect.succeed(state.correctionCycles < correctionMax ? ({ ...next, attempt: state.attempt + 1, correctionCycles: state.correctionCycles + 1, status: 'Planning' } as LoopState) : failed)),
                    Match.when('fatal', () => Effect.logError('kargadan.fatal', failureError).pipe(Effect.as(failed))),
                    Match.when('retryable', () => Effect.succeed(state.attempt < retryMax ? ({ ...next, attempt: state.attempt + 1, status: 'Planning' } as LoopState) : failed)),
                    Match.exhaustive,
                );
            const nextState = verified ? done : failed;
            return persistence.persist({
                chatJson: '',
                checkpoint: _buildCheckpoint(nextState, seq),
                toolCall: {
                    durationMs: _elapsed(start),
                    error: verified ? Option.none() : Option.some(failureError.message),
                    operation: verified ? 'command.completed' : 'command.failed',
                    params: { dedupe: result.dedupe, operation: command.operation, status: result.status },
                    result: Option.some({ dedupe: result.dedupe, status: result.status, verified }),
                    runId: state.identityBase.runId,
                    sequence: seq,
                    sessionId: state.identityBase.sessionId,
                    status: verified ? 'ok' as const : 'error' as const,
                },
            }).pipe(Effect.andThen(decide));
        };
        const execute = (state: LoopState, command: Command): Effect.Effect<LoopState, unknown, never> => {
            const start = performance.now();
            return dispatch.execute(command).pipe(
                Effect.catchAll((error) => Effect.succeed(dispatchFailure(command, error))),
                Effect.flatMap((result) => persistResult(state, command, result, start)),
            );
        };
        const plan = (state: LoopState): Effect.Effect<LoopState, unknown, never> =>
            Effect.gen(function* () {
                const start = performance.now();
                const command = yield* _planCommand({ deadline: commandDeadlineMs, hash: persistence.hash, state, writeObjectRef });
                yield* persistence.persist({
                    chatJson: '',
                    checkpoint: _buildCheckpoint(state, state.sequence + 1),
                    toolCall: {
                        durationMs: _elapsed(start),
                        error: Option.none(),
                        operation: 'command.plan',
                        params: { operation: command.operation, status: state.status },
                        result: Option.some({ operation: command.operation }),
                        runId: state.identityBase.runId,
                        sequence: state.sequence + 1,
                        sessionId: state.identityBase.sessionId,
                        status: 'ok' as const,
                    },
                });
                return yield* execute(state, command);
            });
        const run = Effect.fn('AgentLoop.handle')((input: { readonly identityBase: IdentityBase; readonly token: string }) =>
            Effect.gen(function* () {
                const ack = yield* dispatch.handshake({ ...input.identityBase, requestId: crypto.randomUUID(), token: input.token });
                const base: IdentityBase = { ...input.identityBase, appId: ack.appId, runId: ack.runId, sessionId: ack.sessionId, traceId: ack.traceId };
                const heartbeatLoop = dispatch.heartbeat(base).pipe(
                    Effect.tap((hb) => Effect.logDebug('kargadan.harness.heartbeat', { mode: hb.mode, requestId: hb.requestId, runId: hb.runId })),
                    Effect.catchAll((error) => Effect.logWarning('kargadan.harness.heartbeat.failed', { error: String(error), runId: base.runId })),
                    Effect.zipRight(Effect.sleep(Duration.millis(heartbeatIntervalMs))),
                    Effect.forever,
                );
                const inboundLoop = dispatch.takeEvent().pipe(
                    Effect.flatMap(persistInboundEvent),
                    Effect.tap((es) => Effect.logDebug('kargadan.harness.transport.event', { batchCount: es.totalCount, eventId: es.eventEnvelope.eventId, eventType: es.eventEnvelope.eventType, requestId: es.eventEnvelope.requestId, runId: es.eventEnvelope.runId, sequence: es.sequence })),
                    Effect.catchAll((error) => Effect.logWarning('kargadan.harness.transport.event.failed', { error: String(error), runId: base.runId })),
                    Effect.forever,
                );
                const fibers = yield* Effect.all([Effect.fork(inboundLoop), Effect.fork(heartbeatLoop)]);
                const initialState: LoopState = { attempt: 1, command: undefined, correctionCycles: 0, identityBase: base, operations, sequence: 0, status: 'Planning' };
                const finalState = yield* Effect.iterate(initialState, { body: plan, while: (state) => state.status !== 'Completed' && state.status !== 'Failed' }).pipe(Effect.ensuring(Effect.forEach(fibers, Fiber.interrupt, { discard: true })));
                const trace = yield* persistence.sessionTrace(finalState.identityBase.sessionId);
                return { state: finalState, trace } as const;
            }),
        );
        return { handle: run } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

namespace AgentLoop {
    export type IdentityBase = { readonly appId: string; readonly runId: string; readonly sessionId: string; readonly traceId: string };
}

export { AgentLoop };
