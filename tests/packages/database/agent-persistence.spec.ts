/** agent-persistence.ts tests: duplicate journal writes are idempotent only on exact content matches. */
import { it } from '@effect/vitest';
import { AgentPersistenceLayer, AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { SqlClient } from '@effect/sql';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const { _state } = vi.hoisted(() => ({
    _state: {
        current: undefined as undefined | Record<string, unknown>,
        mode: 'match' as 'match' | 'mismatch',
    },
}));
const _duplicateError = { cause: { code: '23505', constraint: 'idx_agent_journal_session_sequence_kind' } } as const;
const _sql = {} as never;

// --- [MOCKS] -----------------------------------------------------------------

vi.mock('@parametric-portal/database/repos', async (importOriginal) => {
    const original = await importOriginal<typeof import('@parametric-portal/database/repos')>();
    const { Effect, Layer, Option } = await import('effect');
    const fakePersistence = {
        journal: {
            find: () =>
                Effect.sync(() =>
                    _state.current === undefined
                        ? []
                        : [
                            _state.mode === 'match'
                                ? _state.current
                                : {
                                    ..._state.current,
                                    payloadJson: { ...(_state.current['payloadJson'] as Record<string, unknown>), tampered: true },
                                    stateHash:   Option.some('mismatch'),
                                },
                        ]),
            put: (entries: readonly Record<string, unknown>[]) =>
                Effect.sync(() => {
                    _state.current = entries[0] as Record<string, unknown>;
                }).pipe(Effect.flatMap(() => Effect.fail(_duplicateError as never))),
        },
        kv: {},
        withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
    } as never;
    const persistenceService = new Proxy(original.PersistenceService, {
        get: (target, property, receiver) =>
            property === 'Default'
                ? Layer.succeed(target, fakePersistence)
                : Reflect.get(target, property, receiver),
    });
    return { ...original, PersistenceService: persistenceService };
});

// --- [FUNCTIONS] -------------------------------------------------------------

const _program = (mode: 'match' | 'mismatch') =>
    Effect.gen(function* () {
        _state.mode = mode;
        _state.current = undefined;
        const service = yield* AgentPersistenceService;
        return yield* service.persistCall(
            {
                appId: '00000000-0000-0000-0000-000000000001',
                correlationId: '00000000-0000-0000-0000-000000000010',
                sessionId: '00000000-0000-0000-0000-000000000020',
            },
            { nested: [new Date('2025-01-02T00:00:00.000Z')], startedAt: new Date('2025-01-01T00:00:00.000Z') },
            {
                chatJson:   '{"messages":[{"role":"user","content":"ping"}]}',
                durationMs: 12,
                error:      Option.none(),
                operation:   'write.object.create',
                params:      { text: 'hello' },
                result:      Option.some({ ok: true }),
                sequence:    1,
                status:     'ok',
            },
        );
    }).pipe(Effect.provide(AgentPersistenceLayer({ projector: () => ({}) }).pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient, _sql)))));

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: duplicate writes are idempotent when content matches', () =>
    Effect.gen(function* () {
        const exit = yield* _program('match').pipe(Effect.exit);
        expect(Exit.isSuccess(exit)).toBe(true);
    }),
);
it.effect('E2: duplicate writes fail when content diverges', () =>
    Effect.gen(function* () {
        const exit = yield* _program('mismatch').pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : '').toContain('AgentJournalConflictError');
    }),
);
