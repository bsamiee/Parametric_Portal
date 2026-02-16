/**
 * Expose batched repositories via factory pattern.
 * UUIDv7 ordering, casefold comparisons, purge/revoke DB functions.
 */
import { SqlClient } from '@effect/sql';
import { Clock, Effect, Option, Record as R, Schema as S } from 'effect';
import { repo, routine, Update } from './factory.ts';
import { ApiKey, App, AppSettingsDefaults, Asset, AuditLog, type AuditOperationSchema, Job, JobDlq, KvStore, MfaSecret, Notification, OauthAccount, Permission, Session, User, WebauthnCredential, AppSettingsSchema } from './models.ts';
import { SearchRepo } from './search.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _LIMITS: { defaultAuditWindow: number; defaultPage: number } = { defaultAuditWindow: 60, defaultPage: 100 };

// --- [REPOSITORIES] ----------------------------------------------------------

const makeUserRepo = Effect.gen(function* () {
    const repository = yield* repo(User, 'users', { resolve: { byEmail: 'email', byRole: { field: 'role', many: true } }, scoped: 'appId' });
    return { ...repository, setPreferences: (id: string, preferences: S.Schema.Type<typeof User.fields.preferences>) => repository.set(id, { preferences }),};
});
const makePermissionRepo = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const repository = yield* repo(Permission, 'permissions', {
        conflict: { keys: ['appId', 'role', 'resource', 'action'], only: ['deletedAt'] },
        resolve:  { byRole: { field: 'role', many: true } },
        scoped:   'appId',
    });
    return { ...repository,
        grant:      (payload: { appId: string; role: S.Schema.Type<typeof Permission.fields.role>; resource: string; action: string }) => repository.upsert({action: payload.action, appId: payload.appId, deletedAt: Option.none(), resource: payload.resource, role: payload.role, updatedAt: undefined,}),
        lookupImmv: (appId: string, role: string, resource: string, action: string) => sql`SELECT app_id FROM permission_lookups WHERE app_id = ${appId} AND role = ${role} AND resource = ${resource} AND action = ${action}`.pipe(Effect.map((rows) => rows.length > 0)),
        revoke:     (role: string, resource: string, action: string) => repository.drop([{ field: 'role', value: role },{ field: 'resource', value: resource },{ field: 'action', value: action },]),
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
        purge: 'purge_sessions',
        resolve: {
            byAccessToken:  { field: 'token_access', through: { table: 'session_tokens', target: 'session_id' } },
            byRefreshToken: { field: 'token_refresh', through: { table: 'session_tokens', target: 'session_id' } },
            byUser:         { field: 'userId', many: true },
        },
        scoped: 'appId',
    });
    return { ...repository,
        byRefreshTokenForUpdate: (hash: string) => repository.by('byRefreshToken', hash, 'update'),
        softDeleteByIp: (appId: string, ip: string) => repository.drop([{ field: 'app_id', value: appId }, { field: 'ip_address', value: ip }]),
        touch: repository.touch('updated_at'),
        verify: (id: string) => repository.set(id, { verified_at: Update.now }, undefined, { field: 'verified_at', op: 'null' }),
    };
});
const makeApiKeyRepo = Effect.gen(function* () {
    const repository = yield* repo(ApiKey, 'api_keys', { purge: { column: 'deleted_at', defaultDays: 365, table: 'api_keys' }, resolve: { byHash: 'hash', byUser: { field: 'userId', many: true } } });
    return { ...repository, touch: repository.touch('last_used_at'),};
});
const makeOauthAccountRepo = Effect.gen(function* () {
    const repository = yield* repo(OauthAccount, 'oauth_accounts', {
        conflict: { keys: ['provider', 'externalId'], only: ['tokenPayload'] },
        purge: { column: 'deleted_at', defaultDays: 90, table: 'oauth_accounts' }, resolve: { byExternal: ['provider', 'externalId'], byUser: { field: 'userId', many: true } },
    });
    return { ...repository, byExternal: (provider: string, externalId: string) => repository.by('byExternal', { externalId, provider }),};
});
const makeAssetRepo = Effect.gen(function* () {
    const repository = yield* repo(Asset, 'assets', { purge: { column: 'deleted_at', defaultDays: 30, table: 'assets' }, resolve: { byHash: 'hash', byType: { field: 'type', many: true }, byUser: { field: 'userId', many: true } }, scoped: 'appId' });
    return { ...repository,
        byFilter: (userId: string, { after, before, ids, types }: { after?: Date; before?: Date; ids?: string[]; types?: string[] } = {}) => repository.find(repository.preds({ after, before, id: ids, type: types, user_id: userId })),
        byUserKeyset: (userId: string, limit: number, cursor?: string) => repository.page([{ field: 'user_id', value: userId }], { cursor, limit }),
        findStaleForPurge: (olderThanDays: number) => Clock.currentTimeMillis.pipe(Effect.andThen((now) => repository.find([{ field: 'deleted_at',  op: 'notNull' },{ field: 'deleted_at',  op: 'lt', value: new Date(now - olderThanDays * 24 * 60 * 60 * 1000) },{ field: 'storage_ref', op: 'notNull' },])),),
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
        countByIp: (appId: string, ip: string, windowMinutes = _LIMITS.defaultAuditWindow) => repository.fn<number>('count_audit_by_ip', { appId, ip, windowMinutes }),
        log: repository.insert,
    };
});
const makeMfaSecretRepo = Effect.gen(function* () {
    const repository = yield* repo(MfaSecret, 'mfa_secrets', {
        conflict: { keys: ['userId'], only: ['backups', 'enabledAt', 'encrypted'] },
        purge:    { column: 'deleted_at', defaultDays: 90, table: 'mfa_secrets' }, resolve: { byUser: 'userId' },
    });
    return { ...repository, softDelete: (userId: string) => repository.drop([{ field: 'user_id', value: userId }]),};
});
const makeWebauthnCredentialRepo = Effect.gen(function* () {
    const repository = yield* repo(WebauthnCredential, 'webauthn_credentials', { resolve: { byCredentialId: 'credentialId', byUser: { field: 'userId', many: true } } });
    return { ...repository,
        touch: repository.touch('last_used_at'),
        updateCounter: (id: string, counter: number) => repository.set(id, { counter, last_used_at: Update.now }),
    };
});
const makeJobRepo = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const repository = yield* repo(Job, 'jobs', { pk: { column: 'job_id' }, scoped: 'appId' });
    return { ...repository,
        byDateRange: (after: Date, before: Date, options?: { limit?: number; cursor?: string }) => repository.page(repository.preds({ after, before }), repository.pageOpts(options)),
        byStatus: (status: string, options?: { after?: Date; before?: Date; limit?: number; cursor?: string }) => repository.page([{ field: 'status', value: status }, ...repository.preds({ after: options?.after, before: options?.before })], repository.pageOpts(options)),
        countByStatuses: (...statuses: readonly string[]) => repository.count([{ field: 'status', op: 'in', values: [...statuses] }]),
        countByStatusesImmv: (...statuses: readonly string[]) => sql`SELECT status, cnt FROM job_status_counts WHERE status IN ${sql.in([...statuses])}`.pipe(Effect.map((rows) => Object.fromEntries((rows as readonly { status: string; cnt: number }[]).map((row) => [row.status, row.cnt])) as Record<string, number>)),
        isDuplicate: (dedupeKey: string) => repository.exists([{ raw: sql`correlation->>'dedupe' = ${dedupeKey}` }, { field: 'status', op: 'in', values: ['queued', 'processing'] }]),
    };
});
const makeJobDlqRepo = Effect.gen(function* () {
    const repository = yield* repo(JobDlq, 'job_dlq', { purge: { column: 'replayed_at', defaultDays: 30, table: 'job_dlq' }, resolve: { byRequest: { field: 'contextRequestId', many: true }, bySource: 'sourceId' }, scoped: 'appId' });
    return { ...repository,
        byErrorReason:  (errorReason: string, options?: { limit?: number; cursor?: string }) => repository.page([{ field: 'error_reason', value: errorReason }], repository.pageOpts(options)),
        countPending:   (type?: string) => repository.count(repository.wildcard('type', type)),
        listPending:    (options?: { type?: string; limit?: number; cursor?: string }) => repository.page(repository.wildcard('type', options?.type), repository.pageOpts(options)),
        markReplayed:   (id: string) => repository.drop(id),
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
        conflict:  { keys: ['key'], only: ['value', 'expiresAt'] },
        functions: { delete_kv_by_prefix: { args: ['prefix'], params: S.Struct({ prefix: S.String }) } },
        purge:     { column: 'expires_at', defaultDays: 30, table: 'kv_store' }, resolve: { byKey: 'key' },
    });
    return { ...repository,
        deleteByPrefix: (prefix: string) => repository.fn<number>('delete_kv_by_prefix', { prefix }),
        getJson: <A, I, R>(key: string, schema: S.Schema<A, I, R>) => repository.by('byKey', key).pipe(Effect.flatMap(repository.json.decode('value', schema))),
        setJson: <A, I, R>(key: string, jsonValue: A, schema: S.Schema<A, I, R>, expiresAt?: Date) => repository.json.encode(schema)(jsonValue).pipe(Effect.flatMap((encoded) => repository.upsert({ expiresAt, key, value: encoded }))),
    };
});

const makeSystemRepo = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const repository = yield* routine('database/system', {
        functions: {
            create_hypothetical_index: { args: ['statement'], mode: 'set', params: S.Struct({ statement: S.String }), schema: S.Struct({ indexname: S.String, indexrelid: S.Number }) },
            exec_delegate:     { args: ['name', { cast: 'jsonb', field: 'args' }], mode: 'scalar', params: S.Struct({ args: S.NullOr(S.String), name: S.String }), schema: S.Boolean },
            get_journal_entry: { args: ['primaryKey'], mode: 'set', params: S.Struct({ primaryKey: S.String }), schema: S.Struct({ payload: S.String }) },
            heap_force_freeze: { args: ['relation', 'block'], params: S.Struct({ block: S.Number, relation: S.String }) },
            list_journal_entries: {
                args: ['sinceSequenceId', 'sinceTimestamp', 'eventType', 'batchSize'],
                mode: 'set',
                params: S.Struct({ batchSize: S.Number, eventType: S.NullOr(S.String), sinceSequenceId: S.String, sinceTimestamp: S.NullOr(S.Number) }),
                schema: S.Struct({ payload: S.String, primaryKey: S.String }),
            },
            list_partition_health: { args: ['parentTable'], mode: 'typed', params: S.Struct({ parentTable: S.String }), schema: S.Array(S.Unknown) },
            prewarm_relation:      { args: ['relation', 'mode'], params: S.Struct({ mode: S.String, relation: S.String }) },
            purge_journal:         { args: ['days'], params: S.Struct({ days: S.Number }) },
            purge_tenant:          { args: ['appId'], params: S.Struct({ appId: S.UUID }) },
            reset_hypothetical_indexes: { mode: 'scalar', schema: S.Void },
            stat: {
                args: ['name', 'limit', { cast: 'jsonb', field: 'extra' }],
                mode: 'typed',
                params: S.Struct({ extra: S.NullOr(S.String), limit: S.Number, name: S.String }),
                schema: S.Array(S.Unknown),
            },
            stat_batch: {
                args: ['names', 'limit', { cast: 'jsonb', field: 'extra' }],
                mode: 'typed',
                params: S.Struct({ extra: S.NullOr(S.String), limit: S.Number, names: S.Array(S.String) }),
                schema: S.Unknown,
            },
            sync_cron_jobs: { mode: 'typed', schema: S.Array(S.Unknown) },
        },
    });
    return {
        createHypotheticalIndex: (statement: string) => repository.fn<readonly { indexrelid: number; indexname: string }[]>('create_hypothetical_index', { statement }),
        heapForceFreeze: (relation: string, block = 0) => repository.fn<void>('heap_force_freeze', { block, relation }),
        immvJobStatusCounts: () => sql<{ appId: string; status: string; cnt: number }>`
                SELECT app_id, status, cnt
                FROM job_status_counts ORDER BY app_id, status`,
        immvPermissionLookups: () => sql<{ appId: string; role: string; resource: string; action: string }>`
                SELECT app_id, role, resource, action
                FROM permission_lookups
                ORDER BY app_id, role, resource, action`,
        journalEntry:  (primaryKey: string) => repository.fn<readonly { payload: string }[]>('get_journal_entry', { primaryKey }).pipe(Effect.map((rows) => Option.fromNullable(rows[0]))),
        journalPurge:  (days: number) => repository.fn<number>('purge_journal', { days }),
        journalReplay: (input: { batchSize: number; eventType?: string; sinceSequenceId: string; sinceTimestamp?: number }) => repository.fn<readonly { payload: string; primaryKey: string }[]>(
            'list_journal_entries', {
                batchSize: input.batchSize,
                eventType: Option.getOrNull(Option.fromNullable(input.eventType)),
                sinceSequenceId: input.sinceSequenceId,
                sinceTimestamp: Option.getOrNull(Option.fromNullable(input.sinceTimestamp)),
            },
        ),
        outboxCount: () => sql`SELECT COUNT(*)::int AS count FROM effect_event_remotes`.pipe(Effect.map((rows) => (rows[0] as { count: number }).count),),
        partitionHealth: (parentTable = 'public.sessions') => repository.fn<readonly { bound: string | null; isLeaf: boolean; level: number; partition: string }[]>('list_partition_health', { parentTable }),
        prewarmRelation: (relation: string, mode = 'buffer') => repository.fn<number>('prewarm_relation', { mode, relation }),
        resetHypotheticalIndexes: () => repository.fn<void>('reset_hypothetical_indexes', {}),
        resetWaitSampling: () => repository.fn<boolean>('exec_delegate', { args: null, name: 'reset_wait_sampling' }),
        runPartmanMaintenance: () => repository.fn<boolean>('exec_delegate', { args: null, name: 'run_partman' }),
        squeezeStartWorker: () => repository.fn<boolean>('exec_delegate', { args: null, name: 'start_squeeze' }),
        squeezeStatus: () => Effect.all({ tables: repository.stat('squeeze_tables'), workers: repository.stat('squeeze_workers') }),
        squeezeStopWorker: (pid: number) => repository.fn<boolean>('exec_delegate', { args: JSON.stringify({ pid }), name: 'stop_squeeze' }),
        stat: (name: string, limit = _LIMITS.defaultPage, extra: Record<string, unknown> | null = null) => {
            const toSnake = (str: string) => str.replaceAll(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
            return repository.stat(toSnake(name), limit, extra ? Object.fromEntries(Object.entries(extra).map(([key, value]) => [toSnake(key), value])) : null);
        },
        statBatch: (names: readonly string[], limit = _LIMITS.defaultPage) => repository.statBatch(names, limit),
        syncCronJobs: () => repository.fn<readonly { error?: string; name: string; schedule: string; status: 'created' | 'error' | 'unchanged' | 'updated' }[]>('sync_cron_jobs', {}),
        tenantPurge: (appId: string) => repository.fn<number>('purge_tenant', { appId }),
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
        return {
            apiKeys, apps, assets, audit, jobDlq, jobs, kvStore, mfaSecrets, notifications, oauthAccounts, observability: system, permissions, search: searchRepo, sessions,
            users, webauthnCredentials, withTransaction: sqlClient.withTransaction,
        };
    }),
}) {}

// --- [NAMESPACE] -------------------------------------------------------------

namespace DatabaseService {
    export type Type = typeof DatabaseService.Service;
}

// --- [EXPORT] ----------------------------------------------------------------

export { DatabaseService };
