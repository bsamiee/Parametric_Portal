/**
 * Validate async state machine via property-based testing.
 */
import { it } from '@fast-check/vitest';
import { Schema as S } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { ASYNC_TUNING, asyncState } from '../src/async.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const loadApi = () => asyncState<{ readonly value: number }, Error>();

const arbitraryData = fc.record({ value: fc.integer() });
const arbitraryError = fc.string().map((msg) => new Error(msg));

// --- [TESTS] -----------------------------------------------------------------

describe('async package', () => {
    describe('api surface', () => {
        it('returns frozen api object', () => {
            const api = loadApi();
            expect(Object.isFrozen(api)).toBe(true);
            expect(api.idle).toBeDefined();
            expect(api.loading).toBeDefined();
            expect(api.success).toBeDefined();
            expect(api.failure).toBeDefined();
            expect(api.map).toBeDefined();
            expect(api.fold).toBeDefined();
        });

        it('exposes tuning constants', () => {
            expect(Object.isFrozen(ASYNC_TUNING)).toBe(true);
            expect(ASYNC_TUNING.tags.idle).toBe('Idle');
            expect(ASYNC_TUNING.tags.loading).toBe('Loading');
            expect(ASYNC_TUNING.tags.success).toBe('Success');
            expect(ASYNC_TUNING.tags.failure).toBe('Failure');
        });
    });

    describe('idle state', () => {
        it('creates idle state', () => {
            const api = loadApi();
            const state = api.idle;
            expect(state._tag).toBe(ASYNC_TUNING.tags.idle);
            expect(api.isIdle(state)).toBe(true);
            expect(api.isLoading(state)).toBe(false);
            expect(api.isSuccess(state)).toBe(false);
            expect(api.isFailure(state)).toBe(false);
        });
    });

    describe('loading state', () => {
        it('creates loading state with timestamp', () => {
            const api = loadApi();
            const state = api.loading();
            expect(state._tag).toBe(ASYNC_TUNING.tags.loading);
            expect(state.startedAt).toBeGreaterThan(0);
            expect(api.isLoading(state)).toBe(true);
            expect(api.isIdle(state)).toBe(false);
        });

        it('uses custom timestamp provider', () => {
            const customTime = 12345;
            const api = asyncState({ timestampProvider: () => customTime });
            const state = api.loading();
            expect(state.startedAt).toBe(customTime);
        });
    });

    describe('success state', () => {
        it.prop([arbitraryData])('creates success state', (data) => {
            const api = loadApi();
            const state = api.success(data);
            expect(state._tag).toBe(ASYNC_TUNING.tags.success);
            expect(state.data).toEqual(data);
            expect(state.timestamp).toBeGreaterThan(0);
            expect(api.isSuccess(state)).toBe(true);
        });

        it('uses custom timestamp provider', () => {
            const customTime = 67890;
            const api = asyncState({ timestampProvider: () => customTime });
            const state = api.success({ value: 42 });
            expect(state.timestamp).toBe(customTime);
        });
    });

    describe('failure state', () => {
        it.prop([arbitraryError])('creates failure state', (error) => {
            const api = loadApi();
            const state = api.failure(error);
            expect(state._tag).toBe(ASYNC_TUNING.tags.failure);
            expect(state.error).toBe(error);
            expect(state.timestamp).toBeGreaterThan(0);
            expect(api.isFailure(state)).toBe(true);
        });
    });

    describe('type guards', () => {
        it('identifies all state types', () => {
            const api = loadApi();
            const idle = api.idle;
            const loading = api.loading();
            const success = api.success({ value: 1 });
            const failure = api.failure(new Error('test error'));

            expect(api.isIdle(idle)).toBe(true);
            expect(api.isLoading(loading)).toBe(true);
            expect(api.isSuccess(success)).toBe(true);
            expect(api.isFailure(failure)).toBe(true);

            expect(api.isIdle(loading)).toBe(false);
            expect(api.isLoading(success)).toBe(false);
            expect(api.isSuccess(failure)).toBe(false);
            expect(api.isFailure(idle)).toBe(false);
        });
    });

    describe('map transformation', () => {
        it.prop([arbitraryData])('transforms success data', (data) => {
            const api = loadApi();
            const state = api.success(data);
            const mapped = api.map(state, (d) => ({ doubled: d.value * 2 }));
            expect(mapped._tag).toBe(ASYNC_TUNING.tags.success);
            expect((mapped as { readonly data: { doubled: number } }).data).toEqual({ doubled: data.value * 2 });
        });

        it('preserves idle state', () => {
            const api = loadApi();
            const state = api.idle;
            const mapped = api.map(state, (d) => ({ doubled: d.value * 2 }));
            expect(mapped._tag).toBe(ASYNC_TUNING.tags.idle);
        });

        it('preserves loading state', () => {
            const api = loadApi();
            const state = api.loading();
            const mapped = api.map(state, (d) => ({ doubled: d.value * 2 }));
            expect(mapped._tag).toBe(ASYNC_TUNING.tags.loading);
        });

        it.prop([arbitraryError])('preserves failure state', (error) => {
            const api = loadApi();
            const state = api.failure(error);
            const mapped = api.map(state, (d) => ({ doubled: d.value * 2 }));
            expect(mapped._tag).toBe(ASYNC_TUNING.tags.failure);
        });
    });

    describe('fold handler', () => {
        it('folds idle to value', () => {
            const api = loadApi();
            const state = api.idle;
            const result = api.fold(state, {
                onFailure: () => 'failure',
                onIdle: () => 'idle',
                onLoading: () => 'loading',
                onSuccess: () => 'success',
            });
            expect(result).toBe('idle');
        });

        it('folds loading to value with timestamp', () => {
            const api = loadApi();
            const state = api.loading();
            const result = api.fold(state, {
                onFailure: () => 0,
                onIdle: () => 0,
                onLoading: (startedAt) => startedAt,
                onSuccess: () => 0,
            });
            expect(result).toBeGreaterThan(0);
        });

        it.prop([arbitraryData])('folds success to value', (data) => {
            const api = loadApi();
            const state = api.success(data);
            const result = api.fold(state, {
                onFailure: () => 'failure',
                onIdle: () => 'idle',
                onLoading: () => 'loading',
                onSuccess: (d) => `success:${d.value}`,
            });
            expect(result).toBe(`success:${data.value}`);
        });

        it.prop([arbitraryError])('folds failure to value', (error) => {
            const api = loadApi();
            const state = api.failure(error);
            const result = api.fold(state, {
                onFailure: (e) => `failure:${(e as Error).message}`,
                onIdle: () => 'idle',
                onLoading: () => 'loading',
                onSuccess: () => 'success',
            });
            expect(result).toBe(`failure:${error.message}`);
        });
    });

    describe('schema validation', () => {
        it('validates idle schema', () => {
            const schema = asyncState().schemas.idle;
            expect(S.is(schema)({ _tag: 'Idle' })).toBe(true);
            expect(S.is(schema)({ _tag: 'Loading' })).toBe(false);
        });

        it('validates loading schema', () => {
            const schema = asyncState().schemas.loading;
            expect(S.is(schema)({ _tag: 'Loading', startedAt: 123 })).toBe(true);
            expect(S.is(schema)({ _tag: 'Idle' })).toBe(false);
        });
    });
});
