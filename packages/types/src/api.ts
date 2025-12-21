/**
 * Provides API response discriminated unions via Effect Schema: ApiSuccess, ApiError, PaginatedResponse with status code validation.
 */
import { Option, pipe, Schema as S } from 'effect';
import { match, P } from 'ts-pattern';

// --- [TYPES] -----------------------------------------------------------------

type HttpStatus = S.Schema.Type<typeof HttpStatusSchema>;
type HttpStatusSuccess = S.Schema.Type<typeof HttpStatusSuccessSchema>;
type HttpStatusError = S.Schema.Type<typeof HttpStatusErrorSchema>;

type ApiSuccess<T> = {
    readonly _tag: 'ApiSuccess';
    readonly data: T;
    readonly status: HttpStatusSuccess;
};

type ApiError = {
    readonly _tag: 'ApiError';
    readonly code: string;
    readonly message: string;
    readonly status: HttpStatusError;
};

type ApiResponse<T> = ApiSuccess<T> | ApiError;

type PaginationMeta = {
    readonly currentPage: number;
    readonly pageSize: number;
    readonly totalItems: number;
    readonly totalPages: number;
};

type PaginatedResponse<T> = ApiSuccess<ReadonlyArray<T>> & {
    readonly pagination: PaginationMeta;
};

type ApiConfig = {
    readonly defaultPageSize?: number;
};

type ApiApi<T> = {
    readonly error: (status: HttpStatusError, code: string, message: string) => ApiError;
    readonly fold: <R>(response: ApiResponse<T>, handlers: FoldHandlers<T, R>) => R;
    readonly isError: (response: ApiResponse<T>) => response is ApiError;
    readonly isSuccess: (response: ApiResponse<T>) => response is ApiSuccess<T>;
    readonly map: <U>(response: ApiResponse<T>, f: (data: T) => U) => ApiResponse<U>;
    readonly match: typeof match;
    readonly Option: typeof Option;
    readonly P: typeof P;
    readonly paginated: (
        data: ReadonlyArray<T>,
        pagination: PaginationMeta,
        status?: HttpStatusSuccess,
    ) => PaginatedResponse<T>;
    readonly schemas: typeof schemas;
    readonly success: (data: T, status?: HttpStatusSuccess) => ApiSuccess<T>;
    readonly tags: typeof B.tags;
};

type FoldHandlers<T, R> = {
    readonly onError: (error: ApiError) => R;
    readonly onSuccess: (data: T, status: HttpStatusSuccess) => R;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: { pageSize: 20, status: 200 },
    ranges: {
        error: { max: 599, min: 400 },
        success: { max: 299, min: 200 },
    },
    tags: {
        error: 'ApiError',
        success: 'ApiSuccess',
    },
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

const HttpStatusSchema = S.Union(HttpStatusSuccessSchema, HttpStatusErrorSchema);

const PaginationMetaSchema = S.Struct({
    currentPage: pipe(S.Number, S.int(), S.positive()),
    pageSize: pipe(S.Number, S.int(), S.positive()),
    totalItems: pipe(S.Number, S.int(), S.nonNegative()),
    totalPages: pipe(S.Number, S.int(), S.nonNegative()),
});

const ApiSuccessSchema = <A extends S.Schema.Any>(dataSchema: A) =>
    S.Struct({
        _tag: S.Literal('ApiSuccess'),
        data: dataSchema,
        status: HttpStatusSuccessSchema,
    });

const ApiErrorSchema = S.Struct({
    _tag: S.Literal('ApiError'),
    code: S.String,
    message: S.String,
    status: HttpStatusErrorSchema,
});

const ApiResponseSchema = <A extends S.Schema.Any>(dataSchema: A) =>
    S.Union(ApiSuccessSchema(dataSchema), ApiErrorSchema);

const PaginatedResponseSchema = <A extends S.Schema.Any>(dataSchema: A) =>
    S.Struct({
        _tag: S.Literal('ApiSuccess'),
        data: S.Array(dataSchema),
        pagination: PaginationMetaSchema,
        status: HttpStatusSuccessSchema,
    });

const schemas = Object.freeze({
    apiError: ApiErrorSchema,
    apiResponse: ApiResponseSchema,
    apiSuccess: ApiSuccessSchema,
    httpStatus: HttpStatusSchema,
    httpStatusError: HttpStatusErrorSchema,
    httpStatusSuccess: HttpStatusSuccessSchema,
    paginatedResponse: PaginatedResponseSchema,
    paginationMeta: PaginationMetaSchema,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const mkSuccess = <T>(data: T, status: HttpStatusSuccess): ApiSuccess<T> => ({
    _tag: B.tags.success,
    data,
    status,
});

const mkError = (status: HttpStatusError, code: string, message: string): ApiError => ({
    _tag: B.tags.error,
    code,
    message,
    status,
});

const mkPaginated = <T>(
    data: ReadonlyArray<T>,
    pagination: PaginationMeta,
    status: HttpStatusSuccess,
): PaginatedResponse<T> => ({
    _tag: B.tags.success,
    data,
    pagination,
    status,
});

const defaultStatus = (): HttpStatusSuccess => B.defaults.status as HttpStatusSuccess;

// --- [DISPATCH_TABLES] -------------------------------------------------------

const foldHandlers = <T, R>(response: ApiResponse<T>, h: FoldHandlers<T, R>): R =>
    match(response)
        .with({ _tag: B.tags.success }, (r) => h.onSuccess(r.data, r.status))
        .with({ _tag: B.tags.error }, (r) => h.onError(r))
        .exhaustive();

const mapHandlers = <T, U>(response: ApiResponse<T>, f: (data: T) => U): ApiResponse<U> =>
    match(response)
        .with({ _tag: B.tags.success }, (r) => mkSuccess(f(r.data), r.status))
        .otherwise(() => response as ApiResponse<U>);

// --- [ENTRY_POINT] -----------------------------------------------------------

const api = <T>(_config: ApiConfig = {}): ApiApi<T> =>
    Object.freeze({
        error: mkError,
        fold: <R>(response: ApiResponse<T>, handlers: FoldHandlers<T, R>) => foldHandlers(response, handlers),
        isError: (response: ApiResponse<T>): response is ApiError => response._tag === B.tags.error,
        isSuccess: (response: ApiResponse<T>): response is ApiSuccess<T> => response._tag === B.tags.success,
        map: <U>(response: ApiResponse<T>, f: (data: T) => U) => mapHandlers(response, f),
        match,
        Option,
        P,
        paginated: (data: ReadonlyArray<T>, pagination: PaginationMeta, status?: HttpStatusSuccess) =>
            mkPaginated(data, pagination, status ?? defaultStatus()),
        schemas,
        success: (data: T, status?: HttpStatusSuccess) => mkSuccess(data, status ?? defaultStatus()),
        tags: B.tags,
    } as ApiApi<T>);

// --- [EXPORT] ----------------------------------------------------------------

export { api, B as API_TUNING };
export type {
    ApiApi,
    ApiConfig,
    ApiError,
    ApiResponse,
    ApiSuccess,
    FoldHandlers,
    HttpStatus,
    HttpStatusError,
    HttpStatusSuccess,
    PaginatedResponse,
    PaginationMeta,
};
