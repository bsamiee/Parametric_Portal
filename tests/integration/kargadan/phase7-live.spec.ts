/** Phase 7 (non-GH) live integration acceptance: protocol conformance, write/undo,
 * idempotent non-duplication, and checkpoint continuity on real transport/runtime. */
import { createHash } from 'node:crypto';
import { it } from '@effect/vitest';
import { HarnessConfig } from '../../../apps/kargadan/harness/src/config.ts';
import { CommandDispatch } from '../../../apps/kargadan/harness/src/protocol/dispatch.ts';
import { Envelope, type ObjectTypeTag } from '../../../apps/kargadan/harness/src/protocol/schemas.ts';
import { KargadanSocketClientLive, ReconnectionSupervisor } from '../../../apps/kargadan/harness/src/socket.ts';
import { AgentPersistenceService } from '../../../packages/database/src/agent-persistence.ts';
import { Duration, Effect, Exit, Layer, Match, Option, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _liveEnabled = ['1', 'true', 'yes'].includes((process.env['KARGADAN_LIVE_TESTS'] ?? '').trim().toLowerCase());
const _liveDbEnabled = _liveEnabled
    && (process.env['KARGADAN_CHECKPOINT_DATABASE_URL'] ?? '').trim().length > 0;
const _ForbiddenFakeFlags = [
    'KARGADAN_FAKE_AI_RUNTIME',
    'KARGADAN_FAKE_COMMAND_DISPATCH',
    'KARGADAN_FAKE_RHINO_TRANSPORT',
    'KARGADAN_FAKE_SOCKET_CLIENT',
] as const;
const _SceneSummaryCodec = S.Struct({ objectCount: S.Int.pipe(S.greaterThanOrEqualTo(0)) });
const _CreateResultCodec = S.Struct({ objectId: S.UUID });
const _dispatchLayer = Layer.mergeAll(
    KargadanSocketClientLive,
    ReconnectionSupervisor.Default,
    CommandDispatch.Default,
);
const _persistenceLayer = HarnessConfig.persistenceLayer;
const _liveIt = _liveEnabled ? it : it.skip;
const _liveDbIt = _liveDbEnabled ? it : it.skip;
type LiveDispatch = {
    readonly execute: (command: Envelope.Command) => Effect.Effect<unknown, unknown, never>;
    readonly handshake: (identity: Envelope.Identity & { readonly token: string }) => Effect.Effect<unknown, unknown, never>;
    readonly start: () => Effect.Effect<unknown, unknown, never>;
    readonly takeEvent: () => Effect.Effect<Envelope.Event, unknown, never>;
};
type HandshakeAck = Extract<typeof Envelope.Type, { readonly _tag: 'handshake.ack' }>;

// --- [FUNCTIONS] -------------------------------------------------------------

const _assertNoFakeFlags = Effect.sync(() => {
    const activeFlags = _ForbiddenFakeFlags.filter((key) =>
        ['1', 'true', 'yes'].includes((process.env[key] ?? '').trim().toLowerCase()));
    expect(activeFlags).toEqual([]);
});
const _makeCommand = (input: {
    readonly args: Record<string, unknown>;
    readonly commandId: string;
    readonly identityBase: Envelope.IdentityBase;
    readonly idempotency?: { readonly idempotencyKey: string; readonly payloadHash: string };
    readonly objectRefs?: ReadonlyArray<{ readonly objectId: string; readonly sourceRevision: number; readonly typeTag: typeof ObjectTypeTag.Type }>;
    readonly operationTag: string;
    readonly undoScope?: string;
}) => {
    const requestId = crypto.randomUUID();
    return {
        _tag: 'command',
        ...input.identityBase,
        args: input.args,
        commandId: input.commandId,
        deadlineMs: 5_000,
        ...(input.idempotency === undefined ? {} : { idempotency: input.idempotency }),
        ...(input.objectRefs === undefined ? {} : { objectRefs: input.objectRefs }),
        requestId,
        telemetryContext: {
            attempt: 1,
            operationTag: input.operationTag,
            spanId: requestId.replaceAll('-', ''),
            traceId: input.identityBase.correlationId,
        },
        ...(input.undoScope === undefined ? {} : { undoScope: input.undoScope }),
    } satisfies Envelope.Command;
};
const _execute = (dispatch: LiveDispatch, command: Envelope.Command) =>
    dispatch.execute(command).pipe(Effect.map((result) => result as Envelope.Result));
const _decodeSceneSummary = (result: Envelope.Result) =>
    Match.value(result.status).pipe(
        Match.when('ok', () =>
            Option.fromNullable(result.result).pipe(
                Option.match({
                    onNone: () => Effect.fail('scene.summary payload missing'),
                    onSome: (payload) => S.decodeUnknown(_SceneSummaryCodec)(payload),
                }),
            )),
        Match.orElse(() => Effect.fail(`scene.summary failed: ${result.error?.message ?? 'unknown'}`)),
    );
const _decodeCreateObjectResult = (result: Envelope.Result) =>
    Match.value(result.status).pipe(
        Match.when('ok', () =>
            Option.fromNullable(result.result).pipe(
                Option.match({
                    onNone: () => Effect.fail('write.object.create payload missing'),
                    onSome: (payload) => S.decodeUnknown(_CreateResultCodec)(payload),
                }),
            )),
        Match.orElse(() => Effect.fail(`write.object.create failed: ${result.error?.message ?? 'unknown'}`)),
    );
const _payloadHash = (args: Record<string, unknown>) =>
    createHash('sha256').update(JSON.stringify(args)).digest('hex');
const _runPromiseUnsafe = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(effect as Effect.Effect<A, E, never>);
const _withLiveDispatch = <A, E>(
    run: (context: {
        readonly ack: { readonly acceptedCapabilities: ReadonlyArray<string>; readonly catalog: ReadonlyArray<unknown> };
        readonly dispatch: LiveDispatch;
        readonly identityBase: Envelope.IdentityBase;
    }) => Effect.Effect<A, E, never>,
) =>
    Effect.scoped(
        Effect.gen(function* () {
            yield* _assertNoFakeFlags;
            const [rawDispatch, appId, token] = yield* Effect.all([
                CommandDispatch,
                HarnessConfig.appId,
                HarnessConfig.sessionToken,
            ]);
            const dispatch = rawDispatch as LiveDispatch;
            yield* Effect.forkScoped(dispatch.start()).pipe(Effect.asVoid);
            const identityBase = {
                appId,
                correlationId: crypto.randomUUID().replaceAll('-', ''),
                sessionId: crypto.randomUUID(),
            } satisfies Envelope.IdentityBase;
            const ack = yield* dispatch.handshake({
                ...identityBase,
                requestId: crypto.randomUUID(),
                token,
            } satisfies Envelope.Identity & { readonly token: string }).pipe(
                Effect.map((value) => value as HandshakeAck),
            );
            return yield* run({
                ack: {
                    acceptedCapabilities: ack.acceptedCapabilities,
                    catalog: ack.catalog,
                },
                dispatch,
                identityBase,
            });
        }),
    ).pipe(Effect.provide(_dispatchLayer));

// --- [LIVE ACCEPTANCE] -------------------------------------------------------

_liveIt('P7-LIVE-01: protocol conformance smoke decodes handshake/result/event and rejects malformed envelope', async () => {
    await _runPromiseUnsafe(_withLiveDispatch(({ ack, dispatch, identityBase }) =>
        Effect.gen(function* () {
            expect(Array.isArray(ack.acceptedCapabilities)).toBe(true);
            expect(Array.isArray(ack.catalog)).toBe(true);
            const summaryResult = yield* _execute(dispatch, _makeCommand({
                args: {},
                commandId: 'read.scene.summary',
                identityBase,
                operationTag: 'tests.phase7.protocol.scene.summary',
            }));
            const summary = yield* _decodeSceneSummary(summaryResult);
            expect(summary.objectCount).toBeGreaterThanOrEqual(0);
            const inboundEvent = yield* dispatch.takeEvent().pipe(
                Effect.timeoutOption(Duration.seconds(3)),
                Effect.flatMap(Option.match({
                    onNone: () => Effect.fail('No event envelope observed within 3s after live handshake.'),
                    onSome: Effect.succeed,
                })),
            );
            expect(inboundEvent._tag).toBe('event');
            const malformedDecode = yield* S.decodeUnknown(Envelope)({
                _tag: 'result',
                appId: identityBase.appId,
                correlationId: identityBase.correlationId,
                sessionId: identityBase.sessionId,
            }).pipe(Effect.exit);
            expect(Exit.isFailure(malformedDecode)).toBe(true);
        })));
});
_liveIt('P7-LIVE-02: live write + undo preserves logical action boundary', async () => {
    await _runPromiseUnsafe(_withLiveDispatch(({ dispatch, identityBase }) =>
        Effect.gen(function* () {
            const createArgs = {
                line: {
                    from: [0, 0, 0],
                    to: [10, 0, 0],
                },
            } as const;
            const createResult = yield* _execute(dispatch, _makeCommand({
                args: createArgs,
                commandId: 'write.object.create',
                idempotency: {
                    idempotencyKey: `phase7:live:create:${crypto.randomUUID().slice(0, 8)}`,
                    payloadHash: _payloadHash(createArgs),
                },
                identityBase,
                operationTag: 'tests.phase7.write.create',
                undoScope: 'kargadan.phase7.live',
            }));
            const created = yield* _decodeCreateObjectResult(createResult);
            const objectRefs = [{ objectId: created.objectId, sourceRevision: 0, typeTag: 'Curve' }] as const;
            const metadataBeforeUndo = yield* _execute(dispatch, _makeCommand({
                args: { detail: 'compact' },
                commandId: 'read.object.metadata',
                identityBase,
                objectRefs,
                operationTag: 'tests.phase7.write.metadata.before_undo',
            }));
            expect(metadataBeforeUndo.status).toBe('ok');
            const undoResult = yield* _execute(dispatch, _makeCommand({
                args: { script: '_Undo _Enter' },
                commandId: 'script.run',
                identityBase,
                operationTag: 'tests.phase7.write.undo',
            }));
            expect(undoResult.status).toBe('ok');
            const metadataAfterUndo = yield* _execute(dispatch, _makeCommand({
                args: { detail: 'compact' },
                commandId: 'read.object.metadata',
                identityBase,
                objectRefs,
                operationTag: 'tests.phase7.write.metadata.after_undo',
            }));
            expect(metadataAfterUndo.status).toBe('error');
        })));
});
_liveIt('P7-LIVE-03: duplicate idempotency key does not execute write twice', async () => {
    await _runPromiseUnsafe(_withLiveDispatch(({ dispatch, identityBase }) =>
        Effect.gen(function* () {
            const summaryBeforeResult = yield* _execute(dispatch, _makeCommand({
                args: {},
                commandId: 'read.scene.summary',
                identityBase,
                operationTag: 'tests.phase7.dedupe.summary.before',
            }));
            const summaryBefore = yield* _decodeSceneSummary(summaryBeforeResult);
            const createArgs = {
                line: {
                    from: [0, 10, 0],
                    to: [10, 10, 0],
                },
            } as const;
            const idempotency = {
                idempotencyKey: `phase7:live:dedupe:${crypto.randomUUID().slice(0, 8)}`,
                payloadHash: _payloadHash(createArgs),
            } as const;
            const firstResult = yield* _execute(dispatch, _makeCommand({
                args: createArgs,
                commandId: 'write.object.create',
                idempotency,
                identityBase,
                operationTag: 'tests.phase7.dedupe.first',
                undoScope: 'kargadan.phase7.live',
            }));
            expect(firstResult.status).toBe('ok');
            const summaryAfterFirstResult = yield* _execute(dispatch, _makeCommand({
                args: {},
                commandId: 'read.scene.summary',
                identityBase,
                operationTag: 'tests.phase7.dedupe.summary.after_first',
            }));
            const summaryAfterFirst = yield* _decodeSceneSummary(summaryAfterFirstResult);
            const secondResult = yield* _execute(dispatch, _makeCommand({
                args: createArgs,
                commandId: 'write.object.create',
                idempotency,
                identityBase,
                operationTag: 'tests.phase7.dedupe.second',
                undoScope: 'kargadan.phase7.live',
            }));
            expect(secondResult.status).toBe('ok');
            expect(secondResult.dedupe?.decision).toBe('duplicate');
            const summaryAfterSecondResult = yield* _execute(dispatch, _makeCommand({
                args: {},
                commandId: 'read.scene.summary',
                identityBase,
                operationTag: 'tests.phase7.dedupe.summary.after_second',
            }));
            const summaryAfterSecond = yield* _decodeSceneSummary(summaryAfterSecondResult);
            expect(summaryAfterFirst.objectCount).toBeGreaterThanOrEqual(summaryBefore.objectCount + 1);
            expect(summaryAfterSecond.objectCount).toBe(summaryAfterFirst.objectCount);
            const undoResult = yield* _execute(dispatch, _makeCommand({
                args: { script: '_Undo _Enter' },
                commandId: 'script.run',
                identityBase,
                operationTag: 'tests.phase7.dedupe.undo_cleanup',
            }));
            expect(undoResult.status).toBe('ok');
        })));
});
_liveDbIt('P7-LIVE-04: persisted compaction checkpoint hydrates to equivalent loop state', async () => {
    await _runPromiseUnsafe(Effect.gen(function* () {
        yield* _assertNoFakeFlags;
        const [appId, persistence] = yield* Effect.all([HarnessConfig.appId, AgentPersistenceService]);
        const identity = {
            appId,
            correlationId: crypto.randomUUID().replaceAll('-', ''),
            sessionId: crypto.randomUUID(),
        } as const;
        const loopState = {
            attempt: 1,
            correctionCycles: 0,
            lastCompaction: {
                estimatedTokensAfter: 320,
                estimatedTokensBefore: 900,
                mode: 'history_reset',
                sequence: 1,
                targetTokens: 400,
                triggerTokens: 700,
            },
            operations: ['read.scene.summary', 'write.object.create'],
            sequence: 1,
            status: 'Planning',
            verificationEvidence: {
                deterministicFailureClass: null,
                deterministicStatus: 'ok',
                visualStatus: 'capability_missing',
            },
            workflowExecution: {
                approved: true,
                commandId: 'write.object.create',
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
            appId: identity.appId,
            correlationId: identity.correlationId,
            error: null,
            sequence: 1,
            sessionId: identity.sessionId,
            status: 'completed',
            toolCallCount: 1,
        });
    }).pipe(Effect.scoped, Effect.provide(_persistenceLayer)));
});
