/**
 * Validate API response types and handlers via property-based testing.
 */
import { it } from '@fast-check/vitest';
import { Schema as S } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { API_TUNING, api } from '../src/api.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const loadApi = () => api<{ readonly value: number }>();

const arbitraryHttpStatusSuccess = fc.integer({ max: 299, min: 200 });
const arbitraryHttpStatusError = fc.integer({ max: 599, min: 400 });
const arbitraryApiData = fc.record({ value: fc.integer() });

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
        });

        it('exposes tuning constants', () => {
            expect(Object.isFrozen(API_TUNING)).toBe(true);
            expect(API_TUNING.defaults.status).toBe(200);
            expect(API_TUNING.defaults.pageSize).toBe(20);
            expect(API_TUNING.tags.success).toBe('ApiSuccess');
            expect(API_TUNING.tags.error).toBe('ApiError');
        });
    });

    describe('success creation', () => {
        it.prop([arbitraryApiData, arbitraryHttpStatusSuccess])('creates success response', (data, status) => {
            const apiInstance = loadApi();
            const response = apiInstance.success(data, status as never);
            expect(response._tag).toBe(API_TUNING.tags.success);
            expect(response.data).toEqual(data);
            expect(response.status).toBe(status);
        });

        it.prop([arbitraryApiData])('uses default status when omitted', (data) => {
            const apiInstance = loadApi();
            const response = apiInstance.success(data);
            expect(response.status).toBe(API_TUNING.defaults.status);
        });
    });

    describe('error creation', () => {
        it.prop([arbitraryHttpStatusError, fc.string(), fc.string()])(
            'creates error response',
            (status, code, message) => {
                const apiInstance = loadApi();
                const response = apiInstance.error(status as never, code, message);
                expect(response._tag).toBe(API_TUNING.tags.error);
                expect(response.status).toBe(status);
                expect(response.code).toBe(code);
                expect(response.message).toBe(message);
            },
        );
    });

    describe('paginated creation', () => {
        it.prop([
            fc.array(arbitraryApiData),
            fc.integer({ max: 100, min: 1 }),
            fc.integer({ max: 100, min: 1 }),
            fc.integer({ max: 1000, min: 0 }),
        ])('creates paginated response', (data, currentPage, pageSize, totalItems) => {
            const apiInstance = loadApi();
            const totalPages = Math.ceil(totalItems / pageSize);
            const pagination = { currentPage, pageSize, totalItems, totalPages };
            const response = apiInstance.paginated(data, pagination);
            expect(response._tag).toBe(API_TUNING.tags.success);
            expect(response.data).toEqual(data);
            expect(response.pagination).toEqual(pagination);
        });
    });

    describe('type guards', () => {
        it.prop([arbitraryApiData])('identifies success responses', (data) => {
            const apiInstance = loadApi();
            const response = apiInstance.success(data);
            expect(apiInstance.isSuccess(response)).toBe(true);
            expect(apiInstance.isError(response)).toBe(false);
        });

        it.prop([arbitraryHttpStatusError, fc.string(), fc.string()])(
            'identifies error responses',
            (status, code, message) => {
                const apiInstance = loadApi();
                const response = apiInstance.error(status as never, code, message);
                expect(apiInstance.isError(response)).toBe(true);
                expect(apiInstance.isSuccess(response)).toBe(false);
            },
        );
    });

    describe('map transformation', () => {
        it.prop([arbitraryApiData])('transforms success data', (data) => {
            const apiInstance = loadApi();
            const response = apiInstance.success(data);
            const mapped = apiInstance.map(response, (d) => ({ doubled: d.value * 2 }));
            expect(mapped._tag).toBe(API_TUNING.tags.success);
            expect((mapped as { readonly data: { doubled: number } }).data).toEqual({ doubled: data.value * 2 });
        });

        it.prop([arbitraryHttpStatusError, fc.string(), fc.string()])(
            'preserves error unchanged',
            (status, code, message) => {
                const apiInstance = loadApi();
                const response = apiInstance.error(status as never, code, message);
                const mapped = apiInstance.map(response, (d) => ({ doubled: d.value * 2 }));
                expect(mapped._tag).toBe(API_TUNING.tags.error);
                const errorResponse = mapped as { readonly code: string; readonly message: string };
                expect(errorResponse.code).toBe(code);
                expect(errorResponse.message).toBe(message);
            },
        );
    });

    describe('fold handler', () => {
        it.prop([arbitraryApiData])('folds success to value', (data) => {
            const apiInstance = loadApi();
            const response = apiInstance.success(data);
            const result = apiInstance.fold(response, {
                onError: () => 'error' as const,
                onSuccess: (d) => `success:${d.value}` as const,
            });
            expect(result).toBe(`success:${data.value}`);
        });

        it.prop([arbitraryHttpStatusError, fc.string(), fc.string()])(
            'folds error to value',
            (status, code, message) => {
                const apiInstance = loadApi();
                const response = apiInstance.error(status as never, code, message);
                const result = apiInstance.fold(response, {
                    onError: (e) => `error:${e.code}`,
                    onSuccess: () => 'success',
                });
                expect(result).toBe(`error:${code}`);
            },
        );
    });

    describe('schema validation', () => {
        it('validates success status range', () => {
            const schema = api().schemas.httpStatusSuccess;
            expect(S.is(schema)(200)).toBe(true);
            expect(S.is(schema)(299)).toBe(true);
            expect(S.is(schema)(199)).toBe(false);
            expect(S.is(schema)(300)).toBe(false);
        });

        it('validates error status range', () => {
            const schema = api().schemas.httpStatusError;
            expect(S.is(schema)(400)).toBe(true);
            expect(S.is(schema)(599)).toBe(true);
            expect(S.is(schema)(399)).toBe(false);
            expect(S.is(schema)(600)).toBe(false);
        });
    });
});
