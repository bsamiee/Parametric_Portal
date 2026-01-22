/**
 * Users group handlers for user management operations.
 * Includes role update endpoint protected by role enforcement middleware.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService, type DatabaseServiceShape } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Audit } from '@parametric-portal/server/audit';
import { HttpError } from '@parametric-portal/server/http-errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { Effect, Option, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type _RoleType = 'admin' | 'guest' | 'member' | 'owner' | 'viewer';

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const handleUpdateRole = Effect.fn('users.updateRole')(
    (repos: DatabaseServiceShape, requireRole: ReturnType<typeof Middleware.makeRequireRole>, targetUserId: string, newRole: string) =>
        Effect.gen(function* () {
            yield* Middleware.requireMfaVerified;
            yield* requireRole('admin');
            const user = yield* pipe(
                repos.users.findById(targetUserId),
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
            yield* Audit.log(repos.audit, 'User', targetUserId, 'update', {
                after: { email: updatedUser.email, role: updatedUser.role },
                before: { email: user.email, role: user.role },
            });
            return { appId: updatedUser.appId, email: updatedUser.email, id: updatedUser.id, role: updatedUser.role, state: updatedUser.state } as { appId: string; email: string; id: string; role: _RoleType; state: string };
        }),
);

// --- [LAYERS] ----------------------------------------------------------------

const UsersLive = HttpApiBuilder.group(ParametricApi, 'users', (handlers) =>
    Effect.gen(function* () {
        const repos = yield* DatabaseService;
        const requireRole = Middleware.makeRequireRole((id) => repos.users.findById(id).pipe(Effect.map(Option.map((u) => ({ role: u.role as _RoleType })))));
        return handlers.handle('updateRole', ({ path: { id }, payload: { role } }) => handleUpdateRole(repos, requireRole, id, role));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { UsersLive };
