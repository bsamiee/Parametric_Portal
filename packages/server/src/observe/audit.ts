/**
 * Polymorphic audit logging with operation-driven behavior inference.
 * Single log() API handles business and security events with dead-letter replay.
 * PG18.1: Uses old_data/new_data columns for full before/after snapshots.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import type { JobDlq } from '@parametric-portal/database/models';
import { Array as A, Clock, DateTime, Effect, Option, pipe, Schema as S, Struct } from 'effect';
import { constant } from 'effect/Function';
import { Context } from '../context.ts';
import { MetricsService } from './metrics.ts';
import { Telemetry } from './telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _SECURITY_OPS = new Set(['access_denied', 'auth_failure', 'mfa_required', 'permission_denied', 'rate_limited', 'token_invalid']) as ReadonlySet<string>;

// --- [SERVICES] --------------------------------------------------------------

class AuditService extends Effect.Service<AuditService>()('server/Audit', {
	scoped: Effect.gen(function* () {
		const database = yield* DatabaseService;
		const metrics = yield* MetricsService;
		yield* Effect.annotateLogsScoped({ 'service.name': 'audit' });
		const writeDeadLetter = (entry: Record<string, unknown>, error: string, timestampMs: number, context: { readonly tenantId: string; readonly requestId: string; readonly userId: Option.Option<string> }) =>
			database.jobDlq.insert({ appId: context.tenantId, attempts: 1, errorHistory: [{ error, timestamp: timestampMs }], errorReason: 'AuditPersistFailed', originalJobId: context.requestId, payload: entry, replayedAt: Option.none(), requestId: Option.some(context.requestId), source: 'event', type: `audit.${entry['subject']}.${entry['operation']}`, userId: context.userId }).pipe(Effect.ignore);
		const log = (
			operationName: string,
			config?: { readonly subjectId?: string; readonly before?: unknown; readonly after?: unknown; readonly details?: unknown; readonly silent?: boolean },) => Effect.gen(function* () {
			const context = yield* Context.Request.current;
			const timestampMs = yield* Clock.currentTimeMillis;
			const index = operationName.indexOf('.');
			const [subject, operation] = index > 0 ? [operationName.slice(0, index), operationName.slice(index + 1)] : ['security', operationName];
			const isSecurity = subject === 'security' && _SECURITY_OPS.has(operation);
			const forceDeadLetter = isSecurity || !(config?.silent ?? false);
			const subjectId = config?.subjectId ?? (isSecurity ? context.requestId : Context.Request.Id.unspecified);
			const labels = MetricsService.label({ operation, subject, tenant: context.tenantId });
			const userId = pipe(context.session, Option.map((s) => s.userId));
			const dlqContext = { requestId: context.requestId, tenantId: context.tenantId, userId };
			const entry = {
				appId: context.tenantId, ipAddress: context.ipAddress,
				newData: Option.fromNullable(config?.after),
				oldData: Option.fromNullable(config?.before).pipe(Option.orElse(() => Option.fromNullable(config?.details))),
				operation, requestId: pipe(context.requestId, Option.some), subject, subjectId,
				timestamp: DateTime.formatIso(DateTime.unsafeMake(timestampMs)), userAgent: context.userAgent, userId,
			};
			yield* Effect.all([Effect.annotateCurrentSpan('audit.operation', operation), Effect.annotateCurrentSpan('audit.subject', subject), Effect.annotateCurrentSpan('audit.subjectId', subjectId)], { discard: true });
			yield* pipe(
				database.audit.log(entry),
				Effect.tap(MetricsService.inc(metrics.audit.writes, labels, 1)),
				Effect.catchAll((databaseError) => Effect.all([
					Effect.logWarning('AUDIT_FAILURE', { error: String(databaseError), isSecurity, operation: `${subject}.${operation}`, subjectId }),
					MetricsService.inc(metrics.audit.failures, labels, 1),
						Effect.when(writeDeadLetter(entry, String(databaseError), timestampMs, dlqContext), constant(forceDeadLetter)),
				], { discard: true })),
			);
		}).pipe(Telemetry.span('audit.log', { metrics: false }));
		const replayDlqEntry = (dlq: JobDlq) => Effect.gen(function* () {
			const entry = yield* S.decodeUnknown(S.Record({ key: S.String, value: S.Unknown }))(dlq.payload);
			yield* database.audit.log(entry as Parameters<typeof database.audit.log>[0]);
			yield* database.jobDlq.markReplayed(dlq.id);
			return { id: dlq.id, success: true as const };
		}).pipe(Effect.catchAll((error) => Effect.logWarning('Audit DLQ replay failed', { dlqId: dlq.id, error: String(error) }).pipe(Effect.as({ id: dlq.id, success: false as const }))));
		const replayDeadLetters = Effect.sync(Context.Request.system).pipe(
			Effect.flatMap((ctx) => Context.Request.within(Context.Request.Id.system, Telemetry.span(
				Effect.gen(function* () {
					const pending = yield* database.jobDlq.listPending({ limit: 100, type: 'audit.*' });
					const results = yield* Effect.forEach(pending.items, replayDlqEntry, { concurrency: 10 });
					const [failures, successes] = A.partition(results, Struct.get('success'));
					yield* Effect.when(Effect.logInfo('Audit dead-letter replay completed', { failed: failures.length, replayed: successes.length }), constant(results.length > 0));
					return { failed: failures.length, replayed: successes.length, skipped: pending.items.length === 0 };
				}), 'audit.replayDeadLetters', { metrics: false }), ctx)),
		);
		yield* Effect.logInfo('AuditService initialized');
		return { log, replayDeadLetters };
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AuditService };
