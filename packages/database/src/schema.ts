/**
 * Re-export database types from @parametric-portal/types for backward compatibility.
 * All type definitions now centralized in packages/types/src/database.ts.
 */

// --- [EXPORT] ----------------------------------------------------------------

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
} from '@parametric-portal/types/database';
// biome-ignore lint/performance/noBarrelFile: Re-export for backward compatibility
export {
    ApiKeyIdSchema,
    ApiKeyResultSchema,
    AssetIdSchema,
    AssetMetadataSchema,
    DATABASE_TYPES_TUNING as SCHEMA_TUNING,
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
} from '@parametric-portal/types/database';
