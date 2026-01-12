/**
 * DatabaseService via Effect.Service with SqlResolver batching.
 * Uses relational query API (findFirst/findMany) + auto-batched findById.
 * Supports eager loading via Drizzle 'with' clause.
 * Batch operations via SqlResolver.ordered for INSERT RETURNING.
 */
import { SqlClient } from '@effect/sql/SqlClient';
import type { SqlError } from '@effect/sql/SqlError';
import * as SqlResolver from '@effect/sql/SqlResolver';
import { MetricsService } from '@parametric-portal/server/metrics';
import { type ApiKey, type ApiKeyInsert, ApiKeyInsertSchema, ApiKeyRowSchema, type Asset, type AssetInsert, AssetInsertSchema, AssetRowSchema, type AuditLogInsert, AuditLogInsertSchema, AuditLogRowSchema, apiKeys, assets, auditLogs, IdFactory, type OAuthAccount, type OAuthAccountInsert, OAuthAccountInsertSchema, OAuthAccountRowSchema, oauthAccounts, type RefreshToken, type RefreshTokenInsert, RefreshTokenInsertSchema, RefreshTokenRowSchema, refreshTokens, type Session, type SessionInsert, SessionInsertSchema, SessionRowSchema, type SessionWithUser, sessions, type User, type UserInsert, UserInsertSchema, UserRowSchema, type UserWithApiKeys, type UserWithOAuthAccounts, type UserWithSessions, users } from '@parametric-portal/types/schema';
import type { Hex64 } from '@parametric-portal/types/types';
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { Chunk, type Context, Duration, Effect, identity, Layer, Metric, Option, type Schema as S, Stream } from 'effect';
import { DATABASE_TUNING, Drizzle, PgLive } from './client.ts';

// --- [TYPES] -----------------------------------------------------------------

type DrizzleDb = Context.Tag.Service<typeof Drizzle>;
type OpType = 'read' | 'write' | 'delete';
type WithTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | SqlError, R>;
type Resolvers = Effect.Effect.Success<ReturnType<typeof makeResolvers>>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({ ...DATABASE_TUNING } as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const opt = <T>(row: T | undefined): Option.Option<T> => Option.fromNullable(row);
/** Extract first row from INSERT RETURNING (always non-empty for single-row insert); throws if empty (programming error) */
const first = <T>(rows: readonly T[]): T => Option.getOrThrow(Option.fromNullable(rows[0]));
/** SqlResolver.grouped requires sync callback; getOrThrow is data integrity guard (userId filtered in WHERE clause) */
const userIdOrThrow = (asset: Asset): User['id'] => Option.getOrThrow(Option.fromNullable(asset.userId));
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
/**
 * Wraps SqlResolver execute function to track batch coalescing efficiency. Captures: batch size, deduplication ratio, query execution timing.
 * Emits N+1 warnings for single-item batches via MetricsService.
 * Note: This wrapper intercepts the execute function BEFORE it reaches SqlResolver, tracking the batch that SqlResolver creates from coalesced requests.
 */
const withResolverTracing = <T extends readonly unknown[], R extends readonly unknown[], E>(
    resolverName: string,
    execute: (requests: T) => Effect.Effect<R, E, MetricsService>,
): ((requests: T) => Effect.Effect<R, E, MetricsService>) =>
    (requests: T) =>
        Effect.flatMap(
            Effect.Do,
            () => {
                const originalCount = requests.length;
                const uniqueCount = new Set(requests.map((r) => JSON.stringify(r))).size;
                return execute(requests).pipe(
                    Effect.tap(() => Effect.annotateCurrentSpan('resolver.name', resolverName)),
                    Effect.tap(() => Effect.annotateCurrentSpan('resolver.original_requests', originalCount)),
                    Effect.tap(() => Effect.annotateCurrentSpan('resolver.batch_size', uniqueCount)),
                    Effect.tap(() => Effect.annotateCurrentSpan('resolver.deduplication_ratio', originalCount > 0 ? ((originalCount - uniqueCount) / originalCount).toFixed(2) : '0')),
                    Effect.tap(() => originalCount === 1 ? Effect.annotateCurrentSpan('resolver.n1_warning', true) : Effect.void),
                    Effect.timed,
                    Effect.flatMap(([duration, result]) =>
                        Effect.gen(function* () {
                            yield* Effect.annotateCurrentSpan('resolver.duration_ms', Duration.toMillis(duration));
                            yield* MetricsService.trackBatchCoalesce(resolverName, originalCount, uniqueCount, duration);
                            return result;
                        }),
                    ),
                    Effect.withSpan(`resolver.${resolverName}`),
                );
            },
        );

// --- [RESOLVERS] -------------------------------------------------------------
// Unified resolver factory: read (findById, grouped) + write (ordered, void), SqlResolver auto-batches concurrent execute() calls into single DB query

const makeResolvers = (db: DrizzleDb) =>
    Effect.all({
        // READ: findById resolvers
        apiKey: SqlResolver.findById('ApiKeyById', {
            execute: withResolverTracing('ApiKeyById', (ids) => withDbOps('db.apiKeys.batch', 'read', ids.length === 0 ? Effect.succeed([] as readonly ApiKey[]) : db.query.apiKeys.findMany({ where: inArray(apiKeys.id, ids as ApiKey['id'][]) }))),
            Id: IdFactory.ApiKeyId.schema,
            Result: ApiKeyRowSchema,
            ResultId: (row) => row.id,
            withContext: true,
        }),
        // READ: grouped resolvers
        apiKeysByUserId: SqlResolver.grouped('ApiKeysByUserId', {
            execute: withResolverTracing('ApiKeysByUserId', (userIds) => withDbOps('db.apiKeys.byUserIds', 'read', userIds.length === 0 ? Effect.succeed([] as readonly ApiKey[]) : db.query.apiKeys.findMany({ where: inArray(apiKeys.userId, userIds as User['id'][]) }))),
            Request: IdFactory.UserId.schema,
            RequestGroupKey: (userId) => userId,
            Result: ApiKeyRowSchema,
            ResultGroupKey: (apiKey) => apiKey.userId,
            withContext: true,
        }),
        asset: SqlResolver.findById('AssetById', {
            execute: withResolverTracing('AssetById', (ids) => withDbOps('db.assets.batch', 'read', ids.length === 0 ? Effect.succeed([] as readonly Asset[]) : db.query.assets.findMany({ where: inArray(assets.id, ids as Asset['id'][]) }))),
            Id: IdFactory.AssetId.schema,
            Result: AssetRowSchema,
            ResultId: (row) => row.id,
            withContext: true,
        }),
        assetsByUserId: SqlResolver.grouped('AssetsByUserId', {
            execute: withResolverTracing('AssetsByUserId', (userIds) => withDbOps('db.assets.byUserIds', 'read', userIds.length === 0 ? Effect.succeed([] as readonly Asset[]) : db.query.assets.findMany({ orderBy: desc(assets.createdAt), where: and(inArray(assets.userId, userIds as User['id'][]), isNull(assets.deletedAt)) }))),
            Request: IdFactory.UserId.schema,
            RequestGroupKey: (userId) => userId,
            Result: AssetRowSchema,
            ResultGroupKey: userIdOrThrow,
            withContext: true,
        }),
        // WRITE: ordered resolvers (INSERT RETURNING - auto-batched)
        insertApiKey: SqlResolver.ordered('ApiKeyInsert', {
            execute: withResolverTracing('ApiKeyInsert', (reqs) => withDbOps('db.apiKeys.insert', 'write', reqs.length === 0 ? Effect.succeed([] as readonly ApiKey[]) : db.insert(apiKeys).values([...reqs] as ApiKeyInsert[]).returning())),
            Request: ApiKeyInsertSchema,
            Result: ApiKeyRowSchema,
            withContext: true,
        }),
        insertAsset: SqlResolver.ordered('AssetInsert', {
            execute: withResolverTracing('AssetInsert', (reqs) => withDbOps('db.assets.insert', 'write', reqs.length === 0 ? Effect.succeed([] as readonly Asset[]) : db.insert(assets).values([...reqs] as AssetInsert[]).returning())),
            Request: AssetInsertSchema,
            Result: AssetRowSchema,
            withContext: true,
        }),
        // WRITE: ordered resolver for audit (INSERT RETURNING - auto-batched)
        insertAudit: SqlResolver.ordered('AuditInsert', {
            execute: withResolverTracing('AuditInsert', (logs) => withDbOps('db.audit.insert', 'write', logs.length === 0 ? Effect.succeed([]) : db.insert(auditLogs).values([...logs] as AuditLogInsert[]).returning())),
            Request: AuditLogInsertSchema,
            Result: AuditLogRowSchema,
            withContext: true,
        }),
        insertOAuthAccount: SqlResolver.ordered('OAuthAccountInsert', {
            execute: withResolverTracing('OAuthAccountInsert', (reqs) => withDbOps('db.oauthAccounts.insert', 'write', reqs.length === 0 ? Effect.succeed([] as readonly OAuthAccount[]) : db.insert(oauthAccounts).values([...reqs] as OAuthAccountInsert[]).returning())),
            Request: OAuthAccountInsertSchema,
            Result: OAuthAccountRowSchema,
            withContext: true,
        }),
        insertRefreshToken: SqlResolver.ordered('RefreshTokenInsert', {
            execute: withResolverTracing('RefreshTokenInsert', (reqs) => withDbOps('db.refreshTokens.insert', 'write', reqs.length === 0 ? Effect.succeed([] as readonly RefreshToken[]) : db.insert(refreshTokens).values([...reqs] as RefreshTokenInsert[]).returning())),
            Request: RefreshTokenInsertSchema,
            Result: RefreshTokenRowSchema,
            withContext: true,
        }),
        insertSession: SqlResolver.ordered('SessionInsert', {
            execute: withResolverTracing('SessionInsert', (reqs) => withDbOps('db.sessions.insert', 'write', reqs.length === 0 ? Effect.succeed([] as readonly Session[]) : db.insert(sessions).values([...reqs] as SessionInsert[]).returning())),
            Request: SessionInsertSchema,
            Result: SessionRowSchema,
            withContext: true,
        }),
        insertUser: SqlResolver.ordered('UserInsert', {
            execute: withResolverTracing('UserInsert', (reqs) => withDbOps('db.users.insert', 'write', reqs.length === 0 ? Effect.succeed([] as readonly User[]) : db.insert(users).values([...reqs] as UserInsert[]).returning())),
            Request: UserInsertSchema,
            Result: UserRowSchema,
            withContext: true,
        }),
        session: SqlResolver.findById('SessionById', {
            execute: withResolverTracing('SessionById', (ids) => withDbOps('db.sessions.batch', 'read', ids.length === 0 ? Effect.succeed([] as readonly Session[]) : db.query.sessions.findMany({ where: inArray(sessions.id, ids as Session['id'][]) }))),
            Id: IdFactory.SessionId.schema,
            Result: SessionRowSchema,
            ResultId: (row) => row.id,
            withContext: true,
        }),
        sessionsByUserId: SqlResolver.grouped('SessionsByUserId', {
            execute: withResolverTracing('SessionsByUserId', (userIds) => withDbOps('db.sessions.byUserIds', 'read', userIds.length === 0 ? Effect.succeed([] as readonly Session[]) : db.query.sessions.findMany({ where: and(inArray(sessions.userId, userIds as User['id'][]), isNull(sessions.revokedAt)) }))),
            Request: IdFactory.UserId.schema,
            RequestGroupKey: (userId) => userId,
            Result: SessionRowSchema,
            ResultGroupKey: (session) => session.userId,
            withContext: true,
        }),
        user: SqlResolver.findById('UserById', {
            execute: withResolverTracing('UserById', (ids) => withDbOps('db.users.batch', 'read', ids.length === 0 ? Effect.succeed([] as readonly User[]) : db.query.users.findMany({ where: inArray(users.id, ids as User['id'][]) }))),
            Id: IdFactory.UserId.schema,
            Result: UserRowSchema,
            ResultId: (row) => row.id,
            withContext: true,
        }),
    });

// --- [REPOSITORIES] ----------------------------------------------------------

const makeUserRepo = (db: DrizzleDb, resolver: Resolvers['user']) => ({
    delete: (id: User['id']) => withDbOps('db.users.delete', 'delete', db.delete(users).where(eq(users.id, id))).pipe(Effect.asVoid),
    findActiveByEmail: (email: string) => withDbOps('db.users.findActiveByEmail', 'read', db.query.users.findFirst({ where: and(eq(users.email, email), isNull(users.deletedAt)) })).pipe(Effect.map(opt)),
    findByEmail: (email: string) => withDbOps('db.users.findByEmail', 'read', db.query.users.findFirst({ where: eq(users.email, email) })).pipe(Effect.map(opt)),
    findById: resolver.execute,
    findByIdWithApiKeys: (id: User['id']) => withDbOps('db.users.findByIdWithApiKeys', 'read', db.query.users.findFirst({ where: eq(users.id, id), with: { apiKeys: true } })).pipe(Effect.map((r) => opt(r as UserWithApiKeys | undefined))),
    findByIdWithOAuthAccounts: (id: User['id']) => withDbOps('db.users.findByIdWithOAuthAccounts', 'read', db.query.users.findFirst({ where: eq(users.id, id), with: { oauthAccounts: true } })).pipe(Effect.map((r) => opt(r as UserWithOAuthAccounts | undefined))),
    findByIdWithSessions: (id: User['id']) => withDbOps('db.users.findByIdWithSessions', 'read', db.query.users.findFirst({ where: eq(users.id, id), with: { sessions: { where: isNull(sessions.revokedAt) } } })).pipe(Effect.map((r) => opt(r as UserWithSessions | undefined))),
    insert: (data: UserInsert) => withDbOps('db.users.insert', 'write', db.insert(users).values(data).returning()).pipe(Effect.map(first)),
    restore: (id: User['id']) => withDbOps('db.users.restore', 'write', db.update(users).set({ deletedAt: null }).where(eq(users.id, id))).pipe(Effect.asVoid),
    softDelete: (id: User['id']) => withDbOps('db.users.softDelete', 'write', db.update(users).set({ deletedAt: sql`now()` }).where(eq(users.id, id))).pipe(Effect.asVoid),
    update: (id: User['id'], data: Partial<UserInsert>) => withDbOps('db.users.update', 'write', db.update(users).set(data).where(eq(users.id, id)).returning()).pipe(Effect.map((rows) => opt(rows[0]))),
});
const makeSessionRepo = (db: DrizzleDb, resolver: Resolvers['session']) => ({
    delete: (id: Session['id']) => withDbOps('db.sessions.delete', 'delete', db.delete(sessions).where(eq(sessions.id, id))).pipe(Effect.asVoid),
    findById: resolver.execute,
    findValidByTokenHash: (hash: Hex64) => withDbOps('db.sessions.findValidByTokenHash', 'read', db.query.sessions.findFirst({ where: and(eq(sessions.tokenHash, hash), gt(sessions.expiresAt, sql`now()`), isNull(sessions.revokedAt)) })).pipe(Effect.map(opt)),
    findValidByTokenHashWithUser: (hash: Hex64) => withDbOps('db.sessions.findValidByTokenHashWithUser', 'read', db.query.sessions.findFirst({ where: and(eq(sessions.tokenHash, hash), gt(sessions.expiresAt, sql`now()`), isNull(sessions.revokedAt)), with: { user: true } })).pipe(Effect.map((r) => opt(r as SessionWithUser | undefined))),
    insert: (data: SessionInsert) => withDbOps('db.sessions.insert', 'write', db.insert(sessions).values(data).returning()).pipe(Effect.map(first)),
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
    insert: (data: ApiKeyInsert) => withDbOps('db.apiKeys.insert', 'write', db.insert(apiKeys).values(data).returning()).pipe(Effect.map(first)),
    updateLastUsed: (id: ApiKey['id']) => withDbOps('db.apiKeys.updateLastUsed', 'write', db.update(apiKeys).set({ lastUsedAt: sql`now()` }).where(eq(apiKeys.id, id))).pipe(Effect.asVoid),
});
const makeOAuthAccountRepo = (db: DrizzleDb) => ({
    delete: (id: OAuthAccount['id']) => withDbOps('db.oauthAccounts.delete', 'delete', db.delete(oauthAccounts).where(eq(oauthAccounts.id, id))).pipe(Effect.asVoid),
    deleteByProvider: (provider: OAuthAccount['provider'], providerAccountId: string) => withDbOps('db.oauthAccounts.deleteByProvider', 'delete', db.delete(oauthAccounts).where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerAccountId, providerAccountId)))).pipe(Effect.asVoid),
    findAllByUserId: (userId: User['id']) => withDbOps('db.oauthAccounts.findAllByUserId', 'read', db.query.oauthAccounts.findMany({ where: eq(oauthAccounts.userId, userId) })),
    findById: (id: OAuthAccount['id']) => withDbOps('db.oauthAccounts.findById', 'read', db.query.oauthAccounts.findFirst({ where: eq(oauthAccounts.id, id) })).pipe(Effect.map(opt)),
    findByProviderAccountId: (provider: OAuthAccount['provider'], providerAccountId: string) => withDbOps('db.oauthAccounts.findByProviderAccountId', 'read', db.query.oauthAccounts.findFirst({ where: and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerAccountId, providerAccountId)) })).pipe(Effect.map(opt)),
    insert: (data: OAuthAccountInsert) => withDbOps('db.oauthAccounts.insert', 'write', db.insert(oauthAccounts).values(data).returning()).pipe(Effect.map(first)),
    upsert: (data: OAuthAccountInsert) => withDbOps('db.oauthAccounts.upsert', 'write', db.insert(oauthAccounts).values(data).onConflictDoUpdate({ set: { accessToken: data.accessToken, accessTokenExpiresAt: data.accessTokenExpiresAt, refreshToken: data.refreshToken, updatedAt: sql`now()` }, target: [oauthAccounts.provider, oauthAccounts.providerAccountId] }).returning()).pipe(Effect.map(first)),
});
const makeRefreshTokenRepo = (db: DrizzleDb) => ({
    delete: (id: RefreshToken['id']) => withDbOps('db.refreshTokens.delete', 'delete', db.delete(refreshTokens).where(eq(refreshTokens.id, id))).pipe(Effect.asVoid),
    findById: (id: RefreshToken['id']) => withDbOps('db.refreshTokens.findById', 'read', db.query.refreshTokens.findFirst({ where: eq(refreshTokens.id, id) })).pipe(Effect.map(opt)),
    findValidByTokenHash: (hash: Hex64) => withDbOps('db.refreshTokens.findValidByTokenHash', 'read', db.query.refreshTokens.findFirst({ where: and(eq(refreshTokens.tokenHash, hash), gt(refreshTokens.expiresAt, sql`now()`), isNull(refreshTokens.revokedAt)) })).pipe(Effect.map(opt)),
    insert: (data: RefreshTokenInsert) => withDbOps('db.refreshTokens.insert', 'write', db.insert(refreshTokens).values(data).returning()).pipe(Effect.map(first)),
    revoke: (id: RefreshToken['id']) => withDbOps('db.refreshTokens.revoke', 'write', db.update(refreshTokens).set({ revokedAt: sql`now()` }).where(eq(refreshTokens.id, id))).pipe(Effect.asVoid),
    revokeAllByUserId: (userId: User['id']) => withDbOps('db.refreshTokens.revokeAllByUserId', 'write', db.update(refreshTokens).set({ revokedAt: sql`now()` }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))).pipe(Effect.asVoid),
});
const makeAssetRepo = (db: DrizzleDb, resolvers: Resolvers) => ({
    countByUserId: (userId: User['id']) => withDbOps('db.assets.countByUserId', 'read', db.select({ count: sql<number>`count(*)::int` }).from(assets).where(and(eq(assets.userId, userId), isNull(assets.deletedAt)))).pipe(Effect.map((rows) => rows[0]?.count ?? 0)),
    delete: (id: Asset['id']) => withDbOps('db.assets.delete', 'delete', db.delete(assets).where(eq(assets.id, id))).pipe(Effect.asVoid),
    findAllByUserId: (userId: User['id'], limit: number, offset: number) => withDbOps('db.assets.findAllByUserId', 'read', db.query.assets.findMany({ limit, offset, orderBy: desc(assets.createdAt), where: and(eq(assets.userId, userId), isNull(assets.deletedAt)) })),
    findById: resolvers.asset.execute,
    insert: (data: AssetInsert) => resolvers.insertAsset.execute(data as S.Schema.Type<typeof AssetInsertSchema>),
    insertMany: (items: readonly AssetInsert[]) => Effect.all(items.map((item) => resolvers.insertAsset.execute(item as S.Schema.Type<typeof AssetInsertSchema>))),
    restore: (id: Asset['id']) => withDbOps('db.assets.restore', 'write', db.update(assets).set({ deletedAt: null, updatedAt: sql`now()` }).where(eq(assets.id, id))).pipe(Effect.asVoid),
    softDelete: (id: Asset['id']) => withDbOps('db.assets.softDelete', 'write', db.update(assets).set({ deletedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(assets.id, id))).pipe(Effect.asVoid),
    streamByUserId: (userId: User['id'], batchSize = 1000) => Stream.paginateChunkEffect(0, (offset) => withDbOps('db.assets.streamByUserId', 'read', db.query.assets.findMany({ limit: batchSize, offset, orderBy: desc(assets.createdAt), where: and(eq(assets.userId, userId), isNull(assets.deletedAt)) })).pipe(Effect.map((rows) => [Chunk.fromIterable(rows), rows.length < batchSize ? Option.none() : Option.some(offset + batchSize)]))),
    update: (id: Asset['id'], data: Partial<AssetInsert>) => withDbOps('db.assets.update', 'write', db.update(assets).set({ ...data, updatedAt: sql`now()` }).where(eq(assets.id, id)).returning()).pipe(Effect.map((rows) => opt(rows[0]))),
});
const makeAuditRepo = (db: DrizzleDb, resolvers: Resolvers) => ({
    findByEntity: (entityType: string, entityId: string) => withDbOps('db.audit.findByEntity', 'read', db.query.auditLogs.findMany({ orderBy: desc(auditLogs.createdAt), where: and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)) })),
    log: resolvers.insertAudit.execute,
});

// --- [DERIVED_TYPES] ---------------------------------------------------------

type UserRepository = ReturnType<typeof makeUserRepo>;
type SessionRepository = ReturnType<typeof makeSessionRepo>;
type ApiKeyRepository = ReturnType<typeof makeApiKeyRepo>;
type OAuthAccountRepository = ReturnType<typeof makeOAuthAccountRepo>;
type RefreshTokenRepository = ReturnType<typeof makeRefreshTokenRepo>;
type AssetRepository = ReturnType<typeof makeAssetRepo>;
type AuditRepository = ReturnType<typeof makeAuditRepo>;
type DatabaseServiceShape = {
    readonly apiKeys: ApiKeyRepository;
    readonly assets: AssetRepository;
    readonly audit: AuditRepository;
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
            assets: makeAssetRepo(db, resolvers),
            audit: makeAuditRepo(db, resolvers),
            oauthAccounts: makeOAuthAccountRepo(db),
            refreshTokens: makeRefreshTokenRepo(db),
            sessions: makeSessionRepo(db, resolvers.session),
            users: makeUserRepo(db, resolvers.user),
            withTransaction: sqlClient.withTransaction,
        };
    }),
}) {
    static readonly layer = this.Default.pipe(Layer.provide(Drizzle.Default), Layer.provide(PgLive), Layer.provide(MetricsService.layer));
    /** Returns batch coalescing metrics snapshot for runtime observability. Use this to diagnose N+1 patterns and optimize resolver access patterns. */
    static readonly getBatchMetrics = Effect.gen(function* () {
        const metrics = yield* MetricsService;
        const [batchSize, deduplicationRatio, n1Warnings, totalBatches] = yield* Effect.all([
            Metric.value(metrics.batch.batchSize),
            Metric.value(metrics.batch.deduplicationRatio),
            Metric.value(metrics.batch.n1Warnings),
            Metric.value(metrics.batch.totalBatches),
        ]);
        return {
            batchSize: batchSize as unknown as { readonly buckets: ReadonlyArray<readonly [number, number]>; readonly count: number; readonly max: number; readonly min: number; readonly sum: number },
            deduplicationRatio: deduplicationRatio as unknown as { readonly buckets: ReadonlyArray<readonly [number, number]>; readonly count: number; readonly max: number; readonly min: number; readonly sum: number },
            n1Warnings: n1Warnings as unknown as number,
            totalBatches: totalBatches as unknown as number,
        };
    });
}

// --- [EXPORT] ----------------------------------------------------------------

export { DatabaseService };
export type {
    ApiKeyRepository, AssetRepository, AuditRepository, DatabaseServiceShape, OAuthAccountRepository, RefreshTokenRepository, SessionRepository,
    UserRepository, WithTransaction,
};
