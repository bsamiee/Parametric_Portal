/** Shared fixture for phase 7 live integration specs. */
import { createHash } from 'node:crypto';
import { it } from '@effect/vitest';
import { HarnessConfig } from '../../../apps/kargadan/harness/src/config.ts';
import { CommandDispatch } from '../../../apps/kargadan/harness/src/protocol/dispatch.ts';
import type { CorrelationId, SpanId, TraceId } from '../../../apps/kargadan/harness/src/protocol/schemas.ts';
import type { Envelope, ObjectTypeTag } from '../../../apps/kargadan/harness/src/protocol/schemas.ts';
import { KargadanSocketClientLive, ReconnectionSupervisor } from '../../../apps/kargadan/harness/src/socket.ts';
import { Effect, Layer, Match, Option, Schema as S } from 'effect';
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
const _hexId = () => crypto.randomUUID().replaceAll('-', '');
const _correlationId = () => _hexId() as typeof CorrelationId.Type;
const _traceId = () => _hexId() as typeof TraceId.Type;
const _spanId = () => _hexId() as typeof SpanId.Type;
const _SceneSummaryCodec = S.Struct({ objectCount: S.Int.pipe(S.greaterThanOrEqualTo(0)) });
const _CreateResultCodec = S.Struct({ objectId: S.UUID });
const _HandshakeAckCodec = S.Struct({
    _tag: S.Literal('handshake.ack'),
    acceptedCapabilities: S.Array(S.String),
    catalog: S.Array(S.Unknown),
});
const _ResultCodec = S.Struct({
    _tag: S.Literal('result'),
    dedupe: S.optional(S.Struct({ decision: S.String, originalRequestId: S.UUID })),
    error: S.optional(S.Struct({ code: S.String, failureClass: S.String, message: S.String }),),
    result: S.optional(S.Unknown),
    status: S.String,
});
const dispatchLayer = CommandDispatch.Default.pipe(
    Layer.provideMerge(KargadanSocketClientLive.pipe(Layer.provideMerge(ReconnectionSupervisor.Default))),
);
const persistenceLayer = HarnessConfig.persistenceLayer;
const liveIt = _liveEnabled ? it : it.skip;
const liveDbIt = _liveDbEnabled ? it : it.skip;

// --- [FUNCTIONS] -------------------------------------------------------------

const assertNoFakeFlags = Effect.sync(() => {
    const activeFlags = _ForbiddenFakeFlags.filter((key) =>
        ['1', 'true', 'yes'].includes((process.env[key] ?? '').trim().toLowerCase()));
    expect(activeFlags).toEqual([]);
});
const makeCommand = (input: {
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
            spanId: _spanId(),
            traceId: _traceId(),
        },
        ...(input.undoScope === undefined ? {} : { undoScope: input.undoScope }),
    } satisfies Envelope.Command;
};
const execute = (dispatch: CommandDispatch, command: Envelope.Command) =>
    dispatch.execute(command).pipe(Effect.flatMap(S.decodeUnknown(_ResultCodec)));
const decodeSceneSummary = (result: typeof _ResultCodec.Type) =>
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
const decodeCreateObjectResult = (result: typeof _ResultCodec.Type) =>
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
const payloadHash = (args: Record<string, unknown>) =>
    createHash('sha256').update(JSON.stringify(args)).digest('hex');
const runPromiseUnsafe = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(effect as Effect.Effect<A, E, never>);
const withLiveDispatch = <A, E>(
    run: (context: {
        readonly ack: typeof _HandshakeAckCodec.Type;
        readonly dispatch: CommandDispatch;
        readonly identityBase: Envelope.IdentityBase;
    }) => Effect.Effect<A, E, never>,
) =>
    Effect.scoped(
        Effect.gen(function* () {
            yield* assertNoFakeFlags;
            const [dispatch, cfg] = yield* Effect.all([CommandDispatch, HarnessConfig]);
            yield* Effect.forkScoped(dispatch.start()).pipe(Effect.asVoid);
            const identityBase = {
                appId: cfg.appId,
                correlationId: _correlationId(),
                sessionId: crypto.randomUUID(),
            } satisfies Envelope.IdentityBase;
            const ack = yield* dispatch.handshake({
                ...identityBase,
                requestId: crypto.randomUUID(),
                token: cfg.sessionToken,
            } satisfies Envelope.Identity & { readonly token: string }).pipe(
                Effect.flatMap((value) => S.decodeUnknown(_HandshakeAckCodec)(value)),
            );
            return yield* run({ ack, dispatch, identityBase });
        }),
    ).pipe(Effect.provide(dispatchLayer));

// --- [EXPORT] ----------------------------------------------------------------

export {
    assertNoFakeFlags,
    decodeCreateObjectResult,
    decodeSceneSummary,
    execute,
    liveDbIt,
    liveIt,
    makeCommand,
    payloadHash,
    persistenceLayer,
    runPromiseUnsafe,
    withLiveDispatch,
};
