/**
 * Search API route handlers with tenant context and admin authorization.
 */
import { HttpApiBuilder } from '@effect/platform';
import { SearchService } from '@parametric-portal/ai/search';
import { ParametricApi } from '@parametric-portal/server/api';
import { Middleware } from '@parametric-portal/server/middleware';
import { Array as A, Effect } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _ENTITY_TYPES = ['user', 'app', 'asset', 'auditLog'] as const;

// --- [LAYERS] ----------------------------------------------------------------

const SearchLive = HttpApiBuilder.group(ParametricApi, 'search', (handlers) =>
    Effect.gen(function* () {
        const search = yield* SearchService;
        const searchRoute = Middleware.resource('search');
        const isEntityType = <T extends { readonly entityType: string }>(
            item: T,
        ): item is T & { readonly entityType: typeof _ENTITY_TYPES[number] } =>
            (_ENTITY_TYPES as readonly string[]).includes(item.entityType);
        return handlers
            .handle('search', ({ urlParams }) =>
                searchRoute.api('search', Middleware.feature('enableAiSearch').pipe(
                    Effect.flatMap(() => {
                        const { cursor, limit, ...query } = urlParams;
                        return search.query(query, { cursor, limit });
                    }),
                    Effect.map((result) => ({
                        cursor: result.cursor,
                        facets: (result.facets && {
                            app: result.facets['app'] ?? 0,
                            asset: result.facets['asset'] ?? 0,
                            auditLog: result.facets['auditLog'] ?? 0,
                            user: result.facets['user'] ?? 0,
                        }) || null,
                        hasNext: result.hasNext,
                        hasPrev: result.hasPrev,
                        items: A.filter(result.items, isEntityType),
                        total: result.total,
                    })),
                )),
            )
            .handle('suggest', ({ urlParams }) =>
                searchRoute.api('suggest', Middleware.feature('enableAiSearch').pipe(
                    Effect.andThen(search.suggest({
                        includeGlobal: urlParams.includeGlobal,
                        limit: urlParams.limit,
                        prefix: urlParams.prefix,
                    })),
                )),
            )
            .handle('refresh', ({ payload }) => searchRoute.api('refresh', search.refresh(payload.includeGlobal).pipe(Effect.as({ status: 'ok' as const }),)),)
            .handle('refreshEmbeddings', ({ payload }) =>
                searchRoute.api('refreshEmbeddings', Middleware.feature('enableAiSearch').pipe(
                    Effect.andThen(search.refreshEmbeddings({ includeGlobal: payload.includeGlobal }).pipe(Effect.map((result) => ({ count: result.count })),)),
                )),
            );
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { SearchLive };
