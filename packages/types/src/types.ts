/**
 * Provide domain primitives via Effect Schema branded types.
 */
import { Effect, Option, pipe, Schema as S } from 'effect';
import type { ParseError } from 'effect/ParseResult';
import { match, P } from 'ts-pattern';
import { v7 as uuidv7 } from 'uuid';

// --- [TYPES] -----------------------------------------------------------------

type Uuidv7 = S.Schema.Type<typeof Uuidv7Schema>;
type Email = S.Schema.Type<typeof EmailSchema>;
type HexColor = S.Schema.Type<typeof HexColorSchema>;
type IsoDate = S.Schema.Type<typeof IsoDateSchema>;
type NonEmptyString = S.Schema.Type<typeof NonEmptyStringSchema>;
type NonNegativeInt = S.Schema.Type<typeof NonNegativeIntSchema>;
type Percentage = S.Schema.Type<typeof PercentageSchema>;
type PositiveInt = S.Schema.Type<typeof PositiveIntSchema>;
type SafeInteger = S.Schema.Type<typeof SafeIntegerSchema>;
type Slug = S.Schema.Type<typeof SlugSchema>;
type Url = S.Schema.Type<typeof UrlSchema>;
type TypesConfig = {
    readonly cacheCapacity?: number;
    readonly cacheTtlMinutes?: number;
};
type TypesApi = {
    readonly brands: typeof brands;
    readonly createIdGenerator: typeof createIdGenerator;
    readonly generateUuidv7: Effect.Effect<Uuidv7, never, never>;
    readonly isUuidv7: (u: unknown) => u is Uuidv7;
    readonly match: typeof match;
    readonly Option: typeof Option;
    readonly P: typeof P;
    readonly patterns: typeof patterns;
    readonly schemas: typeof schemas;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    cache: { capacity: 1000, ttlMinutes: 5 },
    patterns: {
        email: /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/,
        hexColor: /^#[0-9a-f]{6}$/i,
        isoDate: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/,
        slug: /^[a-z0-9-]+$/,
        url: /^https?:\/\/[^\s/$.?#].[^\s]*$/i,
        uuidv7: /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    },
    ranges: {
        percentage: { max: 100, min: 0 },
        safeInteger: { max: Number.MAX_SAFE_INTEGER, min: Number.MIN_SAFE_INTEGER },
    },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const baseSchemas = {
    email: pipe(S.String, S.pattern(B.patterns.email)),
    hexColor: pipe(S.String, S.pattern(B.patterns.hexColor)),
    int: pipe(S.Number, S.int()),
    isoDate: pipe(S.String, S.pattern(B.patterns.isoDate)),
    nonEmptyString: pipe(S.String, S.nonEmptyString()),
    nonNegativeInt: pipe(S.Number, S.int(), S.nonNegative()),
    percentage: pipe(S.Number, S.between(B.ranges.percentage.min, B.ranges.percentage.max)),
    positiveInt: pipe(S.Number, S.int(), S.positive()),
    safeInteger: pipe(S.Number, S.int(), S.between(B.ranges.safeInteger.min, B.ranges.safeInteger.max)),
    slug: pipe(S.String, S.pattern(B.patterns.slug)),
    url: pipe(S.String, S.pattern(B.patterns.url)),
    uuidv7: pipe(S.String, S.pattern(B.patterns.uuidv7)),
} as const;

const EmailSchema = pipe(baseSchemas.email, S.brand('Email'));
const HexColorSchema = pipe(baseSchemas.hexColor, S.brand('HexColor'));
const IsoDateSchema = pipe(baseSchemas.isoDate, S.brand('IsoDate'));
const NonEmptyStringSchema = pipe(baseSchemas.nonEmptyString, S.brand('NonEmptyString'));
const NonNegativeIntSchema = pipe(baseSchemas.nonNegativeInt, S.brand('NonNegativeInt'));
const PercentageSchema = pipe(baseSchemas.percentage, S.brand('Percentage'));
const PositiveIntSchema = pipe(baseSchemas.positiveInt, S.brand('PositiveInt'));
const SafeIntegerSchema = pipe(baseSchemas.safeInteger, S.brand('SafeInteger'));
const SlugSchema = pipe(baseSchemas.slug, S.brand('Slug'));
const UrlSchema = pipe(baseSchemas.url, S.brand('Url'));
const Uuidv7Schema = pipe(baseSchemas.uuidv7, S.brand('Uuidv7'));

const patterns = Object.freeze(B.patterns);

const schemas = Object.freeze({
    ...baseSchemas,
    number: S.Number,
    string: S.String,
    uuid: S.UUID,
} as const);

const brands = Object.freeze({
    email: EmailSchema,
    hexColor: HexColorSchema,
    isoDate: IsoDateSchema,
    nonEmptyString: NonEmptyStringSchema,
    nonNegativeInt: NonNegativeIntSchema,
    percentage: PercentageSchema,
    positiveInt: PositiveIntSchema,
    safeInteger: SafeIntegerSchema,
    slug: SlugSchema,
    url: UrlSchema,
    uuidv7: Uuidv7Schema,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const castToUuidv7 = (uuid: string): Uuidv7 => uuid as Uuidv7;

// --- [ENTRY_POINT] -----------------------------------------------------------

const createIdGenerator = <A>(schema: S.Schema<A, string, never>): Effect.Effect<A, ParseError, never> =>
    pipe(
        Effect.sync(() => castToUuidv7(uuidv7())),
        Effect.flatMap((uuid) => S.decode(schema)(uuid)),
    );

const types = (_config: TypesConfig = {}): TypesApi =>
    Object.freeze({
        brands,
        createIdGenerator,
        generateUuidv7: Effect.sync(() => castToUuidv7(uuidv7())),
        isUuidv7: S.is(Uuidv7Schema),
        match,
        Option,
        P,
        patterns,
        schemas,
    } as TypesApi);

// --- [EXPORT] ----------------------------------------------------------------

export { B as TYPES_TUNING, types };
export type {
    Email,
    HexColor,
    IsoDate,
    NonEmptyString,
    NonNegativeInt,
    Percentage,
    PositiveInt,
    SafeInteger,
    Slug,
    TypesApi,
    TypesConfig,
    Url,
    Uuidv7,
};
