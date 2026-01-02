/**
 * PgMigrator layer for database schema migrations.
 * Uses file-system loader to run migrations from ../migrations directory.
 */
import '@effect/platform';
import { fileURLToPath } from 'node:url';
import { PgMigrator } from '@effect/sql-pg';
import { Layer } from 'effect';
import { PgLive } from './client.ts';

// --- [LAYERS] ----------------------------------------------------------------

const MigratorLive = PgMigrator.layer({
    loader: PgMigrator.fromFileSystem(fileURLToPath(new URL(/* @vite-ignore */ '../migrations', import.meta.url))),
}).pipe(Layer.provide(PgLive));

// --- [EXPORT] ----------------------------------------------------------------

export { MigratorLive };
