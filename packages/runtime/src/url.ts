/**
 * URL state management via nuqs - type-safe search params with branded parsers.
 */
import {
    ApiKeyId,
    AssetId,
    OAuthAccountId,
    RefreshTokenId,
    SessionId,
    UserId,
} from '@parametric-portal/types/database';
import {
    Email,
    Hex8,
    Hex64,
    HexColor,
    HtmlId,
    Index,
    IsoDate,
    NonNegativeInt,
    Percentage,
    PositiveInt,
    SafeInteger,
    Slug,
    Url,
    Uuidv7,
    VariantCount,
    ZoomFactor,
} from '@parametric-portal/types/types';
import { Option, Schema as S } from 'effect';
import {
    createLoader,
    createParser,
    type Options,
    parseAsArrayOf,
    parseAsBoolean,
    parseAsFloat,
    parseAsInteger,
    parseAsIsoDateTime,
    parseAsJson,
    parseAsNumberLiteral,
    parseAsString,
    parseAsStringEnum,
    parseAsStringLiteral,
    parseAsTimestamp,
    type SingleParserBuilder,
    throttle,
    useQueryState,
    useQueryStates,
} from 'nuqs';
import { useMemo } from 'react';

// --- [TYPES] -----------------------------------------------------------------

type UrlHistory = 'push' | 'replace';
type UrlStateOptions = {
    readonly clearOnDefault?: boolean;
    readonly history?: UrlHistory;
    readonly limitUrlUpdates?: ReturnType<typeof throttle>;
    readonly scroll?: boolean;
    readonly shallow?: boolean;
};
type ParserType =
    | 'arrayOf'
    | 'boolean'
    | 'float'
    | 'integer'
    | 'isoDateTime'
    | 'json'
    | 'numberLiteral'
    | 'string'
    | 'stringEnum'
    | 'stringLiteral'
    | 'timestamp';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        clearOnDefault: true,
        history: 'replace' as UrlHistory,
        scroll: false,
        shallow: true,
        throttleMs: 50,
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createBrandedStringParser = <A, I extends string>(schema: S.Schema<A, I>) =>
    createParser<A>({
        parse: (value) => Option.getOrNull(S.decodeUnknownOption(schema)(value)),
        serialize: String,
    });
const createBrandedNumberParser = <A, I extends number>(schema: S.Schema<A, I>) =>
    createParser<A>({
        parse: (value) =>
            Number.isNaN(Number(value)) ? null : Option.getOrNull(S.decodeUnknownOption(schema)(Number(value))),
        serialize: String,
    });
const buildOptions = (opts?: UrlStateOptions): Options => ({
    clearOnDefault: opts?.clearOnDefault ?? B.defaults.clearOnDefault,
    history: opts?.history ?? B.defaults.history,
    limitUrlUpdates: opts?.limitUrlUpdates ?? throttle(B.defaults.throttleMs),
    scroll: opts?.scroll ?? B.defaults.scroll,
    shallow: opts?.shallow ?? B.defaults.shallow,
});

// --- [DISPATCH_TABLES] -------------------------------------------------------

const brandedParsers = Object.freeze({
    apiKeyId: createBrandedStringParser(ApiKeyId),
    assetId: createBrandedStringParser(AssetId),
    email: createBrandedStringParser(Email.schema),
    hex8: createBrandedStringParser(Hex8.schema),
    hex64: createBrandedStringParser(Hex64.schema),
    hexColor: createBrandedStringParser(HexColor.schema),
    htmlId: createBrandedStringParser(HtmlId.schema),
    index: createBrandedNumberParser(Index.schema),
    isoDate: createBrandedStringParser(IsoDate.schema),
    nonNegativeInt: createBrandedNumberParser(NonNegativeInt.schema),
    oauthAccountId: createBrandedStringParser(OAuthAccountId),
    percentage: createBrandedNumberParser(Percentage.schema),
    positiveInt: createBrandedNumberParser(PositiveInt.schema),
    refreshTokenId: createBrandedStringParser(RefreshTokenId),
    safeInteger: createBrandedNumberParser(SafeInteger.schema),
    sessionId: createBrandedStringParser(SessionId),
    slug: createBrandedStringParser(Slug.schema),
    url: createBrandedStringParser(Url.schema),
    userId: createBrandedStringParser(UserId),
    uuidv7: createBrandedStringParser(Uuidv7.schema),
    variantCount: createBrandedNumberParser(VariantCount.schema),
    zoomFactor: createBrandedNumberParser(ZoomFactor.schema),
} as const);
const parsers = Object.freeze({
    arrayOf: <T>(itemParser: SingleParserBuilder<T>) => parseAsArrayOf(itemParser),
    boolean: parseAsBoolean,
    float: parseAsFloat,
    integer: parseAsInteger,
    isoDateTime: parseAsIsoDateTime,
    // biome-ignore lint/suspicious/noExplicitAny: parseAsJson generic escape
    json: <T>(defaultValue: T) => (parseAsJson as any)().withDefault(defaultValue),
    numberLiteral: <T extends number>(values: T[]) => parseAsNumberLiteral(values),
    string: parseAsString,
    stringEnum: <T extends string>(values: T[]) => parseAsStringEnum(values),
    stringLiteral: <T extends string>(values: T[]) => parseAsStringLiteral(values),
    timestamp: parseAsTimestamp,
    ...brandedParsers,
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const useUrlState = <T>(key: string, parser: SingleParserBuilder<T>, options?: UrlStateOptions) =>
    useQueryState(key, parser.withOptions(buildOptions(options)));
const useUrlStates = <T extends Record<string, SingleParserBuilder<unknown>>>(keyMap: T, options?: UrlStateOptions) =>
    useQueryStates(
        useMemo(
            () =>
                Object.fromEntries(
                    Object.entries(keyMap).map(([k, p]) => [k, p.withOptions(buildOptions(options))]),
                ) as T,
            [keyMap, options],
        ),
    );
const createUrlLoader = <T extends Record<string, SingleParserBuilder<unknown>>>(keyMap: T) =>
    createLoader(keyMap as Parameters<typeof createLoader>[0]);

// --- [EXPORT] ----------------------------------------------------------------

export {
    B as URL_TUNING,
    createBrandedNumberParser,
    createBrandedStringParser,
    createUrlLoader,
    parsers,
    useUrlState,
    useUrlStates,
};
export type { ParserType, UrlHistory, UrlStateOptions };
