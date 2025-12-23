/**
 * Migration: Add provider and encrypted key columns to api_keys.
 * Enables provider-agnostic API key storage with server-side AES-256-GCM encryption.
 */
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/noDefaultExport: @effect/sql-pg migrations require default export
export default Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
    ALTER TABLE api_keys ADD COLUMN provider TEXT NOT NULL DEFAULT 'anthropic';
    ALTER TABLE api_keys ADD COLUMN key_encrypted BYTEA;

    CREATE INDEX idx_api_keys_user_provider ON api_keys(user_id, provider) INCLUDE (name, expires_at);
`,
);
