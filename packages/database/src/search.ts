import { SqlClient, SqlSchema, type Statement } from '@effect/sql';
import { Client } from './client.ts';
import { Page } from './page.ts';
import { Data, Duration, Effect, Layer, Match, Option, Schema as S } from 'effect';

// --- [ERRORS] ----------------------------------------------------------------

class SearchError extends Data.TaggedError('SearchError')<{ readonly cause: unknown; readonly operation: string }> {}
class SearchEmbeddingDimensionsError extends Data.TaggedError('SearchEmbeddingDimensionsError')<{
    readonly dimensions: number;
    readonly maxDimensions: number;
}> {}

// --- [SERVICES] --------------------------------------------------------------

class SearchRepo extends Effect.Service<SearchRepo>()('database/Search', {
    effect: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const _config = (() => {
            const snippet = { delimiter: ' ... ', maxFragments: 3, maxWords: 50, minWords: 20, startSel: '<mark>', stopSel: '</mark>' } as const;
            return {
                embedding:  { maxDimensions: 3072, padValue: 0 },
                fuzzy:      { maxDistance: 2, maxInputLength: 255, minTermLength: 4 },
                limits:     { candidate: 300, defaultLimit: 20, embeddingBatch: 200, maxLimit: 100, suggestLimitDefault: 10, suggestLimitMax: 20, termMax: 256, termMin: 2 },
                phonetic:   { minTermLength: 3 },
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
                tables:     { chunks: 'search_chunks' },
                trigram:    { minTermLength: 2 },
                vector:     { efSearch: 120, maxScanTuples: 40_000, mode: 'relaxed_order' as const, scanMemMultiplier: 2 },
            } as const;
        })();
        const _snakeCase = (name: string) => name.replaceAll(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
        const _clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
        const _mapSearchError = <A, E, R>(operation: string) =>
            (effect: Effect.Effect<A, E, R>) =>
                effect.pipe(Effect.mapError((cause) => new SearchError({ cause, operation })));
        type EmbeddingInput = { readonly vector: readonly number[]; readonly model: string; readonly dimensions: number };
        const _filters = (parameters: { readonly entityTypes: readonly string[]; readonly includeGlobal: boolean; readonly scopeId: string | null }, alias: string | null = 'documents') => {
            const col = (name: string) => alias === null ? sql`${sql(name)}` : sql`${sql(alias)}.${sql(name)}`;
            const entityFilter = parameters.entityTypes.length ? sql`AND ${col('entity_type')} IN ${sql.in(parameters.entityTypes)}` : sql``;
            const scopeMatch = parameters.scopeId ? sql`${col('scope_id')} = ${parameters.scopeId}::uuid` : sql`${col('scope_id')} IS NULL`;
            return { entityFilter, scopeFilter: parameters.includeGlobal && parameters.scopeId ? sql`AND (${scopeMatch} OR ${col('scope_id')} IS NULL)` : sql`AND ${scopeMatch}` };
        };
        const _embeddingPayload = (input: EmbeddingInput) =>
            S.decode(S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_config.embedding.maxDimensions)))(input.dimensions).pipe(
                Effect.mapError(() => new SearchEmbeddingDimensionsError({ dimensions: input.dimensions, maxDimensions: _config.embedding.maxDimensions })),
                Effect.flatMap((dimensions) => S.decode(S.Array(S.Number).pipe(S.itemsCount(dimensions)))(input.vector).pipe(
                    Effect.map((vector) => {
                        const pad = _config.embedding.maxDimensions - vector.length;
                        return {
                            dimensions,
                            embeddingJson: JSON.stringify(pad <= 0 ? vector : [...vector, ...Array.from({ length: pad }, () => _config.embedding.padValue)]),
                            model: input.model,
                        };
                    }),
                )),
            );
        const _trgmKnnOps = [
            { distExpr: (normalizedTerm: Statement.Fragment) => sql`documents.normalized_text <-> ${normalizedTerm}`, name: 'trgmKnnSimilarity' },
            { distExpr: (normalizedTerm: Statement.Fragment) => sql`${normalizedTerm} <<-> documents.normalized_text`, name: 'trgmKnnWord' },
            { distExpr: (normalizedTerm: Statement.Fragment) => sql`${normalizedTerm} <<<-> documents.normalized_text`, name: 'trgmKnnStrictWord' },
        ] as const;
        const _buildTrgmKnnCte = (
            spec: (typeof _trgmKnnOps)[number],
            entityFilter: Statement.Fragment,
            scopeFilter: Statement.Fragment,
            normalizedTerm: Statement.Fragment,
        ) => {
            const dist = spec.distExpr(normalizedTerm);
            const snake = _snakeCase(spec.name);
            return sql`${sql.literal(snake)}_candidates AS (
                    SELECT documents.entity_type, documents.entity_id, documents.normalized_text, ${1} - (${dist}) AS ${sql.literal(snake)}_score
                    FROM ${sql(_config.tables.chunks)} documents
                    WHERE true ${scopeFilter} ${entityFilter}
                        AND char_length(${normalizedTerm}) >= ${_config.trigram.minTermLength}
                    ORDER BY ${dist}, documents.entity_id DESC LIMIT ${_config.limits.candidate}
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
            { candidateTable: 'fuzzy_candidates', filterExpr: sql`fuzzy_distance <= ${_config.fuzzy.maxDistance}`, name: 'fuzzy', orderDir: 'ASC' as const, scoreCol: 'fuzzy_distance' },
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
            const normalizedTerm = sql`left(normalize_search_text(${parameters.term}, NULL, NULL), ${_config.fuzzy.maxInputLength})`;
            const query = sql`websearch_to_tsquery(${_config.regconfig}::regconfig, ${parameters.term})`;
            const semanticCte = hasEmbedding
                ? sql`,
                semantic_candidates AS (
                    SELECT documents.entity_type, documents.entity_id, ${1} - (documents.embedding <=> (${parameters.embeddingJson})::halfvec(${_config.embedding.maxDimensions})) AS semantic_score
                    FROM ${sql(_config.tables.chunks)} documents
                    WHERE true ${scopeFilter} ${entityFilter}
                        AND documents.embedding IS NOT NULL
                        AND documents.embedding_hash = documents.document_hash
                        AND documents.model = ${parameters.model}
                        AND documents.dimensions = ${parameters.dimensions}
                    ORDER BY documents.embedding <=> (${parameters.embeddingJson})::halfvec(${_config.embedding.maxDimensions}), documents.entity_id DESC LIMIT ${_config.limits.candidate}
                )` : sql``;
            const trgmKnnCtes = _trgmKnnOps.map((spec) => _buildTrgmKnnCte(spec, entityFilter, scopeFilter, normalizedTerm));
            const rankedCtes = [..._rankedSpecs, ...(hasEmbedding ? [{ candidateTable: 'semantic_candidates', name: 'semantic', scoreCol: 'semantic_score' }] : [])].map(_buildRankedCte);
            const ctes = sql`
                fts_candidates AS (
                    SELECT documents.entity_type, documents.entity_id, ts_rank_cd(documents.search_vector, ${query}, ${_config.rank.normalization}) AS fts_score
                    FROM ${sql(_config.tables.chunks)} documents
                    WHERE true ${scopeFilter} ${entityFilter}
                        AND documents.search_vector @@ ${query}
                    ORDER BY fts_score DESC NULLS LAST, documents.entity_id DESC LIMIT ${_config.limits.candidate}
                ),
                trgm_candidates AS (
                    SELECT documents.entity_type, documents.entity_id, documents.normalized_text,
                        similarity(documents.normalized_text, ${normalizedTerm}) AS trgm_similarity_score,
                        word_similarity(${normalizedTerm}, documents.normalized_text) AS trgm_word_score,
                        strict_word_similarity(${normalizedTerm}, documents.normalized_text) AS trgm_strict_word_score,
                        documents.normalized_text % ${normalizedTerm} AS trgm_similarity_match,
                        ${normalizedTerm} <% documents.normalized_text AS trgm_word_match,
                        ${normalizedTerm} <<% documents.normalized_text AS trgm_strict_word_match
                    FROM ${sql(_config.tables.chunks)} documents
                    WHERE true ${scopeFilter} ${entityFilter}
                        AND char_length(${normalizedTerm}) >= ${_config.trigram.minTermLength}
                        AND (documents.normalized_text % ${normalizedTerm} OR ${normalizedTerm} <% documents.normalized_text OR ${normalizedTerm} <<% documents.normalized_text)
                    ORDER BY GREATEST(trgm_similarity_score, trgm_word_score, trgm_strict_word_score) DESC NULLS LAST, documents.entity_id DESC LIMIT ${_config.limits.candidate}
                ),
                ${sql.csv(trgmKnnCtes)},
                fuzzy_candidates AS (
                    SELECT knn.entity_type, knn.entity_id,
                        levenshtein_less_equal(
                            left(knn.normalized_text, ${_config.fuzzy.maxInputLength}),
                            ${normalizedTerm},
                            ${_config.fuzzy.maxDistance}
                        ) AS fuzzy_distance
                    FROM trgm_knn_similarity_candidates knn
                    WHERE char_length(${normalizedTerm}) >= ${_config.fuzzy.minTermLength}
                    ORDER BY fuzzy_distance ASC NULLS LAST, knn.entity_id DESC LIMIT ${_config.limits.candidate}
                ),
                phonetic_candidates AS (
                    SELECT metaphone.entity_type, metaphone.entity_id
                    FROM (
                        SELECT documents.entity_type, documents.entity_id
                        FROM ${sql(_config.tables.chunks)} documents
                        WHERE char_length(${normalizedTerm}) >= ${_config.phonetic.minTermLength}
                            AND true ${scopeFilter} ${entityFilter}
                            AND documents.phonetic_code = dmetaphone(${normalizedTerm})
                        ORDER BY documents.entity_id DESC LIMIT ${_config.limits.candidate}
                    ) metaphone
                    UNION
                    SELECT daitch.entity_type, daitch.entity_id
                    FROM (
                        SELECT documents.entity_type, documents.entity_id
                        FROM ${sql(_config.tables.chunks)} documents
                        WHERE char_length(${normalizedTerm}) >= ${_config.trigram.minTermLength}
                            AND true ${scopeFilter} ${entityFilter}
                            AND documents.phonetic_daitch && daitch_mokotoff(${normalizedTerm})
                        ORDER BY documents.entity_id DESC LIMIT ${_config.limits.candidate}
                    ) daitch
                )
            ${semanticCte},
                ${sql.csv(rankedCtes)},
            ranked AS (
                ${sql.unsafe(_config.rrf.signals
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
                    ${sql.unsafe(_config.rrf.signals
                        .map((signal) => `COALESCE(SUM(1.0 / (${_config.rrf.k} + rnk)) FILTER (WHERE source = '${signal.name}'), 0) * ${signal.weight}`)
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
                const { ctes, query } = _buildRankedCtes({
                    entityTypes: parameters.entityTypes, includeGlobal: parameters.includeGlobal, scopeId: parameters.scopeId, term: parameters.term,
                    ...(parameters.embeddingJson === undefined ? {} : { embeddingJson: parameters.embeddingJson }),
                    ...(parameters.dimensions === undefined ? {} : { dimensions: parameters.dimensions }),
                    ...(parameters.model === undefined ? {} : { model: parameters.model }),
                });
                const snippetExpr = parameters.includeSnippets
                    ? sql`ts_headline(${_config.regconfig}::regconfig, coalesce(documents.display_text, '') || ' ' || coalesce(documents.content_text, '') || ' ' || coalesce((SELECT string_agg(value, ' ') FROM jsonb_each_text(coalesce(documents.metadata, '{}'::jsonb))), ''), ${query}, ${_config.snippet.opts})`
                    : sql`NULL`;
                const facetsExpr = parameters.includeFacets ? sql`(SELECT jsonb_object_agg(entity_type, cnt) FROM (SELECT entity_type, COUNT(*)::int AS cnt FROM scored GROUP BY entity_type) facet)` : sql`NULL::jsonb`;
                return sql`
                    WITH ${ctes},
                    totals AS (SELECT (SELECT COUNT(*) FROM scored)::int AS total_count, ${facetsExpr} AS facets),
                    paged AS (
                        SELECT scored.entity_type, scored.entity_id, documents.display_text, documents.metadata, scored.rank, ${snippetExpr} AS snippet
                        FROM scored scored
                        JOIN ${sql(_config.tables.chunks)} documents ON documents.entity_type = scored.entity_type AND documents.entity_id = scored.entity_id
                        ORDER BY scored.rank DESC, scored.entity_id DESC
                    ),
                filtered AS (SELECT * FROM paged paged ${cursorFilter} LIMIT ${parameters.limit + 1})
                SELECT filtered.entity_type, filtered.entity_id, filtered.display_text, filtered.metadata, filtered.rank, filtered.snippet, totals.total_count, totals.facets
                FROM totals totals LEFT JOIN filtered filtered ON true ORDER BY filtered.rank DESC NULLS LAST, filtered.entity_id DESC NULLS LAST`;
            },
            Request: S.Struct({
                cursorId:    S.optional(S.UUID), cursorRank: S.optional(S.Number), dimensions: S.optional(S.Int), embeddingJson: S.optional(S.String),
                entityTypes: S.Array(S.String), includeFacets: S.Boolean, includeGlobal: S.Boolean, includeSnippets: S.Boolean,
                limit:       S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_config.limits.maxLimit)), model: S.optional(S.String),
                scopeId:     S.NullOr(S.UUID), term: S.String.pipe(S.minLength(_config.limits.termMin), S.maxLength(_config.limits.termMax)),
            }),
            Result: S.Struct({ displayText: S.NullOr(S.String), entityId: S.NullOr(S.UUID), entityType: S.NullOr(S.String), facets: S.NullOr(S.Record({ key: S.String, value: S.Int })), metadata: S.NullOr(S.Unknown), rank: S.NullOr(S.Number), snippet: S.NullOr(S.String), totalCount: S.Int }),
        });
        const executeSuggestions = SqlSchema.findAll({
            execute: (parameters) => sql`SELECT term, frequency::int FROM get_search_suggestions(${parameters.prefix}, ${parameters.scopeId}::uuid, ${parameters.includeGlobal}, ${parameters.limit})`,
            Request: S.Struct({ includeGlobal: S.Boolean, limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_config.limits.suggestLimitMax)), prefix: S.String.pipe(S.minLength(_config.limits.termMin), S.maxLength(_config.limits.termMax)), scopeId: S.NullOr(S.UUID) }),
            Result:  S.Struct({ frequency: S.Int, term: S.String }),
        });
        const executeEmbeddingSources = SqlSchema.findAll({
            execute: (parameters) => {
                const { entityFilter, scopeFilter } = _filters(parameters, 'd');
                return sql`SELECT d.entity_type, d.entity_id, d.scope_id, d.display_text, d.content_text, d.metadata, d.document_hash, d.normalized_text, d.updated_at
                    FROM ${sql(_config.tables.chunks)} d
                    WHERE true ${scopeFilter} ${entityFilter}
                        AND (
                            d.embedding IS NULL
                            OR d.embedding_hash IS DISTINCT FROM d.document_hash
                            OR d.model IS DISTINCT FROM ${parameters.model}
                            OR d.dimensions IS DISTINCT FROM ${parameters.dimensions}
                        )
                    ORDER BY d.updated_at DESC LIMIT ${parameters.limit}`;
            },
            Request: S.Struct({ dimensions: S.Int, entityTypes: S.Array(S.String), includeGlobal: S.Boolean, limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_config.limits.embeddingBatch)), model: S.String, scopeId: S.NullOr(S.UUID) }),
            Result:  S.Struct({ contentText: S.NullOr(S.String), displayText: S.String, documentHash: S.String, entityId: S.UUID, entityType: S.String, metadata: S.Unknown, normalizedText: S.String, scopeId: S.NullOr(S.UUID), updatedAt: S.DateFromSelf }),
        });
        const executeUpsertDocument = SqlSchema.single({
            execute: (parameters) => sql`
                INSERT INTO ${sql(_config.tables.chunks)} (
                    entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text
                )
                VALUES (
                    ${parameters.entityType},
                    ${parameters.entityId},
                    ${parameters.scopeId},
                    ${parameters.displayText},
                    ${parameters.contentText},
                    jsonb_strip_nulls(${parameters.metadataJson}::jsonb, true),
                    normalize_search_text(
                        ${parameters.displayText},
                        ${parameters.contentText},
                        jsonb_strip_nulls(${parameters.metadataJson}::jsonb, true)
                    )
                )
                ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                    scope_id = EXCLUDED.scope_id,
                    display_text = EXCLUDED.display_text,
                    content_text = EXCLUDED.content_text,
                    metadata = EXCLUDED.metadata,
                    normalized_text = EXCLUDED.normalized_text,
                    model = NULL,
                    dimensions = NULL,
                    embedding = NULL,
                    embedding_hash = NULL,
                    updated_at = NOW()
                RETURNING entity_type, entity_id, document_hash`,
            Request: S.Struct({
                contentText:  S.NullOr(S.String),
                displayText:  S.String,
                entityId:     S.UUID,
                entityType:   S.String,
                metadataJson: S.String,
                scopeId:      S.NullOr(S.UUID),
            }),
            Result:  S.Struct({ documentHash: S.String, entityId: S.UUID, entityType: S.String }),
        });
        const executeUpsertEmbedding = SqlSchema.single({
            execute: (parameters) => sql`
                INSERT INTO ${sql(_config.tables.chunks)} (
                    entity_type,
                    entity_id,
                    scope_id,
                    display_text,
                    content_text,
                    metadata,
                    normalized_text,
                    model,
                    dimensions,
                    embedding,
                    embedding_hash
                )
                VALUES (
                    ${parameters.entityType},
                    ${parameters.entityId},
                    ${parameters.scopeId},
                    ${parameters.entityType} || ':' || ${parameters.entityId}::text,
                    NULL,
                    '{}'::jsonb,
                    normalize_search_text(${parameters.entityType} || ':' || ${parameters.entityId}::text, NULL, '{}'::jsonb),
                    ${parameters.model},
                    ${parameters.dimensions},
                    (${parameters.embeddingJson})::halfvec(${_config.embedding.maxDimensions}),
                    ${parameters.documentHash}
                )
                ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                    scope_id = EXCLUDED.scope_id,
                    model = EXCLUDED.model,
                    dimensions = EXCLUDED.dimensions,
                    embedding = EXCLUDED.embedding,
                    embedding_hash = EXCLUDED.embedding_hash,
                    updated_at = NOW()
                RETURNING WITH (OLD AS old, NEW AS new) new.entity_type, new.entity_id, (old.entity_type IS NULL)::boolean AS is_new`,
            Request: S.Struct({ dimensions: S.Int, documentHash: S.String, embeddingJson: S.String, entityId: S.UUID, entityType: S.String, model: S.String, scopeId: S.NullOr(S.UUID) }),
            Result:  S.Struct({ entityId: S.UUID, entityType: S.String, isNew: S.Boolean }),
        });
        const executeRefresh = SqlSchema.void({
            execute: (parameters) => sql`SELECT refresh_search_chunks(${parameters.scopeId}::uuid, ${parameters.includeGlobal})`.pipe(
                Effect.timeout(Duration.minutes(_config.refresh.timeoutMinutes)),
                Effect.andThen(sql`SELECT notify_search_refresh()`),
            ),
            Request: S.Struct({ includeGlobal: S.Boolean, scopeId: S.NullOr(S.UUID) }),
        });
        return {
            embeddingSources: Effect.fn('SearchRepo.embeddingSources')((options: { readonly dimensions: number; readonly entityTypes?: readonly string[] | undefined; readonly includeGlobal?: boolean | undefined; readonly limit?: number | undefined; readonly model: string; readonly scopeId?: string | null | undefined }) =>
                executeEmbeddingSources({
                    dimensions: options.dimensions, entityTypes: options.entityTypes ?? [], includeGlobal: options.includeGlobal ?? false,
                    limit: _clamp(options.limit ?? _config.limits.embeddingBatch, 1, _config.limits.embeddingBatch),
                    model: options.model, scopeId: options.scopeId ?? null,
                }).pipe(
                    Effect.map((sources) => sources.map((source) => ({ ...source, embeddingSource: source.normalizedText }))),
                    _mapSearchError('embeddingSources'),
                ),
            ),
            refresh: Effect.fn('SearchRepo.refresh')((scopeId: string | null = null, includeGlobal = false) =>
                executeRefresh({ includeGlobal, scopeId }).pipe(_mapSearchError('refresh'))),
            search: Effect.fn('SearchRepo.search')((options: { readonly embedding?: EmbeddingInput | undefined; readonly entityTypes?: readonly string[] | undefined; readonly includeFacets?: boolean | undefined; readonly includeGlobal?: boolean | undefined; readonly includeSnippets?: boolean | undefined; readonly scopeId: string | null; readonly term: string }, pagination: { cursor?: string | undefined; limit?: number | undefined } = {}) =>
                Effect.gen(function* () {
                    const cursor = Option.filter(yield* Page.decode(pagination.cursor, S.Number), (value) => S.is(S.UUID)(value.id));
                    const limit = _clamp(pagination.limit ?? _config.limits.defaultLimit, 1, _config.limits.maxLimit);
                    const embedding = yield* Option.match(Option.fromNullable(options.embedding), {
                        onNone: () => Effect.succeed(Option.none<{ dimensions: number; embeddingJson: string; model: string }>()),
                        onSome: (input) => _embeddingPayload(input).pipe(Effect.map(Option.some)),
                    });
                    const cursorArgs = Option.match(cursor, {
                        onNone: () => ({}),
                        onSome: (value) => ({ cursorId: value.id, cursorRank: value.v }),
                    });
                    const embeddingArgs = Option.match(embedding, {
                        onNone: () => ({}),
                        onSome: (value) => value,
                    });
                    const searchEffect = executeSearch({
                        entityTypes: options.entityTypes ?? [], includeFacets: options.includeFacets ?? false, includeGlobal: options.includeGlobal ?? false,
                        includeSnippets: options.includeSnippets ?? true, limit, scopeId: options.scopeId, term: options.term,
                        ...cursorArgs,
                        ...embeddingArgs,
                    }).pipe(_mapSearchError('search'));
                    const rows = yield* Match.value(Option.isSome(embedding)).pipe(
                        Match.when(true, () => Client.vector.withIterativeScan({
                            efSearch: _config.vector.efSearch,
                            maxScanTuples: _config.vector.maxScanTuples,
                            mode: _config.vector.mode,
                            scanMemMultiplier: _config.vector.scanMemMultiplier,
                        }, searchEffect)),
                        Match.orElse(() => searchEffect),
                    );
                    const totalCount = rows[0]?.totalCount ?? 0;
                    const facets = options.includeFacets ? rows[0]?.facets ?? null : null;
                    const { items } = Page.strip(rows.filter((row): row is typeof row & { entityId: string; entityType: string; displayText: string; rank: number } => row.entityId !== null));
                    return { ...Page.keyset(items, totalCount, limit, (item) => ({ id: item.entityId, v: item.rank }), S.Number, Option.isSome(cursor)), facets };
                }).pipe(Effect.tap(() => Effect.annotateCurrentSpan({ 'search.term': options.term }))),
            ),
            suggest: Effect.fn('SearchRepo.suggest')((options: { readonly includeGlobal?: boolean | undefined; readonly limit?: number | undefined; readonly prefix: string; readonly scopeId: string | null }) =>
                executeSuggestions({
                    includeGlobal: options.includeGlobal ?? false,
                    limit: _clamp(options.limit ?? _config.limits.suggestLimitDefault, 1, _config.limits.suggestLimitMax),
                    prefix: options.prefix, scopeId: options.scopeId,
                }).pipe(_mapSearchError('suggest')),
            ),
            upsertDocument: Effect.fn('SearchRepo.upsertDocument')((input: {
                readonly contentText?: string | null | undefined;
                readonly displayText: string;
                readonly entityId: string;
                readonly entityType: string;
                readonly metadata?: unknown;
                readonly scopeId: string | null;
            }) =>
                executeUpsertDocument({
                    contentText:  input.contentText ?? null,
                    displayText:  input.displayText,
                    entityId:     input.entityId,
                    entityType:   input.entityType,
                    metadataJson: JSON.stringify(input.metadata ?? {}),
                    scopeId:      input.scopeId,
                }).pipe(_mapSearchError('upsertDocument')),
            ),
            upsertEmbedding: Effect.fn('SearchRepo.upsertEmbedding')((input: { readonly dimensions: number; readonly embedding: readonly number[]; readonly entityId: string; readonly entityType: string; readonly documentHash: string; readonly model: string; readonly scopeId: string | null }) =>
                _embeddingPayload({ dimensions: input.dimensions, model: input.model, vector: input.embedding }).pipe(
                    Effect.andThen((payload) => executeUpsertEmbedding({ ...payload, documentHash: input.documentHash, entityId: input.entityId, entityType: input.entityType, scopeId: input.scopeId })),
                    _mapSearchError('upsertEmbedding'),
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
            upsertDocument: overrides.upsertDocument ?? ((_input) => Effect.succeed({ documentHash: '0', entityId: '00000000-0000-0000-0000-000000000000', entityType: 'app' as const })),
            upsertEmbedding: overrides.upsertEmbedding ?? ((_input) => Effect.succeed({ entityId: '00000000-0000-0000-0000-000000000000', entityType: 'app' as const, isNew: true })),
        } as SearchRepo);
}

// --- [EXPORT] ----------------------------------------------------------------

export { SearchEmbeddingDimensionsError, SearchError, SearchRepo };
