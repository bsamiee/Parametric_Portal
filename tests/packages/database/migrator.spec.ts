/** migrator.ts tests: MigratorLive returns a valid Layer composed from PgMigrator, NodeContext, Client. */
import { it } from '@effect/vitest';
import { MigratorLive } from '@parametric-portal/database/migrator';
import { Effect, Layer, Option, Redacted } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    appName: 'tests',
    connectionTtlMs: 60_000,
    connectionUrl: Redacted.make('postgres://localhost:5432/postgres'),
    connectTimeoutMs: 1_000,
    idleTimeoutMs: 1_000,
    options: '',
    poolMax: 1,
    poolMin: 1,
    ssl: {
        caPath: Option.none(), certPath: Option.none(), enabled: false,
        keyPath: Option.none(), minVersion: 'TLSv1.2', rejectUnauthorized: true, servername: Option.none(),
    },
    timeouts: { idleInTransactionMs: 1_000, lockMs: 1_000, statementMs: 1_000, transactionMs: 1_000 },
    trigramThresholds: { similarity: 0.3, strictWordSimilarity: 0.5, wordSimilarity: 0.6 },
} as const;

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: MigratorLive returns a Layer', () =>
    Effect.sync(() => {
        expect(Layer.isLayer(MigratorLive(_CONFIG))).toBe(true);
    }),
);
