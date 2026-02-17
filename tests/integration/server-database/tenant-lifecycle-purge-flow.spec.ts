/** Tenant lifecycle + purge flow integration tests: schema contracts, service tag
 * identifiers, and structural properties of transition commands and purge configs.
 * Oracle: Schema.decodeUnknown roundtrip — structural truths independent of implementation. */
import { it } from '@effect/vitest';
import { ClusterService } from '@parametric-portal/server/infra/cluster';
import { PurgeService } from '@parametric-portal/server/infra/handlers/purge';
import { _TransitionCommand, TenantLifecycleService } from '@parametric-portal/server/infra/handlers/tenant-lifecycle';
import { Cron, Effect, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const TENANT_UUID = '00000000-0000-7000-8000-000000000999' as const;
const TRANSITION_VECTORS = [
    { _tag: 'purge',   tenantId: TENANT_UUID },
    { _tag: 'suspend', tenantId: TENANT_UUID },
    { _tag: 'resume',  tenantId: TENANT_UUID },
    { _tag: 'archive', tenantId: TENANT_UUID },
] as const;

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect('P1: _TransitionCommand decodes all tenant-id variants', () =>
    Effect.forEach(TRANSITION_VECTORS, (vector) =>
        S.decodeUnknown(_TransitionCommand)(vector).pipe(Effect.tap((decoded) => { expect(decoded).toEqual(vector); }),)).pipe(Effect.asVoid));
it.effect('P2: _TransitionCommand decodes provision variant with namespace pattern', () =>
    S.decodeUnknown(_TransitionCommand)({
        _tag: 'provision',
        name: 'Test Tenant',
        namespace: 'test-tenant-ns',
    }).pipe(
        Effect.tap((decoded) => {
            expect(decoded._tag).toBe('provision');
            expect(decoded).toHaveProperty('namespace', 'test-tenant-ns');
        }),
        Effect.asVoid));
it.effect('P3: ClusterService.Schedule.cronInfo returns deterministic nextRuns length', () =>
    ClusterService.Schedule.cronInfo(
        Cron.unsafeParse('0 3 * * *'),
        { nextCount: 3 },
    ).pipe(
        Effect.tap((info) => {
            expect(info.nextRuns).toHaveLength(3);
            expect(typeof info.matchesNow).toBe('boolean');
        }),
        Effect.asVoid));

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: service tags have expected identifiers', () =>
    Effect.sync(() => {
        expect((TenantLifecycleService as { readonly key: string }).key).toBe('server/TenantLifecycle');
        expect((PurgeService as { readonly key: string }).key).toBe('server/Purge');
    }));
it.effect('E2: _TransitionCommand rejects invalid namespace patterns', () =>
    S.decodeUnknown(_TransitionCommand)({
        _tag: 'provision',
        name: 'Bad',
        namespace: '-invalid',
    }).pipe(
        Effect.flip,
        Effect.tap((error) => { expect(error).toBeDefined(); }),
        Effect.asVoid));
it.effect('E3: PurgeService._strategies exposes expected strategy keys', () =>
    Effect.sync(() => {
        const keys = Object.keys(PurgeService._strategies).sort((a, b) => a.localeCompare(b));
        expect(keys).toEqual(['cascade-tenant', 'db-and-s3', 'db-only']);
    }));
