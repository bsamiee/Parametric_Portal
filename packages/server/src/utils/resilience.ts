/**
 * Resilience: bulkhead -> timeout -> hedge -> retry -> circuit -> fallback -> span
 * Native Effect APIs: Semaphore (bulkhead), raceAll (hedge)
 */
import { Array as A, Data, Duration, Effect, Function as F, Layer, Match, Option, Schedule, STM, TMap } from 'effect';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Circuit } from './circuit.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _mkSchedule = (config: Resilience.ScheduleConfig): Schedule.Schedule<unknown, unknown, never> => {
	const base = Schedule.exponential(config.base, config.factor ?? 2).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(Math.max(0, config.maxAttempts - 1))));
	return config.cap === undefined ? base : base.pipe(Schedule.upTo(config.cap));
};
const _CONFIG = {
	defaults: { bulkhead: 10, hedgeDelay: Duration.millis(100), threshold: 5, timeout: Duration.seconds(30) },
	nonRetriable: new Set(['Auth', 'Conflict', 'Forbidden', 'Gone', 'NotFound', 'RateLimit', 'Validation']) as ReadonlySet<string>,
	presets: {
		brief: 		_mkSchedule({ base: Duration.millis(50), cap: Duration.seconds(2), maxAttempts: 2 }),
		default: 	_mkSchedule({ base: Duration.millis(100), cap: Duration.seconds(10), maxAttempts: 3 }),
		patient: 	_mkSchedule({ base: Duration.millis(500), cap: Duration.seconds(30), maxAttempts: 5 }),
		persistent: _mkSchedule({ base: Duration.millis(100), cap: Duration.seconds(30), maxAttempts: 5 }),
	},
} as const;

// --- [ERRORS] ----------------------------------------------------------------

class TimeoutError extends Data.TaggedError('TimeoutError')<{ readonly operation: string; readonly durationMs: number }> {
	static readonly of = (operation: string, duration: Duration.Duration) => new TimeoutError({ durationMs: Duration.toMillis(duration), operation });
	override get message() { return `TimeoutError: ${this.operation} exceeded ${this.durationMs}ms`; }
}
class BulkheadError extends Data.TaggedError('BulkheadError')<{ readonly operation: string; readonly permits: number }> {
	static readonly of = (operation: string, permits: number) => new BulkheadError({ operation, permits });
	override get message() { return `BulkheadError: ${this.operation} rejected (${this.permits} permits)`; }
}

// --- [SERVICES] --------------------------------------------------------------

class ResilienceState extends Effect.Service<ResilienceState>()('server/ResilienceState', {
	scoped: Effect.gen(function* () {
		const semStore = yield* STM.commit(TMap.empty<string, Effect.Semaphore>());
		return { semStore };
	}),
}) {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _run = <A, E, R>(operation: string, eff: Effect.Effect<A, E, R>, configuration: Resilience.Config<A, E, R> = {}): Effect.Effect<A, Resilience.Error<E>, R | Resilience.State> =>
	ResilienceState.pipe(Effect.flatMap(({ semStore }) => {
		const timeout = configuration.timeout === false ? undefined : (configuration.timeout ?? _CONFIG.defaults.timeout);
		const schedule = Match.value(configuration.retry).pipe(Match.when(false, () => undefined), Match.when(Match.string, (key: Resilience.SchedulePreset) => _CONFIG.presets[key]), Match.when(true, () => _CONFIG.presets.default), Match.when(undefined, () => _CONFIG.presets.default), Match.orElse((s) => s));
		const circuitName = configuration.circuit === false ? undefined : (configuration.circuit ?? operation);
		const bulkhead = Match.value(configuration.bulkhead).pipe(
			Match.when(false, () => undefined),
			Match.when(undefined, () => undefined),
			Match.orElse((value) => value),
		);
		const bulkheadKey = `${operation}:${bulkhead}`;
		const hedge = Match.value(configuration.hedge).pipe(Match.when(false, () => undefined), Match.when(Match.number, (n) => ({ attempts: Math.max(2, n), delay: _CONFIG.defaults.hedgeDelay })), Match.orElse((h) => h));
		const inc = (key: keyof MetricsService['resilience']) => Effect.flatMap(Effect.serviceOption(MetricsService), Option.match({ onNone: () => Effect.void, onSome: (metrics) => MetricsService.inc(metrics.resilience[key], MetricsService.label({ operation })) }));
		const t0: Effect.Effect<A, E | TimeoutError, R> = timeout === undefined ? eff : eff.pipe(Effect.timeoutFail({ duration: timeout, onTimeout: () => TimeoutError.of(operation, timeout) }), Effect.tapErrorTag('TimeoutError', () => inc('timeouts')));
		const t1 = Match.value(hedge).pipe(
			Match.when(undefined, F.constant(t0)),
			Match.orElse((h) => Effect.raceAll(A.map(A.makeBy(h.attempts, F.identity), (index) => Effect.tapBoth(
				Effect.delay(t0, Duration.times(h.delay, index)),
				{
					onFailure: F.constant(Effect.void),
					onSuccess: F.constant(
						Match.value(index).pipe(
							Match.when(0, F.constant(Effect.void)),
							Match.orElse(F.constant(inc('hedges'))),
						),
					),
				},
				)))),
		);
		const retrySchedule = schedule === undefined ? undefined : schedule.pipe(Schedule.tapOutput(() => inc('retries')));
		const t2 = retrySchedule === undefined ? t1 : t1.pipe(Effect.retry({ schedule: retrySchedule, while: (error) => !_CONFIG.nonRetriable.has((error as { _tag?: string })?._tag ?? '') }));
		const t3 = circuitName === undefined
			? t2
			: Circuit.make(circuitName, { breaker: { _tag: 'consecutive', threshold: configuration.threshold ?? _CONFIG.defaults.threshold } }).pipe(
				Effect.flatMap((circuit) => circuit.execute(t2)),
				Effect.catchAll((error) => Circuit.is(error, 'Cancelled') ? Effect.die(error) : Effect.fail(error)),
			);
		const fallback = configuration.fallback;
		const pipeline = fallback === undefined
			? t3
			: t3.pipe(Effect.catchAll((error) => Circuit.is(error) ? Effect.fail(error) : Effect.zipRight(inc('fallbacks'), fallback(error as E | TimeoutError | BulkheadError))));
		const incrementBulkheadRejection = (error: unknown) => Option.getOrElse(
			Option.liftPredicate(inc('bulkheadRejections'), F.constant(error instanceof BulkheadError)),
			F.constant(Effect.void),
		);
			const withBulkhead = bulkhead === undefined
				? pipeline
				: STM.commit(TMap.get(semStore, bulkheadKey)).pipe(
					Effect.flatMap(Option.match({
						onNone: () => Effect.makeSemaphore(bulkhead).pipe(Effect.tap((sem) => STM.commit(TMap.set(semStore, bulkheadKey, sem)))),
						onSome: Effect.succeed,
					})),
				Effect.flatMap((sem) => {
					const bulkheadError = BulkheadError.of(operation, bulkhead);
					return Effect.acquireUseRelease(
						Match.value(configuration.bulkheadTimeout).pipe(
							Match.when(undefined, () => sem.take(1)),
							Match.orElse((duration) => sem.take(1).pipe(
								Effect.timeoutFail({ duration, onTimeout: F.constant(bulkheadError) }),
								Effect.tapError(incrementBulkheadRejection),
							)),
						),
						F.constant(pipeline),
						() => sem.release(1).pipe(Effect.asVoid),
					);
				}),
				);
		return Telemetry.span(withBulkhead, `resilience.${operation}`, { metrics: false, 'resilience.operation': operation });
	}));

// --- [ENTRY_POINT] -----------------------------------------------------------

const Resilience: Resilience = {
	Bulkhead: BulkheadError,
	Circuit: Circuit.Error,
	current: Circuit.current,
	defaults: _CONFIG.defaults,
	is: ((error: unknown, tag?: 'BulkheadError' | 'CircuitError' | 'TimeoutError') => Match.value(tag).pipe(Match.when('BulkheadError', () => error instanceof BulkheadError), Match.when('CircuitError', () => Circuit.is(error)), Match.when('TimeoutError', () => error instanceof TimeoutError), Match.orElse(() => error instanceof BulkheadError || Circuit.is(error) || error instanceof TimeoutError))) as Resilience['is'],
	Layer: Layer.mergeAll(ResilienceState.Default, Circuit.Layer),
	presets: _CONFIG.presets,
	run: _run,
	schedule: ((presetOrConfig: Resilience.SchedulePreset | Resilience.ScheduleConfig) => Match.value(presetOrConfig).pipe(
		Match.when(Match.string, (preset) => _CONFIG.presets[preset]),
		Match.orElse(_mkSchedule),
	)) as Resilience['schedule'],
	Timeout: TimeoutError,
};

// --- [NAMESPACE] -------------------------------------------------------------

interface Resilience {
	readonly Bulkhead: typeof BulkheadError;
	readonly Circuit: typeof Circuit.Error;
	readonly current: typeof Circuit.current;
	readonly defaults: typeof _CONFIG.defaults;
	readonly is: { (error: unknown): error is Resilience.Error<unknown>; (error: unknown, tag: 'BulkheadError'): error is BulkheadError; (error: unknown, tag: 'CircuitError'): error is Circuit.Error; (error: unknown, tag: 'TimeoutError'): error is TimeoutError };
	readonly Layer: Layer.Layer<Resilience.State>;
	readonly presets: typeof _CONFIG.presets;
	readonly run: <A, E, R>(operation: string, eff: Effect.Effect<A, E, R>, configuration?: Resilience.Config<A, E, R>) => Effect.Effect<A, Resilience.Error<E>, R | Resilience.State>;
	readonly schedule: { (preset: Resilience.SchedulePreset): Schedule.Schedule<unknown, unknown, never>; (config: Resilience.ScheduleConfig): Schedule.Schedule<unknown, unknown, never> };
	readonly Timeout: typeof TimeoutError;
}
namespace Resilience {
	export type TimeoutError = InstanceType<typeof TimeoutError>;
	export type BulkheadError = InstanceType<typeof BulkheadError>;
	export type CircuitError = Circuit.Error;
	export type Error<E> = E | TimeoutError | BulkheadError | CircuitError;
	export type SchedulePreset = keyof typeof _CONFIG.presets;
	export type ScheduleConfig = { readonly base: Duration.DurationInput; readonly cap?: Duration.DurationInput; readonly factor?: number; readonly maxAttempts: number };
	export type RetryMode = SchedulePreset | boolean;
	export type State = ResilienceState | Circuit.State;
	export type Config<A = unknown, E = unknown, R = unknown> = {
		readonly bulkhead?: number | false;
		readonly bulkheadTimeout?: Duration.Duration;
		readonly circuit?: string | false;
		readonly fallback?: (error: E | TimeoutError | BulkheadError) => Effect.Effect<A, never, R>;
		readonly hedge?: number | { readonly attempts: number; readonly delay: Duration.Duration } | false;
		readonly retry?: RetryMode | Schedule.Schedule<unknown, unknown, never> | false;
		readonly threshold?: number;
		readonly timeout?: Duration.Duration | false;
	};
}

// --- [EXPORT] ----------------------------------------------------------------

export { Resilience };
