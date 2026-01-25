/**
 * Log audit events with fail-open semantics.
 * Auto-extracts context from RequestContext; generates diffs when before/after provided.
 */
import { FileSystem } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Effect, Option } from 'effect';
import { Context } from '../context.ts';
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
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;
		const metrics = yield* MetricsService;
		const _labels = (subject: string, operation: string) => MetricsService.label({ operation, subject, tenant: '' });
		const log = (
			subject: string,
			subjectId: string,
			operation: string,
			opts?: { readonly after?: unknown; readonly before?: unknown },) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const userId = Option.match(ctx.session, { onNone: () => Option.none<string>(), onSome: (s) => Option.some(s.userId) });
				const entry = {
					appId: ctx.tenantId,
					changes: Option.fromNullable(opts?.before && opts?.after ? Diff.create(opts.before, opts.after) : undefined),
					ipAddress: ctx.ipAddress,
					operation,
					requestId: Option.some(ctx.requestId),
					subject,
					subjectId,
					userAgent: ctx.userAgent,
					userId,
				};
				yield* db.audit.log(entry).pipe(
					Effect.tap(() => MetricsService.inc(metrics.audit.writes, _labels(subject, operation), 1)),
					Effect.catchAll((dbError) =>
						Effect.all([
							Effect.logWarning('AUDIT_FAILURE', { error: String(dbError), subject, subjectId }),
							MetricsService.inc(metrics.audit.failures, _labels(subject, operation), 1),
							_config.deadLetter.enabled
								? FileSystem.FileSystem.pipe(
										Effect.flatMap((fs) =>
											fs.writeFileString(
												_config.deadLetter.path,
												`${JSON.stringify({ ...entry, _error: String(dbError), changes: Option.getOrNull(entry.changes), requestId: Option.getOrNull(entry.requestId), userId: Option.getOrNull(entry.userId) })}\n`,
												{ flag: 'a' },
											),
										),
										Effect.catchAll((deadLetterErr) =>
											Effect.logError('AUDIT_DEAD_LETTER_FAILED', { deadLetterError: String(deadLetterErr), originalError: String(dbError), subjectId }),
										),
									)
								: Effect.void,
						], { discard: true }),
					),
				);
			});
		return { log };
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AuditService };
