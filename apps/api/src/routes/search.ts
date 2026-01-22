import { HttpApiBuilder } from '@effect/platform';
import { SearchService } from '@parametric-portal/database/search';
import { ParametricApi, type Query } from '@parametric-portal/server/api';
import { RequestContext } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/http-errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { RateLimit } from '@parametric-portal/server/rate-limit';
import { Effect } from 'effect';

// --- [HANDLERS] --------------------------------------------------------------

const handleSearch = Effect.fn('search.search')(
	(service: typeof SearchService.Service, params: typeof Query.Type) =>
		Effect.gen(function* () {
			yield* Middleware.requireMfaVerified;
			const appId = yield* RequestContext.app;
			const term = params.q ?? '';
			const options = {
				entityTypes: params.entityTypes,
				includeFacets: params.includeFacets,
				includeGlobal: params.includeGlobal,
				includeSnippets: params.includeSnippets,
				scopeId: appId,
				term,
			};
			return yield* service.search(options, {
				...(params.cursor ? { cursor: params.cursor } : {}),
				limit: params.limit,
			}).pipe(Effect.mapError((e) => HttpError.internal('Search failed', e)));
		}),
);
const handleSuggest = Effect.fn('search.suggest')(
	(service: typeof SearchService.Service, params: typeof Query.Type) =>
		Effect.gen(function* () {
			yield* Middleware.requireMfaVerified;
			const appId = yield* RequestContext.app;
			const suggestions = yield* service.suggest({
				includeGlobal: params.includeGlobal,
				limit: params.limit,
				prefix: params.prefix ?? '',
				scopeId: appId,
			}).pipe(Effect.mapError((e) => HttpError.internal('Suggest failed', e)));
			return { cursor: null, facets: null, hasNext: false, hasPrev: false, items: [], suggestions, total: 0 };
		}),
);

// --- [LAYERS] ----------------------------------------------------------------

const SearchLive = HttpApiBuilder.group(ParametricApi, 'search', (handlers) =>
	Effect.gen(function* () {
		const service = yield* SearchService;
		return handlers
			.handle('search', ({ urlParams }) => RateLimit.apply('api', handleSearch(service, urlParams)))
			.handle('suggest', ({ urlParams }) => RateLimit.apply('api', handleSuggest(service, urlParams)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { SearchLive };
