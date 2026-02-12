/**
 * PostgreSQL 18.1 Migration — Multi-tenant auth/search/jobs platform
 * PG18.1: uuidv7(), uuid_extract_timestamp(), casefold(), VIRTUAL generated,
 * jsonb_strip_nulls(,t), NOT ENFORCED, B-tree skip scan, async I/O.
 * Extensions: pg_trgm, btree_gin, fuzzystrmatch, unaccent, vector (0.8+),
 * pg_stat_statements, pgaudit, pg_stat_kcache, pg_walinspect, pg_cron, pg_partman.
 * Well-known: System=00000000-0000-7000-8000-000000000000, Default=...-000000000001
 */
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// biome-ignore lint/style/noDefaultExport: @effect/sql-pg migrations require default export
export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS btree_gin`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS fuzzystrmatch`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS unaccent`;
    yield* sql`CREATE EXTENSION IF NOT EXISTS vector`;
    yield* sql.unsafe(String.raw`DO $$ BEGIN
        BEGIN CREATE EXTENSION IF NOT EXISTS pg_stat_statements; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'pg_stat_statements unavailable: %', SQLERRM; END;
        BEGIN CREATE EXTENSION IF NOT EXISTS pgaudit; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'pgaudit unavailable: %', SQLERRM; END;
        BEGIN CREATE EXTENSION IF NOT EXISTS pg_stat_kcache; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'pg_stat_kcache unavailable: %', SQLERRM; END;
        BEGIN CREATE EXTENSION IF NOT EXISTS pg_walinspect; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'pg_walinspect unavailable: %', SQLERRM; END;
        BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'pg_cron unavailable: %', SQLERRM; END;
        BEGIN CREATE EXTENSION IF NOT EXISTS pg_partman; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'pg_partman unavailable: %', SQLERRM; END;
    END $$`);
    yield* sql`CREATE COLLATION IF NOT EXISTS case_insensitive (provider = icu, locale = 'und-u-ks-level2', deterministic = false)`;

    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
        BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
        CREATE OR REPLACE FUNCTION reject_dml() RETURNS TRIGGER AS $$
        BEGIN
            IF TG_OP = ANY(TG_ARGV) THEN RAISE EXCEPTION USING MESSAGE = format('Table %I: %s is prohibited', TG_TABLE_NAME, TG_OP), ERRCODE = 'restrict_violation'; END IF;
            RETURN NULL;
        END; $$ LANGUAGE plpgsql;
        CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS uuid
            LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path TO public
            AS $$ SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid $$;
        CREATE OR REPLACE FUNCTION get_tenant_user_ids() RETURNS SETOF uuid
            LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path TO public
            AS $$ SELECT id FROM users WHERE app_id = get_current_tenant_id() AND deleted_at IS NULL $$`);

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
            'MaxRetries','Validation','HandlerMissing','RunnerUnavailable','Timeout','Panic',
            'Processing','NotFound','AlreadyCancelled','DeliveryFailed','DeserializationFailed',
            'DuplicateEvent','ValidationFailed','AuditPersistFailed','HandlerTimeout');
        CREATE TYPE webauthn_device_type AS ENUM ('singleDevice', 'multiDevice');
        CREATE TYPE audit_operation AS ENUM (
            'create','update','delete','read','list','status','login','refresh','revoke','revokeByIp',
            'verify','verifyMfa','register','enroll','disable','sign','upload','stream_upload','copy',
            'remove','abort_multipart','export','import','validate','cancel','replay','archive',
            'purge-tenant','auth_failure','permission_denied','purge-sessions','purge-api-keys',
            'purge-assets','purge-event-journal','purge-job-dlq','purge-kv-store',
            'purge-mfa-secrets','purge-oauth-accounts');
        CREATE DOMAIN hex64 AS TEXT CHECK (VALUE ~* '^[0-9a-f]{64}$')`);

    yield* sql`
        CREATE TABLE apps (
            id UUID PRIMARY KEY DEFAULT uuidv7(), name TEXT NOT NULL,
            namespace TEXT COLLATE case_insensitive NOT NULL, settings JSONB,
            status app_status NOT NULL DEFAULT 'active',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT apps_name_not_empty CHECK (length(trim(name)) > 0),
            CONSTRAINT apps_namespace_not_empty CHECK (length(trim(namespace)) > 0),
            CONSTRAINT apps_settings_shape CHECK (settings IS NULL OR jsonb_typeof(settings) = 'object'))`;
    yield* sql.unsafe(String.raw`
        CREATE UNIQUE INDEX idx_apps_namespace ON apps(namespace) INCLUDE (id);
        INSERT INTO apps (id, name, namespace) VALUES ('00000000-0000-7000-8000-000000000000', 'System', 'system') ON CONFLICT (id) DO NOTHING;
        INSERT INTO apps (id, name, namespace) VALUES ('00000000-0000-7000-8000-000000000001', 'Default', 'default') ON CONFLICT (id) DO NOTHING`);

    yield* sql`
        CREATE TABLE users (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            email TEXT COLLATE case_insensitive NOT NULL,
            preferences JSONB NOT NULL DEFAULT '{"channels":{"email":true,"webhook":true,"inApp":true},"templates":{},"mutedUntil":null}'::jsonb,
            role app_role NOT NULL, status user_status NOT NULL DEFAULT 'active',
            deleted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT users_preferences_shape CHECK (jsonb_typeof(preferences) = 'object' AND jsonb_typeof(preferences->'channels') = 'object'))`;
    yield* sql.unsafe(String.raw`
        CREATE UNIQUE INDEX idx_users_app_email_active ON users(app_id, email) INCLUDE (id, role) WHERE deleted_at IS NULL;
        CREATE INDEX idx_users_app_id ON users(app_id) INCLUDE (id, email, role) WHERE deleted_at IS NULL`);

    yield* sql`
        CREATE TABLE permissions (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            role app_role NOT NULL, resource TEXT NOT NULL, action TEXT NOT NULL,
            deleted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT permissions_resource_not_empty CHECK (length(trim(resource)) > 0),
            CONSTRAINT permissions_action_not_empty CHECK (length(trim(action)) > 0),
            CONSTRAINT permissions_unique UNIQUE (app_id, role, resource, action))`;
    yield* sql`CREATE INDEX idx_permissions_app_role_active ON permissions(app_id, role) INCLUDE (resource, action) WHERE deleted_at IS NULL`;

    yield* sql`
        CREATE TABLE sessions (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            token_access hex64 NOT NULL, token_refresh hex64 NOT NULL,
            expiry_access TIMESTAMPTZ NOT NULL, expiry_refresh TIMESTAMPTZ NOT NULL,
            deleted_at TIMESTAMPTZ, verified_at TIMESTAMPTZ, ip_address INET, agent TEXT,
            created_at TIMESTAMPTZ GENERATED ALWAYS AS (uuid_extract_timestamp(id)) STORED,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT sessions_agent_length CHECK (agent IS NULL OR length(agent) <= 1024)
        ) PARTITION BY RANGE (created_at)`;
    yield* sql.unsafe(String.raw`
        CREATE TABLE sessions_default PARTITION OF sessions DEFAULT;
        CREATE TABLE session_tokens (
            session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
            token_access hex64 NOT NULL UNIQUE, token_refresh hex64 NOT NULL UNIQUE);
        CREATE OR REPLACE FUNCTION sync_session_tokens() RETURNS TRIGGER AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN DELETE FROM session_tokens WHERE session_id = OLD.id; RETURN OLD; END IF;
            INSERT INTO session_tokens (session_id, token_access, token_refresh)
            VALUES (NEW.id, NEW.token_access, NEW.token_refresh)
            ON CONFLICT (session_id) DO UPDATE SET token_access = EXCLUDED.token_access, token_refresh = EXCLUDED.token_refresh;
            RETURN NEW;
        END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER sessions_tokens_sync_upsert AFTER INSERT OR UPDATE OF token_access, token_refresh ON sessions FOR EACH ROW EXECUTE FUNCTION sync_session_tokens();
        CREATE TRIGGER sessions_tokens_sync_delete AFTER DELETE ON sessions FOR EACH ROW EXECUTE FUNCTION sync_session_tokens()`);
    yield* sql.unsafe(String.raw`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_partman') THEN BEGIN
            PERFORM partman.create_parent(p_parent_table := 'public.sessions', p_control := 'created_at',
                p_type := 'native', p_interval := 'monthly', p_premake := 4, p_default_table := false);
            UPDATE partman.part_config SET infinite_time_partitions = true, retention = '30 days', retention_keep_table = false
            WHERE parent_table = 'public.sessions';
        EXCEPTION WHEN OTHERS THEN RAISE WARNING 'pg_partman sessions registration skipped: %', SQLERRM; END; END IF;
    END $$`);
    yield* sql.unsafe(String.raw`
        CREATE INDEX idx_sessions_app_user_active ON sessions(app_id, user_id) INCLUDE (expiry_access, expiry_refresh, verified_at, updated_at, ip_address) WHERE deleted_at IS NULL;
        CREATE INDEX idx_sessions_cleanup ON sessions(deleted_at, (GREATEST(expiry_access, expiry_refresh)));
        CREATE INDEX idx_sessions_ip ON sessions(ip_address) WHERE ip_address IS NOT NULL AND deleted_at IS NULL`);

    yield* sql`
        CREATE TABLE api_keys (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            name TEXT NOT NULL, hash hex64 NOT NULL, encrypted BYTEA NOT NULL,
            expires_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            prefix TEXT GENERATED ALWAYS AS (left(hash, 16)) VIRTUAL,
            CONSTRAINT api_keys_hash_unique UNIQUE (hash),
            CONSTRAINT api_keys_name_not_empty CHECK (length(trim(name)) > 0))`;
    yield* sql`CREATE INDEX idx_api_keys_user_active ON api_keys(user_id) INCLUDE (id, name, expires_at, last_used_at) WHERE deleted_at IS NULL`;

    yield* sql`
        CREATE TABLE oauth_accounts (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            provider oauth_provider NOT NULL, external_id TEXT NOT NULL,
            token_payload BYTEA NOT NULL, deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT oauth_provider_external_unique UNIQUE (provider, external_id))`;
    yield* sql`CREATE INDEX idx_oauth_user ON oauth_accounts(user_id) INCLUDE (provider, external_id) WHERE deleted_at IS NULL`;

    yield* sql`
        CREATE TABLE assets (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            type TEXT NOT NULL, status asset_status NOT NULL, hash hex64, name TEXT,
            storage_ref TEXT, content TEXT NOT NULL, deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            size INTEGER GENERATED ALWAYS AS (octet_length(content)) STORED,
            CONSTRAINT assets_content_max_size CHECK (octet_length(content) <= 1048576))`;
    yield* sql.unsafe(String.raw`
        CREATE INDEX idx_assets_app_type ON assets(app_id, type) INCLUDE (id, user_id) WHERE deleted_at IS NULL;
        CREATE INDEX idx_assets_app_user ON assets(app_id, user_id) INCLUDE (id, type) WHERE deleted_at IS NULL AND user_id IS NOT NULL;
        CREATE INDEX idx_assets_hash ON assets(hash) WHERE hash IS NOT NULL AND deleted_at IS NULL;
        CREATE INDEX idx_assets_storage_ref ON assets(storage_ref) WHERE storage_ref IS NOT NULL AND deleted_at IS NULL;
        CREATE INDEX idx_assets_stale_purge ON assets(deleted_at, storage_ref) WHERE deleted_at IS NOT NULL AND storage_ref IS NOT NULL`);

    yield* sql`
        CREATE TABLE audit_logs (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT NOT ENFORCED,
            user_id UUID REFERENCES users(id) ON DELETE RESTRICT NOT ENFORCED,
            request_id UUID, operation audit_operation NOT NULL,
            target_type TEXT NOT NULL, target_id UUID NOT NULL,
            delta JSONB, context_ip INET, context_agent TEXT)`;
    yield* sql.unsafe(String.raw`
        CREATE INDEX idx_audit_id_brin ON audit_logs USING BRIN (id);
        CREATE INDEX idx_audit_app_target ON audit_logs(app_id, target_type, target_id, id DESC) INCLUDE (user_id, operation);
        CREATE INDEX idx_audit_app_user ON audit_logs(app_id, user_id, id DESC) INCLUDE (target_type, operation) WHERE user_id IS NOT NULL;
        CREATE INDEX idx_audit_request ON audit_logs(request_id) WHERE request_id IS NOT NULL;
        CREATE INDEX idx_audit_delta ON audit_logs USING GIN (delta jsonb_path_ops) WITH (parallel_workers = 4) WHERE delta IS NOT NULL;
        CREATE INDEX idx_audit_context_ip ON audit_logs(context_ip) WHERE context_ip IS NOT NULL;
        CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_dml('UPDATE', 'DELETE')`);

    yield* sql`
        CREATE TABLE mfa_secrets (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
            encrypted BYTEA NOT NULL, backups TEXT[] NOT NULL DEFAULT '{}',
            enabled_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            remaining INTEGER GENERATED ALWAYS AS (COALESCE(array_length(backups, 1), 0)) VIRTUAL,
            CONSTRAINT mfa_backups_no_nulls CHECK (array_position(backups, NULL) IS NULL))`;
    yield* sql`CREATE INDEX idx_mfa_user ON mfa_secrets(user_id) INCLUDE (enabled_at) WHERE deleted_at IS NULL`;

    yield* sql`
        CREATE TABLE webauthn_credentials (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            credential_id TEXT NOT NULL, public_key BYTEA NOT NULL,
            counter INTEGER NOT NULL DEFAULT 0, device_type webauthn_device_type NOT NULL,
            backed_up BOOLEAN NOT NULL, transports TEXT[] NOT NULL DEFAULT '{}',
            name TEXT NOT NULL, last_used_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT webauthn_credentials_credential_id_unique UNIQUE (credential_id),
            CONSTRAINT webauthn_credentials_counter_non_negative CHECK (counter >= 0),
            CONSTRAINT webauthn_credentials_name_not_empty CHECK (length(trim(name)) > 0))`;
    yield* sql`CREATE INDEX idx_webauthn_credentials_user_active ON webauthn_credentials(user_id) INCLUDE (credential_id, name, last_used_at, counter) WHERE deleted_at IS NULL`;

    yield* sql`
        CREATE TABLE jobs (
            job_id TEXT PRIMARY KEY, app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            type TEXT NOT NULL, status job_status NOT NULL, priority job_priority NOT NULL,
            payload JSONB NOT NULL, output JSONB, history JSONB NOT NULL,
            retry_current INTEGER NOT NULL DEFAULT 0 CHECK (retry_current >= 0),
            retry_max INTEGER NOT NULL CHECK (retry_max > 0),
            scheduled_at TIMESTAMPTZ, correlation JSONB, completed_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT jobs_type_not_empty CHECK (length(trim(type)) > 0),
            CONSTRAINT jobs_history_array CHECK (jsonb_typeof(history) = 'array'))`;
    yield* sql.unsafe(String.raw`
        CREATE INDEX idx_jobs_app_status ON jobs(app_id, status) INCLUDE (type, priority, retry_current, retry_max);
        CREATE INDEX idx_jobs_app_type ON jobs(app_id, type) INCLUDE (status, priority);
        CREATE INDEX idx_jobs_app_updated ON jobs(app_id, updated_at DESC) INCLUDE (status, type);
        CREATE UNIQUE INDEX idx_jobs_dedupe_active ON jobs(app_id, (correlation->>'dedupe')) WHERE correlation->>'dedupe' IS NOT NULL AND status IN ('queued', 'processing');
        CREATE INDEX idx_jobs_batch ON jobs((correlation->>'batch')) WHERE correlation->>'batch' IS NOT NULL`);

    yield* sql.unsafe(String.raw`
        CREATE TABLE notifications (
            id UUID PRIMARY KEY DEFAULT uuidv7(), app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
            channel notification_channel NOT NULL, template TEXT NOT NULL,
            status notification_status NOT NULL, recipient TEXT,
            payload JSONB NOT NULL, delivery JSONB,
            retry_current INTEGER NOT NULL DEFAULT 0 CHECK (retry_current >= 0),
            retry_max INTEGER NOT NULL DEFAULT 5 CHECK (retry_max > 0),
            correlation JSONB, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT notifications_template_not_empty CHECK (length(trim(template)) > 0));
        CREATE INDEX idx_notifications_app_status ON notifications(app_id, status, id DESC) INCLUDE (channel, template, retry_current, retry_max);
        CREATE INDEX idx_notifications_app_user ON notifications(app_id, user_id, id DESC) INCLUDE (channel, status, template) WHERE user_id IS NOT NULL;
        CREATE INDEX idx_notifications_app_updated ON notifications(app_id, updated_at DESC) INCLUDE (channel, status, user_id);
        CREATE INDEX idx_notifications_correlation_job ON notifications((correlation->>'job')) WHERE correlation->>'job' IS NOT NULL;
        CREATE UNIQUE INDEX idx_notifications_dedupe_active ON notifications(app_id, (correlation->>'dedupe')) WHERE correlation->>'dedupe' IS NOT NULL AND status IN ('queued', 'sending')`);

    yield* sql`
        CREATE TABLE job_dlq (
            id UUID PRIMARY KEY DEFAULT uuidv7(), source dlq_source NOT NULL DEFAULT 'job',
            source_id TEXT NOT NULL, app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT NOT ENFORCED,
            context_user_id UUID, context_request_id UUID, type TEXT NOT NULL,
            payload JSONB NOT NULL, error_reason dlq_error_reason NOT NULL,
            attempts INTEGER NOT NULL, errors JSONB NOT NULL, replayed_at TIMESTAMPTZ,
            CONSTRAINT job_dlq_errors_array CHECK (jsonb_typeof(errors) = 'array'),
            CONSTRAINT job_dlq_attempts_positive CHECK (attempts > 0))`;
    yield* sql.unsafe(String.raw`
        CREATE INDEX idx_job_dlq_id_brin ON job_dlq USING BRIN (id);
        CREATE INDEX idx_job_dlq_source ON job_dlq(source, error_reason) INCLUDE (type, attempts) WHERE replayed_at IS NULL;
        CREATE INDEX idx_job_dlq_pending_type ON job_dlq(type, error_reason) INCLUDE (app_id, source, attempts) WHERE replayed_at IS NULL;
        CREATE INDEX idx_job_dlq_pending_app ON job_dlq(app_id, id DESC) INCLUDE (type, source, error_reason, attempts) WHERE replayed_at IS NULL;
        CREATE INDEX idx_job_dlq_source_id ON job_dlq(source_id) INCLUDE (error_reason, attempts, replayed_at);
        CREATE INDEX idx_job_dlq_context_request ON job_dlq(context_request_id) WHERE context_request_id IS NOT NULL`);

    yield* sql.unsafe(String.raw`
        CREATE TABLE effect_event_journal (
            id BYTEA PRIMARY KEY, event TEXT NOT NULL, primary_key TEXT NOT NULL UNIQUE,
            payload BYTEA NOT NULL, timestamp BIGINT NOT NULL);
        CREATE INDEX idx_event_journal_timestamp ON effect_event_journal USING BRIN (timestamp);
        CREATE INDEX idx_event_journal_event ON effect_event_journal (event);
        CREATE TRIGGER event_journal_no_update BEFORE UPDATE ON effect_event_journal FOR EACH ROW EXECUTE FUNCTION reject_dml('UPDATE');
        CREATE TABLE effect_event_remotes (
            remote_id TEXT NOT NULL, entry_id BYTEA NOT NULL REFERENCES effect_event_journal(id) ON DELETE CASCADE,
            sequence BIGINT NOT NULL, PRIMARY KEY (remote_id, entry_id))`);

    yield* sql.unsafe(String.raw`
        CREATE TABLE kv_store (
            id UUID PRIMARY KEY DEFAULT uuidv7(), key TEXT NOT NULL, value TEXT NOT NULL,
            expires_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
        CREATE UNIQUE INDEX kv_store_key_unique ON kv_store(key) INCLUDE (value);
        CREATE INDEX idx_kv_store_expires ON kv_store(expires_at) WHERE expires_at IS NOT NULL`);

    yield* sql.unsafe(String.raw`DO $$ DECLARE _pair text[]; _tbl text; BEGIN
        FOREACH _pair SLICE 1 IN ARRAY ARRAY[
            ARRAY['sessions','user_id'], ARRAY['assets','user_id'],
            ARRAY['audit_logs','app_id'], ARRAY['audit_logs','user_id'],
            ARRAY['notifications','user_id'], ARRAY['job_dlq','app_id']
        ] LOOP EXECUTE format('CREATE INDEX idx_%s_%s_fk ON %I(%I)', _pair[1], _pair[2], _pair[1], _pair[2]); END LOOP;
        FOR _tbl IN SELECT unnest(ARRAY[
            'apps','users','permissions','api_keys','oauth_accounts','assets',
            'mfa_secrets','webauthn_credentials','jobs','notifications','kv_store'
        ]) LOOP EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION set_updated_at()', _tbl || '_updated_at', _tbl); END LOOP;
    END $$`);

    yield* sql`
        CREATE OR REPLACE FUNCTION purge_sessions(p_older_than_days INT DEFAULT 30) RETURNS INT
        LANGUAGE plpgsql VOLATILE AS $$
        DECLARE _cutoff TIMESTAMPTZ := NOW() - make_interval(days => p_older_than_days);
            _deleted INT := 0; _dropped INT := 0; _rel record; _upper TEXT;
        BEGIN
            FOR _rel IN SELECT cls.oid, nsp.nspname, cls.relname, pg_get_expr(cls.relpartbound, cls.oid) AS bound
                FROM pg_inherits inh JOIN pg_class cls ON cls.oid = inh.inhrelid
                JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
                WHERE inh.inhparent = 'public.sessions'::regclass LOOP
                IF _rel.bound <> 'DEFAULT' THEN
                    _upper := (regexp_match(_rel.bound, $$TO \('([^']+)'\)$$))[1];
                    IF _upper IS NOT NULL AND _upper::timestamptz < _cutoff THEN
                        EXECUTE format('DROP TABLE IF EXISTS %I.%I', _rel.nspname, _rel.relname); _dropped := _dropped + 1;
                    END IF;
                END IF;
            END LOOP;
            DELETE FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at < _cutoff;
            GET DIAGNOSTICS _deleted = ROW_COUNT;
            IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_partman') THEN
                BEGIN PERFORM partman.run_maintenance(p_analyze := false);
                EXCEPTION WHEN OTHERS THEN RAISE WARNING 'pg_partman maintenance failed: %', SQLERRM; END;
            END IF;
            RETURN _deleted + _dropped;
        END $$`;
    yield* sql.unsafe(String.raw`DO $$ DECLARE _rec record; BEGIN
        FOR _rec IN SELECT * FROM (VALUES
            ('api_keys','deleted_at',365), ('oauth_accounts','deleted_at',90),
            ('mfa_secrets','deleted_at',90), ('assets','deleted_at',30),
            ('kv_store','expires_at',30), ('job_dlq','replayed_at',30)
        ) AS t(table_name text, column_name text, default_days int) LOOP
            EXECUTE format($fn$CREATE OR REPLACE FUNCTION purge_%I(p_older_than_days INT DEFAULT %s) RETURNS INT LANGUAGE sql VOLATILE AS $body$
                WITH purged AS (DELETE FROM %I WHERE %I IS NOT NULL AND %I < NOW() - make_interval(days => p_older_than_days) RETURNING 1) SELECT COUNT(*)::int FROM purged $body$ $fn$,
                _rec.table_name, _rec.default_days, _rec.table_name, _rec.column_name, _rec.column_name);
        END LOOP;
    END $$`);
    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION purge_event_journal(p_older_than_days INT DEFAULT 30) RETURNS INT LANGUAGE sql VOLATILE AS $$
            WITH purged AS (DELETE FROM effect_event_journal WHERE timestamp < (EXTRACT(EPOCH FROM NOW()) * 1000 - p_older_than_days::bigint * 86400000)::bigint RETURNING 1)
            SELECT COUNT(*)::int FROM purged $$;
        CREATE OR REPLACE FUNCTION purge_tenant_cascade(p_app_id UUID) RETURNS INT LANGUAGE plpgsql VOLATILE AS $$
        DECLARE _total bigint := 0; _count bigint; _user_ids uuid[]; _tbl text;
        BEGIN
            SELECT array_agg(id) INTO _user_ids FROM users WHERE app_id = p_app_id;
            FOR _tbl IN SELECT unnest(ARRAY['search_embeddings','search_documents']) LOOP
                EXECUTE format('DELETE FROM %I WHERE scope_id = $1', _tbl) USING p_app_id; GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;
            END LOOP;
            DELETE FROM notifications WHERE app_id = p_app_id; GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;
            ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable;
            DELETE FROM audit_logs WHERE app_id = p_app_id; GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;
            ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable;
            FOR _tbl IN SELECT unnest(ARRAY['jobs','job_dlq','assets']) LOOP
                EXECUTE format('DELETE FROM %I WHERE app_id = $1', _tbl) USING p_app_id; GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;
            END LOOP;
            IF _user_ids IS NOT NULL THEN
                FOR _tbl IN SELECT unnest(ARRAY['webauthn_credentials','mfa_secrets','oauth_accounts','api_keys']) LOOP
                    EXECUTE format('DELETE FROM %I WHERE user_id = ANY($1)', _tbl) USING _user_ids; GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;
                END LOOP;
            END IF;
            FOR _tbl IN SELECT unnest(ARRAY['sessions','permissions','users']) LOOP
                EXECUTE format('DELETE FROM %I WHERE app_id = $1', _tbl) USING p_app_id; GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;
            END LOOP;
            DELETE FROM apps WHERE id = p_app_id; GET DIAGNOSTICS _count = ROW_COUNT; _total := _total + _count;
            RETURN _total::int;
        END $$`);

    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION count_event_outbox() RETURNS INT LANGUAGE sql STABLE PARALLEL SAFE
            AS $$ SELECT COUNT(*)::int FROM effect_event_remotes $$;
        CREATE OR REPLACE FUNCTION get_event_journal_entry_by_primary_key(p_primary_key TEXT) RETURNS TABLE(payload TEXT)
            LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT convert_from(payload, 'UTF8') FROM effect_event_journal WHERE primary_key = p_primary_key LIMIT 1 $$;
        CREATE OR REPLACE FUNCTION list_event_journal_entries(p_since_sequence_id TEXT DEFAULT '0', p_since_timestamp BIGINT DEFAULT NULL, p_event_type TEXT DEFAULT NULL, p_limit INT DEFAULT 500)
            RETURNS TABLE(payload TEXT, primary_key TEXT) LANGUAGE sql STABLE PARALLEL SAFE AS $$
            SELECT convert_from(e.payload, 'UTF8'), e.primary_key FROM effect_event_journal e
            WHERE e.primary_key ~ '^[0-9]+$' AND e.primary_key::bigint > p_since_sequence_id::bigint
              AND (p_since_timestamp IS NULL OR e.timestamp >= p_since_timestamp)
              AND (p_event_type IS NULL OR e.event = p_event_type)
            ORDER BY e.primary_key::bigint ASC LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000) $$;
        CREATE OR REPLACE FUNCTION delete_kv_by_prefix(p_prefix TEXT) RETURNS INT LANGUAGE sql VOLATILE
            AS $$ WITH deleted AS (DELETE FROM kv_store WHERE starts_with(key, p_prefix) RETURNING 1) SELECT COUNT(*)::int FROM deleted $$;
        CREATE OR REPLACE FUNCTION revoke_sessions_by_ip(p_app_id UUID, p_ip INET) RETURNS INT LANGUAGE sql VOLATILE AS $$
            WITH revoked AS (UPDATE sessions SET deleted_at = NOW() WHERE app_id = p_app_id AND ip_address = p_ip AND deleted_at IS NULL RETURNING 1) SELECT COUNT(*)::int FROM revoked $$;
        CREATE OR REPLACE FUNCTION count_audit_by_ip(p_app_id UUID, p_ip INET, p_window_minutes INT DEFAULT 60) RETURNS INT
            LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT COUNT(*)::int FROM audit_logs
            WHERE app_id = p_app_id AND context_ip = p_ip AND uuid_extract_timestamp(id) > NOW() - make_interval(mins => p_window_minutes) $$`);

    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION get_db_io_config() RETURNS TABLE(name TEXT, setting TEXT)
            LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT name, setting FROM pg_settings WHERE name IN ('io_method','io_workers','effective_io_concurrency','io_combine_limit') $$;
        CREATE OR REPLACE FUNCTION get_db_cache_hit_ratio() RETURNS TABLE(
            backend_type TEXT, io_object TEXT, io_context TEXT, hits DOUBLE PRECISION, reads DOUBLE PRECISION, writes DOUBLE PRECISION, cache_hit_ratio DOUBLE PRECISION)
            LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT backend_type, object, context,
            SUM(hits)::double precision, SUM(reads)::double precision, SUM(writes)::double precision,
            CASE WHEN SUM(hits)+SUM(reads)>0 THEN SUM(hits)::double precision/(SUM(hits)::double precision+SUM(reads)::double precision)*100 ELSE 0 END
            FROM pg_stat_io WHERE object='relation' AND context='normal' GROUP BY backend_type, object, context $$;
        CREATE OR REPLACE FUNCTION get_db_io_stats() RETURNS TABLE(
            backend_type TEXT, io_object TEXT, io_context TEXT, reads BIGINT, read_time DOUBLE PRECISION,
            writes BIGINT, write_time DOUBLE PRECISION, writebacks BIGINT, writeback_time DOUBLE PRECISION,
            extends BIGINT, extend_time DOUBLE PRECISION, hits BIGINT, evictions BIGINT, reuses BIGINT,
            fsyncs BIGINT, fsync_time DOUBLE PRECISION, stats_reset TIMESTAMPTZ)
            LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT backend_type, object, context, reads, read_time,
            writes, write_time, writebacks, writeback_time, extends, extend_time, hits, evictions, reuses,
            fsyncs, fsync_time, stats_reset FROM pg_stat_io $$;
        CREATE OR REPLACE FUNCTION _query_extension_json(p_extension TEXT, p_query TEXT, p_limit INT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
        DECLARE _result JSONB;
        BEGIN IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = p_extension) THEN RETURN '[]'::jsonb; END IF;
            EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM (%s) r',
                CASE WHEN p_limit IS NOT NULL THEN p_query||' LIMIT '||GREATEST(1,LEAST(p_limit,500)) ELSE p_query END) INTO _result;
            RETURN _result; EXCEPTION WHEN OTHERS THEN RETURN '[]'::jsonb; END $$;
        CREATE OR REPLACE FUNCTION list_stat_statements_json(p_limit INT DEFAULT 100) RETURNS JSONB LANGUAGE sql STABLE AS $$ SELECT _query_extension_json('pg_stat_statements','SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC',p_limit) $$;
        CREATE OR REPLACE FUNCTION list_walinspect_json(p_limit INT DEFAULT 100) RETURNS JSONB LANGUAGE sql STABLE AS $$ SELECT _query_extension_json('pg_walinspect','SELECT * FROM pg_get_wal_record_info(pg_current_wal_lsn())',p_limit) $$;
        CREATE OR REPLACE FUNCTION list_stat_kcache_json(p_limit INT DEFAULT 100) RETURNS JSONB LANGUAGE sql STABLE AS $$ SELECT _query_extension_json('pg_stat_kcache','SELECT * FROM pg_stat_kcache_detail ORDER BY exec_reads DESC NULLS LAST',p_limit) $$;
        CREATE OR REPLACE FUNCTION list_cron_jobs_json() RETURNS JSONB LANGUAGE sql STABLE AS $$ SELECT _query_extension_json('pg_cron','SELECT * FROM cron.job ORDER BY jobid') $$;
        CREATE OR REPLACE FUNCTION list_partition_health_json(p_parent_table TEXT) RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
        BEGIN RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('partition', (tree.relid::regclass)::text, 'level', tree.level,
            'isLeaf', tree.isleaf, 'bound', pg_get_expr(cls.relpartbound, cls.oid)) ORDER BY tree.level, (tree.relid::regclass)::text)
            FROM pg_partition_tree(p_parent_table::regclass) tree JOIN pg_class cls ON cls.oid = tree.relid), '[]'::jsonb);
        EXCEPTION WHEN OTHERS THEN RETURN '[]'::jsonb; END $$;
        CREATE OR REPLACE FUNCTION reconcile_maintenance_cron_jobs() RETURNS JSONB LANGUAGE plpgsql VOLATILE AS $$
        DECLARE _job record; _existing_command TEXT; _existing_jobid BIGINT; _existing_schedule TEXT; _result JSONB := '[]'::jsonb;
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN _result; END IF;
            FOR _job IN SELECT * FROM (VALUES
                ('maintenance-partman','5 * * * *','SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = ''pg_partman'') THEN partman.run_maintenance(p_analyze := false) END'),
                ('maintenance-purge-sessions','15 1 * * *','SELECT purge_sessions(30)'),
                ('maintenance-purge-api-keys','20 3 * * 0','SELECT purge_api_keys(365)'),
                ('maintenance-purge-oauth-accounts','20 5 * * 0','SELECT purge_oauth_accounts(90)'),
                ('maintenance-purge-mfa-secrets','20 4 * * 0','SELECT purge_mfa_secrets(90)'),
                ('maintenance-purge-kv-store','20 0 * * 0','SELECT purge_kv_store(30)'),
                ('maintenance-purge-event-journal','20 2 * * *','SELECT purge_event_journal(30)'),
                ('maintenance-purge-job-dlq','25 2 * * *','SELECT purge_job_dlq(30)')
            ) AS t(name, schedule, command) LOOP BEGIN
                SELECT j.jobid, j.schedule, j.command INTO _existing_jobid, _existing_schedule, _existing_command FROM cron.job j WHERE j.jobname = _job.name ORDER BY j.jobid DESC LIMIT 1;
                IF _existing_jobid IS NOT NULL AND _existing_schedule = _job.schedule AND _existing_command = _job.command THEN
                    _result := _result || jsonb_build_array(jsonb_build_object('name', _job.name, 'schedule', _job.schedule, 'status', 'unchanged'));
                ELSE
                    IF _existing_jobid IS NOT NULL THEN PERFORM cron.unschedule(_existing_jobid); END IF;
                    PERFORM cron.schedule(_job.name, _job.schedule, _job.command);
                    _result := _result || jsonb_build_array(jsonb_build_object('name', _job.name, 'schedule', _job.schedule, 'status', CASE WHEN _existing_jobid IS NULL THEN 'created' ELSE 'updated' END));
                END IF;
            EXCEPTION WHEN OTHERS THEN _result := _result || jsonb_build_array(jsonb_build_object('name', _job.name, 'schedule', _job.schedule, 'status', 'error', 'error', SQLERRM));
            END; END LOOP; RETURN _result;
        END $$`);

    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION normalize_search_text(p_display_text text, p_content_text text DEFAULT NULL, p_metadata jsonb DEFAULT NULL)
            RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT trim(regexp_replace(casefold(unaccent(concat_ws(' ',
            NULLIF(p_display_text, ''), NULLIF(p_content_text, ''),
            NULLIF((SELECT string_agg(value, ' ') FROM jsonb_each_text(coalesce(p_metadata, '{}'::jsonb))), '')))), '\s+', ' ', 'g')) $$;
        CREATE TEXT SEARCH CONFIGURATION parametric_search (COPY = english);
        ALTER TEXT SEARCH CONFIGURATION parametric_search ALTER MAPPING FOR hword, hword_part, word WITH unaccent, english_stem`);

    yield* sql`
        CREATE TABLE search_documents (
            entity_type TEXT NOT NULL, entity_id UUID NOT NULL, scope_id UUID,
            display_text TEXT NOT NULL, content_text TEXT, metadata JSONB,
            normalized_text TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            document_hash TEXT GENERATED ALWAYS AS (
                to_hex(crc32c(coalesce(display_text, '') || E'\x1F' || coalesce(content_text, '') || E'\x1F' || coalesce(metadata::text, '')))
            ) STORED,
            search_vector TSVECTOR GENERATED ALWAYS AS (
                setweight(to_tsvector('parametric_search', coalesce(display_text, '')), 'A') ||
                setweight(to_tsvector('parametric_search', coalesce(content_text, '')), 'C') ||
                setweight(jsonb_to_tsvector('parametric_search', coalesce(metadata, '{}'::jsonb), '["string","numeric","boolean"]'), 'D')
            ) STORED, CONSTRAINT search_documents_pk PRIMARY KEY (entity_type, entity_id))`;
    yield* sql`
        CREATE TABLE search_embeddings (
            entity_type TEXT NOT NULL, entity_id UUID NOT NULL, scope_id UUID,
            model TEXT NOT NULL, dimensions INTEGER NOT NULL,
            embedding VECTOR(3072) NOT NULL, hash TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT search_embeddings_pk PRIMARY KEY (entity_type, entity_id),
            CONSTRAINT search_embeddings_dimensions_positive CHECK (dimensions > 0),
            CONSTRAINT search_embeddings_fk FOREIGN KEY (entity_type, entity_id) REFERENCES search_documents(entity_type, entity_id) ON DELETE CASCADE)`;
    yield* sql.unsafe(String.raw`
        CREATE INDEX idx_search_documents_vector ON search_documents USING GIN (search_vector) WITH (parallel_workers = 4);
        CREATE INDEX idx_search_documents_scope ON search_documents (scope_id, entity_type);
        CREATE INDEX idx_search_documents_scope_entity_trgm ON search_documents USING GIN (scope_id uuid_ops, entity_type text_ops, normalized_text gin_trgm_ops) WITH (parallel_workers = 4);
        CREATE INDEX idx_search_embeddings_scope ON search_embeddings (scope_id, entity_type, model, dimensions);
        CREATE INDEX idx_search_embeddings_embedding ON search_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 24, ef_construction = 200);
        DO $$ DECLARE _tbl text; BEGIN
            FOR _tbl IN SELECT unnest(ARRAY['search_documents', 'search_embeddings']) LOOP
                EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION set_updated_at()', _tbl || '_updated_at', _tbl);
            END LOOP; END $$`);

    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION _upsert_search_doc(p_et TEXT, p_eid UUID, p_sid UUID, p_d TEXT, p_c TEXT, p_m JSONB) RETURNS void LANGUAGE sql AS $$
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
            VALUES (p_et, p_eid, p_sid, p_d, p_c, p_m, normalize_search_text(p_d, p_c, p_m))
            ON CONFLICT (entity_type, entity_id) DO UPDATE SET scope_id=EXCLUDED.scope_id, display_text=EXCLUDED.display_text,
                content_text=EXCLUDED.content_text, metadata=EXCLUDED.metadata, normalized_text=EXCLUDED.normalized_text $$;
        CREATE OR REPLACE FUNCTION _delete_search_doc(p_et TEXT, p_eid UUID) RETURNS void LANGUAGE sql
            AS $$ DELETE FROM search_documents WHERE entity_type = p_et AND entity_id = p_eid $$;
        CREATE OR REPLACE FUNCTION sync_search_document() RETURNS TRIGGER AS $$
        DECLARE _et TEXT := TG_ARGV[0]; _d text; _c text; _m jsonb; _s uuid;
        BEGIN
            IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND _et <> 'auditLog' AND NEW.deleted_at IS NOT NULL) THEN
                PERFORM _delete_search_doc(_et, OLD.id); RETURN COALESCE(NEW, OLD);
            END IF;
            IF _et = 'app' THEN _s:=NULL; _d:=NEW.name; _c:=NEW.namespace; _m:=jsonb_build_object('name',NEW.name,'namespace',NEW.namespace);
            ELSIF _et = 'user' THEN _s:=NEW.app_id; _d:=NEW.email; _c:=NEW.role::text; _m:=jsonb_build_object('email',NEW.email,'role',NEW.role);
            ELSIF _et = 'asset' THEN _s:=NEW.app_id; _d:=COALESCE(NEW.name,NEW.type); _c:=NEW.content;
                _m:=jsonb_strip_nulls(jsonb_build_object('type',NEW.type,'size',NEW.size,'name',NEW.name,'hash',NEW.hash),true);
            ELSIF _et = 'auditLog' THEN _s:=NEW.app_id; _d:=NEW.target_type||':'||NEW.operation::text; _c:=NEW.target_type||' '||NEW.operation::text;
                _m:=jsonb_strip_nulls(jsonb_build_object('targetType',NEW.target_type,'operation',NEW.operation,'userId',NEW.user_id,'hasDelta',NEW.delta IS NOT NULL),true);
            END IF;
            PERFORM _upsert_search_doc(_et, NEW.id, _s, _d, _c, _m); RETURN NEW;
        END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER apps_search_upsert AFTER INSERT OR UPDATE OF name, namespace ON apps FOR EACH ROW EXECUTE FUNCTION sync_search_document('app');
        CREATE TRIGGER users_search_upsert AFTER INSERT OR UPDATE OF email, role, deleted_at ON users FOR EACH ROW WHEN (NEW.deleted_at IS NULL) EXECUTE FUNCTION sync_search_document('user');
        CREATE TRIGGER users_search_delete AFTER UPDATE OF deleted_at ON users FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL) EXECUTE FUNCTION sync_search_document('user');
        CREATE TRIGGER assets_search_upsert AFTER INSERT OR UPDATE OF content, type, name, hash, deleted_at ON assets FOR EACH ROW WHEN (NEW.deleted_at IS NULL) EXECUTE FUNCTION sync_search_document('asset');
        CREATE TRIGGER assets_search_delete AFTER UPDATE OF deleted_at ON assets FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL) EXECUTE FUNCTION sync_search_document('asset');
        CREATE TRIGGER audit_logs_search_insert AFTER INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION sync_search_document('auditLog')`);

    yield* sql.unsafe(String.raw`
        CREATE OR REPLACE FUNCTION refresh_search_documents(p_scope_id uuid DEFAULT NULL, p_include_global boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
        BEGIN
            IF p_scope_id IS NULL THEN DELETE FROM search_documents;
            ELSE DELETE FROM search_documents WHERE scope_id = p_scope_id;
                IF p_include_global THEN DELETE FROM search_documents WHERE scope_id IS NULL; END IF; END IF;
            IF p_scope_id IS NULL OR p_include_global THEN
                INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
                SELECT 'app', s.id, NULL, s.name, s.namespace, jsonb_build_object('name',s.name,'namespace',s.namespace),
                    normalize_search_text(s.name, s.namespace, jsonb_build_object('name',s.name,'namespace',s.namespace)) FROM apps s;
            END IF;
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
            SELECT 'user', s.id, s.app_id, s.email, s.role::text, jsonb_build_object('email',s.email,'role',s.role),
                normalize_search_text(s.email, s.role::text, jsonb_build_object('email',s.email,'role',s.role))
            FROM users s WHERE s.deleted_at IS NULL AND (p_scope_id IS NULL OR s.app_id = p_scope_id);
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
            SELECT 'asset', s.id, s.app_id, COALESCE(s.name,s.type), s.content,
                jsonb_strip_nulls(jsonb_build_object('type',s.type,'size',s.size,'name',s.name,'hash',s.hash),true),
                normalize_search_text(COALESCE(s.name,s.type), s.content, jsonb_strip_nulls(jsonb_build_object('type',s.type,'size',s.size,'name',s.name,'hash',s.hash),true))
            FROM assets s WHERE s.deleted_at IS NULL AND (p_scope_id IS NULL OR s.app_id = p_scope_id);
            INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
            SELECT 'auditLog', s.id, s.app_id, s.target_type||':'||s.operation::text, s.target_type||' '||s.operation::text,
                jsonb_strip_nulls(jsonb_build_object('targetType',s.target_type,'operation',s.operation,'userId',s.user_id,'hasDelta',s.delta IS NOT NULL),true),
                normalize_search_text(s.target_type||':'||s.operation::text, s.target_type||' '||s.operation::text,
                    jsonb_strip_nulls(jsonb_build_object('targetType',s.target_type,'operation',s.operation,'userId',s.user_id,'hasDelta',s.delta IS NOT NULL),true))
            FROM audit_logs s WHERE p_scope_id IS NULL OR s.app_id = p_scope_id;
            ANALYZE search_documents;
        END $$;
        CREATE OR REPLACE FUNCTION notify_search_refresh() RETURNS void LANGUAGE sql SECURITY INVOKER AS $$
            SELECT pg_notify('search_refresh', json_build_object('timestamp', extract(epoch from now()), 'event', 'refresh_complete')::text) $$;
        CREATE OR REPLACE FUNCTION get_search_suggestions(p_prefix text, p_scope_id uuid, p_include_global boolean, p_limit int DEFAULT 20)
            RETURNS TABLE(term text, frequency bigint) LANGUAGE sql STABLE SECURITY INVOKER AS $$
            SELECT word, ndoc FROM ts_stat(
                CASE WHEN p_scope_id IS NULL THEN 'SELECT search_vector FROM search_documents WHERE scope_id IS NULL'
                    WHEN p_include_global THEN format('SELECT search_vector FROM search_documents WHERE scope_id = %L OR scope_id IS NULL', p_scope_id)
                    ELSE format('SELECT search_vector FROM search_documents WHERE scope_id = %L', p_scope_id) END)
            WHERE word LIKE (regexp_replace(unaccent(casefold(p_prefix)), '([%_\\])', '\\\\\1', 'g') || '%') ESCAPE '\'
            ORDER BY ndoc DESC LIMIT LEAST(COALESCE(p_limit, 20), 100) $$`);
    yield* sql`SELECT refresh_search_documents()`;

    yield* sql.unsafe(String.raw`
        WITH tenants(app_id) AS (VALUES ('00000000-0000-7000-8000-000000000001'::uuid),('00000000-0000-7000-8000-000000000000'::uuid)),
        all_roles(role) AS (VALUES ('owner'),('admin'),('member'),('viewer'),('guest')),
        all_actions(resource, action) AS (VALUES ('auth','logout'),('auth','me'),('auth','mfaStatus'),('auth','mfaEnroll'),('auth','mfaVerify'),('auth','mfaDisable'),('auth','mfaRecover'),('auth','listApiKeys'),('auth','createApiKey'),('auth','deleteApiKey'),('auth','rotateApiKey'),('auth','linkProvider'),('auth','unlinkProvider'),
            ('users','getMe'),('users','updateProfile'),('users','deactivate'),('users','getNotificationPreferences'),('users','updateNotificationPreferences'),('users','listNotifications'),('users','subscribeNotifications'),
            ('audit','getMine'),('transfer','export'),('transfer','import'),('search','search'),('search','suggest'),('jobs','subscribe'),
            ('storage','sign'),('storage','exists'),('storage','remove'),('storage','upload'),('storage','getAsset'),('storage','createAsset'),('storage','updateAsset'),('storage','archiveAsset'),('storage','listAssets'),('websocket','connect')),
        privileged_roles(role) AS (VALUES ('owner'),('admin')),
        privileged_actions(resource, action) AS (VALUES ('users','updateRole'),('audit','getByEntity'),('audit','getByUser'),('search','refresh'),('search','refreshEmbeddings'),
            ('webhooks','list'),('webhooks','register'),('webhooks','remove'),('webhooks','test'),('webhooks','retry'),('webhooks','status'),
            ('admin','listUsers'),('admin','listSessions'),('admin','deleteSession'),('admin','revokeSessionsByIp'),('admin','listJobs'),('admin','cancelJob'),('admin','listDlq'),('admin','replayDlq'),('admin','listNotifications'),('admin','replayNotification'),('admin','events'),
            ('admin','dbIoStats'),('admin','dbIoConfig'),('admin','dbStatements'),('admin','dbCacheHitRatio'),('admin','dbWalInspect'),('admin','dbStatKcache'),('admin','dbCronJobs'),('admin','dbPartitionHealth'),('admin','dbReconcileMaintenance'),
            ('admin','listTenants'),('admin','createTenant'),('admin','getTenant'),('admin','updateTenant'),('admin','deactivateTenant'),('admin','resumeTenant'),('admin','getTenantOAuth'),('admin','updateTenantOAuth'),
            ('admin','listPermissions'),('admin','grantPermission'),('admin','revokePermission'),('admin','getFeatureFlags'),('admin','setFeatureFlag')),
        seed AS (SELECT t.app_id, r.role, a.resource, a.action FROM tenants t CROSS JOIN all_roles r CROSS JOIN all_actions a
            UNION ALL SELECT t.app_id, r.role, a.resource, a.action FROM tenants t CROSS JOIN privileged_roles r CROSS JOIN privileged_actions a)
        INSERT INTO permissions (app_id, role, resource, action) SELECT * FROM seed ON CONFLICT (app_id, role, resource, action) DO NOTHING`);
    yield* sql`SELECT reconcile_maintenance_cron_jobs()`;

    yield* sql`SELECT set_config('app.current_tenant', '00000000-0000-7000-8000-000000000001', false)`;
    yield* sql.unsafe(String.raw`DO $$ DECLARE _tbl text; BEGIN
        FOR _tbl IN SELECT unnest(ARRAY['users','permissions','sessions','session_tokens','api_keys','oauth_accounts',
            'mfa_secrets','webauthn_credentials','assets','audit_logs','jobs','notifications','job_dlq','search_documents','search_embeddings']) LOOP
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', _tbl);
            EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', _tbl);
        END LOOP;
        FOR _tbl IN SELECT unnest(ARRAY['users','permissions','sessions','assets','audit_logs','jobs','notifications','job_dlq']) LOOP
            EXECUTE format('CREATE POLICY %I ON %I USING (app_id = get_current_tenant_id()) WITH CHECK (app_id = get_current_tenant_id())', _tbl||'_tenant_isolation', _tbl);
        END LOOP;
        FOR _tbl IN SELECT unnest(ARRAY['api_keys','oauth_accounts','mfa_secrets','webauthn_credentials']) LOOP
            EXECUTE format('CREATE POLICY %I ON %I USING (user_id IN (SELECT get_tenant_user_ids())) WITH CHECK (user_id IN (SELECT get_tenant_user_ids()))', _tbl||'_tenant_isolation', _tbl);
        END LOOP;
    END $$`);
    yield* sql`
        CREATE POLICY session_tokens_tenant_isolation ON session_tokens
        USING (EXISTS (SELECT 1 FROM sessions s WHERE s.id = session_tokens.session_id AND s.app_id = get_current_tenant_id()))
        WITH CHECK (EXISTS (SELECT 1 FROM sessions s WHERE s.id = session_tokens.session_id AND s.app_id = get_current_tenant_id()))`;
    yield* sql`CREATE POLICY search_documents_tenant_isolation ON search_documents USING (scope_id IS NULL OR scope_id = get_current_tenant_id()) WITH CHECK (scope_id IS NULL OR scope_id = get_current_tenant_id())`;
    yield* sql`CREATE POLICY search_embeddings_tenant_isolation ON search_embeddings USING (scope_id IS NULL OR scope_id = get_current_tenant_id()) WITH CHECK (scope_id IS NULL OR scope_id = get_current_tenant_id())`;
});
