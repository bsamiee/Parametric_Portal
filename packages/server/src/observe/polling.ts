/**
 * Scheduled metrics polling with unified poll+alert flow.
 * MetricPolling.retry for resilience; Schedule.jittered to prevent thundering herd.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import { Duration, Effect, Match, Metric, MetricPolling, MetricState, Option, type Record, Ref, Schedule } from 'effect';
import { MetricsService } from './metrics.ts';
import { Telemetry } from './telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
	intervals: { queueDepth: Duration.seconds(30) },
	retry: { base: Duration.seconds(1), cap: Duration.seconds(30) },
	thresholds: { queueDepth: { critical: 1000, warning: 500 } },
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

/** Transform MetricState to Prometheus-compatible snapshot entries. */
const _stateToEntries = (state: MetricState.MetricState<unknown>, name: string, labels: Record<string, string>) =>
	Match.value(state).pipe(
		Match.when(MetricState.isCounterState, (s) => [{ labels, name, type: 'counter', value: Number(s.count) }]),
		Match.when(MetricState.isGaugeState, (s) => [{ labels, name, type: 'gauge', value: Number(s.value) }]),
		Match.when(MetricState.isHistogramState, (s) => [
			{ labels, name: `${name}_count`, type: 'histogram_count', value: s.count },
			{ labels, name: `${name}_sum`, type: 'histogram_sum', value: s.sum },
			{ labels, name: `${name}_min`, type: 'histogram_min', value: s.min },
			{ labels, name: `${name}_max`, type: 'histogram_max', value: s.max },
		]),
		Match.when(MetricState.isSummaryState, (s) => [
			{ labels, name: `${name}_count`, type: 'summary_count', value: s.count },
			{ labels, name: `${name}_sum`, type: 'summary_sum', value: s.sum },
			...[...s.quantiles].filter(([, v]) => Option.isSome(v)).map(([q, v]) => ({
				labels: { ...labels, quantile: String(q) },
				name,
				type: 'summary_quantile',
				value: Option.getOrElse(v, () => 0),
			})),
		]),
		Match.when(MetricState.isFrequencyState, (s) => [...s.occurrences.entries()].map(([category, count]) => ({
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
		const db = yield* DatabaseService;
		const alerts = yield* Ref.make<ReadonlyArray<PollingService.Alert>>([]);
		const threshold = _config.thresholds.queueDepth;
		const pollEffect = Effect.gen(function* () {
			const value = yield* db.jobs.count([{ field: 'status', value: 'pending' }]);
			const shouldLog = yield* Ref.modify(alerts, (current) => {
				const wasAlreadyCritical = current.some((a) => a.metric === 'jobs_queue_depth' && a.severity === 'critical');
				const filtered = current.filter((a) => a.metric !== 'jobs_queue_depth');
				const updated = Match.value(value).pipe(
					Match.when((v) => v > threshold.critical, () => [...filtered, { current: value, metric: 'jobs_queue_depth' as const, severity: 'critical' as const, threshold: threshold.critical }]),
					Match.when((v) => v > threshold.warning, () => [...filtered, { current: value, metric: 'jobs_queue_depth' as const, severity: 'warning' as const, threshold: threshold.warning }]),
					Match.orElse(() => filtered),
				);
				return [value > threshold.critical && !wasAlreadyCritical, updated] as const;
			});
			yield* Effect.when(Effect.logWarning('Queue depth critical', { threshold: threshold.critical, value }), () => shouldLog);
			return value;
		}).pipe(Effect.orElseSucceed(() => 0), Telemetry.span('polling.queueDepth', { metrics: false, 'polling.metric': 'jobs_queue_depth' }));
		const retrySchedule = Schedule.exponential(_config.retry.base).pipe(Schedule.jittered, Schedule.upTo(_config.retry.cap));
		const polling = MetricPolling.make(metrics.jobs.queueDepth, pollEffect).pipe(MetricPolling.retry(retrySchedule));
		const launchSchedule = Schedule.spaced(_config.intervals.queueDepth).pipe(Schedule.jittered);
		yield* MetricPolling.launch(polling, launchSchedule);
		yield* Effect.logInfo('PollingService started');
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
		return { getHealth, snapshot };
	}),
}) {}

// --- [NAMESPACE] -------------------------------------------------------------

namespace PollingService {
	export interface Alert {
		readonly current: number;
		readonly metric: string;
		readonly severity: 'critical' | 'warning';
		readonly threshold: number;
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { PollingService };
