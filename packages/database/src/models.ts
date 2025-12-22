/**
 * Provide Model.Class entities with auto-generated schema variants.
 * Import @effect/experimental for VariantSchema types required by Model.Class declarations.
 */
import '@effect/experimental';
import { Model } from '@effect/sql';
import { type SessionResult, schemas } from '@parametric-portal/types/database';
import { DateTime, Schema as S } from 'effect';

// --- [MODELS] ----------------------------------------------------------------

class Asset extends Model.Class<Asset>('Asset')({
    createdAt: Model.DateTimeInsertFromDate,
    deletedAt: S.OptionFromNullOr(S.DateTimeUtc),
    id: Model.Generated(schemas.AssetId),
    metadata: Model.FieldOption(schemas.AssetMetadata),
    prompt: S.NonEmptyTrimmedString,
    svg: S.String,
    updatedAt: Model.DateTimeUpdateFromDate,
    userId: Model.FieldOption(schemas.UserId),
    version: S.Int.pipe(S.nonNegative()),
}) {}

class User extends Model.Class<User>('User')({
    createdAt: Model.DateTimeInsertFromDate,
    deletedAt: S.OptionFromNullOr(S.DateTimeUtc),
    email: S.NonEmptyTrimmedString,
    id: Model.Generated(schemas.UserId),
    version: S.Int.pipe(S.nonNegative()),
}) {}

class ApiKey extends Model.Class<ApiKey>('ApiKey')({
    createdAt: Model.DateTimeInsertFromDate,
    expiresAt: S.OptionFromNullOr(S.DateTimeUtc),
    id: Model.Generated(schemas.ApiKeyId),
    keyHash: Model.Sensitive(S.String),
    lastUsedAt: S.OptionFromNullOr(S.DateTimeUtc),
    name: S.NonEmptyTrimmedString,
    userId: schemas.UserId,
}) {}

class Session extends Model.Class<Session>('Session')({
    createdAt: Model.DateTimeInsertFromDate,
    expiresAt: S.DateTimeUtc,
    id: Model.Generated(schemas.SessionId),
    ipAddress: S.OptionFromNullOr(S.String),
    lastActivityAt: Model.DateTimeUpdateFromDate,
    tokenHash: Model.Sensitive(S.String),
    userAgent: S.OptionFromNullOr(S.String),
    userId: schemas.UserId,
}) {}

class OAuthAccount extends Model.Class<OAuthAccount>('OAuthAccount')({
    accessToken: Model.Sensitive(S.String),
    accessTokenExpiresAt: S.OptionFromNullOr(S.DateTimeUtc),
    createdAt: Model.DateTimeInsertFromDate,
    id: Model.Generated(schemas.OAuthAccountId),
    provider: schemas.OAuthProvider,
    providerAccountId: S.String,
    refreshToken: Model.Sensitive(S.OptionFromNullOr(S.String)),
    scope: S.OptionFromNullOr(S.String),
    updatedAt: Model.DateTimeUpdateFromDate,
    userId: schemas.UserId,
}) {}

class RefreshToken extends Model.Class<RefreshToken>('RefreshToken')({
    createdAt: Model.DateTimeInsertFromDate,
    expiresAt: S.DateTimeUtc,
    id: Model.Generated(schemas.RefreshTokenId),
    revokedAt: S.OptionFromNullOr(S.DateTimeUtc),
    tokenHash: Model.Sensitive(S.String),
    userId: schemas.UserId,
}) {}

class Organization extends Model.Class<Organization>('Organization')({
    createdAt: Model.DateTimeInsertFromDate,
    deletedAt: S.OptionFromNullOr(S.DateTimeUtc),
    id: Model.Generated(schemas.OrganizationId),
    name: S.NonEmptyTrimmedString,
    slug: S.NonEmptyTrimmedString,
    updatedAt: Model.DateTimeUpdateFromDate,
    version: S.Int.pipe(S.nonNegative()),
}) {}

class OrganizationMember extends Model.Class<OrganizationMember>('OrganizationMember')({
    createdAt: Model.DateTimeInsertFromDate,
    id: Model.Generated(schemas.OrganizationMemberId),
    organizationId: schemas.OrganizationId,
    role: schemas.OrganizationRole,
    updatedAt: Model.DateTimeUpdateFromDate,
    userId: schemas.UserId,
    version: S.Int.pipe(S.nonNegative()),
}) {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const sessionToResult = (session: typeof Session.Type): SessionResult => ({
    expiresAt: DateTime.toDateUtc(session.expiresAt),
    sessionId: session.id,
    userId: session.userId,
});

// --- [EXPORT] ----------------------------------------------------------------

export { ApiKey, Asset, OAuthAccount, Organization, OrganizationMember, RefreshToken, Session, sessionToResult, User };
