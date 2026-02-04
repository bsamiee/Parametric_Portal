import { PgClient } from '@effect/sql-pg';
import { SqlClient, SqlSchema } from '@effect/sql';
import { Page } from './page.ts';
import { Data, Duration, Effect, Layer, Option, Schema as S, Stream } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

const EntityTypeSchema = S.Literal('app', 'asset', 'auditLog', 'user');
type EntityType = typeof EntityTypeSchema.Type;

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = (() => {
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

class SearchRepo extends Effect.Service<SearchRepo>()('database/Search', {
	effect: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const pg = yield* PgClient.PgClient;
		/** Build scope and entity type filter fragments. Alias defaults to 'documents' for documents table; null for no alias. */
		const buildFilters = (parameters: { readonly entityTypes: readonly EntityType[]; readonly includeGlobal: boolean; readonly scopeId: string | null }, alias: string | null = 'documents') => {
			const column = (name: string) => alias === null ? sql`${sql(name)}` : sql`${sql(alias)}.${sql(name)}`;
			const entityFilter = parameters.entityTypes.length ? sql`AND ${column('entity_type')} IN ${sql.in(parameters.entityTypes)}` : sql``;
			const scopeMatch = parameters.scopeId ? sql`${column('scope_id')} = ${parameters.scopeId}::uuid` : sql`${column('scope_id')} IS NULL`;
			const scopeFilter = parameters.includeGlobal && parameters.scopeId ? sql`AND (${scopeMatch} OR ${column('scope_id')} IS NULL)` : sql`AND ${scopeMatch}`;
			return { entityFilter, scopeFilter, scopeMatch };
		};
		const buildRankedCtes = (parameters: { readonly embeddingJson?: string | undefined; readonly entityTypes: readonly EntityType[]; readonly includeGlobal: boolean; readonly scopeId: string | null; readonly term: string }) => {
			const hasEmbedding = parameters.embeddingJson !== undefined;
			const { entityFilter, scopeFilter } = buildFilters(parameters);
		const term = sql`casefold(unaccent(${parameters.term}))`; 	// PG 18.1: casefold() for Unicode case folding (e.g., ß → ss), unaccent() for diacritics
			const query = sql`websearch_to_tsquery(${_CONFIG.regconfig}::regconfig, unaccent(${parameters.term}))`;
			const semanticParts = { 							// Dispatch table for semantic CTE (hasEmbedding ? with : without)
				cte: hasEmbedding
					? sql`,
					semantic_candidates AS (
						SELECT documents.entity_type, documents.entity_id,
							${1} - (embeddings.embedding <=> (${parameters.embeddingJson})::vector) AS semantic_score
						FROM ${sql(_CONFIG.tables.embeddings)} embeddings
						JOIN ${sql(_CONFIG.tables.documents)} documents
							ON documents.entity_type = embeddings.entity_type
							AND documents.entity_id = embeddings.entity_id
							AND documents.hash = embeddings.hash
						WHERE true
							${scopeFilter}
							${entityFilter}
						ORDER BY embeddings.embedding <=> (${parameters.embeddingJson})::vector
						LIMIT ${_CONFIG.limits.candidate}
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
						SELECT documents.entity_type, documents.entity_id,
							ts_rank_cd(documents.search_vector, ${query}, ${_CONFIG.rank.normalization}) AS fts_score
						FROM ${sql(_CONFIG.tables.documents)} documents
						WHERE documents.search_vector @@ ${query}
							${scopeFilter}
							${entityFilter}
						ORDER BY fts_score DESC NULLS LAST, documents.entity_id DESC
						LIMIT ${_CONFIG.limits.candidate}
					),
					trgm_candidates AS (
						SELECT documents.entity_type, documents.entity_id,
						similarity(documents.display_text, unaccent(${parameters.term})) AS trgm_score
					FROM ${sql(_CONFIG.tables.documents)} documents
					WHERE documents.display_text % unaccent(${parameters.term})
						AND similarity(documents.display_text, unaccent(${parameters.term})) >= ${_CONFIG.trigram.threshold}
							${scopeFilter}
							${entityFilter}
						ORDER BY trgm_score DESC NULLS LAST, documents.entity_id DESC
						LIMIT ${_CONFIG.limits.candidate}
					),
					fuzzy_candidates AS (
						SELECT documents.entity_type, documents.entity_id, fuzzy.distance AS fuzzy_distance
						FROM ${sql(_CONFIG.tables.documents)} documents
						CROSS JOIN LATERAL (
							SELECT levenshtein_less_equal(casefold(unaccent(documents.display_text)), ${term}, ${_CONFIG.fuzzy.maxDistance}) AS distance
						) fuzzy
						WHERE char_length(${term}) >= ${_CONFIG.fuzzy.minTermLength}
							${scopeFilter}
							${entityFilter}
						ORDER BY fuzzy.distance ASC NULLS LAST, documents.entity_id DESC
						LIMIT ${_CONFIG.limits.candidate}
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
							COALESCE(SUM(1.0 / (${_CONFIG.rrf.k} + rnk)) FILTER (WHERE source = 'fts'), 0) * ${_CONFIG.rrf.weights.fts} +
							COALESCE(SUM(1.0 / (${_CONFIG.rrf.k} + rnk)) FILTER (WHERE source = 'trgm'), 0) * ${_CONFIG.rrf.weights.trgm} +
							COALESCE(SUM(1.0 / (${_CONFIG.rrf.k} + rnk)) FILTER (WHERE source = 'fuzzy'), 0) * ${_CONFIG.rrf.weights.fuzzy} +
							COALESCE(SUM(1.0 / (${_CONFIG.rrf.k} + rnk)) FILTER (WHERE source = 'semantic'), 0) * ${_CONFIG.rrf.weights.semantic}
							AS rank
						FROM ranked
						GROUP BY entity_type, entity_id
					)
				`;
			return { ctes, query };
		};
		const executeSearch = SqlSchema.findAll({ 		// PG 18.1: LEFT JOIN from totals ensures we always get total_count + facets even with 0 paged results
			execute: (parameters) => {
				const hasCursor = parameters.cursorRank !== undefined && parameters.cursorId !== undefined;
				const cursorFilter = hasCursor
					? sql`WHERE (paged.rank, paged.entity_id) < (${parameters.cursorRank}, ${parameters.cursorId}::uuid)`
					: sql``;
				const { ctes, query } = buildRankedCtes(parameters);
				const limitWithLookahead = parameters.limit + 1;
				const snippetExpr = parameters.includeSnippets
					? sql`ts_headline(${_CONFIG.regconfig}::regconfig, coalesce(documents.display_text, '') || ${_CONFIG.text.snippetJoiner} || coalesce(documents.content_text, '') || ${_CONFIG.text.snippetJoiner} || coalesce((SELECT string_agg(value, ' ') FROM jsonb_each_text(documents.metadata)), ''), ${query}, ${_CONFIG.snippet.opts})`
					: sql`NULL`;
				const facetsExpr = parameters.includeFacets
					? sql`(SELECT jsonb_object_agg(entity_type, cnt) FROM (SELECT entity_type, COUNT(*)::int AS cnt FROM scored GROUP BY entity_type) facet)`
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
						SELECT scored.entity_type, scored.entity_id, documents.display_text, documents.metadata, scored.rank,
							${snippetExpr} AS snippet
						FROM scored scored
						JOIN ${sql(_CONFIG.tables.documents)} documents
							ON documents.entity_type = scored.entity_type AND documents.entity_id = scored.entity_id
						ORDER BY scored.rank DESC, scored.entity_id DESC
					),
					filtered AS (
						SELECT * FROM paged paged
						${cursorFilter}
						LIMIT ${limitWithLookahead}
					)
					SELECT filtered.entity_type, filtered.entity_id, filtered.display_text, filtered.metadata, filtered.rank, filtered.snippet,
						totals.total_count, totals.facets
					FROM totals totals
					LEFT JOIN filtered filtered ON true
					ORDER BY filtered.rank DESC NULLS LAST, filtered.entity_id DESC NULLS LAST
				`;
			},
			Request: S.Struct({
				cursorId: S.optional(S.UUID),
				cursorRank: S.optional(S.Number),
				embeddingJson: S.optional(S.String),
				entityTypes: S.Array(EntityTypeSchema),
				includeFacets: S.Boolean,
				includeGlobal: S.Boolean,
				includeSnippets: S.Boolean,
				limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_CONFIG.limits.maxLimit)),
				scopeId: S.NullOr(S.UUID),
				term: S.String.pipe(S.minLength(_CONFIG.limits.termMin), S.maxLength(_CONFIG.limits.termMax)),
			}),
			Result: S.Struct({ displayText: S.NullOr(S.String), entityId: S.NullOr(S.UUID), entityType: S.NullOr(EntityTypeSchema), facets: S.NullOr(S.Record({ key: EntityTypeSchema, value: S.Int })), metadata: S.NullOr(S.Unknown), rank: S.NullOr(S.Number), snippet: S.NullOr(S.String), totalCount: S.Int }),
		});
		const executeSuggestions = SqlSchema.findAll({
			execute: (parameters) => sql`SELECT term, frequency::int FROM get_search_suggestions(${parameters.prefix}, ${parameters.scopeId}::uuid, ${parameters.includeGlobal}, ${parameters.limit})`,
			Request: S.Struct({ includeGlobal: S.Boolean, limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_CONFIG.limits.suggestLimitMax)), prefix: S.String.pipe(S.minLength(_CONFIG.limits.termMin), S.maxLength(_CONFIG.limits.termMax)), scopeId: S.NullOr(S.UUID) }),
			Result: S.Struct({ frequency: S.Int, term: S.String }),
		});
		const executeEmbeddingSources = SqlSchema.findAll({
			execute: (parameters) => {
				const { entityFilter, scopeFilter } = buildFilters(parameters, null);
				return sql`
					SELECT entity_type, entity_id, scope_id, display_text, content_text, metadata, hash, updated_at
					FROM ${sql(_CONFIG.tables.embeddingSources)}
					WHERE true ${scopeFilter} ${entityFilter}
					ORDER BY updated_at DESC
					LIMIT ${parameters.limit}
				`;
			},
			Request: S.Struct({ entityTypes: S.Array(EntityTypeSchema), includeGlobal: S.Boolean, limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_CONFIG.limits.embeddingBatch)), scopeId: S.NullOr(S.UUID) }),
			Result: S.Struct({ contentText: S.NullOr(S.String), displayText: S.String, entityId: S.UUID, entityType: EntityTypeSchema, hash: S.String, metadata: S.Unknown, scopeId: S.NullOr(S.UUID), updatedAt: S.DateFromSelf }),
		});
		const executeUpsertEmbedding = SqlSchema.single({ 	// PG 18.1: RETURNING WITH (OLD AS old, NEW AS new) returns both old and new row values, OLD.entity_type IS NULL means a fresh insert occurred
			execute: (parameters) => sql`
				INSERT INTO ${sql(_CONFIG.tables.embeddings)} (entity_type, entity_id, scope_id, embedding, hash)
				VALUES (${parameters.entityType}, ${parameters.entityId}, ${parameters.scopeId}, (${parameters.embeddingJson})::vector, ${parameters.hash})
				ON CONFLICT (entity_type, entity_id) DO UPDATE SET
					embedding = EXCLUDED.embedding,
					scope_id = EXCLUDED.scope_id,
					hash = EXCLUDED.hash
				RETURNING WITH (OLD AS old, NEW AS new)
					new.entity_type, new.entity_id,
					(old.entity_type IS NULL)::boolean AS is_new
			`,
			Request: S.Struct({ embeddingJson: S.String, entityId: S.UUID, entityType: EntityTypeSchema, hash: S.String, scopeId: S.NullOr(S.UUID) }),
			Result: S.Struct({ entityId: S.UUID, entityType: EntityTypeSchema, isNew: S.Boolean }),
		});
		return {
			embeddingSources: Effect.fn('SearchRepo.embeddingSources')((options: { readonly entityTypes?: readonly EntityType[]; readonly includeGlobal?: boolean; readonly limit?: number; readonly scopeId?: string | null }) =>
				executeEmbeddingSources({
					entityTypes: options.entityTypes ?? [],
					includeGlobal: options.includeGlobal ?? false,
					limit: Math.min(Math.max(options.limit ?? _CONFIG.limits.embeddingBatch, 1), _CONFIG.limits.embeddingBatch),
					scopeId: options.scopeId ?? null,
				}).pipe(
					Effect.mapError((cause) => new SearchError({ cause, operation: 'embeddingSources' })),
					Effect.withSpan('search.embeddingSources'),
				),
			),
			onRefresh: () =>
				pg.listen(_CONFIG.channels.refresh).pipe(
					Stream.mapEffect((payload) => S.decodeUnknown(S.parseJson(S.Struct({ event: S.String, timestamp: S.Number })))(payload)),
					Stream.mapError((cause) => new SearchError({ cause, operation: 'listen' })),
				),
			refresh: (() => {
				const executeRefresh = SqlSchema.void({ 	// SqlSchema.void provides request validation and type safety
					execute: (parameters) =>
						sql`SELECT refresh_search_documents(${parameters.scopeId}::uuid, ${parameters.includeGlobal})`.pipe(
							Effect.timeout(Duration.minutes(_CONFIG.refresh.timeoutMinutes)),
							Effect.andThen(sql`SELECT notify_search_refresh()`),
						),
					Request: S.Struct({ includeGlobal: S.Boolean, scopeId: S.NullOr(S.UUID) }),
				});
				return Effect.fn('SearchRepo.refresh')((scopeId: string | null = null, includeGlobal = false) =>
					executeRefresh({ includeGlobal, scopeId }).pipe(
						Effect.mapError((cause) => new SearchError({ cause, operation: 'refresh' })),
						Effect.withSpan('search.refresh'),
					),
				);
			})(),
			search: Effect.fn('SearchRepo.search')((options: { readonly embedding?: readonly number[]; readonly entityTypes?: readonly EntityType[]; readonly includeFacets?: boolean; readonly includeGlobal?: boolean; readonly includeSnippets?: boolean; readonly scopeId: string | null; readonly term: string }, pagination: { cursor?: string; limit?: number } = {}) =>
				Effect.gen(function* () {
					const cursorValue = Option.filter(yield* Page.decode(pagination.cursor, S.Number), (cursor) => S.is(S.UUID)(cursor.id));
					const limit = Math.min(Math.max(pagination.limit ?? _CONFIG.limits.defaultLimit, 1), _CONFIG.limits.maxLimit);
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
					const { items } = Page.strip(rows.filter((row): row is typeof row & { entityId: string; entityType: EntityType; displayText: string; rank: number } => row.entityId !== null));
					return { ...Page.keyset(items, totalCount, limit, (item) => ({ id: item.entityId, v: item.rank }), S.Number, Option.isSome(cursorValue)), facets };
				}).pipe(Effect.withSpan('search.query', { attributes: { term: options.term } })),
			),
			suggest: Effect.fn('SearchRepo.suggest')((options: { readonly includeGlobal?: boolean; readonly limit?: number; readonly prefix: string; readonly scopeId: string | null }) =>
				executeSuggestions({
					includeGlobal: options.includeGlobal ?? false,
					limit: Math.min(Math.max(options.limit ?? _CONFIG.limits.suggestLimitDefault, 1), _CONFIG.limits.suggestLimitMax),
					prefix: options.prefix,
					scopeId: options.scopeId,
				}).pipe(
					Effect.mapError((cause) => new SearchError({ cause, operation: 'suggest' })),
					Effect.withSpan('search.suggest'),
				),
			),
			upsertEmbedding: Effect.fn('SearchRepo.upsertEmbedding')((input: { readonly hash: string; readonly embedding: readonly number[]; readonly entityId: string; readonly entityType: EntityType; readonly scopeId: string | null }) =>
				S.decode(S.Array(S.Number).pipe(S.itemsCount(_CONFIG.embedding.dimensions)))(input.embedding).pipe(
					Effect.andThen((embedding) => executeUpsertEmbedding({ embeddingJson: JSON.stringify(embedding), entityId: input.entityId, entityType: input.entityType, hash: input.hash, scopeId: input.scopeId })),
					Effect.mapError((cause) => new SearchError({ cause, operation: 'upsertEmbedding' })),
					Effect.withSpan('search.upsertEmbedding'),
				),
			),
		};
	}),
}) {
	/** Test layer factory with mock implementations. Override only the methods you need. */
	static readonly Test = (overrides: Partial<SearchRepo> = {}) =>
		Layer.succeed(SearchRepo, {
			embeddingSources: overrides.embeddingSources ?? ((_) => Effect.succeed([])),
			onRefresh: overrides.onRefresh ?? (() => Stream.empty),
			refresh: overrides.refresh ?? ((_scopeId, _includeGlobal) => Effect.void),
			search: overrides.search ?? ((_options, _pagination) => Effect.succeed({ cursor: null, facets: null, hasNext: false, hasPrev: false, items: [], total: 0 })),
			suggest: overrides.suggest ?? ((_options) => Effect.succeed([])),
			upsertEmbedding: overrides.upsertEmbedding ?? ((_input) => Effect.succeed({ entityId: '00000000-0000-0000-0000-000000000000', entityType: 'app' as const, isNew: true })),
		} as SearchRepo);
}

// --- [EXPORT] ----------------------------------------------------------------

export { SearchError, SearchRepo };
