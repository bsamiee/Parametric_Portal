/**
 * Audit log retrieval: admin entity/user queries, self-lookup for authenticated users.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Tenant } from '@parametric-portal/server/tenant';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { RateLimit } from '@parametric-portal/server/infra/rate-limit';
import { Effect, Option, pipe } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const AuditLive = HttpApiBuilder.group(ParametricApi, 'audit', (handlers) =>
	Effect.gen(function* () {
		const repos = yield* DatabaseService;
		const requireRole = Middleware.makeRequireRole((id) => repos.users.one([{ field: 'id', value: id }]).pipe(Effect.map(Option.map((u) => ({ role: u.role })))));
		const adminLookup = <A>(find: Effect.Effect<A, unknown>) => pipe(
			Middleware.requireMfaVerified,
			Effect.zipRight(requireRole('admin')),
			Effect.zipRight(find),
			Effect.mapError((e) => HttpError.internal('Audit lookup failed', e)),
		);
		return handlers
			.handle('getByEntity', ({ path: { subject, subjectId }, urlParams: params }) =>
				RateLimit.apply('api', adminLookup(Tenant.Context.current.pipe(Effect.flatMap((tenantId) => repos.audit.bySubject(tenantId, subject, subjectId, params.limit, params.cursor, params))))))
			.handle('getByUser', ({ path: { userId }, urlParams: params }) =>
				RateLimit.apply('api', adminLookup(Tenant.Context.current.pipe(Effect.flatMap((tenantId) => repos.audit.byUser(tenantId, userId, params.limit, params.cursor, params))))))
			.handle('getMine', ({ urlParams: params }) =>
				RateLimit.apply('api', pipe(
					Middleware.requireMfaVerified,
					Effect.zipRight(Effect.all([Tenant.Context.current, Middleware.Session])),
					Effect.flatMap(([tenantId, session]) => repos.audit.byUser(tenantId, session.userId, params.limit, params.cursor, params)),
					Effect.mapError((e) => HttpError.internal('Audit lookup failed', e)),
				)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuditLive };
