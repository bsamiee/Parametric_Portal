import { Schema as S } from '@effect/schema';
import { it } from '@fast-check/vitest';
import { Effect } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { createTypes, TYPES_TUNING } from '../src/types.ts';

// --- Pure Functions ----------------------------------------------------------

const loadApi = () => Effect.runSync(createTypes());

// --- Constants ---------------------------------------------------------------

const BRAND_TEST_CASES = [
    ['uuidv7', '019377a8-1234-7abc-89de-0123456789ab', true],
    ['uuidv7', 'not-a-uuid', false],
    ['uuidv7', '00000000-0000-0000-0000-000000000000', false],
    ['email', 'test@example.com', true],
    ['email', 'user@domain.co.uk', true],
    ['email', 'not-an-email', false],
    ['hexColor', '#ff00ff', true],
    ['hexColor', '#ABC123', true],
    ['hexColor', 'ff00ff', false],
    ['hexColor', '#gggggg', false],
    ['slug', 'my-slug', true],
    ['slug', 'valid-slug-123', true],
    ['slug', 'Invalid Slug', false],
    ['url', 'https://example.com', true],
    ['url', 'http://localhost:3000/path', true],
    ['url', 'not-a-url', false],
    ['positiveInt', 1, true],
    ['positiveInt', 100, true],
    ['positiveInt', 0, false],
    ['positiveInt', -1, false],
    ['nonNegativeInt', 0, true],
    ['nonNegativeInt', 100, true],
    ['nonNegativeInt', -1, false],
    ['percentage', 0, true],
    ['percentage', 50, true],
    ['percentage', 100, true],
    ['percentage', -1, false],
    ['percentage', 101, false],
] as const;

// --- Entry Point -------------------------------------------------------------

describe('types package', () => {
    describe('api surface', () => {
        it('returns frozen api object', () => {
            const api = loadApi();
            expect(Object.isFrozen(api)).toBe(true);
            expect(api.brands).toBeDefined();
            expect(api.schemas).toBeDefined();
            expect(api.patterns).toBeDefined();
        });

        it('exposes all 11 branded types', () => {
            const api = loadApi();
            const expectedBrands = [
                'email',
                'hexColor',
                'isoDate',
                'nonEmptyString',
                'nonNegativeInt',
                'percentage',
                'positiveInt',
                'safeInteger',
                'slug',
                'url',
                'uuidv7',
            ] as const;
            for (const brand of expectedBrands) {
                expect(api.brands[brand]).toBeDefined();
            }
        });
    });

    describe.each(BRAND_TEST_CASES)('brands.%s validates %s = %s', (brand, value, expected) => {
        it(`${expected ? 'accepts' : 'rejects'} value`, () => {
            const api = loadApi();
            const schema = api.brands[brand as keyof typeof api.brands];
            const isValid = S.is(schema as S.Schema<unknown, unknown, never>)(value);
            expect(isValid).toBe(expected);
        });
    });

    describe('uuidv7 generation', () => {
        it.prop([fc.nat({ max: 100 })])('generates valid unique uuids', () => {
            const api = loadApi();
            const a = Effect.runSync(api.generateUuidv7);
            const b = Effect.runSync(api.generateUuidv7);
            expect(a).not.toBe(b);
            expect(api.isUuidv7(a)).toBe(true);
            expect(api.isUuidv7(b)).toBe(true);
            expect(TYPES_TUNING.patterns.uuidv7.test(a)).toBe(true);
        });

        it('caches validation results', () => {
            const api = loadApi();
            const uuid = Effect.runSync(api.generateUuidv7);
            const cached1 = Effect.runSync(api.isUuidv7Cached(uuid));
            const cached2 = Effect.runSync(api.isUuidv7Cached('invalid-uuid'));
            expect(cached1).toBe(true);
            expect(cached2).toBe(false);
        });
    });

    describe('patterns', () => {
        it.each(
            Object.keys(TYPES_TUNING.patterns) as (keyof typeof TYPES_TUNING.patterns)[],
        )('pattern.%s is valid regex', (key) => {
            const pattern = TYPES_TUNING.patterns[key];
            expect(pattern).toBeInstanceOf(RegExp);
        });
    });
});
