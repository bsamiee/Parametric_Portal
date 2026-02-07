/**
 * Admin management endpoints.
 * Admin-gated CRUD for users, sessions, jobs, DLQ, events, tenants.
 */
import { HttpApiBuilder } from '@effect/platform';
import { Client } from '@parametric-portal/database/client';
import { App } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { EventBus } from '@parametric-portal/server/infra/events';
import { JobService } from '@parametric-portal/server/infra/jobs';
import { Middleware } from '@parametric-portal/server/middleware';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { StreamingService } from '@parametric-portal/server/platform/streaming';
import { Cause, Effect, Option } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _requireAdmin = Middleware.requireMfaVerified.pipe(Effect.andThen(Middleware.requireRole('admin')));

// --- [FUNCTIONS] -------------------------------------------------------------

const settingsRecord = (settings: Option.Option<unknown>): Record<string, unknown> => Option.match(settings, { onNone: () => ({}), onSome: (value) => value as Record<string, unknown> });
const handleListTenants = (database: typeof DatabaseService.Service) =>
	CacheService.rateLimit('api', _requireAdmin.pipe(
		Effect.andThen(database.apps.find([]).pipe(Effect.mapError((error) => HttpError.Internal.of('Tenant list failed', error)),)),
		Telemetry.span('admin.listTenants', { kind: 'server', metrics: false }),
	));
const handleCreateTenant = (
	database: typeof DatabaseService.Service,
	audit: typeof AuditService.Service,
	payload: { readonly name: string; readonly namespace: string; readonly settings?: unknown },) =>
	CacheService.rateLimit('mutation', _requireAdmin.pipe(
		Effect.andThen(database.apps.byNamespace(payload.namespace).pipe(Effect.mapError((error) => HttpError.Internal.of('Tenant namespace lookup failed', error)),)),
		Effect.flatMap(Option.match({
			onNone: () => database.apps.insert(App.insert.make({
				name: payload.name,
				namespace: payload.namespace,
				settings: Option.fromNullable(payload.settings),
			})).pipe(Effect.mapError((error) => HttpError.Internal.of('Tenant creation failed', error) as HttpError.Conflict | HttpError.Internal),),
			onSome: () => Effect.fail(HttpError.Conflict.of('tenant', `Namespace '${payload.namespace}' already exists`) as HttpError.Conflict | HttpError.Internal),
		})),
		Effect.tap((tenant) => audit.log('App.create', { details: { namespace: payload.namespace, tenantId: tenant.id } })),
		Telemetry.span('admin.createTenant', { kind: 'server', metrics: false }),
	));
const handleGetTenant = (database: typeof DatabaseService.Service, id: string) =>
	CacheService.rateLimit('api', _requireAdmin.pipe(
		Effect.andThen(database.apps.one([{ field: 'id', value: id }]).pipe(Effect.mapError((error) => HttpError.Internal.of('Tenant lookup failed', error)),)),
		Effect.flatMap(Option.match({
			onNone: () => Effect.fail(HttpError.NotFound.of('tenant', id)),
			onSome: Effect.succeed,
		})),
		Telemetry.span('admin.getTenant', { kind: 'server', metrics: false }),
	));
const handleUpdateTenant = (
	database: typeof DatabaseService.Service,
	audit: typeof AuditService.Service,
	id: string,
	payload: { readonly name?: string; readonly settings?: unknown },) =>
	CacheService.rateLimit('mutation', _requireAdmin.pipe(
		Effect.andThen(database.apps.set(id, {
			...(payload.name === undefined ? {} : { name: payload.name }),
			...(payload.settings === undefined ? {} : { settings: payload.settings }),
		}).pipe(Effect.mapError((error) => Cause.isNoSuchElementException(error) ? HttpError.NotFound.of('tenant', id) : HttpError.Internal.of('Tenant update failed', error)),)),
		Effect.tap(() => audit.log('App.update', { details: { tenantId: id } })),
		Telemetry.span('admin.updateTenant', { kind: 'server', metrics: false }),
	));
const handleDeactivateTenant = (
	database: typeof DatabaseService.Service,
	audit: typeof AuditService.Service,
	id: string,) =>
	CacheService.rateLimit('mutation', _requireAdmin.pipe(
		Effect.andThen(database.apps.one([{ field: 'id', value: id }]).pipe(Effect.mapError((error) => HttpError.Internal.of('Tenant lookup failed', error)),)),
		Effect.flatMap(Option.match({
			onNone: () => Effect.fail(HttpError.NotFound.of('tenant', id) as HttpError.Internal | HttpError.NotFound),
			onSome: (tenant) => database.apps.updateSettings(tenant.id, { ...settingsRecord(tenant.settings), deactivated: true }).pipe(Effect.mapError((error) => HttpError.Internal.of('Tenant deactivation failed', error) as HttpError.Internal | HttpError.NotFound),),
		})),
		Effect.tap(() => audit.log('App.deactivate', { details: { tenantId: id } })),
		Effect.as({ success: true as const }),
		Telemetry.span('admin.deactivateTenant', { kind: 'server', metrics: false }),
	));
const handleGetTenantOAuth = (database: typeof DatabaseService.Service, id: string) =>
	CacheService.rateLimit('api', _requireAdmin.pipe(
		Effect.andThen(database.apps.one([{ field: 'id', value: id }]).pipe(Effect.mapError((error) => HttpError.Internal.of('Tenant lookup failed', error)),)),
		Effect.flatMap(Option.match({
			onNone: () => Effect.fail(HttpError.NotFound.of('tenant', id)),
			onSome: (tenant) => Effect.succeed({
				providers: (settingsRecord(tenant.settings)['oauthProviders'] ?? []) as ReadonlyArray<{
					readonly clientId: string;
					readonly clientSecret: string;
					readonly enabled: boolean;
					readonly provider: 'apple' | 'github' | 'google' | 'microsoft';
					readonly scopes?: ReadonlyArray<string>;
				}>,
			}),
		})),
		Telemetry.span('admin.getTenantOAuth', { kind: 'server', metrics: false }),
	));
const handleUpdateTenantOAuth = <P extends { readonly providers: ReadonlyArray<unknown> }>(
	database: typeof DatabaseService.Service,
	audit: typeof AuditService.Service,
	id: string,
	payload: P,) =>
	CacheService.rateLimit('mutation', _requireAdmin.pipe(
		Effect.andThen(database.apps.one([{ field: 'id', value: id }]).pipe(Effect.mapError((error) => HttpError.Internal.of('Tenant lookup failed', error)),)),
		Effect.flatMap(Option.match({
			onNone: () => Effect.fail(HttpError.NotFound.of('tenant', id) as HttpError.Internal | HttpError.NotFound),
			onSome: (tenant) => database.apps.updateSettings(tenant.id, { ...settingsRecord(tenant.settings), oauthProviders: payload.providers }).pipe(Effect.mapError((error) => HttpError.Internal.of('Tenant OAuth config update failed', error) as HttpError.Internal | HttpError.NotFound),),
		})),
		Effect.tap(() => audit.log('App.updateOAuth', { details: { tenantId: id } })),
		Effect.map(() => payload),
		Telemetry.span('admin.updateTenantOAuth', { kind: 'server', metrics: false }),
	));

// --- [LAYERS] ----------------------------------------------------------------

const AdminLive = HttpApiBuilder.group(ParametricApi, 'admin', (handlers) =>
	Effect.gen(function* () {
		const [database, jobs, eventBus, audit] = yield* Effect.all([DatabaseService, JobService, EventBus, AuditService]);
		return handlers
			.handle('listUsers', ({ urlParams }) => CacheService.rateLimit('api', _requireAdmin.pipe(
				Effect.andThen(Context.Request.currentTenantId),
				Effect.flatMap((tenantId) => database.users.page([{ field: 'app_id', value: tenantId }], { cursor: urlParams.cursor, limit: urlParams.limit }).pipe(Effect.mapError((error) => HttpError.Internal.of('User list failed', error)),)),
				Telemetry.span('admin.listUsers', { kind: 'server', metrics: false }),
			)))
			.handle('listSessions', ({ urlParams }) => CacheService.rateLimit('api', _requireAdmin.pipe(
				Effect.andThen(database.sessions.page(
					urlParams.userId
						? [{ field: 'user_id', value: urlParams.userId }]
						: urlParams.ipAddress
							? [{ field: 'ip_address', value: urlParams.ipAddress }]
							: [],
					{ cursor: urlParams.cursor, limit: urlParams.limit },
				).pipe(Effect.mapError((error) => HttpError.Internal.of('Session list failed', error)))),
				Telemetry.span('admin.listSessions', { kind: 'server', metrics: false }),
			)))
			.handle('deleteSession', ({ path }) => CacheService.rateLimit('mutation', _requireAdmin.pipe(
				Effect.andThen(database.sessions.softDelete(path.id).pipe(Effect.mapError((error) => Cause.isNoSuchElementException(error) ? HttpError.NotFound.of('session', path.id) : HttpError.Internal.of('Session delete failed', error)),)),
				Effect.tap(() => audit.log('Session.delete', { details: { sessionId: path.id } })),
				Effect.as({ success: true as const }),
				Telemetry.span('admin.deleteSession', { kind: 'server', metrics: false }),
			)))
			.handle('revokeSessionsByIp', ({ payload }) => CacheService.rateLimit('mutation', _requireAdmin.pipe(
				Effect.andThen(database.sessions.softDeleteByIp(payload.ipAddress).pipe(Effect.mapError((error) => HttpError.Internal.of('Session revoke failed', error)),)),
				Effect.tap((revoked) => audit.log('Session.revokeByIp', { details: { ipAddress: payload.ipAddress, revoked } })),
				Effect.map((revoked) => ({ revoked })),
				Telemetry.span('admin.revokeSessionsByIp', { kind: 'server', metrics: false }),
			)))
			.handle('listJobs', ({ urlParams }) => CacheService.rateLimit('api', _requireAdmin.pipe(
				Effect.andThen(database.jobs.page([], { cursor: urlParams.cursor, limit: urlParams.limit }).pipe(Effect.mapError((error) => HttpError.Internal.of('Job list failed', error)),)),
				Telemetry.span('admin.listJobs', { kind: 'server', metrics: false }),
			)))
			.handle('cancelJob', ({ path }) => CacheService.rateLimit('mutation', _requireAdmin.pipe(
				Effect.andThen(jobs.cancel(path.id).pipe(Effect.mapError((error) => error.reason === 'NotFound' ? HttpError.NotFound.of('job', path.id) : HttpError.Internal.of('Job cancel failed', error)),)),
				Effect.tap(() => audit.log('Job.cancel', { details: { jobId: path.id } })),
				Effect.as({ success: true as const }),
				Telemetry.span('admin.cancelJob', { kind: 'server', metrics: false }),
			)))
			.handle('listDlq', ({ urlParams }) => CacheService.rateLimit('api', _requireAdmin.pipe(
				Effect.andThen(database.jobDlq.listPending({ cursor: urlParams.cursor, limit: urlParams.limit }).pipe(Effect.mapError((error) => HttpError.Internal.of('DLQ list failed', error)),)),
				Telemetry.span('admin.listDlq', { kind: 'server', metrics: false }),
			)))
			.handle('replayDlq', ({ path }) => CacheService.rateLimit('mutation', _requireAdmin.pipe(
				Effect.andThen(database.jobDlq.markReplayed(path.id).pipe(Effect.mapError((error) => Cause.isNoSuchElementException(error) ? HttpError.NotFound.of('dlq', path.id) : HttpError.Internal.of('DLQ replay failed', error)),)),
				Effect.tap(() => audit.log('Dlq.replay', { details: { dlqId: path.id } })),
				Effect.as({ success: true as const }),
				Telemetry.span('admin.replayDlq', { kind: 'server', metrics: false }),
			)))
			.handleRaw('events', () => CacheService.rateLimit('realtime', _requireAdmin.pipe(
				Effect.andThen(Context.Request.currentTenantId),
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
			.handle('dbIoStats', () => CacheService.rateLimit('api', _requireAdmin.pipe(
				Effect.andThen(Client.monitoring.ioStats().pipe(Effect.mapError((error) => HttpError.Internal.of('Database io stats failed', error)),)),
				Telemetry.span('admin.dbIoStats', { kind: 'server', metrics: false }),
			)))
			.handle('dbIoConfig', () => CacheService.rateLimit('api', _requireAdmin.pipe(
				Effect.andThen(Client.monitoring.ioConfig().pipe(Effect.mapError((error) => HttpError.Internal.of('Database io config failed', error)),)),
				Telemetry.span('admin.dbIoConfig', { kind: 'server', metrics: false }),
			)))
			.handle('dbStatements', ({ urlParams }) => CacheService.rateLimit('api', _requireAdmin.pipe(
				Effect.andThen(database.listStatStatements(urlParams.limit).pipe(Effect.mapError((error) => HttpError.Internal.of('Database statements failed', error)),)),
				Telemetry.span('admin.dbStatements', { kind: 'server', metrics: false }),
			)))
			// Tenant CRUD
			.handle('listTenants', () => handleListTenants(database))
			.handle('createTenant', ({ payload }) => handleCreateTenant(database, audit, payload))
			.handle('getTenant', ({ path }) => handleGetTenant(database, path.id))
			.handle('updateTenant', ({ path, payload }) => handleUpdateTenant(database, audit, path.id, payload))
			.handle('deactivateTenant', ({ path }) => handleDeactivateTenant(database, audit, path.id))
			.handle('getTenantOAuth', ({ path }) => handleGetTenantOAuth(database, path.id))
			.handle('updateTenantOAuth', ({ path, payload }) => handleUpdateTenantOAuth(database, audit, path.id, payload));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AdminLive };
