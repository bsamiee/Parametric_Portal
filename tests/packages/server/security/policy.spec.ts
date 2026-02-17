/** Policy tests: role-based access control, session invariants, grant/revoke lifecycle. */
import { it } from '@effect/vitest';
import { SqlClient } from '@effect/sql';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '@parametric-portal/server/context';
import { EventBus } from '@parametric-portal/server/infra/events';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { PolicyService } from '@parametric-portal/server/security/policy';
import { Effect, Metric, Option, PrimaryKey, Stream } from 'effect';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _state = vi.hoisted(() => ({
    audit:         [] as Array<{ event: string; payload: unknown }>,
    grants:        [] as Array<{ action: string; appId: string; resource: string; role: string }>,
    invalidations: [] as string[],
    permissions:   new Map<string, Array<{ action: string; deletedAt: Option.Option<Date>; resource: string }>>(),
    publishes:     [] as unknown[],
    revokes:       [] as Array<{ action: string; resource: string; role: string }>,
    userMode:      'active' as 'active' | 'deleted' | 'inactive' | 'missing',
}));
const _sql = Object.assign(
    ((..._args: ReadonlyArray<unknown>) => Effect.succeed([])) as unknown as SqlClient.SqlClient,
    { withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect },
);
const _database = {
    permissions: {
        byRole: (role: string) => Effect.sync(() => _state.permissions.get(role) ?? []),
        find: () => Effect.sync(() => [..._state.permissions.values()].flat()),
        grant: (entry: { action: string; appId: string; resource: string; role: string }) => Effect.sync(() => {
            _state.grants.push(entry);
            _state.permissions.set(entry.role, [...(_state.permissions.get(entry.role) ?? []), { action: entry.action, deletedAt: Option.none(), resource: entry.resource }]);
            return entry;
        }),
        revoke: (role: string, resource: string, action: string) => Effect.sync(() => {
            _state.revokes.push({ action, resource, role });
            _state.permissions.set(role, (_state.permissions.get(role) ?? []).filter((entry) => !(entry.resource === resource && entry.action === action)));
        }),
    },
    users: { one: (_preds: ReadonlyArray<unknown>) => Effect.sync(() =>
        _state.userMode === 'missing'
            ? Option.none()
            : Option.some({
                deletedAt: _state.userMode === 'deleted' ? Option.some(_fixedDate()) : Option.none<Date>(),
                role: 'member' as const,
                status: _state.userMode === 'inactive' ? 'inactive' as const : 'active' as const,
            })) },
} as const;
const _eventBus = {
    publish: (event: unknown) => Effect.sync(() => { _state.publishes.push(event); }),
    subscribe: (...args: ReadonlyArray<unknown>) => Effect.sync(() => {
        const handler = args[2] as (event: { tenantId: string }, payload: { _tag: 'policy'; action: 'changed'; role: 'member' }) => Effect.Effect<void, never, never>;
        return Stream.fromEffect(handler({ tenantId: 'tenant-sub' }, { _tag: 'policy', action: 'changed', role: 'member' }));
    }).pipe(Stream.unwrap),
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _fixedDate =   () => Reflect.construct(Date, [Date.parse('2026-01-01T00:00:00.000Z')], Date);
const _runtimeDate = () => Reflect.construct(Date, [Date.now()], Date);
const _session = (input: Partial<{ kind: 'apiKey' | 'session'; mfaEnabled: boolean; verifiedAt: Option.Option<Date> }> = {}) => Option.some({
    appId:      'tenant-1',
    id:         'session-1',
    kind:       input.kind ?? 'session',
    mfaEnabled: input.mfaEnabled ?? true,
    userId:     'user-1',
    verifiedAt: input.verifiedAt ?? Option.some(_fixedDate()),
});
const _reset = () => { _state.audit.length = 0; _state.grants.length = 0; _state.invalidations.length = 0; _state.permissions.clear(); _state.publishes.length = 0; _state.revokes.length = 0; _state.userMode = 'active'; };
const _provide = <A, E>(effect: Effect.Effect<A, E, unknown>) => effect.pipe(
    Effect.provide(PolicyService.DefaultWithoutDependencies),
    Effect.provideService(CacheService, {} as never),
    Effect.provideService(DatabaseService, _database as never),
    Effect.provideService(AuditService, { log: (event: string, payload: unknown) => Effect.sync(() => { _state.audit.push({ event, payload }); }) } as never),
    Effect.provideService(EventBus, _eventBus as never),
    Effect.provideService(MetricsService, { errors: Metric.frequency('policy_errors_total') } as never),
    Effect.provideService(SqlClient.SqlClient, _sql as never),
) as Effect.Effect<A, E, never>;

// --- [MOCKS] -----------------------------------------------------------------

vi.mock('@parametric-portal/server/platform/cache', async () => {
    const actual = await vi.importActual<typeof import('@parametric-portal/server/platform/cache')>('@parametric-portal/server/platform/cache');
    const makeCacheStore = (options: { lookup: (key: { [PrimaryKey.symbol](): string }) => Effect.Effect<unknown, unknown, never> }) => {
        const store = {
            get: (key: { [PrimaryKey.symbol](): string }) => options.lookup(key),
            invalidate: (key: { [PrimaryKey.symbol](): string }) => Effect.sync(() => { _state.invalidations.push(PrimaryKey.value(key)); }),
        };
        return Effect.sync(() => store);
    };
    Object.defineProperty(actual.CacheService, 'cache', { configurable: true, value: makeCacheStore });
    return actual;
});

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect('P1: require succeeds + list filters deleted rows', () =>
    Effect.gen(function* () {
        _reset();
        _state.permissions.set('member', [{ action: 'getMe', deletedAt: Option.none(), resource: 'users' }, { action: 'getMe', deletedAt: Option.some(_runtimeDate()), resource: 'users' }]);
        const service = yield* PolicyService;
        yield* Context.Request.within('tenant-1', service.require('users', 'getMe'), { session: _session() });
        const [listed, listedAll] = yield* Effect.all([Context.Request.within('tenant-1', service.list('member')), Context.Request.within('tenant-1', service.list())]);
        expect(listed).toEqual([{ action: 'getMe', deletedAt: Option.none(), resource: 'users' }]);
        expect(listedAll).toEqual([{ action: 'getMe', deletedAt: Option.none(), resource: 'users' }]);
        expect(_state.invalidations).toContain('policy:tenant-sub:member');
    }).pipe(_provide));
it.effect('P2: session + interactive + MFA + active-user invariants', () =>
    Effect.gen(function* () {
        _reset();
        _state.permissions.set('member', [{ action: 'upload', deletedAt: Option.none(), resource: 'storage' }]);
        const service = yield* PolicyService;
        const [missingSession, interactive, mfaEnroll, mfaVerify] = yield* Effect.all([
            Context.Request.within('tenant-1', service.require('users', 'getMe'), { session: Option.none() }).pipe(Effect.flip),
            Context.Request.within('tenant-1', service.require('auth', 'logout'), { session: _session({ kind: 'apiKey' }) }).pipe(Effect.flip),
            Context.Request.within('tenant-1', service.require('storage', 'upload'), { session: _session({ mfaEnabled: false }) }).pipe(Effect.flip),
            Context.Request.within('tenant-1', service.require('storage', 'upload'), { session: _session({ verifiedAt: Option.none() }) }).pipe(Effect.flip),
        ]);
        _state.userMode = 'missing';
        const missingUser = yield* Context.Request.within('tenant-1', service.require('users', 'getMe'), { session: _session() }).pipe(Effect.flip);
        _state.userMode = 'inactive';
        const inactive = yield* Context.Request.within('tenant-1', service.require('users', 'getMe'), { session: _session() }).pipe(Effect.flip);
        expect([missingSession._tag, interactive._tag, mfaEnroll._tag, mfaVerify._tag, missingUser._tag, inactive._tag]).toEqual(['Auth', 'Forbidden', 'Forbidden', 'Forbidden', 'Forbidden', 'Forbidden']);
        expect([interactive.message, mfaEnroll.message, mfaVerify.message, missingUser.message, inactive.message]).toEqual(['Forbidden: Interactive session required', 'Forbidden: MFA enrollment required', 'Forbidden: MFA verification required', 'Forbidden: User not found', 'Forbidden: User is not active']);
    }).pipe(_provide));
it.effect('P3: audit on denial + grant/revoke/seed update cache+events', () =>
    Effect.gen(function* () {
        _reset();
        _state.permissions.set('member', [{ action: 'getMe', deletedAt: Option.none(), resource: 'users' }]);
        const service = yield* PolicyService;
        const denied = yield* Context.Request.within('tenant-1', service.require('users', 'updateRole'), { session: _session() }).pipe(Effect.flip);
        yield* Context.Request.within('tenant-seed', service.grant({ action: 'getMe', resource: 'users', role: 'member' }));
        yield* Context.Request.within('tenant-seed', service.revoke({ action: 'getMe', resource: 'users', role: 'member' }));
        yield* service.seedTenantDefaults('tenant-seed');
        expect(denied.message).toBe('Forbidden: Insufficient permissions');
        expect(_state.audit[0]?.event).toBe('security.permission_denied');
        expect(_state.publishes).toEqual([
            { aggregateId: 'tenant-seed', payload: { _tag: 'policy', action: 'changed', role: 'member' }, tenantId: 'tenant-seed' },
            { aggregateId: 'tenant-seed', payload: { _tag: 'policy', action: 'changed', role: 'member' }, tenantId: 'tenant-seed' },
        ]);
        expect(_state.grants.some((entry) => entry.resource === 'webhooks' && entry.role === 'guest')).toBe(false);
        expect(_state.grants.some((entry) => entry.resource === 'users' && entry.action === 'getMe' && entry.role === 'guest')).toBe(true);
        expect(_state.invalidations).toEqual(expect.arrayContaining(['policy:tenant-seed:owner', 'policy:tenant-seed:admin', 'policy:tenant-seed:member', 'policy:tenant-seed:viewer', 'policy:tenant-seed:guest']));
    }).pipe(_provide));
