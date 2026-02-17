/** DopplerService tests: init lifecycle, cache lookup, refresh, error channel. */
import { it } from '@effect/vitest';
import { DopplerError, DopplerService } from '@parametric-portal/server/platform/doppler';
import { Env } from '@parametric-portal/server/env';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Effect, Exit, FastCheck as fc, Layer, Option, Redacted } from 'effect';
import { beforeEach, expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _operation = fc.constantFrom<'auth' | 'download' | 'configLogs' | 'refresh' | 'getRequired'>('auth', 'download', 'configLogs', 'refresh', 'getRequired');
const _cause =     fc.oneof(fc.string({ maxLength: 64 }), fc.constant(null), fc.integer());
const SECRETS =    { API_KEY: 'secret-value', DB_URL: 'postgres://localhost' } as const;
const ENV =        { config: 'test', project: 'test', refreshMs: 50, token: Redacted.make('tok') } as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _sdk =  vi.hoisted(() => ({
    authMe:   vi.fn((..._: unknown[]) => Promise.resolve({ type_: 'service', workplace: { name: 'ws' } })),
    download: vi.fn((..._: unknown[]): Promise<Record<string, unknown>> => Promise.resolve({ ...SECRETS, _bool: true, _num: 42 })),
    listLogs: vi.fn((..._: unknown[]) => Promise.resolve({ logs: [{ id: 'log-1' }] })),
}));
const _layer = () => DopplerService.Default.pipe(
    Layer.provideMerge(Layer.mergeAll(
        Layer.succeed(Env.Service, { doppler: ENV } as never),
        MetricsService.Default,
    )),
);

// --- [MOCKS] -----------------------------------------------------------------

vi.mock('@dopplerhq/node-sdk', () => ({
    DopplerSDK: function DopplerSDK() { return {
        auth:       { me: (...a: ReadonlyArray<unknown>) =>       _sdk.authMe(...a)   },
        configLogs: { list: (...a: ReadonlyArray<unknown>) =>     _sdk.listLogs(...a) },
        secrets:    { download: (...a: ReadonlyArray<unknown>) => _sdk.download(...a) },
    }; },
}));
vi.mock('@parametric-portal/server/utils/resilience', async () => {
    const  { Schedule } = await import('effect');
    return { Resilience: { schedule: () => Schedule.recurs(0) } };
});
beforeEach(() => {
    _sdk.authMe.mockImplementation((..._: unknown[]) => Promise.resolve({ type_: 'service', workplace: { name: 'ws' } }));
    _sdk.download.mockImplementation((..._: unknown[]): Promise<Record<string, unknown>> => Promise.resolve({ ...SECRETS, _bool: true, _num: 42 }));
    _sdk.listLogs.mockImplementation((..._: unknown[]) => Promise.resolve({ logs: [{ id: 'log-1' }] }));
});

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: DopplerError — tag + operation + cause preserved', { cause: _cause, operation: _operation }, ({ cause, operation }) =>
    Effect.sync(() => {
        const e = new DopplerError({ cause, operation });
        expect(e._tag).toBe('DopplerError');
        expect(e.operation).toBe(operation);
        expect(e.cause).toBe(cause);
    }), { fastCheck: { numRuns: 100 } });
it.scoped('P2: init — downloads, filters non-strings, lookup + health', () =>
    Effect.gen(function* () {
        const svc = yield* Effect.provide(DopplerService, _layer());
        const [found, missing, all, health, required, failExit] = yield* Effect.all([
            svc.get('API_KEY'), svc.get('NONEXISTENT'), svc.getAll, svc.health(),
            svc.getRequired('API_KEY'), svc.getRequired('NOPE').pipe(Effect.exit),
        ]);
        expect(Option.getOrThrow(found)).toBe('secret-value');
        expect(Option.isNone(missing)).toBe(true);
        expect(all.get('DB_URL')).toBe('postgres://localhost');
        expect(all.has('_num')).toBe(false);
        expect(all.has('_bool')).toBe(false);
        expect(all.size).toBe(2);
        expect(health.consecutiveFailures).toBe(0);
        expect(health.lastRefreshAt).toBeGreaterThan(0);
        expect(required).toBe('secret-value');
        expect(Exit.isFailure(failExit)).toBe(true);
    }));
it.live('P3: refresh — changed log updates cache, same log preserves', () =>
    Effect.gen(function* () {
        const svc = yield* DopplerService;
        expect((yield* svc.getAll).get('API_KEY')).toBe('secret-value');
        _sdk.listLogs.mockImplementation(() => Promise.resolve({ logs: [{ id: 'log-2' }] }));
        _sdk.download.mockImplementation(() => Promise.resolve({ NEW_KEY: 'new-value' }));
        yield* Effect.sleep(200);
        const updated = yield* svc.getAll;
        expect(updated.get('NEW_KEY')).toBe('new-value');
        expect(updated.has('API_KEY')).toBe(false);
        yield* Effect.sleep(200);
        expect((yield* svc.getAll).get('NEW_KEY')).toBe('new-value');
        expect((yield* svc.health()).consecutiveFailures).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(_layer())));
it.live('P4: refresh — SDK failure tracks consecutiveFailures', () =>
    Effect.gen(function* () {
        const svc = yield* DopplerService;
        _sdk.listLogs.mockImplementation(() => Promise.reject(new Error('network')));
        _sdk.download.mockImplementation(() => Promise.reject(new Error('network')));
        yield* Effect.sleep(200);
        const health = yield* svc.health();
        expect(health.consecutiveFailures).toBeGreaterThan(0);
        expect(Option.isSome(health.lastError)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(_layer())));

// --- [EDGE_CASES] ------------------------------------------------------------

it.scoped('E1: auth failure propagates DopplerError', () => {
    _sdk.authMe.mockImplementation(() => Promise.reject(new Error('unauthorized')));
    return Effect.provide(DopplerService, _layer()).pipe(Effect.exit, Effect.tap((exit) => { expect(Exit.isFailure(exit)).toBe(true); }),);
});
it.scoped('E2: download failure propagates DopplerError', () => {
    _sdk.download.mockImplementation(() => Promise.reject(new Error('forbidden')));
    return Effect.provide(DopplerService, _layer()).pipe(Effect.exit, Effect.tap((exit) => { expect(Exit.isFailure(exit)).toBe(true); }),);
});
