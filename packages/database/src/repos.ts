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

const _LIMITS: { defaultPage: number } = { defaultPage: 100 };

// --- [REPOSITORIES] ----------------------------------------------------------

const makeUserRepo = Effect.gen(function* () {
    const repository = yield* repo(User, 'users', { resolve: { byEmail: 'email', byRole: { field: 'role', many: true } }, scoped: 'appId' });
    return { ...repository, setPreferences: (id: string, preferences: S.Schema.Type<typeof User.fields.preferences>) => repository.set(id, { preferences }),};
});
const makePermissionRepo = Effect.gen(function* () {
    const repository = yield* repo(Permission, 'permissions', {
        conflict: { keys: ['appId', 'role', 'resource', 'action'], only: ['deletedAt'] },
        resolve: { byRole: { field: 'role', many: true } },
        scoped: 'appId',
    });
    return { ...repository,
        grant:      (payload: { appId: string; role: S.Schema.Type<typeof Permission.fields.role>; resource: string; action: string }) => repository.upsert({action: payload.action, appId: payload.appId, deletedAt: Option.none(), resource: payload.resource, role: payload.role, updatedAt: undefined,}),
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
            byAccessToken:  { field: 'tokenAccess', through: { table: 'session_tokens', target: 'sessionId' } },
            byRefreshToken: { field: 'tokenRefresh', through: { table: 'session_tokens', target: 'sessionId' } },
            byUser:         { field: 'userId', many: true },
        },
        scoped: 'appId',
    });
    return { ...repository,
        byRefreshTokenForUpdate: (hash: string) => repository.by('byRefreshToken', hash, 'update'),
        softDeleteByIp: (appId: string, ip: string) => repository.drop([{ field: 'appId', value: appId }, { field: 'ipAddress', value: ip }]),
        touch: repository.touch('updatedAt'),
        verify: (id: string) => repository.set(id, { verifiedAt: Update.now }, undefined, { field: 'verifiedAt', op: 'null' }),
    };
});
const makeApiKeyRepo = Effect.gen(function* () {
    const repository = yield* repo(ApiKey, 'api_keys', { purge: { column: 'deletedAt', defaultDays: 365, table: 'api_keys' }, resolve: { byHash: 'hash', byUser: { field: 'userId', many: true } } });
    return { ...repository, touch: repository.touch('lastUsedAt'),};
});
const makeOauthAccountRepo = Effect.gen(function* () {
    const repository = yield* repo(OauthAccount, 'oauth_accounts', {
        conflict: { keys: ['provider', 'externalId'], only: ['tokenPayload'] },
        purge: { column: 'deletedAt', defaultDays: 90, table: 'oauth_accounts' }, resolve: { byExternal: ['provider', 'externalId'], byUser: { field: 'userId', many: true } },
    });
    return { ...repository, byExternal: (provider: string, externalId: string) => repository.by('byExternal', { externalId, provider }),};
});
const makeAssetRepo = Effect.gen(function* () {
    const repository = yield* repo(Asset, 'assets', { purge: { column: 'deletedAt', defaultDays: 30, table: 'assets' }, resolve: { byHash: 'hash', byType: { field: 'type', many: true }, byUser: { field: 'userId', many: true } }, scoped: 'appId' });
    return { ...repository,
        byFilter: (userId: string, { after, before, ids, types }: { after?: Date; before?: Date; ids?: string[]; types?: string[] } = {}) => repository.find(repository.preds({ after, before, id: ids, type: types, userId })),
        findStaleForPurge: (olderThanDays: number) => Clock.currentTimeMillis.pipe(Effect.andThen((now) => repository.find([{ field: 'deletedAt',  op: 'notNull' },{ field: 'deletedAt',  op: 'lt', value: new Date(now - olderThanDays * 24 * 60 * 60 * 1000) },{ field: 'storageRef', op: 'notNull' },])),),
    };
});
const makeAuditRepo = Effect.gen(function* () {
    const repository = yield* repo(AuditLog, 'audit_logs', { scoped: 'appId' });
    return { ...repository,
        bySubject: (type: string, id: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: S.Schema.Type<typeof AuditOperationSchema> } = {}) => repository.page([{ field: 'targetType', value: type }, { field: 'targetId', value: id }, ...repository.preds({ after, before, operation })], { limit, ...(cursor !== undefined ? { cursor } : {}) }),
        byUser: (userId: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: S.Schema.Type<typeof AuditOperationSchema> } = {}) => repository.page(repository.preds({ after, before, operation, userId }), { limit, ...(cursor !== undefined ? { cursor } : {}) }),
        log: repository.insert,
    };
});
const makeMfaSecretRepo = Effect.gen(function* () {
    const repository = yield* repo(MfaSecret, 'mfa_secrets', {
        conflict: { keys: ['userId'], only: ['backups', 'enabledAt', 'encrypted'] },
        purge:    { column: 'deletedAt', defaultDays: 90, table: 'mfa_secrets' }, resolve: { byUser: 'userId' },
    });
    return { ...repository, softDelete: (userId: string) => repository.drop([{ field: 'userId', value: userId }]),};
});
const makeWebauthnCredentialRepo = Effect.gen(function* () {
    const repository = yield* repo(WebauthnCredential, 'webauthn_credentials', { resolve: { byCredentialId: 'credentialId', byUser: { field: 'userId', many: true } } });
    return { ...repository,
        touch: repository.touch('lastUsedAt'),
        updateCounter: (id: string, counter: number) => repository.set(id, { counter, lastUsedAt: Update.now }),
    };
});
const makeJobRepo = Effect.gen(function* () {
    const repository = yield* repo(Job, 'jobs', { pk: { column: 'job_id' }, scoped: 'appId' });
    return { ...repository,
        countByStatuses: (...statuses: readonly string[]) => repository.count([{ field: 'status', op: 'in', values: [...statuses] }]),
    };
});
const makeJobDlqRepo = Effect.gen(function* () {
    const repository = yield* repo(JobDlq, 'job_dlq', { purge: { column: 'replayedAt', defaultDays: 30, table: 'job_dlq' }, resolve: { byRequest: { field: 'contextRequestId', many: true }, bySource: 'sourceId' }, scoped: 'appId' });
    return { ...repository,
        countPending:   (type?: string) => repository.count(repository.wildcard('type', type)),
        listPending:    (options?: { type?: string; limit?: number; cursor?: string }) => repository.page(repository.wildcard('type', options?.type), options),
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
        purge:     { column: 'expiresAt', defaultDays: 30, table: 'kv_store' }, resolve: { byKey: 'key' },
    });
    return { ...repository,
        getJson: <A, I, R>(key: string, schema: S.Schema<A, I, R>) => repository.by('byKey', key).pipe(Effect.flatMap(repository.json.decode('value', schema))),
        setJson: <A, I, R>(key: string, jsonValue: A, schema: S.Schema<A, I, R>, expiresAt?: Date) => repository.json.encode(schema)(jsonValue).pipe(Effect.flatMap((encoded) => repository.upsert({ expiresAt, key, value: encoded }))),
    };
});
const makeSystemRepo = Effect.gen(function* () {
    const repository = yield* routine('database/system', {
        functions: {
            get_journal_entry: { args: ['primaryKey'], mode: 'set', params: S.Struct({ primaryKey: S.String }), schema: S.Struct({ payload: S.String }) },
            list_journal_entries: {
                args: ['sinceSequenceId', 'sinceTimestamp', 'eventType', 'batchSize'],
                mode: 'set',
                params: S.Struct({ batchSize: S.Number, eventType: S.NullOr(S.String), sinceSequenceId: S.String, sinceTimestamp: S.NullOr(S.Number) }),
                schema: S.Struct({ payload: S.String, primaryKey: S.String }),
            },
            outbox_count:  { mode: 'scalar',  schema: S.Int },
            purge_journal: { args: ['days'],  params: S.Struct({ days: S.Number }) },
            purge_tenant:  { args: ['appId'], params: S.Struct({ appId: S.UUID }) },
            query_db_observability: {
                args: [{ cast: 'jsonb', field: 'sections' }, 'limit'],
                mode: 'typed',
                params: S.Struct({ limit: S.Number, sections: S.String }),
                schema: S.Record({ key: S.String, value: S.Unknown }),
            },
        },
    });
    return {
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
        outboxCount: () => repository.fn<number>('outbox_count', {}),
        query: (input: {
            limit?: number;
            sections: readonly { name: string; options?: Record<string, unknown> }[];
        }) => repository.fn<Record<string, unknown>>('query_db_observability', {
            limit: input.limit ?? _LIMITS.defaultPage,
            sections: JSON.stringify(input.sections),
        }),
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
