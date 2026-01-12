/**
 * Migration: Create all database tables matching schema.ts.
 * PostgreSQL 18.1 features: NULLS NOT DISTINCT, covering indexes with INCLUDE.
 */
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/noDefaultExport: @effect/sql-pg migrations require default export
export default Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
    -- Enums
    CREATE TYPE role AS ENUM ('guest', 'viewer', 'member', 'admin', 'owner');
    CREATE TYPE oauth_provider AS ENUM ('google', 'github', 'microsoft', 'apple');
    CREATE TYPE ai_provider AS ENUM ('anthropic', 'openai', 'gemini');
    CREATE TYPE asset_type AS ENUM ('icon', 'image', 'document');
    CREATE TYPE audit_operation AS ENUM ('create', 'update', 'delete', 'revoke');

    -- Users
    CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL,
        role role NOT NULL DEFAULT 'viewer',
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT email_format CHECK (position('@' in email) > 1),
        CONSTRAINT users_email_unique UNIQUE NULLS NOT DISTINCT (email)
    );
    CREATE INDEX idx_users_email ON users(email) INCLUDE (id) WHERE deleted_at IS NULL;

    -- Sessions
    CREATE TABLE sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        mfa_verified_at TIMESTAMPTZ,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT token_hash_format CHECK (token_hash ~* '^[0-9a-f]{64}$'),
        CONSTRAINT expires_at_future CHECK (expires_at > created_at),
        CONSTRAINT sessions_token_hash_unique UNIQUE NULLS NOT DISTINCT (token_hash)
    );
    CREATE INDEX idx_sessions_user_id ON sessions(user_id) INCLUDE (token_hash, expires_at);
    CREATE INDEX idx_sessions_expires_at ON sessions(expires_at) WHERE expires_at > now();

    -- API Keys
    CREATE TABLE api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        provider ai_provider NOT NULL,
        key_hash TEXT NOT NULL,
        key_encrypted BYTEA NOT NULL,
        expires_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT key_hash_format CHECK (key_hash ~* '^[0-9a-f]{64}$'),
        CONSTRAINT name_not_empty CHECK (length(trim(name)) > 0),
        CONSTRAINT api_keys_key_hash_unique UNIQUE NULLS NOT DISTINCT (key_hash)
    );
    CREATE INDEX idx_api_keys_user_id ON api_keys(user_id) INCLUDE (name, expires_at);
    CREATE INDEX idx_api_keys_user_provider ON api_keys(user_id, provider) INCLUDE (name, expires_at);

    -- OAuth Accounts
    CREATE TABLE oauth_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider oauth_provider NOT NULL,
        provider_account_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        access_token_expires_at TIMESTAMPTZ,
        scope TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT oauth_accounts_provider_unique UNIQUE NULLS NOT DISTINCT (provider, provider_account_id)
    );
    CREATE INDEX idx_oauth_accounts_user_id ON oauth_accounts(user_id) INCLUDE (provider);
    CREATE INDEX idx_oauth_provider_account ON oauth_accounts USING HASH (provider_account_id) WHERE provider IS NOT NULL;

    -- Refresh Tokens
    CREATE TABLE refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT token_hash_format_refresh CHECK (token_hash ~* '^[0-9a-f]{64}$'),
        CONSTRAINT refresh_tokens_token_hash_unique UNIQUE NULLS NOT DISTINCT (token_hash)
    );
    CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id) INCLUDE (expires_at, revoked_at);

    -- Assets
    CREATE TABLE assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        asset_type asset_type NOT NULL,
        content TEXT NOT NULL,
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_assets_user_id ON assets(user_id) INCLUDE (id, asset_type) WHERE deleted_at IS NULL;
    CREATE INDEX idx_assets_created_at ON assets(created_at DESC) INCLUDE (id) WHERE deleted_at IS NULL;

    -- Audit Logs
    CREATE TABLE audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        operation audit_operation NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id UUID NOT NULL,
        actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
        changes JSONB,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id) INCLUDE (operation, created_at);
    CREATE INDEX idx_audit_actor ON audit_logs(actor_id) INCLUDE (entity_type, created_at);
    CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

    -- MFA Secrets
    CREATE TABLE mfa_secrets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        secret_encrypted BYTEA NOT NULL,
        backup_codes_hash TEXT[] NOT NULL,
        enabled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_mfa_secrets_user_id ON mfa_secrets(user_id) INCLUDE (enabled_at);
`,
);
