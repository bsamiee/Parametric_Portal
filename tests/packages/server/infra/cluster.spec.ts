/** Cluster tests: error construction, schema roundtrips, schedule properties. */
import { it } from '@effect/vitest';
import { ClusterService } from '@parametric-portal/server/infra/cluster';
import { Cron, Effect, FastCheck as fc, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const { Error: Err, Response: Res } = ClusterService.Model;
const _status = fc.constantFrom<'idle' | 'processing' | 'suspended'>('idle', 'processing', 'suspended');
const _clusterReason = fc.constantFrom<typeof Err.Cluster.prototype.reason>(
    'AlreadyProcessingMessage', 'EntityNotAssignedToRunner', 'MailboxFull', 'MalformedMessage',
    'PersistenceError', 'RpcClientError', 'RunnerNotRegistered', 'RunnerUnavailable',
    'SendTimeout', 'SerializationError', 'Suspended',
);
const _singletonReason = fc.constantFrom<typeof Err.Singleton.prototype.reason>(
    'HeartbeatFailed', 'LeaderHandoffFailed', 'NotFound', 'SchemaDecodeFailed',
    'StateLoadFailed', 'StatePersistFailed', 'Unavailable',
);
const _infraReason = fc.constantFrom<typeof Err.Infra.prototype.reason>('InvalidPattern', 'MetricsUnavailable', 'PartialFailure', 'StoreUnavailable', 'Timeout',);
const CRON = Cron.unsafeParse('*/5 * * * *');

// --- [ALGEBRAIC] -------------------------------------------------------------

// Why: Status schema roundtrip -- decode preserves fields, encode inverts (inverse law).
it.effect.prop('P1: status schema roundtrip', { status: _status, updatedAt: fc.nat() }, ({ status, updatedAt }) =>
    Effect.gen(function* () {
        const decoded = yield* S.decodeUnknown(Res.Status)({ status, updatedAt });
        const encoded = yield* S.encodeUnknown(Res.Status)(decoded);
        expect(decoded).toEqual({ status, updatedAt });
        expect(encoded).toEqual({ status, updatedAt });
    }),
);
// Why: All three error types preserve tag + reason + context (determinism + preservation).
it.effect.prop('P2: error factories preserve tag, reason, context', { cluster: _clusterReason, entityId: fc.string({ maxLength: 32, minLength: 1 }), infra: _infraReason, singleton: _singletonReason }, ({ entityId, cluster, singleton, infra }) =>
    Effect.sync(() => {
        const ce = Err.Cluster.from(cluster, entityId, { requestId: 'r', resumeToken: 's' });
        const se = Err.Singleton.from(singleton, 'svc');
        const ie = Err.Infra.from(infra, 'key');
        expect(ce).toEqual(expect.objectContaining({ _tag: 'ClusterError', entityId, reason: cluster, requestId: 'r', resumeToken: 's' }));
        expect(se).toEqual(expect.objectContaining({ _tag: 'SingletonError', reason: singleton, singletonName: 'svc' }));
        expect(ie).toEqual(expect.objectContaining({ _tag: 'InfraError', key: 'key', reason: infra }));
    }),
);
// Why: cronInfo nextRuns count = requested, monotonically increasing, unique (length + monotonicity + uniqueness).
it.effect.prop('P3: cronInfo count + monotonicity + uniqueness + default', { nextCount: fc.integer({ max: 20, min: 1 }) }, ({ nextCount }) =>
    Effect.gen(function* () {
        const info = yield* ClusterService.Schedule.cronInfo(CRON, { nextCount });
        const times = info.nextRuns.map((r) => r.getTime());
        expect(info.nextRuns).toHaveLength(nextCount);
        expect(typeof info.matchesNow).toBe('boolean');
        expect(times).toEqual([...times].sort((a, b) => a - b));
        expect(new Set(times).size).toBe(nextCount);
        const defaultInfo = yield* ClusterService.Schedule.cronInfo(CRON);
        expect(defaultInfo.nextRuns).toHaveLength(5);
    }),
);
// Why: All 4 response schemas decode valid payloads (structural contract).
it.effect('P4: response schemas decode valid payloads', () =>
    Effect.all([
        S.decodeUnknown(Res.ClusterHealth)({ degraded: false, entities: 5, healthy: true, runners: 2, runnersHealthy: 2, shards: 100, singletons: 3 }),
        S.decodeUnknown(Res.NodeInfo)({ entityCount: 10, runnerId: 'r-1', shardCount: 50, startedAt: 1_000_000, status: 'active' }),
        S.decodeUnknown(Res.ShardAssignment)({ isLocal: true, shardId: 42 }),
        S.decodeUnknown(Res.SingletonState)({ isLeader: true, singletonName: 's-1', status: 'active' }),
    ]).pipe(Effect.tap(([health, node, shard, singleton]) => {
        expect(health.healthy).toBe(true);
        expect(node.status).toBe('active');
        expect(shard.shardId).toBe(42);
        expect(singleton.isLeader).toBe(true);
    }), Effect.asVoid),
);

// --- [EDGE_CASES] ------------------------------------------------------------

// Why: Status schema rejects invalid/empty/missing + error minimal/cause propagation.
it.effect('E1: status rejection + error minimal + cause propagation', () =>
    Effect.gen(function* () {
        const errors = yield* Effect.all([
            S.decodeUnknown(Res.Status)({ status: 'invalid', updatedAt: 0 }).pipe(Effect.flip),
            S.decodeUnknown(Res.Status)({ status: '', updatedAt: 0 }).pipe(Effect.flip),
            S.decodeUnknown(Res.Status)({ updatedAt: 0 }).pipe(Effect.flip),
        ]);
        expect(errors.map((e) => e._tag)).toEqual(['ParseError', 'ParseError', 'ParseError']);
        const minimal = Err.Cluster.from('MalformedMessage');
        const cause = new Error('conn');
        expect(minimal.entityId).toBeUndefined();
        expect(minimal.requestId).toBeUndefined();
        expect(Err.Singleton.from('StateLoadFailed', 'svc', cause).cause).toBe(cause);
        expect(Err.Infra.from('Timeout', 'k', cause).cause).toBe(cause);
    }),
);
