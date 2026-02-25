/**
 * Search API route handlers with tenant context and admin authorization.
 */
import { HttpApiBuilder } from '@effect/platform';
import { AiService } from '@parametric-portal/ai/service';
import { ParametricApi } from '@parametric-portal/server/api';
import { Middleware } from '@parametric-portal/server/middleware';
import { Array as A, Effect } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _ENTITY_TYPES = ['user', 'app', 'asset', 'auditLog', 'command'] as const;

// --- [LAYERS] ----------------------------------------------------------------

const SearchLive = HttpApiBuilder.group(ParametricApi, 'search', (handlers) =>
    Effect.gen(function* () {
        const ai = yield* AiService;
        const searchRoute = Middleware.resource('search');
        const isEntityType = <T extends { readonly entityType: string | null }>(
            item: T,
        ): item is T & { readonly entityType: typeof _ENTITY_TYPES[number] } =>
            typeof item.entityType === 'string' && (_ENTITY_TYPES as readonly string[]).includes(item.entityType);
        return handlers
            .handle('search', ({ urlParams }) =>
                searchRoute.api('search', Middleware.feature('enableAiSearch').pipe(
                        Effect.flatMap(() => {
                            const { cursor, limit, ...query } = urlParams;
                            return ai.searchQuery(query, { cursor, limit });
                        }),
                    Effect.map((result) => ({
                        cursor: result.cursor,
                        facets: result.facets === null
                            ? null
                            : {
                                app:      result.facets['app'] ?? 0,
                                asset:    result.facets['asset'] ?? 0,
                                auditLog: result.facets['auditLog'] ?? 0,
                                command:  result.facets['command'] ?? 0,
                                user:     result.facets['user'] ?? 0,
                            },
                        hasNext: result.hasNext,
                        hasPrev: result.hasPrev,
                        items:   A.filter(result.items, isEntityType),
                        total:   result.total,
                    })),
                )),
            )
            .handle('suggest', ({ urlParams }) =>
                searchRoute.api('suggest', Middleware.feature('enableAiSearch').pipe(
                    Effect.andThen(ai.searchSuggest({
                        includeGlobal: urlParams.includeGlobal,
                        limit:         urlParams.limit,
                        prefix:        urlParams.prefix,
                    })),
                )),
            )
            .handle('refresh', ({ payload }) => searchRoute.api('refresh', ai.searchRefresh(payload.includeGlobal).pipe(Effect.as({ status: 'ok' as const }))))
            .handle('refreshEmbeddings', ({ payload }) =>
                searchRoute.api('refreshEmbeddings', Middleware.feature('enableAiSearch').pipe(
                    Effect.andThen(ai.searchRefreshEmbeddings({ includeGlobal: payload.includeGlobal }).pipe(Effect.map(({ count }) => ({ count })))),
                )),
            );
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { SearchLive };
