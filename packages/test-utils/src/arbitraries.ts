/**
 * Arbitraries: reusable fast-check generators for property-based tests.
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

const charsToArb = (chars: string): fc.Arbitrary<string> => fc.constantFrom(...chars.split(''));
const stringOfChars = (chars: string, opts: { maxLength: number; minLength: number }): fc.Arbitrary<string> =>
    fc.string({ maxLength: opts.maxLength, minLength: opts.minLength, unit: charsToArb(chars) });

/** Temporal offset: symmetric integer range around zero. */
const fcTemporalOffset = (unit: TemporalUnit): fc.Arbitrary<number> => {
    const bound = B.temporal[unit];
    return fc.integer({ max: bound, min: -bound });
};
/** Pattern-validated string: generated then filtered by regex. */
const fcPatternedString = (key: PatternKey): fc.Arbitrary<string> => {
    const pattern = B.patterns[key];
    const chars = key === 'storeName' ? B.charSets.storeName : undefined;
    const base = chars
        ? stringOfChars(chars, { maxLength: B.strings.max, minLength: B.strings.min })
        : fc.string({ maxLength: B.strings.max, minLength: B.strings.min });
    return base.filter((s) => pattern.test(s));
};
/** Enum constant: one of fixed literal values. */
const fcEnumConstant = <K extends EnumKey>(key: K): fc.Arbitrary<(typeof B.enums)[K][number]> =>
    fc.constantFrom(...B.enums[key]);
/** Bounded integer: min/max from integers config. */
const fcBoundedInteger = (key: IntegerBoundKey): fc.Arbitrary<number> => {
    const bounds = B.integers[key];
    return fc.integer({ max: bounds.max, min: bounds.min });
};
/** Invalid cases: union of deliberately invalid arbitraries with typed output. */
const fcInvalid = <K extends keyof typeof B.invalidCases, T>(key: K): fc.Arbitrary<T> =>
    fc.oneof(...B.invalidCases[key].map((f) => f())) as fc.Arbitrary<T>;
/** Nullable: wraps arbitrary to include null. */
const fcNullable = <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | null> => fc.oneof(arb, fc.constant(null));
/** Optional: wraps arbitrary to include undefined. */
const fcOptional = <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> => fc.oneof(arb, fc.constant(undefined));
/** Boolean: simple true/false. */
const fcBoolean = (): fc.Arbitrary<boolean> => fc.boolean();
const fcFilename = (): fc.Arbitrary<string> => fc.string({ maxLength: 100, minLength: B.strings.min });
const fcSafeFilename = (): fc.Arbitrary<string> =>
    stringOfChars(B.charSets.filename, { maxLength: B.filenames.max, minLength: B.filenames.min });
const fcJsonValue = (): fc.Arbitrary<string> => fc.json({ maxDepth: 2 }).map((v) => JSON.stringify(v));
/** ISO date string: algorithmically generated from valid year/month/day components. */
const fcIsoDate = (): fc.Arbitrary<string> => {
    const pad = (n: number): string => String(n).padStart(2, '0');
    const yearArb = fc.integer({ max: B.dates.maxYear, min: B.dates.minYear });
    const monthArb = fc.integer({ max: 12, min: 1 });
    return fc.tuple(yearArb, monthArb).chain(([year, month]) => {
        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
        return fc.integer({ max: daysInMonth, min: 1 }).map((day) => `${year}-${pad(month)}-${pad(day)}`);
    });
};
const fcMessageData = (): fc.Arbitrary<unknown> =>
    fc.oneof(
        fc.string(),
        fc.integer(),
        fc.boolean(),
        fc.record({ key: fc.string(), value: fc.string() }),
        fc.array(fc.integer()),
    );

// --- [ENTRY_POINT] ----------------------------------------------------------

const Arbitraries = Object.freeze({
    boolean: fcBoolean,
    days: () => fcTemporalOffset('days'),
    eventName: () => fcPatternedString('eventName'),
    fileExtension: () => fcEnumConstant('fileExtensions'),
    filename: fcFilename,
    historyLimit: () => fcBoundedInteger('historyLimit'),
    hours: () => fcTemporalOffset('hours'),
    invalidHistoryLimit: (): fc.Arbitrary<number> => fcInvalid<'historyLimit', number>('historyLimit'),
    invalidStoreName: (): fc.Arbitrary<string> => fcInvalid<'storeName', string>('storeName'),
    isoDate: fcIsoDate,
    jsonValue: fcJsonValue,
    messageData: fcMessageData,
    minutes: () => fcTemporalOffset('minutes'),
    months: () => fcTemporalOffset('months'),
    nullable: fcNullable,
    optional: fcOptional,
    safeFilename: fcSafeFilename,
    storageKey: () => fcPatternedString('storageKey'),
    storageType: () => fcEnumConstant('storageTypes'),
    storeName: () => fcPatternedString('storeName'),
    variantCount: () => fcBoundedInteger('variantCount'),
    variantIndex: () => fcBoundedInteger('variantIndex'),
} as const);

// --- [EXPORT] ---------------------------------------------------------------

export { Arbitraries as FC_ARB, B as ARB_TUNING };
export type { FileExtension, StorageType };
