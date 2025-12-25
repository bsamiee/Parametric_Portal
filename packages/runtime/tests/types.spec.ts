/**
 * Store types tests: schema validation for store names and history limits.
 */
import { it } from '@fast-check/vitest';
import { FC_ARB } from '@parametric-portal/test-utils/arbitraries';
import '@parametric-portal/test-utils/harness';
import { Schema as S } from 'effect';
import { describe, expect } from 'vitest';
import { HistoryLimitSchema, STORE_TYPES_TUNING, StoreNameSchema, validateStoreName } from '../src/store/types';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    bounds: { historyLimit: { max: 1000, min: 1 } },
    pattern: /^[a-z0-9][a-z0-9:-]*$/,
    samples: {
        invalidNames: ['INVALID', 'has space', '@special', '', '-dash-start'] as const,
        validNames: ['my-store', 'app:auth', 'store-v2', 'a1', 'my-app:store-v2'] as const,
    },
} as const);

// --- [DESCRIBE] STORE_TYPES_TUNING -------------------------------------------

describe('STORE_TYPES_TUNING', () => {
    it('history bounds match expected values', () => {
        expect(STORE_TYPES_TUNING.bounds.historyLimit.min).toBe(B.bounds.historyLimit.min);
        expect(STORE_TYPES_TUNING.bounds.historyLimit.max).toBe(B.bounds.historyLimit.max);
    });
    it('store name pattern matches expected regex', () => {
        expect(STORE_TYPES_TUNING.patterns.storeName.source).toBe(B.pattern.source);
    });
    it('history bounds are positive integers with max > min', () => {
        expect(STORE_TYPES_TUNING.bounds.historyLimit.min).toBeGreaterThan(0);
        expect(STORE_TYPES_TUNING.bounds.historyLimit.max).toBeGreaterThan(STORE_TYPES_TUNING.bounds.historyLimit.min);
    });
});

// --- [DESCRIBE] validateStoreName --------------------------------------------

describe('validateStoreName', () => {
    it.prop([FC_ARB.storeName()])('accepts valid names matching pattern', (name) => {
        expect(validateStoreName(name)).toBe(true);
    });
    it.prop([FC_ARB.invalidStoreName()])('rejects invalid names not matching pattern', (name) => {
        expect(validateStoreName(name)).toBe(false);
    });
    it.each(B.samples.validNames)('accepts valid sample: "%s"', (name) => {
        expect(validateStoreName(name)).toBe(true);
    });
    it.each(B.samples.invalidNames)('rejects invalid sample: "%s"', (name) => {
        expect(validateStoreName(name)).toBe(false);
    });
    it('requires lowercase alphanumeric start', () => {
        expect(validateStoreName('abc')).toBe(true);
        expect(validateStoreName('123abc')).toBe(true);
        expect(validateStoreName('Abc')).toBe(false);
        expect(validateStoreName('-abc')).toBe(false);
    });
    it('allows hyphens and colons in body', () => {
        expect(validateStoreName('my-store')).toBe(true);
        expect(validateStoreName('app:store')).toBe(true);
        expect(validateStoreName('my-app:store-v2')).toBe(true);
    });
    it('rejects empty string', () => {
        expect(validateStoreName('')).toBe(false);
    });
    it('rejects whitespace characters', () => {
        expect(validateStoreName(' ')).toBe(false);
        expect(validateStoreName('a b')).toBe(false);
        expect(validateStoreName('\t')).toBe(false);
    });
});

// --- [DESCRIBE] StoreNameSchema ----------------------------------------------

describe('StoreNameSchema', () => {
    it.prop([FC_ARB.storeName()])('decodes valid names to Right with preserved value', (name) => {
        const result = S.decodeUnknownEither(StoreNameSchema)(name);
        expect(result).toBeRight(name);
    });
    it.prop([FC_ARB.invalidStoreName()])('decodes invalid names to Left', (name) => {
        const result = S.decodeUnknownEither(StoreNameSchema)(name);
        expect(result).toBeLeft();
    });
    it('preserves exact value on successful decode', () => {
        const result = S.decodeUnknownEither(StoreNameSchema)('valid-store');
        expect(result).toBeRight('valid-store');
    });
    it.each([null, undefined, 42, {}, []])('rejects non-string type: %p', (value) => {
        const result = S.decodeUnknownEither(StoreNameSchema)(value);
        expect(result).toBeLeft();
    });
});

// --- [DESCRIBE] HistoryLimitSchema -------------------------------------------

describe('HistoryLimitSchema', () => {
    it.prop([FC_ARB.historyLimit()])('decodes valid limits to Right with preserved value', (n) => {
        const result = S.decodeUnknownEither(HistoryLimitSchema)(n);
        expect(result).toBeRight(n);
    });
    it.prop([FC_ARB.invalidHistoryLimit()])('decodes invalid limits to Left', (n) => {
        const result = S.decodeUnknownEither(HistoryLimitSchema)(n);
        expect(result).toBeLeft();
    });
    it('accepts boundary values exactly', () => {
        expect(S.decodeUnknownEither(HistoryLimitSchema)(1)).toBeRight(1);
        expect(S.decodeUnknownEither(HistoryLimitSchema)(1000)).toBeRight(1000);
    });
    it('rejects boundary-adjacent values', () => {
        expect(S.decodeUnknownEither(HistoryLimitSchema)(0)).toBeLeft();
        expect(S.decodeUnknownEither(HistoryLimitSchema)(1001)).toBeLeft();
        expect(S.decodeUnknownEither(HistoryLimitSchema)(-1)).toBeLeft();
    });
    it('rejects non-integers', () => {
        expect(S.decodeUnknownEither(HistoryLimitSchema)(1.5)).toBeLeft();
        expect(S.decodeUnknownEither(HistoryLimitSchema)(500.1)).toBeLeft();
    });
    it.each([null, undefined, 'string', {}, []])('rejects non-number type: %p', (value) => {
        const result = S.decodeUnknownEither(HistoryLimitSchema)(value);
        expect(result).toBeLeft();
    });
    it('preserves integer value on successful decode', () => {
        const result = S.decodeUnknownEither(HistoryLimitSchema)(50);
        expect(result).toBeRight(50);
    });
});

// --- [DESCRIBE] schema and validator consistency -----------------------------

describe('schema and validator consistency', () => {
    it.prop([FC_ARB.storeName()])('validateStoreName and StoreNameSchema agree on valid names', (name) => {
        const validatorResult = validateStoreName(name);
        const schemaResult = S.decodeUnknownEither(StoreNameSchema)(name);
        const schemaValid = schemaResult._tag === 'Right';
        expect(validatorResult).toBe(schemaValid);
    });
    it.prop([FC_ARB.invalidStoreName()])('validateStoreName and StoreNameSchema agree on invalid names', (name) => {
        const validatorResult = validateStoreName(name);
        const schemaResult = S.decodeUnknownEither(StoreNameSchema)(name);
        const schemaValid = schemaResult._tag === 'Right';
        expect(validatorResult).toBe(schemaValid);
    });
    it('TUNING pattern source matches local pattern', () => {
        expect(STORE_TYPES_TUNING.patterns.storeName.source).toBe(B.pattern.source);
    });
    it('TUNING bounds match local bounds', () => {
        expect(STORE_TYPES_TUNING.bounds.historyLimit.min).toBe(B.bounds.historyLimit.min);
        expect(STORE_TYPES_TUNING.bounds.historyLimit.max).toBe(B.bounds.historyLimit.max);
    });
});
