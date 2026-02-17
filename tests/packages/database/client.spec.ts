/** client.ts tests: connection pooling config, tenant RLS context, health checks, advisory locks, listen/notify, vector ops. */
import { it } from '@effect/vitest';
import { Client } from '@parametric-portal/database/client';
import { SqlClient } from '@effect/sql';
import { PgClient } from '@effect/sql-pg';
import { Cause, Effect, Exit, FastCheck as fc, Layer, Match, Option, Redacted, Schema as Sch, Stream } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _baseConfig = {
    appName: 'tests', connectionTtlMs: 60_000, connectionUrl: Redacted.make('postgres://localhost:5432/postgres'),
    connectTimeoutMs: 1_000, idleTimeoutMs: 1_000, options: '', poolMax: 1, poolMin: 1,
    ssl: { caPath: Option.none(), certPath: Option.none(), enabled: false, keyPath: Option.none(), minVersion: 'TLSv1.2' as const, rejectUnauthorized: true, servername: Option.none() },
    timeouts: { idleInTransactionMs: 1_000, lockMs: 1_000, statementMs: 1_000, transactionMs: 1_000 },
    trigramThresholds: { similarity: 0.3, strictWordSimilarity: 0.5, wordSimilarity: 0.6 },
} as const;
const _emptyDb = Object.assign(
    (_strings: TemplateStringsArray, ..._values: ReadonlyArray<unknown>) => Effect.succeed([{ ok: 1 }]),
    { unsafe: () => Effect.succeed([{}]), withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect },
) as never;

// --- [FUNCTIONS] -------------------------------------------------------------

const _makeSql = (opts: { fail?: boolean; rows?: ReadonlyArray<Record<string, unknown>> } = {}) => {
    const calls: string[] = [];
    const txCounts = { value: 0 };
    const queryResult = (text: string) =>
        opts.fail ? Effect.fail(new Error('db down'))
            : Effect.succeed(
                Match.value(text).pipe(
                    Match.when((t) => t.includes('pg_settings'), () => [{ name: 'hnsw.ef_search', setting: '120' }]),
                    Match.when((t) => t.includes('pg_stat_user_indexes'), () => [{ idxScan: 1n, idxTupFetch: 3n, idxTupRead: 2n }]),
                    Match.orElse(() => opts.rows ?? [{ ok: 1 }]),
                ),
            );
    const db = Object.assign(
        (strings: TemplateStringsArray, ..._values: ReadonlyArray<unknown>) => { const text = strings.join(''); calls.push(text); return queryResult(text); },
        {
            unsafe: (query: string, _params?: ReadonlyArray<unknown>) => { calls.push(query); return Effect.succeed(opts.rows ?? [{ acquired: true, released: false }]); },
            withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.sync(() => { txCounts.value += 1; }).pipe(Effect.andThen(effect)),
        },
    ) as never;
    return { calls, db, txCount: () => txCounts.value };
};
const _provide = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>, db: never) => Effect.provideService(effect, SqlClient.SqlClient, db);

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: tenant set/get inverse + locally isolation', { tenantId: fc.uuid() }, ({ tenantId }) =>
    Effect.gen(function* () {
        yield* Client.tenant.set(tenantId);
        expect(yield* Client.tenant.current).toBe(tenantId);
        const inner = yield* Client.tenant.locally('other-tenant', Client.tenant.current);
        expect(inner).toBe('other-tenant');
        expect(yield* Client.tenant.current).toBe(tenantId);
    }),
);
it.effect.prop('P2: health + healthDeep determinism + latencyMs shape', { shouldFail: fc.boolean() }, ({ shouldFail }) =>
    Effect.gen(function* () {
        const { db } = _makeSql({ fail: shouldFail });
        const [shallow, deep] = yield* Effect.all([_provide(Client.health(), db), _provide(Client.healthDeep(), db)]);
        expect(shallow.healthy).toBe(!shouldFail);
        expect(shallow.latencyMs).toBeGreaterThanOrEqual(0);
        expect(deep.healthy).toBe(!shouldFail);
        expect(deep.latencyMs).toBeGreaterThanOrEqual(0);
    }),
);

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: tenant.with nesting + set_config + inSqlContext default', () =>
    Effect.gen(function* () {
        expect(yield* Client.tenant.inSqlContext).toBe(false);
        expect(Client.tenant.Id.system).toBe('00000000-0000-7000-8000-000000000000');
        expect(Client.tenant.Id.unspecified).toBe('00000000-0000-7000-8000-ffffffffffff');
        expect(Client.tenant.Id.system).not.toBe(Client.tenant.Id.unspecified);
        const sql = _makeSql();
        const nested = yield* _provide(Client.tenant.with('a', Client.tenant.with('b', Client.tenant.current)), sql.db);
        expect(nested).toBe('b');
        expect(sql.txCount()).toBe(1);
        expect(sql.calls.some((c) => c.includes('set_config'))).toBe(true);
    }),
);
it.effect('E2: advisory lock acquire/try/session + notify + vector ops', () =>
    Effect.gen(function* () {
        const sql = _makeSql();
        const _p = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) => _provide(effect, sql.db);
        const [acquireResult, tryResult, sessionAcquire, sessionTry, releaseResult] = yield* Effect.all([
            _p(Client.lock.acquire(7n)), _p(Client.lock.try(7n)),
            _p(Client.lock.session.acquire(42n)), _p(Client.lock.session.try(42n)),
            _p(Client.lock.session.release(42n)),
        ]);
        expect(acquireResult).toBeUndefined();
        expect(tryResult).toBe(true);
        expect(sessionAcquire).toBeUndefined();
        expect(sessionTry).toBe(true);
        expect(releaseResult).toBe(false);
        const _has = (needle: string) => sql.calls.some((c) => c.includes(needle));
        expect(_has('pg_advisory_xact_lock')).toBe(true);
        expect(_has('pg_try_advisory_xact_lock')).toBe(true);
        expect(sql.calls.some((c) => c.includes('pg_advisory_lock') && !c.includes('xact') && !c.includes('try') && !c.includes('unlock'))).toBe(true);
        expect(sql.calls.some((c) => c.includes('pg_try_advisory_lock') && !c.includes('xact'))).toBe(true);
        expect(_has('pg_advisory_unlock')).toBe(true);
        const fallback = yield* Client.lock.try(8n).pipe(Effect.provideService(SqlClient.SqlClient, _emptyDb));
        expect(fallback).toBe(false);
        yield* Effect.all({ notify: _p(Client.notify('events', 'payload')), vectorConfig: _p(Client.vector.getConfig()), vectorScan: _p(Client.vector.withIterativeScan({ mode: 'off' }, Effect.succeed('ok'))), vectorStats: _p(Client.vector.indexStats('assets', 'idx_assets')) });
        expect(_has('pg_notify')).toBe(true);
        expect(_has('pg_settings')).toBe(true);
        expect(_has('pg_stat_user_indexes')).toBe(true);
        expect(_has('hnsw.iterative_scan')).toBe(true);
    }),
);
it.effect('E3: listen.typed filters invalid JSON + listen.raw passthrough', () =>
    Effect.gen(function* () {
        const pg = { listen: (channel: string) => Stream.fromIterable(channel === 'typed' ? ['{"ok":true}', 'not-json', '{invalid}'] : ['{"raw":1}']) } as never;
        const [raw, typed] = yield* Effect.all([
            Stream.runCollect(Client.listen.raw('raw')).pipe(Effect.provideService(PgClient.PgClient, pg)),
            Stream.runCollect(Client.listen.typed('typed', Sch.Struct({ ok: Sch.Boolean }))).pipe(Effect.provideService(PgClient.PgClient, pg)),
        ]);
        expect(Array.from(raw)).toEqual(['{"raw":1}']);
        expect(Array.from(typed)).toEqual([{ ok: true }]);
    }),
);
it.effect('E4: layerFromConfig boundary — invalid thresholds, NaN, valid, malformed options', () =>
    Effect.gen(function* () {
        const invalidNeg = { ..._baseConfig, trigramThresholds: { similarity: -1, strictWordSimilarity: 0.5, wordSimilarity: 2 } } as const;
        const invalidNaN = { ..._baseConfig, trigramThresholds: { similarity: Number.NaN, strictWordSimilarity: 0.5, wordSimilarity: 0.6 } } as const;
        const valid = { ..._baseConfig, connectionUrl: Redacted.make('postgres://localhost:5432/postgres?options=-c lock_timeout=5'), options: '-c statement_timeout=250' } as const;
        const malformed = { ..._baseConfig, options: '-c statement_timeout -c lock_timeout=5' } as const;
        const sslBadPath = { ..._baseConfig, ssl: { ...(_baseConfig.ssl), caPath: Option.some('/nonexistent/ca.pem'), enabled: true } } as const;
        const _buildExit = (cfg: Record<string, unknown>) => Effect.exit(Effect.scoped(Layer.build(Client.layerFromConfig(cfg))));
        const [negExit, nanExit, validExit, malExit, sslExit] = yield* Effect.all([_buildExit(invalidNeg), _buildExit(invalidNaN), _buildExit(valid), _buildExit(malformed), _buildExit(sslBadPath)]);
        expect(Exit.isFailure(negExit)).toBe(true);
        expect(Exit.isFailure(negExit) ? Cause.pretty(negExit.cause) : '').toContain('Invalid trigram thresholds');
        expect(Exit.isFailure(nanExit)).toBe(true);
        expect(Exit.isFailure(nanExit) ? Cause.pretty(nanExit.cause) : '').toContain('Invalid trigram thresholds');
        expect(Exit.isFailure(validExit) ? Cause.pretty(validExit.cause) : 'ok').not.toContain('Invalid trigram');
        expect(Exit.isFailure(malExit) ? Cause.pretty(malExit.cause) : 'ok').not.toContain('Invalid trigram');
        expect(Exit.isFailure(sslExit)).toBe(true);
    }),
);
