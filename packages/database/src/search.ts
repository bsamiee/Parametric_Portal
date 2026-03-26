import { SqlClient, SqlSchema, type Statement } from '@effect/sql';
import { Array as A, Data, Duration, Effect, Layer, Option, Schema as S, String as Str } from 'effect';
import { Client } from './client.ts';
import { Page } from './page.ts';

// --- [TYPES] -----------------------------------------------------------------

type _Strat = { w: number; tbl?: string; flt?: string; ord?: 'ASC'; score?: string | null };
type _EmbedOpts = { readonly entityTypes?: readonly string[] | undefined; readonly includeGlobal?: boolean | undefined; readonly limit?: number | undefined; readonly profile: EmbeddingProfile; readonly scopeId?: string | null | undefined };

// --- [ERRORS] ----------------------------------------------------------------

class SearchError extends Data.TaggedError('SearchError')<{
    readonly reason: 'embeddingDimensions' | 'query' | 'staleEmbeddings' | 'upsert' | 'unknown';
    readonly cause?: unknown; readonly operation?: string; readonly details?: unknown;
}> {}

// --- [CONSTANTS] -------------------------------------------------------------

const _cfg = {
    docsTable: 'search_documents',
    embeddingsTable: 'search_embeddings',
    fuzzy: { maxDist: 2, maxLen: 255, minLen: 4 },
    limits: { candidate: 300, default: 20, embedBatch: 200, max: 100, suggestDefault: 10, suggestMax: 20, termMax: 256, termMin: 2 },
    phonetic: { minLen: 3 }, rank: 32, refreshMin: 5, regconfig: 'parametric_search',
    rrf: {
        k: 60,
        strategies: {
            fts:                  { w: 0.3 },  fuzzy:                { ord: 'ASC' as const, score: 'fuzzy_distance', w: 0.08 },
            phonetic:             { score: null, w: 0.02 },          semantic:             { w: 0.2 },
            trgm_knn_similarity:  { w: 0.05 },                      trgm_knn_strict_word: { w: 0.02 },
            trgm_knn_word:        { w: 0.03 },
            trgm_similarity:      { flt: 'trgm_similarity_match',  tbl: 'trgm_candidates', w: 0.15 },
            trgm_strict_word:     { flt: 'trgm_strict_word_match', tbl: 'trgm_candidates', w: 0.05 },
            trgm_word:            { flt: 'trgm_word_match',        tbl: 'trgm_candidates', w: 0.1  },
        },
    },
    snippet: { delim: ' ... ', frags: 3, maxW: 50, minW: 20, start: '<mark>', stop: '</mark>' },
    trigram: { minLen: 2 }, vector: { efSearch: 120, maxTuples: 40_000, memMult: 2, mode: 'relaxed_order' as const },
} as const;
const _snippetOpts = `MaxWords=${_cfg.snippet.maxW},MinWords=${_cfg.snippet.minW},MaxFragments=${_cfg.snippet.frags},FragmentDelimiter=${_cfg.snippet.delim},StartSel=${_cfg.snippet.start},StopSel=${_cfg.snippet.stop}`;
const _reasonByOperation = {
    embeddingSources: 'staleEmbeddings',
    profileFingerprint: 'staleEmbeddings',
    pruneEmbeddings: 'staleEmbeddings',
    refresh: 'query',
    search: 'query',
    staleEmbeddings: 'staleEmbeddings',
    suggest: 'query',
    upsertDocument: 'upsert',
    upsertEmbedding: 'upsert',
} as const satisfies Record<string, SearchError['reason']>;

// --- [SCHEMA] ----------------------------------------------------------------

const _SearchEntityId = S.UUID.pipe(S.brand('SearchEntityId')) as unknown as S.Schema<string, string, never>;
const _SearchScopeId  = S.UUID.pipe(S.brand('SearchScopeId')) as unknown as S.Schema<string, string, never>;
const _scopeFields    = { includeGlobal: S.Boolean, scopeId: S.NullOr(_SearchScopeId) };
const _entityFilter   = { entityTypes: S.Array(S.String), ..._scopeFields };
const _EmbeddingProfileFields = {
    dimensions: S.Literal(1_536),
    provider: S.Literal('gemini', 'openai'),
};
const _embeddingProfileSchema = S.Struct(_EmbeddingProfileFields);
const _EmbedRequestSchema = S.Struct({
    ..._EmbeddingProfileFields,
    ..._entityFilter,
    limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_cfg.limits.embedBatch)),
});
const _SearchRequestSchema = S.Struct({
    cursorId: S.optional(_SearchEntityId),
    cursorRank: S.optional(S.Number),
    dimensions: S.optional(S.Literal(1_536)),
    embeddingJson: S.optional(S.String),
    entityTypes: S.Array(S.String),
    includeFacets: S.Boolean,
    includeGlobal: S.Boolean,
    includeSnippets: S.Boolean,
    limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_cfg.limits.max)),
    provider: S.optional(S.Literal('gemini', 'openai')),
    scopeId: S.NullOr(_SearchScopeId),
    term: S.String.pipe(S.minLength(_cfg.limits.termMin), S.maxLength(_cfg.limits.termMax)),
}).pipe(S.mutable);
const _UpsertEmbeddingSchema = S.Struct({
    ..._EmbeddingProfileFields,
    documentHash: S.String,
    embeddingJson: S.String,
    entityId: _SearchEntityId,
    entityType: S.String,
});
const _ProfileFingerprintSchema = S.Struct({
    ..._EmbeddingProfileFields,
    sourceHash: S.String,
});
type EmbeddingProfile = typeof _embeddingProfileSchema.Type;
type EmbeddingInput = { readonly profile: EmbeddingProfile; readonly vector: readonly number[] };
type _EmbedRequest = typeof _EmbedRequestSchema.Type;
type _SearchRequest = typeof _SearchRequestSchema.Type;

// --- [FUNCTIONS] -------------------------------------------------------------

const _clamp  = (value: number | undefined, fallback: number, max: number) => Math.min(Math.max(value ?? fallback, 1), max);
const _errorDetails = (cause: unknown) => typeof cause === 'object' && cause !== null ? {
    code: 'code' in cause ? cause.code : undefined,
    constraint: 'constraint' in cause ? cause.constraint : undefined,
    detail: 'detail' in cause ? cause.detail : undefined,
    message: 'message' in cause ? cause.message : undefined,
    schema: 'schema' in cause ? cause.schema : undefined,
    table: 'table' in cause ? cause.table : undefined,
} : undefined;
const _mapErr = (operation: string) => Effect.mapError((cause: unknown) => cause instanceof SearchError ? cause : new SearchError({
    cause,
    details: _errorDetails(cause),
    operation,
    reason: operation in _reasonByOperation ? _reasonByOperation[operation as keyof typeof _reasonByOperation] : 'unknown',
}));
const _spreadEmbedOpts = (options: _EmbedOpts): _EmbedRequest => ({
    dimensions: options.profile.dimensions, entityTypes: options.entityTypes ?? [], includeGlobal: options.includeGlobal ?? false,
    limit: _clamp(options.limit, _cfg.limits.embedBatch, _cfg.limits.embedBatch), provider: options.profile.provider, scopeId: options.scopeId ?? null,
});

// --- [SERVICES] --------------------------------------------------------------

class SearchRepo extends Effect.Service<SearchRepo>()('database/Search', {
    effect: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const _filters = (input: { readonly entityTypes: readonly string[]; readonly includeGlobal: boolean; readonly scopeId: string | null }, alias = 'documents') => {
            const col = (name: string) => sql`${sql(alias)}.${sql(name)}`;
            const predicates = A.getSomes([
                Option.fromNullable(input.scopeId).pipe(Option.map((scopeId) => input.includeGlobal ? sql`(${col('scope_id')} = ${scopeId}::uuid OR ${col('scope_id')} IS NULL)` : sql`${col('scope_id')} = ${scopeId}::uuid`), Option.orElse(() => Option.some(sql`${col('scope_id')} IS NULL`))),
                Option.liftPredicate(input.entityTypes, (entityTypes) => entityTypes.length > 0).pipe(Option.map((entityTypes) => sql`${col('entity_type')} IN ${sql.in(entityTypes)}`)),
            ]);
            return A.match(predicates, { onEmpty: () => sql`TRUE`, onNonEmpty: (items) => sql.and(items) });
        };
        const _embeddingPayload = (input: EmbeddingInput) =>
            S.decode(_embeddingProfileSchema)(input.profile).pipe(
                Effect.flatMap((profile) => S.decode(S.Array(S.Number).pipe(S.itemsCount(profile.dimensions)))(input.vector).pipe(
                    Effect.map((vector) => ({ embeddingJson: JSON.stringify(vector), profile })),
                    Effect.mapError(() => new SearchError({ details: { dimensions: profile.dimensions, length: input.vector.length }, reason: 'embeddingDimensions' })),
                )),
            );
        const _distance = (alias: string, embeddingJson: string): Statement.Fragment =>
            sql`${sql(alias)}.embedding <#> (${embeddingJson})::halfvec(1536)`;
        const _embeddingHash = (
            input: { readonly dimensions: number; readonly provider: 'gemini' | 'openai' },
            source: Statement.Fragment,
        ): Statement.Fragment => sql`search_embedding_profile_hash(${source}, ${input.provider}, ${input.dimensions})`;
        const _profileMatch = (
            input: { readonly dimensions: number; readonly provider: 'gemini' | 'openai' },
            alias = 'embeddings',
        ): Statement.Fragment => sql`${sql(alias)}.provider = ${input.provider} AND ${sql(alias)}.dimensions = ${input.dimensions}`;
        const _staleProfile = (
            input: { readonly dimensions: number; readonly provider: 'gemini' | 'openai' },
            profileHash: Statement.Fragment,
            alias = 'embeddings',
        ): Statement.Fragment => sql`NOT (${_profileMatch(input, alias)}) OR ${sql(alias)}.embedding_hash IS DISTINCT FROM ${profileHash}`;
        const _buildCtes = (input: { readonly embeddingJson?: string; readonly entityTypes: readonly string[]; readonly includeGlobal: boolean; readonly profile?: EmbeddingProfile; readonly scopeId: string | null; readonly term: string }) => {
            const strategyKeys = Object.keys(_cfg.rrf.strategies) as ReadonlyArray<keyof typeof _cfg.rrf.strategies>;
            const scoreColumns = Object.fromEntries(strategyKeys.map((key) => {
                const strategy = _cfg.rrf.strategies[key] as _Strat;
                return [key, 'score' in strategy ? strategy.score : `${key}_score`];
            })) as Record<keyof typeof _cfg.rrf.strategies, string | null>;
            const where = _filters(input);
            const embedding = Option.all({
                embeddingJson: Option.fromNullable(input.embeddingJson),
                profile:       Option.fromNullable(input.profile),
            });
            const hasEmbedding = Option.isSome(embedding);
            const profileHash = Option.match(embedding, {
                onNone: () => sql`NULL`,
                onSome: ({ profile }) => _embeddingHash(profile, sql`documents.embedding_input_hash`),
            });
            const normalized = sql`left(normalize_search_text(${input.term}, NULL, NULL), ${_cfg.fuzzy.maxLen})`;
            const query = sql`websearch_to_tsquery(${_cfg.regconfig}::regconfig, ${input.term})`;
            const trgmKnnCtes = ([['similarity', '<->'], ['word', '<<->'], ['strictWord', '<<<->']] as const).map(([key, operator]) => {
                const snake = `trgm_knn_${Str.camelToSnake(key)}`;
                const distance = sql.unsafe(`documents.normalized_text ${operator} `) as unknown as Statement.Fragment;
                return sql`${sql.literal(snake)}_candidates AS (SELECT documents.entity_type, documents.entity_id, documents.normalized_text, ${1} - (${distance}${normalized}) AS ${sql.literal(`${snake}_score`)} FROM ${sql(_cfg.docsTable)} documents WHERE ${where} AND char_length(${normalized}) >= ${_cfg.trigram.minLen} ORDER BY ${distance}${normalized}, documents.entity_id DESC LIMIT ${_cfg.limits.candidate})`;
            });
            const semanticCte = Option.match(embedding, {
                onNone: () => sql``,
                onSome: ({ embeddingJson, profile }) => sql`, semantic_candidates AS (
                    SELECT embeddings.entity_type, embeddings.entity_id, -(${_distance('embeddings', embeddingJson)}) AS semantic_score
                    FROM ${sql(_cfg.embeddingsTable)} embeddings JOIN ${sql(_cfg.docsTable)} documents ON documents.entity_type = embeddings.entity_type AND documents.entity_id = embeddings.entity_id
                    WHERE ${where} AND ${_profileMatch(profile)} AND embeddings.embedding_hash = ${profileHash}
                    ORDER BY ${_distance('embeddings', embeddingJson)}, embeddings.entity_id DESC LIMIT ${_cfg.limits.candidate})`,
            });
            const activeKeys = strategyKeys.filter((key) => key !== 'semantic' || hasEmbedding);
            const rankedCtes = activeKeys.map((key) => {
                const strategy = _cfg.rrf.strategies[key] as _Strat;
                const table = strategy.tbl ?? `${key}_candidates`;
                const score = scoreColumns[key];
                const ordering = score ? `${score} ${strategy.ord ?? 'DESC'} NULLS LAST, entity_id DESC` : 'entity_id DESC';
                const filter = key === 'fuzzy' ? `fuzzy_distance <= ${_cfg.fuzzy.maxDist}` : strategy.flt;
                return sql`${sql.literal(key)}_ranked AS (SELECT entity_type, entity_id, ROW_NUMBER() OVER (ORDER BY ${sql.unsafe(ordering)}) AS ${sql.literal(`${key}_rank`)} FROM ${sql.literal(table)}${filter ? sql` WHERE ${sql.unsafe(filter)}` : sql``})`;
            });
            const union = activeKeys.map((key, index) => `${index === 0 ? '' : 'UNION ALL '}SELECT entity_type, entity_id, '${key}' AS source, ${key}_rank AS rnk FROM ${key}_ranked`).join('\n');
            const activeWeight = activeKeys.reduce((sum, key) => sum + (_cfg.rrf.strategies[key] as _Strat).w, 0) || 1;
            const score = activeKeys.map((key) => `COALESCE(SUM(1.0 / (${_cfg.rrf.k} + rnk)) FILTER (WHERE source = '${key}'), 0) * ${(_cfg.rrf.strategies[key] as _Strat).w}`).join(' + ');
            return {
                ctes: sql`
                    fts_candidates AS (
                        SELECT documents.entity_type, documents.entity_id, ts_rank_cd(documents.search_vector, ${query}, ${_cfg.rank}) AS fts_score
                        FROM ${sql(_cfg.docsTable)} documents WHERE ${where} AND documents.search_vector @@ ${query}
                        ORDER BY fts_score DESC NULLS LAST, documents.entity_id DESC LIMIT ${_cfg.limits.candidate}),
                    trgm_candidates AS (
                        SELECT documents.entity_type, documents.entity_id, documents.normalized_text,
                            similarity(documents.normalized_text, ${normalized}) AS trgm_similarity_score, word_similarity(${normalized}, documents.normalized_text) AS trgm_word_score, strict_word_similarity(${normalized}, documents.normalized_text) AS trgm_strict_word_score,
                            documents.normalized_text % ${normalized} AS trgm_similarity_match, ${normalized} <% documents.normalized_text AS trgm_word_match, ${normalized} <<% documents.normalized_text AS trgm_strict_word_match
                        FROM ${sql(_cfg.docsTable)} documents
                        WHERE ${where} AND char_length(${normalized}) >= ${_cfg.trigram.minLen} AND (documents.normalized_text % ${normalized} OR ${normalized} <% documents.normalized_text OR ${normalized} <<% documents.normalized_text)
                        ORDER BY GREATEST(trgm_similarity_score, trgm_word_score, trgm_strict_word_score) DESC NULLS LAST, documents.entity_id DESC LIMIT ${_cfg.limits.candidate}),
                    ${sql.csv(trgmKnnCtes)},
                    fuzzy_candidates AS (
                        SELECT knn.entity_type, knn.entity_id, levenshtein_less_equal(left(knn.normalized_text, ${_cfg.fuzzy.maxLen}), ${normalized}, ${_cfg.fuzzy.maxDist}) AS fuzzy_distance
                        FROM trgm_knn_similarity_candidates knn WHERE char_length(${normalized}) >= ${_cfg.fuzzy.minLen}
                        ORDER BY fuzzy_distance ASC NULLS LAST, knn.entity_id DESC LIMIT ${_cfg.limits.candidate}),
                    phonetic_candidates AS (
                        SELECT metaphone.entity_type, metaphone.entity_id FROM (
                            SELECT documents.entity_type, documents.entity_id FROM ${sql(_cfg.docsTable)} documents
                            WHERE char_length(${normalized}) >= ${_cfg.phonetic.minLen} AND ${where} AND documents.phonetic_code = dmetaphone(${normalized})
                            ORDER BY documents.entity_id DESC LIMIT ${_cfg.limits.candidate}) metaphone
                        UNION
                        SELECT daitch.entity_type, daitch.entity_id FROM (
                            SELECT documents.entity_type, documents.entity_id FROM ${sql(_cfg.docsTable)} documents
                            WHERE char_length(${normalized}) >= ${_cfg.trigram.minLen} AND ${where} AND documents.phonetic_daitch && daitch_mokotoff(${normalized})
                            ORDER BY documents.entity_id DESC LIMIT ${_cfg.limits.candidate}) daitch)
                    ${semanticCte},
                    ${sql.csv(rankedCtes)},
                    ranked AS (${sql.unsafe(union)}),
                    scored AS (SELECT entity_type, entity_id, (${sql.unsafe(`(${score}) / ${activeWeight}`)})::float8 AS rank FROM ranked GROUP BY entity_type, entity_id)
                `,
                query,
            };
        };
const _searchInput = (options: { readonly entityTypes?: readonly string[] | undefined; readonly includeFacets?: boolean | undefined; readonly includeGlobal?: boolean | undefined; readonly includeSnippets?: boolean | undefined; readonly scopeId: string | null; readonly term: string }, limit: number, cursor: Option.Option<{ id: string; v: number }>, embedding: Option.Option<{ embeddingJson: string; profile: EmbeddingProfile }>): _SearchRequest => ({
            entityTypes: options.entityTypes ?? [], includeFacets: options.includeFacets ?? false, includeGlobal: options.includeGlobal ?? false, includeSnippets: options.includeSnippets ?? true, limit, scopeId: options.scopeId, term: options.term,
            ...Option.getOrUndefined(Option.map(cursor, (value) => ({ cursorId: value.id, cursorRank: value.v }))),
            ...Option.getOrUndefined(Option.map(embedding, (e) => ({ dimensions: e.profile.dimensions, embeddingJson: e.embeddingJson, provider: e.profile.provider }))),
        });
        const executeSearch = SqlSchema.findAll({
            execute: (input: _SearchRequest) => {
                const cursor = input.cursorRank !== undefined && input.cursorId !== undefined ? sql`WHERE (paged.rank, paged.entity_id) < (${input.cursorRank}, ${input.cursorId}::uuid)` : sql``;
                const { ctes, query } = _buildCtes({ entityTypes: input.entityTypes, includeGlobal: input.includeGlobal, scopeId: input.scopeId, term: input.term,
                    ...Option.getOrUndefined(Option.map(Option.fromNullable(input.embeddingJson), (embeddingJson) => ({ embeddingJson }))),
                    ...Option.getOrUndefined(
                        S.decodeUnknownOption(_embeddingProfileSchema)({
                            dimensions: input.dimensions,
                            provider: input.provider,
                        }).pipe(Option.map((profile) => ({ profile }))),
                    ),
                });
                const snippet = input.includeSnippets
                    ? sql`ts_headline(${_cfg.regconfig}::regconfig, coalesce(documents.display_text, '') || ' ' || coalesce(documents.content_text, '') || ' ' || coalesce((SELECT string_agg(value, ' ') FROM jsonb_each_text(coalesce(documents.metadata, '{}'::jsonb))), ''), ${query}, ${_snippetOpts})`
                    : sql`NULL`;
                const facets = input.includeFacets ? sql`(SELECT jsonb_object_agg(entity_type, cnt) FROM (SELECT entity_type, COUNT(*)::int AS cnt FROM scored GROUP BY entity_type) facet)` : sql`NULL::jsonb`;
                return sql`
                    WITH ${ctes},
                    totals AS (SELECT (SELECT COUNT(*) FROM scored)::int AS total_count, ${facets} AS facets),
                    paged AS (
                        SELECT scored.entity_type, scored.entity_id, documents.display_text, documents.metadata, scored.rank, ${snippet} AS snippet
                        FROM scored JOIN ${sql(_cfg.docsTable)} documents ON documents.entity_type = scored.entity_type AND documents.entity_id = scored.entity_id
                        ORDER BY scored.rank DESC, scored.entity_id DESC),
                    filtered AS (SELECT * FROM paged paged ${cursor} LIMIT ${input.limit + 1})
                    SELECT filtered.entity_type, filtered.entity_id, filtered.display_text, filtered.metadata, filtered.rank, filtered.snippet, totals.total_count, totals.facets
                    FROM totals LEFT JOIN filtered ON true ORDER BY filtered.rank DESC NULLS LAST, filtered.entity_id DESC NULLS LAST`;
            },
            Request: _SearchRequestSchema,
            Result: S.Struct({
                displayText: S.NullOr(S.String), entityId: S.NullOr(_SearchEntityId), entityType: S.NullOr(S.String),
                facets: S.NullOr(S.Record({ key: S.String, value: S.Int })), metadata: S.NullOr(S.Unknown), rank: S.NullOr(S.Number), snippet: S.NullOr(S.String), totalCount: S.Int,
            }),
        });
        const executeSuggestions = SqlSchema.findAll({
            execute: (input) => sql`SELECT term, frequency::int FROM get_search_suggestions(${input.prefix}, ${input.scopeId}::uuid, ${input.includeGlobal}, ${input.limit})`,
            Request: S.Struct({ ..._scopeFields, limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_cfg.limits.suggestMax)), prefix: S.String.pipe(S.minLength(_cfg.limits.termMin), S.maxLength(_cfg.limits.termMax)) }),
            Result:  S.Struct({ frequency: S.Int, term: S.String }),
        });
        const executeEmbeddingSources = SqlSchema.findAll({
            execute: (input: _EmbedRequest) => {
                const where = _filters(input, 'documents');
                const profileHash = _embeddingHash(input, sql`documents.embedding_input_hash`);
                return sql`
                    SELECT documents.entity_type, documents.entity_id, documents.scope_id, documents.display_text, documents.content_text, documents.metadata,
                           documents.embedding_input_hash AS document_hash, documents.normalized_text, documents.updated_at
                    FROM ${sql(_cfg.docsTable)} documents LEFT JOIN ${sql(_cfg.embeddingsTable)} embeddings
                      ON embeddings.entity_type = documents.entity_type AND embeddings.entity_id = documents.entity_id
                     AND ${_profileMatch(input)}
                    WHERE ${where} AND (embeddings.entity_id IS NULL OR ${_staleProfile(input, profileHash)})
                    ORDER BY documents.updated_at DESC LIMIT ${input.limit}`;
            },
            Request: _EmbedRequestSchema,
            Result:  S.Struct({ contentText: S.NullOr(S.String), displayText: S.String, documentHash: S.String, entityId: _SearchEntityId, entityType: S.String, metadata: S.Unknown, normalizedText: S.String, scopeId: S.NullOr(_SearchScopeId), updatedAt: S.DateFromSelf }),
        });
        const executeUpsertDoc = SqlSchema.single({
            execute: (input) => sql`
                INSERT INTO ${sql(_cfg.docsTable)} (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
                VALUES (${input.entityType}, ${input.entityId}, ${input.scopeId}, ${input.displayText}, ${input.contentText}, jsonb_strip_nulls(${input.metadataJson}::jsonb, true), normalize_search_text(${input.displayText}, ${input.contentText}, jsonb_strip_nulls(${input.metadataJson}::jsonb, true)))
                ON CONFLICT (entity_type, entity_id) DO UPDATE
                SET scope_id = EXCLUDED.scope_id, display_text = EXCLUDED.display_text, content_text = EXCLUDED.content_text,
                    metadata = EXCLUDED.metadata, normalized_text = EXCLUDED.normalized_text, updated_at = clock_timestamp()
                RETURNING entity_type, entity_id, embedding_input_hash AS document_hash`,
            Request: S.Struct({ contentText: S.NullOr(S.String), displayText: S.String, entityId: _SearchEntityId, entityType: S.String, metadataJson: S.String, scopeId: S.NullOr(_SearchScopeId) }),
            Result:  S.Struct({ documentHash: S.String, entityId: _SearchEntityId, entityType: S.String }),
        });
        const executeUpsertEmbedding = SqlSchema.single({
            execute: (input: typeof _UpsertEmbeddingSchema.Type) => sql`
                INSERT INTO ${sql(_cfg.embeddingsTable)} (entity_type, entity_id, provider, dimensions, embedding, embedding_hash)
                VALUES (${input.entityType}, ${input.entityId}, ${input.provider}, ${input.dimensions}, (${input.embeddingJson})::halfvec(1536), search_embedding_profile_hash(${input.documentHash}, ${input.provider}, ${input.dimensions}))
                ON CONFLICT (entity_type, entity_id, provider, dimensions) DO UPDATE
                SET embedding = EXCLUDED.embedding, embedding_hash = EXCLUDED.embedding_hash, updated_at = clock_timestamp()
                RETURNING entity_type, entity_id, provider, dimensions`,
            Request: _UpsertEmbeddingSchema,
            Result:  S.Struct({ dimensions: S.Int, entityId: _SearchEntityId, entityType: S.String, provider: S.String }),
        });
        const executeStaleEmbeddings = SqlSchema.findAll({
            execute: (input: _EmbedRequest) => {
                const where = _filters(input, 'documents');
                const profileHash = _embeddingHash(input, sql`documents.embedding_input_hash`);
                return sql`
                    SELECT embeddings.entity_type, embeddings.entity_id, embeddings.provider AS stale_provider, embeddings.dimensions AS stale_dimensions
                    FROM ${sql(_cfg.embeddingsTable)} embeddings JOIN ${sql(_cfg.docsTable)} documents ON documents.entity_type = embeddings.entity_type AND documents.entity_id = embeddings.entity_id
                    WHERE ${where} AND ${_staleProfile(input, profileHash)}
                    ORDER BY embeddings.updated_at DESC LIMIT ${input.limit}`;
            },
            Request: _EmbedRequestSchema,
            Result:  S.Struct({ entityId: _SearchEntityId, entityType: S.String, staleDimensions: S.Int, staleProvider: S.String }),
        });
        const executePruneEmbeddings = SqlSchema.single({
            execute: (input: _EmbedRequest) => {
                const where = _filters(input, 'documents');
                const profileHash = _embeddingHash(input, sql`documents.embedding_input_hash`);
                return sql`
                    WITH deleted AS (
                        DELETE FROM ${sql(_cfg.embeddingsTable)} embeddings
                        USING ${sql(_cfg.docsTable)} documents
                        WHERE documents.entity_type = embeddings.entity_type AND documents.entity_id = embeddings.entity_id
                          AND ${where}
                          AND ${_staleProfile(input, profileHash)}
                        RETURNING 1
                    )
                    SELECT COUNT(*)::int AS count FROM deleted`;
            },
            Request: _EmbedRequestSchema,
            Result: S.Struct({ count: S.Int }),
        });
        const executeProfileFingerprint = SqlSchema.single({
            execute: (input: typeof _ProfileFingerprintSchema.Type) => sql`
                SELECT search_embedding_profile_hash(${input.sourceHash}, ${input.provider}, ${input.dimensions}) AS hash`,
            Request: _ProfileFingerprintSchema,
            Result: S.Struct({ hash: S.String }),
        });
        const executeRefresh = SqlSchema.void({
            execute: (input) => sql`SELECT refresh_search_documents(${input.scopeId}::uuid, ${input.includeGlobal})`.pipe(Effect.timeout(Duration.minutes(_cfg.refreshMin)), Effect.andThen(sql`SELECT notify_search_refresh()`)),
            Request: S.Struct(_scopeFields),
        });
        return {
            embeddingSources: Effect.fn('SearchRepo.embeddingSources')((options: _EmbedOpts) =>
                executeEmbeddingSources(_spreadEmbedOpts(options)).pipe(Effect.map((rows) => rows.map((row) => ({ ...row, embeddingSource: row.normalizedText }))), _mapErr('embeddingSources'))),
            profileFingerprint: Effect.fn('SearchRepo.profileFingerprint')((input: { readonly profile: EmbeddingProfile; readonly sourceHash: string }) =>
                executeProfileFingerprint({ dimensions: input.profile.dimensions, provider: input.profile.provider, sourceHash: input.sourceHash }).pipe(_mapErr('profileFingerprint'))),
            pruneEmbeddings: Effect.fn('SearchRepo.pruneEmbeddings')((options: _EmbedOpts) =>
                executePruneEmbeddings(_spreadEmbedOpts(options)).pipe(Effect.map((row) => row.count), _mapErr('pruneEmbeddings'))),
            refresh: Effect.fn('SearchRepo.refresh')((scopeId: string | null = null, includeGlobal = false) => executeRefresh({ includeGlobal, scopeId }).pipe(_mapErr('refresh'))),
            search: Effect.fn('SearchRepo.search')((options: { readonly embedding?: EmbeddingInput | undefined; readonly entityTypes?: readonly string[] | undefined; readonly includeFacets?: boolean | undefined; readonly includeGlobal?: boolean | undefined; readonly includeSnippets?: boolean | undefined; readonly scopeId: string | null; readonly term: string }, pagination: { cursor?: string | undefined; limit?: number | undefined } = {}) =>
                Effect.gen(function* () {
                    const cursor = Option.filter(yield* Page.decode(pagination.cursor, S.Number), (value) => S.is(_SearchEntityId)(value.id));
                    const limit = _clamp(pagination.limit, _cfg.limits.default, _cfg.limits.max);
                    const embedding = yield* Option.fromNullable(options.embedding).pipe(Option.map(_embeddingPayload), Effect.transposeOption);
                    const input = _searchInput(options, limit, cursor, embedding);
                    const rows = yield* (Option.isSome(embedding)
                        ? Client.vector.withIterativeScan({ efSearch: _cfg.vector.efSearch, maxScanTuples: _cfg.vector.maxTuples, mode: _cfg.vector.mode, scanMemMultiplier: _cfg.vector.memMult }, executeSearch(input).pipe(_mapErr('search')))
                        : executeSearch(input).pipe(_mapErr('search')));
                    const total = rows[0]?.totalCount ?? 0;
                    const facets = options.includeFacets ? rows[0]?.facets ?? null : null;
                    const { items } = Page.strip(rows.filter((row): row is typeof row & { entityId: string; entityType: string; displayText: string; rank: number } => row.entityId !== null && row.entityType !== null && row.displayText !== null && row.rank !== null));
                    return { ...Page.keyset(items, total, limit, (item) => ({ id: item.entityId, v: item.rank }), S.Number, Option.isSome(cursor)), facets };
                }).pipe(Effect.tap(() => Effect.annotateCurrentSpan({ 'search.term': options.term })))),
            staleEmbeddings: Effect.fn('SearchRepo.staleEmbeddings')((options: _EmbedOpts) =>
                executeStaleEmbeddings(_spreadEmbedOpts(options)).pipe(_mapErr('staleEmbeddings'))),
            suggest: Effect.fn('SearchRepo.suggest')((options: { readonly includeGlobal?: boolean | undefined; readonly limit?: number | undefined; readonly prefix: string; readonly scopeId: string | null }) =>
                executeSuggestions({ includeGlobal: options.includeGlobal ?? false, limit: _clamp(options.limit, _cfg.limits.suggestDefault, _cfg.limits.suggestMax), prefix: options.prefix, scopeId: options.scopeId }).pipe(_mapErr('suggest'))),
            upsertDocument: Effect.fn('SearchRepo.upsertDocument')((input: { readonly contentText?: string | null; readonly displayText: string; readonly entityId: string; readonly entityType: string; readonly metadata?: unknown; readonly scopeId: string | null }) =>
                executeUpsertDoc({ contentText: input.contentText ?? null, displayText: input.displayText, entityId: input.entityId, entityType: input.entityType, metadataJson: JSON.stringify(input.metadata ?? {}), scopeId: input.scopeId }).pipe(_mapErr('upsertDocument'))),
            upsertEmbedding: Effect.fn('SearchRepo.upsertEmbedding')((input: { readonly documentHash: string; readonly embedding: readonly number[]; readonly entityId: string; readonly entityType: string; readonly profile: EmbeddingProfile }) =>
                _embeddingPayload({ profile: input.profile, vector: input.embedding }).pipe(
                    Effect.andThen(({ embeddingJson, profile }) =>
                        executeUpsertEmbedding({ dimensions: profile.dimensions, documentHash: input.documentHash, embeddingJson, entityId: input.entityId, entityType: input.entityType, provider: profile.provider }).pipe(_mapErr('upsertEmbedding'))))),
        };
    }),
}) {
    static readonly Test = (overrides: Partial<SearchRepo> = {}) => Layer.succeed(SearchRepo, {
        embeddingSources: () => Effect.succeed([]), profileFingerprint: () => Effect.succeed({ hash: 'profile-hash' }), pruneEmbeddings: () => Effect.succeed(0), refresh: () => Effect.void,
        search: () => Effect.succeed({ cursor: null, facets: null, hasNext: false, hasPrev: false, items: [], total: 0 }),
        staleEmbeddings: () => Effect.succeed([]), suggest: () => Effect.succeed([]),
        upsertDocument: () => Effect.succeed({ documentHash: '0', entityId: '00000000-0000-0000-0000-000000000000', entityType: 'app' as const }),
        upsertEmbedding: () => Effect.succeed({ dimensions: 1_536, entityId: '00000000-0000-0000-0000-000000000000', entityType: 'app' as const, provider: 'openai' }),
        ...overrides,
    } as SearchRepo);
}

// --- [EXPORT] ----------------------------------------------------------------

export { SearchError, SearchRepo };
