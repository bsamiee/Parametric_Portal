/** search.ts tests: SearchError construction, SearchRepo methods, Test layer defaults, limit clamping, error wrapping. */
import { it } from '@effect/vitest';
import { SearchError, SearchRepo } from '@parametric-portal/database/search';
import { SqlClient } from '@effect/sql';
import { Cause, Effect, Exit, FastCheck as fc } from 'effect';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _ID = '00000000-0000-0000-0000-000000000001';
const { _calls } = vi.hoisted(() => ({ _calls: [] as Array<Record<string, unknown>> }));
const _sql = Object.assign(
    (strings: TemplateStringsArray, ..._values: ReadonlyArray<unknown>) => Effect.succeed({ strings: [...strings], values: _values }),
    { and: (v: ReadonlyArray<unknown>) => v, csv: (v: ReadonlyArray<unknown>) => v, in: (v: ReadonlyArray<unknown>) => v, literal: String, unsafe: String },
) as never;

// --- [FUNCTIONS] -------------------------------------------------------------

const _live = <A>(effect: Effect.Effect<A, unknown, SearchRepo | SqlClient.SqlClient>) => effect.pipe(Effect.provide(SearchRepo.Default), Effect.provideService(SqlClient.SqlClient, _sql));
const _exitStr = (exit: Exit.Exit<unknown, unknown>) => Exit.match(exit, { onFailure: (cause) => Cause.pretty(cause), onSuccess: () => '' });

// --- [MOCKS] -----------------------------------------------------------------

vi.mock('@parametric-portal/database/client', () => ({ Client: { vector: { withIterativeScan: <A, E, R>(_c: Record<string, unknown>, e: Effect.Effect<A, E, R>) => e } } }));
vi.mock('@effect/sql', async (importOriginal) => {
    const orig = await importOriginal<typeof import('@effect/sql')>();
    const { Effect, Match } = await import('effect');
    const frozen = Reflect.construct(Date, [1735689600000], Date);
    const _run = <A>(spec: { execute: (p: Record<string, unknown>) => unknown }, params: Record<string, unknown>, value: A) => Effect.gen(function* () { yield* orig.SqlClient.SqlClient; yield* Effect.sync(() => { _calls.push(params); spec.execute(params); }); return value; });
    const _fail = (spec: { execute: (p: Record<string, unknown>) => unknown }, params: Record<string, unknown>, msg: string) => _run(spec, params, undefined).pipe(Effect.flatMap(() => Effect.fail(new Error(msg))));
    return {
        ...orig,
        SqlSchema: {
            ...orig.SqlSchema,
            findAll: (spec: { execute: (p: Record<string, unknown>) => unknown }) => (params: Record<string, unknown>) => {
                const boom = (params['term'] === 'boom' && 'search boom') || (params['prefix'] === 'boom' && 'suggest boom') || (params['model'] === 'explode-model' && 'embedding boom');
                const value = Match.value(params).pipe(
                    Match.when((p) => 'term' in p, () => [{ displayText: 'Doc', entityId: _ID, entityType: 'app', facets: { app: 1 }, metadata: {}, rank: 0.9, snippet: null, totalCount: 1 }]),
                    Match.when((p) => 'prefix' in p, () => [{ frequency: 3, term: `${String(params['prefix'])}-suggest` }]),
                    Match.orElse(() => [{ contentText: null, displayText: 'Doc', documentHash: 'hash', entityId: '00000000-0000-0000-0000-000000000003', entityType: 'app', metadata: {}, scopeId: null, updatedAt: frozen }]),
                );
                return boom ? _fail(spec, params, boom) : _run(spec, params, value);
            },
            single: (spec: { execute: (p: Record<string, unknown>) => unknown }) => (params: Record<string, unknown>) => _run(spec, params, { entityId: String(params['entityId'] ?? '00000000-0000-0000-0000-000000000000'), entityType: String(params['entityType'] ?? 'app'), isNew: true }),
            void: (spec: { execute: (p: Record<string, unknown>) => unknown }) => (params: Record<string, unknown>) => _run(spec, params, undefined).pipe(Effect.asVoid),
        },
    };
});

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: SearchError tag + fields preserved', { cause: fc.anything(), operation: fc.constantFrom('search', 'suggest', 'refresh', 'embeddingSources', 'upsertEmbedding') }, ({ cause, operation }) =>
    Effect.sync(() => { const error = new SearchError({ cause, operation }); expect(error._tag).toBe('SearchError'); expect(error.operation).toBe(operation); expect(error.cause).toBe(cause); }));
it.effect.prop('P2: suggest limit clamped to [1..20]', { raw: fc.integer({ max: 999, min: -10 }) }, ({ raw }) =>
    _live(Effect.gen(function* () {
        _calls.splice(0);
        yield* (yield* SearchRepo).suggest({ limit: raw, prefix: 'ab', scopeId: null });
        expect((_calls.at(-1)?.['limit'] as number)).toBeGreaterThanOrEqual(1);
        expect((_calls.at(-1)?.['limit'] as number)).toBeLessThanOrEqual(20);
    })));
it.effect.prop('P3: embeddingSources limit clamped to [1..200]', { raw: fc.integer({ max: 999, min: -10 }) }, ({ raw }) =>
    _live(Effect.gen(function* () {
        _calls.splice(0);
        yield* (yield* SearchRepo).embeddingSources({ dimensions: 2, limit: raw, model: 'm', scopeId: null });
        expect((_calls.at(-1)?.['limit'] as number)).toBeGreaterThanOrEqual(1);
        expect((_calls.at(-1)?.['limit'] as number)).toBeLessThanOrEqual(200);
    })));
it.effect.prop('P4: search limit clamped to [1..100]', { raw: fc.integer({ max: 999, min: -10 }) }, ({ raw }) =>
    _live(Effect.gen(function* () {
        _calls.splice(0);
        yield* (yield* SearchRepo).search({ scopeId: null, term: 'test' }, { limit: raw });
        expect((_calls.at(-1)?.['limit'] as number)).toBeGreaterThanOrEqual(1);
        expect((_calls.at(-1)?.['limit'] as number)).toBeLessThanOrEqual(100);
    })));

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: Test() defaults are deterministic + partial override preserves others', () =>
    Effect.gen(function* () {
        const repo = yield* SearchRepo;
        const [search, suggest, sources, refresh, upsert] = yield* Effect.all([
            repo.search({ scopeId: null, term: 'anything' }), repo.suggest({ prefix: 'ab', scopeId: null }),
            repo.embeddingSources({ dimensions: 2, model: 'any', scopeId: null }), repo.refresh(null, false),
            repo.upsertEmbedding({ dimensions: 2, documentHash: 'h', embedding: [0.1, 0.2], entityId: _ID, entityType: 'app', model: 'm', scopeId: null }),
        ]);
        expect(search).toStrictEqual({ cursor: null, facets: null, hasNext: false, hasPrev: false, items: [], total: 0 });
        expect(suggest).toStrictEqual([]); expect(sources).toStrictEqual([]); expect(refresh).toBeUndefined();
        expect(upsert).toStrictEqual({ entityId: '00000000-0000-0000-0000-000000000000', entityType: 'app', isNew: true });
    }).pipe(Effect.provide(SearchRepo.Test()), Effect.provideService(SqlClient.SqlClient, _sql)));
it.effect('E2: Test() partial override preserves other defaults', () =>
    Effect.gen(function* () {
        const repo = yield* SearchRepo;
        const [search, suggest] = yield* Effect.all([repo.search({ scopeId: null, term: 'x' }), repo.suggest({ prefix: 'ab', scopeId: null })]);
        expect(search.total).toBe(42); expect(suggest).toStrictEqual([]);
    }).pipe(Effect.provide(SearchRepo.Test({ search: () => Effect.succeed({ cursor: null, facets: null, hasNext: false, hasPrev: false, items: [], total: 42 }) })), Effect.provideService(SqlClient.SqlClient, _sql)));
it.effect('E3: failure wrapping produces SearchError', () =>
    Effect.gen(function* () {
        const exits = yield* Effect.all([
            _live(Effect.gen(function* () { return yield* (yield* SearchRepo).upsertEmbedding({ dimensions: 3, documentHash: 'h', embedding: [0.1, 0.2], entityId: _ID, entityType: 'app', model: 'm', scopeId: null }); })).pipe(Effect.exit),
            _live(Effect.gen(function* () { return yield* (yield* SearchRepo).search({ embedding: { dimensions: 5, model: 'm', vector: [0.1] }, scopeId: null, term: 'test' }); })).pipe(Effect.exit),
            _live(Effect.gen(function* () { return yield* (yield* SearchRepo).search({ scopeId: null, term: 'boom' }); })).pipe(Effect.exit),
            _live(Effect.gen(function* () { return yield* (yield* SearchRepo).suggest({ prefix: 'boom', scopeId: null }); })).pipe(Effect.exit),
            _live(Effect.gen(function* () { return yield* (yield* SearchRepo).embeddingSources({ dimensions: 2, model: 'explode-model', scopeId: null }); })).pipe(Effect.exit),
        ]);
        expect(exits.every((exit) => Exit.isFailure(exit as never))).toBe(true);
        expect(_exitStr(exits[0] as never)).toContain('SearchError');
        expect(_exitStr(exits[0] as never)).toContain('upsertEmbedding');
        expect(_exitStr(exits[1] as never)).toContain('search');
        expect([2, 3, 4].map((index) => _exitStr(exits[index] as never)).every((s) => s.includes('SearchError'))).toBe(true);
    }));
it.effect('E4: happy path with embeddings + option defaults passthrough', () =>
    _live(Effect.gen(function* () {
        _calls.splice(0);
        const repo = yield* SearchRepo;
        const fullVector = Array.from({ length: 3072 }, () => 0.1);
        const [search, searchEmbed, suggest, sources, refresh, upsert] = yield* Effect.all([
            repo.search({ includeFacets: true, scopeId: null, term: 'portal' }),
            repo.search({ embedding: { dimensions: 2, model: 'm', vector: [0.5, 0.5] }, scopeId: null, term: 'test' }),
            repo.suggest({ includeGlobal: true, limit: 15, prefix: 'po', scopeId: '00000000-0000-0000-0000-000000000010' }),
            repo.embeddingSources({ dimensions: 2, model: 'text-embedding-3-large', scopeId: null }),
            repo.refresh('00000000-0000-0000-0000-000000000010', true),
            repo.upsertEmbedding({ dimensions: 3072, documentHash: 'h', embedding: fullVector, entityId: _ID, entityType: 'app', model: 'text-embedding-3-large', scopeId: null }),
        ]);
        expect(search.total).toBe(1); expect(searchEmbed.total).toBe(1); expect(suggest[0]?.term).toContain('po');
        expect(sources).toHaveLength(1); expect(refresh).toBeUndefined(); expect(upsert.isNew).toBe(true);
        _calls.splice(0);
        yield* repo.search({ entityTypes: ['app', 'user'], includeSnippets: false, scopeId: null, term: 'test' });
        const searchCall = _calls.at(-1) as Record<string, unknown>;
        expect(searchCall['entityTypes']).toStrictEqual(['app', 'user']); expect(searchCall['includeSnippets']).toBe(false);
        _calls.splice(0);
        yield* repo.suggest({ prefix: 'ab', scopeId: null });
        const suggestCall = _calls.at(-1) as Record<string, unknown>;
        expect(suggestCall['includeGlobal']).toBe(false); expect(suggestCall['limit']).toBe(10);
        _calls.splice(0);
        yield* repo.embeddingSources({ dimensions: 2, model: 'm', scopeId: null });
        const esCall = _calls.at(-1) as Record<string, unknown>;
        expect(esCall['entityTypes']).toStrictEqual([]); expect(esCall['includeGlobal']).toBe(false); expect(esCall['limit']).toBe(200);
        _calls.splice(0);
        yield* repo.refresh();
        const refreshCall = _calls.at(-1) as Record<string, unknown>;
        expect(refreshCall['scopeId']).toBeNull(); expect(refreshCall['includeGlobal']).toBe(false);
    })));
