/**
 * Admin management endpoints.
 * Admin-gated CRUD for users, sessions, jobs, DLQ, events, tenants.
 */
import { HttpApiBuilder } from '@effect/platform';
import { AppSettingsDefaults, AppSettingsSchema, OAuthProviderConfigSchema, OAuthProviderStoredSchema } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { NotificationService } from '@parametric-portal/server/domain/notifications';
import { HttpError } from '@parametric-portal/server/errors';
import { EventBus } from '@parametric-portal/server/infra/events';
import { JobService } from '@parametric-portal/server/infra/jobs';
import { WebhookService } from '@parametric-portal/server/infra/webhooks';
import { Middleware } from '@parametric-portal/server/middleware';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { StreamingService } from '@parametric-portal/server/platform/streaming';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { PolicyService } from '@parametric-portal/server/security/policy';
import { FeatureService } from '@parametric-portal/server/domain/features';
import { Cause, Effect, Encoding, Option, Schema as S } from 'effect';

// --- [FUNCTIONS] -------------------------------------------------------------

const _requireOne = <A>(
	effect: Effect.Effect<Option.Option<A>, unknown>,
	entity: string,
	id?: string,
): Effect.Effect<A, HttpError.NotFound | HttpError.Internal> =>
	effect.pipe(
		Effect.mapError((error) => HttpError.Internal.of(`${entity} lookup failed`, error)),
		Effect.flatMap(Option.match({
			onNone: () => Effect.fail(HttpError.NotFound.of(entity, id)),
			onSome: Effect.succeed,
		})),
	);

// --- [LAYERS] ----------------------------------------------------------------

const AdminLive = HttpApiBuilder.group(ParametricApi, 'admin', (handlers) =>
	Effect.gen(function* () {
		const [database, jobs, eventBus, audit, webhooks, policy, notifications, features] = yield* Effect.all([DatabaseService, JobService, EventBus, AuditService, WebhookService, PolicyService, NotificationService, FeatureService]);
		return handlers
			.handle('listUsers', ({ urlParams }) => Middleware.guarded('admin', 'listUsers', 'api', database.users.page([], { cursor: urlParams.cursor, limit: urlParams.limit }).pipe(
				Effect.mapError((error) => HttpError.Internal.of('User list failed', error)),
				Telemetry.span('admin.listUsers', { kind: 'server', metrics: false }),
			)))
			.handle('listSessions', ({ urlParams }) => Middleware.guarded('admin', 'listSessions', 'api', database.sessions.page(
					urlParams.userId
						? [{ field: 'user_id', value: urlParams.userId }]
						: urlParams.ipAddress
							? [{ field: 'ip_address', value: urlParams.ipAddress }]
							: [],
					{ cursor: urlParams.cursor, limit: urlParams.limit },
				).pipe(Effect.mapError((error) => HttpError.Internal.of('Session list failed', error)),
				Telemetry.span('admin.listSessions', { kind: 'server', metrics: false }),
			)))
			.handle('deleteSession', ({ path }) => Middleware.guarded('admin', 'deleteSession', 'mutation', database.sessions.softDelete(path.id).pipe(
				Effect.mapError((error) => Cause.isNoSuchElementException(error) ? HttpError.NotFound.of('session', path.id) : HttpError.Internal.of('Session delete failed', error)),
				Effect.tap(() => audit.log('Session.delete', { details: { sessionId: path.id } })),
				Effect.as({ success: true as const }),
				Telemetry.span('admin.deleteSession', { kind: 'server', metrics: false }),
			)))
			.handle('revokeSessionsByIp', ({ payload }) => Middleware.guarded('admin', 'revokeSessionsByIp', 'mutation', database.sessions.softDeleteByIp(payload.ipAddress).pipe(
				Effect.mapError((error) => HttpError.Internal.of('Session revoke failed', error)),
				Effect.tap((revoked) => audit.log('Session.revokeByIp', { details: { ipAddress: payload.ipAddress, revoked } })),
				Effect.map((revoked) => ({ revoked })),
				Telemetry.span('admin.revokeSessionsByIp', { kind: 'server', metrics: false }),
			)))
			.handle('listJobs', ({ urlParams }) => Middleware.guarded('admin', 'listJobs', 'api', database.jobs.page([], { cursor: urlParams.cursor, limit: urlParams.limit }).pipe(
				Effect.mapError((error) => HttpError.Internal.of('Job list failed', error)),
				Telemetry.span('admin.listJobs', { kind: 'server', metrics: false }),
			)))
			.handle('cancelJob', ({ path }) => Middleware.guarded('admin', 'cancelJob', 'mutation', jobs.cancel(path.id).pipe(
				Effect.mapError((error) => error.reason === 'NotFound' ? HttpError.NotFound.of('job', path.id) : HttpError.Internal.of('Job cancel failed', error)),
				Effect.tap(() => audit.log('Job.cancel', { details: { jobId: path.id } })),
				Effect.as({ success: true as const }),
				Telemetry.span('admin.cancelJob', { kind: 'server', metrics: false }),
			)))
			.handle('listDlq', ({ urlParams }) => Middleware.guarded('admin', 'listDlq', 'api', database.jobDlq.listPending({ cursor: urlParams.cursor, limit: urlParams.limit }).pipe(
				Effect.mapError((error) => HttpError.Internal.of('DLQ list failed', error)),
				Telemetry.span('admin.listDlq', { kind: 'server', metrics: false }),
			)))
			.handle('replayDlq', ({ path }) => Middleware.guarded('admin', 'replayDlq', 'mutation', _requireOne(
				database.jobDlq.one([{ field: 'id', value: path.id }]),
				'dlq',
				path.id,
			).pipe(
				Effect.flatMap((entry) =>
					Effect.filterOrFail(
						Effect.succeed(entry),
						(dlqEntry) => dlqEntry.source === 'job' || dlqEntry.type.startsWith('webhook:'),
						(dlqEntry) => HttpError.Validation.of('dlqReplay', `Unsupported event DLQ type: ${dlqEntry.type}`),
					).pipe(
						Effect.flatMap((dlqEntry) => (dlqEntry.source === 'job'
							? Context.Request.withinSync(dlqEntry.appId, jobs.submit(dlqEntry.type, dlqEntry.payload, { priority: 'normal' }).pipe(
								Effect.flatMap(() => database.jobDlq.markReplayed(path.id)),
								Effect.asVoid,
							))
							: webhooks.retry(path.id).pipe(Effect.asVoid)).pipe(
							Effect.catchAll((error: unknown) => Effect.fail(HttpError.Internal.of('DLQ replay failed', error))),
						)),
					)),
				Effect.tap(() => audit.log('Dlq.replay', { details: { dlqId: path.id } })),
				Effect.as({ success: true as const }),
				Telemetry.span('admin.replayDlq', { kind: 'server', metrics: false }),
			)))
			.handle('listNotifications', ({ urlParams }) => Middleware.guarded('admin', 'listNotifications', 'api', notifications.list({
				after: urlParams.after,
				before: urlParams.before,
				cursor: urlParams.cursor,
				limit: urlParams.limit,
			}).pipe(
				Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Notification list failed', error)),
				Telemetry.span('admin.listNotifications', { kind: 'server', metrics: false }),
			)))
			.handle('replayNotification', ({ path }) => Middleware.guarded('admin', 'replayNotification', 'mutation', notifications.replay(path.id).pipe(
				Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Notification replay failed', error)),
				Effect.tap(() => audit.log('Job.replay', { details: { notificationId: path.id } })),
				Effect.as({ success: true as const }),
				Telemetry.span('admin.replayNotification', { kind: 'server', metrics: false }),
			)))
			.handleRaw('events', () => Middleware.guarded('admin', 'events', 'realtime', Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => StreamingService.sse({
					filter: (envelope) => envelope.event.tenantId === tenantId,
					name: 'admin.events',
					serialize: (envelope) => ({
						data: JSON.stringify(envelope.event),
						event: 'domain',
						id: envelope.event.eventId,
					}),
					source: eventBus.stream(),
				})),
				Telemetry.span('admin.events', { kind: 'server', metrics: false }),
			)))
			.handle('dbIoStats', () => Middleware.guarded('admin', 'dbIoStats', 'api', database.monitoring.ioStats().pipe(
				Effect.mapError((error) => HttpError.Internal.of('Database io stats failed', error)),
				Telemetry.span('admin.dbIoStats', { kind: 'server', metrics: false }),
			)))
			.handle('dbIoConfig', () => Middleware.guarded('admin', 'dbIoConfig', 'api', database.monitoring.ioConfig().pipe(
				Effect.mapError((error) => HttpError.Internal.of('Database io config failed', error)),
				Telemetry.span('admin.dbIoConfig', { kind: 'server', metrics: false }),
			)))
			.handle('dbStatements', ({ urlParams }) => Middleware.guarded('admin', 'dbStatements', 'api', database.listStatStatements(urlParams.limit).pipe(
				Effect.mapError((error) => HttpError.Internal.of('Database statements failed', error)),
				Telemetry.span('admin.dbStatements', { kind: 'server', metrics: false }),
			)))
			.handle('dbCacheHitRatio', () => Middleware.guarded('admin', 'dbCacheHitRatio', 'api', database.monitoring.cacheHitRatio().pipe(
				Effect.mapError((error) => HttpError.Internal.of('Database cache hit ratio failed', error)),
				Telemetry.span('admin.dbCacheHitRatio', { kind: 'server', metrics: false }),
			)))
			.handle('listPermissions', () => Middleware.guarded('admin', 'listPermissions', 'api', policy.list().pipe(
				Effect.map((permissions) => permissions.map((permission) => ({ action: permission.action, resource: permission.resource, role: permission.role }))),
				Telemetry.span('admin.listPermissions', { kind: 'server', metrics: false }),
			)))
			.handle('grantPermission', ({ payload }) => Middleware.guarded('admin', 'grantPermission', 'mutation', policy.grant(payload).pipe(
				Effect.map((permission) => ({ action: permission.action, resource: permission.resource, role: permission.role })),
				Effect.tap((permission) => audit.log('Permission.create', { details: permission })),
				Telemetry.span('admin.grantPermission', { kind: 'server', metrics: false }),
			)))
			.handle('revokePermission', ({ payload }) => Middleware.guarded('admin', 'revokePermission', 'mutation', policy.revoke(payload).pipe(
				Effect.tap(() => audit.log('Permission.revoke', { details: payload })),
				Effect.as({ success: true as const }),
				Telemetry.span('admin.revokePermission', { kind: 'server', metrics: false }),
			)))
			.handle('listTenants', () => Middleware.guarded('admin', 'listTenants', 'api', database.apps.find([]).pipe(
				Effect.mapError((error) => HttpError.Internal.of('Tenant list failed', error)),
				Telemetry.span('admin.listTenants', { kind: 'server', metrics: false }),
			)))
			.handle('createTenant', ({ payload }) => Middleware.guarded('admin', 'createTenant', 'mutation', database.apps.byNamespace(payload.namespace).pipe(
				Effect.mapError((error) => HttpError.Internal.of('Tenant namespace lookup failed', error)),
				Effect.flatMap(Option.match({
					onNone: () => Effect.gen(function* () {
						const inserted = yield* database.apps.insert({
							name: payload.name,
							namespace: payload.namespace,
							settings: Option.fromNullable(payload.settings),
							status: 'active',
							updatedAt: undefined
						}).pipe(
							Effect.mapError((error) => HttpError.Internal.of('Tenant creation failed', error) as HttpError.Conflict | HttpError.Internal),
						);
						yield* policy.seedTenantDefaults(inserted.id).pipe(
							Effect.mapError((error) => HttpError.Internal.of('Tenant default permissions failed', error) as HttpError.Conflict | HttpError.Internal),
						);
						yield* eventBus.publish({ aggregateId: inserted.id, payload: { _tag: 'tenant', action: 'provisioned', name: payload.name, namespace: payload.namespace }, tenantId: inserted.id }).pipe(Effect.ignore);
						yield* audit.log('tenant.create', { after: { name: payload.name, namespace: payload.namespace }, subjectId: inserted.id });
						return inserted;
					}),
					onSome: () => Effect.fail(HttpError.Conflict.of('tenant', `Namespace '${payload.namespace}' already exists`) as HttpError.Conflict | HttpError.Internal),
				})),
				Telemetry.span('admin.createTenant', { kind: 'server', metrics: false }),
			)))
			.handle('getTenant', ({ path }) => Middleware.guarded('admin', 'getTenant', 'api', _requireOne(
				database.apps.one([{ field: 'id', value: path.id }]),
				'tenant',
				path.id,
			).pipe(
				Telemetry.span('admin.getTenant', { kind: 'server', metrics: false }),
			)))
				.handle('updateTenant', ({ path, payload }) => Middleware.guarded('admin', 'updateTenant', 'mutation', database.withTransaction(Effect.gen(function* () {
					const current = yield* _requireOne(
						database.apps.one([{ field: 'id', value: path.id }], 'update'),
						'tenant',
						path.id,
					);
					const currentSettings = yield* S.decodeUnknown(AppSettingsSchema)(
						Option.getOrElse(current.settings, () => AppSettingsDefaults),
						{ errors: 'all', onExcessProperty: 'ignore' },
					).pipe(
						Effect.mapError((error) => HttpError.Internal.of('Tenant settings decode failed', error)),
					);
					const updates = {
						...(payload.name === undefined ? {} : { name: payload.name }),
						...(payload.settings === undefined ? {} : {
							settings: {
								...currentSettings,
								...payload.settings,
							},
						}),
					};
				const updated = yield* Object.keys(updates).length === 0
					? Effect.succeed(current)
					: database.apps.set(path.id, updates).pipe(
						Effect.mapError((error) => Cause.isNoSuchElementException(error)
							? HttpError.NotFound.of('tenant', path.id)
							: HttpError.Internal.of('Tenant update failed', error)),
					);
					yield* audit.log('App.update', { details: { tenantId: path.id } });
					return updated;
				})).pipe(
					Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Tenant update failed', error)),
					Telemetry.span('admin.updateTenant', { kind: 'server', metrics: false }),
				)))
			.handle('deactivateTenant', ({ path }) => Middleware.guarded('admin', 'deactivateTenant', 'mutation', Effect.gen(function* () {
				const app = yield* _requireOne(database.apps.one([{ field: 'id', value: path.id }]), 'tenant', path.id);
				yield* Effect.filterOrFail(
					Effect.succeed(app.status),
					(status) => status === 'active',
					() => HttpError.Validation.of('tenantTransition', `Invalid transition from '${app.status}' to 'suspended'`),
				);
				yield* database.apps.suspend(path.id).pipe(Effect.mapError((error) => HttpError.Internal.of('Tenant suspension failed', error)));
				yield* eventBus.publish({ aggregateId: path.id, payload: { _tag: 'tenant', action: 'suspended' }, tenantId: path.id }).pipe(Effect.ignore);
				yield* audit.log('tenant.update', { after: { status: 'suspended' }, before: { status: app.status }, subjectId: path.id });
				return { success: true as const };
			}).pipe(
				Telemetry.span('admin.deactivateTenant', { kind: 'server', metrics: false }),
			)))
			.handle('resumeTenant', ({ path }) => Middleware.guarded('admin', 'resumeTenant', 'mutation', Effect.gen(function* () {
				const app = yield* _requireOne(database.apps.one([{ field: 'id', value: path.id }]), 'tenant', path.id);
				yield* Effect.filterOrFail(
					Effect.succeed(app.status),
					(status) => status === 'suspended',
					() => HttpError.Validation.of('tenantTransition', `Invalid transition from '${app.status}' to 'active'`),
				);
				yield* database.apps.resume(path.id).pipe(Effect.mapError((error) => HttpError.Internal.of('Tenant resume failed', error)));
				yield* eventBus.publish({ aggregateId: path.id, payload: { _tag: 'tenant', action: 'resumed' }, tenantId: path.id }).pipe(Effect.ignore);
				yield* audit.log('tenant.update', { after: { status: 'active' }, before: { status: app.status }, subjectId: path.id });
				return { success: true as const };
			}).pipe(
				Telemetry.span('admin.resumeTenant', { kind: 'server', metrics: false }),
			)))
			.handle('getTenantOAuth', ({ path }) => Middleware.guarded('admin', 'getTenantOAuth', 'api', _requireOne(
				database.apps.one([{ field: 'id', value: path.id }]),
				'tenant',
				path.id,
			).pipe(
				Effect.flatMap((tenant) => S.decodeUnknown(AppSettingsSchema)(
					Option.getOrElse(tenant.settings, () => AppSettingsDefaults),
					{ errors: 'all', onExcessProperty: 'ignore' },
				).pipe(
					Effect.mapError((error) => HttpError.Internal.of('Tenant OAuth settings decode failed', error)),
					Effect.flatMap((settings) => Effect.forEach(
						settings.oauthProviders,
						(provider) => Encoding.decodeBase64(provider.clientSecretEncrypted).pipe(
							Effect.flatMap(Crypto.decrypt),
							Effect.flatMap((clientSecret) => S.decodeUnknown(OAuthProviderConfigSchema)({
								clientId: provider.clientId,
								clientSecret,
								enabled: provider.enabled,
								keyId: provider.keyId,
								provider: provider.provider,
								scopes: provider.scopes,
								teamId: provider.teamId,
								tenant: provider.tenant,
							})),
						),
						{ concurrency: 'unbounded' },
					)),
				)),
				Effect.map((providers) => ({ providers })),
				Effect.mapError((error) => HttpError.Internal.of('Tenant OAuth config read failed', error)),
				Telemetry.span('admin.getTenantOAuth', { kind: 'server', metrics: false }),
			)))
			.handle('updateTenantOAuth', ({ path, payload }) => Middleware.guarded('admin', 'updateTenantOAuth', 'mutation', _requireOne(
				database.apps.one([{ field: 'id', value: path.id }], 'update'),
				'tenant',
				path.id,
			).pipe(
				Effect.flatMap((tenant) => S.decodeUnknown(AppSettingsSchema)(
					Option.getOrElse(tenant.settings, () => AppSettingsDefaults),
					{ errors: 'all', onExcessProperty: 'ignore' },
				).pipe(
					Effect.mapError((error) => HttpError.Internal.of('Tenant OAuth settings decode failed', error)),
					Effect.flatMap((currentSettings) => Effect.forEach(payload.providers, (provider) => Crypto.encrypt(provider.clientSecret).pipe(
						Effect.map(Encoding.encodeBase64),
						Effect.flatMap((clientSecretEncrypted) => S.decodeUnknown(OAuthProviderStoredSchema)({
							clientId: provider.clientId,
							clientSecretEncrypted,
							enabled: provider.enabled,
							keyId: provider.keyId,
							provider: provider.provider,
							scopes: provider.scopes,
							teamId: provider.teamId,
							tenant: provider.tenant,
						})),
					), { concurrency: 'unbounded' }).pipe(
						Effect.flatMap((oauthProviders) => database.apps.updateSettings(tenant.id, {
							...currentSettings,
							oauthProviders,
						})),
						Effect.mapError((error) => HttpError.Internal.of('Tenant OAuth config update failed', error)),
					)),
				)),
				Effect.tap(() => audit.log('App.update', { details: { tenantId: path.id } })),
				Effect.tap(() => eventBus.publish({ aggregateId: path.id, payload: { _tag: 'app', action: 'settings.updated' }, tenantId: path.id }).pipe(Effect.ignore)),
				Effect.map(() => payload),
				Telemetry.span('admin.updateTenantOAuth', { kind: 'server', metrics: false }),
			)))
			.handle('getFeatureFlags', () => Middleware.guarded('admin', 'getFeatureFlags', 'api', features.getAll.pipe(
				Telemetry.span('admin.getFeatureFlags', { kind: 'server', metrics: false }),
			)))
			.handle('setFeatureFlag', ({ payload }) => Middleware.guarded('admin', 'setFeatureFlag', 'mutation', features.set(payload.flag, payload.value).pipe(
				Effect.tap(() => audit.log('Feature.update', { details: { flag: payload.flag, value: payload.value } })),
				Effect.as({ success: true as const }),
				Telemetry.span('admin.setFeatureFlag', { kind: 'server', metrics: false }),
			)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AdminLive };
