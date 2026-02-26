import { SqlClient, SqlSchema, type Statement } from '@effect/sql';
import { Array as A, Data, Duration, Effect, Layer, Option, Schema as S, String as Str } from 'effect';
import { Client } from './client.ts';
import { Page } from './page.ts';

// --- [TYPES] -----------------------------------------------------------------

type _Strat = { w: number; tbl?: string; flt?: string; ord?: 'ASC'; score?: string | null };

// --- [ERRORS] ----------------------------------------------------------------

class SearchError extends Data.TaggedError('SearchError')<{
    readonly reason:     'embeddingDimensions' | 'query' | 'upsert' | 'unknown';
    readonly cause?:     unknown;
    readonly operation?: string;
    readonly details?:   unknown;
}> {}

// --- [CONSTANTS] -------------------------------------------------------------

const _cfg = {
    embedding: { maxDim:  3072, pad:    0              },
    fuzzy:     { maxDist: 2,    maxLen: 255, minLen: 4 },
    limits: {
        candidate:      300, default:    20, embedBatch: 200, max:     100,
        suggestDefault: 10,  suggestMax: 20, termMax:    256, termMin: 2
    },
    phonetic: { minLen: 3 },
    rank: 32,
    refreshMin: 5,
    regconfig: 'parametric_search',
    rrf: {
        k: 60, strategies: {
            fts:                  { w: 0.3                                                },
            fuzzy:                { ord: 'ASC' as const, score: 'fuzzy_distance', w: 0.08 },
            phonetic:             { score: null,         w: 0.02                          },
            semantic:             { w: 0.2                                                },
            trgm_knn_similarity:  { w: 0.05                                               },
            trgm_knn_strict_word: { w: 0.02                                               },
            trgm_knn_word:        { w: 0.03                                               },
            trgm_similarity:      { flt: 'trgm_similarity_match',  tbl: 'trgm_candidates', w: 0.15 },
            trgm_strict_word:     { flt: 'trgm_strict_word_match', tbl: 'trgm_candidates', w: 0.05 },
            trgm_word:            { flt: 'trgm_word_match',        tbl: 'trgm_candidates', w: 0.1  },
        },
    },
    snippet: { delim: ' ... ', frags: 3, maxW: 50, minW: 20, start: '<mark>', stop: '</mark>' },
    table:   'search_chunks',
    trigram: { minLen: 2 },
    vector:  { efSearch: 120,  maxTuples: 40_000, memMult: 2, mode: 'relaxed_order' as const },
} as const;
const _stratKeys =    Object.keys(_cfg.rrf.strategies) as ReadonlyArray<keyof typeof _cfg.rrf.strategies>;
const _scoreCols =    Object.fromEntries(_stratKeys.map((k) => { const s = _cfg.rrf.strategies[k] as _Strat; return [k, 'score' in s ? s.score : `${k}_score`]; })) as Record<keyof typeof _cfg.rrf.strategies, string | null>;
const _snippetOpts =  `MaxWords=${_cfg.snippet.maxW},MinWords=${_cfg.snippet.minW},MaxFragments=${_cfg.snippet.frags},FragmentDelimiter=${_cfg.snippet.delim},StartSel=${_cfg.snippet.start},StopSel=${_cfg.snippet.stop}`;
const _trgmKnnOps =   [['similarity', '<->'], ['word', '<<->'], ['strictWord', '<<<->']] as const;

// --- [SCHEMA] ----------------------------------------------------------------

const _scopeFields =  { includeGlobal: S.Boolean, scopeId: S.NullOr(S.UUID) };
const _entityFilter = { entityTypes:   S.Array(S.String), ..._scopeFields   };
const _embedFields =  { dimensions:    S.Int, model: S.String               };

// --- [FUNCTIONS] -------------------------------------------------------------

const _clamp =  (v: number | undefined, d: number, max: number) =>  Math.min(Math.max(v ?? d, 1), max);
const _mapErr = (op: string) => Effect.mapError((cause: unknown) => new SearchError({ cause, operation: op, reason: 'unknown' }));

// --- [SERVICES] --------------------------------------------------------------

class SearchRepo extends Effect.Service<SearchRepo>()('database/Search', {
    effect: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        type EmbeddingInput = { readonly vector: readonly number[]; readonly model: string; readonly dimensions: number };
        const _filters = (p: { readonly entityTypes: readonly string[]; readonly includeGlobal: boolean; readonly scopeId: string | null }, a = 'documents') => {
            const col = (n: string) => sql`${sql(a)}.${sql(n)}`;
            const preds = A.getSomes([
                Option.fromNullable(p.scopeId).pipe(Option.map((id) => p.includeGlobal ? sql`(${col('scope_id')} = ${id}::uuid OR ${col('scope_id')} IS NULL)` : sql`${col('scope_id')} = ${id}::uuid`), Option.orElse(() => Option.some(sql`${col('scope_id')} IS NULL`))),
                Option.liftPredicate(p.entityTypes, (t) => t.length > 0).pipe(Option.map((types) => sql`${col('entity_type')} IN ${sql.in(types)}`)),
            ]);
            return A.match(preds, { onEmpty: () => sql`TRUE`, onNonEmpty: (ps) => sql.and(ps) });
        };
        const _embedPayload = (i: EmbeddingInput) =>
            S.decode(S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_cfg.embedding.maxDim)))(i.dimensions).pipe(
                Effect.mapError(() => new SearchError({ details: { dimensions: i.dimensions, maxDimensions: _cfg.embedding.maxDim }, reason: 'embeddingDimensions' })),
                Effect.flatMap((d) => S.decode(S.Array(S.Number).pipe(S.itemsCount(d)))(i.vector).pipe(Effect.map((v) => {
                    const pad = _cfg.embedding.maxDim - v.length;
                    return { dimensions: d, embeddingJson: JSON.stringify(pad <= 0 ? v : [...v, ...Array.from<number>({ length: pad }).fill(_cfg.embedding.pad)]), model: i.model };
                }))),
            );
        const _buildCtes = (p: { readonly embeddingJson?: string; readonly dimensions?: number; readonly entityTypes: readonly string[]; readonly includeGlobal: boolean; readonly model?: string; readonly scopeId: string | null; readonly term: string }) => {
            const hasEmbed = p.embeddingJson !== undefined, where = _filters(p);
            const norm = sql`left(normalize_search_text(${p.term}, NULL, NULL), ${_cfg.fuzzy.maxLen})`, q = sql`websearch_to_tsquery(${_cfg.regconfig}::regconfig, ${p.term})`;
            const trgmKnnCtes = _trgmKnnOps.map(([key, op]) => {
                const snake = `trgm_knn_${Str.camelToSnake(key)}`, dist = sql.unsafe(`documents.normalized_text ${op} `) as unknown as Statement.Fragment;
                return sql`${sql.literal(snake)}_candidates AS (SELECT documents.entity_type, documents.entity_id, documents.normalized_text, ${1} - (${dist}${norm}) AS ${sql.literal(snake)}_score FROM ${sql(_cfg.table)} documents WHERE ${where} AND char_length(${norm}) >= ${_cfg.trigram.minLen} ORDER BY ${dist}${norm}, documents.entity_id DESC LIMIT ${_cfg.limits.candidate})`;
            });
            const activeKeys = _stratKeys.filter((k) => k !== 'semantic' || hasEmbed);
            const rankedCtes = activeKeys.map((k) => {
                const s = _cfg.rrf.strategies[k] as _Strat, tbl = s.tbl ?? `${k}_candidates`, sc = _scoreCols[k], ord = sc ? `${sc} ${s.ord ?? 'DESC'} NULLS LAST, entity_id DESC` : 'entity_id DESC';
                const fltExpr = k === 'fuzzy' ? `fuzzy_distance <= ${_cfg.fuzzy.maxDist}` : s.flt;
                const flt = fltExpr ? sql` WHERE ${sql.unsafe(fltExpr)}` : sql``;
                return sql`${sql.literal(k)}_ranked AS (SELECT entity_type, entity_id, ROW_NUMBER() OVER (ORDER BY ${sql.unsafe(ord)}) AS ${sql.literal(k)}_rank FROM ${sql.literal(tbl)}${flt})`;
            });
            const union = activeKeys.map((k, i) => `${i ? 'UNION ALL ' : ''}SELECT entity_type, entity_id, '${k}' AS source, ${k}_rank AS rnk FROM ${k}_ranked`).join('\n');
            const activeWeightSum = activeKeys.reduce((acc, k) => acc + (_cfg.rrf.strategies[k] as _Strat).w, 0) || 1;
            const scoreTerms = activeKeys.map((k) => `COALESCE(SUM(1.0 / (${_cfg.rrf.k} + rnk)) FILTER (WHERE source = '${k}'), 0) * ${(_cfg.rrf.strategies[k] as _Strat).w}`).join(' + ');
            const score = `(${scoreTerms}) / ${activeWeightSum}`;
            const semanticCte = hasEmbed ? sql`, semantic_candidates AS (SELECT documents.entity_type, documents.entity_id, ${1} - (documents.embedding <=> (${p.embeddingJson})::halfvec(${_cfg.embedding.maxDim})) AS semantic_score FROM ${sql(_cfg.table)} documents WHERE ${where} AND documents.embedding IS NOT NULL AND documents.embedding_hash = documents.document_hash AND documents.model = ${p.model} AND documents.dimensions = ${p.dimensions} ORDER BY documents.embedding <=> (${p.embeddingJson})::halfvec(${_cfg.embedding.maxDim}), documents.entity_id DESC LIMIT ${_cfg.limits.candidate})` : sql``;
            return { ctes: sql`fts_candidates AS (SELECT documents.entity_type, documents.entity_id, ts_rank_cd(documents.search_vector, ${q}, ${_cfg.rank}) AS fts_score FROM ${sql(_cfg.table)} documents WHERE ${where} AND documents.search_vector @@ ${q} ORDER BY fts_score DESC NULLS LAST, documents.entity_id DESC LIMIT ${_cfg.limits.candidate}), trgm_candidates AS (SELECT documents.entity_type, documents.entity_id, documents.normalized_text, similarity(documents.normalized_text, ${norm}) AS trgm_similarity_score, word_similarity(${norm}, documents.normalized_text) AS trgm_word_score, strict_word_similarity(${norm}, documents.normalized_text) AS trgm_strict_word_score, documents.normalized_text % ${norm} AS trgm_similarity_match, ${norm} <% documents.normalized_text AS trgm_word_match, ${norm} <<% documents.normalized_text AS trgm_strict_word_match FROM ${sql(_cfg.table)} documents WHERE ${where} AND char_length(${norm}) >= ${_cfg.trigram.minLen} AND (documents.normalized_text % ${norm} OR ${norm} <% documents.normalized_text OR ${norm} <<% documents.normalized_text) ORDER BY GREATEST(trgm_similarity_score, trgm_word_score, trgm_strict_word_score) DESC NULLS LAST, documents.entity_id DESC LIMIT ${_cfg.limits.candidate}), ${sql.csv(trgmKnnCtes)}, fuzzy_candidates AS (SELECT knn.entity_type, knn.entity_id, levenshtein_less_equal(left(knn.normalized_text, ${_cfg.fuzzy.maxLen}), ${norm}, ${_cfg.fuzzy.maxDist}) AS fuzzy_distance FROM trgm_knn_similarity_candidates knn WHERE char_length(${norm}) >= ${_cfg.fuzzy.minLen} ORDER BY fuzzy_distance ASC NULLS LAST, knn.entity_id DESC LIMIT ${_cfg.limits.candidate}), phonetic_candidates AS (SELECT metaphone.entity_type, metaphone.entity_id FROM (SELECT documents.entity_type, documents.entity_id FROM ${sql(_cfg.table)} documents WHERE char_length(${norm}) >= ${_cfg.phonetic.minLen} AND ${where} AND documents.phonetic_code = dmetaphone(${norm}) ORDER BY documents.entity_id DESC LIMIT ${_cfg.limits.candidate}) metaphone UNION SELECT daitch.entity_type, daitch.entity_id FROM (SELECT documents.entity_type, documents.entity_id FROM ${sql(_cfg.table)} documents WHERE char_length(${norm}) >= ${_cfg.trigram.minLen} AND ${where} AND documents.phonetic_daitch && daitch_mokotoff(${norm}) ORDER BY documents.entity_id DESC LIMIT ${_cfg.limits.candidate}) daitch) ${semanticCte}, ${sql.csv(rankedCtes)}, ranked AS (${sql.unsafe(union)}), scored AS (SELECT entity_type, entity_id, ${sql.unsafe(score)} AS rank FROM ranked GROUP BY entity_type, entity_id)`, query: q };
        };
        const executeSearch = SqlSchema.findAll({
            execute: (p) => {
                const curFlt = p.cursorRank !== undefined && p.cursorId !== undefined ? sql`WHERE (paged.rank, paged.entity_id) < (${p.cursorRank}, ${p.cursorId}::uuid)` : sql``;
                const { ctes, query } = _buildCtes({ entityTypes: p.entityTypes, includeGlobal: p.includeGlobal, scopeId: p.scopeId, term: p.term, ...Option.getOrUndefined(Option.all({ dimensions: Option.fromNullable(p.dimensions), embeddingJson: Option.fromNullable(p.embeddingJson), model: Option.fromNullable(p.model) })) });
                const snip = p.includeSnippets ? sql`ts_headline(${_cfg.regconfig}::regconfig, coalesce(documents.display_text, '') || ' ' || coalesce(documents.content_text, '') || ' ' || coalesce((SELECT string_agg(value, ' ') FROM jsonb_each_text(coalesce(documents.metadata, '{}'::jsonb))), ''), ${query}, ${_snippetOpts})` : sql`NULL`;
                const fac = p.includeFacets ? sql`(SELECT jsonb_object_agg(entity_type, cnt) FROM (SELECT entity_type, COUNT(*)::int AS cnt FROM scored GROUP BY entity_type) facet)` : sql`NULL::jsonb`;
                return sql`WITH ${ctes}, totals AS (SELECT (SELECT COUNT(*) FROM scored)::int AS total_count, ${fac} AS facets), paged AS (SELECT scored.entity_type, scored.entity_id, documents.display_text, documents.metadata, scored.rank, ${snip} AS snippet FROM scored JOIN ${sql(_cfg.table)} documents ON documents.entity_type = scored.entity_type AND documents.entity_id = scored.entity_id ORDER BY scored.rank DESC, scored.entity_id DESC), filtered AS (SELECT * FROM paged paged ${curFlt} LIMIT ${p.limit + 1}) SELECT filtered.entity_type, filtered.entity_id, filtered.display_text, filtered.metadata, filtered.rank, filtered.snippet, totals.total_count, totals.facets FROM totals LEFT JOIN filtered ON true ORDER BY filtered.rank DESC NULLS LAST, filtered.entity_id DESC NULLS LAST`;
            },
            Request: S.Struct({
                cursorId:        S.optional(S.UUID),
                cursorRank:      S.optional(S.Number),
                dimensions:      S.optional(S.Int),
                embeddingJson:   S.optional(S.String),
                model:           S.optional(S.String),
                ..._entityFilter,
                includeFacets:   S.Boolean,
                includeSnippets: S.Boolean,
                limit:           S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_cfg.limits.max)),
                term:            S.String.pipe(S.minLength(_cfg.limits.termMin), S.maxLength(_cfg.limits.termMax)) }).pipe(S.mutable),
            Result: S.Struct({
                displayText: S.NullOr(S.String),
                entityId:    S.NullOr(S.UUID),
                entityType:  S.NullOr(S.String),
                facets:      S.NullOr(S.Record({ key: S.String, value: S.Int })),
                metadata:    S.NullOr(S.Unknown),
                rank:        S.NullOr(S.Number),
                snippet:     S.NullOr(S.String),
                totalCount:  S.Int
            }),
        });
        const executeSuggestions = SqlSchema.findAll({
            execute: (p) => sql`SELECT term, frequency::int FROM get_search_suggestions(${p.prefix}, ${p.scopeId}::uuid, ${p.includeGlobal}, ${p.limit})`,
            Request: S.Struct({ ..._scopeFields, limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_cfg.limits.suggestMax)), prefix: S.String.pipe(S.minLength(_cfg.limits.termMin), S.maxLength(_cfg.limits.termMax)) }),
            Result:  S.Struct({ frequency: S.Int, term: S.String }),
        });
        const executeEmbedSources = SqlSchema.findAll({
            execute: (p) => { const where = _filters(p, 'd'); return sql`SELECT d.entity_type, d.entity_id, d.scope_id, d.display_text, d.content_text, d.metadata, d.document_hash, d.normalized_text, d.updated_at FROM ${sql(_cfg.table)} d WHERE ${where} AND (d.embedding IS NULL OR d.embedding_hash IS DISTINCT FROM d.document_hash OR d.model IS DISTINCT FROM ${p.model} OR d.dimensions IS DISTINCT FROM ${p.dimensions}) ORDER BY d.updated_at DESC LIMIT ${p.limit}`; },
            Request: S.Struct({ ..._embedFields, ..._entityFilter, limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_cfg.limits.embedBatch)) }),
            Result:  S.Struct({ contentText: S.NullOr(S.String), displayText: S.String, documentHash: S.String, entityId: S.UUID, entityType: S.String, metadata: S.Unknown, normalizedText: S.String, scopeId: S.NullOr(S.UUID), updatedAt: S.DateFromSelf }),
        });
        const executeUpsertDoc = SqlSchema.single({
            execute: (p) => sql`INSERT INTO ${sql(_cfg.table)} (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text) VALUES (${p.entityType}, ${p.entityId}, ${p.scopeId}, ${p.displayText}, ${p.contentText}, jsonb_strip_nulls(${p.metadataJson}::jsonb, true), normalize_search_text(${p.displayText}, ${p.contentText}, jsonb_strip_nulls(${p.metadataJson}::jsonb, true))) ON CONFLICT (entity_type, entity_id) DO UPDATE SET scope_id = EXCLUDED.scope_id, display_text = EXCLUDED.display_text, content_text = EXCLUDED.content_text, metadata = EXCLUDED.metadata, normalized_text = EXCLUDED.normalized_text, model = NULL, dimensions = NULL, embedding = NULL, embedding_hash = NULL, updated_at = NOW() RETURNING entity_type, entity_id, document_hash`,
            Request: S.Struct({ contentText: S.NullOr(S.String), displayText: S.String, entityId: S.UUID, entityType: S.String, metadataJson: S.String, scopeId: S.NullOr(S.UUID) }),
            Result:  S.Struct({ documentHash: S.String, entityId: S.UUID, entityType: S.String }),
        });
        const executeUpsertEmbed = SqlSchema.single({
            execute: (p) => sql`INSERT INTO ${sql(_cfg.table)} (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text, model, dimensions, embedding, embedding_hash) VALUES (${p.entityType}, ${p.entityId}, ${p.scopeId}, ${p.entityType} || ':' || ${p.entityId}::text, NULL, '{}'::jsonb, normalize_search_text(${p.entityType} || ':' || ${p.entityId}::text, NULL, '{}'::jsonb), ${p.model}, ${p.dimensions}, (${p.embeddingJson})::halfvec(${_cfg.embedding.maxDim}), ${p.documentHash}) ON CONFLICT (entity_type, entity_id) DO UPDATE SET scope_id = EXCLUDED.scope_id, model = EXCLUDED.model, dimensions = EXCLUDED.dimensions, embedding = EXCLUDED.embedding, embedding_hash = EXCLUDED.embedding_hash, updated_at = NOW() RETURNING WITH (OLD AS old, NEW AS new) new.entity_type, new.entity_id, (old.entity_type IS NULL)::boolean AS is_new`,
            Request: S.Struct({ ..._embedFields, documentHash: S.String, embeddingJson: S.String, entityId: S.UUID, entityType: S.String, scopeId: S.NullOr(S.UUID) }),
            Result:  S.Struct({ entityId: S.UUID, entityType: S.String, isNew: S.Boolean }),
        });
        const executeRefresh = SqlSchema.void({
            execute: (p) => sql`SELECT refresh_search_chunks(${p.scopeId}::uuid, ${p.includeGlobal})`.pipe(Effect.timeout(Duration.minutes(_cfg.refreshMin)), Effect.andThen(sql`SELECT notify_search_refresh()`)),
            Request: S.Struct(_scopeFields),
        });
        return {
            embeddingSources: Effect.fn('SearchRepo.embeddingSources')((opts: { readonly dimensions: number; readonly entityTypes?: readonly string[] | undefined; readonly includeGlobal?: boolean | undefined; readonly limit?: number | undefined; readonly model: string; readonly scopeId?: string | null | undefined }) =>
                executeEmbedSources({
                    dimensions:    opts.dimensions,
                    entityTypes:   opts.entityTypes ?? [],
                    includeGlobal: opts.includeGlobal ?? false,
                    limit:         _clamp(opts.limit,_cfg.limits.embedBatch, _cfg.limits.embedBatch),
                    model:         opts.model, scopeId: opts.scopeId ?? null
                }).pipe(Effect.map((s) => s.map((r) => ({ ...r, embeddingSource: r.normalizedText }))), _mapErr('embeddingSources'))),
            refresh: Effect.fn('SearchRepo.refresh')((scopeId: string | null = null, includeGlobal = false) => executeRefresh({ includeGlobal, scopeId }).pipe(_mapErr('refresh'))),
            search: Effect.fn('SearchRepo.search')((opts: { readonly embedding?: EmbeddingInput; readonly entityTypes?: readonly string[] | undefined; readonly includeFacets?: boolean | undefined; readonly includeGlobal?: boolean | undefined; readonly includeSnippets?: boolean | undefined; readonly scopeId: string | null; readonly term: string }, pag: { cursor?: string | undefined; limit?: number | undefined } = {}) =>
                Effect.gen(function* () {
                    const cursor = Option.filter(yield* Page.decode(pag.cursor, S.Number), (v) => S.is(S.UUID)(v.id)), limit = _clamp(pag.limit, _cfg.limits.default, _cfg.limits.max);
                    const embed = yield* Option.fromNullable(opts.embedding).pipe(Option.map(_embedPayload), Effect.transposeOption);
                    const searchParams = { entityTypes: opts.entityTypes ?? [], includeFacets: opts.includeFacets ?? false, includeGlobal: opts.includeGlobal ?? false, includeSnippets: opts.includeSnippets ?? true, limit, scopeId: opts.scopeId, term: opts.term, ...Option.getOrUndefined(Option.map(cursor, (v) => ({ cursorId: v.id, cursorRank: v.v }))), ...Option.getOrUndefined(embed) };
                    const searchEffect = executeSearch(searchParams).pipe(_mapErr('search'));
                    const rows = yield* Option.match(embed, { onNone: () => searchEffect, onSome: () => Client.vector.withIterativeScan({ efSearch: _cfg.vector.efSearch, maxScanTuples: _cfg.vector.maxTuples, mode: _cfg.vector.mode, scanMemMultiplier: _cfg.vector.memMult }, searchEffect) });
                    const total = rows[0]?.totalCount ?? 0, facets = opts.includeFacets ? rows[0]?.facets ?? null : null;
                    const { items } = Page.strip(rows.filter((r): r is typeof r & { entityId: string; entityType: string; displayText: string; rank: number } => r.entityId !== null));
                    return { ...Page.keyset(items, total, limit, (i) => ({ id: i.entityId, v: i.rank }), S.Number, Option.isSome(cursor)), facets };
                }).pipe(Effect.tap(() => Effect.annotateCurrentSpan({ 'search.term': opts.term })))),
            suggest: Effect.fn('SearchRepo.suggest')((opts: { readonly includeGlobal?: boolean | undefined; readonly limit?: number | undefined; readonly prefix: string; readonly scopeId: string | null }) =>
                executeSuggestions({ includeGlobal: opts.includeGlobal ?? false, limit: _clamp(opts.limit, _cfg.limits.suggestDefault, _cfg.limits.suggestMax), prefix: opts.prefix, scopeId: opts.scopeId }).pipe(_mapErr('suggest'))),
            upsertDocument: Effect.fn('SearchRepo.upsertDocument')((i: { readonly contentText?: string | null; readonly displayText: string; readonly entityId: string; readonly entityType: string; readonly metadata?: unknown; readonly scopeId: string | null }) =>
                executeUpsertDoc({ contentText: i.contentText ?? null, displayText: i.displayText, entityId: i.entityId, entityType: i.entityType, metadataJson: JSON.stringify(i.metadata ?? {}), scopeId: i.scopeId }).pipe(_mapErr('upsertDocument'))),
            upsertEmbedding: Effect.fn('SearchRepo.upsertEmbedding')((i: { readonly dimensions: number; readonly embedding: readonly number[]; readonly entityId: string; readonly entityType: string; readonly documentHash: string; readonly model: string; readonly scopeId: string | null }) =>
                _embedPayload({ dimensions: i.dimensions, model: i.model, vector: i.embedding }).pipe(Effect.andThen((p) => executeUpsertEmbed({ ...p, documentHash: i.documentHash, entityId: i.entityId, entityType: i.entityType, scopeId: i.scopeId }).pipe(_mapErr('upsertEmbedding'))))),
        };
    }),
}) {
    static readonly _testDefaults = {
        embeddingSources: () => Effect.succeed([]),
        refresh:          () => Effect.void,
        search:           () => Effect.succeed({cursor: null, facets: null, hasNext: false, hasPrev: false, items: [], total: 0 }),
        suggest:          () => Effect.succeed([]),
        upsertDocument:   () => Effect.succeed({ documentHash: '0', entityId: '00000000-0000-0000-0000-000000000000', entityType: 'app' as const }),
        upsertEmbedding:  () => Effect.succeed({ entityId: '00000000-0000-0000-0000-000000000000', entityType: 'app' as const, isNew: true }) } as const;
    static readonly Test = (overrides: Partial<SearchRepo> = {}) => Layer.succeed(SearchRepo, { ...SearchRepo._testDefaults, ...overrides } as SearchRepo);
}

// --- [EXPORT] ----------------------------------------------------------------

export { SearchError, SearchRepo };
