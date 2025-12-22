/**
 * Validate API response types and handlers via property-based testing.
 */
import { it } from '@fast-check/vitest';
import { Schema as S } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import {
    API_TUNING,
    ApiResponseSchema,
    api,
    error,
    fold,
    type HttpStatusError,
    type HttpStatusSuccess,
    hasNextPage,
    hasPrevPage,
    map,
    PaginatedResponseSchema,
    type PaginationMeta,
    paginated,
    success,
} from '../src/api.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const loadApi = () => api();
const arbitraryHttpStatusSuccess = fc.integer({ max: 299, min: 200 }) as fc.Arbitrary<HttpStatusSuccess>;
const arbitraryHttpStatusError = fc.integer({ max: 599, min: 400 }) as fc.Arbitrary<HttpStatusError>;
const arbitraryData = fc.record({ value: fc.integer() });

// --- [TESTS] -----------------------------------------------------------------

describe('api package', () => {
    describe('api surface', () => {
        it('returns frozen api object', () => {
            const apiInstance = loadApi();
            expect(Object.isFrozen(apiInstance)).toBe(true);
            expect(apiInstance.success).toBeDefined();
            expect(apiInstance.error).toBeDefined();
            expect(apiInstance.paginated).toBeDefined();
            expect(apiInstance.map).toBeDefined();
            expect(apiInstance.fold).toBeDefined();
            expect(apiInstance.hasNextPage).toBeDefined();
            expect(apiInstance.hasPrevPage).toBeDefined();
        });

        it('exposes tuning constants', () => {
            expect(Object.isFrozen(API_TUNING)).toBe(true);
            expect(API_TUNING.defaults.status).toBe(200);
            expect(API_TUNING.pagination.defaultPageSize).toBe(20);
            expect(API_TUNING.pagination.maxPageSize).toBe(100);
            expect(API_TUNING.tags.success).toBe('ApiSuccess');
            expect(API_TUNING.tags.error).toBe('ApiError');
        });
    });

    describe('success creation', () => {
        it.prop([arbitraryData, arbitraryHttpStatusSuccess])('creates success response', (data, status) => {
            const response = success(data, status);
            expect(response._tag).toBe('ApiSuccess');
            expect(response.data).toEqual(data);
            expect(response.status).toBe(status);
        });

        it.prop([arbitraryData])('uses default status when omitted', (data) => {
            const response = success(data);
            expect(response.status).toBe(API_TUNING.defaults.status);
        });
    });

    describe('error creation', () => {
        it.prop([arbitraryHttpStatusError, fc.string(), fc.string()])(
            'creates error response',
            (status, code, message) => {
                const response = error(status, code, message);
                expect(response._tag).toBe('ApiError');
                expect(response.status).toBe(status);
                expect(response.code).toBe(code);
                expect(response.message).toBe(message);
            },
        );
    });

    describe('paginated creation', () => {
        it('creates paginated response', () => {
            const data = [{ value: 1 }, { value: 2 }];
            const pagination: PaginationMeta = { currentPage: 1, pageSize: 20, totalItems: 100, totalPages: 5 };
            const response = paginated(data, pagination);
            expect(response._tag).toBe('PaginatedSuccess');
            expect(response.data).toEqual(data);
            expect(response.pagination).toEqual(pagination);
        });
    });

    describe('pagination helpers', () => {
        it('hasNextPage returns true when more pages exist', () => {
            const pagination: PaginationMeta = { currentPage: 1, pageSize: 20, totalItems: 100, totalPages: 5 };
            const response = paginated([], pagination);
            expect(hasNextPage(response)).toBe(true);
        });

        it('hasNextPage returns false on last page', () => {
            const pagination: PaginationMeta = { currentPage: 5, pageSize: 20, totalItems: 100, totalPages: 5 };
            const response = paginated([], pagination);
            expect(hasNextPage(response)).toBe(false);
        });

        it('hasPrevPage returns false on first page', () => {
            const pagination: PaginationMeta = { currentPage: 1, pageSize: 20, totalItems: 100, totalPages: 5 };
            const response = paginated([], pagination);
            expect(hasPrevPage(response)).toBe(false);
        });

        it('hasPrevPage returns true when previous pages exist', () => {
            const pagination: PaginationMeta = { currentPage: 2, pageSize: 20, totalItems: 100, totalPages: 5 };
            const response = paginated([], pagination);
            expect(hasPrevPage(response)).toBe(true);
        });
    });

    describe('fold', () => {
        it.prop([arbitraryData])('folds success to value', (data) => {
            const response = success(data);
            const result = fold(response, {
                ApiError: () => 'error',
                ApiSuccess: (d) => `success:${d.value}`,
            });
            expect(result).toBe(`success:${data.value}`);
        });

        it.prop([arbitraryHttpStatusError, fc.string(), fc.string()])(
            'folds error to value',
            (status, code, message) => {
                const response = error(status, code, message);
                const result = fold(response, {
                    ApiError: (e) => `error:${e.code}`,
                    ApiSuccess: () => 'success',
                });
                expect(result).toBe(`error:${code}`);
            },
        );
    });

    describe('map', () => {
        it.prop([arbitraryData])('transforms success data', (data) => {
            const response = success(data);
            const mapped = map(response, (d) => ({ doubled: d.value * 2 }));
            expect(mapped._tag).toBe('ApiSuccess');
            expect((mapped as { readonly data: { doubled: number } }).data).toEqual({ doubled: data.value * 2 });
        });

        it.prop([arbitraryHttpStatusError, fc.string(), fc.string()])(
            'preserves error unchanged',
            (status, code, message) => {
                const response = error(status, code, message);
                const mapped = map(response, (d: { value: number }) => ({ doubled: d.value * 2 }));
                expect(mapped._tag).toBe('ApiError');
                expect((mapped as { readonly code: string }).code).toBe(code);
            },
        );
    });

    describe('schema', () => {
        it('validates success via ApiResponseSchema', () => {
            const schema = ApiResponseSchema(S.Struct({ value: S.Number }));
            expect(S.is(schema)({ _tag: 'ApiSuccess', data: { value: 42 }, status: 200 })).toBe(true);
            expect(S.is(schema)({ _tag: 'ApiError', code: 'ERR', message: 'fail', status: 400 })).toBe(true);
            expect(S.is(schema)({ _tag: 'Invalid' })).toBe(false);
        });

        it('validates paginated via PaginatedResponseSchema', () => {
            const schema = PaginatedResponseSchema(S.Struct({ value: S.Number }));
            const valid = {
                _tag: 'PaginatedSuccess',
                data: [{ value: 1 }],
                pagination: { currentPage: 1, pageSize: 20, totalItems: 100, totalPages: 5 },
                status: 200,
            };
            expect(S.is(schema)(valid)).toBe(true);
        });

        it('exposes schemas via factory', () => {
            const apiInstance = loadApi();
            expect(apiInstance.schema.response).toBeDefined();
            expect(apiInstance.schema.paginated).toBeDefined();
        });
    });
});
