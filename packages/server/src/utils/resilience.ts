/**
 * Unified resilience: timeout, retry, circuit breaker, fallback.
 * Single entry point (wrap) composing all patterns with automatic metrics.
 *
 * Usage: Resilience.wrap(effect, { timeout, retry, circuit, fallback, operation })
 */
import { Data, Duration, Effect, Match, Option, Schedule } from 'effect';
import { MetricsService } from '../observe/metrics.ts';
import { Circuit } from './circuit.ts';

// --- [ERRORS] ----------------------------------------------------------------

class TimeoutError extends Data.TaggedError('TimeoutError')<{
	readonly durationMs: number;
	readonly operation: string;
}> {override get message() {return `TimeoutError: ${this.operation} exceeded ${this.durationMs}ms`;}}

// --- [CONSTANTS] -------------------------------------------------------------

const _NON_RETRIABLE = new Set(['Auth', 'Validation', 'NotFound', 'Forbidden', 'Conflict', 'Gone']);
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

// --- [SERVICES] --------------------------------------------------------------

const wrap = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	config?: {
		readonly circuit?: string | { readonly name: string; readonly config?: Circuit.Config };
		readonly fallback?: Effect.Effect<A, never, R>;
		readonly operation?: string;
		readonly retry?: Resilience.RetryMode | Schedule.Schedule<unknown, unknown, never>;
		readonly timeout?: Duration.Duration;
	},
): Effect.Effect<A, Resilience.Error<E>, R> => {
	const operation = config?.operation ?? 'operation';
	// Timeout
	const to = config?.timeout;
	const withTimeout: Effect.Effect<A, E | TimeoutError, R> = to === undefined
		? effect
		: effect.pipe(
				Effect.timeoutFail({
					duration: to,
					onTimeout: () => new TimeoutError({ durationMs: Duration.toMillis(to), operation }),
				}),
				Effect.tapErrorTag('TimeoutError', () =>
					Effect.flatMap(Effect.serviceOption(MetricsService), (opt) =>
						Option.match(opt, {
							onNone: () => Effect.void,
							onSome: (m) => MetricsService.inc(m.resilience.timeouts, MetricsService.label({ operation })),
						}),
					),
				),
			);
	// Retry (resolve schedule inline)
	const schedule = Match.value(config?.retry).pipe(
		Match.when(undefined, () => undefined),
		Match.when(false, () => undefined),
		Match.when(true, () => _schedules.default),
		Match.when('fast', () => _schedules.fast),
		Match.when('slow', () => _schedules.slow),
		Match.orElse((s) => s),
	);
	const withRetry: Effect.Effect<A, E | TimeoutError, R> = schedule === undefined
		? withTimeout
		: withTimeout.pipe(
				Effect.tapError(() =>
					Effect.flatMap(Effect.serviceOption(MetricsService), (opt) =>
						Option.match(opt, {
							onNone: () => Effect.void,
							onSome: (m) => MetricsService.inc(m.resilience.retries, MetricsService.label({ operation })),
						}),
					),
				),
				Effect.retry({
					schedule,
					while: (err) => {
						const tag = (err as { _tag?: string })?._tag;
						return tag === undefined || !_NON_RETRIABLE.has(tag);
					},
				}),
			);
	// Circuit breaker (Note: Circuit tracks its own state metrics)
	const withCircuit: Effect.Effect<A, Resilience.Error<E>, R> = config?.circuit === undefined
		? withRetry
		: (() => {
				const { name, circuitConfig } = typeof config.circuit === 'string'
					? { circuitConfig: undefined, name: config.circuit }
					: { circuitConfig: config.circuit.config, name: config.circuit.name };
				const circuit = Circuit.make(name, circuitConfig);
				return circuit.execute(withRetry).pipe(
					Effect.catchIf((e) => Circuit.is(e, 'Cancelled'), (err) => Effect.die(err)),
				);
			})();
	// Fallback
	const fb = config?.fallback;
	const withFallback: Effect.Effect<A, Resilience.Error<E>, R> = fb === undefined
		? withCircuit
		: Effect.catchAll(withCircuit, (err) =>
				Effect.flatMap(Effect.serviceOption(MetricsService), (opt) =>
					Option.match(opt, {
						onNone: () => fb,
						onSome: (m) =>
							Effect.andThen(
								MetricsService.inc(
									m.resilience.fallbacks,
									MetricsService.label({ operation, reason: (err as { _tag?: string })?._tag ?? 'unknown' }),
								),
								fb,
							),
					}),
				),
			);
	return withFallback;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Resilience = { TimeoutError, wrap } as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Resilience {
	export type TimeoutError = InstanceType<typeof TimeoutError>;
	export type CircuitError = Circuit.Error;
	export type RetryMode = boolean | 'fast' | 'slow';
	export type Config<A, E, R> = NonNullable<Parameters<typeof wrap<A, E, R>>[1]>;
	export type Error<E> = E | TimeoutError | CircuitError;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Resilience };
