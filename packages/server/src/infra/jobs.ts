/**
 * Entity-based job processing via @effect/cluster mailbox dispatch + @effect/workflow durable execution.
 * Workflow-first design: every job runs as a durable workflow with activities, compensation, and state persistence.
 * Entity sharding handles routing; workflow engine handles durability, retry, and rollback.
 * Includes scheduled purge (H1), automatic DLQ watcher (H2), and request context propagation (H3).
 */
import { ClusterWorkflowEngine, DeliverAt, Entity, EntityId, Sharding, Snowflake } from '@effect/cluster';
import { Rpc, RpcClientError } from '@effect/rpc';
import { Activity, DurableClock, Workflow, WorkflowEngine } from '@effect/workflow';
import { SqlClient } from '@effect/sql';
import { Chunk, Clock, Config, DateTime, Duration, Effect, Fiber, FiberMap, HashMap, Layer, Mailbox, Match, Metric, Option, Ref, Schedule, Schema as S, Stream } from 'effect';
import { DatabaseService } from '@parametric-portal/database/repos';
import type { Job, JobDlq } from '@parametric-portal/database/models';
import { Resilience } from '../utils/resilience.ts';
import { Context } from '../context.ts';
import { CacheService } from '../platform/cache.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { ClusterService } from './cluster.ts';
import { EventBus } from './events.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	cache: { keyPrefix: 'job:', ttl: Duration.days(7) },
	dlqWatcher: {backoffBase: Duration.seconds(5), backoffCap: Duration.minutes(5), checkInterval: Duration.minutes(5), maxRetries: 3,},
	entity: { concurrency: 1, mailboxCapacity: 100, maxIdleTime: Duration.minutes(5) },
	heartbeat: { interval: Duration.seconds(10), keyPrefix: 'job:heartbeat:', staleness: Duration.seconds(30) },
	pools: { critical: 4, high: 3, low: 1, normal: 2 },
	purge: {completedTtlDays: 7, failedTtlDays: 30, interval: Duration.hours(6),},
	retry: {cap: Duration.seconds(30), defect: { base: Duration.millis(100), maxAttempts: 5 }, job: { base: Duration.millis(100), maxAttempts: 5, resetAfter: Duration.minutes(5) },},
	workflow: {scheduledDelayThreshold: Duration.seconds(60),},
} as const;
const _PURGE_CFG = Config.all({
	completedTtlDays: 	Config.integer('JOB_PURGE_COMPLETED_TTL_DAYS').pipe(Config.withDefault(_CONFIG.purge.completedTtlDays)),
	failedTtlDays: 		Config.integer('JOB_PURGE_FAILED_TTL_DAYS').pipe(Config.withDefault(_CONFIG.purge.failedTtlDays)),
});
const _DLQ_WATCHER_CFG = Config.all({
	checkIntervalMs: 	Config.integer('JOB_DLQ_CHECK_INTERVAL_MS').pipe(Config.withDefault(Duration.toMillis(_CONFIG.dlqWatcher.checkInterval))),
	maxRetries: 		Config.integer('JOB_DLQ_MAX_RETRIES').pipe(Config.withDefault(_CONFIG.dlqWatcher.maxRetries)),
});
const _SCHEMA = {
	errorReason: S.Literal('NotFound', 'AlreadyCancelled', 'HandlerMissing', 'Validation', 'Processing', 'MaxRetries', 'RunnerUnavailable', 'Timeout'),
	historyEntry: S.Struct({ error: S.optional(S.String), status: S.Literal('queued', 'processing', 'complete', 'failed', 'cancelled'), timestamp: S.Number }),
	jobRef: S.Struct({ jobId: S.String, tenantId: S.String }),
	priority: S.Literal('critical', 'high', 'normal', 'low'),
	progress: S.Struct({ message: S.String, pct: S.Number }),
	status: S.Literal('queued', 'processing', 'complete', 'failed', 'cancelled'),
} as const;
const _STATUS_MODEL = {
	cancelled: { cancelError: 'AlreadyCancelled', incrementOnEntry: false, incrementOnRetry: false, terminal: true, transitions: new Set<typeof _SCHEMA.status.Type>() },
	complete: { cancelError: 'AlreadyCancelled', incrementOnEntry: false, incrementOnRetry: false, terminal: true, transitions: new Set<typeof _SCHEMA.status.Type>() },
	failed: { cancelError: 'AlreadyCancelled', incrementOnEntry: true, incrementOnRetry: false, terminal: true, transitions: new Set<typeof _SCHEMA.status.Type>(['processing']) },
	processing: { cancelError: 'NotFound', incrementOnEntry: false, incrementOnRetry: true, terminal: false, transitions: new Set<typeof _SCHEMA.status.Type>(['complete', 'failed', 'cancelled']) },
	queued: { cancelError: 'NotFound', incrementOnEntry: false, incrementOnRetry: false, terminal: false, transitions: new Set<typeof _SCHEMA.status.Type>(['processing', 'cancelled']) },
} as const satisfies Record<typeof _SCHEMA.status.Type, { cancelError: 'AlreadyCancelled' | 'NotFound'; incrementOnEntry: boolean; incrementOnRetry: boolean; terminal: boolean; transitions: ReadonlySet<typeof _SCHEMA.status.Type> }>;
const _ERROR_MODEL = {
	AlreadyCancelled: { retryable: false, terminal: true },
	HandlerMissing: { retryable: false, terminal: true },
	MaxRetries: { retryable: false, terminal: true },
	NotFound: { retryable: false, terminal: true },
	Processing: { retryable: true, terminal: false },
	RunnerUnavailable: { retryable: true, terminal: false },
	Timeout: { retryable: true, terminal: false },
	Validation: { retryable: false, terminal: true },
} as const satisfies Record<typeof _SCHEMA.errorReason.Type, { retryable: boolean; terminal: boolean }>;
const _WorkflowEngineLayer = Layer.unwrapEffect(Config.string('NODE_ENV').pipe(
	Config.withDefault('development'),
	Effect.map((environment) => Match.value(environment).pipe(
		Match.when('production', () => ClusterWorkflowEngine.layer.pipe(Layer.provide(ClusterService.Layers.runner))),
		Match.orElse(() => WorkflowEngine.layerMemory),
	)),
));

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _normalizeJobError = (jobId: string) => (error: unknown): JobError =>error instanceof JobError ? error : JobError.from(jobId, 'Processing', error);
const _retryBase = (config: { readonly base: Duration.Duration; readonly maxAttempts: number }): Schedule.Schedule<[Duration.Duration, number], unknown, never> =>
	Resilience.schedule({ base: config.base, cap: _CONFIG.retry.cap, maxAttempts: config.maxAttempts }) as Schedule.Schedule<[Duration.Duration, number], unknown, never>;
const _makeDlqWatcher = (submitFn: (type: string, payload: unknown, opts?: { priority?: typeof _SCHEMA.priority.Type }) => Effect.Effect<unknown, unknown, never>) =>
	Effect.gen(function* () {
		const database = yield* DatabaseService;
		const sql = yield* SqlClient.SqlClient;
		const eventBus = yield* EventBus;
		const dlqConfig = yield* _DLQ_WATCHER_CFG;
		const _dbRun = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>) => Context.Request.withinSync(tenantId, effect).pipe(Effect.provideService(SqlClient.SqlClient, sql));
		const retryAttempts = yield* Ref.make(HashMap.empty<string, number>());
		const retrySchedule = Schedule.exponential(_CONFIG.dlqWatcher.backoffBase).pipe(
			Schedule.union(Schedule.spaced(_CONFIG.dlqWatcher.backoffCap)),
			Schedule.intersect(Schedule.recurs(dlqConfig.maxRetries)),
		);
		const processDlqEntry = (entry: typeof JobDlq.Type) =>
			Ref.get(retryAttempts).pipe(
				Effect.map((attempts) => Option.getOrElse(HashMap.get(attempts, entry.id), () => 0)),
				Effect.flatMap((currentAttempts) =>
					currentAttempts >= dlqConfig.maxRetries
						? eventBus.publish({
							aggregateId: entry.originalJobId,
							payload: { _tag: 'DlqAlertEvent', action: 'alert', attempts: currentAttempts, errorReason: entry.errorReason, originalJobId: entry.originalJobId, type: entry.type },
							tenantId: entry.appId,
						}).pipe(
							Effect.tap(() => Ref.update(retryAttempts, HashMap.remove(entry.id))),
							Effect.tap(() => Effect.logWarning('DLQ entry exceeded max retries, alert emitted', { 'dlq.id': entry.id, 'dlq.max_retries': dlqConfig.maxRetries, 'dlq.type': entry.type })),
							Effect.asVoid,
						)
						: Context.Request.within(entry.appId,
							_dbRun(entry.appId, database.jobDlq.markReplayed(entry.id)).pipe(
								Effect.zipRight(submitFn(entry.type, entry.payload, { priority: 'normal' })),
								Effect.tap(() => Ref.update(retryAttempts, HashMap.remove(entry.id))),
								Effect.tap(() => Effect.logInfo('DLQ entry auto-replayed', { 'dlq.id': entry.id, 'dlq.type': entry.type })),
								Effect.catchAll((error) => Effect.all([
									Ref.update(retryAttempts, HashMap.set(entry.id, currentAttempts + 1)),
									_dbRun(entry.appId, database.jobDlq.unmarkReplayed(entry.id)).pipe(Effect.ignore),
									Effect.logWarning('DLQ auto-replay failed, will retry', { 'dlq.attempt': currentAttempts + 1, 'dlq.error': String(error), 'dlq.id': entry.id }),
								], { discard: true })),
								Effect.asVoid,
								Effect.retry(retrySchedule),
								Effect.catchAll((error) => Effect.logWarning('DLQ replay retry exhausted', { 'dlq.error': String(error), 'dlq.id': entry.id })),
							),
						),
				),
			);
		return Telemetry.span(
			database.jobDlq.listPending({ limit: 50 }).pipe(
				Effect.flatMap((page) => Effect.forEach(page.items, processDlqEntry, { discard: true })),
				Effect.tap(() => Effect.logDebug('DLQ watcher cycle completed')),
				Effect.catchAll((error) => Effect.logWarning('DLQ watcher cycle failed', { error: String(error) })),
			),
			'job.dlqWatcher',
			{ metrics: false },
		);
	});

// --- [CLASSES] ---------------------------------------------------------------

class JobPayload extends S.Class<JobPayload>('JobPayload')({
	batchId: S.optional(S.String),
	dedupeKey: S.optional(S.String),
	duration: S.optionalWith(S.Literal('short', 'long'), { default: () => 'short' }),
	ipAddress: S.optional(S.String),
	maxAttempts: S.optionalWith(S.Number, { default: () => 3 }),
	payload: S.Unknown,
	priority: S.optionalWith(_SCHEMA.priority, { default: () => 'normal' }),
	requestId: S.optional(S.String),
	scheduledAt: S.optional(S.Number),
	tenantId: S.String,
	type: S.String,
	userAgent: S.optional(S.String),
}) {}
class JobStatusResponse extends S.Class<JobStatusResponse>('JobStatusResponse')({
	attempts: S.Number,
	history: S.Array(_SCHEMA.historyEntry),
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
class JobState extends S.Class<JobState>('JobState')({
	attempts: S.Number,
	completedAt: S.optional(S.Number),
	createdAt: S.Number,
	history: S.Array(_SCHEMA.historyEntry),
	lastError: S.optional(S.String),
	result: S.optional(S.Unknown),
	status: _SCHEMA.status,
}) {
	static readonly transition = (
		state: JobState | null,
		to: typeof _SCHEMA.status.Type,
		timestamp: number,
		opts?: { error?: string; result?: unknown },): JobState => {
		const base = state ?? new JobState({ attempts: 0, createdAt: timestamp, history: [], status: 'queued' });
		const isIdempotent = base.status === to;
		const isValid = _STATUS_MODEL[base.status].transitions.has(to);
		const shouldApply = isValid || isIdempotent;
		return shouldApply
			? new JobState({
				...base,
				attempts: base.attempts + Number(_STATUS_MODEL[to].incrementOnEntry) + Number(_STATUS_MODEL[to].incrementOnRetry && opts?.error !== undefined),
				completedAt: _STATUS_MODEL[to].terminal ? timestamp : base.completedAt,
				history: [...base.history, { error: opts?.error, status: to, timestamp }],
				lastError: opts?.error ?? base.lastError,
				result: opts?.result ?? base.result,
				status: to,
			})
			: base;
	};
	get errorHistory(): readonly { error: string; timestamp: number }[] {return this.history.flatMap((entry) => entry.error ? [{ error: entry.error, timestamp: entry.timestamp }] : []);}
	static readonly fromRecord = (job: typeof Job.Type) =>
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
	toResponse(): typeof JobStatusResponse.Type {return new JobStatusResponse({ attempts: this.attempts, history: this.history, result: this.result, status: this.status });}
}
class JobContext extends Effect.Tag('JobContext')<JobContext, {
	readonly jobId: string;
	readonly priority: typeof _SCHEMA.priority.Type;
	readonly reportProgress: (pct: number, message: string) => Effect.Effect<void>;
	readonly tenantId: string;
}>() {}
class JobError extends S.TaggedError<JobError>()('JobError', { cause: S.optional(S.Unknown), jobId: S.optional(S.String), reason: _SCHEMA.errorReason }) {
	static readonly from = (jobId: string, reason: typeof _SCHEMA.errorReason.Type, cause?: unknown) => new JobError({ cause, jobId, reason });
	static readonly fromRpc = (jobId: string) => (error: unknown): JobError =>
		error !== null && typeof error === 'object' && RpcClientError.TypeId in error
			? JobError.from(jobId, 'RunnerUnavailable', error)
			: JobError.from(jobId, 'Processing', error);
	get isTerminal(): boolean { return _ERROR_MODEL[this.reason].terminal; }
	get isRetryable(): boolean { return _ERROR_MODEL[this.reason].retryable; }
}

// --- [WORKFLOW] --------------------------------------------------------------

const _JobWorkflow = Workflow.make({
	error: JobError,
	idempotencyKey: ({ jobId }) => jobId,
	name: 'JobExecution',
	payload: {envelope: JobPayload, jobId: S.String,},
	success: S.Unknown,
});

// --- [LAYERS] ----------------------------------------------------------------
// Module-level: required before class definition (forward ref from extends clause)

class _JobInternal extends Effect.Tag('_JobInternal')<_JobInternal, {
	readonly handlers: Ref.Ref<HashMap.HashMap<string, (payload: unknown) => Effect.Effect<unknown, unknown, never>>>;
}>() {}
const _JobInternalLive = Layer.scoped(_JobInternal, Effect.gen(function* () {
	const handlers = yield* Ref.make(HashMap.empty<string, (payload: unknown) => Effect.Effect<unknown, unknown, never>>());
	return { handlers };
}));
const JobEntity = Entity.make('Job', [
	Rpc.make('submit', { error: JobError, payload: JobPayload.fields, primaryKey: (payload: typeof JobPayload.Type) => payload.dedupeKey ?? crypto.randomUUID(), success: S.Struct({ duplicate: S.Boolean, jobId: S.String }) }),
	Rpc.make('status', { payload: _SCHEMA.jobRef, success: JobStatusResponse }),
	Rpc.make('progress', { payload: _SCHEMA.jobRef, stream: true, success: _SCHEMA.progress }),
	Rpc.make('cancel', { error: JobError, payload: _SCHEMA.jobRef, success: S.Void }),
]);
const JobEntityLive = JobEntity.toLayer(Effect.gen(function* () {
	const currentAddress = yield* Entity.CurrentAddress;
	const { handlers } = yield* _JobInternal;
	const runningJobs = yield* FiberMap.make<string>();
	const progressMailboxes = yield* Ref.make(HashMap.empty<string, Mailbox.Mailbox<{ pct: number; message: string }>>());
	const { cache, database, eventBus, metrics, sharding, sql } = yield* Effect.all({ cache: CacheService, database: DatabaseService, eventBus: EventBus, metrics: MetricsService, sharding: Sharding.Sharding, sql: SqlClient.SqlClient });
	const _entityLabels = MetricsService.label({ entity_type: 'Job' });
	const _activatedAt = yield* Clock.currentTimeMillis;
	const _dbRun = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>) => Context.Request.withinSync(tenantId, effect).pipe(Effect.provideService(SqlClient.SqlClient, sql));
	const _store = {
		progress: { cacheKey: (jobId: string) => `${_CONFIG.cache.keyPrefix}progress:${jobId}`, fromJob: (job: typeof Job.Type) => job.progress, schema: _SCHEMA.progress, toPatch: (value: typeof _SCHEMA.progress.Type) => ({ progress: Option.some(value) }), writeError: 'Job progress DB write failed' },
		state: { cacheKey: (jobId: string) => `${_CONFIG.cache.keyPrefix}state:${jobId}`, fromJob: (job: typeof Job.Type) => Option.some(JobState.fromRecord(job)), schema: JobState, toPatch: (value: JobState) => ({ attempts: value.attempts, completedAt: Option.fromNullable(value.completedAt).pipe(Option.map((timestamp) => new Date(timestamp))), history: value.history, lastError: Option.fromNullable(value.lastError), result: Option.fromNullable(value.result), status: value.status }), writeError: 'Job state DB write failed' },
	} as const;
	const _readStore = <A, I>(descriptor: { readonly cacheKey: (jobId: string) => string; readonly fromJob: (job: typeof Job.Type) => Option.Option<A>; readonly schema: S.Schema<A, I, never> }, jobId: string, tenantId: string) => cache.kv.get(descriptor.cacheKey(jobId), descriptor.schema).pipe(
		Effect.flatMap(Option.match({
			onNone: () => _dbRun(tenantId, database.jobs.one([{ field: 'job_id', value: jobId }])).pipe(Effect.map(Option.flatMap(descriptor.fromJob)), Effect.tap(Option.match({ onNone: () => Effect.void, onSome: (value) => cache.kv.set(descriptor.cacheKey(jobId), value, _CONFIG.cache.ttl) }))),
			onSome: (value) => Effect.succeed(Option.some(value)),
		})),
	);
	const _writeStore = <A>(descriptor: { readonly cacheKey: (jobId: string) => string; readonly toPatch: (value: A) => Parameters<DatabaseService.Type['jobs']['set']>[1]; readonly writeError: string }, jobId: string, tenantId: string, value: A) =>
		_dbRun(tenantId, database.jobs.set(jobId, descriptor.toPatch(value))).pipe(Effect.tapError((error) => Effect.logError(descriptor.writeError, { error: String(error), jobId })), Effect.tap(() => cache.kv.set(descriptor.cacheKey(jobId), value, _CONFIG.cache.ttl).pipe(Effect.ignore)));
	const _progressStreamLabels = MetricsService.label({ stream: 'job_progress' });
	const _runtime = {
		db: { run: _dbRun },
		handlers: { resolve: (jobId: string, type: string) => Ref.get(handlers).pipe(Effect.flatMap((handlerMap) => Option.match(HashMap.get(handlerMap, type), { onNone: () => Effect.fail(JobError.from(jobId, 'HandlerMissing', { type })), onSome: Effect.succeed }))) },
		heartbeat: {
			clear: (jobId: string) => cache.kv.del(`${_CONFIG.heartbeat.keyPrefix}${jobId}`).pipe(Effect.ignore),
			start: (jobId: string) => cache.kv.set(`${_CONFIG.heartbeat.keyPrefix}${jobId}`, Date.now(), _CONFIG.heartbeat.staleness).pipe(Effect.repeat(Schedule.spaced(_CONFIG.heartbeat.interval)), Effect.ignore),
			touch: (jobId: string) => cache.kv.set(`${_CONFIG.heartbeat.keyPrefix}${jobId}`, Date.now(), _CONFIG.heartbeat.staleness).pipe(Effect.ignore),
		},
		progress: {
			cleanup: (jobId: string) => Ref.modify(progressMailboxes, (mailboxes) => [HashMap.get(mailboxes, jobId), HashMap.remove(mailboxes, jobId)] as const).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (mailbox) => mailbox.end.pipe(Effect.asVoid) }))),
			getMailbox: (jobId: string) => Ref.get(progressMailboxes).pipe(Effect.flatMap((mailboxes) => Option.match(HashMap.get(mailboxes, jobId), { onNone: () => Mailbox.make<{ pct: number; message: string }>({ capacity: 16, strategy: 'sliding' }).pipe(Effect.tap((mailbox) => Ref.update(progressMailboxes, HashMap.set(jobId, mailbox)))), onSome: Effect.succeed }))),
			read: (jobId: string, tenantId: string) => _readStore(_store.progress, jobId, tenantId),
			report: (jobId: string, tenantId: string, progress: typeof _SCHEMA.progress.Type) => _runtime.progress.getMailbox(jobId).pipe(Effect.flatMap((mailbox) => mailbox.offer(progress)), Effect.zipRight(_writeStore(_store.progress, jobId, tenantId, progress).pipe(Effect.ignore)), Effect.asVoid),
			stream: (jobId: string, tenantId: string) => Effect.all([_runtime.progress.getMailbox(jobId), _runtime.progress.read(jobId, tenantId)]).pipe(Effect.map(([mailbox, last]) => Stream.concat(Option.match(last, { onNone: () => Stream.empty, onSome: (progress) => Stream.make(progress) }), Mailbox.toStream(mailbox)).pipe(Stream.tap(() => Metric.increment(Metric.taggedWithLabels(metrics.stream.elements, _progressStreamLabels)))))),
		},
		state: {
			read: (jobId: string, tenantId: string) => _readStore(_store.state, jobId, tenantId),
			transition: (jobId: string, tenantId: string, status: typeof _SCHEMA.status.Type, timestamp: number, options?: { error?: string; result?: unknown }) => _runtime.state.read(jobId, tenantId).pipe(Effect.map(Option.getOrElse(() => null)), Effect.map((current) => JobState.transition(current, status, timestamp, options)), Effect.tap((state) => _runtime.state.write(jobId, tenantId, state))),
			write: (jobId: string, tenantId: string, state: JobState) => _writeStore(_store.state, jobId, tenantId, state),
		},
		status: {
			publish: (jobId: string, type: string, status: typeof _SCHEMA.status.Type, tenantId: string, error?: string) => eventBus.publish({ aggregateId: jobId, payload: { _tag: 'JobStatusEvent', action: 'status', error, jobId, status, tenantId, type }, tenantId }).pipe(Effect.asVoid, Effect.catchAllCause((cause) => Effect.logWarning('Job status EventBus publish failed', { cause: String(cause), jobId }))),
		},
	} as const;
	const _lifecycle = (status: Exclude<typeof _SCHEMA.status.Type, 'queued'>, input: { readonly envelope: typeof JobPayload.Type; readonly error?: string; readonly extra?: (state: JobState) => Effect.Effect<void, unknown, unknown>; readonly jobId: string; readonly reason?: string; readonly result?: unknown; readonly timestamp: number }) =>
		_runtime.state.transition(input.jobId, input.envelope.tenantId, status, input.timestamp, { error: input.error, result: input.result }).pipe(
			Effect.tap((state) => Effect.all([
				Match.value(status).pipe(
					Match.when('processing', () => _runtime.status.publish(input.jobId, input.envelope.type, 'processing', input.envelope.tenantId)),
					Match.when('complete', () => Effect.all([
						_runtime.status.publish(input.jobId, input.envelope.type, 'complete', input.envelope.tenantId),
						eventBus.publish({ aggregateId: input.jobId, payload: { _tag: 'job', action: 'completed', result: state.result, type: input.envelope.type }, tenantId: input.envelope.tenantId }),
						Metric.increment(metrics.jobs.completions),
						_runtime.progress.cleanup(input.jobId),
					], { discard: true })),
					Match.when('failed', () => Effect.all([
						_runtime.status.publish(input.jobId, input.envelope.type, 'failed', input.envelope.tenantId, input.error),
						eventBus.publish({ aggregateId: input.jobId, payload: { _tag: 'job', action: 'failed', reason: input.reason ?? 'MaxRetries', type: input.envelope.type }, tenantId: input.envelope.tenantId }),
						Metric.increment(metrics.jobs.failures),
						_runtime.progress.cleanup(input.jobId),
					], { discard: true })),
					Match.when('cancelled', () => Effect.all([
						_runtime.status.publish(input.jobId, input.envelope.type, 'cancelled', input.envelope.tenantId),
						eventBus.publish({ aggregateId: input.jobId, payload: { _tag: 'job', action: 'cancelled', type: input.envelope.type }, tenantId: input.envelope.tenantId }),
						Metric.increment(metrics.jobs.cancellations),
						_runtime.progress.cleanup(input.jobId),
						_runtime.heartbeat.clear(input.jobId),
					], { discard: true })),
					Match.exhaustive,
				),
				Option.match(Option.fromNullable(input.extra), { onNone: () => Effect.void, onSome: (extra) => extra(state) }),
			], { discard: true })),
		);
	const _executeWorkflow = (jobId: string, envelope: typeof JobPayload.Type) => Telemetry.span(
		Context.Request.within(envelope.tenantId, Context.Request.withinCluster({ entityId: currentAddress.entityId, entityType: currentAddress.entityType, shardId: currentAddress.shardId })(
			Effect.gen(function* () {
				yield* Context.Request.update({ ipAddress: Option.fromNullable(envelope.ipAddress), requestId: envelope.requestId ?? crypto.randomUUID(), userAgent: Option.fromNullable(envelope.userAgent) });
				const handler = yield* _runtime.handlers.resolve(jobId, envelope.type);
				const startTimestamp = yield* Clock.currentTimeMillis;
				yield* _lifecycle('processing', { envelope, jobId, timestamp: startTimestamp });
				yield* Effect.when(Entity.keepAlive(true), () => envelope.duration === 'long');
				yield* _runtime.heartbeat.touch(jobId);
				const heartbeatFiber = yield* Effect.fork(_runtime.heartbeat.start(jobId));
				yield* Option.match(Option.fromNullable(envelope.scheduledAt), {
					onNone: () => Effect.void,
					onSome: (scheduledAt) => Clock.currentTimeMillis.pipe(Effect.flatMap((now) => {
						const delay = Duration.millis(Math.max(0, scheduledAt - now));
						return Duration.greaterThan(delay, Duration.zero) ? DurableClock.sleep({ duration: delay, inMemoryThreshold: _CONFIG.workflow.scheduledDelayThreshold, name: `job.scheduled-delay.${jobId}` }) : Effect.void;
					})),
				});
				const handlerActivity = Activity.make({
					error: JobError,
					execute: Effect.provideService(handler(envelope.payload).pipe(Effect.mapError((error) => JobError.from(jobId, 'Processing', error))), JobContext, { jobId, priority: envelope.priority ?? 'normal', reportProgress: (pct, message) => _runtime.progress.report(jobId, envelope.tenantId, { message, pct }), tenantId: envelope.tenantId }),
					name: `job.handler.${envelope.type}`,
					success: S.Unknown,
				});
				const result = yield* handlerActivity.pipe(
					Activity.retry({ times: envelope.maxAttempts, while: (error) => error.isRetryable }),
					_JobWorkflow.withCompensation((_value, cause) => Telemetry.span(
						Clock.currentTimeMillis.pipe(
							Effect.flatMap((failedTimestamp) => _lifecycle('failed', {
								envelope,
								error: String(cause),
								extra: (state) => _runtime.db.run(envelope.tenantId, database.jobDlq.insert({ appId: envelope.tenantId, attempts: state.attempts, errorHistory: state.errorHistory, errorReason: 'MaxRetries', originalJobId: jobId, payload: envelope.payload, replayedAt: Option.none(), requestId: Option.fromNullable(envelope.requestId), source: 'job', type: envelope.type, userId: Option.none() })).pipe(Effect.zipRight(Metric.increment(metrics.jobs.deadLettered)), Effect.asVoid),
								jobId,
								reason: 'MaxRetries',
								timestamp: failedTimestamp,
							}).pipe(Effect.uninterruptible)),
							Effect.asVoid,
							Effect.catchAllCause((compensationCause) => Effect.logError('Workflow compensation failed', { cause: String(compensationCause), jobId })),
						),
						'job.workflow.compensate',
						{ 'job.id': jobId, 'job.type': envelope.type, metrics: false },
					)),
				);
				yield* Effect.ensuring(Effect.void, Effect.all([Fiber.interrupt(heartbeatFiber), _runtime.heartbeat.clear(jobId)], { discard: true }));
				yield* Clock.currentTimeMillis.pipe(Effect.flatMap((completedTimestamp) => _lifecycle('complete', { envelope, jobId, result, timestamp: completedTimestamp }).pipe(Effect.tap(() => Effect.logDebug('Job completed', { 'job.elapsed': Duration.format(Duration.millis(completedTimestamp - startTimestamp)) })))));
				return result;
			}).pipe(
				Effect.catchAll((error) => Effect.fail(_normalizeJobError(jobId)(error))),
				MetricsService.trackJob({ jobType: envelope.type, operation: 'process', priority: envelope.priority }),
				Effect.ensuring(Effect.when(Entity.keepAlive(false), () => envelope.duration === 'long')),
				Effect.onInterrupt(() => Clock.currentTimeMillis.pipe(Effect.flatMap((cancelledTimestamp) => _lifecycle('cancelled', { envelope, jobId, timestamp: cancelledTimestamp }).pipe(Effect.asVoid)), Effect.catchAllCause(() => Effect.void))),
			),
		)),
		'job.workflow.execute',
		{ 'job.id': jobId, 'job.type': envelope.type, metrics: false },
	);
	yield* Metric.increment(Metric.taggedWithLabels(metrics.cluster.entityActivations, _entityLabels));
	yield* Effect.addFinalizer(() => Clock.currentTimeMillis.pipe(Effect.flatMap((deactivatedAt) => Effect.all([Metric.increment(Metric.taggedWithLabels(metrics.cluster.entityDeactivations, _entityLabels)), Metric.update(Metric.taggedWithLabels(metrics.cluster.entityLifetime, _entityLabels), Duration.millis(deactivatedAt - _activatedAt))], { discard: true }))));
	yield* Effect.addFinalizer(() => FiberMap.join(runningJobs).pipe(Effect.ignore));
	return {
		cancel: ({ payload: { jobId, tenantId } }) => FiberMap.has(runningJobs, jobId).pipe(
			Effect.flatMap((isRunning) => isRunning ? FiberMap.remove(runningJobs, jobId) : _runtime.state.read(jobId, tenantId).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.fail(JobError.from(jobId, 'NotFound')), onSome: (state) => Effect.fail(JobError.from(jobId, _STATUS_MODEL[state.status].cancelError)) })))),
			Effect.catchAll((error) => Effect.fail(_normalizeJobError(jobId)(error))),
		),
		progress: (envelope) => _runtime.progress.stream(envelope.payload.jobId, envelope.payload.tenantId).pipe(Effect.catchAll(() => Effect.succeed(Stream.empty)), Stream.unwrap),
		status: (envelope) => _runtime.state.read(envelope.payload.jobId, envelope.payload.tenantId).pipe(Effect.map(Option.match({ onNone: () => JobState.defaultResponse, onSome: (state) => state.toResponse() })), Effect.catchAll(() => Effect.succeed(JobState.defaultResponse))),
		submit: (envelope) => Effect.gen(function* () {
			const jobId = yield* sharding.getSnowflake.pipe(Effect.map(String));
			const queuedTimestamp = yield* Clock.currentTimeMillis;
			const state = JobState.transition(null, 'queued', queuedTimestamp);
			yield* _runtime.db.run(envelope.payload.tenantId, database.jobs.insert({
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
				scheduledAt: Option.fromNullable(envelope.payload.scheduledAt).pipe(Option.map((timestamp) => new Date(timestamp))),
				status: state.status,
				type: envelope.payload.type,
				updatedAt: undefined,
			})).pipe(Effect.mapError((error) => JobError.from(jobId, 'Processing', error)));
			yield* cache.kv.set(_store.state.cacheKey(jobId), state, _CONFIG.cache.ttl);
			yield* Effect.all([
				_runtime.status.publish(jobId, envelope.payload.type, 'queued', envelope.payload.tenantId),
				Metric.increment(metrics.jobs.enqueued),
				FiberMap.run(runningJobs, jobId)(_executeWorkflow(jobId, envelope.payload)),
			], { discard: true });
			return { duplicate: false, jobId };
		}),
	};
}), {
	concurrency: _CONFIG.entity.concurrency,
	defectRetryPolicy: _retryBase(_CONFIG.retry.defect),
	mailboxCapacity: _CONFIG.entity.mailboxCapacity,
	maxIdleTime: _CONFIG.entity.maxIdleTime,
	spanAttributes: { 'entity.service': 'job-processing', 'entity.version': 'v2' },
});
const _purgeJobs = Telemetry.span(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const purgeConfig = yield* _PURGE_CFG;
		const now = yield* Clock.currentTimeMillis;
		const completedCutoff = new Date(now - purgeConfig.completedTtlDays * 24 * 60 * 60 * 1000);
		const failedCutoff = new Date(now - purgeConfig.failedTtlDays * 24 * 60 * 60 * 1000);
		const completedResult = yield* sql`
			WITH deleted AS (
				DELETE FROM jobs WHERE status IN ('complete', 'cancelled') AND updated_at < ${completedCutoff} RETURNING job_id
			)
			SELECT COUNT(*)::int AS count FROM deleted
		`;
		const failedResult = yield* sql`
			WITH deleted AS (
				DELETE FROM jobs WHERE status = 'failed' AND updated_at < ${failedCutoff} RETURNING job_id
			)
			SELECT COUNT(*)::int AS count FROM deleted
		`;
		const completedCount = (completedResult[0] as { count: number }).count;
		const failedCount = (failedResult[0] as { count: number }).count;
		yield* Effect.when(
			Effect.logInfo('Job purge completed', {
				'purge.completed_count': completedCount,
				'purge.completed_ttl_days': purgeConfig.completedTtlDays,
				'purge.failed_count': failedCount,
				'purge.failed_ttl_days': purgeConfig.failedTtlDays,
			}),
			() => completedCount > 0 || failedCount > 0,
		);
		return { completedCount, failedCount };
	}),
	'job.purge',
	{ metrics: false },
);

// --- [SERVICES] --------------------------------------------------------------

class JobService extends Effect.Service<JobService>()('server/Jobs', {
	dependencies: [
		JobEntityLive.pipe(Layer.provideMerge(Layer.mergeAll(ClusterService.Layers.runner, _JobInternalLive, DatabaseService.Default))),
		DatabaseService.Default,
		EventBus.Default,
		_JobInternalLive,
		MetricsService.Default,
		_WorkflowEngineLayer,
		_JobWorkflow.toLayer(() =>
			Effect.succeed(undefined as unknown), // Workflow implementation: execution happens via entity handler, workflow provides durability envelope
		),
	],
	scoped: Effect.gen(function* () {
		const { handlers } = yield* _JobInternal;
		const eventBus = yield* EventBus;
		const cluster = yield* ClusterService;
		const counter = yield* Ref.make(0);
		const sharding = yield* Sharding.Sharding;
		const getClient = yield* sharding.makeClient(JobEntity);
		const dlqConfig = yield* _DLQ_WATCHER_CFG;
		const routeByPriority = (priority: keyof typeof _CONFIG.pools) => Ref.modify(counter, (count) => [EntityId.make(`job-${priority}-${count % _CONFIG.pools[priority]}`), count + 1] as const);
		const _forkPeriodic = <A, E, R>(effect: Effect.Effect<A, E, R>, interval: Duration.Duration, warning: string) => effect.pipe(
			Effect.repeat(Schedule.spaced(interval)),
			Effect.catchAllCause((cause) => Effect.logWarning(warning, { cause: String(cause) })),
			Effect.forkScoped,
		);
		const _rpcWithTenant = <A>(jobId: string, run: (tenantId: string) => Effect.Effect<A, unknown, never>) => Context.Request.currentTenantId.pipe(
			Effect.flatMap((tenantId) => run(tenantId).pipe(Effect.mapError(JobError.fromRpc(jobId)))),
		);
		const submit = <T>(type: string, payloads: T | readonly T[], opts?: { dedupeKey?: string; maxAttempts?: number; priority?: typeof _SCHEMA.priority.Type; scheduledAt?: number }) =>
			Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => Effect.gen(function* () {
					const requestContext = yield* Context.Request.current;
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
									ipAddress: Option.getOrUndefined(requestContext.ipAddress),
									maxAttempts: opts?.maxAttempts, payload, priority,
									requestId: requestContext.requestId,
									scheduledAt: opts?.scheduledAt, tenantId, type,
									userAgent: Option.getOrUndefined(requestContext.userAgent),
								}).pipe(Effect.map((result) => result.jobId)),
							)),
						), { concurrency: 'unbounded' });
					return isBatch ? results : results[0];
				})),
				Telemetry.span('job.submit', { 'job.type': type, metrics: false }),
			);
		const statusStream = eventBus.stream().pipe(
			Stream.filter((envelope) => envelope.event.eventType === 'JobStatusEvent.status'),
			Stream.map((envelope) => {
				const payload = envelope.event.payload as { error?: string; jobId: string; status: typeof _SCHEMA.status.Type; tenantId: string; type: string };
				return new JobStatusEvent({ error: payload.error, id: envelope.event.eventId, jobId: payload.jobId, status: payload.status, tenantId: payload.tenantId, type: payload.type });
			}),
		);
		yield* _forkPeriodic(_purgeJobs, _CONFIG.purge.interval, 'Job purge scheduler failed');
		yield* _forkPeriodic(_makeDlqWatcher(submit).pipe(Effect.flatten), Duration.millis(dlqConfig.checkIntervalMs), 'DLQ watcher scheduler failed');
		return {
			cancel: (jobId: string) => _rpcWithTenant(jobId, (tenantId) => getClient(jobId)['cancel']({ jobId, tenantId })).pipe(
				Telemetry.span('job.cancel', { 'job.id': jobId, metrics: false }),
			),
			onStatusChange: () => statusStream,
			registerHandler: <T>(type: string, handler: (payload: T) => Effect.Effect<void, unknown, never>) => Ref.update(handlers, HashMap.set(type, handler as (payload: unknown) => Effect.Effect<unknown, unknown, never>)),
			status: (jobId: string) => _rpcWithTenant(jobId, (tenantId) => getClient(jobId)['status']({ jobId, tenantId })).pipe(
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
	static readonly Workflow = _JobWorkflow;
	static readonly replay = (dlqId: string) => JobService.pipe(Effect.flatMap((jobs) => {
		const fetchDlq = Effect.flatMap(DatabaseService, (database) => database.jobDlq.one([{ field: 'id', value: dlqId }]));
		return Telemetry.span(
			fetchDlq.pipe(
				Effect.flatMap(Option.match({
					onNone: () => Effect.fail(JobError.from(dlqId, 'NotFound')),
					onSome: (entry: typeof JobDlq.Type) => jobs.submit(entry.type, entry.payload, { priority: 'normal' }).pipe(
						Effect.flatMap(() => Effect.flatMap(DatabaseService, (database) => database.jobDlq.markReplayed(dlqId))),
					),
				})),
			),
			'job.replay',
			{ 'dlq.id': dlqId, metrics: false },
		);
	}));
	static readonly resetJob = (jobId: string) => Sharding.Sharding.pipe(
		Effect.flatMap((sharding) => Telemetry.span(
			sharding.reset(Snowflake.Snowflake(jobId)).pipe(Effect.flatMap((ok) => ok ? Effect.logInfo('Job state reset', { jobId }) : Effect.fail(JobError.from(jobId, 'NotFound')))),
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

// --- [EXPORT] ----------------------------------------------------------------

export { JobService };
