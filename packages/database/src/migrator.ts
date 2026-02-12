/**
 * Load migrations from ../migrations directory via PgMigrator.
 * NodeContext filesystem access; depends on Client.layer.
 */
import { fileURLToPath } from 'node:url';
import { NodeContext } from '@effect/platform-node';
import { PgMigrator } from '@effect/sql-pg';
import { Layer } from 'effect';
import { Client } from './client.ts';

// --- [LAYERS] ----------------------------------------------------------------

const MigratorLive = PgMigrator.layer({ loader: PgMigrator.fromFileSystem(fileURLToPath(new URL(/* @vite-ignore */ '../migrations', import.meta.url))) }).pipe(
    Layer.provide(Client.layer),
    Layer.provide(NodeContext.layer),
);

// --- [EXPORT] ----------------------------------------------------------------

export { MigratorLive };
