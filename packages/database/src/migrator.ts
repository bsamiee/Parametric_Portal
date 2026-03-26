/**
 * Load migrations from ../migrations directory via PgMigrator.
 * NodeContext filesystem access; caller provides explicit DB runtime config.
 */
import { NodeContext } from '@effect/platform-node';
import { SqlClient } from '@effect/sql';
import { PgMigrator } from '@effect/sql-pg';
import { Effect } from 'effect';
import { Client } from './client.ts';
import { MigrationLoader } from './migration-catalog.ts';

// --- [LAYERS] ----------------------------------------------------------------

const _postMigrationVacuum = SqlClient.SqlClient.pipe(Effect.flatMap((sql) =>
    Effect.forEach([
        `VACUUM (ANALYZE, BUFFER_USAGE_LIMIT '256MB') agent_journal`,
        `VACUUM (ANALYZE, BUFFER_USAGE_LIMIT '256MB') search_documents`,
        `VACUUM (ANALYZE, BUFFER_USAGE_LIMIT '256MB') search_embeddings`,
        `VACUUM (ANALYZE, BUFFER_USAGE_LIMIT '256MB') search_terms`,
        `VACUUM (ANALYZE) kv_store`,
    ], (statement) => sql.unsafe(statement), { discard: true }).pipe(
        Effect.tap(() => Effect.logInfo('database.migrator.vacuum.completed')))));
const MigratorRun = (databaseConfig: Record<string, unknown>) =>
    Effect.scoped(((databaseLayer) => PgMigrator.run({
        loader: MigrationLoader,
    }).pipe(
        Effect.provide(databaseLayer),
        Effect.provide(NodeContext.layer),
        Effect.zipRight(_postMigrationVacuum.pipe(Effect.provide(databaseLayer))),
    ))(Client.bootstrapLayerFromConfig(databaseConfig)));

// --- [EXPORT] ----------------------------------------------------------------

export { MigratorRun };
