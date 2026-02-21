/**
 * Drives the PLAN→EXECUTE→VERIFY→PERSIST→DECIDE agent loop via recursive LoopCommand dispatch against KargadanSocketClient.
 * Handles retry, correction, and compensation transitions; delegates pure stage logic to loop-stages and state types to loop-contracts.
 */
import type { Kargadan } from '@parametric-portal/types/kargadan';
import { Effect, Function as F, Match } from 'effect';
import { HarnessConfig } from '../config';
import { LoopCommand, type LoopState } from '../loop-types';
import { CommandDispatch, CommandDispatchError } from '../protocol/dispatch';
import { handleDecision, planCommand, verifyResult } from './loop-stages';
import { PersistenceTrace } from './persistence-trace';

// --- [SERVICES] --------------------------------------------------------------

class AgentLoop extends Effect.Service<AgentLoop>()('kargadan/AgentLoop', {
    effect: Effect.gen(function* () {
        const [dispatch, trace, commandDeadlineMs, retryMax, correctionMax, operations, simulatedPluginRevision] =
            yield* Effect.all([
                CommandDispatch,
                PersistenceTrace,
                HarnessConfig.commandDeadlineMs,
                HarnessConfig.retryMaxAttempts,
                HarnessConfig.correctionCycles,
                HarnessConfig.resolveLoopOperations,
                HarnessConfig.simulatedPluginRevision,
            ]);
        const run = (loopCommand: LoopCommand.Type): Effect.Effect<LoopState.Type, unknown> =>
            LoopCommand.$match(loopCommand, {
                DECIDE: ({ state, command, verification }) =>
                    handleDecision({
                        command,
                        context: { correctionMax, retryMax, trace },
                        state,
                        verification,
                    }),
                EXECUTE: ({ state, command }) =>
                    dispatch.command.execute(command).pipe(
                        Effect.catchAll((error) => {
                            const dispatchError = Match.value(error).pipe(
                                Match.when(Match.instanceOf(CommandDispatchError), F.identity),
                                Match.orElse(
                                    F.constant(CommandDispatchError.of('transport', { error: String(error) })),
                                ),
                            ) as CommandDispatchError;
                            return Effect.succeed({
                                _tag: 'result',
                                dedupe: {
                                    decision: 'rejected',
                                    originalRequestId: command.identity.requestId,
                                },
                                error: {
                                    details: dispatchError,
                                    reason: {
                                        code: 'DISPATCH_ERROR',
                                        failureClass: dispatchError.failureClass ?? 'retryable',
                                        message: dispatchError.message,
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
                                telemetryContext: {
                                    attempt: command.telemetryContext.attempt,
                                    operationTag: 'EXECUTE',
                                    spanId:  crypto.randomUUID().replaceAll('-', ''),
                                    traceId: crypto.randomUUID().replaceAll('-', ''),
                                },
                            } satisfies Kargadan.ResultEnvelope);
                        }),
                        Effect.flatMap((result) => run(LoopCommand.VERIFY({ command, result, state }))),
                    ),
                PERSIST: ({ state, command, result, verification }) =>
                    trace
                        .appendTransition({
                            appId: state.identityBase.appId,
                            createdAt: new Date(),
                            eventId: crypto.randomUUID(),
                            eventType: verification._tag === 'Verified' ? 'command.completed' : 'command.failed',
                            payload: {
                                dedupe: result.dedupe,
                                status: result.status,
                                verification,
                            },
                            requestId: command.identity.requestId,
                            runId:     state.identityBase.runId,
                            sequence:  state.sequence + 1,
                            sessionId: state.identityBase.sessionId,
                            telemetryContext: {
                                attempt: state.attempt,
                                operationTag: 'PERSIST',
                                spanId:  crypto.randomUUID().replaceAll('-', ''),
                                traceId: crypto.randomUUID().replaceAll('-', ''),
                            },
                            ...(command.idempotency === undefined ? {} : { idempotency: command.idempotency }),
                        })
                        .pipe(
                            Effect.andThen(
                                trace.snapshot({
                                    appId:    state.identityBase.appId,
                                    runId:    state.identityBase.runId,
                                    sequence: state.sequence + 1,
                                    state: {
                                        operation: command.operation,
                                        status:    verification._tag,
                                    },
                                }),
                            ),
                            Effect.flatMap(() =>
                                run(
                                    LoopCommand.DECIDE({
                                        command,
                                        result,
                                        state: {
                                            ...state,
                                            command,
                                            sequence: state.sequence + 1,
                                            status:   'Persisting',
                                        },
                                        verification,
                                    }),
                                ),
                            ),
                        ),
                PLAN: ({ state }) =>
                    Effect.gen(function* () {
                        const command = yield* planCommand({ deadline: commandDeadlineMs, state });
                        yield* trace.appendTransition({
                            appId:     state.identityBase.appId,
                            createdAt: new Date(),
                            eventId:   crypto.randomUUID(),
                            eventType: 'command.plan',
                            payload: { operation: command.operation, status: state.status },
                            requestId: command.identity.requestId,
                            runId:     state.identityBase.runId,
                            sequence:  state.sequence + 1,
                            sessionId: state.identityBase.sessionId,
                            telemetryContext: {
                                attempt: state.attempt,
                                operationTag: 'PLAN',
                                spanId:  crypto.randomUUID().replaceAll('-', ''),
                                traceId: crypto.randomUUID().replaceAll('-', ''),
                            },
                            ...(command.idempotency === undefined ? {} : { idempotency: command.idempotency }),
                        });
                        return yield* run(LoopCommand.EXECUTE({ command, state }));
                    }),
                VERIFY: ({ state, command, result }) =>
                    run(
                        LoopCommand.PERSIST({
                            command,
                            result,
                            state,
                            verification: verifyResult(result),
                        }),
                    ),
            });
        const handle = Effect.fn('AgentLoop.handle')(
            (input: { readonly identityBase: LoopState.IdentityBase; readonly token: string }) =>
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
                    });
                    const initialState: LoopState.Type = {
                        attempt: 1,
                        command: undefined,
                        correctionCycles: 0,
                        identityBase: {
                            appId:           connected.identity.appId,
                            protocolVersion: connected.identity.protocolVersion,
                            runId:           connected.identity.runId,
                            sessionId:       connected.identity.sessionId,
                        },
                        operations,
                        sequence: 0,
                        status: 'Planning',
                    };
                    const finalState = yield* Effect.iterate(initialState, {
                        body:  (state) => run(LoopCommand.PLAN({ state })),
                        while: (state) => state.status !== 'Completed' && state.status !== 'Failed',
                    });
                    const replay = yield* trace.replay({ runId: finalState.identityBase.runId });
                    return { replay, state: finalState } as const;
                }),
        );
        return { handle } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AgentLoop };
