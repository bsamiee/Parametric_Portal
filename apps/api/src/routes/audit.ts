/**
 * Audit log retrieval: admin entity/user queries, self-lookup for authenticated users.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { RateLimit } from '@parametric-portal/server/security/rate-limit';
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
			Effect.mapError((e) => HttpError.Internal.of('Audit lookup failed', e)),
		);
		return handlers
			.handle('getByEntity', ({ path: { subject, subjectId }, urlParams: params }) =>
				RateLimit.apply('api', adminLookup(Context.Request.tenantId.pipe(Effect.flatMap((tenantId) => repos.audit.bySubject(tenantId, subject, subjectId, params.limit, params.cursor, params)))).pipe(Effect.withSpan('audit.getByEntity', { kind: 'server' }))))
			.handle('getByUser', ({ path: { userId }, urlParams: params }) =>
				RateLimit.apply('api', adminLookup(Context.Request.tenantId.pipe(Effect.flatMap((tenantId) => repos.audit.byUser(tenantId, userId, params.limit, params.cursor, params)))).pipe(Effect.withSpan('audit.getByUser', { kind: 'server' }))))
			.handle('getMine', ({ urlParams: params }) =>
				RateLimit.apply('api', pipe(
					Middleware.requireMfaVerified,
					Effect.zipRight(Context.Request.current),
					Effect.flatMap((ctx) => {
						const session = Option.getOrThrow(ctx.session);
						return repos.audit.byUser(ctx.tenantId, session.userId, params.limit, params.cursor, params);
					}),
					Effect.mapError((e) => HttpError.Internal.of('Audit lookup failed', e)),
					Effect.withSpan('audit.getMine', { kind: 'server' }),
				)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuditLive };
