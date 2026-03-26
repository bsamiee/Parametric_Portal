/**
 * Standalone migration runner script.
 * Run with: pnpm exec tsx src/migrate.ts
 */
import { NodeRuntime } from '@effect/platform-node';
import { MigratorRun } from '@parametric-portal/database/migrator';
import { Env } from '@parametric-portal/server/env';
import { Effect } from 'effect';

Effect.gen(function* () {
    yield* Effect.log('Running migrations...');
    yield* MigratorRun(Env.database(process.env));
    yield* Effect.log('Migrations complete');
}).pipe(NodeRuntime.runMain);
