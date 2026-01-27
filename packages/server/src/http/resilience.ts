/**
 * Unified resilience module with Effect-native retry, timeout, and fallback composition.
 * Uses cockatiel for circuit breaker (proven state machine), Effect for everything else.
 * Metrics are optional - module works without MetricsService in context.
 */
import { Data, Duration, Effect, Schedule } from 'effect';
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

/** Apply timeout to an effect with typed error */
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
	);

/** Apply retry schedule to an effect */
const withRetry = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	schedule: Schedule.Schedule<unknown, E, never> = _schedules.default,
): Effect.Effect<A, E, R> =>
	Effect.retry(effect, schedule);

/** Apply fallback when effect fails */
const withFallback = <A, E, R, A2, R2>(
	effect: Effect.Effect<A, E, R>,
	fallback: Effect.Effect<A2, never, R2>,
): Effect.Effect<A | A2, never, R | R2> =>
	Effect.catchAll(effect, () => fallback);

/** Execute through a circuit breaker by name - wraps effect in cockatiel circuit breaker */
const withCircuit = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	circuitName: string,
	config?: Circuit.Config,
): Effect.Effect<A, E | CircuitOpenError | Error, R> =>
	Effect.gen(function* () {
		const circuit = Circuit.make(circuitName, config);
		// Execute through circuit breaker - converts BrokenCircuitError to CircuitOpenError
		const result = yield* circuit.execute(
			() => Effect.runPromise(effect as Effect.Effect<A, E, never>),
		).pipe(
			Effect.catchIf(Circuit.isOpen, () => Effect.fail(new CircuitOpenError({ circuit: circuitName }))),
			Effect.catchIf(Circuit.isCancelled, (err) => Effect.die(err)),
		);
		return result;
	});

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
	// Order matters: timeout → retry → circuit → execute
	// Timeout wraps the retried operation so each attempt has same timeout
	// Circuit wraps everything so open circuit short-circuits early

	// Start with the base effect
	const withTimeoutApplied = config?.timeout !== undefined
		? withTimeout(effect, config.timeout, config.operation)
		: effect;

	// Apply retry (wraps timeout - retries on timeout or other errors)
	const withRetryApplied = config?.retry !== undefined
		? Effect.retry(withTimeoutApplied, config.retry)
		: withTimeoutApplied;

	// Apply circuit breaker (outermost - tracks failures across retries)
	const withCircuitApplied = config?.circuit !== undefined
		? withCircuit(withRetryApplied, config.circuit, config.circuitConfig)
		: withRetryApplied;

	// Apply fallback at the very end if provided
	const withFallbackApplied = config?.fallback !== undefined
		? withFallback(withCircuitApplied, config.fallback)
		: withCircuitApplied;

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
