/** Feature flag tests: CRUD, cache invalidation, rollout boundary invariants. */
import { it } from '@effect/vitest';
import { SqlClient } from '@effect/sql';
import { AppSettingsDefaults } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '@parametric-portal/server/context';
import { FeatureService } from '@parametric-portal/server/domain/features';
import { EventBus } from '@parametric-portal/server/infra/events';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Effect, Either, FastCheck as fc, Option, PrimaryKey, Stream } from 'effect';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _cacheService = {} as never;
const _sql = Object.assign(
    ((..._args: ReadonlyArray<unknown>) => Effect.succeed([])) as unknown as SqlClient.SqlClient,
    { withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect },
);
const _state = vi.hoisted(() => ({
    invalidations: [] as string[],
    publishes:     [] as unknown[],
    reads:         [] as Array<{ lock: false | 'update'; tenantId: string }>,
    settings:      new Map<string, typeof AppSettingsDefaults>(),
    subscribes:    0,
    updates:       [] as Array<{ settings: typeof AppSettingsDefaults; tenantId: string }>,
}));
const _database = {
    apps: {
        readSettings: (tenantId: string, lock: false | 'update' = false) => Effect.sync(() => {
            _state.reads.push({ lock, tenantId });
            return Option.fromNullable(_state.settings.get(tenantId)).pipe(Option.map((settings) => ({ app: { id: tenantId, settings: Option.some(settings) }, settings })));
        }),
        updateSettings: (tenantId: string, settings: typeof AppSettingsDefaults) => Effect.sync(() => {
            _state.settings.set(tenantId, settings);
            _state.updates.push({ settings, tenantId });
            return { id: tenantId };
        }),
    },
} as const;
const _eventBus = {
    publish: (event: unknown) => Effect.sync(() => { _state.publishes.push(event); }),
    subscribe: (...args: ReadonlyArray<unknown>) => Effect.sync(() => {
        _state.subscribes += 1;
        const handler = args[2] as (event: { tenantId: string }, payload: { _tag: 'app'; action: 'settings.updated' }) => Effect.Effect<void, never, never>;
        return Stream.concat(
            Stream.fromEffect(handler({ tenantId: 'tenant-sub' }, { _tag: 'app', action: 'settings.updated' })),
            Stream.fail('subscription-boom'),
        );
    }).pipe(Stream.unwrap),
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _reset = () => {
    _state.invalidations.length = 0;
    _state.publishes.length = 0;
    _state.reads.length = 0;
    _state.settings.clear();
    _state.subscribes = 0;
    _state.updates.length = 0;
};
const _provide = <A, E>(effect: Effect.Effect<A, E, unknown>) => effect.pipe(
    Effect.provide(FeatureService.DefaultWithoutDependencies),
    Effect.provideService(CacheService, _cacheService),
    Effect.provideService(DatabaseService, _database as never),
    Effect.provideService(EventBus, _eventBus as never),
    Effect.provideService(SqlClient.SqlClient, _sql as never),
) as Effect.Effect<A, E, never>;

// --- [MOCKS] -----------------------------------------------------------------

vi.mock('@parametric-portal/server/platform/cache', async () => {
    type _Key = { [PrimaryKey.symbol](): string };
    type _Def = { lookup: (key: _Key) => Effect.Effect<unknown, unknown, never> };
    const actual = await vi.importActual<typeof import('@parametric-portal/server/platform/cache')>('@parametric-portal/server/platform/cache');
    const _cacheLookup = (store: Map<string, unknown>, lookup: _Def['lookup'], key: _Key) => {
        const primary = PrimaryKey.value(key);
        return store.has(primary)
            ? Effect.succeed(store.get(primary))
            : lookup(key).pipe(Effect.tap((value) => Effect.sync(() => { store.set(primary, value); })));
    };
    const _cacheInvalidate = (store: Map<string, unknown>, key: _Key) => Effect.sync(() => {
        const primary = PrimaryKey.value(key);
        store.delete(primary);
        _state.invalidations.push(primary);
    });
    Object.defineProperty(actual.CacheService, 'cache', {
        configurable: true,
        value: (options: _Def) => Effect.sync(() => {
            const store = new Map<string, unknown>();
            return {
                get: (key: _Key) => _cacheLookup(store, options.lookup, key),
                invalidate: (key: _Key) => _cacheInvalidate(store, key),
            };
        }),
    });
    return actual;
});

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect('P1: getAll returns defaults for missing tenant, caches by tenant key', () =>
    Effect.gen(function* () {
        _reset();
        const service = yield* FeatureService;
        const first = yield* Context.Request.within('tenant-a', service.getAll);
        const second = yield* Context.Request.within('tenant-a', service.getAll);
        yield* Context.Request.within('tenant-x', service.getAll);
        expect(first).toStrictEqual(AppSettingsDefaults.featureFlags);
        expect(second).toStrictEqual(AppSettingsDefaults.featureFlags);
        expect(_state.reads).toStrictEqual([{ lock: false, tenantId: 'tenant-a' }, { lock: false, tenantId: 'tenant-x' }]);
        expect(_state.subscribes).toBe(1);
    }).pipe(_provide));
it.effect('P2: set writes flags, invalidates cache, publishes settings.updated', () =>
    Effect.gen(function* () {
        _reset();
        _state.settings.set('tenant-b', { ...AppSettingsDefaults, featureFlags: { ...AppSettingsDefaults.featureFlags, enableMfa: 0 } });
        const service = yield* FeatureService;
        yield* Context.Request.within('tenant-b', service.set('enableMfa', 100));
        const refreshed = yield* Context.Request.within('tenant-b', service.getAll);
        expect(refreshed.enableMfa).toBe(100);
        expect(_state.updates.map((entry) => entry.tenantId)).toStrictEqual(['tenant-b']);
        expect(_state.reads).toContainEqual({ lock: 'update', tenantId: 'tenant-b' });
        expect(_state.invalidations).toContain('features:tenant-b');
        expect(_state.publishes[0]).toStrictEqual({
            aggregateId: 'tenant-b',
            payload:     { _tag: 'app', action: 'settings.updated' },
            tenantId:    'tenant-b',
        });
    }).pipe(_provide));
it.effect('P3: require — Forbidden at 0%, pass-through at 100%', () =>
    Effect.gen(function* () {
        _reset();
        _state.settings.set('t', { ...AppSettingsDefaults, featureFlags: { ...AppSettingsDefaults.featureFlags, enableApiKeys: 100, enableExport: 0 } });
        const service = yield* FeatureService;
        const err = yield* Context.Request.within('t', service.require('enableExport')).pipe(Effect.flip);
        yield* Context.Request.within('t', service.require('enableApiKeys'));
        expect(err._tag).toBe('Forbidden');
    }).pipe(_provide));
it.effect.prop('P4: isEnabled/require — determinism + boundary + agreement', { rollout: fc.integer({ max: 100, min: 0 }), tenantId: fc.uuid() }, ({ rollout, tenantId }) =>
    Effect.gen(function* () {
        _reset();
        _state.settings.set(tenantId, { ...AppSettingsDefaults, featureFlags: { ...AppSettingsDefaults.featureFlags, enableMfa: rollout } });
        const service = yield* FeatureService;
        const [a, b] = yield* Effect.all([Context.Request.within(tenantId, service.isEnabled('enableMfa')), Context.Request.within(tenantId, service.isEnabled('enableMfa'))]);
        const required = yield* Context.Request.within(tenantId, service.require('enableMfa')).pipe(Effect.either);
        expect(a).toBe(b);
        expect(rollout > 0 || !a).toBe(true);
        expect(rollout < 100 || a).toBe(true);
        expect(Either.isRight(required)).toBe(a);
    }).pipe(_provide), { fastCheck: { numRuns: 100 } });

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: set fails with NotFound when tenant settings are absent', () =>
    Effect.gen(function* () {
        _reset();
        const service = yield* FeatureService;
        const failure = yield* Context.Request.within('tenant-missing', service.set('enableMfa', 42)).pipe(Effect.flip);
        expect(failure._tag).toBe('NotFound');
        expect(_state.updates).toHaveLength(0);
        expect(_state.publishes).toHaveLength(0);
    }).pipe(_provide));
