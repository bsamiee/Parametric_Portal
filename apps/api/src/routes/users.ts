/**
 * Users group handlers for user management operations.
 * Includes role update endpoint protected by role enforcement middleware.
 */
import { HttpApiBuilder } from '@effect/platform';
import type { Context } from '@parametric-portal/server/context';
import { DatabaseService, type DatabaseServiceShape } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { AuditService } from '@parametric-portal/server/domain/audit';
import { Effect, Option, pipe } from 'effect';

// --- [FUNCTIONS] -------------------------------------------------------------

const handleUpdateRole = Effect.fn('users.updateRole')(
    (repos: DatabaseServiceShape, audit: typeof AuditService.Service, requireRole: ReturnType<typeof Middleware.makeRequireRole>, targetUserId: string, newRole: Context.UserRole) =>
        Effect.gen(function* () {
            yield* Middleware.requireMfaVerified;
            yield* requireRole('admin');
            const user = yield* pipe(
                repos.users.one([{ field: 'id', value: targetUserId }]),
                Effect.mapError((e) => HttpError.internal('User lookup failed', e)),
                Effect.flatMap((opt) => Option.match(opt, {
                    onNone: () => Effect.fail(HttpError.notFound('user', targetUserId)),
                    onSome: Effect.succeed,
                })),
            );
            const updatedUser = yield* pipe(
                repos.users.update({ ...user, role: newRole, updatedAt: undefined }),
                Effect.mapError((e) => HttpError.internal('Role update failed', e)),
            );
            yield* audit.log('User', targetUserId, 'update', {
                after: { email: updatedUser.email, role: updatedUser.role },
                before: { email: user.email, role: user.role },
            });
            return updatedUser;
        }),
);

// --- [LAYERS] ----------------------------------------------------------------

const UsersLive = HttpApiBuilder.group(ParametricApi, 'users', (handlers) =>
    Effect.gen(function* () {
        const [repos, audit] = yield* Effect.all([DatabaseService, AuditService]);
        const requireRole = Middleware.makeRequireRole((id) => repos.users.one([{ field: 'id', value: id }]).pipe(Effect.map(Option.map((u) => ({ role: u.role })))));
        return handlers.handle('updateRole', ({ path: { id }, payload: { role } }) => handleUpdateRole(repos, audit, requireRole, id, role));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { UsersLive };
