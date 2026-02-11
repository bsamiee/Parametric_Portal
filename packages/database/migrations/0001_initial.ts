/**
 * PostgreSQL 18.1 aligned features and extensions (18.1 released 2025-11-13):
 * ┌───────────────────────────────────────────────────────────────────────────────┐
 * │ uuidv7()              │ NATIVE time-ordered IDs (no extension, k-sortable)    │
 * │ uuid_extract_timestamp│ Extract creation time from UUIDv7 (NO created_at)     │
 * │ RETURNING OLD/NEW     │ Capture before/after values in single DML statement   │
 * │ NULLS NOT DISTINCT    │ Proper NULL handling in unique constraints            │
 * │ Covering (INCLUDE)    │ Index-only scans eliminate heap fetches               │
 * │ BRIN indexes          │ Ultra-compact for time-range scans on audit logs      │
 * │ Parallel GIN          │ Concurrent JSONB index builds                         │
 * │ B-tree skip scan      │ Multi-column indexes usable when leading cols omitted │
 * │ Partial indexes       │ Only index active/non-deleted records                 │
 * │ STORED generated      │ Precomputed columns for search hash/vector + asset size│
 * │ VIRTUAL generated     │ Computed on read for lightweight derived counters      │
 * │ Immutability          │ DB-enforced append-only audit_logs via trigger        │
 * └───────────────────────────────────────────────────────────────────────────────┘
 * EXTENSIONS + COLLATION REQUIRED (CREATE EXTENSION IF NOT EXISTS):
 * - ICU case-insensitive collation (TEXT + nondeterministic ICU collation for apps.namespace, users.email)
 * - pg_trgm (trigram similarity for fuzzy search)
 * - btree_gin (multi-column GIN with scalar + trigram operator classes)
 * - fuzzystrmatch (levenshtein/soundex fuzzy matchers)
 * - unaccent (diacritic normalization for FTS/similarity)
 * - pgcrypto (cryptographic digest for deterministic SHA-256 document hashes)
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
    // EXTENSIONS: pgcrypto + pg_trgm + btree_gin + fuzzystrmatch + unaccent + vector + pg_stat_statements + pgaudit
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS btree_gin`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS fuzzystrmatch`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS unaccent`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS vector`;
    yield* sql.unsafe(String.raw`
	        DO $$
	        BEGIN
	            CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
	        EXCEPTION
	            WHEN OTHERS THEN
                        RAISE WARNING 'pg_stat_statements unavailable (extension install only; shared_preload_libraries and compute_query_id must also be configured): %', SQLERRM;
	        END;
	        $$;
	    `);
    yield* sql.unsafe(String.raw`
	        DO $$
	        BEGIN
	            CREATE EXTENSION IF NOT EXISTS pgaudit;
	        EXCEPTION
	            WHEN OTHERS THEN
                        RAISE WARNING 'pgaudit unavailable (extension install only; shared_preload_libraries must include pgaudit): %', SQLERRM;
	        END;
	        $$;
	    `);
    yield* sql`COMMENT ON EXTENSION pgcrypto IS 'pgcrypto: SHA-256 digest support for generated document hashes and integrity checks'`;
    yield* sql`COMMENT ON EXTENSION pg_trgm IS 'pg_trgm: trigram similarity for fuzzy search'`;
    yield* sql`COMMENT ON EXTENSION btree_gin IS 'btree_gin: scalar operator classes for multi-column GIN indexes with pg_trgm'`;
    yield* sql`COMMENT ON EXTENSION fuzzystrmatch IS 'fuzzystrmatch: levenshtein/soundex matchers for fuzzy search'`;
    yield* sql`COMMENT ON EXTENSION unaccent IS 'unaccent: Unicode diacritic normalization for search'`;
    yield* sql`COMMENT ON EXTENSION vector IS 'pgvector 0.8+: vector similarity search with HNSW iterative scan support'`;
    yield* sql.unsafe(String.raw`
	        DO $$
	        BEGIN
	            IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') THEN
                COMMENT ON EXTENSION pg_stat_statements IS 'pg_stat_statements: SQL statement performance statistics (requires shared_preload_libraries + compute_query_id)';
	            END IF;
	        END;
	        $$;
	    `);
    yield* sql.unsafe(String.raw`
	        DO $$
	        BEGIN
	            IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgaudit') THEN
                COMMENT ON EXTENSION pgaudit IS 'pgaudit: compliance audit logging for SOC2/HIPAA/PCI-DSS (requires shared_preload_libraries)';
	            END IF;
	        END;
	        $$;
	    `);
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
            SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid
        $$
    `;
    yield* sql`COMMENT ON FUNCTION get_current_tenant_id() IS 'Returns current tenant ID from app.current_tenant GUC with null-safe default-deny semantics. Used by RLS policies with STABLE caching.'`;
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
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT apps_name_not_empty CHECK (length(trim(name)) > 0),
            CONSTRAINT apps_namespace_not_empty CHECK (length(trim(namespace)) > 0),
            CONSTRAINT apps_settings_shape CHECK (
                settings IS NULL OR (
                    jsonb_typeof(settings) = 'object'
                    AND jsonb_typeof(COALESCE(settings->'featureFlags', '{}'::jsonb)) = 'object'
                    AND jsonb_typeof(COALESCE(settings->'oauthProviders', '[]'::jsonb)) = 'array'
                    AND jsonb_typeof(COALESCE(settings->'webhooks', '[]'::jsonb)) = 'array'
                    AND (settings - ARRAY['featureFlags', 'oauthProviders', 'webhooks']) = '{}'::jsonb
                )
            )
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
            notification_preferences JSONB NOT NULL DEFAULT jsonb_build_object(
                'channels', jsonb_build_object('email', true, 'webhook', true, 'inApp', true),
                'templates', '{}'::jsonb,
                'mutedUntil', NULL
            ),
            role TEXT NOT NULL,
            status TEXT NOT NULL,
            deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            role_order INTEGER GENERATED ALWAYS AS (
                CASE role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'member' THEN 2 WHEN 'viewer' THEN 1 WHEN 'guest' THEN 0 ELSE -1 END
            ) VIRTUAL,
            CONSTRAINT users_role_valid CHECK (role IN ('owner', 'admin', 'member', 'viewer', 'guest')),
            CONSTRAINT users_status_valid CHECK (status IN ('active', 'inactive', 'suspended'))
        )
    `;
    yield* sql`COMMENT ON TABLE users IS 'User accounts — NEVER hard-delete; use uuid_extract_timestamp(id) for creation time'`;
    yield* sql`COMMENT ON COLUMN users.deleted_at IS 'Soft-delete timestamp — NULL means active; set enables email re-registration'`;
    yield* sql`COMMENT ON COLUMN users.email IS 'Format validated at app layer; ICU nondeterministic collation enforces case-insensitive uniqueness among active users'`;
    yield* sql`COMMENT ON COLUMN users.notification_preferences IS 'Per-user notification preferences: channel toggles, template overrides, mute window'`;
    yield* sql`COMMENT ON COLUMN users.role_order IS 'VIRTUAL generated — permission hierarchy (owner=4, admin=3, member=2, viewer=1, guest=0)'`;
    yield* sql`CREATE UNIQUE INDEX idx_users_app_email_active ON users(app_id, email) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_users_app_email ON users(app_id, email) INCLUDE (id, role) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_users_app_id ON users(app_id) INCLUDE (id, email, role) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_users_app_id_fk ON users(app_id)`;
    yield* sql`CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    // ═══════════════════════════════════════════════════════════════════════════
    // PERMISSIONS: Tenant-scoped resource-action authorization matrix
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE permissions (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            role TEXT NOT NULL,
            resource TEXT NOT NULL,
            action TEXT NOT NULL,
            deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT permissions_role_valid CHECK (role IN ('owner', 'admin', 'member', 'viewer', 'guest')),
            CONSTRAINT permissions_resource_not_empty CHECK (length(trim(resource)) > 0),
            CONSTRAINT permissions_action_not_empty CHECK (length(trim(action)) > 0),
            CONSTRAINT permissions_unique UNIQUE NULLS NOT DISTINCT (app_id, role, resource, action)
        )
    `;
    yield* sql`COMMENT ON TABLE permissions IS 'Tenant-scoped authorization matrix (role × resource × action)'`;
    yield* sql`COMMENT ON COLUMN permissions.deleted_at IS 'Soft-delete timestamp — NULL means active permission'`;
    yield* sql`CREATE INDEX idx_permissions_app_role_active ON permissions(app_id, role) INCLUDE (resource, action) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_permissions_app_id_fk ON permissions(app_id)`;
    yield* sql`CREATE TRIGGER permissions_updated_at BEFORE UPDATE ON permissions FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
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
            CONSTRAINT oauth_provider_external_unique UNIQUE NULLS NOT DISTINCT (provider, external_id),
            CONSTRAINT oauth_provider_valid CHECK (provider IN ('apple', 'github', 'google', 'microsoft'))
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
            CONSTRAINT assets_status_valid CHECK (status IN ('active', 'processing', 'failed', 'deleted')),
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
                'create', 'update', 'delete', 'read', 'list', 'status',
                'login', 'refresh', 'revoke', 'revokeByIp',
                'verify', 'verifyMfa', 'register', 'enroll', 'disable',
                'sign', 'upload', 'stream_upload', 'copy', 'remove', 'abort_multipart',
                'export', 'import', 'validate',
                'cancel', 'replay',
                'auth_failure', 'permission_denied',
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
    // WEBAUTHN_CREDENTIALS: Passkey credentials (user-scoped, soft-delete)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE webauthn_credentials (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            credential_id TEXT NOT NULL,
            public_key BYTEA NOT NULL,
            counter INTEGER NOT NULL DEFAULT 0,
            device_type TEXT NOT NULL,
            backed_up BOOLEAN NOT NULL DEFAULT false,
            transports TEXT[] NOT NULL DEFAULT '{}',
            name TEXT NOT NULL,
            last_used_at TIMESTAMPTZ,
            deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT webauthn_credentials_credential_id_unique UNIQUE NULLS NOT DISTINCT (credential_id),
            CONSTRAINT webauthn_credentials_counter_non_negative CHECK (counter >= 0),
            CONSTRAINT webauthn_credentials_device_type_valid CHECK (device_type IN ('singleDevice', 'multiDevice')),
            CONSTRAINT webauthn_credentials_name_not_empty CHECK (length(trim(name)) > 0),
            CONSTRAINT webauthn_credentials_transports_no_nulls CHECK (array_position(transports, NULL) IS NULL)
        )
    `;
    yield* sql`COMMENT ON TABLE webauthn_credentials IS 'WebAuthn passkeys — use uuid_extract_timestamp(id) for creation time'`;
    yield* sql`COMMENT ON COLUMN webauthn_credentials.credential_id IS 'Base64url credential ID from authenticator; globally unique'`;
    yield* sql`COMMENT ON COLUMN webauthn_credentials.deleted_at IS 'Soft-delete timestamp — NULL means active'`;
    yield* sql`CREATE INDEX idx_webauthn_credentials_user_active ON webauthn_credentials(user_id) INCLUDE (credential_id, name, last_used_at, counter, device_type, backed_up) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_webauthn_credentials_credential_id_active ON webauthn_credentials(credential_id) INCLUDE (user_id, counter, public_key, transports, backed_up, device_type) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_webauthn_credentials_user_id_fk ON webauthn_credentials(user_id)`;
    yield* sql`CREATE TRIGGER webauthn_credentials_updated_at BEFORE UPDATE ON webauthn_credentials FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
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
            CONSTRAINT jobs_status_valid CHECK (status IN ('queued', 'processing', 'complete', 'failed', 'cancelled')),
            CONSTRAINT jobs_priority_valid CHECK (priority IN ('critical', 'high', 'normal', 'low')),
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
    yield* sql`CREATE UNIQUE INDEX idx_jobs_dedupe_active_unique ON jobs(app_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'processing')`;
    yield* sql`CREATE INDEX idx_jobs_batch ON jobs(batch_id) WHERE batch_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_jobs_app_id_fk ON jobs(app_id)`;
    yield* sql`CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    // ═══════════════════════════════════════════════════════════════════════════
    // NOTIFICATIONS: Durable channel delivery ledger (email/webhook/in-app)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE notifications (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
            channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook', 'inApp')),
            template TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'delivered', 'failed', 'dlq')),
            recipient TEXT,
            provider TEXT,
            payload JSONB NOT NULL,
            error TEXT,
            attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
            max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
            job_id TEXT,
            dedupe_key TEXT,
            delivered_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT notifications_template_not_empty CHECK (length(trim(template)) > 0)
        )
    `;
    yield* sql`COMMENT ON TABLE notifications IS 'Tenant-scoped notification ledger for email/webhook/in-app delivery lifecycle — use uuid_extract_timestamp(id) for creation time'`;
    yield* sql`COMMENT ON COLUMN notifications.user_id IS 'FK to users — RESTRICT (users never hard-deleted); NULL for system/broadcast notifications'`;
    yield* sql`COMMENT ON COLUMN notifications.job_id IS 'Snowflake job_id linking to jobs table — NO FK constraint (job may complete/purge before notification)'`;
    yield* sql`CREATE INDEX idx_notifications_app_status ON notifications(app_id, status, id DESC) INCLUDE (channel, template, attempts, max_attempts)`;
    yield* sql`CREATE INDEX idx_notifications_app_user ON notifications(app_id, user_id, id DESC) INCLUDE (channel, status, template) WHERE user_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_notifications_app_updated ON notifications(app_id, updated_at DESC) INCLUDE (channel, status, user_id)`;
    yield* sql`CREATE INDEX idx_notifications_job_id ON notifications(job_id) WHERE job_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_notifications_app_id_fk ON notifications(app_id)`;
    yield* sql`CREATE INDEX idx_notifications_user_id_fk ON notifications(user_id) WHERE user_id IS NOT NULL`;
    yield* sql`CREATE UNIQUE INDEX idx_notifications_dedupe_active ON notifications(app_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'sending')`;
    yield* sql`CREATE TRIGGER notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
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
    yield* sql`
	        COMMENT ON TABLE job_dlq IS 'Unified dead-letter queue for jobs and events — use uuid_extract_timestamp(id) for DLQ creation time; NO updated_at (append-mostly)'
	    `;
    yield* sql`
	        COMMENT ON COLUMN job_dlq.source IS 'Discriminant: job = background job, event = domain event from EventBus'
	    `;
    yield* sql`
	        COMMENT ON COLUMN job_dlq.original_job_id IS 'Reference to original job/event — snowflake string, NO FK constraint (source may be purged before replay)'
	    `;
    yield* sql`
	        COMMENT ON COLUMN job_dlq.payload IS 'Serialized failed payload; webhook DLQ entries persist endpoint snapshot + event data for deterministic replay even after settings drift'
	    `;
    yield* sql`
	        COMMENT ON COLUMN job_dlq.error_reason IS 'Failure classification discriminant for typed error handling — valid values depend on source'
	    `;
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
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION count_event_outbox()
        RETURNS INT
        LANGUAGE sql
        STABLE
        AS $$
            SELECT COUNT(*)::int
            FROM effect_event_remotes
        $$;
        COMMENT ON FUNCTION count_event_outbox IS 'Count pending event remotes for outbox-depth monitoring';

        CREATE OR REPLACE FUNCTION get_event_journal_entry_by_primary_key(p_primary_key TEXT)
        RETURNS TABLE(payload TEXT)
        LANGUAGE sql
        STABLE
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
        AS $$
            SELECT convert_from(effect_event_journal.payload, 'UTF8') AS payload, effect_event_journal.primary_key
            FROM effect_event_journal
            WHERE effect_event_journal.primary_key ~ '^[0-9]+$'
              AND effect_event_journal.primary_key::numeric > p_since_sequence_id::numeric
              AND (p_since_timestamp IS NULL OR effect_event_journal.timestamp >= p_since_timestamp)
              AND (p_event_type IS NULL OR effect_event_journal.event = p_event_type)
            ORDER BY effect_event_journal.primary_key::numeric ASC
            LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000)
        $$;
        COMMENT ON FUNCTION list_event_journal_entries IS 'Replay event journal in sequence order with optional timestamp/event filters and bounded limit';

        CREATE OR REPLACE FUNCTION get_db_io_config()
        RETURNS TABLE(name TEXT, setting TEXT)
        LANGUAGE sql
        STABLE
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
        AS $$
	            SELECT backend_type, object AS io_object, context AS io_context,
	                SUM(hits)::double precision AS hits,
	                SUM(reads)::double precision AS reads,
	                SUM(writes)::double precision AS writes,
	                CASE
	                    WHEN SUM(hits) + SUM(reads) > 0
	                        THEN (SUM(hits)::double precision / (SUM(hits) + SUM(reads)) * 100)
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
    // IP-BASED FUNCTIONS: Abuse detection and session management
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE OR REPLACE FUNCTION revoke_sessions_by_ip(p_app_id UUID, p_ip INET)
        RETURNS INT
        LANGUAGE sql
        AS $$
            WITH revoked AS (
                UPDATE sessions
                SET deleted_at = NOW(), updated_at = NOW()
                WHERE app_id = p_app_id
                  AND ip_address = p_ip
                  AND deleted_at IS NULL
                RETURNING id
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
                    coalesce(p_display_text, ''),
                    coalesce(p_content_text, ''),
                    coalesce(p_metadata::text, '')
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
    yield* sql`DROP MATERIALIZED VIEW IF EXISTS unified_search CASCADE`;
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
                encode(digest(coalesce(display_text, '') || ' ' || coalesce(content_text, '') || ' ' || coalesce(metadata::text, ''), 'sha256'), 'hex')
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
    yield* sql`COMMENT ON COLUMN search_documents.normalized_text IS 'Canonical term-matching text built via normalize_search_text() for trigram/fuzzy ranking'`;
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
    yield* sql`CREATE INDEX idx_search_documents_scope_entity_trgm ON search_documents USING GIN (scope_id uuid_ops, entity_type text_ops, normalized_text gin_trgm_ops)`;
    yield* sql`CREATE INDEX idx_search_embeddings_scope ON search_embeddings (scope_id, entity_type, model, dimensions)`;
    yield* sql`CREATE INDEX idx_search_embeddings_embedding ON search_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`;
    yield* sql`CREATE TRIGGER search_documents_updated_at BEFORE UPDATE ON search_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    yield* sql`CREATE TRIGGER search_embeddings_updated_at BEFORE UPDATE ON search_embeddings FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION upsert_search_document_app()
        RETURNS TRIGGER AS $$
        BEGIN
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
            VALUES (
                'app',
                NEW.id,
                NULL,
                NEW.name,
                NEW.namespace,
                jsonb_build_object('name', NEW.name, 'namespace', NEW.namespace),
                normalize_search_text(NEW.name, NEW.namespace, jsonb_build_object('name', NEW.name, 'namespace', NEW.namespace))
            )
            ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                display_text = EXCLUDED.display_text,
                content_text = EXCLUDED.content_text,
                metadata = EXCLUDED.metadata,
                normalized_text = EXCLUDED.normalized_text;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION upsert_search_document_user()
        RETURNS TRIGGER AS $$
        BEGIN
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
            VALUES (
                'user',
                NEW.id,
                NEW.app_id,
                NEW.email,
                NEW.role::text,
                jsonb_build_object('email', NEW.email, 'role', NEW.role),
                normalize_search_text(NEW.email, NEW.role::text, jsonb_build_object('email', NEW.email, 'role', NEW.role))
            )
            ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                scope_id = EXCLUDED.scope_id,
                display_text = EXCLUDED.display_text,
                content_text = EXCLUDED.content_text,
                metadata = EXCLUDED.metadata,
                normalized_text = EXCLUDED.normalized_text;
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
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
            VALUES (
                'asset',
                NEW.id,
                NEW.app_id,
                COALESCE(NEW.name, NEW.type),
                NEW.content,
                jsonb_strip_nulls(jsonb_build_object('type', NEW.type, 'size', NEW.size, 'name', NEW.name, 'hash', NEW.hash), true),
                normalize_search_text(
                    COALESCE(NEW.name, NEW.type),
                    NEW.content,
                    jsonb_strip_nulls(jsonb_build_object('type', NEW.type, 'size', NEW.size, 'name', NEW.name, 'hash', NEW.hash), true)
                )
            )
            ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                scope_id = EXCLUDED.scope_id,
                display_text = EXCLUDED.display_text,
                content_text = EXCLUDED.content_text,
                metadata = EXCLUDED.metadata,
                normalized_text = EXCLUDED.normalized_text;
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
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
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
                ), true),
                normalize_search_text(
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
            )
            ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                scope_id = EXCLUDED.scope_id,
                display_text = EXCLUDED.display_text,
                content_text = EXCLUDED.content_text,
                metadata = EXCLUDED.metadata,
                normalized_text = EXCLUDED.normalized_text;
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
                INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
                SELECT 'app', id, NULL, name, namespace, jsonb_build_object('name', name, 'namespace', namespace), normalize_search_text(name, namespace, jsonb_build_object('name', name, 'namespace', namespace))
                FROM apps;
                INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
                SELECT 'user', id, app_id, email, role::text, jsonb_build_object('email', email, 'role', role), normalize_search_text(email, role::text, jsonb_build_object('email', email, 'role', role))
                FROM users
                WHERE deleted_at IS NULL;
                INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
                SELECT 'asset', id, app_id, COALESCE(name, type), content,
                    jsonb_strip_nulls(jsonb_build_object('type', type, 'size', size, 'name', name, 'hash', hash), true),
                    normalize_search_text(COALESCE(name, type), content, jsonb_strip_nulls(jsonb_build_object('type', type, 'size', size, 'name', name, 'hash', hash), true))
                FROM assets
                WHERE deleted_at IS NULL;
                INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
                SELECT 'auditLog', id, app_id, subject::text || ':' || operation::text, subject::text || ' ' || operation::text,
                    jsonb_strip_nulls(jsonb_build_object(
                        'subject', subject,
                        'operation', operation,
                        'userId', user_id,
                        'hasOldData', old_data IS NOT NULL,
                        'hasNewData', new_data IS NOT NULL
                    ), true),
                    normalize_search_text(
                        subject::text || ':' || operation::text,
                        subject::text || ' ' || operation::text,
                        jsonb_strip_nulls(jsonb_build_object(
                            'subject', subject,
                            'operation', operation,
                            'userId', user_id,
                            'hasOldData', old_data IS NOT NULL,
                            'hasNewData', new_data IS NOT NULL
                        ), true)
                    )
                FROM audit_logs;
                RETURN;
            END IF;

            DELETE FROM search_documents WHERE scope_id = p_scope_id;

            IF p_include_global THEN
                DELETE FROM search_documents WHERE scope_id IS NULL;
                INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
                SELECT 'app', id, NULL, name, namespace, jsonb_build_object('name', name, 'namespace', namespace), normalize_search_text(name, namespace, jsonb_build_object('name', name, 'namespace', namespace))
                FROM apps;
            END IF;

            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
            SELECT 'user', id, app_id, email, role::text, jsonb_build_object('email', email, 'role', role), normalize_search_text(email, role::text, jsonb_build_object('email', email, 'role', role))
            FROM users
            WHERE deleted_at IS NULL AND app_id = p_scope_id;

            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
            SELECT 'asset', id, app_id, COALESCE(name, type), content,
                jsonb_strip_nulls(jsonb_build_object('type', type, 'size', size, 'name', name, 'hash', hash), true),
                normalize_search_text(COALESCE(name, type), content, jsonb_strip_nulls(jsonb_build_object('type', type, 'size', size, 'name', name, 'hash', hash), true))
            FROM assets
            WHERE deleted_at IS NULL AND app_id = p_scope_id;

            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
            SELECT 'auditLog', id, app_id, subject::text || ':' || operation::text, subject::text || ' ' || operation::text,
                jsonb_strip_nulls(jsonb_build_object(
                    'subject', subject,
                    'operation', operation,
                    'userId', user_id,
                    'hasOldData', old_data IS NOT NULL,
                    'hasNewData', new_data IS NOT NULL
                ), true),
                normalize_search_text(
                    subject::text || ':' || operation::text,
                    subject::text || ' ' || operation::text,
                    jsonb_strip_nulls(jsonb_build_object(
                        'subject', subject,
                        'operation', operation,
                        'userId', user_id,
                        'hasOldData', old_data IS NOT NULL,
                        'hasNewData', new_data IS NOT NULL
                    ), true)
                )
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
    // Enable RLS on tenant-scoped tables
    yield* sql`ALTER TABLE users ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE permissions ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE sessions ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE oauth_accounts ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE mfa_secrets ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE assets ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE jobs ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE notifications ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE job_dlq ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE search_documents ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE search_embeddings ENABLE ROW LEVEL SECURITY`;
    // RLS Policies: users (scoped by app_id)
    yield* sql`CREATE POLICY users_tenant_isolation ON users USING (app_id = get_current_tenant_id()) WITH CHECK (app_id = get_current_tenant_id())`;
    // RLS Policies: permissions (scoped by app_id)
    yield* sql`CREATE POLICY permissions_tenant_isolation ON permissions USING (app_id = get_current_tenant_id()) WITH CHECK (app_id = get_current_tenant_id())`;
    // RLS Policies: sessions (scoped by app_id)
    yield* sql`CREATE POLICY sessions_tenant_isolation ON sessions USING (app_id = get_current_tenant_id()) WITH CHECK (app_id = get_current_tenant_id())`;
    // RLS Policies: api_keys (scoped via SECURITY DEFINER helper — avoids chained RLS)
    yield* sql`CREATE POLICY api_keys_tenant_isolation ON api_keys USING (user_id IN (SELECT get_tenant_user_ids())) WITH CHECK (user_id IN (SELECT get_tenant_user_ids()))`;
    // RLS Policies: oauth_accounts (scoped via SECURITY DEFINER helper — avoids chained RLS)
    yield* sql`CREATE POLICY oauth_accounts_tenant_isolation ON oauth_accounts USING (user_id IN (SELECT get_tenant_user_ids())) WITH CHECK (user_id IN (SELECT get_tenant_user_ids()))`;
    // RLS Policies: mfa_secrets (scoped via SECURITY DEFINER helper — avoids chained RLS)
    yield* sql`CREATE POLICY mfa_secrets_tenant_isolation ON mfa_secrets USING (user_id IN (SELECT get_tenant_user_ids())) WITH CHECK (user_id IN (SELECT get_tenant_user_ids()))`;
    // RLS Policies: webauthn_credentials (scoped via SECURITY DEFINER helper — avoids chained RLS)
    yield* sql`CREATE POLICY webauthn_credentials_tenant_isolation ON webauthn_credentials USING (user_id IN (SELECT get_tenant_user_ids())) WITH CHECK (user_id IN (SELECT get_tenant_user_ids()))`;
    // RLS Policies: assets (scoped by app_id)
    yield* sql`CREATE POLICY assets_tenant_isolation ON assets USING (app_id = get_current_tenant_id()) WITH CHECK (app_id = get_current_tenant_id())`;
    // RLS Policies: audit_logs (scoped by app_id)
    yield* sql`CREATE POLICY audit_logs_tenant_isolation ON audit_logs USING (app_id = get_current_tenant_id()) WITH CHECK (app_id = get_current_tenant_id())`;
    // RLS Policies: jobs (scoped by app_id)
    yield* sql`CREATE POLICY jobs_tenant_isolation ON jobs USING (app_id = get_current_tenant_id()) WITH CHECK (app_id = get_current_tenant_id())`;
    // RLS Policies: notifications (scoped by app_id)
    yield* sql`CREATE POLICY notifications_tenant_isolation ON notifications USING (app_id = get_current_tenant_id()) WITH CHECK (app_id = get_current_tenant_id())`;
    // RLS Policies: job_dlq (scoped by app_id)
    yield* sql`CREATE POLICY job_dlq_tenant_isolation ON job_dlq USING (app_id = get_current_tenant_id()) WITH CHECK (app_id = get_current_tenant_id())`;
    // RLS Policies: search_documents (scoped by scope_id = app_id, or global if NULL)
    yield* sql`CREATE POLICY search_documents_tenant_isolation ON search_documents USING (scope_id IS NULL OR scope_id = get_current_tenant_id()) WITH CHECK (scope_id IS NULL OR scope_id = get_current_tenant_id())`;
    // RLS Policies: search_embeddings (scoped by scope_id = app_id, or global if NULL)
    yield* sql`CREATE POLICY search_embeddings_tenant_isolation ON search_embeddings USING (scope_id IS NULL OR scope_id = get_current_tenant_id()) WITH CHECK (scope_id IS NULL OR scope_id = get_current_tenant_id())`;
    // FORCE RLS for table owners (superuser bypass is acceptable for migrations/admin)
    yield* sql`ALTER TABLE users FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE permissions FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE sessions FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE api_keys FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE oauth_accounts FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE mfa_secrets FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE webauthn_credentials FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE assets FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE jobs FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE notifications FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE job_dlq FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE search_documents FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE search_embeddings FORCE ROW LEVEL SECURITY`;
    yield* sql`COMMENT ON POLICY users_tenant_isolation ON users IS 'RLS: Isolate users by app_id matching get_current_tenant_id()'`;
    yield* sql`COMMENT ON POLICY permissions_tenant_isolation ON permissions IS 'RLS: Isolate permissions by app_id matching get_current_tenant_id()'`;
    yield* sql`COMMENT ON POLICY assets_tenant_isolation ON assets IS 'RLS: Isolate assets by app_id matching get_current_tenant_id()'`;
    yield* sql`COMMENT ON POLICY audit_logs_tenant_isolation ON audit_logs IS 'RLS: Isolate audit_logs by app_id matching get_current_tenant_id()'`;
    yield* sql`COMMENT ON POLICY jobs_tenant_isolation ON jobs IS 'RLS: Isolate jobs by app_id matching get_current_tenant_id()'`;
    yield* sql`COMMENT ON POLICY notifications_tenant_isolation ON notifications IS 'RLS: Isolate notifications by app_id matching get_current_tenant_id()'`;
    yield* sql`COMMENT ON POLICY job_dlq_tenant_isolation ON job_dlq IS 'RLS: Isolate job_dlq by app_id matching get_current_tenant_id()'`;
});
