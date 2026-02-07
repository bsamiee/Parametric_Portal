/**
 * Audit log retrieval: admin entity/user queries, self-lookup for authenticated users.
 * Supports on-demand diff computation via ?includeDiff=true query parameter.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Diff } from '@parametric-portal/server/utils/diff';
import { Array as A, Effect, Option, pipe } from 'effect';

// --- [FUNCTIONS] -------------------------------------------------------------

/** Transform audit entries: compute diffs when requested, add null diff otherwise */
const withDiffs = <T extends { oldData: Option.Option<unknown>; newData: Option.Option<unknown> }>(
	items: readonly T[],
	includeDiff: boolean,): readonly (T & { readonly diff: Diff.Patch | null })[] =>
	A.map(items, (entry) => ({
		...entry,
		diff: includeDiff
			? pipe(Diff.fromSnapshots(entry.oldData, entry.newData), Option.getOrNull)
			: null,
	}));

// --- [LAYERS] ----------------------------------------------------------------

const AuditLive = HttpApiBuilder.group(ParametricApi, 'audit', (handlers) =>
	Effect.gen(function* () {
		const repositories = yield* DatabaseService;
		const adminLookup = <A>(find: Effect.Effect<A, unknown>) => Middleware.requireMfaVerified.pipe(
			Effect.andThen(Middleware.requireRole('admin')),
			Effect.andThen(find),
			Effect.mapError((error) => HttpError.Internal.of('Audit lookup failed', error)),
		);
		return handlers
			.handle('getByEntity', ({ path: { subject, subjectId }, urlParams: parameters }) =>
					CacheService.rateLimit('api', adminLookup(Context.Request.currentTenantId.pipe(
						Effect.flatMap((tenantId) => repositories.audit.bySubject(tenantId, subject, subjectId, parameters.limit, parameters.cursor, parameters)),
						Effect.map((result) => ({ ...result, items: withDiffs(result.items, parameters.includeDiff ?? false) })),
					)).pipe(Telemetry.span('audit.getByEntity', { kind: 'server', metrics: false }))))
				.handle('getByUser', ({ path: { userId }, urlParams: parameters }) =>
					CacheService.rateLimit('api', adminLookup(Context.Request.currentTenantId.pipe(
						Effect.flatMap((tenantId) => repositories.audit.byUser(tenantId, userId, parameters.limit, parameters.cursor, parameters)),
						Effect.map((result) => ({ ...result, items: withDiffs(result.items, parameters.includeDiff ?? false) })),
					)).pipe(Telemetry.span('audit.getByUser', { kind: 'server', metrics: false }))))
				.handle('getMine', ({ urlParams: parameters }) =>
					CacheService.rateLimit('api', Middleware.requireMfaVerified.pipe(
						Effect.andThen(Effect.all([Context.Request.current, Context.Request.sessionOrFail])),
						Effect.flatMap(([context, session]) => repositories.audit.byUser(context.tenantId, session.userId, parameters.limit, parameters.cursor, parameters)),
						Effect.map((result) => ({ ...result, items: withDiffs(result.items, parameters.includeDiff ?? false) })),
						Effect.catchTag('Auth', Effect.fail),
						Effect.mapError((error) => HttpError.Internal.of('Audit lookup failed', error)),
						Telemetry.span('audit.getMine', { kind: 'server', metrics: false }),
					)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuditLive };
