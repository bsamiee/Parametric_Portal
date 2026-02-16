/**
 * Standalone migration runner script.
 * Run with: pnpm exec tsx src/migrate.ts
 */
import { NodeRuntime } from '@effect/platform-node';
import { MigratorLive } from '@parametric-portal/database/migrator';
import { Env } from '@parametric-portal/server/env';
import { Effect, Layer } from 'effect';

// --- [ENTRY_POINT] -----------------------------------------------------------

const MigrateLive = MigratorLive(Env.database(process.env));

Effect.gen(function* () {
    yield* Effect.log('Running migrations...');
    yield* Layer.launch(MigrateLive);
    yield* Effect.log('Migrations complete');
}).pipe(NodeRuntime.runMain);
