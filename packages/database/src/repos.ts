/**
 * Expose batched repositories via factory pattern.
 * UUIDv7 ordering, casefold comparisons, purge/revoke DB functions.
 */
import { SqlClient } from '@effect/sql';
import { Clock, Effect, Option, Record as R, Schema as S } from 'effect';
import { repo, routine, Update } from './factory.ts';
import { ApiKey, App, AppSettingsDefaults, Asset, AuditLog, type AuditOperationSchema, Job, JobDlq, KvStore, MfaSecret, Notification, OauthAccount, Permission, Session, User, WebauthnCredential, AppSettingsSchema } from './models.ts';
import { SearchRepo } from './search.ts';

// --- [REPOSITORIES] ----------------------------------------------------------

const makeUserRepo = Effect.gen(function* () {
    const repository = yield* repo(User, 'users', { resolve: { byEmail: 'email' }, scoped: 'appId' });
    return { ...repository,
        byRole: (role: string) => repository.find([{ field: 'role', value: role }]),
        setPreferences: (id: string, preferences: S.Schema.Type<typeof User.fields.preferences>) => repository.set(id, { preferences }),
    };
});
const makePermissionRepo = Effect.gen(function* () {
    const repository = yield* repo(Permission, 'permissions', {
        conflict: { keys: ['appId', 'role', 'resource', 'action'], only: ['deletedAt'] },
        scoped: 'appId',
    });
    return { ...repository,
        byRole: (role: string) => repository.find([{ field: 'role', value: role }]),
        grant: (payload: { appId: string; role: S.Schema.Type<typeof Permission.fields.role>; resource: string; action: string }) =>
            repository.upsert({
                action: payload.action,
                appId: payload.appId,
                deletedAt: Option.none(),
                resource: payload.resource,
                role: payload.role,
                updatedAt: undefined,
            }),
        revoke: (role: string, resource: string, action: string) =>
            repository.drop([
                { field: 'role', value: role },
                { field: 'resource', value: resource },
                { field: 'action', value: action },
            ]),
    };
});
const makeAppRepo = Effect.gen(function* () {
    const repository = yield* repo(App, 'apps', { resolve: { byNamespace: 'namespace' } });
    const _decodeSettings = (rawValue: unknown) => S.decodeUnknown(AppSettingsSchema)(rawValue, { errors: 'all', onExcessProperty: 'ignore' });
    return { ...repository,
        readSettings: (id: string, lock: false | 'update' = false) => repository.one([{ field: 'id', value: id }], lock).pipe(
            Effect.flatMap(Option.match({
                onNone: () => Effect.succeed(Option.none()),
                onSome: (app) => _decodeSettings(Option.getOrElse(app.settings, () => AppSettingsDefaults)).pipe(Effect.map((settings) => Option.some({ app, settings }))),
            })),
        ),
        updateSettings: (id: string, settings: S.Schema.Type<typeof AppSettingsSchema>) => repository.set(id, { settings }),
    };
});
const makeSessionRepo = Effect.gen(function* () {
    const repository = yield* repo(Session, 'sessions', {
        functions: { revoke_sessions_by_ip: { args: [{ cast: 'uuid', field: 'appId' }, { cast: 'inet', field: 'ip' }], params: S.Struct({ appId: S.UUID, ip: S.String }) } },
        purge: 'purge_sessions',
        resolve: {
            byAccessToken: { through: { source: 'token_access', table: 'session_tokens', target: 'session_id' } },
            byRefreshToken: { through: { source: 'token_refresh', table: 'session_tokens', target: 'session_id' } },
        },
        scoped: 'appId',
    });
    return { ...repository,
        byRefreshTokenForUpdate: (hash: string) => repository.by('byRefreshToken', hash, 'update'),
        byUser: (userId: string) => repository.find([{ field: 'user_id', value: userId }]),
        softDelete: (id: string) => repository.drop(id),
        softDeleteByIp: (appId: string, ip: string) => repository.fn<number>('revoke_sessions_by_ip', { appId, ip }),
        touch: (id: string) => repository.set(id, { updated_at: Update.now }),
        verify: (id: string) => repository.set(id, { verified_at: Update.now }, undefined, { field: 'verified_at', op: 'null' }),
    };
});
const makeApiKeyRepo = Effect.gen(function* () {
    const repository = yield* repo(ApiKey, 'api_keys', { purge: 'purge_api_keys', resolve: { byHash: 'hash', byUser: 'many:userId' } });
    return { ...repository,
        touch: (id: string) => repository.set(id, { last_used_at: Update.now }),
    };
});
const makeOauthAccountRepo = Effect.gen(function* () {
    const repository = yield* repo(OauthAccount, 'oauth_accounts', {
        conflict: { keys: ['provider', 'externalId'], only: ['tokenPayload'] },
        purge: 'purge_oauth_accounts', resolve: { byExternal: ['provider', 'externalId'], byUser: 'many:userId' },
    });
    return { ...repository,
        byExternal: (provider: string, externalId: string) => repository.by('byExternal', { externalId, provider }),
    };
});
const makeAssetRepo = Effect.gen(function* () {
    const repository = yield* repo(Asset, 'assets', { purge: 'purge_assets', scoped: 'appId' });
    return { ...repository,
        byFilter: (userId: string, { after, before, ids, types }: { after?: Date; before?: Date; ids?: string[]; types?: string[] } = {}) => repository.find(repository.preds({ after, before, id: ids, type: types, user_id: userId })),
        byHash: (hash: string) => repository.one([{ field: 'hash', value: hash }]),
        byType: (type: string) => repository.find([{ field: 'type', value: type }]),
        byUser: (userId: string) => repository.find([{ field: 'user_id', value: userId }]),
        byUserKeyset: (userId: string, limit: number, cursor?: string) => repository.page([{ field: 'user_id', value: userId }], { cursor, limit }),
        findStaleForPurge: (olderThanDays: number) => Clock.currentTimeMillis.pipe(
            Effect.andThen((now) => repository.find([
                { field: 'deleted_at', op: 'notNull' },
                { field: 'deleted_at', op: 'lt', value: new Date(now - olderThanDays * 24 * 60 * 60 * 1000) },
                { field: 'storage_ref', op: 'notNull' },
            ])),
        ),
        insertMany: (items: readonly S.Schema.Type<typeof Asset.insert>[]) => repository.put([...items]),
    };
});
const makeAuditRepo = Effect.gen(function* () {
    const repository = yield* repo(AuditLog, 'audit_logs', {
        functions: { count_audit_by_ip: { args: [{ cast: 'uuid', field: 'appId' }, { cast: 'inet', field: 'ip' }, 'windowMinutes'], params: S.Struct({ appId: S.UUID, ip: S.String, windowMinutes: S.Number }) } },
        scoped: 'appId',
    });
    return { ...repository,
        byIp: (ip: string, limit: number, cursor?: string) => repository.page([{ field: 'context_ip', value: ip }], { cursor, limit }),
        bySubject: (type: string, id: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: S.Schema.Type<typeof AuditOperationSchema> } = {}) => repository.page([{ field: 'target_type', value: type }, { field: 'target_id', value: id }, ...repository.preds({ after, before, operation })], { cursor, limit }),
        byUser: (userId: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: S.Schema.Type<typeof AuditOperationSchema> } = {}) => repository.page(repository.preds({ after, before, operation, user_id: userId }), { cursor, limit }),
        countByIp: (appId: string, ip: string, windowMinutes = 60) => repository.fn<number>('count_audit_by_ip', { appId, ip, windowMinutes }),
        log: repository.insert,
    };
});
const makeMfaSecretRepo = Effect.gen(function* () {
    const repository = yield* repo(MfaSecret, 'mfa_secrets', {
        conflict: { keys: ['userId'], only: ['backups', 'enabledAt', 'encrypted'] },
        purge: 'purge_mfa_secrets', resolve: { byUser: 'userId' },
    });
    return { ...repository,
        softDelete: (userId: string) => repository.drop([{ field: 'user_id', value: userId }]),
    };
});
const makeWebauthnCredentialRepo = Effect.gen(function* () {
    const repository = yield* repo(WebauthnCredential, 'webauthn_credentials', { resolve: { byCredentialId: 'credentialId', byUser: 'many:userId' } });
    return { ...repository,
        touch: (id: string) => repository.set(id, { last_used_at: Update.now }),
        updateCounter: (id: string, counter: number) => repository.set(id, { counter, last_used_at: Update.now }),
    };
});
const makeJobRepo = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const repository = yield* repo(Job, 'jobs', { pk: { column: 'job_id' }, scoped: 'appId' });
    return { ...repository,
        byDateRange: (after: Date, before: Date, options?: { limit?: number; cursor?: string }) => repository.page(repository.preds({ after, before }), { cursor: options?.cursor, limit: options?.limit ?? 100 }),
        byStatus: (status: string, options?: { after?: Date; before?: Date; limit?: number; cursor?: string }) => repository.page([{ field: 'status', value: status }, ...repository.preds({ after: options?.after, before: options?.before })], { cursor: options?.cursor, limit: options?.limit ?? 100 }),
        countByStatuses: (...statuses: readonly string[]) => repository.count([{ field: 'status', op: 'in', values: [...statuses] }]),
        isDuplicate: (dedupeKey: string) => repository.exists([{ raw: sql`correlation->>'dedupe' = ${dedupeKey}` }, { field: 'status', op: 'in', values: ['queued', 'processing'] }]),
    };
});
const makeJobDlqRepo = Effect.gen(function* () {
    const repository = yield* repo(JobDlq, 'job_dlq', { purge: 'purge_job_dlq', resolve: { bySource: 'sourceId' }, scoped: 'appId' });
    return { ...repository,
        byErrorReason: (errorReason: string, options?: { limit?: number; cursor?: string }) => repository.page([{ field: 'error_reason', value: errorReason }], { cursor: options?.cursor, limit: options?.limit ?? 100 }),
        byRequest: (requestId: string) => repository.find([{ field: 'context_request_id', value: requestId }]),
        countPending: (type?: string) => repository.count(type === undefined ? [] : [{ field: 'type', op: type.includes('*') ? 'like' as const : 'eq' as const, value: type.replaceAll('*', '%') }]),
        listPending: (options?: { type?: string; limit?: number; cursor?: string }) => repository.page(options?.type === undefined ? [] : [{ field: 'type', op: options.type.includes('*') ? 'like' as const : 'eq' as const, value: options.type.replaceAll('*', '%') }], { cursor: options?.cursor, limit: options?.limit ?? 100 }),
        markReplayed: (id: string) => repository.drop(id),
        unmarkReplayed: (id: string) => repository.lift(id),
    };
});
const makeNotificationRepo = Effect.gen(function* () {
    const repository = yield* repo(Notification, 'notifications', { scoped: 'appId' });
    return { ...repository,
        transition: (id: string, updates: { status: S.Schema.Type<typeof Notification.fields.status>; delivery?: S.Schema.Type<typeof Notification.fields.delivery>; correlation?: S.Schema.Type<typeof Notification.fields.correlation>; retryCurrent?: S.Schema.Type<typeof Notification.fields.retryCurrent>; retryMax?: S.Schema.Type<typeof Notification.fields.retryMax> }, whenStatus?: S.Schema.Type<typeof Notification.fields.status>) =>
            repository.set(
                id,
                R.filter(
                    { correlation: updates.correlation, delivery: updates.delivery, retryCurrent: updates.retryCurrent, retryMax: updates.retryMax, status: updates.status } as Record<string, unknown>,
                    (value) => value !== undefined,
                ),
                undefined,
                Option.fromNullable(whenStatus).pipe(
                    Option.map((status) => ({ field: 'status', value: status })),
                    Option.getOrUndefined,
                ),
            ),
    };
});
const makeKvStoreRepo = Effect.gen(function* () {
    const repository = yield* repo(KvStore, 'kv_store', {
        conflict: { keys: ['key'], only: ['value', 'expiresAt'] },
        functions: { delete_kv_by_prefix: { args: ['prefix'], params: S.Struct({ prefix: S.String }) } },
        purge: 'purge_kv_store', resolve: { byKey: 'key' },
    });
    return { ...repository,
        deleteByPrefix: (prefix: string) => repository.fn<number>('delete_kv_by_prefix', { prefix }),
        getJson: <A, I, R>(key: string, schema: S.Schema<A, I, R>) => repository.by('byKey', key).pipe(Effect.flatMap(repository.json.decode('value', schema))),
        setJson: <A, I, R>(key: string, jsonValue: A, schema: S.Schema<A, I, R>, expiresAt?: Date) => repository.json.encode(schema)(jsonValue).pipe(Effect.flatMap((encoded) => repository.upsert({ expiresAt, key, value: encoded }))),
    };
});
const makeSystemRepo = Effect.gen(function* () {
    const repository = yield* routine('database/system', {
        functions: {
            count_outbox: {},
            get_journal_entry:     { args: ['primaryKey'], mode: 'set', params: S.Struct({ primaryKey: S.String }), schema: S.Struct({ payload: S.String }) },
            list_cron_jobs:        { mode: 'typed', schema: S.Array(S.Unknown) },
            list_journal_entries:  { args: ['sinceSequenceId', 'sinceTimestamp', 'eventType', 'batchSize'], mode: 'set', params: S.Struct({ batchSize: S.Number, eventType: S.NullOr(S.String), sinceSequenceId: S.String, sinceTimestamp: S.NullOr(S.Number) }), schema: S.Struct({ payload: S.String, primaryKey: S.String }) },
            list_partition_health: { args: ['parentTable'], mode: 'typed', params: S.Struct({ parentTable: S.String }), schema: S.Array(S.Unknown) },
            purge_journal:         { args: ['days'], params: S.Struct({ days: S.Number }) },
            purge_tenant:          { args: ['appId'], params: S.Struct({ appId: S.UUID }) },
            stat_cache_ratio:      { mode: 'set', schema: S.Struct({ backendType: S.String, cacheHitRatio: S.Number, hits: S.Number, ioContext: S.String, ioObject: S.String, reads: S.Number, writes: S.Number }) },
            stat_io_config:        { mode: 'set', schema: S.Struct({ name: S.String, setting: S.String }) },
            stat_io_detail:        { mode: 'set', schema: S.Unknown },
            stat_kcache:           { args: ['limit'], mode: 'typed', params: S.Struct({ limit: S.Number }), schema: S.Array(S.Unknown) },
            stat_qualstats:        { args: ['limit'], mode: 'typed', params: S.Struct({ limit: S.Number }), schema: S.Array(S.Unknown) },
            stat_statements:       { args: ['limit'], mode: 'typed', params: S.Struct({ limit: S.Number }), schema: S.Array(S.Unknown) },
            stat_wait_sampling:    { args: ['limit'], mode: 'typed', params: S.Struct({ limit: S.Number }), schema: S.Array(S.Unknown) },
            stat_wal_inspect:      { args: ['limit'], mode: 'typed', params: S.Struct({ limit: S.Number }), schema: S.Array(S.Unknown) },
            sync_cron_jobs:        { mode: 'typed', schema: S.Array(S.Unknown) },
        },
    });
    return {
        cacheRatio: () => repository.fn<readonly { backendType: string; cacheHitRatio: number; hits: number; ioContext: string; ioObject: string; reads: number; writes: number }[]>('stat_cache_ratio', {}),
        cronJobs: () => repository.fn<readonly unknown[]>('list_cron_jobs', {}),
        ioConfig: () => repository.fn<readonly { name: string; setting: string }[]>('stat_io_config', {}),
        ioDetail: () => repository.fn<readonly unknown[]>('stat_io_detail', {}),
        journalEntry: (primaryKey: string) => repository.fn<readonly { payload: string }[]>('get_journal_entry', { primaryKey }).pipe(Effect.map((rows) => Option.fromNullable(rows[0]))),
        journalPurge: (days: number) => repository.fn<number>('purge_journal', { days }),
        journalReplay: (input: { batchSize: number; eventType?: string; sinceSequenceId: string; sinceTimestamp?: number }) => repository.fn<readonly { payload: string; primaryKey: string }[]>('list_journal_entries', {
            batchSize: input.batchSize,
            eventType: Option.getOrNull(Option.fromNullable(input.eventType)),
            sinceSequenceId: input.sinceSequenceId,
            sinceTimestamp: Option.getOrNull(Option.fromNullable(input.sinceTimestamp)),
        }),
        kcache: (limit = 100) => repository.fn<readonly unknown[]>('stat_kcache', { limit }),
        outboxCount: () => repository.fn<number>('count_outbox', {}),
        partitionHealth: (parentTable = 'public.sessions') => repository.fn<readonly unknown[]>('list_partition_health', { parentTable }),
        qualstats: (limit = 100) => repository.fn<readonly unknown[]>('stat_qualstats', { limit }),
        statements: (limit = 100) => repository.fn<readonly unknown[]>('stat_statements', { limit }),
        syncCronJobs: () => repository.fn<readonly unknown[]>('sync_cron_jobs', {}),
        tenantPurge: (appId: string) => repository.fn<number>('purge_tenant', { appId }),
        waitSampling: (limit = 100) => repository.fn<readonly unknown[]>('stat_wait_sampling', { limit }),
        walInspect: (limit = 100) => repository.fn<readonly unknown[]>('stat_wal_inspect', { limit }),
    };
});

// --- [SERVICES] --------------------------------------------------------------

class DatabaseService extends Effect.Service<DatabaseService>()('database/DatabaseService', {
    dependencies: [SearchRepo.Default],
    effect: Effect.gen(function* () {
        const [searchRepo, sqlClient] = yield* Effect.all([SearchRepo, SqlClient.SqlClient]);
        const [users, permissions, apps, sessions, apiKeys, oauthAccounts, assets, audit, mfaSecrets, webauthnCredentials, jobs, jobDlq, notifications, kvStore, system] = yield* Effect.all([
            makeUserRepo, makePermissionRepo, makeAppRepo, makeSessionRepo, makeApiKeyRepo,
            makeOauthAccountRepo, makeAssetRepo, makeAuditRepo, makeMfaSecretRepo, makeWebauthnCredentialRepo, makeJobRepo, makeJobDlqRepo, makeNotificationRepo, makeKvStoreRepo, makeSystemRepo,
        ]);
        const monitoring = {
            cacheRatio: Effect.fn('db.cacheRatio')(system.cacheRatio),
            ioConfig: Effect.fn('db.ioConfig')(system.ioConfig),
            ioDetail: Effect.fn('db.ioDetail')(system.ioDetail),
        } as const;
        return {
            apiKeys, apps, assets, audit,
            cronJobs: Effect.fn('db.cronJobs')(() => system.cronJobs()),
            jobDlq, jobs, journal: {
                entry: (primaryKey: string) => system.journalEntry(primaryKey),
                purge: (olderThanDays: number) => system.journalPurge(olderThanDays),
                replay: (input: { batchSize: number; eventType?: string; sinceSequenceId: string; sinceTimestamp?: number }) => system.journalReplay(input),
            },
            kcache: Effect.fn('db.kcache')((limit = 100) => system.kcache(limit)),kvStore,
            mfaSecrets,
            monitoring, notifications, oauthAccounts, outbox: { count: system.outboxCount() },
            partitionHealth: Effect.fn('db.partitionHealth')((parentTable = 'public.sessions') => system.partitionHealth(parentTable)),permissions,
            qualstats: Effect.fn('db.qualstats')((limit = 100) => system.qualstats(limit)),
            search: searchRepo, sessions,
            statements: Effect.fn('db.statements')((limit = 100) => system.statements(limit)),
            syncCronJobs: Effect.fn('db.syncCronJobs')(() => system.syncCronJobs()),
            system: { tenantPurge: (appId: string) => system.tenantPurge(appId) },
            users,
            waitSampling: Effect.fn('db.waitSampling')((limit = 100) => system.waitSampling(limit)),
            walInspect: Effect.fn('db.walInspect')((limit = 100) => system.walInspect(limit)),webauthnCredentials, withTransaction: sqlClient.withTransaction,
        };
    }),
}) {}

// --- [NAMESPACE] -------------------------------------------------------------

namespace DatabaseService {
    export type Type = typeof DatabaseService.Service;
}

// --- [EXPORT] ----------------------------------------------------------------

export { DatabaseService };
