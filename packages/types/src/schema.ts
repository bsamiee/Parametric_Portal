/**
 * Drizzle schema: Single source of truth for all database entities.
 * Branded IDs, enums, and relations. No re-exports - consumers import directly.
 */

import { relations, sql } from 'drizzle-orm';
import { customType, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { Duration, Effect, Schema as S } from 'effect';
import { Hex64, Uuidv7 } from './types.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    durations: {
        refreshBuffer: Duration.minutes(5),
        refreshToken: Duration.days(30),
        session: Duration.days(7),
        tokenRefreshBuffer: Duration.minutes(1),
    },
    enums: {
        aiProvider: ['anthropic', 'openai', 'gemini'] as const,
        assetType: ['icon', 'image', 'document'] as const,
        auditOperation: ['create', 'update', 'delete', 'revoke'] as const,
        idBrands: ['ApiKeyId', 'AssetId', 'OAuthAccountId', 'RefreshTokenId', 'SessionId', 'UserId'] as const,
        oauthProvider: ['google', 'github', 'microsoft', 'apple'] as const,
        role: ['guest', 'viewer', 'member', 'admin', 'owner'] as const,
    },
    roleLevels: { admin: 3, guest: 0, member: 2, owner: 4, viewer: 1 },
} as const);

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
    Object.fromEntries(B.enums.idBrands.map((brand) => [brand, makeId(brand)])) as unknown as { readonly [K in IdBrand]: ReturnType<typeof makeId<K>>; },
);
const ApiKeyId = IdFactory.ApiKeyId;
const AssetId = IdFactory.AssetId;
const OAuthAccountId = IdFactory.OAuthAccountId;
const RefreshTokenId = IdFactory.RefreshTokenId;
const SessionId = IdFactory.SessionId;
const UserId = IdFactory.UserId;
const Role = S.Literal(...B.enums.role);
const OAuthProvider = S.Literal(...B.enums.oauthProvider);
const AiProvider = S.Literal(...B.enums.aiProvider);
const AssetType = S.Literal(...B.enums.assetType);
const AuditOperation = S.Literal(...B.enums.auditOperation);
const roleEnum = pgEnum('role', [...B.enums.role]);
const oauthProviderEnum = pgEnum('oauth_provider', [...B.enums.oauthProvider]);
const aiProviderEnum = pgEnum('ai_provider', [...B.enums.aiProvider]);
const assetTypeEnum = pgEnum('asset_type', [...B.enums.assetType]);
const auditOperationEnum = pgEnum('audit_operation', [...B.enums.auditOperation]);
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
    dataType: () => 'bytea',
    fromDriver: (value: Buffer): Buffer => value,
    toDriver: (value: Buffer): Buffer => value,
});
const NullableDate = S.NullOr(S.DateFromSelf);
const BufferSchema = S.instanceOf(Buffer);

// --- [ROW_SCHEMAS] -----------------------------------------------------------

const UserRowSchema = S.Struct({
    createdAt: S.DateFromSelf,
    deletedAt: NullableDate,
    email: S.String,
    id: UserId.schema,
    role: Role,
});
const SessionRowSchema = S.Struct({
    createdAt: S.DateFromSelf,
    expiresAt: S.DateFromSelf,
    id: SessionId.schema,
    ipAddress: S.NullOr(S.String),
    lastActivityAt: S.DateFromSelf,
    revokedAt: NullableDate,
    tokenHash: Hex64.schema,
    userAgent: S.NullOr(S.String),
    userId: UserId.schema,
});
const ApiKeyRowSchema = S.Struct({
    createdAt: S.DateFromSelf,
    expiresAt: NullableDate,
    id: ApiKeyId.schema,
    keyEncrypted: BufferSchema,
    keyHash: Hex64.schema,
    lastUsedAt: NullableDate,
    name: S.String,
    provider: AiProvider,
    userId: UserId.schema,
});
const OAuthAccountRowSchema = S.Struct({
    accessToken: S.String,
    accessTokenExpiresAt: NullableDate,
    createdAt: S.DateFromSelf,
    id: OAuthAccountId.schema,
    provider: OAuthProvider,
    providerAccountId: S.String,
    refreshToken: S.NullOr(S.String),
    scope: S.NullOr(S.String),
    updatedAt: S.DateFromSelf,
    userId: UserId.schema,
});
const RefreshTokenRowSchema = S.Struct({
    createdAt: S.DateFromSelf,
    expiresAt: S.DateFromSelf,
    id: RefreshTokenId.schema,
    revokedAt: NullableDate,
    tokenHash: Hex64.schema,
    userId: UserId.schema,
});
const AssetRowSchema = S.Struct({
    assetType: AssetType,
    content: S.String,
    createdAt: S.DateFromSelf,
    deletedAt: NullableDate,
    id: AssetId.schema,
    updatedAt: S.DateFromSelf,
    userId: S.NullOr(UserId.schema),
});
const AuditLogRowSchema = S.Struct({
    actorId: S.NullOr(UserId.schema),
    changes: S.NullOr(S.Record({ key: S.String, value: S.Unknown })),
    createdAt: S.DateFromSelf,
    entityId: S.UUID,
    entityType: S.String,
    id: S.UUID,
    ipAddress: S.NullOr(S.String),
    operation: AuditOperation,
    userAgent: S.NullOr(S.String),
});

// --- [INSERT_SCHEMAS] --------------------------------------------------------
// Derived from RowSchemas - omit DB-generated fields for insert operations

const UserInsertSchema = UserRowSchema.pipe(S.omit('createdAt', 'deletedAt', 'id'));
const SessionInsertSchema = SessionRowSchema.pipe(S.omit('createdAt', 'id', 'revokedAt', 'lastActivityAt'));
const RefreshTokenInsertSchema = RefreshTokenRowSchema.pipe(S.omit('createdAt', 'id', 'revokedAt'));
const AssetInsertSchema = AssetRowSchema.pipe(S.omit('createdAt', 'deletedAt', 'id', 'updatedAt'));
const OAuthAccountInsertSchema = OAuthAccountRowSchema.pipe(S.omit('createdAt', 'id', 'updatedAt'));
const ApiKeyInsertSchema = ApiKeyRowSchema.pipe(S.omit('createdAt', 'id', 'lastUsedAt'));
const AuditLogInsertSchema = AuditLogRowSchema.pipe(S.omit('id', 'createdAt'));

// --- [TABLES] ----------------------------------------------------------------

const users = pgTable('users', {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    email: text('email').notNull().unique(),
    id: uuid('id').primaryKey().default(sql`uuidv7()`).$type<UserId>(),
    role: roleEnum('role').notNull().default('viewer'),
});
const sessions = pgTable('sessions', {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    id: uuid('id').primaryKey().default(sql`uuidv7()`).$type<SessionId>(),
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
    id: uuid('id').primaryKey().default(sql`uuidv7()`).$type<ApiKeyId>(),
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
    id: uuid('id').primaryKey().default(sql`uuidv7()`).$type<OAuthAccountId>(),
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
    id: uuid('id').primaryKey().default(sql`uuidv7()`).$type<RefreshTokenId>(),
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
    id: uuid('id').primaryKey().default(sql`uuidv7()`).$type<AssetId>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id')
        .references(() => users.id)
        .$type<UserId>(),
});
const auditLogs = pgTable('audit_logs', {
    actorId: uuid('actor_id')
        .references(() => users.id)
        .$type<UserId>(),
    changes: jsonb('changes').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    entityId: uuid('entity_id').notNull(),
    entityType: text('entity_type').notNull(),
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    ipAddress: text('ip_address'),
    operation: auditOperationEnum('operation').notNull(),
    userAgent: text('user_agent'),
});

// --- [RELATIONS] -------------------------------------------------------------

const usersRelations = relations(users, ({ many }) => ({
    apiKeys: many(apiKeys),
    assets: many(assets),
    oauthAccounts: many(oauthAccounts),
    refreshTokens: many(refreshTokens),
    sessions: many(sessions),
}));
const sessionsRelations = relations(sessions, ({ one }) => ({ user: one(users, { fields: [sessions.userId], references: [users.id] }), }));
const apiKeysRelations = relations(apiKeys, ({ one }) => ({ user: one(users, { fields: [apiKeys.userId], references: [users.id] }), }));
const oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({ user: one(users, { fields: [oauthAccounts.userId], references: [users.id] }), }));
const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({ user: one(users, { fields: [refreshTokens.userId], references: [users.id] }), }));
const assetsRelations = relations(assets, ({ one }) => ({ user: one(users, { fields: [assets.userId], references: [users.id] }), }));
const auditLogsRelations = relations(auditLogs, ({ one }) => ({ actor: one(users, { fields: [auditLogs.actorId], references: [users.id] }), }));

// --- [TYPES] -----------------------------------------------------------------

type IdBrand = (typeof B.enums.idBrands)[number];
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
type AuditOperation = typeof AuditOperation.Type;
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
type AuditLog = typeof auditLogs.$inferSelect;
type AuditLogInsert = typeof auditLogs.$inferInsert;
type UserRow = S.Schema.Type<typeof UserRowSchema>;
type SessionRow = S.Schema.Type<typeof SessionRowSchema>;
type ApiKeyRow = S.Schema.Type<typeof ApiKeyRowSchema>;
type OAuthAccountRow = S.Schema.Type<typeof OAuthAccountRowSchema>;
type RefreshTokenRow = S.Schema.Type<typeof RefreshTokenRowSchema>;
type AssetRow = S.Schema.Type<typeof AssetRowSchema>;
type AuditLogRow = S.Schema.Type<typeof AuditLogRowSchema>;
type UserWithSessions = User & { readonly sessions: ReadonlyArray<Session> };
type UserWithApiKeys = User & { readonly apiKeys: ReadonlyArray<ApiKey> };
type UserWithOAuthAccounts = User & { readonly oauthAccounts: ReadonlyArray<OAuthAccount> };
type SessionWithUser = Session & { readonly user: User };

// --- [EXPORT] ----------------------------------------------------------------

export { B as SCHEMA_TUNING, IdFactory };
export { AiProvider, ApiKeyId, AssetId, AssetType, AuditOperation, OAuthAccountId, OAuthProvider, RefreshTokenId, Role, SessionId, UserId, };
export { aiProviderEnum, assetTypeEnum, auditOperationEnum, oauthProviderEnum, roleEnum };
export { apiKeys, assets, auditLogs, oauthAccounts, refreshTokens, sessions, users };
export { apiKeysRelations, assetsRelations, auditLogsRelations, oauthAccountsRelations, refreshTokensRelations, sessionsRelations, usersRelations, };
export { ApiKeyRowSchema, AssetRowSchema, AuditLogRowSchema, OAuthAccountRowSchema, RefreshTokenRowSchema, SessionRowSchema, UserRowSchema };
export { ApiKeyInsertSchema, AssetInsertSchema, AuditLogInsertSchema, OAuthAccountInsertSchema, RefreshTokenInsertSchema, SessionInsertSchema, UserInsertSchema };
export type {
    IdBrand, ApiKey, ApiKeyInsert, ApiKeyRow, Asset, AssetInsert, AssetRow, AuditLog, AuditLogInsert, AuditLogRow, OAuthAccount,
    OAuthAccountInsert, OAuthAccountRow, RefreshToken, RefreshTokenInsert, RefreshTokenRow, RoleKey, Session, SessionInsert,
    SessionRow, SessionWithUser, User, UserInsert, UserRow, UserWithApiKeys, UserWithOAuthAccounts, UserWithSessions,
};
