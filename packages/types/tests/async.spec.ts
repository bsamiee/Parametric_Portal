/**
 * Validate async state machine via property-based testing.
 */
import { it } from '@fast-check/vitest';
import { Schema as S } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import {
    ASYNC_TUNING,
    AsyncStateSchema,
    createAsync,
    fold,
    map,
    mkFailure,
    mkIdle,
    mkLoading,
    mkSuccess,
} from '../src/async.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const FIXED_TIME = 1000;
const loadApi = () => createAsync({ timestampProvider: () => FIXED_TIME });
const arbitraryData = fc.integer();
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
            expect(ASYNC_TUNING.tags).toEqual({
                failure: 'Failure',
                idle: 'Idle',
                loading: 'Loading',
                success: 'Success',
            });
        });
    });

    describe('state constructors', () => {
        it('mkIdle creates idle state', () => {
            const state = mkIdle<number, Error>();
            expect(state._tag).toBe('Idle');
        });

        it('mkLoading creates loading state with timestamp', () => {
            const state = mkLoading<number, Error>(() => FIXED_TIME);
            expect(state._tag).toBe('Loading');
            expect(state.startedAt).toBe(FIXED_TIME);
        });

        it.prop([arbitraryData])('mkSuccess creates success state', (data) => {
            const state = mkSuccess<number, Error>(data, () => FIXED_TIME);
            expect(state._tag).toBe('Success');
            expect(state.data).toBe(data);
            expect(state.timestamp).toBe(FIXED_TIME);
        });

        it.prop([arbitraryError])('mkFailure creates failure state', (error) => {
            const state = mkFailure<number, Error>(error, () => FIXED_TIME);
            expect(state._tag).toBe('Failure');
            expect(state.error).toBe(error);
            expect(state.timestamp).toBe(FIXED_TIME);
        });
    });

    describe('factory api', () => {
        it('factory.idle creates idle state', () => {
            const api = loadApi();
            const state = api.idle();
            expect(state._tag).toBe('Idle');
        });

        it('factory.loading uses injected timestamp', () => {
            const api = loadApi();
            const state = api.loading();
            expect(state._tag).toBe('Loading');
            expect(state.startedAt).toBe(FIXED_TIME);
        });

        it.prop([arbitraryData])('factory.success uses injected timestamp', (data) => {
            const api = loadApi();
            const state = api.success(data);
            expect(state._tag).toBe('Success');
            expect(state.data).toBe(data);
            expect(state.timestamp).toBe(FIXED_TIME);
        });

        it.prop([arbitraryError])('factory.failure uses injected timestamp', (error) => {
            const api = loadApi();
            const state = api.failure(error);
            expect(state._tag).toBe('Failure');
            expect(state.error).toBe(error);
            expect(state.timestamp).toBe(FIXED_TIME);
        });
    });

    describe('fold', () => {
        it('folds idle state', () => {
            const state = mkIdle<number, Error>();
            const result = fold(state, {
                Failure: () => 'failure',
                Idle: () => 'idle',
                Loading: () => 'loading',
                Success: () => 'success',
            });
            expect(result).toBe('idle');
        });

        it('folds loading state with startedAt', () => {
            const state = mkLoading<number, Error>(() => FIXED_TIME);
            const result = fold(state, {
                Failure: () => 0,
                Idle: () => 0,
                Loading: (startedAt) => startedAt,
                Success: () => 0,
            });
            expect(result).toBe(FIXED_TIME);
        });

        it.prop([arbitraryData])('folds success state with data', (data) => {
            const state = mkSuccess<number, Error>(data, () => FIXED_TIME);
            const result = fold(state, {
                Failure: () => -1,
                Idle: () => -1,
                Loading: () => -1,
                Success: (d) => d,
            });
            expect(result).toBe(data);
        });

        it.prop([arbitraryError])('folds failure state with error', (error) => {
            const state = mkFailure<number, Error>(error, () => FIXED_TIME);
            const result = fold(state, {
                Failure: (e) => e.message,
                Idle: () => '',
                Loading: () => '',
                Success: () => '',
            });
            expect(result).toBe(error.message);
        });
    });

    describe('map', () => {
        it.prop([arbitraryData])('transforms success data', (data) => {
            const state = mkSuccess<number, Error>(data, () => FIXED_TIME);
            const mapped = map(
                state,
                (d) => d * 2,
                () => FIXED_TIME,
            );
            expect(mapped._tag).toBe('Success');
            expect((mapped as { readonly data: number }).data).toBe(data * 2);
        });

        it('preserves idle state', () => {
            const state = mkIdle<number, Error>();
            const mapped = map(state, (d) => d * 2);
            expect(mapped._tag).toBe('Idle');
        });

        it('preserves loading state', () => {
            const state = mkLoading<number, Error>(() => FIXED_TIME);
            const mapped = map(state, (d) => d * 2);
            expect(mapped._tag).toBe('Loading');
        });

        it.prop([arbitraryError])('preserves failure state', (error) => {
            const state = mkFailure<number, Error>(error, () => FIXED_TIME);
            const mapped = map(state, (d) => d * 2);
            expect(mapped._tag).toBe('Failure');
            expect((mapped as { readonly error: Error }).error).toBe(error);
        });
    });

    describe('schema', () => {
        it('validates state union via AsyncStateSchema', () => {
            const schema = AsyncStateSchema(S.Number, S.instanceOf(Error));
            expect(S.is(schema)({ _tag: 'Idle' })).toBe(true);
            expect(S.is(schema)({ _tag: 'Loading', startedAt: 123 })).toBe(true);
            expect(S.is(schema)({ _tag: 'Success', data: 42, timestamp: 123 })).toBe(true);
            expect(S.is(schema)({ _tag: 'Invalid' })).toBe(false);
        });
    });
});
