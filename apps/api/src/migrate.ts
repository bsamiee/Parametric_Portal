/**
 * Standalone migration runner script.
 * Run with: pnpm exec tsx src/migrate.ts
 */
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { MigratorLive } from '@parametric-portal/database/migrator';
import { Effect, Layer } from 'effect';

// --- [ENTRY_POINT] -----------------------------------------------------------

const MigrateLive = Layer.provide(MigratorLive, NodeContext.layer);

Effect.gen(function* () {
    yield* Effect.log('Running migrations...');
    yield* Layer.launch(MigrateLive);
    yield* Effect.log('Migrations complete');
}).pipe(NodeRuntime.runMain);
