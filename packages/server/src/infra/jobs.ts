/**
 * Entity-based job processing via @effect/cluster mailbox dispatch + @effect/workflow durable execution.
 * Workflow-first design: every job runs as a durable workflow with activities, compensation, and state persistence.
 * Entity sharding handles routing; workflow engine handles durability, retry, and rollback.
 * Includes automatic DLQ watcher and request context propagation.
 */
import { ClusterWorkflowEngine, DeliverAt, Entity, EntityId, Sharding, Snowflake } from '@effect/cluster';
import { Rpc, RpcClientError } from '@effect/rpc';
import { Activity, Workflow } from '@effect/workflow';
import { SqlClient } from '@effect/sql';
import { Cause, Chunk, Clock, Config, DateTime, Duration, Effect, Fiber, FiberMap, Layer, Mailbox, Match, Metric, Option, pipe, Ref, Schedule, Schema as S, STM, Stream, TMap, TRef } from 'effect';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Job, JobStatusSchema, type JobDlq } from '@parametric-portal/database/models';
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
	retry: {cap: Duration.seconds(30), defect: { base: Duration.millis(100), maxAttempts: 5 }, job: { base: Duration.millis(100), maxAttempts: 5, resetAfter: Duration.minutes(5) },},
} as const;
const _DLQ_WATCHER_CFG = Config.all({
	checkIntervalMs: 	Config.integer('JOB_DLQ_CHECK_INTERVAL_MS').pipe(Config.withDefault(Duration.toMillis(_CONFIG.dlqWatcher.checkInterval))),
	maxRetries: 		Config.integer('JOB_DLQ_MAX_RETRIES').pipe(Config.withDefault(_CONFIG.dlqWatcher.maxRetries)),
});
const _ErrorReason = S.Literal('NotFound', 'AlreadyCancelled', 'HandlerMissing', 'Validation', 'Processing', 'MaxRetries', 'RunnerUnavailable', 'Timeout');
const _HistoryEntry = S.Struct({ error: S.optional(S.String), status: JobStatusSchema, timestamp: S.Number });
const _Progress = S.Struct({ message: S.String, pct: S.Number });
const _STATUS_MODEL = {
	cancelled: { terminal: true, transitions: new Set<typeof JobStatusSchema.Type>() },
	complete: { terminal: true, transitions: new Set<typeof JobStatusSchema.Type>() },
	failed: { terminal: true, transitions: new Set<typeof JobStatusSchema.Type>(['processing']) },
	processing: { terminal: false, transitions: new Set<typeof JobStatusSchema.Type>(['complete', 'failed', 'cancelled']) },
	queued: { terminal: false, transitions: new Set<typeof JobStatusSchema.Type>(['processing', 'cancelled']) },
} as const;
const _ERROR_PROPS = {
	AlreadyCancelled: { retryable: false, terminal: true }, HandlerMissing: { retryable: false, terminal: true }, MaxRetries: { retryable: false, terminal: true }, NotFound: { retryable: false, terminal: true },
	Processing: { retryable: true, terminal: false }, RunnerUnavailable: { retryable: true, terminal: false }, Timeout: { retryable: true, terminal: false },
	Validation: { retryable: false, terminal: true },
} as const satisfies Record<typeof _ErrorReason.Type, { retryable: boolean; terminal: boolean }>;

// --- [FUNCTIONS] -------------------------------------------------------------

const _retryBase = (config: { readonly base: Duration.Duration; readonly maxAttempts: number }): Schedule.Schedule<[Duration.Duration, number], unknown, never> =>
	Resilience.schedule({ base: config.base, cap: _CONFIG.retry.cap, maxAttempts: config.maxAttempts }) as Schedule.Schedule<[Duration.Duration, number], unknown, never>;
const _makeDlqWatcher = (submitFn: (type: string, payload: unknown, opts?: { priority?: typeof Job.fields.priority.Type }) => Effect.Effect<unknown, unknown, unknown>) =>
	Effect.gen(function* () {
		const database = yield* DatabaseService;
		const sql = yield* SqlClient.SqlClient;
		const eventBus = yield* EventBus;
		const dlqConfig = yield* _DLQ_WATCHER_CFG;
		const _dbRun = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>) => Context.Request.withinSync(tenantId, effect).pipe(Effect.provideService(SqlClient.SqlClient, sql));
		const processDlqEntry = (entry: typeof JobDlq.Type) =>
			Match.value(entry.attempts).pipe(
				Match.when((attempts) => attempts > dlqConfig.maxRetries, () => Effect.void),
				Match.when((attempts) => attempts === dlqConfig.maxRetries, (attempts) => eventBus.publish({
					aggregateId: entry.sourceId,
					payload: { _tag: 'DlqAlertEvent', action: 'alert', attempts, errorReason: entry.errorReason, sourceId: entry.sourceId, type: entry.type },
					tenantId: entry.appId,
				}).pipe(
					Effect.zipRight(_dbRun(entry.appId, database.jobDlq.set(entry.id, { attempts: attempts + 1 }))),
					Effect.tap(() => Effect.logWarning('DLQ entry exceeded max retries, alert emitted', { 'dlq.id': entry.id, 'dlq.max_retries': dlqConfig.maxRetries, 'dlq.type': entry.type })),
					Effect.asVoid,
				)),
				Match.orElse(() => _dbRun(entry.appId, database.jobDlq.markReplayed(entry.id)).pipe(
					Effect.zipRight(Context.Request.within(entry.appId, submitFn(entry.type, entry.payload, { priority: 'normal' }), Context.Request.system())),
					Effect.tap(() => Effect.logInfo('DLQ entry auto-replayed', { 'dlq.id': entry.id, 'dlq.type': entry.type })),
					Effect.tapError((error) => Effect.all([
						_dbRun(entry.appId, database.jobDlq.set(entry.id, { attempts: entry.attempts + 1 })),
						_dbRun(entry.appId, database.jobDlq.unmarkReplayed(entry.id)).pipe(Effect.ignore),
						Effect.logWarning('DLQ auto-replay failed', { 'dlq.attempt': entry.attempts + 1, 'dlq.error': String(error), 'dlq.id': entry.id }),
					], { discard: true })),
					Effect.asVoid,
				)),
			);
		yield* Telemetry.span(
			Context.Request.withinSync(
				Context.Request.Id.system,
				database.apps.find([]),
				Context.Request.system(),
			).pipe(
				Effect.provideService(SqlClient.SqlClient, sql),
				Effect.flatMap((apps) => Effect.forEach(
					apps,
					(app) => _dbRun(
						app.id,
							database.jobDlq.page([
								{ field: 'source', value: 'job' },
								{ field: 'attempts', op: 'lte', value: dlqConfig.maxRetries },
							], { limit: 50 }).pipe(
							Effect.map((page) => page.items),
						),
					),
					{ concurrency: 'unbounded' },
				)),
				Effect.map((pages) => pages.flat()),
				Effect.flatMap((entries) => Effect.forEach(entries, processDlqEntry, { discard: true })),
				Effect.tap(() => Effect.logDebug('DLQ watcher cycle completed')),
				Effect.catchAll((error) => Effect.logWarning('DLQ watcher cycle failed', { error: String(error) })),
			),
			'jobs.dlqWatcher',
			{ metrics: false },
		);
	});

// --- [CLASSES] ---------------------------------------------------------------

class JobPayload extends S.Class<JobPayload>('JobPayload')({
	batchId: S.optional(S.String), dedupeKey: S.optional(S.String),
	duration: S.optionalWith(S.Literal('short', 'long'), { default: () => 'short' }),ipAddress: S.optional(S.String), 
	maxAttempts: S.optionalWith(S.Number, { default: () => 3 }),
	payload: S.Unknown,
	priority: S.optionalWith(Job.fields.priority, { default: () => 'normal' }),requestId: S.optional(S.String), scheduledAt: S.optional(S.Number), tenantId: S.String, type: S.String,userAgent: S.optional(S.String),
}) {}
class JobStatusResponse extends S.Class<JobStatusResponse>('JobStatusResponse')({
	attempts: S.Number, history: S.Array(_HistoryEntry), result: S.optional(S.Unknown), status: JobStatusSchema,
}) {}
class JobStatusEvent extends S.Class<JobStatusEvent>('JobStatusEvent')({
	error: S.optional(S.String), id: S.optional(S.String), jobId: S.String, status: JobStatusSchema, tenantId: S.String, type: S.String,
}) {}
class JobState extends S.Class<JobState>('JobState')({
	attempts: S.Number, completedAt: S.optional(S.Number), createdAt: S.Number, history: S.Array(_HistoryEntry),
	lastError: S.optional(S.String), result: S.optional(S.Unknown), status: JobStatusSchema,
}) {
	static readonly transition = (
		state: JobState | null,
		to: typeof JobStatusSchema.Type,
		timestamp: number,
		opts?: { attempts?: number; error?: string; result?: unknown },): JobState => {
		const base = state ?? new JobState({ attempts: 0, createdAt: timestamp, history: [], status: 'queued' });
		const isIdempotent = base.status === to;
		const isValid = _STATUS_MODEL[base.status].transitions.has(to);
		const shouldApply = isValid || isIdempotent;
		return shouldApply
			? new JobState({
				...base,
				attempts: opts?.attempts ?? base.attempts,
				completedAt: _STATUS_MODEL[to].terminal ? timestamp : base.completedAt,
				history: [...base.history, { error: opts?.error, status: to, timestamp }],
				lastError: opts?.error ?? base.lastError,
				result: opts?.result ?? base.result,
				status: to,
			})
			: base;
	};
	get errorHistory(): readonly { error: string; timestamp: number }[] {return this.history.flatMap((entry) => entry.error ? [{ error: entry.error, timestamp: entry.timestamp }] : []);}
	static readonly fromRecord = (job: S.Schema.Type<typeof Job>) =>
			new JobState({
				attempts: job.retry.current,
				completedAt: Option.getOrUndefined(Option.map(job.completedAt, (d: Date) => d.getTime())),
				createdAt: Snowflake.timestamp(Snowflake.Snowflake(job.jobId)),
				history: S.is(S.Array(_HistoryEntry))(job.history) ? job.history : [],
				lastError: job.history.at(-1)?.error,
				result: Option.getOrUndefined(Option.map(job.output, (o) => o.result)),
				status: job.status,
			});
	static readonly defaultResponse = new JobStatusResponse({ attempts: 0, history: [], status: 'queued' });
	toResponse(): typeof JobStatusResponse.Type {return new JobStatusResponse({ attempts: this.attempts, history: this.history, result: this.result, status: this.status });}
}
class JobContext extends Effect.Tag('JobContext')<JobContext, {
	readonly jobId: string;
	readonly priority: typeof Job.fields.priority.Type;
	readonly reportProgress: (pct: number, message: string) => Effect.Effect<void>;
	readonly tenantId: string;
}>() {}
class JobError extends S.TaggedError<JobError>()('JobError', { cause: S.optional(S.Unknown), jobId: S.optional(S.String), reason: _ErrorReason }) {
	static readonly from = (jobId: string, reason: typeof _ErrorReason.Type, cause?: unknown) => new JobError({ cause, jobId, reason });
	get isTerminal(): boolean { return _ERROR_PROPS[this.reason].terminal; }
	get isRetryable(): boolean { return _ERROR_PROPS[this.reason].retryable; }
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

class JobInternal extends Effect.Tag('JobInternal')<JobInternal, {
	readonly handlers: TMap.TMap<string, (payload: unknown) => Effect.Effect<unknown, unknown, never>>;
}>() {}
const JobInternalLive = Layer.scoped(JobInternal, Effect.gen(function* () {
	const handlers = yield* STM.commit(TMap.empty<string, (payload: unknown) => Effect.Effect<unknown, unknown, never>>());
	return { handlers };
}));
const JobEntity = Entity.make('Job', [
	Rpc.make('submit', { error: JobError, payload: JobPayload.fields, primaryKey: (payload: typeof JobPayload.Type) => payload.dedupeKey ?? crypto.randomUUID(), success: S.Struct({ duplicate: S.Boolean, jobId: S.String }) }),
	Rpc.make('status', { error: JobError, payload: S.Struct({ jobId: S.String, tenantId: S.String }), success: JobStatusResponse }),
	Rpc.make('progress', { error: JobError, payload: S.Struct({ jobId: S.String, tenantId: S.String }), stream: true, success: _Progress }),
	Rpc.make('cancel', { error: JobError, payload: S.Struct({ jobId: S.String, tenantId: S.String }), success: S.Void }),
]);
const JobEntityLive = JobEntity.toLayer(Effect.gen(function* () {
	const currentAddress = yield* Entity.CurrentAddress;
	const { handlers } = yield* JobInternal;
	const runningJobs = yield* FiberMap.make<string>();
	const progressMailboxes = yield* STM.commit(TMap.empty<string, Mailbox.Mailbox<{ pct: number; message: string }>>());
	const { cache, database, eventBus, metrics, sharding, sql } = yield* Effect.all({ cache: CacheService, database: DatabaseService, eventBus: EventBus, metrics: MetricsService, sharding: Sharding.Sharding, sql: SqlClient.SqlClient });
	const _entityLabels = MetricsService.label({ entity_type: 'Job' });
	const _activatedAt = yield* Clock.currentTimeMillis;
	const _dbRun = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>) => Context.Request.withinSync(tenantId, effect).pipe(Effect.provideService(SqlClient.SqlClient, sql));
	const _progressCacheKey = (jobId: string) => `${_CONFIG.cache.keyPrefix}progress:${jobId}`;
	const _stateCacheKey = (jobId: string) => `${_CONFIG.cache.keyPrefix}state:${jobId}`;
	const _readState = (jobId: string, tenantId: string) => cache.kv.get(_stateCacheKey(jobId), JobState).pipe(
		Effect.flatMap(Option.match({
			onNone: () => _dbRun(tenantId, database.jobs.one([{ field: 'job_id', value: jobId }])).pipe(Effect.map(Option.map(JobState.fromRecord)), Effect.tap(Option.match({ onNone: () => Effect.void, onSome: (value) => cache.kv.set(_stateCacheKey(jobId), value, _CONFIG.cache.ttl) }))),
			onSome: (value) => Effect.succeed(Option.some(value)),
		})),
	);
	const _writeState = (jobId: string, tenantId: string, state: JobState) =>
		_dbRun(tenantId, database.jobs.set(jobId, { completedAt: Option.fromNullable(state.completedAt).pipe(Option.map((timestamp) => new Date(timestamp))), history: state.history, output: Option.fromNullable(state.result).pipe(Option.map((result) => ({ result }))), retry: { current: state.attempts, max: 0 }, status: state.status })).pipe(
			Effect.tapError((error) => Effect.logError('Job state DB write failed', { error: String(error), jobId })),
			Effect.tap(() => cache.kv.set(_stateCacheKey(jobId), state, _CONFIG.cache.ttl).pipe(Effect.ignore)));
	const _readProgress = (jobId: string, tenantId: string) => cache.kv.get(_progressCacheKey(jobId), _Progress).pipe(
		Effect.flatMap(Option.match({
			onNone: () => _dbRun(tenantId, database.jobs.one([{ field: 'job_id', value: jobId }])).pipe(Effect.map(Option.flatMap((job) => Option.flatMap(job.output, (o) => Option.fromNullable((o as { progress?: typeof _Progress.Type }).progress)))), Effect.tap(Option.match({ onNone: () => Effect.void, onSome: (value) => cache.kv.set(_progressCacheKey(jobId), value, _CONFIG.cache.ttl) }))),
			onSome: (value) => Effect.succeed(Option.some(value)),
		})),
	);
		const _writeProgress = (jobId: string, tenantId: string, progress: typeof _Progress.Type) =>
			_dbRun(tenantId, database.jobs.set(jobId, { output: Option.some({ progress }) })).pipe(
				Effect.tapError((error) => Effect.logError('Job progress DB write failed', { error: String(error), jobId })),
				Effect.tap(() => cache.kv.set(_progressCacheKey(jobId), progress, _CONFIG.cache.ttl).pipe(Effect.ignore)));
		const _progressStreamLabels = MetricsService.label({ stream: 'job_progress' });
		const _writeHeartbeat = (jobId: string) => Clock.currentTimeMillis.pipe(
			Effect.flatMap((now) => cache.kv.set(`${_CONFIG.heartbeat.keyPrefix}${jobId}`, now, _CONFIG.heartbeat.staleness)),
			Effect.ignore,
		);
		const _runtime = {
		db: { run: _dbRun },
		handlers: { resolve: (jobId: string, type: string) => STM.commit(TMap.get(handlers, type)).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.fail(JobError.from(jobId, 'HandlerMissing', { type })), onSome: Effect.succeed }))) },
			heartbeat: {
				clear: (jobId: string) => cache.kv.del(`${_CONFIG.heartbeat.keyPrefix}${jobId}`).pipe(Effect.ignore),
				start: (jobId: string) => _writeHeartbeat(jobId).pipe(Effect.repeat(Schedule.spaced(_CONFIG.heartbeat.interval))),
				touch: (jobId: string) => _writeHeartbeat(jobId),
			},
		progress: {
			cleanup: (jobId: string) => STM.commit(TMap.get(progressMailboxes, jobId).pipe(STM.flatMap((mailbox) => TMap.remove(progressMailboxes, jobId).pipe(STM.as(mailbox))))).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (mailbox) => mailbox.end.pipe(Effect.asVoid) }))),
			getMailbox: (jobId: string) => STM.commit(TMap.get(progressMailboxes, jobId)).pipe(Effect.flatMap(Option.match({ onNone: () => Mailbox.make<{ pct: number; message: string }>({ capacity: 16, strategy: 'sliding' }).pipe(Effect.tap((mailbox) => STM.commit(TMap.set(progressMailboxes, jobId, mailbox)))), onSome: Effect.succeed }))),
			read: _readProgress,
			report: (jobId: string, tenantId: string, progress: typeof _Progress.Type) => _runtime.progress.getMailbox(jobId).pipe(Effect.flatMap((mailbox) => mailbox.offer(progress)), Effect.zipRight(_writeProgress(jobId, tenantId, progress).pipe(Effect.ignore)), Effect.asVoid),
				stream: (jobId: string, tenantId: string) => Effect.all([_runtime.progress.getMailbox(jobId), _readProgress(jobId, tenantId)]).pipe(Effect.map(([mailbox, last]) => Stream.concat(Option.match(last, { onNone: () => Stream.fromIterable<typeof _Progress.Type>([]), onSome: (value) => Stream.fromIterable([value]) }), Mailbox.toStream(mailbox)).pipe(Stream.tap(() => Metric.increment(Metric.taggedWithLabels(metrics.stream.elements, _progressStreamLabels)))))),
		},
			state: {
				read: _readState,
				transition: (jobId: string, tenantId: string, status: typeof JobStatusSchema.Type, timestamp: number, options?: { attempts?: number; error?: string; result?: unknown }) => _readState(jobId, tenantId).pipe(
					Effect.map(Option.getOrElse(() => null)),
					Effect.flatMap((current) => Match.value(current).pipe(
						Match.when(null, () => Effect.succeed(JobState.transition(null, status, timestamp, options))),
						Match.orElse((state) => pipe(
							Effect.succeed(state),
							Effect.filterOrFail(
								(current) => _STATUS_MODEL[current.status].transitions.has(status) || current.status === status,
								(current) => JobError.from(jobId, 'Validation', { from: current.status, to: status }),
							),
							Effect.map((current) => JobState.transition(current, status, timestamp, options)),
						)),
					)),
					Effect.tap((state) => _writeState(jobId, tenantId, state)),
				),
				write: _writeState,
			},
		status: {
			publish: (jobId: string, type: string, status: typeof JobStatusSchema.Type, tenantId: string, error?: string) => eventBus.publish({ aggregateId: jobId, payload: { _tag: 'job', action: 'status', error, jobId, status, tenantId, type }, tenantId }).pipe(Effect.asVoid, Effect.catchAllCause((cause) => Effect.logWarning('Job status EventBus publish failed', { cause: String(cause), jobId }))),
		},
		} as const;
		const _findDuplicate = (jobId: string, tenantId: string, dedupeKey: string) => _runtime.db.run(
			tenantId,
			database.jobs.one([
				{ raw: sql`correlation->>'dedupe' = ${dedupeKey}` },
				{ field: 'status', op: 'in', values: ['queued', 'processing'] },
			]),
		).pipe(Effect.mapError((error) => JobError.from(jobId, 'Processing', error)));
		const _lifecycle = (status: Exclude<typeof JobStatusSchema.Type, 'queued'>, input: { readonly attempts?: number; readonly envelope: typeof JobPayload.Type; readonly error?: string; readonly extra?: (state: JobState) => Effect.Effect<void, unknown, unknown>; readonly jobId: string; readonly reason?: string; readonly result?: unknown; readonly timestamp: number }) =>
			_runtime.state.transition(input.jobId, input.envelope.tenantId, status, input.timestamp, { attempts: input.attempts, error: input.error, result: input.result }).pipe(
				Effect.flatMap((state) => Match.value(state.status).pipe(
					Match.when('processing', () => _runtime.status.publish(input.jobId, input.envelope.type, 'processing', input.envelope.tenantId)),
					Match.when('complete', () => Effect.all([_runtime.status.publish(input.jobId, input.envelope.type, 'complete', input.envelope.tenantId), eventBus.publish({ aggregateId: input.jobId, payload: { _tag: 'job', action: 'completed', result: state.result, type: input.envelope.type }, tenantId: input.envelope.tenantId }), Metric.increment(metrics.jobs.completions), _runtime.progress.cleanup(input.jobId)], { discard: true })),
					Match.when('failed', () => Effect.all([_runtime.status.publish(input.jobId, input.envelope.type, 'failed', input.envelope.tenantId, input.error), eventBus.publish({ aggregateId: input.jobId, payload: { _tag: 'job', action: 'failed', reason: input.reason ?? 'MaxRetries', type: input.envelope.type }, tenantId: input.envelope.tenantId }), _runtime.progress.cleanup(input.jobId)], { discard: true })),
					Match.when('cancelled', () => Effect.all([_runtime.status.publish(input.jobId, input.envelope.type, 'cancelled', input.envelope.tenantId), eventBus.publish({ aggregateId: input.jobId, payload: { _tag: 'job', action: 'cancelled', type: input.envelope.type }, tenantId: input.envelope.tenantId }), Metric.increment(metrics.jobs.cancellations), _runtime.progress.cleanup(input.jobId), _runtime.heartbeat.clear(input.jobId)], { discard: true })),
					Match.when('queued', () => Effect.void),
					Match.exhaustive,
					Effect.andThen(input.extra ? input.extra(state) : Effect.void),
				)),
			);
	const _withHeartbeat = <A, E, R>(jobId: string, effect: Effect.Effect<A, E, R>) => Effect.acquireUseRelease(
		Effect.fork(_runtime.heartbeat.start(jobId)),
		() => effect,
		(fiber) => Effect.all([Fiber.interrupt(fiber), _runtime.heartbeat.clear(jobId)], { discard: true }),
	);
	const _executeWorkflow = (jobId: string, envelope: typeof JobPayload.Type) => Telemetry.span(
		Context.Request.within(envelope.tenantId, Context.Request.withinCluster({ entityId: currentAddress.entityId, entityType: currentAddress.entityType, shardId: currentAddress.shardId })(
			Effect.gen(function* () {
					yield* Context.Request.update({ ipAddress: Option.fromNullable(envelope.ipAddress), requestId: envelope.requestId ?? crypto.randomUUID(), userAgent: Option.fromNullable(envelope.userAgent) });
					const handler = yield* _runtime.handlers.resolve(jobId, envelope.type);
					const startTimestamp = yield* Clock.currentTimeMillis;
					const attemptsRef = yield* Ref.make(0);
					yield* Effect.when(Entity.keepAlive(true), () => envelope.duration === 'long');
					yield* _runtime.heartbeat.touch(jobId);
						const handlerActivity = Activity.make({
						error: JobError,
						execute: Effect.gen(function* () {
							const attempt = yield* Ref.updateAndGet(attemptsRef, (current) => current + 1);
							const attemptTimestamp = yield* Clock.currentTimeMillis;
							yield* _lifecycle('processing', { attempts: attempt, envelope, jobId, timestamp: attemptTimestamp }).pipe(
								Effect.mapError((error) => JobError.from(jobId, 'Processing', error)),
							);
							return yield* Effect.provideService(handler(envelope.payload).pipe(Effect.mapError((error) => JobError.from(jobId, 'Processing', error))), JobContext, { jobId, priority: envelope.priority ?? 'normal', reportProgress: (pct, message) => _runtime.progress.report(jobId, envelope.tenantId, { message, pct }), tenantId: envelope.tenantId });
						}),
						name: `job.handler.${envelope.type}`,
						success: S.Unknown,
					});
					const result = yield* _withHeartbeat(jobId, handlerActivity.pipe(
						Activity.retry({ times: envelope.maxAttempts, while: (error) => error.isRetryable }),
						_JobWorkflow.withCompensation((_value, cause) => {
							const errorReason = Option.match(Cause.failureOption(cause), {
								onNone: () => 'MaxRetries' as const,
								onSome: (failure) => (typeof failure === 'object' && failure !== null && '_tag' in failure && (failure as { _tag: unknown })._tag === 'JobError' && 'reason' in failure && typeof (failure as { reason: unknown }).reason === 'string') ? (failure as JobError).reason : 'Processing',
							});
							return Telemetry.span(Clock.currentTimeMillis.pipe(
								Effect.flatMap((failedTimestamp) => _lifecycle('failed', {
									envelope,
									error: String(cause),
									extra: (state) => _runtime.db.run(envelope.tenantId, database.jobDlq.insert({
										appId: envelope.tenantId,
										attempts: state.attempts,
										context: Option.fromNullable(envelope.requestId).pipe(Option.map((request) => ({ request }))),
										errorReason,
										errors: state.errorHistory,
										payload: envelope.payload,
										replayedAt: Option.none(),
										source: 'job',
										sourceId: jobId,
										type: envelope.type,
									})).pipe(Effect.zipRight(Metric.increment(metrics.jobs.deadLettered)), Effect.asVoid),
									jobId,
									reason: errorReason,
									timestamp: failedTimestamp,
								}).pipe(Effect.uninterruptible)),
								Effect.asVoid,
								Effect.catchAllCause((compensationCause) => Effect.logError('Workflow compensation failed', { cause: String(compensationCause), jobId })),
							), 'jobs.workflow.compensate', { 'job.id': jobId, 'job.type': envelope.type, metrics: false });
						}),
					));
				yield* Clock.currentTimeMillis.pipe(Effect.flatMap((completedTimestamp) => _lifecycle('complete', { envelope, jobId, result, timestamp: completedTimestamp }).pipe(Effect.tap(() => Effect.logDebug('Job completed', { 'job.elapsed': Duration.format(Duration.millis(completedTimestamp - startTimestamp)) })))));
				return result;
			}).pipe(
				Effect.catchAll((error) => Effect.fail(error instanceof JobError ? error : JobError.from(jobId, 'Processing', error))),
				MetricsService.trackJob({ jobType: envelope.type, operation: 'process', priority: envelope.priority }),
				Effect.ensuring(Effect.when(Entity.keepAlive(false), () => envelope.duration === 'long')),
				Effect.onInterrupt(() => Clock.currentTimeMillis.pipe(Effect.flatMap((cancelledTimestamp) => _lifecycle('cancelled', { envelope, jobId, timestamp: cancelledTimestamp }).pipe(Effect.asVoid)), Effect.catchAllCause(() => Effect.void))),
			),
		)),
		'jobs.workflow.execute',
		{ 'job.id': jobId, 'job.type': envelope.type, metrics: false },
	);
	yield* Metric.increment(Metric.taggedWithLabels(metrics.cluster.entityActivations, _entityLabels));
	yield* Effect.addFinalizer(() => Clock.currentTimeMillis.pipe(Effect.flatMap((deactivatedAt) => Effect.all([Metric.increment(Metric.taggedWithLabels(metrics.cluster.entityDeactivations, _entityLabels)), Metric.update(Metric.taggedWithLabels(metrics.cluster.entityLifetime, _entityLabels), Duration.millis(deactivatedAt - _activatedAt))], { discard: true }))));
	yield* Effect.addFinalizer(() => FiberMap.join(runningJobs).pipe(Effect.ignore));
	return {
		cancel: ({ payload: { jobId, tenantId } }) => FiberMap.has(runningJobs, jobId).pipe(
			Effect.flatMap((isRunning) => isRunning ? FiberMap.remove(runningJobs, jobId) : _runtime.db.run(
				tenantId,
				database.jobs.one([{ field: 'job_id', value: jobId }]),
			).pipe(Effect.flatMap(Option.match({
				onNone: () => Effect.fail(JobError.from(jobId, 'NotFound')),
				onSome: (job) => Match.value(job.status).pipe(
					Match.when('queued', () => Clock.currentTimeMillis.pipe(
						Effect.flatMap((timestamp) => _runtime.state.transition(jobId, tenantId, 'cancelled', timestamp)),
						Effect.flatMap(() => Effect.all([
							_runtime.status.publish(jobId, job.type, 'cancelled', tenantId),
							eventBus.publish({ aggregateId: jobId, payload: { _tag: 'job', action: 'cancelled', type: job.type }, tenantId }),
							Metric.increment(metrics.jobs.cancellations),
							_runtime.progress.cleanup(jobId),
							_runtime.heartbeat.clear(jobId),
						], { discard: true })),
					)),
					Match.when('processing', () => Effect.fail(JobError.from(jobId, 'Processing'))),
					Match.orElse(() => Effect.fail(JobError.from(jobId, 'AlreadyCancelled'))),
				),
			})))),
			Effect.catchAll((error) => Effect.fail(error instanceof JobError ? error : JobError.from(jobId, 'Processing', error))),
		),
					progress: (envelope) => _runtime.progress.stream(envelope.payload.jobId, envelope.payload.tenantId).pipe(
						Effect.mapError((error) => JobError.from(envelope.payload.jobId, 'Processing', error)),
						Stream.unwrap,
					) as Stream.Stream<typeof _Progress.Type, JobError>,
				status: (envelope) => _runtime.state.read(envelope.payload.jobId, envelope.payload.tenantId).pipe(
					Effect.map(Option.match({ onNone: () => JobState.defaultResponse, onSome: (state) => state.toResponse() })),
					Effect.mapError((error) => JobError.from(envelope.payload.jobId, 'Processing', error)),
				),
			submit: (envelope) => Effect.gen(function* () {
				const jobId = yield* sharding.getSnowflake.pipe(Effect.map(String));
				const dedupeKey = Option.fromNullable(envelope.payload.dedupeKey);
				const existing = yield* dedupeKey.pipe(
						Option.match({
							onNone: () => Effect.succeed(Option.none<{ readonly jobId: string }>()),
							onSome: (key) => _findDuplicate(jobId, envelope.payload.tenantId, key).pipe(
								Effect.map(Option.map((row) => ({ jobId: row.jobId }))),
							),
						}),
					);
					return yield* Option.match(existing, {
						onNone: () => Effect.gen(function* () {
							const queuedTimestamp = yield* Clock.currentTimeMillis;
							const state = JobState.transition(null, 'queued', queuedTimestamp);
						const inserted = yield* _runtime.db.run(envelope.payload.tenantId, database.jobs.insert({
							appId: envelope.payload.tenantId, completedAt: Option.none(),
							correlation: Option.some({ batch: envelope.payload.batchId, dedupe: envelope.payload.dedupeKey }), history: state.history, jobId,
							output: Option.none(), payload: envelope.payload.payload, priority: envelope.payload.priority,
							retry: { current: state.attempts, max: envelope.payload.maxAttempts }, scheduledAt: Option.fromNullable(envelope.payload.scheduledAt).pipe(Option.map((timestamp) => new Date(timestamp))), status: state.status, type: envelope.payload.type, updatedAt: undefined,
						})).pipe(
							Effect.as({ duplicate: false as const, jobId }),
								Effect.catchAll((error) => dedupeKey.pipe(
									Option.match({
										onNone: () => Effect.fail(JobError.from(jobId, 'Processing', error)),
										onSome: (key) => _findDuplicate(jobId, envelope.payload.tenantId, key).pipe(
											Effect.flatMap(Option.match({
												onNone: () => Effect.fail(JobError.from(jobId, 'Processing', error)),
												onSome: (row) => Effect.succeed({ duplicate: true as const, jobId: row.jobId }),
										})),
									),
								}),
							)),
						);
						return yield* Match.value(inserted.duplicate).pipe(
							Match.when(true, () => Effect.succeed(inserted)),
							Match.orElse(() => FiberMap.run(runningJobs, jobId)(_executeWorkflow(jobId, envelope.payload)).pipe(
								Effect.zipRight(
									Effect.all([
										cache.kv.set(_stateCacheKey(jobId), state, _CONFIG.cache.ttl),
										_runtime.status.publish(jobId, envelope.payload.type, 'queued', envelope.payload.tenantId),
										Metric.increment(metrics.jobs.enqueued),
									], { discard: true }).pipe(
										Effect.catchAllCause((cause) => Effect.logWarning('Job submit side effects failed', { cause: String(cause), jobId })),
									),
								),
								Effect.as(inserted),
							)),
						);
						}),
						onSome: ({ jobId: existingJobId }) => Effect.succeed({ duplicate: true as const, jobId: existingJobId }),
					});
				}),
			};
	}), {
	concurrency: _CONFIG.entity.concurrency,
	defectRetryPolicy: _retryBase(_CONFIG.retry.defect),
	mailboxCapacity: _CONFIG.entity.mailboxCapacity,
	maxIdleTime: _CONFIG.entity.maxIdleTime,
	spanAttributes: { 'entity.service': 'job-processing', 'entity.version': 'v2' },
});
// --- [SERVICES] --------------------------------------------------------------

class JobService extends Effect.Service<JobService>()('server/Jobs', {
	dependencies: [
		JobEntityLive,
		DatabaseService.Default,
		EventBus.Default,
		JobInternalLive,
		MetricsService.Default,
		ClusterWorkflowEngine.layer,
		_JobWorkflow.toLayer(() => Effect.void),
	],
	scoped: Effect.gen(function* () {
		const { handlers } = yield* JobInternal;
		const eventBus = yield* EventBus;
		const cluster = yield* ClusterService;
		const counter = yield* STM.commit(TRef.make(0));
		const sharding = yield* Sharding.Sharding;
		const getClient = yield* sharding.makeClient(JobEntity);
		const dlqConfig = yield* _DLQ_WATCHER_CFG;
		const routeByPriority = (priority: keyof typeof _CONFIG.pools) => STM.commit(TRef.modify(counter, (count) => [EntityId.make(`job-${priority}-${count % _CONFIG.pools[priority]}`), count + 1] as const));
		const _forkPeriodic = <A, E, R>(effect: Effect.Effect<A, E, R>, interval: Duration.Duration, warning: string) => effect.pipe(Effect.repeat(Schedule.spaced(interval)), Effect.catchAllCause((cause) => Effect.logWarning(warning, { cause: String(cause) })), Effect.forkScoped);
		const leaderOnly = <A, E, R>(key: string, effect: Effect.Effect<A, E, R>) => cluster.isLocal(key).pipe(Effect.flatMap((isLeader) => isLeader ? effect : Effect.void));
			const _rpcWithTenant = <A>(jobId: string, run: (tenantId: string) => Effect.Effect<A, unknown, never>) => Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => run(tenantId).pipe(
					Effect.mapError((error) => error instanceof JobError
						? error
						: error !== null && typeof error === 'object' && RpcClientError.TypeId in error
							? JobError.from(jobId, 'RunnerUnavailable', error)
							: JobError.from(jobId, 'Processing', error)),
				)),
			);
		function submit<T>(type: string, payloads: readonly T[], opts?: { dedupeKey?: string; maxAttempts?: number; priority?: typeof Job.fields.priority.Type; scheduledAt?: number }): Effect.Effect<readonly string[], unknown, never>;
		function submit<T>(type: string, payloads: T, opts?: { dedupeKey?: string; maxAttempts?: number; priority?: typeof Job.fields.priority.Type; scheduledAt?: number }): Effect.Effect<string, unknown, never>;
		function submit<T>(type: string, payloads: T | readonly T[], opts?: { dedupeKey?: string; maxAttempts?: number; priority?: typeof Job.fields.priority.Type; scheduledAt?: number }): Effect.Effect<string | readonly string[], unknown, never> {
			return Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => Effect.gen(function* () {
					const requestContext = yield* Context.Request.current;
					const isBatch = Array.isArray(payloads);
						const items = Array.isArray(payloads)
							? Chunk.fromIterable<T>(payloads)
							: Chunk.of(payloads);
					const validationId = yield* cluster.generateId.pipe(Effect.map(String));
					yield* Effect.filterOrFail(
						Effect.succeed(items),
						(chunk) => !(isBatch && Chunk.isEmpty(chunk)),
						() => JobError.from(validationId, 'Validation', { reason: 'empty_batch' }),
					);
					const priority = opts?.priority ?? 'normal';
					const batchId = yield* (isBatch ? cluster.generateId.pipe(Effect.map(String)) : Effect.succeed(undefined));
					const deliverAt = Option.fromNullable(opts?.scheduledAt).pipe(Option.match({
						onNone: () => ({} as const),
						onSome: (scheduledAt) => ({ [DeliverAt.symbol]: () => DateTime.unsafeMake(scheduledAt) } as const),
					}));
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
					return yield* isBatch
						? Effect.succeed(results)
						: Effect.fromNullable(results[0]).pipe(Effect.orElseFail(() => JobError.from(validationId, 'Validation', { reason: 'empty_submit_result' })));
				})),
				Telemetry.span('jobs.submit', { 'job.type': type, metrics: false }),
			);
		}
				const statusStream = eventBus.stream().pipe(
					Stream.filter((envelope) => envelope.event.eventType === 'job.status'),
					Stream.mapEffect((envelope) => S.decodeUnknown(JobStatusEvent)(envelope.event.payload).pipe(
						Effect.map((payload) => Option.some(new JobStatusEvent({ error: payload.error, id: envelope.event.eventId, jobId: payload.jobId, status: payload.status, tenantId: payload.tenantId, type: payload.type }))),
						Effect.tapError((error) => Effect.logWarning('Job status event decode failed', { error: String(error) })),
						Effect.orElseSucceed(() => Option.none()),
					)),
					Stream.filterMap((event) => event),
				);
			yield* _forkPeriodic(leaderOnly('jobs-maintenance:dlq', _makeDlqWatcher(submit)), Duration.millis(dlqConfig.checkIntervalMs), 'DLQ watcher scheduler failed');
		return {
			cancel: (jobId: string) => _rpcWithTenant(jobId, (tenantId) => getClient(jobId)['cancel']({ jobId, tenantId })).pipe(
				Telemetry.span('jobs.cancel', { 'job.id': jobId, metrics: false }),
			),
			onStatusChange: () => statusStream,
			registerHandler: <T>(type: string, handler: (payload: T) => Effect.Effect<void, unknown, never>) => STM.commit(TMap.set(handlers, type, handler as (payload: unknown) => Effect.Effect<unknown, unknown, never>)),
			status: (jobId: string) => _rpcWithTenant(jobId, (tenantId) => getClient(jobId)['status']({ jobId, tenantId })).pipe(
				Telemetry.span('jobs.status', { 'job.id': jobId, metrics: false }),
			),
			submit,
		};
	}),
}) {
	static readonly Error = JobError;
	static readonly replay = (dlqId: string) => JobService.pipe(Effect.flatMap((jobs) => Telemetry.span(
		Effect.flatMap(DatabaseService, (database) => database.jobDlq.one([{ field: 'id', value: dlqId }])).pipe(
			Effect.flatMap(Option.match({
				onNone: () => Effect.fail(JobError.from(dlqId, 'NotFound')),
				onSome: (entry: typeof JobDlq.Type) => jobs.submit(entry.type, entry.payload, { priority: 'normal' }).pipe(
					Effect.flatMap(() => Effect.flatMap(DatabaseService, (database) => database.jobDlq.markReplayed(dlqId)))),
			}))),
		'jobs.replay', { 'dlq.id': dlqId, metrics: false },
	)));
	static readonly resetJob = (jobId: string) => Sharding.Sharding.pipe(Effect.flatMap((sharding) => Telemetry.span(
		sharding.reset(Snowflake.Snowflake(jobId)).pipe(Effect.flatMap((ok) => ok ? Effect.logInfo('Job state reset', { jobId }) : Effect.fail(JobError.from(jobId, 'NotFound')))),
		'jobs.reset', { 'job.id': jobId, metrics: false })));
	static readonly isLocal = (entityId: string) => ClusterService.pipe(Effect.flatMap((cluster) => cluster.isLocal(entityId)));
	static readonly recoverInFlight = Sharding.Sharding.pipe(Effect.flatMap((sharding) => Telemetry.span(
		sharding.pollStorage.pipe(Effect.tap(() => Effect.logInfo('Job message storage polled for recovery'))),
		'jobs.recoverInFlight', { metrics: false })));
}

// --- [EXPORT] ----------------------------------------------------------------

export { JobService };
