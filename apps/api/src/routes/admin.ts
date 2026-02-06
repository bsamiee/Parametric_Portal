/**
 * Admin management endpoints.
 * Admin-gated CRUD for users, sessions, jobs, DLQ, events, apps.
 */
import { HttpApiBuilder } from '@effect/platform';
import { Client } from '@parametric-portal/database/client';
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

// --- [LAYERS] ----------------------------------------------------------------

const AdminLive = HttpApiBuilder.group(ParametricApi, 'admin', (handlers) =>
	Effect.gen(function* () {
		const [database, jobs, eventBus, audit] = yield* Effect.all([DatabaseService, JobService, EventBus, AuditService]);
		const requireRole = Middleware.makeRequireRole((id) => database.users.one([{ field: 'id', value: id }]).pipe(Effect.map(Option.map((user) => ({ role: user.role })))));
		const requireAdmin = Middleware.requireMfaVerified.pipe(Effect.andThen(requireRole('admin')));
		return handlers
				.handle('listUsers', ({ urlParams }) => CacheService.rateLimit('api', requireAdmin.pipe(
					Effect.andThen(Context.Request.currentTenantId),
					Effect.flatMap((tenantId) => database.users.page([{ field: 'app_id', value: tenantId }], { cursor: urlParams.cursor, limit: urlParams.limit }).pipe(
						Effect.mapError((error) => HttpError.Internal.of('User list failed', error)),
					)),
					Telemetry.span('admin.listUsers', { kind: 'server', metrics: false }),
				)))
					.handle('listSessions', ({ urlParams }) => CacheService.rateLimit('api', requireAdmin.pipe(
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
				.handle('deleteSession', ({ path }) => CacheService.rateLimit('mutation', requireAdmin.pipe(
					Effect.andThen(database.sessions.softDelete(path.id).pipe(
						Effect.mapError((error) => Cause.isNoSuchElementException(error) ? HttpError.NotFound.of('session', path.id) : HttpError.Internal.of('Session delete failed', error)),
					)),
					Effect.tap(() => audit.log('Session.delete', { details: { sessionId: path.id } })),
					Effect.as({ success: true as const }),
					Telemetry.span('admin.deleteSession', { kind: 'server', metrics: false }),
				)))
				.handle('revokeSessionsByIp', ({ payload }) => CacheService.rateLimit('mutation', requireAdmin.pipe(
					Effect.andThen(database.sessions.softDeleteByIp(payload.ipAddress).pipe(
						Effect.mapError((error) => HttpError.Internal.of('Session revoke failed', error)),
					)),
					Effect.tap((revoked) => audit.log('Session.revokeByIp', { details: { ipAddress: payload.ipAddress, revoked } })),
					Effect.map((revoked) => ({ revoked })),
					Telemetry.span('admin.revokeSessionsByIp', { kind: 'server', metrics: false }),
				)))
				.handle('listJobs', ({ urlParams }) => CacheService.rateLimit('api', requireAdmin.pipe(
					Effect.andThen(database.jobs.page([], { cursor: urlParams.cursor, limit: urlParams.limit }).pipe(
						Effect.mapError((error) => HttpError.Internal.of('Job list failed', error)),
					)),
					Telemetry.span('admin.listJobs', { kind: 'server', metrics: false }),
				)))
				.handle('cancelJob', ({ path }) => CacheService.rateLimit('mutation', requireAdmin.pipe(
					Effect.andThen(jobs.cancel(path.id).pipe(
						Effect.mapError((error) => error.reason === 'NotFound' ? HttpError.NotFound.of('job', path.id) : HttpError.Internal.of('Job cancel failed', error)),
					)),
					Effect.tap(() => audit.log('Job.cancel', { details: { jobId: path.id } })),
					Effect.as({ success: true as const }),
					Telemetry.span('admin.cancelJob', { kind: 'server', metrics: false }),
				)))
				.handle('listDlq', ({ urlParams }) => CacheService.rateLimit('api', requireAdmin.pipe(
					Effect.andThen(database.jobDlq.listPending({ cursor: urlParams.cursor, limit: urlParams.limit }).pipe(
						Effect.mapError((error) => HttpError.Internal.of('DLQ list failed', error)),
					)),
					Telemetry.span('admin.listDlq', { kind: 'server', metrics: false }),
				)))
				.handle('replayDlq', ({ path }) => CacheService.rateLimit('mutation', requireAdmin.pipe(
					Effect.andThen(database.jobDlq.markReplayed(path.id).pipe(
						Effect.mapError((error) => Cause.isNoSuchElementException(error) ? HttpError.NotFound.of('dlq', path.id) : HttpError.Internal.of('DLQ replay failed', error)),
					)),
					Effect.tap(() => audit.log('Dlq.replay', { details: { dlqId: path.id } })),
					Effect.as({ success: true as const }),
					Telemetry.span('admin.replayDlq', { kind: 'server', metrics: false }),
				)))
					.handleRaw('events', () => CacheService.rateLimit('realtime', requireAdmin.pipe(
						Effect.andThen(Context.Request.currentTenantId),
						Effect.flatMap((tenantId) => StreamingService.sse({
							filter: (envelope) => envelope.event.tenantId === tenantId,
					name: 'admin.events',
					serialize: (envelope) => ({
						data: JSON.stringify(envelope.event),
						event: 'domain', id: envelope.event.eventId,}),
						source: eventBus.stream(),
					})),
					Telemetry.span('admin.events', { kind: 'server', metrics: false }),
				)))
					.handle('listApps', () => CacheService.rateLimit('api', requireAdmin.pipe(
						Effect.andThen(database.apps.find([]).pipe(
							Effect.mapError((error) => HttpError.Internal.of('App list failed', error)),
						)),
						Telemetry.span('admin.listApps', { kind: 'server', metrics: false }),
					)))
					.handle('dbIoStats', () => CacheService.rateLimit('api', requireAdmin.pipe(
						Effect.andThen(Client.monitoring.ioStats().pipe(
							Effect.mapError((error) => HttpError.Internal.of('Database io stats failed', error)),
						)),
						Telemetry.span('admin.dbIoStats', { kind: 'server', metrics: false }),
					)))
					.handle('dbIoConfig', () => CacheService.rateLimit('api', requireAdmin.pipe(
						Effect.andThen(Client.monitoring.ioConfig().pipe(
							Effect.mapError((error) => HttpError.Internal.of('Database io config failed', error)),
						)),
						Telemetry.span('admin.dbIoConfig', { kind: 'server', metrics: false }),
					)))
					.handle('dbStatements', ({ urlParams }) => CacheService.rateLimit('api', requireAdmin.pipe(
						Effect.andThen(database.listStatStatements(urlParams.limit).pipe(
							Effect.mapError((error) => HttpError.Internal.of('Database statements failed', error)),
						)),
						Telemetry.span('admin.dbStatements', { kind: 'server', metrics: false }),
					)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AdminLive };
