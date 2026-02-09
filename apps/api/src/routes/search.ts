/**
 * Search API route handlers with tenant context and admin authorization.
 */
import { HttpApiBuilder } from '@effect/platform';
import { SearchService } from '@parametric-portal/ai/search';
import { ParametricApi } from '@parametric-portal/server/api';
import { HttpError } from '@parametric-portal/server/errors';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Middleware } from '@parametric-portal/server/middleware';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Array as A, Effect } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _ENTITY_TYPES = ['user', 'app', 'asset', 'auditLog'] as const;

// --- [LAYERS] ----------------------------------------------------------------

const SearchLive = HttpApiBuilder.group(ParametricApi, 'search', (handlers) =>
	Effect.gen(function* () {
		const search = yield* SearchService;
		const isEntityType = <T extends { readonly entityType: string }>(
			item: T,
		): item is T & { readonly entityType: typeof _ENTITY_TYPES[number] } =>
			(_ENTITY_TYPES as readonly string[]).includes(item.entityType);
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
								facets:
									(result.facets && {
										app: result.facets['app'] ?? 0,
										asset: result.facets['asset'] ?? 0,
										auditLog: result.facets['auditLog'] ?? 0,
										user: result.facets['user'] ?? 0,
									}) ||
									null,
								hasNext: result.hasNext,
								hasPrev: result.hasPrev,
								items: A.filter(result.items, isEntityType),
								total: result.total,
							})),
							Effect.mapError((error) => HttpError.Internal.of('Search failed', error)),
							Telemetry.span('search.query', { kind: 'server', metrics: false }),
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
							Telemetry.span('search.suggest', { kind: 'server', metrics: false }),
						),
					),
				)
			.handle('refresh', ({ payload }) =>
				CacheService.rateLimit('api',
					Middleware.role('admin').pipe(
							Effect.andThen(search.refresh(payload.includeGlobal)),
							Effect.as({ status: 'ok' as const }),
							Effect.catchTag('Forbidden', Effect.fail),
							Effect.catchAll((error) => Effect.fail(HttpError.Internal.of('Refresh failed', error))),
							Telemetry.span('search.refresh', { kind: 'server', metrics: false }),
						),
					),
				)
			.handle('refreshEmbeddings', ({ payload }) =>
				CacheService.rateLimit('api',
					Middleware.role('admin').pipe(
							Effect.andThen(search.refreshEmbeddings({ includeGlobal: payload.includeGlobal })),
							Effect.map((result) => ({ count: result.count })),
							Effect.catchTag('Forbidden', Effect.fail),
							Effect.catchAll((error) => Effect.fail(HttpError.Internal.of('Embedding refresh failed', error))),
							Telemetry.span('search.refreshEmbeddings', { kind: 'server', metrics: false }),
						),
					),
				);
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { SearchLive };
