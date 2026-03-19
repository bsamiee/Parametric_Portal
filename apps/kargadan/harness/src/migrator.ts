import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeContext } from '@effect/platform-node';
import { SqlClient } from '@effect/sql';
import { PgMigrator } from '@effect/sql-pg';
import { Effect, Layer } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

// --- [FUNCTIONS] -------------------------------------------------------------

const _postMigrationVacuum = SqlClient.SqlClient.pipe(Effect.flatMap((sql) =>
    Effect.forEach([
        `VACUUM (ANALYZE, BUFFER_USAGE_LIMIT '256MB') agent_journal`,
        `VACUUM (ANALYZE, BUFFER_USAGE_LIMIT '256MB') search_documents`,
        `VACUUM (ANALYZE, BUFFER_USAGE_LIMIT '256MB') search_embeddings`,
        `VACUUM (ANALYZE, BUFFER_USAGE_LIMIT '256MB') search_terms`,
        `VACUUM (ANALYZE) kv_store`,
    ], (statement) => sql.unsafe(statement), { discard: true }).pipe(
        Effect.tap(() => Effect.logInfo('kargadan.migrator.vacuum.completed')))));

// --- [LAYERS] ----------------------------------------------------------------

const MigratorLive = PgMigrator.layer({
    loader: PgMigrator.fromFileSystem(_MIGRATIONS_DIR),
}).pipe(
    Layer.tap(() => _postMigrationVacuum),
    Layer.provide(NodeContext.layer),
);

// --- [EXPORT] ----------------------------------------------------------------

export { MigratorLive };
