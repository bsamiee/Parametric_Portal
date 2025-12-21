/**
 * Provide branded domain types for database entities.
 * Single source of truth for all ID schemas and result schemas.
 */
import { Duration, pipe, Schema as S } from 'effect';

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
type Email = S.Schema.Type<typeof EmailSchema>;
type Slug = S.Schema.Type<typeof SlugSchema>;
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
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        hexHash: /^[0-9a-f]+$/i,
        slug: /^[a-z0-9-]+$/,
        uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const uuidBase = pipe(S.String, S.pattern(B.patterns.uuid));
const ApiKeyIdSchema = pipe(uuidBase, S.brand('ApiKeyId'));
const AssetIdSchema = pipe(uuidBase, S.brand('AssetId'));
const UserIdSchema = pipe(uuidBase, S.brand('UserId'));
const SessionIdSchema = pipe(uuidBase, S.brand('SessionId'));
const OAuthAccountIdSchema = pipe(uuidBase, S.brand('OAuthAccountId'));
const RefreshTokenIdSchema = pipe(uuidBase, S.brand('RefreshTokenId'));
const OrganizationIdSchema = pipe(uuidBase, S.brand('OrganizationId'));
const OrganizationMemberIdSchema = pipe(uuidBase, S.brand('OrganizationMemberId'));
const TokenHashSchema = pipe(S.String, S.pattern(B.patterns.hexHash), S.brand('TokenHash'));
const EmailSchema = pipe(S.NonEmptyTrimmedString, S.pattern(B.patterns.email), S.brand('Email'));
const SlugSchema = pipe(S.NonEmptyTrimmedString, S.pattern(B.patterns.slug), S.brand('Slug'));
const VersionSchema = pipe(S.Int, S.nonNegative(), S.brand('Version'));

// Pagination schema (reusable)
const PaginationParamsSchema = S.Struct({
    limit: pipe(S.Int, S.between(1, B.limits.maxPageSize)),
    offset: pipe(S.Int, S.nonNegative()),
});

// Enum schemas (discriminated values)
const OAuthProviderSchema = S.Union(S.Literal('google'), S.Literal('github'), S.Literal('microsoft'));
const OrganizationRoleSchema = S.Union(S.Literal('owner'), S.Literal('admin'), S.Literal('member'));

// Composite schemas (structured data)
const AssetMetadataSchema = S.Struct({
    colorMode: S.Literal('light', 'dark'),
    intent: S.Literal('create', 'refine'),
});

// Result schemas for middleware/API boundaries (fully typed)
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
    EmailSchema,
    OAuthAccountIdSchema,
    OAuthProviderSchema,
    OrganizationIdSchema,
    OrganizationMemberIdSchema,
    OrganizationRoleSchema,
    PaginationParamsSchema,
    RefreshTokenIdSchema,
    B as SCHEMA_TUNING,
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
    Version,
};
