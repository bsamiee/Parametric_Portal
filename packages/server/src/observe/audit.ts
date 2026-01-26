/**
 * Polymorphic audit logging with operation-driven behavior inference.
 * Operation format: 'Subject.operation' (business) or 'operation' (security).
 * Single log() function handles all audit scenarios via smart defaults.
 */
import { FileSystem } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { DateTime, Effect, Option, pipe } from 'effect';
import { Context } from '../context.ts';
import { Diff } from '../utils/diff.ts';
import { MetricsService } from './metrics.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
	deadLetter: {
		enabled: process.env['AUDIT_DEAD_LETTER_FILE'] !== undefined,
		path: process.env['AUDIT_DEAD_LETTER_FILE'] ?? '/tmp/audit-dead-letter.jsonl',
	},
} as const;
const _securityOps = {	// CRITICAL: Security events ALWAYS persist to dead-letter on DB failure. These are forensically important during attacks when DB may be under load.
	access_denied: true,
	auth_failure: true,
	mfa_required: true,
	permission_denied: true,
	rate_limited: true,
	token_invalid: true,
} as const satisfies Record<string, true>;

// --- [FUNCTIONS] -------------------------------------------------------------

const _parseOperation = (operation: string): { isSecurity: boolean; op: string; subject: string; valid: boolean } =>
	pipe(
		Option.liftPredicate((s: string) => !!s && s.trim() === s && !s.startsWith('.') && !s.endsWith('.'))(operation),
		Option.map((s) => {
			const idx = s.indexOf('.');
			const [subject, op] = idx > 0 ? [s.slice(0, idx), s.slice(idx + 1)] : ['security', s];
			return { isSecurity: subject === 'security' && op in _securityOps, op, subject, valid: true as const };
		}),
		Option.getOrElse(() => ({ isSecurity: false, op: operation || '<empty>', subject: '<invalid>', valid: false as const })),
	);

// --- [SERVICE] ---------------------------------------------------------------

class AuditService extends Effect.Service<AuditService>()('server/Audit', {
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;
		const metrics = yield* MetricsService;
		const fs = yield* Effect.serviceOption(FileSystem.FileSystem);
		yield* Effect.when(
			Effect.logWarning('AUDIT_DEAD_LETTER_NO_FS', {
				message: 'Dead-letter enabled but FileSystem service not available',
				path: _config.deadLetter.path,
			}),
			() => _config.deadLetter.enabled && Option.isNone(fs),
		);
		const writeDeadLetter = (entry: Record<string, unknown>, error: string) =>
			pipe(
				fs,
				Option.filter(() => _config.deadLetter.enabled),
				Option.match({
					onNone: () => Effect.void,
					onSome: (f) => f.writeFileString(
						_config.deadLetter.path,
						`${JSON.stringify({
							...entry,
							_error: error,
							_timestamp: DateTime.unsafeNow(),
							changes: Option.isOption(entry['changes']) ? Option.getOrNull(entry['changes']) : entry['changes'],
							requestId: Option.isOption(entry['requestId']) ? Option.getOrNull(entry['requestId']) : entry['requestId'],
							userId: Option.isOption(entry['userId']) ? Option.getOrNull(entry['userId']) : entry['userId'],
						})}\n`,
						{ flag: 'a' },
					).pipe(
						Effect.catchAll((e) => Effect.logError('AUDIT_DEAD_LETTER_FAILED', {
							deadLetterError: String(e),
							originalError: error,
						})),
					),
				}),
			);
		const handleFailure = (
			entry: Record<string, unknown>,
			parsed: ReturnType<typeof _parseOperation>,
			forceDeadLetter: boolean,) => (dbError: unknown) => {
			const error = String(dbError);
			const labels = MetricsService.label({
				operation: parsed.op,
				subject: parsed.subject,
				tenant: String(entry['appId']),
			});
			return Effect.all([
				Effect.logWarning('AUDIT_FAILURE', {
					error,
					isSecurity: parsed.isSecurity,
					operation: `${parsed.subject}.${parsed.op}`,
					subjectId: entry['subjectId'],
				}),
				MetricsService.inc(metrics.audit.failures, labels, 1),
				forceDeadLetter ? writeDeadLetter(entry, error) : Effect.void,
			], { discard: true });
		};
		const log = Effect.fn('audit.log')((
			operation: string,
			config?: {
				readonly subjectId?: string;
				readonly before?: unknown;
				readonly after?: unknown;
				readonly details?: unknown;
				readonly silent?: boolean;
			},
		) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const parsed = _parseOperation(operation);
				yield* Effect.when(
					Effect.logWarning('AUDIT_INVALID_OPERATION', {
						operation,
						reason: 'Malformed operation string (empty, whitespace, or starts/ends with dot)',
						requestId: ctx.requestId,
					}),
					() => !parsed.valid,
				);
				const forceDeadLetter = parsed.isSecurity || !(config?.silent ?? false);
				const subjectId = config?.subjectId ?? (parsed.isSecurity ? ctx.requestId : Context.Request.Id.unspecified);
				yield* Effect.when(
					Effect.logWarning('AUDIT_MISSING_SUBJECT_ID', {
						fallback: Context.Request.Id.unspecified,
						operation: `${parsed.subject}.${parsed.op}`,
						requestId: ctx.requestId,
					}),
					() => !parsed.isSecurity && !config?.subjectId,
				);
				const labels = MetricsService.label({
					operation: parsed.op,
					subject: parsed.subject,
					tenant: ctx.tenantId,
				});
				const entry = {
					appId: ctx.tenantId,
					changes: Option.fromNullable(
						config?.before !== undefined && config?.after !== undefined
							? Diff.create(config.before, config.after)
							: (config?.details ?? null),
					),
					ipAddress: ctx.ipAddress,
					operation: parsed.op,
					requestId: Option.some(ctx.requestId),
					subject: parsed.subject,
					subjectId,
					timestamp: DateTime.unsafeNow(),
					userAgent: ctx.userAgent,
					userId: Option.flatMap(ctx.session, (s) => Option.some(s.userId)),
				};
				yield* Effect.annotateCurrentSpan('audit.subject', parsed.subject);
				yield* Effect.annotateCurrentSpan('audit.operation', parsed.op);
				yield* Effect.annotateCurrentSpan('audit.subjectId', subjectId);
				yield* db.audit.log(entry).pipe(
					Effect.tap(() => MetricsService.inc(metrics.audit.writes, labels, 1)),
					Effect.catchAll(handleFailure(entry, parsed, forceDeadLetter)),
				);
			}));
		return { log };
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AuditService };
