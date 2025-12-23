/**
 * Database entity identifiers, domain schemas, and auth response types.
 * Single import point for all domain primitives: @parametric-portal/types/database
 */
import { Duration, pipe, type Redacted, Schema as S } from 'effect';
import type { Hex64 } from './types.ts';
import { Hex64Schema, Uuidv7Schema } from './types.ts';

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
type OAuthProviderConfig = {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
    readonly redirectUri: string;
    readonly scopes: ReadonlyArray<string>;
};
type OAuthTokens = S.Schema.Type<typeof OAuthTokensSchema>;
type OAuthUserInfo = S.Schema.Type<typeof OAuthUserInfoSchema>;

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

const brandedId = <T extends string>(label: T) => pipe(Uuidv7Schema, S.brand(label));

const ApiKeyIdSchema = brandedId('ApiKeyId');
const AssetIdSchema = brandedId('AssetId');
const UserIdSchema = brandedId('UserId');
const SessionIdSchema = brandedId('SessionId');
const OAuthAccountIdSchema = brandedId('OAuthAccountId');
const RefreshTokenIdSchema = brandedId('RefreshTokenId');
const OrganizationIdSchema = brandedId('OrganizationId');
const OrganizationMemberIdSchema = brandedId('OrganizationMemberId');
const TokenHashSchema = Hex64Schema;
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
    createdAt: S.DateTimeUtc,
    id: ApiKeyIdSchema,
    lastUsedAt: S.OptionFromNullOr(S.DateTimeUtc),
    name: S.NonEmptyTrimmedString,
    provider: AiProviderSchema,
});
const OAuthTokensSchema = S.Struct({
    accessToken: S.String,
    expiresAt: S.OptionFromSelf(S.DateFromSelf),
    refreshToken: S.OptionFromSelf(S.String),
    scope: S.OptionFromSelf(S.String),
});
const OAuthUserInfoSchema = S.Struct({
    avatarUrl: S.OptionFromSelf(S.String),
    email: S.OptionFromSelf(S.String),
    name: S.OptionFromSelf(S.String),
    providerAccountId: S.String,
});

// --- [API_RESPONSES] ---------------------------------------------------------

const OAuthStartResponseSchema = S.Struct({ url: S.String });
const SessionResponseSchema = S.Struct({ accessToken: Uuidv7Schema, expiresAt: S.DateTimeUtc });
const UserResponseSchema = S.Struct({ email: S.String, id: UserIdSchema });
const LogoutResponseSchema = S.Struct({ success: S.Boolean });

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const Expiry = Object.freeze({
    check: (date: Date | null | undefined, bufferMs = Duration.toMillis(B.durations.refreshBuffer)) =>
        date === null || date === undefined
            ? { delayMs: 0, expired: false, shouldRefresh: false }
            : {
                  delayMs: Math.max(0, date.getTime() - Date.now() - bufferMs),
                  expired: date.getTime() < Date.now(),
                  shouldRefresh: date.getTime() - Date.now() - bufferMs <= 0,
              },
    computeFrom: (duration: Duration.Duration): Date => new Date(Date.now() + Duration.toMillis(duration)),
});

// --- [EXPORT] ----------------------------------------------------------------

export {
    AiProviderSchema,
    ApiKeyIdSchema,
    ApiKeyListItemSchema,
    ApiKeyResultSchema,
    AssetCountResultSchema,
    AssetIdSchema,
    AssetListItemSchema,
    AssetMetadataSchema,
    B as SCHEMA_TUNING,
    ColorModeSchema,
    Expiry,
    IntentSchema,
    LogoutResponseSchema,
    OAuthAccountIdSchema,
    OAuthProviderSchema,
    OAuthStartResponseSchema,
    OAuthTokensSchema,
    OAuthUserInfoSchema,
    OrganizationIdSchema,
    OrganizationMemberIdSchema,
    OrganizationRoleSchema,
    OutputModeSchema,
    RefreshTokenIdSchema,
    SessionIdSchema,
    SessionResponseSchema,
    SessionResultSchema,
    TokenHashSchema,
    UserIdSchema,
    UserResponseSchema,
    VersionSchema,
};
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
