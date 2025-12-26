/**
 * URL state tests: branded parsers, options builder, nuqs integration.
 */
import { it as itProp } from '@fast-check/vitest';
import { types } from '@parametric-portal/types/types';
import { Schema as S } from 'effect';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createBrandedNumberParser, createBrandedStringParser, parsers, URL_TUNING } from '../src/url';

const typesApi = types();

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        clearOnDefault: true,
        history: 'replace',
        scroll: false,
        shallow: true,
        throttleMs: 50,
    },
    samples: {
        emails: ['test@example.com', 'user+tag@domain.co.uk', 'a@b.io'] as const,
        hexColors: ['#ff0000', '#00ff00', '#0000ff', '#abc123'] as const,
        invalidEmails: ['notanemail', '@missing', 'spaces here@x.com', ''] as const,
        invalidHexColors: ['red', '#gg0000', '000000', '#12345', ''] as const,
        invalidSlugs: ['UPPERCASE', 'has spaces', 'special!chars', ''] as const,
        slugs: ['my-slug', 'test-123', 'a', 'valid-slug-here'] as const,
        uuids: ['01932f5a-b7c1-7def-8a90-123456789abc', '01932f5a-b7c1-7def-8a90-abcdef012345'] as const,
    },
    schemas: {
        positiveInt: S.Number.pipe(S.int(), S.positive()),
        slug: S.String.pipe(S.pattern(/^[a-z0-9-]+$/)),
    },
} as const);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const parserKeys = ['boolean', 'float', 'integer', 'isoDateTime', 'string', 'timestamp'] as const;
const brandedParserKeys = ['email', 'hexColor', 'slug', 'userId', 'index', 'positiveInt', 'percentage'] as const;

// --- [DESCRIBE] URL_TUNING ---------------------------------------------------

describe('URL_TUNING', () => {
    it('is frozen with correct defaults', () => {
        expect(Object.isFrozen(URL_TUNING)).toBe(true);
        expect(URL_TUNING.defaults).toEqual(B.defaults);
    });
    it('defaults.history is replace', () => expect(URL_TUNING.defaults.history).toBe('replace'));
    it('defaults.throttleMs is positive', () => expect(URL_TUNING.defaults.throttleMs).toBeGreaterThan(0));
    it('defaults.shallow is true', () => expect(URL_TUNING.defaults.shallow).toBe(true));
    it('defaults.clearOnDefault is true', () => expect(URL_TUNING.defaults.clearOnDefault).toBe(true));
});

// --- [DESCRIBE] createBrandedStringParser ------------------------------------

describe('createBrandedStringParser', () => {
    const slugParser = createBrandedStringParser(B.schemas.slug);
    it.each(B.samples.slugs)('parses valid slug: %s', (slug) => {
        expect(slugParser.parse(slug)).toBe(slug);
    });
    it.each(B.samples.invalidSlugs)('returns null for invalid slug: "%s"', (slug) => {
        expect(slugParser.parse(slug)).toBeNull();
    });
    itProp.prop([fc.string().filter((s) => /^[a-z0-9-]+$/.test(s) && s.length > 0)])(
        'round-trips valid slugs',
        (slug) => {
            const parsed = slugParser.parse(slug);
            expect(parsed).toBe(slug);
            expect(slugParser.serialize(parsed as string)).toBe(slug);
        },
    );
    it('serialize returns string representation', () => {
        expect(slugParser.serialize('my-slug')).toBe('my-slug');
    });
    it('handles empty string as invalid', () => {
        expect(slugParser.parse('')).toBeNull();
    });
});

// --- [DESCRIBE] createBrandedNumberParser ------------------------------------

describe('createBrandedNumberParser', () => {
    const positiveIntParser = createBrandedNumberParser(B.schemas.positiveInt);
    itProp.prop([fc.integer({ max: 10000, min: 1 })])('parses valid positive integers', (n) => {
        expect(positiveIntParser.parse(String(n))).toBe(n);
    });
    itProp.prop([fc.integer({ max: 0 })])('returns null for non-positive integers', (n) => {
        expect(positiveIntParser.parse(String(n))).toBeNull();
    });
    it.each(['abc', 'NaN', '', '1.5', 'Infinity'])('returns null for non-numeric: "%s"', (v) => {
        expect(positiveIntParser.parse(v)).toBeNull();
    });
    it('serialize returns string representation', () => {
        expect(positiveIntParser.serialize(42)).toBe('42');
    });
    itProp.prop([fc.integer({ max: 1000, min: 1 })])('round-trips valid values', (n) => {
        const parsed = positiveIntParser.parse(String(n));
        expect(parsed).toBe(n);
        expect(positiveIntParser.serialize(parsed as number)).toBe(String(n));
    });
});

// --- [DESCRIBE] parsers dispatch table ---------------------------------------

describe('parsers', () => {
    it('is frozen object', () => expect(Object.isFrozen(parsers)).toBe(true));
    it.each(parserKeys)('contains base parser: %s', (key) => {
        expect(parsers[key]).toBeDefined();
    });
    it.each(brandedParserKeys)('contains branded parser: %s', (key) => {
        expect(parsers[key]).toBeDefined();
    });
    describe('parsers.boolean', () => {
        it('parses "true" to true', () => expect(parsers.boolean.parse('true')).toBe(true));
        it('parses "false" to false', () => expect(parsers.boolean.parse('false')).toBe(false));
    });
    describe('parsers.integer', () => {
        itProp.prop([fc.integer({ max: 1000, min: -1000 })])('parses valid integers', (n) => {
            expect(parsers.integer.parse(String(n))).toBe(n);
        });
        it('truncates floats to integers', () => expect(parsers.integer.parse('1.5')).toBe(1));
        it('returns null for non-numeric', () => expect(parsers.integer.parse('abc')).toBeNull());
    });
    describe('parsers.float', () => {
        itProp.prop([fc.double({ max: 1000, min: -1000, noNaN: true })])('parses valid floats', (n) => {
            const parsed = parsers.float.parse(String(n));
            expect(parsed).toBeCloseTo(n, 10);
        });
    });
    describe('parsers.string', () => {
        itProp.prop([fc.string()])('parses any string', (s) => {
            expect(parsers.string.parse(s)).toBe(s);
        });
    });
    describe('parsers.arrayOf', () => {
        it('parses comma-separated integers', () => {
            const parser = parsers.arrayOf(parsers.integer);
            expect(parser.parse('1,2,3')).toEqual([1, 2, 3]);
        });
        it('returns empty array for empty string', () => {
            const parser = parsers.arrayOf(parsers.string);
            expect(parser.parse('')).toEqual([]);
        });
    });
    describe('parsers.stringEnum', () => {
        const enumParser = parsers.stringEnum(['a', 'b', 'c']);
        it.each(['a', 'b', 'c'])('parses valid enum value: %s', (v) => {
            expect(enumParser.parse(v)).toBe(v);
        });
        it('returns null for invalid enum value', () => expect(enumParser.parse('d')).toBeNull());
    });
    describe('parsers.stringLiteral', () => {
        const literalParser = parsers.stringLiteral(['foo', 'bar']);
        it.each(['foo', 'bar'])('parses valid literal: %s', (v) => {
            expect(literalParser.parse(v)).toBe(v);
        });
        it('returns null for invalid literal', () => expect(literalParser.parse('baz')).toBeNull());
    });
    describe('parsers.numberLiteral', () => {
        const literalParser = parsers.numberLiteral([1, 2, 3]);
        it.each([1, 2, 3])('parses valid number literal: %d', (v) => {
            expect(literalParser.parse(String(v))).toBe(v);
        });
        it('returns null for invalid number literal', () => expect(literalParser.parse('4')).toBeNull());
    });
    describe('parsers.json', () => {
        it('creates parser with default value', () => {
            const parser = parsers.json({ key: 'default' });
            expect(parser).toBeDefined();
            expect(typeof parser.parse).toBe('function');
            expect(typeof parser.serialize).toBe('function');
        });
        it('serializes JSON to string', () => {
            const parser = parsers.json({ key: 'default' });
            expect(parser.serialize({ key: 'value' })).toBe('{"key":"value"}');
        });
    });
});

// --- [DESCRIBE] branded parsers ----------------------------------------------

describe('branded parsers', () => {
    describe('parsers.email', () => {
        it.each(B.samples.emails)('parses valid email: %s', (email) => {
            expect(parsers.email.parse(email)).toBe(email);
        });
        it.each(B.samples.invalidEmails)('returns null for invalid: "%s"', (email) => {
            expect(parsers.email.parse(email)).toBeNull();
        });
    });
    describe('parsers.hexColor', () => {
        it.each(B.samples.hexColors)('parses valid hex color: %s', (color) => {
            expect(parsers.hexColor.parse(color)).toBe(color);
        });
        it.each(B.samples.invalidHexColors)('returns null for invalid: "%s"', (color) => {
            expect(parsers.hexColor.parse(color)).toBeNull();
        });
    });
    describe('parsers.slug', () => {
        it.each(B.samples.slugs)('parses valid slug: %s', (slug) => {
            expect(parsers.slug.parse(slug)).toBe(slug);
        });
        it.each(B.samples.invalidSlugs)('returns null for invalid: "%s"', (slug) => {
            expect(parsers.slug.parse(slug)).toBeNull();
        });
    });
    describe('parsers.uuidv7', () => {
        it.each(B.samples.uuids)('parses valid UUIDv7: %s', (uuid) => {
            expect(parsers.uuidv7.parse(uuid)).toBe(uuid);
        });
        it.each(['not-a-uuid', '12345', ''])('returns null for invalid: "%s"', (uuid) => {
            expect(parsers.uuidv7.parse(uuid)).toBeNull();
        });
    });
    describe('parsers.positiveInt', () => {
        itProp.prop([fc.integer({ max: 10000, min: 1 })])('parses valid positive int', (n) => {
            expect(parsers.positiveInt.parse(String(n))).toBe(n);
        });
        it.each(['0', '-1', '1.5', 'abc'])('returns null for invalid: "%s"', (v) => {
            expect(parsers.positiveInt.parse(v)).toBeNull();
        });
    });
    describe('parsers.index', () => {
        itProp.prop([fc.integer({ max: 10000, min: 0 })])('parses valid index', (n) => {
            expect(parsers.index.parse(String(n))).toBe(n);
        });
        it('returns null for negative', () => expect(parsers.index.parse('-1')).toBeNull());
    });
    describe('parsers.percentage', () => {
        itProp.prop([fc.integer({ max: 100, min: 0 })])('parses valid percentage', (n) => {
            expect(parsers.percentage.parse(String(n))).toBe(n);
        });
        it('parses float percentages', () => expect(parsers.percentage.parse('50.5')).toBe(50.5));
        it.each(['-1', '101'])('returns null for out of range: "%s"', (v) => {
            expect(parsers.percentage.parse(v)).toBeNull();
        });
    });
});

// --- [DESCRIBE] serialization ------------------------------------------------

describe('serialization', () => {
    itProp.prop([fc.integer({ max: 1000, min: 1 })])('positiveInt serializes to string', (n) => {
        const branded = S.decodeSync(typesApi.schemas.PositiveInt)(n);
        expect(parsers.positiveInt.serialize(branded)).toBe(String(n));
    });
    it.each(B.samples.slugs)('slug serializes to itself: %s', (slug) => {
        const branded = S.decodeSync(typesApi.schemas.Slug)(slug);
        expect(parsers.slug.serialize(branded)).toBe(slug);
    });
    it.each(B.samples.emails)('email serializes to itself: %s', (email) => {
        const branded = S.decodeSync(typesApi.schemas.Email)(email);
        expect(parsers.email.serialize(branded)).toBe(email);
    });
});
