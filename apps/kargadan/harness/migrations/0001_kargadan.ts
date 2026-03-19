import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _KV_FILLFACTOR = 70;
const _SQL = String.raw`
-- Kargadan harness: runtime schema (PG 18.3)

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS unaccent;

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

CREATE TEXT SEARCH DICTIONARY IF NOT EXISTS parametric_unaccent (TEMPLATE = unaccent, RULES = 'unaccent');
CREATE TEXT SEARCH CONFIGURATION IF NOT EXISTS parametric_search (COPY = english);
ALTER TEXT SEARCH CONFIGURATION parametric_search ALTER MAPPING FOR hword, hword_part, word WITH parametric_unaccent, english_stem;
CREATE OR REPLACE FUNCTION normalize_search_text(p_display_text text, p_content_text text DEFAULT NULL, p_metadata jsonb DEFAULT NULL)
    RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT trim(regexp_replace(casefold(unaccent('parametric_unaccent'::regdictionary, concat_ws(' ',
        NULLIF(p_display_text, ''), NULLIF(p_content_text, ''),
        NULLIF((SELECT string_agg(value, ' ') FROM jsonb_each_text(coalesce(p_metadata, '{}'::jsonb))), '')))), '\s+', ' ', 'g')) $$;

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
        END
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_journal_session_sequence_kind ON agent_journal(session_id, sequence, entry_kind);
CREATE INDEX IF NOT EXISTS idx_agent_journal_app_session_sequence ON agent_journal(app_id, session_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_agent_journal_app_kind_created ON agent_journal(app_id, entry_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_journal_run_kind ON agent_journal(run_id, entry_kind, created_at DESC);

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

-- search_documents
CREATE TABLE IF NOT EXISTS search_documents (
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    scope_id UUID,
    display_text TEXT NOT NULL,
    content_text TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    normalized_text TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    document_hash TEXT GENERATED ALWAYS AS (
        to_hex(crc32c(coalesce(display_text, '') || E'\x1F' || coalesce(content_text, '') || E'\x1F' || coalesce(metadata::text, '')))
    ) STORED,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('parametric_search', coalesce(display_text, '')), 'A') ||
        setweight(to_tsvector('parametric_search', coalesce(content_text, '')), 'C') ||
        setweight(jsonb_to_tsvector('parametric_search', coalesce(metadata, '{}'::jsonb), '["string","numeric","boolean"]'), 'D')
    ) STORED,
    phonetic_daitch TEXT[] GENERATED ALWAYS AS (daitch_mokotoff(left(normalized_text, 255))) STORED,
    phonetic_code TEXT GENERATED ALWAYS AS (dmetaphone(left(normalized_text, 255))) STORED,
    CONSTRAINT search_documents_pk PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_search_documents_scope ON search_documents (scope_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_search_documents_scope_entity_vector ON search_documents USING GIN (scope_id uuid_ops, entity_type text_ops, search_vector) WITH (parallel_workers = 4);
CREATE INDEX IF NOT EXISTS idx_search_documents_scope_entity_trgm ON search_documents
    USING GIN (scope_id uuid_ops, entity_type text_ops, normalized_text gin_trgm_ops) WITH (parallel_workers = 4);
CREATE INDEX IF NOT EXISTS idx_search_documents_trgm_knn ON search_documents USING GIST (normalized_text gist_trgm_ops(siglen=64));
CREATE INDEX IF NOT EXISTS idx_search_documents_phonetic ON search_documents (phonetic_code) WHERE phonetic_code <> '';
CREATE INDEX IF NOT EXISTS idx_search_documents_phonetic_daitch ON search_documents USING GIN (phonetic_daitch);
DROP TRIGGER IF EXISTS trg_search_documents_updated ON search_documents;
CREATE TRIGGER trg_search_documents_updated BEFORE UPDATE ON search_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- search_embeddings
CREATE TABLE IF NOT EXISTS search_embeddings (
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    embedding HALFVEC NOT NULL,
    embedding_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT search_embeddings_pk PRIMARY KEY (entity_type, entity_id, provider, model, dimensions),
    CONSTRAINT search_embeddings_dimensions_positive CHECK (dimensions > 0),
    CONSTRAINT search_embeddings_dimension_match CHECK (halfvec_dims(embedding) = dimensions),
    CONSTRAINT search_embeddings_document_fk FOREIGN KEY (entity_type, entity_id)
        REFERENCES search_documents(entity_type, entity_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_search_embeddings_profile ON search_embeddings (provider, model, dimensions) INCLUDE (entity_type, entity_id, embedding_hash);
CREATE INDEX IF NOT EXISTS idx_search_embeddings_openai_3_small ON search_embeddings
    USING hnsw ((embedding::halfvec(1536)) halfvec_ip_ops)
    WITH (m = 24, ef_construction = 200)
    WHERE provider = 'openai' AND model = 'text-embedding-3-small' AND dimensions = 1536;
CREATE INDEX IF NOT EXISTS idx_search_embeddings_openai_3_large ON search_embeddings
    USING hnsw ((embedding::halfvec(3072)) halfvec_ip_ops)
    WITH (m = 24, ef_construction = 200)
    WHERE provider = 'openai' AND model = 'text-embedding-3-large' AND dimensions = 3072;
CREATE INDEX IF NOT EXISTS idx_search_embeddings_gemini_001 ON search_embeddings
    USING hnsw ((embedding::halfvec(3072)) halfvec_ip_ops)
    WITH (m = 24, ef_construction = 200)
    WHERE provider = 'gemini' AND model = 'gemini-embedding-001' AND dimensions = 3072;
CREATE INDEX IF NOT EXISTS idx_search_embeddings_openai_3_large_mrl ON search_embeddings
    USING hnsw ((embedding::halfvec(1024)) halfvec_ip_ops)
    WITH (m = 16, ef_construction = 128)
    WHERE provider = 'openai' AND model = 'text-embedding-3-large' AND dimensions = 3072;
CREATE INDEX IF NOT EXISTS idx_search_embeddings_gemini_001_mrl ON search_embeddings
    USING hnsw ((embedding::halfvec(1024)) halfvec_ip_ops)
    WITH (m = 16, ef_construction = 128)
    WHERE provider = 'gemini' AND model = 'gemini-embedding-001' AND dimensions = 3072;
DROP TRIGGER IF EXISTS trg_search_embeddings_updated ON search_embeddings;
CREATE TRIGGER trg_search_embeddings_updated BEFORE UPDATE ON search_embeddings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- search_terms
CREATE TABLE IF NOT EXISTS search_terms (
    scope_id UUID,
    term TEXT NOT NULL,
    frequency INTEGER NOT NULL CHECK (frequency > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT search_terms_scope_term_unique UNIQUE NULLS NOT DISTINCT (scope_id, term)
);
CREATE INDEX IF NOT EXISTS idx_search_terms_scope_term_trgm ON search_terms USING GIN (scope_id uuid_ops, term gin_trgm_ops) WITH (parallel_workers = 4);
CREATE INDEX IF NOT EXISTS idx_search_terms_trgm_knn ON search_terms USING GIST (term gist_trgm_ops(siglen=64));

CREATE OR REPLACE FUNCTION _search_terms_array(p_text text) RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT COALESCE(ARRAY(SELECT lexeme FROM unnest(tsvector_to_array(to_tsvector('simple', coalesce(p_text, '')))) AS t(lexeme)
        WHERE char_length(lexeme) BETWEEN 2 AND 255), ARRAY[]::text[]) $$;
CREATE OR REPLACE FUNCTION _merge_search_terms(p_scope_id uuid, p_terms text[], p_delta int) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF p_terms IS NULL OR cardinality(p_terms) = 0 THEN RETURN; END IF;
    IF p_delta > 0 THEN
        INSERT INTO search_terms (scope_id, term, frequency)
        SELECT p_scope_id, term, COUNT(*)::int
        FROM unnest(p_terms) term
        GROUP BY term
        ON CONFLICT (scope_id, term) DO UPDATE
        SET frequency = search_terms.frequency + EXCLUDED.frequency, updated_at = clock_timestamp();
    ELSE
        UPDATE search_terms st
        SET frequency = st.frequency - t.cnt, updated_at = clock_timestamp()
        FROM (SELECT term, COUNT(*)::int AS cnt FROM unnest(p_terms) term GROUP BY term) t
        WHERE st.scope_id IS NOT DISTINCT FROM p_scope_id AND st.term = t.term;
        DELETE FROM search_terms st WHERE st.scope_id IS NOT DISTINCT FROM p_scope_id AND st.frequency <= 0;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION sync_search_terms() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM _merge_search_terms(OLD.scope_id, _search_terms_array(OLD.normalized_text), -1); END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM _merge_search_terms(NEW.scope_id, _search_terms_array(NEW.normalized_text), 1); END IF;
    RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS search_documents_terms_sync ON search_documents;
CREATE TRIGGER search_documents_terms_sync AFTER INSERT OR DELETE ON search_documents FOR EACH ROW EXECUTE FUNCTION sync_search_terms();
DROP TRIGGER IF EXISTS search_documents_terms_sync_update ON search_documents;
CREATE TRIGGER search_documents_terms_sync_update AFTER UPDATE ON search_documents FOR EACH ROW
    WHEN (OLD.scope_id IS DISTINCT FROM NEW.scope_id OR OLD.normalized_text IS DISTINCT FROM NEW.normalized_text) EXECUTE FUNCTION sync_search_terms();

CREATE OR REPLACE FUNCTION refresh_search_documents()
    RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    ANALYZE search_documents;
    ANALYZE search_embeddings;
    ANALYZE search_terms;
END $$;
CREATE OR REPLACE FUNCTION notify_search_refresh() RETURNS void LANGUAGE sql SECURITY INVOKER AS $$
    SELECT pg_notify('search_refresh', json_build_object('timestamp', extract(epoch from now()), 'event', 'refresh_complete')::text) $$;
CREATE OR REPLACE FUNCTION get_search_suggestions(p_prefix text, p_scope_id uuid, p_include_global boolean, p_limit int DEFAULT 20)
    RETURNS TABLE(term text, frequency bigint) LANGUAGE sql STABLE SECURITY INVOKER AS $$
    WITH normalized AS (
        SELECT source.prefix,
            regexp_replace(source.prefix, '([%_\\])', '\\\\\1', 'g') AS escaped_prefix,
            LEAST(COALESCE(p_limit, 20), 100) AS max_limit
        FROM (SELECT left(normalize_search_text(p_prefix, NULL, NULL), 255) AS prefix) source),
    scoped_terms AS (
        SELECT st.term, st.frequency, n.prefix, n.escaped_prefix FROM search_terms st CROSS JOIN normalized n
        WHERE CASE WHEN p_scope_id IS NULL THEN st.scope_id IS NULL
            WHEN p_include_global THEN st.scope_id = p_scope_id OR st.scope_id IS NULL
            ELSE st.scope_id = p_scope_id END),
    prefix_hits AS (
        SELECT term, SUM(frequency)::bigint AS frequency FROM scoped_terms WHERE term LIKE (escaped_prefix || '%') ESCAPE '\\'
        GROUP BY term ORDER BY frequency DESC, term ASC LIMIT (SELECT max_limit FROM normalized)),
    fuzzy_candidates AS (
        SELECT term, frequency, levenshtein_less_equal(left(term, 255), left(prefix, 255), 2) AS lev,
            term <-> prefix AS similarity_distance, prefix <<-> term AS word_distance, prefix <<<-> term AS strict_word_distance
        FROM scoped_terms WHERE char_length(prefix) >= 2 AND (term % prefix OR prefix <% term OR prefix <<% term)
        ORDER BY similarity_distance ASC, word_distance ASC, strict_word_distance ASC, frequency DESC, term ASC
        LIMIT (SELECT max_limit * 4 FROM normalized)),
    fuzzy_hits AS (
        SELECT term, SUM(frequency)::bigint AS frequency FROM fuzzy_candidates WHERE lev <= 2
            AND NOT EXISTS (SELECT 1 FROM prefix_hits p WHERE p.term = fuzzy_candidates.term)
        GROUP BY term ORDER BY MIN(lev) ASC, MIN(similarity_distance) ASC, MIN(word_distance) ASC,
            MIN(strict_word_distance) ASC, SUM(frequency) DESC, term ASC
        LIMIT (SELECT max_limit FROM normalized)),
    merged AS (SELECT term, frequency, 0 AS bucket FROM prefix_hits UNION ALL SELECT term, frequency, 1 AS bucket FROM fuzzy_hits)
    SELECT term, frequency FROM merged ORDER BY bucket ASC, frequency DESC, term ASC LIMIT (SELECT max_limit FROM normalized) $$;

-- Multicolumn statistics
CREATE STATISTICS IF NOT EXISTS stat_agent_journal_session_sequence (ndistinct, dependencies) ON session_id, sequence FROM agent_journal;
ALTER TABLE search_documents ALTER COLUMN entity_type SET STATISTICS 500;
ALTER TABLE search_embeddings ALTER COLUMN provider SET STATISTICS 500;
CREATE STATISTICS IF NOT EXISTS stat_search_documents_scope_entity (ndistinct, dependencies) ON scope_id, entity_type FROM search_documents;
CREATE STATISTICS IF NOT EXISTS stat_search_embeddings_profile_entity (ndistinct, dependencies) ON provider, model, dimensions, entity_type FROM search_embeddings;
`;

// --- [EXPORT] ----------------------------------------------------------------

// why: PgMigrator expects default export of Effect<void, MigrationError, SqlClient>
// biome-ignore lint/style/noDefaultExport: PgMigrator contract
export default SqlClient.SqlClient.pipe(
    Effect.flatMap((sql) => sql.unsafe(_SQL)),
    Effect.tap(() => Effect.logInfo('kargadan.migration.0001.completed')),
    Effect.asVoid,
);
