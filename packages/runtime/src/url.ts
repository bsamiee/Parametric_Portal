/**
 * URL state management via nuqs - type-safe search params with branded parsers.
 */
import { database } from '@parametric-portal/types/database';
import { types } from '@parametric-portal/types/types';
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
    useQueryState,
    useQueryStates,
} from 'nuqs';
import { useMemo } from 'react';

const typesApi = types();
const dbApi = database();

// --- [TYPES] -----------------------------------------------------------------

type UrlHistory = 'push' | 'replace';
type UrlStateOptions = {
    readonly clearOnDefault?: boolean;
    readonly history?: UrlHistory;
    readonly scroll?: boolean;
    readonly shallow?: boolean;
    readonly throttleMs?: number;
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
        parse: (value) => {
            const num = Number(value);
            return Number.isNaN(num) ? null : Option.getOrNull(S.decodeUnknownOption(schema)(num));
        },
        serialize: String,
    });
const buildOptions = (opts?: UrlStateOptions): Options => ({
    clearOnDefault: opts?.clearOnDefault ?? B.defaults.clearOnDefault,
    history: opts?.history ?? B.defaults.history,
    scroll: opts?.scroll ?? B.defaults.scroll,
    shallow: opts?.shallow ?? B.defaults.shallow,
    throttleMs: opts?.throttleMs ?? B.defaults.throttleMs,
});

// --- [DISPATCH_TABLES] -------------------------------------------------------

const brandedParsers = Object.freeze({
    apiKeyId: createBrandedStringParser(dbApi.schemas.ids.ApiKeyId),
    assetId: createBrandedStringParser(dbApi.schemas.ids.AssetId),
    email: createBrandedStringParser(typesApi.schemas.Email),
    hex8: createBrandedStringParser(typesApi.schemas.Hex8),
    hex64: createBrandedStringParser(typesApi.schemas.Hex64),
    hexColor: createBrandedStringParser(typesApi.schemas.HexColor),
    htmlId: createBrandedStringParser(typesApi.schemas.HtmlId),
    index: createBrandedNumberParser(typesApi.schemas.Index),
    isoDate: createBrandedStringParser(typesApi.schemas.IsoDate),
    nonNegativeInt: createBrandedNumberParser(typesApi.schemas.NonNegativeInt),
    oauthAccountId: createBrandedStringParser(dbApi.schemas.ids.OAuthAccountId),
    organizationId: createBrandedStringParser(dbApi.schemas.ids.OrganizationId),
    organizationMemberId: createBrandedStringParser(dbApi.schemas.ids.OrganizationMemberId),
    percentage: createBrandedNumberParser(typesApi.schemas.Percentage),
    positiveInt: createBrandedNumberParser(typesApi.schemas.PositiveInt),
    refreshTokenId: createBrandedStringParser(dbApi.schemas.ids.RefreshTokenId),
    safeInteger: createBrandedNumberParser(typesApi.schemas.SafeInteger),
    sessionId: createBrandedStringParser(dbApi.schemas.ids.SessionId),
    slug: createBrandedStringParser(typesApi.schemas.Slug),
    url: createBrandedStringParser(typesApi.schemas.Url),
    userId: createBrandedStringParser(dbApi.schemas.ids.UserId),
    uuidv7: createBrandedStringParser(typesApi.schemas.Uuidv7),
    variantCount: createBrandedNumberParser(typesApi.schemas.VariantCount),
    zoomFactor: createBrandedNumberParser(typesApi.schemas.ZoomFactor),
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
const useUrlStates = <T extends Record<string, SingleParserBuilder<unknown>>>(keyMap: T, options?: UrlStateOptions) => {
    const keyMapWithOpts = useMemo(() => {
        const opts = buildOptions(options);
        return Object.fromEntries(Object.entries(keyMap).map(([k, parser]) => [k, parser.withOptions(opts)])) as T;
    }, [keyMap, options]);
    return useQueryStates(keyMapWithOpts);
};
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
