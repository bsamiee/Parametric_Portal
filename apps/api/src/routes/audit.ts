/**
 * Audit log retrieval: admin entity/user queries, self-lookup for authenticated users.
 * Supports on-demand diff computation via ?includeDiff=true query parameter.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { Middleware } from '@parametric-portal/server/middleware';
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
        const audit = Middleware.resource('audit');
        return handlers
            .handle('getByEntity', ({ path: { subject, subjectId }, urlParams: parameters }) =>
                audit.api('getByEntity', Middleware.feature('enableAuditLog').pipe(
                        Effect.andThen(Context.Request.currentTenantId),
                        Effect.flatMap(() => repositories.audit.bySubject(subject, subjectId, parameters.limit, parameters.cursor, parameters)),
                        Effect.map((result) => ({ ...result, items: withDiffs(result.items, parameters.includeDiff ?? false) })),
                    )))
            .handle('getByUser', ({ path: { userId }, urlParams: parameters }) =>
                audit.api('getByUser', Middleware.feature('enableAuditLog').pipe(
                        Effect.andThen(Context.Request.currentTenantId),
                        Effect.flatMap(() => repositories.audit.byUser(userId, parameters.limit, parameters.cursor, parameters)),
                        Effect.map((result) => ({ ...result, items: withDiffs(result.items, parameters.includeDiff ?? false) })),
                    )))
            .handle('getMine', ({ urlParams: parameters }) =>
                audit.api('getMine', Middleware.feature('enableAuditLog').pipe(
                        Effect.andThen(Effect.all([Context.Request.current, Context.Request.sessionOrFail])),
                        Effect.flatMap(([, session]) => repositories.audit.byUser(session.userId, parameters.limit, parameters.cursor, parameters)),
                        Effect.map((result) => ({ ...result, items: withDiffs(result.items, parameters.includeDiff ?? false) })),
                    )));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuditLive };
