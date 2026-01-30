/**
 * Entity-based job processing via @effect/cluster mailbox dispatch.
 * Replaces poll-based queue with instant consistent-hash routing.
 */
import { Entity, Sharding } from '@effect/cluster';
import { Rpc } from '@effect/rpc';
import { Clock, Duration, Effect, Fiber, FiberMap, HashMap, Layer, Match, Metric, Option, Queue, Ref, Schedule, Schema as S, Stream } from 'effect';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { ClusterService } from './cluster.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const JobPriority = S.Literal('critical', 'high', 'normal', 'low');
const JobStatus = S.Literal('queued', 'processing', 'complete', 'failed', 'cancelled');
const JobErrorReason = S.Literal('NotFound', 'AlreadyCancelled', 'HandlerMissing', 'Validation', 'Processing', 'MaxRetries', 'RunnerUnavailable', 'Timeout');

class JobPayload extends S.Class<JobPayload>('JobPayload')({
	batchId: S.optional(S.String), dedupeKey: S.optional(S.String),
	duration: S.optionalWith(S.Literal('short', 'long'), { default: () => 'short' as const }),
	maxAttempts: S.optionalWith(S.Number, { default: () => 3 }), payload: S.Unknown,
	priority: S.optionalWith(JobPriority, { default: () => 'normal' as const }), type: S.String,
}) {}

class JobStatusResponse extends S.Class<JobStatusResponse>('JobStatusResponse')({
	attempts: S.Number, 
	history: S.Array(S.Struct({ error: S.optional(S.String), status: JobStatus, timestamp: S.Number })),result: S.optional(S.Unknown), status: JobStatus,
}) {}

// --- [ERRORS] ----------------------------------------------------------------

class JobError extends S.TaggedError<JobError>()('JobError', { cause: S.optional(S.Unknown), jobId: S.optional(S.String), reason: JobErrorReason }) {
	static readonly fromNotFound = (jobId: string) => new JobError({ jobId, reason: 'NotFound' });
	static readonly fromCancelled = (jobId: string) => new JobError({ jobId, reason: 'AlreadyCancelled' });
	static readonly fromHandlerMissing = (jobId: string, type: string) => new JobError({ cause: { type }, jobId, reason: 'HandlerMissing' });
	static readonly fromValidation = (jobId: string, cause: unknown) => new JobError({ cause, jobId, reason: 'Validation' });
	static readonly fromProcessing = (jobId: string, cause: unknown) => new JobError({ cause, jobId, reason: 'Processing' });
	static readonly fromMaxRetries = (jobId: string, cause: unknown) => new JobError({ cause, jobId, reason: 'MaxRetries' });
	static readonly fromRunnerUnavailable = (jobId: string, cause?: unknown) => new JobError({ cause, jobId, reason: 'RunnerUnavailable' });
	static readonly fromTimeout = (jobId: string, cause?: unknown) => new JobError({ cause, jobId, reason: 'Timeout' });
	static readonly _terminal: ReadonlySet<typeof JobErrorReason.Type> = new Set(['Validation', 'HandlerMissing', 'AlreadyCancelled', 'NotFound']);
	static readonly _transient: ReadonlySet<typeof JobErrorReason.Type> = new Set(['Timeout', 'RunnerUnavailable']);
	static readonly isTerminal = (e: JobError): boolean => JobError._terminal.has(e.reason);
	static readonly isTransient = (e: JobError): boolean => JobError._transient.has(e.reason);
}

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	entity: { concurrency: 1, mailboxCapacity: 100, maxIdleTime: Duration.minutes(5) },
	pools: { critical: 4, high: 3, low: 1, normal: 2 } as const,
	retry: Schedule.exponential(Duration.millis(100)).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(5)), Schedule.upTo(Duration.seconds(30)), Schedule.whileInput((e: JobError) => !JobError.isTerminal(e)), Schedule.resetAfter(Duration.minutes(5)), Schedule.collectAllInputs),
} as const;

// --- [CONTEXT] ---------------------------------------------------------------

class JobContext extends Effect.Tag('JobContext')<JobContext, {
	readonly jobId: string;
	readonly priority: typeof JobPriority.Type;
	readonly reportProgress: (pct: number, message: string) => Effect.Effect<void>;
	readonly tenantId: string;
}>() {}

// --- [ENTITY] ----------------------------------------------------------------

const JobEntity = Entity.make('Job', [
	Rpc.make('submit', { error: JobError, payload: JobPayload.fields, primaryKey: (p: typeof JobPayload.Type) => p.dedupeKey ?? crypto.randomUUID(), success: S.Struct({ duplicate: S.Boolean, jobId: S.String }) }),
	Rpc.make('status', { payload: S.Struct({ jobId: S.String }), success: JobStatusResponse }),
	Rpc.make('progress', { payload: S.Struct({ jobId: S.String }), stream: true, success: S.Struct({ message: S.String, pct: S.Number }) }),
	Rpc.make('cancel', { error: JobError, payload: S.Struct({ jobId: S.String }), success: S.Void }),
]);

// --- [LAYERS] ----------------------------------------------------------------

const JobEntityLive = JobEntity.toLayer(Effect.gen(function* () {
	const currentAddress = yield* Entity.CurrentAddress;
	const handlers = yield* Ref.make(HashMap.empty<string, (payload: unknown) => Effect.Effect<unknown, unknown, never>>());
	const runningJobs = yield* FiberMap.make<string>();
	const jobStates = yield* Ref.make(HashMap.empty<string, typeof JobStatusResponse.Type>());
	const progressQueue = yield* Queue.sliding<{ jobId: string; pct: number; message: string }>(100);
	const [db, metrics, sharding] = yield* Effect.all([DatabaseService, MetricsService, Sharding.Sharding]);

	const insertDlq = (jobId: string, envelope: typeof JobPayload.Type, errors: readonly JobError[], reason: typeof JobErrorReason.Type) =>
		Context.Request.tenantId.pipe(Effect.flatMap((tenantId) => db.jobDlq.insert({ appId: tenantId, attempts: errors.length, errorHistory: errors.map((e) => ({ error: String(e.cause), timestamp: Date.now() })), errorReason: reason, originalJobId: jobId, payload: envelope.payload, replayedAt: Option.none(), requestId: Option.none(), type: envelope.type, userId: Option.none() })), Effect.zipRight(Metric.increment(metrics.jobs.deadLettered)));

	const retrySchedule = Schedule.exponential(Duration.millis(100)).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(5)), Schedule.upTo(Duration.seconds(30)), Schedule.whileInput((e: JobError) => !JobError.isTerminal(e)), Schedule.resetAfter(Duration.minutes(5)), Schedule.tapOutput(() => Metric.increment(metrics.jobs.retries)));

	const processJob = (jobId: string, envelope: typeof JobPayload.Type) => Telemetry.span(Context.Request.withinCluster({ entityId: currentAddress.entityId, entityType: currentAddress.entityType, shardId: currentAddress.shardId })(Effect.gen(function* () {
		const handler = yield* Ref.get(handlers).pipe(Effect.map(HashMap.get(envelope.type)), Effect.flatMap(Option.match({ onNone: () => Effect.fail(JobError.fromHandlerMissing(jobId, envelope.type)), onSome: Effect.succeed })));
		const tenantId = yield* Context.Request.tenantId;
		const ts = yield* Clock.currentTimeMillis;
		yield* Ref.update(jobStates, HashMap.set(jobId, new JobStatusResponse({ attempts: 1, history: [{ status: 'processing', timestamp: ts }], status: 'processing' })));
		const longJob = envelope.duration === 'long';
		yield* Effect.when(Entity.keepAlive(true), () => longJob);
		yield* Effect.provideService(handler(envelope.payload).pipe(Effect.mapError((e) => JobError.fromProcessing(jobId, e))), JobContext, { jobId, priority: envelope.priority ?? 'normal', reportProgress: (pct, message) => Queue.offer(progressQueue, { jobId, message, pct }), tenantId }).pipe(Effect.catchTag('JobError', (e) => JobError.isTerminal(e) ? insertDlq(jobId, envelope, [e], e.reason).pipe(Effect.zipRight(Effect.fail(e))) : Effect.fail(e)), Effect.retryOrElse(retrySchedule, (e) => insertDlq(jobId, envelope, [e], 'MaxRetries').pipe(Effect.zipRight(Effect.fail(e)))), MetricsService.trackJob({ jobType: envelope.type, operation: 'process', priority: envelope.priority }), Effect.ensuring(Effect.when(Entity.keepAlive(false), () => longJob)));
		const completeTs = yield* Clock.currentTimeMillis;
		yield* Ref.update(jobStates, HashMap.modify(jobId, (s) => new JobStatusResponse({ ...s, history: [...s.history, { status: 'complete', timestamp: completeTs }], status: 'complete' })));
		yield* Metric.increment(metrics.jobs.completions);
	}).pipe(Effect.onInterrupt(() => Clock.currentTimeMillis.pipe(Effect.flatMap((ts) => Ref.update(jobStates, HashMap.modify(jobId, (s) => new JobStatusResponse({ ...s, history: [...s.history, { status: 'cancelled', timestamp: ts }], status: 'cancelled' })))))))), 'job.process', { 'job.id': jobId, 'job.type': envelope.type, metrics: false });

	return {
		cancel: (envelope) => Effect.gen(function* () {
			const { jobId } = envelope.payload;
			const fiberOpt = yield* FiberMap.get(runningJobs, jobId).pipe(Effect.option);
			yield* Option.match(fiberOpt, {
				onNone: () => Ref.get(jobStates).pipe(Effect.map(HashMap.get(jobId)), Effect.flatMap(Option.match({
					onNone: () => Effect.fail(JobError.fromNotFound(jobId)),
					onSome: (state) => Match.value(state.status).pipe(Match.when('cancelled', () => Effect.fail(JobError.fromCancelled(jobId))), Match.when('complete', () => Effect.fail(JobError.fromCancelled(jobId))), Match.when('failed', () => Effect.fail(JobError.fromCancelled(jobId))), Match.orElse(() => Effect.fail(JobError.fromNotFound(jobId)))),
				}))),
				onSome: (fiber) => Effect.gen(function* () {
					yield* Fiber.interrupt(fiber);
					yield* FiberMap.remove(runningJobs, jobId);
					const ts = yield* Clock.currentTimeMillis;
					yield* Ref.update(jobStates, HashMap.modify(jobId, (s) => new JobStatusResponse({ ...s, history: [...s.history, { status: 'cancelled', timestamp: ts }], status: 'cancelled' })));
					yield* Metric.increment(metrics.jobs.cancellations);
				}),
			});
		}),
		progress: (envelope) => Stream.fromQueue(progressQueue).pipe(Stream.filter((p) => p.jobId === envelope.payload.jobId), Stream.map(({ pct, message }) => ({ message, pct }))),
		status: (envelope) => Ref.get(jobStates).pipe(Effect.map(HashMap.get(envelope.payload.jobId)), Effect.flatMap(Option.match({ onNone: () => Effect.succeed(new JobStatusResponse({ attempts: 0, history: [], status: 'queued' })), onSome: Effect.succeed }))),
		submit: (envelope) => Effect.gen(function* () {
			const jobId = yield* sharding.getSnowflake.pipe(Effect.map(String));
			yield* Metric.increment(metrics.jobs.enqueued);
			yield* FiberMap.run(runningJobs, jobId)(processJob(jobId, envelope.payload).pipe(Effect.onInterrupt(() => Effect.logInfo('Job interrupted', { jobId }))));
			return { duplicate: false, jobId };
		}),
	};
}), { concurrency: _CONFIG.entity.concurrency, defectRetryPolicy: _CONFIG.retry, mailboxCapacity: _CONFIG.entity.mailboxCapacity, maxIdleTime: _CONFIG.entity.maxIdleTime, spanAttributes: { 'entity.service': 'job-processing', 'entity.version': 'v1' } });

// --- [SERVICES] --------------------------------------------------------------

class JobService extends Effect.Service<JobService>()('server/Jobs', {
	dependencies: [JobEntityLive.pipe(Layer.provide(ClusterService.Layer)), DatabaseService.Default, MetricsService.Default],
	scoped: Effect.gen(function* () {
		const [sharding, handlers, db, counter] = yield* Effect.all([Sharding.Sharding, Ref.make(HashMap.empty<string, JobService.Handler>()), DatabaseService, Ref.make(0)]);
		const getClient = yield* sharding.makeClient(JobEntity);
		const routeByPriority = (p: keyof typeof _CONFIG.pools) => Ref.getAndUpdate(counter, (c) => c + 1).pipe(Effect.map((n) => `job-${p}-${n % _CONFIG.pools[p]}`));
		const submit = <T>(type: string, payloads: T | readonly T[], opts?: { dedupeKey?: string; maxAttempts?: number; priority?: typeof JobPriority.Type }) => Effect.gen(function* () {
			const items = Array.isArray(payloads) ? payloads : [payloads];
			const priority = opts?.priority ?? 'normal';
			const batchId = items.length > 1 ? crypto.randomUUID() : undefined;
			const results = yield* Effect.forEach(items, (payload, idx) => Effect.gen(function* () {
				const entityId = yield* routeByPriority(priority);
				return yield* Context.Request.withinCluster({ entityId, entityType: 'Job' })(getClient(entityId)['submit']({ batchId, dedupeKey: opts?.dedupeKey ? `${opts.dedupeKey}:${idx}` : undefined, maxAttempts: opts?.maxAttempts, payload, priority, type }).pipe(Effect.map((r) => r.jobId)));
			}), { concurrency: 'unbounded' });
			return Array.isArray(payloads) ? results : results[0];
		});
		const validateBatch = <T>(items: readonly T[], validator: (item: T) => Effect.Effect<void, JobError>) =>
			Effect.all(items.map((item, idx) => validator(item).pipe(Effect.mapError((e) => ({ error: e, idx })))), { concurrency: 'unbounded', mode: 'validate' });
		const replay = (dlqId: string) => db.jobDlq.findById(dlqId as never).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.fail(JobError.fromNotFound(dlqId)), onSome: (entry) => submit(entry.type, entry.payload, { priority: 'normal' }).pipe(Effect.zipRight(db.jobDlq.markReplayed(dlqId))) })));
		return {
			cancel: (jobId: string) => getClient(jobId)['cancel']({ jobId }), enqueue: submit,
			registerHandler: <T>(type: string, handler: (payload: T) => Effect.Effect<void, unknown, never>) => Ref.update(handlers, HashMap.set(type, handler as JobService.Handler)),
			replay, status: (jobId: string) => getClient(jobId)['status']({ jobId }), submit, validateBatch,
		};
	}),
}) {
	static readonly Config = _CONFIG;
	static readonly Context = JobContext;
	static readonly Error = JobError;
	static readonly Payload = JobPayload;
	static readonly Response = { Status: JobStatusResponse } as const;
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace JobService {
	export type Handler = (payload: unknown) => Effect.Effect<void, unknown, never>;
	export type Priority = typeof JobPriority.Type;
	export type Status = typeof JobStatus.Type;
	export type Error = InstanceType<typeof JobError>;
	export type Context = Effect.Effect.Context<typeof JobContext>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { JobService };
