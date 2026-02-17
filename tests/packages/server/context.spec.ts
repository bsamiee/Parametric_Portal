/** Context tests: tenant isolation, session propagation, cluster boundaries. */
import { it } from '@effect/vitest';
import { Context } from '@parametric-portal/server/context';
import { Effect, FastCheck as fc, Option } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _uuid = fc.uuid();
const _session = (userId: string, appId: string) => Option.some({
    appId,
    id:         'session-1',
    kind:       'session' as const,
    mfaEnabled: true,
    userId,
    verifiedAt: Option.none<Date>(),
});

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: within propagates tenantId + session + config statics', {
    appId: _uuid, tenantId: _uuid, userId: _uuid,
}, ({ appId, tenantId, userId }) =>
    Context.Request.within(
        tenantId,
        Effect.all([
            Context.Request.currentTenantId,
            Context.Request.current,
            Context.Request.sessionOrFail,
        ]),
        { requestId: 'req-1', session: _session(userId, appId) },
    ).pipe(Effect.tap(([tid, current, session]) => {
        expect(tid).toBe(tenantId);
        expect(current.requestId).toBe('req-1');
        expect(session.userId).toBe(userId);
        expect(session.appId).toBe(appId);
        expect(Context.Request.Id.system).toBeDefined();
        expect(Context.Request.Headers.appId).toBe('x-app-id');
        expect(Context.Request.config.csrf.header).toBe('x-requested-with');
    }), Effect.asVoid));
it.effect('P2: sessionOrFail rejects absent + clusterState requires withinCluster', () =>
    Effect.gen(function* () {
        const authErr = yield* Context.Request.within(
            Context.Request.Id.system,
            Context.Request.sessionOrFail,
            { requestId: 'req-2', session: Option.none() },
        ).pipe(Effect.flip);
        const clusterErr = yield* Context.Request.within(
            Context.Request.Id.system,
            Context.Request.clusterState,
        ).pipe(Effect.flip, Effect.map(String));
        const cluster = yield* Context.Request.within(
            Context.Request.Id.system,
            Context.Request.withinCluster(Context.Request.clusterState, {entityId: 'e-1', entityType: 'job', isLeader: true,}),
        );
        expect(authErr._tag).toBe('Auth');
        expect(authErr.message).toContain('Missing session');
        expect(clusterErr).toContain('ClusterContextRequired');
        expect(cluster.entityId).toBe('e-1');
    }));

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: system() factory produces well-formed defaults', () =>
    Effect.sync(() => {
        const sys = Context.Request.system(crypto.randomUUID(), Context.Request.Id.system);
        expect(sys.requestId).toMatch(/^[0-9a-f-]{36}$/);
        expect(sys.tenantId).toBe(Context.Request.Id.system);
        expect(Option.isNone(sys.session)).toBe(true);
        expect(Option.isNone(sys.cluster)).toBe(true);
        expect(Option.isNone(sys.ipAddress)).toBe(true);
        expect(Option.isNone(sys.rateLimit)).toBe(true);
    }));
