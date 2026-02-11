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
import { Diff } from '@parametric-portal/server/utils/diff';
import { Array as A, Effect, Option, pipe } from 'effect';

// --- [FUNCTIONS] -------------------------------------------------------------

const withDiffs = <T extends { delta: Option.Option<{ readonly old?: unknown; readonly new?: unknown }> }>(
	items: readonly T[],
	includeDiff: boolean,): readonly (T & { readonly diff: Diff.Patch | null })[] =>
	A.map(items, (entry) => ({
		...entry,
		diff: includeDiff
			? pipe(Option.flatMap(entry.delta, (delta) => Diff.fromSnapshots(Option.fromNullable(delta.old), Option.fromNullable(delta.new))), Option.getOrNull)
			: null,
	}));

// --- [LAYERS] ----------------------------------------------------------------

const AuditLive = HttpApiBuilder.group(ParametricApi, 'audit', (handlers) =>
	Effect.gen(function* () {
		const repositories = yield* DatabaseService;
		return handlers
			.handle('getByEntity', ({ path: { subject, subjectId }, urlParams: parameters }) =>
					Middleware.guarded('audit', 'getByEntity', 'api', Middleware.feature('enableAuditLog').pipe(
					Effect.andThen(Context.Request.currentTenantId),
						Effect.flatMap(() => repositories.audit.bySubject(subject, subjectId, parameters.limit, parameters.cursor, parameters)),
						Effect.map((result) => ({ ...result, items: withDiffs(result.items, parameters.includeDiff ?? false) })),
						Effect.mapError((error) => HttpError.Internal.of('Audit lookup failed', error)),
					)).pipe(Telemetry.span('audit.getByEntity')))
				.handle('getByUser', ({ path: { userId }, urlParams: parameters }) =>
					Middleware.guarded('audit', 'getByUser', 'api', Middleware.feature('enableAuditLog').pipe(
					Effect.andThen(Context.Request.currentTenantId),
						Effect.flatMap(() => repositories.audit.byUser(userId, parameters.limit, parameters.cursor, parameters)),
						Effect.map((result) => ({ ...result, items: withDiffs(result.items, parameters.includeDiff ?? false) })),
						Effect.mapError((error) => HttpError.Internal.of('Audit lookup failed', error)),
					)).pipe(Telemetry.span('audit.getByUser')))
				.handle('getMine', ({ urlParams: parameters }) =>
					Middleware.guarded('audit', 'getMine', 'api', Middleware.feature('enableAuditLog').pipe(
					Effect.andThen(Effect.all([Context.Request.current, Context.Request.sessionOrFail])),
						Effect.flatMap(([, session]) => repositories.audit.byUser(session.userId, parameters.limit, parameters.cursor, parameters)),
						Effect.map((result) => ({ ...result, items: withDiffs(result.items, parameters.includeDiff ?? false) })),
						Effect.mapError((error) => HttpError.Internal.of('Audit lookup failed', error)),
						Telemetry.span('audit.getMine'),
					)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuditLive };
