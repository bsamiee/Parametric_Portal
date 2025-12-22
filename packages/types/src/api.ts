/**
 * API response types and discriminated unions.
 * Grounding: Effect TaggedClass for success/error handling.
 */
import { Match, pipe, Schema as S } from 'effect';

import { TYPES_TUNING } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type ApiResponseFold<T, R> = {
    readonly ApiError: (error: ApiError) => R;
    readonly ApiSuccess: (data: T, status: HttpStatusSuccess) => R;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: { status: 200 },
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

type HttpStatusSuccess = S.Schema.Type<typeof HttpStatusSuccessSchema>;
type HttpStatusError = S.Schema.Type<typeof HttpStatusErrorSchema>;

const PaginationMetaSchema = S.Struct({
    currentPage: pipe(S.Number, S.int(), S.positive()),
    pageSize: pipe(S.Number, S.int(), S.between(1, B.pagination.maxPageSize)),
    totalItems: pipe(S.Number, S.int(), S.nonNegative()),
    totalPages: pipe(S.Number, S.int(), S.nonNegative()),
});

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

// --- [ENTRY_POINT] -----------------------------------------------------------

const api = () =>
    Object.freeze({
        error,
        fold,
        hasNextPage,
        hasPrevPage,
        map,
        paginated,
        schema: { paginated: PaginatedResponseSchema, response: ApiResponseSchema },
        success,
    });

// --- [EXPORT] ----------------------------------------------------------------

export {
    api,
    ApiResponseSchema,
    B as API_TUNING,
    error,
    fold,
    hasNextPage,
    hasPrevPage,
    HttpStatusErrorSchema,
    HttpStatusSuccessSchema,
    map,
    paginated,
    PaginatedResponseSchema,
    PaginationMetaSchema,
    success,
};
export type {
    ApiError,
    ApiResponse,
    ApiResponseFold,
    ApiSuccess,
    HttpStatusError,
    HttpStatusSuccess,
    PaginatedSuccess,
    PaginationMeta,
};
