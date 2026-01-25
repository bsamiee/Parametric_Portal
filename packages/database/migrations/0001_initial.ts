/**
 * PG18.1 + EXTENSIONS LEVERAGED (Release: Sept 25, 2025):
 * ┌───────────────────────────────────────────────────────────────────────────────┐
 * │ uuidv7()            │ NATIVE time-ordered IDs (no extension, k-sortable)      │
 * │ uuid_extract_timestamp │ Extract creation time from UUIDv7 (NO created_at)    │
 * │ casefold(text)      │ Unicode case folding for proper text comparisons        │
 * │ citext              │ Case-insensitive text columns (extension)               │
 * │ NULLS NOT DISTINCT  │ Proper NULL handling in unique constraints              │
 * │ Covering (INCLUDE)  │ Index-only scans eliminate heap fetches                 │
 * │ BRIN indexes        │ Ultra-compact for time-range scans on audit logs        │
 * │ Parallel GIN        │ Concurrent JSONB index builds                           │
 * │ B-tree skip scan    │ Multi-column indexes usable when leading cols omitted   │
 * │ Partial indexes     │ Only index active/non-deleted records                   │
 * │ STORED generated    │ Precomputed columns (assets.size only — others VIRTUAL) │
 * │ VIRTUAL generated   │ Computed on read (prefix columns)                       │
 * │ Immutability        │ DB-enforced append-only audit_logs via trigger          │
 * └───────────────────────────────────────────────────────────────────────────────┘
 * EXTENSIONS REQUIRED (CREATE EXTENSION IF NOT EXISTS):
 * - citext (case-insensitive columns: users.email)
 * - pg_trgm (trigram similarity for fuzzy search)
 * - fuzzystrmatch (levenshtein/soundex fuzzy matchers)
 * - unaccent (diacritic normalization for FTS/similarity)
 * - vector (pgvector embeddings + HNSW)
 * - pg_stat_statements (SQL stats; requires shared_preload_libraries)
 * GENERATED COLUMNS (PG18.1):
 * - VIRTUAL: Default in PG18, computed on read, CANNOT be indexed
 * - STORED: Explicit keyword, precomputed on write, indexable
 * - This migration uses STORED for indexable generated columns
 * NEW PG18.1 FUNCTIONS LEVERAGED:
 * - uuidv7() / uuidv4(): Native UUID generation (no uuid-ossp needed)
 * - uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
 * - casefold(text): Unicode case folding for proper comparisons (Turkish İ/i safe)
 * - array_sort(anyarray): Sort array first dimension
 * - array_reverse(anyarray): Reverse array first dimension
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
 * - expires_at validation: App must ensure expires_at > now() at insert time
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
    // EXTENSIONS: citext + pg_trgm + fuzzystrmatch + unaccent + vector + pg_stat_statements + pgaudit
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`CREATE EXTENSION IF NOT EXISTS citext`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS fuzzystrmatch`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS unaccent`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS vector`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS pgaudit`;
    yield* sql`COMMENT ON EXTENSION citext IS 'citext: case-insensitive text columns'`;
    yield* sql`COMMENT ON EXTENSION pg_trgm IS 'pg_trgm: trigram similarity for fuzzy search'`;
    yield* sql`COMMENT ON EXTENSION fuzzystrmatch IS 'fuzzystrmatch: levenshtein/soundex matchers for fuzzy search'`;
    yield* sql`COMMENT ON EXTENSION unaccent IS 'unaccent: Unicode diacritic normalization for search'`;
    yield* sql`COMMENT ON EXTENSION vector IS 'pgvector: vector similarity search for embeddings'`;
    yield* sql`COMMENT ON EXTENSION pg_stat_statements IS 'pg_stat_statements: SQL statement performance statistics'`;
    yield* sql`COMMENT ON EXTENSION pgaudit IS 'pgaudit: compliance audit logging for SOC2/HIPAA/PCI-DSS'`;
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
			namespace TEXT NOT NULL,
			settings JSONB,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT apps_name_not_empty CHECK (length(trim(name)) > 0),
			CONSTRAINT apps_namespace_not_empty CHECK (length(trim(namespace)) > 0)
		)
	`;
    yield* sql`COMMENT ON TABLE apps IS 'Tenant isolation root — all user-facing entities scope to an app; use uuid_extract_timestamp(id) for creation time'`;
    yield* sql`CREATE UNIQUE INDEX idx_apps_namespace ON apps(namespace) INCLUDE (id)`;
    yield* sql`CREATE UNIQUE INDEX idx_apps_namespace_casefold ON apps(casefold(namespace))`;
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
			email CITEXT NOT NULL,
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
    yield* sql`COMMENT ON COLUMN users.email IS 'Format validated at app layer; CITEXT enforces case-insensitive uniqueness among active users'`;
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
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
			hash TEXT NOT NULL,
			expires_at TIMESTAMPTZ NOT NULL,
			deleted_at TIMESTAMPTZ,
			verified_at TIMESTAMPTZ,
			ip_address INET,
			user_agent TEXT,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			prefix TEXT GENERATED ALWAYS AS (left(hash, 16)) VIRTUAL,
			CONSTRAINT sessions_hash_unique UNIQUE NULLS NOT DISTINCT (hash),
			CONSTRAINT sessions_hash_format CHECK (hash ~* '^[0-9a-f]{64}$'),
			CONSTRAINT sessions_user_agent_length CHECK (user_agent IS NULL OR length(user_agent) <= 1024)
		)
	`;
    yield* sql`COMMENT ON TABLE sessions IS 'Auth sessions — use uuid_extract_timestamp(id) for creation time'`;
    yield* sql`COMMENT ON COLUMN sessions.verified_at IS 'NULL until second factor verified — gate sensitive operations'`;
    yield* sql`COMMENT ON COLUMN sessions.prefix IS 'VIRTUAL for debugging/logs only — NOT unique (birthday collision at ~4B tokens)'`;
    yield* sql`COMMENT ON COLUMN sessions.updated_at IS 'App layer must update on each authenticated request'`;
    yield* sql`COMMENT ON COLUMN sessions.deleted_at IS 'Soft-delete timestamp — NULL means active'`;
    yield* sql`CREATE INDEX idx_sessions_user_active ON sessions(user_id) INCLUDE (expires_at, verified_at, updated_at, ip_address) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_sessions_cleanup ON sessions(expires_at, deleted_at)`;
    yield* sql`CREATE INDEX idx_sessions_ip ON sessions(ip_address) WHERE ip_address IS NOT NULL AND deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_sessions_user_id_fk ON sessions(user_id)`;
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
    // REFRESH_TOKENS: Long-lived token rotation (linked to session for per-device revocation)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
		CREATE TABLE refresh_tokens (
			id UUID PRIMARY KEY DEFAULT uuidv7(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
			session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
			hash TEXT NOT NULL,
			expires_at TIMESTAMPTZ NOT NULL,
			deleted_at TIMESTAMPTZ,
			prefix TEXT GENERATED ALWAYS AS (left(hash, 16)) VIRTUAL,
			CONSTRAINT refresh_tokens_hash_unique UNIQUE NULLS NOT DISTINCT (hash),
			CONSTRAINT refresh_tokens_hash_format CHECK (hash ~* '^[0-9a-f]{64}$')
		)
	`;
    yield* sql`COMMENT ON TABLE refresh_tokens IS 'Token rotation — use uuid_extract_timestamp(id) for creation time'`;
    yield* sql`COMMENT ON COLUMN refresh_tokens.session_id IS 'Link to originating session — CASCADE deletes tokens when session revoked'`;
    yield* sql`COMMENT ON COLUMN refresh_tokens.prefix IS 'VIRTUAL for debugging/logs only — NOT unique'`;
    yield* sql`COMMENT ON COLUMN refresh_tokens.deleted_at IS 'Soft-delete timestamp — NULL means active'`;
    yield* sql`CREATE INDEX idx_refresh_user_active ON refresh_tokens(user_id) INCLUDE (expires_at) WHERE deleted_at IS NULL`;
    yield* sql`CREATE INDEX idx_refresh_session ON refresh_tokens(session_id) WHERE session_id IS NOT NULL`;
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
			changes JSONB,
			ip_address INET,
			user_agent TEXT,
			CONSTRAINT audit_logs_user_agent_length CHECK (user_agent IS NULL OR length(user_agent) <= 1024)
		)
	`;
    yield* sql`COMMENT ON TABLE audit_logs IS 'Append-only audit trail — use uuid_extract_timestamp(id) for creation time; JOIN to users for email; never UPDATE/DELETE in application code'`;
    yield* sql`COMMENT ON COLUMN audit_logs.user_id IS 'FK to users — RESTRICT (users never hard-deleted); JOIN to users.email when needed'`;
    yield* sql`COMMENT ON COLUMN audit_logs.request_id IS 'Correlation ID from request context — correlate multiple audit entries from same HTTP request'`;
    yield* sql`CREATE INDEX idx_audit_id_brin ON audit_logs USING BRIN (id)`;
    yield* sql`CREATE INDEX idx_audit_app_subject ON audit_logs(app_id, subject, subject_id, id DESC) INCLUDE (user_id, operation)`;
    yield* sql`CREATE INDEX idx_audit_app_user ON audit_logs(app_id, user_id, id DESC) INCLUDE (subject, subject_id, operation) WHERE user_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_audit_subject_id ON audit_logs(subject_id, id DESC)`;
    yield* sql`CREATE INDEX idx_audit_request ON audit_logs(request_id) WHERE request_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_audit_changes ON audit_logs USING GIN (changes) WHERE changes IS NOT NULL`;
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
    // JOBS: Background job queue with tenant isolation and worker locking
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
		CREATE OR REPLACE FUNCTION set_job_timestamps()
		RETURNS TRIGGER AS $$
		BEGIN
			-- Auto-set started_at when transitioning to processing (first time only)
			IF NEW.status = 'processing' AND (OLD.status IS NULL OR OLD.status != 'processing') AND NEW.started_at IS NULL THEN
				NEW.started_at = NOW();
			END IF;
			-- Auto-set completed_at when transitioning to terminal state
			IF NEW.status IN ('completed', 'dead') AND (OLD.status IS NULL OR OLD.status NOT IN ('completed', 'dead')) THEN
				NEW.completed_at = NOW();
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql
	`;
    yield* sql`COMMENT ON FUNCTION set_job_timestamps() IS 'Trigger function to auto-set started_at/completed_at on job status transitions'`;
    yield* sql`
		CREATE TABLE jobs (
			id UUID PRIMARY KEY DEFAULT uuidv7(),
			app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
			user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
			request_id UUID,
			type TEXT NOT NULL,
			payload JSONB NOT NULL,
			priority TEXT NOT NULL DEFAULT 'normal',
			status TEXT NOT NULL DEFAULT 'pending',
			attempts INTEGER NOT NULL DEFAULT 0,
			max_attempts INTEGER NOT NULL DEFAULT 5,
			scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			started_at TIMESTAMPTZ,
			completed_at TIMESTAMPTZ,
			last_error TEXT,
			locked_by TEXT,
			locked_until TIMESTAMPTZ,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			-- VIRTUAL generated: queue wait time in milliseconds (null until started)
			wait_ms INTEGER GENERATED ALWAYS AS (
				CASE WHEN started_at IS NOT NULL
				THEN EXTRACT(EPOCH FROM (started_at - scheduled_at))::integer * 1000
				END
			) VIRTUAL,
			-- VIRTUAL generated: execution duration in milliseconds (null until completed)
			duration_ms INTEGER GENERATED ALWAYS AS (
				CASE WHEN completed_at IS NOT NULL AND started_at IS NOT NULL
				THEN EXTRACT(EPOCH FROM (completed_at - started_at))::integer * 1000
				END
			) VIRTUAL,
			CONSTRAINT jobs_priority_valid CHECK (priority IN ('low', 'normal', 'high', 'critical')),
			CONSTRAINT jobs_status_valid CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead'))
		)
	`;
    yield* sql`COMMENT ON TABLE jobs IS 'Background job queue — use uuid_extract_timestamp(id) for creation time; worker claims via SELECT FOR UPDATE SKIP LOCKED'`;
    yield* sql`COMMENT ON COLUMN jobs.user_id IS 'FK to users — RESTRICT (users never hard-deleted); attribution for who enqueued the job'`;
    yield* sql`COMMENT ON COLUMN jobs.request_id IS 'Correlation ID from request context — correlate job with originating HTTP request'`;
    yield* sql`COMMENT ON COLUMN jobs.locked_by IS 'Worker ID holding the lock — NULL when available'`;
    yield* sql`COMMENT ON COLUMN jobs.locked_until IS 'Lock expiration — stale locks can be reclaimed after this time'`;
    yield* sql`COMMENT ON COLUMN jobs.wait_ms IS 'VIRTUAL — queue latency from scheduled_at to started_at in milliseconds'`;
    yield* sql`COMMENT ON COLUMN jobs.duration_ms IS 'VIRTUAL — execution time from started_at to completed_at in milliseconds'`;
    yield* sql`CREATE INDEX idx_jobs_claim ON jobs(priority DESC, scheduled_at ASC) WHERE status = 'pending' AND (locked_until IS NULL OR locked_until < now())`;
    yield* sql`CREATE INDEX idx_jobs_app_status ON jobs(app_id, status) INCLUDE (type, scheduled_at)`;
    yield* sql`CREATE INDEX idx_jobs_type_status ON jobs(type, status) INCLUDE (app_id, scheduled_at)`;
    yield* sql`CREATE INDEX idx_jobs_cleanup ON jobs(status, completed_at) WHERE status IN ('completed', 'dead')`;
    yield* sql`CREATE INDEX idx_jobs_app_id_fk ON jobs(app_id)`;
    yield* sql`CREATE INDEX idx_jobs_user_id_fk ON jobs(user_id)`;
    yield* sql`CREATE TRIGGER jobs_timestamps BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_job_timestamps()`;
    yield* sql`CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    yield* sql`
		CREATE OR REPLACE FUNCTION claim_jobs(p_worker_id TEXT, p_limit INT, p_lock_minutes INT DEFAULT 5)
		RETURNS SETOF jobs
		LANGUAGE sql
		AS $$
			UPDATE jobs SET
				status = 'processing',
				locked_by = p_worker_id,
				locked_until = NOW() + (p_lock_minutes || ' minutes')::interval
			WHERE id IN (
				SELECT id FROM jobs
				WHERE status = 'pending'
					AND scheduled_at <= NOW()
					AND (locked_until IS NULL OR locked_until < NOW())
				ORDER BY priority DESC, scheduled_at ASC
				FOR UPDATE SKIP LOCKED
				LIMIT p_limit
			)
			RETURNING *
		$$
	`;
    yield* sql`COMMENT ON FUNCTION claim_jobs IS 'Atomic job claim via SELECT FOR UPDATE SKIP LOCKED — trigger auto-sets started_at'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // PURGE FUNCTIONS: Hard-delete stale/expired records (cleanup jobs)
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
		CREATE OR REPLACE FUNCTION purge_sessions(p_older_than_days INT DEFAULT 30)
		RETURNS INT
		LANGUAGE sql
		AS $$
			WITH purged AS (
				DELETE FROM sessions
				WHERE (deleted_at IS NOT NULL AND deleted_at < NOW() - (p_older_than_days || ' days')::interval)
				   OR (expires_at < NOW() - (p_older_than_days || ' days')::interval)
				RETURNING id
			)
			SELECT COUNT(*)::int FROM purged
		$$
	`;
    yield* sql`COMMENT ON FUNCTION purge_sessions IS 'Hard-delete soft-deleted + expired sessions older than N days'`;
    yield* sql`
		CREATE OR REPLACE FUNCTION purge_refresh_tokens(p_older_than_days INT DEFAULT 90)
		RETURNS INT
		LANGUAGE sql
		AS $$
			WITH purged AS (
				DELETE FROM refresh_tokens
				WHERE (deleted_at IS NOT NULL AND deleted_at < NOW() - (p_older_than_days || ' days')::interval)
				   OR (expires_at < NOW() - (p_older_than_days || ' days')::interval)
				RETURNING id
			)
			SELECT COUNT(*)::int FROM purged
		$$
	`;
    yield* sql`COMMENT ON FUNCTION purge_refresh_tokens IS 'Hard-delete soft-deleted + expired refresh tokens older than N days'`;
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
		CREATE OR REPLACE FUNCTION purge_jobs(p_older_than_days INT DEFAULT 7)
		RETURNS INT
		LANGUAGE sql
		AS $$
			WITH purged AS (
				DELETE FROM jobs
				WHERE status IN ('completed', 'dead')
				  AND completed_at < NOW() - (p_older_than_days || ' days')::interval
				RETURNING id
			)
			SELECT COUNT(*)::int FROM purged
		$$
	`;
    yield* sql`COMMENT ON FUNCTION purge_jobs IS 'Hard-delete completed/dead jobs older than N days'`;
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
			hash TEXT GENERATED ALWAYS AS (
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
			embedding VECTOR(1536) NOT NULL,
			hash TEXT,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT search_embeddings_pk PRIMARY KEY (entity_type, entity_id),
			CONSTRAINT search_embeddings_fk FOREIGN KEY (entity_type, entity_id)
				REFERENCES search_documents(entity_type, entity_id) ON DELETE CASCADE
		)
	`;
    yield* sql`COMMENT ON TABLE search_embeddings IS 'Vector embeddings — use entity_id (UUIDv7) for creation time'`;
    yield* sql`COMMENT ON COLUMN search_embeddings.embedding IS 'Fixed 1536-dim embeddings for stable HNSW indexing'`;
    yield* sql`CREATE INDEX idx_search_documents_vector ON search_documents USING GIN (search_vector)`;
    yield* sql`CREATE INDEX idx_search_documents_scope ON search_documents (scope_id, entity_type)`;
    yield* sql`CREATE INDEX idx_search_documents_trgm ON search_documents USING GIN (display_text gin_trgm_ops)`;
    yield* sql`CREATE INDEX idx_search_embeddings_scope ON search_embeddings (scope_id, entity_type)`;
    yield* sql`CREATE INDEX idx_search_embeddings_embedding ON search_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`;
    yield* sql`
		CREATE OR REPLACE VIEW search_embedding_sources AS
		SELECT
			d.entity_type,
			d.entity_id,
			d.scope_id,
			d.display_text,
			d.content_text,
			d.metadata,
			d.hash,
			d.updated_at
		FROM search_documents d
		LEFT JOIN search_embeddings e
			ON e.entity_type = d.entity_type
			AND e.entity_id = d.entity_id
			AND e.hash = d.hash
		WHERE e.entity_id IS NULL
	`;
    yield* sql`COMMENT ON VIEW search_embedding_sources IS 'Source for embedding refresh; yields documents missing current embeddings'`;
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
				jsonb_build_object('type', NEW.type, 'size', NEW.size, 'name', NEW.name, 'hash', NEW.hash)
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
				jsonb_strip_nulls(jsonb_build_object('subject', NEW.subject, 'operation', NEW.operation, 'userId', NEW.user_id) || coalesce(NEW.changes, '{}'::jsonb))
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
				SELECT 'asset', id, app_id, COALESCE(name, type), content, jsonb_build_object('type', type, 'size', size, 'name', name, 'hash', hash)
				FROM assets
				WHERE deleted_at IS NULL;
				INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata)
				SELECT 'auditLog', id, app_id, subject::text || ':' || operation::text, subject::text || ' ' || operation::text,
					jsonb_strip_nulls(jsonb_build_object('subject', subject, 'operation', operation, 'userId', user_id) || coalesce(changes, '{}'::jsonb))
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
			SELECT 'asset', id, app_id, COALESCE(name, type), content, jsonb_build_object('type', type, 'size', size, 'name', name, 'hash', hash)
			FROM assets
			WHERE deleted_at IS NULL AND app_id = p_scope_id;

			INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata)
			SELECT 'auditLog', id, app_id, subject::text || ':' || operation::text, subject::text || ' ' || operation::text,
				jsonb_strip_nulls(jsonb_build_object('subject', subject, 'operation', operation, 'userId', user_id) || coalesce(changes, '{}'::jsonb))
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
    yield* sql`ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE mfa_secrets ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE assets ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE jobs ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE search_documents ENABLE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE search_embeddings ENABLE ROW LEVEL SECURITY`;
    // RLS Policies: users (scoped by app_id)
    yield* sql`CREATE POLICY users_tenant_isolation ON users USING (app_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (app_id = current_setting('app.current_tenant', true)::uuid)`;
    // RLS Policies: sessions (scoped via user.app_id join)
    yield* sql`CREATE POLICY sessions_tenant_isolation ON sessions USING (user_id IN (SELECT id FROM users WHERE app_id = current_setting('app.current_tenant', true)::uuid))`;
    // RLS Policies: api_keys (scoped via user.app_id join)
    yield* sql`CREATE POLICY api_keys_tenant_isolation ON api_keys USING (user_id IN (SELECT id FROM users WHERE app_id = current_setting('app.current_tenant', true)::uuid))`;
    // RLS Policies: oauth_accounts (scoped via user.app_id join)
    yield* sql`CREATE POLICY oauth_accounts_tenant_isolation ON oauth_accounts USING (user_id IN (SELECT id FROM users WHERE app_id = current_setting('app.current_tenant', true)::uuid))`;
    // RLS Policies: refresh_tokens (scoped via user.app_id join)
    yield* sql`CREATE POLICY refresh_tokens_tenant_isolation ON refresh_tokens USING (user_id IN (SELECT id FROM users WHERE app_id = current_setting('app.current_tenant', true)::uuid))`;
    // RLS Policies: mfa_secrets (scoped via user.app_id join)
    yield* sql`CREATE POLICY mfa_secrets_tenant_isolation ON mfa_secrets USING (user_id IN (SELECT id FROM users WHERE app_id = current_setting('app.current_tenant', true)::uuid))`;
    // RLS Policies: assets (scoped by app_id)
    yield* sql`CREATE POLICY assets_tenant_isolation ON assets USING (app_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (app_id = current_setting('app.current_tenant', true)::uuid)`;
    // RLS Policies: audit_logs (scoped by app_id)
    yield* sql`CREATE POLICY audit_logs_tenant_isolation ON audit_logs USING (app_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (app_id = current_setting('app.current_tenant', true)::uuid)`;
    // RLS Policies: jobs (scoped by app_id)
    yield* sql`CREATE POLICY jobs_tenant_isolation ON jobs USING (app_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (app_id = current_setting('app.current_tenant', true)::uuid)`;
    // RLS Policies: search_documents (scoped by scope_id = app_id, or global if NULL)
    yield* sql`CREATE POLICY search_documents_tenant_isolation ON search_documents USING (scope_id IS NULL OR scope_id = current_setting('app.current_tenant', true)::uuid)`;
    // RLS Policies: search_embeddings (scoped by scope_id = app_id, or global if NULL)
    yield* sql`CREATE POLICY search_embeddings_tenant_isolation ON search_embeddings USING (scope_id IS NULL OR scope_id = current_setting('app.current_tenant', true)::uuid)`;
    // FORCE RLS for table owners (superuser bypass is acceptable for migrations/admin)
    yield* sql`ALTER TABLE users FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE sessions FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE api_keys FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE oauth_accounts FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE mfa_secrets FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE assets FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE jobs FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE search_documents FORCE ROW LEVEL SECURITY`;
    yield* sql`ALTER TABLE search_embeddings FORCE ROW LEVEL SECURITY`;
    yield* sql`COMMENT ON POLICY users_tenant_isolation ON users IS 'RLS: Isolate users by app_id matching current_setting(app.current_tenant)'`;
    yield* sql`COMMENT ON POLICY assets_tenant_isolation ON assets IS 'RLS: Isolate assets by app_id matching current_setting(app.current_tenant)'`;
    yield* sql`COMMENT ON POLICY audit_logs_tenant_isolation ON audit_logs IS 'RLS: Isolate audit_logs by app_id matching current_setting(app.current_tenant)'`;
    yield* sql`COMMENT ON POLICY jobs_tenant_isolation ON jobs IS 'RLS: Isolate jobs by app_id matching current_setting(app.current_tenant)'`;
});
