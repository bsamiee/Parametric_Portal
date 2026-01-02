/**
 * DatabaseService Context.Tag + repositories with Model.makeRepository.
 * Static layer pattern following crypto.ts gold standard.
 */
import { Model, SqlClient, SqlSchema } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import {
    AiProvider,
    ApiKeyId,
    AssetId,
    OAuthProvider,
    RefreshTokenId,
    SessionId,
    UserId,
} from '@parametric-portal/types/database';
import { Hex64 } from '@parametric-portal/types/types';
import type { Option, ParseResult } from 'effect';
import { Context, Effect, Layer, Schema as S } from 'effect';
import { ApiKey, Asset, OAuthAccount, RefreshToken, Session, User } from './models.ts';

// --- [TYPES] -----------------------------------------------------------------

type DbError = ParseResult.ParseError | SqlError;
type SoftDeleteOps<Id> = {
    readonly restore: (id: Id) => Effect.Effect<void, DbError>;
    readonly softDelete: (id: Id) => Effect.Effect<void, DbError>;
};
type TokenLookupOps<M> = {
    readonly findValidByTokenHash: (hash: Hex64) => Effect.Effect<Option.Option<M>, DbError>;
};
type RevocableOps<Id, UserId> = {
    readonly revoke: (id: Id) => Effect.Effect<void, DbError>;
    readonly revokeAllByUserId: (userId: UserId) => Effect.Effect<void, DbError>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    tables: {
        apiKeys: 'api_keys',
        assets: 'assets',
        oauthAccounts: 'oauth_accounts',
        refreshTokens: 'refresh_tokens',
        sessions: 'sessions',
        users: 'users',
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const makeRepo = <M extends Model.Any>(model: M, name: keyof typeof B.tables) =>
    Model.makeRepository(model, { idColumn: 'id', spanPrefix: `database.${name}`, tableName: B.tables[name] });
const withSoftDelete = <Id>(
    sql: SqlClient.SqlClient,
    table: string,
    idSchema: S.Schema<Id, string>,
): SoftDeleteOps<Id> => ({
    restore: SqlSchema.void({
        execute: (id) => sql`UPDATE ${sql(table)} SET deleted_at = NULL, updated_at = now() WHERE id = ${id}`,
        Request: idSchema,
    }),
    softDelete: SqlSchema.void({
        execute: (id) => sql`UPDATE ${sql(table)} SET deleted_at = now(), updated_at = now() WHERE id = ${id}`,
        Request: idSchema,
    }),
});
const withTokenLookup = <M extends S.Schema.Any>(
    sql: SqlClient.SqlClient,
    table: string,
    hashColumn: string,
    model: M,
    withRevocation: boolean,
): TokenLookupOps<S.Schema.Type<M>> => ({
    findValidByTokenHash: SqlSchema.findOne({
        execute: (hash) =>
            withRevocation
                ? sql`SELECT * FROM ${sql(table)} WHERE ${sql(hashColumn)} = ${hash} AND expires_at > now() AND revoked_at IS NULL`
                : sql`SELECT * FROM ${sql(table)} WHERE ${sql(hashColumn)} = ${hash} AND (expires_at IS NULL OR expires_at > now())`,
        Request: Hex64.schema,
        Result: model,
    }) as TokenLookupOps<S.Schema.Type<M>>['findValidByTokenHash'],
});
const withRevocable = <Id, UserId>(
    sql: SqlClient.SqlClient,
    table: string,
    idSchema: S.Schema<Id, string>,
    userIdSchema: S.Schema<UserId, string>,
): RevocableOps<Id, UserId> => ({
    revoke: SqlSchema.void({
        execute: (id) => sql`UPDATE ${sql(table)} SET revoked_at = now() WHERE id = ${id}`,
        Request: idSchema,
    }),
    revokeAllByUserId: SqlSchema.void({
        execute: (userId) =>
            sql`UPDATE ${sql(table)} SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`,
        Request: userIdSchema,
    }),
});

// --- [REPOSITORY_BUILDERS] ---------------------------------------------------

const buildApiKeyRepo = (sql: SqlClient.SqlClient) =>
    Effect.map(makeRepo(ApiKey, 'apiKeys'), (base) => ({
        ...base,
        ...withTokenLookup(sql, B.tables.apiKeys, 'key_hash', ApiKey, false),
        findAllByUserId: SqlSchema.findAll({
            execute: (userId) => sql`SELECT * FROM ${sql(B.tables.apiKeys)} WHERE user_id = ${userId}`,
            Request: UserId,
            Result: ApiKey,
        }),
        findByIdAndUserId: SqlSchema.findOne({
            execute: ({ id, userId }) =>
                sql`SELECT * FROM ${sql(B.tables.apiKeys)} WHERE id = ${id} AND user_id = ${userId}`,
            Request: S.Struct({ id: ApiKeyId, userId: UserId }),
            Result: ApiKey,
        }),
        findByUserIdAndProvider: SqlSchema.findOne({
            execute: ({ userId, provider }) =>
                sql`SELECT * FROM ${sql(B.tables.apiKeys)} WHERE user_id = ${userId} AND provider = ${provider} AND (expires_at IS NULL OR expires_at > now())`,
            Request: S.Struct({ provider: AiProvider, userId: UserId }),
            Result: ApiKey,
        }),
        updateLastUsed: SqlSchema.void({
            execute: (id) => sql`UPDATE ${sql(B.tables.apiKeys)} SET last_used_at = now() WHERE id = ${id}`,
            Request: ApiKeyId,
        }),
    }));
const buildAssetRepo = (sql: SqlClient.SqlClient) =>
    Effect.map(makeRepo(Asset, 'assets'), (base) => ({
        ...base,
        ...withSoftDelete(sql, B.tables.assets, AssetId),
        countByUserId: SqlSchema.single({
            execute: (userId) =>
                sql`SELECT COUNT(*)::int AS count FROM ${sql(B.tables.assets)} WHERE user_id = ${userId} AND deleted_at IS NULL`,
            Request: UserId,
            Result: S.Struct({ count: S.Number }),
        }),
        findAllByUserId: SqlSchema.findAll({
            execute: ({ userId, limit, offset }) =>
                sql`SELECT * FROM ${sql(B.tables.assets)} WHERE user_id = ${userId} AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
            Request: S.Struct({ limit: S.Number, offset: S.Number, userId: UserId }),
            Result: Asset,
        }),
    }));
const ProviderAccountSchema = S.Struct({ provider: OAuthProvider, providerAccountId: S.String });
const buildOAuthAccountRepo = (sql: SqlClient.SqlClient) =>
    Effect.map(makeRepo(OAuthAccount, 'oauthAccounts'), (base) => ({
        ...base,
        deleteByProvider: SqlSchema.void({
            execute: ({ provider, providerAccountId }) =>
                sql`DELETE FROM ${sql(B.tables.oauthAccounts)} WHERE provider = ${provider} AND provider_account_id = ${providerAccountId}`,
            Request: ProviderAccountSchema,
        }),
        findAllByUserId: SqlSchema.findAll({
            execute: (userId) => sql`SELECT * FROM ${sql(B.tables.oauthAccounts)} WHERE user_id = ${userId}`,
            Request: UserId,
            Result: OAuthAccount,
        }),
        findByProviderAccountId: SqlSchema.findOne({
            execute: ({ provider, providerAccountId }) =>
                sql`SELECT * FROM ${sql(B.tables.oauthAccounts)} WHERE provider = ${provider} AND provider_account_id = ${providerAccountId}`,
            Request: ProviderAccountSchema,
            Result: OAuthAccount,
        }),
        upsert: SqlSchema.void({
            execute: ({ userId, provider, providerAccountId, accessToken, refreshToken, expiresAt }) =>
                sql`INSERT INTO ${sql(B.tables.oauthAccounts)} (user_id, provider, provider_account_id, access_token, refresh_token, access_token_expires_at) VALUES (${userId}, ${provider}, ${providerAccountId}, ${accessToken}, ${refreshToken}, ${expiresAt}) ON CONFLICT (provider, provider_account_id) DO UPDATE SET access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, updated_at = now()`,
            Request: S.Struct({
                accessToken: S.String,
                expiresAt: S.NullOr(S.DateFromSelf),
                provider: OAuthProvider,
                providerAccountId: S.String,
                refreshToken: S.NullOr(S.String),
                userId: UserId,
            }),
        }),
    }));
const buildRefreshTokenRepo = (sql: SqlClient.SqlClient) =>
    Effect.map(makeRepo(RefreshToken, 'refreshTokens'), (base) => ({
        ...base,
        ...withTokenLookup(sql, B.tables.refreshTokens, 'token_hash', RefreshToken, true),
        ...withRevocable(sql, B.tables.refreshTokens, RefreshTokenId, UserId),
    }));
const buildSessionRepo = (sql: SqlClient.SqlClient) =>
    Effect.map(makeRepo(Session, 'sessions'), (base) => ({
        ...base,
        ...withTokenLookup(sql, B.tables.sessions, 'token_hash', Session, true),
        ...withRevocable(sql, B.tables.sessions, SessionId, UserId),
    }));
const buildUserRepo = (sql: SqlClient.SqlClient) =>
    Effect.map(makeRepo(User, 'users'), (base) => ({
        ...base,
        ...withSoftDelete(sql, B.tables.users, UserId),
        findActiveByEmail: SqlSchema.findOne({
            execute: (email) => sql`SELECT * FROM ${sql(B.tables.users)} WHERE email = ${email} AND deleted_at IS NULL`,
            Request: S.NonEmptyTrimmedString,
            Result: User,
        }),
        findByEmail: SqlSchema.findOne({
            execute: (email) => sql`SELECT * FROM ${sql(B.tables.users)} WHERE email = ${email}`,
            Request: S.NonEmptyTrimmedString,
            Result: User,
        }),
    }));

// --- [SERVICE_TYPES] ---------------------------------------------------------

type ApiKeyRepository = Effect.Effect.Success<ReturnType<typeof buildApiKeyRepo>>;
type AssetRepository = Effect.Effect.Success<ReturnType<typeof buildAssetRepo>>;
type OAuthAccountRepository = Effect.Effect.Success<ReturnType<typeof buildOAuthAccountRepo>>;
type RefreshTokenRepository = Effect.Effect.Success<ReturnType<typeof buildRefreshTokenRepo>>;
type SessionRepository = Effect.Effect.Success<ReturnType<typeof buildSessionRepo>>;
type UserRepository = Effect.Effect.Success<ReturnType<typeof buildUserRepo>>;
type DatabaseServiceShape = {
    readonly apiKeys: ApiKeyRepository;
    readonly assets: AssetRepository;
    readonly oauthAccounts: OAuthAccountRepository;
    readonly refreshTokens: RefreshTokenRepository;
    readonly sessions: SessionRepository;
    readonly users: UserRepository;
    readonly withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | SqlError, R>;
};

// --- [SERVICE] ---------------------------------------------------------------

class DatabaseService extends Context.Tag('database/DatabaseService')<DatabaseService, DatabaseServiceShape>() {
    static readonly layer = Layer.effect(
        this,
        Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const [apiKeys, assets, oauthAccounts, refreshTokens, sessions, users] = yield* Effect.all([
                buildApiKeyRepo(sql),
                buildAssetRepo(sql),
                buildOAuthAccountRepo(sql),
                buildRefreshTokenRepo(sql),
                buildSessionRepo(sql),
                buildUserRepo(sql),
            ]);
            return {
                apiKeys,
                assets,
                oauthAccounts,
                refreshTokens,
                sessions,
                users,
                withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => sql.withTransaction(effect),
            };
        }),
    );
}

// --- [EXPORT] ----------------------------------------------------------------

export { B as REPOSITORY_TUNING, DatabaseService };
export type {
    ApiKeyRepository,
    AssetRepository,
    DatabaseServiceShape,
    OAuthAccountRepository,
    RefreshTokenRepository,
    SessionRepository,
    UserRepository,
};
