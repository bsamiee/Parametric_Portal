/**
 * PG18.1 FEATURES LEVERAGED:
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ UUIDv7              │ Native time-ordered IDs (k-sortable, no hot spots)    │
 * │ NULLS NOT DISTINCT  │ Proper NULL handling in unique constraints            │
 * │ Covering (INCLUDE)  │ Index-only scans eliminate heap fetches               │
 * │ BRIN indexes        │ Ultra-compact for time-range scans on audit logs      │
 * │ Parallel GIN        │ Concurrent JSONB index builds                         │
 * │ Skip scan ready     │ Leading app_id column enables skip scan optimization  │
 * │ Partial indexes     │ Only index active/non-deleted records                 │
 * │ Expression indexes  │ Case-insensitive email/slug lookups                   │
 * │ STORED generated    │ Precomputed columns (token_prefix, content_bytes)     │
 * │ Immutability        │ DB-enforced append-only audit_logs via trigger        │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * GENERATED COLUMNS (PG18.1):
 * - VIRTUAL: Default in PG18, computed on read, CANNOT be indexed or replicated
 * - STORED: Explicit keyword, precomputed on write, indexable, replicable
 * - This migration uses STORED only (token_prefix, content_bytes, backup_codes_remaining)
 *
 * INDEX STRATEGY:
 * - Auth tokens: UNIQUE constraint creates B-tree (sufficient for equality lookups)
 * - App-scoped queries: Leading app_id enables PG18 skip scan when filtering by email/type
 * - Audit logs: BRIN on created_at (append-only, UUIDv7 guarantees time correlation)
 * - JSONB columns: GIN with jsonb_ops (supports @>, ?, ?|, ?& operators)
 * - Covering indexes: INCLUDE payload columns to avoid heap fetches entirely
 * - FK indexes: Full (non-partial) indexes for FK enforcement on all reference columns
 *
 * FK POLICY (Coherent):
 * - Users are NEVER hard-deleted (soft-delete only via deleted_at)
 * - All user-owned entities use ON DELETE RESTRICT to prevent accidental cascade
 * - audit_logs: actor_id RESTRICT (users never hard-deleted), denormalized actor_email for compliance
 * - Assets orphan gracefully (user_id SET NULL) for content preservation
 *
 * APP-LAYER RESPONSIBILITIES:
 * - sessions.last_activity_at: Updated by app on each authenticated request
 * - Email format validation: RFC 5322 is complex; verification email is authoritative
 * - expires_at validation: App must ensure expires_at > now() at insert time
 * - MFA rate limiting: Track failed attempts in app-layer cache (Redis), not DB
 *
 * CAVEATS:
 * - UUIDv7 clock skew: If DB server clock moves backward, IDs may sort before existing.
 *   BRIN indexes on created_at assume append-only; NTP sync is critical.
 * - Soft-delete restore: Restoring a user may conflict with re-registered email.
 *   App layer must check for conflicts before clearing deleted_at.
 *
 * WELL-KNOWN IDS:
 * - Default app: 00000000-0000-7000-8000-000000000001 (deterministic for app bootstrap)
 */
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/noDefaultExport: @effect/sql-pg migrations require default export
export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    // ═══════════════════════════════════════════════════════════════════════════
    // ENUMS: Type-safe discriminated values (ordered for readability; compare in app layer)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`CREATE TYPE role AS ENUM ('guest', 'viewer', 'member', 'admin', 'owner')`;
    yield* sql`CREATE TYPE oauth_provider AS ENUM ('google', 'github', 'microsoft', 'apple')`;
    yield* sql`CREATE TYPE ai_provider AS ENUM ('anthropic', 'openai', 'gemini')`;
    yield* sql`CREATE TYPE audit_operation AS ENUM ('create', 'update', 'delete', 'restore', 'revoke', 'export', 'import')`;
    yield* sql`CREATE TYPE audit_entity_type AS ENUM ('user', 'session', 'apikey', 'asset', 'app', 'mfa', 'refreshtoken', 'oauthaccount')`;

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITY: Trigger functions for updated_at and immutability enforcement
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `;
    yield* sql`COMMENT ON FUNCTION set_updated_at() IS 'Trigger function to auto-update updated_at on row modification'`;

    yield* sql`
        CREATE OR REPLACE FUNCTION reject_modification()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'Table % is immutable — UPDATE and DELETE are prohibited', TG_TABLE_NAME;
        END;
        $$ LANGUAGE plpgsql
    `;
    yield* sql`COMMENT ON FUNCTION reject_modification() IS 'Trigger function to enforce append-only tables (audit_logs)'`;

    // ═══════════════════════════════════════════════════════════════════════════
    // APPS: Multi-tenant isolation root (must exist before FK references)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE apps (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            name TEXT NOT NULL,
            slug TEXT NOT NULL,
            settings JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- Slug: 3-63 chars, alphanumeric + hyphens, no leading/trailing hyphen (DNS-safe)
            CONSTRAINT apps_slug_format CHECK (slug ~ '^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]$'),
            CONSTRAINT apps_name_not_empty CHECK (length(trim(name)) > 0)
        )
    `;
    yield* sql`COMMENT ON TABLE apps IS 'Tenant isolation root — all user-facing entities scope to an app'`;
    yield* sql`COMMENT ON COLUMN apps.slug IS 'Case-insensitive uniqueness enforced via expression index on lower(slug)'`;
    // Expression index for case-insensitive uniqueness (no redundant VIRTUAL column needed)
    yield* sql`CREATE UNIQUE INDEX idx_apps_slug_lower ON apps(lower(slug))`;
    yield* sql`CREATE INDEX idx_apps_slug ON apps(slug) INCLUDE (id)`;
    // GIN with default jsonb_ops: supports @>, ?, ?|, ?& operators
    yield* sql`CREATE INDEX idx_apps_settings ON apps USING GIN (settings) WHERE settings IS NOT NULL`;
    yield* sql`CREATE TRIGGER apps_updated_at BEFORE UPDATE ON apps FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    // Well-known UUID for default app (idempotent insert for re-runnable migrations)
    yield* sql`INSERT INTO apps (id, name, slug) VALUES ('00000000-0000-7000-8000-000000000001', 'Default', 'default') ON CONFLICT (id) DO NOTHING`;

    // ═══════════════════════════════════════════════════════════════════════════
    // USERS: App-scoped accounts with soft-delete (NEVER hard-delete)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE users (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            email TEXT NOT NULL,
            role role NOT NULL DEFAULT 'viewer',
            deleted_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `;
    yield* sql`COMMENT ON TABLE users IS 'User accounts — NEVER hard-delete, always soft-delete via deleted_at'`;
    yield* sql`COMMENT ON COLUMN users.deleted_at IS 'Soft-delete timestamp — NULL means active; set enables email re-registration'`;
    yield* sql`COMMENT ON COLUMN users.email IS 'Format validated at app layer; DB enforces case-insensitive uniqueness among active users'`;
    // Partial unique index: email uniqueness only among ACTIVE users (allows re-registration after soft-delete)
    yield* sql`CREATE UNIQUE INDEX idx_users_app_email_active ON users(app_id, lower(email)) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_users_app_email ON users(app_id, lower(email)) INCLUDE (id, role) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_users_app_id ON users(app_id) INCLUDE (id, email, role) WHERE deleted_at IS NULL`;
    // Full index on app_id for FK enforcement (no WHERE clause)
    yield* sql`CREATE INDEX idx_users_app_id_fk ON users(app_id)`;
    yield* sql`CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;

    // ═══════════════════════════════════════════════════════════════════════════
    // SESSIONS: Token-based auth with MFA gate
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE sessions (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            token_hash TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,
            mfa_verified_at TIMESTAMPTZ,
            ip_address INET,
            user_agent TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- PG18.1 STORED: 16-char prefix for debugging (NOT for uniqueness — birthday collision at ~4B)
            token_prefix TEXT GENERATED ALWAYS AS (left(token_hash, 16)) STORED,
            CONSTRAINT sessions_token_hash_unique UNIQUE NULLS NOT DISTINCT (token_hash),
            -- Hash length flexible: allows algorithm migration (SHA-256=64, SHA-512=128, argon2=variable)
            CONSTRAINT sessions_token_hash_min_length CHECK (length(token_hash) >= 32)
        )
    `;
    yield* sql`COMMENT ON TABLE sessions IS 'Auth sessions — RESTRICT prevents cascade on user soft-delete'`;
    yield* sql`COMMENT ON COLUMN sessions.mfa_verified_at IS 'NULL until TOTP verified — gate sensitive operations'`;
    yield* sql`COMMENT ON COLUMN sessions.token_prefix IS 'For debugging/logs only — NOT unique (birthday collision at ~4B tokens)'`;
    yield* sql`COMMENT ON COLUMN sessions.last_activity_at IS 'App layer must update on each authenticated request'`;
    // Note: No separate token index needed — UNIQUE constraint on token_hash creates B-tree (works for equality)
    yield* sql`CREATE INDEX idx_sessions_user_active ON sessions(user_id, created_at DESC) INCLUDE (expires_at, mfa_verified_at, last_activity_at, ip_address) WHERE revoked_at IS NULL`;
    // Cleanup job index: composite on (expires_at, revoked_at) — job queries with dynamic now() at runtime
    yield* sql`CREATE INDEX idx_sessions_cleanup ON sessions(expires_at, revoked_at)`;
    // Index for IP-based security queries
    yield* sql`CREATE INDEX idx_sessions_ip ON sessions(ip_address) WHERE ip_address IS NOT NULL`;
    // Full index on user_id for FK enforcement
    yield* sql`CREATE INDEX idx_sessions_user_id_fk ON sessions(user_id)`;

    // ═══════════════════════════════════════════════════════════════════════════
    // API_KEYS: AI provider credentials (encrypted at rest)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE api_keys (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            name TEXT NOT NULL,
            provider ai_provider NOT NULL,
            key_hash TEXT NOT NULL,
            key_encrypted BYTEA NOT NULL,
            expires_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ,
            last_used_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- PG18.1 STORED: 16-char prefix for UI display (NOT unique)
            key_prefix TEXT GENERATED ALWAYS AS (left(key_hash, 16)) STORED,
            CONSTRAINT api_keys_hash_unique UNIQUE NULLS NOT DISTINCT (key_hash),
            CONSTRAINT api_keys_hash_min_length CHECK (length(key_hash) >= 32),
            CONSTRAINT api_keys_name_not_empty CHECK (length(trim(name)) > 0)
        )
    `;
    yield* sql`COMMENT ON COLUMN api_keys.key_encrypted IS 'AES-256-GCM encrypted — decrypt only at use time'`;
    yield* sql`COMMENT ON COLUMN api_keys.key_prefix IS 'For UI display only — NOT unique'`;
    yield* sql`COMMENT ON COLUMN api_keys.revoked_at IS 'Set to revoke without deleting — preserves audit trail'`;
    // Note: No separate key_hash index needed — UNIQUE constraint creates B-tree (works for equality)
    yield* sql`CREATE INDEX idx_api_keys_user_provider ON api_keys(user_id, provider) INCLUDE (id, name, expires_at, last_used_at) WHERE revoked_at IS NULL`;
    // Full index on user_id for FK enforcement
    yield* sql`CREATE INDEX idx_api_keys_user_id_fk ON api_keys(user_id)`;
    yield* sql`CREATE TRIGGER api_keys_updated_at BEFORE UPDATE ON api_keys FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;

    // ═══════════════════════════════════════════════════════════════════════════
    // OAUTH_ACCOUNTS: Federated identity linking (tokens encrypted)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE oauth_accounts (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            provider oauth_provider NOT NULL,
            provider_account_id TEXT NOT NULL,
            access_token_encrypted BYTEA NOT NULL,
            refresh_token_encrypted BYTEA,
            access_token_expires_at TIMESTAMPTZ,
            scope TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT oauth_provider_account_unique UNIQUE NULLS NOT DISTINCT (provider, provider_account_id)
        )
    `;
    yield* sql`COMMENT ON COLUMN oauth_accounts.access_token_encrypted IS 'AES-256-GCM encrypted — consistent with api_keys'`;
    yield* sql`COMMENT ON COLUMN oauth_accounts.refresh_token_encrypted IS 'AES-256-GCM encrypted — NULL if provider does not issue refresh tokens'`;
    yield* sql`CREATE INDEX idx_oauth_user ON oauth_accounts(user_id) INCLUDE (provider, provider_account_id, access_token_expires_at)`;
    // Note: No separate provider_account_id index — UNIQUE constraint on (provider, provider_account_id) creates B-tree
    // Full index on user_id for FK enforcement
    yield* sql`CREATE INDEX idx_oauth_user_id_fk ON oauth_accounts(user_id)`;
    yield* sql`CREATE TRIGGER oauth_accounts_updated_at BEFORE UPDATE ON oauth_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;

    // ═══════════════════════════════════════════════════════════════════════════
    // REFRESH_TOKENS: Long-lived token rotation (linked to session for per-device revocation)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE refresh_tokens (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- PG18.1 STORED: 16-char prefix for debugging (NOT unique)
            token_prefix TEXT GENERATED ALWAYS AS (left(token_hash, 16)) STORED,
            CONSTRAINT refresh_tokens_hash_unique UNIQUE NULLS NOT DISTINCT (token_hash),
            CONSTRAINT refresh_tokens_hash_min_length CHECK (length(token_hash) >= 32)
        )
    `;
    yield* sql`COMMENT ON COLUMN refresh_tokens.session_id IS 'Link to originating session — CASCADE deletes tokens when session revoked'`;
    yield* sql`COMMENT ON COLUMN refresh_tokens.token_prefix IS 'For debugging/logs only — NOT unique'`;
    // Note: No separate token index needed — UNIQUE constraint on token_hash creates B-tree (works for equality)
    yield* sql`CREATE INDEX idx_refresh_user_active ON refresh_tokens(user_id) INCLUDE (expires_at, created_at) WHERE revoked_at IS NULL`;
    yield* sql`CREATE INDEX idx_refresh_session ON refresh_tokens(session_id) WHERE session_id IS NOT NULL`;
    // Full indexes for FK enforcement (no WHERE clause)
    yield* sql`CREATE INDEX idx_refresh_user_id_fk ON refresh_tokens(user_id)`;
    yield* sql`CREATE INDEX idx_refresh_session_id_fk ON refresh_tokens(session_id)`;

    // ═══════════════════════════════════════════════════════════════════════════
    // ASSETS: App-scoped content (icons, images, documents) with size limits
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE assets (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            asset_type TEXT NOT NULL,
            content TEXT NOT NULL,
            deleted_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- PG18.1 STORED: octet_length for accurate byte-level quota
            content_bytes INTEGER GENERATED ALWAYS AS (octet_length(content)) STORED,
            -- 10MB max content size (prevents DB bloat from large uploads)
            CONSTRAINT assets_content_max_size CHECK (octet_length(content) <= 10485760),
            -- Asset type validation at app layer via branded string
            CONSTRAINT assets_type_not_empty CHECK (length(trim(asset_type)) > 0)
        )
    `;
    yield* sql`COMMENT ON TABLE assets IS 'App content — user_id SET NULL on user delete preserves orphaned content'`;
    yield* sql`COMMENT ON COLUMN assets.content_bytes IS 'PG18.1 STORED — octet_length for byte quota (UTF-8 aware)'`;
    yield* sql`CREATE INDEX idx_assets_app_type ON assets(app_id, asset_type) INCLUDE (id, user_id, created_at) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_assets_app_user ON assets(app_id, user_id) INCLUDE (id, asset_type) WHERE deleted_at IS NULL AND user_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_assets_app_recent ON assets(app_id, created_at DESC) INCLUDE (id, asset_type, user_id) WHERE deleted_at IS NULL`;
    // Full indexes for FK enforcement (no WHERE clause — FK checks ALL rows)
    yield* sql`CREATE INDEX idx_assets_app_id_fk ON assets(app_id)`;
    yield* sql`CREATE INDEX idx_assets_user_id_fk ON assets(user_id)`;
    yield* sql`CREATE TRIGGER assets_updated_at BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;

    // ═══════════════════════════════════════════════════════════════════════════
    // AUDIT_LOGS: Immutable compliance trail (append-only, BRIN-optimized)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE audit_logs (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            operation audit_operation NOT NULL,
            entity_type audit_entity_type NOT NULL,
            entity_id UUID NOT NULL,
            -- RESTRICT: users are NEVER hard-deleted; actor_email provides compliance backup
            actor_id UUID REFERENCES users(id) ON DELETE RESTRICT,
            actor_email TEXT,
            changes JSONB,
            ip_address INET,
            user_agent TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `;
    yield* sql`COMMENT ON TABLE audit_logs IS 'Append-only audit trail — never UPDATE/DELETE in application code'`;
    yield* sql`COMMENT ON COLUMN audit_logs.actor_id IS 'RESTRICT — users never hard-deleted; if somehow NULL, actor_email preserves attribution'`;
    yield* sql`COMMENT ON COLUMN audit_logs.actor_email IS 'Denormalized for compliance — preserved even if actor_id becomes orphaned'`;
    // BRIN with default pages_per_range (128) — well-tuned for most workloads
    yield* sql`CREATE INDEX idx_audit_created_brin ON audit_logs USING BRIN (created_at)`;
    yield* sql`CREATE INDEX idx_audit_app_entity ON audit_logs(app_id, entity_type, entity_id, created_at DESC) INCLUDE (actor_id, operation)`;
    yield* sql`CREATE INDEX idx_audit_app_actor ON audit_logs(app_id, actor_id, created_at DESC) INCLUDE (entity_type, entity_id, operation) WHERE actor_id IS NOT NULL`;
    // Standalone entity_id index for "all logs for entity X regardless of type" queries
    yield* sql`CREATE INDEX idx_audit_entity_id ON audit_logs(entity_id, created_at DESC)`;
    // GIN with default jsonb_ops: supports @>, ?, ?|, ?& operators
    yield* sql`CREATE INDEX idx_audit_changes ON audit_logs USING GIN (changes) WHERE changes IS NOT NULL`;
    // IP index for security investigations
    yield* sql`CREATE INDEX idx_audit_ip ON audit_logs(ip_address) WHERE ip_address IS NOT NULL`;
    // Full index for FK enforcement
    yield* sql`CREATE INDEX idx_audit_app_id_fk ON audit_logs(app_id)`;
    // Immutability enforcement: reject UPDATE/DELETE at DB level (not just app convention)
    yield* sql`CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_modification()`;

    // ═══════════════════════════════════════════════════════════════════════════
    // MFA_SECRETS: TOTP secrets with backup codes
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE mfa_secrets (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
            secret_encrypted BYTEA NOT NULL,
            backup_codes_hash TEXT[] NOT NULL DEFAULT '{}',
            enabled_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- PG18.1 STORED: COALESCE handles empty array returning NULL from array_length
            backup_codes_remaining INTEGER GENERATED ALWAYS AS (COALESCE(array_length(backup_codes_hash, 1), 0)) STORED,
            -- Prevent NULL elements in array (would inflate backup_codes_remaining incorrectly)
            CONSTRAINT mfa_backup_codes_no_nulls CHECK (array_position(backup_codes_hash, NULL) IS NULL)
        )
    `;
    yield* sql`COMMENT ON COLUMN mfa_secrets.enabled_at IS 'NULL = enrolled but not activated; set after first successful TOTP'`;
    yield* sql`COMMENT ON COLUMN mfa_secrets.backup_codes_remaining IS 'PG18.1 STORED — COALESCE ensures 0 (not NULL) when codes exhausted'`;
    yield* sql`COMMENT ON COLUMN mfa_secrets.backup_codes_hash IS 'Rate limiting for MFA attempts tracked in app-layer cache (Redis), not DB'`;
    yield* sql`CREATE INDEX idx_mfa_user ON mfa_secrets(user_id) INCLUDE (enabled_at, created_at)`;
    yield* sql`CREATE TRIGGER mfa_secrets_updated_at BEFORE UPDATE ON mfa_secrets FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
});
