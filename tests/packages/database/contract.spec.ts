/** Contract tests: database package boundary — service shape, schema decode, error identity. */
import { it } from '@effect/vitest';
import { DatabaseService } from '@parametric-portal/database/repos';
import { SearchError, SearchRepo } from '@parametric-portal/database/search';
import {
    ApiKey, App, AuditOperationSchema, FeatureFlagsSchema, OAuthProviderSchema,
    PreferencesSchema, RoleSchema, Session, User,
} from '@parametric-portal/database/models';
import { SqlClient } from '@effect/sql';
import { PgClient } from '@effect/sql-pg';
import { Effect, Layer, Option, Schema as S, Stream } from 'effect';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _EXPECTED_DB_KEYS = ['apiKeys', 'apps', 'assets', 'audit', 'jobDlq', 'jobs', 'kvStore', 'mfaSecrets', 'notifications', 'oauthAccounts', 'observability', 'permissions', 'search', 'sessions', 'users', 'webauthnCredentials', 'withTransaction'] as const;
const _EXPECTED_SEARCH_KEYS = ['embeddingSources', 'refresh', 'search', 'suggest', 'upsertEmbedding'] as const;
const _row = { _action: 'insert', appId: 'tenant-a', count: 2, deletedAt: null, exists: true, expiresAt: null, id: 'id-1', name: 'name-1', settings: Option.none(), totalCount: 2, updatedAt: '2024-01-01T00:00:00.000Z', value: '{"ok":true}' } as const;
const _sqlClient = Object.assign(
    (_strings: TemplateStringsArray, ..._values: ReadonlyArray<unknown>) => Object.assign(Effect.succeed([_row]), { stream: Stream.fromIterable([_row]) }) as never,
    { and: (values: ReadonlyArray<unknown>) => values, csv: (values: ReadonlyArray<unknown>) => values, in: (values: ReadonlyArray<unknown>) => values, insert: (values: unknown) => values, literal: String, or: (values: ReadonlyArray<unknown>) => values, unsafe: () => Effect.succeed([{ acquired: true }]), withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect },
) as never;
const _pg = { json: (value: unknown) => JSON.stringify(value) } as never;

// --- [MOCKS] -----------------------------------------------------------------

vi.mock('@effect/sql', async (importOriginal) => {
    const orig = await importOriginal<typeof import('@effect/sql')>();
    const { Effect, Option } = await import('effect');
    const _run = <A>(spec: { execute: (params: unknown) => unknown }, params: unknown, value: A) => Effect.sync(() => { spec.execute(params); return value; });
    return { ...orig, Model: { ...orig.Model, makeRepository: () => Effect.succeed({}) }, SqlSchema: { ...orig.SqlSchema, findAll: (spec: { execute: (params: unknown) => unknown }) => (params: unknown) => _run(spec, params, [_row]), findOne: (spec: { execute: (params: unknown) => unknown }) => (params: unknown) => _run(spec, params, Option.some(_row)), single: (spec: { execute: (params: unknown) => unknown }) => (params: unknown) => _run(spec, params, { ..._row, value: 1 }) } };
});
vi.mock('@parametric-portal/database/client', async () => {
    const { Effect } = await import('effect');
    return { Client: { tenant: { current: Effect.succeed('tenant-a'), Id: { system: '00000000-0000-7000-8000-000000000000', unspecified: '00000000-0000-7000-8000-ffffffffffff' }, inSqlContext: Effect.succeed(false) }, vector: { withIterativeScan: <A, E, R>(_c: Record<string, unknown>, effect: Effect.Effect<A, E, R>) => effect } } };
});
vi.mock('@parametric-portal/database/page', async () => {
    const { Effect, Option } = await import('effect');
    return { Page: { bounds: { default: 2 }, decode: (cursor?: string) => Effect.succeed(cursor ? Option.some({ id: 'id-1', v: 1 }) : Option.none()), keyset: (items: ReadonlyArray<unknown>, total: number, limit: number) => ({ cursor: items.length ? 'c' : null, hasNext: items.length > limit, hasPrev: false, items: items.slice(0, limit), total }), offset: (items: ReadonlyArray<unknown>, total: number, start: number) => ({ hasNext: false, hasPrev: start > 0, items, page: 1, pages: 1, total }), strip: (rows: ReadonlyArray<{ totalCount: number }>) => ({ items: rows.map(({ totalCount: _, ...rest }) => rest), total: rows[0]?.totalCount ?? 0 }) } };
});

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: exported literal schemas roundtrip via decode', {
    flags: FeatureFlagsSchema, oauth: OAuthProviderSchema, role: RoleSchema,
}, ({ flags, oauth, role }) => Effect.sync(() => {
    expect(S.decodeSync(RoleSchema)(role)).toBe(role);
    expect(S.decodeSync(OAuthProviderSchema)(oauth)).toBe(oauth);
    expect(S.decodeSync(FeatureFlagsSchema)(flags)).toEqual(flags);
}), { fastCheck: { numRuns: 30 } });

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: DatabaseService tag exposes exactly 17 keys', () =>
    Effect.gen(function* () {
        const service = yield* DatabaseService;
        expect(Object.keys(service).sort((a, b) => a.localeCompare(b))).toEqual([..._EXPECTED_DB_KEYS]);
    }).pipe(Effect.provide(DatabaseService.Default.pipe(Layer.provide(SearchRepo.Test()), Layer.provide(Layer.succeed(SqlClient.SqlClient, _sqlClient)), Layer.provide(Layer.succeed(PgClient.PgClient, _pg))))));
it.effect('E2: SearchRepo Test shape + SearchError tag', () =>
    Effect.gen(function* () {
        const repo = yield* SearchRepo;
        expect(Object.keys(repo).sort((a, b) => a.localeCompare(b))).toEqual([..._EXPECTED_SEARCH_KEYS]);
        const error = new SearchError({ cause: 'test-cause', operation: 'search' });
        expect(error._tag).toBe('SearchError');
        expect(error.operation).toBe('search');
        expect(error.cause).toBe('test-cause');
    }).pipe(Effect.provide(SearchRepo.Test()), Effect.provideService(SqlClient.SqlClient, _sqlClient)));
it.effect('E3: model schemas expose expected field counts and insert variants', () =>
    Effect.sync(() => {
        expect(Object.keys(User.fields).length).toBeGreaterThanOrEqual(7);
        expect(Object.keys(Session.fields).length).toBeGreaterThanOrEqual(9);
        expect(Object.keys(ApiKey.fields).length).toBeGreaterThanOrEqual(5);
        expect(Object.keys(App.fields).length).toBeGreaterThanOrEqual(3);
        expect(Object.keys(User.insert.fields)).not.toContain('id');
        expect(Object.keys(Session.insert.fields)).not.toContain('id');
        expect(S.decodeSync(AuditOperationSchema)('create')).toBe('create');
        const prefs = { channels: { email: true, inApp: true, webhook: false }, mutedUntil: null, templates: {} };
        expect(S.decodeSync(PreferencesSchema)(prefs).channels.email).toBe(true);
    }));
