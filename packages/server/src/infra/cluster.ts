/**
 * ClusterService facade for multi-pod coordination via @effect/cluster.
 * Entity sharding, shard ownership via advisory locks, distributed message routing.
 */
import { ClusterCron, Entity, EntityId, HttpRunner, K8sHttpClient, RunnerHealth, Sharding, ShardingConfig, Singleton, Snowflake, SocketRunner, SqlMessageStorage, SqlRunnerStorage } from '@effect/cluster';
import type { AlreadyProcessingMessage, MailboxFull, PersistenceError } from '@effect/cluster/ClusterError';
import { FetchHttpClient, Socket } from '@effect/platform';
import { NodeClusterSocket, NodeFileSystem, NodeHttpClient, NodeSocket } from '@effect/platform-node';
import { Rpc, RpcSerialization } from '@effect/rpc';
import { PgClient } from '@effect/sql-pg';
import { Boolean as B, Cause, Chunk, Clock, Config, Data, Duration, Effect, Layer, Match, Number as N, Ref, Schedule, Schema as S } from 'effect';
import { Client as DbClient } from '@parametric-portal/database/client';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	cron: 	{ skipIfOlderThan: Duration.minutes(5) },
	entity: { concurrency: 1, mailboxCapacity: 100, maxIdleTime: Duration.minutes(5) },
	retry: 	{
		defect:    { base: Duration.millis(100), factor: 2, maxAttempts: 5 },
		transient: { base: Duration.millis(50),  cap: Duration.seconds(5), maxAttempts: 3 },
	},
	singleton: {
		graceMs: Duration.toMillis(Duration.seconds(60)),
		heartbeatInterval: Duration.seconds(30),
		keyPrefix: 'singleton-state:',
		migrationSlaMs: 10_000,
		schemaVersion: 1,
		// N.clamp ensures threshold stays within bounds — self-documenting validation
		threshold: N.clamp({ maximum: 5, minimum: 1 })(2),
	},
	sla: 	{ sendTimeout: Duration.millis(100) },
} as const;

// --- [SCHEMA] ----------------------------------------------------------------

const IdempotencyKey = S.String.pipe(S.minLength(1), S.maxLength(255), S.pattern(/^[a-zA-Z0-9:_-]+$/), S.brand('IdempotencyKey'));
const SnowflakeId = S.String.pipe(S.pattern(/^\d{18,19}$/), S.brand('SnowflakeId'));
const EntityStatus = S.Literal('idle', 'processing', 'suspended', 'complete', 'failed');
class ProcessPayload extends S.Class<ProcessPayload>('ProcessPayload')({ data: S.Unknown, entityId: SnowflakeId, idempotencyKey: S.optional(IdempotencyKey) }) {}
class StatusPayload extends S.Class<StatusPayload>('StatusPayload')({ entityId: SnowflakeId }) {}
class StatusResponse extends S.Class<StatusResponse>('StatusResponse')({ status: EntityStatus, updatedAt: S.Number }) {}
class EntityProcessError extends S.TaggedError<EntityProcessError>()('EntityProcessError', { cause: S.optional(S.Unknown), message: S.String }) {}
const ClusterEntity = Entity.make('Cluster', [
	// primaryKey: idempotencyKey required for determinism (Date.now() violates replay safety per research)
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
	const initTs = yield* Clock.currentTimeMillis;
	const stateRef = yield* Ref.make(EntityState.idle(initTs));
	return {
		process: (envelope) => Effect.gen(function* () {
			const ts = yield* Clock.currentTimeMillis;
			yield* Ref.set(stateRef, EntityState.processing(ts));
			yield* Effect.logDebug('Entity processing', { entityId: currentAddress.entityId, idempotencyKey: envelope.payload.idempotencyKey });
			const completeTs = yield* Clock.currentTimeMillis;
			yield* Ref.set(stateRef, new EntityState({ status: 'complete', updatedAt: completeTs }));
		}).pipe(
			Effect.ensuring(Clock.currentTimeMillis.pipe(Effect.flatMap((ts) => Ref.update(stateRef, (s) => new EntityState({ ...s, updatedAt: ts }))))),
			Effect.matchCauseEffect({
				onFailure: (cause) => Effect.fail(new EntityProcessError({
					cause,
					message: B.match(Chunk.isNonEmpty(Cause.defects(cause)), { onFalse: () => Cause.pretty(cause), onTrue: () => 'Internal error' }),
				})),
				onSuccess: Effect.succeed,
			}),
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

	// Exhaustive factory via Match.type — compile-time guarantee all reasons have factory
	// Use when reason comes from external source (e.g., deserialized error)
	static readonly from = Match.type<{ reason: SingletonError['reason']; name: string; cause?: unknown }>().pipe(
		Match.when({ reason: 'StateLoadFailed' }, ({ name, cause }) => SingletonError.fromStateLoad(name, cause)),
		Match.when({ reason: 'StatePersistFailed' }, ({ name, cause }) => SingletonError.fromStatePersist(name, cause)),
		Match.when({ reason: 'SchemaDecodeFailed' }, ({ name, cause }) => SingletonError.fromSchemaDecode(name, cause)),
		Match.when({ reason: 'HeartbeatFailed' }, ({ name, cause }) => SingletonError.fromHeartbeat(name, cause)),
		Match.when({ reason: 'LeaderHandoffFailed' }, ({ name, cause }) => SingletonError.fromLeaderHandoff(name, cause)),
		Match.exhaustive,
	);
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
		const send = (entityId: string, payload: ProcessPayload): Effect.Effect<void, ClusterError, MetricsService> =>
			MetricsService.trackCluster(
				Telemetry.span(
					getClient(entityId)['process'](payload).pipe(
						Effect.asVoid,
						Effect.timeoutFail({ duration: _CONFIG.sla.sendTimeout, onTimeout: () => ClusterError.fromSendTimeout(entityId, 'SLA exceeded') }),
						Effect.catchTags({
							AlreadyProcessingMessage: (e: AlreadyProcessingMessage) => Effect.fail(ClusterError.fromAlreadyProcessing(entityId, e)),
							MailboxFull: (e: MailboxFull) => Effect.fail(ClusterError.fromMailboxFull(entityId, e)),
							PersistenceError: (e: PersistenceError) => Effect.fail(ClusterError.fromPersistence(e)),
						}),
						Effect.catchIf(Socket.isSocketError, (e) => Effect.fail(ClusterError.fromRunnerUnavailable(entityId, e))),
						Effect.catchAll((e: unknown) => Effect.fail(ClusterError.fromRunnerUnavailable(entityId, e))),
						Effect.retry({
							schedule: Schedule.exponential(_CONFIG.retry.transient.base).pipe(
								Schedule.jittered,
								Schedule.intersect(Schedule.recurs(_CONFIG.retry.transient.maxAttempts)),
								Schedule.upTo(_CONFIG.retry.transient.cap),
							),
							while: ClusterError.isTransient,
						}),
					),
					'cluster.send',
					{ 'entity.id': entityId },
				),
				{ entityType: 'Cluster', operation: 'send' },
			);
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
	// Layer factories - compose at startup, pre-wired with ClusterLive + telemetry spans
	static readonly singleton = <E, R>(name: string, run: Effect.Effect<void, E, R>, options?: { readonly shardGroup?: string }) => Singleton.make(name, Telemetry.span(run, `singleton.${name}`), options).pipe(Layer.provide(_clusterLayer));
	static readonly cron = <E, R>(config: {
		readonly name: string;
		readonly cron: Parameters<typeof ClusterCron.make>[0]['cron'];
		readonly execute: Effect.Effect<void, E, R>;
		readonly shardGroup?: string;
		readonly skipIfOlderThan?: Duration.DurationInput;}) => ClusterCron.make({
		cron: config.cron,
		execute: Telemetry.span(config.execute, `cron.${config.name}`),
		name: config.name,
		shardGroup: config.shardGroup,
		skipIfOlderThan: config.skipIfOlderThan ?? _CONFIG.cron.skipIfOlderThan,
	}).pipe(Layer.provide(_clusterLayer));
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
}

// --- [EXPORT] ----------------------------------------------------------------

export { ClusterService };
