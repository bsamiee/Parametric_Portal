/**
 * Audit log retrieval: admin entity/actor queries, self-lookup for authenticated users.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { RequestContext } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/http-errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { RateLimit } from '@parametric-portal/server/rate-limit';
import { Effect, Option, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type _RoleType = 'admin' | 'guest' | 'member' | 'owner' | 'viewer';

// --- [LAYERS] ----------------------------------------------------------------

const AuditLive = HttpApiBuilder.group(ParametricApi, 'audit', (handlers) =>
	Effect.gen(function* () {
		const repos = yield* DatabaseService;
		const requireRole = Middleware.makeRequireRole((id) => repos.users.findById(id).pipe(Effect.map(Option.map((u) => ({ role: u.role as _RoleType })))));
		const adminLookup = <A>(find: Effect.Effect<A, unknown>) => pipe(
			Middleware.requireMfaVerified,
			Effect.zipRight(requireRole('admin')),
			Effect.zipRight(find),
			Effect.mapError((e) => HttpError.internal('Audit lookup failed', e)),
		);
		return handlers
			.handle('getByEntity', ({ path: { entityType, entityId }, urlParams: params }) =>
				RateLimit.apply('api', adminLookup(RequestContext.app.pipe(Effect.flatMap((appId) => repos.audit.byEntity(appId, entityType, entityId, params.limit, params.cursor, params))))))
			.handle('getByActor', ({ path: { actorId }, urlParams: params }) =>
				RateLimit.apply('api', adminLookup(RequestContext.app.pipe(Effect.flatMap((appId) => repos.audit.byActor(appId, actorId, params.limit, params.cursor, params))))))
			.handle('getMine', ({ urlParams: params }) =>
				RateLimit.apply('api', pipe(
					Middleware.requireMfaVerified,
					Effect.zipRight(Effect.all({ appId: RequestContext.app, userId: Middleware.Session.pipe(Effect.map((s) => s.userId)) })),
					Effect.flatMap(({ appId, userId }) => repos.audit.byActor(appId, userId, params.limit, params.cursor, params)),
					Effect.mapError((e) => HttpError.internal('Audit lookup failed', e)),
				)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuditLive };
