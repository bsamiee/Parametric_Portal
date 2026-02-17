/** Audit tests: operation parsing, dead-letter semantics, replay lifecycle. */
import { it } from '@effect/vitest';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '@parametric-portal/server/context';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Effect, Metric, Option } from 'effect';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _metrics = { audit: { failures: Metric.counter('audit_failures_total'), writes: Metric.counter('audit_writes_total') } } as const;
const _tenantId = '00000000-0000-7000-8000-000000000777' as const;
const _requestId = '00000000-0000-7000-8000-000000000099';
const _userId = '00000000-0000-7000-8000-000000000123' as const;
const _verifiedAt = Reflect.construct(Date, [Date.parse('2026-01-01T00:00:00.000Z')], Date);
const _session = Option.some({
    appId:      _tenantId,
    id:         'session-1',
    kind:       'session' as const,
    mfaEnabled: true,
    userId:     _userId,
    verifiedAt: Option.some(_verifiedAt),
});
const _state = vi.hoisted(() => ({
    auditEntries: [] as Array<Record<string, unknown>>,
    auditFails:   false,
    dlqInserts:   [] as Array<Record<string, unknown>>,
    markReplayed: [] as string[],
    pendingQueue: [] as Array<{ items: ReadonlyArray<{ id: string; payload: unknown }> }>,
    spans:        [] as string[],
}));
const _database = {
    audit: {
        log: (entry: Record<string, unknown>) => _state.auditFails
            ? Effect.fail(new Error('audit-write-failed'))
            : Effect.sync(() => { _state.auditEntries.push(entry); }),
    },
    jobDlq: {
        insert: (entry: Record<string, unknown>) => Effect.sync(() => { _state.dlqInserts.push(entry); }),
        listPending: (_input: { limit: number; type: string }) => Effect.sync(() => _state.pendingQueue.shift() ?? { items: [] }),
        markReplayed: (id: string) => Effect.sync(() => { _state.markReplayed.push(id); }),
    },
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _reset = () => {
    _state.auditEntries.length = 0;
    _state.auditFails = false;
    _state.dlqInserts.length = 0;
    _state.markReplayed.length = 0;
    _state.pendingQueue.length = 0;
    _state.spans.length = 0;
};
const _provide = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(
    Effect.provide(AuditService.Default),
    Effect.provideService(DatabaseService, _database as never),
    Effect.provideService(MetricsService, _metrics as never),
);

// --- [MOCKS] -----------------------------------------------------------------

vi.mock('@parametric-portal/server/observe/telemetry', async () => {
    const { identity } = await import('effect/Function');
    return {
        Telemetry: {
            span: (...args: ReadonlyArray<unknown>) => {
                const [first, second] = args;
                const isName = typeof first === 'string';
                const secondLabel = typeof second === 'string' ? second : 'unknown';
                _state.spans.push(isName ? first : secondLabel);
                return isName ? identity : first;
            },
        },
    };
});

// --- [ALGEBRAIC] -------------------------------------------------------------

// Why: log derives targetType/operation from dotted name, attaches delta + subjectId; bare names default to security; invalid ops silently dropped.
it.effect('log: dotted parsing + bare security default + delta + invalid rejection', () =>
    Effect.gen(function* () {
        _reset();
        const service = yield* AuditService;
        const ctx = { requestId: _requestId, session: _session };
        yield* Effect.all([
            Context.Request.within(_tenantId, service.log('users.update', { after: { name: 'b' }, before: { name: 'a' }, subjectId: _userId }), ctx),
            Context.Request.within(_tenantId, service.log('users.not_a_real_operation', { details: { x: 1 } }), ctx),
            Context.Request.within(_tenantId, service.log('permission_denied', { details: { scope: 'api' } }), ctx),
        ]);
        expect(_state.auditEntries).toHaveLength(2);
        expect(_state.auditEntries[0]).toMatchObject({ delta: Option.some({ new: { name: 'b' }, old: { name: 'a' } }), operation: 'update', targetId: _userId, targetType: 'users' });
        expect(_state.auditEntries[1]).toMatchObject({ operation: 'permission_denied', targetType: 'security' });
        expect(_state.spans).toContain('audit.log');
    }).pipe(_provide));
// Why: DLQ insertion — security + non-silent dead-lettered on write failure; silent non-security skipped.
it.effect('DLQ: security and non-silent events dead-lettered, silent non-security skipped', () =>
    Effect.gen(function* () {
        _reset();
        _state.auditFails = true;
        const service = yield* AuditService;
        const ctx = { requestId: _requestId, session: _session };
        yield* Effect.all([
            Context.Request.within(_tenantId, service.log('security.permission_denied', { details: { scope: 'admin' } }), ctx),
            Context.Request.within(_tenantId, service.log('users.update', { details: { silent: true }, silent: true }), ctx),
            Context.Request.within(_tenantId, service.log('users.update', { details: { silent: false } }), ctx),
        ]);
        expect(_state.dlqInserts).toHaveLength(2);
        expect(_state.dlqInserts.map((entry) => entry['errorReason'])).toEqual(['AuditPersistFailed', 'AuditPersistFailed']);
        expect(_state.dlqInserts.every((entry) => entry['appId'] === _tenantId && String(entry['type']).startsWith('audit.'))).toBe(true);
    }).pipe(_provide));
// Why: replay semantics — valid items replayed + marked, invalid counted as failed, empty queue skipped.
it.effect('replayDeadLetters: replays valid, counts invalid, skips empty', () =>
    Effect.gen(function* () {
        _reset();
        const service = yield* AuditService;
        const payload = {
            appId: _tenantId, contextAgent: null, contextIp: null,
            delta: { new: { ok: true }, old: { ok: false } },
            operation: 'update', requestId: _requestId,
            targetId: _userId, targetType: 'users', userId: _userId,
        } as const;
        _state.pendingQueue.push({ items: [{ id: 'dlq-1', payload }, { id: 'dlq-2', payload: { bad: true } }] }, { items: [] });
        const [first, second] = yield* Effect.all([service.replayDeadLetters, service.replayDeadLetters]);
        expect(_state.markReplayed).toEqual(['dlq-1']);
        expect(first).toEqual({ failed: 1, replayed: 1, skipped: false });
        expect(second).toEqual({ failed: 0, replayed: 0, skipped: true });
    }).pipe(_provide));
