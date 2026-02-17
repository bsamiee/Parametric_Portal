/** Tenant lifecycle tests: schema roundtrip, DNS labels, transition dispatch, compensation. */
import { it } from '@effect/vitest';
import { SqlClient } from '@effect/sql';
import { DatabaseService } from '@parametric-portal/database/repos';
import { _TransitionCommand, TenantLifecycleService } from '@parametric-portal/server/infra/handlers/tenant-lifecycle';
import { EventBus } from '@parametric-portal/server/infra/events';
import { JobService } from '@parametric-portal/server/infra/jobs';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { PolicyService } from '@parametric-portal/server/security/policy';
import { Effect, FastCheck as fc, Option, Schema as S } from 'effect';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------
const UUID_A =    '00000000-0000-7000-8000-000000000111' as const;
const UUID_B =    '00000000-0000-7000-8000-000000000222' as const;
const _alphaNum = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''));
const _dnsLabel = fc.tuple(fc.array(_alphaNum, { maxLength: 1, minLength: 1 }).map((a) => a.join('')), fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), { maxLength: 62, minLength: 1 }).map((a) => a.join('')), fc.array(_alphaNum, { maxLength: 1, minLength: 1 }).map((a) => a.join(''))).map(([h, m, t]) => `${h}${m}${t}`);
const _sql =      Object.assign(((..._: ReadonlyArray<unknown>) => Effect.succeed([])) as unknown as SqlClient.SqlClient, { withTransaction: <A, E, R>(e: Effect.Effect<A, E, R>) => e });

// --- [FUNCTIONS] -------------------------------------------------------------
const _mkApp =    (status: string) => ({ id: UUID_A, name: 'Acme', namespace: 'acme-ns', settings: Option.none(), status }) as never;
const _mkJobs =   (fail = false) => ({ registerHandler: vi.fn(() => Effect.void), submit: vi.fn(() => fail ? Effect.fail('job-error' as never) : Effect.void) }) as never;
const _mkPolicy = (fail = false) => ({ seedTenantDefaults: vi.fn(() => fail ? Effect.fail({ _tag: 'InternalServerError' } as never) : Effect.void) }) as never;
const _mkDb =     (o: { readonly a?: unknown; readonly ns?: unknown; readonly set?: Option.Option<unknown> } = {}) => ({ apps: {
    byNamespace: vi.fn(() => Effect.succeed(Option.fromNullable(o.ns ?? null))), drop: vi.fn(() => Effect.void),
    insert:      vi.fn((d: unknown) => Effect.succeed({ ...(d as Record<string, unknown>), id: UUID_A })),
    one:         vi.fn(() => Effect.succeed(Option.fromNullable(o.a ?? null))), set: vi.fn(() => Effect.succeed(o.set ?? Option.some({}))),
} }) as never;
const _transition = (cmd: typeof _TransitionCommand.Type, db = _mkDb(), pol = _mkPolicy(), jobs = _mkJobs()) => Effect.gen(function* () { return yield* (yield* TenantLifecycleService).transition(cmd); }).pipe((e) => _provide(e, db, pol, jobs));
const _provide = <A, E>(effect: Effect.Effect<A, E, unknown>, db = _mkDb(), pol = _mkPolicy(), jobs = _mkJobs()) => effect.pipe(
    Effect.provide(TenantLifecycleService.DefaultWithoutDependencies),
    Effect.provideService(AuditService, { log: vi.fn(() => Effect.void) } as never),
    Effect.provideService(DatabaseService, db), Effect.provideService(EventBus, { publish: vi.fn(() => Effect.void) } as never),
    Effect.provideService(JobService, jobs), Effect.provideService(PolicyService, pol),
    Effect.provideService(SqlClient.SqlClient, _sql as never),
) as Effect.Effect<A, E, never>;

// --- [ALGEBRAIC] -------------------------------------------------------------

// Why: Roundtrip + DNS label universality + UUID rejection — packed: annihilation + RFC 1123 + boundary.
it.effect.prop('P1: schema roundtrip + DNS accept + UUID reject', { bad: fc.string({ maxLength: 50, minLength: 1 }), cmd: _TransitionCommand, ns: _dnsLabel }, ({ bad, cmd, ns }) =>
    Effect.gen(function* () {
        fc.pre(!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bad)));
        expect(yield* S.encode(_TransitionCommand)(cmd).pipe(Effect.flatMap(S.decodeUnknown(_TransitionCommand)))).toStrictEqual(cmd);
        expect((yield* S.decodeUnknown(_TransitionCommand)({ _tag: 'provision', name: 'T', namespace: ns }))._tag).toBe('provision');
        expect((yield* S.decodeUnknown(_TransitionCommand)({ _tag: 'suspend', tenantId: bad }).pipe(Effect.exit))._tag).toBe('Failure');
    }),
);

// --- [EDGE_CASES] ------------------------------------------------------------

// Why: All 5 tags decode + contract + 6 rejection boundaries in one pass.
it.effect('E1: all tags decode + contract stable + rejection boundaries', () =>
    Effect.gen(function* () {
        const tags = yield* Effect.all([S.decodeUnknown(_TransitionCommand)({ _tag: 'provision', name: 'Acme Corp', namespace: 'acme-corp' }),
            S.decodeUnknown(_TransitionCommand)({ _tag: 'suspend', tenantId: UUID_A }), S.decodeUnknown(_TransitionCommand)({ _tag: 'resume', tenantId: UUID_A }),
            S.decodeUnknown(_TransitionCommand)({ _tag: 'archive', tenantId: UUID_B }), S.decodeUnknown(_TransitionCommand)({ _tag: 'purge', tenantId: UUID_B })]);
        expect(tags.map((t) => t._tag)).toEqual(['provision', 'suspend', 'resume', 'archive', 'purge']);
        expect((TenantLifecycleService as { readonly key: string }).key).toBe('server/TenantLifecycle');
        expect(typeof TenantLifecycleService.Handlers).toBe('object');
        expect(typeof TenantLifecycleService.Layer).toBe('object');
        const exits = yield* Effect.all([S.decodeUnknown(_TransitionCommand)({ _tag: 'destroy', tenantId: UUID_A }).pipe(Effect.exit),
            S.decodeUnknown(_TransitionCommand)({ _tag: 'provision' }).pipe(Effect.exit),
            S.decodeUnknown(_TransitionCommand)({ _tag: 'provision', name: '', namespace: 'valid-ns' }).pipe(Effect.exit),
            S.decodeUnknown(_TransitionCommand)({ _tag: 'provision', name: 'Valid', namespace: 'x' }).pipe(Effect.exit),
            S.decodeUnknown(_TransitionCommand)({ _tag: 'provision', name: 'Valid', namespace: '-invalid' }).pipe(Effect.exit),
            S.decodeUnknown(_TransitionCommand)({ _tag: 'suspend' }).pipe(Effect.exit)]);
        expect(exits.every((e) => e._tag === 'Failure')).toBe(true);
    }),
);
// Why: Valid + invalid + NotFound + CAS — full _TRANSITIONS + _lookupTenant + _statusGuard coverage.
it.effect('E2: transition dispatch — valid succeed, invalid/missing/CAS fail', () =>
    Effect.gen(function* () {
        const [sus, res, arc] = yield* Effect.all([_transition({ _tag: 'suspend', tenantId: UUID_A }, _mkDb({ a: _mkApp('active') })),
            _transition({ _tag: 'resume', tenantId: UUID_A }, _mkDb({ a: _mkApp('suspended') })), _transition({ _tag: 'archive', tenantId: UUID_A }, _mkDb({ a: _mkApp('suspended') }))]);
        expect([sus, res, arc]).toEqual([{ success: true }, { success: true }, { success: true }]);
        const [inv1, inv2, notFound, cas] = yield* Effect.all([_transition({ _tag: 'suspend', tenantId: UUID_A }, _mkDb({ a: _mkApp('suspended') })).pipe(Effect.flip),
            _transition({ _tag: 'suspend', tenantId: UUID_A }, _mkDb({ a: _mkApp('purging') })).pipe(Effect.flip), _transition({ _tag: 'suspend', tenantId: UUID_A }).pipe(Effect.flip),
            _transition({ _tag: 'suspend', tenantId: UUID_A }, _mkDb({ a: _mkApp('active'), set: Option.none() })).pipe(Effect.flip)]);
        expect([inv1._tag, inv2._tag, notFound._tag, cas._tag]).toEqual(['Validation', 'Validation', 'NotFound', 'Conflict']);
    }),
);
// Why: Provision + purge — success/conflict/seed-fail/CAS/job-fail — covers _provision + purge Match branches.
it.effect('E3: provision + purge — success, conflict, compensation, CAS, job failure', () =>
    Effect.gen(function* () {
        const provOk = yield* _transition({ _tag: 'provision', name: 'Co', namespace: 'new-co' });
        expect('id' in provOk ? provOk.id : undefined).toBe(UUID_A);
        const [provConflict, seedFail] = yield* Effect.all([
            _transition({ _tag: 'provision', name: 'Co',  namespace: 'co-ns' },  _mkDb({ ns: _mkApp('active') })).pipe(Effect.flip),
            _transition({ _tag: 'provision', name: 'Bad', namespace: 'bad-co' }, _mkDb(), _mkPolicy(true)).pipe(Effect.flip)]);
        expect([provConflict._tag, seedFail._tag]).toEqual(['Conflict', 'Internal']);
        const purgeOk = yield* _transition({ _tag: 'purge', tenantId: UUID_A }, _mkDb({ a: _mkApp('archived') }));
        const [purgeCas, purgeJob] = yield* Effect.all([
            _transition({ _tag: 'purge', tenantId: UUID_A }, _mkDb({ a: _mkApp('archived'), set: Option.none() })).pipe(Effect.flip),
            _transition({ _tag: 'purge', tenantId: UUID_A }, _mkDb({ a: _mkApp('archived') }), _mkPolicy(), _mkJobs(true)).pipe(Effect.flip)]);
        expect(purgeOk).toEqual({ success: true });
        expect([purgeCas._tag, purgeJob._tag]).toEqual(['Conflict', 'Internal']);
    }),
);
// Why: Handlers register + invoke + error paths — covers static Handlers block.
it.effect('E4: Handlers register + invoke + error paths', () => {
    const handlers = new Map<string, (p: unknown) => Effect.Effect<void, unknown>>();
    const _build = (fn: () => Effect.Effect<unknown, unknown>) => Effect.void.pipe(Effect.provide(TenantLifecycleService.Handlers),
        Effect.provideService(JobService, { registerHandler: vi.fn((_: string, h: (p: unknown) => Effect.Effect<void, unknown>) => { handlers.set(_, h); return Effect.void; }), submit: vi.fn(() => Effect.void) } as never),
        Effect.provideService(TenantLifecycleService, { transition: fn } as never));
    const _call = (n: string, p: unknown) => (handlers.get(n) ?? (() => Effect.void))(p);
    return Effect.gen(function* () {
        yield* _build(() => Effect.succeed({ success: true }));
        expect(handlers.size).toBe(2);
        yield* _call('provision-tenant', { name: 'Acme', namespace: 'acme-co' });
        yield* _call('tenant-lifecycle', { _tag: 'suspend', tenantId: UUID_A });
        const [badP, badL] = yield* Effect.all([_call('provision-tenant', {}).pipe(Effect.exit), _call('tenant-lifecycle', {}).pipe(Effect.exit)]);
        expect([badP._tag, badL._tag]).toEqual(['Failure', 'Failure']);
        handlers.clear();
        yield* _build(() => Effect.fail({ _tag: 'Internal' }));
        yield* _call('provision-tenant', { name: 'X', namespace: 'xco-ns' }).pipe(Effect.exit);
        yield* _call('tenant-lifecycle', { _tag: 'suspend', tenantId: UUID_A }).pipe(Effect.exit);
    });
});
