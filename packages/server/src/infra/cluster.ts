/**
 * ClusterService facade for multi-pod coordination via @effect/cluster.
 * Entity sharding, shard ownership via advisory locks, distributed message routing.
 */
import { ClusterCron, ClusterMetrics, Entity, EntityId, HttpRunner, K8sHttpClient, RunnerHealth, Sharding, ShardingConfig, Singleton, Snowflake, SocketRunner, SqlMessageStorage, SqlRunnerStorage } from '@effect/cluster';
import { FetchHttpClient, Socket } from '@effect/platform';
import { NodeClusterSocket, NodeFileSystem, NodeHttpClient, NodeSocket, NodeSocketServer } from '@effect/platform-node';
import { Rpc, RpcSerialization } from '@effect/rpc';
import { PgClient } from '@effect/sql-pg';
import { Array as A, Cause, Chunk, Clock, Config, Cron, Data, DateTime, Duration, Effect, FiberMap, HashSet, Layer, Metric, Option, Predicate, Ref, Schedule, Schema as S } from 'effect';
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
const _scheduleRetry = (max: number, cap = _CONFIG.retry.cap) => Schedule.exponential(_CONFIG.retry.base).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(max)), Schedule.upTo(cap));

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
const _metricOpt = (svc: Option.Option<MetricsService>, f: (m: MetricsService) => Metric.Metric.Counter<number>): Effect.Effect<void> => Option.match(svc, { onNone: () => Effect.void, onSome: (m) => Metric.increment(f(m)) });
const ClusterEntityLive = ClusterEntity.toLayer(Effect.gen(function* () {
	const addr = yield* Entity.CurrentAddress;
	const stateRef = yield* EntityState.mk('idle').pipe(Effect.andThen(Ref.make));
	const metrics = yield* Effect.serviceOption(MetricsService);
	const trackActivation = _metricOpt(metrics, (m) => m.cluster.entityActivations);
	const trackDeactivation = _metricOpt(metrics, (m) => m.cluster.entityDeactivations);
	return {
		process: (envelope) => Context.Request.withinCluster({ entityId: addr.entityId, entityType: addr.entityType, shardId: addr.shardId })(
			Effect.gen(function* () {
				yield* trackActivation;
				yield* EntityState.transition(stateRef, 'processing');
				yield* Effect.logDebug('Entity processing', { entityId: addr.entityId, idempotencyKey: envelope.payload.idempotencyKey });
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
	defectRetryPolicy: _scheduleRetry(_CONFIG.retry.maxAttempts.defect),
	spanAttributes: { 'entity.service': 'cluster-infrastructure', 'entity.version': 'v1' },
});

// --- [ERRORS] ----------------------------------------------------------------

class ClusterError extends S.TaggedError<ClusterError>()('ClusterError', {
	cause: S.optional(S.Unknown),
	entityId: S.optional(S.String),
	reason: S.Literal('AlreadyProcessingMessage', 'EntityNotAssignedToRunner', 'MailboxFull', 'MalformedMessage', 'PersistenceError', 'RpcClientError', 'RunnerNotRegistered', 'RunnerUnavailable', 'SendTimeout', 'SerializationError', 'Suspended'),
	requestId: S.optional(S.String),
	resumeToken: S.optional(S.String),
}) {	// Polymorphic factory: reason determines required fields, opts allows cause/requestId/resumeToken
	static readonly from = (reason: ClusterError['reason'], entityId?: string, opts?: { cause?: unknown; requestId?: string; resumeToken?: string }) => new ClusterError({ cause: opts?.cause, entityId, reason, requestId: opts?.requestId, resumeToken: opts?.resumeToken });
	static readonly _knownTags = HashSet.fromIterable(['AlreadyProcessingMessage', 'EntityNotAssignedToRunner', 'MailboxFull', 'MalformedMessage', 'PersistenceError', 'RpcClientError', 'RunnerNotRegistered', 'SerializationError', 'Suspended'] as const);
	static readonly _globalErrors = HashSet.fromIterable(['PersistenceError', 'RunnerNotRegistered', 'SerializationError'] as const);
	static readonly _transient = HashSet.fromIterable(['MailboxFull', 'RunnerUnavailable', 'SendTimeout'] as const);
	static readonly isTransient = (e: ClusterError): boolean => HashSet.has(ClusterError._transient, e.reason);
}
class SingletonError extends Data.TaggedError('SingletonError')<{
	readonly reason: 'StateLoadFailed' | 'StatePersistFailed' | 'SchemaDecodeFailed' | 'HeartbeatFailed' | 'LeaderHandoffFailed';
	readonly cause?: unknown;
	readonly singletonName: string;
}> {
	static readonly from = (reason: SingletonError['reason'], name: string, cause?: unknown) => new SingletonError({ cause, reason, singletonName: name });
	static readonly _retryable = HashSet.fromIterable(['StateLoadFailed', 'StatePersistFailed'] as const);
	static readonly isRetryable = (e: SingletonError): boolean => HashSet.has(SingletonError._retryable, e.reason);
}

// --- [LAYERS] ----------------------------------------------------------------

const _storageLayers = (() => {	// Consolidated storage: dedicated PgClient for RunnerStorage (prevents advisory lock loss from connection recycling)
	const runnerPgClient = PgClient.layerConfig({
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
	return Layer.mergeAll(
		SqlRunnerStorage.layer.pipe(Layer.provide(runnerPgClient)),
		SqlMessageStorage.layer.pipe(Layer.provide(DbClient.layer)),
		ShardingConfig.layer({ entityMailboxCapacity: _CONFIG.entity.mailboxCapacity, entityMaxIdleTime: _CONFIG.entity.maxIdleTime, preemptiveShutdown: true, sendRetryInterval: _CONFIG.send.timeout, shardsPerGroup: 100 }),
		Snowflake.layerGenerator,
	);
})();
const _healthLayer = Layer.unwrapEffect(Effect.gen(function* () {	// Health mode: K8s in production, noop otherwise (consolidated config read)
	const [env, mode, namespace, labelSelector] = yield* Effect.all([
		Config.string('NODE_ENV').pipe(Config.withDefault('development')),
		Config.string('CLUSTER_HEALTH_MODE').pipe(Config.withDefault('auto')),
		Config.string('K8S_NAMESPACE').pipe(Config.withDefault('default')),
		Config.string('K8S_LABEL_SELECTOR').pipe(Config.withDefault('app=parametric-portal')),
	]);
	const useK8s = mode === 'k8s' || (mode === 'auto' && env === 'production');
	yield* Effect.logDebug('Cluster health mode selected', { mode, useK8s });
	return useK8s
		? RunnerHealth.layerK8s({ labelSelector, namespace }).pipe(Layer.provide(K8sHttpClient.layer), Layer.provide(NodeHttpClient.layerUndici), Layer.provide(NodeFileSystem.layer))
		: RunnerHealth.layerNoop;
}));
const _transportBase = Layer.mergeAll(RpcSerialization.layerMsgPack, _healthLayer, _storageLayers);
// Client-only HTTP layer for fallback (no local entity hosting, only message passing)
// Uses provideMerge to expose ShardingConfig, maintaining type compatibility with socket layer
const _httpClientLayer = HttpRunner.layerClient.pipe(Layer.provide(HttpRunner.layerClientProtocolHttpDefault), Layer.provide(FetchHttpClient.layer), Layer.provideMerge(_transportBase));
// Full socket runner layer for entity hosting
const _socketLayer = SocketRunner.layer.pipe(
	Layer.provide(NodeSocketServer.layer({ port: _CONFIG.socketServer.port })),
	Layer.provide(NodeClusterSocket.layerClientProtocol),
	Layer.provideMerge(_transportBase));
const _transports = {
	auto: _socketLayer.pipe(
		Layer.catchAll((e) => Effect.logWarning('Socket unavailable, using HTTP client-only (no local entity hosting)', { error: String(e) }).pipe(Effect.as(_httpClientLayer), Layer.unwrapEffect))),
	http: _httpClientLayer,
	socket: _socketLayer,
	websocket: HttpRunner.layerWebsocketClientOnly.pipe(
		Layer.provide(HttpRunner.layerClientProtocolWebsocketDefault),
		Layer.provide(NodeSocket.layerWebSocketConstructor),
		Layer.provide(FetchHttpClient.layer),
		Layer.provideMerge(_transportBase)),
} as const;
const _transportLayer = Layer.unwrapEffect(Effect.gen(function* () {	// Polymorphic transport selection via config
	const mode = yield* Config.string('CLUSTER_TRANSPORT').pipe(
		Config.withDefault<keyof typeof _transports>('auto'),
		Config.map((m): keyof typeof _transports => (m in _transports ? (m as keyof typeof _transports) : 'auto')),
	);
	yield* Effect.logInfo('Cluster transport selected', { mode });
	return _transports[mode];
}));
const _clusterLayer = ClusterEntityLive.pipe(Layer.provideMerge(_transportLayer));	// Entity layer with transport wiring, provideMerge exposes Sharding+ShardingConfig

// --- [SERVICE] ---------------------------------------------------------------

class ClusterService extends Effect.Service<ClusterService>()('server/Cluster', {
	dependencies: [_clusterLayer],
	effect: Effect.gen(function* () {
		const sharding = yield* Sharding.Sharding;
		yield* Effect.annotateLogsScoped({ 'service.name': 'cluster' });
		const getClient = yield* sharding.makeClient(ClusterEntity);
		const _inferReason = (e: unknown): ClusterError['reason'] => Socket.isSocketError(e) ? 'RunnerUnavailable'
			: Predicate.hasProperty(e, '_tag') && typeof e._tag === 'string' && HashSet.has(ClusterError._knownTags, e._tag as ClusterError['reason']) ? e._tag as ClusterError['reason'] : 'RunnerUnavailable';
		const _mapClusterError = (entityId: string) => (e: unknown): ClusterError =>
			((r) => ClusterError.from(r, HashSet.has(ClusterError._globalErrors, r) ? undefined : entityId, { cause: e }))(_inferReason(e));
		const _resilienceMap = { BulkheadError: 'MailboxFull', CircuitError: 'RunnerUnavailable', TimeoutError: 'SendTimeout' } as const satisfies Record<string, ClusterError['reason']>;
		const send = (entityId: string, payload: ProcessPayload): Effect.Effect<void, ClusterError, MetricsService> => {
			const circuitName = `cluster.shard.${sharding.getShardId(EntityId.make(entityId), 'default')}`;
			const mapResilienceError = (e: Resilience.Error<ClusterError>): ClusterError =>
				e._tag in _resilienceMap ? ClusterError.from(_resilienceMap[e._tag as keyof typeof _resilienceMap], entityId, { cause: e }) : e as ClusterError;
			const resilientSend = Resilience.run(circuitName, getClient(entityId)['process'](payload).pipe(Effect.asVoid, Effect.mapError(_mapClusterError(entityId))), {
				bulkhead: _CONFIG.send.bulkhead,
				circuit: circuitName,
				retry: false,
				threshold: _CONFIG.circuit.threshold,
				timeout: _CONFIG.send.timeout,
			}).pipe(Effect.mapError(mapResilienceError));
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
								Effect.retry(_scheduleRetry(_CONFIG.retry.maxAttempts.state)),
								Effect.catchAllCause((cause) => Metric.increment(taggedErr).pipe(Effect.zipRight(Effect.logWarning('State load failed, using initial', { cause })), Effect.as(stateOpts.initial))),
							);
							const ref = yield* Ref.make(loaded);
							yield* Effect.addFinalizer(() => Ref.get(ref).pipe(
								Effect.flatMap((state) => db.kvStore.setJson(stateKey, state, schema)),
								Effect.retry(_scheduleRetry(_CONFIG.retry.maxAttempts.state)),
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
			execute: Effect.gen(function* () {
				yield* Effect.annotateLogsScoped({ 'service.name': `cron.${config.name}` });
				const metrics = yield* MetricsService;
				yield* Context.Request.withinCluster({ isLeader: true })(
					MetricsService.trackEffect(Telemetry.span(config.execute, `cron.${config.name}`, { metrics: false }), {
						duration: metrics.singleton.duration, errors: metrics.errors, labels: MetricsService.label({ singleton: config.name, type: 'cron' }),
					}).pipe(Effect.andThen(Clock.currentTimeMillis), Effect.tap((ts) => Effect.all([Metric.set(metrics.singleton.lastExecution, ts), Metric.increment(metrics.singleton.executions)], { discard: true }))),
				);
			}),
			name: config.name,
			shardGroup: config.shardGroup,
			skipIfOlderThan: config.skipIfOlderThan ?? _CONFIG.cron.skipIfOlderThan,
		}).pipe(Layer.provide(_clusterLayer), Layer.provide(MetricsService.Default));
	static readonly checkHealth = {	// Health check utilities
		cluster: () => Telemetry.span(Effect.all({
			entities: Metric.value(ClusterMetrics.entities), runners: Metric.value(ClusterMetrics.runners),
			runnersHealthy: Metric.value(ClusterMetrics.runnersHealthy), shards: Metric.value(ClusterMetrics.shards), singletons: Metric.value(ClusterMetrics.singletons),
		}).pipe(Effect.map((m) => ({
			degraded: Number(m.runnersHealthy.value) < Number(m.runners.value),
			healthy: Number(m.runnersHealthy.value) > 0 && Number(m.singletons.value) > 0,
			metrics: { entities: Number(m.entities.value), runners: Number(m.runners.value), runnersHealthy: Number(m.runnersHealthy.value), shards: Number(m.shards.value), singletons: Number(m.singletons.value) },
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
				count >= n ? Option.none() : ((r) => r.done ? Option.none() : Option.some([r.value, { count: count + 1, seq }] as const))(seq.next()),
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
