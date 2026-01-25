/**
 * Scheduled metrics polling with unified poll+alert flow.
 * Uses SynchronizedRef for atomic alert updates, MetricPolling.retry for resilience,
 * Schedule.jittered to prevent thundering herd across instances.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import { Duration, Effect, FiberSet, Match, Metric, MetricPolling, MetricState, Option, Schedule, SynchronizedRef } from 'effect';
import { MetricsService } from './metrics.ts';

// --- [TYPES] -----------------------------------------------------------------

type Alert = { readonly current: number; readonly metric: string; readonly severity: 'critical' | 'warning'; readonly threshold: number };
type SnapshotEntry = { readonly labels: Record<string, string>; readonly name: string; readonly type: string; readonly value: number };
type Threshold = { readonly critical: number; readonly warning: number };

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
	intervals: { queueDepth: Duration.seconds(30) },
	retry: { base: Duration.seconds(1), cap: Duration.seconds(30) },
	thresholds: { queueDepth: { critical: 1000, warning: 500 } satisfies Threshold },
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

/** Evaluate value against thresholds, returning updated alert array with metric replaced or cleared. */
const _evaluateThreshold = (alerts: ReadonlyArray<Alert>, metric: string, value: number, threshold: Threshold): ReadonlyArray<Alert> => {
	const filtered = alerts.filter((a) => a.metric !== metric);
	return Match.value(value).pipe(
		Match.when((v) => v > threshold.critical, () => [...filtered, { current: value, metric, severity: 'critical' as const, threshold: threshold.critical }]),
		Match.when((v) => v > threshold.warning, () => [...filtered, { current: value, metric, severity: 'warning' as const, threshold: threshold.warning }]),
		Match.orElse(() => filtered),
	);
};
/** Transform MetricState to Prometheus-compatible snapshot entries. */
const _stateToEntries = (state: MetricState.MetricState<unknown>, name: string, labels: Record<string, string>): ReadonlyArray<SnapshotEntry> =>
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

class MetricsPollingService extends Effect.Service<MetricsPollingService>()('server/MetricsPolling', {
	scoped: Effect.gen(function* () {
		const metrics = yield* MetricsService;
		const db = yield* DatabaseService;
		const fiberSet = yield* FiberSet.make<void, never>();
		const alerts = yield* SynchronizedRef.make<ReadonlyArray<Alert>>([]);
		// Unified poll: fetch DB count → update gauge → evaluate health thresholds atomically
		const pollEffect = db.jobs.count([{ field: 'status', value: 'pending' }]).pipe(
			Effect.tap((value) =>
				SynchronizedRef.updateEffect(alerts, (current) => {
					const updated = _evaluateThreshold(current, 'jobs_queue_depth', value, _config.thresholds.queueDepth);
					const criticalAlert = updated.find((a) => a.metric === 'jobs_queue_depth' && a.severity === 'critical');
					const wasAlreadyCritical = current.some((a) => a.metric === 'jobs_queue_depth' && a.severity === 'critical');
					return criticalAlert && !wasAlreadyCritical
						? Effect.logWarning('Queue depth critical', { threshold: criticalAlert.threshold, value }).pipe(Effect.as(updated))
						: Effect.succeed(updated);
				}),
			),
			Effect.orElseSucceed(() => 0),
		);
		const retrySchedule = Schedule.exponential(_config.retry.base).pipe(
			Schedule.jittered,
			Schedule.upTo(_config.retry.cap),
		);
		const polling = MetricPolling.make(metrics.jobs.queueDepth, pollEffect).pipe(MetricPolling.retry(retrySchedule));
		const launchSchedule = Schedule.spaced(_config.intervals.queueDepth).pipe(Schedule.jittered);
		yield* FiberSet.run(fiberSet, MetricPolling.launch(polling, launchSchedule));
		yield* Effect.logInfo('MetricsPollingService started');
		const snapshot = (): Effect.Effect<ReadonlyArray<SnapshotEntry>> =>
			Metric.snapshot.pipe(
				Effect.map((snap) =>
					Array.from(snap).flatMap((entry) => {
						const labels = Object.fromEntries(Array.from(entry.metricKey.tags).map((tag) => [tag.key, tag.value]));
						return _stateToEntries(entry.metricState, entry.metricKey.name, labels);
					}),
				),
			);
		const getHealth = () => SynchronizedRef.get(alerts);
		return { getHealth, snapshot };
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { MetricsPollingService };
