/**
 * Polymorphic audit logging with operation-driven behavior inference.
 * Operation format: 'Subject.operation' (business) or 'operation' (security).
 * Single log() handles all audit scenarios; background fiber replays dead-letters.
 */
import { FileSystem } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Array as A, DateTime, Duration, Effect, Option, Schedule, Tuple, pipe } from 'effect';
import { Context } from '../context.ts';
import { Diff } from '../utils/diff.ts';
import { MetricsService } from './metrics.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
	deadLetter: {
		enabled: process.env['AUDIT_DEAD_LETTER_FILE'] !== undefined,
		path: process.env['AUDIT_DEAD_LETTER_FILE'] ?? '/tmp/audit-dead-letter.jsonl',
		replay: { concurrency: 10, interval: Duration.minutes(5) },
	},
} as const;
const _securityOps = new Set(['access_denied', 'auth_failure', 'mfa_required', 'permission_denied', 'rate_limited', 'token_invalid']);

// --- [FUNCTIONS] -------------------------------------------------------------

const _parseOperation = (operation: string) =>
	pipe(
		Option.liftPredicate((s: string) => !!s && s.trim() === s && !s.startsWith('.') && !s.endsWith('.'))(operation),
		Option.map((s) => {
			const idx = s.indexOf('.');
			const [subject, op] = idx > 0 ? [s.slice(0, idx), s.slice(idx + 1)] : ['security', s];
			return { isSecurity: subject === 'security' && _securityOps.has(op), op, subject, valid: true as const };
		}),
		Option.getOrElse(() => ({ isSecurity: false, op: operation || '<empty>', subject: '<invalid>', valid: false as const })),
	);
const _serializeEntry = (entry: Record<string, unknown>, error: string) =>
	JSON.stringify({
		...entry,
		_error: error,
		_timestamp: DateTime.unsafeNow(),
		changes: Option.isOption(entry['changes']) ? Option.getOrNull(entry['changes']) : entry['changes'],
		requestId: Option.isOption(entry['requestId']) ? Option.getOrNull(entry['requestId']) : entry['requestId'],
		userId: Option.isOption(entry['userId']) ? Option.getOrNull(entry['userId']) : entry['userId'],
	});

// --- [SERVICE] ---------------------------------------------------------------

class AuditService extends Effect.Service<AuditService>()('server/Audit', {
	scoped: Effect.gen(function* () {
		const db = yield* DatabaseService;
		const metrics = yield* MetricsService;
		const fs = yield* Effect.serviceOption(FileSystem.FileSystem);
		yield* Effect.when(
			Effect.logWarning('AUDIT_DEAD_LETTER_NO_FS', { message: 'Dead-letter enabled but FileSystem unavailable', path: _config.deadLetter.path }),
			() => _config.deadLetter.enabled && Option.isNone(fs),
		);
		const writeDeadLetter = (entry: Record<string, unknown>, error: string) =>
			fs.pipe(Option.filter(() => _config.deadLetter.enabled), Option.match({
				onNone: () => Effect.void,
				onSome: (f) => f.writeFileString(_config.deadLetter.path, `${_serializeEntry(entry, error)}\n`, { flag: 'a' }).pipe(
					Effect.catchAll((e) => Effect.logError('AUDIT_DEAD_LETTER_FAILED', { deadLetterError: String(e), originalError: error })),
				),
			}));
		const handleFailure = (entry: Record<string, unknown>, parsed: ReturnType<typeof _parseOperation>, forceDeadLetter: boolean) =>
			(dbError: unknown) => {
				const error = String(dbError);
				const labels = MetricsService.label({ operation: parsed.op, subject: parsed.subject, tenant: String(entry['appId']) });
				return Effect.all([
					Effect.logWarning('AUDIT_FAILURE', { error, isSecurity: parsed.isSecurity, operation: `${parsed.subject}.${parsed.op}`, subjectId: entry['subjectId'] }),
					MetricsService.inc(metrics.audit.failures, labels, 1),
					forceDeadLetter ? writeDeadLetter(entry, error) : Effect.void,
				], { discard: true });
			};
		const log = Effect.fn('audit.log')((
			operation: string,
			config?: { readonly subjectId?: string; readonly before?: unknown; readonly after?: unknown; readonly details?: unknown; readonly silent?: boolean },
		) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const parsed = _parseOperation(operation);
				yield* Effect.when(
					Effect.logWarning('AUDIT_INVALID_OPERATION', { operation, reason: 'Malformed operation string', requestId: ctx.requestId }),
					() => !parsed.valid,
				);
				const forceDeadLetter = parsed.isSecurity || !(config?.silent ?? false);
				const subjectId = config?.subjectId ?? (parsed.isSecurity ? ctx.requestId : Context.Request.Id.unspecified);
				yield* Effect.when(
					Effect.logWarning('AUDIT_MISSING_SUBJECT_ID', { fallback: Context.Request.Id.unspecified, operation: `${parsed.subject}.${parsed.op}`, requestId: ctx.requestId }),
					() => !parsed.isSecurity && !config?.subjectId,
				);
				const labels = MetricsService.label({ operation: parsed.op, subject: parsed.subject, tenant: ctx.tenantId });
				const entry = {
					appId: ctx.tenantId,
					changes: Option.fromNullable(config?.before !== undefined && config?.after !== undefined ? Diff.create(config.before, config.after) : (config?.details ?? null)),
					ipAddress: ctx.ipAddress,
					operation: parsed.op,
					requestId: pipe(ctx.requestId, Option.some),
					subject: parsed.subject,
					subjectId,
					timestamp: DateTime.unsafeNow(),
					userAgent: ctx.userAgent,
					userId: ctx.session.pipe(Option.map((s) => s.userId)),
				};
				yield* Effect.annotateCurrentSpan('audit.subject', parsed.subject);
				yield* Effect.annotateCurrentSpan('audit.operation', parsed.op);
				yield* Effect.annotateCurrentSpan('audit.subjectId', subjectId);
				yield* db.audit.log(entry).pipe(
					Effect.tap(() => MetricsService.inc(metrics.audit.writes, labels, 1)),
					Effect.catchAll(handleFailure(entry, parsed, forceDeadLetter)),
				);
			}));
		// Stream-based dead-letter replay: atomic rename → stream lines → batch insert → write failures back
		type ReplayResult = { readonly failed: number; readonly replayed: number; readonly skipped: boolean };
		const _noOp = (skipped: boolean): ReplayResult => ({ failed: 0, replayed: 0, skipped });
		const _processLine = (line: string) =>
			Effect.gen(function* () {
				const parsed = yield* Effect.try(() => JSON.parse(line) as Record<string, unknown> | null).pipe(Effect.orElseSucceed(() => null));
				if (parsed === null) return Tuple.make(false, line);
				const { _error: _, _timestamp: __, ...entry } = parsed;
				const success = yield* db.audit.log(entry as Parameters<typeof db.audit.log>[0]).pipe(Effect.as(true), Effect.catchAll(() => Effect.succeed(false)));
				return Tuple.make(success, success ? '' : line);
			});
		const replayDeadLetters: Effect.Effect<ReplayResult> = Effect.gen(function* () {
			if (Option.isNone(fs) || !_config.deadLetter.enabled) return _noOp(true);
			const fileSystem = fs.value;
			const { path } = _config.deadLetter;
			const tempPath = `${path}.processing`;
			const renamed = yield* fileSystem.rename(path, tempPath).pipe(Effect.as(true), Effect.catchAll(() => Effect.succeed(false)));
			if (!renamed) return _noOp(false);
			const content = yield* fileSystem.readFileString(tempPath).pipe(Effect.catchAll(() => Effect.succeed('')));
			const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
			const results = yield* Effect.forEach(lines, _processLine, { concurrency: _config.deadLetter.replay.concurrency });
			const [failures, successes] = A.partition(results, (r) => r[0]);
			if (failures.length > 0) {
				const failedLines = failures.map(([, l]) => l).join('\n');
				yield* fileSystem.writeFileString(path, `${failedLines}\n`, { flag: 'a' }).pipe(
					Effect.catchAll((e) => Effect.logError('Replay failure write failed', { error: String(e) })),
				);
			}
			yield* fileSystem.remove(tempPath).pipe(Effect.ignore);
			yield* Effect.logInfo('Dead-letter replay completed', { failed: failures.length, replayed: successes.length });
			return { failed: failures.length, replayed: successes.length, skipped: false };
		}).pipe(Effect.withSpan('audit.replayDeadLetters'));
		// Background replay fiber: runs periodically with jitter to prevent thundering herd
		yield* replayDeadLetters.pipe(
			Effect.repeat(Schedule.spaced(_config.deadLetter.replay.interval).pipe(Schedule.jittered)),
			Effect.catchAll((e) => Effect.logError('Dead-letter replay fiber failed', { error: String(e) })),
			Effect.forkScoped,
		);
		yield* Effect.logInfo('AuditService initialized', { deadLetterEnabled: _config.deadLetter.enabled, replayInterval: Duration.toMillis(_config.deadLetter.replay.interval) });
		return { log, replayDeadLetters };
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AuditService };
