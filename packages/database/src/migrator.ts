/**
 * Load migrations from ../migrations directory via PgMigrator.
 * NodeContext filesystem access; caller provides explicit DB runtime config.
 */
import { fileURLToPath } from 'node:url';
import { NodeContext } from '@effect/platform-node';
import { PgMigrator } from '@effect/sql-pg';
import { Layer } from 'effect';
import { Client } from './client.ts';

// --- [LAYERS] ----------------------------------------------------------------

const MigratorLive = (config: Parameters<typeof Client.layerFromConfig>[0]) =>
    PgMigrator.layer({ loader: PgMigrator.fromFileSystem(fileURLToPath(new URL(/* @vite-ignore */ '../migrations', import.meta.url))) }).pipe(
        Layer.provide(NodeContext.layer),
        Layer.provide(Client.layerFromConfig(config)),
    );

// --- [EXPORT] ----------------------------------------------------------------

export { MigratorLive };
