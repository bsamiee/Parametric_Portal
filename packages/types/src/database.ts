/**
 * Define database entity identifiers, domain schemas, and auth response types.
 * Single import point for all domain primitives via @parametric-portal/types/database.
 */
import { Duration, Option, pipe, type Redacted, Schema as S } from 'effect';
import { type Hex64, types } from './types.ts';

const typesApi = types();

// --- [TYPES] -----------------------------------------------------------------

type ApiKeyId = S.Schema.Type<typeof ApiKeyIdSchema>;
type AssetId = S.Schema.Type<typeof AssetIdSchema>;
type UserId = S.Schema.Type<typeof UserIdSchema>;
type SessionId = S.Schema.Type<typeof SessionIdSchema>;
type OAuthAccountId = S.Schema.Type<typeof OAuthAccountIdSchema>;
type RefreshTokenId = S.Schema.Type<typeof RefreshTokenIdSchema>;
type OrganizationId = S.Schema.Type<typeof OrganizationIdSchema>;
type OrganizationMemberId = S.Schema.Type<typeof OrganizationMemberIdSchema>;
type OAuthProvider = S.Schema.Type<typeof OAuthProviderSchema>;
type OrganizationRole = S.Schema.Type<typeof OrganizationRoleSchema>;
type SessionResult = S.Schema.Type<typeof SessionResultSchema>;
type ApiKeyResult = S.Schema.Type<typeof ApiKeyResultSchema>;
type TokenHash = Hex64;
type Version = S.Schema.Type<typeof VersionSchema>;
type ColorMode = S.Schema.Type<typeof ColorModeSchema>;
type Intent = S.Schema.Type<typeof IntentSchema>;
type OutputMode = S.Schema.Type<typeof OutputModeSchema>;
type AssetMetadata = S.Schema.Type<typeof AssetMetadataSchema>;
type AssetListItem = S.Schema.Type<typeof AssetListItemSchema>;
type AssetCountResult = S.Schema.Type<typeof AssetCountResultSchema>;
type AiProvider = S.Schema.Type<typeof AiProviderSchema>;
type ApiKeyListItem = S.Schema.Type<typeof ApiKeyListItemSchema>;
type OAuthStartResponse = S.Schema.Type<typeof OAuthStartResponseSchema>;
type SessionResponse = S.Schema.Type<typeof SessionResponseSchema>;
type UserResponse = S.Schema.Type<typeof UserResponseSchema>;
type LogoutResponse = S.Schema.Type<typeof LogoutResponseSchema>;
type OAuthTokens = S.Schema.Type<typeof OAuthTokensSchema>;
type OAuthUserInfo = S.Schema.Type<typeof OAuthUserInfoSchema>;
type OAuthProviderConfig = {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
    readonly redirectUri: string;
    readonly scopes: ReadonlyArray<string>;
};
type DatabaseConfig = {
    readonly refreshBuffer?: Duration.Duration;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    aiProviders: ['anthropic'] as const,
    durations: {
        accessToken: Duration.minutes(15),
        apiKey: Duration.days(365),
        refreshBuffer: Duration.minutes(1),
        refreshToken: Duration.days(30),
        session: Duration.days(7),
    },
    providers: ['google', 'github', 'microsoft'] as const,
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const brandedId = <T extends string>(label: T) => pipe(typesApi.schemas.Uuidv7, S.brand(label));
const ApiKeyIdSchema = brandedId('ApiKeyId');
const AssetIdSchema = brandedId('AssetId');
const UserIdSchema = brandedId('UserId');
const SessionIdSchema = brandedId('SessionId');
const OAuthAccountIdSchema = brandedId('OAuthAccountId');
const RefreshTokenIdSchema = brandedId('RefreshTokenId');
const OrganizationIdSchema = brandedId('OrganizationId');
const OrganizationMemberIdSchema = brandedId('OrganizationMemberId');
const TokenHashSchema = typesApi.schemas.Hex64;
const VersionSchema = pipe(S.Int, S.nonNegative(), S.brand('Version'));
const OAuthProviderSchema = S.Literal(...B.providers);
const OrganizationRoleSchema = S.Literal('owner', 'admin', 'member');
const SessionResultSchema = S.Struct({
    expiresAt: S.DateFromSelf,
    sessionId: SessionIdSchema,
    userId: UserIdSchema,
});
const ApiKeyResultSchema = S.Struct({
    expiresAt: S.OptionFromNullOr(S.DateFromSelf),
    id: ApiKeyIdSchema,
    userId: UserIdSchema,
});
const ColorModeSchema = S.Literal('dark', 'light');
const IntentSchema = S.Literal('create', 'refine');
const OutputModeSchema = S.Literal('single', 'batch');
const AssetMetadataSchema = S.Struct({ colorMode: ColorModeSchema, intent: IntentSchema });
const AssetListItemSchema = S.Struct({ id: AssetIdSchema, prompt: S.NonEmptyTrimmedString });
const AssetCountResultSchema = S.Struct({ count: S.NumberFromString });
const AiProviderSchema = S.Literal(...B.aiProviders);
const ApiKeyListItemSchema = S.Struct({
    createdAt: S.DateFromSelf,
    id: ApiKeyIdSchema,
    lastUsedAt: S.OptionFromNullOr(S.DateFromSelf),
    name: S.NonEmptyTrimmedString,
    provider: AiProviderSchema,
});
const OAuthTokensSchema = S.Struct({
    accessToken: S.String,
    expiresAt: S.OptionFromNullOr(S.DateFromSelf),
    refreshToken: S.OptionFromNullOr(S.String),
    scope: S.OptionFromNullOr(S.String),
});
const OAuthUserInfoSchema = S.Struct({
    avatarUrl: S.OptionFromNullOr(S.String),
    email: S.OptionFromNullOr(S.String),
    name: S.OptionFromNullOr(S.String),
    providerAccountId: S.String,
});
const OAuthStartResponseSchema = S.Struct({ url: S.String });
const SessionResponseSchema = S.Struct({ accessToken: typesApi.schemas.Uuidv7, expiresAt: S.DateTimeUtc });
const UserResponseSchema = S.Struct({ email: S.String, id: UserIdSchema });
const LogoutResponseSchema = S.Struct({ success: S.Boolean });

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const Expiry = Object.freeze({
    check: (date: Date | null | undefined, bufferMs = Duration.toMillis(B.durations.refreshBuffer)) =>
        pipe(
            Option.fromNullable(date),
            Option.match({
                onNone: () => ({ delayMs: 0, expired: false, shouldRefresh: false }),
                onSome: (d) => ({
                    delayMs: Math.max(0, d.getTime() - Date.now() - bufferMs),
                    expired: d.getTime() < Date.now(),
                    shouldRefresh: d.getTime() - Date.now() - bufferMs <= 0,
                }),
            }),
        ),
    computeFrom: (duration: Duration.Duration): Date => new Date(Date.now() + Duration.toMillis(duration)),
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const database = (config: DatabaseConfig = {}) =>
    Object.freeze({
        expiry: Object.freeze({
            check: (date: Date | null | undefined, bufferMs?: number) =>
                Expiry.check(date, bufferMs ?? Duration.toMillis(config.refreshBuffer ?? B.durations.refreshBuffer)),
            computeFrom: Expiry.computeFrom,
        }),
        providers: B.providers,
        schemas: Object.freeze({
            entities: Object.freeze({
                AiProvider: AiProviderSchema,
                ApiKeyListItem: ApiKeyListItemSchema,
                ApiKeyResult: ApiKeyResultSchema,
                AssetCountResult: AssetCountResultSchema,
                AssetListItem: AssetListItemSchema,
                AssetMetadata: AssetMetadataSchema,
                ColorMode: ColorModeSchema,
                Intent: IntentSchema,
                OAuthProvider: OAuthProviderSchema,
                OAuthTokens: OAuthTokensSchema,
                OAuthUserInfo: OAuthUserInfoSchema,
                OrganizationRole: OrganizationRoleSchema,
                OutputMode: OutputModeSchema,
                SessionResult: SessionResultSchema,
                TokenHash: TokenHashSchema,
                Version: VersionSchema,
            }),
            ids: Object.freeze({
                ApiKeyId: ApiKeyIdSchema,
                AssetId: AssetIdSchema,
                OAuthAccountId: OAuthAccountIdSchema,
                OrganizationId: OrganizationIdSchema,
                OrganizationMemberId: OrganizationMemberIdSchema,
                RefreshTokenId: RefreshTokenIdSchema,
                SessionId: SessionIdSchema,
                UserId: UserIdSchema,
            }),
            responses: Object.freeze({
                LogoutResponse: LogoutResponseSchema,
                OAuthStartResponse: OAuthStartResponseSchema,
                SessionResponse: SessionResponseSchema,
                UserResponse: UserResponseSchema,
            }),
        }),
    });
type DatabaseApi = ReturnType<typeof database>;

// --- [EXPORT] ----------------------------------------------------------------

export { B as DATABASE_TUNING, database };
export type {
    AiProvider,
    ApiKeyId,
    ApiKeyListItem,
    ApiKeyResult,
    AssetCountResult,
    AssetId,
    AssetListItem,
    AssetMetadata,
    ColorMode,
    DatabaseApi,
    DatabaseConfig,
    Intent,
    LogoutResponse,
    OAuthAccountId,
    OAuthProvider,
    OAuthProviderConfig,
    OAuthStartResponse,
    OAuthTokens,
    OAuthUserInfo,
    OrganizationId,
    OrganizationMemberId,
    OrganizationRole,
    OutputMode,
    RefreshTokenId,
    SessionId,
    SessionResponse,
    SessionResult,
    TokenHash,
    UserId,
    UserResponse,
    Version,
};
