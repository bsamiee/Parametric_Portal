/**
 * Background job processing with database-backed queue.
 * SELECT FOR UPDATE SKIP LOCKED for atomic claim; Circuit breaker resilience; graceful shutdown.
 * Effect APIs: Semaphore (concurrency), Match.value (transitions), Schedule.spaced (polling).
 * [ARCHITECTURE] Hybrid Service Design:
 * JobService combines job orchestration (enqueue, process, retry) with real-time event streaming
 * (onStatusChange via pg.listen). PgClient access justified: events are internal to job processing.
 * Consumers: routes/jobs.ts exposes onStatusChange() via SSE for real-time job dashboards.
 */
import { PgClient } from '@effect/sql-pg';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Duration, Effect, Function as F, HashMap, Match, Metric, Option, pipe, Ref, Schedule, Schema as S, Stream } from 'effect';
import { AuditService } from '../observe/audit.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Circuit } from '../utils/circuit.ts';
import { Context } from '../context.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const JobStatusEvent = S.Struct({
	appId: S.UUID,
	jobId: S.UUID,
	previousStatus: S.String,
	status: S.String,
	timestamp: S.Number,
	type: S.String,
});

// --- [CONSTANTS] -------------------------------------------------------------

const B = {
	batch: { concurrency: 5, size: 10 },
	breaker: { halfOpen: Duration.seconds(30), threshold: 5 },
	lock: { minutes: 5 },
	poll: { busy: Duration.seconds(1), idle: Duration.seconds(10) },
	retry: { base: Duration.seconds(1), cap: Duration.minutes(10), factor: 2 },
	shutdown: { interval: Duration.millis(100), maxWait: 50 },
	timeout: Duration.minutes(5),
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _delay = (attempt: number) => pipe(
	Duration.times(B.retry.base, B.retry.factor ** attempt),
	Duration.min(B.retry.cap),
	Duration.toMillis,
	(ms) => Math.round(ms * (0.8 + Math.random() * 0.4)),
);

// --- [SERVICE] ---------------------------------------------------------------

class JobService extends Effect.Service<JobService>()('server/Jobs', {
	scoped: Effect.gen(function* () {
		const [db, pg, metrics, audit] = yield* Effect.all([DatabaseService, PgClient.PgClient, MetricsService, AuditService]);
		const workerId = crypto.randomUUID();
		yield* Effect.annotateLogsScoped({ 'service.name': 'jobs', 'worker.id': workerId });
		type DbJob = Effect.Effect.Success<ReturnType<typeof db.jobs.claimBatch>>[number];
		type _Result = 'complete' | { readonly retry: { attempt: number; delayMs: number; error: unknown } } | { readonly dead: string };
		const handlers = yield* Ref.make(HashMap.empty<string, (payload: unknown) => Effect.Effect<void, unknown, never>>());
		const semaphore = yield* Effect.makeSemaphore(B.batch.concurrency);
		const inFlight = yield* Ref.make(0);
		const circuit = Circuit.make('jobs-db', { breaker: { _tag: 'consecutive', threshold: B.breaker.threshold }, halfOpenAfter: B.breaker.halfOpen });
		const run = <A, E>(eff: Effect.Effect<A, E>) => circuit.execute(eff);
		const _transition = (job: DbJob, result: _Result) =>
			Match.value(result).pipe(
				Match.when('complete', () => run(db.jobs.complete(job.id)).pipe(
					Effect.tap(() => Effect.all([
						MetricsService.inc(metrics.jobs.completions, MetricsService.label({ type: job.type }), 1),
						audit.log('Job.complete', { details: { type: job.type }, subjectId: job.id }),
					], { discard: true })),
					Telemetry.span('jobs.complete', { 'job.id': job.id, 'job.type': job.type }),
				)),
				Match.when({ retry: Match.any }, ({ retry }) => run(db.jobs.retry(job.id, {
					attempts: retry.attempt, lastError: String(retry.error), scheduledAt: new Date(Date.now() + retry.delayMs),
				})).pipe(
					Effect.tap(() => Effect.all([
						MetricsService.inc(metrics.jobs.failures, MetricsService.label({ type: job.type }), 1),
						MetricsService.inc(metrics.jobs.retries, MetricsService.label({ type: job.type }), 1),
						audit.log('Job.retry', { details: { attempt: retry.attempt, delayMs: retry.delayMs, type: job.type }, subjectId: job.id }),
					], { discard: true })),
					Telemetry.span('jobs.retry', { 'job.attempts': job.attempts, 'job.id': job.id, 'job.type': job.type }),
				)),
				Match.when({ dead: Match.string }, ({ dead }) => run(db.jobs.deadLetter(job.id, dead)).pipe(
					Effect.tap(() => Effect.all([
						MetricsService.inc(metrics.jobs.deadLettered, MetricsService.label({ type: job.type }), 1),
						Effect.logError('Dead letter', { attempts: job.attempts, error: dead, jobId: job.id, type: job.type }),
						audit.log('Job.dead_letter', { details: { attempts: job.attempts, error: dead, type: job.type }, subjectId: job.id }),
					], { discard: true })),
					Telemetry.span('jobs.deadLetter', { 'job.attempts': job.attempts, 'job.id': job.id, 'job.type': job.type }),
				)),
				Match.exhaustive,
			);
		const process = (job: DbJob) => {
			const map$ = Ref.get(handlers);
			const requestId = Option.getOrElse(job.requestId, () => crypto.randomUUID());
			const userId = Option.getOrUndefined(job.userId);
			const sessionFromJob = (job.userId).pipe(Option.map((uid) => ({ id: Context.Request.Id.job, mfaEnabled: false, userId: uid, verifiedAt: Option.none<Date>() })));
			const ctx: Partial<Context.Request.Data> = { ipAddress: Option.none(), requestId, session: sessionFromJob, userAgent: Option.none() };
			const serializable = new Context.Serializable({ requestId, sessionId: Context.Request.Id.job, tenantId: job.appId, userId });
			const labels = MetricsService.label({ tenant: job.appId, type: job.type });
			const trackWait = Option.match(job.waitMs, {
				onNone: () => Effect.void,
				onSome: (ms) => Metric.update(Metric.taggedWithLabels(metrics.jobs.waitDuration, labels), Duration.millis(ms)),
			});
			const noHandler = Effect.logWarning('No handler', { jobId: job.id, type: job.type }).pipe(Effect.andThen(_transition(job, { dead: 'No handler' })));
			const runHandler = (fn: (payload: unknown) => Effect.Effect<void, unknown, never>) =>
				fn(job.payload).pipe(
					Effect.timeoutFail({ duration: B.timeout, onTimeout: () => `Timeout ${Duration.toMillis(B.timeout)}ms` }),
					Metric.trackDuration(Metric.taggedWithLabels(metrics.jobs.duration, labels)),
					Effect.matchEffect({
						onFailure: (e) => _transition(job,
							job.attempts + 1 >= job.maxAttempts
								? { dead: String(e) }
								: { retry: { attempt: job.attempts + 1, delayMs: _delay(job.attempts + 1), error: e } },
						),
						onSuccess: () => _transition(job, 'complete'),
					}),
				);
			return Ref.update(inFlight, (n) => n + 1).pipe(
				Effect.andThen(map$),
				Effect.map((map) => HashMap.get(map, job.type)),
				Effect.andThen((handler) => Context.Request.withinSync(job.appId, trackWait.pipe(Effect.andThen(Option.match(handler, { onNone: () => noHandler, onSome: runHandler }))), ctx)),
				Effect.ensuring(Ref.update(inFlight, (n) => n - 1)),
				Effect.catchAll((e) => {
					const tag = MetricsService.errorTag(e);
					return Effect.logError('Process failed', { error: String(e), errorTag: tag, jobId: job.id, type: job.type }).pipe(
						Effect.andThen(MetricsService.inc(metrics.jobs.failures, MetricsService.label({ errorTag: tag, type: job.type }), 1)),
					);
				}),
				Telemetry.span('jobs.process', { 'job.id': job.id, 'job.type': job.type, 'trace.requestId': serializable.requestId, 'trace.tenantId': serializable.tenantId, 'trace.userId': serializable.userId }),
			);
		};
		const poll = run(db.jobs.claimBatch(workerId, B.batch.size, B.lock.minutes)).pipe(
			Effect.tap((jobs) => jobs.length > 0 ? Effect.logDebug('Claimed', { count: jobs.length, workerId }) : Effect.void),
			Effect.catchAll((e) => Effect.all([
				Effect.logWarning('Claim failed', { error: String(e) }),
				MetricsService.inc(metrics.jobs.failures, MetricsService.label({ type: 'claim' }), 1),
			], { discard: true }).pipe(Effect.as([] as DbJob[]))),
			Effect.tap((jobs) => Effect.forEach(jobs, (job) => semaphore.withPermits(1)(process(job)), { concurrency: 'unbounded' })),
			Effect.map((jobs) => jobs.length),
			Telemetry.span('jobs.poll', { 'batch.concurrency': B.batch.concurrency, 'batch.size': B.batch.size, 'worker.id': workerId }),
		);
		const pollSchedule = Schedule.identity<number>().pipe(
			Schedule.addDelay((count) => Match.value(count > 0).pipe(
				Match.when(true, () => B.poll.busy),
				Match.orElse(() => B.poll.idle),
			)),
		);
		const shutdown = Effect.gen(function* () {
			yield* Effect.logInfo('Shutting down', { workerId });
			yield* Ref.get(inFlight).pipe(
				Effect.filterOrFail((n) => n === 0, () => 'waiting'),
				Effect.retry(Schedule.spaced(B.shutdown.interval).pipe(Schedule.intersect(Schedule.recurs(B.shutdown.maxWait)))),
				Effect.ignore,
			);
			const remaining = yield* Ref.get(inFlight);
			yield* remaining > 0 ? Effect.logWarning('Shutdown with in-flight', { count: remaining, workerId }) : Effect.logInfo('Shutdown complete', { workerId });
		});
		yield* Effect.logInfo('Starting', { workerId });
		yield* Effect.addFinalizer(() => shutdown);
		yield* poll.pipe(Effect.repeat(pollSchedule), Effect.forkScoped);
		const enqueue = <T>(type: string, payloads: T | readonly T[], opts?: { delay?: Duration.Duration; maxAttempts?: number; priority?: 'critical' | 'high' | 'low' | 'normal' }) =>
			Effect.gen(function* () {
				const isBatch = Array.isArray(payloads);
				const items = isBatch ? payloads : [payloads];
				const priority = opts?.priority ?? 'normal';
				const maxAttempts = opts?.maxAttempts ?? 5;
				const ctx = yield* Context.Request.current;
				const userId = ctx.session.pipe(Option.map((s) => s.userId));
				const inserted = yield* run(db.jobs.put(items.map((payload) => ({
					appId: ctx.tenantId, attempts: 0, lastError: Option.none(), lockedBy: Option.none(), lockedUntil: Option.none(),
					maxAttempts, payload, priority, requestId: pipe(ctx.requestId, Option.some),
					scheduledAt: opts?.delay ? new Date(Date.now() + Duration.toMillis(opts.delay)) : new Date(), status: 'pending', type, updatedAt: undefined, userId,
				}))));
				const ids = (inserted as readonly { id: string }[]).map((j) => j.id);
				const firstId = ids[0];
				yield* Effect.all([
					MetricsService.inc(metrics.jobs.enqueued, MetricsService.label({ priority, type }), items.length),
					audit.log('Job.enqueue', { details: { count: items.length, priority, type }, subjectId: firstId ?? 'batch' }),
				], { discard: true });
				yield* Effect.when(Effect.die(new Error('Job insert returned no ID')), () => !isBatch && firstId === undefined);
				return isBatch ? ids : (firstId as string);
			}).pipe(
				Effect.tap(() => Context.Request.toSerializable.pipe(Effect.flatMap((s) => Effect.annotateCurrentSpan({ 'trace.requestId': s.requestId, 'trace.tenantId': s.tenantId, 'trace.userId': s.userId })))),
				Telemetry.span('jobs.enqueue', { 'job.count': Array.isArray(payloads) ? payloads.length : 1, 'job.maxAttempts': opts?.maxAttempts ?? 5, 'job.priority': opts?.priority ?? 'normal', 'job.type': type }),
			);
		return {
			enqueue,
			onStatusChange: (): Stream.Stream<JobService.StatusEvent, never, never> => pg.listen('job_status').pipe(
				Stream.mapEffect((payload) => S.decodeUnknown(S.parseJson(JobStatusEvent))(payload).pipe(
					Effect.matchEffect({
						onFailure: (e) => Effect.logWarning('Invalid job status event', { error: String(e), payload }).pipe(Effect.as(Option.none<JobService.StatusEvent>())),
						onSuccess: (parsed) => Effect.succeed(Option.some(parsed)),
					}),
				)),
				Stream.filterMap(F.identity),
				Stream.catchAll(() => Stream.empty),
			),
			registerHandler: (type: string, handler: JobService.Handler) => Ref.update(handlers, HashMap.set(type, handler as (payload: unknown) => Effect.Effect<void, unknown, never>)),
		};
	}),
}) {}

// --- [NAMESPACE] -------------------------------------------------------------

namespace JobService {
	export type Handler = (payload: unknown) => Effect.Effect<void, unknown, unknown>;
	export type StatusEvent = typeof JobStatusEvent.Type;
}

// --- [EXPORT] ----------------------------------------------------------------

export { B as JOB_TUNING, JobService };
