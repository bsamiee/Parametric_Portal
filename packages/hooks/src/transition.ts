/**
 * Bridge React 19 useTransition/useOptimistic with Effect fiber execution.
 */

import { ASYNC_TUNING, type AsyncState, mkFailure, mkIdle, mkLoading, mkSuccess } from '@parametric-portal/types/async';
import { Effect, Fiber } from 'effect';
import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import type { RuntimeApi } from './runtime.ts';

// --- [TYPES] -----------------------------------------------------------------

type TransitionState<A, E> = {
    readonly isPending: boolean;
    readonly start: () => void;
    readonly state: AsyncState<A, E>;
};

type OptimisticState<A, E> = {
    readonly addOptimistic: (update: A) => void;
    readonly optimisticState: A;
    readonly state: AsyncState<A, E>;
};

type TransitionHooksApi<R> = {
    readonly useEffectTransition: <A, E>(effect: Effect.Effect<A, E, R>) => TransitionState<A, E>;
    readonly useOptimisticEffect: <A, E>(
        currentState: A,
        updateFn: (current: A, optimistic: A) => A,
        effect: (optimistic: A) => Effect.Effect<A, E, R>,
    ) => OptimisticState<A, E>;
};

type TransitionHooksConfig = {
    readonly timestampProvider?: () => number;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        timestamp: ASYNC_TUNING.timestamp,
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const onTransitionSuccess =
    <A, E>(setState: React.Dispatch<React.SetStateAction<AsyncState<A, E>>>, ts: () => number) =>
    (data: A) =>
        Effect.sync(() => setState(mkSuccess(data, ts)));

const onTransitionFailure =
    <A, E>(setState: React.Dispatch<React.SetStateAction<AsyncState<A, E>>>, ts: () => number) =>
    (error: E) => {
        setState(mkFailure(error, ts));
        return Effect.fail(error);
    };

const wrapWithTransition = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    setState: React.Dispatch<React.SetStateAction<AsyncState<A, E>>>,
    ts: () => number,
): Effect.Effect<A, E, R> =>
    effect.pipe(
        Effect.tap(onTransitionSuccess(setState, ts)),
        Effect.catchAll(onTransitionFailure<A, E>(setState, ts)),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const createTransitionHooks = <R, E>(
    runtimeApi: RuntimeApi<R, E>,
    config: TransitionHooksConfig = {},
): TransitionHooksApi<R> => {
    const { useRuntime } = runtimeApi;
    const ts = config.timestampProvider ?? B.defaults.timestamp;

    const useEffectTransition = <A, Err>(effect: Effect.Effect<A, Err, R>): TransitionState<A, Err> => {
        const runtime = useRuntime();
        const [isPending, startTransition] = useTransition();
        const [state, setState] = useState<AsyncState<A, Err>>(mkIdle);
        const fiberRef = useRef<Fiber.RuntimeFiber<A, E | Err> | null>(null);

        const start = useCallback(() => {
            startTransition(() => {
                setState(mkLoading(ts));
                fiberRef.current = runtime.runFork(wrapWithTransition(effect, setState, ts));
            });
        }, [runtime, effect]);

        useEffect(
            () => () => {
                fiberRef.current && runtime.runPromise(Fiber.interrupt(fiberRef.current)).catch(() => {});
            },
            [runtime],
        );

        return { isPending, start, state };
    };

    const useOptimisticEffect = <A, Err>(
        currentState: A,
        updateFn: (current: A, optimistic: A) => A,
        effect: (optimistic: A) => Effect.Effect<A, Err, R>,
    ): OptimisticState<A, Err> => {
        const runtime = useRuntime();
        const [optimisticState, setOptimistic] = useOptimistic(currentState, updateFn);
        const [state, setState] = useState<AsyncState<A, Err>>(mkIdle);
        const fiberRef = useRef<Fiber.RuntimeFiber<A, E | Err> | null>(null);

        const addOptimistic = useCallback(
            (update: A) => {
                setOptimistic(update);
                setState(mkLoading(ts));

                const eff = effect(update).pipe(
                    Effect.tap(onTransitionSuccess(setState, ts)),
                    Effect.catchAll(onTransitionFailure<A, Err>(setState, ts)),
                );

                fiberRef.current = runtime.runFork(eff);
            },
            [runtime, effect, setOptimistic],
        );

        useEffect(
            () => () => {
                fiberRef.current && runtime.runPromise(Fiber.interrupt(fiberRef.current)).catch(() => {});
            },
            [runtime],
        );

        return { addOptimistic, optimisticState, state };
    };

    return Object.freeze({
        useEffectTransition,
        useOptimisticEffect,
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { OptimisticState, TransitionHooksApi, TransitionHooksConfig, TransitionState };
export { B as TRANSITION_HOOKS_TUNING, createTransitionHooks };
