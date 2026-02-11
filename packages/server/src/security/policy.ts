/**
 * Policy engine: role-based permission evaluation, cache, grant/revoke lifecycle.
 * Catalog + rule tables drive privilege escalation, MFA/interactive requirements, and seed data.
 */
import type { SqlClient } from '@effect/sql';
import { Permission, RoleSchema } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Effect, Option, PrimaryKey, Schema as S, Stream } from 'effect';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { EventBus } from '../infra/events.ts';
import { AuditService } from '../observe/audit.ts';
import { MetricsService } from '../observe/metrics.ts';
import { CacheService } from '../platform/cache.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	catalog: {
		admin: 			['listUsers', 'listSessions', 'deleteSession', 'revokeSessionsByIp', 'listJobs', 'cancelJob', 'listDlq', 'replayDlq', 'listNotifications', 'replayNotification', 'events', 'dbIoStats', 'dbIoConfig', 'dbStatements', 'dbCacheHitRatio', 'listTenants', 'createTenant', 'getTenant', 'updateTenant', 'deactivateTenant', 'resumeTenant', 'archiveTenant', 'purgeTenant', 'getTenantOAuth', 'updateTenantOAuth', 'listPermissions', 'grantPermission', 'revokePermission', 'getFeatureFlags', 'setFeatureFlag'],
		audit: 			['getByEntity', 'getByUser', 'getMine'],
		auth: 			['logout', 'me', 'mfaStatus', 'mfaEnroll', 'mfaVerify', 'mfaDisable', 'mfaRecover', 'listApiKeys', 'createApiKey', 'deleteApiKey', 'rotateApiKey', 'linkProvider', 'unlinkProvider'],
		jobs: 			['subscribe'],
		search: 		['search', 'suggest', 'refresh', 'refreshEmbeddings'],
		storage: 		['sign', 'exists', 'remove', 'upload', 'getAsset', 'createAsset', 'updateAsset', 'archiveAsset', 'listAssets'],
		transfer: 		['export', 'import'],
		users: 			['getMe', 'updateProfile', 'deactivate', 'updateRole', 'getNotificationPreferences', 'updateNotificationPreferences', 'listNotifications', 'subscribeNotifications'],
		webhooks: 		['list', 'register', 'remove', 'test', 'retry', 'status'],
		websocket: 		['connect'],
	},
	rules: {
		interactive: 	{ admin: ['replayNotification'], auth: ['*'], users: ['updateNotificationPreferences'] } as Record<string, readonly string[]>,
		mfa: 			{ admin: ['*'], audit: ['*'], auth: ['me', 'mfaDisable', 'listApiKeys', 'createApiKey', 'deleteApiKey', 'rotateApiKey', 'linkProvider', 'unlinkProvider'], jobs: ['subscribe'], storage: ['sign', 'remove', 'upload', 'createAsset', 'updateAsset', 'archiveAsset'], transfer: ['*'], users: ['updateRole', 'updateNotificationPreferences'], webhooks: ['*'], websocket: ['connect'] } as Record<string, readonly string[]>,
		privileged: 	{ admin: ['*'], audit: ['getByEntity', 'getByUser'], search: ['refresh', 'refreshEmbeddings'], users: ['updateRole'], webhooks: ['*'] } as Record<string, readonly string[]>,
		roles: 			{ all: ['owner', 'admin', 'member', 'viewer', 'guest'] as const, privileged: ['owner', 'admin'] as const },
	},
} as const;

// --- [SERVICES] --------------------------------------------------------------

class PolicyService extends Effect.Service<PolicyService>()('server/Policy', {
	dependencies: [DatabaseService.Default, AuditService.Default, CacheService.Default, EventBus.Default, MetricsService.Default],
	scoped: Effect.gen(function* () {
		const [database, audit, eventBus, metrics] = yield* Effect.all([DatabaseService, AuditService, EventBus, MetricsService]);
		class CacheKey extends S.TaggedRequest<CacheKey>()('PermissionCacheKey', {
			failure: HttpError.Internal, payload: { role: RoleSchema, tenantId: S.String }, success: S.Array(Permission),
		}) { [PrimaryKey.symbol]() { return `policy:${this.tenantId}:${this.role}`; } }
		const cache = yield* CacheService.cache<CacheKey, never, SqlClient.SqlClient>({
			lookup: (key) => Context.Request.withinSync(key.tenantId, database.permissions.byRole(key.role)).pipe(
				Effect.map((permissions) => permissions.filter((p) => Option.isNone(p.deletedAt))),
				Effect.mapError((error) => HttpError.Internal.of('Permission lookup failed', error)),
			),
			storeId: 'policy',
		});
		yield* Effect.forkScoped(eventBus.subscribe('policy.changed', S.Struct({ _tag: S.Literal('policy'), action: S.Literal('changed'), role: RoleSchema }),
			(event, payload) => cache.invalidate(new CacheKey({ role: payload.role, tenantId: event.tenantId })).pipe(Effect.ignore),
		).pipe(Stream.runDrain, Effect.ignore));
		const require = Effect.fn('PolicyService.require')(function* (resource: string, action: string) {
			const ctx = yield* Context.Request.current;
			const session = yield* Option.match(ctx.session, { onNone: () => Effect.fail(HttpError.Auth.of('Missing session')), onSome: Effect.succeed });
			const rules = _CONFIG.rules;
			const matches = (table: Record<string, readonly string[]>) => table[resource]?.includes('*') === true || table[resource]?.includes(action) === true;
			yield* Effect.filterOrFail(Effect.succeed(session), () => !(matches(rules.interactive) && session.kind !== 'session'), () => HttpError.Forbidden.of('Interactive session required'));
			yield* Effect.when(Effect.fail(HttpError.Forbidden.of('MFA enrollment required')), () => matches(rules.mfa) && !session.mfaEnabled);
			yield* Effect.when(Effect.fail(HttpError.Forbidden.of('MFA verification required')), () => matches(rules.mfa) && session.mfaEnabled && Option.isNone(session.verifiedAt));
			const user = yield* Context.Request.withinSync(ctx.tenantId, database.users.one([{ field: 'id', value: session.userId }])).pipe(
				Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.Forbidden.of('User not found')), onSome: Effect.succeed })),
			);
			yield* Effect.filterOrFail(
				Effect.succeed(user),
				(candidate) => Option.isNone(candidate.deletedAt) && candidate.status === 'active',
				() => HttpError.Forbidden.of('User is not active'),
			);
			const permissions = yield* cache.get(new CacheKey({ role: user.role, tenantId: ctx.tenantId }));
			yield* Effect.filterOrFail(Effect.succeed(permissions), (ps) => ps.some((p) => p.resource === resource && p.action === action), () => HttpError.Forbidden.of('Insufficient permissions')).pipe(
				Effect.tapError(() => Effect.all([
					audit.log('security.permission_denied', { details: { action, resource, role: user.role }, subjectId: session.userId }),
					MetricsService.trackError(metrics.errors, MetricsService.label({ action, resource, role: user.role, tenant: ctx.tenantId }), HttpError.Forbidden.of('Insufficient permissions')),
				], { discard: true })),
			);
		});
		const list = Effect.fn('PolicyService.list')((role?: typeof RoleSchema.Type) => Context.Request.currentTenantId.pipe(
			Effect.flatMap((tenantId) => Context.Request.withinSync(tenantId, role === undefined ? database.permissions.find([]) : database.permissions.byRole(role))),
			Effect.map((ps) => ps.filter((p) => Option.isNone(p.deletedAt))),
			Effect.mapError((error) => HttpError.Internal.of('Permission list failed', error)),
		));
		const grant = Effect.fn('PolicyService.grant')((input: { role: typeof RoleSchema.Type; resource: string; action: string }) => Effect.gen(function* () {
			const tenantId = yield* Context.Request.currentTenantId;
			const granted = yield* Context.Request.withinSync(tenantId, database.permissions.grant({ action: input.action, appId: tenantId, resource: input.resource, role: input.role }));
			yield* cache.invalidate(new CacheKey({ role: input.role, tenantId })).pipe(Effect.ignore);
			yield* eventBus.publish({ aggregateId: tenantId, payload: { _tag: 'policy', action: 'changed', role: input.role }, tenantId }).pipe(Effect.ignore);
			return granted;
		}).pipe(Effect.mapError((error) => error instanceof HttpError.Internal ? error : HttpError.Internal.of('Permission grant failed', error))));
		const revoke = Effect.fn('PolicyService.revoke')((input: { role: typeof RoleSchema.Type; resource: string; action: string }) => Effect.gen(function* () {
			const tenantId = yield* Context.Request.currentTenantId;
			yield* Context.Request.withinSync(tenantId, database.permissions.revoke(input.role, input.resource, input.action));
			yield* cache.invalidate(new CacheKey({ role: input.role, tenantId })).pipe(Effect.ignore);
			yield* eventBus.publish({ aggregateId: tenantId, payload: { _tag: 'policy', action: 'changed', role: input.role }, tenantId }).pipe(Effect.ignore);
		}).pipe(Effect.mapError((error) => HttpError.Internal.of('Permission revoke failed', error))));
		const seedEntries = Object.entries(_CONFIG.catalog).flatMap(([resource, actions]) => {
			const priv = _CONFIG.rules.privileged[resource];
			const isPrivileged = (a: string) => priv?.includes('*') || priv?.includes(a);
			return actions.flatMap((action) => (isPrivileged(action) ? _CONFIG.rules.roles.privileged : _CONFIG.rules.roles.all).map((role) => ({ action, resource, role })));
		});
		const seedTenantDefaults = Effect.fn('PolicyService.seedTenantDefaults')((tenantId: string) => Context.Request.withinSync(tenantId,
			Effect.forEach(seedEntries, (e) => database.permissions.grant({ action: e.action, appId: tenantId, resource: e.resource, role: e.role }), { discard: true }),
		).pipe(
			Effect.andThen(Effect.forEach(_CONFIG.rules.roles.all, (role) => cache.invalidate(new CacheKey({ role, tenantId })), { discard: true })),
			Effect.mapError((error) => HttpError.Internal.of('Permission seed failed', error)),
		));
		return { grant, list, require, revoke, seedTenantDefaults };
	}),
}) {static readonly Catalog = _CONFIG.catalog;}

// --- [EXPORT] ----------------------------------------------------------------

export { PolicyService };
