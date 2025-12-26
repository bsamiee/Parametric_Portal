/**
 * Consolidated repository factory with SqlSchema-based resolvers.
 * Single Effect.gen yields SqlClient once; all resolvers defined inline.
 */
import { SqlClient, SqlSchema } from '@effect/sql';
import { database } from '@parametric-portal/types/database';
import { Effect, Schema as S } from 'effect';
import { ApiKey, Asset, OAuthAccount, Organization, OrganizationMember, RefreshToken, Session, User } from './models';

const db = database();

// --- [SCHEMA] ----------------------------------------------------------------

const InsertSession = S.Struct({
    expiresAt: S.DateFromSelf,
    tokenHash: db.schemas.entities.TokenHash,
    userId: db.schemas.ids.UserId,
});
const InsertRefreshToken = S.Struct({
    expiresAt: S.DateFromSelf,
    tokenHash: db.schemas.entities.TokenHash,
    userId: db.schemas.ids.UserId,
});
const InsertApiKey = S.Struct({
    expiresAt: S.NullOr(S.DateFromSelf),
    keyEncrypted: S.Uint8ArrayFromSelf,
    keyHash: db.schemas.entities.TokenHash,
    name: S.NonEmptyTrimmedString,
    provider: db.schemas.entities.AiProvider,
    userId: db.schemas.ids.UserId,
});
const FindApiKeyByUserProvider = S.Struct({ provider: db.schemas.entities.AiProvider, userId: db.schemas.ids.UserId });
const FindApiKeyByIdAndUserId = S.Struct({ id: db.schemas.ids.ApiKeyId, userId: db.schemas.ids.UserId });
const InsertAsset = S.Struct({ prompt: S.NonEmptyTrimmedString, svg: S.String, userId: db.schemas.ids.UserId });
const InsertOrganization = S.Struct({ name: S.NonEmptyTrimmedString, slug: S.NonEmptyTrimmedString });
const InsertOrganizationMember = S.Struct({
    organizationId: db.schemas.ids.OrganizationId,
    role: db.schemas.entities.OrganizationRole,
    userId: db.schemas.ids.UserId,
});
const UpsertOAuthAccount = S.Struct({
    accessToken: S.String,
    expiresAt: S.NullOr(S.DateFromSelf),
    provider: db.schemas.entities.OAuthProvider,
    providerAccountId: S.String,
    refreshToken: S.NullOr(S.String),
    userId: db.schemas.ids.UserId,
});
const FindAssetsByUserIdParams = S.Struct({
    limit: S.Int,
    offset: S.Int,
    userId: db.schemas.ids.UserId,
});
const UpdateAssetWithVersion = S.Struct({
    expectedVersion: db.schemas.entities.Version,
    id: db.schemas.ids.AssetId,
    prompt: S.NonEmptyTrimmedString,
    svg: S.String,
});
const UpdateUserWithVersion = S.Struct({
    email: S.NonEmptyTrimmedString,
    expectedVersion: db.schemas.entities.Version,
    id: db.schemas.ids.UserId,
});
const UpdateOrganization = S.Struct({
    expectedVersion: db.schemas.entities.Version,
    id: db.schemas.ids.OrganizationId,
    name: S.NonEmptyTrimmedString,
    slug: S.NonEmptyTrimmedString,
});
const UpdateOrgMemberWithVersion = S.Struct({
    expectedVersion: db.schemas.entities.Version,
    id: db.schemas.ids.OrganizationMemberId,
    role: db.schemas.entities.OrganizationRole,
});
const DeleteOAuthAccountParams = S.Struct({ provider: db.schemas.entities.OAuthProvider, providerAccountId: S.String });

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
                Request: db.schemas.ids.ApiKeyId,
            }),
            findAllByUserId: SqlSchema.findAll({
                execute: (userId) =>
                    sql`SELECT id, name, provider, last_used_at, created_at FROM ${sql(B.tables.apiKeys)} WHERE user_id = ${userId} ORDER BY created_at DESC`,
                Request: db.schemas.ids.UserId,
                Result: db.schemas.entities.ApiKeyListItem,
            }),
            findByIdAndUserId: SqlSchema.findOne({
                execute: ({ id, userId }) =>
                    sql`SELECT * FROM ${sql(B.tables.apiKeys)} WHERE id = ${id} AND user_id = ${userId}`,
                Request: FindApiKeyByIdAndUserId,
                Result: ApiKey.select,
            }),
            findByUserIdAndProvider: SqlSchema.findOne({
                execute: ({ userId, provider }) =>
                    sql`SELECT * FROM ${sql(B.tables.apiKeys)} WHERE user_id = ${userId} AND provider = ${provider} AND (expires_at IS NULL OR expires_at > now())`,
                Request: FindApiKeyByUserProvider,
                Result: ApiKey.select,
            }),
            findValidByKeyHash: SqlSchema.findOne({
                execute: (keyHash) =>
                    sql`SELECT * FROM ${sql(B.tables.apiKeys)} WHERE key_hash = ${keyHash} AND (expires_at IS NULL OR expires_at > now())`,
                Request: db.schemas.entities.TokenHash,
                Result: ApiKey.select,
            }),
            insert: SqlSchema.single({
                execute: ({ userId, name, keyHash, expiresAt, provider, keyEncrypted }) =>
                    sql`INSERT INTO ${sql(B.tables.apiKeys)} (user_id, name, key_hash, expires_at, provider, key_encrypted) VALUES (${userId}, ${name}, ${keyHash}, ${expiresAt}, ${provider}, ${keyEncrypted}) RETURNING *`,
                Request: InsertApiKey,
                Result: ApiKey.select,
            }),
            updateLastUsed: SqlSchema.void({
                execute: (id) => sql`UPDATE ${sql(B.tables.apiKeys)} SET last_used_at = now() WHERE id = ${id}`,
                Request: db.schemas.ids.ApiKeyId,
            }),
        },
        assets: {
            countActiveByUserId: SqlSchema.single({
                execute: (userId) =>
                    sql`SELECT COUNT(*)::text as count FROM ${sql(B.tables.assets)} WHERE user_id = ${userId} AND deleted_at IS NULL`,
                Request: db.schemas.ids.UserId,
                Result: db.schemas.entities.AssetCountResult,
            }),
            countByUserId: SqlSchema.single({
                execute: (userId) =>
                    sql`SELECT COUNT(*)::text as count FROM ${sql(B.tables.assets)} WHERE user_id = ${userId}`,
                Request: db.schemas.ids.UserId,
                Result: db.schemas.entities.AssetCountResult,
            }),
            findAllActiveByUserId: SqlSchema.findAll({
                execute: ({ userId, limit, offset }) =>
                    sql`SELECT id, prompt FROM ${sql(B.tables.assets)} WHERE user_id = ${userId} AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
                Request: FindAssetsByUserIdParams,
                Result: db.schemas.entities.AssetListItem,
            }),
            findAllByUserId: SqlSchema.findAll({
                execute: ({ userId, limit, offset }) =>
                    sql`SELECT id, prompt FROM ${sql(B.tables.assets)} WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
                Request: FindAssetsByUserIdParams,
                Result: db.schemas.entities.AssetListItem,
            }),
            findById: SqlSchema.findOne({
                execute: (id) => sql`SELECT * FROM ${sql(B.tables.assets)} WHERE id = ${id}`,
                Request: db.schemas.ids.AssetId,
                Result: Asset.select,
            }),
            insert: SqlSchema.single({
                execute: ({ userId, prompt, svg }) =>
                    sql`INSERT INTO ${sql(B.tables.assets)} (user_id, prompt, svg) VALUES (${userId}, ${prompt}, ${svg}) RETURNING *`,
                Request: InsertAsset,
                Result: Asset.select,
            }),
            restore: SqlSchema.void({
                execute: (id) =>
                    sql`UPDATE ${sql(B.tables.assets)} SET deleted_at = NULL, updated_at = now() WHERE id = ${id}`,
                Request: db.schemas.ids.AssetId,
            }),
            softDelete: SqlSchema.void({
                execute: (id) =>
                    sql`UPDATE ${sql(B.tables.assets)} SET deleted_at = now(), updated_at = now() WHERE id = ${id}`,
                Request: db.schemas.ids.AssetId,
            }),
            updateWithVersion: SqlSchema.void({
                execute: ({ prompt, svg, id, expectedVersion }) =>
                    sql`UPDATE ${sql(B.tables.assets)} SET prompt = ${prompt}, svg = ${svg}, version = version + 1, updated_at = now() WHERE id = ${id} AND version = ${expectedVersion}`,
                Request: UpdateAssetWithVersion,
            }),
        },
        oauthAccounts: {
            delete: SqlSchema.void({
                execute: ({ provider, providerAccountId }) =>
                    sql`DELETE FROM ${sql(B.tables.oauthAccounts)} WHERE provider = ${provider} AND provider_account_id = ${providerAccountId}`,
                Request: DeleteOAuthAccountParams,
            }),
            findAllByUserId: SqlSchema.findAll({
                execute: (userId) => sql`SELECT * FROM ${sql(B.tables.oauthAccounts)} WHERE user_id = ${userId}`,
                Request: db.schemas.ids.UserId,
                Result: OAuthAccount.select,
            }),
            findByProviderAccountId: SqlSchema.findOne({
                execute: ({ provider, providerAccountId }) =>
                    sql`SELECT * FROM ${sql(B.tables.oauthAccounts)} WHERE provider = ${provider} AND provider_account_id = ${providerAccountId}`,
                Request: S.Struct({ provider: db.schemas.entities.OAuthProvider, providerAccountId: S.String }),
                Result: OAuthAccount.select,
            }),
            upsert: SqlSchema.void({
                execute: ({ userId, provider, providerAccountId, accessToken, refreshToken, expiresAt }) =>
                    sql`INSERT INTO ${sql(B.tables.oauthAccounts)} (user_id, provider, provider_account_id, access_token, refresh_token, access_token_expires_at)
                        VALUES (${userId}, ${provider}, ${providerAccountId}, ${accessToken}, ${refreshToken}, ${expiresAt})
                        ON CONFLICT (provider, provider_account_id)
                        DO UPDATE SET access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, updated_at = now()`,
                Request: UpsertOAuthAccount,
            }),
        },
        organizationMembers: {
            delete: SqlSchema.void({
                execute: (id) => sql`DELETE FROM ${sql(B.tables.organizationMembers)} WHERE id = ${id}`,
                Request: db.schemas.ids.OrganizationMemberId,
            }),
            findAllByOrganizationId: SqlSchema.findAll({
                execute: (orgId) =>
                    sql`SELECT * FROM ${sql(B.tables.organizationMembers)} WHERE organization_id = ${orgId}`,
                Request: db.schemas.ids.OrganizationId,
                Result: OrganizationMember.select,
            }),
            findAllByUserId: SqlSchema.findAll({
                execute: (userId) => sql`SELECT * FROM ${sql(B.tables.organizationMembers)} WHERE user_id = ${userId}`,
                Request: db.schemas.ids.UserId,
                Result: OrganizationMember.select,
            }),
            findByOrgAndUser: SqlSchema.findOne({
                execute: ({ organizationId, userId }) =>
                    sql`SELECT * FROM ${sql(B.tables.organizationMembers)} WHERE organization_id = ${organizationId} AND user_id = ${userId}`,
                Request: S.Struct({ organizationId: db.schemas.ids.OrganizationId, userId: db.schemas.ids.UserId }),
                Result: OrganizationMember.select,
            }),
            insert: SqlSchema.single({
                execute: ({ organizationId, userId, role }) =>
                    sql`INSERT INTO ${sql(B.tables.organizationMembers)} (organization_id, user_id, role) VALUES (${organizationId}, ${userId}, ${role}) RETURNING *`,
                Request: InsertOrganizationMember,
                Result: OrganizationMember.select,
            }),
            updateRole: SqlSchema.void({
                execute: ({ role, id }) =>
                    sql`UPDATE ${sql(B.tables.organizationMembers)} SET role = ${role}, updated_at = now() WHERE id = ${id}`,
                Request: S.Struct({
                    id: db.schemas.ids.OrganizationMemberId,
                    role: db.schemas.entities.OrganizationRole,
                }),
            }),
            updateWithVersion: SqlSchema.void({
                execute: ({ role, id, expectedVersion }) =>
                    sql`UPDATE ${sql(B.tables.organizationMembers)} SET role = ${role}, version = version + 1, updated_at = now() WHERE id = ${id} AND version = ${expectedVersion}`,
                Request: UpdateOrgMemberWithVersion,
            }),
        },
        organizations: {
            findAllActiveByUserId: SqlSchema.findAll({
                execute: (userId) =>
                    sql`SELECT o.* FROM ${sql(B.tables.organizations)} o
                        JOIN ${sql(B.tables.organizationMembers)} m ON o.id = m.organization_id
                        WHERE m.user_id = ${userId} AND o.deleted_at IS NULL`,
                Request: db.schemas.ids.UserId,
                Result: Organization.select,
            }),
            findById: SqlSchema.findOne({
                execute: (id) => sql`SELECT * FROM ${sql(B.tables.organizations)} WHERE id = ${id}`,
                Request: db.schemas.ids.OrganizationId,
                Result: Organization.select,
            }),
            findBySlug: SqlSchema.findOne({
                execute: (slug) => sql`SELECT * FROM ${sql(B.tables.organizations)} WHERE slug = ${slug}`,
                Request: S.NonEmptyTrimmedString,
                Result: Organization.select,
            }),
            insert: SqlSchema.single({
                execute: (data) =>
                    sql`INSERT INTO ${sql(B.tables.organizations)} (name, slug) VALUES (${data.name}, ${data.slug}) RETURNING *`,
                Request: InsertOrganization,
                Result: Organization.select,
            }),
            restore: SqlSchema.void({
                execute: (id) =>
                    sql`UPDATE ${sql(B.tables.organizations)} SET deleted_at = NULL, updated_at = now() WHERE id = ${id}`,
                Request: db.schemas.ids.OrganizationId,
            }),
            softDelete: SqlSchema.void({
                execute: (id) =>
                    sql`UPDATE ${sql(B.tables.organizations)} SET deleted_at = now(), updated_at = now() WHERE id = ${id}`,
                Request: db.schemas.ids.OrganizationId,
            }),
            updateWithVersion: SqlSchema.void({
                execute: ({ name, slug, id, expectedVersion }) =>
                    sql`UPDATE ${sql(B.tables.organizations)} SET name = ${name}, slug = ${slug}, version = version + 1, updated_at = now() WHERE id = ${id} AND version = ${expectedVersion}`,
                Request: UpdateOrganization,
            }),
        },
        refreshTokens: {
            findValidByTokenHash: SqlSchema.findOne({
                execute: (tokenHash) =>
                    sql`SELECT * FROM ${sql(B.tables.refreshTokens)} WHERE token_hash = ${tokenHash} AND expires_at > now() AND revoked_at IS NULL`,
                Request: db.schemas.entities.TokenHash,
                Result: RefreshToken.select,
            }),
            insert: SqlSchema.void({
                execute: ({ userId, tokenHash, expiresAt }) =>
                    sql`INSERT INTO ${sql(B.tables.refreshTokens)} (user_id, token_hash, expires_at) VALUES (${userId}, ${tokenHash}, ${expiresAt})`,
                Request: InsertRefreshToken,
            }),
            revoke: SqlSchema.void({
                execute: (id) => sql`UPDATE ${sql(B.tables.refreshTokens)} SET revoked_at = now() WHERE id = ${id}`,
                Request: db.schemas.ids.RefreshTokenId,
            }),
            revokeAllByUserId: SqlSchema.void({
                execute: (userId) =>
                    sql`UPDATE ${sql(B.tables.refreshTokens)} SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`,
                Request: db.schemas.ids.UserId,
            }),
        },
        sessions: {
            findByTokenHash: SqlSchema.findOne({
                execute: (tokenHash) =>
                    sql`SELECT * FROM ${sql(B.tables.sessions)} WHERE token_hash = ${tokenHash} AND expires_at > now() AND revoked_at IS NULL`,
                Request: db.schemas.entities.TokenHash,
                Result: Session.select,
            }),
            insert: SqlSchema.void({
                execute: ({ userId, tokenHash, expiresAt }) =>
                    sql`INSERT INTO ${sql(B.tables.sessions)} (user_id, token_hash, expires_at) VALUES (${userId}, ${tokenHash}, ${expiresAt})`,
                Request: InsertSession,
            }),
            revoke: SqlSchema.void({
                execute: (id) => sql`UPDATE ${sql(B.tables.sessions)} SET revoked_at = now() WHERE id = ${id}`,
                Request: db.schemas.ids.SessionId,
            }),
            revokeAllByUserId: SqlSchema.void({
                execute: (userId) =>
                    sql`UPDATE ${sql(B.tables.sessions)} SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`,
                Request: db.schemas.ids.UserId,
            }),
        },
        users: {
            findActiveByEmail: SqlSchema.findOne({
                execute: (email) =>
                    sql`SELECT * FROM ${sql(B.tables.users)} WHERE email = ${email} AND deleted_at IS NULL`,
                Request: S.NonEmptyTrimmedString,
                Result: User.select,
            }),
            findByEmail: SqlSchema.findOne({
                execute: (email) => sql`SELECT * FROM ${sql(B.tables.users)} WHERE email = ${email}`,
                Request: S.NonEmptyTrimmedString,
                Result: User.select,
            }),
            findById: SqlSchema.findOne({
                execute: (id) => sql`SELECT * FROM ${sql(B.tables.users)} WHERE id = ${id}`,
                Request: db.schemas.ids.UserId,
                Result: User.select,
            }),
            insert: SqlSchema.single({
                execute: (data) => sql`INSERT INTO ${sql(B.tables.users)} (email) VALUES (${data.email}) RETURNING *`,
                Request: S.Struct({ email: S.NonEmptyTrimmedString }),
                Result: User.select,
            }),
            restore: SqlSchema.void({
                execute: (id) => sql`UPDATE ${sql(B.tables.users)} SET deleted_at = NULL WHERE id = ${id}`,
                Request: db.schemas.ids.UserId,
            }),
            softDelete: SqlSchema.void({
                execute: (id) => sql`UPDATE ${sql(B.tables.users)} SET deleted_at = now() WHERE id = ${id}`,
                Request: db.schemas.ids.UserId,
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

// --- [TYPES] -----------------------------------------------------------------

type Repositories = Effect.Effect.Success<typeof makeRepositories>;

// --- [EXPORT] ----------------------------------------------------------------

export { B as REPOSITORY_TUNING, makeRepositories };
export type { Repositories };
