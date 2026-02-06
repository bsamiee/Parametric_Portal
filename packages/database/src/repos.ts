/**
 * Expose batched repositories via factory pattern.
 * UUIDv7 ordering, casefold comparisons, purge/revoke DB functions.
 */
import { SqlClient } from '@effect/sql';
import { Clock, Effect, Schema as S } from 'effect';
import { Client } from './client.ts';
import { repo, Update } from './factory.ts';
import { ApiKey, App, Asset, AuditLog, Job, JobDlq, KvStore, MfaSecret, OauthAccount, Session, User } from './models.ts';

// --- [USER_REPO] -------------------------------------------------------------

const makeUserRepo = Effect.gen(function* () {
	const repository = yield* repo(User, 'users', { resolve: { byEmail: ['appId', 'email'] } });
	return {
		...repository,
		byAppRole: (appId: string, role: string) => repository.find([{ field: 'app_id', value: appId }, { field: 'role', value: role }]),
		byEmail: (appId: string, email: string) => repository.by('byEmail', { appId, email }),
		restore: (id: string, appId: string) => repository.lift(id, { app_id: appId }),
		softDelete: (id: string, appId: string) => repository.drop(id, { app_id: appId }),
	};
});

// --- [APP_REPO] --------------------------------------------------------------

const makeAppRepo = Effect.gen(function* () {
	const repository = yield* repo(App, 'apps', { resolve: { byNamespace: 'namespace' } });
	return {
		...repository,
		byNamespace: (namespace: string) => repository.by('byNamespace', namespace),
		updateSettings: (id: string, settings: Record<string, unknown>) => repository.set(id, { settings }),
	};
});

// --- [SESSION_REPO] ----------------------------------------------------------

const makeSessionRepo = Effect.gen(function* () {
	const repository = yield* repo(Session, 'sessions', {
		fn: {count_sessions_by_ip: { args: [{ cast: 'inet', field: 'ip' }, 'windowMinutes'], params: S.Struct({ ip: S.String, windowMinutes: S.Number }) },
			revoke_sessions_by_ip: { args: [{ cast: 'inet', field: 'ip' }], params: S.Struct({ ip: S.String }) },},
		purge: 'purge_sessions',
		resolve: { byHash: 'hash', byRefreshHash: 'refreshHash' },
	});
	return {
		...repository,
		byHash: (hash: string) => repository.by('byHash', hash),
		byIp: (ip: string) => repository.find([{ field: 'ip_address', value: ip }]),
		byRefreshHash: (hash: string) => repository.by('byRefreshHash', hash),
		byRefreshHashForUpdate: (hash: string) => repository.one([{ field: 'refresh_hash', value: hash }], 'update'),
		byUser: (userId: string) => repository.find([{ field: 'user_id', value: userId }]),
		countByIp: (ip: string, windowMinutes = 60) => repository.fn('count_sessions_by_ip', { ip, windowMinutes }),
		restore: (id: string) => repository.lift(id),
		softDelete: (id: string) => repository.drop(id),
		softDeleteByIp: (ip: string) => repository.fn('revoke_sessions_by_ip', { ip }),
		softDeleteByUser: (userId: string) => repository.drop([{ field: 'user_id', value: userId }]),
		touch: (id: string) => repository.set(id, { updated_at: Update.now }),
		verify: (id: string) => repository.set(id, { verified_at: Update.now }, undefined, { field: 'verified_at', op: 'null' }),
	};
});

// --- [API_KEY_REPO] ----------------------------------------------------------

const makeApiKeyRepo = Effect.gen(function* () {
	const repository = yield* repo(ApiKey, 'api_keys', {
		purge: 'purge_api_keys',
		resolve: { byHash: 'hash', byUser: 'many:userId' },
	});
	return {
		...repository,
		byHash: (hash: string) => repository.by('byHash', hash),
		byUser: (userId: string) => repository.by('byUser', userId),
		restore: (id: string) => repository.lift(id),
		softDelete: (id: string) => repository.drop(id),
		touch: (id: string) => repository.set(id, { last_used_at: Update.now }),
	};
});

// --- [OAUTH_ACCOUNT_REPO] ----------------------------------------------------

const makeOauthAccountRepo = Effect.gen(function* () {
	const repository = yield* repo(OauthAccount, 'oauth_accounts', {
		conflict: { keys: ['provider', 'externalId'], only: ['accessEncrypted', 'expiresAt', 'refreshEncrypted'] },
		purge: 'purge_oauth_accounts',
		resolve: { byExternal: ['provider', 'externalId'], byUser: 'many:userId' },
	});
	return {
		...repository,
		byExternal: (provider: string, externalId: string) => repository.by('byExternal', { externalId, provider }),
		byUser: (userId: string) => repository.by('byUser', userId),
		restore: (id: string) => repository.lift(id),
		softDelete: (id: string) => repository.drop(id),
	};
});

// --- [ASSET_REPO] ------------------------------------------------------------

const makeAssetRepo = Effect.gen(function* () {
	const repository = yield* repo(Asset, 'assets', { purge: 'purge_assets' });
	return {
		...repository,
		byAppType: (appId: string, type: string) => repository.find([{ field: 'app_id', value: appId }, { field: 'type', value: type }]),
		byFilter: (userId: string, appId: string, { after, before, ids, types }: { after?: Date; before?: Date; ids?: string[]; types?: string[] } = {}) => repository.find(repository.preds({ after, app_id: appId, before, id: ids, type: types, user_id: userId })),
		byHash: (hash: string) => repository.one([{ field: 'hash', value: hash }]),
		byUser: (userId: string) => repository.find([{ field: 'user_id', value: userId }]),
		byUserKeyset: (userId: string, limit: number, cursor?: string) => repository.page([{ field: 'user_id', value: userId }], { cursor, limit }),
		findStaleForPurge: (olderThanDays: number) => Clock.currentTimeMillis.pipe(	// Find soft-deleted assets with storageRef older than specified days (for S3 cleanup). Uses Clock for testability.
			Effect.andThen((now) => repository.find([
				{ field: 'deleted_at', op: 'notNull' },
				{ field: 'deleted_at', op: 'lt', value: new Date(now - olderThanDays * 24 * 60 * 60 * 1000) },
				{ field: 'storage_ref', op: 'notNull' },
			])),
		),
		insertMany: (items: readonly S.Schema.Type<typeof Asset.insert>[]) => repository.put(items as S.Schema.Type<typeof Asset.insert>[]),
		restore: (id: string, appId: string) => repository.lift(id, { app_id: appId }),
		softDelete: (id: string, appId: string) => repository.drop(id, { app_id: appId }),
	};
});

// --- [AUDIT_REPO] ------------------------------------------------------------

const makeAuditRepo = Effect.gen(function* () {
	const repository = yield* repo(AuditLog, 'audit_logs', {
		fn: { count_audit_by_ip: { args: [{ cast: 'uuid', field: 'appId' }, { cast: 'inet', field: 'ip' }, 'windowMinutes'], params: S.Struct({ appId: S.UUID, ip: S.String, windowMinutes: S.Number }) } },
	});
	return {
		...repository,
		byIp: (appId: string, ip: string, limit: number, cursor?: string) => repository.page([{ field: 'app_id', value: appId }, { field: 'ip_address', value: ip }], { cursor, limit }),
		bySubject: (appId: string, subject: string, subjectId: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: string } = {}) => repository.page(repository.preds({ after, app_id: appId, before, operation, subject, subject_id: subjectId }), { cursor, limit }),
		byUser: (appId: string, userId: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: string } = {}) => repository.page(repository.preds({ after, app_id: appId, before, operation, user_id: userId }), { cursor, limit }),
		countByIp: (appId: string, ip: string, windowMinutes = 60) => repository.fn('count_audit_by_ip', { appId, ip, windowMinutes }),
		log: repository.insert,
	};
});

// --- [MFA_SECRET_REPO] -------------------------------------------------------

const makeMfaSecretRepo = Effect.gen(function* () {
	const repository = yield* repo(MfaSecret, 'mfa_secrets', {
		conflict: { keys: ['userId'], only: ['backupHashes', 'enabledAt', 'encrypted'] },
		purge: 'purge_mfa_secrets',
		resolve: { byUser: 'userId' },
	});
	return {
		...repository,
		byUser: (userId: string) => repository.by('byUser', userId),
		byUserForUpdate: (userId: string) => repository.one([{ field: 'user_id', value: userId }], 'update'),
		enable: (userId: string) => repository.set([{ field: 'user_id', value: userId }], { enabled_at: Update.now }),
		restore: (userId: string) => repository.lift([{ field: 'user_id', value: userId }]),
		softDelete: (userId: string) => repository.drop([{ field: 'user_id', value: userId }]),
	};
});

// --- [JOB_REPO] --------------------------------------------------------------

const makeJobRepo = Effect.gen(function* () {
	const repository = yield* repo(Job, 'jobs', { pk: { column: 'job_id' } });
	return {
		...repository,
	};
});

// --- [JOB_DLQ_REPO] ----------------------------------------------------------

const makeJobDlqRepo = Effect.gen(function* () {
	const repository = yield* repo(JobDlq, 'job_dlq', {
		purge: 'purge_job_dlq',
		resolve: { byOriginalJob: 'originalJobId' },
	});
	return {
		...repository,
		byErrorReason: (errorReason: string, options?: { limit?: number; cursor?: string }) => repository.page([{ field: 'error_reason', value: errorReason }], { cursor: options?.cursor, limit: options?.limit ?? 100 }),
		byOriginalJob: (originalJobId: string) => repository.by('byOriginalJob', originalJobId),
		byRequest: (requestId: string) => repository.find([{ field: 'request_id', value: requestId }]),
		countPending: (type?: string) => repository.count(type ? [{ field: 'type', value: type }] : []),
		listPending: (options?: { type?: string; limit?: number; cursor?: string }) => repository.page(options?.type ? [{ field: 'type', value: options.type }] : [], { cursor: options?.cursor, limit: options?.limit ?? 100 }),
		markReplayed: (id: string) => repository.drop(id),		// drop() sets replayedAt = NOW() (mark:soft)
		unmarkReplayed: (id: string) => repository.lift(id),		// lift() sets replayedAt = NULL (undo replay)
	};
});

// --- [KV_STORE_REPO] ---------------------------------------------------------

const makeKvStoreRepo = Effect.gen(function* () {
	const repository = yield* repo(KvStore, 'kv_store', {
		conflict: { keys: ['key'], only: ['value', 'expiresAt'] },
		fn: { delete_kv_by_prefix: { args: ['prefix'], params: S.Struct({ prefix: S.String }) } },
		purge: 'purge_kv_store',
		resolve: { byKey: 'key' },
	});
	return {
		...repository,
		byKey: (key: string) => repository.by('byKey', key),
		deleteByPrefix: (prefix: string) => repository.fn('delete_kv_by_prefix', { prefix }),
		getJson: <A, I>(key: string, schema: S.Schema<A, I, never>) => repository.by('byKey', key).pipe(Effect.flatMap(repository.json.decode('value', schema))),
		setJson: <A, I>(key: string, jsonValue: A, schema: S.Schema<A, I, never>, expiresAt?: Date) => repository.json.encode(schema)(jsonValue).pipe(Effect.flatMap((encoded) => repository.upsert({ expiresAt, key, value: encoded }))),
	};
});

// --- [EVENT_JOURNAL] ---------------------------------------------------------
// SqlEventJournal manages its own CRUD — only purge function needed for cleanup

const _purgeEventJournal = (olderThanDays: number) => Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
	const result = yield* sql`
		WITH deleted AS (
			DELETE FROM effect_event_journal WHERE timestamp < ${cutoff} RETURNING id
		)
		SELECT COUNT(*)::int as count FROM deleted
	`;
	return (result[0]?.['count'] as number) ?? 0;
});

// --- [SERVICES] --------------------------------------------------------------

class DatabaseService extends Effect.Service<DatabaseService>()('database/DatabaseService', {
	effect: Effect.gen(function* () {
		const sqlClient = yield* SqlClient.SqlClient;
		const [users, apps, sessions, apiKeys, oauthAccounts, assets, audit, mfaSecrets, jobs, jobDlq, kvStore] = yield* Effect.all([
			makeUserRepo, makeAppRepo, makeSessionRepo, makeApiKeyRepo,
			makeOauthAccountRepo, makeAssetRepo, makeAuditRepo, makeMfaSecretRepo, makeJobRepo, makeJobDlqRepo, makeKvStoreRepo,
		]);
		return { apiKeys, apps, assets, audit, eventJournal: { purge: _purgeEventJournal }, jobDlq, jobs, kvStore, listStatStatements: Client.statements, mfaSecrets, oauthAccounts, sessions, users, withTransaction: sqlClient.withTransaction };
	}),
}) {}

// --- [NAMESPACE] -------------------------------------------------------------

namespace DatabaseService {
	export type Type = typeof DatabaseService.Service;
}

// --- [EXPORT] ----------------------------------------------------------------

export { DatabaseService };
