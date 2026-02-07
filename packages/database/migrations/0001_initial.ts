/**
 * PG18.1 + EXTENSIONS LEVERAGED (Release date: 2025-11-13):
 * ┌───────────────────────────────────────────────────────────────────────────────┐
 * │ uuidv7()              │ NATIVE time-ordered IDs (no extension, k-sortable)    │
 * │ uuid_extract_timestamp│ Extract creation time from UUIDv7 (NO created_at)     │
 * │ RETURNING OLD/NEW     │ Capture before/after values in single DML statement   │
 * │ btree_gist            │ GiST for scalars — required for WITHOUT OVERLAPS      │
 * │ NULLS NOT DISTINCT    │ Proper NULL handling in unique constraints            │
 * │ Covering (INCLUDE)    │ Index-only scans eliminate heap fetches               │
 * │ BRIN indexes          │ Ultra-compact for time-range scans on audit logs      │
 * │ Parallel GIN          │ Concurrent JSONB index builds                         │
 * │ B-tree skip scan      │ Multi-column indexes usable when leading cols omitted │
 * │ Partial indexes       │ Only index active/non-deleted records                 │
 * │ STORED generated      │ Precomputed columns (assets.size only — others VIRTUAL│
 * │ VIRTUAL generated     │ Computed on read (prefix columns)                     │
 * │ Immutability          │ DB-enforced append-only audit_logs via trigger        │
 * └───────────────────────────────────────────────────────────────────────────────┘
 * EXTENSIONS + COLLATION REQUIRED (CREATE EXTENSION IF NOT EXISTS):
 * - ICU case-insensitive collation (TEXT + nondeterministic ICU collation for apps.namespace, users.email)
 * - btree_gist (GiST index support for scalar types — temporal constraints)
 * - pg_trgm (trigram similarity for fuzzy search)
 * - fuzzystrmatch (levenshtein/soundex fuzzy matchers)
 * - unaccent (diacritic normalization for FTS/similarity)
 * - vector (pgvector 0.8+ embeddings + HNSW with iterative scan)
 * - pg_stat_statements (SQL stats; requires shared_preload_libraries)
 * - pgaudit (compliance audit logging for SOC2/HIPAA/PCI-DSS)
 * GENERATED COLUMNS (PG18.1):
 * - VIRTUAL: Default in PG18, computed on read, CANNOT be indexed
 * - STORED: Explicit keyword, precomputed on write, indexable
 * - This migration uses STORED for indexable generated columns
 * NEW PG18.1 FUNCTIONS LEVERAGED:
 * - uuidv7() / uuidv4(): Native UUID generation (no uuid-ossp needed)
 * - uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at
 * - array_sort(anyarray): Sort array first dimension
 * - array_reverse(anyarray): Reverse array first dimension
 * - RETURNING OLD.*, NEW.*: Capture before/after values in UPDATE/DELETE
 * PGVECTOR 0.8+ CONFIGURATION (set in postgresql.conf or per-session):
 * - hnsw.iterative_scan = 'relaxed_order': Prevents overfiltering with WHERE clauses
 * - hnsw.ef_search = 100: Recall/speed tradeoff (higher = better recall, slower)
 * INDEX STRATEGY:
 * - Auth tokens: UNIQUE constraint creates B-tree (sufficient for equality lookups)
 * - App-scoped queries: Leading app_id enables PG18 skip scan when filtering by email/type
 * - Audit logs: BRIN on id (UUIDv7 is time-ordered, more efficient than separate timestamp)
 * - JSONB columns: GIN with jsonb_ops (supports @>, ?, ?|, ?& operators)
 * - Covering indexes: INCLUDE payload columns to avoid heap fetches entirely
 * - FK indexes: Full (non-partial) indexes for FK enforcement on all reference columns
 * - IP indexes: INET indexes for abuse detection and session management
 * FK POLICY (Coherent):
 * - Users are NEVER hard-deleted (soft-delete only via deleted_at)
 * - All user-owned entities use ON DELETE RESTRICT to prevent accidental cascade
 * - audit_logs: user_id RESTRICT (users never hard-deleted); JOIN to users.email when needed
 * - Assets orphan gracefully (user_id SET NULL) for content preservation
 * APP-LAYER RESPONSIBILITIES:
 * - sessions.updated_at: Updated by app on each authenticated request
 * - Email format validation: RFC 5322 is complex; verification email is authoritative
 * - access_expires_at validation: App must ensure access_expires_at > now() at insert time
 * - MFA rate limiting: Track failed attempts in app-layer cache (Redis), not DB
 * CAVEATS:
 * - UUIDv7 clock skew: If DB server clock moves backward, IDs may sort before existing.
 *   BRIN indexes on id assume append-only; NTP sync is critical.
 * - Soft-delete restore: Restoring a user may conflict with re-registered email.
 *   App layer must check for conflicts before clearing deleted_at.
 * WELL-KNOWN IDS:
 * - System app: 00000000-0000-7000-8000-000000000000 (reserved for internal/system use)
 * - Default app: 00000000-0000-7000-8000-000000000001 (deterministic for app bootstrap)
 */
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/noDefaultExport: @effect/sql-pg migrations require default export
export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // ═══════════════════════════════════════════════════════════════════════════
    // EXTENSIONS: btree_gist + pg_trgm + fuzzystrmatch + unaccent + vector + pg_stat_statements + pgaudit
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`CREATE EXTENSION IF NOT EXISTS btree_gist`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS fuzzystrmatch`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS unaccent`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS vector`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS pgaudit`;
    yield* sql`COMMENT ON EXTENSION btree_gist IS 'btree_gist: GiST support for scalar types — required for temporal constraints (WITHOUT OVERLAPS)'`;
    yield* sql`COMMENT ON EXTENSION pg_trgm IS 'pg_trgm: trigram similarity for fuzzy search'`;
    yield* sql`COMMENT ON EXTENSION fuzzystrmatch IS 'fuzzystrmatch: levenshtein/soundex matchers for fuzzy search'`;
    yield* sql`COMMENT ON EXTENSION unaccent IS 'unaccent: Unicode diacritic normalization for search'`;
    yield* sql`COMMENT ON EXTENSION vector IS 'pgvector 0.8+: vector similarity search with HNSW iterative scan support'`;
    yield* sql`COMMENT ON EXTENSION pg_stat_statements IS 'pg_stat_statements: SQL statement performance statistics'`;
    yield* sql`COMMENT ON EXTENSION pgaudit IS 'pgaudit: compliance audit logging for SOC2/HIPAA/PCI-DSS'`;
    yield* sql`CREATE COLLATION IF NOT EXISTS case_insensitive (provider = icu, locale = 'und-u-ks-level2', deterministic = false)`;
    yield* sql`COMMENT ON COLLATION case_insensitive IS 'ICU nondeterministic collation for case-insensitive TEXT (Unicode-aware)'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // ASYNC I/O CONFIGURATION GUIDANCE (PG18.1)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        DO $$
        BEGIN
            EXECUTE format(
                'COMMENT ON DATABASE %I IS %L',
                current_database(),
                'PG18.1 Async I/O Configuration (set in postgresql.conf):
                - io_method: worker (default, recommended) or io_uring (Linux 5.1+, requires --with-liburing)
                - io_workers: 3 (default), tune to 25% of CPU cores for cloud workloads
                - effective_io_concurrency: 16 (PG18 default, increase to 32-64 for cloud storage)
                - io_combine_limit: 128 (default, increase for sequential scans)
                Note: io_method and io_workers require server restart to change.'
            );
        END;
        $$;
    `;
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
    // RLS HELPERS: SECURITY DEFINER functions for efficient tenant isolation
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE OR REPLACE FUNCTION get_current_tenant_id()
        RETURNS uuid
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path TO public
        AS $$
            SELECT current_setting('app.current_tenant', true)::uuid
        $$
    `;
    yield* sql`COMMENT ON FUNCTION get_current_tenant_id() IS 'Returns current tenant ID from app.current_tenant GUC. Used by RLS policies with caching via STABLE.'`;
    yield* sql`
        CREATE OR REPLACE FUNCTION get_tenant_user_ids()
        RETURNS SETOF uuid
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path TO public
        AS $$
            SELECT id FROM users
            WHERE app_id = get_current_tenant_id()
              AND deleted_at IS NULL
        $$
    `;
    yield* sql`COMMENT ON FUNCTION get_tenant_user_ids() IS 'Returns active user IDs for current tenant. SECURITY DEFINER avoids chained RLS evaluation (~75% overhead reduction).'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // APPS: Multi-tenant isolation root (must exist before FK references)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE apps (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            name TEXT NOT NULL,
            namespace TEXT COLLATE case_insensitive NOT NULL,
            settings JSONB,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT apps_name_not_empty CHECK (length(trim(name)) > 0),
            CONSTRAINT apps_namespace_not_empty CHECK (length(trim(namespace)) > 0)
        )
    `;
    yield* sql`COMMENT ON TABLE apps IS 'Tenant isolation root — all user-facing entities scope to an app; use uuid_extract_timestamp(id) for creation time'`;
    yield* sql`CREATE UNIQUE INDEX idx_apps_namespace ON apps(namespace) INCLUDE (id)`;
    yield* sql`CREATE INDEX idx_apps_settings ON apps USING GIN (settings) WHERE settings IS NOT NULL`;
    yield* sql`CREATE TRIGGER apps_updated_at BEFORE UPDATE ON apps FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    yield* sql`INSERT INTO apps (id, name, namespace) VALUES ('00000000-0000-7000-8000-000000000001', 'Default', 'default') ON CONFLICT (id) DO NOTHING`;
    yield* sql`INSERT INTO apps (id, name, namespace) VALUES ('00000000-0000-7000-8000-000000000000', 'System', 'system') ON CONFLICT (id) DO NOTHING`;
    // ═══════════════════════════════════════════════════════════════════════════
    // USERS: App-scoped accounts with soft-delete (NEVER hard-delete)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE users (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            email TEXT COLLATE case_insensitive NOT NULL,
            role TEXT NOT NULL,
            status TEXT NOT NULL,
            deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            role_order INTEGER GENERATED ALWAYS AS (
                CASE role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'member' THEN 2 WHEN 'viewer' THEN 1 WHEN 'guest' THEN 0 ELSE -1 END
            ) VIRTUAL
        )
    `;
    yield* sql`COMMENT ON TABLE users IS 'User accounts — NEVER hard-delete; use uuid_extract_timestamp(id) for creation time'`;
    yield* sql`COMMENT ON COLUMN users.deleted_at IS 'Soft-delete timestamp — NULL means active; set enables email re-registration'`;
    yield* sql`COMMENT ON COLUMN users.email IS 'Format validated at app layer; ICU nondeterministic collation enforces case-insensitive uniqueness among active users'`;
    yield* sql`COMMENT ON COLUMN users.role_order IS 'VIRTUAL generated — permission hierarchy (owner=4, admin=3, member=2, viewer=1, guest=0)'`;
    yield* sql`CREATE UNIQUE INDEX idx_users_app_email_active ON users(app_id, email) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_users_app_email ON users(app_id, email) INCLUDE (id, role) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_users_app_id ON users(app_id) INCLUDE (id, email, role) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_users_app_id_fk ON users(app_id)`;
    yield* sql`CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    // ═══════════════════════════════════════════════════════════════════════════
    // SESSIONS: Token-based auth with MFA gate
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE sessions (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            hash TEXT NOT NULL,
            refresh_hash TEXT NOT NULL,
            access_expires_at TIMESTAMPTZ NOT NULL,
            refresh_expires_at TIMESTAMPTZ NOT NULL,
            deleted_at TIMESTAMPTZ,
            verified_at TIMESTAMPTZ,
            ip_address INET,
            user_agent TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            prefix TEXT GENERATED ALWAYS AS (left(hash, 16)) VIRTUAL,
            CONSTRAINT sessions_hash_unique UNIQUE NULLS NOT DISTINCT (hash),
            CONSTRAINT sessions_hash_format CHECK (hash ~* '^[0-9a-f]{64}$'),
            CONSTRAINT sessions_refresh_hash_unique UNIQUE NULLS NOT DISTINCT (refresh_hash),
            CONSTRAINT sessions_refresh_hash_format CHECK (refresh_hash ~* '^[0-9a-f]{64}$'),
            CONSTRAINT sessions_user_agent_length CHECK (user_agent IS NULL OR length(user_agent) <= 1024)
        )
    `;
    yield* sql`COMMENT ON TABLE sessions IS 'Auth sessions — use uuid_extract_timestamp(id) for creation time'`;
    yield* sql`COMMENT ON COLUMN sessions.verified_at IS 'NULL until second factor verified — gate sensitive operations'`;
    yield* sql`COMMENT ON COLUMN sessions.prefix IS 'VIRTUAL for debugging/logs only — NOT unique (birthday collision at ~4B tokens)'`;
    yield* sql`COMMENT ON COLUMN sessions.refresh_hash IS 'Refresh token hash (rotated on refresh; invalidates prior refresh token)'`;
    yield* sql`COMMENT ON COLUMN sessions.refresh_expires_at IS 'Refresh token expiration (session remains refreshable until this time)'`;
    yield* sql`COMMENT ON COLUMN sessions.updated_at IS 'App layer must update on each authenticated request'`;
    yield* sql`COMMENT ON COLUMN sessions.deleted_at IS 'Soft-delete timestamp — NULL means active'`;
    yield* sql`CREATE INDEX idx_sessions_app_user_active ON sessions(app_id, user_id) INCLUDE (access_expires_at, verified_at, updated_at, ip_address) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_sessions_cleanup ON sessions(access_expires_at, deleted_at)`;
    yield* sql`CREATE INDEX idx_sessions_ip ON sessions(ip_address) WHERE ip_address IS NOT NULL AND deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_sessions_user_id_fk ON sessions(user_id)`;
    yield* sql`CREATE INDEX idx_sessions_app_id_fk ON sessions(app_id)`;
    // ═══════════════════════════════════════════════════════════════════════════
    // API_KEYS: Programmatic access tokens (encrypted at rest)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE api_keys (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            name TEXT NOT NULL,
            hash TEXT NOT NULL,
            encrypted BYTEA NOT NULL,
            expires_at TIMESTAMPTZ,
            deleted_at TIMESTAMPTZ,
            last_used_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            prefix TEXT GENERATED ALWAYS AS (left(hash, 16)) VIRTUAL,
            CONSTRAINT api_keys_hash_unique UNIQUE NULLS NOT DISTINCT (hash),
            CONSTRAINT api_keys_hash_format CHECK (hash ~* '^[0-9a-f]{64}$'),
            CONSTRAINT api_keys_name_not_empty CHECK (length(trim(name)) > 0)
        )
    `;
    yield* sql`COMMENT ON TABLE api_keys IS 'Programmatic access tokens — use uuid_extract_timestamp(id) for creation time'`;
    yield* sql`COMMENT ON COLUMN api_keys.encrypted IS 'AES-256-GCM encrypted — decrypt only at use time'`;
    yield* sql`COMMENT ON COLUMN api_keys.prefix IS 'VIRTUAL for UI display only — NOT unique'`;
    yield* sql`COMMENT ON COLUMN api_keys.deleted_at IS 'Soft-delete timestamp — NULL means active'`;
    yield* sql`CREATE INDEX idx_api_keys_user_active ON api_keys(user_id) INCLUDE (id, name, expires_at, last_used_at) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_api_keys_user_id_fk ON api_keys(user_id)`;
    yield* sql`CREATE TRIGGER api_keys_updated_at BEFORE UPDATE ON api_keys FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    // ═══════════════════════════════════════════════════════════════════════════
    // OAUTH_ACCOUNTS: Federated identity linking (tokens encrypted)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE oauth_accounts (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            provider TEXT NOT NULL,
            external_id TEXT NOT NULL,
            access_encrypted BYTEA NOT NULL,
            refresh_encrypted BYTEA,
            expires_at TIMESTAMPTZ,
            deleted_at TIMESTAMPTZ,
            scope TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT oauth_provider_external_unique UNIQUE NULLS NOT DISTINCT (provider, external_id)
        )
    `;
    yield* sql`COMMENT ON TABLE oauth_accounts IS 'Federated identity linking — use uuid_extract_timestamp(id) for creation time'`;
    yield* sql`COMMENT ON COLUMN oauth_accounts.access_encrypted IS 'AES-256-GCM encrypted — consistent with api_keys'`;
    yield* sql`COMMENT ON COLUMN oauth_accounts.refresh_encrypted IS 'AES-256-GCM encrypted — NULL if provider does not issue refresh tokens'`;
    yield* sql`COMMENT ON COLUMN oauth_accounts.deleted_at IS 'Soft-delete timestamp — NULL means active'`;
    yield* sql`CREATE INDEX idx_oauth_user ON oauth_accounts(user_id) INCLUDE (provider, external_id, expires_at) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_oauth_user_id_fk ON oauth_accounts(user_id)`;
    yield* sql`CREATE TRIGGER oauth_accounts_updated_at BEFORE UPDATE ON oauth_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    // ═══════════════════════════════════════════════════════════════════════════
    // ASSETS: App-scoped content (icons, images, documents) with size limits
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE assets (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            type TEXT NOT NULL,
            content TEXT NOT NULL,
            status TEXT NOT NULL,
            hash TEXT,
            name TEXT,
            storage_ref TEXT,
            deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            size INTEGER GENERATED ALWAYS AS (octet_length(content)) STORED,
            CONSTRAINT assets_content_max_size CHECK (octet_length(content) <= 1048576),
            CONSTRAINT assets_hash_format CHECK (hash IS NULL OR hash ~* '^[0-9a-f]{64}$')
        )
    `;
    yield* sql`COMMENT ON TABLE assets IS 'App content — use uuid_extract_timestamp(id) for creation time; user_id SET NULL on user delete preserves orphaned content'`;
    yield* sql`COMMENT ON COLUMN assets.hash IS 'SHA-256 content hash (64 hex chars) for verification/deduplication — computed at app layer'`;
    yield* sql`COMMENT ON COLUMN assets.name IS 'Original filename for ZIP manifest reconstruction and display'`;
    yield* sql`COMMENT ON COLUMN assets.storage_ref IS 'S3 object key when binary content stored externally — pattern: assets/{appId}/{hash}.{ext}'`;
    yield* sql`COMMENT ON COLUMN assets.size IS 'STORED for aggregate queries — octet_length for byte quota (UTF-8 aware)'`;
    yield* sql`CREATE INDEX idx_assets_app_type ON assets(app_id, type) INCLUDE (id, user_id) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_assets_app_user ON assets(app_id, user_id) INCLUDE (id, type) WHERE deleted_at IS NULL AND user_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_assets_app_recent ON assets(app_id, id DESC) INCLUDE (type, user_id) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_assets_hash ON assets(hash) WHERE hash IS NOT NULL AND deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_assets_storage_ref ON assets(storage_ref) WHERE storage_ref IS NOT NULL AND deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_assets_app_id_fk ON assets(app_id)`;
    yield* sql`CREATE INDEX idx_assets_user_id_fk ON assets(user_id)`;
    yield* sql`CREATE TRIGGER assets_updated_at BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    // ═══════════════════════════════════════════════════════════════════════════
    // AUDIT_LOGS: Immutable compliance trail (append-only, BRIN-optimized on id)
    // Uses PG18.1 RETURNING OLD/NEW for efficient before/after capture
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE audit_logs (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
            request_id UUID,
            operation TEXT NOT NULL,
            subject TEXT NOT NULL,
            subject_id UUID NOT NULL,
            old_data JSONB,
            new_data JSONB,
            ip_address INET,
            user_agent TEXT,
            CONSTRAINT audit_logs_user_agent_length CHECK (user_agent IS NULL OR length(user_agent) <= 1024),
            CONSTRAINT audit_logs_operation_valid CHECK (operation IN (
                'create', 'update', 'delete', 'restore', 'login', 'logout', 'verify', 'revoke',
                'sign', 'upload', 'stream_upload', 'copy', 'read', 'list', 'register', 'remove',
                'enroll', 'disable', 'verifyMfa', 'refresh', 'revokeByIp', 'cancel', 'replay',
                'export', 'import', 'validate', 'status', 'query', 'suggest', 'refreshEmbeddings',
                'abort_multipart', 'auth_failure', 'rate_limited',
                'purge-sessions', 'purge-api-keys', 'purge-assets', 'purge-event-journal',
                'purge-job-dlq', 'purge-kv-store', 'purge-mfa-secrets', 'purge-oauth-accounts'
            ))
        )
    `;
    yield* sql`COMMENT ON TABLE audit_logs IS 'Append-only audit trail — use uuid_extract_timestamp(id) for creation time; old_data/new_data populated via RETURNING OLD/NEW'`;
    yield* sql`COMMENT ON COLUMN audit_logs.user_id IS 'FK to users — RESTRICT (users never hard-deleted); JOIN to users.email when needed'`;
    yield* sql`COMMENT ON COLUMN audit_logs.request_id IS 'Correlation ID from request context — correlate multiple audit entries from same HTTP request'`;
    yield* sql`COMMENT ON COLUMN audit_logs.old_data IS 'PG18.1: Pre-modification state captured via RETURNING OLD.* — NULL for create operations'`;
    yield* sql`COMMENT ON COLUMN audit_logs.new_data IS 'PG18.1: Post-modification state captured via RETURNING NEW.* — NULL for delete operations'`;
    yield* sql`CREATE INDEX idx_audit_id_brin ON audit_logs USING BRIN (id)`;
    yield* sql`CREATE INDEX idx_audit_app_subject ON audit_logs(app_id, subject, subject_id, id DESC) INCLUDE (user_id, operation)`;
    yield* sql`CREATE INDEX idx_audit_app_user ON audit_logs(app_id, user_id, id DESC) INCLUDE (subject, subject_id, operation) WHERE user_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_audit_subject_id ON audit_logs(subject_id, id DESC)`;
    yield* sql`CREATE INDEX idx_audit_request ON audit_logs(request_id) WHERE request_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_audit_old_data ON audit_logs USING GIN (old_data) WHERE old_data IS NOT NULL`;
    yield* sql`CREATE INDEX idx_audit_new_data ON audit_logs USING GIN (new_data) WHERE new_data IS NOT NULL`;
    yield* sql`CREATE INDEX idx_audit_ip ON audit_logs(ip_address) WHERE ip_address IS NOT NULL`;
    yield* sql`CREATE INDEX idx_audit_app_id_fk ON audit_logs(app_id)`;
    yield* sql`CREATE INDEX idx_audit_user_id_fk ON audit_logs(user_id)`;
    yield* sql`CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_modification()`;
    // ═══════════════════════════════════════════════════════════════════════════
    // AUDIT HELPER: PG18.1 function to log with RETURNING OLD/NEW data
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION audit_log_entry(
            p_app_id UUID,
            p_user_id UUID,
            p_request_id UUID,
            p_operation TEXT,
            p_subject TEXT,
            p_subject_id UUID,
            p_old_data JSONB DEFAULT NULL,
            p_new_data JSONB DEFAULT NULL,
            p_ip_address INET DEFAULT NULL,
            p_user_agent TEXT DEFAULT NULL
        )
        RETURNS UUID
        LANGUAGE sql
        AS $$
            INSERT INTO audit_logs (app_id, user_id, request_id, operation, subject, subject_id, old_data, new_data, ip_address, user_agent)
            VALUES (p_app_id, p_user_id, p_request_id, p_operation, p_subject, p_subject_id,
                    jsonb_strip_nulls(p_old_data, true),
                    jsonb_strip_nulls(p_new_data, true),
                    p_ip_address, p_user_agent)
            RETURNING id
        $$
    `);
    yield* sql`COMMENT ON FUNCTION audit_log_entry IS 'Insert audit entry with PG18.1 jsonb_strip_nulls(,true) to remove null values AND null array elements'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // MFA_SECRETS: TOTP secrets with backup codes
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE mfa_secrets (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
            encrypted BYTEA NOT NULL,
            backup_hashes TEXT[] NOT NULL DEFAULT '{}',
            enabled_at TIMESTAMPTZ,
            deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            remaining INTEGER GENERATED ALWAYS AS (COALESCE(array_length(backup_hashes, 1), 0)) VIRTUAL,
            CONSTRAINT mfa_backup_hashes_no_nulls CHECK (array_position(backup_hashes, NULL) IS NULL)
        )
    `;
    yield* sql`COMMENT ON TABLE mfa_secrets IS 'TOTP secrets — use uuid_extract_timestamp(id) for creation time'`;
    yield* sql`COMMENT ON COLUMN mfa_secrets.enabled_at IS 'NULL = enrolled but not activated; set after first successful TOTP'`;
    yield* sql`COMMENT ON COLUMN mfa_secrets.remaining IS 'VIRTUAL — COALESCE ensures 0 (not NULL) when codes exhausted'`;
    yield* sql`COMMENT ON COLUMN mfa_secrets.backup_hashes IS 'Rate limiting for MFA attempts tracked in app-layer cache (Redis), not DB'`;
    yield* sql`COMMENT ON COLUMN mfa_secrets.deleted_at IS 'Soft-delete timestamp — NULL means active'`;
    yield* sql`CREATE INDEX idx_mfa_user ON mfa_secrets(user_id) INCLUDE (enabled_at) WHERE deleted_at IS NULL`;
    yield* sql`CREATE TRIGGER mfa_secrets_updated_at BEFORE UPDATE ON mfa_secrets FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    // ═══════════════════════════════════════════════════════════════════════════
    // JOBS: Durable job registry with snowflake job_id
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE jobs (
            job_id TEXT PRIMARY KEY,
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            type TEXT NOT NULL,
            status TEXT NOT NULL,
            priority TEXT NOT NULL,
            payload JSONB NOT NULL,
            result JSONB,
            progress JSONB,
            history JSONB NOT NULL,
            attempts INTEGER NOT NULL,
            max_attempts INTEGER NOT NULL,
            scheduled_at TIMESTAMPTZ,
            batch_id TEXT,
            dedupe_key TEXT,
            last_error TEXT,
            completed_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT jobs_type_not_empty CHECK (length(trim(type)) > 0),
            CONSTRAINT jobs_status_not_empty CHECK (length(trim(status)) > 0),
            CONSTRAINT jobs_priority_not_empty CHECK (length(trim(priority)) > 0),
            CONSTRAINT jobs_attempts_non_negative CHECK (attempts >= 0),
            CONSTRAINT jobs_max_attempts_positive CHECK (max_attempts > 0),
            CONSTRAINT jobs_history_array CHECK (jsonb_typeof(history) = 'array')
        )
    `;
    yield* sql`COMMENT ON TABLE jobs IS 'Durable job registry — snowflake job_id, status/progress/history, tenant-scoped'`;
    yield* sql`COMMENT ON COLUMN jobs.job_id IS 'Snowflake job identifier (18-19 digit string)'`;
    yield* sql`COMMENT ON COLUMN jobs.history IS 'Array of {status, timestamp, error?} state transitions'`;
    yield* sql`CREATE INDEX idx_jobs_app_status ON jobs(app_id, status) INCLUDE (type, priority, attempts)`;
    yield* sql`CREATE INDEX idx_jobs_app_type ON jobs(app_id, type) INCLUDE (status, priority)`;
    yield* sql`CREATE INDEX idx_jobs_app_updated ON jobs(app_id, updated_at DESC) INCLUDE (status, type)`;
    yield* sql`CREATE INDEX idx_jobs_dedupe ON jobs(app_id, dedupe_key) WHERE dedupe_key IS NOT NULL`;
    yield* sql`CREATE INDEX idx_jobs_batch ON jobs(batch_id) WHERE batch_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_jobs_app_id_fk ON jobs(app_id)`;
    yield* sql`CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    yield* sql`
        CREATE OR REPLACE FUNCTION count_jobs_by_status()
        RETURNS JSONB
        LANGUAGE sql
        STABLE
        AS $$
            SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
            FROM (SELECT status, COUNT(*)::int AS cnt FROM jobs GROUP BY status) sub
        $$
    `;
    yield* sql`COMMENT ON FUNCTION count_jobs_by_status() IS 'Aggregate job counts per status as JSONB object — e.g. {"queued":5,"processing":2}'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // JOB_DLQ: Dead-letter queue for failed jobs and events
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE job_dlq (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            source TEXT NOT NULL DEFAULT 'job',
            original_job_id TEXT NOT NULL,
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
            request_id UUID,
            type TEXT NOT NULL,
            payload JSONB NOT NULL,
            error_reason TEXT NOT NULL,
            attempts INTEGER NOT NULL,
            error_history JSONB NOT NULL,
            replayed_at TIMESTAMPTZ,
            CONSTRAINT job_dlq_source_valid CHECK (source IN ('job', 'event')),
            CONSTRAINT job_dlq_error_reason_valid CHECK (error_reason IN (
                'MaxRetries', 'Validation', 'HandlerMissing', 'RunnerUnavailable', 'Timeout', 'Panic',
                'Processing', 'NotFound', 'AlreadyCancelled',
                'DeliveryFailed', 'DeserializationFailed', 'DuplicateEvent', 'ValidationFailed',
                'AuditPersistFailed', 'HandlerTimeout'
            )),
            CONSTRAINT job_dlq_error_history_array CHECK (jsonb_typeof(error_history) = 'array'),
            CONSTRAINT job_dlq_attempts_positive CHECK (attempts > 0)
        )
    `;
    yield* sql`COMMENT ON TABLE job_dlq IS 'Unified dead-letter queue for jobs and events — use uuid_extract_timestamp(id) for DLQ creation time; NO updated_at (append-mostly)'`;
    yield* sql`COMMENT ON COLUMN job_dlq.source IS 'Discriminant: job = background job, event = domain event from EventBus'`;
    yield* sql`COMMENT ON COLUMN job_dlq.original_job_id IS 'Reference to original job/event — snowflake string, NO FK constraint (source may be purged before replay)'`;
    yield* sql`COMMENT ON COLUMN job_dlq.error_reason IS 'Failure classification discriminant for typed error handling — valid values depend on source'`;
    yield* sql`COMMENT ON COLUMN job_dlq.error_history IS 'Array of {error: string, timestamp: number} entries from all attempts'`;
    yield* sql`COMMENT ON COLUMN job_dlq.replayed_at IS 'NULL = pending replay; set when job/event resubmitted to queue'`;
    yield* sql`CREATE INDEX idx_job_dlq_id_brin ON job_dlq USING BRIN (id)`;
    yield* sql`CREATE INDEX idx_job_dlq_source ON job_dlq(source, error_reason) INCLUDE (type, attempts) WHERE replayed_at IS NULL`;
    yield* sql`CREATE INDEX idx_job_dlq_pending_type ON job_dlq(type, error_reason) INCLUDE (app_id, source, attempts) WHERE replayed_at IS NULL`;
    yield* sql`CREATE INDEX idx_job_dlq_pending_app ON job_dlq(app_id, id DESC) INCLUDE (type, source, error_reason, attempts) WHERE replayed_at IS NULL`;
    yield* sql`CREATE INDEX idx_job_dlq_original ON job_dlq(original_job_id) INCLUDE (error_reason, attempts, replayed_at)`;
    yield* sql`CREATE INDEX idx_job_dlq_request ON job_dlq(request_id) INCLUDE (type, error_reason) WHERE request_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_job_dlq_errors ON job_dlq USING GIN (error_history)`;
    yield* sql`CREATE INDEX idx_job_dlq_app_id_fk ON job_dlq(app_id)`;
    yield* sql`CREATE INDEX idx_job_dlq_user_id_fk ON job_dlq(user_id) WHERE user_id IS NOT NULL`;
    // ═══════════════════════════════════════════════════════════════════════════
    // EFFECT_EVENT_JOURNAL: SqlEventJournal from @effect/sql (append-only, dedup via primary_key)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE effect_event_journal (
            id BYTEA PRIMARY KEY,
            event TEXT NOT NULL,
            primary_key TEXT NOT NULL UNIQUE,
            payload BYTEA NOT NULL,
            timestamp BIGINT NOT NULL
        )
    `;
    yield* sql`COMMENT ON TABLE effect_event_journal IS 'SqlEventJournal: Append-only event journal with deduplication via primary_key UNIQUE constraint'`;
    yield* sql`COMMENT ON COLUMN effect_event_journal.id IS 'UUID bytes — use encode(id, hex) for display'`;
    yield* sql`COMMENT ON COLUMN effect_event_journal.event IS 'Event type string (e.g., job.completed, ws.presence.online)'`;
    yield* sql`COMMENT ON COLUMN effect_event_journal.primary_key IS 'Deduplication key — typically eventId; UNIQUE constraint prevents duplicates'`;
    yield* sql`COMMENT ON COLUMN effect_event_journal.payload IS 'Binary-encoded EventEnvelope (JSON via TextEncoder)'`;
    yield* sql`COMMENT ON COLUMN effect_event_journal.timestamp IS 'Epoch milliseconds — extracted from Snowflake ID'`;
    yield* sql`CREATE INDEX idx_event_journal_timestamp ON effect_event_journal USING BRIN (timestamp)`;
    yield* sql`CREATE INDEX idx_event_journal_event ON effect_event_journal (event)`;
    yield* sql`
        CREATE TABLE effect_event_remotes (
            remote_id TEXT NOT NULL,
            entry_id BYTEA NOT NULL REFERENCES effect_event_journal(id) ON DELETE CASCADE,
            sequence BIGINT NOT NULL,
            PRIMARY KEY (remote_id, entry_id)
        )
    `;
    yield* sql`COMMENT ON TABLE effect_event_remotes IS 'SqlEventJournal remote sync tracking — sequence per remote for federation'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // KV_STORE: Cluster-wide key-value persistence (singleton state, feature flags)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE kv_store (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            expires_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT kv_store_key_unique UNIQUE (key)
        )
    `;
    yield* sql`COMMENT ON TABLE kv_store IS 'Cluster infrastructure state — singleton state, feature flags; NOT tenant-scoped; use uuid_extract_timestamp(id) for creation time'`;
    yield* sql`COMMENT ON COLUMN kv_store.key IS 'Namespaced key pattern: {prefix}:{name} (e.g., singleton-state:cleanup-job)'`;
    yield* sql`COMMENT ON COLUMN kv_store.value IS 'JSON-encoded state; use S.parseJson(schema) for typed access'`;
    yield* sql`COMMENT ON COLUMN kv_store.expires_at IS 'Optional TTL — purge_kv_store() removes expired entries'`;
    yield* sql`CREATE INDEX idx_kv_store_key ON kv_store(key) INCLUDE (value)`;
    yield* sql`CREATE INDEX idx_kv_store_expires ON kv_store(expires_at) WHERE expires_at IS NOT NULL`;
    yield* sql`CREATE TRIGGER kv_store_updated_at BEFORE UPDATE ON kv_store FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    // ═══════════════════════════════════════════════════════════════════════════
    // PURGE FUNCTIONS: Hard-delete stale/expired records
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE OR REPLACE FUNCTION purge_sessions(p_older_than_days INT DEFAULT 30)
        RETURNS INT
        LANGUAGE sql
        AS $$
            WITH purged AS (
                DELETE FROM sessions
                WHERE (deleted_at IS NOT NULL AND deleted_at < NOW() - (p_older_than_days || ' days')::interval)
                   OR (GREATEST(access_expires_at, refresh_expires_at) < NOW() - (p_older_than_days || ' days')::interval)
                RETURNING id
            )
            SELECT COUNT(*)::int FROM purged
        $$
    `;
    yield* sql`COMMENT ON FUNCTION purge_sessions IS 'Hard-delete soft-deleted + expired sessions older than N days'`;
    yield* sql`
        CREATE OR REPLACE FUNCTION purge_api_keys(p_older_than_days INT DEFAULT 365)
        RETURNS INT
        LANGUAGE sql
        AS $$
            WITH purged AS (
                DELETE FROM api_keys
                WHERE deleted_at IS NOT NULL
                  AND deleted_at < NOW() - (p_older_than_days || ' days')::interval
                RETURNING id
            )
            SELECT COUNT(*)::int FROM purged
        $$
    `;
    yield* sql`COMMENT ON FUNCTION purge_api_keys IS 'Hard-delete soft-deleted API keys older than N days'`;
    yield* sql`
        CREATE OR REPLACE FUNCTION purge_oauth_accounts(p_older_than_days INT DEFAULT 90)
        RETURNS INT
        LANGUAGE sql
        AS $$
            WITH purged AS (
                DELETE FROM oauth_accounts
                WHERE deleted_at IS NOT NULL
                  AND deleted_at < NOW() - (p_older_than_days || ' days')::interval
                RETURNING id
            )
            SELECT COUNT(*)::int FROM purged
        $$
    `;
    yield* sql`COMMENT ON FUNCTION purge_oauth_accounts IS 'Hard-delete soft-deleted OAuth accounts older than N days'`;
    yield* sql`
        CREATE OR REPLACE FUNCTION purge_mfa_secrets(p_older_than_days INT DEFAULT 90)
        RETURNS INT
        LANGUAGE sql
        AS $$
            WITH purged AS (
                DELETE FROM mfa_secrets
                WHERE deleted_at IS NOT NULL
                  AND deleted_at < NOW() - (p_older_than_days || ' days')::interval
                RETURNING id
            )
            SELECT COUNT(*)::int FROM purged
        $$
    `;
    yield* sql`COMMENT ON FUNCTION purge_mfa_secrets IS 'Hard-delete soft-deleted MFA secrets older than N days'`;
    yield* sql`
        CREATE OR REPLACE FUNCTION purge_assets(p_older_than_days INT DEFAULT 30)
        RETURNS INT
        LANGUAGE sql
        AS $$
            WITH purged AS (
                DELETE FROM assets
                WHERE deleted_at IS NOT NULL
                  AND deleted_at < NOW() - (p_older_than_days || ' days')::interval
                RETURNING id
            )
            SELECT COUNT(*)::int FROM purged
        $$
    `;
    yield* sql`COMMENT ON FUNCTION purge_assets IS 'Hard-delete soft-deleted assets older than N days'`;
    yield* sql`
        CREATE OR REPLACE FUNCTION purge_kv_store(p_older_than_days INT DEFAULT 30)
        RETURNS INT
        LANGUAGE sql
        AS $$
            WITH purged AS (
                DELETE FROM kv_store
                WHERE expires_at IS NOT NULL AND expires_at < NOW() - (p_older_than_days || ' days')::interval
                RETURNING id
            )
            SELECT COUNT(*)::int FROM purged
        $$
    `;
    yield* sql`COMMENT ON FUNCTION purge_kv_store IS 'Hard-delete expired kv_store entries older than N days'`;
    yield* sql`
        CREATE OR REPLACE FUNCTION purge_job_dlq(p_older_than_days INT DEFAULT 30)
        RETURNS INT
        LANGUAGE sql
        AS $$
            WITH purged AS (
                DELETE FROM job_dlq
                WHERE replayed_at IS NOT NULL
                  AND replayed_at < NOW() - (p_older_than_days || ' days')::interval
                RETURNING id
            )
            SELECT COUNT(*)::int FROM purged
        $$
    `;
    yield* sql`COMMENT ON FUNCTION purge_job_dlq IS 'Hard-delete replayed job_dlq entries older than N days — keeps pending entries indefinitely'`;
    yield* sql`
        CREATE OR REPLACE FUNCTION purge_event_journal(p_older_than_days INT DEFAULT 30)
        RETURNS INT
        LANGUAGE sql
        AS $$
            WITH purged AS (
                DELETE FROM effect_event_journal
                WHERE timestamp < (EXTRACT(EPOCH FROM NOW()) * 1000 - p_older_than_days * 86400000)::bigint
                RETURNING id
            )
            SELECT COUNT(*)::int FROM purged
        $$
    `;
    yield* sql`COMMENT ON FUNCTION purge_event_journal IS 'Hard-delete journal entries older than N days (timestamp is epoch ms)'`;
    yield* sql`
        CREATE OR REPLACE FUNCTION delete_kv_by_prefix(p_prefix TEXT)
        RETURNS INT
        LANGUAGE sql
        AS $$
            WITH deleted AS (
                DELETE FROM kv_store
                WHERE key LIKE p_prefix || '%'
                RETURNING id
            )
            SELECT COUNT(*)::int FROM deleted
        $$
    `;
    yield* sql`COMMENT ON FUNCTION delete_kv_by_prefix IS 'Hard-delete kv_store entries by key prefix pattern'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // MONITORING FUNCTIONS: PG18.1 pg_stat_io for I/O observability
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE OR REPLACE FUNCTION get_io_stats_by_backend()
        RETURNS TABLE(
            backend_type TEXT,
            io_object TEXT,
            io_context TEXT,
            blks_hit BIGINT,
            blks_read BIGINT,
            blks_written BIGINT,
            blks_extended BIGINT,
            stats_reset TIMESTAMPTZ
        )
        LANGUAGE sql
        STABLE
        AS $$
            SELECT
                backend_type,
                object,
                context,
                SUM(hits)::bigint,
                SUM(reads)::bigint,
                SUM(writes)::bigint,
                SUM(extends)::bigint,
                MAX(stats_reset)
            FROM pg_stat_io
            GROUP BY backend_type, object, context
            ORDER BY SUM(reads) DESC
        $$
    `;
    yield* sql`COMMENT ON FUNCTION get_io_stats_by_backend() IS 'PG18.1: Aggregated I/O statistics by backend type from pg_stat_io catalog view'`;
    yield* sql`
        CREATE OR REPLACE FUNCTION get_io_cache_hit_ratio()
        RETURNS TABLE(
            io_object TEXT,
            io_context TEXT,
            cache_hit_ratio NUMERIC,
            hits BIGINT,
            reads BIGINT
        )
        LANGUAGE sql
        STABLE
        AS $$
            SELECT
                object,
                context,
                CASE
                    WHEN hits + reads > 0
                    THEN ROUND(100.0 * hits / (hits + reads), 2)
                    ELSE 0
                END,
                hits,
                reads
            FROM pg_stat_io
            WHERE object = 'relation'
            ORDER BY reads DESC
        $$
    `;
    yield* sql`COMMENT ON FUNCTION get_io_cache_hit_ratio() IS 'PG18.1: Cache hit ratio from pg_stat_io for relation objects'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // JSON UTILITIES: JSONB diff extraction for audit display
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION extract_audit_changes(
            p_old_data JSONB,
            p_new_data JSONB
        )
        RETURNS TABLE(
            field_name TEXT,
            old_value TEXT,
            new_value TEXT,
            change_type TEXT
        )
        LANGUAGE sql
        STABLE
        AS $$
            SELECT
                COALESCE(o.key, n.key) AS field_name,
                o.value::text AS old_value,
                n.value::text AS new_value,
                CASE
                    WHEN o.key IS NULL THEN 'added'
                    WHEN n.key IS NULL THEN 'removed'
                    WHEN o.value IS DISTINCT FROM n.value THEN 'modified'
                    ELSE 'unchanged'
                END AS change_type
            FROM jsonb_each(COALESCE(p_old_data, '{}'::jsonb)) o
            FULL OUTER JOIN jsonb_each(COALESCE(p_new_data, '{}'::jsonb)) n
                ON o.key = n.key
            WHERE o.value IS DISTINCT FROM n.value
        $$
    `);
    yield* sql`COMMENT ON FUNCTION extract_audit_changes IS 'PG18.1: Extract field-level changes between old/new JSONB for audit diff display. Uses jsonb_each (40x faster than JSON_TABLE for flat structures).'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // IP-BASED FUNCTIONS: Abuse detection and session management
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE OR REPLACE FUNCTION count_sessions_by_ip(p_ip INET, p_window_minutes INT DEFAULT 60)
        RETURNS INT
        LANGUAGE sql
        STABLE
        AS $$
            SELECT COUNT(*)::int
            FROM sessions
            WHERE ip_address = p_ip
              AND deleted_at IS NULL
              AND uuid_extract_timestamp(id) > NOW() - (p_window_minutes || ' minutes')::interval
        $$
    `;
    yield* sql`COMMENT ON FUNCTION count_sessions_by_ip IS 'Count active sessions from IP in time window (rate limiting)'`;
    yield* sql`
        CREATE OR REPLACE FUNCTION revoke_sessions_by_ip(p_ip INET)
        RETURNS INT
        LANGUAGE sql
        AS $$
            WITH revoked AS (
                UPDATE sessions
                SET deleted_at = NOW()
                WHERE ip_address = p_ip AND deleted_at IS NULL
                RETURNING id
            )
            SELECT COUNT(*)::int FROM revoked
        $$
    `;
    yield* sql`COMMENT ON FUNCTION revoke_sessions_by_ip IS 'Soft-delete all sessions from IP (abuse response)'`;
    yield* sql`
        CREATE OR REPLACE FUNCTION count_audit_by_ip(p_app_id UUID, p_ip INET, p_window_minutes INT DEFAULT 60)
        RETURNS INT
        LANGUAGE sql
        STABLE
        AS $$
            SELECT COUNT(*)::int
            FROM audit_logs
            WHERE app_id = p_app_id
              AND ip_address = p_ip
              AND uuid_extract_timestamp(id) > NOW() - (p_window_minutes || ' minutes')::interval
        $$
    `;
    yield* sql`COMMENT ON FUNCTION count_audit_by_ip IS 'Count audit events from IP in time window (abuse detection)'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // SEARCH: Hybrid FTS + trigram + embeddings + fuzzystrmatch
    // pgvector 0.8+: Enable hnsw.iterative_scan = 'relaxed_order' for filtered queries
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`CREATE TEXT SEARCH CONFIGURATION parametric_search (COPY = english)`;
    yield* sql`
        ALTER TEXT SEARCH CONFIGURATION parametric_search
        ALTER MAPPING FOR hword, hword_part, word
        WITH unaccent, english_stem
    `;
    yield* sql`COMMENT ON TEXT SEARCH CONFIGURATION parametric_search IS 'FTS config with unaccent normalization'`;
    yield* sql`DROP MATERIALIZED VIEW IF EXISTS unified_search CASCADE`;
    yield* sql`
        CREATE TABLE search_documents (
            entity_type TEXT NOT NULL,
            entity_id UUID NOT NULL,
            scope_id UUID,
            display_text TEXT NOT NULL,
            content_text TEXT,
            metadata JSONB,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            document_hash TEXT GENERATED ALWAYS AS (
                md5(coalesce(display_text, '') || ' ' || coalesce(content_text, '') || ' ' || coalesce(metadata::text, ''))
            ) STORED,
            search_vector TSVECTOR GENERATED ALWAYS AS (
                setweight(to_tsvector('parametric_search', coalesce(display_text, '')), 'A') ||
                setweight(to_tsvector('parametric_search', coalesce(content_text, '')), 'D') ||
                setweight(jsonb_to_tsvector('parametric_search', coalesce(metadata, '{}'::jsonb), '["string","numeric","boolean"]'), 'C')
            ) STORED,
            CONSTRAINT search_documents_pk PRIMARY KEY (entity_type, entity_id)
        )
    `;
    yield* sql`COMMENT ON TABLE search_documents IS 'Unified search index — use entity_id (UUIDv7) for creation time via uuid_extract_timestamp()'`;
    yield* sql`
        CREATE TABLE search_embeddings (
            entity_type TEXT NOT NULL,
            entity_id UUID NOT NULL,
            scope_id UUID,
            model TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            embedding VECTOR(3072) NOT NULL,
            hash TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT search_embeddings_pk PRIMARY KEY (entity_type, entity_id),
            CONSTRAINT search_embeddings_fk FOREIGN KEY (entity_type, entity_id)
                REFERENCES search_documents(entity_type, entity_id) ON DELETE CASCADE
        )
    `;
    yield* sql`COMMENT ON TABLE search_embeddings IS 'Vector embeddings — use entity_id (UUIDv7) for creation time; configure hnsw.iterative_scan for filtered queries'`;
    yield* sql`COMMENT ON COLUMN search_embeddings.embedding IS 'Max-dimension vectors (3072); actual dimensions stored in dimensions, model in model'`;
    yield* sql`CREATE INDEX idx_search_documents_vector ON search_documents USING GIN (search_vector)`;
    yield* sql`CREATE INDEX idx_search_documents_scope ON search_documents (scope_id, entity_type)`;
    yield* sql`CREATE INDEX idx_search_documents_trgm ON search_documents USING GIN (display_text gin_trgm_ops)`;
    yield* sql`CREATE INDEX idx_search_embeddings_scope ON search_embeddings (scope_id, entity_type, model, dimensions)`;
    yield* sql`CREATE INDEX idx_search_embeddings_embedding ON search_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`;
    yield* sql`CREATE TRIGGER search_documents_updated_at BEFORE UPDATE ON search_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    yield* sql`CREATE TRIGGER search_embeddings_updated_at BEFORE UPDATE ON search_embeddings FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION upsert_search_document_app()
        RETURNS TRIGGER AS $$
        BEGIN
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata)
            VALUES (
                'app',
                NEW.id,
                NULL,
                NEW.name,
                NEW.namespace,
                jsonb_build_object('name', NEW.name, 'namespace', NEW.namespace)
            )
            ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                display_text = EXCLUDED.display_text,
                content_text = EXCLUDED.content_text,
                metadata = EXCLUDED.metadata;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION upsert_search_document_user()
        RETURNS TRIGGER AS $$
        BEGIN
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata)
            VALUES (
                'user',
                NEW.id,
                NEW.app_id,
                NEW.email,
                NEW.role::text,
                jsonb_build_object('email', NEW.email, 'role', NEW.role)
            )
            ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                scope_id = EXCLUDED.scope_id,
                display_text = EXCLUDED.display_text,
                content_text = EXCLUDED.content_text,
                metadata = EXCLUDED.metadata;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION delete_search_document_user()
        RETURNS TRIGGER AS $$
        BEGIN
            DELETE FROM search_documents WHERE entity_type = 'user' AND entity_id = OLD.id;
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION upsert_search_document_asset()
        RETURNS TRIGGER AS $$
        BEGIN
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata)
            VALUES (
                'asset',
                NEW.id,
                NEW.app_id,
                COALESCE(NEW.name, NEW.type),
                NEW.content,
                jsonb_strip_nulls(jsonb_build_object('type', NEW.type, 'size', NEW.size, 'name', NEW.name, 'hash', NEW.hash), true)
            )
            ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                scope_id = EXCLUDED.scope_id,
                display_text = EXCLUDED.display_text,
                content_text = EXCLUDED.content_text,
                metadata = EXCLUDED.metadata;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION delete_search_document_asset()
        RETURNS TRIGGER AS $$
        BEGIN
            DELETE FROM search_documents WHERE entity_type = 'asset' AND entity_id = OLD.id;
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION insert_search_document_audit()
        RETURNS TRIGGER AS $$
        BEGIN
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata)
            VALUES (
                'auditLog',
                NEW.id,
                NEW.app_id,
                NEW.subject::text || ':' || NEW.operation::text,
                NEW.subject::text || ' ' || NEW.operation::text,
                jsonb_strip_nulls(jsonb_build_object(
                    'subject', NEW.subject,
                    'operation', NEW.operation,
                    'userId', NEW.user_id,
                    'hasOldData', NEW.old_data IS NOT NULL,
                    'hasNewData', NEW.new_data IS NOT NULL
                ), true)
            )
            ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                scope_id = EXCLUDED.scope_id,
                display_text = EXCLUDED.display_text,
                content_text = EXCLUDED.content_text,
                metadata = EXCLUDED.metadata;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `);
    yield* sql`CREATE TRIGGER apps_search_upsert AFTER INSERT OR UPDATE OF name, namespace ON apps FOR EACH ROW EXECUTE FUNCTION upsert_search_document_app()`;
    yield* sql`CREATE TRIGGER users_search_upsert AFTER INSERT OR UPDATE OF email, role, deleted_at ON users FOR EACH ROW WHEN (NEW.deleted_at IS NULL) EXECUTE FUNCTION upsert_search_document_user()`;
    yield* sql`CREATE TRIGGER users_search_delete AFTER UPDATE OF deleted_at ON users FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL) EXECUTE FUNCTION delete_search_document_user()`;
    yield* sql`CREATE TRIGGER assets_search_upsert AFTER INSERT OR UPDATE OF content, type, name, hash, deleted_at ON assets FOR EACH ROW WHEN (NEW.deleted_at IS NULL) EXECUTE FUNCTION upsert_search_document_asset()`;
    yield* sql`CREATE TRIGGER assets_search_delete AFTER UPDATE OF deleted_at ON assets FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL) EXECUTE FUNCTION delete_search_document_asset()`;
    yield* sql`CREATE TRIGGER audit_logs_search_insert AFTER INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION insert_search_document_audit()`;
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION refresh_search_documents(p_scope_id uuid DEFAULT NULL, p_include_global boolean DEFAULT false)
        RETURNS void
        LANGUAGE plpgsql
        SECURITY INVOKER
        AS $$
        BEGIN
            IF p_scope_id IS NULL THEN
                DELETE FROM search_documents;
                INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata)
                SELECT 'app', id, NULL, name, namespace, jsonb_build_object('name', name, 'namespace', namespace)
                FROM apps;
                INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata)
                SELECT 'user', id, app_id, email, role::text, jsonb_build_object('email', email, 'role', role)
                FROM users
                WHERE deleted_at IS NULL;
                INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata)
                SELECT 'asset', id, app_id, COALESCE(name, type), content,
                    jsonb_strip_nulls(jsonb_build_object('type', type, 'size', size, 'name', name, 'hash', hash), true)
                FROM assets
                WHERE deleted_at IS NULL;
                INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata)
                SELECT 'auditLog', id, app_id, subject::text || ':' || operation::text, subject::text || ' ' || operation::text,
                    jsonb_strip_nulls(jsonb_build_object(
                        'subject', subject,
                        'operation', operation,
                        'userId', user_id,
                        'hasOldData', old_data IS NOT NULL,
                        'hasNewData', new_data IS NOT NULL
                    ), true)
                FROM audit_logs;
                RETURN;
            END IF;

            DELETE FROM search_documents WHERE scope_id = p_scope_id;

            IF p_include_global THEN
                DELETE FROM search_documents WHERE scope_id IS NULL;
                INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata)
                SELECT 'app', id, NULL, name, namespace, jsonb_build_object('name', name, 'namespace', namespace)
                FROM apps;
            END IF;

            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata)
            SELECT 'user', id, app_id, email, role::text, jsonb_build_object('email', email, 'role', role)
            FROM users
            WHERE deleted_at IS NULL AND app_id = p_scope_id;

            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata)
            SELECT 'asset', id, app_id, COALESCE(name, type), content,
                jsonb_strip_nulls(jsonb_build_object('type', type, 'size', size, 'name', name, 'hash', hash), true)
            FROM assets
            WHERE deleted_at IS NULL AND app_id = p_scope_id;

            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata)
            SELECT 'auditLog', id, app_id, subject::text || ':' || operation::text, subject::text || ' ' || operation::text,
                jsonb_strip_nulls(jsonb_build_object(
                    'subject', subject,
                    'operation', operation,
                    'userId', user_id,
                    'hasOldData', old_data IS NOT NULL,
                    'hasNewData', new_data IS NOT NULL
                ), true)
            FROM audit_logs
            WHERE app_id = p_scope_id;
        END
        $$
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION notify_search_refresh()
        RETURNS void
        LANGUAGE plpgsql
        SECURITY INVOKER
        AS $$
        BEGIN
            PERFORM pg_notify('search_refresh', json_build_object(
                'timestamp', extract(epoch from now()),
                'event', 'refresh_complete'
            )::text);
        END
        $$
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION get_search_suggestions(
            p_prefix text,
            p_scope_id uuid,
            p_include_global boolean,
            p_limit int DEFAULT 20
        )
        RETURNS TABLE(term text, frequency bigint)
        LANGUAGE sql
        STABLE
        SECURITY INVOKER
        AS $$
            SELECT word, ndoc
            FROM ts_stat(
                CASE
                    WHEN p_scope_id IS NULL THEN
                        'SELECT search_vector FROM search_documents WHERE scope_id IS NULL'
                    WHEN p_include_global THEN
                        format('SELECT search_vector FROM search_documents WHERE scope_id = %L OR scope_id IS NULL', p_scope_id)
                    ELSE
                        format('SELECT search_vector FROM search_documents WHERE scope_id = %L', p_scope_id)
                END
            )
            WHERE word LIKE (regexp_replace(unaccent(lower(p_prefix)), '([%_\\])', '\\\\\1', 'g') || '%') ESCAPE '\'
            ORDER BY ndoc DESC
            LIMIT LEAST(COALESCE(p_limit, 20), 100)
        $$
    `);
    yield* sql`SELECT refresh_search_documents()`;
    // ═══════════════════════════════════════════════════════════════════════════
    // RLS: Row-Level Security for multi-tenant isolation
    // ═══════════════════════════════════════════════════════════════════════════
    // Custom GUC for tenant context (set via SET LOCAL in transactions)
    yield* sql`SELECT set_config('app.current_tenant', '00000000-0000-7000-8000-000000000001', false)`;
    // Enable RLS on tenant-scoped tables
    yield* sql`ALTER TABLE users ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE sessions ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE oauth_accounts ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE mfa_secrets ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE assets ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE jobs ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE job_dlq ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE search_documents ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE search_embeddings ENABLE ROW LEVEL SECURITY`;
    // RLS Policies: users (scoped by app_id)
    yield* sql`CREATE POLICY users_tenant_isolation ON users USING (app_id = current_setting('app.current_tenant')::uuid) WITH CHECK (app_id = current_setting('app.current_tenant')::uuid)`;
    // RLS Policies: sessions (scoped by app_id)
    yield* sql`CREATE POLICY sessions_tenant_isolation ON sessions USING (app_id = current_setting('app.current_tenant')::uuid) WITH CHECK (app_id = current_setting('app.current_tenant')::uuid)`;
    // RLS Policies: api_keys (scoped via SECURITY DEFINER helper — avoids chained RLS)
    yield* sql`CREATE POLICY api_keys_tenant_isolation ON api_keys USING (user_id IN (SELECT get_tenant_user_ids()))`;
    // RLS Policies: oauth_accounts (scoped via SECURITY DEFINER helper — avoids chained RLS)
    yield* sql`CREATE POLICY oauth_accounts_tenant_isolation ON oauth_accounts USING (user_id IN (SELECT get_tenant_user_ids()))`;
    // RLS Policies: mfa_secrets (scoped via SECURITY DEFINER helper — avoids chained RLS)
    yield* sql`CREATE POLICY mfa_secrets_tenant_isolation ON mfa_secrets USING (user_id IN (SELECT get_tenant_user_ids()))`;
    // RLS Policies: assets (scoped by app_id)
    yield* sql`CREATE POLICY assets_tenant_isolation ON assets USING (app_id = current_setting('app.current_tenant')::uuid) WITH CHECK (app_id = current_setting('app.current_tenant')::uuid)`;
    // RLS Policies: audit_logs (scoped by app_id)
    yield* sql`CREATE POLICY audit_logs_tenant_isolation ON audit_logs USING (app_id = current_setting('app.current_tenant')::uuid) WITH CHECK (app_id = current_setting('app.current_tenant')::uuid)`;
    // RLS Policies: jobs (scoped by app_id)
    yield* sql`CREATE POLICY jobs_tenant_isolation ON jobs USING (app_id = current_setting('app.current_tenant')::uuid) WITH CHECK (app_id = current_setting('app.current_tenant')::uuid)`;
    // RLS Policies: job_dlq (scoped by app_id)
    yield* sql`CREATE POLICY job_dlq_tenant_isolation ON job_dlq USING (app_id = current_setting('app.current_tenant')::uuid) WITH CHECK (app_id = current_setting('app.current_tenant')::uuid)`;
    // RLS Policies: search_documents (scoped by scope_id = app_id, or global if NULL)
    yield* sql`CREATE POLICY search_documents_tenant_isolation ON search_documents USING (scope_id IS NULL OR scope_id = current_setting('app.current_tenant')::uuid)`;
    // RLS Policies: search_embeddings (scoped by scope_id = app_id, or global if NULL)
    yield* sql`CREATE POLICY search_embeddings_tenant_isolation ON search_embeddings USING (scope_id IS NULL OR scope_id = current_setting('app.current_tenant')::uuid)`;
    // FORCE RLS for table owners (superuser bypass is acceptable for migrations/admin)
    yield* sql`ALTER TABLE users FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE sessions FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE api_keys FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE oauth_accounts FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE mfa_secrets FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE assets FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE jobs FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE job_dlq FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE search_documents FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE search_embeddings FORCE ROW LEVEL SECURITY`;
    yield* sql`COMMENT ON POLICY users_tenant_isolation ON users IS 'RLS: Isolate users by app_id matching current_setting(app.current_tenant)'`;
    yield* sql`COMMENT ON POLICY assets_tenant_isolation ON assets IS 'RLS: Isolate assets by app_id matching current_setting(app.current_tenant)'`;
    yield* sql`COMMENT ON POLICY audit_logs_tenant_isolation ON audit_logs IS 'RLS: Isolate audit_logs by app_id matching current_setting(app.current_tenant)'`;
    yield* sql`COMMENT ON POLICY jobs_tenant_isolation ON jobs IS 'RLS: Isolate jobs by app_id matching current_setting(app.current_tenant)'`;
    yield* sql`COMMENT ON POLICY job_dlq_tenant_isolation ON job_dlq IS 'RLS: Isolate job_dlq by app_id matching current_setting(app.current_tenant)'`;
});
