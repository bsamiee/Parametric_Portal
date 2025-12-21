/**
 * Provide Model.Class entities with auto-generated schema variants.
 */
import { Model } from '@effect/sql';
import { Schema as S } from 'effect';
import { ApiKeyIdSchema, AssetIdSchema, AssetMetadataSchema, UserIdSchema } from './schema.ts';

// --- [MODELS] ----------------------------------------------------------------

class Asset extends Model.Class<Asset>('Asset')({
    createdAt: Model.DateTimeInsertFromDate,
    id: Model.Generated(AssetIdSchema),
    metadata: Model.FieldOption(AssetMetadataSchema),
    prompt: S.NonEmptyTrimmedString,
    svg: S.String,
    updatedAt: Model.DateTimeUpdateFromDate,
    userId: Model.FieldOption(UserIdSchema),
}) {}

class User extends Model.Class<User>('User')({
    apiKeyHash: Model.Sensitive(S.OptionFromNullOr(S.String)),
    createdAt: Model.DateTimeInsertFromDate,
    email: S.NonEmptyTrimmedString,
    id: Model.Generated(UserIdSchema),
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

// --- [EXPORT] ----------------------------------------------------------------

export { ApiKey, Asset, User };
