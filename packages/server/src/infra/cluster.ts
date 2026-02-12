/**
 * Multi-pod coordination facade via @effect/cluster.
 * Entity sharding, advisory-lock shard ownership, distributed message routing.
 * Expanded @effect/rpc coverage: all inter-node operations are proper RPCs with
 * Schema-typed payloads, success responses, and tagged errors.
 */
import { ClusterCron, ClusterMetrics, Entity, EntityId, RunnerStorage, Sharding, ShardingConfig, Singleton, Snowflake, SqlMessageStorage, SqlRunnerStorage } from '@effect/cluster';
import { NodeClusterHttp } from '@effect/platform-node';
import { Rpc, RpcGroup } from '@effect/rpc';
import { Array as A, Cause, Clock, Config, Cron, DateTime, Duration, Effect, FiberMap, HashRing, Layer, Metric, Option, Ref, Schedule, Schema as S } from 'effect';
import { Client as DbClient } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { CacheService } from '../platform/cache.ts';
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
    entityMaxIdleTime:  _CONFIG.entity.maxIdleTime,
    preemptiveShutdown: _CONFIG.sharding.preemptiveShutdown,
    sendRetryInterval:  _CONFIG.send.retryInterval,
    shardsPerGroup:     _CONFIG.sharding.shardsPerGroup,
});

// --- [SCHEMA] ----------------------------------------------------------------

const _SCHEMA = {
    Payload: {
        ClusterHealth: {},
        Invalidation: { mode: S.Literal('key', 'pattern'), storeId: S.String, target: S.String },
        LeaderInfo: { shardGroup: S.optional(S.String) },
        NodeInfo: { runnerId: S.String },
        ShardAssignment: { entityId: S.String, shardGroup: S.optional(S.String) },
        SingletonHealth: { singletons: S.Array(S.Struct({ expectedInterval: S.Number, name: S.String })) },
        SingletonHeartbeat: { singletonName: S.String },
        SingletonState: { singletonName: S.String },
        Status: { entityId: S.String.pipe(S.pattern(/^\d{18,19}$/), S.brand('SnowflakeId')) },
    },
    Response: {
        ClusterHealth:      S.Struct({ degraded: S.Boolean, entities: S.Number, healthy: S.Boolean, runners: S.Number, runnersHealthy: S.Number, shards: S.Number, singletons: S.Number }),
        Invalidation:       S.Struct({ count: S.Number, mode: S.Literal('key', 'pattern'), target: S.String }),
        LeaderInfo:         S.Struct({ runnerId: S.optional(S.String), shardGroup: S.String }),
        NodeInfo:           S.Struct({ entityCount: S.Number, runnerId: S.String, shardCount: S.Number, startedAt: S.Number, status: S.Literal('active') }),
        ShardAssignment:    S.Struct({ isLocal: S.Boolean, runnerId: S.optional(S.String), shardId: S.Number }),
        SingletonHealth:    S.Struct({ healthy: S.Boolean, healthyCount: S.Number, results: S.Array(S.Struct({ healthy: S.Boolean, lastExecution: S.String, name: S.String, staleFormatted: S.String, staleMs: S.Number })), unhealthyCount: S.Number }),
        SingletonHeartbeat: S.Struct({ healthy: S.Boolean, lastHeartbeat: S.Number, singletonName: S.String }),
        SingletonState:     S.Struct({ isLeader: S.Boolean, lastExecution: S.optional(S.Number), singletonName: S.String, status: S.Literal('active', 'idle', 'stopped') }),
        Status:             S.Struct({ status: S.Literal('idle', 'processing', 'suspended'), updatedAt: S.Number }),
    },
} as const;

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
        Rpc.make('invalidate',          { error: InfraError, payload: _SCHEMA.Payload.Invalidation, success: _SCHEMA.Response.Invalidation }),
    ),
    ClusterManagement: RpcGroup.make(
        Rpc.make('status',              { error: ClusterError, payload: _SCHEMA.Payload.Status, success: _SCHEMA.Response.Status }),
        Rpc.make('nodeInfo',            { error: ClusterError, payload: _SCHEMA.Payload.NodeInfo, success: _SCHEMA.Response.NodeInfo }),
        Rpc.make('shardAssignment',     { error: ClusterError, payload: _SCHEMA.Payload.ShardAssignment, success: _SCHEMA.Response.ShardAssignment }),
    ),
    HealthCheck: RpcGroup.make(
        Rpc.make('clusterHealth',       { error: InfraError, payload: _SCHEMA.Payload.ClusterHealth, success: _SCHEMA.Response.ClusterHealth }),
        Rpc.make('singletonHealth',     { error: InfraError, payload: _SCHEMA.Payload.SingletonHealth, success: _SCHEMA.Response.SingletonHealth }),
    ),
    SingletonOps: RpcGroup.make(
        Rpc.make('singletonState',      { error: SingletonError, payload: _SCHEMA.Payload.SingletonState, success: _SCHEMA.Response.SingletonState }),
        Rpc.make('singletonHeartbeat',  { error: SingletonError, payload: _SCHEMA.Payload.SingletonHeartbeat, success: _SCHEMA.Response.SingletonHeartbeat }),
        Rpc.make('leaderInfo',          { error: SingletonError, payload: _SCHEMA.Payload.LeaderInfo, success: _SCHEMA.Response.LeaderInfo }),
    ),
} as const;
const _AllClusterRpcs = _RPC_GROUPS.ClusterManagement.merge(_RPC_GROUPS.SingletonOps, _RPC_GROUPS.HealthCheck, _RPC_GROUPS.CacheInvalidation);

// --- [FUNCTIONS] -------------------------------------------------------------

const _retrySchedule = (maxAttempts: number) => Resilience.schedule({ base: _CONFIG.retry.base, cap: _CONFIG.retry.cap, maxAttempts });
const _readMetric = <A extends number | bigint>(metric: Metric.Metric.Gauge<A>) => Metric.value(metric).pipe(Effect.map(({ value }) => Number(value)));
const _rpcSpan = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) => Telemetry.span(effect, `rpc.${name}`, _RPC_SPAN_OPTS);
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
                        labels: MetricsService.label(type === 'cron' ? { singleton: name, type: 'cron' } : { singleton: name }),
                    },
                ).pipe(
                    Effect.andThen(Clock.currentTimeMillis),
                    Effect.tap((timestamp) => Effect.all([
                        Metric.set(Metric.taggedWithLabels(metrics.singleton.lastExecution, MetricsService.label({ singleton: name })), timestamp),
                        Metric.increment(metrics.singleton.executions),
                    ], { discard: true })),
                ),
            ),
            requestContext,
        )),
    ));
const _readSingletonMetric = (metrics: MetricsService, singletonName: string) => Metric.value(
    Metric.taggedWithLabels(metrics.singleton.lastExecution, MetricsService.label({ singleton: singletonName })),
).pipe(Effect.map(({ value }) => Number(value)));
const _computeSingletonHealth = (metrics: MetricsService, config: ReadonlyArray<{ readonly expectedInterval: number; readonly name: string }>) => Clock.currentTimeMillis.pipe(
    Effect.map(DateTime.unsafeMake),
    Effect.flatMap((now) => Effect.forEach(config, ({ expectedInterval, name }) => _readSingletonMetric(metrics, name).pipe(
        Effect.map((ts) => {
            const dt = DateTime.unsafeMake(ts), elapsed = DateTime.distanceDuration(now, dt), hasRun = ts > 0;
            return { healthy: Duration.between(elapsed, { maximum: Duration.times(Duration.millis(expectedInterval), _CONFIG.singleton.threshold), minimum: Duration.zero }), lastExecution: hasRun ? DateTime.formatIso(dt) : 'never', name, staleFormatted: hasRun ? Duration.format(elapsed) : 'N/A', staleMs: Duration.toMillis(elapsed) };
        }),
    ), { concurrency: 'unbounded' })),
    Effect.map((results) => {
        const unhealthyCount = A.filter(results, (r) => !r.healthy).length;
        return { healthy: unhealthyCount === 0, healthyCount: results.length - unhealthyCount, results, unhealthyCount };
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
        clusterHealth: () => _rpcSpan('clusterHealth', Effect.all({
            entities: _readMetric(ClusterMetrics.entities), runners: _readMetric(ClusterMetrics.runners),
            runnersHealthy: _readMetric(ClusterMetrics.runnersHealthy), shards: _readMetric(ClusterMetrics.shards), singletons: _readMetric(ClusterMetrics.singletons),
        }).pipe(Effect.map((m) => ({ ...m, degraded: m.runnersHealthy < m.runners, healthy: m.runnersHealthy > 0 && m.singletons > 0 })))),
        invalidate: ({ payload }) => _rpcSpan(
            'invalidate.controlPlane',
            Effect.succeed(payload).pipe(
                Effect.filterOrFail(
                    ({ storeId, target }) => storeId.trim().length > 0 && target.trim().length > 0,
                    () => InfraError.from('InvalidPattern', `${payload.storeId}:${payload.target}`),
                ),
                Effect.tap(({ mode, storeId, target }) => Effect.logDebug('Cluster invalidation RPC', { mode, storeId, target })),
                Effect.flatMap(({ mode, storeId, target }) =>
                    (mode === 'key' ? CacheService.invalidate(storeId, target) : CacheService.invalidatePattern(storeId, target)).pipe(
                        Effect.filterOrFail(
                            (count) => Number.isFinite(count) && count >= 0,
                            () => InfraError.from('StoreUnavailable', `${storeId}:${target}`),
                        ),
                        Effect.map((count) => ({ count, mode, target })),
                        Effect.tap((result) => Effect.logDebug('Cluster invalidation RPC completed', result)),
                    )),
            ),
        ),
        leaderInfo: ({ payload }) => _rpcSpan('leaderInfo', ShardingConfig.ShardingConfig.pipe(
            Effect.map((config) => ({
                runnerId: Option.getOrUndefined(Option.map(config.runnerAddress, (a) => a.toString())),
                shardGroup: payload.shardGroup ?? 'default',
            })),
        )),
        nodeInfo: ({ payload }) => _rpcSpan('nodeInfo', Effect.all({
            entityCount: _readMetric(ClusterMetrics.entities),
            isLocal: ShardingConfig.ShardingConfig.pipe(Effect.map((c) => Option.getOrUndefined(Option.map(c.runnerAddress, (a) => a.toString())) === payload.runnerId)),
            registered: RunnerStorage.RunnerStorage.pipe(
                Effect.flatMap((rs) => rs.getRunners),
                Effect.map(A.findFirst(([r]) => r.address.toString() === payload.runnerId)),
                Effect.mapError((cause): ClusterError => ClusterError.from('PersistenceError', undefined, { cause })),
            ),
            shardCount: _readMetric(ClusterMetrics.shards),
        }).pipe(
            Effect.flatMap(({ entityCount, isLocal, registered, shardCount }) =>
                Option.isSome(registered) && registered.value[1] && isLocal
                    ? Effect.succeed({ entityCount, runnerId: payload.runnerId, shardCount, startedAt: activatedAt, status: 'active' as const })
                    : Effect.fail(ClusterError.from(Option.isNone(registered) ? 'RunnerNotRegistered' : 'RunnerUnavailable', undefined, { requestId: payload.runnerId }))),
        )),
        shardAssignment: ({ payload }) => _rpcSpan('shardAssignment', Effect.gen(function* () {
            const group = payload.shardGroup ?? 'default';
            const shardId = sharding.getShardId(EntityId.make(payload.entityId), group);
            const runners = yield* RunnerStorage.RunnerStorage.pipe(
                Effect.flatMap((rs) => rs.getRunners),
                Effect.map(A.filterMap(([r, h]) => h && A.some(r.groups, (g) => g === group) ? Option.some(r) : Option.none())),
                Effect.mapError((cause): ClusterError => ClusterError.from('PersistenceError', undefined, { cause })),
            );
            const ring = runners.reduce((acc, r) => HashRing.add(acc, r.address, { weight: r.weight }), HashRing.make());
            const assigned = Option.fromNullable(HashRing.getShards(ring, _CONFIG.sharding.shardsPerGroup)?.[Math.max(0, shardId.id - 1)]);
            return { isLocal: sharding.hasShardId(shardId), runnerId: Option.getOrUndefined(Option.map(assigned, (a) => a.toString())), shardId: shardId.id };
        })),
        singletonHealth: ({ payload }) => _rpcSpan('singletonHealth', _computeSingletonHealth(metrics, payload.singletons)),
        singletonHeartbeat: ({ payload }) => _rpcSpan('singletonHeartbeat', Effect.all({
            isLeader: Effect.sync(() => sharding.hasShardId(sharding.getShardId(EntityId.make(payload.singletonName), 'default'))),
            lastExecution: _readSingletonMetric(metrics, payload.singletonName),
            timestamp: Clock.currentTimeMillis,
        }).pipe(Effect.map(({ isLeader, lastExecution, timestamp }) => ({
            healthy: isLeader && lastExecution > 0,
            lastHeartbeat: lastExecution > 0 ? lastExecution : timestamp,
            singletonName: payload.singletonName,
        })))),
        singletonState: ({ payload: { singletonName } }) => _rpcSpan('singletonState', Effect.all({
            isLeader: Effect.sync(() => sharding.hasShardId(sharding.getShardId(EntityId.make(singletonName), 'default'))),
            lastExecution: _readSingletonMetric(metrics, singletonName),
        }).pipe(Effect.map(({ isLeader, lastExecution }) => ({
            isLeader,
            lastExecution: lastExecution > 0 ? lastExecution : undefined,
            singletonName,
            status: isLeader ? (lastExecution > 0 ? 'active' : 'idle') : 'stopped' as const,
        })))),
        status: ({ payload }) => _rpcSpan('status', Effect.suspend(() => {
            const shardId = sharding.getShardId(EntityId.make(payload.entityId), 'default');
            return sharding.hasShardId(shardId)
                ? Effect.all({ entities: sharding.activeEntityCount, isShutdown: sharding.isShutdown, timestamp: Clock.currentTimeMillis }).pipe(
                    Effect.map(({ entities, isShutdown, timestamp }) => ({ status: isShutdown ? 'suspended' : entities > 0 ? 'processing' : 'idle' as const, updatedAt: timestamp })))
                : Effect.fail(ClusterError.from('EntityNotAssignedToRunner', payload.entityId, { requestId: payload.entityId, resumeToken: `${shardId.group}:${shardId.id}` }));
        })),
    };
}), {
    concurrency: _CONFIG.entity.concurrency,
    defectRetryPolicy: _retrySchedule(_CONFIG.retry.maxAttempts.defect),
    spanAttributes: { 'entity.service': 'cluster-infrastructure', 'entity.version': 'v2' },
});

// --- [SERVICES] --------------------------------------------------------------

class ClusterService extends Effect.Service<ClusterService>()('server/Cluster', {
    dependencies: [_ClusterEntityLive.pipe(Layer.provideMerge(Layer.unwrapEffect(
        Config.all({
            environment:    Config.string('NODE_ENV').pipe(Config.withDefault('development')),
            labelSelector:  Config.string('K8S_LABEL_SELECTOR').pipe(Config.withDefault('app=parametric-portal')),
            mode:           Config.string('CLUSTER_HEALTH_MODE').pipe(Config.withDefault('auto')),
            namespace:      Config.string('K8S_NAMESPACE').pipe(Config.withDefault('default')),
        }).pipe(
            Effect.map(({ environment, labelSelector, mode, namespace }) => ({
                httpServerLayer: NodeClusterHttp.layerHttpServer.pipe(Layer.provide(_shardingLayer)),
                runnerHealth: (mode === 'k8s' || (environment === 'production' && mode === 'auto'))
                    ? { k8s: { labelSelector, namespace } as const, layer: NodeClusterHttp.layerK8sHttpClient, mode: 'k8s' as const }
                    : { k8s: undefined, layer: Layer.empty, mode: 'ping' as const },
            })),
            Effect.tap(({ runnerHealth }) => Effect.logDebug('Cluster health mode selected', { mode: runnerHealth.mode, useK8s: runnerHealth.mode === 'k8s' })),
            Effect.map(({ httpServerLayer, runnerHealth }) => NodeClusterHttp.layer({
                clientOnly: false,
                runnerHealth: runnerHealth.mode,
                runnerHealthK8s: runnerHealth.k8s,
                serialization: _CONFIG.transport.serialization,
                storage: 'byo',
                transport: _CONFIG.transport.type,
            }).pipe(
                Layer.provideMerge(Layer.mergeAll(
                    SqlRunnerStorage.layer.pipe(Layer.provide(DbClient.layer)),
                    SqlMessageStorage.layer.pipe(Layer.provide(DbClient.layer)),
                    _shardingLayer,
                    Snowflake.layerGenerator,
                )),
                Layer.provideMerge(runnerHealth.layer),
                Layer.provideMerge(httpServerLayer),
            )),
        ),
    )))],
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
    static readonly Model = {
        Entity: _ClusterEntity,
        Error: { Cluster: ClusterError, Infra: InfraError, Singleton: SingletonError },
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
            }),
        cronInfo: (cron: Cron.Cron, options?: { readonly nextCount?: number }) => Effect.sync(() => {
            const now = new Date(), limit = options?.nextCount ?? 5, seq = Cron.sequence(cron, now);
            return { matchesNow: Cron.match(cron, now), nextRuns: A.unfold(0, (n) => {
                const next = seq.next();
                return next.done || n >= limit ? Option.none() : Option.some([next.value, n + 1] as const);
            }) };
        }),
        singleton: <E, R, StateSchema extends S.Schema.Any = never>(
            name: string,
            run: (stateRef: Ref.Ref<S.Schema.Type<StateSchema> | undefined>) => Effect.Effect<void, E, R>,
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
                        onNone: () => Ref.make(undefined),
                        onSome: (stateConfig) => Effect.gen(function* () {
                            const database = yield* DatabaseService;
                            const loaded = yield* database.kvStore.getJson(stateKey, stateConfig.schema).pipe(
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
                                Effect.flatMap((value) => database.kvStore.setJson(stateKey, value, stateConfig.schema)),
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
                        Effect.tap(() => Effect.logInfo(`Singleton ${name} shutting down gracefully`)),
                        Effect.catchAllCause((cause) => Cause.isInterrupted(cause)
                            ? Effect.void
                            : Effect.logError(`Singleton ${name} exited unexpectedly`, { cause }).pipe(Effect.andThen(Effect.failCause(cause)))),
                    );
                    }),
                    { shardGroup: options?.shardGroup },
                );
            },
        } as const;
    static readonly Health = {
        cluster: () => Telemetry.span(Effect.all({
            entities: _readMetric(ClusterMetrics.entities), runners: _readMetric(ClusterMetrics.runners),
            runnersHealthy: _readMetric(ClusterMetrics.runnersHealthy), shards: _readMetric(ClusterMetrics.shards), singletons: _readMetric(ClusterMetrics.singletons),
        }).pipe(Effect.map((m) => ({ degraded: m.runnersHealthy < m.runners, healthy: m.runnersHealthy > 0 && m.singletons > 0, metrics: m }))),
        'cluster.checkClusterHealth', _RPC_SPAN_OPTS),
        singleton: (config: ReadonlyArray<{ readonly name: string; readonly expectedInterval: Duration.DurationInput }>) => Telemetry.span(
            MetricsService.pipe(
                Effect.flatMap((metrics) => _computeSingletonHealth(metrics, config.map(({ expectedInterval, name }) => ({ expectedInterval: Duration.toMillis(Duration.decode(expectedInterval)), name })))),
                Effect.map(({ results, ...rest }) => ({ ...rest, singletons: results })),
            ), 'cluster.checkSingletonHealth', _RPC_SPAN_OPTS),
    } as const;
}

// --- [EXPORT] ----------------------------------------------------------------

export { ClusterService };
