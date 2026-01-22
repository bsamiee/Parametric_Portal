/**
 * Expose batched repositories via Model.makeRepository + SqlResolver.
 * UUIDv7 ordering, casefold() comparisons, purge/revoke DB functions.
 */
import { PgClient } from '@effect/sql-pg';
import { Model, SqlClient, SqlResolver, SqlSchema } from '@effect/sql';
import { Page } from './page.ts';
import { type Context, Effect, Layer, Option, Schema as S } from 'effect';
import { Client } from './client.ts';
import { ApiKey, App, Asset, AuditLog, MfaSecret, OauthAccount, RefreshToken, Session, User } from './models.ts';

// --- [USER_REPO] -------------------------------------------------------------

const makeUserRepo = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const repo = yield* Model.makeRepository(User, { idColumn: 'id', spanPrefix: 'User', tableName: 'users' });
	const ByEmail = yield* SqlResolver.findById('User.byEmail', {
		execute: (keys) => sql`SELECT * FROM users WHERE ${sql.or(keys.map((k) => sql`(app_id = ${k.appId} AND email = ${k.email} AND deleted_at IS NULL)`))}`,
		Id: S.Struct({ appId: S.UUID, email: S.String }),
		Result: User,
		ResultId: (r) => ({ appId: r.appId, email: r.email }),
	});
	return {
		...repo,
		byEmail: (appId: string, email: string) => ByEmail.execute({ appId, email }),
		restore: (id: string, appId: string) => sql`UPDATE users SET deleted_at = NULL, updated_at = NOW() WHERE id = ${id} AND app_id = ${appId} AND deleted_at IS NOT NULL`.pipe(Effect.asVoid),
		softDelete: (id: string, appId: string) => sql`UPDATE users SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${id} AND app_id = ${appId} AND deleted_at IS NULL`.pipe(Effect.asVoid),
	};
});

// --- [APP_REPO] --------------------------------------------------------------

const makeAppRepo = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const pg = yield* PgClient.PgClient;
	const repo = yield* Model.makeRepository(App, { idColumn: 'id', spanPrefix: 'App', tableName: 'apps' });
	const ByNamespace = yield* SqlResolver.findById('App.byNamespace', {
		execute: (namespaces) => sql`SELECT * FROM apps WHERE casefold(namespace) IN ${sql.in(namespaces)}`,
		Id: App.fields.namespace,
		Result: App,
		ResultId: (r) => r.namespace.toLowerCase(),
	});
	return {
		...repo,
		byNamespace: (namespace: string) => ByNamespace.execute(namespace.toLowerCase()),
		updateSettings: (id: string, settings: Record<string, unknown>) => SqlSchema.single({ execute: (p) => sql`UPDATE apps SET settings = ${pg.json(p.settings)}, updated_at = NOW() WHERE id = ${p.id} RETURNING *`, Request: S.Struct({ id: S.UUID, settings: S.Record({ key: S.String, value: S.Unknown }) }), Result: App })({ id, settings }),
	};
});

// --- [SESSION_REPO] ----------------------------------------------------------

const makeSessionRepo = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const repo = yield* Model.makeRepository(Session, { idColumn: 'id', spanPrefix: 'Session', tableName: 'sessions' });
	const ByHash = yield* SqlResolver.findById('Session.byHash', {
		execute: (hashes) => sql`SELECT * FROM sessions WHERE hash IN ${sql.in(hashes)} AND expires_at > NOW() AND deleted_at IS NULL`,
		Id: S.String,
		Result: Session,
		ResultId: (r) => r.hash,
	});
	return {
		...repo,
		byHash: ByHash.execute,
		byIp: (ip: string) => SqlSchema.findAll({ execute: (i) => sql`SELECT * FROM sessions WHERE ip_address = ${i}::inet AND deleted_at IS NULL ORDER BY id DESC`, Request: S.String, Result: Session })(ip),
		countByIp: (ip: string, windowMinutes = 60) => SqlSchema.single({ execute: (r) => sql`SELECT count_sessions_by_ip(${r.ip}::inet, ${r.windowMinutes}) AS count`, Request: S.Struct({ ip: S.String, windowMinutes: S.Number }), Result: S.Struct({ count: S.Int }) })({ ip, windowMinutes }).pipe(Effect.map((r) => r.count)),
		purge: (olderThanDays = 30) => SqlSchema.single({ execute: (d) => sql`SELECT purge_sessions(${d}) AS count`, Request: S.Number, Result: S.Struct({ count: S.Int }) })(olderThanDays).pipe(Effect.map((r) => r.count)),
		restore: (id: string) => sql`UPDATE sessions SET deleted_at = NULL, updated_at = NOW() WHERE id = ${id} AND deleted_at IS NOT NULL`.pipe(Effect.asVoid),
		softDelete: (id: string) => sql`UPDATE sessions SET deleted_at = NOW() WHERE id = ${id} AND deleted_at IS NULL`.pipe(Effect.asVoid),
		softDeleteByIp: (ip: string) => SqlSchema.single({ execute: (i) => sql`SELECT revoke_sessions_by_ip(${i}::inet) AS count`, Request: S.String, Result: S.Struct({ count: S.Int }) })(ip).pipe(Effect.map((r) => r.count)),
		softDeleteByUser: (userId: string) => sql`UPDATE sessions SET deleted_at = NOW() WHERE user_id = ${userId} AND deleted_at IS NULL`.pipe(Effect.asVoid),
		touch: (id: string) => sql`UPDATE sessions SET updated_at = NOW() WHERE id = ${id}`.pipe(Effect.asVoid),
		verify: (id: string) => sql`UPDATE sessions SET verified_at = NOW() WHERE id = ${id} AND verified_at IS NULL`.pipe(Effect.asVoid),
	};
});

// --- [API_KEY_REPO] ----------------------------------------------------------

const makeApiKeyRepo = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const repo = yield* Model.makeRepository(ApiKey, { idColumn: 'id', spanPrefix: 'ApiKey', tableName: 'api_keys' });
	const ByHash = yield* SqlResolver.findById('ApiKey.byHash', {
		execute: (hashes) => sql`SELECT * FROM api_keys WHERE hash IN ${sql.in(hashes)} AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`,
		Id: S.String,
		Result: ApiKey,
		ResultId: (r) => r.hash,
	});
	const ByUser = yield* SqlResolver.grouped('ApiKey.byUser', {
		execute: (ids) => sql`SELECT * FROM api_keys WHERE user_id IN ${sql.in(ids)} AND deleted_at IS NULL`,
		Request: S.UUID,
		RequestGroupKey: (id) => id,
		Result: ApiKey,
		ResultGroupKey: (r) => r.userId,
	});
	return {
		...repo,
		byHash: ByHash.execute,
		byUser: ByUser.execute,
		purge: (olderThanDays = 365) => SqlSchema.single({ execute: (d) => sql`SELECT purge_api_keys(${d}) AS count`, Request: S.Number, Result: S.Struct({ count: S.Int }) })(olderThanDays).pipe(Effect.map((r) => r.count)),
		restore: (id: string) => sql`UPDATE api_keys SET deleted_at = NULL, updated_at = NOW() WHERE id = ${id} AND deleted_at IS NOT NULL`.pipe(Effect.asVoid),
		softDelete: (id: string) => sql`UPDATE api_keys SET deleted_at = NOW() WHERE id = ${id} AND deleted_at IS NULL`.pipe(Effect.asVoid),
		touch: (id: string) => sql`UPDATE api_keys SET last_used_at = NOW() WHERE id = ${id}`.pipe(Effect.asVoid),
	};
});

// --- [OAUTH_ACCOUNT_REPO] ----------------------------------------------------

const makeOauthAccountRepo = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const repo = yield* Model.makeRepository(OauthAccount, { idColumn: 'id', spanPrefix: 'OauthAccount', tableName: 'oauth_accounts' });
	const ByExternal = yield* SqlResolver.findById('OauthAccount.byExternal', {
		execute: (keys) => sql`SELECT * FROM oauth_accounts WHERE ${sql.or(keys.map((k) => sql`(provider = ${k.provider} AND external_id = ${k.externalId} AND deleted_at IS NULL)`))}`,
		Id: S.Struct({ externalId: S.String, provider: S.String }),
		Result: OauthAccount,
		ResultId: (r) => ({ externalId: r.externalId, provider: r.provider }),
	});
	const ByUser = yield* SqlResolver.grouped('OauthAccount.byUser', {
		execute: (ids) => sql`SELECT * FROM oauth_accounts WHERE user_id IN ${sql.in(ids)} AND deleted_at IS NULL`,
		Request: S.UUID,
		RequestGroupKey: (id) => id,
		Result: OauthAccount,
		ResultGroupKey: (r) => r.userId,
	});
	return {
		...repo,
		byExternal: (provider: string, externalId: string) => ByExternal.execute({ externalId, provider }),
		byUser: ByUser.execute,
		purge: (olderThanDays = 90) => SqlSchema.single({ execute: (d) => sql`SELECT purge_oauth_accounts(${d}) AS count`, Request: S.Number, Result: S.Struct({ count: S.Int }) })(olderThanDays).pipe(Effect.map((r) => r.count)),
		restore: (id: string) => sql`UPDATE oauth_accounts SET deleted_at = NULL, updated_at = NOW() WHERE id = ${id} AND deleted_at IS NOT NULL`.pipe(Effect.asVoid),
		softDelete: (id: string) => sql`UPDATE oauth_accounts SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${id} AND deleted_at IS NULL`.pipe(Effect.asVoid),
		upsert: (data: S.Schema.Type<typeof OauthAccount.insert>, expectedUpdatedAt?: Date) =>
			SqlSchema.single({
				execute: (d) => expectedUpdatedAt
					? sql`INSERT INTO oauth_accounts ${sql.insert(d)} ON CONFLICT (provider, external_id) DO UPDATE SET access_encrypted = EXCLUDED.access_encrypted, expires_at = EXCLUDED.expires_at, refresh_encrypted = EXCLUDED.refresh_encrypted, updated_at = NOW() WHERE oauth_accounts.updated_at = ${expectedUpdatedAt} RETURNING *`
					: sql`INSERT INTO oauth_accounts ${sql.insert(d)} ON CONFLICT (provider, external_id) DO UPDATE SET access_encrypted = EXCLUDED.access_encrypted, expires_at = EXCLUDED.expires_at, refresh_encrypted = EXCLUDED.refresh_encrypted, updated_at = NOW() RETURNING *`,
				Request: OauthAccount.insert,
				Result: OauthAccount,
			})(data),
	};
});

// --- [REFRESH_TOKEN_REPO] ----------------------------------------------------

const makeRefreshTokenRepo = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const repo = yield* Model.makeRepository(RefreshToken, { idColumn: 'id', spanPrefix: 'RefreshToken', tableName: 'refresh_tokens' });
	const byHashForUpdate = (hash: string) => SqlSchema.findOne({ execute: (h) => sql`SELECT * FROM refresh_tokens WHERE hash = ${h} AND expires_at > NOW() AND deleted_at IS NULL FOR UPDATE SKIP LOCKED`, Request: S.String, Result: RefreshToken })(hash);
	return {
		...repo,
		byHashForUpdate,
		purge: (olderThanDays = 90) => SqlSchema.single({ execute: (d) => sql`SELECT purge_refresh_tokens(${d}) AS count`, Request: S.Number, Result: S.Struct({ count: S.Int }) })(olderThanDays).pipe(Effect.map((r) => r.count)),
		restore: (id: string) => sql`UPDATE refresh_tokens SET deleted_at = NULL WHERE id = ${id} AND deleted_at IS NOT NULL`.pipe(Effect.asVoid),
		softDelete: (id: string) => sql`UPDATE refresh_tokens SET deleted_at = NOW() WHERE id = ${id} AND deleted_at IS NULL`.pipe(Effect.asVoid),
		softDeleteByUser: (userId: string) => sql`UPDATE refresh_tokens SET deleted_at = NOW() WHERE user_id = ${userId} AND deleted_at IS NULL`.pipe(Effect.asVoid),
	};
});

// --- [ASSET_REPO] ------------------------------------------------------------

const makeAssetRepo = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const repo = yield* Model.makeRepository(Asset, { idColumn: 'id', spanPrefix: 'Asset', tableName: 'assets' });
	const countByUserId = SqlSchema.single({
		execute: (id) => sql`SELECT COUNT(*)::int AS total_count FROM assets WHERE user_id = ${id} AND deleted_at IS NULL`,
		Request: S.UUID,
		Result: S.Struct({ totalCount: S.Int }),
	});
	const byUserKeyset = (userId: string, limit: number, cursor?: string) =>
		Effect.gen(function* () {
			const cursorOpt = yield* Page.decode(cursor);
			const cursorFilter = Option.match(cursorOpt, {
				onNone: () => sql``,
				onSome: (c) => sql`AND id < ${c.id}::uuid`,
			});
			const rows = yield* SqlSchema.findAll({
				execute: (r) => sql`
					WITH base AS (
						SELECT * FROM assets
						WHERE user_id = ${r.userId} AND deleted_at IS NULL
					),
					totals AS (SELECT COUNT(*)::int AS total_count FROM base)
					SELECT base.*, totals.total_count FROM base CROSS JOIN totals
					WHERE true ${cursorFilter}
					ORDER BY id DESC
					LIMIT ${r.limit}
				`,
				Request: S.Struct({ limit: S.Number, userId: S.UUID }),
				Result: Page.withCount(Asset.fields),
			})({ limit: limit + 1, userId });
			const { items, total } = Page.strip(rows);
			const finalTotal = items.length === 0
				? yield* countByUserId(userId).pipe(Effect.map((r) => r.totalCount))
				: total;
			return Page.keyset(items as readonly Asset[], finalTotal, limit, (item) => ({ id: item.id }), Option.isSome(cursorOpt));
		});
	const byUser = (userId: string) => SqlSchema.findAll({ execute: (id) => sql`SELECT * FROM assets WHERE user_id = ${id} AND deleted_at IS NULL ORDER BY id DESC`, Request: S.UUID, Result: Asset })(userId);
	const ByFilter = SqlSchema.findAll({
		execute: (r) => {
			const predicates = [
				sql`user_id = ${r.userId}`,
				sql`app_id = ${r.appId}`,
				sql`deleted_at IS NULL`,
				...(r.after ? [sql`uuid_extract_timestamp(id) >= ${r.after}`] : []),
				...(r.before ? [sql`uuid_extract_timestamp(id) <= ${r.before}`] : []),
				...(r.ids.length > 0 ? [sql`id IN ${sql.in(r.ids)}`] : []),
				...(r.kinds.length > 0 ? [sql`kind IN ${sql.in(r.kinds)}`] : []),
			];
			return sql`SELECT * FROM assets WHERE ${sql.and(predicates)} ORDER BY id DESC`;
		},
		Request: S.Struct({after: S.NullOr(S.DateFromSelf), appId: S.UUID, before: S.NullOr(S.DateFromSelf), ids: S.Array(S.UUID), kinds: S.Array(S.String), userId: S.UUID,}),
		Result: Asset,
	});
	const byFilter = (userId: string, appId: string, filter: { after?: Date; before?: Date; ids?: string[]; kinds?: string[] } = {}) =>
		ByFilter({after: filter.after ?? null, appId, before: filter.before ?? null, ids: filter.ids ?? [], kinds: filter.kinds ?? [], userId,});
	const InsertMany = SqlSchema.findAll({
		execute: (items) => sql`INSERT INTO assets ${sql.insert(items)} RETURNING *`,
		Request: S.Array(Asset.insert),
		Result: Asset,
	});
	return {
		...repo,
		byFilter,
		byUser,
		byUserKeyset,
		insertMany: (items: readonly S.Schema.Type<typeof Asset.insert>[]) =>
			items.length === 0
				? Effect.succeed([] as readonly Asset[])
				: InsertMany(items),
		purge: (olderThanDays = 30) => SqlSchema.single({ execute: (d) => sql`SELECT purge_assets(${d}) AS count`, Request: S.Number, Result: S.Struct({ count: S.Int }) })(olderThanDays).pipe(Effect.map((r) => r.count)),
		restore: (id: string, appId: string) => sql`UPDATE assets SET deleted_at = NULL, updated_at = NOW() WHERE id = ${id} AND app_id = ${appId} AND deleted_at IS NOT NULL`.pipe(Effect.asVoid),
		softDelete: (id: string, appId: string) => sql`UPDATE assets SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${id} AND app_id = ${appId} AND deleted_at IS NULL`.pipe(Effect.asVoid),
	};
});

// --- [AUDIT_REPO] ------------------------------------------------------------

const makeAuditRepo = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const repo = yield* Model.makeRepository(AuditLog, { idColumn: 'id', spanPrefix: 'AuditLog', tableName: 'audit_logs' });
	const byActor = (appId: string, actorId: string, limit: number, cursor?: string, filter: { after?: Date; before?: Date; operation?: string } = {}) =>
		Effect.gen(function* () {
			const cursorOpt = yield* Page.decode(cursor);
			const predicates = [
				sql`app_id = ${appId}`,
				sql`actor_id = ${actorId}`,
				...(filter.after ? [sql`uuid_extract_timestamp(id) >= ${filter.after}`] : []),
				...(filter.before ? [sql`uuid_extract_timestamp(id) <= ${filter.before}`] : []),
				...(filter.operation ? [sql`operation = ${filter.operation}`] : []),
			];
			const cursorFilter = Option.match(cursorOpt, { onNone: () => sql``, onSome: (c) => sql`AND id < ${c.id}::uuid` });
			const rows = yield* SqlSchema.findAll({
				execute: () => sql`
					WITH base AS (SELECT * FROM audit_logs WHERE ${sql.and(predicates)}),
					totals AS (SELECT COUNT(*) AS total_count FROM base)
					SELECT base.*, totals.total_count FROM base CROSS JOIN totals
					WHERE true ${cursorFilter}
					ORDER BY id DESC
					LIMIT ${limit + 1}
				`,
				Request: S.Void,
				Result: Page.withCount(AuditLog.fields),
			})(undefined);
			const { items, total } = Page.strip(rows);
			const finalTotal = items.length === 0
				? yield* sql`SELECT COUNT(*)::int AS c FROM audit_logs WHERE ${sql.and(predicates)}`.pipe(Effect.map((r) => (r as ReadonlyArray<{ c: number }>)[0]?.c ?? 0))
				: total;
			return Page.keyset(items as readonly AuditLog[], finalTotal, limit, (i) => ({ id: i.id }), Option.isSome(cursorOpt));
		});
	const byEntity = (appId: string, entityType: string, entityId: string, limit: number, cursor?: string, filter: { after?: Date; before?: Date; operation?: string } = {}) =>
		Effect.gen(function* () {
			const cursorOpt = yield* Page.decode(cursor);
			const predicates = [
				sql`app_id = ${appId}`,
				sql`entity_type = ${entityType}`,
				sql`entity_id = ${entityId}`,
				...(filter.after ? [sql`uuid_extract_timestamp(id) >= ${filter.after}`] : []),
				...(filter.before ? [sql`uuid_extract_timestamp(id) <= ${filter.before}`] : []),
				...(filter.operation ? [sql`operation = ${filter.operation}`] : []),
			];
			const cursorFilter = Option.match(cursorOpt, { onNone: () => sql``, onSome: (c) => sql`AND id < ${c.id}::uuid` });
			const rows = yield* SqlSchema.findAll({
				execute: () => sql`
					WITH base AS (SELECT * FROM audit_logs WHERE ${sql.and(predicates)}),
					totals AS (SELECT COUNT(*) AS total_count FROM base)
					SELECT base.*, totals.total_count FROM base CROSS JOIN totals
					WHERE true ${cursorFilter}
					ORDER BY id DESC
					LIMIT ${limit + 1}
				`,
				Request: S.Void,
				Result: Page.withCount(AuditLog.fields),
			})(undefined);
			const { items, total } = Page.strip(rows);
			const finalTotal = items.length === 0
				? yield* sql`SELECT COUNT(*)::int AS c FROM audit_logs WHERE ${sql.and(predicates)}`.pipe(Effect.map((r) => (r as ReadonlyArray<{ c: number }>)[0]?.c ?? 0))
				: total;
			return Page.keyset(items as readonly AuditLog[], finalTotal, limit, (i) => ({ id: i.id }), Option.isSome(cursorOpt));
		});
	const byIp = (appId: string, ip: string, limit: number, cursor?: string) =>
		Effect.gen(function* () {
			const cursorOpt = yield* Page.decode(cursor);
			const cursorFilter = Option.match(cursorOpt, { onNone: () => sql``, onSome: (c) => sql`AND id < ${c.id}::uuid` });
			const rows = yield* SqlSchema.findAll({
				execute: (r) => sql`
					WITH base AS (SELECT * FROM audit_logs WHERE app_id = ${r.appId} AND ip_address = ${r.ip}::inet),
					totals AS (SELECT COUNT(*) AS total_count FROM base)
					SELECT base.*, totals.total_count FROM base CROSS JOIN totals
					WHERE true ${cursorFilter}
					ORDER BY id DESC
					LIMIT ${r.limit + 1}
				`,
				Request: S.Struct({ appId: S.UUID, ip: S.String, limit: S.Number }),
				Result: Page.withCount(AuditLog.fields),
			})({ appId, ip, limit });
			const { items, total } = Page.strip(rows);
			const finalTotal = items.length === 0
				? yield* sql`SELECT COUNT(*)::int AS c FROM audit_logs WHERE app_id = ${appId} AND ip_address = ${ip}::inet`.pipe(Effect.map((r) => (r as ReadonlyArray<{ c: number }>)[0]?.c ?? 0))
				: total;
			return Page.keyset(items as readonly AuditLog[], finalTotal, limit, (i) => ({ id: i.id }), Option.isSome(cursorOpt));
		});
	const countByIp = (appId: string, ip: string, windowMinutes = 60) => SqlSchema.single({ execute: (r) => sql`SELECT count_audit_by_ip(${r.appId}::uuid, ${r.ip}::inet, ${r.windowMinutes}) AS count`, Request: S.Struct({ appId: S.UUID, ip: S.String, windowMinutes: S.Number }), Result: S.Struct({ count: S.Int }) })({ appId, ip, windowMinutes }).pipe(Effect.map((r) => r.count));
	return { ...repo, byActor, byEntity, byIp, countByIp, log: repo.insert };
});

// --- [MFA_SECRET_REPO] -------------------------------------------------------

const makeMfaSecretRepo = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const repo = yield* Model.makeRepository(MfaSecret, { idColumn: 'id', spanPrefix: 'MfaSecret', tableName: 'mfa_secrets' });
	const ByUser = yield* SqlResolver.findById('MfaSecret.byUser', {
		execute: (ids) => sql`SELECT * FROM mfa_secrets WHERE user_id IN ${sql.in(ids)} AND deleted_at IS NULL`,
		Id: S.UUID,
		Result: MfaSecret,
		ResultId: (r) => r.userId,
	});
	const byUserForUpdate = (userId: string) => SqlSchema.findOne({ execute: (id) => sql`SELECT * FROM mfa_secrets WHERE user_id = ${id} AND deleted_at IS NULL FOR UPDATE`, Request: S.UUID, Result: MfaSecret })(userId);
	return {
		...repo,
		byUser: ByUser.execute,
		byUserForUpdate,
		purge: (olderThanDays = 90) => SqlSchema.single({ execute: (d) => sql`SELECT purge_mfa_secrets(${d}) AS count`, Request: S.Number, Result: S.Struct({ count: S.Int }) })(olderThanDays).pipe(Effect.map((r) => r.count)),
		restore: (userId: string) => sql`UPDATE mfa_secrets SET deleted_at = NULL, updated_at = NOW() WHERE user_id = ${userId} AND deleted_at IS NOT NULL`.pipe(Effect.asVoid),
		softDelete: (userId: string) => sql`UPDATE mfa_secrets SET deleted_at = NOW(), updated_at = NOW() WHERE user_id = ${userId} AND deleted_at IS NULL`.pipe(Effect.asVoid),
		upsert: (data: S.Schema.Type<typeof MfaSecret.insert>) => SqlSchema.single({ execute: (d) => sql`INSERT INTO mfa_secrets ${sql.insert(d)} ON CONFLICT (user_id) DO UPDATE SET backup_hashes = EXCLUDED.backup_hashes, enabled_at = EXCLUDED.enabled_at, encrypted = EXCLUDED.encrypted RETURNING *`, Request: MfaSecret.insert, Result: MfaSecret })(data),
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
