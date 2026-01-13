/**
 * Users group handlers for user management operations.
 * Includes role update endpoint protected by role enforcement middleware.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService, type DatabaseServiceShape } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { HttpError } from '@parametric-portal/server/http-errors';
import { requireRole } from '@parametric-portal/server/middleware';
import type { RoleKey, User, UserId } from '@parametric-portal/types/schema';
import { Email } from '@parametric-portal/types/types';
import { Effect, Option, pipe } from 'effect';

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const toUserResponse = (u: User) => Object.freeze({ createdAt: u.createdAt, email: Email.decodeSync(u.email), id: u.id, role: u.role });

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const handleUpdateRole = Effect.fn('users.updateRole')(
    (repos: DatabaseServiceShape, targetUserId: UserId, newRole: RoleKey) =>
        Effect.gen(function* () {
            yield* requireRole('admin');
            const userOpt = yield* pipe(
                repos.users.findById(targetUserId),
                HttpError.chain(HttpError.Internal, { message: 'User lookup failed' }),
            );
            const user = yield* Option.match(userOpt, {
                onNone: () => Effect.fail(new HttpError.NotFound({ id: targetUserId, resource: 'user' })),
                onSome: Effect.succeed,
            });
            const updatedUserOpt = yield* pipe(
                repos.users.update(user.id, { role: newRole }),
                HttpError.chain(HttpError.Internal, { message: 'Role update failed' }),
            );
            return yield* Option.match(updatedUserOpt, {
                onNone: () => Effect.fail(new HttpError.Internal({ message: 'User update returned empty result' })),
                onSome: (updatedUser) => Effect.succeed(toUserResponse(updatedUser)),
            });
        }),
);

// --- [LAYERS] ----------------------------------------------------------------

const UsersLive = HttpApiBuilder.group(ParametricApi, 'users', (handlers) =>
    Effect.gen(function* () {
        const repos = yield* DatabaseService;
        return handlers.handle('updateRole', ({ path: { id }, payload: { role } }) => handleUpdateRole(repos, id, role), );
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { UsersLive };
