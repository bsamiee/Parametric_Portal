/**
 * Expose batched repositories via factory pattern.
 * UUIDv7 ordering, casefold comparisons, purge/revoke DB functions.
 */
import { SqlClient, SqlSchema } from '@effect/sql';
import { Clock, Effect, Option, Record as R, Schema as S } from 'effect';
import { repo, routine, Update } from './factory.ts';
import { ApiKey, App, AppSettingsDefaults, Asset, AuditLog, type AuditOperationSchema, Job, JobDlq, KvStore, MfaSecret, Notification, OauthAccount, Permission, Session, User, WebauthnCredential, AppSettingsSchema } from './models.ts';
import { SearchRepo } from './search.ts';

// --- [REPOSITORIES] ----------------------------------------------------------

const makeUserRepo = Effect.gen(function* () {
	const repository = yield* repo(User, 'users', { resolve: { byEmail: 'email' }, scoped: 'appId' });
	return { ...repository,
		byEmail: (email: string) => repository.by('byEmail', email),
		byRole: (role: string) => repository.find([{ field: 'role', value: role }]),
		restore: (id: string, appId: string) => repository.lift(id, { app_id: appId }),
		setNotificationPreferences: (id: string, preferences: S.Schema.Type<typeof User.fields.notificationPreferences>) => repository.set(id, { notification_preferences: preferences }),
		softDelete: (id: string, appId: string) => repository.drop(id, { app_id: appId }),
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
	const _decodeSettings = (raw: unknown) => S.decodeUnknown(AppSettingsSchema)(raw, { errors: 'all', onExcessProperty: 'ignore' });
	return { ...repository,
		archive: (id: string) => repository.set(id, { status: 'archived' }),
		byNamespace: (namespace: string) => repository.by('byNamespace', namespace),
		readSettings: (id: string, lock: false | 'update' = false) => repository.one([{ field: 'id', value: id }], lock).pipe(
			Effect.flatMap(Option.match({
				onNone: () => Effect.succeed(Option.none()),
				onSome: (app) => _decodeSettings(Option.getOrElse(app.settings, () => AppSettingsDefaults)).pipe(Effect.map((settings) => Option.some({ app, settings })),),
			})),
		),
		resume: (id: string) => repository.set(id, { status: 'active' }),
		suspend: (id: string) => repository.set(id, { status: 'suspended' }),
		updateSettings: (id: string, settings: S.Schema.Type<typeof AppSettingsSchema>) => repository.set(id, { settings }),
	};
});
const makeSessionRepo = Effect.gen(function* () {
	const repository = yield* repo(Session, 'sessions', {
		fn: { revoke_sessions_by_ip: { args: [{ cast: 'uuid', field: 'appId' }, { cast: 'inet', field: 'ip' }], params: S.Struct({ appId: S.UUID, ip: S.String }) } },
		purge: 'purge_sessions', resolve: { byHash: 'hash', byRefreshHash: 'refreshHash' },
		scoped: 'appId',
	});
	return { ...repository,
		byHash: (hash: string) => repository.by('byHash', hash),
		byRefreshHash: (hash: string) => repository.by('byRefreshHash', hash),
		byRefreshHashForUpdate: (hash: string) => repository.one([{ field: 'refresh_hash', value: hash }], 'update'),
		byUser: (userId: string) => repository.find([{ field: 'user_id', value: userId }]),
		softDelete: (id: string) => repository.drop(id),
		softDeleteByIp: (appId: string, ip: string) => repository.fn('revoke_sessions_by_ip', { appId, ip }),
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
	const sqlClient = yield* SqlClient.SqlClient;
	const repository = yield* repo(OauthAccount, 'oauth_accounts', {
		conflict: { keys: ['provider', 'externalId'], only: ['accessEncrypted', 'expiresAt', 'refreshEncrypted'] },
		purge: 'purge_oauth_accounts', resolve: { byExternal: ['provider', 'externalId'], byUser: 'many:userId' },
	});
	const byExternalAny = SqlSchema.findOne({
		execute: (input: { externalId: string; provider: S.Schema.Type<typeof OauthAccount.fields.provider> }) => sqlClient`SELECT * FROM oauth_accounts WHERE provider = ${input.provider} AND external_id = ${input.externalId} AND deleted_at IS NULL LIMIT 1`,
		Request: S.Struct({ externalId: S.String, provider: OauthAccount.fields.provider }),
		Result: OauthAccount,
	});
	return { ...repository,
		byExternal: (provider: S.Schema.Type<typeof OauthAccount.fields.provider>, externalId: string) => repository.by('byExternal', { externalId, provider }),
		byExternalAny: (provider: S.Schema.Type<typeof OauthAccount.fields.provider>, externalId: string) => byExternalAny({ externalId, provider }),
		byUser: (userId: string) => repository.by('byUser', userId),
		restore: (id: string) => repository.lift(id),
		softDelete: (id: string) => repository.drop(id),
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
		restore: (id: string, appId: string) => repository.lift(id, { app_id: appId }),
		softDelete: (id: string, appId: string) => repository.drop(id, { app_id: appId }),
	};
});
const makeAuditRepo = Effect.gen(function* () {
	const repository = yield* repo(AuditLog, 'audit_logs', {
		fn: { count_audit_by_ip: { args: [{ cast: 'uuid', field: 'appId' }, { cast: 'inet', field: 'ip' }, 'windowMinutes'], params: S.Struct({ appId: S.UUID, ip: S.String, windowMinutes: S.Number }) } },
		scoped: 'appId',
	});
	return { ...repository,
		byIp: (ip: string, limit: number, cursor?: string) => repository.page([{ field: 'ip_address', value: ip }], { cursor, limit }),
		bySubject: (subject: string, subjectId: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: S.Schema.Type<typeof AuditOperationSchema> } = {}) => repository.page(repository.preds({ after, before, operation, subject, subject_id: subjectId }), { cursor, limit }),
		byUser: (userId: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: S.Schema.Type<typeof AuditOperationSchema> } = {}) => repository.page(repository.preds({ after, before, operation, user_id: userId }), { cursor, limit }),
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
	const repository = yield* repo(Job, 'jobs', { pk: { column: 'job_id' }, scoped: 'appId' });
	const _updatedBetween = (after?: Date, before?: Date) => [
		...(after === undefined ? [] : [{ field: 'updated_at', op: 'gte' as const, value: after }]),
		...(before === undefined ? [] : [{ field: 'updated_at', op: 'lte' as const, value: before }]),
	];
	return { ...repository,
		byDateRange: (after: Date, before: Date, options?: { limit?: number; cursor?: string }) => repository.page(_updatedBetween(after, before), { cursor: options?.cursor, limit: options?.limit ?? 100 }),
		byStatus: (status: string, options?: { after?: Date; before?: Date; limit?: number; cursor?: string }) => repository.page([{ field: 'status', value: status }, ..._updatedBetween(options?.after, options?.before)], { cursor: options?.cursor, limit: options?.limit ?? 100 }),
		countByStatuses: (...statuses: readonly string[]) => repository.count([{ field: 'status', op: 'in', values: [...statuses] }]),
		isDuplicate: (dedupeKey: string) => repository.exists([{ field: 'dedupe_key', value: dedupeKey }, { field: 'status', op: 'in', values: ['queued', 'processing'] }]),
	};
});
const makeJobDlqRepo = Effect.gen(function* () {
	const repository = yield* repo(JobDlq, 'job_dlq', { purge: 'purge_job_dlq', resolve: { byOriginalJob: 'originalJobId' }, scoped: 'appId' });
	const _typePred = (type?: string) => type === undefined
		? []
		: [{ field: 'type', op: type.includes('*') ? 'like' : 'eq', value: type.replaceAll('*', '%') } as const];
	return { ...repository,
		byErrorReason: (errorReason: string, options?: { limit?: number; cursor?: string }) => repository.page([{ field: 'error_reason', value: errorReason }], { cursor: options?.cursor, limit: options?.limit ?? 100 }),
		byOriginalJob: (originalJobId: string) => repository.by('byOriginalJob', originalJobId),
		byRequest: (requestId: string) => repository.find([{ field: 'request_id', value: requestId }]),
		countPending: (type?: string) => repository.count(_typePred(type)),
		listPending: (options?: { type?: string; limit?: number; cursor?: string }) => repository.page(_typePred(options?.type), { cursor: options?.cursor, limit: options?.limit ?? 100 }),
		markReplayed: (id: string) => repository.drop(id),
		unmarkReplayed: (id: string) => repository.lift(id),
	};
});
const makeNotificationRepo = Effect.gen(function* () {
	const repository = yield* repo(Notification, 'notifications', { scoped: 'appId' });
	return { ...repository,
		transition: (id: string, updates: { status: S.Schema.Type<typeof Notification.fields.status>; error?: string | null; provider?: string | null; deliveredAt?: Date | null; jobId?: string | null }, whenStatus?: S.Schema.Type<typeof Notification.fields.status>) =>
			repository.set(
				id,
				R.filter(
					{ delivered_at: updates.deliveredAt, error: updates.error, job_id: updates.jobId, provider: updates.provider, status: updates.status } as Record<string, unknown>,
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
		fn: { delete_kv_by_prefix: { args: ['prefix'], params: S.Struct({ prefix: S.String }) } },
		purge: 'purge_kv_store', resolve: { byKey: 'key' },
	});
	return { ...repository,
		byKey: (key: string) => repository.by('byKey', key),
		deleteByPrefix: (prefix: string) => repository.fn('delete_kv_by_prefix', { prefix }),
			getJson: <A, I, R>(key: string, schema: S.Schema<A, I, R>) => repository.by('byKey', key).pipe(Effect.flatMap(repository.json.decode('value', schema))),
			setJson: <A, I, R>(key: string, jsonValue: A, schema: S.Schema<A, I, R>, expiresAt?: Date) => repository.json.encode(schema)(jsonValue).pipe(Effect.flatMap((encoded) => repository.upsert({ expiresAt, key, value: encoded }))),
	};
});
const makeSystemRepo = Effect.gen(function* () {
	const repository = yield* routine('database/system', {
		fn: { count_event_outbox: {}, purge_event_journal: { args: ['days'], params: S.Struct({ days: S.Number }) } },
		fnSet: {
			get_db_cache_hit_ratio: { schema: S.Struct({ backendType: S.String, cacheHitRatio: S.Number, hits: S.Number, ioContext: S.String, ioObject: S.String, reads: S.Number, writes: S.Number }) },
			get_db_io_config: { schema: S.Struct({ name: S.String, setting: S.String }) },
			get_db_io_stats: { schema: S.Unknown },
			get_event_journal_entry_by_primary_key: {
				args: ['primaryKey'],
				params: S.Struct({ primaryKey: S.String }),
				schema: S.Struct({ payload: S.String }),
			},
			list_event_journal_entries: {
				args: ['sinceSequenceId', 'sinceTimestamp', 'eventType', 'batchSize'],
					params: S.Struct({ batchSize: S.Number, eventType: S.NullOr(S.String), sinceSequenceId: S.String, sinceTimestamp: S.NullOr(S.Number) }),
					schema: S.Struct({ payload: S.String, primaryKey: S.String }),
				},
		},
		fnTyped: { list_stat_statements_json: { args: ['limit'], params: S.Struct({ limit: S.Number }), schema: S.Array(S.Unknown) } },
	});
	return {
		dbCacheHitRatio: () => repository.fnSet('get_db_cache_hit_ratio', {}),
		dbIoConfig: () => repository.fnSet('get_db_io_config', {}),
		dbIoStats: () => repository.fnSet('get_db_io_stats', {}),
		eventJournalByPrimaryKey: (primaryKey: string) => repository.fnSet('get_event_journal_entry_by_primary_key', { primaryKey }).pipe(Effect.map((rows) => Option.fromNullable(rows[0]))),
		eventJournalPurge: (days: number) => repository.fn('purge_event_journal', { days }),
		eventJournalReplay: (input: { batchSize: number; eventType?: string; sinceSequenceId: string; sinceTimestamp?: number }) => repository.fnSet('list_event_journal_entries', {
			batchSize: input.batchSize,
			eventType: Option.getOrNull(Option.fromNullable(input.eventType)),
			sinceSequenceId: input.sinceSequenceId,
			sinceTimestamp: Option.getOrNull(Option.fromNullable(input.sinceTimestamp)),
		}),
		eventOutboxCount: () => repository.fn('count_event_outbox', {}),
		listStatStatements: (limit = 100) => repository.fnTyped('list_stat_statements_json', { limit }),
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
			cacheHitRatio: Effect.fn('db.cacheHitRatio')(system.dbCacheHitRatio),
			ioConfig: Effect.fn('db.ioConfig')(system.dbIoConfig),
			ioStats: Effect.fn('db.ioStats')(system.dbIoStats),
		} as const;
			return {
				apiKeys, apps, assets, audit, eventJournal: {
					byPrimaryKey: (primaryKey: string) => system.eventJournalByPrimaryKey(primaryKey),
					purge: (olderThanDays: number) => system.eventJournalPurge(olderThanDays),
					replay: (input: { batchSize: number; eventType?: string; sinceSequenceId: string; sinceTimestamp?: number }) => system.eventJournalReplay(input),
				}, eventOutbox: { count: system.eventOutboxCount() },
				jobDlq, jobs, kvStore, listStatStatements: Effect.fn('db.listStatStatements')((limit = 100) => system.listStatStatements(limit)), mfaSecrets,
				monitoring, notifications, oauthAccounts, permissions, search: searchRepo, sessions, users, webauthnCredentials, withTransaction: sqlClient.withTransaction,
			};
		}),
}) {}

// --- [NAMESPACE] -------------------------------------------------------------

namespace DatabaseService {
	export type Type = typeof DatabaseService.Service;
}

// --- [EXPORT] ----------------------------------------------------------------

export { DatabaseService };
