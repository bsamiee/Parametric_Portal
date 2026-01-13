/**
 * DatabaseService via Effect.Service with SqlResolver batching.
 * Uses relational query API (findFirst/findMany) + auto-batched findById.
 * Supports eager loading via Drizzle 'with' clause.
 * Batch operations via SqlResolver.ordered for INSERT RETURNING.
 */
import { SqlClient } from '@effect/sql/SqlClient';
import type { SqlError } from '@effect/sql/SqlError';
import * as SqlResolver from '@effect/sql/SqlResolver';
import { API_TUNING } from '@parametric-portal/server/api';
import { MetricsService } from '@parametric-portal/server/metrics';
import { type ApiKey, type ApiKeyInsert, ApiKeyInsertSchema, ApiKeyRowSchema, type App, type AppInsert, AppInsertSchema, AppRowSchema, type Asset, type AssetInsert, AssetInsertSchema, AssetRowSchema, type AuditLog, type AuditLogInsert, AuditLogInsertSchema, AuditLogRowSchema, apiKeys, apps, assets, auditLogs, IdFactory, type MfaSecretInsert, mfaSecrets, type OAuthAccount, type OAuthAccountInsert, OAuthAccountInsertSchema, OAuthAccountRowSchema, oauthAccounts, type RefreshToken, type RefreshTokenInsert, RefreshTokenInsertSchema, RefreshTokenRowSchema, refreshTokens, type Session, type SessionInsert, SessionInsertSchema, SessionRowSchema, type SessionWithUser, sessions, type User, type UserInsert, UserInsertSchema, UserRowSchema, type UserWithApiKeys, type UserWithOAuthAccounts, type UserWithSessions, users } from '@parametric-portal/types/schema';
import { AppError } from '@parametric-portal/types/app-error';
import type { Hex64 } from '@parametric-portal/types/types';
import { and, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { Chunk, type Context, Duration, Effect, identity, Layer, Option, pipe, type Schema as S, Stream } from 'effect';
import { DATABASE_TUNING, Drizzle, PgLive } from './client.ts';

// --- [TYPES] -----------------------------------------------------------------

type DrizzleDb = Context.Tag.Service<typeof Drizzle>;
type OpType = 'read' | 'write' | 'delete';
type WithTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | SqlError, R>;
type Resolvers = Effect.Effect.Success<ReturnType<typeof makeResolvers>>;
type AuditFilter = { readonly after?: Date | undefined; readonly before?: Date | undefined; readonly operation?: AuditLog['operation'] | undefined };
type CursorPaginationInput<T> = { readonly cursor?: T | undefined; readonly direction?: CursorDirection | undefined; readonly limit?: number | undefined; };
type CursorDirection = 'forward' | 'backward';
type PaginationResult = {
    readonly clamped: boolean;
    readonly limit: number;
    readonly offset: number;
    readonly requestedLimit: number;
    readonly requestedOffset: number;
};
type CursorPaginationResult<T, C> = {
    readonly data: readonly T[];
    readonly hasNextPage: boolean;
    readonly hasPreviousPage: boolean;
    readonly limit: number;
    readonly nextCursor: C | null;
    readonly previousCursor: C | null;
};
type AuditWithCount = {
    readonly clamped: boolean;
    readonly data: readonly AuditLog[];
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    ...DATABASE_TUNING,
    pagination: { ...API_TUNING.pagination, maxOffset: 10000, minOffset: 0 },
} as const);
const allAuditFields = Object.freeze({
    actorEmail: auditLogs.actorEmail,
    actorId: auditLogs.actorId,
    appId: auditLogs.appId,
    changes: auditLogs.changes,
    createdAt: auditLogs.createdAt,
    entityId: auditLogs.entityId,
    entityType: auditLogs.entityType,
    id: auditLogs.id,
    ipAddress: auditLogs.ipAddress,
    operation: auditLogs.operation,
    userAgent: auditLogs.userAgent,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const opt = <T>(row: T | undefined): Option.Option<T> => Option.fromNullable(row);
const userIdOrThrow = (asset: Asset): User['id'] => Option.getOrThrow(Option.fromNullable(asset.userId));
const clampCursorLimit = (limit: number | undefined): number => Math.min(Math.max(B.pagination.minLimit, limit ?? B.pagination.defaultLimit), B.pagination.maxLimit);
const firstE = <T>(rows: readonly T[]): Effect.Effect<T, AppError<'Database'>> =>
    pipe(
        Option.fromNullable(rows[0]),
        Option.match({
            onNone: () => Effect.fail(AppError.from('Database', 'NOT_FOUND')),
            onSome: Effect.succeed,
        }),
    );
const clampPagination = (limit: number, offset: number): PaginationResult => {
    const clampedLimit = Math.min(Math.max(B.pagination.minLimit, limit), B.pagination.maxLimit);
    const clampedOffset = Math.min(Math.max(B.pagination.minOffset, offset), B.pagination.maxOffset);
    return {
        clamped: clampedLimit !== limit || clampedOffset !== offset,
        limit: clampedLimit,
        offset: clampedOffset,
        requestedLimit: limit,
        requestedOffset: offset,
    };
};
const buildCursorResult = <T extends { readonly id: string }, C extends string>(
    data: readonly T[], limit: number, direction: CursorDirection,
    getCursor: (item: T) => C, ): CursorPaginationResult<T, C> => {
    const hasMore = data.length > limit;
    const trimmedData = hasMore ? data.slice(0, limit) : data;
    const isForward = direction === 'forward';
    return {
        data: trimmedData,
        hasNextPage: isForward ? hasMore : trimmedData.length > 0,
        hasPreviousPage: isForward ? trimmedData.length > 0 : hasMore,
        limit,
        nextCursor: trimmedData.length > 0 ? getCursor(trimmedData.at(-1) as T) : null,
        previousCursor: trimmedData.length > 0 ? getCursor(trimmedData[0] as T) : null,
    };
};
const findWithCount = <T, E, R>(
    dataQuery: Effect.Effect<readonly T[], E, R>,
    countQuery: Effect.Effect<{ count: number }[], E, R>, ): Effect.Effect<{ data: readonly T[]; total: number }, E, R> =>
    Effect.all({ data: dataQuery, total: countQuery.pipe(Effect.map((rows) => rows[0]?.count ?? 0)) }, { concurrency: 2 });
const withDbOps = <A, E, R>(opName: string, opType: OpType, effect: Effect.Effect<A, E, R>) =>
    Effect.fn(opName)(() =>
        effect.pipe(
            Effect.tap(() => Effect.annotateCurrentSpan('db.operation', opName)),
            Effect.tap(() => Effect.annotateCurrentSpan('db.operation_type', opType)),
            Effect.timeout(B.durations.queryTimeout),
            opType === 'read' ? Effect.retry(B.retry.query) : identity,
            Effect.timed,
            Effect.flatMap(([duration, result]) => MetricsService.trackDbQuery(opName, duration, 'success').pipe(Effect.as(result))),
            Effect.tapError(() => MetricsService.trackDbQuery(opName, Duration.zero, 'error')),
        ),
    )();

// --- [RESOLVERS] -------------------------------------------------------------
// Unified resolver factory: read (findById, grouped) + write (ordered, void), SqlResolver auto-batches concurrent execute() calls into single DB query

const makeResolvers = (db: DrizzleDb) =>
    Effect.all({
        apiKey: SqlResolver.findById('ApiKeyById', {
            execute: (ids) => withDbOps('db.apiKeys.batch', 'read', ids.length === 0 ? Effect.succeed([] as readonly ApiKey[]) : db.query.apiKeys.findMany({ where: inArray(apiKeys.id, ids as ApiKey['id'][]) })),
            Id: IdFactory.ApiKeyId.schema,
            Result: ApiKeyRowSchema,
            ResultId: (row) => row.id,
            withContext: true,
        }),
        apiKeysByUserId: SqlResolver.grouped('ApiKeysByUserId', {
            execute: (userIds) => withDbOps('db.apiKeys.byUserIds', 'read', userIds.length === 0 ? Effect.succeed([] as readonly ApiKey[]) : db.query.apiKeys.findMany({ where: inArray(apiKeys.userId, userIds as User['id'][]) })),
            Request: IdFactory.UserId.schema,
            RequestGroupKey: (userId) => userId,
            Result: ApiKeyRowSchema,
            ResultGroupKey: (apiKey) => apiKey.userId,
            withContext: true,
        }),
        app: SqlResolver.findById('AppById', {
            execute: (ids) => withDbOps('db.apps.batch', 'read', ids.length === 0 ? Effect.succeed([] as readonly App[]) : db.query.apps.findMany({ where: inArray(apps.id, ids as App['id'][]) })),
            Id: IdFactory.AppId.schema,
            Result: AppRowSchema,
            ResultId: (row) => row.id,
            withContext: true,
        }),
        asset: SqlResolver.findById('AssetById', {
            execute: (ids) => withDbOps('db.assets.batch', 'read', ids.length === 0 ? Effect.succeed([] as readonly Asset[]) : db.query.assets.findMany({ where: inArray(assets.id, ids as Asset['id'][]) })),
            Id: IdFactory.AssetId.schema,
            Result: AssetRowSchema,
            ResultId: (row) => row.id,
            withContext: true,
        }),
        assetsByUserId: SqlResolver.grouped('AssetsByUserId', {
            execute: (userIds) => withDbOps('db.assets.byUserIds', 'read', userIds.length === 0 ? Effect.succeed([] as readonly Asset[]) : db.query.assets.findMany({ orderBy: desc(assets.createdAt), where: and(inArray(assets.userId, userIds as User['id'][]), isNull(assets.deletedAt)) })),
            Request: IdFactory.UserId.schema,
            RequestGroupKey: (userId) => userId,
            Result: AssetRowSchema,
            ResultGroupKey: userIdOrThrow,
            withContext: true,
        }),
        insertApiKey: SqlResolver.ordered('ApiKeyInsert', {
            execute: (reqs) => withDbOps('db.apiKeys.insert', 'write', reqs.length === 0 ? Effect.succeed([] as readonly ApiKey[]) : db.insert(apiKeys).values([...reqs] as ApiKeyInsert[]).returning()),
            Request: ApiKeyInsertSchema,
            Result: ApiKeyRowSchema,
            withContext: true,
        }),
        insertApp: SqlResolver.ordered('AppInsert', {
            execute: (reqs) => withDbOps('db.apps.insert', 'write', reqs.length === 0 ? Effect.succeed([] as readonly App[]) : db.insert(apps).values([...reqs] as AppInsert[]).returning()),
            Request: AppInsertSchema,
            Result: AppRowSchema,
            withContext: true,
        }),
        insertAsset: SqlResolver.ordered('AssetInsert', {
            execute: (reqs) => withDbOps('db.assets.insert', 'write', reqs.length === 0 ? Effect.succeed([] as readonly Asset[]) : db.insert(assets).values([...reqs] as AssetInsert[]).returning()),
            Request: AssetInsertSchema,
            Result: AssetRowSchema,
            withContext: true,
        }),
        insertAudit: SqlResolver.ordered('AuditInsert', {
            execute: (logs) => withDbOps('db.audit.insert', 'write', logs.length === 0 ? Effect.succeed([]) : db.insert(auditLogs).values([...logs] as AuditLogInsert[]).returning()),
            Request: AuditLogInsertSchema,
            Result: AuditLogRowSchema,
            withContext: true,
        }),
        insertOAuthAccount: SqlResolver.ordered('OAuthAccountInsert', {
            execute: (reqs) => withDbOps('db.oauthAccounts.insert', 'write', reqs.length === 0 ? Effect.succeed([] as readonly OAuthAccount[]) : db.insert(oauthAccounts).values([...reqs] as OAuthAccountInsert[]).returning()),
            Request: OAuthAccountInsertSchema,
            Result: OAuthAccountRowSchema,
            withContext: true,
        }),
        insertRefreshToken: SqlResolver.ordered('RefreshTokenInsert', {
            execute: (reqs) => withDbOps('db.refreshTokens.insert', 'write', reqs.length === 0 ? Effect.succeed([] as readonly RefreshToken[]) : db.insert(refreshTokens).values([...reqs] as RefreshTokenInsert[]).returning()),
            Request: RefreshTokenInsertSchema,
            Result: RefreshTokenRowSchema,
            withContext: true,
        }),
        insertSession: SqlResolver.ordered('SessionInsert', {
            execute: (reqs) => withDbOps('db.sessions.insert', 'write', reqs.length === 0 ? Effect.succeed([] as readonly Session[]) : db.insert(sessions).values([...reqs] as SessionInsert[]).returning()),
            Request: SessionInsertSchema,
            Result: SessionRowSchema,
            withContext: true,
        }),
        insertUser: SqlResolver.ordered('UserInsert', {
            execute: (reqs) => withDbOps('db.users.insert', 'write', reqs.length === 0 ? Effect.succeed([] as readonly User[]) : db.insert(users).values([...reqs] as UserInsert[]).returning()),
            Request: UserInsertSchema,
            Result: UserRowSchema,
            withContext: true,
        }),
        session: SqlResolver.findById('SessionById', {
            execute: (ids) => withDbOps('db.sessions.batch', 'read', ids.length === 0 ? Effect.succeed([] as readonly Session[]) : db.query.sessions.findMany({ where: inArray(sessions.id, ids as Session['id'][]) })),
            Id: IdFactory.SessionId.schema,
            Result: SessionRowSchema,
            ResultId: (row) => row.id,
            withContext: true,
        }),
        sessionsByUserId: SqlResolver.grouped('SessionsByUserId', {
            execute: (userIds) => withDbOps('db.sessions.byUserIds', 'read', userIds.length === 0 ? Effect.succeed([] as readonly Session[]) : db.query.sessions.findMany({ where: and(inArray(sessions.userId, userIds as User['id'][]), isNull(sessions.revokedAt)) })),
            Request: IdFactory.UserId.schema,
            RequestGroupKey: (userId) => userId,
            Result: SessionRowSchema,
            ResultGroupKey: (session) => session.userId,
            withContext: true,
        }),
        user: SqlResolver.findById('UserById', {
            execute: (ids) => withDbOps('db.users.batch', 'read', ids.length === 0 ? Effect.succeed([] as readonly User[]) : db.query.users.findMany({ where: inArray(users.id, ids as User['id'][]) })),
            Id: IdFactory.UserId.schema,
            Result: UserRowSchema,
            ResultId: (row) => row.id,
            withContext: true,
        }),
    });

// --- [REPOSITORIES] ----------------------------------------------------------

const makeAppRepo = (db: DrizzleDb, resolver: Resolvers['app']) => ({
    create: (data: AppInsert) => withDbOps('db.apps.create', 'write', db.insert(apps).values(data).returning()).pipe(Effect.flatMap(firstE)),
    findById: resolver.execute,
    findBySlug: (slug: string) => withDbOps('db.apps.findBySlug', 'read', db.query.apps.findFirst({ where: eq(apps.slug, slug) })).pipe(Effect.map(opt)),
    updateSettings: (id: App['id'], settings: Record<string, unknown>) => withDbOps('db.apps.updateSettings', 'write', db.update(apps).set({ settings }).where(eq(apps.id, id)).returning()).pipe(Effect.map((rows) => opt(rows[0]))),
});
const makeUserRepo = (db: DrizzleDb, resolver: Resolvers['user']) => ({
    delete: (id: User['id']) => withDbOps('db.users.delete', 'delete', db.delete(users).where(eq(users.id, id))).pipe(Effect.asVoid),
    findActiveByAppAndEmail: (appId: App['id'], email: string) => withDbOps('db.users.findActiveByAppAndEmail', 'read', db.query.users.findFirst({ where: and(eq(users.appId, appId), eq(users.email, email), isNull(users.deletedAt)) })).pipe(Effect.map(opt)),
    findByAppAndEmail: (appId: App['id'], email: string) => withDbOps('db.users.findByAppAndEmail', 'read', db.query.users.findFirst({ where: and(eq(users.appId, appId), eq(users.email, email)) })).pipe(Effect.map(opt)),
    findById: resolver.execute,
    findByIdWithApiKeys: (id: User['id']) => withDbOps('db.users.findByIdWithApiKeys', 'read', db.query.users.findFirst({ where: eq(users.id, id), with: { apiKeys: true } })).pipe(Effect.map((r) => opt(r as UserWithApiKeys | undefined))),
    findByIdWithOAuthAccounts: (id: User['id']) => withDbOps('db.users.findByIdWithOAuthAccounts', 'read', db.query.users.findFirst({ where: eq(users.id, id), with: { oauthAccounts: true } })).pipe(Effect.map((r) => opt(r as UserWithOAuthAccounts | undefined))),
    findByIdWithSessions: (id: User['id']) => withDbOps('db.users.findByIdWithSessions', 'read', db.query.users.findFirst({ where: eq(users.id, id), with: { sessions: { where: isNull(sessions.revokedAt) } } })).pipe(Effect.map((r) => opt(r as UserWithSessions | undefined))),
    insert: (data: UserInsert) => withDbOps('db.users.insert', 'write', db.insert(users).values(data).returning()).pipe(Effect.flatMap(firstE)),
    restore: (id: User['id']) => withDbOps('db.users.restore', 'write', db.update(users).set({ deletedAt: null }).where(eq(users.id, id))).pipe(Effect.asVoid),
    softDelete: (id: User['id']) => withDbOps('db.users.softDelete', 'write', db.update(users).set({ deletedAt: sql`now()` }).where(eq(users.id, id))).pipe(Effect.asVoid),
    update: (id: User['id'], data: Partial<UserInsert>) => withDbOps('db.users.update', 'write', db.update(users).set(data).where(eq(users.id, id)).returning()).pipe(Effect.map((rows) => opt(rows[0]))),
});
const makeSessionRepo = (db: DrizzleDb, resolver: Resolvers['session']) => ({
    delete: (id: Session['id']) => withDbOps('db.sessions.delete', 'delete', db.delete(sessions).where(eq(sessions.id, id))).pipe(Effect.asVoid),
    findById: resolver.execute,
    findValidByTokenHash: (hash: Hex64) => withDbOps('db.sessions.findValidByTokenHash', 'read', db.query.sessions.findFirst({ where: and(eq(sessions.tokenHash, hash), gt(sessions.expiresAt, sql`now()`), isNull(sessions.revokedAt)) })).pipe(Effect.map(opt)),
    findValidByTokenHashWithUser: (hash: Hex64) => withDbOps('db.sessions.findValidByTokenHashWithUser', 'read', db.query.sessions.findFirst({ where: and(eq(sessions.tokenHash, hash), gt(sessions.expiresAt, sql`now()`), isNull(sessions.revokedAt)), with: { user: true } })).pipe(Effect.map((r) => opt(r as SessionWithUser | undefined))),
    insert: (data: SessionInsert) => withDbOps('db.sessions.insert', 'write', db.insert(sessions).values(data).returning()).pipe(Effect.flatMap(firstE)),
    markMfaVerified: (id: Session['id']) => withDbOps('db.sessions.markMfaVerified', 'write', db.update(sessions).set({ mfaVerifiedAt: sql`now()` }).where(eq(sessions.id, id))).pipe(Effect.asVoid),
    revoke: (id: Session['id']) => withDbOps('db.sessions.revoke', 'write', db.update(sessions).set({ revokedAt: sql`now()` }).where(eq(sessions.id, id))).pipe(Effect.asVoid),
    revokeAllByUserId: (userId: User['id']) => withDbOps('db.sessions.revokeAllByUserId', 'write', db.update(sessions).set({ revokedAt: sql`now()` }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))).pipe(Effect.asVoid),
    updateLastActivity: (id: Session['id']) => withDbOps('db.sessions.updateLastActivity', 'write', db.update(sessions).set({ lastActivityAt: sql`now()` }).where(eq(sessions.id, id))).pipe(Effect.asVoid),
});
const makeApiKeyRepo = (db: DrizzleDb, resolver: Resolvers['apiKey']) => ({
    delete: (id: ApiKey['id']) => withDbOps('db.apiKeys.delete', 'delete', db.delete(apiKeys).where(eq(apiKeys.id, id))).pipe(Effect.asVoid),
    findAllByUserId: (userId: User['id']) => withDbOps('db.apiKeys.findAllByUserId', 'read', db.query.apiKeys.findMany({ where: eq(apiKeys.userId, userId) })),
    findById: resolver.execute,
    findByIdAndUserId: (id: ApiKey['id'], userId: User['id']) => withDbOps('db.apiKeys.findByIdAndUserId', 'read', db.query.apiKeys.findFirst({ where: and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)) })).pipe(Effect.map(opt)),
    findByUserIdAndProvider: (userId: User['id'], provider: ApiKey['provider']) => withDbOps('db.apiKeys.findByUserIdAndProvider', 'read', db.query.apiKeys.findFirst({ where: and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider), or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, sql`now()`))) })).pipe(Effect.map(opt)),
    findValidByKeyHash: (hash: Hex64) => withDbOps('db.apiKeys.findValidByKeyHash', 'read', db.query.apiKeys.findFirst({ where: and(eq(apiKeys.keyHash, hash), or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, sql`now()`))) })).pipe(Effect.map(opt)),
    insert: (data: ApiKeyInsert) => withDbOps('db.apiKeys.insert', 'write', db.insert(apiKeys).values(data).returning()).pipe(Effect.flatMap(firstE)),
    updateLastUsed: (id: ApiKey['id']) => withDbOps('db.apiKeys.updateLastUsed', 'write', db.update(apiKeys).set({ lastUsedAt: sql`now()` }).where(eq(apiKeys.id, id))).pipe(Effect.asVoid),
});
const makeOAuthAccountRepo = (db: DrizzleDb) => ({
    delete: (id: OAuthAccount['id']) => withDbOps('db.oauthAccounts.delete', 'delete', db.delete(oauthAccounts).where(eq(oauthAccounts.id, id))).pipe(Effect.asVoid),
    deleteByProvider: (provider: OAuthAccount['provider'], providerAccountId: string) => withDbOps('db.oauthAccounts.deleteByProvider', 'delete', db.delete(oauthAccounts).where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerAccountId, providerAccountId)))).pipe(Effect.asVoid),
    findAllByUserId: (userId: User['id']) => withDbOps('db.oauthAccounts.findAllByUserId', 'read', db.query.oauthAccounts.findMany({ where: eq(oauthAccounts.userId, userId) })),
    findById: (id: OAuthAccount['id']) => withDbOps('db.oauthAccounts.findById', 'read', db.query.oauthAccounts.findFirst({ where: eq(oauthAccounts.id, id) })).pipe(Effect.map(opt)),
    findByProviderAccountId: (provider: OAuthAccount['provider'], providerAccountId: string) => withDbOps('db.oauthAccounts.findByProviderAccountId', 'read', db.query.oauthAccounts.findFirst({ where: and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerAccountId, providerAccountId)) })).pipe(Effect.map(opt)),
    insert: (data: OAuthAccountInsert) => withDbOps('db.oauthAccounts.insert', 'write', db.insert(oauthAccounts).values(data).returning()).pipe(Effect.flatMap(firstE)),
    upsert: (data: OAuthAccountInsert) => withDbOps('db.oauthAccounts.upsert', 'write', db.insert(oauthAccounts).values(data).onConflictDoUpdate({ set: { accessTokenEncrypted: data.accessTokenEncrypted, accessTokenExpiresAt: data.accessTokenExpiresAt, refreshTokenEncrypted: data.refreshTokenEncrypted, updatedAt: sql`now()` }, target: [oauthAccounts.provider, oauthAccounts.providerAccountId] }).returning()).pipe(Effect.flatMap(firstE)),
});
const makeRefreshTokenRepo = (db: DrizzleDb) => ({
    delete: (id: RefreshToken['id']) => withDbOps('db.refreshTokens.delete', 'delete', db.delete(refreshTokens).where(eq(refreshTokens.id, id))).pipe(Effect.asVoid),
    findById: (id: RefreshToken['id']) => withDbOps('db.refreshTokens.findById', 'read', db.query.refreshTokens.findFirst({ where: eq(refreshTokens.id, id) })).pipe(Effect.map(opt)),
    findValidByTokenHash: (hash: Hex64) => withDbOps('db.refreshTokens.findValidByTokenHash', 'read', db.query.refreshTokens.findFirst({ where: and(eq(refreshTokens.tokenHash, hash), gt(refreshTokens.expiresAt, sql`now()`), isNull(refreshTokens.revokedAt)) })).pipe(Effect.map(opt)),
    insert: (data: RefreshTokenInsert) => withDbOps('db.refreshTokens.insert', 'write', db.insert(refreshTokens).values(data).returning()).pipe(Effect.flatMap(firstE)),
    revoke: (id: RefreshToken['id']) => withDbOps('db.refreshTokens.revoke', 'write', db.update(refreshTokens).set({ revokedAt: sql`now()` }).where(eq(refreshTokens.id, id))).pipe(Effect.asVoid),
    revokeAllByUserId: (userId: User['id']) => withDbOps('db.refreshTokens.revokeAllByUserId', 'write', db.update(refreshTokens).set({ revokedAt: sql`now()` }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))).pipe(Effect.asVoid),
});
const makeAssetRepo = (db: DrizzleDb, resolvers: Resolvers) => ({
    countByUserId: (userId: User['id']) => withDbOps('db.assets.countByUserId', 'read', db.select({ count: sql<number>`count(*)::int` }).from(assets).where(and(eq(assets.userId, userId), isNull(assets.deletedAt)))).pipe( Effect.map((rows) => rows[0]?.count ?? 0), ),
    delete: (id: Asset['id'], appId: App['id']) => withDbOps('db.assets.delete', 'delete', db.delete(assets).where(and(eq(assets.id, id), eq(assets.appId, appId)))).pipe(Effect.asVoid),
    findAllByUserId: (userId: User['id'], limit: number, offset: number) => {
        const clamped = clampPagination(limit, offset);
        return withDbOps('db.assets.findAllByUserId', 'read', db.query.assets.findMany({ limit: clamped.limit, offset: clamped.offset, orderBy: desc(assets.createdAt), where: and(eq(assets.userId, userId), isNull(assets.deletedAt)) }));
    },
    findAllByUserIdCursor: (userId: User['id'], input: CursorPaginationInput<Asset['id']>) => {
        const limit = clampCursorLimit(input.limit);
        const direction = input.direction ?? 'forward';
        const baseWhere = and(eq(assets.userId, userId), isNull(assets.deletedAt));
        const cursorCondition = input.cursor
            ? direction === 'forward'
                ? and(baseWhere, gt(assets.id, input.cursor))
                : and(baseWhere, lte(assets.id, input.cursor))
            : baseWhere;
        return withDbOps( 'db.assets.findAllByUserIdCursor', 'read',
            db.query.assets.findMany({
                limit: limit + 1, // Fetch one extra to detect hasMore
                orderBy: direction === 'forward' ? [assets.id] : [desc(assets.id)],
                where: cursorCondition,
            }),
        ).pipe( Effect.map((rows) => buildCursorResult(rows, limit, direction, (a) => a.id)), );
    },
    findById: resolvers.asset.execute,
    insert: (data: AssetInsert) => resolvers.insertAsset.execute(data as S.Schema.Type<typeof AssetInsertSchema>),
    /** Batch insert with single query. Returns all created assets. */
    insertMany: (items: readonly AssetInsert[]) =>
        withDbOps( 'db.assets.insertMany', 'write',
            items.length === 0
                ? Effect.succeed([] as Asset[])
                : db.insert(assets).values([...items]).returning(),
        ),
    restore: (id: Asset['id'], appId: App['id']) => withDbOps('db.assets.restore', 'write', db.update(assets).set({ deletedAt: null, updatedAt: sql`now()` }).where(and(eq(assets.id, id), eq(assets.appId, appId)))).pipe(Effect.asVoid),
    softDelete: (id: Asset['id'], appId: App['id']) => withDbOps('db.assets.softDelete', 'write', db.update(assets).set({ deletedAt: sql`now()`, updatedAt: sql`now()` }).where(and(eq(assets.id, id), eq(assets.appId, appId)))).pipe(Effect.asVoid),
    streamByUserId: (userId: User['id'], batchSize = 1000) => Stream.paginateChunkEffect(0, (offset) => db.query.assets.findMany({ limit: batchSize, offset, orderBy: desc(assets.createdAt), where: and(eq(assets.userId, userId), isNull(assets.deletedAt)) }).pipe(Effect.timeout(B.durations.queryTimeout), Effect.retry(B.retry.query), Effect.map((rows) => [Chunk.fromIterable(rows), rows.length < batchSize ? Option.none() : Option.some(offset + batchSize)]))),
    update: (id: Asset['id'], appId: App['id'], data: Partial<AssetInsert>) => withDbOps('db.assets.update', 'write', db.update(assets).set({ ...data, updatedAt: sql`now()` }).where(and(eq(assets.id, id), eq(assets.appId, appId))).returning()).pipe( Effect.map((rows) => opt(rows[0])), ),
});
const buildAuditFilters = (appId: App['id'], base: readonly ReturnType<typeof eq>[], filter: AuditFilter) => {
    const conditions = [...base, eq(auditLogs.appId, appId)];
    filter.after && conditions.push(gte(auditLogs.createdAt, filter.after));
    filter.before && conditions.push(lte(auditLogs.createdAt, filter.before));
    filter.operation && conditions.push(eq(auditLogs.operation, filter.operation));
    return and(...conditions);
};
const makeAuditRepo = (db: DrizzleDb, resolvers: Resolvers) => ({
    findByActor: (appId: App['id'], actorId: User['id'], limit: number, offset: number, filter: AuditFilter = {}) => {
        const pagination = clampPagination(limit, offset);
        const whereClause = buildAuditFilters(appId, [eq(auditLogs.actorId, actorId)], filter);
        const dataQuery = withDbOps('db.audit.findByActor', 'read',
            db.select({ ...allAuditFields }).from(auditLogs)
              .where(whereClause).orderBy(desc(auditLogs.createdAt))
              .limit(pagination.limit).offset(pagination.offset),
        );
        const countQuery = withDbOps('db.audit.findByActor.count', 'read', db.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(whereClause), );
        return findWithCount(dataQuery, countQuery).pipe( Effect.map(({ data, total }) => ({ clamped: pagination.clamped, data, limit: pagination.limit, offset: pagination.offset, total })), );
    },
    findByEntity: (appId: App['id'], entityType: AuditLog['entityType'], entityId: string, limit: number, offset: number, filter: AuditFilter = {}) => {
        const pagination = clampPagination(limit, offset);
        const whereClause = buildAuditFilters(appId, [eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)], filter);
        const dataQuery = withDbOps('db.audit.findByEntity', 'read',
            db.select({ ...allAuditFields }).from(auditLogs)
              .where(whereClause).orderBy(desc(auditLogs.createdAt))
              .limit(pagination.limit).offset(pagination.offset),
        );
        const countQuery = withDbOps('db.audit.findByEntity.count', 'read', db.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(whereClause), );
        return findWithCount(dataQuery, countQuery).pipe( Effect.map(({ data, total }) => ({ clamped: pagination.clamped, data, limit: pagination.limit, offset: pagination.offset, total })), );
    },
    log: (data: AuditLogInsert) => resolvers.insertAudit.execute(data as S.Schema.Type<typeof AuditLogInsertSchema>),
});
const makeMfaSecretsRepo = (db: DrizzleDb) => ({
    delete: (userId: User['id']) => withDbOps('db.mfaSecrets.delete', 'delete', db.delete(mfaSecrets).where(eq(mfaSecrets.userId, userId))).pipe(Effect.asVoid),
    findByUserId: (userId: User['id']) => withDbOps('db.mfaSecrets.findByUserId', 'read', db.query.mfaSecrets.findFirst({ where: eq(mfaSecrets.userId, userId) })).pipe(Effect.map(opt)),
    upsert: (data: MfaSecretInsert) => withDbOps('db.mfaSecrets.upsert', 'write', db.insert(mfaSecrets).values(data).onConflictDoUpdate({ set: { backupCodesHash: data.backupCodesHash, enabledAt: data.enabledAt, secretEncrypted: data.secretEncrypted }, target: mfaSecrets.userId }).returning()).pipe(Effect.flatMap(firstE)),
});

// --- [DERIVED_TYPES] ---------------------------------------------------------

type AppRepository = ReturnType<typeof makeAppRepo>;
type UserRepository = ReturnType<typeof makeUserRepo>;
type SessionRepository = ReturnType<typeof makeSessionRepo>;
type ApiKeyRepository = ReturnType<typeof makeApiKeyRepo>;
type OAuthAccountRepository = ReturnType<typeof makeOAuthAccountRepo>;
type RefreshTokenRepository = ReturnType<typeof makeRefreshTokenRepo>;
type AssetRepository = ReturnType<typeof makeAssetRepo>;
type AuditRepository = ReturnType<typeof makeAuditRepo>;
type MfaSecretsRepository = ReturnType<typeof makeMfaSecretsRepo>;
type DatabaseServiceShape = {
    readonly apiKeys: ApiKeyRepository;
    readonly apps: AppRepository;
    readonly assets: AssetRepository;
    readonly audit: AuditRepository;
    readonly mfaSecrets: MfaSecretsRepository;
    readonly oauthAccounts: OAuthAccountRepository;
    readonly refreshTokens: RefreshTokenRepository;
    readonly sessions: SessionRepository;
    readonly users: UserRepository;
    readonly withTransaction: WithTransaction;
};

// --- [SERVICES] --------------------------------------------------------------

class DatabaseService extends Effect.Service<DatabaseService>()('database/DatabaseService', {
    dependencies: [MetricsService.Default],
    effect: Effect.gen(function* () {
        const db = yield* Drizzle;
        const sqlClient = yield* SqlClient;
        const resolvers = yield* makeResolvers(db);
        return {
            apiKeys: makeApiKeyRepo(db, resolvers.apiKey),
            apps: makeAppRepo(db, resolvers.app),
            assets: makeAssetRepo(db, resolvers),
            audit: makeAuditRepo(db, resolvers),
            mfaSecrets: makeMfaSecretsRepo(db),
            oauthAccounts: makeOAuthAccountRepo(db),
            refreshTokens: makeRefreshTokenRepo(db),
            sessions: makeSessionRepo(db, resolvers.session),
            users: makeUserRepo(db, resolvers.user),
            withTransaction: sqlClient.withTransaction,
        };
    }),
}) {
    static readonly layer = this.Default.pipe(Layer.provide(Drizzle.Default), Layer.provide(PgLive), Layer.provide(MetricsService.layer));
}

// --- [EXPORT] ----------------------------------------------------------------

export { DatabaseService };
export type {
    ApiKeyRepository, AppRepository, AssetRepository, AuditFilter, AuditRepository, AuditWithCount, CursorDirection, CursorPaginationInput, CursorPaginationResult, DatabaseServiceShape, MfaSecretsRepository, OAuthAccountRepository, PaginationResult, RefreshTokenRepository, SessionRepository,
    UserRepository, WithTransaction,
};
