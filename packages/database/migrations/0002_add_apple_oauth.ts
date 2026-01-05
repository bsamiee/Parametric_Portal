/**
 * Migration: Add 'apple' to oauth_provider enum.
 * Extends enum to support Sign In with Apple authentication.
 */
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/noDefaultExport: @effect/sql-pg migrations require default export
export default Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`ALTER TYPE oauth_provider ADD VALUE IF NOT EXISTS 'apple';`,
);
