/** Polling tests: metric aggregation, alert transitions, error recovery, interval gating, health staleness. */
import { it } from '@effect/vitest';
import { SqlClient } from '@effect/sql';
import { DatabaseService } from '@parametric-portal/database/repos';
import { EventBus } from '@parametric-portal/server/infra/events';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { PollingService } from '@parametric-portal/server/observe/polling';
import { Effect, Metric, Option } from 'effect';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _state = { alerts: [] as readonly { current: number; metric: string; severity: 'critical' | 'warning'; threshold: number }[] };
const _events = { published: [] as Array<Record<string, unknown>> };
const _eventBus = { publish: (event: Record<string, unknown>) => Effect.sync(() => { _events.published.push(event); }) } as const;
const _sql = Object.assign(
    ((..._args: ReadonlyArray<unknown>) => Effect.succeed([])) as unknown as SqlClient.SqlClient,
    { withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect },
);
const _database = {
    apps: {   find:            vi.fn(() => Effect.succeed([{ id: 'tenant-a' }, { id: 'tenant-b' }])) },
    jobDlq: { countPending:    vi.fn(() => Effect.succeed(600))                                      },
    jobs: {   countByStatuses: vi.fn(() => Effect.succeed(5))                                        },
    kvStore: {
        getJson: vi.fn(() => Effect.succeed(Option.some(_state.alerts))),
        setJson: vi.fn((_key: string, value: typeof _state.alerts) => Effect.sync(() => { _state.alerts = value; })),
    },
    observability: {
        outboxCount: vi.fn(() => Effect.succeed(12)),
        query:       vi.fn(() => Effect.succeed({ io: { summary: { cacheHitRatio: 88, reads: 100, writes: 40 } } })),
    },
} as const;
const _metrics = {
    database: { cacheHitRatio: Metric.gauge('test_cache_hit'), ioReads:    Metric.gauge('test_io_reads'), ioWrites: Metric.gauge('test_io_writes') },
    events: {   outboxDepth:   Metric.gauge('test_outbox')                                                                                         },
    jobs: {     dlqSize:       Metric.gauge('test_dlq'),       queueDepth: Metric.gauge('test_queue')                                              },
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _reset = () => { vi.clearAllMocks(); _state.alerts = []; _events.published = []; };
const _provide = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(
    Effect.provide(PollingService.Default),
    Effect.provideService(DatabaseService, _database as never),
    Effect.provideService(EventBus, _eventBus as never),
    Effect.provideService(MetricsService, _metrics as never),
    Effect.provideService(SqlClient.SqlClient, _sql as never),
);
const _actions = (aggregateId: string) => _events.published
    .filter((event) => (event['aggregateId'] as string) === aggregateId)
    .map((event) => (event['payload'] as Record<string, unknown>)['action']);

// --- [ALGEBRAIC] -------------------------------------------------------------

// Why: aggregation — pollDlqSize sums 2 tenants x 600 = 1200, critical at 1000.
it.effect('pollDlqSize: aggregates per-tenant depth and emits critical alert', () =>
    Effect.gen(function* () {
        _reset();
        const service = yield* _provide(PollingService);
        expect(yield* _provide(service.pollDlqSize)).toBe(1200);
        expect(_actions('jobs_dlq_size')).toContain('critical');
    }));
// Why: below-threshold emits no alert; warning-level (500-1000) creates warning without critical event.
it.effect('pollJobQueueDepth: below-threshold and warning-level transitions', () =>
    Effect.gen(function* () {
        _reset();
        const service = yield* _provide(PollingService);
        expect(yield* _provide(service.pollJobQueueDepth)).toBe(10);
        expect(_actions('jobs_queue_depth')).toHaveLength(0);
        _database.jobs.countByStatuses.mockReturnValue(Effect.succeed(350) as never);
        const service2 = yield* _provide(PollingService);
        expect(yield* _provide(service2.pollJobQueueDepth)).toBe(700);
        expect(_state.alerts.some((alert) => alert.metric === 'jobs_queue_depth' && alert.severity === 'warning')).toBe(true);
    }));
// Why: critical→recovered — two service instances share persisted alert state via kvStore.
it.effect('outbox: emits critical then recovered transitions', () =>
    Effect.gen(function* () {
        _reset();
        _database.observability.outboxCount.mockReturnValueOnce(Effect.succeed(1200) as never);
        const first = yield* _provide(PollingService);
        yield* _provide(first.pollEventOutboxDepth);
        _database.observability.outboxCount.mockReturnValueOnce(Effect.succeed(10) as never);
        const second = yield* _provide(PollingService);
        yield* _provide(second.pollEventOutboxDepth);
        expect(_actions('events_outbox_depth')).toContain('critical');
        expect(_actions('events_outbox_depth')).toContain('recovered');
    }));
// Why: error recovery — ioStats failure falls back to cached zero; partial tenant failure sums remaining.
it.effect('error recovery: ioStats zero fallback and partial tenant failure', () =>
    Effect.gen(function* () {
        _reset();
        _database.observability.query.mockReturnValueOnce(Effect.fail(new Error('io down')) as never);
        _database.jobDlq.countPending.mockReturnValueOnce(Effect.fail(new Error('dlq down')) as never);
        const service = yield* _provide(PollingService);
        const [io, dlq] = yield* Effect.all([_provide(service.pollIoStats), _provide(service.pollDlqSize)]);
        expect(io).toEqual({ avgHitRatio: 0, totalReads: 0 });
        expect(dlq).toBe(600);
        expect(_events.published.some((event) => (event['payload'] as Record<string, unknown>)['action'] === 'error')).toBe(true);
    }));
// Why: ioStats branches — low cache hit ratio triggers warning; missing summary defaults to zero.
it.effect('pollIoStats: low cache hit ratio and missing summary branches', () =>
    Effect.gen(function* () {
        _reset();
        _database.observability.query.mockReturnValueOnce(Effect.succeed({ io: { summary: { cacheHitRatio: 50, reads: 10, writes: 5 } } }) as never);
        const service = yield* _provide(PollingService);
        expect(yield* _provide(service.pollIoStats)).toEqual({ avgHitRatio: 50, totalReads: 10 });
        _database.observability.query.mockReturnValueOnce(Effect.succeed({ io: {} }) as never);
        expect(yield* _provide(service.pollIoStats)).toEqual({ avgHitRatio: 0, totalReads: 0 });
    }));
// Why: interval gating — refresh(false) skips when minInterval not elapsed.
it.effect('refresh: force=false respects minimum interval', () =>
    Effect.gen(function* () {
        _reset();
        const service = yield* _provide(PollingService);
        yield* _provide(service.refresh(true));
        const before = _database.jobDlq.countPending.mock.calls.length;
        yield* _provide(service.refresh(false));
        expect(_database.jobDlq.countPending.mock.calls.length).toBe(before);
    }));
// Why: staleness — stale=true before refresh, stale=false after; STM fallback on kv failure; failure timestamp tracked.
it.effect('getHealth: stale transitions + STM fallback on kv failure + failure tracking', () =>
    Effect.gen(function* () {
        _reset();
        _state.alerts = [{ current: 1200, metric: 'jobs_dlq_size', severity: 'critical', threshold: 1000 }];
        const service = yield* _provide(PollingService);
        const before = yield* _provide(service.getHealth());
        expect(before.stale).toBe(true);
        expect(before.lastSuccessAtMs).toBeUndefined();
        yield* _provide(service.refresh(true));
        const after = yield* _provide(service.getHealth());
        expect(after.stale).toBe(false);
        expect(after.lastSuccessAtMs).toBeTypeOf('number');
        _database.observability.query.mockReturnValueOnce(Effect.fail(new Error('down')) as never);
        yield* _provide(service.pollIoStats);
        _database.kvStore.getJson.mockImplementation(() => Effect.fail(new Error('kv down')) as never);
        const fallback = yield* _provide(service.getHealth());
        _database.kvStore.getJson.mockImplementation(() => Effect.succeed(Option.some(_state.alerts)));
        expect(fallback.alerts.length).toBeGreaterThan(0);
        expect(fallback.lastFailureAtMs).toBeTypeOf('number');
    }));
// Why: Crons static is a Layer value — structural existence.
it.effect('Crons: static property is defined', () => Effect.sync(() => { expect(PollingService.Crons).toBeDefined(); }));
