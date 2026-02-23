/**
 * Drives the PLAN→EXECUTE→VERIFY→PERSIST→DECIDE loop as a single Effect stage pipeline over the socket transport.
 * Handles retry/correction/compensation transitions via loop-stages and persists each command lifecycle to checkpoint storage.
 */
import type { Kargadan } from '@parametric-portal/types/kargadan';
import { Duration, Effect, Fiber, Function as F, Match } from 'effect';
import { HarnessConfig } from '../config';
import { CommandDispatch, CommandDispatchError } from '../protocol/dispatch';
import { CheckpointService } from '../persistence/checkpoint';
import { handleDecision, planCommand, verifyResult } from './loop-stages';

// --- [TYPES] -----------------------------------------------------------------

type LoopState = {
    readonly attempt: number;
    readonly command: Kargadan.CommandEnvelope | undefined;
    readonly correctionCycles: number;
    readonly identityBase: {
        readonly appId: string;
        readonly protocolVersion: Kargadan.ProtocolVersion;
        readonly runId: string;
        readonly sessionId: string;
        readonly traceId: string;
    };
    readonly operations: ReadonlyArray<Kargadan.CommandOperation>;
    readonly sequence: number;
    readonly status: typeof Kargadan.RunStatusSchema.Type;
};

// --- [SERVICES] --------------------------------------------------------------

class AgentLoop extends Effect.Service<AgentLoop>()('kargadan/AgentLoop', {
    effect: Effect.gen(function* () {
        const [dispatch, checkpoint, commandDeadlineMs, retryMax, correctionMax, operations, simulatedPluginRevision] =
            yield* Effect.all([
                CommandDispatch,
                CheckpointService,
                HarnessConfig.commandDeadlineMs,
                HarnessConfig.retryMaxAttempts,
                HarnessConfig.correctionCycles,
                HarnessConfig.resolveLoopOperations,
                HarnessConfig.simulatedPluginRevision,
            ]);
        const _dispatchFailure = (command: Kargadan.CommandEnvelope, error: unknown): Kargadan.ResultEnvelope => {
            const dispatchError = Match.value(error).pipe(
                Match.when(Match.instanceOf(CommandDispatchError), F.identity),
                Match.orElse(F.constant(CommandDispatchError.of('transport', { error: String(error) }))),
            ) as CommandDispatchError;
            return {
                _tag: 'result',
                dedupe: {
                    decision: 'rejected',
                    originalRequestId: command.identity.requestId,
                },
                error: {
                    details:          dispatchError,
                    reason: {
                        code: 'DISPATCH_ERROR',
                        failureClass: dispatchError.failureClass ?? 'retryable',
                        message:      dispatchError.message,
                    },
                },
                execution: {
                    durationMs: 0,
                    pluginRevision: simulatedPluginRevision,
                    sourceRevision: 0,
                },
                identity: command.identity,
                result: {},
                status: 'error',
                telemetryContext: { ...command.telemetryContext, operationTag: 'EXECUTE' },
            } satisfies Kargadan.ResultEnvelope;
        };
        const _persist = (
            state: LoopState,
            command: Kargadan.CommandEnvelope,
            result: Kargadan.ResultEnvelope,
        ): Effect.Effect<LoopState, unknown, never> => {
            const verification = verifyResult(result);
            const { appId, runId, sessionId } = state.identityBase;
            return checkpoint
                .appendTransition({
                    appId,
                    createdAt:  new Date(),
                    eventId:    crypto.randomUUID(),
                    eventType:  verification._tag === 'Verified' ? 'command.completed' : 'command.failed',
                    payload: {
                        dedupe: result.dedupe,
                        status: result.status,
                        verification,
                    },
                    requestId: command.identity.requestId,
                    runId,
                    sequence:  state.sequence + 1,
                    sessionId,
                    telemetryContext: { ...command.telemetryContext, attempt: state.attempt, operationTag: 'PERSIST' },
                    ...(command.idempotency === undefined ? {} : { idempotency: command.idempotency }),
                })
                .pipe(
                    Effect.andThen(
                        checkpoint.snapshot({
                            appId,
                            runId,
                            sequence: state.sequence + 1,
                            state: {
                                operation: command.operation,
                                status: verification._tag,
                            },
                        }),
                    ),
                    Effect.flatMap(() =>
                        handleDecision({
                            command,
                            context: { checkpoint, correctionMax, retryMax },
                            state: {
                                ...state,
                                command,
                                sequence: state.sequence + 1,
                                status: 'Persisting',
                            },
                            verification,
                        }),
                    ),
                );
        };
        const _execute = (
            state: LoopState,
            command: Kargadan.CommandEnvelope,
        ): Effect.Effect<LoopState, unknown, never> =>
            dispatch.command.execute(command).pipe(
                Effect.catchAll((error) => Effect.succeed(_dispatchFailure(command, error))),
                Effect.flatMap((result) => _persist(state, command, result)),
            );
        const _plan = (state: LoopState): Effect.Effect<LoopState, unknown, never> =>
            Effect.gen(function* () {
                const command = yield* planCommand({ deadline: commandDeadlineMs, state });
                const { appId, runId, sessionId } = state.identityBase;
                yield* checkpoint.appendTransition({
                    appId,
                    createdAt: new Date(),
                    eventId: crypto.randomUUID(),
                    eventType: 'command.plan',
                    payload: { operation: command.operation, status: state.status },
                    requestId: command.identity.requestId,
                    runId,
                    sequence: state.sequence + 1,
                    sessionId,
                    telemetryContext: command.telemetryContext,
                    ...(command.idempotency === undefined ? {} : { idempotency: command.idempotency }),
                });
                return yield* _execute(state, command);
            });
        const _handle = Effect.fn('AgentLoop.handle')(
            (input: { readonly identityBase: LoopState['identityBase']; readonly token: string }) =>
                Effect.gen(function* () {
                    const connected = yield* dispatch.protocol.handshake({
                        identity: {
                            appId:           input.identityBase.appId,
                            issuedAt:        new Date(),
                            protocolVersion: input.identityBase.protocolVersion,
                            requestId:       crypto.randomUUID(),
                            runId:           input.identityBase.runId,
                            sessionId:       input.identityBase.sessionId,
                        },
                        token: input.token,
                        traceId: input.identityBase.traceId,
                    });
                    const initialState: LoopState = {
                        attempt: 1,
                        command: undefined,
                        correctionCycles: 0,
                        identityBase: {
                            appId:           connected.identity.appId,
                            protocolVersion: connected.identity.protocolVersion,
                            runId:           connected.identity.runId,
                            sessionId:       connected.identity.sessionId,
                            traceId:         input.identityBase.traceId,
                        },
                        operations,
                        sequence: 0,
                        status: 'Planning',
                    };
                    const heartbeatLoop = dispatch.protocol.heartbeat(connected.identity, input.identityBase.traceId).pipe(
                        Effect.tap((heartbeat) =>
                            Effect.logDebug('kargadan.harness.heartbeat', {
                                mode: heartbeat.mode,
                                requestId: heartbeat.identity.requestId,
                                runId: heartbeat.identity.runId,
                            }),
                        ),
                        Effect.catchAll((error) =>
                            Effect.logWarning('kargadan.harness.heartbeat.failed', {
                                error: String(error),
                                runId: connected.identity.runId,
                            }),
                        ),
                        Effect.zipRight(
                            HarnessConfig.heartbeatIntervalMs.pipe(Effect.flatMap((ms) => Effect.sleep(Duration.millis(ms))),),
                        ),
                        Effect.forever,
                    );
                    const inboundEventLoop = dispatch.transport.takeEvent().pipe(
                        Effect.tap((eventEnvelope) =>
                            Effect.logDebug('kargadan.harness.transport.event', {
                                eventId: eventEnvelope.eventId,
                                eventType: eventEnvelope.eventType,
                                requestId: eventEnvelope.identity.requestId,
                                runId: eventEnvelope.identity.runId,
                            }),
                        ),
                        Effect.catchAll((error) =>
                            Effect.logWarning('kargadan.harness.transport.event.failed', {
                                error: String(error),
                                runId: connected.identity.runId,
                            }),
                        ),
                        Effect.forever,
                    );
                    const runtimeFibers = yield* Effect.all([
                        Effect.fork(inboundEventLoop),
                        Effect.fork(heartbeatLoop),
                    ]);
                    const stopRuntimeFibers = Effect.forEach(
                        runtimeFibers,
                        (fiber) => Fiber.interrupt(fiber),
                        { discard: true },
                    );
                    const finalState = yield* Effect.iterate(initialState, {
                        body:  (state) => _plan(state),
                        while: (state) => state.status !== 'Completed' && state.status !== 'Failed',
                    }).pipe(Effect.ensuring(stopRuntimeFibers),);
                    const replay = yield* checkpoint.replay({ runId: finalState.identityBase.runId });
                    return { replay, state: finalState } as const;
                }),
        );
        return { handle: _handle } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AgentLoop };
export type { LoopState };
