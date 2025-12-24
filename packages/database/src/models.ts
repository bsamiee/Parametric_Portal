/**
 * Provide Model.Class entities with auto-generated schema variants.
 * Import @effect/experimental for VariantSchema types required by Model.Class declarations.
 */
import '@effect/experimental';
import { Model } from '@effect/sql';
import { database, type SessionResult } from '@parametric-portal/types/database';
import { DateTime, Schema as S } from 'effect';

const db = database();

// --- [MODELS] ----------------------------------------------------------------

class Asset extends Model.Class<Asset>('Asset')({
    createdAt: Model.DateTimeInsertFromDate,
    deletedAt: S.OptionFromNullOr(S.DateTimeUtc),
    id: Model.Generated(db.schemas.ids.AssetId),
    metadata: Model.FieldOption(db.schemas.entities.AssetMetadata),
    prompt: S.NonEmptyTrimmedString,
    svg: S.String,
    updatedAt: Model.DateTimeUpdateFromDate,
    userId: Model.FieldOption(db.schemas.ids.UserId),
    version: db.schemas.entities.Version,
}) {}
class User extends Model.Class<User>('User')({
    createdAt: Model.DateTimeInsertFromDate,
    deletedAt: S.OptionFromNullOr(S.DateTimeUtc),
    email: S.NonEmptyTrimmedString,
    id: Model.Generated(db.schemas.ids.UserId),
    version: db.schemas.entities.Version,
}) {}
class ApiKey extends Model.Class<ApiKey>('ApiKey')({
    createdAt: Model.DateTimeInsertFromDate,
    expiresAt: S.OptionFromNullOr(S.DateTimeUtc),
    id: Model.Generated(db.schemas.ids.ApiKeyId),
    keyEncrypted: Model.Sensitive(S.OptionFromNullOr(S.Uint8ArrayFromSelf)),
    keyHash: Model.Sensitive(db.schemas.entities.TokenHash),
    lastUsedAt: S.OptionFromNullOr(S.DateTimeUtc),
    name: S.NonEmptyTrimmedString,
    provider: db.schemas.entities.AiProvider,
    userId: db.schemas.ids.UserId,
}) {}
class Session extends Model.Class<Session>('Session')({
    createdAt: Model.DateTimeInsertFromDate,
    expiresAt: S.DateTimeUtc,
    id: Model.Generated(db.schemas.ids.SessionId),
    ipAddress: S.OptionFromNullOr(S.String),
    lastActivityAt: Model.DateTimeUpdateFromDate,
    revokedAt: S.OptionFromNullOr(S.DateTimeUtc),
    tokenHash: Model.Sensitive(db.schemas.entities.TokenHash),
    userAgent: S.OptionFromNullOr(S.String),
    userId: db.schemas.ids.UserId,
}) {}
class OAuthAccount extends Model.Class<OAuthAccount>('OAuthAccount')({
    accessToken: Model.Sensitive(S.String),
    accessTokenExpiresAt: S.OptionFromNullOr(S.DateTimeUtc),
    createdAt: Model.DateTimeInsertFromDate,
    id: Model.Generated(db.schemas.ids.OAuthAccountId),
    provider: db.schemas.entities.OAuthProvider,
    providerAccountId: S.String,
    refreshToken: Model.Sensitive(S.OptionFromNullOr(S.String)),
    scope: S.OptionFromNullOr(S.String),
    updatedAt: Model.DateTimeUpdateFromDate,
    userId: db.schemas.ids.UserId,
}) {}
class RefreshToken extends Model.Class<RefreshToken>('RefreshToken')({
    createdAt: Model.DateTimeInsertFromDate,
    expiresAt: S.DateTimeUtc,
    id: Model.Generated(db.schemas.ids.RefreshTokenId),
    revokedAt: S.OptionFromNullOr(S.DateTimeUtc),
    tokenHash: Model.Sensitive(db.schemas.entities.TokenHash),
    userId: db.schemas.ids.UserId,
}) {}
class Organization extends Model.Class<Organization>('Organization')({
    createdAt: Model.DateTimeInsertFromDate,
    deletedAt: S.OptionFromNullOr(S.DateTimeUtc),
    id: Model.Generated(db.schemas.ids.OrganizationId),
    name: S.NonEmptyTrimmedString,
    slug: S.NonEmptyTrimmedString,
    updatedAt: Model.DateTimeUpdateFromDate,
    version: db.schemas.entities.Version,
}) {}
class OrganizationMember extends Model.Class<OrganizationMember>('OrganizationMember')({
    createdAt: Model.DateTimeInsertFromDate,
    id: Model.Generated(db.schemas.ids.OrganizationMemberId),
    organizationId: db.schemas.ids.OrganizationId,
    role: db.schemas.entities.OrganizationRole,
    updatedAt: Model.DateTimeUpdateFromDate,
    userId: db.schemas.ids.UserId,
    version: db.schemas.entities.Version,
}) {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const sessionToResult = (session: typeof Session.Type): SessionResult => ({
    expiresAt: DateTime.toDateUtc(session.expiresAt),
    sessionId: session.id,
    userId: session.userId,
});

// --- [EXPORT] ----------------------------------------------------------------

export { ApiKey, Asset, OAuthAccount, Organization, OrganizationMember, RefreshToken, Session, sessionToResult, User };
