/** factory.ts tests: polymorphic repo factory, Update builders, routine, scope enforcement, error tagging. */
import { it } from '@effect/vitest';
import { Update, repo, routine } from '@parametric-portal/database/factory';
import { SqlClient } from '@effect/sql';
import { PgClient } from '@effect/sql-pg';
import { assertNone } from '@effect/vitest/utils';
import { Effect, Exit, FastCheck as fc, Option, Schema as S, Stream } from 'effect';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _row = { _action: 'insert', appId: 'tenant-a', count: 2, deletedAt: null, exists: true, expiresAt: null, id: 'id-1', name: 'name-1', totalCount: 2, updatedAt: '2024-01-01T00:00:00.000Z', value: 1 } as const;
const _rows = [_row, { ..._row, id: 'id-2', name: 'name-2' }] as const;
const _tenantState = { current: 'tenant-a', inSqlContext: false };
const _sql = Object.assign((first: TemplateStringsArray | string, ..._v: ReadonlyArray<unknown>) => (Array.isArray(first) && Object.hasOwn(first, 'raw')) ? Object.assign(Effect.succeed(_rows), { stream: Stream.fromIterable(_rows) }) as never : String(first), { and: (v: ReadonlyArray<unknown>) => v, csv: (v: ReadonlyArray<unknown>) => v, in: (v: ReadonlyArray<unknown>) => v, insert: (v: unknown) => v, literal: String, or: (v: ReadonlyArray<unknown>) => v, unsafe: () => Effect.succeed([{ acquired: true }]), withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect }) as never;
const _pg = { json: (value: unknown) => JSON.stringify(value) } as never;
const _fields = { appId: S.String, deletedAt: S.NullOr(S.String), expiresAt: S.NullOr(S.String), id: S.String, name: S.String, updatedAt: S.String };
const _model = Object.assign(S.Struct(_fields), { fields: _fields, insert: S.Struct({ appId: S.String, name: S.String }) }) as never;
const _hardFields = { appId: S.String, id: S.String, name: S.String, updatedAt: S.String };
const _hardModel = Object.assign(S.Struct(_hardFields), { fields: _hardFields, insert: S.Struct({ appId: S.String, name: S.String }) }) as never;
const _repoFull = repo(_model, 'items', { conflict: { keys: ['appId', 'name'], only: ['updatedAt'] }, functions: { setFn: { args: [{ cast: 'uuid', field: 'id' }], mode: 'set' }, stat: { mode: 'scalar' }, typed: { mode: 'typed' } }, purge: { column: 'deletedAt', defaultDays: 7, table: 'items' }, resolve: { byJoin: { field: 'name', through: { table: 'item_meta', target: 'id' } }, byMany: { field: 'name', many: true }, byName: 'name' }, scoped: 'appId' });
const _repoPurgeStr = repo(_model, 'items', { purge: 'purge_items' });
const _pred = { field: 'name', value: 'n' } as const;
const _allOps = [{ field: 'name', op: 'gt' as const, value: 'a' }, { field: 'name', op: 'gte' as const, value: 'a' }, { field: 'name', op: 'lt' as const, value: 'z' }, { field: 'name', op: 'lte' as const, value: 'z' }, { field: 'name', op: 'like' as const, value: '%a%' }, { field: 'name', op: 'null' as const }, { field: 'name', op: 'notNull' as const }, { field: 'name', op: 'in' as const, values: ['a', 'b'] }, { field: 'name', op: 'in' as const, values: [] as unknown[] }, { field: 'name', op: 'contains' as const, value: '{}' }, { field: 'name', op: 'containedBy' as const, value: '{}' }, { field: 'name', op: 'hasKey' as const, value: 'k' }, { field: 'name', op: 'hasKeys' as const, values: ['k1', 'k2'] }, { field: 'name', op: 'hasKeys' as const, values: [] as unknown[] }];

// --- [FUNCTIONS] -------------------------------------------------------------

const _provide = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(
    Effect.provideService(SqlClient.SqlClient, _sql),
    Effect.provideService(PgClient.PgClient, _pg),
);

// --- [MOCKS] -----------------------------------------------------------------

vi.mock('@effect/sql', async (importOriginal) => {
    const orig = await importOriginal<typeof import('@effect/sql')>();
    const { Effect, Option } = await import('effect');
    const _run = <A>(spec: { execute: (p: unknown) => unknown }, p: unknown, value: A) => Effect.sync(() => { spec.execute(p); return value; });
    return { ...orig, Model: { ...orig.Model, makeRepository: () => Effect.succeed({}) }, SqlSchema: { ...orig.SqlSchema, findAll: (spec: { execute: (p: unknown) => unknown }) => (p: unknown) => _run(spec, p, _rows), findOne: (spec: { execute: (p: unknown) => unknown }) => (p: unknown) => _run(spec, p, Option.some(_row)), single: (spec: { execute: (p: unknown) => unknown }) => (p: unknown) => _run(spec, p, { ..._row, value: 1 }) } };
});
vi.mock('@parametric-portal/database/client', async () => {
    const { Effect } = await import('effect');
    return { Client: { tenant: { current: Effect.sync(() => _tenantState.current), Id: { system: '00000000-0000-7000-8000-000000000000', unspecified: '00000000-0000-7000-8000-ffffffffffff' }, inSqlContext: Effect.sync(() => _tenantState.inSqlContext) } } };
});
vi.mock('@parametric-portal/database/page', async () => {
    const { Effect, Option } = await import('effect');
    return { Page: { bounds: { default: 2 }, decode: (cursor?: string) => Effect.succeed(cursor ? Option.some({ id: 'id-1', v: 1 }) : Option.none()), keyset: (items: ReadonlyArray<unknown>, total: number, limit: number) => ({ cursor: items.length ? 'c' : null, hasNext: items.length > limit, hasPrev: false, items: items.slice(0, limit), total }), offset: (items: ReadonlyArray<unknown>, total: number, start: number) => ({ hasNext: false, hasPrev: start > 0, items, page: 1, pages: 1, total }), strip: (rows: ReadonlyArray<{ totalCount: number }>) => ({ items: rows.map(({ totalCount: _, ...rest }) => rest), total: rows[0]?.totalCount ?? 0 }) } };
});

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: Update builders are deterministic (referential transparency)', { delta: fc.integer({ max: 100, min: -100 }), path: fc.array(fc.string({ maxLength: 8, minLength: 1 }), { maxLength: 4, minLength: 1 }), value: fc.jsonValue() }, ({ delta, path, value }) =>
    Effect.sync(() => {
        const col = 'payload' as never;
        expect(String(Update.inc(delta)(col, _sql, _pg))).toBe(String(Update.inc(delta)(col, _sql, _pg)));
        expect(String(Update.jsonb.set(path, value)(col, _sql, _pg))).toBe(String(Update.jsonb.set(path, value)(col, _sql, _pg)));
        expect(String(Update.jsonb.del(path)(col, _sql, _pg))).toBe(String(Update.jsonb.del(path)(col, _sql, _pg)));
    }));
it.effect.prop('P2: routine error tags partition (no-fns=ConfigError, unknown=UnknownFnError, known=success)', { fnName: fc.string({ maxLength: 16, minLength: 1 }).filter((name) => !Object.hasOwn(Object.prototype, name)) }, ({ fnName }) =>
    Effect.gen(function* () {
        const noFns = yield* Effect.exit((yield* routine('t', {}).pipe(_provide)).fn(fnName, {}));
        const withFns = yield* Effect.exit((yield* routine('t', { functions: { known: { mode: 'scalar' } } }).pipe(_provide)).fn(fnName, {}));
        expect(Exit.isFailure(noFns) && String(noFns).includes('RepoConfigError')).toBe(true);
        (fnName === 'known')
            ? expect(Exit.isSuccess(withFns)).toBe(true)
            : expect(String(withFns)).toContain('RepoUnknownFnError');
    }));

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: scope enforcement + config errors', () =>
    Effect.gen(function* () {
        const api = yield* _repoFull.pipe(_provide);
        _tenantState.current = '00000000-0000-7000-8000-ffffffffffff';
        const scopeFail = yield* Effect.exit(api.find([_pred]));
        _tenantState.current = '00000000-0000-7000-8000-000000000000';
        const systemOk = yield* Effect.exit(api.find([_pred]));
        _tenantState.current = 'tenant-a';
        expect(Exit.isFailure(scopeFail) && String(scopeFail).includes('RepoScopeError')).toBe(true);
        expect(Exit.isSuccess(systemOk)).toBe(true);
        expect(String(yield* Effect.exit(api.by('missing' as never, 'n')))).toContain('RepoConfigError');
        const bare = yield* repo(_model, 'items', {}).pipe(_provide);
        const hard = yield* repo(_hardModel, 'items', {}).pipe(_provide);
        const exits = yield* Effect.all([
            Effect.exit(bare.upsert({ appId: 'a', name: 'n' } as never)), Effect.exit(bare.purge()),
            Effect.exit(bare.merge({ appId: 'a', name: 'n' } as never)),
            Effect.exit(hard.drop('id-1')), Effect.exit(hard.lift(['id-1'])),
        ]);
        expect(exits.map(String).every((s) => s.includes('RepoConfigError'))).toBe(true);
    }));
it.effect('E2: CRUD ops + pagination + streaming + JSON codec + function dispatch', () =>
    Effect.gen(function* () {
        const api = yield* _repoFull.pipe(_provide);
        const results = yield* Effect.all({
            by:         api.by('byName', 'n'), byJoin: api.by('byJoin', 'n'), byMany: api.by('byMany', 'n'),
            count:      api.count([_pred]), drop: api.drop('id-1'), dropBulk: api.drop(['id-1']), dropEmpty: api.drop([] as readonly string[]),
            exists:     api.exists([_pred]), find: api.find([_pred]), findAsc: api.find([_pred], { asc: true }), findOps: api.find(_allOps), findRaw: api.find([{ raw: 'TRUE' } as never]),
            lift:       api.lift(['id-1']), liftSingle: api.lift('id-1' as never),
            merge:      api.merge([{ appId: 'tenant-a', name: 'n' } as never]), mergeEmpty: api.merge([] as never), mergeOne: api.merge({ appId: 'tenant-a', name: 'n' } as never),
            one:        api.one([_pred], 'update'), oneNowait: api.one([_pred], 'nowait'), oneShare: api.one([_pred], 'share'), oneSkip: api.one([_pred], 'skip'),
            purge:      api.purge(1), purgeDefault: api.purge(),
            put:        api.put({ appId: 'tenant-a', name: 'n' } as never), putConflict: api.put({ appId: 'tenant-a', name: 'n' } as never, { keys: ['appId'] }),
            putMany:    api.put([{ appId: 'tenant-a', name: 'n' } as never]), putManyEmpty: api.put([] as never),
            restore:    api.restore('id-1'),
            set:        api.set('id-1', { name: 'next' }), setBulk: api.set([_pred], { name: 'next' }), setBulkEmpty: api.set([_pred], {}),
            setJsonb:   api.set('id-1', { name: { nested: true } }), setNoop: api.set('id-1', {}),
            setTuple:   api.set(['name', 'n'] as [string, unknown], { name: 'next' }), setWhen: api.set('id-1', { name: 'x' }, undefined, _pred),
            softDelete: api.softDelete('id-1'), touch: api.touch('name')('id-1'), upsert: api.upsert({ appId: 'tenant-a', name: 'n' } as never),
        });
        expect(results.count).toBe(2);
        expect(results.exists).toBe(true);
        expect([results.find, results.findAsc, results.findOps, results.findRaw].every((list) => list.length === 2)).toBe(true);
        expect([Option.isSome(results.by), Option.isSome(results.byJoin), Array.isArray(results.byMany)]).toEqual([true, true, true]);
        expect([typeof results.setBulk, typeof results.setBulkEmpty]).toEqual(['number', 'number']);
        expect(results.dropEmpty).toBe(0);
        const paged = yield* Effect.all({
            agg:        api.agg([_pred], { avg: 'updatedAt', count: true, max: 'updatedAt', min: 'updatedAt', sum: 'updatedAt' }),
            page:       api.page([_pred], { cursor: 'c', limit: 1 }), pageNoCursor: api.page([_pred]),
            pageOffset: api.pageOffset([_pred], { limit: 1, offset: 0 }),
            stream:     Stream.runCollect(api.stream([_pred])), streamAsc: Stream.runCollect(api.stream([_pred], { asc: true })),
        });
        expect([paged.page.total, paged.pageOffset.total, paged.stream.length]).toEqual([2, 2, 2]);
        const codec = yield* Effect.all({
            fnScalar:       api.fn('stat', {}), fnSet: api.fn('setFn', { id: 'id-1' }), fnTyped: api.fn('typed', {}),
            jsonDecode:     api.json.decode('value', S.Struct({ v: S.Int }))(Option.some({ value: '{"v":1}' } as never)),
            jsonDecodeNone: api.json.decode('value', S.Struct({ v: S.Int }))(Option.none()),
            jsonEncode:     api.json.encode(S.Struct({ v: S.Int }))({ v: 1 }),
        });
        expect(codec.fnScalar).toBe(1);
        expect(typeof codec.jsonEncode).toBe('string');
        expect(Option.isSome(codec.jsonDecode)).toBe(true);
        assertNone(codec.jsonDecodeNone);
        expect(api.wildcard('name', 'portal*')[0]).toEqual({ field: 'name', op: 'like', value: 'portal%' });
        expect(api.wildcard('name', 'exact')[0]).toEqual({ field: 'name', op: 'eq', value: 'exact' });
        expect(api.wildcard('name', undefined)).toEqual([]);
    }));
it.effect('E3: routine delegate + preds + scope + purge variants', () =>
    Effect.gen(function* () {
        const api = yield* routine('system', { functions: { health: { mode: 'scalar' } } }).pipe(_provide);
        expect(yield* api.delegate('health')({})).toBe(1);
        const bare = yield* repo(_model, 'items', {}).pipe(_provide);
        expect(bare.preds({})).toEqual([]);
        expect(bare.preds({ name: 'a' })).toHaveLength(1);
        expect(bare.preds({ name: ['a', 'b'] })[0]).toHaveProperty('op', 'in');
        expect(bare.preds({ name: undefined })).toEqual([]);
        expect(bare.preds({ name: [] })).toEqual([]);
        _tenantState.inSqlContext = true;
        const scoped = yield* _repoFull.pipe(_provide);
        expect(Exit.isSuccess(yield* Effect.exit(scoped.find([_pred])))).toBe(true);
        _tenantState.inSqlContext = false;
        const purgeStr = yield* _repoPurgeStr.pipe(_provide);
        expect(typeof (yield* purgeStr.purge())).toBe('number');
    }));
