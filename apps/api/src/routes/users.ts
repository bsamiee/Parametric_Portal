/**
 * Users group handlers for user management operations.
 * Self-service profile endpoints + admin role update.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Effect, Option } from 'effect';

// --- [FUNCTIONS] -------------------------------------------------------------

const lookupCurrentUser = (repositories: DatabaseService.Type) =>
	Context.Request.sessionOrFail.pipe(
		Effect.mapError(() => HttpError.Internal.of('Session lookup failed')),
		Effect.flatMap((session) => repositories.users.one([{ field: 'id', value: session.userId }]).pipe(
			Effect.mapError((error) => HttpError.Internal.of('User lookup failed', error)),
			Effect.flatMap(Option.match({
				onNone: () => Effect.fail(HttpError.NotFound.of('user')),
				onSome: Effect.succeed,
			})),
		)),
	);
const handleGetMe = (repositories: DatabaseService.Type) => lookupCurrentUser(repositories).pipe(Telemetry.span('users.getMe', { kind: 'server', metrics: false }),);
const handleUpdateProfile = (repositories: DatabaseService.Type, audit: typeof AuditService.Service, payload: { readonly email?: string }) =>
	Effect.gen(function* () {
		const user = yield* lookupCurrentUser(repositories);
		const updatedUser = yield* repositories.users.update({
			...user,
			...(payload.email === undefined ? {} : { email: payload.email }),
			updatedAt: undefined,
		}).pipe(Effect.mapError((error) => HttpError.Internal.of('Profile update failed', error)),);
		yield* audit.log('User.update', {
			after: { email: updatedUser.email },
			before: { email: user.email },
			subjectId: user.id,
		});
		return updatedUser;
	}).pipe(Telemetry.span('users.updateProfile', { kind: 'server', metrics: false }));
const handleDeactivate = (repositories: DatabaseService.Type, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		const user = yield* lookupCurrentUser(repositories);
		yield* repositories.users.update({ ...user, status: 'inactive', updatedAt: undefined }).pipe(Effect.mapError((error) => HttpError.Internal.of('Account deactivation failed', error)),);
		yield* audit.log('User.deactivate', {
			after: { status: 'inactive' },
			before: { status: user.status },
			subjectId: user.id,
		});
		return { success: true as const };
	}).pipe(Telemetry.span('users.deactivate', { kind: 'server', metrics: false }));
const handleUpdateRole = (repositories: DatabaseService.Type, audit: typeof AuditService.Service, targetUserId: string, newRole: Context.UserRole) =>
	Effect.gen(function* () {
		yield* Middleware.mfaVerified;
		yield* Middleware.role('admin');
		const user = yield* repositories.users.one([{ field: 'id', value: targetUserId }]).pipe(
			Effect.mapError((error) => HttpError.Internal.of('User lookup failed', error)),
			Effect.flatMap(Option.match({
				onNone: () => Effect.fail(HttpError.NotFound.of('user', targetUserId)),
				onSome: Effect.succeed,
			})),
		);
		const updatedUser = yield* repositories.users.update({ ...user, role: newRole, updatedAt: undefined }).pipe(Effect.mapError((error) => HttpError.Internal.of('Role update failed', error)),);
		yield* audit.log('User.update', {
			after: { email: updatedUser.email, role: updatedUser.role },
			before: { email: user.email, role: user.role },
			subjectId: targetUserId,
		});
		return updatedUser;
	}).pipe(Telemetry.span('users.updateRole', { kind: 'server', metrics: false }));

// --- [LAYERS] ----------------------------------------------------------------

const UsersLive = HttpApiBuilder.group(ParametricApi, 'users', (handlers) =>
	Effect.gen(function* () {
		const [repositories, audit] = yield* Effect.all([DatabaseService, AuditService]);
		return handlers
			.handle('getMe', () => CacheService.rateLimit('api', handleGetMe(repositories)))
			.handle('updateProfile', ({ payload }) => CacheService.rateLimit('mutation', handleUpdateProfile(repositories, audit, payload)))
			.handle('deactivate', () => CacheService.rateLimit('mutation', handleDeactivate(repositories, audit)))
			.handle('updateRole', ({ path: { id }, payload: { role } }) => CacheService.rateLimit('mutation', handleUpdateRole(repositories, audit, id, role)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { UsersLive };
