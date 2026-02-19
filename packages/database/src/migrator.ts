/**
 * Load migrations from ../migrations directory via PgMigrator.
 * NodeContext filesystem access; caller provides explicit DB runtime config.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { PgMigrator } from '@effect/sql-pg';
import { Layer } from 'effect';
import { Client } from './client.ts';

// --- [LAYERS] ----------------------------------------------------------------

const MigratorLive = (config: Parameters<typeof Client.layerFromConfig>[0]) =>
    PgMigrator.layer({
        loader: PgMigrator.fromFileSystem(
            import.meta.url.startsWith('file:')
                ? resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')
                : resolve(process.cwd(), 'packages/database/migrations'),
        ),
    }).pipe(
        Layer.provide(NodeContext.layer),
        Layer.provide(Client.layerFromConfig(config)),
    );

// --- [EXPORT] ----------------------------------------------------------------

export { MigratorLive };
