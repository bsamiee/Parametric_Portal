/**
 * Migration: Add multi-app support for tenant isolation.
 * Creates apps table and adds appId foreign key to users, assets, audit_logs.
 *
 * ROLLBACK STRATEGY (manual):
 * 1. DROP INDEX idx_audit_app_id, idx_audit_entity
 * 2. DROP INDEX idx_assets_app_id, idx_assets_user_id
 * 3. DROP INDEX idx_users_app_id, idx_users_email
 * 4. ALTER TABLE users DROP CONSTRAINT users_app_email_unique
 * 5. ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email)
 * 6. ALTER TABLE audit_logs DROP COLUMN app_id
 * 7. ALTER TABLE assets DROP COLUMN app_id
 * 8. ALTER TABLE users DROP COLUMN app_id
 * 9. DROP TABLE apps
 * 10. CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id)
 * 11. CREATE INDEX idx_assets_user_id ON assets(user_id) WHERE deleted_at IS NULL
 * 12. CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL
 *
 * WARNING: Rollback causes data loss if multiple apps exist (users/assets/audit with same email across apps collapse).
 */
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/noDefaultExport: @effect/sql-pg migrations require default export
export default Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
    -- Apps table for multi-tenant support
    CREATE TABLE apps (
        id UUID PRIMARY KEY DEFAULT uuidv7(),
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        settings JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT apps_slug_unique UNIQUE NULLS NOT DISTINCT (slug),
        CONSTRAINT slug_format CHECK (slug ~* '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
        CONSTRAINT name_not_empty CHECK (length(trim(name)) > 0)
    );
    CREATE INDEX idx_apps_slug ON apps(slug) INCLUDE (id, name);

    -- Create default app for backfilling existing data (idempotent)
    INSERT INTO apps (name, slug) VALUES ('default', 'default') ON CONFLICT DO NOTHING;

    -- Verify default app exists before proceeding with backfill
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM apps WHERE slug = 'default') THEN
            RAISE EXCEPTION 'Default app not found - INSERT may have failed';
        END IF;
    END $$;

    -- Migrate users table with three-step backfill strategy
    -- Step 1: Add column as nullable
    ALTER TABLE users ADD COLUMN app_id UUID REFERENCES apps(id);
    -- Step 2: Backfill with default app (guaranteed to exist from check above)
    UPDATE users SET app_id = (SELECT id FROM apps WHERE slug = 'default') WHERE app_id IS NULL;
    -- Step 3: Add NOT NULL constraint
    ALTER TABLE users ALTER COLUMN app_id SET NOT NULL;

    -- Drop existing email unique constraint and replace with composite unique
    -- NOTE: Assumes original constraint name is 'users_email_unique' (Drizzle default for unique(email))
    -- If constraint has different name, this DROP will silently succeed but ADD below will fail
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique;
    ALTER TABLE users ADD CONSTRAINT users_app_email_unique UNIQUE NULLS NOT DISTINCT (app_id, email);

    -- Add covering index for app-scoped user lookups
    DROP INDEX IF EXISTS idx_users_email;
    CREATE INDEX idx_users_email ON users(app_id, email) INCLUDE (id, role) WHERE deleted_at IS NULL;
    CREATE INDEX idx_users_app_id ON users(app_id) INCLUDE (id, email) WHERE deleted_at IS NULL;

    -- Migrate assets table with three-step backfill strategy
    ALTER TABLE assets ADD COLUMN app_id UUID REFERENCES apps(id);
    UPDATE assets SET app_id = (SELECT id FROM apps WHERE slug = 'default') WHERE app_id IS NULL;
    ALTER TABLE assets ALTER COLUMN app_id SET NOT NULL;

    -- Update assets index for app-scoped lookups
    DROP INDEX IF EXISTS idx_assets_user_id;
    CREATE INDEX idx_assets_user_id ON assets(app_id, user_id) INCLUDE (id, asset_type) WHERE deleted_at IS NULL;
    CREATE INDEX idx_assets_app_id ON assets(app_id) INCLUDE (id, asset_type) WHERE deleted_at IS NULL;

    -- Migrate audit_logs table with three-step backfill strategy
    ALTER TABLE audit_logs ADD COLUMN app_id UUID REFERENCES apps(id);
    UPDATE audit_logs SET app_id = (SELECT id FROM apps WHERE slug = 'default') WHERE app_id IS NULL;
    ALTER TABLE audit_logs ALTER COLUMN app_id SET NOT NULL;

    -- Update audit_logs indexes for app-scoped lookups
    DROP INDEX IF EXISTS idx_audit_entity;
    CREATE INDEX idx_audit_entity ON audit_logs(app_id, entity_type, entity_id) INCLUDE (operation, created_at);
    CREATE INDEX idx_audit_app_id ON audit_logs(app_id) INCLUDE (entity_type, operation, created_at);
`,
);
