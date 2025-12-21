/**
 * Migration: Create sessions, oauth_accounts, refresh_tokens, api_keys tables.
 */
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/noDefaultExport: @effect/sql-pg migrations require default export
export default Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
    CREATE TABLE sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX idx_sessions_user_id ON sessions(user_id);

    CREATE TABLE oauth_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('google', 'github', 'microsoft')),
        provider_account_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        access_token_expires_at TIMESTAMPTZ,
        scope TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(provider, provider_account_id)
    );

    CREATE INDEX idx_oauth_accounts_user_id ON oauth_accounts(user_id);

    CREATE TABLE refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
    CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);

    CREATE TABLE api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
    CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
`,
);
