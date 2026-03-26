/** Phase 7 live acceptance: idempotent deduplication and checkpoint continuity. */
import { HarnessConfig } from '../../../apps/kargadan/harness/src/config.ts';
import { AgentPersistenceService } from '../../../packages/database/src/agent-persistence.ts';
import { Effect, Match, Option } from 'effect';
import { expect } from 'vitest';
import {
    assertNoFakeFlags,
    decodeSceneSummary,
    execute,
    liveDbIt,
    liveIt,
    makeCommand,
    payloadHash,
    persistenceLayer,
    runPromiseUnsafe,
    withLiveDispatch,
} from './_phase7-fixture.ts';

// --- [LIVE ACCEPTANCE: DEDUPE] -----------------------------------------------

liveIt('P7-LIVE-03: duplicate idempotency key does not execute write twice', async () => {
    await runPromiseUnsafe(withLiveDispatch(({ dispatch, identityBase }) =>
        Effect.gen(function* () {
            const summaryBeforeResult = yield* execute(dispatch, makeCommand({
                args: {},
                commandId: 'read.scene.summary',
                identityBase,
                operationTag: 'tests.phase7.dedupe.summary.before',
            }));
            const summaryBefore = yield* decodeSceneSummary(summaryBeforeResult);
            const createArgs = { line: { from: [0, 10, 0], to: [10, 10, 0] } } as const;
            const idempotency = {
                idempotencyKey: `phase7:live:dedupe:${crypto.randomUUID().slice(0, 8)}`,
                payloadHash: payloadHash(createArgs),
            } as const;
            const firstCommand = makeCommand({
                args: createArgs,
                commandId: 'write.object.create',
                idempotency,
                identityBase,
                operationTag: 'tests.phase7.dedupe.first',
                undoScope: 'kargadan.phase7.live',
            });
            const firstResult = yield* execute(dispatch, firstCommand);
            expect(firstResult.status).toBe('ok');
            const summaryAfterFirstResult = yield* execute(dispatch, makeCommand({
                args: {},
                commandId: 'read.scene.summary',
                identityBase,
                operationTag: 'tests.phase7.dedupe.summary.after_first',
            }));
            const summaryAfterFirst = yield* decodeSceneSummary(summaryAfterFirstResult);
            const secondResult = yield* execute(dispatch, makeCommand({
                args: createArgs,
                commandId: 'write.object.create',
                idempotency,
                identityBase,
                operationTag: 'tests.phase7.dedupe.second',
                undoScope: 'kargadan.phase7.live',
            }));
            expect(secondResult.status).toBe('ok');
            expect(secondResult.dedupe?.decision).toBe('duplicate');
            const summaryAfterSecondResult = yield* execute(dispatch, makeCommand({
                args: {},
                commandId: 'read.scene.summary',
                identityBase,
                operationTag: 'tests.phase7.dedupe.summary.after_second',
            }));
            const summaryAfterSecond = yield* decodeSceneSummary(summaryAfterSecondResult);
            expect(summaryAfterFirst.objectCount).toBeGreaterThanOrEqual(summaryBefore.objectCount + 1);
            expect(summaryAfterSecond.objectCount).toBe(summaryAfterFirst.objectCount);
            const undoResult = yield* execute(dispatch, makeCommand({
                args: { requestId: firstCommand.requestId },
                commandId: 'internal.undo.execution',
                identityBase,
                operationTag: 'tests.phase7.dedupe.undo_cleanup',
            }));
            expect(undoResult.status).toBe('ok');
        })));
});

// --- [LIVE ACCEPTANCE: CHECKPOINT] -------------------------------------------

liveDbIt('P7-LIVE-04: persisted compaction checkpoint hydrates to equivalent loop state', async () => {
    await runPromiseUnsafe(Effect.gen(function* () {
        yield* assertNoFakeFlags;
        const [cfg, persistence] = yield* Effect.all([HarnessConfig, AgentPersistenceService]);
        const identity = {
            appId: cfg.appId,
            correlationId: crypto.randomUUID().replaceAll('-', ''),
            sessionId: crypto.randomUUID(),
        } as const;
        const loopState = {
            attempt: 1,
            correctionCycles: 0,
            lastCompaction: {
                estimatedTokensAfter: 320, estimatedTokensBefore: 900,
                mode: 'history_reset', sequence: 1, targetTokens: 400, triggerTokens: 700,
            },
            operations: ['read.scene.summary', 'write.object.create'],
            sequence: 1,
            status: 'Planning',
            verificationEvidence: {
                deterministicFailureClass: null, deterministicStatus: 'ok', visualStatus: 'capability_missing',
            },
            workflowExecution: {
                approved: true, commandId: 'write.object.create',
                executionId: `${identity.sessionId}:00000001:${crypto.randomUUID()}`,
            },
        } as const;
        yield* persistence.startSession(identity);
        yield* persistence.persistCall(identity, loopState, {
            chatJson: '{"messages":[]}',
            durationMs: 12,
            error: Option.none(),
            operation: 'command.completed',
            params: {
                commandId: 'write.object.create',
                verificationEvidence: loopState.verificationEvidence,
                workflowExecution: loopState.workflowExecution,
            },
            result: Option.some({ verified: true }),
            sequence: 1,
            status: 'ok',
        });
        const hydrated = yield* persistence.hydrate(identity.sessionId);
        yield* Match.value(hydrated).pipe(
            Match.when({ fresh: true }, () => Effect.fail('Expected non-fresh hydration after persisted checkpoint.')),
            Match.orElse((restored) =>
                Effect.sync(() => {
                    expect(restored.sequence).toBe(1);
                    const restoredState = restored.state as Record<string, unknown>;
                    expect(restoredState['status']).toBe('Planning');
                    const compaction = restoredState['lastCompaction'] as Record<string, unknown>;
                    expect(compaction['mode']).toBe('history_reset');
                })),
        );
        const trace = yield* persistence.trace(identity.sessionId);
        expect(trace.items.length).toBeGreaterThanOrEqual(1);
        yield* persistence.completeSession({
            appId: identity.appId, correlationId: identity.correlationId,
            error: null, sequence: 1, sessionId: identity.sessionId, status: 'completed', toolCallCount: 1,
        });
    }).pipe(Effect.scoped, Effect.provide(persistenceLayer)));
});
