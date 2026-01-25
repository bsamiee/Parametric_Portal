/**
 * Search API route handlers with tenant context and admin authorization.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { AuditService } from '@parametric-portal/server/domain/audit';
import { SearchDomainService } from '@parametric-portal/server/domain/search';
import { HttpError } from '@parametric-portal/server/errors';
import { RateLimit } from '@parametric-portal/server/infra/rate-limit';
import { Middleware } from '@parametric-portal/server/middleware';
import { Effect, Option } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const SearchLive = HttpApiBuilder.group(ParametricApi, 'search', (handlers) =>
	Effect.gen(function* () {
		const search = yield* SearchDomainService;
		const repos = yield* DatabaseService;
		const audit = yield* AuditService;
		const requireRole = Middleware.makeRequireRole((id) => repos.users.one([{ field: 'id', value: id }]).pipe(Effect.map(Option.map((u) => ({ role: u.role })))));
		return handlers
			.handle('search', ({ urlParams }) =>
				RateLimit.apply('api',
					Effect.gen(function* () {
						const result = yield* search.query(
							{
								entityTypes: urlParams.entityTypes,
								includeFacets: urlParams.includeFacets,
								includeGlobal: urlParams.includeGlobal,
								includeSnippets: urlParams.includeSnippets,
								term: urlParams.q,
							},
							{ cursor: urlParams.cursor, limit: urlParams.limit },
						).pipe(Effect.mapError((err) => HttpError.Internal.of('Search failed', err)));
						yield* audit.log('User', 'search', 'query', { after: { resultCount: result.total, term: urlParams.q } });
						return result;
					}).pipe(Effect.withSpan('search.query', { kind: 'server' })),
				),
			)
			.handle('suggest', ({ urlParams }) =>
				RateLimit.apply('api',
					Effect.gen(function* () {
						const result = yield* search.suggest({
							includeGlobal: urlParams.includeGlobal,
							limit: urlParams.limit,
							prefix: urlParams.prefix,
						}).pipe(Effect.mapError((err) => HttpError.Internal.of('Suggest failed', err)));
						yield* audit.log('User', 'search', 'suggest', { after: { prefix: urlParams.prefix, resultCount: result.length } });
						return result;
					}).pipe(Effect.withSpan('search.suggest', { kind: 'server' })),
				),
			)
			.handle('refresh', ({ payload }) =>
				RateLimit.apply('api',
					requireRole('admin').pipe(
						Effect.andThen(search.refresh(payload.includeGlobal)),
						Effect.tap(() => audit.log('User', 'search', 'refresh', { after: { includeGlobal: payload.includeGlobal } })),
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
