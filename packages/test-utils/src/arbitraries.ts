/**
 * Generate reusable fast-check arbitraries for property-based tests.
 * Pure fast-check generators ensure browser test compatibility.
 */
import fc from 'fast-check';

// --- [TYPES] ----------------------------------------------------------------

type StorageType = 'cookies' | 'indexedDB' | 'localStorage' | 'sessionStorage';
type FileExtension = 'jpg' | 'pdf' | 'png' | 'svg' | 'zip';
type TemporalUnit = keyof typeof B.temporal;
type PatternKey = keyof typeof B.patterns;
type EnumKey = keyof typeof B.enums;
type IntegerBoundKey = keyof typeof B.integers;

// --- [CONSTANTS] ------------------------------------------------------------

const B = Object.freeze({
    charSets: {
        alphaLower: 'abcdefghijklmnopqrstuvwxyz',
        alphaNum: 'abcdefghijklmnopqrstuvwxyz0123456789',
        filename: 'abcdefghijklmnopqrstuvwxyz0123456789 -_',
        storeName: 'abcdefghijklmnopqrstuvwxyz0123456789-:',
    },
    dates: { maxYear: 2030, minYear: 2020 },
    enums: {
        fileExtensions: ['png', 'svg', 'zip', 'jpg', 'pdf'] as const,
        storageTypes: ['localStorage', 'sessionStorage', 'cookies', 'indexedDB'] as const,
    },
    filenames: { max: 64, min: 1 },
    integers: {
        historyLimit: { max: 1000, min: 1 },
        variantCount: { max: 100, min: 1 },
        variantIndex: { max: 99, min: 0 },
    },
    invalidCases: {
        historyLimit: [
            () => fc.integer({ max: 0 }),
            () => fc.integer({ min: 1001 }),
            () => fc.double().filter((n) => !Number.isInteger(n)),
        ],
        storeName: [
            () => fc.constant('UPPERCASE'),
            () => fc.constant('has spaces'),
            () => fc.constant('special!chars'),
            () => fc.constant(''),
            () => fc.constant('-starts-with-dash'),
            () => fc.constant(':starts-with-colon'),
            () => fc.string({ minLength: 1, unit: fc.constantFrom(...'@#$%&*'.split('')) }),
        ],
    },
    patterns: {
        eventName: /^[a-zA-Z][a-zA-Z0-9_-]*$/,
        storageKey: /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
        storeName: /^[a-z0-9][a-z0-9:-]*$/,
    },
    strings: { max: 32, min: 1 },
    temporal: { days: 365, hours: 24, minutes: 60, months: 12 },
} as const);

// --- [PURE_FUNCTIONS] -------------------------------------------------------

/** String from constrained character set (inlines char-to-arb conversion). */
const stringOfChars = (chars: string, opts: { maxLength: number; minLength: number }): fc.Arbitrary<string> =>
    fc.string({ ...opts, unit: fc.constantFrom(...chars.split('')) });
/** ISO date: algorithmically generated from valid year/month/day components. */
const isoDateArb = (): fc.Arbitrary<string> => {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return fc
        .tuple(fc.integer({ max: B.dates.maxYear, min: B.dates.minYear }), fc.integer({ max: 12, min: 1 }))
        .chain(([year, month]) => {
            const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
            return fc.integer({ max: daysInMonth, min: 1 }).map((day) => `${year}-${pad(month)}-${pad(day)}`);
        });
};
/** Message data: polymorphic union of common payload types. */
const messageDataArb = (): fc.Arbitrary<unknown> =>
    fc.oneof(
        fc.string(),
        fc.integer(),
        fc.boolean(),
        fc.record({ key: fc.string(), value: fc.string() }, { noNullPrototype: true }),
        fc.array(fc.integer()),
    );

// --- [DISPATCH_TABLES] ------------------------------------------------------

/** B-keyed generator lookup: single table for all parametric arbitraries. */
const generators = Object.freeze({
    bounded: (key: IntegerBoundKey): fc.Arbitrary<number> =>
        fc.integer({ max: B.integers[key].max, min: B.integers[key].min }),
    enum: <K extends EnumKey>(key: K): fc.Arbitrary<(typeof B.enums)[K][number]> => fc.constantFrom(...B.enums[key]),
    invalid: <K extends keyof typeof B.invalidCases, T>(key: K): fc.Arbitrary<T> =>
        fc.oneof(...B.invalidCases[key].map((f) => f())) as fc.Arbitrary<T>,
    pattern: (key: PatternKey): fc.Arbitrary<string> => {
        const chars = key === 'storeName' ? B.charSets.storeName : undefined;
        const base = chars
            ? stringOfChars(chars, { maxLength: B.strings.max, minLength: B.strings.min })
            : fc.string({ maxLength: B.strings.max, minLength: B.strings.min });
        return base.filter((s) => B.patterns[key].test(s));
    },
    temporal: (unit: TemporalUnit): fc.Arbitrary<number> =>
        fc.integer({ max: B.temporal[unit], min: -B.temporal[unit] }),
} as const);

// --- [ENTRY_POINT] ----------------------------------------------------------

const Arbitraries = Object.freeze({
    boolean: () => fc.boolean(),
    booleanOrUndefined: (): fc.Arbitrary<boolean | undefined> => fc.option(fc.boolean(), { nil: undefined }),
    configOrBoolean: <T>(configArb: fc.Arbitrary<T>): fc.Arbitrary<T | boolean | undefined> =>
        fc.oneof(fc.boolean(), configArb, fc.constant(undefined)),
    days: () => generators.temporal('days'),
    eventName: () => generators.pattern('eventName'),
    fileExtension: () => generators.enum('fileExtensions'),
    filename: () => fc.string({ maxLength: 100, minLength: B.strings.min }),
    historyLimit: () => generators.bounded('historyLimit'),
    hours: () => generators.temporal('hours'),
    invalidHistoryLimit: (): fc.Arbitrary<number> => generators.invalid<'historyLimit', number>('historyLimit'),
    invalidStoreName: (): fc.Arbitrary<string> => generators.invalid<'storeName', string>('storeName'),
    isoDate: isoDateArb,
    jsonValue: (): fc.Arbitrary<string> => fc.json({ maxDepth: 2 }).map((v) => JSON.stringify(v)),
    messageData: messageDataArb,
    minutes: () => generators.temporal('minutes'),
    months: () => generators.temporal('months'),
    nullable: <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | null> => fc.option(arb, { nil: null }),
    optional: <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> => fc.option(arb, { nil: undefined }),
    safeFilename: () => stringOfChars(B.charSets.filename, { maxLength: B.filenames.max, minLength: B.filenames.min }),
    storageKey: () => generators.pattern('storageKey'),
    storageType: () => generators.enum('storageTypes'),
    storeName: () => generators.pattern('storeName'),
    variantCount: () => generators.bounded('variantCount'),
    variantIndex: () => generators.bounded('variantIndex'),
} as const);

// --- [EXPORT] ---------------------------------------------------------------

export { Arbitraries as FC_ARB, B as ARB_TUNING };
export type { FileExtension, StorageType };
