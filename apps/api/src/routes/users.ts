/**
 * Users group handlers for user management operations.
 * Self-service profile endpoints + admin role update.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { NotificationService } from '@parametric-portal/server/domain/notifications';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { StreamingService } from '@parametric-portal/server/platform/streaming';
import { Effect, Option } from 'effect';

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

const UsersLive = HttpApiBuilder.group(ParametricApi, 'users', (handlers) =>
		Effect.gen(function* () {
			const [database, audit, notifications] = yield* Effect.all([DatabaseService, AuditService, NotificationService]);
			return handlers
				.handle('getMe', () =>
					Middleware.guarded('users', 'getMe', 'api', Context.Request.sessionOrFail.pipe(
						Effect.flatMap((session) => _requireOne(database.users.one([{ field: 'id', value: session.userId }]), 'user')),
						Telemetry.span('users.getMe', { metrics: false }),
					)))
				.handle('updateProfile', ({ payload }) =>
					Middleware.guarded('users', 'updateProfile', 'mutation', Context.Request.sessionOrFail.pipe(
						Effect.flatMap((session) => database.users.set(session.userId, { email: payload.email }).pipe(
							Effect.mapError((error) => HttpError.Internal.of('Profile update failed', error)),
						)),
						Effect.tap((updatedUser) => audit.log('User.update', {
							after: { email: updatedUser.email },
							subjectId: updatedUser.id,
						})),
						Telemetry.span('users.updateProfile', { metrics: false }),
					)))
				.handle('deactivate', () =>
					Middleware.guarded('users', 'deactivate', 'mutation', Context.Request.sessionOrFail.pipe(
						Effect.flatMap((session) => database.users.set(session.userId, { status: 'inactive' }).pipe(
							Effect.mapError((error) => HttpError.Internal.of('Account deactivation failed', error)),
						)),
						Effect.tap((user) => audit.log('User.update', {
							after: { status: 'inactive' },
							before: { status: user.status },
							subjectId: user.id,
						})),
						Effect.map(() => ({ success: true as const })),
						Telemetry.span('users.deactivate', { metrics: false }),
					)))
				.handle('updateRole', ({ path: { id }, payload: { role } }) =>
					Middleware.guarded('users', 'updateRole', 'mutation', _requireOne(database.users.one([{ field: 'id', value: id }]), 'user', id).pipe(
						Effect.flatMap((user) => database.users.set(id, { role }).pipe(
							Effect.mapError((error) => HttpError.Internal.of('Role update failed', error)),
							Effect.tap((updatedUser) => audit.log('User.update', {
								after: { email: updatedUser.email, role: updatedUser.role },
								before: { email: user.email, role: user.role },
								subjectId: id,
							})),
						)),
						Telemetry.span('users.updateRole', { metrics: false }),
					)))
				.handle('getNotificationPreferences', () =>
					Middleware.guarded('users', 'getNotificationPreferences', 'api', Middleware.feature('enableNotifications').pipe(
						Effect.andThen(notifications.getPreferences()),
						Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Notification preference lookup failed', error)),
					)))
				.handle('updateNotificationPreferences', ({ payload }) =>
					Middleware.guarded('users', 'updateNotificationPreferences', 'mutation', Middleware.feature('enableNotifications').pipe(
						Effect.andThen(notifications.updatePreferences(payload)),
						Effect.tap(() => audit.log('User.update', { details: { notifications: true } })),
						Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Notification preference update failed', error)),
					)))
				.handle('listNotifications', ({ urlParams }) =>
					Middleware.guarded('users', 'listNotifications', 'api', Middleware.feature('enableNotifications').pipe(
						Effect.andThen(notifications.listMine({
							after: urlParams.after,
							before: urlParams.before,
							cursor: urlParams.cursor,
							limit: urlParams.limit,
						})),
						Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Notification list failed', error)),
						Telemetry.span('users.listNotifications', { metrics: false }),
					)))
				.handleRaw('subscribeNotifications', () =>
					Middleware.guarded('users', 'subscribeNotifications', 'realtime', Middleware.feature('enableNotifications').pipe(
						Effect.andThen(StreamingService.sse({
							name: 'users.notifications',
							serialize: (envelope) => ({ data: JSON.stringify(envelope.event), event: 'notification', id: envelope.event.eventId }),
							source: notifications.streamMine(),
						})),
						Effect.mapError((error): HttpError.Internal => HttpError.Internal.of('Notification stream failed', error)),
						Telemetry.span('users.subscribeNotifications', { metrics: false }),
					)));
		}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { UsersLive };
