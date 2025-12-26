/**
 * Define discriminated API response types with monadic operations.
 * Effect TaggedClass for tagged unions, Match for exhaustive pattern matching.
 */
import { Effect, Match, pipe, Schema as S } from 'effect';

import { TYPES_TUNING } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type ApiResponseFold<T, R> = {
    readonly ApiError: (error: ApiError) => R;
    readonly ApiSuccess: (data: T, status: HttpStatusSuccess) => R;
};
type HttpStatusSuccess = S.Schema.Type<typeof HttpStatusSuccessSchema>;
type HttpStatusError = S.Schema.Type<typeof HttpStatusErrorSchema>;
type PaginationMeta = S.Schema.Type<typeof PaginationMetaSchema>;
type ApiSuccess<T = unknown> = { readonly _tag: 'ApiSuccess'; readonly data: T; readonly status: HttpStatusSuccess };
type ApiError = {
    readonly _tag: 'ApiError';
    readonly code: string;
    readonly message: string;
    readonly status: HttpStatusError;
};
type ApiResponse<T> = ApiSuccess<T> | ApiError;
type PaginatedSuccess<T = unknown> = {
    readonly _tag: 'PaginatedSuccess';
    readonly data: ReadonlyArray<T>;
    readonly pagination: PaginationMeta;
    readonly status: HttpStatusSuccess;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: { status: 200 },
    errorCodes: {
        forbidden: { code: 'FORBIDDEN', status: 403 },
        notFound: { code: 'NOT_FOUND', status: 404 },
        unauthorized: { code: 'UNAUTHORIZED', status: 401 },
    },
    pagination: TYPES_TUNING.pagination,
    ranges: { error: { max: 599, min: 400 }, success: { max: 299, min: 200 } },
    tags: { error: 'ApiError', paginated: 'PaginatedSuccess', success: 'ApiSuccess' },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const HttpStatusSuccessSchema = pipe(
    S.Number,
    S.int(),
    S.between(B.ranges.success.min, B.ranges.success.max),
    S.brand('HttpStatusSuccess'),
);
const HttpStatusErrorSchema = pipe(
    S.Number,
    S.int(),
    S.between(B.ranges.error.min, B.ranges.error.max),
    S.brand('HttpStatusError'),
);
const PaginationMetaSchema = S.Struct({
    currentPage: pipe(S.Number, S.int(), S.positive()),
    pageSize: pipe(S.Number, S.int(), S.between(1, B.pagination.maxPageSize)),
    totalItems: pipe(S.Number, S.int(), S.nonNegative()),
    totalPages: pipe(S.Number, S.int(), S.nonNegative()),
});
const ApiResponseSchema = <A extends S.Schema.Any>(dataSchema: A) =>
    S.Union(
        S.Struct({ _tag: S.Literal(B.tags.success), data: dataSchema, status: HttpStatusSuccessSchema }),
        S.Struct({
            _tag: S.Literal(B.tags.error),
            code: S.String,
            message: S.String,
            status: HttpStatusErrorSchema,
        }),
    );
const PaginatedResponseSchema = <A extends S.Schema.Any>(dataSchema: A) =>
    S.Struct({
        _tag: S.Literal(B.tags.paginated),
        data: S.Array(dataSchema),
        pagination: PaginationMetaSchema,
        status: HttpStatusSuccessSchema,
    });

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const defaultStatus = (): HttpStatusSuccess => B.defaults.status as HttpStatusSuccess;
const success = <T>(data: T, status: HttpStatusSuccess = defaultStatus()): ApiSuccess<T> => ({
    _tag: B.tags.success,
    data,
    status,
});
const error = (status: HttpStatusError, code: string, message: string): ApiError => ({
    _tag: B.tags.error,
    code,
    message,
    status,
});
const unauthorized = (reason: string): ApiError =>
    error(B.errorCodes.unauthorized.status as HttpStatusError, B.errorCodes.unauthorized.code, reason);
const forbidden = (reason: string): ApiError =>
    error(B.errorCodes.forbidden.status as HttpStatusError, B.errorCodes.forbidden.code, reason);
const notFound = (resource: string, id?: string): ApiError =>
    error(
        B.errorCodes.notFound.status as HttpStatusError,
        B.errorCodes.notFound.code,
        id ? `${resource} with id ${id} not found` : `${resource} not found`,
    );
const paginated = <T>(
    data: ReadonlyArray<T>,
    pagination: PaginationMeta,
    status: HttpStatusSuccess = defaultStatus(),
): PaginatedSuccess<T> => ({ _tag: B.tags.paginated, data, pagination, status });
const hasNextPage = <T>(p: PaginatedSuccess<T>): boolean => p.pagination.currentPage < p.pagination.totalPages;
const hasPrevPage = <T>(p: PaginatedSuccess<T>): boolean => p.pagination.currentPage > 1;

// --- [DISPATCH_TABLES] -------------------------------------------------------

const fold = <T, R>(response: ApiResponse<T>, handlers: ApiResponseFold<T, R>): R =>
    Match.value(response).pipe(
        Match.tag(B.tags.success, (r) => handlers.ApiSuccess(r.data, r.status)),
        Match.tag(B.tags.error, (r) => handlers.ApiError(r)),
        Match.exhaustive,
    ) as R;
const map = <T, U>(response: ApiResponse<T>, f: (data: T) => U): ApiResponse<U> =>
    Match.value(response).pipe(
        Match.tag(B.tags.success, (r) => success(f(r.data), r.status)),
        Match.orElse((r) => r),
    );
const flatMap = <T, U>(response: ApiResponse<T>, f: (data: T) => ApiResponse<U>): ApiResponse<U> =>
    Match.value(response).pipe(
        Match.tag(B.tags.success, (r) => f(r.data)),
        Match.orElse((r) => r),
    );
const mapError = <T>(response: ApiResponse<T>, f: (error: ApiError) => ApiError): ApiResponse<T> =>
    Match.value(response).pipe(
        Match.tag(B.tags.error, (r) => f(r)),
        Match.orElse((r) => r),
    );
const toEffect = <T>(response: ApiResponse<T>): Effect.Effect<T, ApiError> =>
    response._tag === B.tags.success ? Effect.succeed(response.data) : Effect.fail(response);
const toEffectM =
    <T>() =>
    (response: ApiResponse<T>): Effect.Effect<T, ApiError> =>
        toEffect(response);

// --- [ENTRY_POINT] -----------------------------------------------------------

const api = () =>
    Object.freeze({
        error,
        flatMap,
        fold,
        forbidden,
        hasNextPage,
        hasPrevPage,
        map,
        mapError,
        notFound,
        paginated,
        schemas: Object.freeze({
            HttpStatusError: HttpStatusErrorSchema,
            HttpStatusSuccess: HttpStatusSuccessSchema,
            PaginatedResponse: PaginatedResponseSchema,
            PaginationMeta: PaginationMetaSchema,
            Response: ApiResponseSchema,
        }),
        success,
        toEffect,
        toEffectM,
        unauthorized,
    });
type ApiApi = ReturnType<typeof api>;

// --- [EXPORT] ----------------------------------------------------------------

export { api, B as API_TUNING };
export type { ApiApi, ApiError, ApiResponse, ApiSuccess, HttpStatusError };
