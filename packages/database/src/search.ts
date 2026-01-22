import { PgClient } from '@effect/sql-pg';
import { SqlClient, SqlSchema } from '@effect/sql';
import { Page } from './page.ts';
import { Data, Duration, Effect, Layer, Option, Schema as S, Stream } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type EntityType = 'app' | 'asset' | 'auditLog' | 'user';

// --- [CONSTANTS] -------------------------------------------------------------

const Tuning = (() => {
	const snippet = { delimiter: ' ... ', maxFragments: 3, maxWords: 50, minWords: 20, startSel: '<mark>', stopSel: '</mark>' } as const;
	return {
		channels: { refresh: 'search_refresh' },
		embedding: { dimensions: 1536 },
		fuzzy: { maxDistance: 2, minTermLength: 4 },
		limits: {
			candidate: 200,
			defaultLimit: 20,
			embeddingBatch: 200,
			maxLimit: 100,
			suggestLimitDefault: 10,
			suggestLimitMax: 20,
			termMax: 256,
			termMin: 2,
		},
		rank: { normalization: 32 },
		refresh: { timeoutMinutes: 5 },
		regconfig: 'parametric_search',
		rrf: { k: 60, weights: { fts: 0.45, fuzzy: 0.1, semantic: 0.3, trgm: 0.15 } },
		snippet: { ...snippet, opts: `MaxWords=${snippet.maxWords},MinWords=${snippet.minWords},MaxFragments=${snippet.maxFragments},FragmentDelimiter=${snippet.delimiter},StartSel=${snippet.startSel},StopSel=${snippet.stopSel}` },
		tables: { documents: 'search_documents', embeddingSources: 'search_embedding_sources', embeddings: 'search_embeddings' },
		text: { snippetJoiner: ' ' },
		trigram: { threshold: 0.3 },
	} as const;
})();

// --- [CLASSES] ---------------------------------------------------------------

class SearchError extends Data.TaggedError('SearchError')<{ readonly cause: unknown; readonly operation: string }> {}

// --- [SERVICES] --------------------------------------------------------------

class SearchService extends Effect.Service<SearchService>()('database/SearchService', {
	effect: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const pg = yield* PgClient.PgClient;
		const buildRankedCtes = (params: { readonly embeddingJson?: string | undefined; readonly entityTypes: readonly EntityType[]; readonly includeGlobal: boolean; readonly scopeId: string | null; readonly term: string }) => {
			const hasEmbedding = params.embeddingJson !== undefined;
			const entityFilter = params.entityTypes.length ? sql`AND d.entity_type IN ${sql.in(params.entityTypes)}` : sql``;
			const scopeMatch = params.scopeId ? sql`d.scope_id = ${params.scopeId}::uuid` : sql`d.scope_id IS NULL`;
			const scopeFilter = params.includeGlobal && params.scopeId ? sql`AND (${scopeMatch} OR d.scope_id IS NULL)` : sql`AND ${scopeMatch}`;
		const term = sql`casefold(unaccent(${params.term}))`; 	// PG 18.1: casefold() for Unicode case folding (e.g., ß → ss), unaccent() for diacritics
			const query = sql`websearch_to_tsquery(${Tuning.regconfig}::regconfig, unaccent(${params.term}))`;
			const semanticParts = { 							// Dispatch table for semantic CTE (hasEmbedding ? with : without)
				cte: hasEmbedding
					? sql`,
					semantic_candidates AS (
						SELECT d.entity_type, d.entity_id,
							${1} - (e.embedding <=> (${params.embeddingJson})::vector) AS semantic_score
						FROM ${sql(Tuning.tables.embeddings)} e
						JOIN ${sql(Tuning.tables.documents)} d
							ON d.entity_type = e.entity_type
							AND d.entity_id = e.entity_id
							AND d.content_hash = e.content_hash
						WHERE true
							${scopeFilter}
							${entityFilter}
						ORDER BY e.embedding <=> (${params.embeddingJson})::vector
						LIMIT ${Tuning.limits.candidate}
					),
					semantic_ranked AS (
						SELECT entity_type, entity_id,
							ROW_NUMBER() OVER (ORDER BY semantic_score DESC NULLS LAST, entity_id DESC) AS semantic_rank
						FROM semantic_candidates
					)`
					: sql``,
				union: hasEmbedding
					? sql`UNION ALL SELECT entity_type, entity_id, 'semantic' AS source, semantic_rank AS rnk FROM semantic_ranked`
					: sql``,
			} as const;
			const ctes = sql`
					fts_candidates AS (
						SELECT d.entity_type, d.entity_id,
							ts_rank_cd(d.search_vector, ${query}, ${Tuning.rank.normalization}) AS fts_score
						FROM ${sql(Tuning.tables.documents)} d
						WHERE d.search_vector @@ ${query}
							${scopeFilter}
							${entityFilter}
						ORDER BY fts_score DESC NULLS LAST, d.entity_id DESC
						LIMIT ${Tuning.limits.candidate}
					),
					trgm_candidates AS (
						SELECT d.entity_type, d.entity_id,
						similarity(d.display_text, unaccent(${params.term})) AS trgm_score
					FROM ${sql(Tuning.tables.documents)} d
					WHERE d.display_text % unaccent(${params.term})
						AND similarity(d.display_text, unaccent(${params.term})) >= ${Tuning.trigram.threshold}
							${scopeFilter}
							${entityFilter}
						ORDER BY trgm_score DESC NULLS LAST, d.entity_id DESC
						LIMIT ${Tuning.limits.candidate}
					),
					fuzzy_candidates AS (
						SELECT d.entity_type, d.entity_id, f.distance AS fuzzy_distance
						FROM ${sql(Tuning.tables.documents)} d
						CROSS JOIN LATERAL (
							SELECT levenshtein_less_equal(casefold(unaccent(d.display_text)), ${term}, ${Tuning.fuzzy.maxDistance}) AS distance
						) f
						WHERE char_length(${term}) >= ${Tuning.fuzzy.minTermLength}
							${scopeFilter}
							${entityFilter}
						ORDER BY f.distance ASC NULLS LAST, d.entity_id DESC
						LIMIT ${Tuning.limits.candidate}
					),
					fts_ranked AS (
						SELECT entity_type, entity_id,
							ROW_NUMBER() OVER (ORDER BY fts_score DESC NULLS LAST, entity_id DESC) AS fts_rank
						FROM fts_candidates
					),
					trgm_ranked AS (
						SELECT entity_type, entity_id,
							ROW_NUMBER() OVER (ORDER BY trgm_score DESC NULLS LAST, entity_id DESC) AS trgm_rank
						FROM trgm_candidates
					),
					fuzzy_ranked AS (
						SELECT entity_type, entity_id,
							ROW_NUMBER() OVER (ORDER BY fuzzy_distance ASC NULLS LAST, entity_id DESC) AS fuzzy_rank
						FROM fuzzy_candidates
					)
					${semanticParts.cte},
					ranked AS (
						SELECT entity_type, entity_id, 'fts' AS source, fts_rank AS rnk FROM fts_ranked
						UNION ALL SELECT entity_type, entity_id, 'trgm' AS source, trgm_rank AS rnk FROM trgm_ranked
						UNION ALL SELECT entity_type, entity_id, 'fuzzy' AS source, fuzzy_rank AS rnk FROM fuzzy_ranked
						${semanticParts.union}
					),
					scored AS (
						SELECT entity_type, entity_id,
							COALESCE(SUM(1.0 / (${Tuning.rrf.k} + rnk)) FILTER (WHERE source = 'fts'), 0) * ${Tuning.rrf.weights.fts} +
							COALESCE(SUM(1.0 / (${Tuning.rrf.k} + rnk)) FILTER (WHERE source = 'trgm'), 0) * ${Tuning.rrf.weights.trgm} +
							COALESCE(SUM(1.0 / (${Tuning.rrf.k} + rnk)) FILTER (WHERE source = 'fuzzy'), 0) * ${Tuning.rrf.weights.fuzzy} +
							COALESCE(SUM(1.0 / (${Tuning.rrf.k} + rnk)) FILTER (WHERE source = 'semantic'), 0) * ${Tuning.rrf.weights.semantic}
							AS rank
						FROM ranked
						GROUP BY entity_type, entity_id
					)
				`;
			return { ctes, query };
		};
		const executeSearch = SqlSchema.findAll({ 		// PG 18.1: LEFT JOIN from totals ensures we always get total_count + facets even with 0 paged results
			execute: (params) => {
				const hasCursor = params.cursorRank !== undefined && params.cursorId !== undefined;
				const cursorFilter = hasCursor
					? sql`WHERE (p.rank, p.entity_id) < (${params.cursorRank}, ${params.cursorId}::uuid)`
					: sql``;
				const { ctes, query } = buildRankedCtes(params);
				const limitWithLookahead = params.limit + 1;
				const snippetExpr = params.includeSnippets
					? sql`ts_headline(${Tuning.regconfig}::regconfig, coalesce(d.display_text, '') || ${Tuning.text.snippetJoiner} || coalesce(d.content_text, '') || ${Tuning.text.snippetJoiner} || coalesce((SELECT string_agg(value, ' ') FROM jsonb_each_text(d.metadata)), ''), ${query}, ${Tuning.snippet.opts})`
					: sql`NULL`;
				const facetsExpr = params.includeFacets
					? sql`(SELECT jsonb_object_agg(entity_type, cnt) FROM (SELECT entity_type, COUNT(*)::int AS cnt FROM scored GROUP BY entity_type) f)`
					: sql`NULL::jsonb`;
				return sql`
					WITH
					${ctes},
					totals AS (
						SELECT
							(SELECT COUNT(*) FROM scored)::int AS total_count,
							${facetsExpr} AS facets
					),
					paged AS (
						SELECT s.entity_type, s.entity_id, d.display_text, d.metadata, s.rank,
							${snippetExpr} AS snippet
						FROM scored s
						JOIN ${sql(Tuning.tables.documents)} d
							ON d.entity_type = s.entity_type AND d.entity_id = s.entity_id
						ORDER BY s.rank DESC, s.entity_id DESC
					),
					filtered AS (
						SELECT * FROM paged p
						${cursorFilter}
						LIMIT ${limitWithLookahead}
					)
					SELECT f.entity_type, f.entity_id, f.display_text, f.metadata, f.rank, f.snippet,
						t.total_count, t.facets
					FROM totals t
					LEFT JOIN filtered f ON true
					ORDER BY f.rank DESC NULLS LAST, f.entity_id DESC NULLS LAST
				`;
			},
			Request: S.Struct({
				cursorId: S.optional(S.UUID),
				cursorRank: S.optional(S.Number),
				embeddingJson: S.optional(S.String),
				entityTypes: S.Array(S.Literal('app', 'asset', 'auditLog', 'user')),
				includeFacets: S.Boolean,
				includeGlobal: S.Boolean,
				includeSnippets: S.Boolean,
				limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(Tuning.limits.maxLimit)),
				scopeId: S.NullOr(S.UUID),
				term: S.String.pipe(S.minLength(Tuning.limits.termMin), S.maxLength(Tuning.limits.termMax)),
			}),
			Result: S.Struct({ displayText: S.NullOr(S.String), entityId: S.NullOr(S.UUID), entityType: S.NullOr(S.Literal('app', 'asset', 'auditLog', 'user')), facets: S.NullOr(S.Record({ key: S.Literal('app', 'asset', 'auditLog', 'user'), value: S.Int })), metadata: S.NullOr(S.Unknown), rank: S.NullOr(S.Number), snippet: S.NullOr(S.String), totalCount: S.Int }),
		});
		const executeSuggestions = SqlSchema.findAll({
			execute: (params) => sql`SELECT term, frequency::int FROM get_search_suggestions(${params.prefix}, ${params.scopeId}::uuid, ${params.includeGlobal}, ${params.limit})`,
			Request: S.Struct({ includeGlobal: S.Boolean, limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(Tuning.limits.suggestLimitMax)), prefix: S.String.pipe(S.minLength(Tuning.limits.termMin), S.maxLength(Tuning.limits.termMax)), scopeId: S.NullOr(S.UUID) }),
			Result: S.Struct({ frequency: S.Int, term: S.String }),
		});
		const executeEmbeddingSources = SqlSchema.findAll({
			execute: (params) => {
				const entityFilter = params.entityTypes.length ? sql`AND entity_type IN ${sql.in(params.entityTypes)}` : sql``;
				const scopeMatch = params.scopeId ? sql`scope_id = ${params.scopeId}::uuid` : sql`scope_id IS NULL`;
				const scopeFilter = params.includeGlobal && params.scopeId ? sql`AND (${scopeMatch} OR scope_id IS NULL)` : sql`AND ${scopeMatch}`;
				return sql`
					SELECT entity_type, entity_id, scope_id, display_text, content_text, metadata, content_hash, updated_at
					FROM ${sql(Tuning.tables.embeddingSources)}
					WHERE true ${scopeFilter} ${entityFilter}
					ORDER BY updated_at DESC
					LIMIT ${params.limit}
				`;
			},
			Request: S.Struct({ entityTypes: S.Array(S.Literal('app', 'asset', 'auditLog', 'user')), includeGlobal: S.Boolean, limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(Tuning.limits.embeddingBatch)), scopeId: S.NullOr(S.UUID) }),
			Result: S.Struct({ contentHash: S.String, contentText: S.NullOr(S.String), displayText: S.String, entityId: S.UUID, entityType: S.Literal('app', 'asset', 'auditLog', 'user'), metadata: S.Unknown, scopeId: S.NullOr(S.UUID), updatedAt: S.DateFromSelf }),
		});
		const executeUpsertEmbedding = SqlSchema.single({ 	// PG 18.1: RETURNING WITH (OLD AS o, NEW AS n) returns both old and new row values, OLD.entity_type IS NULL means a fresh insert occurred
			execute: (params) => sql`
				INSERT INTO ${sql(Tuning.tables.embeddings)} (entity_type, entity_id, scope_id, embedding, content_hash)
				VALUES (${params.entityType}, ${params.entityId}, ${params.scopeId}, (${params.embeddingJson})::vector, ${params.contentHash})
				ON CONFLICT (entity_type, entity_id) DO UPDATE SET
					embedding = EXCLUDED.embedding,
					scope_id = EXCLUDED.scope_id,
					content_hash = EXCLUDED.content_hash
				RETURNING WITH (OLD AS o, NEW AS n)
					n.entity_type, n.entity_id,
					(o.entity_type IS NULL)::boolean AS is_new
			`,
			Request: S.Struct({ contentHash: S.String, embeddingJson: S.String, entityId: S.UUID, entityType: S.Literal('app', 'asset', 'auditLog', 'user'), scopeId: S.NullOr(S.UUID) }),
			Result: S.Struct({ entityId: S.UUID, entityType: S.Literal('app', 'asset', 'auditLog', 'user'), isNew: S.Boolean }),
		});
		return {
			embeddingSources: Effect.fn('SearchService.embeddingSources')((options: { readonly entityTypes?: readonly EntityType[]; readonly includeGlobal?: boolean; readonly limit?: number; readonly scopeId?: string | null }) =>
				executeEmbeddingSources({
					entityTypes: options.entityTypes ?? [],
					includeGlobal: options.includeGlobal ?? false,
					limit: Math.min(Math.max(options.limit ?? Tuning.limits.embeddingBatch, 1), Tuning.limits.embeddingBatch),
					scopeId: options.scopeId ?? null,
				}).pipe(
					Effect.mapError((cause) => new SearchError({ cause, operation: 'embeddingSources' })),
					Effect.withSpan('search.embeddingSources'),
				),
			),
			onRefresh: () =>
				pg.listen(Tuning.channels.refresh).pipe(
					Stream.mapEffect((payload) => S.decodeUnknown(S.parseJson(S.Struct({ event: S.String, timestamp: S.Number })))(payload)),
					Stream.mapError((cause) => new SearchError({ cause, operation: 'listen' })),
				),
			refresh: (() => {
				const executeRefresh = SqlSchema.void({ 	// SqlSchema.void provides request validation and type safety
					execute: (params) =>
						sql`SELECT refresh_search_documents(${params.scopeId}::uuid, ${params.includeGlobal})`.pipe(
							Effect.timeout(Duration.minutes(Tuning.refresh.timeoutMinutes)),
							Effect.andThen(sql`SELECT notify_search_refresh()`),
						),
					Request: S.Struct({ includeGlobal: S.Boolean, scopeId: S.NullOr(S.UUID) }),
				});
				return Effect.fn('SearchService.refresh')((scopeId: string | null = null, includeGlobal = false) =>
					executeRefresh({ includeGlobal, scopeId }).pipe(
						Effect.mapError((cause) => new SearchError({ cause, operation: 'refresh' })),
						Effect.withSpan('search.refresh'),
					),
				);
			})(),
			search: Effect.fn('SearchService.search')((options: { readonly embedding?: readonly number[]; readonly entityTypes?: readonly EntityType[]; readonly includeFacets?: boolean; readonly includeGlobal?: boolean; readonly includeSnippets?: boolean; readonly scopeId: string | null; readonly term: string }, pagination: { cursor?: string; limit?: number } = {}) =>
				Effect.gen(function* () {
					const cursorValue = Option.filter(yield* Page.decode(pagination.cursor, S.Number), (c) => S.is(S.UUID)(c.id));
					const limit = Math.min(Math.max(pagination.limit ?? Tuning.limits.defaultLimit, 1), Tuning.limits.maxLimit);
					const rows = yield* executeSearch({
						entityTypes: options.entityTypes ?? [],
						includeFacets: options.includeFacets ?? false,
						includeGlobal: options.includeGlobal ?? false,
						includeSnippets: options.includeSnippets ?? true,
						limit,
						scopeId: options.scopeId,
						term: options.term,
						...(Option.isSome(cursorValue) ? { cursorId: cursorValue.value.id, cursorRank: cursorValue.value.v } : {}),
						...(options.embedding && options.embedding.length > 0 ? { embeddingJson: JSON.stringify(options.embedding) } : {}),
					}).pipe(Effect.mapError((cause) => new SearchError({ cause, operation: 'search' })));
					// LEFT JOIN guarantees at least 1 row; filter out totals-only row (entityId is null)
					const totalCount = rows[0]?.totalCount ?? 0;
					const facets = options.includeFacets ? rows[0]?.facets ?? null : null;
					const { items } = Page.strip(rows.filter((r): r is typeof r & { entityId: string; entityType: EntityType; displayText: string; rank: number } => r.entityId !== null));
					return { ...Page.keyset(items, totalCount, limit, (item) => ({ id: item.entityId, v: item.rank }), S.Number, Option.isSome(cursorValue)), facets };
				}).pipe(Effect.withSpan('search.query', { attributes: { term: options.term } })),
			),
			suggest: Effect.fn('SearchService.suggest')((options: { readonly includeGlobal?: boolean; readonly limit?: number; readonly prefix: string; readonly scopeId: string | null }) =>
				executeSuggestions({
					includeGlobal: options.includeGlobal ?? false,
					limit: Math.min(Math.max(options.limit ?? Tuning.limits.suggestLimitDefault, 1), Tuning.limits.suggestLimitMax),
					prefix: options.prefix,
					scopeId: options.scopeId,
				}).pipe(
					Effect.mapError((cause) => new SearchError({ cause, operation: 'suggest' })),
					Effect.withSpan('search.suggest'),
				),
			),
			upsertEmbedding: Effect.fn('SearchService.upsertEmbedding')((input: { readonly contentHash: string; readonly embedding: readonly number[]; readonly entityId: string; readonly entityType: EntityType; readonly scopeId: string | null }) =>
				S.decode(S.Array(S.Number).pipe(S.itemsCount(Tuning.embedding.dimensions)))(input.embedding).pipe(
					Effect.andThen((embedding) => executeUpsertEmbedding({ contentHash: input.contentHash, embeddingJson: JSON.stringify(embedding), entityId: input.entityId, entityType: input.entityType, scopeId: input.scopeId })),
					Effect.mapError((cause) => new SearchError({ cause, operation: 'upsertEmbedding' })),
					Effect.withSpan('search.upsertEmbedding'),
				),
			),
		};
	}),
}) {
	static readonly layer = this.Default;
	static readonly Test = (overrides: Partial<SearchService> = {}) => 	/** Create a test layer with mock implementations for SearchService methods. Override only the methods you need in your test. */
		Layer.succeed(SearchService, {
			embeddingSources: overrides.embeddingSources ?? ((_) => Effect.succeed([])),
			onRefresh: overrides.onRefresh ?? (() => Stream.empty),
			refresh: overrides.refresh ?? ((_scopeId, _includeGlobal) => Effect.void),
			search: overrides.search ?? ((_options, _pagination) => Effect.succeed({ cursor: undefined, facets: null, hasMore: false, items: [], total: 0 })),
			suggest: overrides.suggest ?? ((_options) => Effect.succeed([])),
			upsertEmbedding: overrides.upsertEmbedding ?? ((_input) => Effect.succeed({ entityId: '00000000-0000-0000-0000-000000000000', entityType: 'app' as const, isNew: true })),
		} as SearchService);
}

// --- [EXPORT] ----------------------------------------------------------------

export { SearchError, SearchService };
