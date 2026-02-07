/**
 * Polymorphic audit logging with operation-driven behavior inference.
 * Single log() API handles business and security events with dead-letter replay.
 * PG18.1: Uses old_data/new_data columns for full before/after snapshots.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import type { JobDlq } from '@parametric-portal/database/models';
import { Array as A, Clock, DateTime, Duration, Effect, Option, pipe, Schedule, Schema as S } from 'effect';
import { ClusterService } from '../infra/cluster.ts';
import { Context } from '../context.ts';
import { MetricsService } from './metrics.ts';
import { Telemetry } from './telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	deadLetter: { concurrency: 10, interval: Duration.minutes(5) },
	securityOps: new Set(['access_denied', 'auth_failure', 'mfa_required', 'permission_denied', 'rate_limited', 'token_invalid']) as ReadonlySet<string>,
} as const;

// --- [SERVICES] --------------------------------------------------------------

class AuditService extends Effect.Service<AuditService>()('server/Audit', {
	scoped: Effect.gen(function* () {
		const database = yield* DatabaseService;
		const metrics = yield* MetricsService;
		yield* Effect.annotateLogsScoped({ 'service.name': 'audit' });
		const parseOp = (operationString: string) => {
			const index = operationString.indexOf('.');
			const [subject, operation] = index > 0 ? [operationString.slice(0, index), operationString.slice(index + 1)] : ['security', operationString];
			return { isSecurity: subject === 'security' && _CONFIG.securityOps.has(operation), operation, subject };
		};
		// PG18.1: Store full before/after snapshots instead of diffs. Callers pass RETURNING OLD.*/NEW.* data directly; details used for security events
		const computeOldData = (config?: { readonly before?: unknown; readonly details?: unknown }) => Option.fromNullable(config?.before).pipe(Option.orElse(() => Option.fromNullable(config?.details)));
		const computeNewData = (config?: { readonly after?: unknown }) => Option.fromNullable(config?.after);
		const writeDeadLetter = (entry: Record<string, unknown>, error: string, timestampMs: number, context: { readonly tenantId: string; readonly requestId: string; readonly userId: Option.Option<string> }) =>
			database.jobDlq.insert({
				appId: context.tenantId,
				attempts: 1,
				errorHistory: [{ error, timestamp: timestampMs }],
				errorReason: 'AuditPersistFailed',
				originalJobId: context.requestId,
				payload: entry,
				replayedAt: Option.none(),
				requestId: Option.some(context.requestId),
				source: 'event',
				type: `audit.${entry['subject']}.${entry['operation']}`,
				userId: context.userId,
			}).pipe(Effect.ignore);
		const log = (
			operationName: string,
			config?: { readonly subjectId?: string; readonly before?: unknown; readonly after?: unknown; readonly details?: unknown; readonly silent?: boolean },) =>
			Effect.gen(function* () {
				const context = yield* Context.Request.current;
				const timestampMs = yield* Clock.currentTimeMillis;
				const parsed = parseOp(operationName);
				const forceDeadLetter = parsed.isSecurity || !(config?.silent ?? false);
				const subjectId = config?.subjectId ?? (parsed.isSecurity ? context.requestId : Context.Request.Id.unspecified);
				const labels = MetricsService.label({ operation: parsed.operation, subject: parsed.subject, tenant: context.tenantId });
				const userId = pipe(context.session, Option.map((s) => s.userId));
				const dlqContext = { requestId: context.requestId, tenantId: context.tenantId, userId };
				// PG18.1: Store full before/after snapshots for compliance audit trail
				const entry = {
					appId: context.tenantId,
					ipAddress: context.ipAddress,
					newData: computeNewData(config),
					oldData: computeOldData(config),
					operation: parsed.operation,
					requestId: pipe(context.requestId, Option.some),
					subject: parsed.subject,
					subjectId,
					timestamp: DateTime.formatIso(DateTime.unsafeMake(timestampMs)),
					userAgent: context.userAgent,
					userId,
				};
				yield* Effect.all([
					Effect.annotateCurrentSpan('audit.operation', parsed.operation),
					Effect.annotateCurrentSpan('audit.subject', parsed.subject),
					Effect.annotateCurrentSpan('audit.subjectId', subjectId),
				], { discard: true });
				yield* pipe(
					database.audit.log(entry),
					Effect.tap(() => MetricsService.inc(metrics.audit.writes, labels, 1)),
					Effect.catchAll((databaseError) => Effect.all([
						Effect.logWarning('AUDIT_FAILURE', { error: String(databaseError), isSecurity: parsed.isSecurity, operation: `${parsed.subject}.${parsed.operation}`, subjectId }),
							MetricsService.inc(metrics.audit.failures, labels, 1),
						Effect.when(writeDeadLetter(entry, String(databaseError), timestampMs, dlqContext), () => forceDeadLetter),
					], { discard: true })),
				);
				}).pipe(Telemetry.span('audit.log', { metrics: false }));
		const replayDlqEntry = (dlq: typeof JobDlq.Type) => Effect.gen(function* () {
			const entry = yield* S.decodeUnknown(S.Record({ key: S.String, value: S.Unknown }))(dlq.payload);
			yield* database.audit.log(entry as Parameters<typeof database.audit.log>[0]);
			yield* database.jobDlq.markReplayed(dlq.id);
			return { id: dlq.id, success: true as const };
		}).pipe(Effect.catchAll((error) => Effect.logWarning('Audit DLQ replay failed', { dlqId: dlq.id, error: String(error) }).pipe(Effect.as({ id: dlq.id, success: false as const }))),);
		const replayDeadLetters = Effect.sync(Context.Request.system).pipe(
			Effect.flatMap((ctx) => Context.Request.within(
				Context.Request.Id.system,
					Telemetry.span(
						Effect.gen(function* () {
							const pending = yield* database.jobDlq.listPending({ limit: 100, type: 'audit.*' });
							const results = yield* Effect.forEach(pending.items, replayDlqEntry, { concurrency: _CONFIG.deadLetter.concurrency });
							const [failures, successes] = A.partition(results, (r) => r.success);
							yield* Effect.when(Effect.logInfo('Audit dead-letter replay completed', { failed: failures.length, replayed: successes.length }), () => results.length > 0);
							return { failed: failures.length, replayed: successes.length, skipped: pending.items.length === 0 };
						}),
						'audit.replayDeadLetters',
						{ metrics: false },
					),
					ctx,
				)),
			);
		yield* Effect.logInfo('AuditService initialized');
		return { log, replayDeadLetters };
	}),
}) {
	static readonly ReplayLayer = ClusterService.Schedule.singleton(	// Cluster-wide singleton for replay: prevents thundering herd across pods
		'audit-dlq-replay',
		() => Effect.gen(function* () {
			const audit = yield* AuditService;
			yield* audit.replayDeadLetters.pipe(
				Effect.repeat(pipe(Schedule.spaced(_CONFIG.deadLetter.interval), Schedule.jittered)),
				Effect.catchAll((error) => Effect.logError('Audit DLQ replay failed', { error: String(error) })),
			);
		}),
	);
}

// --- [EXPORT] ----------------------------------------------------------------

export { AuditService };
