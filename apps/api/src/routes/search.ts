/**
 * Search API route handlers with tenant context and admin authorization.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { SearchService } from '@parametric-portal/server/domain/search';
import { HttpError } from '@parametric-portal/server/errors';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Middleware } from '@parametric-portal/server/middleware';
import { Effect, Option } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const SearchLive = HttpApiBuilder.group(ParametricApi, 'search', (handlers) =>
	Effect.gen(function* () {
		const search = yield* SearchService;
		const repositories = yield* DatabaseService;
		const requireRole = Middleware.makeRequireRole((id) => repositories.users.one([{ field: 'id', value: id }]).pipe(Effect.map(Option.map((user) => ({ role: user.role })))));
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
						Effect.mapError((error) => HttpError.Internal.of('Search failed', error)),
						Effect.withSpan('search.query', { kind: 'server' }),
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
						Effect.withSpan('search.suggest', { kind: 'server' }),
					),
				),
			)
			.handle('refresh', ({ payload }) =>
				CacheService.rateLimit('api',
					requireRole('admin').pipe(
						Effect.andThen(search.refresh(payload.includeGlobal)),
						Effect.as({ status: 'ok' as const }),
						Effect.catchAll((error) => Effect.fail('_tag' in error && error._tag === 'Forbidden' ? error : HttpError.Internal.of('Refresh failed', error))),
						Effect.withSpan('search.refresh', { kind: 'server' }),
					),
				),
			)
			.handle('refreshEmbeddings', ({ payload }) =>
				CacheService.rateLimit('api',
					requireRole('admin').pipe(
						Effect.andThen(search.refreshEmbeddings({ includeGlobal: payload.includeGlobal })),
						Effect.map((result) => ({ count: result.count })),
						Effect.catchAll((error) => Effect.fail('_tag' in error && error._tag === 'Forbidden' ? error : HttpError.Internal.of('Embedding refresh failed', error))),
						Effect.withSpan('search.refreshEmbeddings', { kind: 'server' }),
					),
				),
			);
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { SearchLive };
