/**
 * Effect-native circuit breaker with registry, metrics, and GC.
 * Replaces cockatiel — all state managed via Ref, no Promise bridge.
 */
import { Array as A, Boolean as B, Data, Duration, Effect, Function as F, Match, Metric, MutableRef, Option, STM, Struct, TMap, TRef } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';

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
const _INITIAL_STATE = {
    failureCount: 0 as number,
    failures: [] as readonly number[],
    lastFailureAt: 0 as number,
    state: 'Closed' as 'Closed' | 'HalfOpen' | 'Open',
    successCount: 0 as number,
    totalCount: 0 as number,
};
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

class CircuitState extends Effect.Service<CircuitState>()('server/CircuitState', {
    scoped: Effect.gen(function* () {
        const registry = yield* STM.commit(TMap.empty<string, Circuit.Instance>());
        const lastAccess = yield* STM.commit(TMap.empty<string, number>());
        return { lastAccess, registry };
    }),
}) {}

// --- [FUNCTIONS] -------------------------------------------------------------

const shouldTrip = (breaker: NonNullable<Circuit.Config['breaker']>, internal: typeof _INITIAL_STATE): boolean =>
    Match.value(breaker).pipe(
        Match.tag('consecutive', (configuration) => internal.failureCount >= (configuration.threshold ?? _CONFIG.defaults.consecutiveThreshold)),
        Match.tag('count', (configuration) => {
            const size = configuration.size ?? _CONFIG.defaults.count.size;
            return internal.totalCount >= Math.max(size, configuration.minimumNumberOfCalls ?? 0) && internal.failureCount / internal.totalCount >= (configuration.threshold ?? _CONFIG.defaults.count.threshold);
        }),
        Match.tag('sampling', (configuration) => {
            const windowMs = Duration.toMillis(configuration.duration ?? Duration.seconds(_CONFIG.defaults.sampling.durationSeconds));
            const now = Date.now();
            return internal.totalCount >= (configuration.minimumRps ?? 0) && A.filter(internal.failures, (timestamp) => now - timestamp <= windowMs).length / Math.max(internal.totalCount, 1) >= (configuration.threshold ?? _CONFIG.defaults.sampling.threshold);
        }),
        Match.exhaustive,
    );
const _createInstance = (
    name: string,
    config: Circuit.Config,
    registry: TMap.TMap<string, Circuit.Instance>,
    lastAccess: TMap.TMap<string, number>,
): Effect.Effect<Circuit.Instance, never, never> =>
    Effect.gen(function* () {
        const breaker = config.breaker ?? { _tag: 'consecutive' as const };
        const halfOpenAfterMs = Duration.toMillis(config.halfOpenAfter ?? Duration.seconds(_CONFIG.defaults.halfOpenSeconds));
        const stateRef = yield* STM.commit(TRef.make(_INITIAL_STATE));
        const isolatedRef = yield* STM.commit(TRef.make(false));
        const userCallback = Option.fromNullable(config.onStateChange);
        const metricsService = yield* Effect.serviceOption(MetricsService);
        const stateTracker = MutableRef.make({ current: _INITIAL_STATE.state, previous: _INITIAL_STATE.state });
        const _notifyStateChange = (previous: typeof _INITIAL_STATE.state, currentState: typeof _INITIAL_STATE.state): Effect.Effect<void> =>
            Effect.void.pipe(
                Effect.tap(F.constant(MutableRef.set(stateTracker, { current: currentState, previous }))),
                Effect.zipRight(Effect.logWarning(`Circuit[${name}] state change`, { from: previous, to: currentState })),
                Effect.zipRight(Option.match(userCallback, {
                    onNone: F.constant(Effect.void),
                    onSome: F.apply({ name, previous, state: currentState }),
                })),
                Effect.zipRight(Effect.when(
                    Option.getOrElse(
                        Option.map(metricsService, (ms) => Metric.update(Metric.taggedWithLabels(ms.circuit.stateChanges, MetricsService.label({ circuit: name })), currentState)),
                        F.constant(Effect.void),
                    ),
                    F.constant(config.metrics ?? true),
                )),
            );
        const _circuitContext = (): Option.Option<{ readonly name: string; readonly state: string }> => Option.some({ name, state: MutableRef.get(stateTracker).current });
        const _onSuccess = STM.commit(TRef.modify(stateRef, (before) => {
            const after = { ...before, failureCount: 0, state: 'Closed' as const, successCount: before.successCount + 1, totalCount: before.totalCount + 1 };
            return [[before.state, after.state] as const, after] as const;
        })).pipe(
            Effect.flatMap(([beforeState, afterState]) => Effect.when(_notifyStateChange(beforeState, afterState), F.constant(beforeState !== afterState))),
            Effect.zipRight(Effect.logDebug(`Circuit[${name}] success`)),
        );
        const _onFailure = Effect.sync(Date.now).pipe(
            Effect.flatMap((now) => STM.commit(TRef.modify(stateRef, (before) => {
                const updated = { ...before, failureCount: before.failureCount + 1, failures: [...before.failures, now], lastFailureAt: now, totalCount: before.totalCount + 1 };
                const after = B.match(shouldTrip(breaker, updated), {
                    onFalse: F.constant(updated),
                    onTrue: F.constant({ ...updated, state: 'Open' as const }),
                });
                return [[before.state, after.state] as const, after] as const;
            }))),
            Effect.flatMap(([beforeState, afterState]) => Effect.when(_notifyStateChange(beforeState, afterState), F.constant(afterState !== beforeState))),
            Effect.zipRight(Effect.logDebug(`Circuit[${name}] failure`)),
        );
        const execute = <A, E, R>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E | CircuitError, R> =>
            Effect.gen(function* () {
                yield* STM.commit(TMap.set(lastAccess, name, Date.now()));
                yield* Context.Request.update({ circuit: _circuitContext() });
                yield* STM.commit(TRef.get(isolatedRef)).pipe(Effect.filterOrFail(B.not, F.constant(CircuitError.isolated(name))));
                const internal = yield* STM.commit(TRef.get(stateRef));
                const effectiveState = internal.state === 'Open' && Date.now() - internal.lastFailureAt >= halfOpenAfterMs ? 'HalfOpen' : internal.state;
                const previousLabel = MutableRef.get(stateTracker).current;
                yield* Effect.when(STM.commit(TRef.update(stateRef, Struct.evolve({ state: F.constant(effectiveState) }))), F.constant(effectiveState !== internal.state));
                yield* Effect.when(_notifyStateChange(previousLabel, effectiveState), F.constant(effectiveState !== previousLabel));
                yield* effectiveState === 'Open' ? Effect.fail(CircuitError.broken(name)) : Effect.void;
                const result = yield* eff.pipe(Effect.tap(F.constant(_onSuccess)), Effect.tapError(F.constant(_onFailure)));
                yield* Context.Request.update({ circuit: _circuitContext() });
                return result;
            }).pipe(Telemetry.span('circuit.execute', { 'circuit.name': name, metrics: false }));
        const instance: Circuit.Instance = {
            dispose: () => { (config.persist ?? true) && Effect.runFork(STM.commit(TMap.remove(registry, name))); },
            execute,
            isolate: () => { Effect.runFork(STM.commit(TRef.set(isolatedRef, true))); return { dispose: () => { Effect.runFork(STM.commit(TRef.set(isolatedRef, false))); } }; },
            name,
            get state() { return MutableRef.get(stateTracker).current; },
            toJSON: () => ({ name, state: MutableRef.get(stateTracker).current }),
        };
        yield* (config.persist ?? true)
            ? STM.commit(TMap.set(registry, name, instance).pipe(STM.zipRight(TMap.set(lastAccess, name, Date.now()))))
            : Effect.void;
        return instance;
    });
const make = (name: string, config: {
    readonly breaker?:
        | { readonly _tag: 'consecutive'; readonly threshold?: number }
        | { readonly _tag: 'count'; readonly minimumNumberOfCalls?: number; readonly size?: number; readonly threshold?: number }
        | { readonly _tag: 'sampling'; readonly duration?: Duration.Duration; readonly minimumRps?: number; readonly threshold?: number };
    readonly halfOpenAfter?: Duration.Duration;
    readonly metrics?: boolean;
    readonly onStateChange?: (change: { readonly name: string; readonly previous: string; readonly state: string }) => Effect.Effect<void, never, never>;
    readonly persist?: boolean;
} = {}): Effect.Effect<Circuit.Instance, never, CircuitState> =>
    Effect.gen(function* () {
        const { lastAccess, registry } = yield* CircuitState;
        const cached = yield* ((config.persist ?? true) ? STM.commit(TMap.get(registry, name)) : Effect.succeed(Option.none<Circuit.Instance>()));
        yield* Effect.when(STM.commit(TMap.set(lastAccess, name, Date.now())), F.constant(Option.isSome(cached)));
        return yield* Option.match(cached, {
            onNone: F.constant(_createInstance(name, config, registry, lastAccess)),
            onSome: Effect.succeed,
        });
    });
function is(err: unknown): err is CircuitError;
function is<R extends CircuitError['reason']>(err: unknown, reason: R): err is CircuitError & { readonly reason: R };
function is(err: unknown, reason?: CircuitError['reason']): boolean {
    const matched = err instanceof CircuitError || (typeof err === 'object' && err !== null && '_tag' in err && err._tag === 'CircuitError');
    return matched && (reason === undefined || (err as CircuitError).reason === reason);
}

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Circuit = {
    clear: () => CircuitState.pipe(Effect.flatMap(({ lastAccess, registry }) => STM.commit(
        TMap.keys(registry).pipe(
            STM.flatMap((keys) => TMap.removeAll(registry, keys)),
            STM.zipRight(TMap.keys(lastAccess).pipe(STM.flatMap((keys) => TMap.removeAll(lastAccess, keys)))),
        ),
    ))),
    current,
    Error: CircuitError,
    gc: (maxIdleMs = _CONFIG.defaults.gcIdleMs) => CircuitState.pipe(
        Effect.flatMap(({ lastAccess, registry }) => STM.commit(TMap.toArray(lastAccess)).pipe(
            Effect.map((accessEntries) => {
                const now = Date.now();
                return A.filterMap(accessEntries, ([circuitName, timestamp]) => Option.liftPredicate(circuitName, F.constant(now - timestamp > maxIdleMs)),
                );
            }),
            Effect.flatMap((staleKeys) =>
                STM.commit(A.reduce(staleKeys, STM.void, (transaction, circuitName) =>
                    transaction.pipe(
                        STM.zipRight(TMap.remove(registry, circuitName)),
                        STM.zipRight(TMap.remove(lastAccess, circuitName)),
                    ),
                )).pipe(Effect.as({ removed: staleKeys.length })),
            ),
        )),
    ),
    get: (name: string) => CircuitState.pipe(Effect.flatMap(({ registry }) => STM.commit(TMap.get(registry, name)))),
    is,
    Layer: CircuitState.Default,
    make,
    State: CircuitState,
    stats: () => CircuitState.pipe(
        Effect.flatMap(({ lastAccess, registry }) => Effect.all([STM.commit(TMap.toArray(registry)), STM.commit(TMap.toArray(lastAccess))]).pipe(
            Effect.map(([registryEntries, accessEntries]) => {
                const access = new Map(accessEntries);
                return registryEntries.map(([circuitName, inst]) => ({ lastAccess: access.get(circuitName) ?? 0, name: circuitName, state: inst.state }));
            }),
        )),
    ),
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Circuit {
    export type Error = InstanceType<typeof CircuitError>;
    export type Config = NonNullable<Parameters<typeof make>[1]>;
    export type State = CircuitState;
    export interface Instance {
        readonly dispose: () => void;
        readonly execute: <A, E, R>(eff: Effect.Effect<A, E, R>) => Effect.Effect<A, E | Error, R>;
        readonly isolate: () => { readonly dispose: () => void };
        readonly name: string;
        readonly state: 'Closed' | 'HalfOpen' | 'Open';
        readonly toJSON: () => unknown;
    }
}

// --- [EXPORT] ----------------------------------------------------------------

export { Circuit };
