/**
 * Async state hooks bridging Effect with React via fiber cleanup.
 */

import { ASYNC_TUNING, type AsyncState, mkFailure, mkIdle, mkLoading, mkSuccess } from '@parametric-portal/types/async';
import type { ManagedRuntime, Schedule } from 'effect';
import { Duration, Effect, Fiber } from 'effect';
import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeApi } from './runtime.ts';

// --- [TYPES] -----------------------------------------------------------------

type CallbackState<A, I, E> = {
    readonly execute: (input: I) => void;
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
    readonly useAsyncCallback: <A, E, I>(fn: (input: I) => Effect.Effect<A, E, R>) => CallbackState<A, I, E>;
    readonly useAsyncEffect: <A, E>(effect: Effect.Effect<A, E, R>, deps: DependencyList) => AsyncState<A, E>;
    readonly useAsyncEffectCached: <A, E>(
        effect: Effect.Effect<A, E, R>,
        ttl: Duration.DurationInput,
        deps: DependencyList,
    ) => CachedState<A, E>;
    readonly useAsyncEffectWithRetry: <A, E>(
        effect: Effect.Effect<A, E, R>,
        schedule: Schedule.Schedule<unknown, E>,
        deps: DependencyList,
    ) => RetryState<A, E>;
    readonly useAsyncState: <A, E>(effect: Effect.Effect<A, E, R>) => AsyncState<A, E>;
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

// --- [ENTRY_POINT] -----------------------------------------------------------

const createAsyncHooks = <R, E>(runtimeApi: RuntimeApi<R, E>, config: AsyncHooksConfig = {}): AsyncHooksApi<R> => {
    const { useRuntime } = runtimeApi;
    const ts = config.timestampProvider ?? B.defaults.timestamp;

    const useAsyncEffect = <A, Err>(effect: Effect.Effect<A, Err, R>, deps: DependencyList): AsyncState<A, Err> => {
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

    const useAsyncState = <A, Err>(effect: Effect.Effect<A, Err, R>): AsyncState<A, Err> => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<A, Err>>(mkIdle);

        useEffect(() => {
            setState(mkLoading(ts));
            const fiber = runtime.runFork(wrapEffect(effect, setState, ts));
            return interruptFiber(runtime, fiber);
        }, [effect, runtime]);

        return state;
    };

    const useAsyncCallback = <A, Err, I>(fn: (input: I) => Effect.Effect<A, Err, R>): CallbackState<A, I, Err> => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<A, Err>>(mkIdle);
        const fiberRef = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);

        const execute = useCallback(
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

        return { execute, reset, state };
    };

    const useAsyncEffectWithRetry = <A, Err>(
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

    const useAsyncEffectCached = <A, Err>(
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

            isCacheValid(cacheRef.current, now)
                ? setState(mkSuccess(cacheRef.current.value, ts))
                : (() => {
                      setState(mkLoading(ts));

                      const cachedEffect = effect.pipe(
                          Effect.tap(onCacheSuccess(setState, cacheRef, ttlMs, ts)),
                          Effect.catchAll(onFailure<A, Err>(setState, ts)),
                      );

                      const fiber = runtime.runFork(cachedEffect);
                      return interruptFiber(runtime, fiber);
                  })();
            // biome-ignore lint/correctness/useExhaustiveDependencies: deps is intentionally dynamic for caller control
        }, deps);

        return { invalidate, state };
    };

    return Object.freeze({
        useAsyncCallback,
        useAsyncEffect,
        useAsyncEffectCached,
        useAsyncEffectWithRetry,
        useAsyncState,
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { AsyncHooksApi, AsyncHooksConfig, CachedState, CallbackState, CacheEntry, RetryState, StateSetter };
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
