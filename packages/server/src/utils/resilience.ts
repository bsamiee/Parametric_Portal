/**
 * Resilience: bulkhead -> timeout -> hedge -> retry -> circuit -> fallback -> memo -> span
 * Native Effect APIs: cachedWithTTL (memo), Semaphore (bulkhead), raceAll (hedge)
 */
import { Data, Duration, Effect, Function as F, Layer, Match, Option, Schedule, STM, TMap } from 'effect';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Circuit } from './circuit.ts';
import { unsafeCoerce } from 'effect/Function';

// --- [CONSTANTS] -------------------------------------------------------------

const _mkSchedule = (config: Resilience.ScheduleConfig): Schedule.Schedule<unknown, unknown, never> => {
	const base = Schedule.exponential(config.base, config.factor ?? 2).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(config.maxAttempts)));
	return config.cap === undefined ? base : base.pipe(Schedule.upTo(config.cap));
};
const _CONFIG = {
	defaults: { bulkhead: 10, hedgeDelay: Duration.millis(100), threshold: 5, timeout: Duration.seconds(30) },
	nonRetriable: new Set(['Auth', 'Conflict', 'Forbidden', 'Gone', 'NotFound', 'RateLimit', 'TimeoutError', 'Validation']) as ReadonlySet<string>,
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
		const memoStore = yield* STM.commit(TMap.empty<string, Effect.Effect<unknown, unknown, unknown>>());
		const semStore = yield* STM.commit(TMap.empty<string, Effect.Semaphore>());
		return { memoStore, semStore };
	}),
}) {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _run = <A, E, R>(operation: string, eff: Effect.Effect<A, E, R>, configuration: Resilience.Config<A, E, R> = {}): Effect.Effect<A, Resilience.Error<E>, R | Resilience.State> =>
	ResilienceState.pipe(Effect.flatMap(({ memoStore, semStore }) => {
		const timeout = configuration.timeout === false ? undefined : (configuration.timeout ?? _CONFIG.defaults.timeout);
		const schedule = Match.value(configuration.retry).pipe(Match.when(false, () => undefined), Match.when(Match.string, (key: Resilience.SchedulePreset) => _CONFIG.presets[key]), Match.when(true, () => _CONFIG.presets.default), Match.when(undefined, () => _CONFIG.presets.default), Match.orElse((s) => s));
		const circuitName = configuration.circuit === false ? undefined : (configuration.circuit ?? operation);
		const bulkhead = configuration.bulkhead === false ? undefined : configuration.bulkhead;
		const hedge = Match.value(configuration.hedge).pipe(Match.when(false, () => undefined), Match.when(Match.number, (n) => ({ attempts: Math.max(2, n), delay: _CONFIG.defaults.hedgeDelay })), Match.orElse((h) => h));
		const memoTtl = configuration.memoize === true ? Duration.minutes(5) : configuration.memoize;
		const inc = (key: keyof MetricsService['resilience']) => Effect.flatMap(Effect.serviceOption(MetricsService), Option.match({ onNone: () => Effect.void, onSome: (metrics) => MetricsService.inc(metrics.resilience[key], MetricsService.label({ operation })) }));
		const pipeline = Effect.gen(function* () {
			const t0: Effect.Effect<A, E | TimeoutError, R> = timeout === undefined ? eff : eff.pipe(Effect.timeoutFail({ duration: timeout, onTimeout: () => TimeoutError.of(operation, timeout) }), Effect.tapErrorTag('TimeoutError', () => inc('timeouts')));
			const t1 = Match.value(hedge).pipe(
				Match.when(undefined, F.constant(t0)),
				Match.orElse((h) => Effect.raceAll(Array.from({ length: h.attempts }, (_, index) => Effect.tapBoth(
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
			const t2 = schedule === undefined ? t1 : t1.pipe(Effect.tapError(() => inc('retries')), Effect.retry({ schedule, while: (error) => !_CONFIG.nonRetriable.has((error as { _tag?: string })?._tag ?? '') }));
			const t3 = circuitName === undefined
				? t2
				: Circuit.make(circuitName, { breaker: { _tag: 'consecutive', threshold: configuration.threshold ?? _CONFIG.defaults.threshold } }).pipe(
					Effect.flatMap((circuit) => circuit.execute(t2)),
					Effect.catchAll((error) => Circuit.is(error, 'Cancelled') ? Effect.die(error) : Effect.fail(error)),
				);
			const fallback = configuration.fallback;
			return fallback === undefined
				? yield* t3
				: yield* t3.pipe(Effect.catchAll((error) => Circuit.is(error) ? Effect.fail(error) : Effect.zipRight(inc('fallbacks'), fallback(unsafeCoerce(error)))));
		});
		const withBulkhead = bulkhead === undefined
			? pipeline
			: STM.commit(TMap.get(semStore, operation)).pipe(
				Effect.flatMap(Option.match({
					onNone: () => Effect.makeSemaphore(bulkhead).pipe(Effect.tap((sem) => STM.commit(TMap.set(semStore, operation, sem)))),
					onSome: Effect.succeed,
				})),
				Effect.flatMap((sem) => sem.withPermits(1)(pipeline)),
				(eff) => configuration.bulkheadTimeout === undefined ? eff : eff.pipe(
					Effect.timeoutFail({ duration: configuration.bulkheadTimeout, onTimeout: () => BulkheadError.of(operation, bulkhead) }),
					Effect.tapError((err: unknown) => err instanceof BulkheadError ? inc('bulkheadRejections') : Effect.void),
				),
			);
		const withMemo = memoTtl === undefined
			? withBulkhead
			: STM.commit(TMap.get(memoStore, operation)).pipe(
				Effect.flatMap(Option.match({
					onNone: () => Effect.cachedWithTTL(withBulkhead, memoTtl).pipe(
						Effect.tap((cached) => STM.commit(TMap.set(memoStore, operation, cached as Effect.Effect<unknown, unknown, unknown>))),
						Effect.flatMap((cached) => cached as Effect.Effect<A, Resilience.Error<E>, R>),
					),
					onSome: (cached) => cached as Effect.Effect<A, Resilience.Error<E>, R>,
				})),
			);
		return Telemetry.span(withMemo, `resilience.${operation}`, { metrics: false, 'resilience.operation': operation });
	}));

// --- [ENTRY_POINT] -----------------------------------------------------------

const Resilience: Resilience = Object.assign(
	<A, E, R>(configuration?: Resilience.Config<A, E, R>) => <This, Args extends unknown[]>(
		target: ((this: This, ...args: Args) => Effect.Effect<A, E, R>) | undefined,
		context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Effect.Effect<A, E, R>> | ClassFieldDecoratorContext<This, (this: This, ...args: Args) => Effect.Effect<A, E, R>>,) => {
		const name = String(context.name);
		const wrap = (fn: (this: This, ...args: Args) => Effect.Effect<A, E, R>) => function (this: This, ...args: Args) { return _run(`${(this as { constructor?: { name?: string } })?.constructor?.name ?? 'Anon'}.${name}`, fn.apply(this, args), configuration); };
		return context.kind === 'method' && target ? wrap(target) : (init: (this: This, ...args: Args) => Effect.Effect<A, E, R>) => wrap(init);
	},
	{
		Bulkhead: BulkheadError,
		Circuit: Circuit.Error,
		current: Circuit.current,
		defaults: _CONFIG.defaults,
		is: ((error: unknown, tag?: 'BulkheadError' | 'CircuitError' | 'TimeoutError') => Match.value(tag).pipe(Match.when('BulkheadError', () => error instanceof BulkheadError), Match.when('CircuitError', () => Circuit.is(error)), Match.when('TimeoutError', () => error instanceof TimeoutError), Match.orElse(() => error instanceof BulkheadError || Circuit.is(error) || error instanceof TimeoutError))) as Resilience['is'],
		Layer: Layer.mergeAll(ResilienceState.Default, Circuit.Layer),
		presets: _CONFIG.presets,
		run: _run,
		schedule: ((presetOrConfig: Resilience.SchedulePreset | Resilience.ScheduleConfig) => typeof presetOrConfig === 'string' ? _CONFIG.presets[presetOrConfig] : _mkSchedule(presetOrConfig)) as Resilience['schedule'],
		Timeout: TimeoutError,
	},
);

// --- [NAMESPACE] -------------------------------------------------------------

interface Resilience {
	<A, E, R>(configuration?: Resilience.Config<A, E, R>): <This, Args extends unknown[]>(target: ((this: This, ...args: Args) => Effect.Effect<A, E, R>) | undefined, context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Effect.Effect<A, E, R>> | ClassFieldDecoratorContext<This, (this: This, ...args: Args) => Effect.Effect<A, E, R>>) => ((this: This, ...args: Args) => Effect.Effect<A, Resilience.Error<E>, R | Resilience.State>) | ((init: (this: This, ...args: Args) => Effect.Effect<A, E, R>) => (this: This, ...args: Args) => Effect.Effect<A, Resilience.Error<E>, R | Resilience.State>);
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
		readonly memoize?: Duration.Duration | true;
		readonly retry?: RetryMode | Schedule.Schedule<unknown, unknown, never> | false;
		readonly threshold?: number;
		readonly timeout?: Duration.Duration | false;
	};
}

// --- [EXPORT] ----------------------------------------------------------------

export { Resilience };
