/**
 * Users group handlers for user management operations.
 * Includes role update endpoint protected by role enforcement middleware.
 */
import { HttpApiBuilder } from '@effect/platform';
import type { Context } from '@parametric-portal/server/context';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Effect, Option } from 'effect';

// --- [FUNCTIONS] -------------------------------------------------------------

const handleUpdateRole = Effect.fn('users.updateRole')(
    (repositories: DatabaseService.Type, audit: typeof AuditService.Service, requireRole: Middleware.RequireRoleCheck, targetUserId: string, newRole: Context.UserRole) =>
        Effect.gen(function* () {
            yield* Middleware.requireMfaVerified;
            yield* requireRole('admin');
            const user = yield* repositories.users.one([{ field: 'id', value: targetUserId }]).pipe(
                Effect.mapError((error) => HttpError.Internal.of('User lookup failed', error)),
                Effect.flatMap(Option.match({
                    onNone: () => Effect.fail(HttpError.NotFound.of('user', targetUserId)),
                    onSome: (user) => Effect.succeed(user),
                })),
            );
            const updatedUser = yield* repositories.users.update({ ...user, role: newRole, updatedAt: undefined }).pipe(
                Effect.mapError((error) => HttpError.Internal.of('Role update failed', error)),
            );
            yield* audit.log('User.update', {
                after: { email: updatedUser.email, role: updatedUser.role },
                before: { email: user.email, role: user.role },
                subjectId: targetUserId,
            });
            return updatedUser;
        }),
);

// --- [LAYERS] ----------------------------------------------------------------

const UsersLive = HttpApiBuilder.group(ParametricApi, 'users', (handlers) =>
    Effect.gen(function* () {
        const [repositories, audit] = yield* Effect.all([DatabaseService, AuditService]);
        const requireRole = Middleware.makeRequireRole((id) => repositories.users.one([{ field: 'id', value: id }]).pipe(Effect.map(Option.map((user) => ({ role: user.role })))));
        return handlers.handle('updateRole', ({ path: { id }, payload: { role } }) => CacheService.rateLimit('mutation', handleUpdateRole(repositories, audit, requireRole, id, role)));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { UsersLive };
