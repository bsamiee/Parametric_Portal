/**
 * Migration: Create organizations and organization_members tables with PG17 optimizations.
 */
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/noDefaultExport: @effect/sql-pg migrations require default export
export default Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
    CREATE TABLE organizations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        version INTEGER NOT NULL DEFAULT 0,
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT name_not_empty CHECK (length(trim(name)) > 0),
        CONSTRAINT slug_format CHECK (slug ~* '^[a-z0-9-]+$')
    );

    CREATE INDEX idx_organizations_slug ON organizations(slug) WHERE deleted_at IS NULL;

    CREATE TABLE organization_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
        version INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(organization_id, user_id)
    );

    CREATE INDEX idx_organization_members_org_id ON organization_members(organization_id);
    CREATE INDEX idx_organization_members_user_id ON organization_members(user_id);
`,
);
