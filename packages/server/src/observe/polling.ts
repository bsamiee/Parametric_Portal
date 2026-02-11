/**
 * Scheduled metrics polling with unified poll+alert flow.
 * Alerts persisted to kvStore for durability across restarts.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import { Clock, Cron, Duration, Effect, Layer, Match, Metric, Option, Schema as S, STM, TRef } from 'effect';
import { Context } from '../context.ts';
import { ClusterService } from '../infra/cluster.ts';
import { EventBus } from '../infra/events.ts';
import { MetricsService } from './metrics.ts';
import { Telemetry } from './telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	cron: { dlqSize: '*/1 * * * *', eventOutboxDepth: '*/1 * * * *', ioStats: '*/5 * * * *', jobQueueDepth: '*/1 * * * *' },
	fallback: { ioStats: { avgHitRatio: 0, totalReads: 0, totalWrites: 0 }, metric: 0 },
	kvKey: 'alerts:polling',
	refresh: { minInterval: Duration.seconds(15), staleMultiplier: 2, tenantMetric: { concurrency: 4, timeout: Duration.seconds(5) } },
	thresholds: {
		cacheHitRatio: 		{ warning: 90 },
		dlqSize: 			{ critical: 1000, warning: 500 },
		eventOutboxDepth: 	{ critical: 1000, warning: 500 },
		jobQueueDepth: 		{ critical: 1000, warning: 500 },
		},
	} as const;

// --- [SCHEMA] ----------------------------------------------------------------

const _SCHEMA = {
	alert: S.Struct({
		current: S.Number,
		metric: S.String,
		severity: S.Literal('critical', 'warning'),
		threshold: S.Number }
	),
} as const;

// --- [SERVICES] --------------------------------------------------------------

class PollingService extends Effect.Service<PollingService>()('server/Polling', {
	scoped: Effect.gen(function* () {
		const [metrics, database, eventBus] = yield* Effect.all([MetricsService, DatabaseService, EventBus]);
		const _listTenantIds = Context.Request.withinSync(Context.Request.Id.system, database.apps.find([{ field: 'id', op: 'notNull' }]), Context.Request.system()).pipe(Effect.map((apps) => apps.map((app) => app.id)));
		const _sumTenantMetric = (metricForTenant: (tenantId: string) => Effect.Effect<number, unknown>) => _listTenantIds.pipe(
			Effect.flatMap((tenantIds) => Effect.forEach(tenantIds, (tenantId) =>
				Context.Request.withinSync(tenantId, metricForTenant(tenantId), Context.Request.system()).pipe(
					Effect.timeout(_CONFIG.refresh.tenantMetric.timeout),
					Effect.catchAll((error) => Effect.logWarning('Tenant polling metric failed', { error: String(error), tenantId }).pipe(Effect.as(_CONFIG.fallback.metric))),
				),
			{ concurrency: _CONFIG.refresh.tenantMetric.concurrency })),
			Effect.map((values) => values.reduce((sum, value) => sum + value, _CONFIG.fallback.metric)),
		);
		const _loadAlerts = database.kvStore.getJson(_CONFIG.kvKey, S.Array(_SCHEMA.alert)).pipe(
			Effect.map(Option.getOrElse(() => [] as const)),
			Effect.tapError((error) => Effect.logError('Failed to load polling alerts', { error: String(error) })),
			Effect.orElseSucceed(() => [] as const),
		);
		const _isCritical = (items: ReadonlyArray<typeof _SCHEMA.alert.Type>, metric: string) => items.some((alert) => alert.metric === metric && alert.severity === 'critical');
		const initial = yield* _loadAlerts;
			const alerts = yield* STM.commit(TRef.make(initial));
			const ioStatsState = yield* STM.commit(TRef.make<{ avgHitRatio: number; totalReads: number; totalWrites: number }>({ ..._CONFIG.fallback.ioStats }));
			const metricState = yield* STM.commit(TRef.make({} as Record<string, number>));
			const lastFailureAtMs = yield* STM.commit(TRef.make(Option.none<number>()));
			const lastSuccessAtMs = yield* STM.commit(TRef.make(Option.none<number>()));
		const persistAlerts = (updated: typeof initial) => database.kvStore.setJson(_CONFIG.kvKey, [...updated], S.Array(_SCHEMA.alert)).pipe(Effect.ignoreLogged);
		const publishFailure = (metric: string, error: unknown) => eventBus.publish({ aggregateId: metric, payload: { _tag: 'polling', action: 'error', error: String(error), metric }, tenantId: Context.Request.Id.system }).pipe(Effect.ignore);
		const recoverWith = <A>(metric: string, message: string, fallback: Effect.Effect<A>) => (error: unknown) => Clock.currentTimeMillis.pipe(
			Effect.flatMap((now) => Effect.all([
				STM.commit(TRef.set(lastFailureAtMs, Option.some(now))),
				Effect.logError(message, { error: String(error), metric }),
				publishFailure(metric, error),
			], { discard: true })),
			Effect.andThen(fallback),
		);
		const pollMetric = <R>(config: {
			readonly fetch: Effect.Effect<number, unknown, R>;
			readonly gauge: Metric.Metric.Gauge<number>;
			readonly metric: string;
			readonly spanName: string;
			readonly thresholds: { readonly critical: number; readonly warning: number };
			readonly warningMessage: string;
		}) => Effect.gen(function* () {
			const value = yield* config.fetch;
			yield* Metric.set(config.gauge, value);
			const { current, updated } = yield* STM.commit(TRef.modify(alerts, (current) => {
				const filtered = current.filter((alert) => alert.metric !== config.metric);
				const updated = Match.value(value).pipe(
					Match.when((v) => v >= config.thresholds.critical, () => [...filtered, { current: value, metric: config.metric, severity: 'critical' as const, threshold: config.thresholds.critical }]),
					Match.when((v) => v >= config.thresholds.warning, () => [...filtered, { current: value, metric: config.metric, severity: 'warning' as const, threshold: config.thresholds.warning }]),
					Match.orElse(() => filtered),
				);
				return [{ current, updated } as const, updated] as const;
			}));
			yield* persistAlerts(updated);
			const wasCritical = _isCritical(current, config.metric);
			const isCriticalNow = _isCritical(updated, config.metric);
			const emit = (action: 'critical' | 'recovered') => eventBus.publish({ aggregateId: config.metric, payload: { _tag: 'polling.alert', action, current: value, metric: config.metric, thresholds: config.thresholds }, tenantId: Context.Request.Id.system }).pipe(Effect.ignore);
			yield* Effect.all([Effect.when(emit('critical'), () => !wasCritical && isCriticalNow), Effect.when(emit('recovered'), () => wasCritical && !isCriticalNow)], { discard: true });
			yield* Effect.when(Effect.logWarning(config.warningMessage, { threshold: config.thresholds.critical, value }), () => value >= config.thresholds.critical && !wasCritical);
			yield* STM.commit(TRef.update(metricState, (state) => ({ ...state, [config.metric]: value })));
			yield* Clock.currentTimeMillis.pipe(Effect.flatMap((now) => STM.commit(TRef.set(lastSuccessAtMs, Option.some(now)))));
			return value;
		}).pipe(
			Effect.catchAll(recoverWith(config.metric, 'Polling metric failed', STM.commit(TRef.get(metricState)).pipe(Effect.map((state) => state[config.metric] ?? _CONFIG.fallback.metric)))),
			Telemetry.span(config.spanName, { metrics: false, 'polling.metric': config.metric }),
		);
		const pollDlqSize = pollMetric({ fetch: _sumTenantMetric(() => database.jobDlq.countPending()), gauge: metrics.jobs.dlqSize, metric: 'jobs_dlq_size', spanName: 'polling.dlqSize', thresholds: _CONFIG.thresholds.dlqSize, warningMessage: 'DLQ size critical' });
		const pollJobQueueDepth = pollMetric({ fetch: _sumTenantMetric(() => database.jobs.countByStatuses('queued', 'processing')), gauge: metrics.jobs.queueDepth, metric: 'jobs_queue_depth', spanName: 'polling.jobQueueDepth', thresholds: _CONFIG.thresholds.jobQueueDepth, warningMessage: 'Job queue depth critical' });
		const pollEventOutboxDepth = pollMetric({ fetch: database.eventOutbox.count, gauge: metrics.events.outboxDepth, metric: 'events_outbox_depth', spanName: 'polling.eventOutboxDepth', thresholds: _CONFIG.thresholds.eventOutboxDepth, warningMessage: 'Event outbox depth critical' });
			const pollIoStats = Effect.gen(function* () {
				const stats = yield* database.monitoring.cacheHitRatio();
				const rows = Array.isArray(stats) ? stats : [];
				const zero = Number(_CONFIG.fallback.metric);
				const totalReads = rows.reduce<number>((sum, row) => sum + row.reads, zero);
				const totalHits = rows.reduce<number>((sum, row) => sum + row.hits, zero);
				const totalWrites = rows.reduce<number>((sum, row) => sum + row.writes, zero);
			const avgHitRatio = totalReads + totalHits > zero ? (totalHits / (totalReads + totalHits)) * 100 : zero;
			yield* Effect.all([Metric.set(metrics.database.cacheHitRatio, avgHitRatio), Metric.set(metrics.database.ioReads, totalReads), Metric.set(metrics.database.ioWrites, totalWrites)], { discard: true });
			yield* Effect.when(Effect.logWarning('Cache hit ratio below threshold', { avgHitRatio, threshold: _CONFIG.thresholds.cacheHitRatio.warning }), () => avgHitRatio > zero && avgHitRatio < _CONFIG.thresholds.cacheHitRatio.warning);
			yield* STM.commit(TRef.set(ioStatsState, { avgHitRatio, totalReads, totalWrites }));
			yield* Clock.currentTimeMillis.pipe(Effect.flatMap((now) => STM.commit(TRef.set(lastSuccessAtMs, Option.some(now)))));
			return { avgHitRatio, totalReads };
		}).pipe(
			Effect.catchAll(recoverWith('pg_stat_io', 'Polling io stats failed', STM.commit(TRef.get(ioStatsState)).pipe(Effect.map(({ avgHitRatio, totalReads }) => ({ avgHitRatio, totalReads }))))),
			Telemetry.span('polling.ioStats', { metrics: false, 'polling.metric': 'pg_stat_io' }),
		);
			const refresh = (force = false) => Effect.gen(function* () {
				const now = yield* Clock.currentTimeMillis;
				const elapsed = now - (Option.getOrUndefined(yield* STM.commit(TRef.get(lastSuccessAtMs))) ?? _CONFIG.fallback.metric);
				yield* Effect.when(
					Effect.all([pollDlqSize, pollJobQueueDepth, pollEventOutboxDepth, pollIoStats], { discard: true }),
					() => force || elapsed >= Duration.toMillis(_CONFIG.refresh.minInterval),
				);
			}).pipe(Telemetry.span('polling.refresh', { metrics: false }));
			const getHealth = () => Effect.gen(function* () {
				const latest = yield* _loadAlerts.pipe(
					Effect.tap((loaded) => STM.commit(TRef.set(alerts, loaded))),
					Effect.tapError((error) => Effect.logError('Polling health refresh failed', { error: String(error) })),
					Effect.orElse(() => STM.commit(TRef.get(alerts))),
				);
				const now = yield* Clock.currentTimeMillis;
				const [lastSuccess, lastFailure] = yield* Effect.all([
					STM.commit(TRef.get(lastSuccessAtMs)),
					STM.commit(TRef.get(lastFailureAtMs)),
				], { concurrency: 'unbounded' });
				const staleThresholdMs = Duration.toMillis(_CONFIG.refresh.minInterval) * _CONFIG.refresh.staleMultiplier;
				const stale = Option.match(lastSuccess, {
					onNone: () => true,
					onSome: (timestamp) => now - timestamp > staleThresholdMs,
				});
				return {
					alerts: latest,
					lastFailureAtMs: Option.getOrUndefined(lastFailure),
					lastSuccessAtMs: Option.getOrUndefined(lastSuccess),
					stale,
				};
			}).pipe(Telemetry.span('polling.getHealth', { metrics: false }));
			return { getHealth, pollDlqSize, pollEventOutboxDepth, pollIoStats, pollJobQueueDepth, refresh };
		}),
	}) {
	static readonly Crons = Layer.mergeAll(
		ClusterService.Schedule.cron({ cron: Cron.unsafeParse(_CONFIG.cron.dlqSize), execute: Effect.suspend(() => Context.Request.withinSync(Context.Request.Id.system, PollingService.pipe(Effect.flatMap((service) => service.pollDlqSize)), Context.Request.system())), name: 'polling-dlq' }),
		ClusterService.Schedule.cron({ cron: Cron.unsafeParse(_CONFIG.cron.ioStats), execute: Effect.suspend(() => Context.Request.withinSync(Context.Request.Id.system, PollingService.pipe(Effect.flatMap((service) => service.pollIoStats)), Context.Request.system())), name: 'polling-io-stats' }),
		ClusterService.Schedule.cron({ cron: Cron.unsafeParse(_CONFIG.cron.jobQueueDepth), execute: Effect.suspend(() => Context.Request.withinSync(Context.Request.Id.system, PollingService.pipe(Effect.flatMap((service) => service.pollJobQueueDepth)), Context.Request.system())), name: 'polling-job-queue-depth' }),
		ClusterService.Schedule.cron({ cron: Cron.unsafeParse(_CONFIG.cron.eventOutboxDepth), execute: Effect.suspend(() => Context.Request.withinSync(Context.Request.Id.system, PollingService.pipe(Effect.flatMap((service) => service.pollEventOutboxDepth)), Context.Request.system())), name: 'polling-event-outbox-depth' }),
	);
}

// --- [EXPORT] ----------------------------------------------------------------

export { PollingService };
