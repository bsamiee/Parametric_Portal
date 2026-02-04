/**
 * Search API route handlers with tenant context and admin authorization.
 */
import { HttpApiBuilder } from '@effect/platform';
import { SearchService } from '@parametric-portal/ai/search';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { HttpError } from '@parametric-portal/server/errors';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Middleware } from '@parametric-portal/server/middleware';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Array as A, Effect, Option } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _ENTITY_TYPES = ['user', 'app', 'asset', 'auditLog'] as const;

// --- [LAYERS] ----------------------------------------------------------------

const SearchLive = HttpApiBuilder.group(ParametricApi, 'search', (handlers) =>
	Effect.gen(function* () {
		const search = yield* SearchService;
		const repositories = yield* DatabaseService;
		const requireRole = Middleware.makeRequireRole((id) => repositories.users.one([{ field: 'id', value: id }]).pipe(Effect.map(Option.map((user) => ({ role: user.role })))));
		const isEntityType = (v: string): v is typeof _ENTITY_TYPES[number] => (_ENTITY_TYPES as readonly string[]).includes(v);
		return handlers
			.handle('search', ({ urlParams }) =>
				CacheService.rateLimit('api',
					search.query(
						{
							entityTypes: urlParams.entityTypes,
							includeFacets: urlParams.includeFacets,
							includeGlobal: urlParams.includeGlobal,
							includeSnippets: urlParams.includeSnippets,
							term: urlParams.q,
						},
						{ cursor: urlParams.cursor, limit: urlParams.limit },
					).pipe(
						Effect.map((result) => ({
							cursor: result.cursor,
							facets: result.facets ? { app: result.facets['app'] ?? 0, asset: result.facets['asset'] ?? 0, auditLog: result.facets['auditLog'] ?? 0, user: result.facets['user'] ?? 0 } : null,
							hasNext: result.hasNext,
							hasPrev: result.hasPrev,
							items: A.filterMap(result.items, (item) => isEntityType(item.entityType) ? Option.some({ displayText: item.displayText, entityId: item.entityId, entityType: item.entityType, metadata: item.metadata, rank: item.rank, snippet: item.snippet }) : Option.none()),
							total: result.total,
						})),
						Effect.mapError((error) => HttpError.Internal.of('Search failed', error)),
						Telemetry.span('search.query', { kind: 'server' }),
					),
				),
			)
			.handle('suggest', ({ urlParams }) =>
				CacheService.rateLimit('api',
					search.suggest({
						includeGlobal: urlParams.includeGlobal,
						limit: urlParams.limit,
						prefix: urlParams.prefix,
					}).pipe(
						Effect.mapError((error) => HttpError.Internal.of('Suggest failed', error)),
						Telemetry.span('search.suggest', { kind: 'server' }),
					),
				),
			)
			.handle('refresh', ({ payload }) =>
				CacheService.rateLimit('api',
					requireRole('admin').pipe(
						Effect.andThen(search.refresh(payload.includeGlobal)),
						Effect.as({ status: 'ok' as const }),
						Effect.catchAll((error) => Effect.fail('_tag' in error && error._tag === 'Forbidden' ? error : HttpError.Internal.of('Refresh failed', error))),
						Telemetry.span('search.refresh', { kind: 'server' }),
					),
				),
			)
			.handle('refreshEmbeddings', ({ payload }) =>
				CacheService.rateLimit('api',
					requireRole('admin').pipe(
						Effect.andThen(search.refreshEmbeddings({ includeGlobal: payload.includeGlobal })),
						Effect.map((result) => ({ count: result.count })),
						Effect.catchAll((error) => Effect.fail('_tag' in error && error._tag === 'Forbidden' ? error : HttpError.Internal.of('Embedding refresh failed', error))),
						Telemetry.span('search.refreshEmbeddings', { kind: 'server' }),
					),
				),
			);
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { SearchLive };
