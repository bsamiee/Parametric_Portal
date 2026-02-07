/**
 * Scheduled metrics polling with unified poll+alert flow.
 * Alerts persisted to kvStore for durability across restarts.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import { Array as A, Clock, Cron, Duration, Effect, Layer, Match, Metric, Option, pipe, Ref, Schema as S } from 'effect';
import { Context } from '../context.ts';
import { ClusterService } from '../infra/cluster.ts';
import { EventBus } from '../infra/events.ts';
import { MetricsService } from './metrics.ts';
import { Telemetry } from './telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	cron: { dlqSize: '*/1 * * * *', eventOutboxDepth: '*/1 * * * *', ioStats: '*/5 * * * *', jobQueueDepth: '*/1 * * * *' },
	kvKey: 'alerts:polling',
	refresh: { minInterval: Duration.seconds(15) },
	thresholds: {
		cacheHitRatio: 		{ warning: 90 },
		dlqSize: 			{ critical: 1000, warning: 500 },
		eventOutboxDepth: 	{ critical: 1000, warning: 500 },
		jobQueueDepth: 		{ critical: 1000, warning: 500 },
	},
} as const;
const _AlertSchema = S.Struct({ current: S.Number, metric: S.String, severity: S.Literal('critical', 'warning'), threshold: S.Number });

// --- [FUNCTIONS] -------------------------------------------------------------

const _withSystemContext = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
	Effect.sync(Context.Request.system).pipe(Effect.flatMap((ctx) => Context.Request.within(Context.Request.Id.system, effect, ctx)),);
const _loadAlerts = (database: DatabaseService) =>
	database.kvStore.getJson(_CONFIG.kvKey, S.Array(_AlertSchema)).pipe(
		Effect.map(Option.getOrElse(() => [] as const)),
		Effect.orElseSucceed(() => [] as const),
	);
const _updateAlerts = (
	current: ReadonlyArray<typeof _AlertSchema.Type>,
	config: { readonly metric: string; readonly value: number; readonly warning: number; readonly critical: number },): readonly [boolean, ReadonlyArray<typeof _AlertSchema.Type>] => {
	const wasAlreadyCritical = current.some((alert) => alert.metric === config.metric && alert.severity === 'critical');
	const filtered = current.filter((alert) => alert.metric !== config.metric);
	const next = Match.value(config.value).pipe(
		Match.when((value) => value >= config.critical, () => [...filtered, { current: config.value, metric: config.metric, severity: 'critical' as const, threshold: config.critical }]),
		Match.when((value) => value >= config.warning, () => [...filtered, { current: config.value, metric: config.metric, severity: 'warning' as const, threshold: config.warning }]),
		Match.orElse(() => filtered),
	);
	return [config.value >= config.critical && !wasAlreadyCritical, next] as const;
};
const _severity = (alerts: ReadonlyArray<typeof _AlertSchema.Type>, metric: string) => pipe(
	alerts,
	A.findFirst((alert) => alert.metric === metric),
	Option.map((alert) => alert.severity),
);
const _isCritical = (severity: Option.Option<typeof _AlertSchema.Type['severity']>) => Option.match(severity, {
	onNone: () => false,
	onSome: (value) => value === 'critical',
});
const _emitTransitions = (
	eventBus: EventBus,
	metric: string,
	current: ReadonlyArray<typeof _AlertSchema.Type>,
	next: ReadonlyArray<typeof _AlertSchema.Type>,
	value: number,
	thresholds: { readonly critical: number; readonly warning: number },
) => {
	const currentSeverity = _severity(current, metric);
	const nextSeverity = _severity(next, metric);
	const criticalRaised = !_isCritical(currentSeverity) && _isCritical(nextSeverity);
	const recovered = _isCritical(currentSeverity) && !_isCritical(nextSeverity);
	const emit = (action: 'critical' | 'recovered') => eventBus.publish({
		aggregateId: metric,
		payload: {
			_tag: 'polling.alert',
			action,
			current: value,
			metric,
			thresholds,
		},
		tenantId: Context.Request.Id.system,
	}).pipe(Effect.ignore);
	return Effect.all([
		Effect.when(emit('critical'), () => criticalRaised),
		Effect.when(emit('recovered'), () => recovered),
	], { discard: true });
};

// --- [SERVICES] --------------------------------------------------------------

class PollingService extends Effect.Service<PollingService>()('server/Polling', {
	scoped: Effect.gen(function* () {
		const metrics = yield* MetricsService;
		const database = yield* DatabaseService;
		const eventBus = yield* EventBus;
		// Load persisted alerts from kvStore (fallback to empty on missing/parse error)
		const initial = yield* _loadAlerts(database);
		const alerts = yield* Ref.make(initial);
		const lastRefreshAtMs = yield* Ref.make(Option.none<number>());
		const persistAlerts = (updated: typeof initial) => database.kvStore.setJson(_CONFIG.kvKey, [...updated], S.Array(_AlertSchema)).pipe(Effect.ignoreLogged);
		const checkShouldRefresh = (force: boolean, lastRefreshedAt: Option.Option<number>, now: number) =>
			force || Option.match(lastRefreshedAt, {
				onNone: () => true,
				onSome: (ts) => now - ts >= Duration.toMillis(_CONFIG.refresh.minInterval),
			});
		const pollDlqSize = _withSystemContext(
			Effect.gen(function* () {
				const value = yield* database.jobDlq.countPending();
				yield* Metric.set(metrics.jobs.dlqSize, value);
				const current = yield* Ref.get(alerts);
				const [shouldLog, updated] = _updateAlerts(current, {
					critical: _CONFIG.thresholds.dlqSize.critical,
					metric: 'jobs_dlq_size',
					value,
					warning: _CONFIG.thresholds.dlqSize.warning,
				});
				yield* Ref.set(alerts, updated);
				yield* persistAlerts(updated);
				yield* _emitTransitions(eventBus, 'jobs_dlq_size', current, updated, value, _CONFIG.thresholds.dlqSize);
				yield* Effect.when(Effect.logWarning('DLQ size critical', { threshold: _CONFIG.thresholds.dlqSize.critical, value }), () => shouldLog);
				return value;
			}).pipe(Effect.orElseSucceed(() => 0), Telemetry.span('polling.dlqSize', { metrics: false, 'polling.metric': 'jobs_dlq_size' })),
		);
		const pollJobQueueDepth = _withSystemContext(
			Effect.gen(function* () {
				const value = yield* database.jobs.countByStatuses('queued', 'processing');
				yield* Metric.set(metrics.jobs.queueDepth, value);
				const current = yield* Ref.get(alerts);
				const [shouldLog, updated] = _updateAlerts(current, {
					critical: _CONFIG.thresholds.jobQueueDepth.critical,
					metric: 'jobs_queue_depth',
					value,
					warning: _CONFIG.thresholds.jobQueueDepth.warning,
				});
				yield* Ref.set(alerts, updated);
				yield* persistAlerts(updated);
				yield* _emitTransitions(eventBus, 'jobs_queue_depth', current, updated, value, _CONFIG.thresholds.jobQueueDepth);
				yield* Effect.when(Effect.logWarning('Job queue depth critical', { threshold: _CONFIG.thresholds.jobQueueDepth.critical, value }), () => shouldLog);
				return value;
			}).pipe(
				Effect.orElseSucceed(() => 0),
				Telemetry.span('polling.jobQueueDepth', { metrics: false, 'polling.metric': 'jobs_queue_depth' }),
			),
		);
		const pollEventOutboxDepth = _withSystemContext(
			Effect.gen(function* () {
				const value = yield* database.eventOutbox.count;
				yield* Metric.set(metrics.events.outboxDepth, value);
				const current = yield* Ref.get(alerts);
				const [shouldLog, updated] = _updateAlerts(current, {
					critical: _CONFIG.thresholds.eventOutboxDepth.critical,
					metric: 'events_outbox_depth',
					value,
					warning: _CONFIG.thresholds.eventOutboxDepth.warning,
				});
				yield* Ref.set(alerts, updated);
				yield* persistAlerts(updated);
				yield* _emitTransitions(eventBus, 'events_outbox_depth', current, updated, value, _CONFIG.thresholds.eventOutboxDepth);
				yield* Effect.when(Effect.logWarning('Event outbox depth critical', { threshold: _CONFIG.thresholds.eventOutboxDepth.critical, value }), () => shouldLog);
				return value;
			}).pipe(
				Effect.orElseSucceed(() => 0),
				Telemetry.span('polling.eventOutboxDepth', { metrics: false, 'polling.metric': 'events_outbox_depth' }),
			),
		);
		const pollIoStats = _withSystemContext(
			Effect.gen(function* () {
				const stats = yield* database.monitoring.cacheHitRatio();
				const totalReads = stats.reduce((sum, s) => sum + Number(s.reads), 0);
				const totalHits = stats.reduce((sum, s) => sum + Number(s.hits), 0);
				const totalWrites = stats.reduce((sum, s) => sum + Number(s.writes), 0);
				const avgHitRatio = totalReads + totalHits > 0 ? (totalHits / (totalReads + totalHits)) * 100 : 0;
				yield* Effect.all([
					Metric.set(metrics.database.cacheHitRatio, avgHitRatio),
					Metric.set(metrics.database.ioReads, totalReads),
					Metric.set(metrics.database.ioWrites, totalWrites),
				], { discard: true });
				const shouldWarn = avgHitRatio > 0 && avgHitRatio < _CONFIG.thresholds.cacheHitRatio.warning;
				yield* Effect.when(Effect.logWarning('Cache hit ratio below threshold', { avgHitRatio, threshold: _CONFIG.thresholds.cacheHitRatio.warning }), () => shouldWarn);
				return { avgHitRatio, totalReads };
			}).pipe(Effect.orElseSucceed(() => ({ avgHitRatio: 0, totalReads: 0 })), Telemetry.span('polling.ioStats', { metrics: false, 'polling.metric': 'pg_stat_io' })),
		);
		const refresh = (force = false) => Effect.all([Clock.currentTimeMillis, Ref.get(lastRefreshAtMs)]).pipe(
			Effect.flatMap(([now, lastRefreshedAt]) => Effect.when(
				Effect.all([
					pollDlqSize,
					pollJobQueueDepth,
					pollEventOutboxDepth,
					pollIoStats,
				], { discard: true }).pipe(Effect.andThen(Ref.set(lastRefreshAtMs, Option.some(now))),),
				() => checkShouldRefresh(force, lastRefreshedAt, now),
			)),
			Telemetry.span('polling.refresh', { metrics: false }),
		);
		const getHealth = () => _loadAlerts(database).pipe(
			Effect.tap((latest) => Ref.set(alerts, latest)),
			Effect.orElse(() => Ref.get(alerts)),
			Telemetry.span('polling.getHealth', { metrics: false }),
		);
		return { getHealth, pollDlqSize, pollEventOutboxDepth, pollIoStats, pollJobQueueDepth, refresh };
	}),
}) {
	/** Consolidated cron layer for all polling schedules */
	static readonly Crons = Layer.mergeAll(
		ClusterService.Schedule.cron({
			cron: Cron.unsafeParse(_CONFIG.cron.dlqSize),
			execute: PollingService.pipe(Effect.flatMap((p) => p.pollDlqSize)),
			name: 'polling-dlq',
		}),
		ClusterService.Schedule.cron({
			cron: Cron.unsafeParse(_CONFIG.cron.ioStats),
			execute: PollingService.pipe(Effect.flatMap((p) => p.pollIoStats)),
			name: 'polling-io-stats',
		}),
		ClusterService.Schedule.cron({
			cron: Cron.unsafeParse(_CONFIG.cron.jobQueueDepth),
			execute: PollingService.pipe(Effect.flatMap((p) => p.pollJobQueueDepth)),
			name: 'polling-job-queue-depth',
		}),
		ClusterService.Schedule.cron({
			cron: Cron.unsafeParse(_CONFIG.cron.eventOutboxDepth),
			execute: PollingService.pipe(Effect.flatMap((p) => p.pollEventOutboxDepth)),
			name: 'polling-event-outbox-depth',
		}),
	);
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace PollingService {
	export type Alert = typeof _AlertSchema.Type;
}

// --- [EXPORT] ----------------------------------------------------------------

export { PollingService };
