/**
 * Consolidated repository factory with SqlSchema-based resolvers.
 * Single Effect.gen yields SqlClient once; all resolvers defined inline.
 */
import { SqlClient, SqlSchema } from '@effect/sql';
import { Effect, Schema as S } from 'effect';

import { ApiKey, Asset, OAuthAccount, Organization, OrganizationMember, RefreshToken, Session, User } from './models';
import {
    ApiKeyIdSchema,
    AssetIdSchema,
    OAuthProviderSchema,
    OrganizationIdSchema,
    OrganizationMemberIdSchema,
    OrganizationRoleSchema,
    RefreshTokenIdSchema,
    SessionIdSchema,
    UserIdSchema,
} from './schema';

// --- [SCHEMA] ----------------------------------------------------------------

const InsertSession = S.Struct({ expiresAt: S.DateFromSelf, tokenHash: S.String, userId: UserIdSchema });
const InsertRefreshToken = S.Struct({ expiresAt: S.DateFromSelf, tokenHash: S.String, userId: UserIdSchema });
const InsertApiKey = S.Struct({
    expiresAt: S.NullOr(S.DateFromSelf),
    keyHash: S.String,
    name: S.NonEmptyTrimmedString,
    userId: UserIdSchema,
});
const InsertAsset = S.Struct({ prompt: S.NonEmptyTrimmedString, svg: S.String, userId: UserIdSchema });
const InsertOrganization = S.Struct({ name: S.NonEmptyTrimmedString, slug: S.NonEmptyTrimmedString });
const InsertOrganizationMember = S.Struct({
    organizationId: OrganizationIdSchema,
    role: OrganizationRoleSchema,
    userId: UserIdSchema,
});
const UpsertOAuthAccount = S.Struct({
    accessToken: S.String,
    expiresAt: S.NullOr(S.DateFromSelf),
    provider: OAuthProviderSchema,
    providerAccountId: S.String,
    refreshToken: S.NullOr(S.String),
    userId: UserIdSchema,
});
const AssetListItem = S.Struct({ id: AssetIdSchema, prompt: S.NonEmptyTrimmedString });
const AssetCountResult = S.Struct({ count: S.NumberFromString });
const FindAssetsByUserIdParams = S.Struct({
    limit: S.Int,
    offset: S.Int,
    userId: UserIdSchema,
});
const UpdateAssetWithVersion = S.Struct({
    expectedVersion: S.Int,
    id: AssetIdSchema,
    prompt: S.NonEmptyTrimmedString,
    svg: S.String,
});
const UpdateUserWithVersion = S.Struct({
    email: S.NonEmptyTrimmedString,
    expectedVersion: S.Int,
    id: UserIdSchema,
});
const UpdateOrganization = S.Struct({
    expectedVersion: S.Int,
    id: OrganizationIdSchema,
    name: S.NonEmptyTrimmedString,
    slug: S.NonEmptyTrimmedString,
});
const UpdateOrgMemberWithVersion = S.Struct({
    expectedVersion: S.Int,
    id: OrganizationMemberIdSchema,
    role: OrganizationRoleSchema,
});
const OAuthAccountIdSchema = S.Struct({ provider: OAuthProviderSchema, providerAccountId: S.String });

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    tables: {
        apiKeys: 'api_keys',
        assets: 'assets',
        oauthAccounts: 'oauth_accounts',
        organizationMembers: 'organization_members',
        organizations: 'organizations',
        refreshTokens: 'refresh_tokens',
        sessions: 'sessions',
        users: 'users',
    },
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const makeRepositories = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return {
        apiKeys: {
            delete: SqlSchema.void({
                execute: (id) => sql`DELETE FROM ${sql(B.tables.apiKeys)} WHERE id = ${id}`,
                Request: ApiKeyIdSchema,
            }),
            findAllByUserId: SqlSchema.findAll({
                execute: (userId) =>
                    sql`SELECT * FROM ${sql(B.tables.apiKeys)} WHERE user_id = ${userId} ORDER BY created_at DESC`,
                Request: UserIdSchema,
                Result: ApiKey,
            }),
            findValidByKeyHash: SqlSchema.findOne({
                execute: (keyHash) =>
                    sql`SELECT * FROM ${sql(B.tables.apiKeys)} WHERE key_hash = ${keyHash} AND (expires_at IS NULL OR expires_at > now())`,
                Request: S.String,
                Result: ApiKey,
            }),
            insert: SqlSchema.single({
                execute: (data) =>
                    sql`INSERT INTO ${sql(B.tables.apiKeys)} (user_id, name, key_hash, expires_at) VALUES (${data.userId}, ${data.name}, ${data.keyHash}, ${data.expiresAt}) RETURNING *`,
                Request: InsertApiKey,
                Result: ApiKey,
            }),
            updateLastUsed: SqlSchema.void({
                execute: (id) => sql`UPDATE ${sql(B.tables.apiKeys)} SET last_used_at = now() WHERE id = ${id}`,
                Request: ApiKeyIdSchema,
            }),
        },
        assets: {
            countActiveByUserId: SqlSchema.single({
                execute: (userId) =>
                    sql`SELECT COUNT(*)::text as count FROM ${sql(B.tables.assets)} WHERE user_id = ${userId} AND deleted_at IS NULL`,
                Request: UserIdSchema,
                Result: AssetCountResult,
            }),
            countByUserId: SqlSchema.single({
                execute: (userId) =>
                    sql`SELECT COUNT(*)::text as count FROM ${sql(B.tables.assets)} WHERE user_id = ${userId}`,
                Request: UserIdSchema,
                Result: AssetCountResult,
            }),
            findAllActiveByUserId: SqlSchema.findAll({
                execute: (params) =>
                    sql`SELECT id, prompt FROM ${sql(B.tables.assets)} WHERE user_id = ${params.userId} AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ${params.limit} OFFSET ${params.offset}`,
                Request: FindAssetsByUserIdParams,
                Result: AssetListItem,
            }),
            findAllByUserId: SqlSchema.findAll({
                execute: (params) =>
                    sql`SELECT id, prompt FROM ${sql(B.tables.assets)} WHERE user_id = ${params.userId} ORDER BY created_at DESC LIMIT ${params.limit} OFFSET ${params.offset}`,
                Request: FindAssetsByUserIdParams,
                Result: AssetListItem,
            }),
            findById: SqlSchema.findOne({
                execute: (id) => sql`SELECT * FROM ${sql(B.tables.assets)} WHERE id = ${id}`,
                Request: AssetIdSchema,
                Result: Asset,
            }),
            insert: SqlSchema.single({
                execute: (data) =>
                    sql`INSERT INTO ${sql(B.tables.assets)} (user_id, prompt, svg) VALUES (${data.userId}, ${data.prompt}, ${data.svg}) RETURNING *`,
                Request: InsertAsset,
                Result: Asset,
            }),
            restore: SqlSchema.void({
                execute: (id) =>
                    sql`UPDATE ${sql(B.tables.assets)} SET deleted_at = NULL, updated_at = now() WHERE id = ${id}`,
                Request: AssetIdSchema,
            }),
            softDelete: SqlSchema.void({
                execute: (id) =>
                    sql`UPDATE ${sql(B.tables.assets)} SET deleted_at = now(), updated_at = now() WHERE id = ${id}`,
                Request: AssetIdSchema,
            }),
            updateWithVersion: SqlSchema.void({
                execute: (data) =>
                    sql`UPDATE ${sql(B.tables.assets)} SET prompt = ${data.prompt}, svg = ${data.svg}, version = version + 1, updated_at = now() WHERE id = ${data.id} AND version = ${data.expectedVersion}`,
                Request: UpdateAssetWithVersion,
            }),
        },
        oauthAccounts: {
            delete: SqlSchema.void({
                execute: (data) =>
                    sql`DELETE FROM ${sql(B.tables.oauthAccounts)} WHERE provider = ${data.provider} AND provider_account_id = ${data.providerAccountId}`,
                Request: OAuthAccountIdSchema,
            }),
            findAllByUserId: SqlSchema.findAll({
                execute: (userId) => sql`SELECT * FROM ${sql(B.tables.oauthAccounts)} WHERE user_id = ${userId}`,
                Request: UserIdSchema,
                Result: OAuthAccount,
            }),
            findByProviderAccountId: SqlSchema.findOne({
                execute: (data) =>
                    sql`SELECT * FROM ${sql(B.tables.oauthAccounts)} WHERE provider = ${data.provider} AND provider_account_id = ${data.providerAccountId}`,
                Request: S.Struct({ provider: OAuthProviderSchema, providerAccountId: S.String }),
                Result: OAuthAccount,
            }),
            upsert: SqlSchema.void({
                execute: (data) =>
                    sql`INSERT INTO ${sql(B.tables.oauthAccounts)} (user_id, provider, provider_account_id, access_token, refresh_token, access_token_expires_at)
                        VALUES (${data.userId}, ${data.provider}, ${data.providerAccountId}, ${data.accessToken}, ${data.refreshToken}, ${data.expiresAt})
                        ON CONFLICT (provider, provider_account_id)
                        DO UPDATE SET access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, updated_at = now()`,
                Request: UpsertOAuthAccount,
            }),
        },
        organizationMembers: {
            delete: SqlSchema.void({
                execute: (id) => sql`DELETE FROM ${sql(B.tables.organizationMembers)} WHERE id = ${id}`,
                Request: OrganizationMemberIdSchema,
            }),
            findAllByOrganizationId: SqlSchema.findAll({
                execute: (orgId) =>
                    sql`SELECT * FROM ${sql(B.tables.organizationMembers)} WHERE organization_id = ${orgId}`,
                Request: OrganizationIdSchema,
                Result: OrganizationMember,
            }),
            findAllByUserId: SqlSchema.findAll({
                execute: (userId) => sql`SELECT * FROM ${sql(B.tables.organizationMembers)} WHERE user_id = ${userId}`,
                Request: UserIdSchema,
                Result: OrganizationMember,
            }),
            findByOrgAndUser: SqlSchema.findOne({
                execute: (data) =>
                    sql`SELECT * FROM ${sql(B.tables.organizationMembers)} WHERE organization_id = ${data.organizationId} AND user_id = ${data.userId}`,
                Request: S.Struct({ organizationId: OrganizationIdSchema, userId: UserIdSchema }),
                Result: OrganizationMember,
            }),
            insert: SqlSchema.single({
                execute: (data) =>
                    sql`INSERT INTO ${sql(B.tables.organizationMembers)} (organization_id, user_id, role) VALUES (${data.organizationId}, ${data.userId}, ${data.role}) RETURNING *`,
                Request: InsertOrganizationMember,
                Result: OrganizationMember,
            }),
            updateRole: SqlSchema.void({
                execute: (data) =>
                    sql`UPDATE ${sql(B.tables.organizationMembers)} SET role = ${data.role}, updated_at = now() WHERE id = ${data.id}`,
                Request: S.Struct({ id: OrganizationMemberIdSchema, role: OrganizationRoleSchema }),
            }),
            updateWithVersion: SqlSchema.void({
                execute: (data) =>
                    sql`UPDATE ${sql(B.tables.organizationMembers)} SET role = ${data.role}, version = version + 1, updated_at = now() WHERE id = ${data.id} AND version = ${data.expectedVersion}`,
                Request: UpdateOrgMemberWithVersion,
            }),
        },
        organizations: {
            findAllActiveByUserId: SqlSchema.findAll({
                execute: (userId) =>
                    sql`SELECT o.* FROM ${sql(B.tables.organizations)} o
                        JOIN ${sql(B.tables.organizationMembers)} m ON o.id = m.organization_id
                        WHERE m.user_id = ${userId} AND o.deleted_at IS NULL`,
                Request: UserIdSchema,
                Result: Organization,
            }),
            findById: SqlSchema.findOne({
                execute: (id) => sql`SELECT * FROM ${sql(B.tables.organizations)} WHERE id = ${id}`,
                Request: OrganizationIdSchema,
                Result: Organization,
            }),
            findBySlug: SqlSchema.findOne({
                execute: (slug) => sql`SELECT * FROM ${sql(B.tables.organizations)} WHERE slug = ${slug}`,
                Request: S.NonEmptyTrimmedString,
                Result: Organization,
            }),
            insert: SqlSchema.single({
                execute: (data) =>
                    sql`INSERT INTO ${sql(B.tables.organizations)} (name, slug) VALUES (${data.name}, ${data.slug}) RETURNING *`,
                Request: InsertOrganization,
                Result: Organization,
            }),
            restore: SqlSchema.void({
                execute: (id) =>
                    sql`UPDATE ${sql(B.tables.organizations)} SET deleted_at = NULL, updated_at = now() WHERE id = ${id}`,
                Request: OrganizationIdSchema,
            }),
            softDelete: SqlSchema.void({
                execute: (id) =>
                    sql`UPDATE ${sql(B.tables.organizations)} SET deleted_at = now(), updated_at = now() WHERE id = ${id}`,
                Request: OrganizationIdSchema,
            }),
            updateWithVersion: SqlSchema.void({
                execute: (data) =>
                    sql`UPDATE ${sql(B.tables.organizations)} SET name = ${data.name}, slug = ${data.slug}, version = version + 1, updated_at = now() WHERE id = ${data.id} AND version = ${data.expectedVersion}`,
                Request: UpdateOrganization,
            }),
        },
        refreshTokens: {
            findValidByTokenHash: SqlSchema.findOne({
                execute: (tokenHash) =>
                    sql`SELECT * FROM ${sql(B.tables.refreshTokens)} WHERE token_hash = ${tokenHash} AND expires_at > now() AND revoked_at IS NULL`,
                Request: S.String,
                Result: RefreshToken,
            }),
            insert: SqlSchema.void({
                execute: (data) =>
                    sql`INSERT INTO ${sql(B.tables.refreshTokens)} (user_id, token_hash, expires_at) VALUES (${data.userId}, ${data.tokenHash}, ${data.expiresAt})`,
                Request: InsertRefreshToken,
            }),
            revoke: SqlSchema.void({
                execute: (id) => sql`UPDATE ${sql(B.tables.refreshTokens)} SET revoked_at = now() WHERE id = ${id}`,
                Request: RefreshTokenIdSchema,
            }),
            revokeAllByUserId: SqlSchema.void({
                execute: (userId) =>
                    sql`UPDATE ${sql(B.tables.refreshTokens)} SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`,
                Request: UserIdSchema,
            }),
        },
        sessions: {
            delete: SqlSchema.void({
                execute: (id) => sql`DELETE FROM ${sql(B.tables.sessions)} WHERE id = ${id}`,
                Request: SessionIdSchema,
            }),
            deleteAllByUserId: SqlSchema.void({
                execute: (userId) => sql`DELETE FROM ${sql(B.tables.sessions)} WHERE user_id = ${userId}`,
                Request: UserIdSchema,
            }),
            findByTokenHash: SqlSchema.findOne({
                execute: (tokenHash) =>
                    sql`SELECT * FROM ${sql(B.tables.sessions)} WHERE token_hash = ${tokenHash} AND expires_at > now()`,
                Request: S.String,
                Result: Session,
            }),
            insert: SqlSchema.void({
                execute: (data) =>
                    sql`INSERT INTO ${sql(B.tables.sessions)} (user_id, token_hash, expires_at) VALUES (${data.userId}, ${data.tokenHash}, ${data.expiresAt})`,
                Request: InsertSession,
            }),
        },
        users: {
            findActiveByEmail: SqlSchema.findOne({
                execute: (email) =>
                    sql`SELECT * FROM ${sql(B.tables.users)} WHERE email = ${email} AND deleted_at IS NULL`,
                Request: S.NonEmptyTrimmedString,
                Result: User,
            }),
            findByEmail: SqlSchema.findOne({
                execute: (email) => sql`SELECT * FROM ${sql(B.tables.users)} WHERE email = ${email}`,
                Request: S.NonEmptyTrimmedString,
                Result: User,
            }),
            findById: SqlSchema.findOne({
                execute: (id) => sql`SELECT * FROM ${sql(B.tables.users)} WHERE id = ${id}`,
                Request: UserIdSchema,
                Result: User,
            }),
            insert: SqlSchema.single({
                execute: (data) => sql`INSERT INTO ${sql(B.tables.users)} (email) VALUES (${data.email}) RETURNING *`,
                Request: S.Struct({ email: S.NonEmptyTrimmedString }),
                Result: User,
            }),
            restore: SqlSchema.void({
                execute: (id) => sql`UPDATE ${sql(B.tables.users)} SET deleted_at = NULL WHERE id = ${id}`,
                Request: UserIdSchema,
            }),
            softDelete: SqlSchema.void({
                execute: (id) => sql`UPDATE ${sql(B.tables.users)} SET deleted_at = now() WHERE id = ${id}`,
                Request: UserIdSchema,
            }),
            updateWithVersion: SqlSchema.void({
                execute: (data) =>
                    sql`UPDATE ${sql(B.tables.users)} SET email = ${data.email}, version = version + 1 WHERE id = ${data.id} AND version = ${data.expectedVersion}`,
                Request: UpdateUserWithVersion,
            }),
        },
        withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => sql.withTransaction(effect),
    };
});

// --- [EXPORT] ----------------------------------------------------------------

export { AssetListItem, B as REPOSITORY_TUNING, makeRepositories };
