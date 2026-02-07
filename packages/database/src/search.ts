import { SqlClient, SqlSchema } from '@effect/sql';
import { Page } from './page.ts';
import { Data, Duration, Effect, Layer, Match, Option, Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = (() => {
	const snippet = { delimiter: ' ... ', maxFragments: 3, maxWords: 50, minWords: 20, startSel: '<mark>', stopSel: '</mark>' } as const;
	return {
		channels: { refresh: 'search_refresh' },
		embedding: { maxDimensions: 3072, padValue: 0 },
		fuzzy: { maxDistance: 2, minTermLength: 4 },
		limits: {candidate: 200, defaultLimit: 20, embeddingBatch: 200, maxLimit: 100, suggestLimitDefault: 10, suggestLimitMax: 20, termMax: 256, termMin: 2,},
		rank: { normalization: 32 },
		refresh: { timeoutMinutes: 5 },
		regconfig: 'parametric_search',
		rrf: { k: 60, weights: { fts: 0.45, fuzzy: 0.1, semantic: 0.3, trgm: 0.15 } },
		snippet: { ...snippet, opts: `MaxWords=${snippet.maxWords},MinWords=${snippet.minWords},MaxFragments=${snippet.maxFragments},FragmentDelimiter=${snippet.delimiter},StartSel=${snippet.startSel},StopSel=${snippet.stopSel}` },
		tables: { documents: 'search_documents', embeddings: 'search_embeddings' },
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
		type EmbeddingInput = { readonly vector: readonly number[]; readonly model: string; readonly dimensions: number };
		/** Build scope and entity type filter fragments. Alias defaults to 'documents' for documents table; null for no alias. */
		const buildFilters = (parameters: { readonly entityTypes: readonly string[]; readonly includeGlobal: boolean; readonly scopeId: string | null }, alias: string | null = 'documents') => {
			const column = (name: string) => alias === null ? sql`${sql(name)}` : sql`${sql(alias)}.${sql(name)}`;
			const entityFilter = parameters.entityTypes.length ? sql`AND ${column('entity_type')} IN ${sql.in(parameters.entityTypes)}` : sql``;
			const scopeMatch = parameters.scopeId ? sql`${column('scope_id')} = ${parameters.scopeId}::uuid` : sql`${column('scope_id')} IS NULL`;
			const scopeFilter = parameters.includeGlobal && parameters.scopeId ? sql`AND (${scopeMatch} OR ${column('scope_id')} IS NULL)` : sql`AND ${scopeMatch}`;
			return { entityFilter, scopeFilter, scopeMatch };
		};
		const padEmbedding = (embedding: readonly number[]) =>
			Match.value(_CONFIG.embedding.maxDimensions - embedding.length).pipe(
				Match.when((pad) => pad <= _CONFIG.embedding.padValue, () => embedding),
				Match.orElse((pad) => [...embedding, ...Array.from({ length: pad }, () => _CONFIG.embedding.padValue)]),
			);
		const embeddingPayload = (input: EmbeddingInput) =>
			S.decode(S.Array(S.Number).pipe(S.itemsCount(input.dimensions)))(input.vector).pipe(
				Effect.map(padEmbedding),
				Effect.map((vector) => ({
					dimensions: input.dimensions,
					embeddingJson: JSON.stringify(vector),
					model: input.model,
				})),
			);
		const buildRankedCtes = (parameters: { readonly embeddingJson?: string | undefined; readonly dimensions?: number; readonly entityTypes: readonly string[]; readonly includeGlobal: boolean; readonly model?: string; readonly scopeId: string | null; readonly term: string }) => {
			const hasEmbedding = parameters.embeddingJson !== undefined;
			const { entityFilter, scopeFilter } = buildFilters(parameters);
			const term = sql`casefold(unaccent(${parameters.term}))`; // PG 18.1: casefold() for Unicode case folding (e.g., ß → ss), unaccent() for diacritics
			const query = sql`websearch_to_tsquery(${_CONFIG.regconfig}::regconfig, unaccent(${parameters.term}))`;
			const semanticParts = { // Dispatch table for semantic CTE (hasEmbedding ? with : without)
				cte: hasEmbedding
					? sql`,
					semantic_candidates AS (
						SELECT documents.entity_type, documents.entity_id,
							${1} - (embeddings.embedding <=> (${parameters.embeddingJson})::vector) AS semantic_score
						FROM ${sql(_CONFIG.tables.embeddings)} embeddings
						JOIN ${sql(_CONFIG.tables.documents)} documents
							ON documents.entity_type = embeddings.entity_type
							AND documents.entity_id = embeddings.entity_id
							AND documents.document_hash = embeddings.hash
						WHERE true
							AND embeddings.model = ${parameters.model}
							AND embeddings.dimensions = ${parameters.dimensions}
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
		const executeSearch = SqlSchema.findAll({ // PG 18.1: LEFT JOIN from totals ensures we always get total_count + facets even with 0 paged results
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
				dimensions: S.optional(S.Int),
				embeddingJson: S.optional(S.String),
				entityTypes: S.Array(S.String),
				includeFacets: S.Boolean,
				includeGlobal: S.Boolean,
				includeSnippets: S.Boolean,
				limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_CONFIG.limits.maxLimit)),
				model: S.optional(S.String),
				scopeId: S.NullOr(S.UUID),
				term: S.String.pipe(S.minLength(_CONFIG.limits.termMin), S.maxLength(_CONFIG.limits.termMax)),
			}),
			Result: S.Struct({ displayText: S.NullOr(S.String), entityId: S.NullOr(S.UUID), entityType: S.NullOr(S.String), facets: S.NullOr(S.Record({ key: S.String, value: S.Int })), metadata: S.NullOr(S.Unknown), rank: S.NullOr(S.Number), snippet: S.NullOr(S.String), totalCount: S.Int }),
		});
		const executeSuggestions = SqlSchema.findAll({
			execute: (parameters) => sql`SELECT term, frequency::int FROM get_search_suggestions(${parameters.prefix}, ${parameters.scopeId}::uuid, ${parameters.includeGlobal}, ${parameters.limit})`,
			Request: S.Struct({ includeGlobal: S.Boolean, limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_CONFIG.limits.suggestLimitMax)), prefix: S.String.pipe(S.minLength(_CONFIG.limits.termMin), S.maxLength(_CONFIG.limits.termMax)), scopeId: S.NullOr(S.UUID) }),
			Result: S.Struct({ frequency: S.Int, term: S.String }),
		});
		const executeEmbeddingSources = SqlSchema.findAll({
			execute: (parameters) => {
				const { entityFilter, scopeFilter } = buildFilters(parameters, 'd');
				return sql`
					SELECT d.entity_type, d.entity_id, d.scope_id, d.display_text, d.content_text, d.metadata, d.document_hash, d.updated_at
					FROM ${sql(_CONFIG.tables.documents)} d
					LEFT JOIN ${sql(_CONFIG.tables.embeddings)} e
						ON e.entity_type = d.entity_type
						AND e.entity_id = d.entity_id
						AND e.hash = d.document_hash
						AND e.model = ${parameters.model}
						AND e.dimensions = ${parameters.dimensions}
					WHERE true ${scopeFilter} ${entityFilter}
						AND e.entity_id IS NULL
					ORDER BY d.updated_at DESC
					LIMIT ${parameters.limit}
				`;
			},
			Request: S.Struct({ dimensions: S.Int, entityTypes: S.Array(S.String), includeGlobal: S.Boolean, limit: S.Int.pipe(S.positive(), S.lessThanOrEqualTo(_CONFIG.limits.embeddingBatch)), model: S.String, scopeId: S.NullOr(S.UUID) }),
			Result: S.Struct({ contentText: S.NullOr(S.String), displayText: S.String, documentHash: S.String, entityId: S.UUID, entityType: S.String, metadata: S.Unknown, scopeId: S.NullOr(S.UUID), updatedAt: S.DateFromSelf }),
		});
		const executeUpsertEmbedding = SqlSchema.single({ // PG 18.1: RETURNING WITH (OLD AS old, NEW AS new) returns both old and new row values, OLD.entity_type IS NULL means a fresh insert occurred
			execute: (parameters) => sql`
				INSERT INTO ${sql(_CONFIG.tables.embeddings)} (entity_type, entity_id, scope_id, model, dimensions, embedding, hash)
				VALUES (${parameters.entityType}, ${parameters.entityId}, ${parameters.scopeId}, ${parameters.model}, ${parameters.dimensions}, (${parameters.embeddingJson})::vector, ${parameters.documentHash})
				ON CONFLICT (entity_type, entity_id) DO UPDATE SET
					embedding = EXCLUDED.embedding,
					scope_id = EXCLUDED.scope_id,
					model = EXCLUDED.model,
					dimensions = EXCLUDED.dimensions,
					hash = EXCLUDED.hash
				RETURNING WITH (OLD AS old, NEW AS new)
					new.entity_type, new.entity_id,
					(old.entity_type IS NULL)::boolean AS is_new
			`,
			Request: S.Struct({ dimensions: S.Int, documentHash: S.String, embeddingJson: S.String, entityId: S.UUID, entityType: S.String, model: S.String, scopeId: S.NullOr(S.UUID) }),
			Result: S.Struct({ entityId: S.UUID, entityType: S.String, isNew: S.Boolean }),
		});
		return {
			embeddingSources: Effect.fn('SearchRepo.embeddingSources')((options: { readonly dimensions: number; readonly entityTypes?: readonly string[]; readonly includeGlobal?: boolean; readonly limit?: number; readonly model: string; readonly scopeId?: string | null }) =>
				executeEmbeddingSources({
					dimensions: options.dimensions,
					entityTypes: options.entityTypes ?? [],
					includeGlobal: options.includeGlobal ?? false,
					limit: Math.min(Math.max(options.limit ?? _CONFIG.limits.embeddingBatch, 1), _CONFIG.limits.embeddingBatch),
					model: options.model,
					scopeId: options.scopeId ?? null,
				}).pipe(
					Effect.mapError((cause) => new SearchError({ cause, operation: 'embeddingSources' })),
					Effect.withSpan('search.embeddingSources'),
				),
			),
			refresh: (() => {
				const executeRefresh = SqlSchema.void({ // SqlSchema.void provides request validation and type safety
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
			search: Effect.fn('SearchRepo.search')((options: { readonly embedding?: EmbeddingInput; readonly entityTypes?: readonly string[]; readonly includeFacets?: boolean; readonly includeGlobal?: boolean; readonly includeSnippets?: boolean; readonly scopeId: string | null; readonly term: string }, pagination: { cursor?: string; limit?: number } = {}) =>
				Effect.gen(function* () {
					const cursorValue = Option.filter(yield* Page.decode(pagination.cursor, S.Number), (cursor) => S.is(S.UUID)(cursor.id));
					const limit = Math.min(Math.max(pagination.limit ?? _CONFIG.limits.defaultLimit, 1), _CONFIG.limits.maxLimit);
					const embedding = yield* Option.fromNullable(options.embedding).pipe(
						Option.match({
							onNone: () => Effect.succeed(Option.none()),
							onSome: (input) => embeddingPayload(input).pipe(
								Effect.map(Option.some),
								Effect.mapError((cause) => new SearchError({ cause, operation: 'search' })),
							),
						}),
					);
					const rows = yield* executeSearch({
						entityTypes: options.entityTypes ?? [],
						includeFacets: options.includeFacets ?? false,
						includeGlobal: options.includeGlobal ?? false,
						includeSnippets: options.includeSnippets ?? true,
						limit,
						scopeId: options.scopeId,
						term: options.term,
						...(Option.isSome(cursorValue) ? { cursorId: cursorValue.value.id, cursorRank: cursorValue.value.v } : {}),
						...(Option.isSome(embedding) ? embedding.value : {}),
					}).pipe(Effect.mapError((cause) => new SearchError({ cause, operation: 'search' })));
					// LEFT JOIN guarantees at least 1 row; filter out totals-only row (entityId is null)
					const totalCount = rows[0]?.totalCount ?? 0;
					const facets = options.includeFacets ? rows[0]?.facets ?? null : null;
					const { items } = Page.strip(rows.filter((row): row is typeof row & { entityId: string; entityType: string; displayText: string; rank: number } => row.entityId !== null));
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
			upsertEmbedding: Effect.fn('SearchRepo.upsertEmbedding')((input: { readonly dimensions: number; readonly embedding: readonly number[]; readonly entityId: string; readonly entityType: string; readonly documentHash: string; readonly model: string; readonly scopeId: string | null }) =>
				embeddingPayload({ dimensions: input.dimensions, model: input.model, vector: input.embedding }).pipe(
					Effect.andThen((payload) => executeUpsertEmbedding({ ...payload, documentHash: input.documentHash, entityId: input.entityId, entityType: input.entityType, scopeId: input.scopeId })),
					Effect.mapError((cause) => new SearchError({ cause, operation: 'upsertEmbedding' })),
					Effect.withSpan('search.upsertEmbedding'),
				),
			),
		};
	}),
}) {
	static readonly Test = (overrides: Partial<SearchRepo> = {}) => // Test layer factory with mock implementations. Override only the methods you need.
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
