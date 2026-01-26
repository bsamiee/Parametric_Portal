/**
 * Background job processing with database-backed queue.
 * SELECT FOR UPDATE SKIP LOCKED for atomic claim; Circuit breaker resilience; graceful shutdown.
 *
 * Effect APIs: Semaphore (concurrency), Schedule.exponential+jittered (backoff), Schedule.spaced (polling).
 *
 * [ARCHITECTURE] Hybrid Service Design:
 * JobService intentionally combines job orchestration (enqueue, process, retry) with real-time event
 * streaming (onStatusChange via pg.listen). This differs from SearchRepo/SearchService pattern
 * where pg.listen lives in database layer and domain layer filters the interface.
 *
 * Rationale:
 * - JobService is a complete orchestration system, not just a repository wrapper
 * - Job status events are tightly coupled to processing lifecycle (same service owns both)
 * - No domain wrapper needed - JobService IS the domain logic for background jobs
 * - PgClient access justified: events are internal to job processing, not external data
 *
 * Consumers: routes/jobs.ts exposes onStatusChange() via SSE for real-time job dashboards.
 */
import { PgClient } from '@effect/sql-pg';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Duration, Effect, HashMap, Metric, Option, Random, Ref, Schedule, Schema as S, Stream } from 'effect';
import { AuditService } from '../observe/audit.ts';
import { Circuit } from '../security/circuit.ts';
import { MetricsService } from '../observe/metrics.ts';
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
	poll: { busy: Duration.seconds(1), idle: Duration.seconds(10) }, // Adaptive: fast when busy, slow when idle
	retry: { base: Duration.seconds(1), cap: Duration.minutes(10), factor: 2, jitter: 0.4 },
	shutdown: { interval: Duration.millis(100), maxWait: 50 },
	timeout: Duration.minutes(5),
} as const;

// --- [SERVICE] ---------------------------------------------------------------

class JobService extends Effect.Service<JobService>()('server/Jobs', {
	scoped: Effect.gen(function* () {
		const db = yield* DatabaseService;
		const pg = yield* PgClient.PgClient;
		const metrics = yield* MetricsService;
		const audit = yield* AuditService;
		const workerId = crypto.randomUUID();
		type DbJob = Effect.Effect.Success<ReturnType<typeof db.jobs.claimBatch>>[number];
		const handlers = yield* Ref.make(HashMap.empty<string, (payload: unknown) => Effect.Effect<void, unknown, never>>());
		const semaphore = yield* Effect.makeSemaphore(B.batch.concurrency);
		const inFlight = yield* Ref.make(0);
		const circuit = Circuit.make('jobs-db', {
			breaker: { _tag: 'consecutive', threshold: B.breaker.threshold },
			halfOpenAfter: B.breaker.halfOpen,
			onStateChange: ({ name, previous, state }) =>
				Effect.logWarning('Circuit state change', { from: Circuit.State[previous], name, to: Circuit.State[state] }),
		});
		const run = <A>(eff: Effect.Effect<A, unknown>) => circuit.execute(() => Effect.runPromise(eff));
		const complete = (job: DbJob) =>
			run(db.jobs.complete(job.id)).pipe(
				Effect.tap(() => Effect.all([
					MetricsService.inc(metrics.jobs.completions, MetricsService.label({ type: job.type }), 1),
					audit.log('Job.complete', { details: { type: job.type }, subjectId: job.id }),
				], { discard: true })),
				Effect.withSpan('jobs.complete', { attributes: { 'job.appId': job.appId, 'job.attempts': job.attempts, 'job.id': job.id, 'job.type': job.type } }),
			);
		const deadLetter = (job: DbJob, error: string) =>
			run(db.jobs.deadLetter(job.id, error)).pipe(
				Effect.tap(() => Effect.all([
					MetricsService.inc(metrics.jobs.deadLettered, MetricsService.label({ type: job.type }), 1),
					Effect.logError('Dead letter', { attempts: job.attempts, error, jobId: job.id, type: job.type }),
					audit.log('Job.dead_letter', { details: { attempts: job.attempts, error, type: job.type }, subjectId: job.id }),
				], { discard: true })),
				Effect.withSpan('jobs.deadLetter', { attributes: { 'job.attempts': job.attempts, 'job.id': job.id, 'job.type': job.type } }),
			);
		const retry = (job: DbJob, error: unknown) =>
			Effect.gen(function* () {
				const attempt = job.attempts + 1;
				const baseMs = Duration.toMillis(B.retry.base);
				const capMs = Duration.toMillis(B.retry.cap);
				const exponentialMs = baseMs * (B.retry.factor ** attempt);
				const jitter = yield* Random.nextRange(1 - B.retry.jitter / 2, 1 + B.retry.jitter / 2);
				const cappedDelayMs = Math.round(Math.min(exponentialMs, capMs) * jitter);
				yield* run(db.jobs.retry(job.id, { attempts: attempt, lastError: String(error), scheduledAt: new Date(Date.now() + cappedDelayMs) }));
				yield* Effect.all([
					MetricsService.inc(metrics.jobs.failures, MetricsService.label({ type: job.type }), 1),
					MetricsService.inc(metrics.jobs.retries, MetricsService.label({ type: job.type }), 1),
					audit.log('Job.retry', { details: { attempt, delayMs: cappedDelayMs, error: String(error), type: job.type }, subjectId: job.id }),
				], { discard: true });
			}).pipe(Effect.withSpan('jobs.retry', { attributes: { 'job.attempts': job.attempts, 'job.id': job.id, 'job.maxAttempts': job.maxAttempts, 'job.type': job.type } }));
		const outcome = (job: DbJob, error: unknown) => job.attempts + 1 >= job.maxAttempts ? deadLetter(job, String(error)) : retry(job, error);
		const process = (job: DbJob) =>
			Effect.gen(function* () {
				yield* Ref.update(inFlight, (n) => n + 1);
				const map = yield* Ref.get(handlers);
				const handler = HashMap.get(map, job.type);
				const requestId = Option.getOrElse(job.requestId as Option.Option<string>, () => crypto.randomUUID());
				const sessionFromJob = Option.map(job.userId as Option.Option<string>, (userId) => ({ id: Context.Request.Id.job, mfaEnabled: false, userId, verifiedAt: Option.none<Date>() }));
				const ctx: Partial<Context.Request.Data> = { ipAddress: Option.none(), requestId, session: sessionFromJob, userAgent: Option.none() };
				yield* Context.Request.withinSync(job.appId, Effect.gen(function* () {
					const labels = MetricsService.label({ tenant: job.appId, type: job.type });
					yield* Option.match(job.waitMs as Option.Option<number>, {
						onNone: () => Effect.void,
						onSome: (ms) => Metric.update(Metric.taggedWithLabels(metrics.jobs.waitDuration, labels), Duration.millis(ms)),
					});
					return yield* Option.match(handler, {
						onNone: () => Effect.logWarning('No handler', { jobId: job.id, type: job.type }).pipe(Effect.andThen(deadLetter(job, 'No handler'))),
						onSome: (fn) => fn(job.payload).pipe(
							Effect.timeoutFail({ duration: B.timeout, onTimeout: () => `Timeout ${Duration.toMillis(B.timeout)}ms` }),
							Metric.trackDuration(Metric.taggedWithLabels(metrics.jobs.duration, labels)),
							Effect.matchEffect({ onFailure: (e) => outcome(job, e), onSuccess: () => complete(job) }),
						),
					});
				}), ctx);
			}).pipe(
				Effect.ensuring(Ref.update(inFlight, (n) => n - 1)),
				Effect.catchAll((e) => {
					const errorTag = typeof e === 'object' && e !== null && '_tag' in e ? String(e._tag) : 'UnknownError';
					return Effect.logError('Process failed', { error: String(e), errorTag, jobId: job.id, type: job.type }).pipe(
						Effect.andThen(MetricsService.inc(metrics.jobs.failures, MetricsService.label({ errorTag, type: job.type }), 1)),
					);
				}),
				Effect.withSpan('jobs.process', { attributes: { 'job.appId': job.appId, 'job.attempts': job.attempts, 'job.id': job.id, 'job.maxAttempts': job.maxAttempts, 'job.type': job.type } }),
			);
		const poll = run(db.jobs.claimBatch(workerId, B.batch.size, B.lock.minutes)).pipe(
			Effect.tap((jobs) => jobs.length > 0 ? Effect.logDebug('Claimed', { count: jobs.length, workerId }) : Effect.void),
			Effect.catchAll((e) => Effect.all([
				Effect.logWarning('Claim failed', { error: String(e) }),
				MetricsService.inc(metrics.jobs.failures, MetricsService.label({ type: 'claim' }), 1),
			], { discard: true }).pipe(Effect.as([] as DbJob[]))),
			Effect.tap((jobs) => Effect.forEach(jobs, (job) => semaphore.withPermits(1)(process(job)), { concurrency: B.batch.concurrency })),
			Effect.map((jobs) => jobs.length),
			Effect.withSpan('jobs.poll', { attributes: { 'batch.concurrency': B.batch.concurrency, 'batch.size': B.batch.size, 'worker.id': workerId } }),
		);
		const pollSchedule = Schedule.forever.pipe(	// Adaptive: fast (1s) when busy, slow (10s) when idle
			Schedule.addDelay((count) => count > 0 ? B.poll.busy : B.poll.idle),
		);
		const shutdown = Effect.gen(function* () {
			yield* Effect.logInfo('Shutting down', { workerId });
			yield* Ref.get(inFlight).pipe(
				Effect.filterOrFail((n) => n === 0, () => 'waiting'),
				Effect.retry(Schedule.spaced(B.shutdown.interval).pipe(Schedule.intersect(Schedule.recurs(B.shutdown.maxWait)))),
				Effect.ignore,
			);
			const remaining = yield* Ref.get(inFlight);
			yield* remaining > 0
				? Effect.logWarning('Shutdown with in-flight', { count: remaining, workerId })
				: Effect.logInfo('Shutdown complete', { workerId });
		});
		yield* Effect.logInfo('Starting', { workerId });
		yield* Effect.addFinalizer(() => shutdown);
		yield* poll.pipe(
			Effect.repeat(pollSchedule),
			Effect.forkScoped,
		);
		// Queue depth polling moved to PollingService
		const enqueue = <T>(type: string, payloads: T | readonly T[], opts?: { delay?: Duration.Duration; maxAttempts?: number; priority?: 'critical' | 'high' | 'low' | 'normal' }) =>
			Effect.gen(function* () {
				const isBatch = Array.isArray(payloads);
				const items = isBatch ? payloads : [payloads];
				const priority = opts?.priority ?? 'normal';
				const maxAttempts = opts?.maxAttempts ?? 5;
				const ctx = yield* Context.Request.current;
				const userId = Option.match(ctx.session, { onNone: () => Option.none<string>(), onSome: (s) => Option.some(s.userId) });
				const inserted = yield* run(db.jobs.put(items.map((payload) => ({
					appId: ctx.tenantId, attempts: 0, lastError: Option.none(), lockedBy: Option.none(), lockedUntil: Option.none(),
					maxAttempts, payload, priority, requestId: Option.some(ctx.requestId),
					scheduledAt: opts?.delay ? new Date(Date.now() + Duration.toMillis(opts.delay)) : new Date(), status: 'pending', type, updatedAt: undefined, userId,
				}))));
				const ids = (inserted as readonly { id: string }[]).map((j) => j.id);
				yield* Effect.all([
					MetricsService.inc(metrics.jobs.enqueued, MetricsService.label({ priority, type }), items.length),
					audit.log('Job.enqueue', { details: { count: items.length, priority, type }, subjectId: ids[0] ?? 'batch' }),
				], { discard: true });
				return isBatch ? ids : (ids[0] ?? '');
			}).pipe(Effect.withSpan('jobs.enqueue', { attributes: { 'job.count': Array.isArray(payloads) ? payloads.length : 1, 'job.maxAttempts': opts?.maxAttempts ?? 5, 'job.priority': opts?.priority ?? 'normal', 'job.type': type } }));
		return {
			enqueue,
			onStatusChange: () =>
				pg.listen('job_status').pipe(
					Stream.mapEffect((payload) => S.decodeUnknown(S.parseJson(JobStatusEvent))(payload)),
				),
			// Register a job handler. Handler can require Context.Request (provided via withinSync at runtime) and any services available in AppLayer (FileSystem, S3Service, etc.) Requirements are satisfied at runtime by the layer composition.
			registerHandler: (type: string, handler: (payload: unknown) => Effect.Effect<void, unknown, unknown>) =>
				Ref.update(handlers, HashMap.set(type, handler as (payload: unknown) => Effect.Effect<void, unknown, never>)),
			unregisterHandler: (type: string) => Ref.update(handlers, HashMap.remove(type)),
		};
	}),
}) {}

// --- [NAMESPACE] -------------------------------------------------------------

namespace JobService {
	export type StatusEvent = typeof JobStatusEvent.Type;
}

// --- [EXPORT] ----------------------------------------------------------------

export { B as JOB_TUNING, JobService };
