/** repos.ts tests: DatabaseService composition, service shape, delegate behavioral properties. */
import { it } from '@effect/vitest';
import { DatabaseService } from '@parametric-portal/database/repos';
import { SearchRepo } from '@parametric-portal/database/search';
import { SqlClient } from '@effect/sql';
import { PgClient } from '@effect/sql-pg';
import { Effect, Layer, Option, Stream } from 'effect';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _row =  { _action: 'insert', appId: 'tenant-a', count: 2, deletedAt: null, exists: true, expiresAt: null, id: 'id-1', name: 'name-1', settings: Option.none(), totalCount: 2, updatedAt: '2024-01-01T00:00:00.000Z', value: '{"ok":true}' } as const;
const _rows = [_row, { ..._row, id: 'id-2', name: 'name-2' }] as const;
const _EXPECTED_KEYS = ['apiKeys', 'apps', 'assets', 'audit', 'jobDlq', 'jobs', 'kvStore', 'mfaSecrets', 'notifications', 'oauthAccounts', 'observability', 'permissions', 'search', 'sessions', 'users', 'webauthnCredentials', 'withTransaction'] as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _pg = { json: (value: unknown) => JSON.stringify(value) } as never;
const _sqlClient = Object.assign(
    (_strings: TemplateStringsArray, ..._values: ReadonlyArray<unknown>) => Object.assign(Effect.succeed(_rows), { stream: Stream.fromIterable(_rows) }) as never,
    {
        and:    (values: ReadonlyArray<unknown>) => values,
        csv:    (values: ReadonlyArray<unknown>) => values,
        in:     (values: ReadonlyArray<unknown>) => values,
        insert: (values: unknown) => values,
        literal: String,
        or:     (values: ReadonlyArray<unknown>) => values,
        unsafe: () => Effect.succeed([{ acquired: true }]),
        withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
    },
) as never;
const _service = Effect.gen(function* () { return yield* DatabaseService; }).pipe(
    Effect.provide(DatabaseService.Default.pipe(
        Layer.provide(SearchRepo.Test()),
        Layer.provide(Layer.succeed(SqlClient.SqlClient, _sqlClient)),
        Layer.provide(Layer.succeed(PgClient.PgClient, _pg)),
    )),
);

// --- [MOCKS] -----------------------------------------------------------------

vi.mock('@effect/sql', async (importOriginal) => {
    const orig = await importOriginal<typeof import('@effect/sql')>();
    const { Effect, Option } = await import('effect');
    const _run = <A>(spec: { execute: (params: unknown) => unknown }, params: unknown, value: A) => Effect.sync(() => { spec.execute(params); return value; });
    return { ...orig, Model: { ...orig.Model, makeRepository: () => Effect.succeed({}) }, SqlSchema: { ...orig.SqlSchema, findAll: (spec: { execute: (params: unknown) => unknown }) => (params: unknown) => _run(spec, params, _rows), findOne: (spec: { execute: (params: unknown) => unknown }) => (params: unknown) => _run(spec, params, Option.some(_row)), single: (spec: { execute: (params: unknown) => unknown }) => (params: unknown) => _run(spec, params, { ..._row, value: 1 }) } };
});
vi.mock('@parametric-portal/database/client', async () => {
    const  { Effect } = await import('effect');
    return { Client: { tenant: { current: Effect.succeed('tenant-a'), Id: { system: '00000000-0000-7000-8000-000000000000', unspecified: '00000000-0000-7000-8000-ffffffffffff' }, inSqlContext: Effect.succeed(false) }, vector: { withIterativeScan: <A, E, R>(_c: Record<string, unknown>, effect: Effect.Effect<A, E, R>) => effect } } };
});
vi.mock('@parametric-portal/database/page', async () => {
    const  { Effect, Option } = await import('effect');
    return { Page: { bounds: { default: 2 }, decode: (cursor?: string) => Effect.succeed(cursor ? Option.some({ id: 'id-1', v: 1 }) : Option.none()), keyset: (items: ReadonlyArray<unknown>, total: number, limit: number) => ({ cursor: items.length ? 'c' : null, hasNext: items.length > limit, hasPrev: false, items: items.slice(0, limit), total }), offset: (items: ReadonlyArray<unknown>, total: number, start: number) => ({ hasNext: false, hasPrev: start > 0, items, page: 1, pages: 1, total }), strip: (rows: ReadonlyArray<{ totalCount: number }>) => ({ items: rows.map(({ totalCount: _, ...rest }) => rest), total: rows[0]?.totalCount ?? 0 }) } };
});

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: composition exposes exactly 17 keys', () => _service.pipe(Effect.tap((service) => {expect(Object.keys(service).sort((a, b) => a.localeCompare(b))).toStrictEqual([..._EXPECTED_KEYS]);}), Effect.asVoid));
it.effect('E2: auth delegates resolve correctly', () =>
    Effect.gen(function* () {
        const service = yield* _service;
        const [prefs, grant, verify, byRefresh] = yield* Effect.all([
            service.users.setPreferences('u-1', { theme: 'dark' } as never),
            service.permissions.grant({ action: 'read', appId: 'a-1', resource: 'users', role: 'admin' as never }),
            service.sessions.verify('s-1'),
            service.sessions.byRefreshTokenForUpdate('hash-abc'),
        ]);
        expect(prefs).toBeDefined();
        expect(grant).toBeDefined();
        expect(verify).toBeDefined();
        expect(Option.isSome(byRefresh)).toBe(true);
    }));
it.effect('E3: data + notification delegates resolve', () =>
    Effect.gen(function* () {
        const service = yield* _service;
        const [count, mark, transition] = yield* Effect.all([
            service.jobs.countByStatuses('queued', 'failed'),
            service.jobDlq.markReplayed('dlq-1'),
            service.notifications.transition('n-1', { status: 'sent' as never }),
        ]);
        expect(count).toBeDefined();
        expect(mark).toBeDefined();
        expect(transition).toBeDefined();
    }));
it.effect('E4: apps readSettings returns decoded settings', () =>
    Effect.gen(function* () {
        const service = yield* _service;
        const result = yield* service.apps.readSettings('app-1');
        expect(Option.isSome(result)).toBe(true);
        Option.match(result, { onNone: () => {}, onSome: (value) => { expect(value.settings.featureFlags).toBeDefined(); } });
    }));
it.effect('E5: withTransaction is a function', () => _service.pipe(Effect.tap((service) => {expect(typeof service.withTransaction).toBe('function');}), Effect.asVoid));
