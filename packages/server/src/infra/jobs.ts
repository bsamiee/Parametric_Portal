/**
 * Entity-based job processing via @effect/cluster mailbox dispatch.
 * Replaces poll-based queue with instant consistent-hash routing.
 */
import { DeliverAt, Entity, EntityId, Sharding, Snowflake } from '@effect/cluster';
import { Rpc, RpcClientError } from '@effect/rpc';
import { SqlClient } from '@effect/sql';
import { Chunk, Clock, DateTime, Duration, Effect, FiberMap, HashMap, Layer, Mailbox, Metric, Option, PubSub, Ref, Schedule, Schema as S, Stream } from 'effect';
import { DatabaseService } from '@parametric-portal/database/repos';
import type { JobDlq } from '@parametric-portal/database/models';
import { Resilience } from '../utils/resilience.ts';
import { Context } from '../context.ts';
import { CacheService } from '../platform/cache.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { ClusterService } from './cluster.ts';
import { EventBus } from './events.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const _SCHEMA = {
	errorReason: S.Literal('NotFound', 'AlreadyCancelled', 'HandlerMissing', 'Validation', 'Processing', 'MaxRetries', 'RunnerUnavailable', 'Timeout'),
	priority: S.Literal('critical', 'high', 'normal', 'low'),
	progress: S.Struct({ message: S.String, pct: S.Number }),
	status: S.Literal('queued', 'processing', 'complete', 'failed', 'cancelled'),
} as const;

// --- [CLASSES] ---------------------------------------------------------------

class JobPayload extends S.Class<JobPayload>('JobPayload')({
	batchId: S.optional(S.String),
	dedupeKey: S.optional(S.String),
	duration: S.optionalWith(S.Literal('short', 'long'), { default: () => 'short' }),
	maxAttempts: S.optionalWith(S.Number, { default: () => 3 }),
	payload: S.Unknown,
	priority: S.optionalWith(_SCHEMA.priority, { default: () => 'normal' }),
	scheduledAt: S.optional(S.Number),
	tenantId: S.String,
	type: S.String,
}) {}
class JobStatusResponse extends S.Class<JobStatusResponse>('JobStatusResponse')({
	attempts: S.Number,
	history: S.Array(S.Struct({ error: S.optional(S.String), status: _SCHEMA.status, timestamp: S.Number })),
	result: S.optional(S.Unknown),
	status: _SCHEMA.status,
}) {}
class JobStatusEvent extends S.Class<JobStatusEvent>('JobStatusEvent')({
	error: S.optional(S.String),
	id: S.String,
	jobId: S.String,
	status: _SCHEMA.status,
	tenantId: S.String,
	type: S.String,
}) {}

// --- [STATE] -----------------------------------------------------------------

class JobState extends S.Class<JobState>('JobState')({
	attempts: S.Number,
	completedAt: S.optional(S.Number),
	createdAt: S.Number,
	history: S.Array(S.Struct({ error: S.optional(S.String), status: _SCHEMA.status, timestamp: S.Number })),
	lastError: S.optional(S.String),
	result: S.optional(S.Unknown),
	status: _SCHEMA.status,
}) {
	static readonly _statusProps = {
		cancelled: 	{ cancelError: 'AlreadyCancelled', 	incrementOnEntry: false, incrementOnRetry: false, terminal: true  },
		complete: 	{ cancelError: 'AlreadyCancelled', 	incrementOnEntry: false, incrementOnRetry: false, terminal: true  },
		failed: 	{ cancelError: 'AlreadyCancelled', 	incrementOnEntry: true,  incrementOnRetry: false, terminal: true  },
		processing: { cancelError: 'NotFound', 			incrementOnEntry: false, incrementOnRetry: true,  terminal: false },
		queued: 	{ cancelError: 'NotFound', 			incrementOnEntry: false, incrementOnRetry: false, terminal: false },
	} as const satisfies Record<typeof _SCHEMA.status.Type, { cancelError: 'AlreadyCancelled' | 'NotFound'; incrementOnEntry: boolean; incrementOnRetry: boolean; terminal: boolean }>;
	static readonly transition = (
		state: JobState | null,
		to: typeof _SCHEMA.status.Type,
		ts: number,
		opts?: { error?: string; result?: unknown },): JobState => {
		const base = state ?? new JobState({ attempts: 0, createdAt: ts, history: [], status: 'queued' });
		const props = JobState._statusProps[to];
		return new JobState({
			...base,
			attempts: base.attempts + Number(props.incrementOnEntry) + Number(props.incrementOnRetry && opts?.error !== undefined),
			completedAt: props.terminal ? ts : base.completedAt,
			history: [...base.history, { error: opts?.error, status: to, timestamp: ts }],
			lastError: opts?.error ?? base.lastError,
			result: opts?.result ?? base.result,
			status: to,
		});
	};
	get errorHistory(): readonly { error: string; timestamp: number }[] { return this.history.flatMap((entry) => entry.error ? [{ error: entry.error, timestamp: entry.timestamp }] : []); }
	static readonly fromRecord = (job: { attempts: number; completedAt: Option.Option<Date>; history: readonly { error?: string; status: string; timestamp: number }[]; jobId: string; lastError: Option.Option<string>; result: Option.Option<unknown>; status: string }) =>
		new JobState({
			attempts: job.attempts,
			completedAt: Option.getOrUndefined(Option.map(job.completedAt, (d: Date) => d.getTime())),
			createdAt: Snowflake.timestamp(Snowflake.Snowflake(job.jobId)),
			history: job.history as JobState['history'],
			lastError: Option.getOrUndefined(job.lastError),
			result: Option.getOrUndefined(job.result),
			status: job.status as typeof _SCHEMA.status.Type,
		});
	static readonly defaultResponse = new JobStatusResponse({ attempts: 0, history: [], status: 'queued' });
	toResponse(): typeof JobStatusResponse.Type { return new JobStatusResponse({ attempts: this.attempts, history: this.history, result: this.result, status: this.status }); }
}

// --- [ERRORS] ----------------------------------------------------------------

class JobError extends S.TaggedError<JobError>()('JobError', { cause: S.optional(S.Unknown), jobId: S.optional(S.String), reason: _SCHEMA.errorReason }) {
	static readonly _props = {
		AlreadyCancelled: 	{ retryable: false, terminal: true  },
		HandlerMissing: 	{ retryable: false, terminal: true  },
		MaxRetries: 		{ retryable: false, terminal: true  },
		NotFound: 			{ retryable: false, terminal: true  },
		Processing: 		{ retryable: true,  terminal: false },
		RunnerUnavailable: 	{ retryable: true,  terminal: false },
		Timeout: 			{ retryable: true,  terminal: false },
		Validation: 		{ retryable: false, terminal: true  },
	} as const satisfies Record<typeof _SCHEMA.errorReason.Type, { retryable: boolean; terminal: boolean }>;
	static readonly from = (jobId: string, reason: typeof _SCHEMA.errorReason.Type, cause?: unknown) => new JobError({ cause, jobId, reason });
	static readonly fromRpc = (jobId: string) => (error: unknown): JobError =>
		error !== null && typeof error === 'object' && RpcClientError.TypeId in error
			? JobError.from(jobId, 'RunnerUnavailable', error)
			: JobError.from(jobId, 'Processing', error);
	get isTerminal(): boolean { return JobError._props[this.reason].terminal; }
	get isRetryable(): boolean { return JobError._props[this.reason].retryable; }
}

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	cache: { keyPrefix: 'job:', ttl: Duration.days(7) },
	entity: { concurrency: 1, mailboxCapacity: 100, maxIdleTime: Duration.minutes(5) },
	pools: { critical: 4, high: 3, low: 1, normal: 2 },
	retry: {
		cap: Duration.seconds(30),
		defect: { base: Duration.millis(100), maxAttempts: 5 },
		job: { base: Duration.millis(100), maxAttempts: 5, resetAfter: Duration.minutes(5) },
	},
	statusHub: { capacity: 256 },
} as const;
const _retryBase = (cfg: { readonly base: Duration.Duration; readonly maxAttempts: number }): Schedule.Schedule<[Duration.Duration, number], unknown, never> =>
	Resilience.schedule({ base: cfg.base, cap: _CONFIG.retry.cap, maxAttempts: cfg.maxAttempts }) as Schedule.Schedule<[Duration.Duration, number], unknown, never>;

// --- [CONTEXT] ---------------------------------------------------------------

class JobContext extends Effect.Tag('JobContext')<JobContext, {
	readonly jobId: string;
	readonly priority: typeof _SCHEMA.priority.Type;
	readonly reportProgress: (pct: number, message: string) => Effect.Effect<void>;
	readonly tenantId: string;
}>() {}

// --- [LAYERS] ----------------------------------------------------------------
// Module-level: required before class definition (forward ref from extends clause)

class _JobInternal extends Effect.Tag('_JobInternal')<_JobInternal, {
	readonly handlers: Ref.Ref<HashMap.HashMap<string, (payload: unknown) => Effect.Effect<unknown, unknown, never>>>;
	readonly statusHub: PubSub.PubSub<typeof JobStatusEvent.Type>;
}>() {}
const _JobInternalLive = Layer.scoped(_JobInternal, Effect.gen(function* () {
	const handlers = yield* Ref.make(HashMap.empty<string, (payload: unknown) => Effect.Effect<unknown, unknown, never>>());
	const statusHub = yield* PubSub.sliding<typeof JobStatusEvent.Type>(_CONFIG.statusHub.capacity);
	return { handlers, statusHub };
}));
const JobEntity = Entity.make('Job', [
	Rpc.make('submit', { error: JobError, payload: JobPayload.fields, primaryKey: (payload: typeof JobPayload.Type) => payload.dedupeKey ?? crypto.randomUUID(), success: S.Struct({ duplicate: S.Boolean, jobId: S.String }) }),
	Rpc.make('status', { payload: S.Struct({ jobId: S.String, tenantId: S.String }), success: JobStatusResponse }),
	Rpc.make('progress', { payload: S.Struct({ jobId: S.String, tenantId: S.String }), stream: true, success: S.Struct({ message: S.String, pct: S.Number }) }),
	Rpc.make('cancel', { error: JobError, payload: S.Struct({ jobId: S.String, tenantId: S.String }), success: S.Void }),
]);
const JobEntityLive = JobEntity.toLayer(Effect.gen(function* () {
	const currentAddress = yield* Entity.CurrentAddress;
	const { handlers, statusHub } = yield* _JobInternal;
	const runningJobs = yield* FiberMap.make<string>();
	yield* Effect.addFinalizer(() => FiberMap.join(runningJobs).pipe(Effect.ignore));
	const progressMailboxes = yield* Ref.make(HashMap.empty<string, Mailbox.Mailbox<{ pct: number; message: string }>>());
	const { cache, database, eventBus, metrics, sharding, sql } = yield* Effect.all({cache: CacheService, database: DatabaseService, eventBus: EventBus, metrics: MetricsService, sharding: Sharding.Sharding, sql: SqlClient.SqlClient,});
		const _runtime = {
			handlers: {
				resolve: (jobId: string, type: string) => Ref.get(handlers).pipe(
					Effect.flatMap((handlerMap) => Option.match(HashMap.get(handlerMap, type), {
						onNone: () => Effect.fail(JobError.from(jobId, 'HandlerMissing', { type })),
						onSome: Effect.succeed,
					})),
				),
			},
			keys: {
				progress: (jobId: string) => `${_CONFIG.cache.keyPrefix}progress:${jobId}`,
				state: (jobId: string) => `${_CONFIG.cache.keyPrefix}state:${jobId}`,
			},
			progress: {
				mailbox: {
					cleanup: (jobId: string) => Ref.modify(progressMailboxes, (mailboxes) => [HashMap.get(mailboxes, jobId), HashMap.remove(mailboxes, jobId)] as const).pipe(
						Effect.flatMap(Option.match({
							onNone: () => Effect.void,
							onSome: (mailbox) => mailbox.end.pipe(Effect.asVoid),
						})),
					),
					get: (jobId: string) => Ref.get(progressMailboxes).pipe(
						Effect.flatMap((mailboxes) => Option.match(HashMap.get(mailboxes, jobId), {
							onNone: () => Mailbox.make<{ pct: number; message: string }>({ capacity: 16, strategy: 'sliding' }).pipe(
								Effect.tap((mailbox) => Ref.update(progressMailboxes, HashMap.set(jobId, mailbox))),
							),
							onSome: Effect.succeed,
						})),
					),
				},
				read: (jobId: string, tenantId: string) => cache.kv.get(_runtime.keys.progress(jobId), _SCHEMA.progress).pipe(
					Effect.flatMap(Option.match({
						onNone: () => Context.Request.withinSync(tenantId, database.jobs.one([{ field: 'job_id', value: jobId }])).pipe(
							Effect.map(Option.flatMap((job) => job.progress)),
							Effect.tap(Option.match({
								onNone: () => Effect.void,
								onSome: (progress) => cache.kv.set(_runtime.keys.progress(jobId), progress, _CONFIG.cache.ttl),
							})),
							Effect.provideService(SqlClient.SqlClient, sql),
						),
						onSome: (progress) => Effect.succeed(Option.some(progress)),
					})),
				),
				write: (jobId: string, tenantId: string, progress: typeof _SCHEMA.progress.Type) => Effect.all([
					cache.kv.set(_runtime.keys.progress(jobId), progress, _CONFIG.cache.ttl),
					Context.Request.withinSync(tenantId, database.jobs.set(jobId, { progress: Option.some(progress) })).pipe(
						Effect.tapError((error) => Effect.logWarning('Job progress persist failed', { error: String(error), jobId })),
						Effect.ignore,
						Effect.provideService(SqlClient.SqlClient, sql),
					),
				], { discard: true }),
			},
			state: {
				read: (jobId: string, tenantId: string) => cache.kv.get(_runtime.keys.state(jobId), JobState).pipe(
					Effect.flatMap(Option.match({
						onNone: () => Context.Request.withinSync(tenantId, database.jobs.one([{ field: 'job_id', value: jobId }])).pipe(
							Effect.flatMap(Option.match({
								onNone: () => Effect.succeed(Option.none<JobState>()),
								onSome: (job) => Effect.succeed(Option.some(JobState.fromRecord(job))),
							})),
							Effect.tap(Option.match({
								onNone: () => Effect.void,
								onSome: (state) => cache.kv.set(_runtime.keys.state(jobId), state, _CONFIG.cache.ttl),
							})),
							Effect.provideService(SqlClient.SqlClient, sql),
						),
						onSome: (state) => Effect.succeed(Option.some(state)),
					})),
				),
				transition: (jobId: string, tenantId: string, status: typeof _SCHEMA.status.Type, timestamp: number, options?: { error?: string; result?: unknown }) =>
					_runtime.state.read(jobId, tenantId).pipe(
						Effect.map(Option.getOrElse(() => null)),
						Effect.map((current) => JobState.transition(current, status, timestamp, options)),
						Effect.tap((state) => _runtime.state.write(jobId, tenantId, state)),
					),
				write: (jobId: string, tenantId: string, state: JobState) => Effect.all([
					cache.kv.set(_runtime.keys.state(jobId), state, _CONFIG.cache.ttl),
					Context.Request.withinSync(tenantId, database.jobs.set(jobId, {
						attempts: state.attempts,
						completedAt: Option.fromNullable(state.completedAt).pipe(Option.map((timestamp) => new Date(timestamp))),
						history: state.history,
						lastError: Option.fromNullable(state.lastError),
						result: Option.fromNullable(state.result),
						status: state.status,
					})).pipe(
						Effect.tapError((error) => Effect.logWarning('Job state persist failed', { error: String(error), jobId })),
						Effect.ignore,
						Effect.provideService(SqlClient.SqlClient, sql),
					),
				], { discard: true }),
			},
			status: {
				publish: (jobId: string, type: string, status: typeof _SCHEMA.status.Type, tenantId: string, error?: string) => sharding.getSnowflake.pipe(
					Effect.flatMap((snowflake) => PubSub.publish(statusHub, new JobStatusEvent({ error, id: String(snowflake), jobId, status, tenantId, type }))),
				),
			},
		} as const;
		const _executeHandler = (context: {
			readonly envelope: typeof JobPayload.Type;
			readonly handler: (payload: unknown) => Effect.Effect<unknown, unknown, never>;
			readonly jobId: string;
		}) => {
			const { envelope, handler, jobId } = context;
			const tenantId = envelope.tenantId;
			const retryWithStateTracking = _retryBase(_CONFIG.retry.job).pipe(
				Schedule.resetAfter(_CONFIG.retry.job.resetAfter),
				Schedule.whileInput((error: JobError) => !error.isTerminal),
				Schedule.tapInput((error: JobError) => Clock.currentTimeMillis.pipe(
					Effect.flatMap((retryTs) => Effect.all([
						_runtime.state.transition(jobId, tenantId, 'processing', retryTs, { error: String(error.cause) }).pipe(Effect.asVoid, Effect.ignore),
						Metric.increment(metrics.jobs.retries),
					], { discard: true })),
				)),
				Schedule.tapOutput(([delay, attempt]: [Duration.Duration, number]) => Effect.all([
				Metric.update(Metric.taggedWithLabels(metrics.jobs.waitDuration, MetricsService.label({ job_type: envelope.type })), delay),
				Effect.annotateCurrentSpan({ 'retry.attempt': attempt + 1, 'retry.delay_ms': Duration.toMillis(delay) }),
			], { discard: true })),
		);
		return Effect.provideService(
			handler(envelope.payload).pipe(Effect.mapError((error) => JobError.from(jobId, 'Processing', error))),
			JobContext,
			{
					jobId,
					priority: envelope.priority ?? 'normal',
					reportProgress: (pct, message) => _runtime.progress.mailbox.get(jobId).pipe(
						Effect.flatMap((mailbox) => mailbox.offer({ message, pct })),
						Effect.zipRight(_runtime.progress.write(jobId, tenantId, { message, pct })),
						Effect.asVoid,
					),
					tenantId,
				},
			).pipe(
				Effect.catchTag('JobError', (error) => error.isTerminal ? _handleFailure({ envelope, error, jobId }) : Effect.fail(error)),
				Effect.catchAll((error) => Effect.fail(JobError.from(jobId, 'Processing', error))),
				Effect.retryOrElse(retryWithStateTracking, (lastError) =>
					_handleFailure({ envelope, error: JobError.from(jobId, 'MaxRetries', lastError.cause), jobId }).pipe(
						Effect.catchAll((nested) => Effect.fail(JobError.from(jobId, 'Processing', nested))),
					),
				),
				MetricsService.trackJob({ jobType: envelope.type, operation: 'process', priority: envelope.priority }),
				Effect.ensuring(Effect.when(Entity.keepAlive(false), () => envelope.duration === 'long')),
			);
		};
		const _handleCompletion = (context: { readonly envelope: typeof JobPayload.Type; readonly jobId: string; readonly startTs: number }) =>
			Clock.currentTimeMillis.pipe(
				Effect.flatMap((completeTs) => _runtime.state.transition(context.jobId, context.envelope.tenantId, 'complete', completeTs).pipe(
					Effect.tap((state) => Effect.all([
						_runtime.status.publish(context.jobId, context.envelope.type, 'complete', context.envelope.tenantId),
						eventBus.publish({
							aggregateId: context.jobId,
							payload: { _tag: 'job', action: 'completed', result: state.result, type: context.envelope.type },
							tenantId: context.envelope.tenantId,
						}),
						Metric.increment(metrics.jobs.completions),
						_runtime.progress.mailbox.cleanup(context.jobId),
						Effect.logDebug('Job completed', { 'job.elapsed': Duration.format(Duration.millis(completeTs - context.startTs)) }),
					], { discard: true })),
				)),
			);
		const _handleFailure = (context: { readonly envelope: typeof JobPayload.Type; readonly error: JobError; readonly jobId: string }) =>
			Telemetry.span(
				Clock.currentTimeMillis.pipe(
					Effect.flatMap((failTs) => _runtime.state.transition(context.jobId, context.envelope.tenantId, 'failed', failTs, { error: String(context.error.cause) })),
					Effect.tap((state) => Effect.uninterruptible(Effect.all([
						Context.Request.withinSync(context.envelope.tenantId, database.jobDlq.insert({
							appId: context.envelope.tenantId,
							attempts: state.attempts,
							errorHistory: state.errorHistory,
							errorReason: context.error.reason,
							originalJobId: context.jobId,
							payload: context.envelope.payload,
							replayedAt: Option.none(),
							requestId: Option.none(),
							source: 'job',
							type: context.envelope.type,
							userId: Option.none(),
						})).pipe(Effect.zipRight(Metric.increment(metrics.jobs.deadLettered))),
						_runtime.status.publish(context.jobId, context.envelope.type, 'failed', context.envelope.tenantId, String(context.error.cause)),
						eventBus.publish({
							aggregateId: context.jobId,
							payload: { _tag: 'job', action: 'failed', reason: context.error.reason, type: context.envelope.type },
							tenantId: context.envelope.tenantId,
						}),
						Metric.increment(metrics.jobs.failures),
						_runtime.progress.mailbox.cleanup(context.jobId),
					], { discard: true }))),
					Effect.flatMap(() => Effect.fail(context.error)),
				),
				'job.handleFailure',
				{ 'error.reason': context.error.reason, 'job.id': context.jobId, metrics: false },
			);
		const processJob = (jobId: string, envelope: typeof JobPayload.Type) => Telemetry.span(
			Context.Request.within(envelope.tenantId, Context.Request.withinCluster({ entityId: currentAddress.entityId, entityType: currentAddress.entityType, shardId: currentAddress.shardId })(
				Effect.gen(function* () {
					const handler = yield* _runtime.handlers.resolve(jobId, envelope.type);
					const ts = yield* Clock.currentTimeMillis;
					yield* _runtime.state.transition(jobId, envelope.tenantId, 'processing', ts);
					yield* _runtime.status.publish(jobId, envelope.type, 'processing', envelope.tenantId);
					yield* Effect.when(Entity.keepAlive(true), () => envelope.duration === 'long');
					yield* _executeHandler({ envelope, handler, jobId });
					yield* _handleCompletion({ envelope, jobId, startTs: ts });
				}).pipe(
					Effect.onInterrupt(() => Clock.currentTimeMillis.pipe(
						Effect.flatMap((cancelTs) => Effect.all([
							_runtime.state.transition(jobId, envelope.tenantId, 'cancelled', cancelTs).pipe(Effect.asVoid),
							_runtime.status.publish(jobId, envelope.type, 'cancelled', envelope.tenantId),
							eventBus.publish({
								aggregateId: jobId,
								payload: { _tag: 'job', action: 'cancelled', type: envelope.type },
								tenantId: envelope.tenantId,
							}),
							Metric.increment(metrics.jobs.cancellations),
							_runtime.progress.mailbox.cleanup(jobId),
						], { discard: true })),
						Effect.catchAllCause(() => Effect.void),
					)),
				),
		)),
		'job.process',
		{ 'job.id': jobId, 'job.type': envelope.type, metrics: false },
	);
	const _toInsert = (jobId: string, payload: typeof JobPayload.Type, state: JobState) => ({
		appId: payload.tenantId,
		attempts: state.attempts,
		batchId: Option.fromNullable(payload.batchId),
		completedAt: Option.none(),
		dedupeKey: Option.fromNullable(payload.dedupeKey),
		history: state.history,
		jobId,
		lastError: Option.none(),
		maxAttempts: payload.maxAttempts,
		payload: payload.payload,
		priority: payload.priority,
		progress: Option.none(),
		result: Option.none(),
		scheduledAt: Option.fromNullable(payload.scheduledAt).pipe(Option.map((ts) => new Date(ts))),
		status: state.status,
		type: payload.type,
		updatedAt: undefined,
	});
		return {
			cancel: ({ payload: { jobId, tenantId } }) => FiberMap.has(runningJobs, jobId).pipe(
				Effect.flatMap((isRunning) => isRunning
					? FiberMap.remove(runningJobs, jobId)
					: _runtime.state.read(jobId, tenantId).pipe(Effect.flatMap(Option.match({
						onNone: () => Effect.fail(JobError.from(jobId, 'NotFound')),
						onSome: (state) => Effect.fail(JobError.from(jobId, JobState._statusProps[state.status].cancelError)),
					}))),
				),
				Effect.catchAll((error) => Effect.fail(error instanceof JobError ? error : JobError.from(jobId, 'Processing', error))),
			),
			progress: (envelope) => {
				const jobId = envelope.payload.jobId;
				const tenantId = envelope.payload.tenantId;
				return Effect.all([_runtime.progress.mailbox.get(jobId), _runtime.progress.read(jobId, tenantId)]).pipe(
					Effect.map(([mailbox, last]) => Stream.concat(
						Option.match(last, { onNone: () => Stream.empty, onSome: (progress) => Stream.make(progress as typeof _SCHEMA.progress.Type) }),
						Mailbox.toStream(mailbox),
					).pipe(Stream.tap(() => Metric.increment(Metric.taggedWithLabels(metrics.stream.elements, MetricsService.label({ stream: 'job_progress' })))))),
					Effect.catchAll(() => Effect.succeed(Stream.empty)),
					Stream.unwrap,
				);
			},
			status: (envelope) => _runtime.state.read(envelope.payload.jobId, envelope.payload.tenantId).pipe(
				Effect.map(Option.match({ onNone: () => JobState.defaultResponse, onSome: (state) => state.toResponse() })),
				Effect.catchAll(() => Effect.succeed(JobState.defaultResponse)),
			),
		submit: (envelope) => Effect.gen(function* () {
			const jobId = yield* sharding.getSnowflake.pipe(Effect.map(String));
			const queuedTs = yield* Clock.currentTimeMillis;
			const state = JobState.transition(null, 'queued', queuedTs);
			yield* Context.Request.withinSync(envelope.payload.tenantId, database.jobs.insert(_toInsert(jobId, envelope.payload, state))).pipe(
				Effect.mapError((error) => JobError.from(jobId, 'Processing', error)),
				Effect.provideService(SqlClient.SqlClient, sql),
			);
				yield* cache.kv.set(_runtime.keys.state(jobId), state, _CONFIG.cache.ttl);
				yield* _runtime.status.publish(jobId, envelope.payload.type, 'queued', envelope.payload.tenantId);
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

// --- [SERVICE] ---------------------------------------------------------------

class JobService extends Effect.Service<JobService>()('server/Jobs', {
	dependencies: [
			JobEntityLive.pipe(Layer.provideMerge(Layer.mergeAll(ClusterService.Layers.runner, _JobInternalLive, DatabaseService.Default))),
		DatabaseService.Default,
		EventBus.Default,
		_JobInternalLive,
		MetricsService.Default,
	],
	scoped: Effect.gen(function* () {
		const { handlers, statusHub } = yield* _JobInternal;
		const cluster = yield* ClusterService;
		const counter = yield* Ref.make(0);
		const sharding = yield* Sharding.Sharding;
		const getClient = yield* sharding.makeClient(JobEntity);
		const routeByPriority = (priority: keyof typeof _CONFIG.pools) => Ref.modify(counter, (count) => [EntityId.make(`job-${priority}-${count % _CONFIG.pools[priority]}`), count + 1] as const);
		const submit = <T>(type: string, payloads: T | readonly T[], opts?: { dedupeKey?: string; maxAttempts?: number; priority?: typeof _SCHEMA.priority.Type; scheduledAt?: number }) =>
			Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => Effect.gen(function* () {
					const items = Array.isArray(payloads) ? Chunk.fromIterable(payloads as readonly T[]) : Chunk.of(payloads as T);
					const isBatch = Chunk.size(items) > 1;
					const priority = opts?.priority ?? 'normal';
					const batchId = yield* (isBatch ? cluster.generateId.pipe(Effect.map(String)) : Effect.succeed(undefined));
					const deliverAt = Option.fromNullable(opts?.scheduledAt).pipe(
						Option.map((scheduledAt) => ({ [DeliverAt.symbol]: () => DateTime.unsafeMake(scheduledAt) }) as const),
						Option.getOrElse(() => ({} as const)),
					);
					const results = yield* Effect.forEach(items, (payload, index) =>
						routeByPriority(priority).pipe(
							Effect.flatMap((entityId) => Context.Request.withinCluster({ entityId, entityType: 'Job' })(
								getClient(entityId)['submit']({
									...deliverAt, batchId, dedupeKey: opts?.dedupeKey ? `${opts.dedupeKey}:${index}` : undefined,
									maxAttempts: opts?.maxAttempts, payload, priority, scheduledAt: opts?.scheduledAt, tenantId, type,
								}).pipe(Effect.map((result) => result.jobId)),
							)),
						), { concurrency: 'unbounded' });
					return isBatch ? results : results[0];
				})),
				Telemetry.span('job.submit', { 'job.type': type, metrics: false }),
			);
		const statusStream = yield* Stream.fromPubSub(statusHub, { scoped: true });
		return {
			cancel: (jobId: string) => Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => getClient(jobId)['cancel']({ jobId, tenantId }).pipe(Effect.mapError(JobError.fromRpc(jobId)))),
				Telemetry.span('job.cancel', { 'job.id': jobId, metrics: false }),
			),
			onStatusChange: () => statusStream,
			registerHandler: <T>(type: string, handler: (payload: T) => Effect.Effect<void, unknown, never>) => Ref.update(handlers, HashMap.set(type, handler as (payload: unknown) => Effect.Effect<unknown, unknown, never>)),
			status: (jobId: string) => Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => getClient(jobId)['status']({ jobId, tenantId }).pipe(Effect.mapError(JobError.fromRpc(jobId)))),
				Telemetry.span('job.status', { 'job.id': jobId, metrics: false }),
			),
			submit,
		};
	}),
}) {
	static readonly _Config = _CONFIG;
	static readonly _retryBase = _retryBase;
	static readonly _Schema = _SCHEMA;
	static readonly Context = JobContext;
	static readonly Error = JobError;
	static readonly Payload = JobPayload;
	static readonly State = JobState;
	static readonly StatusEvent = JobStatusEvent;
	static readonly StatusResponse = JobStatusResponse;
	static readonly replay = (dlqId: string) => JobService.pipe(Effect.flatMap((jobs) => {
		const fetchDlq = Effect.flatMap(DatabaseService, (db) => db.jobDlq.one([{ field: 'id', value: dlqId }]));
		return Telemetry.span(
			fetchDlq.pipe(
				Effect.flatMap(Option.match({
					onNone: () => Effect.fail(JobError.from(dlqId, 'NotFound')),
					onSome: (entry: typeof JobDlq.Type) => jobs.submit(entry.type, entry.payload, { priority: 'normal' }).pipe(
						Effect.flatMap(() => Effect.flatMap(DatabaseService, (db) => db.jobDlq.markReplayed(dlqId))),
					),
				})),
				),
				'job.replay',
				{ 'dlq.id': dlqId, metrics: false },
			);
		}));
	static readonly resetJob = (jobId: string) => Sharding.Sharding.pipe(
		Effect.flatMap((sharding) => Telemetry.span(
			sharding.reset(Snowflake.Snowflake(jobId)).pipe(Effect.flatMap((ok) => ok ? Effect.logInfo('Job state reset', { jobId }) : Effect.fail(JobError.from(jobId, 'NotFound'))),),
			'job.reset',
			{ 'job.id': jobId, metrics: false },
		)),
	);
	static readonly isLocal = (entityId: string) => ClusterService.pipe(Effect.flatMap((cluster) => cluster.isLocal(entityId)));
	static readonly recoverInFlight = Sharding.Sharding.pipe(
		Effect.flatMap((sharding) => Telemetry.span(
			sharding.pollStorage.pipe(Effect.tap(() => Effect.logInfo('Job message storage polled for recovery'))),
			'job.recoverInFlight',
			{ metrics: false },
		)),
	);
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace JobService {
	export type Handler = (payload: unknown) => Effect.Effect<void, JobError, never>;
	export type Error = InstanceType<typeof JobError>;
	export type Context = Effect.Effect.Context<typeof JobContext>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { JobService };
