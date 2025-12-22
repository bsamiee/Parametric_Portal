/**
 * Database entity identifiers and domain schemas.
 * Grounding: Branded UUIDs with domain-specific durations.
 */
import { Duration, pipe, Schema as S } from 'effect';
import type { Hex64 } from './types.ts';
import { Hex64Schema } from './types.ts';

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

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    durations: {
        apiKey: Duration.days(365),
        refreshToken: Duration.days(30),
        session: Duration.days(7),
    },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const uuidBase = S.UUID;
const ApiKeyIdSchema = pipe(uuidBase, S.brand('ApiKeyId'));
const AssetIdSchema = pipe(uuidBase, S.brand('AssetId'));
const UserIdSchema = pipe(uuidBase, S.brand('UserId'));
const SessionIdSchema = pipe(uuidBase, S.brand('SessionId'));
const OAuthAccountIdSchema = pipe(uuidBase, S.brand('OAuthAccountId'));
const RefreshTokenIdSchema = pipe(uuidBase, S.brand('RefreshTokenId'));
const OrganizationIdSchema = pipe(uuidBase, S.brand('OrganizationId'));
const OrganizationMemberIdSchema = pipe(uuidBase, S.brand('OrganizationMemberId'));
const TokenHashSchema = Hex64Schema;
const VersionSchema = pipe(S.Int, S.nonNegative(), S.brand('Version'));

const OAuthProviderSchema = S.Union(S.Literal('google'), S.Literal('github'), S.Literal('microsoft'));
const OrganizationRoleSchema = S.Union(S.Literal('owner'), S.Literal('admin'), S.Literal('member'));

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

// --- [EXPORT] ----------------------------------------------------------------

export {
    ApiKeyIdSchema,
    ApiKeyResultSchema,
    AssetCountResultSchema,
    AssetIdSchema,
    AssetListItemSchema,
    AssetMetadataSchema,
    B as SCHEMA_TUNING,
    ColorModeSchema,
    IntentSchema,
    OAuthAccountIdSchema,
    OAuthProviderSchema,
    OrganizationIdSchema,
    OrganizationMemberIdSchema,
    OrganizationRoleSchema,
    OutputModeSchema,
    RefreshTokenIdSchema,
    SessionIdSchema,
    SessionResultSchema,
    TokenHashSchema,
    UserIdSchema,
    VersionSchema,
};
export type {
    ApiKeyId,
    ApiKeyResult,
    AssetCountResult,
    AssetId,
    AssetListItem,
    AssetMetadata,
    ColorMode,
    Intent,
    OAuthAccountId,
    OAuthProvider,
    OrganizationId,
    OrganizationMemberId,
    OrganizationRole,
    OutputMode,
    RefreshTokenId,
    SessionId,
    SessionResult,
    TokenHash,
    UserId,
    Version,
};
