import { SqlClient, SqlSchema, type Statement } from '@effect/sql';
import { Client } from './client.ts';
import { Page } from './page.ts';
import { Data, Duration, Effect, Layer, Match, Option, pipe, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type _CteParams = {
    readonly entityFilter: Statement.Fragment;
    readonly normalizedTerm: Statement.Fragment;
    readonly scopeFilter: Statement.Fragment;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = (() => {
    const snippet = { delimiter: ' ... ', maxFragments: 3, maxWords: 50, minWords: 20, startSel: '<mark>', stopSel: '</mark>' } as const;
    return {
        channels:   { refresh: 'search_refresh' },
        embedding:  { maxDimensions: 3072, padValue: 0 },
        fuzzy:      { maxDistance: 2, maxInputLength: 255, minTermLength: 4 },
        limits:     { candidate: 300, defaultLimit: 20, embeddingBatch: 200, maxLimit: 100, suggestLimitDefault: 10, suggestLimitMax: 20, termMax: 256, termMin: 2 },
        rank:       { normalization: 32 },
        refresh:    { timeoutMinutes: 5 },
        regconfig:  'parametric_search',
        rrf:        {
            k: 60,
            signals: [
                { name: 'fts',               weight: 0.3  },
                { name: 'trgmSimilarity',    weight: 0.15 },
                { name: 'trgmWord',          weight: 0.1  },
                { name: 'trgmStrictWord',    weight: 0.05 },
                { name: 'trgmKnnSimilarity', weight: 0.05 },
                { name: 'trgmKnnWord',       weight: 0.03 },
                { name: 'trgmKnnStrictWord', weight: 0.02 },
                { name: 'fuzzy',             weight: 0.08 },
                { name: 'phonetic',          weight: 0.02 },
                { name: 'semantic',          weight: 0.2  },
            ] as const,
        },
        snippet:    { ...snippet, opts: `MaxWords=${snippet.maxWords},MinWords=${snippet.minWords},MaxFragments=${snippet.maxFragments},FragmentDelimiter=${snippet.delimiter},StartSel=${snippet.startSel},StopSel=${snippet.stopSel}` },
        tables:     { documents: 'search_documents', embeddings: 'search_embeddings' },
        trigram:    { minTermLength: 2 },
        vector:     { efSearch: 120, maxScanTuples: 40_000, mode: 'relaxed_order' as const, scanMemMultiplier: 2 },
    } as const;
})();

// --- [FUNCTIONS] -------------------------------------------------------------

const _snakeCase = (name: string) => name.replaceAll(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);

// --- [CLASSES] ---------------------------------------------------------------

class SearchError extends Data.TaggedError('SearchError')<{ readonly cause: unknown; readonly operation: string }> {}

// --- [SERVICES] --------------------------------------------------------------

class SearchRepo extends Effect.Service<SearchRepo>()('database/Search', {
    effect: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        type EmbeddingInput = { readonly vector: readonly number[]; readonly model: string; readonly dimensions: number };
        const _filters = (parameters: { readonly entityTypes: readonly string[]; readonly includeGlobal: boolean; readonly scopeId: string | null }, alias: string | null = 'documents') => {
            const col = (name: string) => alias === null ? sql`${sql(name)}` : sql`${sql(alias)}.${sql(name)}`;
            const entityFilter = parameters.entityTypes.length ? sql`AND ${col('entity_type')} IN ${sql.in(parameters.entityTypes)}` : sql``;
            const scopeMatch = parameters.scopeId ? sql`${col('scope_id')} = ${parameters.scopeId}::uuid` : sql`${col('scope_id')} IS NULL`;
            return { entityFilter, scopeFilter: parameters.includeGlobal && parameters.scopeId ? sql`AND (${scopeMatch} OR ${col('scope_id')} IS NULL)` : sql`AND ${scopeMatch}` };
        };
        const _embeddingPayload = (input: EmbeddingInput) =>
            S.decode(S.Array(S.Number).pipe(S.itemsCount(input.dimensions)))(input.vector).pipe(
                Effect.map((vector) => {
                    const pad = _CONFIG.embedding.maxDimensions - vector.length;
                    return { dimensions: input.dimensions, embeddingJson: JSON.stringify(pad <= _CONFIG.embedding.padValue ? vector : [...vector, ...Array.from({ length: pad }, () => _CONFIG.embedding.padValue)]), model: input.model };
                }),
            );
        const _trgmKnnOps = [
            { distExpr: (params: _CteParams) => sql`documents.normalized_text <-> ${params.normalizedTerm}`, name: 'trgmKnnSimilarity' },
            { distExpr: (params: _CteParams) => sql`${params.normalizedTerm} <<-> documents.normalized_text`, name: 'trgmKnnWord' },
            { distExpr: (params: _CteParams) => sql`${params.normalizedTerm} <<<-> documents.normalized_text`, name: 'trgmKnnStrictWord' },
        ] as const;
        const _buildTrgmKnnCte = (spec: (typeof _trgmKnnOps)[number], params: _CteParams) => {
            const dist = spec.distExpr(params);
            const snake = _snakeCase(spec.name);
            return sql`${sql.literal(snake)}_candidates AS (
                    SELECT documents.entity_type, documents.entity_id, documents.normalized_text, ${1} - (${dist}) AS ${sql.literal(snake)}_score
                    FROM ${sql(_CONFIG.tables.documents)} documents
                    WHERE true ${params.scopeFilter} ${params.entityFilter}
                        AND char_length(${params.normalizedTerm}) >= ${_CONFIG.trigram.minTermLength}
                    ORDER BY ${dist}, documents.entity_id DESC LIMIT ${_CONFIG.limits.candidate}
                )`;
        };
        const _rankedSpecs = [
            { candidateTable: 'fts_candidates', name: 'fts', scoreCol: 'fts_score' },
            { candidateTable: 'trgm_candidates', filterExpr: sql`trgm_similarity_match`, name: 'trgmSimilarity', scoreCol: 'trgm_similarity_score' },
            { candidateTable: 'trgm_candidates', filterExpr: sql`trgm_word_match`, name: 'trgmWord', scoreCol: 'trgm_word_score' },
            { candidateTable: 'trgm_candidates', filterExpr: sql`trgm_strict_word_match`, name: 'trgmStrictWord', scoreCol: 'trgm_strict_word_score' },
            { candidateTable: 'trgm_knn_similarity_candidates', name: 'trgmKnnSimilarity', scoreCol: 'trgm_knn_similarity_score' },
            { candidateTable: 'trgm_knn_word_candidates', name: 'trgmKnnWord', scoreCol: 'trgm_knn_word_score' },
            { candidateTable: 'trgm_knn_strict_word_candidates', name: 'trgmKnnStrictWord', scoreCol: 'trgm_knn_strict_word_score' },
            { candidateTable: 'fuzzy_candidates', filterExpr: sql`fuzzy_distance <= ${_CONFIG.fuzzy.maxDistance}`, name: 'fuzzy', orderDir: 'ASC' as const, scoreCol: 'fuzzy_distance' },
            { candidateTable: 'phonetic_candidates', name: 'phonetic' },
        ];
        const _buildRankedCte = (spec: { readonly candidateTable: string; readonly filterExpr?: Statement.Fragment; readonly name: string; readonly orderDir?: 'ASC' | 'DESC'; readonly scoreCol?: string }) => {
            const snake = _snakeCase(spec.name);
            const orderFrag = Match.value(spec.scoreCol).pipe(
                Match.when(Match.string, (col) => sql`${sql.literal(col)} ${sql.literal(spec.orderDir ?? 'DESC')} NULLS LAST, entity_id DESC`),
                Match.orElse(() => sql`entity_id DESC`),
            );
            const filterFrag = spec.filterExpr ? sql` WHERE ${spec.filterExpr}` : sql``;
            return sql`${sql.literal(snake)}_ranked AS (SELECT entity_type, entity_id, ROW_NUMBER() OVER (ORDER BY ${orderFrag}) AS ${sql.literal(snake)}_rank FROM ${sql.literal(spec.candidateTable)}${filterFrag})`;
        };
        const _buildRankedCtes = (parameters: { readonly embeddingJson?: string; readonly dimensions?: number; readonly entityTypes: readonly string[]; readonly includeGlobal: boolean; readonly model?: string; readonly scopeId: string | null; readonly term: string }) => {
            const hasEmbedding = parameters.embeddingJson !== undefined;
            const { entityFilter, scopeFilter } = _filters(parameters);
            const normalizedTerm = sql`left(normalize_search_text(${parameters.term}, NULL, NULL), ${_CONFIG.fuzzy.maxInputLength})`;
            const query = sql`websearch_to_tsquery(${_CONFIG.regconfig}::regconfig, ${parameters.term})`;
            const cteParams: _CteParams = { entityFilter, normalizedTerm, scopeFilter };
            const semanticCte = hasEmbedding
                ? sql`,
                semantic_candidates AS (
                    SELECT documents.entity_type, documents.entity_id, ${1} - (embeddings.embedding <=> (${parameters.embeddingJson})::halfvec(${_CONFIG.embedding.maxDimensions})) AS semantic_score
                    FROM ${sql(_CONFIG.tables.embeddings)} embeddings
                    JOIN ${sql(_CONFIG.tables.documents)} documents
                        ON documents.entity_type = embeddings.entity_type
                        AND documents.entity_id = embeddings.entity_id
                        AND documents.document_hash = embeddings.hash
                    WHERE true ${scopeFilter} ${entityFilter}
                        AND embeddings.model = ${parameters.model} AND embeddings.dimensions = ${parameters.dimensions}
                    ORDER BY embeddings.embedding <=> (${parameters.embeddingJson})::halfvec(${_CONFIG.embedding.maxDimensions}), documents.entity_id DESC LIMIT ${_CONFIG.limits.candidate}
                )` : sql``;
            const trgmKnnCtes = _trgmKnnOps.map((spec) => _buildTrgmKnnCte(spec, cteParams));
            const rankedCtes = [..._rankedSpecs, ...(hasEmbedding ? [{ candidateTable: 'semantic_candidates', name: 'semantic', scoreCol: 'semantic_score' }] : [])].map(_buildRankedCte);
            const ctes = sql`
                fts_candidates AS (
                    SELECT documents.entity_type, documents.entity_id, ts_rank_cd(documents.search_vector, ${query}, ${_CONFIG.rank.normalization}) AS fts_score
                    FROM ${sql(_CONFIG.tables.documents)} documents
                    WHERE true ${scopeFilter} ${entityFilter}
                        AND documents.search_vector @@ ${query}
                    ORDER BY fts_score DESC NULLS LAST, documents.entity_id DESC LIMIT ${_CONFIG.limits.candidate}
                ),
                trgm_candidates AS (
                    SELECT documents.entity_type, documents.entity_id, documents.normalized_text,
                        similarity(documents.normalized_text, ${normalizedTerm}) AS trgm_similarity_score,
                        word_similarity(${normalizedTerm}, documents.normalized_text) AS trgm_word_score,
                        strict_word_similarity(${normalizedTerm}, documents.normalized_text) AS trgm_strict_word_score,
                        documents.normalized_text % ${normalizedTerm} AS trgm_similarity_match,
                        ${normalizedTerm} <% documents.normalized_text AS trgm_word_match,
                        ${normalizedTerm} <<% documents.normalized_text AS trgm_strict_word_match
                    FROM ${sql(_CONFIG.tables.documents)} documents
                    WHERE true ${scopeFilter} ${entityFilter}
                        AND char_length(${normalizedTerm}) >= ${_CONFIG.trigram.minTermLength}
                        AND (documents.normalized_text % ${normalizedTerm} OR ${normalizedTerm} <% documents.normalized_text OR ${normalizedTerm} <<% documents.normalized_text)
                    ORDER BY GREATEST(trgm_similarity_score, trgm_word_score, trgm_strict_word_score) DESC NULLS LAST, documents.entity_id DESC LIMIT ${_CONFIG.limits.candidate}
                ),
                ${sql.csv(trgmKnnCtes)},
                fuzzy_candidates AS (
                    SELECT knn.entity_type, knn.entity_id,
                        levenshtein_less_equal(
                            left(knn.normalized_text, ${_CONFIG.fuzzy.maxInputLength}),
                            ${normalizedTerm},
                            ${_CONFIG.fuzzy.maxDistance}
                        ) AS fuzzy_distance
                    FROM trgm_knn_similarity_candidates knn
                    WHERE char_length(${normalizedTerm}) >= ${_CONFIG.fuzzy.minTermLength}
                    ORDER BY fuzzy_distance ASC NULLS LAST, knn.entity_id DESC LIMIT ${_CONFIG.limits.candidate}
                ),
                phonetic_candidates AS (
                    SELECT metaphone.entity_type, metaphone.entity_id
                    FROM (
                        SELECT documents.entity_type, documents.entity_id
                        FROM ${sql(_CONFIG.tables.documents)} documents
                        WHERE char_length(${normalizedTerm}) >= ${3}
                            AND true ${scopeFilter} ${entityFilter}
                            AND documents.phonetic_code = dmetaphone(${normalizedTerm})
                        ORDER BY documents.entity_id DESC LIMIT ${_CONFIG.limits.candidate}
                    ) metaphone
                    UNION
                    SELECT daitch.entity_type, daitch.entity_id
                    FROM (
                        SELECT documents.entity_type, documents.entity_id
                        FROM ${sql(_CONFIG.tables.documents)} documents
                        WHERE char_length(${normalizedTerm}) >= ${_CONFIG.trigram.minTermLength}
                            AND true ${scopeFilter} ${entityFilter}
                            AND documents.phonetic_daitch && daitch_mokotoff(${normalizedTerm})
                        ORDER BY documents.entity_id DESC LIMIT ${_CONFIG.limits.candidate}
                    ) daitch
                )
            ${semanticCte},
                ${sql.csv(rankedCtes)},
            ranked AS (
                ${sql.unsafe(_CONFIG.rrf.signals
                    .filter((signal) => signal.name !== 'semantic' || hasEmbedding)
                    .map((signal, index) => {
                        const snake = _snakeCase(signal.name);
                        const prefix = index === 0 ? '' : 'UNION ALL ';
                        return `${prefix}SELECT entity_type, entity_id, '${signal.name}' AS source, ${snake}_rank AS rnk FROM ${snake}_ranked`;
                    })
                    .join('\n                '))}
            ),
            scored AS (
                SELECT entity_type, entity_id,
                    ${sql.unsafe(_CONFIG.rrf.signals
                        .map((signal) => `COALESCE(SUM(1.0 / (${_CONFIG.rrf.k} + rnk)) FILTER (WHERE source = '${signal.name}'), 0) * ${signal.weight}`)
                        .join(' +\n                    '))}
                    AS rank
                FROM ranked GROUP BY entity_type, entity_id
            )`;
            return { ctes, query };
        };
        const executeSearch = SqlSchema.findAll({
            execute: (parameters) => {
                const hasCursor = parameters.cursorRank !== undefined && parameters.cursorId !== undefined;
                const cursorFilter = hasCursor ? sql`WHERE (paged.rank, paged.entity_id) < (${parameters.cursorRank}, ${parameters.cursorId}::uuid)` : sql``;
                const { ctes, query } = _buildRankedCtes(parameters);
                const snippetExpr = parameters.includeSnippets
                    ? sql`ts_headline(${_CONFIG.regconfig}::regconfig, coalesce(documents.display_text, '') || ' ' || coalesce(documents.content_text, '') || ' ' || coalesce((SELECT string_agg(value, ' ') FROM jsonb_each_text(coalesce(documents.metadata, '{}'::jsonb))), ''), ${query}, ${_CONFIG.snippet.opts})`
                    : sql`NULL`;
                const facetsExpr = parameters.includeFacets ? sql`(SELECT jsonb_object_agg(entity_type, cnt) FROM (SELECT entity_type, COUNT(*)::int AS cnt FROM scored GROUP BY entity_type) facet)` : sql`NULL::jsonb`;
                return sql`
                    WITH ${ctes},
                    totals AS (SELECT (SELECT COUNT(*) FROM scored)::int AS total_count, ${facetsExpr} AS facets),
                    paged AS (
                        SELECT scored.entity_type, scored.entity_id, documents.display_text, documents.metadata, scored.rank, ${snippetExpr} AS snippet
                        FROM scored scored
                        JOIN ${sql(_CONFIG.tables.documents)} documents ON documents.entity_type = scored.entity_type AND documents.entity_id = scored.entity_id
                        ORDER BY scored.rank DESC, scored.entity_id DESC
                    ),
                filtered AS (SELECT * FROM paged paged ${cursorFilter} LIMIT ${parameters.limit + 1})
                SELECT filtered.entity_type, filtered.entity_id, filtered.display_text, filtered.metadata, filtered.rank, filtered.snippet, totals.total_count, totals.facets
                FROM totals totals LEFT JOIN filtered filtered ON true ORDER BY filtered.rank DESC NULLS LAST, filtered.entity_id DESC NULLS LAST`;
            },
            Request: S.Struct({
                cursorId:    S.optional(S.UUID), cursorRank: S.optional(S.Number), dimensions: S.optional(S.Int), embeddingJson: S.optional(S.String),
                entityTypes: S.Array(S.String), includeFacets: S.Boolean, includeGlobal: S.Boolean, includeSnippets: S.Boolean,
                limit:       S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_CONFIG.limits.maxLimit)), model: S.optional(S.String),
                scopeId:     S.NullOr(S.UUID), term: S.String.pipe(S.minLength(_CONFIG.limits.termMin), S.maxLength(_CONFIG.limits.termMax)),
            }),
            Result: S.Struct({ displayText: S.NullOr(S.String), entityId: S.NullOr(S.UUID), entityType: S.NullOr(S.String), facets: S.NullOr(S.Record({ key: S.String, value: S.Int })), metadata: S.NullOr(S.Unknown), rank: S.NullOr(S.Number), snippet: S.NullOr(S.String), totalCount: S.Int }),
        });
        const executeSuggestions = SqlSchema.findAll({
            execute: (parameters) => sql`SELECT term, frequency::int FROM get_search_suggestions(${parameters.prefix}, ${parameters.scopeId}::uuid, ${parameters.includeGlobal}, ${parameters.limit})`,
            Request: S.Struct({ includeGlobal: S.Boolean, limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_CONFIG.limits.suggestLimitMax)), prefix: S.String.pipe(S.minLength(_CONFIG.limits.termMin), S.maxLength(_CONFIG.limits.termMax)), scopeId: S.NullOr(S.UUID) }),
            Result:  S.Struct({ frequency: S.Int, term: S.String }),
        });
        const executeEmbeddingSources = SqlSchema.findAll({
            execute: (parameters) => {
                const { entityFilter, scopeFilter } = _filters(parameters, 'd');
                return sql`SELECT d.entity_type, d.entity_id, d.scope_id, d.display_text, d.content_text, d.metadata, d.document_hash, d.updated_at
                    FROM ${sql(_CONFIG.tables.documents)} d LEFT JOIN ${sql(_CONFIG.tables.embeddings)} e
                        ON e.entity_type = d.entity_type AND e.entity_id = d.entity_id AND e.hash = d.document_hash AND e.model = ${parameters.model} AND e.dimensions = ${parameters.dimensions}
                    WHERE true ${scopeFilter} ${entityFilter} AND e.entity_id IS NULL ORDER BY d.updated_at DESC LIMIT ${parameters.limit}`;
            },
            Request: S.Struct({ dimensions: S.Int, entityTypes: S.Array(S.String), includeGlobal: S.Boolean, limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_CONFIG.limits.embeddingBatch)), model: S.String, scopeId: S.NullOr(S.UUID) }),
            Result:  S.Struct({ contentText: S.NullOr(S.String), displayText: S.String, documentHash: S.String, entityId: S.UUID, entityType: S.String, metadata: S.Unknown, scopeId: S.NullOr(S.UUID), updatedAt: S.DateFromSelf }),
        });
        const executeUpsertEmbedding = SqlSchema.single({
            execute: (parameters) => sql`
                INSERT INTO ${sql(_CONFIG.tables.embeddings)} (entity_type, entity_id, scope_id, model, dimensions, embedding, hash)
                VALUES (${parameters.entityType}, ${parameters.entityId}, ${parameters.scopeId}, ${parameters.model}, ${parameters.dimensions}, (${parameters.embeddingJson})::halfvec(${_CONFIG.embedding.maxDimensions}), ${parameters.documentHash})
                ON CONFLICT (entity_type, entity_id) DO UPDATE SET embedding = EXCLUDED.embedding, scope_id = EXCLUDED.scope_id, model = EXCLUDED.model, dimensions = EXCLUDED.dimensions, hash = EXCLUDED.hash
                RETURNING WITH (OLD AS old, NEW AS new) new.entity_type, new.entity_id, (old.entity_type IS NULL)::boolean AS is_new`,
            Request: S.Struct({ dimensions: S.Int, documentHash: S.String, embeddingJson: S.String, entityId: S.UUID, entityType: S.String, model: S.String, scopeId: S.NullOr(S.UUID) }),
            Result:  S.Struct({ entityId: S.UUID, entityType: S.String, isNew: S.Boolean }),
        });
        return {
            embeddingSources: Effect.fn('SearchRepo.embeddingSources')((options: { readonly dimensions: number; readonly entityTypes?: readonly string[]; readonly includeGlobal?: boolean; readonly limit?: number; readonly model: string; readonly scopeId?: string | null }) =>
                executeEmbeddingSources({
                    dimensions: options.dimensions, entityTypes: options.entityTypes ?? [], includeGlobal: options.includeGlobal ?? false,
                    limit: Math.min(Math.max(options.limit ?? _CONFIG.limits.embeddingBatch, 1), _CONFIG.limits.embeddingBatch),
                    model: options.model, scopeId: options.scopeId ?? null,
                }).pipe(Effect.mapError((cause) => new SearchError({ cause, operation: 'embeddingSources' }))),
            ),
            refresh: (() => {
                const executeRefresh = SqlSchema.void({
                    execute: (parameters) => sql`SELECT refresh_search_documents(${parameters.scopeId}::uuid, ${parameters.includeGlobal})`.pipe(Effect.timeout(Duration.minutes(_CONFIG.refresh.timeoutMinutes)), Effect.andThen(sql`SELECT notify_search_refresh()`)),
                    Request: S.Struct({ includeGlobal: S.Boolean, scopeId: S.NullOr(S.UUID) }),
                });
                return Effect.fn('SearchRepo.refresh')((scopeId: string | null = null, includeGlobal = false) =>
                    executeRefresh({ includeGlobal, scopeId }).pipe(Effect.mapError((cause) => new SearchError({ cause, operation: 'refresh' }))));
            })(),
            search: Effect.fn('SearchRepo.search')((options: { readonly embedding?: EmbeddingInput; readonly entityTypes?: readonly string[]; readonly includeFacets?: boolean; readonly includeGlobal?: boolean; readonly includeSnippets?: boolean; readonly scopeId: string | null; readonly term: string }, pagination: { cursor?: string; limit?: number } = {}) =>
                Effect.gen(function* () {
                    const cursorValue = Option.filter(yield* Page.decode(pagination.cursor, S.Number), (cursor) => S.is(S.UUID)(cursor.id));
                    const limit = Math.min(Math.max(pagination.limit ?? _CONFIG.limits.defaultLimit, 1), _CONFIG.limits.maxLimit);
                    const embedding = yield* pipe(
                        Option.fromNullable(options.embedding),
                        Option.match({
                            onNone: () => Effect.succeed(Option.none<{ dimensions: number; embeddingJson: string; model: string }>()),
                            onSome: (input) => Effect.map(_embeddingPayload(input), Option.some),
                        })
                    );
                    const searchEffect = executeSearch({
                        entityTypes: options.entityTypes ?? [], includeFacets: options.includeFacets ?? false, includeGlobal: options.includeGlobal ?? false,
                        includeSnippets: options.includeSnippets ?? true, limit, scopeId: options.scopeId, term: options.term,
                        ...(Option.isSome(cursorValue) ? { cursorId: cursorValue.value.id, cursorRank: cursorValue.value.v } : {}),
                        ...(Option.isSome(embedding) ? embedding.value : {}),
                    }).pipe(Effect.mapError((cause) => new SearchError({ cause, operation: 'search' })));
                    const rows = yield* (Option.isSome(embedding)
                        ? Client.vector.withIterativeScan({
                            efSearch: _CONFIG.vector.efSearch,
                            maxScanTuples: _CONFIG.vector.maxScanTuples,
                            mode: _CONFIG.vector.mode,
                            scanMemMultiplier: _CONFIG.vector.scanMemMultiplier,
                        }, searchEffect)
                        : searchEffect);
                    const totalCount = rows[0]?.totalCount ?? 0;
                    const facets = options.includeFacets ? rows[0]?.facets ?? null : null;
                    const { items } = Page.strip(rows.filter((row): row is typeof row & { entityId: string; entityType: string; displayText: string; rank: number } => row.entityId !== null));
                    return { ...Page.keyset(items, totalCount, limit, (item) => ({ id: item.entityId, v: item.rank }), S.Number, Option.isSome(cursorValue)), facets };
                }).pipe(Effect.tap(() => Effect.annotateCurrentSpan({ 'search.term': options.term }))),
            ),
            suggest: Effect.fn('SearchRepo.suggest')((options: { readonly includeGlobal?: boolean; readonly limit?: number; readonly prefix: string; readonly scopeId: string | null }) =>
                executeSuggestions({
                    includeGlobal: options.includeGlobal ?? false,
                    limit: Math.min(Math.max(options.limit ?? _CONFIG.limits.suggestLimitDefault, 1), _CONFIG.limits.suggestLimitMax),
                    prefix: options.prefix, scopeId: options.scopeId,
                }).pipe(Effect.mapError((cause) => new SearchError({ cause, operation: 'suggest' }))),
            ),
            upsertEmbedding: Effect.fn('SearchRepo.upsertEmbedding')((input: { readonly dimensions: number; readonly embedding: readonly number[]; readonly entityId: string; readonly entityType: string; readonly documentHash: string; readonly model: string; readonly scopeId: string | null }) =>
                _embeddingPayload({ dimensions: input.dimensions, model: input.model, vector: input.embedding }).pipe(
                    Effect.andThen((payload) => executeUpsertEmbedding({ ...payload, documentHash: input.documentHash, entityId: input.entityId, entityType: input.entityType, scopeId: input.scopeId })),
                    Effect.mapError((cause) => new SearchError({ cause, operation: 'upsertEmbedding' })),
                ),
            ),
        };
    }),
}) {
    static readonly Test = (overrides: Partial<SearchRepo> = {}) =>
        Layer.succeed(SearchRepo, {
            embeddingSources: overrides.embeddingSources ?? ((_) => Effect.succeed([])),
            refresh: overrides.refresh ?? ((_scopeId, _includeGlobal) => Effect.void),
            search: overrides.search ?? ((_options, _pagination) => Effect.succeed({ cursor: null, facets: null, hasNext: false, hasPrev: false, items: [], total: 0 })),
            suggest: overrides.suggest ?? ((_options) => Effect.succeed([])),
            upsertEmbedding: overrides.upsertEmbedding ?? ((_input) => Effect.succeed({ entityId: '00000000-0000-0000-0000-000000000000', entityType: 'app' as const, isNew: true })),
        } as SearchRepo);
}

// --- [EXPORT] ----------------------------------------------------------------

export { SearchError, SearchRepo };
