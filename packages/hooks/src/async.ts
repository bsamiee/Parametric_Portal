/**
 * Bridge Effect execution with React state via managed fibers.
 * Unified async hooks: useQuery (declarative), useMutation (imperative), with caching and retry variants.
 */

import { ASYNC_TUNING, type AsyncState, mkFailure, mkIdle, mkLoading, mkSuccess } from '@parametric-portal/types/async';
import type { ManagedRuntime, Schedule } from 'effect';
import { Duration, Effect, Fiber } from 'effect';
import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeApi } from './runtime.ts';

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

const onSuccess =
    <A, E>(setState: StateSetter<A, E>, ts: () => number) =>
    (data: A) =>
        Effect.sync(() => setState(mkSuccess(data, ts)));

const onFailure =
    <A, E>(setState: StateSetter<A, E>, ts: () => number) =>
    (error: E) =>
        Effect.sync(() => setState(mkFailure(error, ts)));

const wrapEffect = <A, E, R>(effect: Effect.Effect<A, E, R>, setState: StateSetter<A, E>, ts: () => number) =>
    effect.pipe(Effect.tap(onSuccess(setState, ts)), Effect.catchAll(onFailure<A, E>(setState, ts)));

const interruptFiber =
    <A, E, R>(runtime: ManagedRuntime.ManagedRuntime<R, E>, fiber: Fiber.RuntimeFiber<A, E>) =>
    () =>
        void runtime.runPromise(Fiber.interrupt(fiber));

const isCacheValid = <A>(entry: CacheEntry<A> | null, now: number): entry is CacheEntry<A> =>
    entry !== null && now < entry.expiresAt;

const createCacheEntry = <A>(value: A, ttlMs: number, now: number): CacheEntry<A> => ({
    expiresAt: now + ttlMs,
    value,
});

const incrementAttempts = (setAttempts: React.Dispatch<React.SetStateAction<number>>) => () =>
    Effect.sync(() => setAttempts((prev) => prev + 1));

const onCacheSuccess =
    <A, E>(setState: StateSetter<A, E>, cacheRef: { current: CacheEntry<A> | null }, ttlMs: number, ts: () => number) =>
    (data: A) =>
        Effect.sync(() => {
            cacheRef.current = createCacheEntry(data, ttlMs, ts());
            setState(mkSuccess(data, ts));
        });

const executeCachedEffect = <A, E, R, RuntimeE>(
    runtime: ManagedRuntime.ManagedRuntime<R, RuntimeE>,
    effect: Effect.Effect<A, E, R>,
    setState: StateSetter<A, E>,
    cacheRef: { current: CacheEntry<A> | null },
    ttlMs: number,
    ts: () => number,
): (() => void) => {
    setState(mkLoading(ts));
    const cachedEffect = effect.pipe(
        Effect.tap(onCacheSuccess(setState, cacheRef, ttlMs, ts)),
        Effect.catchAll(onFailure<A, E>(setState, ts)),
    );
    const fiber = runtime.runFork(cachedEffect);
    return interruptFiber(runtime, fiber);
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createAsyncHooks = <R, E>(runtimeApi: RuntimeApi<R, E>, config: AsyncHooksConfig = {}): AsyncHooksApi<R> => {
    const { useRuntime } = runtimeApi;
    const ts = config.timestampProvider ?? B.defaults.timestamp;

    const useQuery = <A, Err>(effect: Effect.Effect<A, Err, R>, deps: DependencyList): AsyncState<A, Err> => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<A, Err>>(mkIdle);

        useEffect(() => {
            setState(mkLoading(ts));
            const fiber = runtime.runFork(wrapEffect(effect, setState, ts));
            return interruptFiber(runtime, fiber);
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
                fiberRef.current = runtime.runFork(wrapEffect(fn(input), setState, ts));
            },
            [runtime, fn],
        );

        const reset = useCallback(() => {
            fiberRef.current && void runtime.runPromise(Fiber.interrupt(fiberRef.current));
            fiberRef.current = null;
            setState(mkIdle());
        }, [runtime]);

        useEffect(
            () => () => {
                fiberRef.current && void runtime.runPromise(Fiber.interrupt(fiberRef.current));
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

            const retryEffect = effect.pipe(
                Effect.tap(incrementAttempts(setAttempts)),
                Effect.retry(schedule),
                Effect.tap(onSuccess(setState, ts)),
                Effect.catchAll(onFailure<A, Err>(setState, ts)),
            );

            const fiber = runtime.runFork(retryEffect);
            return interruptFiber(runtime, fiber);
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
            return isCacheValid(cached, now)
                ? (() => {
                      setState(mkSuccess(cached.value, ts));
                  })()
                : executeCachedEffect(runtime, effect, setState, cacheRef, ttlMs, ts);
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
export {
    B as ASYNC_HOOKS_TUNING,
    createAsyncHooks,
    createCacheEntry,
    interruptFiber,
    isCacheValid,
    onFailure,
    onSuccess,
    wrapEffect,
};
