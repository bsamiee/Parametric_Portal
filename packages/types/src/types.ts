/**
 * Define primitive types and branded schemas with runtime validation.
 * Effect Schema validation with runtime branding for domain primitives.
 */
import { Effect, pipe, Schema as S } from 'effect';
import type { ParseError } from 'effect/ParseResult';
import { v7 as uuidv7 } from 'uuid';

// --- [TYPES] -----------------------------------------------------------------

type BivariantFunction<T> = T extends (...args: infer A extends readonly unknown[]) => infer R
    ? { bivarianceHack: (...args: A) => R }['bivarianceHack']
    : never;
type Uuidv7 = S.Schema.Type<typeof Uuidv7Schema>;
type Email = S.Schema.Type<typeof EmailSchema>;
type HexColor = S.Schema.Type<typeof HexColorSchema>;
type Hex8 = S.Schema.Type<typeof Hex8Schema>;
type Hex64 = S.Schema.Type<typeof Hex64Schema>;
type HtmlId = S.Schema.Type<typeof HtmlIdSchema>;
type IsoDate = S.Schema.Type<typeof IsoDateSchema>;
type NonNegativeInt = S.Schema.Type<typeof NonNegativeIntSchema>;
type Percentage = S.Schema.Type<typeof PercentageSchema>;
type PositiveInt = S.Schema.Type<typeof PositiveIntSchema>;
type SafeInteger = S.Schema.Type<typeof SafeIntegerSchema>;
type Slug = S.Schema.Type<typeof SlugSchema>;
type Url = S.Schema.Type<typeof UrlSchema>;
type PaginationParams = S.Schema.Type<typeof PaginationParamsSchema>;
type Index = S.Schema.Type<typeof IndexSchema>;
type VariantCount = S.Schema.Type<typeof VariantCountSchema>;
type ZoomFactor = S.Schema.Type<typeof ZoomFactorSchema>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    bounds: {
        index: { max: Number.MAX_SAFE_INTEGER, min: 0 },
        variantCount: { max: 10, min: 1 },
        zoomFactor: { max: 10, min: 0.1 },
    },
    hex: { length: 8, radix: 16 },
    pagination: { defaultPageSize: 20, maxPageSize: 100 },
    patterns: {
        email: /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/,
        hex8: /^[0-9a-f]{8}$/,
        hex64: /^[0-9a-f]{64}$/i,
        hexColor: /^#[0-9a-f]{6}$/i,
        htmlId: /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
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
    hex8: pipe(S.String, S.pattern(B.patterns.hex8)),
    hex64: pipe(S.String, S.pattern(B.patterns.hex64)),
    hexColor: pipe(S.String, S.pattern(B.patterns.hexColor)),
    htmlId: pipe(S.String, S.pattern(B.patterns.htmlId)),
    int: pipe(S.Number, S.int()),
    isoDate: pipe(S.String, S.pattern(B.patterns.isoDate)),
    nonNegativeInt: pipe(S.Number, S.int(), S.nonNegative()),
    percentage: pipe(S.Number, S.between(B.ranges.percentage.min, B.ranges.percentage.max)),
    positiveInt: pipe(S.Number, S.int(), S.positive()),
    safeInteger: pipe(S.Number, S.int(), S.between(B.ranges.safeInteger.min, B.ranges.safeInteger.max)),
    slug: pipe(S.String, S.pattern(B.patterns.slug)),
    url: pipe(S.String, S.pattern(B.patterns.url)),
    uuidv7: pipe(S.String, S.pattern(B.patterns.uuidv7)),
} as const;
const EmailSchema = pipe(baseSchemas.email, S.brand('Email'));
const Hex8Schema = pipe(baseSchemas.hex8, S.brand('Hex8'));
const Hex64Schema = pipe(baseSchemas.hex64, S.brand('Hex64'));
const HexColorSchema = pipe(baseSchemas.hexColor, S.brand('HexColor'));
const HtmlIdSchema = pipe(baseSchemas.htmlId, S.brand('HtmlId'));
const IsoDateSchema = pipe(baseSchemas.isoDate, S.brand('IsoDate'));
const NonNegativeIntSchema = pipe(baseSchemas.nonNegativeInt, S.brand('NonNegativeInt'));
const PercentageSchema = pipe(baseSchemas.percentage, S.brand('Percentage'));
const PositiveIntSchema = pipe(baseSchemas.positiveInt, S.brand('PositiveInt'));
const SafeIntegerSchema = pipe(baseSchemas.safeInteger, S.brand('SafeInteger'));
const SlugSchema = pipe(baseSchemas.slug, S.brand('Slug'));
const UrlSchema = pipe(baseSchemas.url, S.brand('Url'));
const Uuidv7Schema = pipe(baseSchemas.uuidv7, S.brand('Uuidv7'));
const boundedInt = <T extends string>(label: T, min: number, max: number) =>
    pipe(S.Number, S.int(), S.between(min, max), S.brand(label));
const boundedNumber = <T extends string>(label: T, min: number, max: number) =>
    pipe(S.Number, S.between(min, max), S.brand(label));
const IndexSchema = boundedInt('Index', B.bounds.index.min, B.bounds.index.max);
const VariantCountSchema = boundedInt('VariantCount', B.bounds.variantCount.min, B.bounds.variantCount.max);
const ZoomFactorSchema = boundedNumber('ZoomFactor', B.bounds.zoomFactor.min, B.bounds.zoomFactor.max);
const patterns = Object.freeze(B.patterns);
const PaginationParamsSchema = S.Struct({
    limit: pipe(S.Int, S.between(1, B.pagination.maxPageSize)),
    offset: pipe(S.Int, S.nonNegative()),
});
const schemas = Object.freeze({
    ...baseSchemas,
    nonEmptyTrimmedString: S.NonEmptyTrimmedString,
    number: S.Number,
    pagination: PaginationParamsSchema,
    string: S.String,
    uuid: S.UUID,
} as const);
const brands = Object.freeze({
    email: EmailSchema,
    hex8: Hex8Schema,
    hex64: Hex64Schema,
    hexColor: HexColorSchema,
    htmlId: HtmlIdSchema,
    index: IndexSchema,
    isoDate: IsoDateSchema,
    nonNegativeInt: NonNegativeIntSchema,
    percentage: PercentageSchema,
    positiveInt: PositiveIntSchema,
    safeInteger: SafeIntegerSchema,
    slug: SlugSchema,
    url: UrlSchema,
    uuidv7: Uuidv7Schema,
    variantCount: VariantCountSchema,
    zoomFactor: ZoomFactorSchema,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const generateUuidv7Sync = (): Uuidv7 => S.decodeSync(Uuidv7Schema)(uuidv7());
const generateHex8 = (): Hex8 =>
    Array.from({ length: B.hex.length }, () => Math.trunc(Math.random() * B.hex.radix).toString(B.hex.radix)).join(
        '',
    ) as Hex8;
const deriveHex8 = (seed: string): Hex8 => {
    const modulo = B.hex.radix ** B.hex.length;
    const hash = Array.from(seed).reduce<number>((acc, char) => (acc * 31 + (char.codePointAt(0) ?? 0)) % modulo, 0);
    return hash.toString(B.hex.radix).padStart(B.hex.length, '0').slice(-B.hex.length) as Hex8;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createIdGenerator = <A>(schema: S.Schema<A, string, never>): Effect.Effect<A, ParseError, never> =>
    pipe(
        Effect.sync(generateUuidv7Sync),
        Effect.flatMap((uuid) => S.decode(schema)(uuid)),
    );
const types = () =>
    Object.freeze({
        brands,
        createIdGenerator,
        derive: Object.freeze({ hex8: deriveHex8 }),
        factories: Object.freeze({ boundedInt, boundedNumber }),
        generate: Object.freeze({
            hex8: generateHex8,
            uuidv7: Effect.sync(generateUuidv7Sync),
            uuidv7Sync: generateUuidv7Sync,
        }),
        guards: Object.freeze({
            email: S.is(EmailSchema),
            hex8: S.is(Hex8Schema),
            hex64: S.is(Hex64Schema),
            hexColor: S.is(HexColorSchema),
            htmlId: S.is(HtmlIdSchema),
            index: S.is(IndexSchema),
            isoDate: S.is(IsoDateSchema),
            nonNegativeInt: S.is(NonNegativeIntSchema),
            percentage: S.is(PercentageSchema),
            positiveInt: S.is(PositiveIntSchema),
            safeInteger: S.is(SafeIntegerSchema),
            slug: S.is(SlugSchema),
            url: S.is(UrlSchema),
            uuidv7: S.is(Uuidv7Schema),
            variantCount: S.is(VariantCountSchema),
            zoomFactor: S.is(ZoomFactorSchema),
        }),
        patterns,
        schemas: Object.freeze({
            ...schemas,
            Email: EmailSchema,
            Hex8: Hex8Schema,
            Hex64: Hex64Schema,
            HexColor: HexColorSchema,
            HtmlId: HtmlIdSchema,
            Index: IndexSchema,
            IsoDate: IsoDateSchema,
            NonNegativeInt: NonNegativeIntSchema,
            Pagination: PaginationParamsSchema,
            Percentage: PercentageSchema,
            PositiveInt: PositiveIntSchema,
            SafeInteger: SafeIntegerSchema,
            Slug: SlugSchema,
            Url: UrlSchema,
            Uuidv7: Uuidv7Schema,
            VariantCount: VariantCountSchema,
            ZoomFactor: ZoomFactorSchema,
        }),
    });
type TypesApi = ReturnType<typeof types>;

// --- [EXPORT] ----------------------------------------------------------------

export { B as TYPES_TUNING, types };
export type {
    BivariantFunction,
    Email,
    Hex64,
    Hex8,
    HexColor,
    HtmlId,
    Index,
    IsoDate,
    NonNegativeInt,
    PaginationParams,
    Percentage,
    PositiveInt,
    SafeInteger,
    Slug,
    TypesApi,
    Url,
    Uuidv7,
    VariantCount,
    ZoomFactor,
};
