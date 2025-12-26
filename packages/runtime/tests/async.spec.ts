/**
 * Async hook tests: AsyncState factories, state transitions, type guards.
 */
import { it as itProp } from '@fast-check/vitest';
import { async } from '@parametric-portal/types/async';
import '@parametric-portal/test-utils/harness';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const asyncApi = async();

const B = Object.freeze({
    errors: {
        network: { _tag: 'NetworkError', message: 'Network failed' },
        validation: { _tag: 'ValidationError', message: 'Invalid input' },
    },
    values: { number: 42, object: { key: 'value' }, string: 'test-result' },
} as const);

// --- [DESCRIBE] asyncApi factories -------------------------------------------

describe('asyncApi.idle', () => {
    it('creates Idle state', () => {
        const state = asyncApi.idle();
        expect(state._tag).toBe('Idle');
    });
    it('returns same structure on multiple calls', () => {
        const s1 = asyncApi.idle();
        const s2 = asyncApi.idle();
        expect(s1).toEqual(s2);
    });
    it('Idle state has only _tag property', () => {
        const state = asyncApi.idle();
        expect(Object.keys(state)).toEqual(['_tag']);
    });
});

describe('asyncApi.loading', () => {
    it('creates Loading state', () => {
        const state = asyncApi.loading();
        expect(state._tag).toBe('Loading');
    });
    it('includes startedAt timestamp', () => {
        const before = Date.now();
        const state = asyncApi.loading();
        const after = Date.now();
        expect(state._tag === 'Loading' && state.startedAt).toBeGreaterThanOrEqual(before);
        expect(state._tag === 'Loading' && state.startedAt).toBeLessThanOrEqual(after);
    });
    it('each call returns different startedAt', () => {
        const s1 = asyncApi.loading();
        const s2 = asyncApi.loading();
        expect(s1).not.toBe(s2);
        expect(s1._tag).toBe('Loading');
        expect(s2._tag).toBe('Loading');
    });
    it('Loading state has _tag and startedAt properties', () => {
        const state = asyncApi.loading();
        expect(state).toHaveProperty('_tag', 'Loading');
        expect(state).toHaveProperty('startedAt');
    });
});

describe('asyncApi.success', () => {
    it('creates Success state with data', () => {
        const state = asyncApi.success(B.values.number);
        expect(state._tag).toBe('Success');
        expect(state._tag === 'Success' && state.data).toBe(B.values.number);
    });
    it('preserves string data', () => {
        const state = asyncApi.success(B.values.string);
        expect(state._tag === 'Success' && state.data).toBe(B.values.string);
    });
    it('preserves object data', () => {
        const state = asyncApi.success(B.values.object);
        expect(state._tag === 'Success' && state.data).toEqual(B.values.object);
    });
    itProp.prop([fc.integer()])('preserves arbitrary integer data', (n) => {
        const state = asyncApi.success(n);
        expect(state._tag === 'Success' && state.data).toBe(n);
    });
    itProp.prop([fc.string()])('preserves arbitrary string data', (s) => {
        const state = asyncApi.success(s);
        expect(state._tag === 'Success' && state.data).toBe(s);
    });
    it('Success state has _tag, data, and timestamp properties', () => {
        const state = asyncApi.success(42);
        expect(state).toHaveProperty('_tag', 'Success');
        expect(state).toHaveProperty('data', 42);
        expect(state).toHaveProperty('timestamp');
    });
    it('includes timestamp on creation', () => {
        const before = Date.now();
        const state = asyncApi.success('value');
        const after = Date.now();
        expect(state._tag === 'Success' && state.timestamp).toBeGreaterThanOrEqual(before);
        expect(state._tag === 'Success' && state.timestamp).toBeLessThanOrEqual(after);
    });
    it('handles null data', () => {
        const state = asyncApi.success(null);
        expect(state._tag).toBe('Success');
        expect(state._tag === 'Success' && state.data).toBeNull();
    });
    it('handles undefined data', () => {
        const state = asyncApi.success(undefined);
        expect(state._tag).toBe('Success');
        expect(state._tag === 'Success' && state.data).toBeUndefined();
    });
});

describe('asyncApi.failure', () => {
    it('creates Failure state with error', () => {
        const state = asyncApi.failure(B.errors.network);
        expect(state._tag).toBe('Failure');
        expect(state._tag === 'Failure' && state.error).toEqual(B.errors.network);
    });
    it('preserves validation error', () => {
        const state = asyncApi.failure(B.errors.validation);
        expect(state._tag === 'Failure' && state.error).toEqual(B.errors.validation);
    });
    itProp.prop([fc.string()])('preserves arbitrary string error', (err) => {
        const state = asyncApi.failure(err);
        expect(state._tag === 'Failure' && state.error).toBe(err);
    });
    it('Failure state has _tag, error, and timestamp properties', () => {
        const state = asyncApi.failure('error');
        expect(state).toHaveProperty('_tag', 'Failure');
        expect(state).toHaveProperty('error', 'error');
        expect(state).toHaveProperty('timestamp');
    });
    it('includes timestamp on creation', () => {
        const before = Date.now();
        const state = asyncApi.failure('error');
        const after = Date.now();
        expect(state._tag === 'Failure' && state.timestamp).toBeGreaterThanOrEqual(before);
        expect(state._tag === 'Failure' && state.timestamp).toBeLessThanOrEqual(after);
    });
    it('handles Error object', () => {
        const error = new Error('test error');
        const state = asyncApi.failure(error);
        expect(state._tag === 'Failure' && state.error).toBe(error);
    });
});

// --- [DESCRIBE] state transitions --------------------------------------------

describe('state transitions', () => {
    it('idle -> loading', () => {
        const idle = asyncApi.idle();
        const loading = asyncApi.loading();
        expect(idle._tag).toBe('Idle');
        expect(loading._tag).toBe('Loading');
    });
    it('loading -> success', () => {
        const loading = asyncApi.loading();
        const success = asyncApi.success(42);
        expect(loading._tag).toBe('Loading');
        expect(success._tag).toBe('Success');
    });
    it('loading -> failure', () => {
        const loading = asyncApi.loading();
        const failure = asyncApi.failure('error');
        expect(loading._tag).toBe('Loading');
        expect(failure._tag).toBe('Failure');
    });
    it('success -> idle (reset)', () => {
        const success = asyncApi.success(42);
        const idle = asyncApi.idle();
        expect(success._tag).toBe('Success');
        expect(idle._tag).toBe('Idle');
    });
    it('failure -> idle (reset)', () => {
        const failure = asyncApi.failure('error');
        const idle = asyncApi.idle();
        expect(failure._tag).toBe('Failure');
        expect(idle._tag).toBe('Idle');
    });
});

// --- [DESCRIBE] type discrimination ------------------------------------------

describe('type discrimination', () => {
    it('discriminates Idle', () => {
        const state = asyncApi.idle();
        expect(state._tag === 'Idle').toBe(true);
        expect(state._tag === 'Loading').toBe(false);
        expect(state._tag === 'Success').toBe(false);
        expect(state._tag === 'Failure').toBe(false);
    });
    it('discriminates Loading', () => {
        const state = asyncApi.loading();
        expect(state._tag === 'Idle').toBe(false);
        expect(state._tag === 'Loading').toBe(true);
        expect(state._tag === 'Success').toBe(false);
        expect(state._tag === 'Failure').toBe(false);
    });
    it('discriminates Success', () => {
        const state = asyncApi.success(42);
        expect(state._tag === 'Idle').toBe(false);
        expect(state._tag === 'Loading').toBe(false);
        expect(state._tag === 'Success').toBe(true);
        expect(state._tag === 'Failure').toBe(false);
    });
    it('discriminates Failure', () => {
        const state = asyncApi.failure('error');
        expect(state._tag === 'Idle').toBe(false);
        expect(state._tag === 'Loading').toBe(false);
        expect(state._tag === 'Success').toBe(false);
        expect(state._tag === 'Failure').toBe(true);
    });
});

// --- [DESCRIBE] data access patterns -----------------------------------------

describe('data access patterns', () => {
    it('Success data is accessible via type narrowing', () => {
        const state = asyncApi.success({ count: 42 });
        const data = state._tag === 'Success' ? state.data : null;
        expect(data).toEqual({ count: 42 });
    });
    it('Failure error is accessible via type narrowing', () => {
        const state = asyncApi.failure({ code: 'ERR' });
        const error = state._tag === 'Failure' ? state.error : null;
        expect(error).toEqual({ code: 'ERR' });
    });
    it('Idle has no data property', () => {
        const state = asyncApi.idle();
        expect('data' in state).toBe(false);
        expect('error' in state).toBe(false);
    });
    it('Loading has startedAt but no data/error', () => {
        const state = asyncApi.loading();
        expect('startedAt' in state).toBe(true);
        expect('data' in state).toBe(false);
        expect('error' in state).toBe(false);
    });
});

// --- [DESCRIBE] edge cases ---------------------------------------------------

describe('edge cases', () => {
    it('handles deeply nested data', () => {
        const nested = { a: { b: { c: { d: [1, 2, 3] } } } };
        const state = asyncApi.success(nested);
        expect(state._tag === 'Success' && state.data).toEqual(nested);
    });
    it('handles array data', () => {
        const arr = [1, 2, 3, 4, 5];
        const state = asyncApi.success(arr);
        expect(state._tag === 'Success' && state.data).toEqual(arr);
    });
    it('handles empty object data', () => {
        const state = asyncApi.success({});
        expect(state._tag === 'Success' && state.data).toEqual({});
    });
    it('handles empty array data', () => {
        const state = asyncApi.success([]);
        expect(state._tag === 'Success' && state.data).toEqual([]);
    });
    it('handles function as error', () => {
        const fn = () => 'error';
        const state = asyncApi.failure(fn);
        expect(state._tag === 'Failure' && state.error).toBe(fn);
    });
    itProp.prop([fc.boolean()])('handles boolean data', (b) => {
        const state = asyncApi.success(b);
        expect(state._tag === 'Success' && state.data).toBe(b);
    });
});

// --- [DESCRIBE] immutability -------------------------------------------------

describe('immutability', () => {
    it('different success calls return different objects', () => {
        const s1 = asyncApi.success(1);
        const s2 = asyncApi.success(1);
        expect(s1).not.toBe(s2);
        expect(s1).toEqual(s2);
    });
    it('different failure calls return different objects', () => {
        const f1 = asyncApi.failure('err');
        const f2 = asyncApi.failure('err');
        expect(f1).not.toBe(f2);
        expect(f1).toEqual(f2);
    });
});
