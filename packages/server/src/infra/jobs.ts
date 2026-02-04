/**
 * Entity-based job processing via @effect/cluster mailbox dispatch.
 * Replaces poll-based queue with instant consistent-hash routing.
 */
import { DeliverAt, Entity, EntityId, Sharding, Snowflake } from '@effect/cluster';
import { Rpc, RpcClientError } from '@effect/rpc';
import { SqlClient } from '@effect/sql';
import { Chunk, Clock, DateTime, Duration, Effect, FiberMap, HashMap, Layer, Match, Metric, Option, PubSub, Ref, Schedule, Schema as S, Stream } from 'effect';
import { DatabaseService } from '@parametric-portal/database/repos';
import type { JobDlq } from '@parametric-portal/database/models';
import { Context } from '../context.ts';
import { CacheService } from '../platform/cache.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { ClusterService } from './cluster.ts';
import { EventBus } from './events.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const JobPriority = S.Literal('critical', 'high', 'normal', 'low');
const JobStatus = S.Literal('queued', 'processing', 'complete', 'failed', 'cancelled');
class JobPayload extends S.Class<JobPayload>('JobPayload')({
	batchId: S.optional(S.String),
	dedupeKey: S.optional(S.String),
	duration: S.optionalWith(S.Literal('short', 'long'), { default: () => 'short' }),
	maxAttempts: S.optionalWith(S.Number, { default: () => 3 }),
	payload: S.Unknown,
	priority: S.optionalWith(JobPriority, { default: () => 'normal' }),
	scheduledAt: S.optional(S.Number), // Unix timestamp (ms) for delayed delivery via DeliverAt
	tenantId: S.String,
	type: S.String,
}) {}
class JobStatusResponse extends S.Class<JobStatusResponse>('JobStatusResponse')({
	attempts: S.Number,
	history: S.Array(S.Struct({ error: S.optional(S.String), status: JobStatus, timestamp: S.Number })),
	result: S.optional(S.Unknown),
	status: JobStatus,
}) {}
class JobStatusEvent extends S.Class<JobStatusEvent>('JobStatusEvent')({
	error: S.optional(S.String),
	id: S.String, // Snowflake - sortable, timestamp extractable via Snowflake.timestamp()
	jobId: S.String,
	status: JobStatus,
	tenantId: S.String,
	type: S.String,
}) {}
const JobProgress = S.Struct({ message: S.String, pct: S.Number });

// --- [STATE] -----------------------------------------------------------------

const _StatusProps = {	// Data-driven status properties - eliminates OR chains via algorithmic derivation
	cancelled: 	{ cancelError: 'AlreadyCancelled', 	incrementOnEntry: false, incrementOnRetry: false, terminal: true  },
	complete: 	{ cancelError: 'AlreadyCancelled', 	incrementOnEntry: false, incrementOnRetry: false, terminal: true  },
	failed: 	{ cancelError: 'AlreadyCancelled', 	incrementOnEntry: true,  incrementOnRetry: false, terminal: true  },
	processing: { cancelError: 'NotFound', 			incrementOnEntry: false, incrementOnRetry: true,  terminal: false },
	queued: 	{ cancelError: 'NotFound', 			incrementOnEntry: false, incrementOnRetry: false, terminal: false },
} as const satisfies Record<typeof JobStatus.Type, { cancelError: 'AlreadyCancelled' | 'NotFound'; incrementOnEntry: boolean; incrementOnRetry: boolean; terminal: boolean }>;
class JobState extends S.Class<JobState>('JobState')({
	attempts: S.Number,
	completedAt: S.optional(S.Number),
	createdAt: S.Number,
	history: S.Array(S.Struct({ error: S.optional(S.String), status: JobStatus, timestamp: S.Number })),
	lastError: S.optional(S.String),
	result: S.optional(S.Unknown),
	status: JobStatus,
}) {
	static readonly transition = (	// Polymorphic state transition - data-driven derivation replaces conditionals
		state: JobState | null,
		to: typeof JobStatus.Type,
		ts: number,
		opts?: { error?: string; result?: unknown },): JobState => {
		const base = state ?? new JobState({ attempts: 0, createdAt: ts, history: [], status: 'queued' });
		const props = _StatusProps[to];
		return new JobState({
			...base,
			attempts: base.attempts + Number(props.incrementOnEntry || (props.incrementOnRetry && !!opts?.error)),
			completedAt: props.terminal ? ts : base.completedAt,
			history: [...base.history, { error: opts?.error, status: to, timestamp: ts }],
			lastError: opts?.error ?? base.lastError,
			result: opts?.result ?? base.result,
			status: to,
		});
	};
	get errorHistory(): readonly { error: string; timestamp: number }[] { return this.history.flatMap((entry) => entry.error ? [{ error: entry.error, timestamp: entry.timestamp }] : []); }
	static readonly defaultResponse = new JobStatusResponse({ attempts: 0, history: [], status: 'queued' });
	toResponse(): typeof JobStatusResponse.Type { return new JobStatusResponse({ attempts: this.attempts, history: this.history, result: this.result, status: this.status }); }
}

// --- [ERRORS] ----------------------------------------------------------------

const _JobErrorReason = S.Literal('NotFound', 'AlreadyCancelled', 'HandlerMissing', 'Validation', 'Processing', 'MaxRetries', 'RunnerUnavailable', 'Timeout');
const _JobErrorProps = {
	AlreadyCancelled: 	{ retryable: false, terminal: true  },
	HandlerMissing: 	{ retryable: false, terminal: true  },
	MaxRetries: 		{ retryable: false, terminal: true  },
	NotFound: 			{ retryable: false, terminal: true  },
	Processing: 		{ retryable: true,  terminal: false },
	RunnerUnavailable: 	{ retryable: true,  terminal: false },
	Timeout: 			{ retryable: true,  terminal: false },
	Validation: 		{ retryable: false, terminal: true  },
} as const satisfies Record<typeof _JobErrorReason.Type, { retryable: boolean; terminal: boolean }>;
class JobError extends S.TaggedError<JobError>()('JobError', { cause: S.optional(S.Unknown), jobId: S.optional(S.String), reason: _JobErrorReason }) {
	static readonly from = (jobId: string, reason: typeof _JobErrorReason.Type, cause?: unknown) => new JobError({ cause, jobId, reason });
	get isTerminal(): boolean { return _JobErrorProps[this.reason].terminal; }
	get isRetryable(): boolean { return _JobErrorProps[this.reason].retryable; }
}
const _mapRpcError = (jobId: string) => (error: unknown): JobError => JobError.from(jobId, (typeof error === 'object' && error !== null && RpcClientError.TypeId in error) ? 'RunnerUnavailable' : 'Processing', error);

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	cache: { keyPrefix: 'job:', ttl: Duration.days(7) },
	entity: { concurrency: 1, mailboxCapacity: 100,
	maxIdleTime: Duration.minutes(5) },
	pools: { critical: 4, high: 3, low: 1, normal: 2 },
	retry: { cap: Duration.seconds(30),
		defect: { base: Duration.millis(100), maxAttempts: 5 },
		job: 	{ base: Duration.millis(100), maxAttempts: 5, resetAfter: Duration.minutes(5) }
	},
	statusHub: { capacity: 256 }
} as const;
const _retryBase = (cfg: { readonly base: Duration.Duration; readonly maxAttempts: number }) => Schedule.exponential(cfg.base).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(cfg.maxAttempts)), Schedule.upTo(_CONFIG.retry.cap));

// --- [CONTEXT] ---------------------------------------------------------------

class JobContext extends Effect.Tag('JobContext')<JobContext, {
	readonly jobId: string;
	readonly priority: typeof JobPriority.Type;
	readonly reportProgress: (pct: number, message: string) => Effect.Effect<void>;
	readonly tenantId: string;
}>() {}

// --- [ENTITY] ----------------------------------------------------------------

const JobEntity = Entity.make('Job', [
	Rpc.make('submit', 	 { error: JobError, payload: JobPayload.fields, primaryKey: (payload: typeof JobPayload.Type) => payload.dedupeKey ?? crypto.randomUUID(), success: S.Struct({ duplicate: S.Boolean, jobId: S.String }) }),
	Rpc.make('status', 	 { payload: S.Struct({ jobId: S.String, tenantId: S.String }), success: JobStatusResponse }),
	Rpc.make('progress', { payload: S.Struct({ jobId: S.String, tenantId: S.String }), stream: true, success: S.Struct({ message: S.String, pct: S.Number }) }),
	Rpc.make('cancel', 	 { error: JobError, payload: S.Struct({ jobId: S.String, tenantId: S.String }), success: S.Void }),
]);

// --- [LAYERS] ----------------------------------------------------------------

const JobEntityLive = JobEntity.toLayer(Effect.gen(function* () {
	const currentAddress = yield* Entity.CurrentAddress;
	const { handlers, statusHub } = yield* JobRuntime;
	const runningJobs = yield* FiberMap.make<string>();
	yield* Effect.addFinalizer(() => FiberMap.join(runningJobs).pipe(Effect.ignore));	// Graceful shutdown: await all running jobs before entity deactivation
	const jobStates = yield* Ref.make(HashMap.empty<string, JobState>());
	const progressHubs = yield* Ref.make(HashMap.empty<string, PubSub.PubSub<{ pct: number; message: string }>>());
	const { db, eventBus, metrics, redis, sharding, sql } = yield* Effect.all({ db: DatabaseService, eventBus: EventBus, metrics: MetricsService, redis: CacheService.redis, sharding: Sharding.Sharding, sql: SqlClient.SqlClient });
	const _stateKey = (jobId: string) => `${_CONFIG.cache.keyPrefix}state:${jobId}`;
	const _progressKey = (jobId: string) => `${_CONFIG.cache.keyPrefix}progress:${jobId}`;
	const _persistStateCache = (jobId: string, state: JobState) =>
		Effect.tryPromise(() => redis.set(_stateKey(jobId), JSON.stringify(state), 'PX', Duration.toMillis(_CONFIG.cache.ttl))).pipe(
			Effect.tapError((error) => Effect.logWarning('Job state persist failed', { error: String(error), jobId })),
			Effect.ignore,
		);
	const _persistProgressCache = (jobId: string, progress: typeof JobProgress.Type) =>
		Effect.tryPromise(() => redis.set(_progressKey(jobId), JSON.stringify(progress), 'PX', Duration.toMillis(_CONFIG.cache.ttl))).pipe(
			Effect.tapError((error) => Effect.logWarning('Job progress persist failed', { error: String(error), jobId })),
			Effect.ignore,
		);
	const _persistStateDb = (jobId: string, tenantId: string, state: JobState) =>
		Context.Request.withinSync(tenantId, db.jobs.set(jobId, {
			attempts: state.attempts,
			completedAt: Option.fromNullable(state.completedAt).pipe(Option.map((ts) => new Date(ts))),
			history: state.history,
			lastError: Option.fromNullable(state.lastError),
			result: Option.fromNullable(state.result),
			status: state.status,
		})).pipe(
			Effect.tapError((error) => Effect.logWarning('Job state persist failed', { error: String(error), jobId })),
			Effect.ignore,
			Effect.provideService(SqlClient.SqlClient, sql),
		);
	const _persistProgressDb = (jobId: string, tenantId: string, progress: typeof JobProgress.Type) =>
		Context.Request.withinSync(tenantId, db.jobs.set(jobId, { progress: Option.some(progress) })).pipe(
			Effect.tapError((error) => Effect.logWarning('Job progress persist failed', { error: String(error), jobId })),
			Effect.ignore,
			Effect.provideService(SqlClient.SqlClient, sql),
		);
	const _persistState = (jobId: string, tenantId: string, state: JobState) => Effect.all([_persistStateCache(jobId, state), _persistStateDb(jobId, tenantId, state)], { discard: true });
	const _persistProgress = (jobId: string, tenantId: string, progress: typeof JobProgress.Type) => Effect.all([_persistProgressCache(jobId, progress), _persistProgressDb(jobId, tenantId, progress)], { discard: true });
	const _readCached = <A, I = A, R = never>(jobId: string, keyFn: (id: string) => string, schema: S.Schema<A, I, R>, label: string) =>
		Effect.tryPromise(() => redis.get(keyFn(jobId))).pipe(
			Effect.flatMap((raw) => Option.match(Option.fromNullable(raw), {
				onNone: () => Effect.succeed(Option.none<A>()),
				onSome: (json) =>
					Effect.try({ catch: (error) => error as Error, try: () => JSON.parse(json) as unknown }).pipe(
						Effect.flatMap(S.decodeUnknown(schema)),
						Effect.map(Option.some),
						Effect.catchAll((error) => Effect.logWarning(`Job ${label} decode failed`, { error: String(error), jobId }).pipe(Effect.as(Option.none<A>()))),
					),
			})),
			Effect.catchAll((error) => Effect.logWarning(`Job ${label} read failed`, { error: String(error), jobId }).pipe(Effect.as(Option.none<A>()))),
		);
	const _readState = (jobId: string, tenantId: string) => _readCached(jobId, _stateKey, JobState, 'state').pipe(
		Effect.flatMap(Option.match({
			onNone: () => Context.Request.withinSync(tenantId, db.jobs.one([{ field: 'job_id', value: jobId }])).pipe(
				Effect.flatMap(Option.match({
					onNone: () => Effect.succeed(Option.none<JobState>()),
					onSome: (job) => Effect.succeed(Option.some(new JobState({
						attempts: job.attempts,
						completedAt: Option.match(job.completedAt, { onNone: () => undefined, onSome: (date: Date) => date.getTime() }),
						createdAt: Snowflake.timestamp(Snowflake.Snowflake(job.jobId)),
						history: job.history,
						lastError: Option.match(job.lastError, { onNone: () => undefined, onSome: (value: string) => value }),
						result: Option.match(job.result, { onNone: () => undefined, onSome: (value: unknown) => value }),
						status: job.status as typeof JobStatus.Type,
					}))),
				})),
				Effect.tap(Option.match({
					onNone: () => Effect.void,
					onSome: (state) => Effect.all([Ref.update(jobStates, HashMap.set(jobId, state)), _persistStateCache(jobId, state)], { discard: true }),
				})),
				Effect.provideService(SqlClient.SqlClient, sql),
			),
			onSome: (state) => Effect.succeed(Option.some(state)),
		})),
	);
	const _readProgress = (jobId: string, tenantId: string) => _readCached(jobId, _progressKey, JobProgress, 'progress').pipe(
		Effect.flatMap(Option.match({
			onNone: () => Context.Request.withinSync(tenantId, db.jobs.one([{ field: 'job_id', value: jobId }])).pipe(
				Effect.map(Option.flatMap((job) => job.progress)),
				Effect.tap(Option.match({ onNone: () => Effect.void, onSome: (progress) => _persistProgressCache(jobId, progress as typeof JobProgress.Type) })),
				Effect.provideService(SqlClient.SqlClient, sql),
			),
			onSome: (progress) => Effect.succeed(Option.some(progress)),
		})),
	);
	const _transitionState = (jobId: string, tenantId: string, to: typeof JobStatus.Type, ts: number, opts?: { error?: string; result?: unknown }) =>
		Ref.modify(jobStates, (states) => {
			const current = Option.getOrElse(HashMap.get(states, jobId), () => null);
			const updated = JobState.transition(current, to, ts, opts);
			return [updated, HashMap.set(states, jobId, updated)] as const;
		}).pipe(Effect.tap((state) => _persistState(jobId, tenantId, state)));
	const _progressHub = (jobId: string) => ({
		cleanup: Ref.modify(progressHubs, (hubs) => [HashMap.get(hubs, jobId), HashMap.remove(hubs, jobId)] as const).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: PubSub.shutdown }))),
		get: Ref.get(progressHubs).pipe(Effect.flatMap((hubs) => HashMap.get(hubs, jobId).pipe(Option.match({
			onNone: () => PubSub.sliding<{ pct: number; message: string }>(16).pipe(Effect.tap((hub) => Ref.update(progressHubs, HashMap.set(jobId, hub)))),
			onSome: Effect.succeed,
		})))),
	});
	const publishStatus = (jobId: string, type: string, status: typeof JobStatus.Type, tenantId: string, error?: string) => sharding.getSnowflake.pipe(Effect.flatMap((snowflake) => PubSub.publish(statusHub, new JobStatusEvent({ error, id: String(snowflake), jobId, status, tenantId, type }))));
	const handleFailure = (jobId: string, envelope: typeof JobPayload.Type, error: JobError) =>
		Telemetry.span(
			Clock.currentTimeMillis.pipe(
				Effect.flatMap((failTs) => _transitionState(jobId, envelope.tenantId, 'failed', failTs, { error: String(error.cause) })),
				Effect.tap((state) => Effect.uninterruptible(Effect.all([
					Context.Request.withinSync(envelope.tenantId, db.jobDlq.insert({
						appId: envelope.tenantId,
						attempts: state.attempts,
						errorHistory: state.errorHistory,
						errorReason: error.reason,
						originalJobId: jobId,
						payload: envelope.payload,
						replayedAt: Option.none(),
						requestId: Option.none(),
						source: 'job',
						type: envelope.type,
						userId: Option.none(),
					})).pipe(Effect.zipRight(Metric.increment(metrics.jobs.deadLettered))),
					publishStatus(jobId, envelope.type, 'failed', envelope.tenantId, String(error.cause)),
					eventBus.emit({
						aggregateId: jobId,
						payload: { _tag: 'job', action: 'failed', reason: error.reason, type: envelope.type },
						tenantId: envelope.tenantId,
					}),
					Metric.increment(metrics.jobs.failures),
					_progressHub(jobId).cleanup,
				], { discard: true }))),
				Effect.flatMap(() => Effect.fail(error)),
			),
			'job.handleFailure',
			{ 'error.reason': error.reason, 'job.id': jobId },
		);
	const processJob = (jobId: string, envelope: typeof JobPayload.Type) => Telemetry.span(
		Context.Request.within(envelope.tenantId, Context.Request.withinCluster({ entityId: currentAddress.entityId, entityType: currentAddress.entityType, shardId: currentAddress.shardId })(
			Effect.gen(function* () {
				const handler = yield* Ref.get(handlers).pipe(
					Effect.flatMap((handlerMap) => Option.match(HashMap.get(handlerMap, envelope.type), {
						onNone: () => Effect.fail(JobError.from(jobId, 'HandlerMissing', { type: envelope.type })),
						onSome: Effect.succeed,
					})),
				);
				const tenantId = envelope.tenantId;
				const ts = yield* Clock.currentTimeMillis;
				yield* _transitionState(jobId, tenantId, 'processing', ts);
				yield* publishStatus(jobId, envelope.type, 'processing', tenantId);
				yield* Effect.when(Entity.keepAlive(true), () => envelope.duration === 'long');
				const retryWithStateTracking = _retryBase(_CONFIG.retry.job).pipe(
					Schedule.resetAfter(_CONFIG.retry.job.resetAfter),
					Schedule.whileInput((error: JobError) => !error.isTerminal),
					Schedule.tapInput((error: JobError) => Clock.currentTimeMillis.pipe(
						Effect.flatMap((retryTs) => Effect.all([
							_transitionState(jobId, tenantId, 'processing', retryTs, { error: String(error.cause) }).pipe(Effect.asVoid),
							Metric.increment(metrics.jobs.retries),
						], { discard: true })),
					)),
					Schedule.tapOutput(([delay, attempt]) => Effect.all([Metric.update(Metric.taggedWithLabels(metrics.jobs.waitDuration, MetricsService.label({ job_type: envelope.type })), delay), Effect.annotateCurrentSpan({ 'retry.attempt': attempt + 1, 'retry.delay_ms': Duration.toMillis(delay) })], { discard: true })),
				);
				yield* Effect.provideService(
					handler(envelope.payload).pipe(Effect.mapError((error) => JobError.from(jobId, 'Processing', error))),
					JobContext,
					{
						jobId,
						priority: envelope.priority ?? 'normal',
						reportProgress: (pct, message) => {
							const progress = { message, pct };
							return _progressHub(jobId).get.pipe(
								Effect.flatMap((hub) => PubSub.publish(hub, progress)),
								Effect.zipRight(_persistProgress(jobId, tenantId, progress)),
								Effect.asVoid,
							);
						},
						tenantId,
					},
				).pipe(
					Effect.catchTag('JobError', (error) => error.isTerminal ? handleFailure(jobId, envelope, error) : Effect.fail(error)),
					Effect.catchAll((error) => Effect.fail(JobError.from(jobId, 'Processing', error))),
					Effect.retryOrElse(retryWithStateTracking, (lastError) => handleFailure(jobId, envelope, JobError.from(jobId, 'MaxRetries', lastError.cause)).pipe(Effect.catchAll((nested) => Effect.fail(JobError.from(jobId, 'Processing', nested))))),
					MetricsService.trackJob({ jobType: envelope.type, operation: 'process', priority: envelope.priority }),
					Effect.ensuring(Effect.when(Entity.keepAlive(false), () => envelope.duration === 'long')),
				);
				const completeTs = yield* Clock.currentTimeMillis;
				const state = yield* _transitionState(jobId, tenantId, 'complete', completeTs);
				yield* Effect.all([
					publishStatus(jobId, envelope.type, 'complete', tenantId),
					eventBus.emit({
						aggregateId: jobId,
						payload: { _tag: 'job', action: 'completed', result: state.result, type: envelope.type },
						tenantId,
					}),
					Metric.increment(metrics.jobs.completions),
					_progressHub(jobId).cleanup,
					Effect.logDebug('Job completed', { 'job.elapsed': Duration.format(Duration.millis(completeTs - ts)) }),
				], { discard: true });
			}).pipe(
				Effect.onInterrupt(() => Clock.currentTimeMillis.pipe(
					Effect.flatMap((cancelTs) => Effect.all([
						_transitionState(jobId, envelope.tenantId, 'cancelled', cancelTs).pipe(Effect.asVoid),
						publishStatus(jobId, envelope.type, 'cancelled', envelope.tenantId),
						eventBus.emit({
							aggregateId: jobId,
							payload: { _tag: 'job', action: 'cancelled', type: envelope.type },
							tenantId: envelope.tenantId,
						}),
						Metric.increment(metrics.jobs.cancellations),
						_progressHub(jobId).cleanup,
					], { discard: true })),
					Effect.catchAllCause(() => Effect.void),
				)),
			),
		)),
		'job.process',
		{ 'job.id': jobId, 'job.type': envelope.type, metrics: false },
	);
	return {
		cancel: ({ payload: { jobId } }) => FiberMap.has(runningJobs, jobId).pipe(
			Effect.flatMap((isRunning) => isRunning
				? FiberMap.remove(runningJobs, jobId)
				: Ref.get(jobStates).pipe(
					Effect.map(HashMap.get(jobId)),
					Effect.flatMap(Option.match({
						onNone: () => Effect.fail(JobError.from(jobId, 'NotFound')),
						onSome: (state) => Effect.fail(JobError.from(jobId, _StatusProps[state.status].cancelError)),
					})),
				),
			),
		),
		progress: (envelope) => {
			const jobId = envelope.payload.jobId;
			const tenantId = envelope.payload.tenantId;
			return Effect.all([_progressHub(jobId).get, _readProgress(jobId, tenantId)]).pipe(
				Effect.map(([hub, last]) => Stream.concat(
					Option.match(last, { onNone: () => Stream.empty, onSome: (progress) => Stream.make(progress as typeof JobProgress.Type) }),
					Stream.fromPubSub(hub),
				).pipe(Stream.tap(() => Metric.increment(Metric.taggedWithLabels(metrics.stream.elements, MetricsService.label({ stream: 'job_progress' })))))),
				Effect.catchAll(() => Effect.succeed(Stream.empty)),
				Stream.unwrap,
			);
		},
		status: (envelope) => Ref.get(jobStates).pipe(
			Effect.flatMap((states) => Option.match(HashMap.get(states, envelope.payload.jobId), {
				onNone: () => _readState(envelope.payload.jobId, envelope.payload.tenantId).pipe(Effect.map((opt) => Option.match(opt, { onNone: () => JobState.defaultResponse, onSome: (state) => state.toResponse() })),),
				onSome: (state) => Effect.succeed(state.toResponse()),
			})),
			Effect.catchAll(() => Effect.succeed(JobState.defaultResponse)),
		),
		submit: (envelope) => Effect.gen(function* () {
			const jobId = yield* sharding.getSnowflake.pipe(Effect.map(String));
			const queuedTs = yield* Clock.currentTimeMillis;
			const state = JobState.transition(null, 'queued', queuedTs);
			yield* Context.Request.withinSync(envelope.payload.tenantId, db.jobs.insert({
				appId: envelope.payload.tenantId,
				attempts: state.attempts,
				batchId: Option.fromNullable(envelope.payload.batchId),
				completedAt: Option.none(),
				dedupeKey: Option.fromNullable(envelope.payload.dedupeKey),
				history: state.history,
				jobId,
				lastError: Option.none(),
				maxAttempts: envelope.payload.maxAttempts,
				payload: envelope.payload.payload,
				priority: envelope.payload.priority,
				progress: Option.none(),
				result: Option.none(),
				scheduledAt: Option.fromNullable(envelope.payload.scheduledAt).pipe(Option.map((ts) => new Date(ts))),
				status: state.status,
				type: envelope.payload.type,
				updatedAt: undefined,
			})).pipe(Effect.mapError((e) => JobError.from(jobId, 'Processing', e)), Effect.provideService(SqlClient.SqlClient, sql));
			yield* Ref.update(jobStates, HashMap.set(jobId, state));
			yield* _persistStateCache(jobId, state);
			yield* publishStatus(jobId, envelope.payload.type, 'queued', envelope.payload.tenantId);
			yield* Metric.increment(metrics.jobs.enqueued);
			yield* FiberMap.run(runningJobs, jobId)(processJob(jobId, envelope.payload).pipe(Effect.provideService(SqlClient.SqlClient, sql)));
			return { duplicate: false, jobId };
		}),
	};
}), {
	concurrency: _CONFIG.entity.concurrency,
	defectRetryPolicy: _retryBase(_CONFIG.retry.defect),
	mailboxCapacity: _CONFIG.entity.mailboxCapacity,
	maxIdleTime: _CONFIG.entity.maxIdleTime,
	spanAttributes: { 'entity.service': 'job-processing', 'entity.version': 'v1' },
});

// --- [SERVICES] --------------------------------------------------------------

class JobRuntime extends Effect.Service<JobRuntime>()('server/JobRuntime', {
	scoped: Effect.gen(function* () {
		const handlers = yield* Ref.make(HashMap.empty<string, (payload: unknown) => Effect.Effect<unknown, unknown, never>>());
		const statusHub = yield* PubSub.sliding<typeof JobStatusEvent.Type>(_CONFIG.statusHub.capacity);
		return { handlers, statusHub };
	}),
}) {}
class JobService extends Effect.Service<JobService>()('server/Jobs', {
	dependencies: [
		JobEntityLive.pipe(Layer.provideMerge(Layer.mergeAll(ClusterService.Layer, JobRuntime.Default, DatabaseService.Default))),
		DatabaseService.Default,
		EventBus.Default,
		JobRuntime.Default,
		MetricsService.Default,
	],
	scoped: Effect.gen(function* () {
		const { sharding, db, counter, runtime } = yield* Effect.all({ counter: Ref.make(0), db: DatabaseService, runtime: JobRuntime, sharding: Sharding.Sharding });
		const { handlers, statusHub } = runtime;
		const getClient = yield* sharding.makeClient(JobEntity);
		const routeByPriority = (priority: keyof typeof _CONFIG.pools) => Ref.modify(counter, (count) => [EntityId.make(`job-${priority}-${count % _CONFIG.pools[priority]}`), count + 1] as const);
		const submit = <T>(type: string, payloads: T | readonly T[], opts?: { dedupeKey?: string; maxAttempts?: number; priority?: typeof JobPriority.Type; scheduledAt?: number }) =>
			Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => Effect.gen(function* () {
					const items = Array.isArray(payloads) ? Chunk.fromIterable(payloads) : Chunk.of(payloads);
					const isBatch = Chunk.size(items) > 1;
					const priority = opts?.priority ?? 'normal';
					const batchId = yield* Match.value(isBatch).pipe(
						Match.when(true, () => sharding.getSnowflake.pipe(Effect.map(String))),
						Match.orElse(() => Effect.succeed(undefined)),
					);
					const deliverAt = Option.fromNullable(opts?.scheduledAt).pipe(
						Option.map((scheduledAt) => ({ [DeliverAt.symbol]: () => DateTime.unsafeMake(scheduledAt) }) as const),
						Option.getOrElse(() => ({} as const)),
					);
					const results = yield* Effect.forEach(items, (payload, index) =>
						routeByPriority(priority).pipe(
							Effect.flatMap((entityId) => Context.Request.withinCluster({ entityId, entityType: 'Job' })(
								getClient(entityId)['submit']({ ...deliverAt, batchId, dedupeKey: opts?.dedupeKey ? `${opts.dedupeKey}:${index}` : undefined, maxAttempts: opts?.maxAttempts, payload, priority, scheduledAt: opts?.scheduledAt, tenantId, type }).pipe(Effect.map((result) => result.jobId)),
							)),
						), { concurrency: 'unbounded' });
					return isBatch ? results : results[0];
				})),
				Telemetry.span('job.submit', { 'job.type': type, metrics: false }),
			);
		const validateBatch = <T>(items: readonly T[], validator: (item: T) => Effect.Effect<void, JobError>) => Effect.forEach(items, (item, index) => validator(item).pipe(Effect.mapError((error) => ({ error, index }))), { concurrency: 'unbounded' }).pipe(Effect.asVoid);
		const replay = (dlqId: string) => Telemetry.span(
			db.jobDlq.one([{ field: 'id', value: dlqId }]).pipe(
				Effect.flatMap((opt) => Option.match(opt, {
					onNone: () => Effect.fail(JobError.from(dlqId, 'NotFound')),
					onSome: (entry: typeof JobDlq.Type) => submit(entry.type, entry.payload, { priority: 'normal' }).pipe(Effect.zipRight(db.jobDlq.markReplayed(dlqId))),
				})),
			),
			'job.replay',
			{ 'dlq.id': dlqId },
		);
		const statusStream = yield* Stream.fromPubSub(statusHub, { scoped: true });	// Create scoped stream from statusHub for SSE consumption
		const isLocal = (entityId: string) => Effect.sync(() => sharding.hasShardId(sharding.getShardId(EntityId.make(entityId), 'Job')));
		const recoverInFlight = Telemetry.span(sharding.pollStorage.pipe(Effect.tap(() => Effect.logInfo('Job message storage polled for recovery'))), 'job.recoverInFlight', {});
		const resetJob = (jobId: string) => Telemetry.span(sharding.reset(Snowflake.Snowflake(jobId)).pipe(Effect.flatMap((ok) => ok ? Effect.logInfo('Job state reset', { jobId }) : Effect.fail(JobError.from(jobId, 'NotFound')))), 'job.reset', { 'job.id': jobId });
		return {
			cancel: (jobId: string) => Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => getClient(jobId)['cancel']({ jobId, tenantId }).pipe(Effect.mapError(_mapRpcError(jobId))),),
				Telemetry.span('job.cancel', { 'job.id': jobId, metrics: false }),
			),
			isLocal,
			onStatusChange: () => statusStream,
			recoverInFlight,
			registerHandler: <T>(type: string, handler: (payload: T) => Effect.Effect<void, unknown, never>) => Ref.update(handlers, HashMap.set(type, handler as (payload: unknown) => Effect.Effect<unknown, unknown, never>)),
			replay,
			resetJob,
			status: (jobId: string) => Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => getClient(jobId)['status']({ jobId, tenantId }).pipe(Effect.mapError(_mapRpcError(jobId))),),
				Telemetry.span('job.status', { 'job.id': jobId, metrics: false }),
			),
			submit,
			validateBatch,
		};
	}),
}) {
	static readonly Config = _CONFIG;
	static readonly Context = JobContext;
	static readonly Error = JobError;
	static readonly Payload = JobPayload;
	static readonly State = JobState;
	static readonly StatusEvent = JobStatusEvent;
	static readonly StatusResponse = JobStatusResponse;
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace JobService {
	export type Handler = (payload: unknown) => Effect.Effect<void, JobError, never>;
	export type Error = InstanceType<typeof JobError>;
	export type Context = Effect.Effect.Context<typeof JobContext>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { JobService };
