/**
 * Provide database-specific branded types with unified ID schemas.
 * Single source of truth for all database entity IDs and domain primitives.
 */
import { Duration, pipe, Schema as S } from 'effect';

import { ColorModeSchema, IntentSchema } from './icons.ts';
import type { Email, Slug, Uuidv7 } from './types.ts';
import { EmailSchema, SlugSchema } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type ApiKeyId = S.Schema.Type<typeof ApiKeyIdSchema>;
type AssetId = S.Schema.Type<typeof AssetIdSchema>;
type UserId = S.Schema.Type<typeof UserIdSchema>;
type AssetMetadata = S.Schema.Type<typeof AssetMetadataSchema>;
type SessionId = S.Schema.Type<typeof SessionIdSchema>;
type OAuthAccountId = S.Schema.Type<typeof OAuthAccountIdSchema>;
type RefreshTokenId = S.Schema.Type<typeof RefreshTokenIdSchema>;
type OrganizationId = S.Schema.Type<typeof OrganizationIdSchema>;
type OrganizationMemberId = S.Schema.Type<typeof OrganizationMemberIdSchema>;
type OAuthProvider = S.Schema.Type<typeof OAuthProviderSchema>;
type OrganizationRole = S.Schema.Type<typeof OrganizationRoleSchema>;
type SessionResult = S.Schema.Type<typeof SessionResultSchema>;
type ApiKeyResult = S.Schema.Type<typeof ApiKeyResultSchema>;
type TokenHash = S.Schema.Type<typeof TokenHashSchema>;
type Version = S.Schema.Type<typeof VersionSchema>;
type PaginationParams = S.Schema.Type<typeof PaginationParamsSchema>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    durations: {
        apiKey: Duration.days(365),
        refreshToken: Duration.days(30),
        session: Duration.days(7),
    },
    limits: {
        defaultPageSize: 20,
        maxPageSize: 100,
    },
    patterns: {
        hexHash: /^[0-9a-f]{64}$/i,
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
const TokenHashSchema = pipe(S.String, S.pattern(B.patterns.hexHash), S.brand('TokenHash'));
const VersionSchema = pipe(S.Int, S.nonNegative(), S.brand('Version'));

const PaginationParamsSchema = S.Struct({
    limit: pipe(S.Int, S.between(1, B.limits.maxPageSize)),
    offset: pipe(S.Int, S.nonNegative()),
});

const OAuthProviderSchema = S.Union(S.Literal('google'), S.Literal('github'), S.Literal('microsoft'));
const OrganizationRoleSchema = S.Union(S.Literal('owner'), S.Literal('admin'), S.Literal('member'));

const AssetMetadataSchema = S.Struct({
    colorMode: ColorModeSchema,
    intent: IntentSchema,
});

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

// --- [EXPORT] ----------------------------------------------------------------

export {
    ApiKeyIdSchema,
    ApiKeyResultSchema,
    AssetIdSchema,
    AssetMetadataSchema,
    B as SCHEMA_TUNING,
    EmailSchema,
    OAuthAccountIdSchema,
    OAuthProviderSchema,
    OrganizationIdSchema,
    OrganizationMemberIdSchema,
    OrganizationRoleSchema,
    PaginationParamsSchema,
    RefreshTokenIdSchema,
    SessionIdSchema,
    SessionResultSchema,
    SlugSchema,
    TokenHashSchema,
    UserIdSchema,
    VersionSchema,
};
export type {
    ApiKeyId,
    ApiKeyResult,
    AssetId,
    AssetMetadata,
    Email,
    OAuthAccountId,
    OAuthProvider,
    OrganizationId,
    OrganizationMemberId,
    OrganizationRole,
    PaginationParams,
    RefreshTokenId,
    SessionId,
    SessionResult,
    Slug,
    TokenHash,
    UserId,
    Uuidv7,
    Version,
};
