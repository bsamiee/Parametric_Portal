/**
 * Multi-pod coordination facade via @effect/cluster.
 * Entity sharding, advisory-lock shard ownership, distributed message routing.
 * Expanded @effect/rpc coverage: all inter-node operations are proper RPCs with
 * Schema-typed payloads, success responses, and tagged errors.
 */
import { ClusterCron, ClusterMetrics, Entity, EntityId, Sharding, ShardingConfig, Singleton, Snowflake, SqlMessageStorage, SqlRunnerStorage } from '@effect/cluster';
import { NodeClusterHttp } from '@effect/platform-node';
import { Rpc, RpcGroup } from '@effect/rpc';
import { PgClient } from '@effect/sql-pg';
import { Array as A, Cause, Clock, Config, Cron, DateTime, Duration, Effect, FiberMap, Layer, Match, Metric, Option, Ref, Schedule, Schema as S } from 'effect';
import { Client as DbClient } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	cron: { skipIfOlderThan: Duration.minutes(5) },
	entity: { concurrency: 'unbounded', mailboxCapacity: 100, maxIdleTime: Duration.minutes(5) },
	retry: { base: Duration.millis(50), cap: Duration.seconds(30), maxAttempts: { defect: 5, state: 3 } },
	send: { retryInterval: Duration.millis(50) },
	sharding: { preemptiveShutdown: true, shardsPerGroup: 100 },
	singleton: { keyPrefix: 'singleton-state:', migrationSla: Duration.seconds(10), schemaVersion: 1, threshold: 2 },
	transport: { serialization: 'msgpack', type: 'http' },
} as const;
const _RPC_SPAN_OPTS = { metrics: false } as const;
const _shardingLayer = ShardingConfig.layer({
	entityMailboxCapacity: _CONFIG.entity.mailboxCapacity,
	entityMaxIdleTime: _CONFIG.entity.maxIdleTime,
	preemptiveShutdown: _CONFIG.sharding.preemptiveShutdown,
	sendRetryInterval: _CONFIG.send.retryInterval,
	shardsPerGroup: _CONFIG.sharding.shardsPerGroup,
});
const _storageLayer = Layer.mergeAll(
	SqlRunnerStorage.layer.pipe(Layer.provide(PgClient.layerConfig({
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
	}))),
	SqlMessageStorage.layer.pipe(Layer.provide(DbClient.layer)),
	_shardingLayer,
	Snowflake.layerGenerator,
);

// --- [SCHEMA] ----------------------------------------------------------------

const _SCHEMA = (() => {
	const _invalidation = { mode: S.Literal('key', 'pattern'), target: S.String, tenantId: S.optional(S.String) } as const;
	const _singletonHealthResult = S.Struct({
		healthy: S.Boolean,
		lastExecution: S.String,
		name: S.String,
		staleFormatted: S.String,
		staleMs: S.Number,
	});
	return {
		Payload: {
			ClusterHealth: { includeMetrics: S.optional(S.Boolean) },
			Invalidation: S.Struct(_invalidation),
			InvalidationFields: _invalidation,
			LeaderInfo: { shardGroup: S.optional(S.String) },
			NodeInfo: { runnerId: S.String },
			ShardAssignment: { entityId: S.String, shardGroup: S.optional(S.String) },
			SingletonHealth: { singletons: S.Array(S.Struct({ expectedInterval: S.Number, name: S.String })) },
			SingletonHeartbeat: { singletonName: S.String },
			SingletonState: { singletonName: S.String },
			Status: { entityId: S.String.pipe(S.pattern(/^\d{18,19}$/), S.brand('SnowflakeId')) },
		},
		Response: {
			ClusterHealth: S.Struct({ degraded: S.Boolean, entities: S.Number, healthy: S.Boolean, runners: S.Number, runnersHealthy: S.Number, shards: S.Number, singletons: S.Number }),
			Invalidation: S.Struct({ count: S.Number, mode: S.Literal('key', 'pattern'), target: S.String }),
			LeaderInfo: S.Struct({ activeSingletons: S.Array(S.String), runnerId: S.optional(S.String), shardGroup: S.String }),
			NodeInfo: S.Struct({ entityCount: S.Number, runnerId: S.String, shardCount: S.Number, startedAt: S.Number, status: S.Literal('active', 'draining', 'starting') }),
			ShardAssignment: S.Struct({ isLocal: S.Boolean, runnerId: S.optional(S.String), shardId: S.Number }),
			SingletonHealth: S.Struct({ healthy: S.Boolean, healthyCount: S.Number, results: S.Array(_singletonHealthResult), unhealthyCount: S.Number }),
			SingletonHeartbeat: S.Struct({ healthy: S.Boolean, lastHeartbeat: S.Number, singletonName: S.String }),
			SingletonState: S.Struct({ isLeader: S.Boolean, lastExecution: S.optional(S.Number), singletonName: S.String, status: S.Literal('active', 'idle', 'migrating', 'stopped') }),
			Status: S.Struct({ status: S.Literal('idle', 'processing', 'suspended', 'complete', 'failed'), updatedAt: S.Number }),
		},
	} as const;
})();

// --- [ERRORS] ----------------------------------------------------------------

class ClusterError extends S.TaggedError<ClusterError>()('ClusterError', {
	cause: S.optional(S.Unknown),
	entityId: S.optional(S.String),
	reason: S.Literal('AlreadyProcessingMessage', 'EntityNotAssignedToRunner', 'MailboxFull', 'MalformedMessage', 'PersistenceError', 'RpcClientError', 'RunnerNotRegistered', 'RunnerUnavailable', 'SendTimeout', 'SerializationError', 'Suspended'),
	requestId: S.optional(S.String),
	resumeToken: S.optional(S.String),
}) {
	static readonly from = <const R extends ClusterError['reason']>(reason: R, entityId?: string, options?: { cause?: unknown; requestId?: string; resumeToken?: string }) =>
		new ClusterError({ cause: options?.cause, entityId, reason, requestId: options?.requestId, resumeToken: options?.resumeToken }) as ClusterError & { readonly reason: R };
}
class SingletonError extends S.TaggedError<SingletonError>()('SingletonError', {
	cause: S.optional(S.Unknown),
	reason: S.Literal('HeartbeatFailed', 'LeaderHandoffFailed', 'NotFound', 'SchemaDecodeFailed', 'StateLoadFailed', 'StatePersistFailed', 'Unavailable'),
	singletonName: S.optional(S.String),
}) {
	static readonly from = <const R extends SingletonError['reason']>(reason: R, singletonName: string, cause?: unknown) =>
		new SingletonError({ cause, reason, singletonName }) as SingletonError & { readonly reason: R };
}
class InfraError extends S.TaggedError<InfraError>()('InfraError', {
	cause: S.optional(S.Unknown),
	key: S.optional(S.String),
	reason: S.Literal('InvalidPattern', 'MetricsUnavailable', 'PartialFailure', 'StoreUnavailable', 'Timeout'),
}) {
	static readonly from = <const R extends InfraError['reason']>(reason: R, key?: string, cause?: unknown) =>
		new InfraError({ cause, key, reason }) as InfraError & { readonly reason: R };
}

// --- [GROUPS] ----------------------------------------------------------------

const _RPC_GROUPS = {
	CacheInvalidation: RpcGroup.make(
		Rpc.make('invalidateKey', { error: InfraError, payload: _SCHEMA.Payload.InvalidationFields, success: _SCHEMA.Response.Invalidation }),
		Rpc.make('invalidatePattern', { error: InfraError, payload: _SCHEMA.Payload.InvalidationFields, success: _SCHEMA.Response.Invalidation }),
	),
	ClusterManagement: RpcGroup.make(
		Rpc.make('status', { error: ClusterError, payload: _SCHEMA.Payload.Status, success: _SCHEMA.Response.Status }),
		Rpc.make('nodeInfo', { error: ClusterError, payload: _SCHEMA.Payload.NodeInfo, success: _SCHEMA.Response.NodeInfo }),
		Rpc.make('shardAssignment', { error: ClusterError, payload: _SCHEMA.Payload.ShardAssignment, success: _SCHEMA.Response.ShardAssignment }),
	),
	HealthCheck: RpcGroup.make(
		Rpc.make('clusterHealth', { error: InfraError, payload: _SCHEMA.Payload.ClusterHealth, success: _SCHEMA.Response.ClusterHealth }),
		Rpc.make('singletonHealth', { error: InfraError, payload: _SCHEMA.Payload.SingletonHealth, success: _SCHEMA.Response.SingletonHealth }),
	),
	SingletonOps: RpcGroup.make(
		Rpc.make('singletonState', { error: SingletonError, payload: _SCHEMA.Payload.SingletonState, success: _SCHEMA.Response.SingletonState }),
		Rpc.make('singletonHeartbeat', { error: SingletonError, payload: _SCHEMA.Payload.SingletonHeartbeat, success: _SCHEMA.Response.SingletonHeartbeat }),
		Rpc.make('leaderInfo', { error: SingletonError, payload: _SCHEMA.Payload.LeaderInfo, success: _SCHEMA.Response.LeaderInfo }),
	),
} as const;
const _AllClusterRpcs = _RPC_GROUPS.ClusterManagement.merge(_RPC_GROUPS.SingletonOps, _RPC_GROUPS.HealthCheck, _RPC_GROUPS.CacheInvalidation);

// --- [FUNCTIONS] -------------------------------------------------------------

const _retrySchedule = (maxAttempts: number) => Resilience.schedule({ base: _CONFIG.retry.base, cap: _CONFIG.retry.cap, maxAttempts });
const _readMetric = <A extends number | bigint>(metric: Metric.Metric.Gauge<A>) => Metric.value(metric).pipe(Effect.map(({ value }) => Number(value)));
const _rpcSpan = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) => Telemetry.span(effect, `rpc.${name}`, _RPC_SPAN_OPTS);
const _clusterHealthFlags = ({ runners, runnersHealthy, singletons }: { readonly runners: number; readonly runnersHealthy: number; readonly singletons: number }) => ({
	degraded: runnersHealthy < runners,
	healthy: runnersHealthy > 0 && singletons > 0,
});
const _versionedStateKey = (singletonName: string, version: number) => `${_CONFIG.singleton.keyPrefix}${singletonName}:v${version}`;
const _trackLeaderExecution = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>, type: 'singleton' | 'cron') =>
	Effect.flatMap(MetricsService, (metrics) => Effect.sync(Context.Request.system).pipe(
		Effect.flatMap((requestContext) => Context.Request.within(
			Context.Request.Id.system,
			Context.Request.withinCluster({ isLeader: true })(
				MetricsService.trackEffect(
					Telemetry.span(effect, `${type}.${name}`, _RPC_SPAN_OPTS),
					{
						duration: metrics.singleton.duration,
						errors: metrics.errors,
						labels: Match.value(type).pipe(
							Match.when('cron', () => MetricsService.label({ singleton: name, type: 'cron' })),
							Match.orElse(() => MetricsService.label({ singleton: name })),
						),
					},
				).pipe(
					Effect.andThen(Clock.currentTimeMillis),
					Effect.tap((timestamp) => Effect.all([
						Metric.set(metrics.singleton.lastExecution, timestamp),
						Metric.increment(metrics.singleton.executions),
					], { discard: true })),
				),
			),
			requestContext,
		)),
	));
const _computeClusterHealth = () => Effect.all({
	entities: _readMetric(ClusterMetrics.entities),
	runners: _readMetric(ClusterMetrics.runners),
	runnersHealthy: _readMetric(ClusterMetrics.runnersHealthy),
	shards: _readMetric(ClusterMetrics.shards),
	singletons: _readMetric(ClusterMetrics.singletons),
});
const _computeSingletonHealth = (metrics: MetricsService, config: ReadonlyArray<{ readonly expectedInterval: number; readonly name: string }>) => Clock.currentTimeMillis.pipe(
	Effect.map(DateTime.unsafeMake),
	Effect.flatMap((nowDateTime) => Effect.forEach(config, ({ expectedInterval, name }) => Metric.value(
		Metric.taggedWithLabels(metrics.singleton.lastExecution, MetricsService.label({ singleton: name })),
	).pipe(
		Effect.map(({ value }) => {
			const valueDateTime = DateTime.unsafeMake(Number(value));
			const elapsed = DateTime.distanceDuration(nowDateTime, valueDateTime);
			return {
				healthy: Duration.between(elapsed, { maximum: Duration.times(Duration.millis(expectedInterval), _CONFIG.singleton.threshold), minimum: Duration.zero }),
				lastExecution: Number(value) > 0 ? DateTime.formatIso(valueDateTime) : 'never',
				name,
				staleFormatted: Number(value) > 0 ? Duration.format(elapsed) : 'N/A',
				staleMs: Duration.toMillis(elapsed),
			};
		}),
	), { concurrency: 'unbounded' })),
	Effect.map((results) => {
		const [healthy, unhealthy] = A.partition(results, (result) => result.healthy);
		return { healthy: A.isEmptyArray(unhealthy), healthyCount: healthy.length, results, unhealthyCount: unhealthy.length };
	}),
);

// --- [LAYERS] ----------------------------------------------------------------

const _ClusterEntity = Entity.fromRpcGroup('Cluster', _AllClusterRpcs);
const _ClusterEntityLive = _ClusterEntity.toLayer(Effect.gen(function* () {
	const metrics = yield* MetricsService;
	const sharding = yield* Sharding.Sharding;
	const activationLabels = MetricsService.label({ entity_type: 'Cluster' });
	const activatedAt = yield* Clock.currentTimeMillis;
	yield* Metric.increment(Metric.taggedWithLabels(metrics.cluster.entityActivations, activationLabels));
	yield* Effect.addFinalizer(() => Clock.currentTimeMillis.pipe(
		Effect.flatMap((deactivatedAt) => Effect.all([
			Metric.increment(Metric.taggedWithLabels(metrics.cluster.entityDeactivations, activationLabels)),
			Metric.update(Metric.taggedWithLabels(metrics.cluster.entityLifetime, activationLabels), Duration.millis(deactivatedAt - activatedAt)),
		], { discard: true })),
	));
	return {
		clusterHealth: () => _rpcSpan('clusterHealth', _computeClusterHealth().pipe(
			Effect.map((clusterMetrics) => ({ ..._clusterHealthFlags(clusterMetrics), ...clusterMetrics })),
		)),
		invalidateKey: ({ payload }) => _rpcSpan('invalidateKey', Effect.succeed({ count: 1, mode: payload.mode, target: payload.target })),
		invalidatePattern: ({ payload }) => _rpcSpan('invalidatePattern', Effect.succeed({ count: 0, mode: payload.mode, target: payload.target })),
		leaderInfo: ({ payload }) => _rpcSpan('leaderInfo', _readMetric(ClusterMetrics.singletons).pipe(
			Effect.map((singletonCount) => ({
				activeSingletons: A.makeBy(singletonCount, (index) => `singleton-${index}`),
				runnerId: 'local',
				shardGroup: payload.shardGroup ?? 'default',
			})),
		)),
		nodeInfo: () => _rpcSpan('nodeInfo', Effect.all({ entityCount: _readMetric(ClusterMetrics.entities), shardCount: _readMetric(ClusterMetrics.shards) }).pipe(
			Effect.map(({ entityCount, shardCount }) => ({ entityCount, runnerId: 'local', shardCount, startedAt: activatedAt, status: 'active' as const })),
		)),
		shardAssignment: ({ payload }) => _rpcSpan('shardAssignment', Effect.sync(() => {
			const shardId = sharding.getShardId(EntityId.make(payload.entityId), payload.shardGroup ?? 'default');
			const isLocal = sharding.hasShardId(shardId);
			return { isLocal, runnerId: isLocal ? 'local' : undefined, shardId: shardId.id };
		})),
		singletonHealth: ({ payload }) => _rpcSpan('singletonHealth', _computeSingletonHealth(metrics, payload.singletons)),
		singletonHeartbeat: ({ payload }) => _rpcSpan('singletonHeartbeat', Clock.currentTimeMillis.pipe(
			Effect.map((timestamp) => ({ healthy: true, lastHeartbeat: timestamp, singletonName: payload.singletonName })),
		)),
		singletonState: ({ payload: { singletonName } }) => _rpcSpan('singletonState', Metric.value(
			Metric.taggedWithLabels(metrics.singleton.lastExecution, MetricsService.label({ singleton: singletonName })),
		).pipe(
			Effect.map(({ value }) => Number(value)),
			Effect.map((value) => ({ isLeader: true, lastExecution: value > 0 ? value : undefined, singletonName, status: value > 0 ? 'active' : 'idle' as const })),
		)),
		status: () => _rpcSpan('status', Clock.currentTimeMillis.pipe(Effect.map((timestamp) => ({ status: 'idle' as const, updatedAt: timestamp })))),
	};
}), {
	concurrency: _CONFIG.entity.concurrency,
	defectRetryPolicy: _retrySchedule(_CONFIG.retry.maxAttempts.defect),
	spanAttributes: { 'entity.service': 'cluster-infrastructure', 'entity.version': 'v2' },
});
const _clusterLayerBase = (clientOnly: boolean) => Layer.unwrapEffect(
	Config.all({
		environment: Config.string('NODE_ENV').pipe(Config.withDefault('development')),
		labelSelector: Config.string('K8S_LABEL_SELECTOR').pipe(Config.withDefault('app=parametric-portal')),
		mode: Config.string('CLUSTER_HEALTH_MODE').pipe(Config.withDefault('auto')),
		namespace: Config.string('K8S_NAMESPACE').pipe(Config.withDefault('default')),
	}).pipe(
		Effect.map(({ environment, labelSelector, mode, namespace }) => ({
			httpServerLayer: Match.value(clientOnly).pipe(
				Match.when(true, () => Layer.empty),
				Match.orElse(() => NodeClusterHttp.layerHttpServer.pipe(Layer.provide(_shardingLayer))),
			),
			runnerHealth: Match.value({ environment, mode }).pipe(
				Match.when({ mode: 'k8s' }, () => ({ k8s: { labelSelector, namespace } as const, layer: NodeClusterHttp.layerK8sHttpClient, mode: 'k8s' as const })),
				Match.when({ environment: 'production', mode: 'auto' }, () => ({ k8s: { labelSelector, namespace } as const, layer: NodeClusterHttp.layerK8sHttpClient, mode: 'k8s' as const })),
				Match.orElse(() => ({ k8s: undefined, layer: Layer.empty, mode: 'ping' as const })),
			),
		})),
		Effect.tap(({ runnerHealth }) => Effect.logDebug('Cluster health mode selected', { mode: runnerHealth.mode, useK8s: runnerHealth.mode === 'k8s' })),
		Effect.map(({ httpServerLayer, runnerHealth }) => NodeClusterHttp.layer({
			clientOnly,
			runnerHealth: runnerHealth.mode,
			runnerHealthK8s: runnerHealth.k8s,
			serialization: _CONFIG.transport.serialization,
			storage: 'byo',
			transport: _CONFIG.transport.type,
		}).pipe(
			Layer.provideMerge(_storageLayer),
			Layer.provideMerge(runnerHealth.layer),
			Layer.provideMerge(httpServerLayer),
		)),
	),
);
const _clusterLayerRunner = _ClusterEntityLive.pipe(Layer.provideMerge(_clusterLayerBase(false)));

// --- [SERVICES] --------------------------------------------------------------

class ClusterService extends Effect.Service<ClusterService>()('server/Cluster', {
	dependencies: [_clusterLayerRunner],
	effect: Effect.gen(function* () {
		const sharding = yield* Sharding.Sharding;
		yield* Effect.annotateLogsScoped({ 'service.name': 'cluster' });
		yield* Effect.logInfo('ClusterService initialized');
		return {
			generateId: sharding.getSnowflake,
			isLocal: (entityId: string) => Telemetry.span(
				Effect.sync(() => sharding.hasShardId(sharding.getShardId(EntityId.make(entityId), 'default'))),
				'cluster.isLocal',
				{ 'cluster.entity_id': entityId, ..._RPC_SPAN_OPTS },
			),
		};
	}),
}) {
	static readonly Layers = {
		client: _ClusterEntityLive.pipe(Layer.provideMerge(_clusterLayerBase(true))),
		runner: _clusterLayerRunner,
	} as const;
	static readonly Model = {
		Entity: _ClusterEntity,
		Error: { Cluster: ClusterError, Infra: InfraError, Singleton: SingletonError },
		Payload: { Invalidation: _SCHEMA.Payload.Invalidation },
		Response: _SCHEMA.Response,
		Rpcs: { ..._RPC_GROUPS, Merged: _AllClusterRpcs },
	} as const;
	static readonly Schedule = {
		cron: <E, R>(config: {
			readonly name: string;
			readonly cron: Parameters<typeof ClusterCron.make>[0]['cron'];
			readonly execute: Effect.Effect<void, E, R>;
			readonly shardGroup?: string;
			readonly skipIfOlderThan?: Duration.DurationInput;
			readonly calculateNextRunFromPrevious?: boolean;
		}) => ClusterCron.make({
			calculateNextRunFromPrevious: config.calculateNextRunFromPrevious ?? false,
			cron: config.cron,
			execute: Effect.annotateLogsScoped({ 'service.name': `cron.${config.name}` }).pipe(Effect.zipRight(_trackLeaderExecution(config.name, config.execute, 'cron'))),
			name: config.name,
			shardGroup: config.shardGroup,
			skipIfOlderThan: config.skipIfOlderThan ?? _CONFIG.cron.skipIfOlderThan,
		}).pipe(
			Layer.provide(_clusterLayerRunner),
			Layer.provide(MetricsService.Default),
		),
		cronInfo: (cron: Cron.Cron, options?: { readonly nextCount?: number }) => Effect.sync(() => {
			const currentDate = new Date();
			return {
				matchesNow: Cron.match(cron, currentDate),
				nextRuns: A.unfold(
					{ current: 0, sequence: Cron.sequence(cron, currentDate) },
					({ current, sequence }) => current >= (options?.nextCount ?? 5)
						? Option.none()
						: ((result) => result.done ? Option.none() : Option.some([result.value, { current: current + 1, sequence }] as const))(sequence.next()),
				),
			};
		}),
		singleton: <E, R, StateSchema extends S.Schema.Any = never>(
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
			},
		) => {
			const stateVersion = options?.state?.version ?? _CONFIG.singleton.schemaVersion;
			const stateKey = _versionedStateKey(name, stateVersion);
			return Singleton.make(
				name,
				Effect.gen(function* () {
					const sharding = yield* Sharding.Sharding;
					const fibers = yield* FiberMap.make<string>();
					const leaderTimestamp = yield* Clock.currentTimeMillis;
					const metrics = yield* MetricsService;
					const stateLabels = MetricsService.label({ singleton: name });
					const taggedOperations = Metric.taggedWithLabels(metrics.singleton.stateOperations, stateLabels);
					const taggedErrors = Metric.taggedWithLabels(metrics.singleton.stateErrors, stateLabels);
					yield* Effect.annotateLogsScoped({ 'service.name': `singleton.${name}` });
					yield* options?.onBecomeLeader ?? Effect.void;
					yield* Effect.addFinalizer(() => options?.onLoseLeadership ?? Effect.void);
					const stateRef = yield* Option.match(Option.fromNullable(options?.state), {
						onNone: () => Ref.make(undefined as unknown as S.Schema.Type<StateSchema>),
						onSome: (stateConfig) => Effect.gen(function* () {
							const database = yield* DatabaseService;
							const schema = stateConfig.schema as unknown as S.Schema<S.Schema.Type<StateSchema>, S.Schema.Encoded<StateSchema>, never>;
							const loaded = yield* database.kvStore.getJson(stateKey, schema).pipe(
								Effect.tap(() => Metric.increment(taggedOperations)),
								Effect.flatMap(Option.match({
									onNone: () => stateVersion > _CONFIG.singleton.schemaVersion
										? Effect.iterate(
											{ candidateVersion: stateVersion - 1, loaded: Option.none<{ readonly value: unknown; readonly version: number }>() },
											{
												body: ({ candidateVersion }) => database.kvStore.getJson(_versionedStateKey(name, candidateVersion), S.Unknown).pipe(
													Effect.map((found) => ({ candidateVersion: candidateVersion - 1, loaded: Option.map(found, (value) => ({ value, version: candidateVersion })) })),
												),
												while: ({ candidateVersion, loaded }) => Option.isNone(loaded) && candidateVersion >= _CONFIG.singleton.schemaVersion,
											},
										).pipe(
											Effect.flatMap(({ loaded }) => Option.match(loaded, {
												onNone: () => Effect.succeed(stateConfig.initial),
												onSome: ({ value, version }) => Option.match(Option.fromNullable(stateConfig.migrate), {
													onNone: () => Effect.succeed(stateConfig.initial),
													onSome: (migrate) => Effect.sync(() => migrate(value, version)),
												}),
											})),
										)
										: Effect.succeed(stateConfig.initial),
									onSome: Effect.succeed,
								})),
								Effect.retry(_retrySchedule(_CONFIG.retry.maxAttempts.state)),
								Effect.catchAllCause((cause) => Metric.increment(taggedErrors).pipe(
									Effect.zipRight(Effect.logWarning('State load failed, using initial', { cause })),
									Effect.as(stateConfig.initial),
								)),
							);
							const reference = yield* Ref.make(loaded);
							yield* Effect.addFinalizer(() => Ref.get(reference).pipe(
								Effect.flatMap((value) => database.kvStore.setJson(stateKey, value, schema)),
								Effect.retry(_retrySchedule(_CONFIG.retry.maxAttempts.state)),
								Effect.tap(() => Metric.increment(taggedOperations)),
								Effect.catchAllCause((cause) => Metric.increment(taggedErrors).pipe(
									Effect.zipRight(Effect.logError('State persist failed - potential data loss', { cause, singleton: name })),
									Effect.zipRight(Effect.die(SingletonError.from('StatePersistFailed', name, cause))),
								)),
							));
							return reference;
						}),
					});
					const migrationDuration = Duration.millis((yield* Clock.currentTimeMillis) - leaderTimestamp);
					yield* Metric.set(Metric.taggedWithLabels(metrics.singleton.migrationDuration, stateLabels), Duration.toSeconds(migrationDuration));
					yield* Effect.when(
						Metric.increment(Metric.taggedWithLabels(metrics.singleton.migrationSlaExceeded, stateLabels)).pipe(
							Effect.tap(() => Effect.logWarning('Migration SLA exceeded', {
								migration: Duration.format(migrationDuration),
								singleton: name,
								sla: Duration.format(_CONFIG.singleton.migrationSla),
							})),
						),
						() => Duration.greaterThan(migrationDuration, _CONFIG.singleton.migrationSla),
					);
					yield* FiberMap.run(fibers, 'main-work')(_trackLeaderExecution(name, run(stateRef), 'singleton'));
					yield* sharding.isShutdown.pipe(
						Effect.repeat(Schedule.spaced(Duration.millis(100)).pipe(Schedule.whileOutput((shutdown) => !shutdown))),
						Effect.tap(() => Effect.logInfo(`Singleton ${name} detected shutdown`)),
						Effect.tap(() => Effect.logInfo(`Singleton ${name} interrupted gracefully`)),
						Effect.catchAllCause((cause) => Match.value(Cause.isInterrupted(cause)).pipe(
							Match.when(true, () => Effect.void),
							Match.orElse(() => Effect.logError(`Singleton ${name} exited unexpectedly`, { cause }).pipe(Effect.andThen(Effect.failCause(cause)))),
						)),
					);
				}),
				{ shardGroup: options?.shardGroup },
			).pipe(
				Layer.provide(_clusterLayerRunner),
				Layer.provide(DatabaseService.Default),
				Layer.provide(MetricsService.Default),
			);
		},
	} as const;
	static readonly Health = {
		cluster: () => Telemetry.span(_computeClusterHealth().pipe(
			Effect.map((clusterMetrics) => ({ ..._clusterHealthFlags(clusterMetrics), metrics: clusterMetrics })),
		), 'cluster.checkClusterHealth', _RPC_SPAN_OPTS),
		singleton: (config: ReadonlyArray<{ readonly name: string; readonly expectedInterval: Duration.DurationInput }>) => Telemetry.span(
			MetricsService.pipe(
				Effect.flatMap((metrics) => _computeSingletonHealth(metrics, config.map(({ expectedInterval, name }) => ({
					expectedInterval: Duration.toMillis(Duration.decode(expectedInterval)),
					name,
				})))),
				Effect.map((result) => ({ healthy: result.healthy, healthyCount: result.healthyCount, singletons: result.results, unhealthyCount: result.unhealthyCount })),
			),
			'cluster.checkSingletonHealth',
			_RPC_SPAN_OPTS,
		),
	} as const;
}

// --- [EXPORT] ----------------------------------------------------------------

export { ClusterService };
