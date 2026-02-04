/**
 * Multi-pod coordination facade via @effect/cluster.
 * Entity sharding, advisory-lock shard ownership, distributed message routing.
 */
import { ClusterCron, ClusterMetrics, Entity, EntityId, HttpRunner, K8sHttpClient, RunnerHealth, Sharding, ShardingConfig, Singleton, Snowflake, SocketRunner, SqlMessageStorage, SqlRunnerStorage } from '@effect/cluster';
import { Socket } from '@effect/platform';
import { NodeClusterSocket, NodeFileSystem, NodeHttpClient, NodeSocket, NodeSocketServer } from '@effect/platform-node';
import { Rpc, RpcSerialization } from '@effect/rpc';
import { PgClient } from '@effect/sql-pg';
import { Array as A, Cause, Chunk, Clock, Config, Cron, Data, DateTime, Duration, Effect, FiberMap, HashSet, Layer, Match, Metric, Option, Predicate, Ref, Schedule, Schema as S } from 'effect';
import { Client as DbClient } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	circuit: { halfOpenAfter: Duration.seconds(30), threshold: 3 },	// Aligns with heartbeat interval; trip after 3 consecutive failures
	cron: { skipIfOlderThan: Duration.minutes(5) },
	entity: { concurrency: 1, mailboxCapacity: 100, maxIdleTime: Duration.minutes(5) },
	retry: { base: Duration.millis(50), cap: Duration.seconds(30), maxAttempts: { defect: 5, state: 3, transient: 3 } },
	send: { bulkhead: 5, timeout: Duration.millis(100) },			// Bulkhead prevents mailbox overflow (capacity=100), timeout enforces SLA
	singleton: {
		grace: Duration.seconds(60),
		heartbeatInterval: Duration.seconds(30),
		keyPrefix: 'singleton-state:',
		migrationSla: Duration.seconds(10),
		schemaVersion: 1,
		threshold: 2,												// 2x expected interval before staleness
	},
	socketServer: { port: 9000 },
} as const;
const _retrySchedule = (max: number) => Schedule.exponential(_CONFIG.retry.base).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(max)), Schedule.upTo(_CONFIG.retry.cap));

// --- [SCHEMA] ----------------------------------------------------------------

const IdempotencyKey = S.String.pipe(S.minLength(1), S.maxLength(255), S.pattern(/^[a-zA-Z0-9:_-]+$/), S.brand('IdempotencyKey'));
const SnowflakeId = S.String.pipe(S.pattern(/^\d{18,19}$/), S.brand('SnowflakeId'));
const EntityStatus = S.Literal('idle', 'processing', 'suspended', 'complete', 'failed');
class ProcessPayload extends S.Class<ProcessPayload>('ProcessPayload')({ data: S.Unknown, entityId: SnowflakeId, idempotencyKey: S.optional(IdempotencyKey) }) {}
class StatusPayload extends S.Class<StatusPayload>('StatusPayload')({ entityId: SnowflakeId }) {}
class StatusResponse extends S.Class<StatusResponse>('StatusResponse')({ status: EntityStatus, updatedAt: S.Number }) {}
class EntityProcessError extends S.TaggedError<EntityProcessError>()('EntityProcessError', { cause: S.optional(S.Unknown), message: S.String }) {}
const ClusterEntity = Entity.make('Cluster', [	// primaryKey: idempotencyKey required for determinism (Date.now() violates replay safety per research)
	Rpc.make('process', { error: EntityProcessError, payload: ProcessPayload.fields, primaryKey: (p) => p.idempotencyKey ?? p.entityId, success: S.Void }),
	Rpc.make('status', { payload: StatusPayload.fields, success: StatusResponse }),
]);

// --- [ENTITY] ----------------------------------------------------------------

class EntityState extends S.Class<EntityState>('EntityState')({
	pendingSignal: S.optional(S.Struct({ name: S.String, token: S.String })),
	status: EntityStatus,
	updatedAt: S.Number,
}) {
	static readonly mk = (status: typeof EntityStatus.Type, signal?: { name: string; token: string }) => Clock.currentTimeMillis.pipe(Effect.map((ts) => new EntityState({ pendingSignal: signal, status, updatedAt: ts })));
	static readonly transition = (ref: Ref.Ref<EntityState>, to: typeof EntityStatus.Type) => EntityState.mk(to).pipe(Effect.flatMap((s) => Ref.set(ref, s)));
}
const ClusterEntityLive = ClusterEntity.toLayer(Effect.gen(function* () {
	const address = yield* Entity.CurrentAddress;
	const stateRef = yield* EntityState.mk('idle').pipe(Effect.andThen(Ref.make));
	const metricsOption = yield* Effect.serviceOption(MetricsService);
	const trackActivation = Option.match(metricsOption, { onNone: () => Effect.void, onSome: (metrics) => Metric.increment(metrics.cluster.entityActivations) });
	const trackDeactivation = Option.match(metricsOption, { onNone: () => Effect.void, onSome: (metrics) => Metric.increment(metrics.cluster.entityDeactivations) });
	return {
		process: (envelope) => Context.Request.withinCluster({ entityId: address.entityId, entityType: address.entityType, shardId: address.shardId })(
			Effect.gen(function* () {
				yield* trackActivation;
				yield* EntityState.transition(stateRef, 'processing');
				yield* Effect.logDebug('Entity processing', { entityId: address.entityId, idempotencyKey: envelope.payload.idempotencyKey });
				yield* EntityState.transition(stateRef, 'complete');
			}).pipe(
				Effect.ensuring(EntityState.transition(stateRef, 'idle').pipe(Effect.tap(() => trackDeactivation))),
				Effect.catchAllCause((cause) => Effect.fail(new EntityProcessError({ cause, message: Chunk.isNonEmpty(Cause.defects(cause)) ? 'Internal error' : Cause.pretty(cause) }))),
			),
		),
		status: () => Ref.get(stateRef).pipe(Effect.map((s) => new StatusResponse({ status: s.status, updatedAt: s.updatedAt }))),
	};
}), {	// mailboxCapacity + maxIdleTime from ShardingConfig
	concurrency: _CONFIG.entity.concurrency,
	defectRetryPolicy: _retrySchedule(_CONFIG.retry.maxAttempts.defect),
	spanAttributes: { 'entity.service': 'cluster-infrastructure', 'entity.version': 'v1' },
});

// --- [ERRORS] ----------------------------------------------------------------

const _ClusterReasons = {
	AlreadyProcessingMessage:  { retryable: false, terminal: true  },
	EntityNotAssignedToRunner: { retryable: false, terminal: true  },
	MailboxFull:               { retryable: true,  terminal: false },
	MalformedMessage:          { retryable: false, terminal: true  },
	PersistenceError:          { retryable: false, terminal: true  },
	RpcClientError:            { retryable: false, terminal: true  },
	RunnerNotRegistered:       { retryable: false, terminal: true  },
	RunnerUnavailable:         { retryable: true,  terminal: false },
	SendTimeout:               { retryable: true,  terminal: false },
	SerializationError:        { retryable: false, terminal: true  },
	Suspended:                 { retryable: false, terminal: true  },
} as const;
type _ClusterReason = keyof typeof _ClusterReasons;
class ClusterError extends S.TaggedError<ClusterError>()('ClusterError', {
	cause: S.optional(S.Unknown),
	entityId: S.optional(S.String),
	reason: S.Literal(...Object.keys(_ClusterReasons) as [_ClusterReason, ..._ClusterReason[]]),
	requestId: S.optional(S.String),
	resumeToken: S.optional(S.String),
}) {
	static readonly from = (reason: ClusterError['reason'], entityId?: string, opts?: { cause?: unknown; requestId?: string; resumeToken?: string }) => new ClusterError({ cause: opts?.cause, entityId, reason, requestId: opts?.requestId, resumeToken: opts?.resumeToken });
	static readonly _knownTags = HashSet.fromIterable(Object.keys(_ClusterReasons).filter((k): k is _ClusterReason => !_ClusterReasons[k as _ClusterReason].retryable));
	get isRetryable(): boolean { return _ClusterReasons[this.reason].retryable; }
	get isTerminal(): boolean { return _ClusterReasons[this.reason].terminal; }
}
const _SingletonReasons = {
	HeartbeatFailed:     { retryable: false, terminal: true  },
	LeaderHandoffFailed: { retryable: false, terminal: true  },
	SchemaDecodeFailed:  { retryable: false, terminal: true  },
	StateLoadFailed:     { retryable: true,  terminal: false },
	StatePersistFailed:  { retryable: true,  terminal: false },
} as const;
type _SingletonReason = keyof typeof _SingletonReasons;
class SingletonError extends Data.TaggedError('SingletonError')<{
	readonly reason: _SingletonReason;
	readonly cause?: unknown;
	readonly singletonName: string;
}> {
	static readonly from = (reason: _SingletonReason, name: string, cause?: unknown) => new SingletonError({ cause, reason, singletonName: name });
	get isRetryable(): boolean { return _SingletonReasons[this.reason].retryable; }
	get isTerminal(): boolean { return _SingletonReasons[this.reason].terminal; }
}

// --- [LAYERS] ----------------------------------------------------------------

const _runnerPgLayer = PgClient.layerConfig({
	applicationName: Config.succeed('cluster-runner-storage'),
	connectionTTL: Config.succeed(Duration.hours(24)),
	connectTimeout: Config.succeed(Duration.seconds(10)),
	database: Config.string('POSTGRES_DB').pipe(Config.withDefault('parametric')),
	host: Config.string('POSTGRES_HOST').pipe(Config.withDefault('localhost')),
	idleTimeout: Config.succeed(Duration.hours(24)),
	maxConnections: Config.succeed(1),
	minConnections: Config.succeed(1),
	password: Config.redacted('POSTGRES_PASSWORD'),
	port: Config.integer('POSTGRES_PORT').pipe(Config.withDefault(5432)),
	spanAttributes: Config.succeed({ 'db.system': 'postgresql', 'service.name': 'cluster-runner-storage' }),
	username: Config.string('POSTGRES_USER').pipe(Config.withDefault('postgres')),
});
const _storageLayers = Layer.mergeAll(
	SqlRunnerStorage.layer.pipe(Layer.provide(_runnerPgLayer)),
	SqlMessageStorage.layer.pipe(Layer.provide(DbClient.layer)),
	ShardingConfig.layer({ entityMailboxCapacity: _CONFIG.entity.mailboxCapacity, entityMaxIdleTime: _CONFIG.entity.maxIdleTime, preemptiveShutdown: true, sendRetryInterval: _CONFIG.send.timeout, shardsPerGroup: 100 }),
	Snowflake.layerGenerator,
);
const _healthConfig = Config.all({
	env: Config.string('NODE_ENV').pipe(Config.withDefault('development')),
	labelSelector: Config.string('K8S_LABEL_SELECTOR').pipe(Config.withDefault('app=parametric-portal')),
	mode: Config.string('CLUSTER_HEALTH_MODE').pipe(Config.withDefault('auto')),
	namespace: Config.string('K8S_NAMESPACE').pipe(Config.withDefault('default')),
});
const _healthLayer = Layer.unwrapEffect(_healthConfig.pipe(
	Effect.tap(({ env, mode }) => Effect.logDebug('Cluster health mode selected', { mode, useK8s: mode === 'k8s' || (mode === 'auto' && env === 'production') })),
	Effect.map(({ env, labelSelector, mode, namespace }) => (mode === 'k8s' || (mode === 'auto' && env === 'production'))
		? RunnerHealth.layerK8s({ labelSelector, namespace }).pipe(Layer.provide(K8sHttpClient.layer), Layer.provide(NodeHttpClient.layerUndici), Layer.provide(NodeFileSystem.layer))
		: RunnerHealth.layerNoop)));
const _transportBase = Layer.mergeAll(RpcSerialization.layerMsgPack, _healthLayer, _storageLayers);
const _httpClientLayer = HttpRunner.layerClient.pipe(Layer.provide(HttpRunner.layerClientProtocolHttpDefault), Layer.provide(NodeHttpClient.layerUndici), Layer.provideMerge(_transportBase));
const _socketLayer = SocketRunner.layer.pipe(
	Layer.provide(NodeSocketServer.layer({ port: _CONFIG.socketServer.port })),
	Layer.provide(NodeClusterSocket.layerClientProtocol),
	Layer.provideMerge(_transportBase));
const _websocketLayer = HttpRunner.layerWebsocketClientOnly.pipe(
	Layer.provide(HttpRunner.layerClientProtocolWebsocketDefault),
	Layer.provide(NodeSocket.layerWebSocketConstructor),
	Layer.provide(NodeHttpClient.layerUndici),
	Layer.provideMerge(_transportBase));
const _transportLayer = Layer.unwrapEffect(Config.string('CLUSTER_TRANSPORT').pipe(Config.withDefault('auto'), Effect.tap((m) => Effect.logInfo('Cluster transport selected', { mode: m })), Effect.map((mode) => Match.value(mode).pipe(
	Match.when('http', () => _httpClientLayer),
	Match.when('socket', () => _socketLayer),
	Match.when('websocket', () => _websocketLayer),
	Match.orElse(() => _socketLayer.pipe(Layer.catchAll((e) => Effect.logWarning('Socket unavailable, using HTTP client-only', { error: String(e) }).pipe(Effect.as(_httpClientLayer), Layer.unwrapEffect)))),
))));
const _clusterLayer = ClusterEntityLive.pipe(Layer.provideMerge(_transportLayer));

// --- [FUNCTIONS] -------------------------------------------------------------

const _trackLeaderExecution = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>, type: 'singleton' | 'cron') =>
	Effect.flatMap(MetricsService, (metrics) => Context.Request.withinCluster({ isLeader: true })(
		MetricsService.trackEffect(Telemetry.span(effect, `${type}.${name}`, { metrics: false }), {
			duration: metrics.singleton.duration, errors: metrics.errors,
			labels: MetricsService.label({ singleton: name, ...(type === 'cron' && { type: 'cron' }) }),
		}).pipe(Effect.andThen(Clock.currentTimeMillis), Effect.tap((ts) => Effect.all([Metric.set(metrics.singleton.lastExecution, ts), Metric.increment(metrics.singleton.executions)], { discard: true }))),
	));
const _readMetric = <A extends number | bigint>(m: Metric.Metric.Gauge<A>) => Metric.value(m).pipe(Effect.map(({ value }) => Number(value)));

// --- [SERVICE] ---------------------------------------------------------------

class ClusterService extends Effect.Service<ClusterService>()('server/Cluster', {
	dependencies: [_clusterLayer, Resilience.Layer],
	effect: Effect.gen(function* () {
		const sharding = yield* Sharding.Sharding;
		yield* Effect.annotateLogsScoped({ 'service.name': 'cluster' });
		const getClient = yield* sharding.makeClient(ClusterEntity);
		const send = (entityId: string, payload: ProcessPayload): Effect.Effect<void, ClusterError, MetricsService | Resilience.State> => {
			const circuitName = `cluster.shard.${sharding.getShardId(EntityId.make(entityId), 'default')}`;
			const inferReason = (e: unknown): ClusterError['reason'] => Socket.isSocketError(e) ? 'RunnerUnavailable'
				: Predicate.hasProperty(e, '_tag') && typeof e._tag === 'string' && HashSet.has(ClusterError._knownTags, e._tag as ClusterError['reason']) ? e._tag as ClusterError['reason'] : 'RunnerUnavailable';
			const resilientSend = Resilience.run(circuitName, getClient(entityId)['process'](payload).pipe(
				Effect.asVoid,
				Effect.mapError((e): ClusterError => {
					const reason = inferReason(e);
					return ClusterError.from(reason, _ClusterReasons[reason].terminal ? undefined : entityId, { cause: e });
				}),
			), {
				bulkhead: _CONFIG.send.bulkhead,
				circuit: circuitName,
				retry: false,
				threshold: _CONFIG.circuit.threshold,
				timeout: _CONFIG.send.timeout,
			}).pipe(Effect.mapError((e): ClusterError => {
				const resilienceMap = { BulkheadError: 'MailboxFull', CircuitError: 'RunnerUnavailable', TimeoutError: 'SendTimeout' } as const;
				return e._tag in resilienceMap ? ClusterError.from(resilienceMap[e._tag as keyof typeof resilienceMap], entityId, { cause: e }) : e as ClusterError;
			}));
			return MetricsService.trackCluster(resilientSend, { entityType: 'Cluster', operation: 'send' });
		};
		const isLocal = Effect.fn('cluster.isLocal')((entityId: string) => Effect.sync(() => sharding.hasShardId(sharding.getShardId(EntityId.make(entityId), 'default'))));	// L1: Effect.fn for auto-tracing
		const generateId: Effect.Effect<Snowflake.Snowflake> = sharding.getSnowflake;
		yield* Effect.logInfo('ClusterService initialized');
		return { generateId, isLocal, send };
	}),
}) {
	static readonly Config = _CONFIG;
	static readonly Error = { Cluster: ClusterError, Singleton: SingletonError };
	static readonly Layer = _clusterLayer;
	static readonly Payload = { Process: ProcessPayload, Status: StatusPayload } as const;
	static readonly Response = { Status: StatusResponse } as const;
	// --- Singleton Factory: state persistence, lifecycle hooks, graceful shutdown ---
	static readonly singleton = <E, R, StateSchema extends S.Schema.Any = never>(
		name: string,
		run: (stateRef: Ref.Ref<S.Schema.Type<StateSchema>>) => Effect.Effect<void, E, R>,
		options?: {
			readonly shardGroup?: string;
			readonly state?: {
				readonly schema: StateSchema;
				readonly initial: S.Schema.Type<StateSchema>;
				readonly version?: number;
				readonly migrate?: (oldState: unknown, oldVersion: number) => S.Schema.Type<StateSchema>;
			};
			readonly onBecomeLeader?: Effect.Effect<void, never, R>;
			readonly onLoseLeadership?: Effect.Effect<void, never, R>;
		},) => {
		const _versionedKey = (n: string, v: number) => `${_CONFIG.singleton.keyPrefix}${n}:v${v}`;
		const stateVersion = options?.state?.version ?? 1;
		const stateKey = _versionedKey(name, stateVersion);
		return Singleton.make(
			name,
			Effect.gen(function* () {
				const sharding = yield* Sharding.Sharding;
				yield* Effect.annotateLogsScoped({ 'service.name': `singleton.${name}` });
				const fibers = yield* FiberMap.make<string>();
				const leaderTs = yield* Clock.currentTimeMillis;
				yield* options?.onBecomeLeader ?? Effect.void;
				yield* Effect.addFinalizer(() => options?.onLoseLeadership ?? Effect.void);
				const metrics = yield* MetricsService;
				const stateLabels = MetricsService.label({ singleton: name });
				const taggedOps = Metric.taggedWithLabels(metrics.singleton.stateOperations, stateLabels);
				const taggedErr = Metric.taggedWithLabels(metrics.singleton.stateErrors, stateLabels);
				const stateOpts = options?.state;
				const stateRef = yield* (stateOpts
					? Effect.gen(function* () {
							const db = yield* DatabaseService;
							const schema = stateOpts.schema as unknown as S.Schema<S.Schema.Type<StateSchema>, S.Schema.Encoded<StateSchema>, never>;
							const loadState = db.kvStore.getJson(stateKey, schema).pipe(
								Effect.tap(() => Metric.increment(taggedOps)),
								Effect.flatMap((opt) => Option.isSome(opt) ? Effect.succeed(opt.value) : stateVersion > 1
									? Effect.iterate({ found: Option.none<unknown>(), v: stateVersion - 1 }, {
										body: ({ v }) => db.kvStore.getJson(_versionedKey(name, v), S.Unknown).pipe(Effect.map((found) => ({ found, v: v - 1 }))),
										while: ({ found, v }) => Option.isNone(found) && v >= 1,
									}).pipe(Effect.flatMap(({ found }) => Option.match(found, {
										onNone: () => Effect.succeed(stateOpts.initial),
										onSome: (value) => stateOpts.migrate ? ((fn) => Effect.sync(() => fn(value, stateVersion - 1)))(stateOpts.migrate) : Effect.succeed(stateOpts.initial),
									})))
									: Effect.succeed(stateOpts.initial)),
							);
							const loaded = yield* loadState.pipe(
								Effect.retry(_retrySchedule(_CONFIG.retry.maxAttempts.state)),
								Effect.catchAllCause((cause) => Metric.increment(taggedErr).pipe(Effect.zipRight(Effect.logWarning('State load failed, using initial', { cause })), Effect.as(stateOpts.initial))),
							);
							const ref = yield* Ref.make(loaded);
							yield* Effect.addFinalizer(() => Ref.get(ref).pipe(
								Effect.flatMap((state) => db.kvStore.setJson(stateKey, state, schema)),
								Effect.retry(_retrySchedule(_CONFIG.retry.maxAttempts.state)),
								Effect.tap(() => Metric.increment(taggedOps)),
								Effect.catchAllCause((cause) => Metric.increment(taggedErr).pipe(
									Effect.zipRight(Effect.logError('State persist failed - potential data loss', { cause, singleton: name })),
									Effect.zipRight(Effect.die(SingletonError.from('StatePersistFailed', name, cause))),	// Propagate as defect for monitoring
								)),
							));
							return ref;
						})
					: Ref.make(undefined as unknown as S.Schema.Type<StateSchema>));
				const awaitShutdown = sharding.isShutdown.pipe(Effect.repeat(Schedule.spaced(Duration.millis(100)).pipe(Schedule.whileOutput((shutdown) => !shutdown))), Effect.tap(() => Effect.logInfo(`Singleton ${name} detected shutdown`)));
				const workStartTs = yield* Clock.currentTimeMillis;
				const migrationDuration = Duration.millis(workStartTs - leaderTs);
				yield* Metric.set(Metric.taggedWithLabels(metrics.singleton.migrationDuration, stateLabels), Duration.toSeconds(migrationDuration));
				yield* Effect.when(
					Metric.increment(Metric.taggedWithLabels(metrics.singleton.migrationSlaExceeded, stateLabels)).pipe(Effect.tap(() => Effect.logWarning('Migration SLA exceeded', { migration: Duration.format(migrationDuration), singleton: name, sla: Duration.format(_CONFIG.singleton.migrationSla) }))),
					() => Duration.greaterThan(migrationDuration, _CONFIG.singleton.migrationSla),
				);
				yield* FiberMap.run(fibers, 'main-work')(Context.Request.withinCluster({ isLeader: true })(
					MetricsService.trackEffect(Telemetry.span(run(stateRef), `singleton.${name}`, { metrics: false }), {
						duration: metrics.singleton.duration, errors: metrics.errors, labels: MetricsService.label({ singleton: name }),
					}).pipe(Effect.andThen(Clock.currentTimeMillis), Effect.tap((ts) => Effect.all([Metric.set(metrics.singleton.lastExecution, ts), Metric.increment(metrics.singleton.executions)], { discard: true }))),
				));
				yield* awaitShutdown.pipe(
					Effect.tap(() => Effect.logInfo(`Singleton ${name} interrupted gracefully`)),
					Effect.catchAllCause((cause) => Cause.isInterrupted(cause) ? Effect.void :
						Effect.logError(`Singleton ${name} exited unexpectedly`, { cause }).pipe(Effect.andThen(Effect.failCause(cause)))),
				);
			}),
			{ shardGroup: options?.shardGroup },
		).pipe(Layer.provide(_clusterLayer), Layer.provide(DatabaseService.Default), Layer.provide(MetricsService.Default));
	};
	// --- Cron Factory: stateless scheduled execution (for stateful cron, use singleton with Schedule) ---
	static readonly cron = <E, R>(config: {
		readonly name: string;
		readonly cron: Parameters<typeof ClusterCron.make>[0]['cron'];
		readonly execute: Effect.Effect<void, E, R>;
		readonly shardGroup?: string;
		readonly skipIfOlderThan?: Duration.DurationInput;
		readonly calculateNextRunFromPrevious?: boolean;}) =>
		ClusterCron.make({
			calculateNextRunFromPrevious: config.calculateNextRunFromPrevious ?? false,
			cron: config.cron,
			execute: Effect.annotateLogsScoped({ 'service.name': `cron.${config.name}` }).pipe(Effect.zipRight(_trackLeaderExecution(config.name, config.execute, 'cron'))),
			name: config.name,
			shardGroup: config.shardGroup,
			skipIfOlderThan: config.skipIfOlderThan ?? _CONFIG.cron.skipIfOlderThan,
		}).pipe(Layer.provide(_clusterLayer), Layer.provide(MetricsService.Default));
	static readonly checkHealth = {
		cluster: () => Telemetry.span(Effect.all({
			entities: _readMetric(ClusterMetrics.entities), runners: _readMetric(ClusterMetrics.runners),
			runnersHealthy: _readMetric(ClusterMetrics.runnersHealthy), shards: _readMetric(ClusterMetrics.shards), singletons: _readMetric(ClusterMetrics.singletons),
		}).pipe(Effect.map((m) => ({
			degraded: m.runnersHealthy < m.runners,
			healthy: m.runnersHealthy > 0 && m.singletons > 0,
			metrics: m,
		}))), 'cluster.checkClusterHealth'),
		singleton: (config: ReadonlyArray<{ readonly name: string; readonly expectedInterval: Duration.DurationInput }>) =>
			Telemetry.span(Effect.gen(function* () {
				const metrics = yield* MetricsService;
				const nowDt = DateTime.unsafeMake(yield* Clock.currentTimeMillis);
				const results = yield* Effect.forEach(config, ({ name, expectedInterval }) => {
					const labels = MetricsService.label({ singleton: name });
					const maxStale = Duration.times(Duration.decode(expectedInterval), _CONFIG.singleton.threshold);
					return Metric.value(Metric.taggedWithLabels(metrics.singleton.lastExecution, labels)).pipe(
						Effect.map(({ value }: { readonly value: number }) => {
							const valueDt = DateTime.unsafeMake(value);
							const elapsed = DateTime.distanceDuration(nowDt, valueDt);
							return {
								healthy: Duration.between(elapsed, { maximum: maxStale, minimum: Duration.zero }),
								lastExecution: value > 0 ? DateTime.formatIso(valueDt) : 'never', name,
								staleFormatted: value > 0 ? Duration.format(elapsed) : 'N/A', staleMs: Duration.toMillis(elapsed),
							};
						}),
					);
				}, { concurrency: 'unbounded' });
				const [healthy, unhealthy] = A.partition(results, (r) => r.healthy);
				return { healthy: A.isEmptyArray(unhealthy), healthyCount: healthy.length, singletons: results, unhealthyCount: unhealthy.length };
			}), 'cluster.checkSingletonHealth'),
	};
	static readonly cronInfo = (cron: Cron.Cron, opts?: { readonly nextCount?: number }) =>
		Effect.sync(() => {
			const date = new Date();
			const seq = Cron.sequence(cron, date);
			const n = opts?.nextCount ?? 5;
			const nextRuns = A.unfold({ count: 0, seq }, ({ count, seq }) =>
				count >= n ? Option.none() : ((r) => r.done ? Option.none() : Option.some([r.value, { count: count + 1, seq }] as const))(seq.next()), // NOSONAR S3358
			);
			return { matchesNow: Cron.match(cron, date), nextRuns };
		});
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace ClusterService {
	export type Entity = typeof ClusterEntity;
	export type Error = InstanceType<typeof ClusterError>;
	export type ErrorReason = Error['reason'];
	export type IdempotencyKey = typeof IdempotencyKey.Type;
	export type SnowflakeId = typeof SnowflakeId.Type;
	export type Status = typeof EntityStatus.Type;
	export type ProcessPayload = InstanceType<typeof ClusterService.Payload.Process>;
	export type StatusPayload = InstanceType<typeof ClusterService.Payload.Status>;
	export type StatusResponse = InstanceType<typeof ClusterService.Response.Status>;
	export type SingletonError = InstanceType<typeof SingletonError>;
	export type SingletonErrorReason = SingletonError['reason'];
	export interface SingletonHealthResult {
		readonly singletons: ReadonlyArray<{readonly name: string; readonly healthy: boolean; readonly lastExecution: string; readonly staleFormatted: string; readonly staleMs: number;}>;
		readonly healthy: boolean;
		readonly healthyCount: number;
		readonly unhealthyCount: number;
	}
	export interface ClusterHealthResult {
		readonly healthy: boolean;
		readonly degraded: boolean;
		readonly metrics: {readonly entities: number; readonly runners: number; readonly runnersHealthy: number; readonly shards: number; readonly singletons: number;};
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { ClusterService };
