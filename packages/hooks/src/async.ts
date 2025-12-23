/**
 * Bridge Effect execution with React state via managed fibers.
 * Unified async hooks: useQuery (declarative), useMutation (imperative), with caching and retry variants.
 */

import { ASYNC_TUNING, type AsyncState, mkFailure, mkIdle, mkLoading, mkSuccess } from '@parametric-portal/types/async';
import type { Schedule } from 'effect';
import { Duration, Effect, Fiber } from 'effect';
import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeApi } from './runtime';

// --- [TYPES] -----------------------------------------------------------------

type MutationState<A, I, E> = {
    readonly mutate: (input: I) => void;
    readonly reset: () => void;
    readonly state: AsyncState<A, E>;
};

type CachedState<A, E> = {
    readonly invalidate: () => void;
    readonly state: AsyncState<A, E>;
};

type RetryState<A, E> = {
    readonly attempts: number;
    readonly state: AsyncState<A, E>;
};

type AsyncHooksApi<R> = {
    readonly useMutation: <A, I, E>(fn: (input: I) => Effect.Effect<A, E, R>) => MutationState<A, I, E>;
    readonly useQuery: <A, E>(effect: Effect.Effect<A, E, R>, deps: DependencyList) => AsyncState<A, E>;
    readonly useQueryCached: <A, E>(
        effect: Effect.Effect<A, E, R>,
        ttl: Duration.DurationInput,
        deps: DependencyList,
    ) => CachedState<A, E>;
    readonly useQueryRetry: <A, E>(
        effect: Effect.Effect<A, E, R>,
        schedule: Schedule.Schedule<unknown, E>,
        deps: DependencyList,
    ) => RetryState<A, E>;
};

type AsyncHooksConfig = {
    readonly timestampProvider?: () => number;
};

type StateSetter<A, E> = React.Dispatch<React.SetStateAction<AsyncState<A, E>>>;

type CacheEntry<A> = {
    readonly expiresAt: number;
    readonly value: A;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        timestamp: ASYNC_TUNING.timestamp,
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isCacheValid = <A>(entry: CacheEntry<A> | null, now: number): entry is CacheEntry<A> =>
    entry !== null && now < entry.expiresAt;

const createCacheEntry = <A>(value: A, ttlMs: number, now: number): CacheEntry<A> => ({
    expiresAt: now + ttlMs,
    value,
});

const incrementBy =
    (n: number) =>
    (prev: number): number =>
        prev + n;

// --- [ENTRY_POINT] -----------------------------------------------------------

const createAsyncHooks = <R, E>(runtimeApi: RuntimeApi<R, E>, config: AsyncHooksConfig = {}): AsyncHooksApi<R> => {
    const { useRuntime } = runtimeApi;
    const ts = config.timestampProvider ?? B.defaults.timestamp;

    const useQuery = <A, Err>(effect: Effect.Effect<A, Err, R>, deps: DependencyList): AsyncState<A, Err> => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<A, Err>>(mkIdle);

        useEffect(() => {
            setState(mkLoading(ts));
            const fiber = runtime.runFork(
                Effect.gen(function* () {
                    const data = yield* effect;
                    setState(mkSuccess(data, ts));
                    return data;
                }).pipe(
                    Effect.catchAll((error: Err) => {
                        setState(mkFailure(error, ts));
                        return Effect.void;
                    }),
                ),
            );
            return () => {
                runtime.runFork(Fiber.interrupt(fiber));
            };
            // biome-ignore lint/correctness/useExhaustiveDependencies: deps is intentionally dynamic for caller control
        }, deps);

        return state;
    };

    const useMutation = <A, Err, I>(fn: (input: I) => Effect.Effect<A, Err, R>): MutationState<A, I, Err> => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<A, Err>>(mkIdle);
        const fiberRef = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);

        const mutate = useCallback(
            (input: I) => {
                setState(mkLoading(ts));
                fiberRef.current = runtime.runFork(
                    Effect.gen(function* () {
                        const data = yield* fn(input);
                        setState(mkSuccess(data, ts));
                        return data;
                    }).pipe(
                        Effect.catchAll((error: Err) => {
                            setState(mkFailure(error, ts));
                            return Effect.void;
                        }),
                    ),
                );
            },
            [runtime, fn],
        );

        const reset = useCallback(() => {
            fiberRef.current && runtime.runFork(Fiber.interrupt(fiberRef.current));
            fiberRef.current = null;
            setState(mkIdle());
        }, [runtime]);

        useEffect(
            () =>
                fiberRef.current === null
                    ? undefined
                    : () => {
                          runtime.runFork(Fiber.interrupt(fiberRef.current as Fiber.RuntimeFiber<unknown, unknown>));
                      },
            [runtime],
        );

        return { mutate, reset, state };
    };

    const useQueryRetry = <A, Err>(
        effect: Effect.Effect<A, Err, R>,
        schedule: Schedule.Schedule<unknown, Err>,
        deps: DependencyList,
    ): RetryState<A, Err> => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<A, Err>>(mkIdle);
        const [attempts, setAttempts] = useState(0);

        useEffect(() => {
            setState(mkLoading(ts));
            setAttempts(0);

            const incrementAttempt = Effect.sync(() => setAttempts(incrementBy(1)));
            const retryEffect = Effect.gen(function* () {
                const data = yield* effect.pipe(Effect.zipLeft(incrementAttempt), Effect.retry(schedule));
                setState(mkSuccess(data, ts));
                return data;
            }).pipe(
                Effect.catchAll((error: Err) => {
                    setState(mkFailure(error, ts));
                    return Effect.void;
                }),
            );

            const fiber = runtime.runFork(retryEffect);
            return () => {
                runtime.runFork(Fiber.interrupt(fiber));
            };
            // biome-ignore lint/correctness/useExhaustiveDependencies: deps is intentionally dynamic for caller control
        }, deps);

        return { attempts, state };
    };

    const useQueryCached = <A, Err>(
        effect: Effect.Effect<A, Err, R>,
        ttl: Duration.DurationInput,
        deps: DependencyList,
    ): CachedState<A, Err> => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<A, Err>>(mkIdle);
        const cacheRef = useRef<CacheEntry<A> | null>(null);
        const ttlMs = Duration.toMillis(ttl);

        const invalidate = useCallback(() => {
            cacheRef.current = null;
            setState(mkIdle());
        }, []);

        useEffect(() => {
            const now = ts();
            const cached = cacheRef.current;
            if (isCacheValid(cached, now)) {
                setState(mkSuccess(cached.value, ts));
                return undefined;
            }
            setState(mkLoading(ts));
            const fiber = runtime.runFork(
                Effect.gen(function* () {
                    const data = yield* effect;
                    cacheRef.current = createCacheEntry(data, ttlMs, ts());
                    setState(mkSuccess(data, ts));
                    return data;
                }).pipe(
                    Effect.catchAll((error: Err) => {
                        setState(mkFailure(error, ts));
                        return Effect.void;
                    }),
                ),
            );
            return () => {
                runtime.runFork(Fiber.interrupt(fiber));
            };
            // biome-ignore lint/correctness/useExhaustiveDependencies: deps is intentionally dynamic for caller control
        }, deps);

        return { invalidate, state };
    };

    return Object.freeze({
        useMutation,
        useQuery,
        useQueryCached,
        useQueryRetry,
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { AsyncHooksApi, AsyncHooksConfig, CachedState, CacheEntry, MutationState, RetryState, StateSetter };
export { B as ASYNC_HOOKS_TUNING, createAsyncHooks, createCacheEntry, isCacheValid };
