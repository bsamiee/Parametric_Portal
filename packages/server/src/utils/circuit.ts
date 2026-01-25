/**
 * Wrap external calls with circuit breaker resilience.
 * Cockatiel-based; configurable breaker strategies with metrics integration.
 * Circuit state tracked via RequestContext.circuit when available.
 */
import {
	BrokenCircuitError, CircuitState, ConsecutiveBreaker, CountBreaker, SamplingBreaker, TaskCancelledError, circuitBreaker,
	handleAll, handleType, isBrokenCircuitError, isTaskCancelledError, type CircuitBreakerPolicy, type IBackoffFactory,
	type IBreaker, type IDefaultPolicyContext, type IHalfOpenAfterBackoffContext, type Policy
} from 'cockatiel';
import { Duration, Effect, Match, Metric, Option } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../infra/metrics.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CIRCUIT_CONFIG = {
	defaults: {
		consecutiveThreshold: 5,
		count: { size: 100, threshold: 0.2 },
		halfOpenSeconds: 30,
		sampling: { durationSeconds: 30, threshold: 0.2 } },
} as const;
const _registry = new Map<string, {
	readonly execute: <A>(fn: (context: IDefaultPolicyContext) => PromiseLike<A> | A, signal?: AbortSignal) => Effect.Effect<A, BrokenCircuitError | TaskCancelledError | Error>;
	readonly name: string;
	readonly policy: CircuitBreakerPolicy;
}>();

// --- [FUNCTIONS] -------------------------------------------------------------

const make = (name: string, config: {
	readonly breaker?:
		| IBreaker
		| { readonly _tag: 'consecutive'; readonly threshold?: number }
		| { readonly _tag: 'count'; readonly minimumNumberOfCalls?: number; readonly size?: number; readonly threshold?: number }
		| { readonly _tag: 'sampling'; readonly duration?: Duration.Duration; readonly minimumRps?: number; readonly threshold?: number };
	readonly halfOpenAfter?: Duration.Duration | IBackoffFactory<IHalfOpenAfterBackoffContext>;
	readonly initialState?: unknown;
	readonly onStateChange?: (change: { readonly error?: unknown; readonly name: string; readonly previous: CircuitState; readonly state: CircuitState }) => Effect.Effect<void, never, never>;
	readonly persist?: boolean;
	readonly policy?: Policy; } = {}) => {
	const persist = config.persist ?? true;
	return (persist ? _registry.get(name) : undefined) ?? (() => {
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
		const onStateChange = Option.fromNullable(config.onStateChange);
		const execute = <A>(fn: (context: IDefaultPolicyContext) => PromiseLike<A> | A, signal?: AbortSignal): Effect.Effect<A, BrokenCircuitError | TaskCancelledError | Error> =>
			Effect.gen(function* () {
				const metrics = yield* Effect.serviceOption(MetricsService);
				const before = policy.state;
				yield* Context.Request.update({ circuit: Option.some({ name, state: before }) });
				const exit = yield* Effect.tryPromise({ catch: (err: unknown) => err instanceof Error ? err : new Error(String(err)), try: (abortSignal) => policy.execute(fn, signal ?? abortSignal) }).pipe(Effect.exit);
				const after = policy.state;
				const error = exit._tag === 'Failure' ? exit.cause : undefined;
				const attemptedHalfOpen = before === CircuitState.Open && !(error instanceof BrokenCircuitError);
				const transitions = [...(attemptedHalfOpen ? [{ previous: before, state: CircuitState.HalfOpen }, { previous: CircuitState.HalfOpen, state: after }] : []), ...(before !== after && !attemptedHalfOpen ? [{ previous: before, state: after }] : [])];
				const notifyEffects = Option.isSome(onStateChange) ? transitions.map((transition) => onStateChange.value({ error, name, previous: transition.previous, state: transition.state })) : [];
				const metricEffects = Option.isSome(metrics) ? transitions.map((transition) => Metric.update(Metric.taggedWithLabels(metrics.value.circuit.stateChanges, MetricsService.label({ circuit: name })), CircuitState[transition.state])) : [];
				yield* Effect.all([Context.Request.update({ circuit: Option.some({ name, state: after }) }), ...notifyEffects, ...metricEffects], { discard: true });
				return exit._tag === 'Success' ? exit.value : yield* Effect.failCause(exit.cause);
			});
		const instance = { execute, name, policy } as const;
		persist && _registry.set(name, instance);
		return instance;
	})();
};
const current = Context.Request.current.pipe(Effect.map((ctx) => ctx.circuit));

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Circuit = {
	BrokenCircuitError,
	current,
	handleType: <T extends Error>(ctor: new (...args: ReadonlyArray<unknown>) => T, filter?: (error: T) => boolean) => handleType(ctor, filter),
	isCancelled: (err: unknown): err is TaskCancelledError => isTaskCancelledError(err),
	isOpen: (err: unknown): err is BrokenCircuitError => isBrokenCircuitError(err),
	make,
	State: CircuitState,
	TaskCancelledError,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Circuit {
	export type Config = NonNullable<Parameters<typeof make>[1]>;
	export type Context = Option.Option.Value<Effect.Effect.Success<typeof current>>;
	export type Instance = ReturnType<typeof make>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Circuit };
