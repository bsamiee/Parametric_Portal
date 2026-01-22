/**
 * Log audit events with fail-open semantics.
 * Auto-extracts context from RequestContext; generates diffs when before/after provided.
 */
import { FileSystem } from '@effect/platform';
import type { AuditLog } from '@parametric-portal/database/models';
import type { SqlError } from '@effect/sql/SqlError';
import { Effect, Match, Metric, Option, Ref } from 'effect';
import { RequestContext } from './context.ts';
import { Diff } from './diff.ts';
import { MetricsService } from './metrics.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const config = {
	batch: { concurrency: 10 },
	deadLetter: { enabled: process.env['AUDIT_DEAD_LETTER_FILE'] !== undefined, path: process.env['AUDIT_DEAD_LETTER_FILE'] ?? '/tmp/audit-dead-letter.jsonl' },
	failures: { threshold: 5 },
} as const;

// --- [SERVICE] ---------------------------------------------------------------

class AuditService extends Effect.Service<AuditService>()('server/Audit', {
	effect: Effect.gen(function* () {
		const health = yield* Ref.make<{ count: number; state: 'alerted' | 'degraded' | 'healthy' }>({ count: 0, state: 'healthy' });
		return {
			logFailure: Ref.updateAndGet(health, (current) => {
				const count = current.count + 1;
				return { count, state: Match.value(count).pipe(Match.when((n) => n >= config.failures.threshold, () => 'alerted' as const), Match.when((n) => n >= 2, () => 'degraded' as const), Match.orElse(() => 'healthy' as const)) };
			}),
			logSuccess: Ref.update(health, () => ({ count: 0, state: 'healthy' as const })),
		};
	}),
}) {}

// --- [FUNCTIONS] -------------------------------------------------------------

const log = (
	repo: { readonly log: (data: typeof AuditLog.insert.Type) => Effect.Effect<typeof AuditLog.Type, SqlError> },
	entityType: 'ApiKey' | 'App' | 'Asset' | 'MfaSecret' | 'OauthAccount' | 'RefreshToken' | 'Session' | 'User',
	entityId: string,
	operation: string,
	opts?: { readonly actorEmail?: string; readonly after?: unknown; readonly before?: unknown },
): Effect.Effect<void, never, AuditService | FileSystem.FileSystem | MetricsService | RequestContext> =>
	Effect.gen(function* () {
		const ctx = yield* RequestContext;
		const audit = yield* AuditService;
		const metrics = yield* MetricsService;
		const entry = {
			actorEmail: opts?.actorEmail ?? null,
			actorId: Option.getOrNull(ctx.userId),
			appId: ctx.appId,
			changes: Option.fromNullable(opts?.before && opts?.after ? Diff.create(opts.before, opts.after) : null),
			entityId,
			entityType,
			ipAddress: Option.getOrNull(ctx.ipAddress),
			operation,
			userAgent: Option.getOrNull(ctx.userAgent),
		};
		yield* repo.log(entry).pipe(
			Effect.tapBoth({
				onFailure: () =>
					audit.logFailure.pipe(
						Effect.flatMap((health) => ({ alerted: Effect.logError('AUDIT_ALERT', { consecutiveFailures: health.count, entityId }), degraded: Effect.logWarning('AUDIT_FAILURE', { entityId }), healthy: Effect.void })[health.state]),
						Effect.zipRight(Metric.update(metrics.audit.failures.pipe(Metric.tagged('entity_type', entityType), Metric.tagged('operation', operation)), 1)),
						Effect.zipRight(config.deadLetter.enabled ? FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.writeFileString(config.deadLetter.path, `${JSON.stringify({ ...entry, _failedAt: new Date().toISOString() })}\n`, { flag: 'a' })), Effect.ignore) : Effect.void),
					),
				onSuccess: () =>
					audit.logSuccess.pipe(Effect.zipRight(Metric.update(metrics.audit.writes.pipe(Metric.tagged('entity_type', entityType), Metric.tagged('operation', operation)), 1))),
			}),
			Effect.catchAll(() => Effect.void),
		);
	});

const Audit = { log } as const;

// --- [EXPORT] ----------------------------------------------------------------

export { Audit, AuditService };
