/**
 * Wrap external calls with circuit breaker resilience.
 * Cockatiel-based; configurable breaker strategies with full metrics integration.
 * Circuit state tracked via RequestContext.circuit when available.
 * Instance exposes: execute, isolate, toJSON, state, lastFailure, dispose
 * Events wired to metrics: break, reset, halfOpen, success, failure
 */
import {
	type BrokenCircuitError, CircuitState, ConsecutiveBreaker, CountBreaker, type FailureReason, type IBackoffFactory, type IBreaker,
	type IDisposable, type IHalfOpenAfterBackoffContext, type IsolatedCircuitError, type Policy, SamplingBreaker,
	type TaskCancelledError, circuitBreaker, handleAll, isBrokenCircuitError, isIsolatedCircuitError, isTaskCancelledError,
} from 'cockatiel';
import { Data, Duration, Effect, Match, Metric, Option } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';

// --- [ERRORS] ----------------------------------------------------------------

class CircuitError extends Data.TaggedError('CircuitError')<{
	readonly circuit: string;
	readonly cause: BrokenCircuitError | Error | IsolatedCircuitError | TaskCancelledError;
	readonly reason: 'BrokenCircuit' | 'Cancelled' | 'ExecutionFailed' | 'Isolated';
}> {
	static readonly fromBroken = (circuit: string, cause: BrokenCircuitError) => new CircuitError({ cause, circuit, reason: 'BrokenCircuit' });
	static readonly fromCancelled = (circuit: string, cause: TaskCancelledError) => new CircuitError({ cause, circuit, reason: 'Cancelled' });
	static readonly fromIsolated = (circuit: string, cause: IsolatedCircuitError) => new CircuitError({ cause, circuit, reason: 'Isolated' });
	static readonly fromExecution = (circuit: string, cause: Error) => new CircuitError({ cause, circuit, reason: 'ExecutionFailed' });
	override get message() { return `Circuit[${this.circuit}]: ${this.reason} - ${this.cause.message}`; }
}

// --- [CONSTANTS] -------------------------------------------------------------

const _CIRCUIT_CONFIG = {
	defaults: {
		consecutiveThreshold: 5,
		count: { size: 100, threshold: 0.2 },
		halfOpenSeconds: 30,
		sampling: { durationSeconds: 30, threshold: 0.2 } },
} as const;
const _registry = new Map<string, Circuit.Instance>();

// --- [FUNCTIONS] -------------------------------------------------------------

const make = (name: string, config: {
	readonly breaker?:
		| IBreaker
		| { readonly _tag: 'consecutive'; readonly threshold?: number }
		| { readonly _tag: 'count'; readonly minimumNumberOfCalls?: number; readonly size?: number; readonly threshold?: number }
		| { readonly _tag: 'sampling'; readonly duration?: Duration.Duration; readonly minimumRps?: number; readonly threshold?: number };
	readonly halfOpenAfter?: Duration.Duration | IBackoffFactory<IHalfOpenAfterBackoffContext>;
	readonly initialState?: unknown;
	readonly metrics?: boolean;
	readonly onStateChange?: (change: { readonly name: string; readonly previous: string; readonly state: string }) => Effect.Effect<void, never, never>;
	readonly persist?: boolean;
	readonly policy?: Policy; } = {}): Circuit.Instance => {
	const persist = config.persist ?? true;
	const cached = persist ? _registry.get(name) : undefined;
	if (cached) return cached;
	const breaker = Match.value(config.breaker).pipe(
		Match.when(undefined, () => new ConsecutiveBreaker(_CIRCUIT_CONFIG.defaults.consecutiveThreshold)),
		Match.tag('consecutive', (cfg) => new ConsecutiveBreaker(cfg.threshold ?? _CIRCUIT_CONFIG.defaults.consecutiveThreshold)),
		Match.tag('count', (cfg) => new CountBreaker({ ...(cfg.minimumNumberOfCalls == null ? {} : { minimumNumberOfCalls: cfg.minimumNumberOfCalls }), size: cfg.size ?? _CIRCUIT_CONFIG.defaults.count.size, threshold: cfg.threshold ?? _CIRCUIT_CONFIG.defaults.count.threshold })),
		Match.tag('sampling', (cfg) => new SamplingBreaker({ duration: Duration.toMillis(cfg.duration ?? Duration.seconds(_CIRCUIT_CONFIG.defaults.sampling.durationSeconds)), ...(cfg.minimumRps == null ? {} : { minimumRps: cfg.minimumRps }), threshold: cfg.threshold ?? _CIRCUIT_CONFIG.defaults.sampling.threshold })),
		Match.orElse((custom) => custom),
	);
	const halfOpenAfter = config.halfOpenAfter ?? Duration.seconds(_CIRCUIT_CONFIG.defaults.halfOpenSeconds);
	const policy = circuitBreaker(config.policy ?? handleAll, {
		breaker,
		halfOpenAfter: Duration.isDuration(halfOpenAfter) ? Duration.toMillis(halfOpenAfter) : halfOpenAfter,
		...(config.initialState == null ? {} : { initialState: config.initialState }),
	});
	const userCallback = Option.fromNullable(config.onStateChange);
	const metrics = config.metrics ?? true;
	const stateTracker = { current: CircuitState[policy.state], previous: '' };
	const disposables: IDisposable[] = [
		policy.onStateChange((newState) => {
			stateTracker.previous = stateTracker.current;
			stateTracker.current = CircuitState[newState];
			Effect.runFork(Effect.logWarning(`Circuit[${name}] state change`, { from: stateTracker.previous, to: stateTracker.current }));
			Option.isSome(userCallback) && Effect.runFork(userCallback.value({ name, previous: stateTracker.previous, state: stateTracker.current }));
			metrics && Effect.runFork(Effect.serviceOption(MetricsService).pipe(
				Effect.flatMap((opt) => Option.match(opt, {
					onNone: () => Effect.void,
					onSome: (m) => Metric.update(Metric.taggedWithLabels(m.circuit.stateChanges, MetricsService.label({ circuit: name })), stateTracker.current),
				})),
			));
		}),
		policy.onSuccess(({ duration }) => Effect.runFork(Effect.logDebug(`Circuit[${name}] success`, { durationMs: duration }))),
		policy.onFailure(({ duration, handled }) => Effect.runFork(Effect.logDebug(`Circuit[${name}] failure`, { durationMs: duration, handled }))),
	];
	const _toCircuitError = (err: unknown): CircuitError => Match.value(err).pipe(
		Match.when(isBrokenCircuitError, (e) => CircuitError.fromBroken(name, e)),
		Match.when(isTaskCancelledError, (e) => CircuitError.fromCancelled(name, e)),
		Match.when(isIsolatedCircuitError, (e) => CircuitError.fromIsolated(name, e)),
		Match.orElse((e) => CircuitError.fromExecution(name, e instanceof Error ? e : new Error(String(e)))),
	);
	const _isCockatielError = (err: unknown): boolean => isBrokenCircuitError(err) || isTaskCancelledError(err) || isIsolatedCircuitError(err);
	const _runViaPolicy = <A, E>(
		fn: (signal: AbortSignal) => Promise<A>,
		onError: (err: unknown) => E | CircuitError,
	): Effect.Effect<A, E | CircuitError, never> =>
		Effect.async<A, E | CircuitError, never>((resume, signal) => {
			policy.execute(({ signal: policySignal }) => fn(policySignal), signal)
				.then((a) => resume(Effect.succeed(a)))
				.catch((err) => resume(Effect.fail(_isCockatielError(err) ? _toCircuitError(err) : onError(err))));
		});
	const execute = <A, E, R>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E | CircuitError, R> =>
		Effect.gen(function* () {
			yield* Context.Request.update({ circuit: Option.some({ name, state: stateTracker.current }) });
			const ctx = yield* Effect.context<R>();
			const result = yield* _runViaPolicy<A, E>(
				() => Effect.runPromise(Effect.provide(eff, ctx)),
				(err) => err as E,
			);
			yield* Context.Request.update({ circuit: Option.some({ name, state: stateTracker.current }) });
			return result;
		});
	const instance: Circuit.Instance = {
		dispose: () => { disposables.forEach((d) => { d.dispose(); }); persist && _registry.delete(name); },
		execute,
		isolate: () => policy.isolate(),
		get lastFailure() { return policy.lastFailure; },
		name,
		get state() { return policy.state; },
		toJSON: () => policy.toJSON(),
	};
	persist && _registry.set(name, instance);
	return instance;
};
const current = Context.Request.current.pipe(Effect.map((ctx) => ctx.circuit));
function is(err: unknown): err is CircuitError;
function is<R extends CircuitError['reason']>(err: unknown, reason: R): err is CircuitError & { readonly reason: R };
function is(err: unknown, reason?: CircuitError['reason']): boolean {
	const match = err instanceof CircuitError || (typeof err === 'object' && err !== null && '_tag' in err && err._tag === 'CircuitError');
	return match && (reason === undefined || (err as CircuitError).reason === reason);
}

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Circuit = {
	clear: () => _registry.clear(),
	current,
	Error: CircuitError,
	get: (name: string) => Option.fromNullable(_registry.get(name)),
	is,
	make,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Circuit {
	export type Error = InstanceType<typeof CircuitError>;
	export type ErrorReason = Error['reason'];
	export type Config = NonNullable<Parameters<typeof make>[1]>;
	export type Context = Option.Option.Value<Effect.Effect.Success<typeof current>>;
	export interface Instance {
		readonly dispose: () => void;
		readonly execute: <A, E, R>(eff: Effect.Effect<A, E, R>) => Effect.Effect<A, E | Error, R>;
		readonly isolate: () => IDisposable;
		readonly lastFailure: FailureReason<unknown> | undefined;
		readonly name: string;
		readonly state: CircuitState;
		readonly toJSON: () => unknown;
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { Circuit };
