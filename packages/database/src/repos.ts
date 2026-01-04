/**
 * DatabaseService Context.Tag with traced Drizzle queries.
 * Uses relational query API (findFirst/findMany) for concise operations.
 */
import { SqlClient } from '@effect/sql/SqlClient';
import type { SqlError } from '@effect/sql/SqlError';
import type { Hex64 } from '@parametric-portal/types/types';
import { and, count, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import {
    Context,
    Duration,
    Effect,
    identity,
    Layer,
    Metric,
    MetricBoundaries,
    MetricLabel,
    Option,
    Schedule,
} from 'effect';
import { Drizzle, PgLive } from './client.ts';
import {
    type ApiKey,
    type ApiKeyInsert,
    type Asset,
    type AssetInsert,
    apiKeys,
    assets,
    type OAuthAccount,
    type OAuthAccountInsert,
    oauthAccounts,
    type RefreshToken,
    type RefreshTokenInsert,
    refreshTokens,
    type Session,
    type SessionInsert,
    sessions,
    type User,
    type UserId,
    type UserInsert,
    users,
} from './schema.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    metrics: {
        boundaries: MetricBoundaries.exponential({ count: 8, factor: 2, start: 0.01 }),
        dbErrors: { description: 'Database query errors', name: 'db_query_errors_total' },
        dbQuery: { description: 'Database query duration', name: 'db_query_duration_seconds' },
    },
    ops: {
        retry: Schedule.exponential(Duration.millis(50)).pipe(
            Schedule.jittered,
            Schedule.intersect(Schedule.recurs(3)),
        ),
        timeout: Duration.seconds(30),
    },
} as const);
const dbQueryDuration = Metric.histogram(B.metrics.dbQuery.name, B.metrics.boundaries, B.metrics.dbQuery.description);
const dbQueryErrors = Metric.counter(B.metrics.dbErrors.name, { description: B.metrics.dbErrors.description });

// --- [TYPES] -----------------------------------------------------------------

type DrizzleDb = Context.Tag.Service<typeof Drizzle>;
type OpType = 'read' | 'write' | 'delete';
type WithTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | SqlError, R>;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const first = <T>(rows: readonly T[]): T => Option.getOrThrow(Option.fromNullable(rows[0]));
const opt = <T>(row: T | undefined): Option.Option<T> => Option.fromNullable(row);
const recordDbMetric = (operation: string, durationSec: number, status: 'success' | 'error') =>
    Effect.gen(function* () {
        const labels = [MetricLabel.make('operation', operation), MetricLabel.make('status', status)];
        const taggedDuration = dbQueryDuration.pipe(Metric.taggedWithLabels(labels));
        const taggedErrors = dbQueryErrors.pipe(Metric.taggedWithLabels([MetricLabel.make('operation', operation)]));
        yield* Metric.update(taggedDuration, durationSec);
        yield* Effect.when(Metric.increment(taggedErrors), () => status === 'error');
    });
const withDbOps = <A, E>(spanName: string, opType: OpType, effect: Effect.Effect<A, E>) =>
    effect.pipe(
        Effect.withSpan(spanName, { attributes: { 'db.operation_type': opType } }),
        Effect.timeout(B.ops.timeout),
        opType === 'read' ? Effect.retry(B.ops.retry) : identity,
        Effect.timed,
        Effect.flatMap(([duration, result]) =>
            recordDbMetric(spanName, Duration.toSeconds(duration), 'success').pipe(Effect.as(result)),
        ),
        Effect.tapError(() => recordDbMetric(spanName, 0, 'error')),
    );

// --- [REPOSITORIES] ----------------------------------------------------------

const buildUserRepo = (db: DrizzleDb) => ({
    delete: (id: User['id']) =>
        withDbOps('db.users.delete', 'delete', db.delete(users).where(eq(users.id, id))).pipe(Effect.asVoid),
    findActiveByEmail: (email: string) =>
        withDbOps(
            'db.users.findActiveByEmail',
            'read',
            db.query.users.findFirst({ where: and(eq(users.email, email), isNull(users.deletedAt)) }),
        ).pipe(Effect.map(opt)),
    findByEmail: (email: string) =>
        withDbOps('db.users.findByEmail', 'read', db.query.users.findFirst({ where: eq(users.email, email) })).pipe(
            Effect.map(opt),
        ),
    findById: (id: User['id']) =>
        withDbOps('db.users.findById', 'read', db.query.users.findFirst({ where: eq(users.id, id) })).pipe(
            Effect.map(opt),
        ),
    findByIds: (ids: ReadonlyArray<User['id']>) =>
        withDbOps(
            'db.users.findByIds',
            'read',
            ids.length === 0
                ? Effect.succeed([] as readonly User[])
                : db.query.users.findMany({ where: inArray(users.id, [...ids]) }),
        ),
    insert: (data: UserInsert) =>
        withDbOps('db.users.insert', 'write', db.insert(users).values(data).returning()).pipe(Effect.map(first)),
    restore: (id: User['id']) =>
        withDbOps('db.users.restore', 'write', db.update(users).set({ deletedAt: null }).where(eq(users.id, id))).pipe(
            Effect.asVoid,
        ),
    softDelete: (id: User['id']) =>
        withDbOps(
            'db.users.softDelete',
            'write',
            db.update(users).set({ deletedAt: sql`now()` }).where(eq(users.id, id)),
        ).pipe(Effect.asVoid),
    update: (id: User['id'], data: Partial<UserInsert>) =>
        withDbOps('db.users.update', 'write', db.update(users).set(data).where(eq(users.id, id)).returning()).pipe(
            Effect.map((rows) => opt(rows[0])),
        ),
});
const buildSessionRepo = (db: DrizzleDb) => ({
    delete: (id: Session['id']) =>
        withDbOps('db.sessions.delete', 'delete', db.delete(sessions).where(eq(sessions.id, id))).pipe(Effect.asVoid),
    findById: (id: Session['id']) =>
        withDbOps('db.sessions.findById', 'read', db.query.sessions.findFirst({ where: eq(sessions.id, id) })).pipe(
            Effect.map(opt),
        ),
    findByIds: (ids: ReadonlyArray<Session['id']>) =>
        withDbOps(
            'db.sessions.findByIds',
            'read',
            ids.length === 0
                ? Effect.succeed([] as readonly Session[])
                : db.query.sessions.findMany({ where: inArray(sessions.id, [...ids]) }),
        ),
    findValidByTokenHash: (hash: Hex64) =>
        withDbOps(
            'db.sessions.findValidByTokenHash',
            'read',
            db.query.sessions.findFirst({
                where: and(
                    eq(sessions.tokenHash, hash),
                    gt(sessions.expiresAt, sql`now()`),
                    isNull(sessions.revokedAt),
                ),
            }),
        ).pipe(Effect.map(opt)),
    insert: (data: SessionInsert) =>
        withDbOps('db.sessions.insert', 'write', db.insert(sessions).values(data).returning()).pipe(Effect.map(first)),
    revoke: (id: Session['id']) =>
        withDbOps(
            'db.sessions.revoke',
            'write',
            db.update(sessions).set({ revokedAt: sql`now()` }).where(eq(sessions.id, id)),
        ).pipe(Effect.asVoid),
    revokeAllByUserId: (userId: UserId) =>
        withDbOps(
            'db.sessions.revokeAllByUserId',
            'write',
            db
                .update(sessions)
                .set({ revokedAt: sql`now()` })
                .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt))),
        ).pipe(Effect.asVoid),
    updateLastActivity: (id: Session['id']) =>
        withDbOps(
            'db.sessions.updateLastActivity',
            'write',
            db.update(sessions).set({ lastActivityAt: sql`now()` }).where(eq(sessions.id, id)),
        ).pipe(Effect.asVoid),
});
const buildApiKeyRepo = (db: DrizzleDb) => ({
    delete: (id: ApiKey['id']) =>
        withDbOps('db.apiKeys.delete', 'delete', db.delete(apiKeys).where(eq(apiKeys.id, id))).pipe(Effect.asVoid),
    findAllByUserId: (userId: UserId) =>
        withDbOps(
            'db.apiKeys.findAllByUserId',
            'read',
            db.query.apiKeys.findMany({ where: eq(apiKeys.userId, userId) }),
        ),
    findById: (id: ApiKey['id']) =>
        withDbOps('db.apiKeys.findById', 'read', db.query.apiKeys.findFirst({ where: eq(apiKeys.id, id) })).pipe(
            Effect.map(opt),
        ),
    findByIdAndUserId: (id: ApiKey['id'], userId: UserId) =>
        withDbOps(
            'db.apiKeys.findByIdAndUserId',
            'read',
            db.query.apiKeys.findFirst({ where: and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)) }),
        ).pipe(Effect.map(opt)),
    findByIds: (ids: ReadonlyArray<ApiKey['id']>) =>
        withDbOps(
            'db.apiKeys.findByIds',
            'read',
            ids.length === 0
                ? Effect.succeed([] as readonly ApiKey[])
                : db.query.apiKeys.findMany({ where: inArray(apiKeys.id, [...ids]) }),
        ),
    findByUserIdAndProvider: (userId: UserId, provider: ApiKey['provider']) =>
        withDbOps(
            'db.apiKeys.findByUserIdAndProvider',
            'read',
            db.query.apiKeys.findFirst({
                where: and(
                    eq(apiKeys.userId, userId),
                    eq(apiKeys.provider, provider),
                    or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, sql`now()`)),
                ),
            }),
        ).pipe(Effect.map(opt)),
    findValidByKeyHash: (hash: Hex64) =>
        withDbOps(
            'db.apiKeys.findValidByKeyHash',
            'read',
            db.query.apiKeys.findFirst({
                where: and(eq(apiKeys.keyHash, hash), or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, sql`now()`))),
            }),
        ).pipe(Effect.map(opt)),
    insert: (data: ApiKeyInsert) =>
        withDbOps('db.apiKeys.insert', 'write', db.insert(apiKeys).values(data).returning()).pipe(Effect.map(first)),
    updateLastUsed: (id: ApiKey['id']) =>
        withDbOps(
            'db.apiKeys.updateLastUsed',
            'write',
            db.update(apiKeys).set({ lastUsedAt: sql`now()` }).where(eq(apiKeys.id, id)),
        ).pipe(Effect.asVoid),
});
const buildOAuthAccountRepo = (db: DrizzleDb) => ({
    delete: (id: OAuthAccount['id']) =>
        withDbOps('db.oauthAccounts.delete', 'delete', db.delete(oauthAccounts).where(eq(oauthAccounts.id, id))).pipe(
            Effect.asVoid,
        ),
    deleteByProvider: (provider: OAuthAccount['provider'], providerAccountId: string) =>
        withDbOps(
            'db.oauthAccounts.deleteByProvider',
            'delete',
            db
                .delete(oauthAccounts)
                .where(
                    and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerAccountId, providerAccountId)),
                ),
        ).pipe(Effect.asVoid),
    findAllByUserId: (userId: UserId) =>
        withDbOps(
            'db.oauthAccounts.findAllByUserId',
            'read',
            db.query.oauthAccounts.findMany({ where: eq(oauthAccounts.userId, userId) }),
        ),
    findById: (id: OAuthAccount['id']) =>
        withDbOps(
            'db.oauthAccounts.findById',
            'read',
            db.query.oauthAccounts.findFirst({ where: eq(oauthAccounts.id, id) }),
        ).pipe(Effect.map(opt)),
    findByProviderAccountId: (provider: OAuthAccount['provider'], providerAccountId: string) =>
        withDbOps(
            'db.oauthAccounts.findByProviderAccountId',
            'read',
            db.query.oauthAccounts.findFirst({
                where: and(
                    eq(oauthAccounts.provider, provider),
                    eq(oauthAccounts.providerAccountId, providerAccountId),
                ),
            }),
        ).pipe(Effect.map(opt)),
    insert: (data: OAuthAccountInsert) =>
        withDbOps('db.oauthAccounts.insert', 'write', db.insert(oauthAccounts).values(data).returning()).pipe(
            Effect.map(first),
        ),
    upsert: (data: OAuthAccountInsert) =>
        withDbOps(
            'db.oauthAccounts.upsert',
            'write',
            db
                .insert(oauthAccounts)
                .values(data)
                .onConflictDoUpdate({
                    set: {
                        accessToken: data.accessToken,
                        accessTokenExpiresAt: data.accessTokenExpiresAt,
                        refreshToken: data.refreshToken,
                        updatedAt: sql`now()`,
                    },
                    target: [oauthAccounts.provider, oauthAccounts.providerAccountId],
                })
                .returning(),
        ).pipe(Effect.map(first)),
});
const buildRefreshTokenRepo = (db: DrizzleDb) => ({
    delete: (id: RefreshToken['id']) =>
        withDbOps('db.refreshTokens.delete', 'delete', db.delete(refreshTokens).where(eq(refreshTokens.id, id))).pipe(
            Effect.asVoid,
        ),
    findById: (id: RefreshToken['id']) =>
        withDbOps(
            'db.refreshTokens.findById',
            'read',
            db.query.refreshTokens.findFirst({ where: eq(refreshTokens.id, id) }),
        ).pipe(Effect.map(opt)),
    findValidByTokenHash: (hash: Hex64) =>
        withDbOps(
            'db.refreshTokens.findValidByTokenHash',
            'read',
            db.query.refreshTokens.findFirst({
                where: and(
                    eq(refreshTokens.tokenHash, hash),
                    gt(refreshTokens.expiresAt, sql`now()`),
                    isNull(refreshTokens.revokedAt),
                ),
            }),
        ).pipe(Effect.map(opt)),
    insert: (data: RefreshTokenInsert) =>
        withDbOps('db.refreshTokens.insert', 'write', db.insert(refreshTokens).values(data).returning()).pipe(
            Effect.map(first),
        ),
    revoke: (id: RefreshToken['id']) =>
        withDbOps(
            'db.refreshTokens.revoke',
            'write',
            db.update(refreshTokens).set({ revokedAt: sql`now()` }).where(eq(refreshTokens.id, id)),
        ).pipe(Effect.asVoid),
    revokeAllByUserId: (userId: UserId) =>
        withDbOps(
            'db.refreshTokens.revokeAllByUserId',
            'write',
            db
                .update(refreshTokens)
                .set({ revokedAt: sql`now()` })
                .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt))),
        ).pipe(Effect.asVoid),
});
const buildAssetRepo = (db: DrizzleDb) => ({
    countByUserId: (userId: UserId) =>
        withDbOps(
            'db.assets.countByUserId',
            'read',
            db
                .select({ count: count() })
                .from(assets)
                .where(and(eq(assets.userId, userId), isNull(assets.deletedAt))),
        ).pipe(Effect.map((rows) => rows[0]?.count ?? 0)),
    delete: (id: Asset['id']) =>
        withDbOps('db.assets.delete', 'delete', db.delete(assets).where(eq(assets.id, id))).pipe(Effect.asVoid),
    findAllByUserId: (userId: UserId, limit: number, offset: number) =>
        withDbOps(
            'db.assets.findAllByUserId',
            'read',
            db.query.assets.findMany({
                limit,
                offset,
                orderBy: desc(assets.createdAt),
                where: and(eq(assets.userId, userId), isNull(assets.deletedAt)),
            }),
        ),
    findById: (id: Asset['id']) =>
        withDbOps('db.assets.findById', 'read', db.query.assets.findFirst({ where: eq(assets.id, id) })).pipe(
            Effect.map(opt),
        ),
    findByIds: (ids: ReadonlyArray<Asset['id']>) =>
        withDbOps(
            'db.assets.findByIds',
            'read',
            ids.length === 0
                ? Effect.succeed([] as readonly Asset[])
                : db.query.assets.findMany({ where: inArray(assets.id, [...ids]) }),
        ),
    insert: (data: AssetInsert) =>
        withDbOps('db.assets.insert', 'write', db.insert(assets).values(data).returning()).pipe(Effect.map(first)),
    restore: (id: Asset['id']) =>
        withDbOps(
            'db.assets.restore',
            'write',
            db.update(assets).set({ deletedAt: null, updatedAt: sql`now()` }).where(eq(assets.id, id)),
        ).pipe(Effect.asVoid),
    softDelete: (id: Asset['id']) =>
        withDbOps(
            'db.assets.softDelete',
            'write',
            db.update(assets).set({ deletedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(assets.id, id)),
        ).pipe(Effect.asVoid),
    update: (id: Asset['id'], data: Partial<AssetInsert>) =>
        withDbOps(
            'db.assets.update',
            'write',
            db
                .update(assets)
                .set({ ...data, updatedAt: sql`now()` })
                .where(eq(assets.id, id))
                .returning(),
        ).pipe(Effect.map((rows) => opt(rows[0]))),
});

// --- [INFERRED_TYPES] --------------------------------------------------------

type UserRepository = ReturnType<typeof buildUserRepo>;
type SessionRepository = ReturnType<typeof buildSessionRepo>;
type ApiKeyRepository = ReturnType<typeof buildApiKeyRepo>;
type OAuthAccountRepository = ReturnType<typeof buildOAuthAccountRepo>;
type RefreshTokenRepository = ReturnType<typeof buildRefreshTokenRepo>;
type AssetRepository = ReturnType<typeof buildAssetRepo>;
type DatabaseServiceShape = {
    readonly apiKeys: ApiKeyRepository;
    readonly assets: AssetRepository;
    readonly oauthAccounts: OAuthAccountRepository;
    readonly refreshTokens: RefreshTokenRepository;
    readonly sessions: SessionRepository;
    readonly users: UserRepository;
    readonly withTransaction: WithTransaction;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

class DatabaseService extends Context.Tag('database/DatabaseService')<DatabaseService, DatabaseServiceShape>() {
    static readonly layer = Layer.effect(
        this,
        Effect.gen(function* () {
            const db = yield* Drizzle;
            const sql = yield* SqlClient;
            return {
                apiKeys: buildApiKeyRepo(db),
                assets: buildAssetRepo(db),
                oauthAccounts: buildOAuthAccountRepo(db),
                refreshTokens: buildRefreshTokenRepo(db),
                sessions: buildSessionRepo(db),
                users: buildUserRepo(db),
                withTransaction: sql.withTransaction,
            };
        }),
    ).pipe(Layer.provide(Drizzle.Default), Layer.provide(PgLive));
}

// --- [EXPORT] ----------------------------------------------------------------

export { DatabaseService };
export type {
    ApiKeyRepository,
    AssetRepository,
    DatabaseServiceShape,
    OAuthAccountRepository,
    RefreshTokenRepository,
    SessionRepository,
    UserRepository,
    WithTransaction,
};
