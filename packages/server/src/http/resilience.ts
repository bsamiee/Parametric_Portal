/**
 * Unified resilience module: timeout, retry, fallback, circuit breaker.
 * Cockatiel for circuit breaker state machine; Effect for composition.
 */
import { BrokenCircuitError } from 'cockatiel';
import { Data, Duration, Effect, Option, Schedule } from 'effect';
import { MetricsService } from '../observe/metrics.ts';
import { Circuit } from '../security/circuit.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _schedules = {
	default: Schedule.exponential(Duration.millis(100), 2).pipe(
		Schedule.jittered,
		Schedule.intersect(Schedule.recurs(3)),
		Schedule.upTo(Duration.seconds(10)),
	),
	fast: Schedule.exponential(Duration.millis(50), 1.5).pipe(
		Schedule.jittered,
		Schedule.intersect(Schedule.recurs(2)),
		Schedule.upTo(Duration.seconds(2)),
	),
	slow: Schedule.exponential(Duration.millis(500), 2).pipe(
		Schedule.jittered,
		Schedule.intersect(Schedule.recurs(5)),
		Schedule.upTo(Duration.seconds(30)),
	),
} as const;

// --- [ERRORS] ----------------------------------------------------------------

class TimeoutError extends Data.TaggedError('TimeoutError')<{
	readonly durationMs: number;
	readonly operation: string;
}> {
	override get message() { return `TimeoutError: ${this.operation} exceeded ${this.durationMs}ms`; }
}

// --- [FUNCTIONS] -------------------------------------------------------------

const withTimeout = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	duration: Duration.Duration,
	operation = 'operation',
): Effect.Effect<A, E | TimeoutError, R> =>
	effect.pipe(
		Effect.timeoutFail({
			duration,
			onTimeout: () => new TimeoutError({ durationMs: Duration.toMillis(duration), operation }),
		}),
		Effect.tapError((err) =>
			err instanceof TimeoutError
				? Effect.flatMap(
					Effect.serviceOption(MetricsService),
					Option.match({
						onNone: () => Effect.void,
						onSome: (m) => MetricsService.inc(m.resilience.timeouts, MetricsService.label({ operation })),
					}),
				)
				: Effect.void,
		),
	);

const withRetry = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	schedule: Schedule.Schedule<unknown, E, never> = _schedules.default,
	operation = 'operation',
): Effect.Effect<A, E, R> =>
	effect.pipe(
		Effect.tapError(() =>
			Effect.flatMap(
				Effect.serviceOption(MetricsService),
				Option.match({
					onNone: () => Effect.void,
					onSome: (m) => MetricsService.inc(m.resilience.retries, MetricsService.label({ operation })),
				}),
			),
		),
		Effect.retry(schedule),
	);

const withFallback = <A, E, R, A2, R2>(
	effect: Effect.Effect<A, E, R>,
	fallback: Effect.Effect<A2, never, R2>,
	operation = 'operation',
): Effect.Effect<A | A2, never, R | R2> =>
	Effect.catchAll(effect, (err) => {
		const reason = typeof err === 'object' && err !== null && '_tag' in err ? String(err._tag) : 'unknown';
		return Effect.flatMap(
			Effect.serviceOption(MetricsService),
			Option.match({
				onNone: () => fallback,
				onSome: (m) => Effect.andThen(
					MetricsService.inc(m.resilience.fallbacks, MetricsService.label({ operation, reason })),
					fallback,
				),
			}),
		);
	});

const withCircuit = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	circuitName: string,
	config?: Circuit.Config,
): Effect.Effect<A, E | BrokenCircuitError, R> => {
	const circuit = Circuit.make(circuitName, config);
	return Effect.flatMap(
		Effect.context<R>(),
		(ctx) => circuit.execute(() => Effect.runPromise(Effect.provide(effect, ctx))).pipe(
			Effect.catchIf(Circuit.isCancelled, (err) => Effect.die(err)),
			Effect.mapError((err) => err as E | BrokenCircuitError),
		),
	);
};

const withResilience = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	config?: {
		readonly circuit?: string;
		readonly circuitConfig?: Circuit.Config;
		readonly fallback?: Effect.Effect<A, never, R>;
		readonly operation?: string;
		readonly retry?: Schedule.Schedule<unknown, unknown, never>;
		readonly timeout?: Duration.Duration;
	},
): Effect.Effect<A, E | TimeoutError | BrokenCircuitError | Error, R> => {
	const operation = config?.operation ?? 'operation';
	const withTimeoutApplied = config?.timeout === undefined
		? effect
		: withTimeout(effect, config.timeout, operation);
	const withRetryApplied = config?.retry === undefined
		? withTimeoutApplied
		: withTimeoutApplied.pipe(
			Effect.tapError(() =>
				Effect.flatMap(
					Effect.serviceOption(MetricsService),
					Option.match({
						onNone: () => Effect.void,
						onSome: (m) => MetricsService.inc(m.resilience.retries, MetricsService.label({ operation })),
					}),
				),
			),
			Effect.retry(config.retry),
		);
	const withCircuitApplied = config?.circuit === undefined
		? withRetryApplied
		: withCircuit(withRetryApplied, config.circuit, config.circuitConfig);
	const withFallbackApplied = config?.fallback === undefined
		? withCircuitApplied
		: withFallback(withCircuitApplied, config.fallback, operation);
	return withFallbackApplied as Effect.Effect<A, E | TimeoutError | BrokenCircuitError | Error, R>;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Resilience = {
	BrokenCircuitError,
	defaultRetry: _schedules.default,
	fastRetry: _schedules.fast,
	slowRetry: _schedules.slow,
	TimeoutError,
	withCircuit,
	withFallback,
	withResilience,
	withRetry,
	withTimeout,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Resilience {
	export type BrokenCircuitError = InstanceType<typeof BrokenCircuitError>;
	export type TimeoutError = InstanceType<typeof TimeoutError>;
	export type Config = NonNullable<Parameters<typeof withResilience>[1]>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Resilience };
