/**
 * Polymorphic audit logging with operation-driven behavior inference.
 * Operation format: 'Subject.operation' (business) or 'operation' (security).
 * Single log() handles all audit scenarios; background fiber replays dead-letters.
 */
import { FileSystem } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Array as A, Clock, DateTime, Duration, Effect, Function as F, Option, Schedule, pipe } from 'effect';
import { Context } from '../context.ts';
import { Diff } from '../utils/diff.ts';
import { MetricsService } from './metrics.ts';
import { Telemetry } from './telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _Audit = (() => {
	const interval = Duration.minutes(5);
	return {
		deadLetter: { concurrency: 10, enabled: process.env['AUDIT_DEAD_LETTER_FILE'] !== undefined, interval, path: process.env['AUDIT_DEAD_LETTER_FILE'] ?? '/tmp/audit-dead-letter.jsonl' },
		schedule: pipe(Schedule.spaced(interval), Schedule.jittered),
		securityOps: new Set(['access_denied', 'auth_failure', 'mfa_required', 'permission_denied', 'rate_limited', 'token_invalid']) as ReadonlySet<string>,
	} as const;
})();

// --- [SERVICE] ---------------------------------------------------------------

class AuditService extends Effect.Service<AuditService>()('server/Audit', {
	scoped: Effect.gen(function* () {
		const db = yield* DatabaseService;
		const metrics = yield* MetricsService;
		const fs = yield* Effect.serviceOption(FileSystem.FileSystem);
		yield* Effect.when(
			Effect.logWarning('AUDIT_DEAD_LETTER_NO_FS', { message: 'Dead-letter enabled but FileSystem unavailable', path: _Audit.deadLetter.path }),
			() => _Audit.deadLetter.enabled && Option.isNone(fs),
		);
		yield* Effect.annotateLogsScoped({ 'audit.deadLetter.enabled': String(_Audit.deadLetter.enabled), 'service.name': 'audit' });
		const parseOp = (operation: string) => {
			const idx = operation.indexOf('.');
			const [subject, op] = idx > 0 ? [operation.slice(0, idx), operation.slice(idx + 1)] : ['security', operation];
			return { isSecurity: subject === 'security' && _Audit.securityOps.has(op), op, subject };
		};
		const serializeEntry = (entry: Record<string, unknown>, error: string, timestampMs: number) =>
			JSON.stringify({
				...entry,
				_error: error,
				_timestamp: DateTime.formatIso(DateTime.unsafeMake(timestampMs)),
				changes: pipe(entry['changes'] as Option.Option<unknown>, Option.getOrNull),
				requestId: pipe(entry['requestId'] as Option.Option<unknown>, Option.getOrNull),
				userId: pipe(entry['userId'] as Option.Option<unknown>, Option.getOrNull),
			});
		const writeDeadLetter = (entry: Record<string, unknown>, error: string, timestampMs: number) =>
			pipe(
				fs,
				Option.filter(() => _Audit.deadLetter.enabled),
				Option.match({
					onNone: () => Effect.void,
					onSome: (f) => pipe(
						f.writeFileString(_Audit.deadLetter.path, `${serializeEntry(entry, error, timestampMs)}\n`, { flag: 'a' }),
						Effect.catchAll((e) => Effect.logError('AUDIT_DEAD_LETTER_FAILED', { deadLetterError: String(e), originalError: error })),
					),
				}),
			);
		const computeChanges = (config?: { readonly before?: unknown; readonly after?: unknown; readonly details?: unknown }) =>
			pipe(
				Option.all({ after: Option.fromNullable(config?.after), before: Option.fromNullable(config?.before) }),
				Option.flatMap(({ after, before }) => Option.fromNullable(Diff.create(before, after))),
				Option.orElse(() => Option.fromNullable(config?.details)),
			);
		const log = (
			operation: string,
			config?: { readonly subjectId?: string; readonly before?: unknown; readonly after?: unknown; readonly details?: unknown; readonly silent?: boolean },
		) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const timestampMs = yield* Clock.currentTimeMillis;
				const parsed = parseOp(operation);
				const forceDeadLetter = parsed.isSecurity || !(config?.silent ?? false);
				const subjectId = config?.subjectId ?? (parsed.isSecurity ? ctx.requestId : Context.Request.Id.unspecified);
				const labels = MetricsService.label({ operation: parsed.op, subject: parsed.subject, tenant: ctx.tenantId });
				const entry = {
					appId: ctx.tenantId,
					changes: computeChanges(config),
					ipAddress: ctx.ipAddress,
					operation: parsed.op,
					requestId: pipe(ctx.requestId, Option.some),
					subject: parsed.subject,
					subjectId,
					timestamp: DateTime.formatIso(DateTime.unsafeMake(timestampMs)),
					userAgent: ctx.userAgent,
					userId: pipe(ctx.session, Option.map((s) => s.userId)),
				};
				yield* Effect.all([
					Effect.annotateCurrentSpan('audit.operation', parsed.op),
					Effect.annotateCurrentSpan('audit.subject', parsed.subject),
					Effect.annotateCurrentSpan('audit.subjectId', subjectId),
				], { discard: true });
				yield* pipe(
					db.audit.log(entry),
					Effect.tap(() => MetricsService.inc(metrics.audit.writes, labels, 1)),
					Effect.catchAll((dbError) => {
						const error = String(dbError);
						return Effect.all([
							Effect.logWarning('AUDIT_FAILURE', { error, isSecurity: parsed.isSecurity, operation: `${parsed.subject}.${parsed.op}`, subjectId }),
							MetricsService.inc(metrics.audit.failures, labels, 1),
							Effect.when(writeDeadLetter(entry, error, timestampMs), F.constant(forceDeadLetter)),
						], { discard: true });
					}),
				);
			}).pipe(Telemetry.span('audit.log'));
		const processLine = (line: string) =>
			pipe(
				Effect.try(() => JSON.parse(line) as Record<string, unknown>),
				Effect.option,
				Effect.flatMap(Option.match({
					onNone: () => Effect.succeed({ line, success: false as const }),
					onSome: (parsed) => {
						const { _error: _, _timestamp: __, ...entry } = parsed;
						return pipe(
							db.audit.log(entry as Parameters<typeof db.audit.log>[0]),
							Effect.as({ line: '', success: true as const }),
							Effect.orElseSucceed(() => ({ line, success: false as const })),
						);
					},
				})),
			);
		const replayFileContents = (fileSystem: FileSystem.FileSystem, tempPath: string) =>
			Effect.gen(function* () {
				const content = yield* pipe(fileSystem.readFileString(tempPath), Effect.orElseSucceed(() => ''));
				const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
				const results = yield* Effect.forEach(lines, processLine, { concurrency: _Audit.deadLetter.concurrency });
				const [successes, failures] = A.partition(results, (r) => r.success);
				const failedLines = pipe(failures, A.map((r) => r.line));
				yield* Effect.when(
					pipe(fileSystem.writeFileString(_Audit.deadLetter.path, `${failedLines.join('\n')}\n`, { flag: 'a' }), Effect.catchAll((e) => Effect.logError('Replay failure write failed', { error: String(e) }))),
					() => A.isNonEmptyArray(failedLines),
				);
				yield* pipe(fileSystem.remove(tempPath), Effect.ignore);
				yield* Effect.logInfo('Dead-letter replay completed', { failed: failures.length, replayed: successes.length });
				return { failed: failures.length, replayed: successes.length, skipped: false };
			});
		const replayDeadLetters = pipe(
			fs,
			Option.match({
				onNone: () => Effect.succeed({ failed: 0, replayed: 0, skipped: true }),
				onSome: (fileSystem) => Effect.if(_Audit.deadLetter.enabled, {
					onFalse: () => Effect.succeed({ failed: 0, replayed: 0, skipped: true }),
					onTrue: () => Effect.gen(function* () {
						const tempPath = `${_Audit.deadLetter.path}.processing`;
						const renamed = yield* pipe(fileSystem.rename(_Audit.deadLetter.path, tempPath), Effect.as(true), Effect.orElseSucceed(F.constFalse));
						return yield* Effect.if(renamed, {
							onFalse: F.constant(Effect.succeed({ failed: 0, replayed: 0, skipped: false })),
							onTrue: F.constant(replayFileContents(fileSystem, tempPath)),
						});
					}),
				}),
			}),
			Telemetry.span('audit.replayDeadLetters'),
		);
		yield* pipe(
			replayDeadLetters,
			Effect.repeat(_Audit.schedule),
			Effect.catchAll((e) => Effect.logError('Dead-letter replay fiber failed', { error: String(e) })),
			Effect.forkScoped,
		);
		yield* Effect.logInfo('AuditService initialized', { deadLetterEnabled: _Audit.deadLetter.enabled, replayInterval: Duration.format(_Audit.deadLetter.interval) });
		return { log, replayDeadLetters };
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AuditService };
