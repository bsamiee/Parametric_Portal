import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { Cache, Duration, Effect, pipe } from 'effect';
import { v7 as uuidv7 } from 'uuid';

// --- Type Definitions --------------------------------------------------------

type Uuidv7 = S.Schema.Type<typeof Uuidv7Schema>;

type TagMatcher<T extends { readonly _tag: string }> = <R>(
    cases: { [K in T['_tag']]: (value: Extract<T, { _tag: K }>) => R },
) => (value: T) => R;

type EffectTagMatcher<T extends { readonly _tag: string }, E = never> = <R>(
    cases: { [K in T['_tag']]: (value: Extract<T, { _tag: K }>) => Effect.Effect<R, E, never> },
) => (value: T) => Effect.Effect<R, E, never>;

type TypesConfig = {
    readonly cacheCapacity?: number;
    readonly cacheTtlMinutes?: number;
};

type TypesApi = {
    readonly brands: typeof brands;
    readonly createIdGenerator: typeof createIdGenerator;
    readonly createTagMatcher: <T extends { readonly _tag: string }>() => TagMatcher<T>;
    readonly createEffectTagMatcher: <T extends { readonly _tag: string }, E = never>() => EffectTagMatcher<T, E>;
    readonly generateUuidv7: Effect.Effect<Uuidv7, never, never>;
    readonly isUuidv7: (u: unknown) => u is Uuidv7;
    readonly isUuidv7Cached: (uuid: string) => Effect.Effect<boolean, never, never>;
    readonly matchTag: typeof matchTag;
    readonly patterns: typeof patterns;
    readonly schemas: typeof schemas;
};

// --- Constants (Single B Constant) -------------------------------------------

const B = Object.freeze({
    cache: { capacity: 1000, ttlMinutes: 5 },
    patterns: {
        email: /^[^@]+@[^@]+$/,
        hexColor: /^#[0-9a-f]{6}$/i,
        isoDate: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/,
        slug: /^[a-z0-9-]+$/,
        uuidv7: /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    },
} as const);

// --- Schema Definitions ------------------------------------------------------

const Uuidv7SchemaUnbranded = pipe(S.String, S.pattern(B.patterns.uuidv7));
const Uuidv7Schema = pipe(Uuidv7SchemaUnbranded, S.brand('Uuidv7'));

const patterns = Object.freeze({
    email: B.patterns.email,
    hexColor: B.patterns.hexColor,
    isoDate: B.patterns.isoDate,
    slug: B.patterns.slug,
    uuidv7: B.patterns.uuidv7,
} as const);

const schemas = Object.freeze({
    email: pipe(S.String, S.pattern(B.patterns.email)),
    hexColor: pipe(S.String, S.pattern(B.patterns.hexColor)),
    int: pipe(S.Number, S.int()),
    isoDate: pipe(S.String, S.pattern(B.patterns.isoDate), S.brand('IsoDate')),
    nonNegativeInt: pipe(S.Number, S.int(), S.nonNegative()),
    number: S.Number,
    positiveInt: pipe(S.Number, S.int(), S.positive()),
    slug: pipe(S.String, S.pattern(B.patterns.slug)),
    string: S.String,
    uuid: S.UUID,
    uuidv7: Uuidv7Schema,
} as const);

const brands = Object.freeze({
    email: pipe(S.String, S.pattern(B.patterns.email), S.brand('Email')),
    hexColor: pipe(S.String, S.pattern(B.patterns.hexColor), S.brand('HexColor')),
    isoDate: pipe(S.String, S.pattern(B.patterns.isoDate), S.brand('IsoDate')),
    nonNegativeInt: pipe(S.Number, S.int(), S.nonNegative(), S.brand('NonNegativeInt')),
    positiveInt: pipe(S.Number, S.int(), S.positive(), S.brand('PositiveInt')),
    slug: pipe(S.String, S.pattern(B.patterns.slug), S.brand('Slug')),
    uuidv7: Uuidv7Schema,
} as const);

// --- Pure Utility Functions --------------------------------------------------

const castToUuidv7 = (uuid: string): Uuidv7 => uuid as Uuidv7;

const matchTag = <T extends { readonly _tag: string }, R>(
    value: T,
    cases: { [K in T['_tag']]: (v: Extract<T, { _tag: K }>) => R },
): R => cases[value._tag as T['_tag']](value as never);

// --- Factory Functions -------------------------------------------------------

const createIdCache = (cfg: TypesConfig) =>
    Cache.make({
        capacity: cfg.cacheCapacity ?? B.cache.capacity,
        lookup: (uuid: string) => Effect.succeed(S.is(Uuidv7SchemaUnbranded)(uuid)),
        timeToLive: Duration.minutes(cfg.cacheTtlMinutes ?? B.cache.ttlMinutes),
    });

const createIdGenerator = <A>(schema: S.Schema<A, string, never>): Effect.Effect<A, ParseError, never> =>
    pipe(
        Effect.sync(() => castToUuidv7(uuidv7())),
        Effect.flatMap((uuid) => S.decode(schema)(uuid)),
    );

// --- Polymorphic Entry Point -------------------------------------------------

const createTypes = (config: TypesConfig = {}): Effect.Effect<TypesApi, never, never> =>
    pipe(
        createIdCache(config),
        Effect.map((cache) =>
            Object.freeze({
                brands,
                createEffectTagMatcher:
                    <T extends { readonly _tag: string }, E = never>(): EffectTagMatcher<T, E> =>
                    <R>(cases: { [K in T['_tag']]: (value: Extract<T, { _tag: K }>) => Effect.Effect<R, E, never> }) =>
                    (value: T): Effect.Effect<R, E, never> =>
                        cases[value._tag as T['_tag']](value as never),
                createIdGenerator,
                createTagMatcher:
                    <T extends { readonly _tag: string }>(): TagMatcher<T> =>
                    <R>(cases: { [K in T['_tag']]: (value: Extract<T, { _tag: K }>) => R }): ((value: T) => R) =>
                    (value: T): R =>
                        cases[value._tag as T['_tag']](value as never),
                generateUuidv7: Effect.sync(() => castToUuidv7(uuidv7())),
                isUuidv7: S.is(Uuidv7Schema),
                isUuidv7Cached: (uuid: string) => cache.get(uuid),
                matchTag,
                patterns,
                schemas,
            } as TypesApi),
        ),
    );

// --- Export (2 Exports: Tuning + Factory) ------------------------------------

export { B as TYPES_TUNING, createTypes };
export type { EffectTagMatcher, TagMatcher, TypesApi, TypesConfig, Uuidv7 };
