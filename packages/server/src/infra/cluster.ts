/**
 * ClusterService facade for multi-pod coordination via @effect/cluster.
 * Entity sharding, shard ownership via advisory locks, distributed message routing.
 */
import { ClusterCron, ClusterMetrics, Entity, EntityId, HttpRunner, K8sHttpClient, RunnerHealth, Sharding, ShardingConfig, Singleton, Snowflake, SocketRunner, SqlMessageStorage, SqlRunnerStorage } from '@effect/cluster';
import type { AlreadyProcessingMessage, MailboxFull, PersistenceError } from '@effect/cluster/ClusterError';
import { Error as PlatformError, FetchHttpClient, KeyValueStore, Socket } from '@effect/platform';
import { NodeClusterSocket, NodeFileSystem, NodeHttpClient, NodeSocket } from '@effect/platform-node';
import { Rpc, RpcSerialization } from '@effect/rpc';
import { SqlClient } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import { PgClient } from '@effect/sql-pg';
import { Array as A, Boolean as B, Cause, Chunk, Clock, Config, Cron, Data, DateTime, Duration, Effect, Exit, FiberMap, Layer, Match, Metric, Number as N, Option, Ref, Schedule, Schema as S } from 'effect';
import { Client as DbClient } from '@parametric-portal/database/client';
import { Context } from '../context.ts';
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
		// withinCluster wraps ENTIRE handler: gen body + ensuring + matchCauseEffect
		process: (envelope) => Context.Request.withinCluster({
			entityId: currentAddress.entityId,
			entityType: currentAddress.entityType,
			shardId: currentAddress.shardId,
		})(
			Effect.gen(function* () {
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

// SQL-backed KeyValueStore for singleton state persistence
// NOTE: modify() is NOT atomic across concurrent executions — wrap critical sections in SqlClient.withTransaction
// Required table: CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());
// This layer requires SqlClient.SqlClient to be provided (typically via DbClient.layer)
const _kvStoreLayers = Layer.effect(
	KeyValueStore.KeyValueStore,
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		// Helper: map SqlError to PlatformError.SystemError for KeyValueStore interface compatibility
		const mapError = <A, R>(effect: Effect.Effect<A, SqlError, R>, method: string) =>
			effect.pipe(
				Effect.mapError((e) => new PlatformError.SystemError({ cause: e, method, module: 'KeyValueStore', reason: 'Unknown' })),
			);
		// Helper: get value as Option<string>
		const _get = (key: string) =>
			mapError(
				sql<{ value: string }>`SELECT value FROM kv_store WHERE key = ${key}`.pipe(
					Effect.map(A.head),
					Effect.map(Option.map((r) => r.value)),
				),
				'get',
			);
		return KeyValueStore.make({
			clear: mapError(sql`DELETE FROM kv_store`.pipe(Effect.asVoid), 'clear'),
			get: (key) => _get(key),
			getUint8Array: (key) => _get(key).pipe(
				Effect.map(Option.map((v) => new TextEncoder().encode(v))),
			),
			remove: (key) => mapError(sql`DELETE FROM kv_store WHERE key = ${key}`.pipe(Effect.asVoid), 'remove'),
			set: (key, value) =>
				mapError(
					sql`INSERT INTO kv_store (key, value, updated_at) VALUES (${key}, ${typeof value === 'string' ? value : Buffer.from(value).toString('base64')}, NOW())
						ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`.pipe(Effect.asVoid),
					'set',
				),
			size: mapError(
				sql<{ count: number }>`SELECT COUNT(*)::int AS count FROM kv_store`.pipe(
					Effect.map((r) => r[0]?.count ?? 0),
				),
				'size',
			),
		});
	}),
);

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

// --- [HEALTH] ----------------------------------------------------------------

// Staleness check — DateTime.distanceDuration for clean Duration arithmetic
// N.between for self-documenting range validation
const _checkStaleness = (intervalMs: number, lastExecMs: number) =>
	Clock.currentTimeMillis.pipe(
		Effect.map((now) => {
			const elapsed = DateTime.distanceDuration(
				DateTime.unsafeMake(now),
				DateTime.unsafeMake(lastExecMs),
			);
			const elapsedMs = Duration.toMillis(elapsed);
			const threshold = intervalMs * _CONFIG.singleton.threshold;
			return {
				elapsed,
				elapsedMs,
				healthy: N.between({ maximum: threshold, minimum: 0 })(elapsedMs),
			};
		}),
	);

// Singleton health check — validates heartbeat against expected interval
const checkSingletonHealth = (config: ReadonlyArray<{ readonly name: string; readonly expectedIntervalMs: number }>) =>
	Telemetry.span(Effect.gen(function* () {
		const metrics = yield* MetricsService;

		// Effect.forEach with concurrency for parallel health checks
		const results = yield* Effect.forEach(config, ({ name, expectedIntervalMs }) =>
			Metric.value(Metric.taggedWithLabels(
				metrics.singleton.lastExecution,
				MetricsService.label({ singleton: name }),
			)).pipe(
				Effect.flatMap((state: { readonly value: number }) =>
					_checkStaleness(expectedIntervalMs, state.value).pipe(
						Effect.map((staleness) => ({
							healthy: staleness.healthy,
							lastExecution: B.match(state.value > 0, {
								onFalse: () => 'never',
								onTrue: () => DateTime.formatIso(DateTime.unsafeMake(state.value)),
							}),
							name,
							// Duration.format for human-readable staleness: "2h 30m"
							staleFormatted: B.match(state.value > 0, {
								onFalse: () => 'N/A',
								onTrue: () => Duration.format(staleness.elapsed),
							}),
							staleMs: staleness.elapsedMs,
						})),
					),
				),
			),
		{ concurrency: 'unbounded' });

		// Array.partition for single-pass healthy/unhealthy split
		const [healthy, unhealthy] = A.partition(results, (r) => r.healthy);

		return {
			healthy: A.isEmptyArray(unhealthy),
			healthyCount: healthy.length,
			singletons: results,
			unhealthyCount: unhealthy.length,
		};
	}), 'cluster.checkSingletonHealth');

// Cluster-wide health aggregation — uses ClusterMetrics official gauges
// Uses Telemetry.span for tracing (matches codebase pattern)
const checkClusterHealth = () =>
	Telemetry.span(Effect.all({
		entities: Metric.value(ClusterMetrics.entities),
		runners: Metric.value(ClusterMetrics.runners),
		runnersHealthy: Metric.value(ClusterMetrics.runnersHealthy),
		shards: Metric.value(ClusterMetrics.shards),
		singletons: Metric.value(ClusterMetrics.singletons),
	}).pipe(
		Effect.map((m) => ({
			// Convert bigint gauge values to numbers for JSON serialization
			degraded: Number(m.runnersHealthy.value) < Number(m.runners.value),
			healthy: Number(m.runnersHealthy.value) > 0 && Number(m.singletons.value) > 0,
			metrics: {
				entities: Number(m.entities.value),
				runners: Number(m.runners.value),
				runnersHealthy: Number(m.runnersHealthy.value),
				shards: Number(m.shards.value),
				singletons: Number(m.singletons.value),
			},
		})),
	), 'cluster.checkClusterHealth');

// --- [UTILITIES] -------------------------------------------------------------

// Cron utilities: preview schedule, validate manual trigger timing
// cronNextRuns: Preview upcoming execution times (debugging UI, schedule validation)
// Use Cron.sequence for iterator, take first N entries
const cronNextRuns = (cron: Cron.Cron, count: number): Effect.Effect<ReadonlyArray<Date>> =>
	Clock.currentTimeMillis.pipe(
		Effect.map((now) => {
			const seq = Cron.sequence(cron, new Date(now));
			return A.makeBy(count, () => seq.next().value);
		}),
	);

// cronMatchesNow: Check if current time matches schedule (manual trigger validation)
// Use Cron.match to verify datetime aligns with cron expression
const cronMatchesNow = (cron: Cron.Cron): Effect.Effect<boolean> =>
	Clock.currentTimeMillis.pipe(
		Effect.map((now) => Cron.match(cron, new Date(now))),
	);

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
	// --- Singleton Factory: Enhanced with state persistence, lifecycle hooks, graceful shutdown ---
	// State loaded on startup, passed to run as Ref, auto-persists on scope close
	// Lifecycle hooks: onBecomeLeader/onLoseLeadership execute at appropriate times
	// Graceful shutdown: Effect.raceFirst + sharding.isShutdown, Exit.isInterrupted distinguishes shutdown from failure
	static readonly singleton = <E, R, StateSchema extends S.Schema.Any = never>(
		name: string,
		run: (stateRef: Ref.Ref<S.Schema.Type<StateSchema>>) => Effect.Effect<void, E, R>,
		options?: {
			readonly shardGroup?: string;
			readonly state?: { readonly schema: StateSchema; readonly initial: S.Schema.Type<StateSchema> };
			readonly onBecomeLeader?: Effect.Effect<void, never, R>;
			readonly onLoseLeadership?: Effect.Effect<void, never, R>;
		},
	) => {
		// State key: namespaced with _CONFIG.singleton.keyPrefix
		const stateKey = `${_CONFIG.singleton.keyPrefix}${name}`;

		return Singleton.make(
			name,
			Effect.gen(function* () {
				const metrics = yield* MetricsService;
				const sharding = yield* Sharding.Sharding;
				yield* Effect.annotateLogsScoped({ 'service.name': `singleton.${name}` });

				// FiberMap for fiber tracking with auto-cleanup (GROUP3 pattern)
				const fibers = yield* FiberMap.make<string>();

				// Lifecycle hooks with finalizer — Telemetry.span wraps entire singleton work below
				yield* options?.onBecomeLeader ?? Effect.void;
				yield* Effect.addFinalizer(() => options?.onLoseLeadership ?? Effect.void);

				// Heartbeat update: Clock.currentTimeMillis for testability (GROUP1 pattern)
				const updateHeartbeat = Clock.currentTimeMillis.pipe(
					Effect.tap((ts) => Metric.set(metrics.singleton.lastExecution, ts)),
					Effect.tap(() => Metric.increment(metrics.singleton.executions)),
				);

				// State initialization: load from KV store or use initial
				const stateOpts = options?.state;
				const stateRef = yield* (stateOpts
					? Effect.gen(function* () {
							const kv = yield* KeyValueStore.KeyValueStore;
							const store = kv.forSchema(stateOpts.schema);
							// Load state with error mapping (GROUP2: Effect.catchTags)
							// Error tags: ParseError, SystemError, BadArgument
							const loaded = yield* store.get(stateKey).pipe(
								Effect.catchTags({
									BadArgument: (e) => Effect.fail(SingletonError.fromStateLoad(name, e)),
									ParseError: (e) => Effect.fail(SingletonError.fromSchemaDecode(name, e)),
									SystemError: (e) => Effect.fail(SingletonError.fromStateLoad(name, e)),
								}),
								Effect.map(Option.getOrElse(() => stateOpts.initial)),
							);
							const ref = yield* Ref.make(loaded);
							// Auto-persist on scope close
							yield* Effect.addFinalizer(() =>
								Ref.get(ref).pipe(
									Effect.flatMap((state) => store.set(stateKey, state)),
									Effect.catchTags({
										BadArgument: () => Effect.logWarning('State persist failed on shutdown (BadArgument)'),
										ParseError: () => Effect.logWarning('State persist failed on shutdown (ParseError)'),
										SystemError: () => Effect.logWarning('State persist failed on shutdown (SystemError)'),
									}),
									Effect.catchAllCause((cause) => Effect.logError('State persist failed', { cause })),
								),
							);
							return ref;
						})
					: Ref.make(undefined as unknown as S.Schema.Type<StateSchema>));

				// Shutdown detection: Effect.repeat with Schedule.recurWhile
				const awaitShutdown = sharding.isShutdown.pipe(
					Effect.repeat(Schedule.recurWhile((shutdown: boolean) => !shutdown)),
					Effect.tap(() => Effect.logInfo(`Singleton ${name} detected shutdown`)),
				);

				// Main work wrapped with context and metrics
				const mainWork = Context.Request.withinCluster({ isLeader: true })(
					MetricsService.trackEffect(
						Telemetry.span(run(stateRef), `singleton.${name}`, { metrics: false }),
						{
							duration: metrics.singleton.duration,
							errors: metrics.errors,
							labels: MetricsService.label({ singleton: name }),
						},
					).pipe(Effect.tap(() => updateHeartbeat)),
				);

				// Run with shutdown coordination via FiberMap
				yield* FiberMap.run(fibers, 'main-work')(mainWork);

				// Race work against shutdown signal
				const exit = yield* Effect.raceFirst(Effect.never, awaitShutdown).pipe(Effect.exit);

				// Exit.isInterrupted distinguishes graceful shutdown from failure (GROUP2 pattern)
				yield* B.match(Exit.isInterrupted(exit), {
					onFalse: () => Effect.logWarning(`Singleton ${name} exited unexpectedly`),
					onTrue: () => Effect.logInfo(`Singleton ${name} interrupted gracefully`),
				});
			}),
			{ shardGroup: options?.shardGroup },
		).pipe(
			Layer.provide(_clusterLayer),
			Layer.provide(_kvStoreLayers),
		);
	};

	// --- Cron Factory: Enhanced with MetricsService.trackEffect and withinCluster context ---
	// NOTE: Cron jobs are stateless by default. For stateful cron, use singleton with Schedule instead.
	static readonly cron = <E, R>(config: {
		readonly name: string;
		readonly cron: Parameters<typeof ClusterCron.make>[0]['cron'];
		readonly execute: Effect.Effect<void, E, R>;
		readonly shardGroup?: string;
		readonly skipIfOlderThan?: Duration.DurationInput;
		readonly calculateNextRunFromPrevious?: boolean;
	}) =>
		ClusterCron.make({
			calculateNextRunFromPrevious: config.calculateNextRunFromPrevious ?? false,
			cron: config.cron,
			execute: Effect.gen(function* () {
				const metrics = yield* MetricsService;
				yield* Effect.annotateLogsScoped({ 'service.name': `cron.${config.name}` });

				// Heartbeat update: Clock.currentTimeMillis for testability
				const updateHeartbeat = Clock.currentTimeMillis.pipe(
					Effect.tap((ts) => Metric.set(metrics.singleton.lastExecution, ts)),
					Effect.tap(() => Metric.increment(metrics.singleton.executions)),
				);

				// Execute within cluster context with trackEffect
				// Telemetry.span({ metrics: false }) + MetricsService.trackEffect for custom labels (codebase pattern)
				yield* Context.Request.withinCluster({ isLeader: true })(
					MetricsService.trackEffect(
						Telemetry.span(config.execute, `cron.${config.name}`, { metrics: false }),
						{
							duration: metrics.singleton.duration,
							errors: metrics.errors,
							labels: MetricsService.label({ singleton: config.name, type: 'cron' }),
						},
					).pipe(Effect.tap(() => updateHeartbeat)),
				);
			}),
			name: config.name,
			shardGroup: config.shardGroup,
			skipIfOlderThan: config.skipIfOlderThan ?? _CONFIG.cron.skipIfOlderThan,
		}).pipe(Layer.provide(_clusterLayer));
	// Health check utilities - exported for Phase 8 health endpoint integration
	static readonly checkClusterHealth = checkClusterHealth;
	static readonly checkSingletonHealth = checkSingletonHealth;

	// Cron utilities - schedule preview and validation
	static readonly cronNextRuns = cronNextRuns;
	static readonly cronMatchesNow = cronMatchesNow;
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
		readonly singletons: ReadonlyArray<{
			readonly name: string;
			readonly healthy: boolean;
			readonly lastExecution: string;
			readonly staleFormatted: string;
			readonly staleMs: number;
		}>;
		readonly healthy: boolean;
		readonly healthyCount: number;
		readonly unhealthyCount: number;
	}
	export interface ClusterHealthResult {
		readonly healthy: boolean;
		readonly degraded: boolean;
		readonly metrics: {
			readonly entities: number;
			readonly runners: number;
			readonly runnersHealthy: number;
			readonly shards: number;
			readonly singletons: number;
		};
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { ClusterService };
