/**
 * Expose batched repositories via factory pattern.
 * UUIDv7 ordering, casefold() comparisons, purge/revoke DB functions.
 *
 * ARCHITECTURE: DatabaseService provides repository access only.
 * SearchRepo is separate and independent at the same layer tier.
 * Consumers needing search should yield SearchRepo directly.
 * This decoupling enables clean layer composition in main.ts.
 */
import { SqlClient } from '@effect/sql';
import { type Context, Effect, Schema as S } from 'effect';
import { Client } from './client.ts';
import { repo, Update } from './factory.ts';
import { ApiKey, App, Asset, AuditLog, Job, MfaSecret, OauthAccount, RefreshToken, Session, User } from './models.ts';

// --- [USER_REPO] -------------------------------------------------------------

const makeUserRepo = Effect.gen(function* () {
	const r = yield* repo(User, 'users', { resolve: { byEmail: ['appId', 'email'] } });
	return {
		...r,
		byAppRole: (appId: string, role: string) => r.find([{ field: 'app_id', value: appId }, { field: 'role', value: role }]),
		byEmail: (appId: string, email: string) => r.by('byEmail', { appId, email }),
		restore: (id: string, appId: string) => r.lift(id, { app_id: appId }),
		softDelete: (id: string, appId: string) => r.drop(id, { app_id: appId }),
	};
});

// --- [APP_REPO] --------------------------------------------------------------

const makeAppRepo = Effect.gen(function* () {
	const r = yield* repo(App, 'apps', { resolve: { byNamespace: 'namespace' } });
	return {
		...r,
		byNamespace: (namespace: string) => r.by('byNamespace', namespace.toLowerCase()),
		updateSettings: (id: string, settings: Record<string, unknown>) => r.set(id, { settings }),
	};
});

// --- [SESSION_REPO] ----------------------------------------------------------

const makeSessionRepo = Effect.gen(function* () {
	const r = yield* repo(Session, 'sessions', {
		fn: {count_sessions_by_ip: { args: [{ cast: 'inet', field: 'ip' }, 'windowMinutes'], params: S.Struct({ ip: S.String, windowMinutes: S.Number }) },
			revoke_sessions_by_ip: { args: [{ cast: 'inet', field: 'ip' }], params: S.Struct({ ip: S.String }) },},
		purge: 'purge_sessions',
		resolve: { byHash: 'hash' },
	});
	return {
		...r,
		byHash: (hash: string) => r.by('byHash', hash),
		byIp: (ip: string) => r.find([{ field: 'ip_address', value: ip }]),
		byUser: (userId: string) => r.find([{ field: 'user_id', value: userId }]),
		countByIp: (ip: string, windowMinutes = 60) => r.fn('count_sessions_by_ip', { ip, windowMinutes }),
		restore: (id: string) => r.lift(id),
		softDelete: (id: string) => r.drop(id),
		softDeleteByIp: (ip: string) => r.fn('revoke_sessions_by_ip', { ip }),
		softDeleteByUser: (userId: string) => r.drop([{ field: 'user_id', value: userId }]),
		touch: (id: string) => r.set(id, { updated_at: Update.now }),
		verify: (id: string) => r.setIf(id, { verified_at: Update.now }, { field: 'verified_at', op: 'null' }),
	};
});

// --- [API_KEY_REPO] ----------------------------------------------------------

const makeApiKeyRepo = Effect.gen(function* () {
	const r = yield* repo(ApiKey, 'api_keys', {
		purge: 'purge_api_keys',
		resolve: { byHash: 'hash', byUser: 'many:userId' },
	});
	return {
		...r,
		byHash: (hash: string) => r.by('byHash', hash),
		byUser: (userId: string) => r.by('byUser', userId),
		restore: (id: string) => r.lift(id),
		softDelete: (id: string) => r.drop(id),
		touch: (id: string) => r.set(id, { last_used_at: Update.now }),
	};
});

// --- [OAUTH_ACCOUNT_REPO] ----------------------------------------------------

const makeOauthAccountRepo = Effect.gen(function* () {
	const r = yield* repo(OauthAccount, 'oauth_accounts', {
		conflict: { keys: ['provider', 'externalId'], only: ['accessEncrypted', 'expiresAt', 'refreshEncrypted'] },
		purge: 'purge_oauth_accounts',
		resolve: { byExternal: ['provider', 'externalId'], byUser: 'many:userId' },
	});
	return {
		...r,
		byExternal: (provider: string, externalId: string) => r.by('byExternal', { externalId, provider }),
		byUser: (userId: string) => r.by('byUser', userId),
		restore: (id: string) => r.lift(id),
		softDelete: (id: string) => r.drop(id),
	};
});

// --- [REFRESH_TOKEN_REPO] ----------------------------------------------------

const makeRefreshTokenRepo = Effect.gen(function* () {
	const r = yield* repo(RefreshToken, 'refresh_tokens', {
		purge: 'purge_refresh_tokens',
		resolve: { byHash: 'hash', byUser: 'many:userId' },
	});
	return {
		...r,
		byHash: (hash: string) => r.by('byHash', hash),
		byHashForUpdate: (hash: string) => r.one([{ field: 'hash', value: hash }], 'skip'),
		bySession: (sessionId: string) => r.find([{ field: 'session_id', value: sessionId }]),
		byUser: (userId: string) => r.by('byUser', userId),
		restore: (id: string) => r.lift(id),
		softDelete: (id: string) => r.drop(id),
		softDeleteByUser: (userId: string) => r.drop([{ field: 'user_id', value: userId }]),
	};
});

// --- [ASSET_REPO] ------------------------------------------------------------

const makeAssetRepo = Effect.gen(function* () {
	const r = yield* repo(Asset, 'assets', { purge: 'purge_assets' });
	return {
		...r,
		byAppType: (appId: string, type: string) => r.find([{ field: 'app_id', value: appId }, { field: 'type', value: type }]),
		byFilter: (userId: string, appId: string, { after, before, ids, types }: { after?: Date; before?: Date; ids?: string[]; types?: string[] } = {}) => r.find(r.preds({ after, app_id: appId, before, id: ids, type: types, user_id: userId })),
		byHash: (hash: string) => r.one([{ field: 'hash', value: hash }]),
		byUser: (userId: string) => r.find([{ field: 'user_id', value: userId }]),
		byUserKeyset: (userId: string, limit: number, cursor?: string) => r.page([{ field: 'user_id', value: userId }], { cursor, limit }),
		findStaleForPurge: (olderThanDays: number) => r.find([	/** Find soft-deleted assets with storageRef older than specified days (for S3 cleanup). */
			{ field: 'deleted_at', op: 'notNull' },
			{ field: 'deleted_at', op: 'lt', value: new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000) },
			{ field: 'storage_ref', op: 'notNull' },
		]),
		insertMany: (items: readonly S.Schema.Type<typeof Asset.insert>[]) => r.put(items as S.Schema.Type<typeof Asset.insert>[]),
		restore: (id: string, appId: string) => r.lift(id, { app_id: appId }),
		softDelete: (id: string, appId: string) => r.drop(id, { app_id: appId }),
	};
});

// --- [AUDIT_REPO] ------------------------------------------------------------

const makeAuditRepo = Effect.gen(function* () {
	const r = yield* repo(AuditLog, 'audit_logs', {
		fn: { count_audit_by_ip: { args: [{ cast: 'uuid', field: 'appId' }, { cast: 'inet', field: 'ip' }, 'windowMinutes'], params: S.Struct({ appId: S.UUID, ip: S.String, windowMinutes: S.Number }) } },
	});
	return {
		...r,
		byIp: (appId: string, ip: string, limit: number, cursor?: string) => r.page([{ field: 'app_id', value: appId }, { field: 'ip_address', value: ip }], { cursor, limit }),
		bySubject: (appId: string, subject: string, subjectId: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: string } = {}) => r.page(r.preds({ after, app_id: appId, before, operation, subject, subject_id: subjectId }), { cursor, limit }),
		byUser: (appId: string, userId: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: string } = {}) => r.page(r.preds({ after, app_id: appId, before, operation, user_id: userId }), { cursor, limit }),
		countByIp: (appId: string, ip: string, windowMinutes = 60) => r.fn('count_audit_by_ip', { appId, ip, windowMinutes }),
		log: r.insert,
	};
});

// --- [MFA_SECRET_REPO] -------------------------------------------------------

const makeMfaSecretRepo = Effect.gen(function* () {
	const r = yield* repo(MfaSecret, 'mfa_secrets', {
		conflict: { keys: ['userId'], only: ['backupHashes', 'enabledAt', 'encrypted'] },
		purge: 'purge_mfa_secrets',
		resolve: { byUser: 'userId' },
	});
	return {
		...r,
		byUser: (userId: string) => r.by('byUser', userId),
		byUserForUpdate: (userId: string) => r.one([{ field: 'user_id', value: userId }], 'update'),
		enable: (userId: string) => r.set([{ field: 'user_id', value: userId }], { enabled_at: Update.now }),
		restore: (userId: string) => r.lift([{ field: 'user_id', value: userId }]),
		softDelete: (userId: string) => r.drop([{ field: 'user_id', value: userId }]),
	};
});

// --- [JOB_REPO] --------------------------------------------------------------

const makeJobRepo = Effect.gen(function* () {
	const r = yield* repo(Job, 'jobs', {
		fnSet: { claim_jobs: { args: ['workerId', 'limit', 'lockMinutes'], params: S.Struct({ limit: S.Number, lockMinutes: S.Number, workerId: S.String }) } },
		purge: 'purge_jobs',
	});
	return {
		...r,
		byApp: (appId: string, limit: number, cursor?: string) => r.page([{ field: 'app_id', value: appId }], { cursor, limit }),
		byStatus: (status: string, limit: number, cursor?: string) => r.page([{ field: 'status', value: status }], { cursor, limit }),
		byUser: (userId: string, limit: number, cursor?: string) => r.page([{ field: 'user_id', value: userId }], { cursor, limit }),
		/** Claim batch of pending jobs for worker. Uses claim_jobs() with SELECT FOR UPDATE SKIP LOCKED. Trigger auto-sets started_at. */
		claimBatch: (workerId: string, limit: number, lockMinutes = 5) => r.fnSet('claim_jobs', { limit, lockMinutes, workerId }),
		/** Mark job completed. Trigger auto-sets completed_at. */
		complete: (id: string) => r.set(id, { locked_by: null, locked_until: null, status: 'completed' }),
		/** Move job to dead letter queue. Trigger auto-sets completed_at. */
		deadLetter: (id: string, error: string) => r.set(id, { last_error: error, locked_by: null, locked_until: null, status: 'dead' }),
		retry: (id: string, opts: { attempts: number; lastError: string; scheduledAt: Date }) => r.set(id, { attempts: opts.attempts, last_error: opts.lastError, locked_by: null, locked_until: null, scheduled_at: opts.scheduledAt, status: 'pending' }),
		unlock: (id: string) => r.set(id, { locked_by: null, locked_until: null, status: 'pending' }),
	};
});

// --- [SERVICES] --------------------------------------------------------------

class DatabaseService extends Effect.Service<DatabaseService>()('database/DatabaseService', {
	effect: Effect.gen(function* () {
		const sqlClient = yield* SqlClient.SqlClient;
		const [users, apps, sessions, apiKeys, oauthAccounts, refreshTokens, assets, audit, mfaSecrets, jobs] = yield* Effect.all([
			makeUserRepo, makeAppRepo, makeSessionRepo, makeApiKeyRepo,
			makeOauthAccountRepo, makeRefreshTokenRepo, makeAssetRepo, makeAuditRepo, makeMfaSecretRepo, makeJobRepo,
		]);
		return { apiKeys, apps, assets, audit, jobs, listStatStatements: Client.statements, mfaSecrets, oauthAccounts, refreshTokens, sessions, users, withTransaction: sqlClient.withTransaction };
	}),
}) {}

type DatabaseServiceShape = Context.Tag.Service<typeof DatabaseService>;

// --- [EXPORT] ----------------------------------------------------------------

export { DatabaseService };
export type { DatabaseServiceShape };
