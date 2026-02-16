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
import { StreamingService } from '@parametric-portal/server/platform/streaming';
import { constant } from 'effect/Function';
import { Effect, Option } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const UsersLive = HttpApiBuilder.group(ParametricApi, 'users', (handlers) =>
    Effect.gen(function* () {
        const [database, audit, notifications] = yield* Effect.all([DatabaseService, AuditService, NotificationService]);
        const users = Middleware.resource('users');
        return handlers
            .handle('getMe', () =>
                users.api('getMe', Context.Request.sessionOrFail.pipe(
                    Effect.flatMap((session) => database.users.one([{ field: 'id', value: session.userId }])),
                    HttpError.mapTo('user lookup failed'),
                    Effect.flatMap(Option.match({
                        onNone: () => Effect.fail(HttpError.NotFound.of('user')),
                        onSome: Effect.succeed,
                    })),
                )))
            .handle('updateProfile', ({ payload }) =>
                users.mutation('updateProfile', Context.Request.sessionOrFail.pipe(
                    Effect.flatMap((session) => database.users.set(session.userId, { email: payload.email })),
                    HttpError.mapTo('Profile update failed'),
                    Effect.tap((updatedUser) => audit.log('User.update', {
                        after: { email: updatedUser.email },
                        subjectId: updatedUser.id,
                    })),
                )))
            .handle('deactivate', () =>
                users.mutation('deactivate', Context.Request.sessionOrFail.pipe(
                    Effect.flatMap((session) => database.users.set(session.userId, { status: 'inactive' })),
                    HttpError.mapTo('Account deactivation failed'),
                    Effect.tap((user) => audit.log('User.update', {
                        after: { status: 'inactive' },
                        before: { status: user.status },
                        subjectId: user.id,
                    })),
                    Effect.as({ success: true as const }),
                )))
            .handle('updateRole', ({ path: { id }, payload: { role } }) =>
                users.mutation('updateRole', database.users.one([{ field: 'id', value: id }]).pipe(
                    HttpError.mapTo('user lookup failed'),
                    Effect.filterOrFail(Option.isSome, constant(HttpError.NotFound.of('user', id))),
                    Effect.map(({ value }) => value),
                    Effect.bindTo('user'),
                    Effect.bind('updatedUser', () => database.users.set(id, { role }).pipe(HttpError.mapTo('Role update failed'),)),
                    Effect.tap(({ user, updatedUser }) => audit.log('User.update', {
                        after: { email: updatedUser.email, role: updatedUser.role },
                        before: { email: user.email, role: user.role },
                        subjectId: id,
                    })),
                    Effect.map(({ updatedUser }) => updatedUser),
                )))
            .handle('getNotificationPreferences', () => users.api('getNotificationPreferences', Middleware.feature('enableNotifications').pipe(Effect.andThen(notifications.getPreferences()),)))
            .handle('updateNotificationPreferences', ({ payload }) =>
                users.mutation('updateNotificationPreferences', Middleware.feature('enableNotifications').pipe(
                    Effect.andThen(notifications.updatePreferences(payload)),
                    Effect.tap(() => audit.log('User.update', { details: { notifications: true } })),
                )))
            .handle('listNotifications', ({ urlParams }) =>
                users.api('listNotifications', Middleware.feature('enableNotifications').pipe(
                    Effect.andThen(notifications.listMine({
                        after: urlParams.after,
                        before: urlParams.before,
                        cursor: urlParams.cursor,
                        limit: urlParams.limit,
                    })),
                )))
            .handleRaw('subscribeNotifications', () =>
                users.realtime('subscribeNotifications', Middleware.feature('enableNotifications').pipe(
                    Effect.andThen(StreamingService.sse({
                        name: 'users.notifications',
                        serialize: (envelope) => ({ data: JSON.stringify(envelope.event), event: 'notification', id: envelope.event.eventId }),
                        source: notifications.streamMine(),
                    })),
                )));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { UsersLive };
