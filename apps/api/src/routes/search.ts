/**
 * Search API route handlers with tenant context and admin authorization.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { SearchService } from '@parametric-portal/server/domain/search';
import { HttpError } from '@parametric-portal/server/errors';
import { RateLimit } from '@parametric-portal/server/security/rate-limit';
import { Middleware } from '@parametric-portal/server/middleware';
import { Effect, Option } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const SearchLive = HttpApiBuilder.group(ParametricApi, 'search', (handlers) =>
	Effect.gen(function* () {
		const search = yield* SearchService;
		const repos = yield* DatabaseService;
		const requireRole = Middleware.makeRequireRole((id) => repos.users.one([{ field: 'id', value: id }]).pipe(Effect.map(Option.map((u) => ({ role: u.role })))));
		return handlers
			.handle('search', ({ urlParams }) =>
				RateLimit.apply('api',
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
						Effect.mapError((err) => HttpError.Internal.of('Search failed', err)),
						Effect.withSpan('search.query', { kind: 'server' }),
					),
				),
			)
			.handle('suggest', ({ urlParams }) =>
				RateLimit.apply('api',
					search.suggest({
						includeGlobal: urlParams.includeGlobal,
						limit: urlParams.limit,
						prefix: urlParams.prefix,
					}).pipe(
						Effect.mapError((err) => HttpError.Internal.of('Suggest failed', err)),
						Effect.withSpan('search.suggest', { kind: 'server' }),
					),
				),
			)
			.handle('refresh', ({ payload }) =>
				RateLimit.apply('api',
					requireRole('admin').pipe(
						Effect.andThen(search.refresh(payload.includeGlobal)),
						Effect.as({ status: 'ok' as const }),
						Effect.mapError((err) =>
							'_tag' in err && err._tag === 'Forbidden' ? err : HttpError.Internal.of('Refresh failed', err)
						),
						Effect.withSpan('search.refresh', { kind: 'server' }),
					),
				),
			);
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { SearchLive };
