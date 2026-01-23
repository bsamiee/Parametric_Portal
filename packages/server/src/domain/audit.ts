/**
 * Log audit events with fail-open semantics.
 * Auto-extracts context from RequestContext; generates diffs when before/after provided.
 */
import { FileSystem } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Effect, Match, Metric, Option, Ref } from 'effect';
import { Tenant } from '../tenant.ts';
import { Diff } from '../utils/diff.ts';
import { MetricsService } from '../infra/metrics.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
	batch: { concurrency: 10 },
	deadLetter: { enabled: process.env['AUDIT_DEAD_LETTER_FILE'] !== undefined, path: process.env['AUDIT_DEAD_LETTER_FILE'] ?? '/tmp/audit-dead-letter.jsonl' },
	failures: { threshold: 5 },
} as const;

// --- [SERVICE] ---------------------------------------------------------------

class AuditService extends Effect.Service<AuditService>()('server/Audit', {
	dependencies: [DatabaseService.Default, MetricsService.Default],
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;
		const metrics = yield* MetricsService;
		const _health = yield* Ref.make<{ count: number; state: 'healthy' | 'degraded' | 'alerted' }>({ count: 0, state: 'healthy' });
		const _logFailure = Ref.updateAndGet(_health, (current) => {
			const count = current.count + 1;
			return { count, state: Match.value(count).pipe(Match.when((n) => n >= _config.failures.threshold, () => 'alerted' as const), Match.when((n) => n >= 2, () => 'degraded' as const), Match.orElse(() => 'healthy' as const)) };
		});
		const _logSuccess = Ref.update(_health, () => ({ count: 0, state: 'healthy' as const }));
		const log = (
			subject: string,
			subjectId: string,
			operation: string,
			opts?: { readonly after?: unknown; readonly before?: unknown },
		) =>
			Effect.gen(function* () {
				const ctx = yield* Tenant.Context;
				const entry = {
					appId: ctx.tenantId,
					changes: Option.fromNullable(opts?.before && opts?.after ? Diff.create(opts.before, opts.after) : undefined),
					ipAddress: ctx.ipAddress,
					operation,
					requestId: Option.some(ctx.requestId),
					subject,
					subjectId,
					userAgent: ctx.userAgent,
					userId: ctx.userId,
				};
				yield* db.audit.log(entry).pipe(
					Effect.tapBoth({
						onFailure: () =>
							_logFailure.pipe(
								Effect.flatMap((health) => ({ alerted: Effect.logError('AUDIT_ALERT', { consecutiveFailures: health.count, subjectId }), degraded: Effect.logWarning('AUDIT_FAILURE', { subjectId }), healthy: Effect.void })[health.state]),
								Effect.zipRight(Metric.update(metrics.audit.failures.pipe(Metric.tagged('subject', subject), Metric.tagged('operation', operation)), 1)),
								Effect.zipRight(_config.deadLetter.enabled ? FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.writeFileString(_config.deadLetter.path, `${JSON.stringify({ ...entry, changes: Option.getOrNull(entry.changes), requestId: Option.getOrNull(entry.requestId), userId: Option.getOrNull(entry.userId) })}\n`, { flag: 'a' })), Effect.tapError((err) => Effect.logWarning('Dead letter write failed', { error: String(err) })), Effect.ignore) : Effect.void),
							),
						onSuccess: () =>
							_logSuccess.pipe(Effect.zipRight(Metric.update(metrics.audit.writes.pipe(Metric.tagged('subject', subject), Metric.tagged('operation', operation)), 1))),
					}),
					Effect.catchAll(() => Effect.void),
				);
			});
		const getHealth = () => Ref.get(_health);
		return { getHealth, log };
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AuditService };
