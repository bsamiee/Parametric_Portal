import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

// why: named constants avoid magic numbers in DDL; centralizes tuning for HNSW + embedding dimensions
const _EMBEDDING_DIMENSIONS   = 3072;
const _HNSW_M                 = 24;
const _HNSW_EF_CONSTRUCTION   = 200;
const _GIST_SIGLEN            = 64;
const _KV_FILLFACTOR          = 70;
const _LEXEME_MIN_LENGTH      = 2;
const _LEXEME_MAX_LENGTH      = 255;
const _PHONETIC_MAX_LENGTH    = 255;

const _SQL = String.raw`
-- Kargadan harness: local-only schema (PG 18.3, no pg_partman, pgvector required)

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS vector;

-- Collation
DO $$ BEGIN
    PERFORM 1 FROM pg_collation WHERE collname = 'case_insensitive';
    IF NOT FOUND THEN
        EXECUTE $sql$CREATE COLLATION case_insensitive (provider = icu, locale = 'und-u-ks-level2', deterministic = false)$sql$;
    END IF;
END $$;

-- Utility functions
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION reject_dml() RETURNS TRIGGER
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
BEGIN
    IF TG_OP = ANY(TG_ARGV) THEN
        RAISE EXCEPTION USING MESSAGE = format('Table %I: %s is prohibited', TG_TABLE_NAME, TG_OP), ERRCODE = 'restrict_violation';
    END IF;
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path = public
    AS $$ SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION purge_table(p_table text, p_column text, p_older_than_days int) RETURNS int
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE _count int;
BEGIN
    EXECUTE format('WITH purged AS (DELETE FROM %I WHERE %I IS NOT NULL AND %I < NOW() - make_interval(days => $1) RETURNING 1) SELECT COUNT(*)::int FROM purged',
        p_table, p_column, p_column) USING p_older_than_days INTO _count;
    RETURN _count;
END $$;

-- Text search configuration
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_ts_dict WHERE dictname = 'parametric_unaccent') THEN CREATE TEXT SEARCH DICTIONARY parametric_unaccent (TEMPLATE = unaccent, RULES = 'unaccent'); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'parametric_search') THEN CREATE TEXT SEARCH CONFIGURATION parametric_search (COPY = english); END IF;
END $$;
ALTER TEXT SEARCH CONFIGURATION parametric_search ALTER MAPPING FOR hword, hword_part, word WITH parametric_unaccent, english_stem;

CREATE OR REPLACE FUNCTION normalize_search_text(p_display_text text, p_content_text text DEFAULT NULL, p_metadata jsonb DEFAULT NULL)
    RETURNS text LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path = public AS $$
    SELECT trim(regexp_replace(casefold(unaccent('parametric_unaccent'::regdictionary, concat_ws(' ',
        NULLIF(p_display_text, ''), NULLIF(p_content_text, ''),
        NULLIF((SELECT string_agg(value, ' ') FROM jsonb_each_text(coalesce(p_metadata, '{}'::jsonb))), '')))), '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION _search_terms_array(p_text text) RETURNS text[]
    LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = public AS $$
    SELECT COALESCE(ARRAY(SELECT lexeme FROM unnest(tsvector_to_array(to_tsvector('simple', coalesce(p_text, '')))) AS t(lexeme)
        WHERE char_length(lexeme) BETWEEN ${_LEXEME_MIN_LENGTH} AND ${_LEXEME_MAX_LENGTH}), ARRAY[]::text[])
$$;

CREATE OR REPLACE FUNCTION _merge_search_terms(p_scope_id uuid, p_terms text[], p_delta int) RETURNS void
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
BEGIN
    IF p_terms IS NULL OR cardinality(p_terms) = 0 THEN RETURN; END IF;
    IF p_delta > 0 THEN
        INSERT INTO search_terms (scope_id, term, frequency)
            SELECT p_scope_id, term, COUNT(*)::int FROM unnest(p_terms) term GROUP BY term
            ON CONFLICT (scope_id, term) DO UPDATE SET frequency = search_terms.frequency + EXCLUDED.frequency, updated_at = now();
    ELSE
        DELETE FROM search_terms st USING (SELECT term, COUNT(*)::int AS cnt FROM unnest(p_terms) term GROUP BY term) t
            WHERE st.scope_id IS NOT DISTINCT FROM p_scope_id AND st.term = t.term AND st.frequency <= t.cnt;
        UPDATE search_terms st SET frequency = st.frequency - t.cnt, updated_at = now()
            FROM (SELECT term, COUNT(*)::int AS cnt FROM unnest(p_terms) term GROUP BY term) t
            WHERE st.scope_id IS NOT DISTINCT FROM p_scope_id AND st.term = t.term AND st.frequency > t.cnt;
    END IF;
END $$;

-- apps
CREATE TABLE IF NOT EXISTS apps (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name TEXT NOT NULL,
    namespace TEXT COLLATE case_insensitive NOT NULL,
    settings JSONB,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived', 'purging')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT apps_name_not_empty CHECK (length(trim(name)) > 0),
    CONSTRAINT apps_namespace_not_empty CHECK (length(trim(namespace)) > 0),
    CONSTRAINT apps_settings_shape CHECK (settings IS NULL OR jsonb_typeof(settings) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_apps_namespace ON apps(namespace) INCLUDE (id);
DROP TRIGGER IF EXISTS trg_apps_updated ON apps;
CREATE TRIGGER trg_apps_updated BEFORE UPDATE ON apps FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO apps (id, name, namespace) VALUES
    ('00000000-0000-7000-8000-000000000000', 'System', 'system'),
    ('00000000-0000-7000-8000-000000000001', 'Default', 'default')
    ON CONFLICT (id) DO NOTHING;

-- agent_journal
CREATE TABLE IF NOT EXISTS agent_journal (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT NOT ENFORCED,
    session_id UUID NOT NULL,
    run_id UUID NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
    entry_kind TEXT NOT NULL CHECK (entry_kind IN ('session_start', 'tool_call', 'checkpoint', 'session_complete')),
    status TEXT CHECK (status IN ('running', 'completed', 'failed', 'interrupted', 'ok', 'error')),
    operation TEXT,
    payload_json JSONB COMPRESSION lz4 NOT NULL DEFAULT '{}'::jsonb,
    state_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT agent_journal_payload_shape CHECK (jsonb_typeof(payload_json) = 'object'),
    CONSTRAINT agent_journal_status_kind_check CHECK (
        CASE entry_kind
            WHEN 'session_start' THEN status IN ('running', 'failed')
            WHEN 'session_complete' THEN status IN ('completed', 'failed', 'interrupted')
            WHEN 'tool_call' THEN status IN ('ok', 'error')
            WHEN 'checkpoint' THEN status IS NULL
        END)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_journal_session_sequence_kind ON agent_journal(session_id, sequence, entry_kind);
CREATE INDEX IF NOT EXISTS idx_agent_journal_app_session_sequence ON agent_journal(app_id, session_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_agent_journal_app_kind_created ON agent_journal(app_id, entry_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_journal_run_kind ON agent_journal(run_id, entry_kind, created_at DESC);

-- search_chunks
CREATE TABLE IF NOT EXISTS search_chunks (
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    scope_id UUID,
    display_text TEXT NOT NULL,
    content_text TEXT,
    metadata JSONB,
    normalized_text TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    document_hash TEXT GENERATED ALWAYS AS (md5(coalesce(display_text, '') || E'\x1F' || coalesce(content_text, '') || E'\x1F' || coalesce(metadata::text, ''))) STORED,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('parametric_search', coalesce(display_text, '')), 'A') ||
        setweight(to_tsvector('parametric_search', coalesce(content_text, '')), 'C') ||
        setweight(jsonb_to_tsvector('parametric_search', coalesce(metadata, '{}'::jsonb), '["string","numeric","boolean"]'), 'D')
    ) STORED,
    phonetic_daitch TEXT[] GENERATED ALWAYS AS (daitch_mokotoff(left(normalized_text, ${_PHONETIC_MAX_LENGTH}))) STORED,
    phonetic_code TEXT GENERATED ALWAYS AS (dmetaphone(left(normalized_text, ${_PHONETIC_MAX_LENGTH}))) STORED,
    embedding HALFVEC(${_EMBEDDING_DIMENSIONS}),
    model TEXT,
    dimensions INTEGER,
    embedding_hash TEXT,
    CONSTRAINT search_chunks_pk PRIMARY KEY (entity_type, entity_id),
    CONSTRAINT search_chunks_dimensions_positive CHECK (dimensions IS NULL OR dimensions > 0)
);

CREATE INDEX IF NOT EXISTS idx_search_chunks_scope ON search_chunks (scope_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_search_chunks_scope_entity_vector ON search_chunks USING GIN (scope_id uuid_ops, entity_type text_ops, search_vector);
CREATE INDEX IF NOT EXISTS idx_search_chunks_scope_entity_trgm ON search_chunks
    USING GIN (scope_id uuid_ops, entity_type text_ops, normalized_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_chunks_trgm_knn ON search_chunks USING GIST (normalized_text gist_trgm_ops(siglen=${_GIST_SIGLEN}));
CREATE INDEX IF NOT EXISTS idx_search_chunks_phonetic ON search_chunks (phonetic_code) WHERE phonetic_code <> '';
CREATE INDEX IF NOT EXISTS idx_search_chunks_phonetic_daitch ON search_chunks USING GIN (phonetic_daitch);
ALTER TABLE search_chunks ADD COLUMN IF NOT EXISTS embedding HALFVEC(${_EMBEDDING_DIMENSIONS});
CREATE INDEX IF NOT EXISTS idx_search_chunks_embedding ON search_chunks USING hnsw (embedding halfvec_cosine_ops) WITH (m = ${_HNSW_M}, ef_construction = ${_HNSW_EF_CONSTRUCTION});
CREATE INDEX IF NOT EXISTS idx_search_chunks_scope_embedding ON search_chunks (scope_id, entity_type, model, dimensions);
CREATE INDEX IF NOT EXISTS idx_search_chunks_model_dim ON search_chunks (model, dimensions) INCLUDE (entity_type, entity_id);

CREATE OR REPLACE FUNCTION sync_search_terms() RETURNS TRIGGER
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM _merge_search_terms(OLD.scope_id, _search_terms_array(OLD.normalized_text), -1); END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM _merge_search_terms(NEW.scope_id, _search_terms_array(NEW.normalized_text), 1); END IF;
    RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_search_chunks_terms ON search_chunks;
CREATE TRIGGER trg_search_chunks_terms AFTER INSERT OR UPDATE OR DELETE ON search_chunks FOR EACH ROW EXECUTE FUNCTION sync_search_terms();
DROP TRIGGER IF EXISTS trg_search_chunks_updated ON search_chunks;
CREATE TRIGGER trg_search_chunks_updated BEFORE UPDATE ON search_chunks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- search_terms
CREATE TABLE IF NOT EXISTS search_terms (
    scope_id UUID,
    term TEXT NOT NULL,
    frequency INTEGER NOT NULL CHECK (frequency > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT search_terms_scope_term_unique UNIQUE NULLS NOT DISTINCT (scope_id, term)
);
CREATE INDEX IF NOT EXISTS idx_search_terms_scope_term_trgm ON search_terms USING GIN (scope_id uuid_ops, term gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_terms_trgm_knn ON search_terms USING GIST (term gist_trgm_ops(siglen=${_GIST_SIGLEN}));
DROP TRIGGER IF EXISTS trg_search_terms_updated ON search_terms;
CREATE TRIGGER trg_search_terms_updated BEFORE UPDATE ON search_terms FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- kv_store
CREATE TABLE IF NOT EXISTS kv_store (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
) WITH (fillfactor = ${_KV_FILLFACTOR}, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
CREATE UNIQUE INDEX IF NOT EXISTS kv_store_key_unique ON kv_store(key) INCLUDE (value);
CREATE INDEX IF NOT EXISTS idx_kv_store_expires ON kv_store(expires_at) WHERE expires_at IS NOT NULL;
DROP TRIGGER IF EXISTS trg_kv_store_updated ON kv_store;
CREATE TRIGGER trg_kv_store_updated BEFORE UPDATE ON kv_store FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- effect_event_journal (durable workflow state)
CREATE TABLE IF NOT EXISTS effect_event_journal (
    id BYTEA PRIMARY KEY,
    event TEXT NOT NULL,
    primary_key TEXT NOT NULL UNIQUE,
    payload BYTEA COMPRESSION lz4 NOT NULL,
    timestamp BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_journal_timestamp ON effect_event_journal USING BRIN (timestamp);
CREATE INDEX IF NOT EXISTS idx_event_journal_event ON effect_event_journal (event);
DROP TRIGGER IF EXISTS event_journal_no_update ON effect_event_journal;
CREATE TRIGGER event_journal_no_update BEFORE UPDATE ON effect_event_journal FOR EACH ROW EXECUTE FUNCTION reject_dml('UPDATE');

CREATE TABLE IF NOT EXISTS effect_event_remotes (
    remote_id TEXT NOT NULL,
    entry_id BYTEA NOT NULL REFERENCES effect_event_journal(id) ON DELETE CASCADE,
    sequence BIGINT NOT NULL,
    PRIMARY KEY (remote_id, entry_id)
);

-- Multicolumn statistics (PG 18+) — explicit kinds: ndistinct + dependencies for correlated filter pairs, mcv only where cardinality is bounded
CREATE STATISTICS IF NOT EXISTS stat_agent_journal_session_sequence (ndistinct, dependencies) ON session_id, sequence FROM agent_journal;
CREATE STATISTICS IF NOT EXISTS stat_search_chunks_scope_entity (ndistinct, dependencies, mcv) ON scope_id, entity_type FROM search_chunks;
CREATE STATISTICS IF NOT EXISTS stat_search_terms_scope_term (ndistinct, dependencies) ON scope_id, term FROM search_terms;
`;

// --- [FUNCTIONS] -------------------------------------------------------------

const run = Effect.fn('kargadan.migration.run')(
    () => SqlClient.SqlClient.pipe(
        Effect.flatMap((sql) => sql.unsafe(_SQL).pipe(Effect.zipRight(Effect.forEach([
            `VACUUM (ANALYZE, BUFFER_USAGE_LIMIT '256MB') agent_journal`, `VACUUM (ANALYZE, BUFFER_USAGE_LIMIT '256MB') search_chunks`,
            `VACUUM (ANALYZE, BUFFER_USAGE_LIMIT '256MB') search_terms`, `VACUUM (ANALYZE) kv_store`,
        ], (statement) => sql.unsafe(statement), { discard: true })))),
        Effect.tap(() => Effect.logInfo('kargadan.migration.completed')),
    ),
);

// --- [EXPORT] ----------------------------------------------------------------

export { run };
