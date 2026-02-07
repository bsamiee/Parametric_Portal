/**
 * Effect-native circuit breaker with registry, metrics, and GC.
 * Replaces cockatiel — all state managed via Ref, no Promise bridge.
 */
import { Array as A, Data, Duration, Effect, HashMap, Match, Metric, MutableRef, Option, Ref } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [TYPES] -----------------------------------------------------------------

type _BreakerState = 'Closed' | 'HalfOpen' | 'Open';
type _BreakerConfig =
	| { readonly _tag: 'consecutive'; readonly threshold?: number }
	| { readonly _tag: 'count'; readonly minimumNumberOfCalls?: number; readonly size?: number; readonly threshold?: number }
	| { readonly _tag: 'sampling'; readonly duration?: Duration.Duration; readonly minimumRps?: number; readonly threshold?: number };
type _InternalState = {
	readonly failureCount: number;
	readonly failures: ReadonlyArray<number>;
	readonly lastFailureAt: number;
	readonly state: _BreakerState;
	readonly successCount: number;
	readonly totalCount: number;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	defaults: {
		consecutiveThreshold: 5,
		count: { size: 100, threshold: 0.2 },
		gcIdleMs: 300_000,
		halfOpenSeconds: 30,
		sampling: { durationSeconds: 30, threshold: 0.2 },
	},
} as const;
const _INITIAL_STATE: _InternalState = {
	failureCount: 0,
	failures: [],
	lastFailureAt: 0,
	state: 'Closed',
	successCount: 0,
	totalCount: 0,
} as const;
const current = Context.Request.current.pipe(Effect.map((requestContext) => requestContext.circuit));

// --- [ERRORS] ----------------------------------------------------------------

class CircuitError extends Data.TaggedError('CircuitError')<{
	readonly circuit: string;
	readonly cause: Error;
	readonly reason: 'BrokenCircuit' | 'Cancelled' | 'ExecutionFailed' | 'Isolated';
}> {
	static readonly broken = (circuit: string) => new CircuitError({ cause: new Error('Circuit is open'), circuit, reason: 'BrokenCircuit' });
	static readonly isolated = (circuit: string) => new CircuitError({ cause: new Error('Circuit is isolated'), circuit, reason: 'Isolated' });
	static readonly execution = (circuit: string, cause: Error) => new CircuitError({ cause, circuit, reason: 'ExecutionFailed' });
	override get message() { return `Circuit[${this.circuit}]: ${this.reason} - ${this.cause.message}`; }
}
// --- [SERVICES] --------------------------------------------------------------

class _CircuitState extends Effect.Service<_CircuitState>()('server/CircuitState', {
	scoped: Effect.gen(function* () {
		const registry = yield* Ref.make(HashMap.empty<string, Circuit.Instance>());
		const lastAccess = yield* Ref.make(HashMap.empty<string, number>());
		return { lastAccess, registry };
	}),
}) {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _shouldTrip = (breaker: _BreakerConfig, internal: _InternalState): boolean =>
	Match.value(breaker).pipe(
		Match.tag('consecutive', (configuration) => internal.failureCount >= (configuration.threshold ?? _CONFIG.defaults.consecutiveThreshold)),
		Match.tag('count', (configuration) => {
			const size = configuration.size ?? _CONFIG.defaults.count.size;
			const threshold = configuration.threshold ?? _CONFIG.defaults.count.threshold;
			const minimum = configuration.minimumNumberOfCalls ?? 0;
			return internal.totalCount >= Math.max(size, minimum) && internal.failureCount / internal.totalCount >= threshold;
		}),
		Match.tag('sampling', (configuration) => {
			const threshold = configuration.threshold ?? _CONFIG.defaults.sampling.threshold;
			const windowMs = Duration.toMillis(configuration.duration ?? Duration.seconds(_CONFIG.defaults.sampling.durationSeconds));
			const now = Date.now();
			const recentFailures = A.filter(internal.failures, (timestamp) => now - timestamp <= windowMs);
			const minimum = configuration.minimumRps ?? 0;
			return internal.totalCount >= minimum && recentFailures.length / Math.max(internal.totalCount, 1) >= threshold;
		}),
		Match.exhaustive,
	);
const _recordSuccess = (internal: _InternalState): _InternalState => ({
	...internal,
	failureCount: 0,
	state: 'Closed',
	successCount: internal.successCount + 1,
	totalCount: internal.totalCount + 1,
});
const _recordFailure = (internal: _InternalState, breaker: _BreakerConfig): _InternalState => {
	const now = Date.now();
	const updated: _InternalState = {
		...internal,
		failureCount: internal.failureCount + 1,
		failures: [...internal.failures, now],
		lastFailureAt: now,
		totalCount: internal.totalCount + 1,
	};
	return _shouldTrip(breaker, updated) ? { ...updated, state: 'Open' } : updated;
};
const _resolveState = (internal: _InternalState, halfOpenAfterMs: number): _BreakerState =>
	internal.state === 'Open' && Date.now() - internal.lastFailureAt >= halfOpenAfterMs
		? 'HalfOpen'
		: internal.state;
const make = (name: string, config: {
	readonly breaker?: _BreakerConfig;
	readonly halfOpenAfter?: Duration.Duration;
	readonly metrics?: boolean;
	readonly onStateChange?: (change: { readonly name: string; readonly previous: string; readonly state: string }) => Effect.Effect<void, never, never>;
	readonly persist?: boolean;
} = {}): Effect.Effect<Circuit.Instance, never, _CircuitState> => _CircuitState.pipe(Effect.flatMap(({ lastAccess, registry }) =>
	Ref.get(registry).pipe(Effect.flatMap((reg) =>
		Option.match((config.persist ?? true) ? HashMap.get(reg, name) : Option.none(), {
			onNone: () => Effect.gen(function* () {
				const breaker: _BreakerConfig = config.breaker ?? { _tag: 'consecutive' };
				const halfOpenAfterMs = Duration.toMillis(config.halfOpenAfter ?? Duration.seconds(_CONFIG.defaults.halfOpenSeconds));
				const stateRef = yield* Ref.make<_InternalState>(_INITIAL_STATE);
				const isolatedRef = yield* Ref.make(false);
				const userCallback = Option.fromNullable(config.onStateChange);
				const metrics = config.metrics ?? true;
				const stateTracker = MutableRef.make({ current: 'Closed' as string, previous: '' });
				const _notifyStateChange = (previous: string, current: string): Effect.Effect<void> =>
					Effect.gen(function* () {
						MutableRef.set(stateTracker, { current, previous });
						yield* Effect.logWarning(`Circuit[${name}] state change`, { from: previous, to: current });
						yield* Option.isSome(userCallback)
							? userCallback.value({ name, previous, state: current })
							: Effect.void;
						yield* metrics
							? Effect.flatMap(Effect.serviceOption(MetricsService), Option.match({
								onNone: () => Effect.void,
								onSome: (metricsService) => Metric.update(Metric.taggedWithLabels(metricsService.circuit.stateChanges, MetricsService.label({ circuit: name })), current),
							}))
							: Effect.void;
					});
				const _circuitContext = (): Option.Option<{ readonly name: string; readonly state: string }> =>
					Option.some({ name, state: MutableRef.get(stateTracker).current });
				const execute = <A, E, R>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E | CircuitError, R> =>
					Effect.gen(function* () {
						yield* Ref.update(lastAccess, HashMap.set(name, Date.now()));
						yield* Context.Request.update({ circuit: _circuitContext() });
						const isolated = yield* Ref.get(isolatedRef);
						yield* isolated ? Effect.fail(CircuitError.isolated(name)) : Effect.void;
						const internal = yield* Ref.get(stateRef);
						const effectiveState = _resolveState(internal, halfOpenAfterMs);
						const previousLabel = MutableRef.get(stateTracker).current;
						yield* effectiveState === internal.state
							? Effect.void
							: Ref.update(stateRef, (state) => ({ ...state, state: effectiveState }));
						yield* effectiveState === previousLabel
							? Effect.void
							: _notifyStateChange(previousLabel, effectiveState);
						yield* effectiveState === 'Open' ? Effect.fail(CircuitError.broken(name)) : Effect.void;
						const result = yield* eff.pipe(
							Effect.tap(() => Effect.gen(function* () {
								const before = yield* Ref.get(stateRef);
								yield* Ref.set(stateRef, _recordSuccess(before));
								yield* before.state === 'Closed'
									? Effect.void
									: _notifyStateChange(before.state, 'Closed');
								yield* Effect.logDebug(`Circuit[${name}] success`);
							})),
							Effect.tapError(() => Effect.gen(function* () {
								const before = yield* Ref.get(stateRef);
								const after = _recordFailure(before, breaker);
								yield* Ref.set(stateRef, after);
								yield* after.state === before.state
									? Effect.void
									: _notifyStateChange(before.state, after.state);
								yield* Effect.logDebug(`Circuit[${name}] failure`);
							})),
						);
						yield* Context.Request.update({ circuit: _circuitContext() });
						return result;
					}).pipe(Telemetry.span('circuit.execute', { 'circuit.name': name, metrics: false }));
				const instance: Circuit.Instance = {
					dispose: () => { (config.persist ?? true) && Effect.runFork(Ref.update(registry, HashMap.remove(name))); },
					execute,
					isolate: () => { Effect.runFork(Ref.set(isolatedRef, true)); return { dispose: () => { Effect.runFork(Ref.set(isolatedRef, false)); } }; },
					name,
					get state() { return MutableRef.get(stateTracker).current as _BreakerState; },
					toJSON: () => ({ name, state: MutableRef.get(stateTracker).current }),
				};
				yield* (config.persist ?? true)
					? Effect.all([Ref.update(registry, HashMap.set(name, instance)), Ref.update(lastAccess, HashMap.set(name, Date.now()))], { discard: true })
					: Effect.void;
				return instance;
			}),
			onSome: Effect.succeed,
		}),
	)),
));
function is(err: unknown): err is CircuitError;
function is<R extends CircuitError['reason']>(err: unknown, reason: R): err is CircuitError & { readonly reason: R };
function is(err: unknown, reason?: CircuitError['reason']): boolean {
	const matched = err instanceof CircuitError || (typeof err === 'object' && err !== null && '_tag' in err && err._tag === 'CircuitError');
	return matched && (reason === undefined || (err as CircuitError).reason === reason);
}

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Circuit = {
	clear: () => _CircuitState.pipe(Effect.flatMap(({ lastAccess, registry }) => Effect.all([Ref.set(registry, HashMap.empty()), Ref.set(lastAccess, HashMap.empty())], { discard: true }))),
	current,
	Error: CircuitError,
	gc: (maxIdleMs = _CONFIG.defaults.gcIdleMs) => _CircuitState.pipe(
		Effect.flatMap(({ lastAccess, registry }) => Effect.all([Ref.get(registry), Ref.get(lastAccess)]).pipe(
			Effect.flatMap(([_reg, la]) => {
				const now = Date.now();
				const stale = HashMap.filter(la, (timestamp) => now - timestamp > maxIdleMs);
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
			Effect.map(([reg, la]) => HashMap.map(reg, (inst, circuitName) => ({
				lastAccess: Option.getOrElse(HashMap.get(la, circuitName), () => 0),
				name: circuitName,
				state: inst.state,
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
		readonly isolate: () => { readonly dispose: () => void };
		readonly name: string;
		readonly state: _BreakerState;
		readonly toJSON: () => unknown;
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { Circuit };
