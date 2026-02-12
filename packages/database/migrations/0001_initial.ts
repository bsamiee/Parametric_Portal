/**
 * PostgreSQL 18.1 aligned features and extensions (18.1 released 2025-11-13):
 * ┌─── PG18.1 NEW FEATURES USED ──────────────────────────────────────────────────┐
 * │ uuidv7()              │ NATIVE time-ordered IDs (no extension, k-sortable)    │
 * │ uuid_extract_timestamp│ Extract creation time from UUIDv7 (NO created_at)     │
 * │ RETURNING OLD/NEW     │ Capture before/after values in single DML statement   │
 * │ B-tree skip scan      │ Multi-column indexes usable when leading cols omitted │
 * │ VIRTUAL generated     │ Computed on read for lightweight derived counters      │
 * │ casefold()            │ Unicode-correct case folding (replaces lower())        │
 * │ jsonb_strip_nulls(,t) │ Two-arg form strips null values from JSONB objects    │
 * │ Async I/O             │ io_method worker/io_uring for parallel prefetch       │
 * │ LIKE + nondeterministic│ LIKE with nondeterministic ICU collations            │
 * │ NOT ENFORCED          │ Skip FK/CHECK enforcement on append-only tables      │
 * ├─── ESTABLISHED PG FEATURES LEVERAGED ─────────────────────────────────────────┤
 * │ NULLS NOT DISTINCT    │ Proper NULL handling in unique constraints (PG15)     │
 * │ Covering (INCLUDE)    │ Index-only scans eliminate heap fetches (PG11)        │
 * │ BRIN indexes          │ Ultra-compact for time-range scans on audit logs (PG9.5)│
 * │ Partial indexes       │ Only index active/non-deleted records (PG7.2)         │
 * │ STORED generated      │ Precomputed columns for search hash/vector (PG12)    │
 * │ Parallel GIN          │ Concurrent JSONB index builds                         │
 * │ Immutability          │ DB-enforced append-only audit_logs via trigger        │
 * └───────────────────────────────────────────────────────────────────────────────┘
 * EXTENSIONS + COLLATION REQUIRED (CREATE EXTENSION IF NOT EXISTS):
 * - ICU case-insensitive collation (TEXT + nondeterministic ICU collation for apps.namespace, users.email)
 * - pg_trgm (trigram similarity for fuzzy search)
 * - btree_gin (multi-column GIN with scalar + trigram operator classes)
 * - fuzzystrmatch (levenshtein_less_equal bounded fuzzy distance)
 * - unaccent (diacritic normalization for FTS/similarity)
 * - crc32c (native PG18 — fast non-cryptographic hash for document change detection)
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
 * - casefold(text): Unicode-correct case folding for search normalization (replaces lower())
 * - jsonb_strip_nulls(jsonb, boolean): Two-arg form strips null values from JSONB objects
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
 * - expiry validation: App must ensure expiry.access/refresh > now() at insert time
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
    // EXTENSIONS: pg_trgm + btree_gin + fuzzystrmatch + unaccent + vector + pg_stat_statements + pgaudit
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS btree_gin`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS fuzzystrmatch`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS unaccent`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS vector`;
    yield* sql.unsafe(String.raw`
		COMMENT ON EXTENSION pg_trgm IS 'pg_trgm: trigram similarity for fuzzy search';
		COMMENT ON EXTENSION btree_gin IS 'btree_gin: scalar operator classes for multi-column GIN indexes with pg_trgm';
		COMMENT ON EXTENSION fuzzystrmatch IS 'fuzzystrmatch: levenshtein_less_equal() for bounded fuzzy distance in search ranking';
		COMMENT ON EXTENSION unaccent IS 'unaccent: Unicode diacritic normalization for search';
		COMMENT ON EXTENSION vector IS 'pgvector 0.8+: vector similarity search with HNSW iterative scan support';
	`);
    yield* sql.unsafe(String.raw`
	        DO $$
	        BEGIN
	            BEGIN
	                CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
	                COMMENT ON EXTENSION pg_stat_statements IS 'pg_stat_statements: query performance statistics (requires shared_preload_libraries)';
	            EXCEPTION WHEN OTHERS THEN RAISE WARNING 'pg_stat_statements unavailable -- requires shared_preload_libraries: %', SQLERRM;
	            END;
	            BEGIN
	                CREATE EXTENSION IF NOT EXISTS pgaudit;
	                COMMENT ON EXTENSION pgaudit IS 'pgaudit: compliance audit logging for SOC2/HIPAA/PCI-DSS (requires shared_preload_libraries)';
	            EXCEPTION WHEN OTHERS THEN RAISE WARNING 'pgaudit unavailable -- requires shared_preload_libraries: %', SQLERRM;
	            END;
	        END;
	        $$;
	    `);
    yield* sql`CREATE COLLATION IF NOT EXISTS case_insensitive (provider = icu, locale = 'und-u-ks-level2', deterministic = false)`;
    yield* sql`COMMENT ON COLLATION case_insensitive IS 'ICU nondeterministic collation for case-insensitive TEXT (Unicode-aware)'`;
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
        CREATE OR REPLACE FUNCTION reject_dml()
        RETURNS TRIGGER AS $$
        BEGIN
            IF TG_OP = ANY(TG_ARGV) THEN
                RAISE EXCEPTION USING
                    MESSAGE = format('Table %I: %s is prohibited', TG_TABLE_NAME, TG_OP),
                    ERRCODE = 'restrict_violation';
            END IF;
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql
    `;
    yield* sql`COMMENT ON FUNCTION reject_dml() IS 'Parameterized DML guard — pass prohibited operations as trigger args (e.g., UPDATE, DELETE)'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // RLS HELPERS: SECURITY DEFINER functions for efficient tenant isolation
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE OR REPLACE FUNCTION get_current_tenant_id()
        RETURNS uuid
        LANGUAGE sql
        STABLE
        PARALLEL SAFE
        SECURITY INVOKER
        SET search_path TO public
        AS $$
            SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid
        $$
    `;
    yield* sql`COMMENT ON FUNCTION get_current_tenant_id() IS 'Returns current tenant ID from app.current_tenant GUC with null-safe default-deny semantics. Used by RLS policies with STABLE caching.'`;
    yield* sql`
        CREATE OR REPLACE FUNCTION get_tenant_user_ids()
        RETURNS SETOF uuid
        LANGUAGE sql
        STABLE
        PARALLEL SAFE
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
    // ENUM + DOMAIN TYPES: Centralized value constraints for reuse across tables
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql.unsafe(String.raw`
		CREATE TYPE app_role AS ENUM ('owner', 'admin', 'member', 'viewer', 'guest');
		CREATE TYPE app_status AS ENUM ('active', 'suspended', 'archived');
		CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended');
		CREATE TYPE asset_status AS ENUM ('active', 'processing', 'failed', 'deleted');
		CREATE TYPE job_status AS ENUM ('queued', 'processing', 'complete', 'failed', 'cancelled');
		CREATE TYPE job_priority AS ENUM ('critical', 'high', 'normal', 'low');
		CREATE TYPE notification_status AS ENUM ('queued', 'sending', 'delivered', 'failed', 'dlq');
		CREATE TYPE notification_channel AS ENUM ('email', 'webhook', 'inApp');
		CREATE TYPE oauth_provider AS ENUM ('apple', 'github', 'google', 'microsoft');
		CREATE TYPE dlq_source AS ENUM ('job', 'event');
		CREATE TYPE dlq_error_reason AS ENUM (
			'MaxRetries', 'Validation', 'HandlerMissing', 'RunnerUnavailable',
			'Timeout', 'Panic', 'Processing', 'NotFound', 'AlreadyCancelled',
			'DeliveryFailed', 'DeserializationFailed', 'DuplicateEvent',
			'ValidationFailed', 'AuditPersistFailed', 'HandlerTimeout'
		);
		CREATE TYPE webauthn_device_type AS ENUM ('singleDevice', 'multiDevice');
		CREATE TYPE audit_operation AS ENUM (
			'create', 'update', 'delete', 'read', 'list', 'status',
			'login', 'refresh', 'revoke', 'revokeByIp',
			'verify', 'verifyMfa', 'register', 'enroll', 'disable',
			'sign', 'upload', 'stream_upload', 'copy', 'remove', 'abort_multipart',
			'export', 'import', 'validate',
			'cancel', 'replay',
			'archive', 'purge-tenant',
			'auth_failure', 'permission_denied',
			'purge-sessions', 'purge-api-keys', 'purge-assets', 'purge-event-journal',
			'purge-job-dlq', 'purge-kv-store', 'purge-mfa-secrets', 'purge-oauth-accounts'
		);
		CREATE DOMAIN hex64 AS TEXT CHECK (VALUE ~* '^[0-9a-f]{64}$');
	`);
    // ═══════════════════════════════════════════════════════════════════════════
    // APPS: Multi-tenant isolation root (must exist before FK references)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE apps (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            name TEXT NOT NULL,
            namespace TEXT COLLATE case_insensitive NOT NULL,
            settings JSONB,
            status app_status NOT NULL DEFAULT 'active',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT apps_name_not_empty CHECK (length(trim(name)) > 0),
            CONSTRAINT apps_namespace_not_empty CHECK (length(trim(namespace)) > 0),
            CONSTRAINT apps_settings_shape CHECK (settings IS NULL OR jsonb_typeof(settings) = 'object')
        )
    `;
    yield* sql`COMMENT ON TABLE apps IS 'Tenant isolation root — all user-facing entities scope to an app; use uuid_extract_timestamp(id) for creation time'`;
    yield* sql`CREATE UNIQUE INDEX idx_apps_namespace ON apps(namespace) INCLUDE (id)`;
    yield* sql`INSERT INTO apps (id, name, namespace) VALUES ('00000000-0000-7000-8000-000000000000', 'System', 'system') ON CONFLICT (id) DO NOTHING`;
    yield* sql`INSERT INTO apps (id, name, namespace) VALUES ('00000000-0000-7000-8000-000000000001', 'Default', 'default') ON CONFLICT (id) DO NOTHING`;
    // ═══════════════════════════════════════════════════════════════════════════
    // USERS: App-scoped accounts with soft-delete (NEVER hard-delete)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE users (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            email TEXT COLLATE case_insensitive NOT NULL,
            preferences JSONB NOT NULL DEFAULT '{"channels":{"email":true,"webhook":true,"inApp":true},"templates":{},"mutedUntil":null}'::jsonb,
            role app_role NOT NULL,
            status user_status NOT NULL DEFAULT 'active',
            deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT users_preferences_shape CHECK (
                jsonb_typeof(preferences) = 'object'
                AND jsonb_typeof(preferences->'channels') = 'object'
            )
        )
    `;
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE users IS 'User accounts — NEVER hard-delete; use uuid_extract_timestamp(id) for creation time';
		COMMENT ON COLUMN users.deleted_at IS 'Soft-delete timestamp — NULL means active; set enables email re-registration';
		COMMENT ON COLUMN users.email IS 'Format validated at app layer; ICU nondeterministic collation enforces case-insensitive uniqueness among active users';
		COMMENT ON COLUMN users.preferences IS 'Per-user notification preferences: channel toggles, template overrides, mute window';
	`);
    yield* sql`CREATE UNIQUE INDEX idx_users_app_email_active ON users(app_id, email) INCLUDE (id, role) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_users_app_id ON users(app_id) INCLUDE (id, email, role) WHERE deleted_at IS NULL`;
    // ═══════════════════════════════════════════════════════════════════════════
    // PERMISSIONS: Tenant-scoped resource-action authorization matrix
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE permissions (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            role app_role NOT NULL,
            resource TEXT NOT NULL,
            action TEXT NOT NULL,
            deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT permissions_resource_not_empty CHECK (length(trim(resource)) > 0),
            CONSTRAINT permissions_action_not_empty CHECK (length(trim(action)) > 0),
            CONSTRAINT permissions_unique UNIQUE (app_id, role, resource, action)
        )
    `;
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE permissions IS 'Tenant-scoped authorization matrix (role × resource × action)';
		COMMENT ON COLUMN permissions.deleted_at IS 'Soft-delete timestamp — NULL means active permission';
	`);
    yield* sql`CREATE INDEX idx_permissions_app_role_active ON permissions(app_id, role) INCLUDE (resource, action) WHERE deleted_at IS NULL`;
    // ═══════════════════════════════════════════════════════════════════════════
    // SESSIONS: Token-based auth with MFA gate
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE sessions (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            token_access hex64 NOT NULL,
            token_refresh hex64 NOT NULL,
            expiry_access TIMESTAMPTZ NOT NULL,
            expiry_refresh TIMESTAMPTZ NOT NULL,
            deleted_at TIMESTAMPTZ,
            verified_at TIMESTAMPTZ,
            ip_address INET,
            agent TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT sessions_agent_length CHECK (agent IS NULL OR length(agent) <= 1024)
        )
    `;
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE sessions IS 'Auth sessions — use uuid_extract_timestamp(id) for creation time';
		COMMENT ON COLUMN sessions.verified_at IS 'NULL until second factor verified — gate sensitive operations';
		COMMENT ON COLUMN sessions.token_access IS 'SHA-256 hash of access token (hex64)';
		COMMENT ON COLUMN sessions.token_refresh IS 'SHA-256 hash of refresh token (hex64)';
		COMMENT ON COLUMN sessions.expiry_access IS 'Access token expiration timestamp';
		COMMENT ON COLUMN sessions.expiry_refresh IS 'Refresh token expiration timestamp';
		COMMENT ON COLUMN sessions.updated_at IS 'App layer must update on each authenticated request';
		COMMENT ON COLUMN sessions.deleted_at IS 'Soft-delete timestamp — NULL means active';
	`);
    yield* sql`CREATE UNIQUE INDEX idx_sessions_token_access ON sessions(token_access)`;
    yield* sql`CREATE UNIQUE INDEX idx_sessions_token_refresh ON sessions(token_refresh)`;
    yield* sql`CREATE INDEX idx_sessions_app_user_active ON sessions(app_id, user_id) INCLUDE (expiry_access, expiry_refresh, verified_at, updated_at, ip_address) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_sessions_cleanup ON sessions(deleted_at, (GREATEST(expiry_access, expiry_refresh)))`;
    yield* sql`CREATE INDEX idx_sessions_ip ON sessions(ip_address) WHERE ip_address IS NOT NULL AND deleted_at IS NULL`;
    // ═══════════════════════════════════════════════════════════════════════════
    // API_KEYS: Programmatic access tokens (encrypted at rest)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE api_keys (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            name TEXT NOT NULL,
            hash hex64 NOT NULL,
            encrypted BYTEA NOT NULL,
            expires_at TIMESTAMPTZ,
            deleted_at TIMESTAMPTZ,
            last_used_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            prefix TEXT GENERATED ALWAYS AS (left(hash, 16)) VIRTUAL,
            CONSTRAINT api_keys_hash_unique UNIQUE (hash),
            CONSTRAINT api_keys_name_not_empty CHECK (length(trim(name)) > 0)
        )
    `;
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE api_keys IS 'Programmatic access tokens — use uuid_extract_timestamp(id) for creation time';
		COMMENT ON COLUMN api_keys.encrypted IS 'AES-256-GCM encrypted — decrypt only at use time';
		COMMENT ON COLUMN api_keys.prefix IS 'VIRTUAL for UI display only — NOT unique';
		COMMENT ON COLUMN api_keys.deleted_at IS 'Soft-delete timestamp — NULL means active';
	`);
    yield* sql`CREATE INDEX idx_api_keys_user_active ON api_keys(user_id) INCLUDE (id, name, expires_at, last_used_at) WHERE deleted_at IS NULL`;
    // ═══════════════════════════════════════════════════════════════════════════
    // OAUTH_ACCOUNTS: Federated identity linking (tokens encrypted)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE oauth_accounts (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            provider oauth_provider NOT NULL,
            external_id TEXT NOT NULL,
            token_payload BYTEA NOT NULL,
            deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT oauth_provider_external_unique UNIQUE (provider, external_id)
        )
    `;
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE oauth_accounts IS 'Federated identity linking — use uuid_extract_timestamp(id) for creation time';
		COMMENT ON COLUMN oauth_accounts.token_payload IS 'AES-256-GCM encrypted token blob (access + refresh + expiry merged)';
		COMMENT ON COLUMN oauth_accounts.deleted_at IS 'Soft-delete timestamp — NULL means active';
	`);
    yield* sql`CREATE INDEX idx_oauth_user ON oauth_accounts(user_id) INCLUDE (provider, external_id) WHERE deleted_at IS NULL`;
    // ═══════════════════════════════════════════════════════════════════════════
    // ASSETS: App-scoped content (icons, images, documents) with size limits
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE assets (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            type TEXT NOT NULL,
            status asset_status NOT NULL,
            hash hex64,
            name TEXT,
            storage_ref TEXT,
            content TEXT NOT NULL,
            deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            size INTEGER GENERATED ALWAYS AS (octet_length(content)) STORED,
            CONSTRAINT assets_content_max_size CHECK (octet_length(content) <= 1048576)
        )
    `;
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE assets IS 'App content — use uuid_extract_timestamp(id) for creation time; user_id SET NULL on user delete preserves orphaned content';
		COMMENT ON COLUMN assets.hash IS 'SHA-256 content hash (64 hex chars) for verification/deduplication — computed at app layer';
		COMMENT ON COLUMN assets.name IS 'Original filename for ZIP manifest reconstruction and display';
		COMMENT ON COLUMN assets.storage_ref IS 'S3 object key when binary content stored externally — pattern: assets/{appId}/{hash}.{ext}';
		COMMENT ON COLUMN assets.size IS 'STORED for aggregate queries — octet_length for byte quota (UTF-8 aware)';
	`);
    yield* sql`CREATE INDEX idx_assets_app_type ON assets(app_id, type) INCLUDE (id, user_id) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_assets_app_user ON assets(app_id, user_id) INCLUDE (id, type) WHERE deleted_at IS NULL AND user_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_assets_app_recent ON assets(app_id, id DESC) INCLUDE (type, user_id) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_assets_hash ON assets(hash) WHERE hash IS NOT NULL AND deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_assets_storage_ref ON assets(storage_ref) WHERE storage_ref IS NOT NULL AND deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_assets_stale_purge ON assets(deleted_at, storage_ref) WHERE deleted_at IS NOT NULL AND storage_ref IS NOT NULL`;
    // ═══════════════════════════════════════════════════════════════════════════
    // AUDIT_LOGS: Immutable compliance trail (append-only, BRIN-optimized on id)
    // Uses PG18.1 RETURNING OLD/NEW for efficient before/after capture
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE audit_logs (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT NOT ENFORCED,
            user_id UUID REFERENCES users(id) ON DELETE RESTRICT NOT ENFORCED,
            request_id UUID,
            operation audit_operation NOT NULL,
            target_type TEXT NOT NULL,
            target_id UUID NOT NULL,
            delta JSONB,
            context_ip INET,
            context_agent TEXT
        )
    `;
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE audit_logs IS 'Append-only audit trail — use uuid_extract_timestamp(id) for creation time';
		COMMENT ON COLUMN audit_logs.user_id IS 'FK to users — RESTRICT (users never hard-deleted); JOIN to users.email when needed';
		COMMENT ON COLUMN audit_logs.request_id IS 'Correlation ID from request context — correlate multiple audit entries from same HTTP request';
		COMMENT ON COLUMN audit_logs.target_type IS 'Entity type discriminant (e.g., user, session, app)';
		COMMENT ON COLUMN audit_logs.target_id IS 'Entity UUID — the subject of the audit event';
		COMMENT ON COLUMN audit_logs.delta IS 'JSONB with old/new state — NULL for read/list operations; replaces old_data/new_data';
		COMMENT ON COLUMN audit_logs.context_ip IS 'Request originator IP address (INET) for abuse detection and subnet matching';
		COMMENT ON COLUMN audit_logs.context_agent IS 'User-Agent string from request context';
	`);
    yield* sql`CREATE INDEX idx_audit_id_brin ON audit_logs USING BRIN (id)`;
    yield* sql`CREATE INDEX idx_audit_app_target ON audit_logs(app_id, target_type, target_id, id DESC) INCLUDE (user_id, operation)`;
    yield* sql`CREATE INDEX idx_audit_app_user ON audit_logs(app_id, user_id, id DESC) INCLUDE (target_type, operation) WHERE user_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_audit_target_id ON audit_logs(target_id, id DESC)`;
    yield* sql`CREATE INDEX idx_audit_request ON audit_logs(request_id) WHERE request_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_audit_delta ON audit_logs USING GIN (delta jsonb_path_ops) WITH (parallel_workers = 4) WHERE delta IS NOT NULL`;
    yield* sql`CREATE INDEX idx_audit_context_ip ON audit_logs(context_ip) WHERE context_ip IS NOT NULL`;
    yield* sql`CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_dml('UPDATE', 'DELETE')`;
    // ═══════════════════════════════════════════════════════════════════════════
    // MFA_SECRETS: TOTP secrets with backup codes
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE mfa_secrets (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
            encrypted BYTEA NOT NULL,
            backups TEXT[] NOT NULL DEFAULT '{}',
            enabled_at TIMESTAMPTZ,
            deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            remaining INTEGER GENERATED ALWAYS AS (COALESCE(array_length(backups, 1), 0)) VIRTUAL,
            CONSTRAINT mfa_backups_no_nulls CHECK (array_position(backups, NULL) IS NULL)
        )
    `;
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE mfa_secrets IS 'TOTP secrets — use uuid_extract_timestamp(id) for creation time';
		COMMENT ON COLUMN mfa_secrets.enabled_at IS 'NULL = enrolled but not activated; set after first successful TOTP';
		COMMENT ON COLUMN mfa_secrets.remaining IS 'VIRTUAL — COALESCE ensures 0 (not NULL) when codes exhausted';
		COMMENT ON COLUMN mfa_secrets.backups IS 'Hashed backup codes — rate limiting for MFA attempts tracked in app-layer cache (Redis), not DB';
		COMMENT ON COLUMN mfa_secrets.deleted_at IS 'Soft-delete timestamp — NULL means active';
	`);
    yield* sql`CREATE INDEX idx_mfa_user ON mfa_secrets(user_id) INCLUDE (enabled_at) WHERE deleted_at IS NULL`;
    // ═══════════════════════════════════════════════════════════════════════════
    // WEBAUTHN_CREDENTIALS: Passkey credentials (user-scoped, soft-delete)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE webauthn_credentials (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            credential_id TEXT NOT NULL,
            public_key BYTEA NOT NULL,
            counter INTEGER NOT NULL DEFAULT 0,
            device_type webauthn_device_type NOT NULL,
            backed_up BOOLEAN NOT NULL,
            transports TEXT[] NOT NULL DEFAULT '{}',
            name TEXT NOT NULL,
            last_used_at TIMESTAMPTZ,
            deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT webauthn_credentials_credential_id_unique UNIQUE (credential_id),
            CONSTRAINT webauthn_credentials_counter_non_negative CHECK (counter >= 0),
            CONSTRAINT webauthn_credentials_name_not_empty CHECK (length(trim(name)) > 0)
        )
    `;
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE webauthn_credentials IS 'WebAuthn passkeys — use uuid_extract_timestamp(id) for creation time';
		COMMENT ON COLUMN webauthn_credentials.credential_id IS 'Base64url credential ID from authenticator; globally unique';
		COMMENT ON COLUMN webauthn_credentials.deleted_at IS 'Soft-delete timestamp — NULL means active';
	`);
    yield* sql`CREATE INDEX idx_webauthn_credentials_user_active ON webauthn_credentials(user_id) INCLUDE (credential_id, name, last_used_at, counter) WHERE deleted_at IS NULL`;
    // ═══════════════════════════════════════════════════════════════════════════
    // JOBS: Durable job registry with snowflake job_id
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE jobs (
            job_id TEXT PRIMARY KEY,
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            type TEXT NOT NULL,
            status job_status NOT NULL,
            priority job_priority NOT NULL,
            payload JSONB NOT NULL,
            output JSONB,
            history JSONB NOT NULL,
            retry_current INTEGER NOT NULL DEFAULT 0 CHECK (retry_current >= 0),
            retry_max INTEGER NOT NULL CHECK (retry_max > 0),
            scheduled_at TIMESTAMPTZ,
            correlation JSONB,
            completed_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT jobs_type_not_empty CHECK (length(trim(type)) > 0),
            CONSTRAINT jobs_history_array CHECK (jsonb_typeof(history) = 'array')
        )
    `;
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE jobs IS 'Durable job registry — snowflake job_id, status/progress/history, tenant-scoped';
		COMMENT ON COLUMN jobs.job_id IS 'Snowflake job identifier (18-19 digit string)';
		COMMENT ON COLUMN jobs.history IS 'Array of {status, timestamp, error?} state transitions';
	`);
    yield* sql`CREATE INDEX idx_jobs_app_status ON jobs(app_id, status) INCLUDE (type, priority, retry_current, retry_max)`;
    yield* sql`CREATE INDEX idx_jobs_app_type ON jobs(app_id, type) INCLUDE (status, priority)`;
    yield* sql`CREATE INDEX idx_jobs_app_updated ON jobs(app_id, updated_at DESC) INCLUDE (status, type)`;
    yield* sql`CREATE UNIQUE INDEX idx_jobs_dedupe_active ON jobs(app_id, (correlation->>'dedupe')) WHERE correlation->>'dedupe' IS NOT NULL AND status IN ('queued', 'processing')`;
    yield* sql`CREATE INDEX idx_jobs_batch ON jobs((correlation->>'batch')) WHERE correlation->>'batch' IS NOT NULL`;
    // ═══════════════════════════════════════════════════════════════════════════
    // NOTIFICATIONS: Durable channel delivery ledger (email/webhook/in-app)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql.unsafe(String.raw`
        CREATE TABLE notifications (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
            channel notification_channel NOT NULL,
            template TEXT NOT NULL,
            status notification_status NOT NULL,
            recipient TEXT,
            payload JSONB NOT NULL,
            delivery JSONB,
            retry_current INTEGER NOT NULL DEFAULT 0 CHECK (retry_current >= 0),
            retry_max INTEGER NOT NULL DEFAULT 5 CHECK (retry_max > 0),
            correlation JSONB,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT notifications_template_not_empty CHECK (length(trim(template)) > 0)
        )
    `);
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE notifications IS 'Tenant-scoped notification ledger for email/webhook/in-app delivery lifecycle — use uuid_extract_timestamp(id) for creation time';
		COMMENT ON COLUMN notifications.user_id IS 'FK to users — RESTRICT (users never hard-deleted); NULL for system/broadcast notifications';
	`);
    yield* sql`CREATE INDEX idx_notifications_app_status ON notifications(app_id, status, id DESC) INCLUDE (channel, template, retry_current, retry_max)`;
    yield* sql`CREATE INDEX idx_notifications_app_user ON notifications(app_id, user_id, id DESC) INCLUDE (channel, status, template) WHERE user_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_notifications_app_updated ON notifications(app_id, updated_at DESC) INCLUDE (channel, status, user_id)`;
    yield* sql`CREATE INDEX idx_notifications_correlation_job ON notifications((correlation->>'job')) WHERE correlation->>'job' IS NOT NULL`;
    yield* sql`CREATE UNIQUE INDEX idx_notifications_dedupe_active ON notifications(app_id, (correlation->>'dedupe')) WHERE correlation->>'dedupe' IS NOT NULL AND status IN ('queued', 'sending')`;
    // ═══════════════════════════════════════════════════════════════════════════
    // JOB_DLQ: Dead-letter queue for failed jobs and events
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE job_dlq (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            source dlq_source NOT NULL DEFAULT 'job',
            source_id TEXT NOT NULL,
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT NOT ENFORCED,
            context_user_id UUID,
            context_request_id UUID,
            type TEXT NOT NULL,
            payload JSONB NOT NULL,
            error_reason dlq_error_reason NOT NULL,
            attempts INTEGER NOT NULL,
            errors JSONB NOT NULL,
            replayed_at TIMESTAMPTZ,
            CONSTRAINT job_dlq_errors_array CHECK (jsonb_typeof(errors) = 'array'),
            CONSTRAINT job_dlq_attempts_positive CHECK (attempts > 0)
        )
    `;
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE job_dlq IS 'Unified dead-letter queue for jobs and events — use uuid_extract_timestamp(id) for DLQ creation time; NO updated_at (append-mostly)';
		COMMENT ON COLUMN job_dlq.source IS 'Discriminant: job = background job, event = domain event from EventBus';
		COMMENT ON COLUMN job_dlq.source_id IS 'Reference to original job/event — snowflake string, NO FK constraint (source may be purged before replay)';
		COMMENT ON COLUMN job_dlq.payload IS 'Serialized failed payload; webhook DLQ entries persist endpoint snapshot + event data for deterministic replay even after settings drift';
		COMMENT ON COLUMN job_dlq.error_reason IS 'Failure classification discriminant for typed error handling — valid values depend on source';
		COMMENT ON COLUMN job_dlq.errors IS 'Array of {error: string, timestamp: number} entries from all attempts';
		COMMENT ON COLUMN job_dlq.replayed_at IS 'NULL = pending replay; set when job/event resubmitted to queue';
	`);
    yield* sql`CREATE INDEX idx_job_dlq_id_brin ON job_dlq USING BRIN (id)`;
    yield* sql`CREATE INDEX idx_job_dlq_source ON job_dlq(source, error_reason) INCLUDE (type, attempts) WHERE replayed_at IS NULL`;
    yield* sql`CREATE INDEX idx_job_dlq_pending_type ON job_dlq(type, error_reason) INCLUDE (app_id, source, attempts) WHERE replayed_at IS NULL`;
    yield* sql`CREATE INDEX idx_job_dlq_pending_app ON job_dlq(app_id, id DESC) INCLUDE (type, source, error_reason, attempts) WHERE replayed_at IS NULL`;
    yield* sql`CREATE INDEX idx_job_dlq_source_id ON job_dlq(source_id) INCLUDE (error_reason, attempts, replayed_at)`;
    yield* sql`CREATE INDEX idx_job_dlq_context_request ON job_dlq(context_request_id) WHERE context_request_id IS NOT NULL`;
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
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE effect_event_journal IS 'SqlEventJournal: Append-only event journal with deduplication via primary_key UNIQUE constraint';
		COMMENT ON COLUMN effect_event_journal.id IS 'UUID bytes — use encode(id, hex) for display';
		COMMENT ON COLUMN effect_event_journal.event IS 'Event type string (e.g., job.completed, ws.presence.online)';
		COMMENT ON COLUMN effect_event_journal.primary_key IS 'Deduplication key — typically eventId; UNIQUE constraint prevents duplicates';
		COMMENT ON COLUMN effect_event_journal.payload IS 'Binary-encoded EventEnvelope (JSON via TextEncoder)';
		COMMENT ON COLUMN effect_event_journal.timestamp IS 'Epoch milliseconds — extracted from Snowflake ID';
	`);
    yield* sql`CREATE INDEX idx_event_journal_timestamp ON effect_event_journal USING BRIN (timestamp)`;
    yield* sql`CREATE INDEX idx_event_journal_event ON effect_event_journal (event)`;
    yield* sql`CREATE TRIGGER event_journal_no_update BEFORE UPDATE ON effect_event_journal FOR EACH ROW EXECUTE FUNCTION reject_dml('UPDATE')`;
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
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `;
    yield* sql`CREATE UNIQUE INDEX kv_store_key_unique ON kv_store(key) INCLUDE (value)`;
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE kv_store IS 'Cluster infrastructure state — singleton state, feature flags; NOT tenant-scoped; use uuid_extract_timestamp(id) for creation time';
		COMMENT ON COLUMN kv_store.key IS 'Namespaced key pattern: {prefix}:{name} (e.g., singleton-state:cleanup-job)';
		COMMENT ON COLUMN kv_store.value IS 'JSON-encoded state; use S.parseJson(schema) for typed access';
		COMMENT ON COLUMN kv_store.expires_at IS 'Optional TTL — purge_kv_store() removes expired entries';
	`);
    yield* sql`CREATE INDEX idx_kv_store_expires ON kv_store(expires_at) WHERE expires_at IS NOT NULL`;
    // ═══════════════════════════════════════════════════════════════════════════
    // CONSOLIDATED: FK indexes for all foreign-key reference columns
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql.unsafe(String.raw`
        DO $$
        DECLARE
            _pair text[];
        BEGIN
            FOREACH _pair SLICE 1 IN ARRAY ARRAY[
                ARRAY['users',                  'app_id'],
                ARRAY['sessions',               'user_id'],
                ARRAY['sessions',               'app_id'],
                ARRAY['api_keys',               'user_id'],
                ARRAY['oauth_accounts',         'user_id'],
                ARRAY['assets',                 'app_id'],
                ARRAY['assets',                 'user_id'],
                ARRAY['audit_logs',             'app_id'],
                ARRAY['audit_logs',             'user_id'],
                ARRAY['webauthn_credentials',   'user_id'],
                ARRAY['notifications',          'user_id'],
                ARRAY['job_dlq',                'app_id']
            ] LOOP
                EXECUTE format(
                    'CREATE INDEX idx_%s_%s_fk ON %I(%I)',
                    _pair[1], _pair[2], _pair[1], _pair[2]
                );
            END LOOP;
        END
        $$
    `);
    // ═══════════════════════════════════════════════════════════════════════════
    // CONSOLIDATED: updated_at triggers (sessions intentionally excluded)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql.unsafe(String.raw`
        DO $$
        DECLARE
            _tbl text;
        BEGIN
            FOR _tbl IN SELECT unnest(ARRAY[
                'apps', 'users', 'permissions', 'api_keys', 'oauth_accounts',
                'assets', 'mfa_secrets', 'webauthn_credentials', 'jobs',
                'notifications', 'kv_store', 'search_documents', 'search_embeddings'
            ]) LOOP
                EXECUTE format(
                    'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION set_updated_at()',
                    _tbl || '_updated_at', _tbl
                );
            END LOOP;
        END
        $$
    `);
    // ═══════════════════════════════════════════════════════════════════════════
    // PURGE FUNCTIONS: Hard-delete stale/expired records
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE OR REPLACE FUNCTION purge_sessions(p_older_than_days INT DEFAULT 30)
        RETURNS INT LANGUAGE sql VOLATILE AS $$
            WITH purged AS (
                DELETE FROM sessions
                WHERE (deleted_at IS NOT NULL AND deleted_at < NOW() - make_interval(days => p_older_than_days))
                   OR (GREATEST(expiry_access, expiry_refresh)
                       < NOW() - make_interval(days => p_older_than_days))
                RETURNING 1
            ) SELECT COUNT(*)::int FROM purged
        $$
    `;
    yield* sql`COMMENT ON FUNCTION purge_sessions IS 'Hard-delete soft-deleted + expired sessions older than N days'`;
    yield* sql.unsafe(String.raw`
        DO $$
        DECLARE
            _rec record;
        BEGIN
            FOR _rec IN
                SELECT *
                FROM (VALUES
                    ('api_keys',       'deleted_at',  365),
                    ('oauth_accounts', 'deleted_at',  90),
                    ('mfa_secrets',    'deleted_at',  90),
                    ('assets',         'deleted_at',  30),
                    ('kv_store',       'expires_at',  30),
                    ('job_dlq',        'replayed_at', 30)
                ) AS t(table_name text, column_name text, default_days int)
            LOOP
                EXECUTE format(
                    $fn$
                    CREATE OR REPLACE FUNCTION purge_%I(p_older_than_days INT DEFAULT %s)
                    RETURNS INT LANGUAGE sql VOLATILE AS $body$
                        WITH purged AS (
                            DELETE FROM %I
                            WHERE %I IS NOT NULL
                              AND %I < NOW() - make_interval(days => p_older_than_days)
                            RETURNING 1
                        )
                        SELECT COUNT(*)::int FROM purged
                    $body$
                    $fn$,
                    _rec.table_name, _rec.default_days,
                    _rec.table_name, _rec.column_name, _rec.column_name
                );
                EXECUTE format(
                    'COMMENT ON FUNCTION purge_%I IS %L',
                    _rec.table_name,
                    format('Hard-delete stale %s entries older than %s days', _rec.table_name, _rec.default_days)
                );
            END LOOP;
        END
        $$
    `);
    yield* sql`
        CREATE OR REPLACE FUNCTION purge_event_journal(p_older_than_days INT DEFAULT 30)
        RETURNS INT
        LANGUAGE sql
        VOLATILE
        AS $$
            WITH purged AS (
                DELETE FROM effect_event_journal
                WHERE timestamp < (EXTRACT(EPOCH FROM NOW()) * 1000 - p_older_than_days::bigint * 86400000)::bigint
                RETURNING 1
            )
            SELECT COUNT(*)::int FROM purged
        $$
    `;
    yield* sql`COMMENT ON FUNCTION purge_event_journal IS 'Hard-delete journal entries older than N days (timestamp is epoch ms)'`;
    yield* sql`
        CREATE OR REPLACE FUNCTION purge_tenant_cascade(p_app_id UUID)
        RETURNS INT
        LANGUAGE plpgsql
        VOLATILE
        AS $$
        DECLARE
            _total bigint := 0;
            _count bigint;
            _user_ids uuid[];
        BEGIN
            -- Materialize user IDs once for user-scoped tables
            SELECT array_agg(id) INTO _user_ids FROM users WHERE app_id = p_app_id;

            DELETE FROM search_embeddings WHERE scope_id = p_app_id;
            GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;

            DELETE FROM search_documents WHERE scope_id = p_app_id;
            GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;

            DELETE FROM notifications WHERE app_id = p_app_id;
            GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;

            -- Disable immutability trigger for cascade purge
            ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable;
            DELETE FROM audit_logs WHERE app_id = p_app_id;
            GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;
            ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable;

            DELETE FROM jobs WHERE app_id = p_app_id;
            GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;

            DELETE FROM job_dlq WHERE app_id = p_app_id;
            GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;

            DELETE FROM assets WHERE app_id = p_app_id;
            GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;

            IF _user_ids IS NOT NULL THEN
                DELETE FROM webauthn_credentials WHERE user_id = ANY(_user_ids);
                GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;

                DELETE FROM mfa_secrets WHERE user_id = ANY(_user_ids);
                GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;

                DELETE FROM oauth_accounts WHERE user_id = ANY(_user_ids);
                GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;

                DELETE FROM api_keys WHERE user_id = ANY(_user_ids);
                GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;
            END IF;

            DELETE FROM sessions WHERE app_id = p_app_id;
            GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;

            DELETE FROM permissions WHERE app_id = p_app_id;
            GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;

            DELETE FROM users WHERE app_id = p_app_id;
            GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;

            DELETE FROM apps WHERE id = p_app_id;
            GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;

            RETURN _total::int;
        END
        $$
    `;
    yield* sql`COMMENT ON FUNCTION purge_tenant_cascade IS 'Cascade-delete all tenant data and the app record — returns total deleted rows'`;
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION count_event_outbox()
        RETURNS INT
        LANGUAGE sql
        STABLE
        PARALLEL SAFE
        AS $$
            SELECT COUNT(*)::int
            FROM effect_event_remotes
        $$;
        COMMENT ON FUNCTION count_event_outbox IS 'Count pending event remotes for outbox-depth monitoring';

        CREATE OR REPLACE FUNCTION get_event_journal_entry_by_primary_key(p_primary_key TEXT)
        RETURNS TABLE(payload TEXT)
        LANGUAGE sql
        STABLE
        PARALLEL SAFE
        AS $$
            SELECT convert_from(effect_event_journal.payload, 'UTF8') AS payload
            FROM effect_event_journal
            WHERE effect_event_journal.primary_key = p_primary_key
            LIMIT 1
        $$;
        COMMENT ON FUNCTION get_event_journal_entry_by_primary_key IS 'Fetch one event journal payload by primary_key for LISTEN/NOTIFY bridge hydration';

        CREATE OR REPLACE FUNCTION list_event_journal_entries(
            p_since_sequence_id TEXT DEFAULT '0',
            p_since_timestamp BIGINT DEFAULT NULL,
            p_event_type TEXT DEFAULT NULL,
            p_limit INT DEFAULT 500
        )
        RETURNS TABLE(payload TEXT, primary_key TEXT)
        LANGUAGE sql
        STABLE
        PARALLEL SAFE
        AS $$
            SELECT convert_from(effect_event_journal.payload, 'UTF8') AS payload, effect_event_journal.primary_key
            FROM effect_event_journal
            WHERE effect_event_journal.primary_key ~ '^[0-9]+$'
              AND effect_event_journal.primary_key::bigint > p_since_sequence_id::bigint
              AND (p_since_timestamp IS NULL OR effect_event_journal.timestamp >= p_since_timestamp)
              AND (p_event_type IS NULL OR effect_event_journal.event = p_event_type)
            ORDER BY effect_event_journal.primary_key::bigint ASC
            LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000)
        $$;
        COMMENT ON FUNCTION list_event_journal_entries IS 'Replay event journal in sequence order with optional timestamp/event filters and bounded limit';

        CREATE OR REPLACE FUNCTION get_db_io_config()
        RETURNS TABLE(name TEXT, setting TEXT)
        LANGUAGE sql
        STABLE
        PARALLEL SAFE
        AS $$
            SELECT name, setting
            FROM pg_settings
            WHERE name IN ('io_method', 'io_workers', 'effective_io_concurrency', 'io_combine_limit')
        $$;
        COMMENT ON FUNCTION get_db_io_config IS 'Expose PostgreSQL Async I/O configuration for admin and polling endpoints';

        CREATE OR REPLACE FUNCTION get_db_cache_hit_ratio()
        RETURNS TABLE(
            backend_type TEXT,
            io_object TEXT,
            io_context TEXT,
            hits DOUBLE PRECISION,
            reads DOUBLE PRECISION,
            writes DOUBLE PRECISION,
            cache_hit_ratio DOUBLE PRECISION
        )
        LANGUAGE sql
        STABLE
        PARALLEL SAFE
        AS $$
	            SELECT backend_type, object AS io_object, context AS io_context,
	                SUM(hits)::double precision AS hits,
	                SUM(reads)::double precision AS reads,
	                SUM(writes)::double precision AS writes,
	                CASE
	                    WHEN SUM(hits) + SUM(reads) > 0
	                        THEN (SUM(hits)::double precision / (SUM(hits)::double precision + SUM(reads)::double precision) * 100)
                    ELSE 0
                END AS cache_hit_ratio
            FROM pg_stat_io
            WHERE object = 'relation' AND context = 'normal'
            GROUP BY backend_type, object, context
        $$;
        COMMENT ON FUNCTION get_db_cache_hit_ratio IS 'Aggregate pg_stat_io relation cache hit ratio by backend type/context';

        CREATE OR REPLACE FUNCTION get_db_io_stats()
        RETURNS TABLE(
            backend_type TEXT,
            io_object TEXT,
            io_context TEXT,
            reads BIGINT,
            read_time DOUBLE PRECISION,
            writes BIGINT,
            write_time DOUBLE PRECISION,
            writebacks BIGINT,
            writeback_time DOUBLE PRECISION,
            extends BIGINT,
            extend_time DOUBLE PRECISION,
            hits BIGINT,
            evictions BIGINT,
            reuses BIGINT,
            fsyncs BIGINT,
            fsync_time DOUBLE PRECISION,
            stats_reset TIMESTAMPTZ
        )
        LANGUAGE sql
        STABLE
        PARALLEL SAFE
        AS $$
            SELECT backend_type, object AS io_object, context AS io_context,
                reads, read_time, writes, write_time, writebacks, writeback_time,
                extends, extend_time, hits, evictions, reuses, fsyncs, fsync_time, stats_reset
            FROM pg_stat_io
        $$;
        COMMENT ON FUNCTION get_db_io_stats IS 'Expose raw pg_stat_io counters and timings for admin diagnostics';

        CREATE OR REPLACE FUNCTION list_stat_statements_json(p_limit INT DEFAULT 100)
        RETURNS JSONB
        LANGUAGE plpgsql
        STABLE
        AS $$
        DECLARE
            safe_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') THEN
                RETURN COALESCE((
                    SELECT jsonb_agg(to_jsonb(stats))
                    FROM (
                        SELECT *
                        FROM pg_stat_statements
                        ORDER BY total_exec_time DESC
                        LIMIT safe_limit
                    ) stats
                ), '[]'::jsonb);
            END IF;
            RETURN '[]'::jsonb;
        END
        $$;
        COMMENT ON FUNCTION list_stat_statements_json IS 'Return pg_stat_statements rows as JSONB with limit clamped to [1,500], or [] when extension is unavailable';
    `);
    yield* sql`
        CREATE OR REPLACE FUNCTION delete_kv_by_prefix(p_prefix TEXT)
        RETURNS INT
        LANGUAGE sql
        VOLATILE
        AS $$
            WITH deleted AS (
                DELETE FROM kv_store
                WHERE starts_with(key, p_prefix)
                RETURNING 1
            )
            SELECT COUNT(*)::int FROM deleted
        $$
    `;
    yield* sql`COMMENT ON FUNCTION delete_kv_by_prefix IS 'Hard-delete kv_store entries by key prefix pattern'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // IP-BASED FUNCTIONS: Abuse detection and session management
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE OR REPLACE FUNCTION revoke_sessions_by_ip(p_app_id UUID, p_ip INET)
        RETURNS INT
        LANGUAGE sql
        VOLATILE
        AS $$
            WITH revoked AS (
                UPDATE sessions
                SET deleted_at = NOW()
                WHERE app_id = p_app_id
                  AND ip_address = p_ip
                  AND deleted_at IS NULL
                RETURNING 1
            )
            SELECT COUNT(*)::int FROM revoked
        $$
    `;
    yield* sql`COMMENT ON FUNCTION revoke_sessions_by_ip IS 'Tenant-safe session revocation by IP: soft-deletes only current app rows and updates updated_at.'`;
    yield* sql`
        CREATE OR REPLACE FUNCTION count_audit_by_ip(p_app_id UUID, p_ip INET, p_window_minutes INT DEFAULT 60)
        RETURNS INT
        LANGUAGE sql
        STABLE
        PARALLEL SAFE
        AS $$
            SELECT COUNT(*)::int
            FROM audit_logs
            WHERE app_id = p_app_id
              AND context_ip = p_ip
              AND uuid_extract_timestamp(id) > NOW() - make_interval(mins => p_window_minutes)
        $$
    `;
    yield* sql`COMMENT ON FUNCTION count_audit_by_ip IS 'Count audit events from IP in time window (abuse detection)'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // SEARCH: Hybrid FTS + trigram + embeddings + fuzzystrmatch
    // pgvector 0.8+: Enable hnsw.iterative_scan = 'relaxed_order' for filtered queries
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION normalize_search_text(
            p_display_text text,
            p_content_text text DEFAULT NULL,
            p_metadata jsonb DEFAULT NULL
        )
        RETURNS text
        LANGUAGE sql
        STABLE
        PARALLEL SAFE
        AS $$
            SELECT trim(regexp_replace(
                casefold(unaccent(concat_ws(' ',
                    NULLIF(p_display_text, ''),
                    NULLIF(p_content_text, ''),
                    NULLIF((SELECT string_agg(value, ' ') FROM jsonb_each_text(coalesce(p_metadata, '{}'::jsonb))), '')
                ))),
                '\s+',
                ' ',
                'g'
            ))
        $$
    `);
    yield* sql`COMMENT ON FUNCTION normalize_search_text(text, text, jsonb) IS 'Canonical search text normalizer used by index write paths and query-side matching'`;
    yield* sql`CREATE TEXT SEARCH CONFIGURATION parametric_search (COPY = english)`;
    yield* sql`
        ALTER TEXT SEARCH CONFIGURATION parametric_search
        ALTER MAPPING FOR hword, hword_part, word
        WITH unaccent, english_stem
    `;
    yield* sql`COMMENT ON TEXT SEARCH CONFIGURATION parametric_search IS 'FTS config with unaccent normalization'`;
    yield* sql`
        CREATE TABLE search_documents (
            entity_type TEXT NOT NULL,
            entity_id UUID NOT NULL,
            scope_id UUID,
            display_text TEXT NOT NULL,
            content_text TEXT,
            metadata JSONB,
            normalized_text TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            document_hash TEXT GENERATED ALWAYS AS (
                to_hex(crc32c(coalesce(display_text, '') || E'\x1F' || coalesce(content_text, '') || E'\x1F' || coalesce(metadata::text, '')))
            ) STORED,
            search_vector TSVECTOR GENERATED ALWAYS AS (
                setweight(to_tsvector('parametric_search', coalesce(display_text, '')), 'A') ||
                setweight(to_tsvector('parametric_search', coalesce(content_text, '')), 'C') ||
                setweight(jsonb_to_tsvector('parametric_search', coalesce(metadata, '{}'::jsonb), '["string","numeric","boolean"]'), 'D')
            ) STORED,
            CONSTRAINT search_documents_pk PRIMARY KEY (entity_type, entity_id)
        )
    `;
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE search_documents IS 'Unified search index — use entity_id (UUIDv7) for creation time via uuid_extract_timestamp()';
		COMMENT ON COLUMN search_documents.normalized_text IS 'Canonical term-matching text built via normalize_search_text() for trigram/fuzzy ranking';
	`);
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
            CONSTRAINT search_embeddings_dimensions_positive CHECK (dimensions > 0),
            CONSTRAINT search_embeddings_fk FOREIGN KEY (entity_type, entity_id)
                REFERENCES search_documents(entity_type, entity_id) ON DELETE CASCADE
        )
    `;
    yield* sql.unsafe(String.raw`
		COMMENT ON TABLE search_embeddings IS 'Vector embeddings — use entity_id (UUIDv7) for creation time; configure hnsw.iterative_scan for filtered queries';
		COMMENT ON COLUMN search_embeddings.embedding IS 'Max-dimension vectors (3072); actual dimensions stored in dimensions, model in model';
	`);
    yield* sql`CREATE INDEX idx_search_documents_vector ON search_documents USING GIN (search_vector) WITH (parallel_workers = 4)`;
    yield* sql`CREATE INDEX idx_search_documents_scope ON search_documents (scope_id, entity_type)`;
    yield* sql`CREATE INDEX idx_search_documents_scope_entity_trgm ON search_documents USING GIN (scope_id uuid_ops, entity_type text_ops, normalized_text gin_trgm_ops) WITH (parallel_workers = 4)`;
    yield* sql`CREATE INDEX idx_search_embeddings_scope ON search_embeddings (scope_id, entity_type, model, dimensions)`;
    yield* sql`CREATE INDEX idx_search_embeddings_embedding ON search_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 24, ef_construction = 200)`;
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION _upsert_search_doc(
            p_entity_type TEXT, p_entity_id UUID, p_scope_id UUID,
            p_display TEXT, p_content TEXT, p_metadata JSONB
        ) RETURNS void LANGUAGE sql AS $$
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
            VALUES (p_entity_type, p_entity_id, p_scope_id, p_display, p_content, p_metadata,
                    normalize_search_text(p_display, p_content, p_metadata))
            ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                scope_id = EXCLUDED.scope_id,
                display_text = EXCLUDED.display_text,
                content_text = EXCLUDED.content_text,
                metadata = EXCLUDED.metadata,
                normalized_text = EXCLUDED.normalized_text
        $$
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION _delete_search_doc(p_entity_type TEXT, p_entity_id UUID)
        RETURNS void LANGUAGE sql AS $$
            DELETE FROM search_documents WHERE entity_type = p_entity_type AND entity_id = p_entity_id
        $$
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION upsert_search_document_app()
        RETURNS TRIGGER AS $$
        DECLARE
            _metadata jsonb := jsonb_build_object('name', NEW.name, 'namespace', NEW.namespace);
        BEGIN
            PERFORM _upsert_search_doc('app', NEW.id, NULL, NEW.name, NEW.namespace, _metadata);
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION upsert_search_document_user()
        RETURNS TRIGGER AS $$
        DECLARE
            _metadata jsonb := jsonb_build_object('email', NEW.email, 'role', NEW.role);
        BEGIN
            PERFORM _upsert_search_doc('user', NEW.id, NEW.app_id, NEW.email, NEW.role::text, _metadata);
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION delete_search_document_user()
        RETURNS TRIGGER AS $$
        BEGIN
            PERFORM _delete_search_doc('user', OLD.id);
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION upsert_search_document_asset()
        RETURNS TRIGGER AS $$
        DECLARE
            _display text := COALESCE(NEW.name, NEW.type);
            _metadata jsonb := jsonb_strip_nulls(jsonb_build_object('type', NEW.type, 'size', NEW.size, 'name', NEW.name, 'hash', NEW.hash), true);
        BEGIN
            PERFORM _upsert_search_doc('asset', NEW.id, NEW.app_id, _display, NEW.content, _metadata);
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION delete_search_document_asset()
        RETURNS TRIGGER AS $$
        BEGIN
            PERFORM _delete_search_doc('asset', OLD.id);
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION insert_search_document_audit()
        RETURNS TRIGGER AS $$
        DECLARE
            _target_type text := NEW.target_type;
            _display text := _target_type || ':' || NEW.operation::text;
            _content text := _target_type || ' ' || NEW.operation::text;
            _metadata jsonb := jsonb_strip_nulls(jsonb_build_object(
                'targetType', _target_type,
                'operation', NEW.operation,
                'userId', NEW.user_id,
                'hasDelta', NEW.delta IS NOT NULL
            ), true);
        BEGIN
            PERFORM _upsert_search_doc('auditLog', NEW.id, NEW.app_id, _display, _content, _metadata);
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
            -- Delete existing documents based on scope
            IF p_scope_id IS NULL THEN
                DELETE FROM search_documents;
            ELSE
                DELETE FROM search_documents WHERE scope_id = p_scope_id;
                IF p_include_global THEN
                    DELETE FROM search_documents WHERE scope_id IS NULL;
                END IF;
            END IF;

            -- Apps (global scope, included when p_scope_id IS NULL or p_include_global)
            IF p_scope_id IS NULL OR p_include_global THEN
                INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
                SELECT 'app', src.id, NULL, d.display, d.content, d.meta,
                       normalize_search_text(d.display, d.content, d.meta)
                FROM apps src,
                LATERAL (SELECT
                    src.name AS display,
                    src.namespace AS content,
                    jsonb_build_object('name', src.name, 'namespace', src.namespace) AS meta
                ) d;
            END IF;

            -- Users
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
            SELECT 'user', src.id, src.app_id, d.display, d.content, d.meta,
                   normalize_search_text(d.display, d.content, d.meta)
            FROM users src,
            LATERAL (SELECT
                src.email AS display,
                src.role::text AS content,
                jsonb_build_object('email', src.email, 'role', src.role) AS meta
            ) d
            WHERE src.deleted_at IS NULL
              AND (p_scope_id IS NULL OR src.app_id = p_scope_id);

            -- Assets
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
            SELECT 'asset', src.id, src.app_id, d.display, d.content, d.meta,
                   normalize_search_text(d.display, d.content, d.meta)
            FROM assets src,
            LATERAL (SELECT
                COALESCE(src.name, src.type) AS display,
                src.content AS content,
                jsonb_strip_nulls(jsonb_build_object('type', src.type, 'size', src.size, 'name', src.name, 'hash', src.hash), true) AS meta
            ) d
            WHERE src.deleted_at IS NULL
              AND (p_scope_id IS NULL OR src.app_id = p_scope_id);

            -- Audit logs (uses normalized target_type column)
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
            SELECT 'auditLog', src.id, src.app_id, d.display, d.content, d.meta,
                   normalize_search_text(d.display, d.content, d.meta)
            FROM audit_logs src,
            LATERAL (SELECT
                src.target_type || ':' || src.operation::text AS display,
                src.target_type || ' ' || src.operation::text AS content,
                jsonb_strip_nulls(jsonb_build_object(
                    'targetType', src.target_type,
                    'operation', src.operation,
                    'userId', src.user_id,
                    'hasDelta', src.delta IS NOT NULL
                ), true) AS meta
            ) d
            WHERE p_scope_id IS NULL OR src.app_id = p_scope_id;

            ANALYZE search_documents;
        END
        $$
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION notify_search_refresh()
        RETURNS void
        LANGUAGE sql
        SECURITY INVOKER
        AS $$
            SELECT pg_notify('search_refresh', json_build_object(
                'timestamp', extract(epoch from now()),
                'event', 'refresh_complete'
            )::text)
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
            WHERE word LIKE (regexp_replace(unaccent(casefold(p_prefix)), '([%_\\])', '\\\\\1', 'g') || '%') ESCAPE '\'
            ORDER BY ndoc DESC
            LIMIT LEAST(COALESCE(p_limit, 20), 100)
        $$
    `);
    yield* sql`SELECT refresh_search_documents()`;
    // ═══════════════════════════════════════════════════════════════════════════
    // PERMISSIONS SEED: default and system tenants
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql.unsafe(String.raw`
        WITH tenants(app_id) AS (
            VALUES
                ('00000000-0000-7000-8000-000000000001'::uuid),
                ('00000000-0000-7000-8000-000000000000'::uuid)
        ),
        all_roles(role) AS (
            VALUES ('owner'), ('admin'), ('member'), ('viewer'), ('guest')
        ),
        all_actions(resource, action) AS (
            VALUES
                ('auth', 'logout'),
                ('auth', 'me'),
                ('auth', 'mfaStatus'),
                ('auth', 'mfaEnroll'),
                ('auth', 'mfaVerify'),
                ('auth', 'mfaDisable'),
                ('auth', 'mfaRecover'),
                ('auth', 'listApiKeys'),
                ('auth', 'createApiKey'),
                ('auth', 'deleteApiKey'),
                ('auth', 'rotateApiKey'),
                ('auth', 'linkProvider'),
                ('auth', 'unlinkProvider'),
                ('users', 'getMe'),
                ('users', 'updateProfile'),
                ('users', 'deactivate'),
                ('users', 'getNotificationPreferences'),
                ('users', 'updateNotificationPreferences'),
                ('users', 'listNotifications'),
                ('users', 'subscribeNotifications'),
                ('audit', 'getMine'),
                ('transfer', 'export'),
                ('transfer', 'import'),
                ('search', 'search'),
                ('search', 'suggest'),
                ('jobs', 'subscribe'),
                ('storage', 'sign'),
                ('storage', 'exists'),
                ('storage', 'remove'),
                ('storage', 'upload'),
                ('storage', 'getAsset'),
                ('storage', 'createAsset'),
                ('storage', 'updateAsset'),
                ('storage', 'archiveAsset'),
                ('storage', 'listAssets'),
                ('websocket', 'connect')
        ),
        privileged_roles(role) AS (
            VALUES ('owner'), ('admin')
        ),
        privileged_actions(resource, action) AS (
            VALUES
                ('users', 'updateRole'),
                ('audit', 'getByEntity'),
                ('audit', 'getByUser'),
                ('search', 'refresh'),
                ('search', 'refreshEmbeddings'),
                ('webhooks', 'list'),
                ('webhooks', 'register'),
                ('webhooks', 'remove'),
                ('webhooks', 'test'),
                ('webhooks', 'retry'),
                ('webhooks', 'status'),
                ('admin', 'listUsers'),
                ('admin', 'listSessions'),
                ('admin', 'deleteSession'),
                ('admin', 'revokeSessionsByIp'),
                ('admin', 'listJobs'),
                ('admin', 'cancelJob'),
                ('admin', 'listDlq'),
                ('admin', 'replayDlq'),
                ('admin', 'listNotifications'),
                ('admin', 'replayNotification'),
                ('admin', 'events'),
                ('admin', 'dbIoStats'),
                ('admin', 'dbIoConfig'),
                ('admin', 'dbStatements'),
                ('admin', 'dbCacheHitRatio'),
                ('admin', 'listTenants'),
                ('admin', 'createTenant'),
                ('admin', 'getTenant'),
                ('admin', 'updateTenant'),
                ('admin', 'deactivateTenant'),
                ('admin', 'resumeTenant'),
                ('admin', 'getTenantOAuth'),
                ('admin', 'updateTenantOAuth'),
                ('admin', 'listPermissions'),
                ('admin', 'grantPermission'),
                ('admin', 'revokePermission'),
                ('admin', 'getFeatureFlags'),
                ('admin', 'setFeatureFlag')
        ),
        seed(app_id, role, resource, action) AS (
            SELECT tenants.app_id, all_roles.role, all_actions.resource, all_actions.action
            FROM tenants
            CROSS JOIN all_roles
            CROSS JOIN all_actions
            UNION ALL
            SELECT tenants.app_id, privileged_roles.role, privileged_actions.resource, privileged_actions.action
            FROM tenants
            CROSS JOIN privileged_roles
            CROSS JOIN privileged_actions
        )
        INSERT INTO permissions (app_id, role, resource, action)
        SELECT app_id, role, resource, action
        FROM seed
        ON CONFLICT (app_id, role, resource, action) DO NOTHING
    `);
    // ═══════════════════════════════════════════════════════════════════════════
    // RLS: Row-Level Security for multi-tenant isolation
    // ═══════════════════════════════════════════════════════════════════════════
    // Custom GUC for tenant context (set via SET LOCAL in transactions)
    yield* sql`SELECT set_config('app.current_tenant', '00000000-0000-7000-8000-000000000001', false)`;
    // Enable + Force RLS on all tenant-scoped tables
    yield* sql.unsafe(String.raw`
        DO $$
        DECLARE
            _tbl text;
        BEGIN
            FOR _tbl IN SELECT unnest(ARRAY[
                'users', 'permissions', 'sessions', 'api_keys', 'oauth_accounts',
                'mfa_secrets', 'webauthn_credentials', 'assets', 'audit_logs',
                'jobs', 'notifications', 'job_dlq', 'search_documents', 'search_embeddings'
            ]) LOOP
                EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', _tbl);
                EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', _tbl);
            END LOOP;
        END
        $$
    `);
    // RLS Policies: app_id-scoped (8 tables)
    yield* sql.unsafe(String.raw`
        DO $$
        DECLARE _tbl text;
        BEGIN
            FOR _tbl IN SELECT unnest(ARRAY[
                'users', 'permissions', 'sessions', 'assets',
                'audit_logs', 'jobs', 'notifications', 'job_dlq'
            ]) LOOP
                EXECUTE format(
                    'CREATE POLICY %I ON %I USING (app_id = get_current_tenant_id()) WITH CHECK (app_id = get_current_tenant_id())',
                    _tbl || '_tenant_isolation', _tbl
                );
            END LOOP;
        END
        $$
    `);
    // RLS Policies: user_id-scoped via SECURITY DEFINER helper (4 tables)
    yield* sql.unsafe(String.raw`
        DO $$
        DECLARE _tbl text;
        BEGIN
            FOR _tbl IN SELECT unnest(ARRAY[
                'api_keys', 'oauth_accounts', 'mfa_secrets', 'webauthn_credentials'
            ]) LOOP
                EXECUTE format(
                    'CREATE POLICY %I ON %I USING (user_id IN (SELECT get_tenant_user_ids())) WITH CHECK (user_id IN (SELECT get_tenant_user_ids()))',
                    _tbl || '_tenant_isolation', _tbl
                );
            END LOOP;
        END
        $$
    `);
    // RLS Policies: scope_id-scoped (NULL = global visibility)
    yield* sql`CREATE POLICY search_documents_tenant_isolation ON search_documents USING (scope_id IS NULL OR scope_id = get_current_tenant_id()) WITH CHECK (scope_id IS NULL OR scope_id = get_current_tenant_id())`;
    yield* sql`CREATE POLICY search_embeddings_tenant_isolation ON search_embeddings USING (scope_id IS NULL OR scope_id = get_current_tenant_id()) WITH CHECK (scope_id IS NULL OR scope_id = get_current_tenant_id())`;
    // Policy comments (consolidated)
    yield* sql.unsafe(String.raw`
        DO $$
        DECLARE
            _tbl text;
        BEGIN
            -- app_id-scoped tables
            FOR _tbl IN SELECT unnest(ARRAY[
                'users', 'permissions', 'sessions', 'assets',
                'audit_logs', 'jobs', 'notifications', 'job_dlq'
            ]) LOOP
                EXECUTE format(
                    'COMMENT ON POLICY %I ON %I IS %L',
                    _tbl || '_tenant_isolation', _tbl,
                    'RLS: Isolate ' || _tbl || ' by app_id matching get_current_tenant_id()'
                );
            END LOOP;
            -- user_id-scoped tables (SECURITY DEFINER helper)
            FOR _tbl IN SELECT unnest(ARRAY[
                'api_keys', 'oauth_accounts', 'mfa_secrets', 'webauthn_credentials'
            ]) LOOP
                EXECUTE format(
                    'COMMENT ON POLICY %I ON %I IS %L',
                    _tbl || '_tenant_isolation', _tbl,
                    'RLS: Isolate ' || _tbl || ' by user_id via get_tenant_user_ids() (SECURITY DEFINER, avoids chained RLS)'
                );
            END LOOP;
            -- scope_id-scoped tables (NULL = global visibility)
            FOR _tbl IN SELECT unnest(ARRAY[
                'search_documents', 'search_embeddings'
            ]) LOOP
                EXECUTE format(
                    'COMMENT ON POLICY %I ON %I IS %L',
                    _tbl || '_tenant_isolation', _tbl,
                    'RLS: Isolate ' || _tbl || ' by scope_id matching get_current_tenant_id() (NULL scope_id = global visibility)'
                );
            END LOOP;
        END
        $$
    `);
});
