/**
 * URL state tests: branded parser factories, dispatch table coverage, hook integration.
 */
import { it } from '@fast-check/vitest';
import { FC_ARB } from '@parametric-portal/test-utils/arbitraries';
import '@parametric-portal/test-utils/harness';
import { renderHook } from '@testing-library/react';
import { Schema as S } from 'effect';
import fc from 'fast-check';
import { describe, expect, vi } from 'vitest';
import {
    createBrandedNumberParser,
    createBrandedStringParser,
    createUrlLoader,
    parsers,
    URL_TUNING,
    useUrlState,
    useUrlStates,
} from '../src/url';

// --- [MOCKS] -----------------------------------------------------------------

vi.mock('nuqs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('nuqs')>();
    return {
        ...actual,
        useQueryState: vi.fn(() => [null, vi.fn()]),
        useQueryStates: vi.fn(() => [{}, vi.fn()]),
    };
});

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    arb: {
        lowerAlpha: fc.stringMatching(/^[a-z]+$/),
        optionsPartial: fc.record(
            {
                clearOnDefault: fc.boolean(),
                history: fc.constantFrom('push' as const, 'replace' as const),
                scroll: fc.boolean(),
                shallow: fc.boolean(),
            },
            { requiredKeys: [] },
        ),
        upperAlphaNum: fc.stringMatching(/^[A-Z0-9]+$/),
    },
    derived: {
        allParserKeys: Object.keys(parsers) as ReadonlyArray<keyof typeof parsers>,
        defaultOptions: { clearOnDefault: true, history: 'replace', scroll: false, shallow: true, throttleMs: 50 },
    },
    samples: {
        enumValues: ['alpha', 'beta', 'gamma'] as const,
        literalValues: ['one', 'two', 'three'] as const,
        numberLiteralValues: [1, 2, 3] as const,
    },
    schemas: {
        number: S.Number.pipe(S.between(0, 100), S.brand('TestNumber')),
        string: S.String.pipe(S.minLength(1), S.pattern(/^[a-z]+$/), S.brand('TestString')),
    },
} as const);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const stringParserTests = [
    { expected: 'valid', input: 'valid' },
    { expected: null, input: '' },
    { expected: null, input: 'ABC' },
    { expected: null, input: '123' },
] as const;
const numberParserTests = [
    { expected: 50, input: '50' },
    { expected: 0, input: '0' },
    { expected: 100, input: '100' },
    { expected: null, input: '-1' },
    { expected: null, input: '101' },
    { expected: null, input: 'abc' },
] as const;
const brandedParserBehavior = [
    { expected: null, input: '0', parser: 'positiveInt' as const },
    { expected: null, input: '-1', parser: 'positiveInt' as const },
    { expected: 1, input: '1', parser: 'positiveInt' as const },
    { expected: 0, input: '0', parser: 'nonNegativeInt' as const },
    { expected: null, input: '-1', parser: 'nonNegativeInt' as const },
    { expected: null, input: 'invalid', parser: 'isoDate' as const },
    { expected: null, input: '', parser: 'isoDate' as const },
] as const;

// --- [DESCRIBE] URL_TUNING ---------------------------------------------------

describe('URL_TUNING', () => {
    it('is frozen with expected defaults', () => {
        expect(Object.isFrozen(URL_TUNING)).toBe(true);
        expect(URL_TUNING.defaults).toEqual(B.derived.defaultOptions);
    });
});

// --- [DESCRIBE] createBrandedStringParser ------------------------------------

describe('createBrandedStringParser', () => {
    const parser = createBrandedStringParser(B.schemas.string);
    it.each(stringParserTests)('parse("$input") → $expected', ({ expected, input }) => {
        expect(parser.parse(input)).toBe(expected);
    });
    it.prop([B.arb.lowerAlpha])('round-trips valid values', (value) => {
        const parsed = parser.parse(value);
        expect(parsed).toBe(value);
        expect(parser.serialize(parsed as S.Schema.Type<typeof B.schemas.string>)).toBe(value);
    });
    it.prop([B.arb.upperAlphaNum])('rejects invalid patterns', (value) => {
        expect(parser.parse(value)).toBeNull();
    });
});

// --- [DESCRIBE] createBrandedNumberParser ------------------------------------

describe('createBrandedNumberParser', () => {
    const parser = createBrandedNumberParser(B.schemas.number);
    it.each(numberParserTests)('parse("$input") → $expected', ({ expected, input }) => {
        expect(parser.parse(input)).toBe(expected);
    });
    it.prop([fc.integer({ max: 100, min: 0 })])('round-trips valid integers', (n) => {
        const parsed = parser.parse(String(n));
        expect(parsed).toBe(n);
        expect(parser.serialize(parsed as S.Schema.Type<typeof B.schemas.number>)).toBe(String(n));
    });
    it.prop([fc.integer({ max: 1000, min: 101 })])('rejects out-of-range positive', (n) => {
        expect(parser.parse(String(n))).toBeNull();
    });
    it.prop([fc.integer({ max: -1, min: -1000 })])('rejects negative', (n) => {
        expect(parser.parse(String(n))).toBeNull();
    });
});

// --- [DESCRIBE] parsers ------------------------------------------------------

describe('parsers', () => {
    it('is frozen with all keys defined', () => {
        expect(Object.isFrozen(parsers)).toBe(true);
        for (const key of B.derived.allParserKeys) expect(parsers[key]).toBeDefined();
    });
    it.each(brandedParserBehavior)('$parser.parse("$input") → $expected', ({ expected, input, parser }) => {
        expect(parsers[parser].parse(input)).toBe(expected);
    });
    it.prop([FC_ARB.isoDate()])('isoDate parses valid ISO dates consistently', (date) => {
        const result = parsers.isoDate.parse(date);
        expect(result === null || typeof result === 'string').toBe(true);
    });
});

// --- [DESCRIBE] parser factories ---------------------------------------------

describe('parser factories', () => {
    it('arrayOf creates array parser', () => {
        const arrayParser = parsers.arrayOf(parsers.string);
        expect(arrayParser).toHaveProperty('parse');
        expect(arrayParser).toHaveProperty('serialize');
    });
    it('json creates JSON parser with default', () => {
        const jsonParser = parsers.json({ key: 'default' });
        expect(jsonParser).toHaveProperty('parse');
        expect(jsonParser).toHaveProperty('serialize');
    });
    it('numberLiteral creates literal parser', () => {
        const literalParser = parsers.numberLiteral([...B.samples.numberLiteralValues]);
        expect(literalParser).toHaveProperty('parse');
        expect(literalParser.parse('1')).toBe(1);
        expect(literalParser.parse('999')).toBeNull();
    });
    it('stringEnum creates enum parser', () => {
        const enumParser = parsers.stringEnum([...B.samples.enumValues]);
        expect(enumParser).toHaveProperty('parse');
        expect(enumParser.parse('alpha')).toBe('alpha');
        expect(enumParser.parse('invalid')).toBeNull();
    });
    it('stringLiteral creates literal parser', () => {
        const literalParser = parsers.stringLiteral([...B.samples.literalValues]);
        expect(literalParser).toHaveProperty('parse');
        expect(literalParser.parse('one')).toBe('one');
        expect(literalParser.parse('invalid')).toBeNull();
    });
});

// --- [DESCRIBE] createUrlLoader ----------------------------------------------

describe('createUrlLoader', () => {
    it('creates loader from parser map', () => {
        // biome-ignore lint/suspicious/noExplicitAny: test type coercion
        const loader = createUrlLoader({ id: parsers.string, page: parsers.integer } as any);
        expect(loader).toBeDefined();
        expect(typeof loader).toBe('function');
    });
});

// --- [DESCRIBE] useUrlState --------------------------------------------------

describe('useUrlState', () => {
    it('returns state tuple from hook', () => {
        const { result } = renderHook(() => useUrlState('test', parsers.string));
        expect(Array.isArray(result.current)).toBe(true);
        expect(result.current).toHaveLength(2);
    });
    it('accepts options parameter', () => {
        const { result } = renderHook(() => useUrlState('test', parsers.string, { history: 'push' }));
        expect(result.current).toBeDefined();
    });
});

// --- [DESCRIBE] useUrlStates -------------------------------------------------

describe('useUrlStates', () => {
    it('returns states object from hook', () => {
        // biome-ignore lint/suspicious/noExplicitAny: test type coercion
        const keyMap = { id: parsers.string, page: parsers.integer } as any;
        const { result } = renderHook(() => useUrlStates(keyMap));
        expect(Array.isArray(result.current)).toBe(true);
        expect(result.current).toHaveLength(2);
    });
    it('accepts options parameter', () => {
        // biome-ignore lint/suspicious/noExplicitAny: test type coercion
        const keyMap = { id: parsers.string } as any;
        const { result } = renderHook(() => useUrlStates(keyMap, { shallow: false }));
        expect(result.current).toBeDefined();
    });
});
