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
	refresh: { minInterval: Duration.seconds(15) },
	thresholds: {
		cacheHitRatio: 		{ warning: 90 },
		dlqSize: 			{ critical: 1000, warning: 500 },
		eventOutboxDepth: 	{ critical: 1000, warning: 500 },
		jobQueueDepth: 		{ critical: 1000, warning: 500 },
	},
} as const;

// --- [SERVICES] --------------------------------------------------------------

class PollingService extends Effect.Service<PollingService>()('server/Polling', {
	scoped: Effect.gen(function* () {
		const metrics = yield* MetricsService;
		const database = yield* DatabaseService;
		const eventBus = yield* EventBus;
		const _listTenantIds = Context.Request.withinSync(
			Context.Request.Id.system,
			database.apps.find([{ field: 'id', op: 'notNull' }]),
			Context.Request.system(),
		).pipe(Effect.map((apps) => apps.map((app) => app.id)));
		const _sumTenantMetric = (metricForTenant: (tenantId: string) => Effect.Effect<number, unknown>) => _listTenantIds.pipe(
			Effect.flatMap((tenantIds) => Effect.forEach(tenantIds, (tenantId) =>
				Context.Request.withinSync(tenantId, metricForTenant(tenantId), Context.Request.system()),
			{ concurrency: 'unbounded' })),
			Effect.map((values) => values.reduce((sum, value) => sum + value, 0)),
		);
		const alertSchema = S.Struct({ current: S.Number, metric: S.String, severity: S.Literal('critical', 'warning'), threshold: S.Number });
		const loadAlerts = database.kvStore.getJson(_CONFIG.kvKey, S.Array(alertSchema)).pipe(
			Effect.map(Option.getOrElse(() => [] as const)),
			Effect.tapError((error) => Effect.logError('Failed to load polling alerts', { error: String(error) })),
			Effect.orElseSucceed(() => [] as const),
		);
		const initial = yield* loadAlerts;
		const alerts = yield* STM.commit(TRef.make(initial));
		const ioStatsState = yield* STM.commit(TRef.make<{ avgHitRatio: number; totalReads: number; totalWrites: number }>({ ..._CONFIG.fallback.ioStats }));
		const metricState = yield* STM.commit(TRef.make({} as Record<string, number>));
		const lastRefreshAtMs = yield* STM.commit(TRef.make(Option.none<number>()));
		const persistAlerts = (updated: typeof initial) => database.kvStore.setJson(_CONFIG.kvKey, [...updated], S.Array(alertSchema)).pipe(Effect.ignoreLogged);
		const publishFailure = (metric: string, error: unknown) => eventBus.publish({
			aggregateId: metric,
			payload: { _tag: 'polling.error', error: String(error), metric },
			tenantId: Context.Request.Id.system,
		}).pipe(Effect.ignore);
			const pollMetric = <R>(config: {
				readonly fetch: Effect.Effect<number, unknown, R>;
				readonly gauge: Metric.Metric.Gauge<number>;
				readonly metric: string;
				readonly spanName: string;
				readonly thresholds: { readonly critical: number; readonly warning: number };
				readonly warningMessage: string;}) =>
				Effect.gen(function* () {
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
					const wasAlreadyCritical = current.some((alert) => alert.metric === config.metric && alert.severity === 'critical');
					const metricName = config.metric;
					const currentAlert = current.find((alert) => alert.metric === metricName);
					const updatedAlert = updated.find((alert) => alert.metric === metricName);
					const wasCritical = currentAlert?.severity === 'critical';
					const isCriticalNow = updatedAlert?.severity === 'critical';
				const criticalRaised = !wasCritical && isCriticalNow;
				const recovered = wasCritical && !isCriticalNow;
				const emit = (action: 'critical' | 'recovered') => eventBus.publish({ aggregateId: config.metric, payload: { _tag: 'polling.alert', action, current: value, metric: config.metric, thresholds: config.thresholds }, tenantId: Context.Request.Id.system }).pipe(Effect.ignore);
				yield* Effect.all([Effect.when(emit('critical'), () => criticalRaised), Effect.when(emit('recovered'), () => recovered)], { discard: true });
				yield* Effect.when(Effect.logWarning(config.warningMessage, { threshold: config.thresholds.critical, value }), () => value >= config.thresholds.critical && !wasAlreadyCritical);
				yield* STM.commit(TRef.update(metricState, (state) => ({ ...state, [config.metric]: value })));
				return value;
			}).pipe(
				Effect.catchAll((error) => Effect.all([
					Effect.logError('Polling metric failed', { error: String(error), metric: config.metric }),
					publishFailure(config.metric, error),
				], { discard: true }).pipe(
					Effect.andThen(STM.commit(TRef.get(metricState))),
					Effect.map((state) => state[config.metric] ?? _CONFIG.fallback.metric),
				)),
				Telemetry.span(config.spanName, { metrics: false, 'polling.metric': config.metric }),
			);
			const pollDlqSize = pollMetric({ fetch: _sumTenantMetric(() => database.jobDlq.countPending()), gauge: metrics.jobs.dlqSize, metric: 'jobs_dlq_size', spanName: 'polling.dlqSize', thresholds: _CONFIG.thresholds.dlqSize, warningMessage: 'DLQ size critical' });
			const pollJobQueueDepth = pollMetric({ fetch: _sumTenantMetric(() => database.jobs.countByStatuses('queued', 'processing')), gauge: metrics.jobs.queueDepth, metric: 'jobs_queue_depth', spanName: 'polling.jobQueueDepth', thresholds: _CONFIG.thresholds.jobQueueDepth, warningMessage: 'Job queue depth critical' });
			const pollEventOutboxDepth = pollMetric({ fetch: database.eventOutbox.count, gauge: metrics.events.outboxDepth, metric: 'events_outbox_depth', spanName: 'polling.eventOutboxDepth', thresholds: _CONFIG.thresholds.eventOutboxDepth, warningMessage: 'Event outbox depth critical' });
		const pollIoStats =
			Effect.gen(function* () {
				const stats = yield* database.monitoring.cacheHitRatio();
				const totalReads = stats.reduce((sum, s) => sum + Number(s.reads), 0);
				const totalHits = stats.reduce((sum, s) => sum + Number(s.hits), 0);
				const totalWrites = stats.reduce((sum, s) => sum + Number(s.writes), 0);
				const avgHitRatio = totalReads + totalHits > 0 ? (totalHits / (totalReads + totalHits)) * 100 : 0;
				yield* Effect.all([Metric.set(metrics.database.cacheHitRatio, avgHitRatio), Metric.set(metrics.database.ioReads, totalReads), Metric.set(metrics.database.ioWrites, totalWrites)], { discard: true });
				yield* Effect.when(Effect.logWarning('Cache hit ratio below threshold', { avgHitRatio, threshold: _CONFIG.thresholds.cacheHitRatio.warning }), () => avgHitRatio > 0 && avgHitRatio < _CONFIG.thresholds.cacheHitRatio.warning);
				yield* STM.commit(TRef.set(ioStatsState, { avgHitRatio, totalReads, totalWrites }));
				return { avgHitRatio, totalReads };
			}).pipe(
				Effect.catchAll((error) => Effect.all([
					Effect.logError('Polling io stats failed', { error: String(error), metric: 'pg_stat_io' }),
					publishFailure('pg_stat_io', error),
				], { discard: true }).pipe(
					Effect.andThen(STM.commit(TRef.get(ioStatsState))),
					Effect.map(({ avgHitRatio, totalReads }) => ({ avgHitRatio, totalReads })),
				)),
				Telemetry.span('polling.ioStats', { metrics: false, 'polling.metric': 'pg_stat_io' }),
			);
		const minIntervalMs = Duration.toMillis(_CONFIG.refresh.minInterval);
		const doRefresh = Effect.all([pollDlqSize, pollJobQueueDepth, pollEventOutboxDepth, pollIoStats], { discard: true });
		const refresh = (force = false) => Effect.gen(function* () {
			const now = yield* Clock.currentTimeMillis;
			const lastRefreshedAt = yield* STM.commit(TRef.get(lastRefreshAtMs));
			const elapsed = now - (Option.getOrUndefined(lastRefreshedAt) ?? 0);
			const shouldRefresh = force || elapsed >= minIntervalMs;
			yield* Effect.when(doRefresh.pipe(Effect.andThen(STM.commit(TRef.set(lastRefreshAtMs, Option.some(now))))), () => shouldRefresh);
		}).pipe(Telemetry.span('polling.refresh', { metrics: false }));
		const getHealth = () => loadAlerts.pipe(
			Effect.tap((latest) => STM.commit(TRef.set(alerts, latest))),
			Effect.tapError((error) => Effect.logError('Polling health refresh failed', { error: String(error) })),
			Effect.orElse(() => STM.commit(TRef.get(alerts))),
			Telemetry.span('polling.getHealth', { metrics: false }),
		);
		return { getHealth, pollDlqSize, pollEventOutboxDepth, pollIoStats, pollJobQueueDepth, refresh };
	}),
	}) {
		static readonly Crons = Layer.mergeAll(
			ClusterService.Schedule.cron({ cron: Cron.unsafeParse(_CONFIG.cron.dlqSize), execute: Effect.suspend(() => Context.Request.withinSync(Context.Request.Id.system, PollingService.pipe(Effect.flatMap((p) => p.pollDlqSize)), Context.Request.system())), name: 'polling-dlq' }),
			ClusterService.Schedule.cron({ cron: Cron.unsafeParse(_CONFIG.cron.ioStats), execute: Effect.suspend(() => Context.Request.withinSync(Context.Request.Id.system, PollingService.pipe(Effect.flatMap((p) => p.pollIoStats)), Context.Request.system())), name: 'polling-io-stats' }),
			ClusterService.Schedule.cron({ cron: Cron.unsafeParse(_CONFIG.cron.jobQueueDepth), execute: Effect.suspend(() => Context.Request.withinSync(Context.Request.Id.system, PollingService.pipe(Effect.flatMap((p) => p.pollJobQueueDepth)), Context.Request.system())), name: 'polling-job-queue-depth' }),
			ClusterService.Schedule.cron({ cron: Cron.unsafeParse(_CONFIG.cron.eventOutboxDepth), execute: Effect.suspend(() => Context.Request.withinSync(Context.Request.Id.system, PollingService.pipe(Effect.flatMap((p) => p.pollEventOutboxDepth)), Context.Request.system())), name: 'polling-event-outbox-depth' }),
		);
	}

// --- [EXPORT] ----------------------------------------------------------------

export { PollingService };
