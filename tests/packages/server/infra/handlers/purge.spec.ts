/** PurgeService tests: strategy return shapes, scheduling config, s3 failure resilience. */
import { it } from '@effect/vitest';
import { Context } from '@parametric-portal/server/context';
import { PurgeService } from '@parametric-portal/server/infra/handlers/purge';
import { Effect } from 'effect';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const S3_CONFIG = { batchSize: 2, concurrency: 1 } as const;
const TENANT_ID = '00000000-0000-7000-8000-000000000777' as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _mkDatabase = (overrides?: Record<string, unknown>) => ({
    apiKeys: { purge: vi.fn(() => Effect.succeed(7)) },
    assets: {
        find: vi.fn(() => Effect.succeed([{ storageRef: 's3/a' }, { storageRef: null }, { storageRef: 's3/b' }])),
        findStaleForPurge: vi.fn(() => Effect.succeed([{ storageRef: 's3/1' }, { storageRef: 's3/2' }, { storageRef: 's3/3' }])),
        purge: vi.fn(() => Effect.succeed(3)),
    },
    jobDlq: {        purge:        vi.fn(() => Effect.succeed(0)) },
    kvStore: {       purge:        vi.fn(() => Effect.succeed(0)) },
    mfaSecrets: {    purge:        vi.fn(() => Effect.succeed(0)) },
    oauthAccounts: { purge:        vi.fn(() => Effect.succeed(0)) },
    observability: { journalPurge: vi.fn(() => Effect.succeed(0)), tenantPurge: vi.fn(() => Effect.succeed(5)) },
    sessions: {      purge:        vi.fn(() => Effect.succeed(0)) },
    ...overrides,
}) as never;
const _mkStorage = () => ({ remove: vi.fn(() => Effect.void) }) as never;
const _mkFailStorage = () => ({ remove: vi.fn(() => Effect.fail(new Error('s3-down'))) }) as never;

// --- [ALGEBRAIC] -------------------------------------------------------------

// Why: All three strategies produce consistent { dbPurged, s3Deleted, s3Failed } shapes + scheduling count.
it.effect('P1: all strategies return correct shapes + scheduled jobs count', () =>
    Effect.gen(function* () {
        expect(PurgeService._scheduledJobs).toHaveLength(8);
        expect(PurgeService._scheduledJobs).not.toContain('purge-tenant-data');
        const dbOnly = yield* PurgeService._strategies['db-only'](_mkDatabase(), _mkStorage(), 365, 'apiKeys', S3_CONFIG);
        const dbS3 = yield* PurgeService._strategies['db-and-s3'](_mkDatabase(), _mkStorage(), 30, 'assets', S3_CONFIG);
        const cascade = yield* Context.Request.within(
            TENANT_ID,
            PurgeService._strategies['cascade-tenant'](_mkDatabase(), _mkStorage(), 0, 'apps', S3_CONFIG),
            Context.Request.system(),
        );
        expect(dbOnly).toEqual({ dbPurged: 7, s3Deleted: 0, s3Failed: 0 });
        expect(dbS3).toEqual({ dbPurged: 3, s3Deleted: 3, s3Failed: 0 });
        expect(cascade).toEqual({ dbPurged: 5, s3Deleted: 2, s3Failed: 0 });
    }),
);

// --- [EDGE_CASES] ------------------------------------------------------------

// Why: s3 failure reports failed count without blocking db purge + db error fail-closes to zero.
it.effect('E1: s3 failure reports s3Failed + db error yields zero purge', () =>
    Effect.gen(function* () {
        const s3Fail = yield* PurgeService._strategies['db-and-s3'](_mkDatabase(), _mkFailStorage(), 30, 'assets', S3_CONFIG);
        const dbFail = yield* PurgeService._strategies['db-only'](_mkDatabase({ apiKeys: { purge: vi.fn(() => Effect.fail(new Error('db-down'))) } }), _mkStorage(), 365, 'apiKeys', S3_CONFIG);
        expect(s3Fail).toEqual({ dbPurged: 3, s3Deleted: 0, s3Failed: 3 });
        expect(dbFail).toEqual({ dbPurged: 0, s3Deleted: 0, s3Failed: 0 });
    }),
);
