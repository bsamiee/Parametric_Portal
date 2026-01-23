/**
 * Expose batched repositories via factory pattern.
 * UUIDv7 ordering, casefold() comparisons, purge/revoke DB functions.
 */
import { SqlClient } from '@effect/sql';
import { type Context, Effect, Layer, Schema as S } from 'effect';
import { Client } from './client.ts';
import { repo, Update } from './factory.ts';
import { ApiKey, App, Asset, AuditLog, MfaSecret, OauthAccount, RefreshToken, Session, User } from './models.ts';

// --- [USER_REPO] -------------------------------------------------------------

const makeUserRepo = Effect.gen(function* () {
	const r = yield* repo(User, 'users', { resolve: { byEmail: ['appId', 'email'] } });
	return {
		...r,
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
	const r = yield* repo(RefreshToken, 'refresh_tokens', { purge: 'purge_refresh_tokens' });
	return {
		...r,
		byHashForUpdate: (hash: string) => r.one([{ field: 'hash', value: hash }], 'skip'),
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
		byFilter: (userId: string, appId: string, { after, before, ids, kinds }: { after?: Date; before?: Date; ids?: string[]; kinds?: string[] } = {}) =>
			r.find(r.preds({ after, app_id: appId, before, id: ids, kind: kinds, user_id: userId })),
		byUser: (userId: string) => r.find([{ field: 'user_id', value: userId }]),
		byUserKeyset: (userId: string, limit: number, cursor?: string) => r.page([{ field: 'user_id', value: userId }], { cursor, limit }),
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
		byIp: (appId: string, ip: string, limit: number, cursor?: string) =>
			r.page([{ field: 'app_id', value: appId }, { field: 'ip_address', value: ip }], { cursor, limit }),
		bySubject: (appId: string, subject: string, subjectId: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: string } = {}) =>
			r.page(r.preds({ after, app_id: appId, before, operation, subject, subject_id: subjectId }), { cursor, limit }),
		byUser: (appId: string, userId: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: string } = {}) =>
			r.page(r.preds({ after, app_id: appId, before, operation, user_id: userId }), { cursor, limit }),
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
		restore: (userId: string) => r.lift([{ field: 'user_id', value: userId }]),
		softDelete: (userId: string) => r.drop([{ field: 'user_id', value: userId }]),
	};
});

// --- [SERVICES] --------------------------------------------------------------

class DatabaseService extends Effect.Service<DatabaseService>()('database/DatabaseService', {
	effect: Effect.gen(function* () {
		const sqlClient = yield* SqlClient.SqlClient;
		const [users, apps, sessions, apiKeys, oauthAccounts, refreshTokens, assets, audit, mfaSecrets] = yield* Effect.all([
			makeUserRepo, makeAppRepo, makeSessionRepo, makeApiKeyRepo,
			makeOauthAccountRepo, makeRefreshTokenRepo, makeAssetRepo, makeAuditRepo, makeMfaSecretRepo,
		]);
		return { apiKeys, apps, assets, audit, listStatStatements: Client.statements, mfaSecrets, oauthAccounts, refreshTokens, sessions, users, withTransaction: sqlClient.withTransaction };
	}),
}) {static readonly layer = this.Default.pipe(Layer.provide(Client.layer));}

type DatabaseServiceShape = Context.Tag.Service<typeof DatabaseService>;

// --- [EXPORT] ----------------------------------------------------------------

export { DatabaseService };
export type { DatabaseServiceShape };
