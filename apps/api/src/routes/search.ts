/**
 * Search API route handlers with tenant context and admin authorization.
 */
import { HttpApiBuilder } from '@effect/platform';
import { SearchService } from '@parametric-portal/ai/search';
import { ParametricApi } from '@parametric-portal/server/api';
import { HttpError } from '@parametric-portal/server/errors';
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
                Middleware.guarded('search', 'search', 'api', Middleware.feature('enableAiSearch').pipe(Effect.andThen(search.query(
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
                    Telemetry.span('search.query'),
                    Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Search failed', error)),
                )))),
            )
            .handle('suggest', ({ urlParams }) =>
                Middleware.guarded('search', 'suggest', 'api', Middleware.feature('enableAiSearch').pipe(Effect.andThen(search.suggest({
                    includeGlobal: urlParams.includeGlobal,
                    limit: urlParams.limit,
                    prefix: urlParams.prefix,
                }).pipe(
                    Telemetry.span('search.suggest'),
                    Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Suggest failed', error)),
                )))),
            )
            .handle('refresh', ({ payload }) =>
                Middleware.guarded('search', 'refresh', 'api', search.refresh(payload.includeGlobal).pipe(
                    Effect.as({ status: 'ok' as const }),
                    Telemetry.span('search.refresh'),
                    Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Refresh failed', error)),
                )),
            )
            .handle('refreshEmbeddings', ({ payload }) =>
                Middleware.guarded('search', 'refreshEmbeddings', 'api', Middleware.feature('enableAiSearch').pipe(Effect.andThen(search.refreshEmbeddings({ includeGlobal: payload.includeGlobal }).pipe(
                    Effect.map((result) => ({ count: result.count })),
                    Telemetry.span('search.refreshEmbeddings'),
                    Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Embedding refresh failed', error)),
                )))),
            );
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { SearchLive };
