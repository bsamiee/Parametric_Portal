/**
 * ClusterService facade for multi-pod coordination via @effect/cluster.
 * Entity sharding, shard ownership via advisory locks, distributed message routing.
 */
import { ClusterCron, ClusterMetrics, Entity, EntityId, HttpRunner, K8sHttpClient, RunnerHealth, Sharding, ShardingConfig, Singleton, Snowflake, SocketRunner, SqlMessageStorage, SqlRunnerStorage } from '@effect/cluster';
import { FetchHttpClient, Socket } from '@effect/platform';
import { NodeClusterSocket, NodeFileSystem, NodeHttpClient, NodeSocket } from '@effect/platform-node';
import { Rpc, RpcSerialization } from '@effect/rpc';
import { PgClient } from '@effect/sql-pg';
import { Array as A, Cause, Chunk, Clock, Config, Cron, Data, DateTime, Duration, Effect, Exit, FiberMap, Function as F, Layer, Match, Metric, Number as N, Option, Ref, Schedule, Schema as S } from 'effect';
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
	retry: {defect: { base: Duration.millis(100), factor: 2, maxAttempts: 5 }, transient: { base: Duration.millis(50), cap: Duration.seconds(5), maxAttempts: 3 },},
	send: { bulkhead: 5, timeout: Duration.millis(100) },			// Bulkhead prevents mailbox overflow (capacity=100), timeout enforces SLA
	singleton: {
		graceMs: Duration.toMillis(Duration.seconds(60)),
		heartbeatInterval: Duration.seconds(30),
		keyPrefix: 'singleton-state:',
		migrationSlaMs: 10_000,
		schemaVersion: 1,
		stateRetry: Schedule.exponential(Duration.millis(50)).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(3))),
		threshold: 2,												// 2x expected interval before staleness
	},
} as const;

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
}) { // Factories accept timestamp for testability via Clock layer mocking
	static readonly idle = (ts: number) => new EntityState({ status: 'idle', updatedAt: ts });
	static readonly processing = (ts: number) => new EntityState({ status: 'processing', updatedAt: ts });
	static readonly suspended = (signal: { name: string; token: string }, ts: number) => new EntityState({ pendingSignal: signal, status: 'suspended', updatedAt: ts });
}
const ClusterEntityLive = ClusterEntity.toLayer(Effect.gen(function* () {
	const currentAddress = yield* Entity.CurrentAddress;
	const stateRef = yield* Clock.currentTimeMillis.pipe(Effect.flatMap((ts) => Ref.make(EntityState.idle(ts))));
	const metrics = yield* Effect.serviceOption(MetricsService);
	const trackActivation = Option.match(metrics, { onNone: () => Effect.void, onSome: (m) => Metric.increment(m.cluster.entityActivations) });
	const trackDeactivation = Option.match(metrics, { onNone: () => Effect.void, onSome: (m) => Metric.increment(m.cluster.entityDeactivations) });
	return {
		process: (envelope) => Context.Request.withinCluster({	// withinCluster wraps ENTIRE handler: gen body + ensuring + catchAllCause
			entityId: currentAddress.entityId,
			entityType: currentAddress.entityType,
			shardId: currentAddress.shardId,
		})(
			Effect.gen(function* () {
				yield* trackActivation;
				const ts = yield* Clock.currentTimeMillis;
				yield* Ref.set(stateRef, EntityState.processing(ts));
				yield* Effect.logDebug('Entity processing', { entityId: currentAddress.entityId, idempotencyKey: envelope.payload.idempotencyKey });
				const completeTs = yield* Clock.currentTimeMillis;
				yield* Ref.set(stateRef, new EntityState({ status: 'complete', updatedAt: completeTs }));
			}).pipe(
				Effect.ensuring(Effect.all([
					Clock.currentTimeMillis.pipe(Effect.tap((ts) => Ref.update(stateRef, (s) => new EntityState({ ...s, updatedAt: ts })))),
					trackDeactivation,
				], { discard: true })),
				Effect.catchAllCause((cause) => Effect.fail(new EntityProcessError({
					cause,
					message: Chunk.isNonEmpty(Cause.defects(cause)) ? 'Internal error' : Cause.pretty(cause),
				}))),
			),
		),
		status: () => Ref.get(stateRef).pipe(Effect.map((s) => new StatusResponse({ status: s.status, updatedAt: s.updatedAt }))),
	};
}), {
	concurrency: _CONFIG.entity.concurrency,
	defectRetryPolicy: Schedule.exponential(_CONFIG.retry.defect.base).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(_CONFIG.retry.defect.maxAttempts)), Schedule.upTo(Duration.seconds(30))),
	disableFatalDefects: false,
	mailboxCapacity: _CONFIG.entity.mailboxCapacity,
	maxIdleTime: _CONFIG.entity.maxIdleTime,
	spanAttributes: { 'entity.service': 'cluster-infrastructure', 'entity.version': 'v1' },
});

// --- [ERRORS] ----------------------------------------------------------------

class ClusterError extends S.TaggedError<ClusterError>()('ClusterError', {
	cause: S.optional(S.Unknown),
	entityId: S.optional(S.String),
	reason: S.Literal('AlreadyProcessingMessage', 'EntityNotAssignedToRunner', 'MailboxFull', 'MalformedMessage', 'PersistenceError', 'RpcClientError', 'RunnerNotRegistered', 'RunnerUnavailable', 'SendTimeout', 'SerializationError', 'Suspended'),
	requestId: S.optional(S.String),
	resumeToken: S.optional(S.String),
}) {
	static readonly fromAlreadyProcessing = (entityId: string, cause?: unknown) => new ClusterError({ cause, entityId, reason: 'AlreadyProcessingMessage' });
	static readonly fromEntityNotAssigned = (entityId: string, cause?: unknown) => new ClusterError({ cause, entityId, reason: 'EntityNotAssignedToRunner' });
	static readonly fromMailboxFull = (entityId: string, cause?: unknown) => new ClusterError({ cause, entityId, reason: 'MailboxFull' });
	static readonly fromMalformedMessage = (cause?: unknown) => new ClusterError({ cause, reason: 'MalformedMessage' });
	static readonly fromPersistence = (cause?: unknown) => new ClusterError({ cause, reason: 'PersistenceError' });
	static readonly fromRpcClientError = (entityId: string, cause: unknown, requestId?: string) => new ClusterError({ cause, entityId, reason: 'RpcClientError', requestId });
	static readonly fromRunnerNotRegistered = (cause?: unknown) => new ClusterError({ cause, reason: 'RunnerNotRegistered' });
	static readonly fromRunnerUnavailable = (entityId: string, cause?: unknown) => new ClusterError({ cause, entityId, reason: 'RunnerUnavailable' });
	static readonly fromSendTimeout = (entityId: string, cause?: unknown) => new ClusterError({ cause, entityId, reason: 'SendTimeout' });
	static readonly fromSerializationError = (cause?: unknown) => new ClusterError({ cause, reason: 'SerializationError' });
	static readonly fromSuspended = (entityId: string, resumeToken: string) => new ClusterError({ entityId, reason: 'Suspended', resumeToken });
	// Transient reasons via Set membership — O(1) lookup, scales with more reasons
	static readonly _transient: ReadonlySet<ClusterError['reason']> = new Set(['MailboxFull', 'SendTimeout']);
	static readonly isTransient = (e: ClusterError): boolean => ClusterError._transient.has(e.reason);
}
class SingletonError extends Data.TaggedError('SingletonError')<{
	readonly reason: 'StateLoadFailed' | 'StatePersistFailed' | 'SchemaDecodeFailed' | 'HeartbeatFailed' | 'LeaderHandoffFailed';
	readonly cause?: unknown;
	readonly singletonName: string;
}> {
	// Set-based retryable check — O(1) lookup, matches ClusterError._transient pattern
	static readonly _retryable: ReadonlySet<SingletonError['reason']> = new Set(['StateLoadFailed', 'StatePersistFailed']);
	static readonly isRetryable = (e: SingletonError): boolean => SingletonError._retryable.has(e.reason);
	// Static factories — match ClusterError.from* pattern for consistency
	static readonly fromStateLoad = (name: string, cause?: unknown) => new SingletonError({ cause, reason: 'StateLoadFailed', singletonName: name });
	static readonly fromStatePersist = (name: string, cause?: unknown) => new SingletonError({ cause, reason: 'StatePersistFailed', singletonName: name });
	static readonly fromSchemaDecode = (name: string, cause?: unknown) => new SingletonError({ cause, reason: 'SchemaDecodeFailed', singletonName: name });
	static readonly fromHeartbeat = (name: string, cause?: unknown) => new SingletonError({ cause, reason: 'HeartbeatFailed', singletonName: name });
	static readonly fromLeaderHandoff = (name: string, cause?: unknown) => new SingletonError({ cause, reason: 'LeaderHandoffFailed', singletonName: name });
	// Direct factory — reason literal union provides type safety without Match overhead
	static readonly from = ({ reason, name, cause }: { reason: SingletonError['reason']; name: string; cause?: unknown }) => new SingletonError({ cause, reason, singletonName: name });
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
		ShardingConfig.layer({ entityMailboxCapacity: _CONFIG.entity.mailboxCapacity, preemptiveShutdown: true, shardsPerGroup: 100 }),
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
const _transportBase = Layer.mergeAll(RpcSerialization.layerMsgPack, _healthLayer, _storageLayers);	// Shared transport base: serialization + health + storage (DRY across all transports)
const _transports = {	// Transport dispatch table - protocol-specific layers only, base provided once
	auto: SocketRunner.layerClientOnly.pipe(
		Layer.provide(NodeClusterSocket.layerClientProtocol),
		Layer.provide(_transportBase),
		Layer.catchAll((e) => Layer.effectDiscard(Effect.logWarning('Socket transport unavailable, using HTTP', { error: String(e) })).pipe(
			Layer.provideMerge(HttpRunner.layerClient.pipe(Layer.provide(HttpRunner.layerClientProtocolHttpDefault), Layer.provide(FetchHttpClient.layer), Layer.provide(_transportBase))),
		)),
	),
	http: HttpRunner.layerClient.pipe(Layer.provide(HttpRunner.layerClientProtocolHttpDefault), Layer.provide(FetchHttpClient.layer), Layer.provide(_transportBase)),
	socket: SocketRunner.layerClientOnly.pipe(Layer.provide(NodeClusterSocket.layerClientProtocol), Layer.provide(_transportBase)),
	websocket: HttpRunner.layerClient.pipe(Layer.provide(HttpRunner.layerClientProtocolWebsocketDefault), Layer.provide(NodeSocket.layerWebSocketConstructor), Layer.provide(FetchHttpClient.layer), Layer.provide(_transportBase)),
} as const;
const _transportLayer = Layer.unwrapEffect(Effect.gen(function* () {	// Polymorphic transport selection via config
	const mode = yield* Config.string('CLUSTER_TRANSPORT').pipe(
		Config.withDefault<keyof typeof _transports>('auto'),
		Config.map((m): keyof typeof _transports => (m in _transports ? (m as keyof typeof _transports) : 'auto')),
	);
	yield* Effect.logInfo('Cluster transport selected', { mode });
	return _transports[mode];
}));
const _clusterLayer = ClusterEntityLive.pipe(Layer.provide(_transportLayer));	// Entity layer with transport wiring

// --- [SERVICE] ---------------------------------------------------------------

class ClusterService extends Effect.Service<ClusterService>()('server/Cluster', {
	dependencies: [_clusterLayer],
	effect: Effect.gen(function* () {
		const sharding = yield* Sharding.Sharding;
		yield* Effect.annotateLogsScoped({ 'service.name': 'cluster' });
		const getClient = yield* sharding.makeClient(ClusterEntity);
		const _mapClusterError = (entityId: string) => (e: unknown): ClusterError =>	// Error mapping: @effect/cluster errors → ClusterError via Match
			Match.value(e).pipe(
				Match.when({ _tag: 'AlreadyProcessingMessage' }, (err) => ClusterError.fromAlreadyProcessing(entityId, err)),
				Match.when({ _tag: 'MailboxFull' }, (err) => ClusterError.fromMailboxFull(entityId, err)),
				Match.when({ _tag: 'PersistenceError' }, (err) => ClusterError.fromPersistence(err)),
				Match.when(Socket.isSocketError, (err) => ClusterError.fromRunnerUnavailable(entityId, err)),
				Match.orElse((err) => ClusterError.fromRunnerUnavailable(entityId, err)),
			);
		const send = (entityId: string, payload: ProcessPayload): Effect.Effect<void, ClusterError, MetricsService> => {
			const circuitName = `cluster.shard.${sharding.getShardId(EntityId.make(entityId), 'default')}`;
			const mapResilienceError = (e: Resilience.Error<ClusterError>): ClusterError =>	// Map Resilience wrapper errors → ClusterError (type guards, not _tag dispatch)
				Resilience.is(e, 'TimeoutError') ? ClusterError.fromSendTimeout(entityId, e) :
				Resilience.is(e, 'CircuitError') ? ClusterError.fromRunnerUnavailable(entityId, e) :
				Resilience.is(e, 'BulkheadError') ? ClusterError.fromMailboxFull(entityId, e) : e;
			const resilientSend = Resilience.run(circuitName, getClient(entityId)['process'](payload).pipe(Effect.asVoid, Effect.mapError(_mapClusterError(entityId))), {
				bulkhead: _CONFIG.send.bulkhead,
				circuit: circuitName,
				retry: false,
				threshold: _CONFIG.circuit.threshold,
				timeout: _CONFIG.send.timeout,
			}).pipe(Effect.mapError(mapResilienceError));
			return MetricsService.trackCluster(resilientSend, { entityType: 'Cluster', operation: 'send' });
		};
		const isLocal = (entityId: string): Effect.Effect<boolean> => Telemetry.span(Effect.sync(() => sharding.hasShardId(sharding.getShardId(EntityId.make(entityId), 'default'))), 'cluster.isLocal', { 'entity.id': entityId });
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
			readonly state?: { readonly schema: StateSchema; readonly initial: S.Schema.Type<StateSchema> };
			readonly onBecomeLeader?: Effect.Effect<void, never, R>;
			readonly onLoseLeadership?: Effect.Effect<void, never, R>;
		},) => {
		const stateKey = `${_CONFIG.singleton.keyPrefix}${name}`;
		return Singleton.make(
			name,
			Effect.gen(function* () {
				const sharding = yield* Sharding.Sharding;
				yield* Effect.annotateLogsScoped({ 'service.name': `singleton.${name}` });
				const fibers = yield* FiberMap.make<string>();
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
							const loaded = yield* db.kvStore.getJson(stateKey, schema).pipe(
								Effect.tap(() => Metric.increment(taggedOps)),
								Effect.retry(_CONFIG.singleton.stateRetry),
								Effect.map(Option.getOrElse(F.constant(stateOpts.initial))),
								Effect.catchAllCause((cause) => Metric.increment(taggedErr).pipe(Effect.zipRight(Effect.logWarning('State load failed, using initial', { cause })), Effect.as(stateOpts.initial))),
							);
							const ref = yield* Ref.make(loaded);
							yield* Effect.addFinalizer(() => Ref.get(ref).pipe(
								Effect.flatMap((state) => db.kvStore.setJson(stateKey, state, schema)),
								Effect.retry(_CONFIG.singleton.stateRetry),
								Effect.tap(() => Metric.increment(taggedOps)),
								Effect.catchAllCause((cause) => Metric.increment(taggedErr).pipe(Effect.zipRight(Effect.logError('State persist failed', { cause })))),
							));
							return ref;
						})
					: Ref.make(undefined as unknown as S.Schema.Type<StateSchema>));
				const awaitShutdown = sharding.isShutdown.pipe(Effect.repeat(Schedule.recurUntil<boolean>(F.identity)), Effect.tap(() => Effect.logInfo(`Singleton ${name} detected shutdown`)));	// recurUntil(identity) = repeat until shutdown === true
				yield* FiberMap.run(fibers, 'main-work')(Context.Request.withinCluster({ isLeader: true })(
					MetricsService.trackEffect(Telemetry.span(run(stateRef), `singleton.${name}`, { metrics: false }), {
						duration: metrics.singleton.duration, errors: metrics.errors, labels: MetricsService.label({ singleton: name }),
					}).pipe(Effect.andThen(Clock.currentTimeMillis), Effect.tap((ts) => Effect.all([Metric.set(metrics.singleton.lastExecution, ts), Metric.increment(metrics.singleton.executions)], { discard: true }))),
				));
				yield* Effect.raceFirst(Effect.never, awaitShutdown).pipe(
					Effect.exit,
					Effect.flatMap((exit) => Effect.if(Exit.isInterrupted(exit), { onFalse: () => Effect.logWarning(`Singleton ${name} exited unexpectedly`), onTrue: () => Effect.logInfo(`Singleton ${name} interrupted gracefully`) })),
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
		singleton: (config: ReadonlyArray<{ readonly name: string; readonly expectedIntervalMs: number }>) =>
			Telemetry.span(Effect.gen(function* () {
				const metrics = yield* MetricsService;
				const nowDt = DateTime.unsafeMake(yield* Clock.currentTimeMillis);
				const results = yield* Effect.forEach(config, ({ name, expectedIntervalMs }) => {
					const labels = MetricsService.label({ singleton: name });
					return Metric.value(Metric.taggedWithLabels(metrics.singleton.lastExecution, labels)).pipe(
						Effect.map(({ value }: { readonly value: number }) => {
							const valueDt = DateTime.unsafeMake(value);
							const elapsed = DateTime.distanceDuration(nowDt, valueDt);
							const elapsedMs = Duration.toMillis(elapsed);
							return {
								healthy: N.between({ maximum: expectedIntervalMs * _CONFIG.singleton.threshold, minimum: 0 })(elapsedMs),
								lastExecution: value > 0 ? DateTime.formatIso(valueDt) : 'never', name,
								staleFormatted: value > 0 ? Duration.format(elapsed) : 'N/A', staleMs: elapsedMs,
							};
						}),
					);
				}, { concurrency: 'unbounded' });
				const [healthy, unhealthy] = A.partition(results, (r) => r.healthy);
				return { healthy: A.isEmptyArray(unhealthy), healthyCount: healthy.length, singletons: results, unhealthyCount: unhealthy.length };
			}), 'cluster.checkSingletonHealth'),
	};
	static readonly cronInfo = (cron: Cron.Cron, opts?: { readonly nextCount?: number }) =>	// Cron schedule info
		Clock.currentTimeMillis.pipe(Effect.map((now) => {
			const date = new Date(now);
			const seq = Cron.sequence(cron, date);
			return { matchesNow: Cron.match(cron, date), nextRuns: A.makeBy(opts?.nextCount ?? 5, () => seq.next().value) };
		}));
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
