/** Phase 7 live acceptance: protocol conformance smoke and write/undo boundary. */
import { Envelope } from '../../../apps/kargadan/harness/src/protocol/schemas.ts';
import { Duration, Effect, Exit, Option, Schema as S } from 'effect';
import { expect } from 'vitest';
import {
    decodeCreateObjectResult,
    decodeSceneSummary,
    execute,
    liveIt,
    makeCommand,
    payloadHash,
    runPromiseUnsafe,
    withLiveDispatch,
} from './_phase7-fixture.ts';

// --- [LIVE ACCEPTANCE: PROTOCOL] ---------------------------------------------

liveIt('P7-LIVE-01: protocol conformance smoke decodes handshake/result/event and rejects malformed envelope', async () => {
    await runPromiseUnsafe(withLiveDispatch(({ ack, dispatch, identityBase }) =>
        Effect.gen(function* () {
            expect(Array.isArray(ack.acceptedCapabilities)).toBe(true);
            expect(Array.isArray(ack.catalog)).toBe(true);
            const summaryResult = yield* execute(dispatch, makeCommand({
                args: {},
                commandId: 'read.scene.summary',
                identityBase,
                operationTag: 'tests.phase7.protocol.scene.summary',
            }));
            const summary = yield* decodeSceneSummary(summaryResult);
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

// --- [LIVE ACCEPTANCE: WRITE/UNDO] -------------------------------------------

liveIt('P7-LIVE-02: live write + undo preserves logical action boundary', async () => {
    await runPromiseUnsafe(withLiveDispatch(({ dispatch, identityBase }) =>
        Effect.gen(function* () {
            const createArgs = { line: { from: [0, 0, 0], to: [10, 0, 0] } } as const;
            const createResult = yield* execute(dispatch, makeCommand({
                args: createArgs,
                commandId: 'write.object.create',
                idempotency: {
                    idempotencyKey: `phase7:live:create:${crypto.randomUUID().slice(0, 8)}`,
                    payloadHash: payloadHash(createArgs),
                },
                identityBase,
                operationTag: 'tests.phase7.write.create',
                undoScope: 'kargadan.phase7.live',
            }));
            const created = yield* decodeCreateObjectResult(createResult);
            const objectRefs = [{ objectId: created.objectId, sourceRevision: 0, typeTag: 'Curve' }] as const;
            const metadataBeforeUndo = yield* execute(dispatch, makeCommand({
                args: { detail: 'compact' },
                commandId: 'read.object.metadata',
                identityBase,
                objectRefs,
                operationTag: 'tests.phase7.write.metadata.before_undo',
            }));
            expect(metadataBeforeUndo.status).toBe('ok');
            const undoResult = yield* execute(dispatch, makeCommand({
                args: { script: '_Undo _Enter' },
                commandId: 'script.run',
                identityBase,
                operationTag: 'tests.phase7.write.undo',
            }));
            expect(undoResult.status).toBe('ok');
            const metadataAfterUndo = yield* execute(dispatch, makeCommand({
                args: { detail: 'compact' },
                commandId: 'read.object.metadata',
                identityBase,
                objectRefs,
                operationTag: 'tests.phase7.write.metadata.after_undo',
            }));
            expect(metadataAfterUndo.status).toBe('error');
        })));
});
