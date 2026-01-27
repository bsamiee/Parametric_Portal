/**
 * Unified resilience module with Effect-native retry, timeout, and fallback composition.
 * Uses cockatiel for circuit breaker (proven state machine), Effect for everything else.
 * Metrics are optional - module works without MetricsService in context.
 */
import { Data, Duration, Effect, Metric, Option, Schedule } from 'effect';
import { MetricsService } from '../observe/metrics.ts';
import { Circuit } from '../security/circuit.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _schedules = {
	/** Default: exponential(100ms, 2x) + jitter + max 3 retries + max 10s total */
	default: Schedule.exponential(Duration.millis(100), 2).pipe(
		Schedule.jittered,
		Schedule.intersect(Schedule.recurs(3)),
		Schedule.upTo(Duration.seconds(10)),
	),
	/** Fast: for rate limit retries - shorter delays, fewer attempts */
	fast: Schedule.exponential(Duration.millis(50), 1.5).pipe(
		Schedule.jittered,
		Schedule.intersect(Schedule.recurs(2)),
		Schedule.upTo(Duration.seconds(2)),
	),
	/** Slow: for external API retries (oauth-style) - longer delays, more patience */
	slow: Schedule.exponential(Duration.millis(500), 2).pipe(
		Schedule.jittered,
		Schedule.intersect(Schedule.recurs(5)),
		Schedule.upTo(Duration.seconds(30)),
	),
} as const;

const _metrics = {
	fallbacks: Metric.counter('resilience_fallbacks_total'),
	retries: Metric.counter('resilience_retries_total'),
	timeouts: Metric.counter('resilience_timeouts_total'),
} as const;

// --- [ERRORS] ----------------------------------------------------------------

class TimeoutError extends Data.TaggedError('TimeoutError')<{
	readonly durationMs: number;
	readonly operation: string;
}> {
	override get message() { return `TimeoutError: ${this.operation} exceeded ${this.durationMs}ms`; }
}

class CircuitOpenError extends Data.TaggedError('CircuitOpenError')<{
	readonly circuit: string;
}> {
	override get message() { return `CircuitOpenError: ${this.circuit} is open`; }
}

// --- [FUNCTIONS] -------------------------------------------------------------

/** Apply timeout to an effect with typed error and optional metrics */
const withTimeout = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	duration: Duration.Duration,
	operation = 'operation',
): Effect.Effect<A, E | TimeoutError, R> =>
	Effect.gen(function* () {
		const metricsOpt = yield* Effect.serviceOption(MetricsService);
		const result = yield* effect.pipe(
			Effect.timeoutFail({
				duration,
				onTimeout: () => new TimeoutError({ durationMs: Duration.toMillis(duration), operation }),
			}),
			Effect.tapError((err) =>
				err instanceof TimeoutError && Option.isSome(metricsOpt)
					? MetricsService.inc(_metrics.timeouts, MetricsService.label({ operation }))
					: Effect.void,
			),
		);
		return result;
	});

/** Apply retry schedule to an effect with optional metrics on each retry */
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
					onSome: () => MetricsService.inc(_metrics.retries, MetricsService.label({ operation })),
				}),
			),
		),
		Effect.retry(schedule),
	);

/** Apply fallback when effect fails with optional metrics */
const withFallback = <A, E, R, A2, R2>(
	effect: Effect.Effect<A, E, R>,
	fallback: Effect.Effect<A2, never, R2>,
	operation = 'operation',
): Effect.Effect<A | A2, never, R | R2> =>
	Effect.catchAll(effect, (err) =>
		Effect.gen(function* () {
			const metricsOpt = yield* Effect.serviceOption(MetricsService);
			const reason = typeof err === 'object' && err !== null && '_tag' in err ? String(err._tag) : 'unknown';
			yield* Option.isSome(metricsOpt)
				? MetricsService.inc(_metrics.fallbacks, MetricsService.label({ operation, reason }))
				: Effect.void;
			return yield* fallback;
		}),
	);

/** Execute through a circuit breaker by name - wraps effect in cockatiel circuit breaker */
const withCircuit = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	circuitName: string,
	config?: Circuit.Config,
): Effect.Effect<A, E | CircuitOpenError, R> => {
	const circuit = Circuit.make(circuitName, config);
	// Circuit.execute expects a function returning PromiseLike, and returns Effect
	// We run our effect via runPromise, then handle circuit errors
	return Effect.flatMap(
		Effect.context<R>(),
		(ctx) => circuit.execute(() => Effect.runPromise(Effect.provide(effect, ctx))).pipe(
			Effect.catchIf(Circuit.isOpen, () => Effect.fail(new CircuitOpenError({ circuit: circuitName }))),
			Effect.catchIf(Circuit.isCancelled, (err) => Effect.die(err)),
			Effect.mapError((err) => err as E | CircuitOpenError),
		),
	);
};

/** Unified resilience wrapper - applies timeout, retry, circuit breaker, and fallback in optimal order */
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
): Effect.Effect<A, E | TimeoutError | CircuitOpenError | Error, R> => {
	const operation = config?.operation ?? 'operation';

	// Order matters: timeout → retry → circuit → execute
	// Timeout wraps the retried operation so each attempt has same timeout
	// Circuit wraps everything so open circuit short-circuits early

	// Start with the base effect
	const withTimeoutApplied = config?.timeout === undefined
		? effect
		: withTimeout(effect, config.timeout, operation);

	// Apply retry with metrics (wraps timeout - retries on timeout or other errors)
	const retrySchedule = config?.retry;
	const withRetryApplied = retrySchedule === undefined
		? withTimeoutApplied
		: withTimeoutApplied.pipe(
			Effect.tapError(() =>
				Effect.flatMap(
					Effect.serviceOption(MetricsService),
					Option.match({
						onNone: () => Effect.void,
						onSome: () => MetricsService.inc(_metrics.retries, MetricsService.label({ operation })),
					}),
				),
			),
			Effect.retry(retrySchedule),
		);

	// Apply circuit breaker (outermost - tracks failures across retries)
	const withCircuitApplied = config?.circuit === undefined
		? withRetryApplied
		: withCircuit(withRetryApplied, config.circuit, config.circuitConfig);

	// Apply fallback with metrics at the very end if provided
	const withFallbackApplied = config?.fallback === undefined
		? withCircuitApplied
		: withFallback(withCircuitApplied, config.fallback, operation);

	return withFallbackApplied as Effect.Effect<A, E | TimeoutError | CircuitOpenError | Error, R>;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Resilience = {
	// Errors
	CircuitOpenError,

	// Re-export Circuit for convenience
	circuit: Circuit.make,

	// Pre-built schedules
	defaultRetry: _schedules.default,
	fastRetry: _schedules.fast,
	slowRetry: _schedules.slow,
	TimeoutError,

	// Primitives
	withCircuit,
	withFallback,
	withResilience,
	withRetry,
	withTimeout,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Resilience {
	export type TimeoutError = InstanceType<typeof TimeoutError>;
	export type CircuitOpenError = InstanceType<typeof CircuitOpenError>;
	export type Config = NonNullable<Parameters<typeof withResilience>[1]>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Resilience };
