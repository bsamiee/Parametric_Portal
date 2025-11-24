import { Schema as S } from '@effect/schema';
import { Effect, pipe } from 'effect';

// --- Constants (Unified Factory → Frozen) ------------------------------------

const { patterns } = Effect.runSync(
    Effect.all({
        patterns: Effect.succeed({
            email: /^[^@]+@[^@]+$/,
            hexColor: /^#[0-9a-f]{6}$/i,
            slug: /^[a-z0-9-]+$/,
        } as const),
    }),
);

const PATTERNS = Object.freeze(patterns);

const COMMON_BRANDS = Object.freeze({
    email: pipe(S.String, S.pattern(PATTERNS.email), S.brand('Email')),
    hexColor: pipe(S.String, S.pattern(PATTERNS.hexColor), S.brand('HexColor')),
    nonNegativeInt: pipe(S.Number, S.int(), S.nonNegative(), S.brand('NonNegativeInt')),
    positiveInt: pipe(S.Number, S.int(), S.positive(), S.brand('PositiveInt')),
    slug: pipe(S.String, S.pattern(PATTERNS.slug), S.brand('Slug')),
} as const);

export const SCHEMAS = Object.freeze({
    email: pipe(S.String, S.pattern(PATTERNS.email)),
    hexColor: pipe(S.String, S.pattern(PATTERNS.hexColor)),
    int: pipe(S.Number, S.int()),
    nonNegativeInt: pipe(S.Number, S.int(), S.nonNegative()),
    number: S.Number,
    positiveInt: pipe(S.Number, S.int(), S.positive()),
    slug: pipe(S.String, S.pattern(PATTERNS.slug)),
    string: S.String,
    uuid: S.UUID,
} as const);

// --- Pure Utility Functions --------------------------------------------------

export const brand = <A, I, Brand extends string>(schema: S.Schema<A, I, never>, brandName: Brand) =>
    pipe(schema, S.brand(brandName));

// --- Export ------------------------------------------------------------------

export { COMMON_BRANDS, PATTERNS };
