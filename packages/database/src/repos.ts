/**
 * Expose batched repositories via factory pattern.
 * UUIDv7 ordering, casefold comparisons, purge/revoke DB functions.
 */
import { SqlClient } from '@effect/sql';
import { Clock, Effect, Schema as S } from 'effect';
import { repo, routine, Update } from './factory.ts';
import { ApiKey, App, Asset, AuditLog, Job, JobDlq, KvStore, MfaSecret, OauthAccount, Session, User, WebauthnCredential } from './models.ts';

// --- [REPOSITORIES] ----------------------------------------------------------

const makeUserRepo = Effect.gen(function* () {
	const repository = yield* repo(User, 'users', { resolve: { byEmail: ['appId', 'email'] } });
	return { ...repository,
		byAppRole: (appId: string, role: string) => repository.find([{ field: 'app_id', value: appId }, { field: 'role', value: role }]),
		byEmail: (appId: string, email: string) => repository.by('byEmail', { appId, email }),
		restore: (id: string, appId: string) => repository.lift(id, { app_id: appId }),
		softDelete: (id: string, appId: string) => repository.drop(id, { app_id: appId }),
	};
});
const makeAppRepo = Effect.gen(function* () {
	const repository = yield* repo(App, 'apps', { resolve: { byNamespace: 'namespace' } });
	return { ...repository,
		byNamespace: (namespace: string) => repository.by('byNamespace', namespace),
		updateSettings: (id: string, settings: Record<string, unknown>) => repository.set(id, { settings }),
	};
});
const makeSessionRepo = Effect.gen(function* () {
	const repository = yield* repo(Session, 'sessions', {
		fn: { count_sessions_by_ip: { args: [{ cast: 'inet', field: 'ip' }, 'windowMinutes'], params: S.Struct({ ip: S.String, windowMinutes: S.Number }) },
			revoke_sessions_by_ip: { args: [{ cast: 'inet', field: 'ip' }], params: S.Struct({ ip: S.String }) } },
		purge: 'purge_sessions', resolve: { byHash: 'hash', byRefreshHash: 'refreshHash' },
	});
	return { ...repository,
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
const makeApiKeyRepo = Effect.gen(function* () {
	const repository = yield* repo(ApiKey, 'api_keys', { purge: 'purge_api_keys', resolve: { byHash: 'hash', byUser: 'many:userId' } });
	return { ...repository,
		byHash: (hash: string) => repository.by('byHash', hash),
		byUser: (userId: string) => repository.by('byUser', userId),
		restore: (id: string) => repository.lift(id),
		softDelete: (id: string) => repository.drop(id),
		touch: (id: string) => repository.set(id, { last_used_at: Update.now }),
	};
});
const makeOauthAccountRepo = Effect.gen(function* () {
	const repository = yield* repo(OauthAccount, 'oauth_accounts', {
		conflict: { keys: ['provider', 'externalId'], only: ['accessEncrypted', 'expiresAt', 'refreshEncrypted'] },
		purge: 'purge_oauth_accounts', resolve: { byExternal: ['provider', 'externalId'], byUser: 'many:userId' },
	});
	return { ...repository,
		byExternal: (provider: string, externalId: string) => repository.by('byExternal', { externalId, provider }),
		byUser: (userId: string) => repository.by('byUser', userId),
		restore: (id: string) => repository.lift(id),
		softDelete: (id: string) => repository.drop(id),
	};
});
const makeAssetRepo = Effect.gen(function* () {
	const repository = yield* repo(Asset, 'assets', { purge: 'purge_assets' });
	return { ...repository,
		byAppType: (appId: string, type: string) => repository.find([{ field: 'app_id', value: appId }, { field: 'type', value: type }]),
		byFilter: (userId: string, appId: string, { after, before, ids, types }: { after?: Date; before?: Date; ids?: string[]; types?: string[] } = {}) => repository.find(repository.preds({ after, app_id: appId, before, id: ids, type: types, user_id: userId })),
		byHash: (hash: string) => repository.one([{ field: 'hash', value: hash }]),
		byUser: (userId: string) => repository.find([{ field: 'user_id', value: userId }]),
		byUserKeyset: (userId: string, limit: number, cursor?: string) => repository.page([{ field: 'user_id', value: userId }], { cursor, limit }),
		findStaleForPurge: (olderThanDays: number) => Clock.currentTimeMillis.pipe(
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
const makeAuditRepo = Effect.gen(function* () {
	const repository = yield* repo(AuditLog, 'audit_logs', {
		fn: { count_audit_by_ip: { args: [{ cast: 'uuid', field: 'appId' }, { cast: 'inet', field: 'ip' }, 'windowMinutes'], params: S.Struct({ appId: S.UUID, ip: S.String, windowMinutes: S.Number }) } },
	});
	return { ...repository,
		byIp: (appId: string, ip: string, limit: number, cursor?: string) => repository.page([{ field: 'app_id', value: appId }, { field: 'ip_address', value: ip }], { cursor, limit }),
		bySubject: (appId: string, subject: string, subjectId: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: string } = {}) => repository.page(repository.preds({ after, app_id: appId, before, operation, subject, subject_id: subjectId }), { cursor, limit }),
		byUser: (appId: string, userId: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: string } = {}) => repository.page(repository.preds({ after, app_id: appId, before, operation, user_id: userId }), { cursor, limit }),
		countByIp: (appId: string, ip: string, windowMinutes = 60) => repository.fn('count_audit_by_ip', { appId, ip, windowMinutes }),
		log: repository.insert,
	};
});
const makeMfaSecretRepo = Effect.gen(function* () {
	const repository = yield* repo(MfaSecret, 'mfa_secrets', {
		conflict: { keys: ['userId'], only: ['backupHashes', 'enabledAt', 'encrypted'] },
		purge: 'purge_mfa_secrets', resolve: { byUser: 'userId' },
	});
	return { ...repository,
		byUser: (userId: string) => repository.by('byUser', userId),
		byUserForUpdate: (userId: string) => repository.one([{ field: 'user_id', value: userId }], 'update'),
		enable: (userId: string) => repository.set([{ field: 'user_id', value: userId }], { enabled_at: Update.now }),
		restore: (userId: string) => repository.lift([{ field: 'user_id', value: userId }]),
		softDelete: (userId: string) => repository.drop([{ field: 'user_id', value: userId }]),
	};
});
const makeWebauthnCredentialRepo = Effect.gen(function* () {
	const repository = yield* repo(WebauthnCredential, 'webauthn_credentials', { resolve: { byCredentialId: 'credentialId', byUser: 'many:userId' } });
	return { ...repository,
		byCredentialId: (credentialId: string) => repository.by('byCredentialId', credentialId),
		byUser: (userId: string) => repository.by('byUser', userId),
		softDelete: (id: string) => repository.drop(id),
		touch: (id: string) => repository.set(id, { last_used_at: Update.now }),
		updateCounter: (id: string, counter: number) => repository.set(id, { counter, last_used_at: Update.now }),
	};
});
const makeJobRepo = Effect.gen(function* () {
	const repository = yield* repo(Job, 'jobs', {
		fnTyped: { count_jobs_by_status: { args: [], params: S.Struct({}), schema: S.Record({ key: S.String, value: S.Number }) } },
		pk: { column: 'job_id' },
	});
	return { ...repository,
		byDateRange: (after: Date, before: Date, options?: { limit?: number; cursor?: string }) => repository.page(repository.preds({ after, before }), { cursor: options?.cursor, limit: options?.limit ?? 100 }),
		byStatus: (status: string, options?: { after?: Date; before?: Date; limit?: number; cursor?: string }) => repository.page(repository.preds({ after: options?.after, before: options?.before, status }), { cursor: options?.cursor, limit: options?.limit ?? 100 }),
		countByStatus: repository.fnTyped('count_jobs_by_status', {}).pipe(Effect.map(result => result as Record<string, number>)),
		countByStatuses: (...statuses: readonly string[]) => repository.count([{ field: 'status', op: 'in', values: [...statuses] }]),
		isDuplicate: (dedupeKey: string) => repository.exists([{ field: 'dedupe_key', value: dedupeKey }, { field: 'status', op: 'in', values: ['queued', 'processing'] }]),
	};
});
const makeJobDlqRepo = Effect.gen(function* () {
	const repository = yield* repo(JobDlq, 'job_dlq', { purge: 'purge_job_dlq', resolve: { byOriginalJob: 'originalJobId' } });
	return { ...repository,
		byErrorReason: (errorReason: string, options?: { limit?: number; cursor?: string }) => repository.page([{ field: 'error_reason', value: errorReason }], { cursor: options?.cursor, limit: options?.limit ?? 100 }),
		byOriginalJob: (originalJobId: string) => repository.by('byOriginalJob', originalJobId),
		byRequest: (requestId: string) => repository.find([{ field: 'request_id', value: requestId }]),
		countPending: (type?: string) => repository.count(type ? [{ field: 'type', value: type }] : []),
		listPending: (options?: { type?: string; limit?: number; cursor?: string }) => repository.page(options?.type ? [{ field: 'type', value: options.type }] : [], { cursor: options?.cursor, limit: options?.limit ?? 100 }),
		markReplayed: (id: string) => repository.drop(id),
		unmarkReplayed: (id: string) => repository.lift(id),
	};
});
const makeKvStoreRepo = Effect.gen(function* () {
	const repository = yield* repo(KvStore, 'kv_store', {
		conflict: { keys: ['key'], only: ['value', 'expiresAt'] },
		fn: { delete_kv_by_prefix: { args: ['prefix'], params: S.Struct({ prefix: S.String }) } },
		purge: 'purge_kv_store', resolve: { byKey: 'key' },
	});
	return { ...repository,
		byKey: (key: string) => repository.by('byKey', key),
		deleteByPrefix: (prefix: string) => repository.fn('delete_kv_by_prefix', { prefix }),
		getJson: <A, I>(key: string, schema: S.Schema<A, I, never>) => repository.by('byKey', key).pipe(Effect.flatMap(repository.json.decode('value', schema))),
		setJson: <A, I>(key: string, jsonValue: A, schema: S.Schema<A, I, never>, expiresAt?: Date) => repository.json.encode(schema)(jsonValue).pipe(Effect.flatMap((encoded) => repository.upsert({ expiresAt, key, value: encoded }))),
	};
});
const _SYSTEM_SCHEMA = {
	cacheHitRatio: S.Struct({backendType: S.String, cacheHitRatio: S.Number, hits: S.Unknown, ioContext: S.String, ioObject: S.String, reads: S.Unknown, writes: S.Unknown,}),
	ioConfig: S.Struct({ name: S.String, setting: S.String }),
	ioStats: S.Unknown,
	statements: S.Array(S.Unknown),
} as const;
const _SYSTEM_ROUTINE = {
	fn: {count_event_outbox: {}, purge_event_journal: { args: ['days'], params: S.Struct({ days: S.Number }) },},
	fnSet: {get_db_cache_hit_ratio: { schema: _SYSTEM_SCHEMA.cacheHitRatio }, get_db_io_config: { schema: _SYSTEM_SCHEMA.ioConfig }, get_db_io_stats: { schema: _SYSTEM_SCHEMA.ioStats },},
	fnTyped: {list_stat_statements_json: { args: ['limit'], params: S.Struct({ limit: S.Number }), schema: _SYSTEM_SCHEMA.statements },},
} as const;

const makeSystemRepo = Effect.gen(function* () {
	const repository = yield* routine('database/system', _SYSTEM_ROUTINE);
	return {
		dbCacheHitRatio: () => repository.fnSet('get_db_cache_hit_ratio', {}),
		dbIoConfig: () => repository.fnSet('get_db_io_config', {}),
		dbIoStats: () => repository.fnSet('get_db_io_stats', {}),
		eventJournalPurge: (days: number) => repository.fn('purge_event_journal', { days }),
		eventOutboxCount: () => repository.fn('count_event_outbox', {}),
		listStatStatements: (limit = 100) => repository.fnTyped('list_stat_statements_json', { limit }),
	};
});

// --- [SERVICES] --------------------------------------------------------------

class DatabaseService extends Effect.Service<DatabaseService>()('database/DatabaseService', {
	effect: Effect.gen(function* () {
		const sqlClient = yield* SqlClient.SqlClient;
		const [users, apps, sessions, apiKeys, oauthAccounts, assets, audit, mfaSecrets, webauthnCredentials, jobs, jobDlq, kvStore, system] = yield* Effect.all([
			makeUserRepo, makeAppRepo, makeSessionRepo, makeApiKeyRepo,
			makeOauthAccountRepo, makeAssetRepo, makeAuditRepo, makeMfaSecretRepo, makeWebauthnCredentialRepo, makeJobRepo, makeJobDlqRepo, makeKvStoreRepo, makeSystemRepo,
		]);
		const monitoring = {
			cacheHitRatio: Effect.fn('db.cacheHitRatio')(system.dbCacheHitRatio),
			ioConfig: Effect.fn('db.ioConfig')(system.dbIoConfig),
			ioStats: Effect.fn('db.ioStats')(system.dbIoStats),
		} as const;
		return {
			apiKeys, apps, assets, audit, eventJournal: { purge: (olderThanDays: number) => system.eventJournalPurge(olderThanDays) }, eventOutbox: { count: system.eventOutboxCount() },
			jobDlq, jobs, kvStore, listStatStatements: Effect.fn('db.listStatStatements')((limit = 100) => system.listStatStatements(limit)), mfaSecrets,
			monitoring, oauthAccounts, sessions, users, webauthnCredentials, withTransaction: sqlClient.withTransaction,
		};
	}),
}) {}

// --- [NAMESPACE] -------------------------------------------------------------

namespace DatabaseService {
	export type Type = typeof DatabaseService.Service;
}

// --- [EXPORT] ----------------------------------------------------------------

export { DatabaseService };
