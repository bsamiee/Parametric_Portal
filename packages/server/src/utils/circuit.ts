/**
 * Wrap external calls with circuit breaker resilience.
 * Cockatiel-based, configurable breaker strategies, full metrics integration.
 */
import {
	type BrokenCircuitError, CircuitState, ConsecutiveBreaker, CountBreaker, type FailureReason, type IBackoffFactory, type IBreaker, type IDisposable, type IHalfOpenAfterBackoffContext, type IsolatedCircuitError,
	type Policy, SamplingBreaker, type TaskCancelledError, circuitBreaker, handleAll, isBrokenCircuitError, isIsolatedCircuitError, isTaskCancelledError,
} from 'cockatiel';
import { Array as A, Data, Duration, Effect, type FiberRefs, HashMap, Match, Metric, MutableRef, Option, Ref, Runtime, unsafeCoerce } from 'effect';
import { constant } from 'effect/Function';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	defaults: {
		consecutiveThreshold: 5,
		count: { size: 100, threshold: 0.2 },
		gcIdleMs: 300_000, // 5 minutes
		halfOpenSeconds: 30,
		sampling: { durationSeconds: 30, threshold: 0.2 } },
} as const;

// --- [ERRORS] ----------------------------------------------------------------

class CircuitError extends Data.TaggedError('CircuitError')<{
	readonly circuit: string;
	readonly cause: BrokenCircuitError | Error | IsolatedCircuitError | TaskCancelledError;
	readonly reason: 'BrokenCircuit' | 'Cancelled' | 'ExecutionFailed' | 'Isolated';
}> {
	static readonly fromBroken = 	(circuit: string, cause: BrokenCircuitError) => new CircuitError({ cause, circuit, reason: 'BrokenCircuit' });
	static readonly fromCancelled = (circuit: string, cause: TaskCancelledError) => new CircuitError({ cause, circuit, reason: 'Cancelled' });
	static readonly fromIsolated = 	(circuit: string, cause: IsolatedCircuitError) => new CircuitError({ cause, circuit, reason: 'Isolated' });
	static readonly fromExecution = (circuit: string, cause: Error) => new CircuitError({ cause, circuit, reason: 'ExecutionFailed' });
	override get message() { return `Circuit[${this.circuit}]: ${this.reason} - ${this.cause.message}`; }
}
class _UnknownCause extends Data.TaggedError('CircuitUnknownCause')<{ readonly cause: unknown }> {override get message() { return `CircuitUnknownCause: ${String(this.cause)}`; }}

// --- [SERVICES] --------------------------------------------------------------

class _CircuitState extends Effect.Service<_CircuitState>()('server/CircuitState', {
	scoped: Effect.gen(function* () {
		const registry = yield* Ref.make(HashMap.empty<string, Circuit.Instance>());
		const lastAccess = yield* Ref.make(HashMap.empty<string, number>());
		return { lastAccess, registry };
	}),
}) {}

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
	readonly policy?: Policy; } = {}): Effect.Effect<Circuit.Instance, never, _CircuitState> => _CircuitState.pipe(Effect.flatMap(({ lastAccess, registry }) =>
	Ref.get(registry).pipe(Effect.flatMap((reg) =>
		Option.match((config.persist ?? true) ? HashMap.get(reg, name) : Option.none(), {
			onNone: () => {
				const breaker = Match.value(config.breaker).pipe(
					Match.when(undefined, () => new ConsecutiveBreaker(_CONFIG.defaults.consecutiveThreshold)),
					Match.tag('consecutive', (configuration) => new ConsecutiveBreaker(configuration.threshold ?? _CONFIG.defaults.consecutiveThreshold)),
					Match.tag('count', (configuration) => new CountBreaker({ ...(configuration.minimumNumberOfCalls == null ? {} : { minimumNumberOfCalls: configuration.minimumNumberOfCalls }), size: configuration.size ?? _CONFIG.defaults.count.size, threshold: configuration.threshold ?? _CONFIG.defaults.count.threshold })),
					Match.tag('sampling', (configuration) => new SamplingBreaker({ duration: Duration.toMillis(configuration.duration ?? Duration.seconds(_CONFIG.defaults.sampling.durationSeconds)), ...(configuration.minimumRps == null ? {} : { minimumRps: configuration.minimumRps }), threshold: configuration.threshold ?? _CONFIG.defaults.sampling.threshold })),
					Match.orElse((custom) => custom),
				);
				const halfOpenAfter = config.halfOpenAfter ?? Duration.seconds(_CONFIG.defaults.halfOpenSeconds);
				const policy = circuitBreaker(config.policy ?? handleAll, {
					breaker,
					halfOpenAfter: Duration.isDuration(halfOpenAfter) ? Duration.toMillis(halfOpenAfter) : halfOpenAfter,
					...(config.initialState == null ? {} : { initialState: config.initialState }),
				});
				const userCallback = Option.fromNullable(config.onStateChange);
				const metrics = config.metrics ?? true;
				const stateTracker = MutableRef.make({ current: CircuitState[policy.state], previous: '' });
				const _updateMetric = (metricsService: MetricsService) => Metric.update(Metric.taggedWithLabels(metricsService.circuit.stateChanges, MetricsService.label({ circuit: name })), MutableRef.get(stateTracker).current);
				const disposables: IDisposable[] = [
					policy.onStateChange((newState) => {
						const tracked = MutableRef.updateAndGet(stateTracker, (state) => ({ current: CircuitState[newState], previous: state.current }));
						Effect.runFork(Effect.logWarning(`Circuit[${name}] state change`, { from: tracked.previous, to: tracked.current }));
						Option.isSome(userCallback) && Effect.runFork(userCallback.value({ name, previous: tracked.previous, state: tracked.current }));
						metrics && Effect.runFork(Effect.serviceOption(MetricsService).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: _updateMetric }))));
					}),
					policy.onSuccess(({ duration }) => Effect.runFork(Effect.logDebug(`Circuit[${name}] success`, { durationMs: duration }))),
					policy.onFailure(({ duration, handled }) => Effect.runFork(Effect.logDebug(`Circuit[${name}] failure`, { durationMs: duration, handled }))),
				];
				const _toCircuitError = (err: unknown): CircuitError => Match.value(err).pipe(
					Match.when(isBrokenCircuitError, (error) => CircuitError.fromBroken(name, error)),
					Match.when(isTaskCancelledError, (error) => CircuitError.fromCancelled(name, error)),
					Match.when(isIsolatedCircuitError, (error) => CircuitError.fromIsolated(name, error)),
					Match.orElse((error) => CircuitError.fromExecution(name, error instanceof Error ? error : new _UnknownCause({ cause: error }))),
				);
				const _isCockatielError = (err: unknown): boolean => isBrokenCircuitError(err) || isTaskCancelledError(err) || isIsolatedCircuitError(err);
				const _runViaPolicy = <A, E, R>(
					runtime: Runtime.Runtime<R>,
					fiberRefs: FiberRefs.FiberRefs,
					eff: Effect.Effect<A, E, R>,
					onError: (err: unknown) => E | CircuitError,
				): Effect.Effect<A, E | CircuitError, never> => {
					const mapError = (err: unknown) => _isCockatielError(err) ? _toCircuitError(err) : onError(err);
					const runner = (ctx: { signal: AbortSignal }) => Runtime.runPromise(Runtime.updateFiberRefs(runtime, constant(fiberRefs)), eff, { signal: ctx.signal });
					return Effect.tryPromise({ catch: mapError, try: (signal) => policy.execute(runner, signal) });
				};
				const _circuitContext = () => Option.some({ name, state: MutableRef.get(stateTracker).current });
				const execute = <A, E, R>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E | CircuitError, R> =>
					Ref.update(lastAccess, HashMap.set(name, Date.now())).pipe(
						Effect.zipRight(Context.Request.update({ circuit: _circuitContext() })),
						Effect.zipRight(Effect.all([Effect.runtime<R>(), Effect.getFiberRefs])),
						Effect.flatMap(([runtime, fiberRefs]) => _runViaPolicy<A, E, R>(runtime, fiberRefs, eff, unsafeCoerce)),
						Effect.tap(() => Context.Request.update({ circuit: _circuitContext() })),
					);
				const instance: Circuit.Instance = {
					dispose: () => { A.map(disposables, (disposable) => disposable.dispose()); (config.persist ?? true) && Effect.runFork(Ref.update(registry, HashMap.remove(name))); },
					execute,
					isolate: () => policy.isolate(),
					get lastFailure() { return policy.lastFailure; },
					name,
					get state() { return policy.state; },
					toJSON: () => policy.toJSON(),
				};
				return (config.persist ?? true)
					? Effect.all([Ref.update(registry, HashMap.set(name, instance)), Ref.update(lastAccess, HashMap.set(name, Date.now()))], { discard: true }).pipe(Effect.as(instance))
					: Effect.succeed(instance);
			},
			onSome: Effect.succeed,
		}),
	)),
));
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
	clear: () => _CircuitState.pipe(Effect.flatMap(({ lastAccess, registry }) => Effect.all([Ref.set(registry, HashMap.empty()), Ref.set(lastAccess, HashMap.empty())], { discard: true }),)),
	current,
	Error: CircuitError,
	gc: (maxIdleMs = _CONFIG.defaults.gcIdleMs) => _CircuitState.pipe(
		Effect.flatMap(({ lastAccess, registry }) => Effect.all([Ref.get(registry), Ref.get(lastAccess)]).pipe(
			Effect.flatMap(([_reg, la]) => {
				const now = Date.now();
				const stale = HashMap.filter(la, (ts) => now - ts > maxIdleMs);
				const toRemove = HashMap.keys(stale);
				return Effect.all([
					Ref.update(registry, (r) => HashMap.removeMany(r, toRemove)),
					Ref.update(lastAccess, (l) => HashMap.removeMany(l, toRemove)),
				], { discard: true }).pipe(Effect.as({ removed: HashMap.size(stale) }));
			}),
		)),
	),
	get: (name: string) => _CircuitState.pipe(Effect.flatMap(({ registry }) => Ref.get(registry).pipe(Effect.map((r) => HashMap.get(r, name))))),
	is,
	Layer: _CircuitState.Default,
	make,
	State: _CircuitState,
	stats: () => _CircuitState.pipe(
		Effect.flatMap(({ lastAccess, registry }) => Effect.all([Ref.get(registry), Ref.get(lastAccess)]).pipe(
			Effect.map(([reg, la]) => HashMap.map(reg, (inst, name) => ({
				lastAccess: Option.getOrElse(HashMap.get(la, name), () => 0),
				name,
				state: CircuitState[inst.state],
			}))),
			Effect.map(HashMap.values),
			Effect.map((iter) => Array.from(iter)),
		)),
	),
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Circuit {
	export type Error = InstanceType<typeof CircuitError>;
	export type ErrorReason = Error['reason'];
	export type Config = NonNullable<Parameters<typeof make>[1]>;
	export type State = _CircuitState;
	export type Context = Option.Option.Value<Effect.Effect.Success<typeof current>>;
	export type Stats = { readonly lastAccess: number; readonly name: string; readonly state: string };
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
