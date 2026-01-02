/**
 * Database entity models via @effect/sql Model.Class.
 * Single source of truth for all DB entities.
 */
import '@effect/experimental';
import { Model } from '@effect/sql';
import {
    AiProvider,
    ApiKey as ApiKeyDomain,
    ApiKeyId,
    AssetId,
    AssetType,
    OAuthAccountId,
    OAuthProvider,
    RefreshTokenId,
    Role,
    SessionId,
    User as UserDomain,
    UserId,
    UserUtils,
} from '@parametric-portal/types/database';
import { DurationMs, Hex64 } from '@parametric-portal/types/types';
import { DateTime, Option, Schema as S } from 'effect';

// --- [MODELS] ----------------------------------------------------------------

class Asset extends Model.Class<Asset>('Asset')({
    assetType: AssetType,
    content: S.String,
    createdAt: Model.DateTimeInsertFromDate,
    deletedAt: Model.FieldOption(S.DateTimeUtc),
    id: Model.Generated(AssetId),
    updatedAt: Model.DateTimeUpdateFromDate,
    userId: Model.FieldOption(UserId),
}) {
    get isDeleted(): boolean {
        return Option.isSome(this.deletedAt);
    }
}
class User extends Model.Class<User>('User')({
    createdAt: Model.DateTimeInsertFromDate,
    deletedAt: Model.FieldOption(S.DateTimeUtc),
    email: S.NonEmptyTrimmedString,
    id: Model.Generated(UserId),
    role: Role,
}) {
    get isDeleted(): boolean {
        return Option.isSome(this.deletedAt);
    }
    get emailDomain(): string {
        return UserUtils.emailDomain(this.email);
    }
    hasMinRole(min: typeof Role.Type): boolean {
        return UserUtils.hasMinRole(this.role, min);
    }
    get canManage(): boolean {
        return UserUtils.canManage(this.role);
    }
    get response(): typeof UserDomain.Response.Type {
        return UserDomain.toResponse(this);
    }
}
class ApiKey extends Model.Class<ApiKey>('ApiKey')({
    createdAt: Model.DateTimeInsertFromDate,
    expiresAt: Model.FieldOption(S.DateTimeUtc),
    id: Model.Generated(ApiKeyId),
    keyEncrypted: Model.Sensitive(S.Uint8ArrayFromSelf),
    keyHash: Model.Sensitive(Hex64.schema),
    lastUsedAt: Model.FieldOption(S.DateTimeUtc),
    name: S.NonEmptyTrimmedString,
    provider: AiProvider,
    userId: UserId,
}) {
    get isExpired(): boolean {
        return Option.match(this.expiresAt, {
            onNone: () => false,
            onSome: (exp) => DateTime.lessThan(exp, DateTime.unsafeNow()),
        });
    }
    get hasExpiry(): boolean {
        return Option.isSome(this.expiresAt);
    }
    get wasEverUsed(): boolean {
        return Option.isSome(this.lastUsedAt);
    }
    get response(): ApiKeyDomain {
        return ApiKeyDomain.toResponse(this);
    }
}
class Session extends Model.Class<Session>('Session')({
    createdAt: Model.DateTimeInsertFromDate,
    expiresAt: S.DateTimeUtc,
    id: Model.Generated(SessionId),
    ipAddress: Model.FieldOption(S.String),
    lastActivityAt: Model.DateTimeUpdateFromDate,
    revokedAt: Model.FieldOption(S.DateTimeUtc),
    tokenHash: Model.Sensitive(Hex64.schema),
    userAgent: Model.FieldOption(S.String),
    userId: UserId,
}) {
    get isExpired(): boolean {
        return DateTime.lessThan(this.expiresAt, DateTime.unsafeNow());
    }
    get isRevoked(): boolean {
        return Option.isSome(this.revokedAt);
    }
    get isActive(): boolean {
        return !this.isExpired && !this.isRevoked;
    }
    get timeRemaining(): DurationMs {
        return DurationMs.max(
            DurationMs.zero,
            DurationMs.fromMillis(DateTime.toEpochMillis(this.expiresAt) - Date.now()),
        );
    }
}
class OAuthAccount extends Model.Class<OAuthAccount>('OAuthAccount')({
    accessToken: Model.Sensitive(S.String),
    accessTokenExpiresAt: Model.FieldOption(S.DateTimeUtc),
    createdAt: Model.DateTimeInsertFromDate,
    id: Model.Generated(OAuthAccountId),
    provider: OAuthProvider,
    providerAccountId: S.String,
    refreshToken: Model.FieldOption(Model.Sensitive(S.String)),
    scope: Model.FieldOption(S.String),
    updatedAt: Model.DateTimeUpdateFromDate,
    userId: UserId,
}) {
    get isAccessTokenExpired(): boolean {
        return Option.match(this.accessTokenExpiresAt, {
            onNone: () => false,
            onSome: (exp) => DateTime.lessThan(exp, DateTime.unsafeNow()),
        });
    }
    get hasRefreshToken(): boolean {
        return Option.isSome(this.refreshToken);
    }
}
class RefreshToken extends Model.Class<RefreshToken>('RefreshToken')({
    createdAt: Model.DateTimeInsertFromDate,
    expiresAt: S.DateTimeUtc,
    id: Model.Generated(RefreshTokenId),
    revokedAt: Model.FieldOption(S.DateTimeUtc),
    tokenHash: Model.Sensitive(Hex64.schema),
    userId: UserId,
}) {
    get isExpired(): boolean {
        return DateTime.lessThan(this.expiresAt, DateTime.unsafeNow());
    }
    get isRevoked(): boolean {
        return Option.isSome(this.revokedAt);
    }
    get isActive(): boolean {
        return !this.isExpired && !this.isRevoked;
    }
}

// --- [EXPORT] ----------------------------------------------------------------

export { ApiKey, Asset, OAuthAccount, RefreshToken, Session, User };
