/**
 * Scheduled metrics polling with unified poll+alert flow.
 * Alerts persisted to kvStore for durability across restarts.
 */
import { Client } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Array as A, Cron, Effect, Layer, Match, Metric, MetricState, Option, type Record, Ref, Schema as S } from 'effect';
import { ClusterService } from '../infra/cluster.ts';
import { MetricsService } from './metrics.ts';
import { Telemetry } from './telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	cron: { dlqSize: '*/1 * * * *', ioStats: '*/5 * * * *' },
	kvKey: 'alerts:polling',
	thresholds: { cacheHitRatio: { warning: 90 }, dlqSize: { critical: 1000, warning: 500 } },
} as const;
const _AlertSchema = S.Struct({ current: S.Number, metric: S.String, severity: S.Literal('critical', 'warning'), threshold: S.Number });

// --- [FUNCTIONS] -------------------------------------------------------------

/** Transform MetricState to Prometheus-compatible snapshot entries. */
const _stateToEntries = (state: MetricState.MetricState<unknown>, name: string, labels: Record<string, string>) =>
	Match.value(state).pipe(
		Match.when(MetricState.isCounterState, (counterState) => [{ labels, name, type: 'counter', value: Number(counterState.count) }]),
		Match.when(MetricState.isGaugeState, (gaugeState) => [{ labels, name, type: 'gauge', value: Number(gaugeState.value) }]),
		Match.when(MetricState.isHistogramState, (histogramState) => [
			{ labels, name: `${name}_count`, type: 'histogram_count', value: histogramState.count },
			{ labels, name: `${name}_sum`, type: 'histogram_sum', value: histogramState.sum },
			{ labels, name: `${name}_min`, type: 'histogram_min', value: histogramState.min },
			{ labels, name: `${name}_max`, type: 'histogram_max', value: histogramState.max },
		]),
		Match.when(MetricState.isSummaryState, (summaryState) => [
			{ labels, name: `${name}_count`, type: 'summary_count', value: summaryState.count },
			{ labels, name: `${name}_sum`, type: 'summary_sum', value: summaryState.sum },
			...A.filterMap([...summaryState.quantiles], ([quantile, v]) => Option.map(v, (val) => ({ // NOSONAR S3358
				labels: { ...labels, quantile: String(quantile) },
				name,
				type: 'summary_quantile' as const,
				value: val,
			}))),
		]),
		Match.when(MetricState.isFrequencyState, (frequencyState) => [...frequencyState.occurrences.entries()].map(([category, count]) => ({
			labels: { ...labels, category },
			name,
			type: 'frequency',
			value: count,
		}))),
		Match.orElse(() => []),
	);

// --- [SERVICE] ---------------------------------------------------------------

class PollingService extends Effect.Service<PollingService>()('server/Polling', {
	scoped: Effect.gen(function* () {
		const metrics = yield* MetricsService;
		const database = yield* DatabaseService;
		// Load persisted alerts from kvStore (fallback to empty on missing/parse error)
		const initial = yield* database.kvStore.getJson(_CONFIG.kvKey, S.Array(_AlertSchema)).pipe(
			Effect.map(Option.getOrElse(() => [] as const)),
			Effect.orElseSucceed(() => [] as const),
		);
		const alerts = yield* Ref.make(initial);
		const persistAlerts = (updated: typeof initial) =>
			database.kvStore.setJson(_CONFIG.kvKey, [...updated], S.Array(_AlertSchema)).pipe(Effect.ignoreLogged);
		const threshold = _CONFIG.thresholds.dlqSize;
		const pollDlqSize = Effect.gen(function* () {
			const value = yield* database.jobDlq.countPending();
			yield* Metric.set(metrics.jobs.dlqSize, value);
			const [shouldLog, updated] = yield* Ref.modify(alerts, (current) => {
				const wasAlreadyCritical = current.some((a) => a.metric === 'jobs_dlq_size' && a.severity === 'critical');
				const filtered = current.filter((a) => a.metric !== 'jobs_dlq_size');
				const next = Match.value(value).pipe(
					Match.when((v) => v > threshold.critical, () => [...filtered, { current: value, metric: 'jobs_dlq_size' as const, severity: 'critical' as const, threshold: threshold.critical }]),
					Match.when((v) => v > threshold.warning, () => [...filtered, { current: value, metric: 'jobs_dlq_size' as const, severity: 'warning' as const, threshold: threshold.warning }]),
					Match.orElse(() => filtered),
				);
				return [[value > threshold.critical && !wasAlreadyCritical, next] as const, next] as const;
			});
			yield* persistAlerts(updated);
			yield* Effect.when(Effect.logWarning('DLQ size critical', { threshold: threshold.critical, value }), () => shouldLog);
			return value;
		}).pipe(Effect.orElseSucceed(() => 0), Telemetry.span('polling.dlqSize', { metrics: false, 'polling.metric': 'jobs_dlq_size' }));
		const pollIoStats = Effect.gen(function* () {
			const stats = yield* Client.monitoring.cacheHitRatio();
			const avgHitRatio = stats.length > 0 ? stats.reduce((sum, s) => sum + s.cacheHitRatio, 0) / stats.length : 0;
			const totalReads = stats.reduce((sum, s) => sum + Number(s.reads), 0);
			yield* Effect.all([Metric.set(metrics.database.cacheHitRatio, avgHitRatio), Metric.set(metrics.database.ioReads, totalReads)], { discard: true });
			const shouldWarn = avgHitRatio > 0 && avgHitRatio < _CONFIG.thresholds.cacheHitRatio.warning;
			yield* Effect.when(Effect.logWarning('Cache hit ratio below threshold', { avgHitRatio, threshold: _CONFIG.thresholds.cacheHitRatio.warning }), () => shouldWarn);
			return { avgHitRatio, totalReads };
		}).pipe(Effect.orElseSucceed(() => ({ avgHitRatio: 0, totalReads: 0 })), Telemetry.span('polling.ioStats', { metrics: false, 'polling.metric': 'pg_stat_io' }));
		const snapshot = Metric.snapshot.pipe(Effect.map((snap) =>
			[...snap].flatMap((entry) =>
				_stateToEntries(
					entry.metricState,
					entry.metricKey.name,
					Object.fromEntries([...entry.metricKey.tags].map((tag) => [tag.key, tag.value])),
				),
			),
		));
		const getHealth = () => Ref.get(alerts);
		return { getHealth, pollDlqSize, pollIoStats, snapshot };
	}),
}) {
	/** Consolidated cron layer for all polling schedules */
	static readonly Crons = Layer.mergeAll(
		ClusterService.cron({
			cron: Cron.unsafeParse(_CONFIG.cron.dlqSize),
			execute: PollingService.pipe(Effect.flatMap((p) => p.pollDlqSize)),
			name: 'polling-dlq',
		}),
		ClusterService.cron({
			cron: Cron.unsafeParse(_CONFIG.cron.ioStats),
			execute: PollingService.pipe(Effect.flatMap((p) => p.pollIoStats)),
			name: 'polling-io-stats',
		}),
	);
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace PollingService {
	export type Alert = typeof _AlertSchema.Type;
}

// --- [EXPORT] ----------------------------------------------------------------

export { PollingService };
