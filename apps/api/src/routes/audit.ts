/**
 * Audit group handlers for audit log retrieval operations.
 * Paginated audit log endpoints with date/operation filters.
 * Supports: admin-only entity/actor queries, self-lookup for any authenticated user.
 */
import { HttpApiBuilder } from '@effect/platform';
import { type AuditFilter, DatabaseService, type DatabaseServiceShape } from '@parametric-portal/database/repos';
import { type AuditFilterQuery, ParametricApi } from '@parametric-portal/server/api';
import { getAppId } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/http-errors';
import { Middleware, requireRole } from '@parametric-portal/server/middleware';
import { RateLimit } from '@parametric-portal/server/rate-limit';
import type { AuditEntityType, AuditLog, UserId } from '@parametric-portal/types/schema';
import { Effect, Option, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type FilterParams = typeof AuditFilterQuery.Type;
type PaginatedResult = { readonly data: readonly AuditLog[]; readonly limit: number; readonly offset: number; readonly total: number };

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const toFilter = (params: FilterParams): AuditFilter => ({
    after: Option.getOrUndefined(params.after),
    before: Option.getOrUndefined(params.before),
    operation: Option.getOrUndefined(params.operation),
});

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const handleGetByEntity = Effect.fn('audit.getByEntity')(
    (repos: DatabaseServiceShape, entityType: AuditEntityType, entityId: string, params: FilterParams) =>
        Effect.gen(function* () {
            yield* requireRole('admin');
            const appId = yield* getAppId;
            const filter = toFilter(params);
            const { data, total } = yield* pipe(
                repos.audit.findByEntity(appId, entityType, entityId, params.limit, params.offset, filter),
                HttpError.chain(HttpError.Internal, { message: 'Audit log lookup failed' }),
            );
            return { data, limit: params.limit, offset: params.offset, total } satisfies PaginatedResult;
        }),
);
const handleGetByActor = Effect.fn('audit.getByActor')(
    (repos: DatabaseServiceShape, actorId: UserId, params: FilterParams) =>
        Effect.gen(function* () {
            yield* requireRole('admin');
            const appId = yield* getAppId;
            const filter = toFilter(params);
            const { data, total } = yield* pipe(
                repos.audit.findByActor(appId, actorId, params.limit, params.offset, filter),
                HttpError.chain(HttpError.Internal, { message: 'Audit log lookup failed' }),
            );
            return { data, limit: params.limit, offset: params.offset, total } satisfies PaginatedResult;
        }),
);
const handleGetMine = Effect.fn('audit.getMine')(
    (repos: DatabaseServiceShape, params: FilterParams) =>
        Effect.gen(function* () {
            const { userId } = yield* Middleware.Session;
            const appId = yield* getAppId;
            const filter = toFilter(params);
            const { data, total } = yield* pipe(
                repos.audit.findByActor(appId, userId, params.limit, params.offset, filter),
                HttpError.chain(HttpError.Internal, { message: 'Audit log lookup failed' }),
            );
            return { data, limit: params.limit, offset: params.offset, total } satisfies PaginatedResult;
        }),
);

// --- [LAYER] -----------------------------------------------------------------

const AuditLive = HttpApiBuilder.group(ParametricApi, 'audit', (handlers) =>
    Effect.gen(function* () {
        const repos = yield* DatabaseService;
        return handlers
            .handle('getByEntity', ({ path: { entityType, entityId }, urlParams }) => RateLimit.middleware.api(handleGetByEntity(repos, entityType, entityId, urlParams)))
            .handle('getByActor', ({ path: { actorId }, urlParams }) => RateLimit.middleware.api(handleGetByActor(repos, actorId, urlParams)))
            .handle('getMine', ({ urlParams }) => RateLimit.middleware.api(handleGetMine(repos, urlParams)));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuditLive };
