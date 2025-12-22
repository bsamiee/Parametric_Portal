/**
 * Migration: Create users and assets tables with PostgreSQL 17 optimizations.
 * Uses gen_random_uuid() (PostgreSQL native RFC 4122 v4 random UUIDs).
 */
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/noDefaultExport: @effect/sql-pg migrations require default export
export default Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
    CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        version INTEGER NOT NULL DEFAULT 0,
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        -- Defense-in-depth: simple @ check; full RFC validation via EmailSchema at app layer
        CONSTRAINT email_format CHECK (position('@' in email) > 1)
    );

    CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;

    CREATE TABLE assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        prompt TEXT NOT NULL,
        svg TEXT NOT NULL,
        metadata JSONB,
        version INTEGER NOT NULL DEFAULT 0,
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT prompt_not_empty CHECK (length(trim(prompt)) > 0),
        CONSTRAINT svg_not_empty CHECK (length(trim(svg)) > 0)
    );

    CREATE INDEX idx_assets_user_id ON assets(user_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_assets_created_at ON assets(created_at DESC) WHERE deleted_at IS NULL;
`,
);
