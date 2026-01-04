/**
 * Drizzle schema: Single source of truth for all database entities.
 * Branded IDs, enums, and relations. No re-exports - consumers import directly.
 */
import { type Hex64, Uuidv7 } from '@parametric-portal/types/types';
import { relations } from 'drizzle-orm';
import { customType, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { Duration, Effect, Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    durations: {
        refreshBuffer: Duration.minutes(5),
        refreshToken: Duration.days(30),
        session: Duration.days(7),
        tokenRefreshBuffer: Duration.minutes(1),
    },
    roleLevels: {
        admin: 3,
        guest: 0,
        member: 2,
        owner: 4,
        viewer: 1,
    },
} as const);
const idBrands = ['ApiKeyId', 'AssetId', 'OAuthAccountId', 'RefreshTokenId', 'SessionId', 'UserId'] as const;
const roleValues = ['guest', 'viewer', 'member', 'admin', 'owner'] as const;
const oauthProviderValues = ['google', 'github', 'microsoft'] as const;
const aiProviderValues = ['anthropic', 'openai', 'gemini'] as const;
const assetTypeValues = ['icon', 'image', 'document'] as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const makeId = <T extends string>(brand: T) => {
    const schema = Uuidv7.schema.pipe(S.brand(brand));
    type Id = S.Schema.Type<typeof schema>;
    const generateSync = (): Id => Uuidv7.generateSync() as Id;
    return Object.freeze({
        brand,
        decode: S.decodeUnknown(schema),
        decodeSync: S.decodeUnknownSync(schema),
        generate: Effect.sync(generateSync),
        generateSync,
        is: S.is(schema),
        schema,
    });
};

// --- [SCHEMA] ----------------------------------------------------------------

const IdFactory = Object.freeze(
    Object.fromEntries(idBrands.map((brand) => [brand, makeId(brand)])) as unknown as {
        readonly [K in IdBrand]: ReturnType<typeof makeId<K>>;
    },
);
const ApiKeyId = IdFactory.ApiKeyId;
const AssetId = IdFactory.AssetId;
const OAuthAccountId = IdFactory.OAuthAccountId;
const RefreshTokenId = IdFactory.RefreshTokenId;
const SessionId = IdFactory.SessionId;
const UserId = IdFactory.UserId;
const Role = S.Literal(...roleValues);
const OAuthProvider = S.Literal(...oauthProviderValues);
const AiProvider = S.Literal(...aiProviderValues);
const AssetType = S.Literal(...assetTypeValues);
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
    dataType: () => 'bytea',
    fromDriver: (value: Buffer): Buffer => value,
    toDriver: (value: Buffer): Buffer => value,
});
const roleEnum = pgEnum('role', [...roleValues]);
const oauthProviderEnum = pgEnum('oauth_provider', [...oauthProviderValues]);
const aiProviderEnum = pgEnum('ai_provider', [...aiProviderValues]);
const assetTypeEnum = pgEnum('asset_type', [...assetTypeValues]);

// --- [TABLES] ----------------------------------------------------------------

const users = pgTable('users', {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    email: text('email').notNull().unique(),
    id: uuid('id').primaryKey().defaultRandom().$type<UserId>(),
    role: roleEnum('role').notNull().default('viewer'),
});
const sessions = pgTable('sessions', {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    id: uuid('id').primaryKey().defaultRandom().$type<SessionId>(),
    ipAddress: text('ip_address'),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    tokenHash: text('token_hash').notNull().$type<Hex64>(),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id)
        .$type<UserId>(),
});
const apiKeys = pgTable('api_keys', {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    id: uuid('id').primaryKey().defaultRandom().$type<ApiKeyId>(),
    keyEncrypted: bytea('key_encrypted').notNull(),
    keyHash: text('key_hash').notNull().$type<Hex64>(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    name: text('name').notNull(),
    provider: aiProviderEnum('provider').notNull(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id)
        .$type<UserId>(),
});
const oauthAccounts = pgTable('oauth_accounts', {
    accessToken: text('access_token').notNull(),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    id: uuid('id').primaryKey().defaultRandom().$type<OAuthAccountId>(),
    provider: oauthProviderEnum('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refreshToken: text('refresh_token'),
    scope: text('scope'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id)
        .$type<UserId>(),
});
const refreshTokens = pgTable('refresh_tokens', {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    id: uuid('id').primaryKey().defaultRandom().$type<RefreshTokenId>(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    tokenHash: text('token_hash').notNull().$type<Hex64>(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id)
        .$type<UserId>(),
});
const assets = pgTable('assets', {
    assetType: assetTypeEnum('asset_type').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    id: uuid('id').primaryKey().defaultRandom().$type<AssetId>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id')
        .references(() => users.id)
        .$type<UserId>(),
});

// --- [RELATIONS] -------------------------------------------------------------

const usersRelations = relations(users, ({ many }) => ({
    apiKeys: many(apiKeys),
    assets: many(assets),
    oauthAccounts: many(oauthAccounts),
    refreshTokens: many(refreshTokens),
    sessions: many(sessions),
}));
const sessionsRelations = relations(sessions, ({ one }) => ({
    user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));
const apiKeysRelations = relations(apiKeys, ({ one }) => ({
    user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
}));
const oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({
    user: one(users, { fields: [oauthAccounts.userId], references: [users.id] }),
}));
const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
    user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));
const assetsRelations = relations(assets, ({ one }) => ({
    user: one(users, { fields: [assets.userId], references: [users.id] }),
}));

// --- [TYPES] -----------------------------------------------------------------

type IdBrand = (typeof idBrands)[number];
type RoleKey = keyof typeof B.roleLevels;
type ApiKeyId = S.Schema.Type<typeof ApiKeyId.schema>;
type AssetId = S.Schema.Type<typeof AssetId.schema>;
type OAuthAccountId = S.Schema.Type<typeof OAuthAccountId.schema>;
type RefreshTokenId = S.Schema.Type<typeof RefreshTokenId.schema>;
type SessionId = S.Schema.Type<typeof SessionId.schema>;
type UserId = S.Schema.Type<typeof UserId.schema>;
type Role = typeof Role.Type;
type OAuthProvider = typeof OAuthProvider.Type;
type AiProvider = typeof AiProvider.Type;
type AssetType = typeof AssetType.Type;
type User = typeof users.$inferSelect;
type UserInsert = typeof users.$inferInsert;
type Session = typeof sessions.$inferSelect;
type SessionInsert = typeof sessions.$inferInsert;
type ApiKey = typeof apiKeys.$inferSelect;
type ApiKeyInsert = typeof apiKeys.$inferInsert;
type OAuthAccount = typeof oauthAccounts.$inferSelect;
type OAuthAccountInsert = typeof oauthAccounts.$inferInsert;
type RefreshToken = typeof refreshTokens.$inferSelect;
type RefreshTokenInsert = typeof refreshTokens.$inferInsert;
type Asset = typeof assets.$inferSelect;
type AssetInsert = typeof assets.$inferInsert;

// --- [EXPORT] ----------------------------------------------------------------

export { B as SCHEMA_TUNING, IdFactory };
export type { IdBrand };
export {
    AiProvider,
    ApiKeyId,
    AssetId,
    AssetType,
    OAuthAccountId,
    OAuthProvider,
    RefreshTokenId,
    Role,
    SessionId,
    UserId,
};
export { aiProviderEnum, assetTypeEnum, oauthProviderEnum, roleEnum };
export { apiKeys, assets, oauthAccounts, refreshTokens, sessions, users };
export {
    apiKeysRelations,
    assetsRelations,
    oauthAccountsRelations,
    refreshTokensRelations,
    sessionsRelations,
    usersRelations,
};
export type {
    ApiKey,
    ApiKeyInsert,
    Asset,
    AssetInsert,
    OAuthAccount,
    OAuthAccountInsert,
    RefreshToken,
    RefreshTokenInsert,
    RoleKey,
    Session,
    SessionInsert,
    User,
    UserInsert,
};
