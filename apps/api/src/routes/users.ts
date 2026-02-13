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
import { constant } from 'effect/Function';
import { Effect, Option } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const UsersLive = HttpApiBuilder.group(ParametricApi, 'users', (handlers) =>
    Effect.gen(function* () {
        const [database, audit, notifications] = yield* Effect.all([DatabaseService, AuditService, NotificationService]);
        return handlers
            .handle('getMe', () =>
                Middleware.guarded('users', 'getMe', 'api', Context.Request.sessionOrFail.pipe(
                    Effect.flatMap((session) => database.users.one([{ field: 'id', value: session.userId }])),
                    HttpError.mapTo('user lookup failed'),
                    Effect.flatMap(Option.match({
                        onNone: () => Effect.fail(HttpError.NotFound.of('user')),
                        onSome: Effect.succeed,
                    })),
                    Telemetry.span('users.getMe'),
                )))
            .handle('updateProfile', ({ payload }) =>
                Middleware.guarded('users', 'updateProfile', 'mutation', Context.Request.sessionOrFail.pipe(
                    Effect.flatMap((session) => database.users.set(session.userId, { email: payload.email })),
                    HttpError.mapTo('Profile update failed'),
                    Effect.tap((updatedUser) => audit.log('User.update', {
                        after: { email: updatedUser.email },
                        subjectId: updatedUser.id,
                    })),
                    Telemetry.span('users.updateProfile'),
                )))
            .handle('deactivate', () =>
                Middleware.guarded('users', 'deactivate', 'mutation', Context.Request.sessionOrFail.pipe(
                    Effect.flatMap((session) => database.users.set(session.userId, { status: 'inactive' })),
                    HttpError.mapTo('Account deactivation failed'),
                    Effect.tap((user) => audit.log('User.update', {
                        after: { status: 'inactive' },
                        before: { status: user.status },
                        subjectId: user.id,
                    })),
                    Effect.as({ success: true as const }),
                    Telemetry.span('users.deactivate'),
                )))
            .handle('updateRole', ({ path: { id }, payload: { role } }) =>
                Middleware.guarded('users', 'updateRole', 'mutation', database.users.one([{ field: 'id', value: id }]).pipe(
                    HttpError.mapTo('user lookup failed'),
                    Effect.filterOrFail(Option.isSome, constant(HttpError.NotFound.of('user', id))),
                    Effect.map(({ value }) => value),
                    Effect.bindTo('user'),
                    Effect.bind('updatedUser', () => database.users.set(id, { role }).pipe(
                        HttpError.mapTo('Role update failed'),
                    )),
                    Effect.tap(({ user, updatedUser }) => audit.log('User.update', {
                        after: { email: updatedUser.email, role: updatedUser.role },
                        before: { email: user.email, role: user.role },
                        subjectId: id,
                    })),
                    Effect.map(({ updatedUser }) => updatedUser),
                    Telemetry.span('users.updateRole'),
                )))
            .handle('getNotificationPreferences', () =>
                Middleware.guarded('users', 'getNotificationPreferences', 'api', Middleware.feature('enableNotifications').pipe(
                    Effect.andThen(notifications.getPreferences()),
                    HttpError.mapTo('Notification preference lookup failed'),
                    Telemetry.span('users.getNotificationPreferences'),
                )))
            .handle('updateNotificationPreferences', ({ payload }) =>
                Middleware.guarded('users', 'updateNotificationPreferences', 'mutation', Middleware.feature('enableNotifications').pipe(
                    Effect.andThen(notifications.updatePreferences(payload)),
                    Effect.tap(() => audit.log('User.update', { details: { notifications: true } })),
                    HttpError.mapTo('Notification preference update failed'),
                    Telemetry.span('users.updateNotificationPreferences'),
                )))
            .handle('listNotifications', ({ urlParams }) =>
                Middleware.guarded('users', 'listNotifications', 'api', Middleware.feature('enableNotifications').pipe(
                    Effect.andThen(notifications.listMine({
                        after: urlParams.after,
                        before: urlParams.before,
                        cursor: urlParams.cursor,
                        limit: urlParams.limit,
                    })),
                    HttpError.mapTo('Notification list failed'),
                    Telemetry.span('users.listNotifications'),
                )))
            .handleRaw('subscribeNotifications', () =>
                Middleware.guarded('users', 'subscribeNotifications', 'realtime', Middleware.feature('enableNotifications').pipe(
                    Effect.andThen(StreamingService.sse({
                        name: 'users.notifications',
                        serialize: (envelope) => ({ data: JSON.stringify(envelope.event), event: 'notification', id: envelope.event.eventId }),
                        source: notifications.streamMine(),
                    })),
                    HttpError.mapTo('Notification stream failed'),
                    Telemetry.span('users.subscribeNotifications'),
                )));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { UsersLive };
