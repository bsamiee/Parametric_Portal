/**
 * Bridge Effect Exit/Cause with React error boundaries.
 */

import { ASYNC_TUNING, type AsyncState, mkFailure, mkIdle, mkLoading, mkSuccess } from '@parametric-portal/types/async';
import { Cause, Effect, Exit, Fiber } from 'effect';
import { type ComponentType, type DependencyList, type ReactNode, useCallback, useEffect, useState } from 'react';
import type { RuntimeApi } from './runtime';

// --- [TYPES] -----------------------------------------------------------------

type BoundaryState<A, E> = {
    readonly error: Cause.Cause<E> | null;
    readonly reset: () => void;
    readonly state: AsyncState<A, E>;
};

type ErrorFallbackProps<E> = {
    readonly error: Cause.Cause<E>;
    readonly reset: () => void;
};

type EffectErrorBoundaryProps<E> = {
    readonly children: ReactNode;
    readonly FallbackComponent: ComponentType<ErrorFallbackProps<E>>;
    readonly onError?: (error: Cause.Cause<E>) => void;
};

type BoundaryHooksApi<R> = {
    readonly useEffectBoundary: <A, E>(effect: Effect.Effect<A, E, R>, deps: DependencyList) => BoundaryState<A, E>;
};

type BoundaryHooksConfig = {
    readonly timestampProvider?: () => number;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        timestamp: ASYNC_TUNING.timestamp,
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const matchExit = <A, E>(
    exit: Exit.Exit<A, E>,
    onFailure: (cause: Cause.Cause<E>) => void,
    onSuccess: (data: A) => void,
): void => Exit.match(exit, { onFailure, onSuccess });

const awaitAndMatch = <A, E>(
    fiber: Fiber.RuntimeFiber<A, E>,
    onFailure: (cause: Cause.Cause<E>) => void,
    onSuccess: (data: A) => void,
): Effect.Effect<void, never, never> =>
    Effect.flatMap(Fiber.await(fiber), (exit) => Effect.sync(() => matchExit(exit, onFailure, onSuccess)));

// --- [ENTRY_POINT] -----------------------------------------------------------

const createBoundaryHooks = <R, E>(
    runtimeApi: RuntimeApi<R, E>,
    config: BoundaryHooksConfig = {},
): BoundaryHooksApi<R> => {
    const { useRuntime } = runtimeApi;
    const ts = config.timestampProvider ?? B.defaults.timestamp;

    const useEffectBoundary = <A, Err>(
        effect: Effect.Effect<A, Err, R>,
        deps: DependencyList,
    ): BoundaryState<A, Err> => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<A, Err>>(mkIdle);
        const [error, setError] = useState<Cause.Cause<Err> | null>(null);

        const reset = useCallback(() => {
            setError(null);
            setState(mkIdle());
        }, []);

        useEffect(() => {
            setState(mkLoading(ts));

            const fiber = runtime.runFork(effect);

            runtime.runFork(
                awaitAndMatch(
                    fiber as Fiber.RuntimeFiber<A, Err>,
                    (cause) => {
                        setError(cause);
                        setState(mkFailure(Cause.squash(cause) as Err, ts));
                    },
                    (data) => {
                        setError(null);
                        setState(mkSuccess(data, ts));
                    },
                ),
            );

            return () => {
                runtime.runFork(Fiber.interrupt(fiber));
            };
            // biome-ignore lint/correctness/useExhaustiveDependencies: deps is intentionally dynamic for caller control
        }, deps);

        return { error, reset, state };
    };

    return Object.freeze({
        useEffectBoundary,
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { BoundaryHooksApi, BoundaryHooksConfig, BoundaryState, EffectErrorBoundaryProps, ErrorFallbackProps };
export { B as BOUNDARY_HOOKS_TUNING, createBoundaryHooks };
