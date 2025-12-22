/**
 * Provide Model.Class entities with auto-generated schema variants.
 * Import @effect/experimental for VariantSchema types required by Model.Class declarations.
 */
import '@effect/experimental';
import { Model } from '@effect/sql';
import {
    ApiKeyIdSchema,
    AssetIdSchema,
    AssetMetadataSchema,
    OAuthAccountIdSchema,
    OAuthProviderSchema,
    OrganizationIdSchema,
    OrganizationMemberIdSchema,
    OrganizationRoleSchema,
    RefreshTokenIdSchema,
    SessionIdSchema,
    type SessionResult,
    UserIdSchema,
} from '@parametric-portal/types/database';
import { Schema as S } from 'effect';

// --- [MODELS] ----------------------------------------------------------------

class Asset extends Model.Class<Asset>('Asset')({
    createdAt: Model.DateTimeInsertFromDate,
    deletedAt: S.OptionFromNullOr(S.DateTimeUtc),
    id: Model.Generated(AssetIdSchema),
    metadata: Model.FieldOption(AssetMetadataSchema),
    prompt: S.NonEmptyTrimmedString,
    svg: S.String,
    updatedAt: Model.DateTimeUpdateFromDate,
    userId: Model.FieldOption(UserIdSchema),
    version: S.Int.pipe(S.nonNegative()),
}) {}

class User extends Model.Class<User>('User')({
    createdAt: Model.DateTimeInsertFromDate,
    deletedAt: S.OptionFromNullOr(S.DateTimeUtc),
    email: S.NonEmptyTrimmedString,
    id: Model.Generated(UserIdSchema),
    version: S.Int.pipe(S.nonNegative()),
}) {}

class ApiKey extends Model.Class<ApiKey>('ApiKey')({
    createdAt: Model.DateTimeInsertFromDate,
    expiresAt: S.OptionFromNullOr(S.DateTimeUtc),
    id: Model.Generated(ApiKeyIdSchema),
    keyHash: Model.Sensitive(S.String),
    lastUsedAt: S.OptionFromNullOr(S.DateTimeUtc),
    name: S.NonEmptyTrimmedString,
    userId: UserIdSchema,
}) {}

class Session extends Model.Class<Session>('Session')({
    createdAt: Model.DateTimeInsertFromDate,
    expiresAt: S.DateTimeUtc,
    id: Model.Generated(SessionIdSchema),
    ipAddress: S.OptionFromNullOr(S.String),
    lastActivityAt: Model.DateTimeUpdateFromDate,
    tokenHash: Model.Sensitive(S.String),
    userAgent: S.OptionFromNullOr(S.String),
    userId: UserIdSchema,
}) {}

class OAuthAccount extends Model.Class<OAuthAccount>('OAuthAccount')({
    accessToken: Model.Sensitive(S.String),
    accessTokenExpiresAt: S.OptionFromNullOr(S.DateTimeUtc),
    createdAt: Model.DateTimeInsertFromDate,
    id: Model.Generated(OAuthAccountIdSchema),
    provider: OAuthProviderSchema,
    providerAccountId: S.String,
    refreshToken: Model.Sensitive(S.OptionFromNullOr(S.String)),
    scope: S.OptionFromNullOr(S.String),
    updatedAt: Model.DateTimeUpdateFromDate,
    userId: UserIdSchema,
}) {}

class RefreshToken extends Model.Class<RefreshToken>('RefreshToken')({
    createdAt: Model.DateTimeInsertFromDate,
    expiresAt: S.DateTimeUtc,
    id: Model.Generated(RefreshTokenIdSchema),
    revokedAt: S.OptionFromNullOr(S.DateTimeUtc),
    tokenHash: Model.Sensitive(S.String),
    userId: UserIdSchema,
}) {}

class Organization extends Model.Class<Organization>('Organization')({
    createdAt: Model.DateTimeInsertFromDate,
    deletedAt: S.OptionFromNullOr(S.DateTimeUtc),
    id: Model.Generated(OrganizationIdSchema),
    name: S.NonEmptyTrimmedString,
    slug: S.NonEmptyTrimmedString,
    updatedAt: Model.DateTimeUpdateFromDate,
    version: S.Int.pipe(S.nonNegative()),
}) {}

class OrganizationMember extends Model.Class<OrganizationMember>('OrganizationMember')({
    createdAt: Model.DateTimeInsertFromDate,
    id: Model.Generated(OrganizationMemberIdSchema),
    organizationId: OrganizationIdSchema,
    role: OrganizationRoleSchema,
    updatedAt: Model.DateTimeUpdateFromDate,
    userId: UserIdSchema,
    version: S.Int.pipe(S.nonNegative()),
}) {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const sessionToResult = (session: typeof Session.Type): SessionResult => ({
    expiresAt: new Date(session.expiresAt.epochMillis),
    sessionId: session.id,
    userId: session.userId,
});

// --- [EXPORT] ----------------------------------------------------------------

export { ApiKey, Asset, OAuthAccount, Organization, OrganizationMember, RefreshToken, Session, sessionToResult, User };
