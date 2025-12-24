/**
 * HttpApi factories, OpenAPI layer, and HttpApiBuilder re-exports for downstream apps.
 */
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiSwagger, OpenApi } from '@effect/platform';
import { TYPES_TUNING } from '@parametric-portal/types/types';
import { pipe, Schema as S } from 'effect';

import {
    ConflictError,
    ERROR_TUNING,
    ForbiddenError,
    GoneError,
    InternalError,
    NotFoundError,
    RateLimitError,
    RequestTimeoutError,
    ServiceUnavailableError,
    UnauthorizedError,
    ValidationError,
} from './errors.ts';

// --- [TYPES] -----------------------------------------------------------------

type PaginationQuery = S.Schema.Type<typeof PaginationQuerySchema>;
type ApiOptions = {
    readonly description?: string;
    readonly prefix?: `/${string}`;
    readonly title?: string;
    readonly version?: string;
};
type GroupOptions = {
    readonly prefix?: `/${string}`;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    openapi: { path: '/openapi.json' },
    server: { defaultPort: 4000 },
    swagger: { path: '/docs' },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const PaginationQuerySchema = S.Struct({
    limit: S.optionalWith(pipe(S.NumberFromString, S.int(), S.between(1, TYPES_TUNING.pagination.maxPageSize)), {
        default: () => TYPES_TUNING.pagination.defaultPageSize,
    }),
    offset: S.optionalWith(pipe(S.NumberFromString, S.int(), S.nonNegative()), {
        default: () => 0,
    }),
});
const LivenessResponseSchema = S.Struct({ status: S.Literal('ok') });
const ReadinessResponseSchema = S.Struct({
    checks: S.Record({ key: S.String, value: S.Boolean }),
    status: S.Literal('ok'),
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const addStandardErrors = <E extends HttpApiEndpoint.HttpApiEndpoint.AnyWithProps>(endpoint: E) =>
    endpoint
        .addError(NotFoundError, { status: ERROR_TUNING.status.notFound })
        .addError(ValidationError, { status: ERROR_TUNING.status.validation })
        .addError(UnauthorizedError, { status: ERROR_TUNING.status.unauthorized })
        .addError(ForbiddenError, { status: ERROR_TUNING.status.forbidden })
        .addError(RateLimitError, { status: ERROR_TUNING.status.rateLimit })
        .addError(ConflictError, { status: ERROR_TUNING.status.conflict })
        .addError(InternalError, { status: ERROR_TUNING.status.internal })
        .addError(RequestTimeoutError, { status: ERROR_TUNING.status.requestTimeout })
        .addError(GoneError, { status: ERROR_TUNING.status.gone })
        .addError(ServiceUnavailableError, { status: ERROR_TUNING.status.serviceUnavailable });

// --- [ENTRY_POINT] -----------------------------------------------------------

const createApi = <const Name extends string>(name: Name, options: ApiOptions = {}) =>
    pipe(
        HttpApi.make(name),
        (api) => (options.prefix ? api.prefix(options.prefix) : api),
        (api) => api.annotate(OpenApi.Title, options.title ?? name),
        (api) => api.annotate(OpenApi.Version, options.version ?? '1.0.0'),
        (api) => (options.description ? api.annotate(OpenApi.Description, options.description) : api),
    );
const createGroup = <const Name extends string>(name: Name, options: GroupOptions = {}) =>
    pipe(HttpApiGroup.make(name), (group) => (options.prefix ? group.prefix(options.prefix) : group));
const createHealthGroup = () =>
    pipe(
        HttpApiGroup.make('health'),
        (g) => g.add(HttpApiEndpoint.get('liveness', '/live').addSuccess(LivenessResponseSchema, { status: 200 })),
        (g) =>
            g.add(
                HttpApiEndpoint.get('readiness', '/ready')
                    .addSuccess(ReadinessResponseSchema, { status: 200 })
                    .addError(ServiceUnavailableError, { status: ERROR_TUNING.status.serviceUnavailable }),
            ),
    );
const SwaggerLayer = HttpApiSwagger.layer({ path: B.swagger.path });
const OpenApiJsonLayer = HttpApiBuilder.middlewareOpenApi({ path: B.openapi.path });

// --- [EXPORT] ----------------------------------------------------------------

export {
    addStandardErrors,
    B as API_TUNING,
    createApi,
    createGroup,
    createHealthGroup,
    LivenessResponseSchema,
    OpenApiJsonLayer,
    PaginationQuerySchema,
    ReadinessResponseSchema,
    SwaggerLayer,
};
export type { ApiOptions, GroupOptions, PaginationQuery };
// biome-ignore lint/performance/noBarrelFile: Re-exporting @effect/platform for downstream API consumers
export { HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from '@effect/platform';
export { Accepted, asEmpty, Created, Multipart, NoContent, Text, withEncoding } from '@effect/platform/HttpApiSchema';
export { Deprecated, Summary } from '@effect/platform/OpenApi';
