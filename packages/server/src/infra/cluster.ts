/**
 * Multi-pod coordination facade via @effect/cluster.
 * Entity sharding, advisory-lock shard ownership, distributed message routing.
 */
import { ClusterCron, ClusterMetrics, Entity, EntityId, Sharding, ShardingConfig, Singleton, Snowflake, SqlMessageStorage, SqlRunnerStorage } from '@effect/cluster';
import { NodeClusterHttp } from '@effect/platform-node';
import { Rpc } from '@effect/rpc';
import { PgClient } from '@effect/sql-pg';
import { Array as A, Cause, Clock, Config, Cron, Data, DateTime, Duration, Effect, FiberMap, Layer, Match, Metric, Option, Ref, Schedule, Schema as S } from 'effect';
import { Client as DbClient } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	cron: 		{ skipIfOlderThan: Duration.minutes(5) },
	entity: 	{ concurrency: 1, mailboxCapacity: 100, maxIdleTime: Duration.minutes(5) },
	retry: 		{ base: Duration.millis(50), cap: Duration.seconds(30), maxAttempts: { defect: 5, state: 3, transient: 3 } },
	send: 		{ retryInterval: Duration.millis(50) },
	sharding: 	{ preemptiveShutdown: true, shardsPerGroup: 100 },
	singleton: 	{ grace: Duration.seconds(60), heartbeatInterval: Duration.seconds(30), keyPrefix: 'singleton-state:', migrationSla: Duration.seconds(10), schemaVersion: 1, threshold: 2 },
	transport: 	{ serialization: 'msgpack', type: 'http' },
} as const;
const _retrySchedule = (maxAttempts: number) => Resilience.schedule({ base: _CONFIG.retry.base, cap: _CONFIG.retry.cap, maxAttempts });

// --- [SCHEMA] ----------------------------------------------------------------

class StatusPayload extends S.Class<StatusPayload>('StatusPayload')({ entityId: S.String.pipe(S.pattern(/^\d{18,19}$/), S.brand('SnowflakeId')) }) {}
class StatusResponse extends S.Class<StatusResponse>('StatusResponse')({ status: S.Literal('idle', 'processing', 'suspended', 'complete', 'failed'), updatedAt: S.Number }) {}

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
class SingletonError extends Data.TaggedError('SingletonError')<{
	readonly reason: 'HeartbeatFailed' | 'LeaderHandoffFailed' | 'SchemaDecodeFailed' | 'StateLoadFailed' | 'StatePersistFailed';
	readonly cause?: unknown;
	readonly singletonName: string;
}> {
	static readonly from = <const R extends SingletonError['reason']>(reason: R, name: string, cause?: unknown) =>
		new SingletonError({ cause, reason, singletonName: name }) as SingletonError & { readonly reason: R };
}

// --- [LAYERS] ----------------------------------------------------------------

const _ClusterEntity = Entity.make('Cluster', [Rpc.make('status', { payload: StatusPayload.fields, success: StatusResponse })]);
const _ClusterEntityLive = _ClusterEntity.toLayer(Effect.succeed({
	status: () => Clock.currentTimeMillis.pipe(Effect.map((timestamp) => new StatusResponse({ status: 'idle', updatedAt: timestamp }))),
}), {
	concurrency: _CONFIG.entity.concurrency,
	defectRetryPolicy: _retrySchedule(_CONFIG.retry.maxAttempts.defect),
	spanAttributes: { 'entity.service': 'cluster-infrastructure', 'entity.version': 'v1' },
});
const _shardingLayer = ShardingConfig.layer({
	entityMailboxCapacity: 	_CONFIG.entity.mailboxCapacity,
	entityMaxIdleTime: 		_CONFIG.entity.maxIdleTime,
	preemptiveShutdown: 	_CONFIG.sharding.preemptiveShutdown,
	sendRetryInterval: 		_CONFIG.send.retryInterval,
	shardsPerGroup: 		_CONFIG.sharding.shardsPerGroup,
});
const _runnerPgLayer = PgClient.layerConfig({
	applicationName: 		Config.succeed('cluster-runner-storage'),
	connectionTTL: 			Config.succeed(Duration.hours(24)),
	connectTimeout: 		Config.succeed(Duration.seconds(10)),
	database: 				Config.string('POSTGRES_DB').pipe(Config.withDefault('parametric')),
	host: 					Config.string('POSTGRES_HOST').pipe(Config.withDefault('localhost')),
	idleTimeout: 			Config.succeed(Duration.hours(24)),
	maxConnections: 		Config.succeed(1),
	minConnections: 		Config.succeed(1),
	password: 				Config.redacted('POSTGRES_PASSWORD'),
	port: 					Config.integer('POSTGRES_PORT').pipe(Config.withDefault(5432)),
	spanAttributes: 		Config.succeed({ 'db.system': 'postgresql', 'service.name': 'cluster-runner-storage' }),
	username: 				Config.string('POSTGRES_USER').pipe(Config.withDefault('postgres')),
});
const _storageLayers = Layer.mergeAll(
	SqlRunnerStorage.layer.pipe(Layer.provide(_runnerPgLayer)),
	SqlMessageStorage.layer.pipe(Layer.provide(DbClient.layer)),
	_shardingLayer,
	Snowflake.layerGenerator,
);
const _resolveRunnerHealth = (environment: string, mode: string, labelSelector: string, namespace: string) => Match.value({ environment, mode }).pipe(
	Match.when({ mode: 'k8s' }, () => ({ k8s: { labelSelector, namespace } as const, layer: NodeClusterHttp.layerK8sHttpClient, mode: 'k8s' as const })),
	Match.when({ environment: 'production', mode: 'auto' }, () => ({ k8s: { labelSelector, namespace } as const, layer: NodeClusterHttp.layerK8sHttpClient, mode: 'k8s' as const })),
	Match.orElse(() => ({ k8s: undefined, layer: Layer.empty, mode: 'ping' as const })),
);
const _clusterLayerBase = (clientOnly: boolean) => Layer.unwrapEffect(
	Config.all({
		environment: Config.string('NODE_ENV').pipe(Config.withDefault('development')),
		labelSelector: Config.string('K8S_LABEL_SELECTOR').pipe(Config.withDefault('app=parametric-portal')),
		mode: Config.string('CLUSTER_HEALTH_MODE').pipe(Config.withDefault('auto')),
		namespace: Config.string('K8S_NAMESPACE').pipe(Config.withDefault('default')),
	}).pipe(
		Effect.map((config) => ({
			httpServerLayer: Match.value(clientOnly).pipe(
				Match.when(true, () => Layer.empty),
				Match.orElse(() => NodeClusterHttp.layerHttpServer.pipe(Layer.provide(_shardingLayer))),
			),
			runnerHealth: _resolveRunnerHealth(config.environment, config.mode, config.labelSelector, config.namespace),
		})),
		Effect.tap(({ runnerHealth }) => Effect.logDebug('Cluster health mode selected', {
			mode: runnerHealth.mode,
			useK8s: runnerHealth.mode === 'k8s',
		})),
		Effect.map(({ httpServerLayer, runnerHealth }) => NodeClusterHttp.layer({
			clientOnly,
			runnerHealth: runnerHealth.mode,
			runnerHealthK8s: runnerHealth.k8s,
			serialization: _CONFIG.transport.serialization,
			storage: 'byo',
			transport: _CONFIG.transport.type,
		}).pipe(
			Layer.provideMerge(_storageLayers),
			Layer.provideMerge(runnerHealth.layer),
			Layer.provideMerge(httpServerLayer),
		)),
	),
);
const _clusterLayerClient = _ClusterEntityLive.pipe(Layer.provideMerge(_clusterLayerBase(true)));
const _clusterLayerRunner = _ClusterEntityLive.pipe(Layer.provideMerge(_clusterLayerBase(false)));

// --- [FUNCTIONS] -------------------------------------------------------------

const _trackLabels = (name: string, type: 'singleton' | 'cron') => Match.value(type).pipe(
	Match.when('cron', () => MetricsService.label({ singleton: name, type: 'cron' })),
	Match.orElse(() => MetricsService.label({ singleton: name })),
);
const _trackLeaderExecution = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>, type: 'singleton' | 'cron') =>
	Effect.flatMap(MetricsService, (metrics) => Effect.sync(Context.Request.system).pipe(
		Effect.flatMap((requestContext) => Context.Request.within(
			Context.Request.Id.system,
			Context.Request.withinCluster({ isLeader: true })(
				MetricsService.trackEffect(
					Telemetry.span(effect, `${type}.${name}`, { metrics: false }),
					{
						duration: metrics.singleton.duration,
						errors: metrics.errors,
						labels: _trackLabels(name, type),
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
const _readMetric = <A extends number | bigint>(metric: Metric.Metric.Gauge<A>) => Metric.value(metric).pipe(
	Effect.map(({ value }) => Number(value)),
);

// --- [SERVICE] ---------------------------------------------------------------

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
				{ 'cluster.entity_id': entityId, metrics: false },
			),
		};
	}),
}) {
	static readonly Layers = {client: _clusterLayerClient, runner: _clusterLayerRunner,} as const;
	static readonly Model = {
		Entity: _ClusterEntity,
		Error: {Cluster: ClusterError, Singleton: SingletonError,},
		Payload: {Status: StatusPayload,},
		Response: {Status: StatusResponse,},
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
			execute: Effect.annotateLogsScoped({ 'service.name': `cron.${config.name}` }).pipe(Effect.zipRight(_trackLeaderExecution(config.name, config.execute, 'cron')),),
			name: config.name,
			shardGroup: config.shardGroup,
			skipIfOlderThan: config.skipIfOlderThan ?? _CONFIG.cron.skipIfOlderThan,
		}).pipe(
			Layer.provide(_clusterLayerRunner),
			Layer.provide(MetricsService.Default),
		),
		cronInfo: (cron: Cron.Cron, options?: { readonly nextCount?: number }) => Effect.sync(() => {
			const currentDate = new Date();
			const sequence = Cron.sequence(cron, currentDate);
			const count = options?.nextCount ?? 5;
			const nextRuns = A.unfold(
				{ current: 0, sequence },
				({ current, sequence }) => current >= count
					? Option.none()
					: ((result) => result.done
						? Option.none()
						: Option.some([result.value, { current: current + 1, sequence }] as const))(sequence.next()),
			);
			return { matchesNow: Cron.match(cron, currentDate), nextRuns };
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
			const _versionedKey = (singletonName: string, version: number) => `${_CONFIG.singleton.keyPrefix}${singletonName}:v${version}`;
			const stateKey = _versionedKey(name, stateVersion);
			return Singleton.make(
				name,
				Effect.gen(function* () {
					const sharding = yield* Sharding.Sharding;
					yield* Effect.annotateLogsScoped({ 'service.name': `singleton.${name}` });
					const fibers = yield* FiberMap.make<string>();
					const leaderTimestamp = yield* Clock.currentTimeMillis;
					yield* options?.onBecomeLeader ?? Effect.void;
					yield* Effect.addFinalizer(() => options?.onLoseLeadership ?? Effect.void);
					const metrics = yield* MetricsService;
					const stateLabels = MetricsService.label({ singleton: name });
					const taggedOperations = Metric.taggedWithLabels(metrics.singleton.stateOperations, stateLabels);
					const taggedErrors = Metric.taggedWithLabels(metrics.singleton.stateErrors, stateLabels);
					const stateRef = yield* Option.match(Option.fromNullable(options?.state), {
						onNone: () => Ref.make(undefined as unknown as S.Schema.Type<StateSchema>),
						onSome: (stateConfig) => Effect.gen(function* () {
							const database = yield* DatabaseService;
							const schema = stateConfig.schema as unknown as S.Schema<S.Schema.Type<StateSchema>, S.Schema.Encoded<StateSchema>, never>;
							const loadedState = yield* database.kvStore.getJson(stateKey, schema).pipe(
								Effect.tap(() => Metric.increment(taggedOperations)),
								Effect.flatMap(Option.match({
									onNone: () => Match.value(stateVersion > _CONFIG.singleton.schemaVersion).pipe(
										Match.when(true, () => Effect.iterate(
											{
												candidateVersion: stateVersion - 1,
												loaded: Option.none<{ readonly value: unknown; readonly version: number }>(),
											},
											{
												body: ({ candidateVersion }) => database.kvStore.getJson(_versionedKey(name, candidateVersion), S.Unknown).pipe(
													Effect.map((found) => ({
														candidateVersion: candidateVersion - 1,
														loaded: Option.map(found, (value) => ({ value, version: candidateVersion })),
													})),
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
										)),
										Match.orElse(() => Effect.succeed(stateConfig.initial)),
									),
									onSome: (value) => Effect.succeed(value),
								})),
								Effect.retry(_retrySchedule(_CONFIG.retry.maxAttempts.state)),
								Effect.catchAllCause((cause) => Metric.increment(taggedErrors).pipe(
									Effect.zipRight(Effect.logWarning('State load failed, using initial', { cause })),
									Effect.as(stateConfig.initial),
								)),
							);
							const reference = yield* Ref.make(loadedState);
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
					const awaitShutdown = sharding.isShutdown.pipe(
						Effect.repeat(Schedule.spaced(Duration.millis(100)).pipe(Schedule.whileOutput((shutdown) => !shutdown),),),
						Effect.tap(() => Effect.logInfo(`Singleton ${name} detected shutdown`)),
					);
					const migrationDuration = Duration.millis((yield* Clock.currentTimeMillis) - leaderTimestamp);
					yield* Metric.set(
						Metric.taggedWithLabels(metrics.singleton.migrationDuration, stateLabels),
						Duration.toSeconds(migrationDuration),
					);
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
					yield* awaitShutdown.pipe(
						Effect.tap(() => Effect.logInfo(`Singleton ${name} interrupted gracefully`)),
						Effect.catchAllCause((cause) => Match.value(Cause.isInterrupted(cause)).pipe(
							Match.when(true, () => Effect.void),
							Match.orElse(() => Effect.logError(`Singleton ${name} exited unexpectedly`, { cause }).pipe(
								Effect.andThen(Effect.failCause(cause)),
							)),
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
		cluster: () => Telemetry.span(
			Effect.all({
				entities: _readMetric(ClusterMetrics.entities),
				runners: _readMetric(ClusterMetrics.runners),
				runnersHealthy: _readMetric(ClusterMetrics.runnersHealthy),
				shards: _readMetric(ClusterMetrics.shards),
				singletons: _readMetric(ClusterMetrics.singletons),
			}).pipe(Effect.map((metrics) => ({
				degraded: metrics.runnersHealthy < metrics.runners,
				healthy: metrics.runnersHealthy > 0 && metrics.singletons > 0,
				metrics,
			}))),
			'cluster.checkClusterHealth',
			{ metrics: false },
		),
		singleton: (config: ReadonlyArray<{ readonly name: string; readonly expectedInterval: Duration.DurationInput }>) => Telemetry.span(
			Effect.gen(function* () {
				const metrics = yield* MetricsService;
				const nowDateTime = DateTime.unsafeMake(yield* Clock.currentTimeMillis);
				const results = yield* Effect.forEach(config, ({ expectedInterval, name }) => {
					const labels = MetricsService.label({ singleton: name });
					const maxStale = Duration.times(Duration.decode(expectedInterval), _CONFIG.singleton.threshold);
					return Metric.value(Metric.taggedWithLabels(metrics.singleton.lastExecution, labels)).pipe(
						Effect.map(({ value }: { readonly value: number }) => {
							const valueDateTime = DateTime.unsafeMake(value);
							const elapsed = DateTime.distanceDuration(nowDateTime, valueDateTime);
							return {
								healthy: Duration.between(elapsed, { maximum: maxStale, minimum: Duration.zero }),
								lastExecution: value > 0 ? DateTime.formatIso(valueDateTime) : 'never',
								name,
								staleFormatted: value > 0 ? Duration.format(elapsed) : 'N/A',
								staleMs: Duration.toMillis(elapsed),
							};
						}),
					);
				}, { concurrency: 'unbounded' });
				const [healthy, unhealthy] = A.partition(results, (result) => result.healthy);
				return { healthy: A.isEmptyArray(unhealthy), healthyCount: healthy.length, singletons: results, unhealthyCount: unhealthy.length };
			}),
			'cluster.checkSingletonHealth',
			{ metrics: false },
		),
	} as const;
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace ClusterService {
	export type Entity = typeof ClusterService.Model.Entity;
	export namespace Types {
		export type ClusterError = InstanceType<typeof ClusterService.Model.Error.Cluster>;
		export type ClusterErrorReason = Types.ClusterError['reason'];
		export type SingletonError = InstanceType<typeof ClusterService.Model.Error.Singleton>;
		export type SingletonErrorReason = Types.SingletonError['reason'];
		export type StatusPayload = S.Schema.Type<typeof ClusterService.Model.Payload.Status>;
		export type StatusResponse = S.Schema.Type<typeof ClusterService.Model.Response.Status>;
		export type SnowflakeId = Types.StatusPayload['entityId'];
		export type Status = Types.StatusResponse['status'];
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { ClusterService };
