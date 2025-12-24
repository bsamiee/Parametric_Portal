/**
 * Bridge Effect Exit/Cause with React error boundaries via RuntimeProvider.
 */
import { type AsyncState, async } from '@parametric-portal/types/async';
import { Cause, Effect, Exit, Fiber } from 'effect';
import { type ComponentType, type DependencyList, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useRuntime } from '../runtime';

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

// --- [CONSTANTS] -------------------------------------------------------------

const asyncApi = async();

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

// --- [HOOKS] -----------------------------------------------------------------

const useEffectBoundary = <A, E, R>(effect: Effect.Effect<A, E, R>, deps: DependencyList): BoundaryState<A, E> => {
    const runtime = useRuntime<R, never>();
    const [state, setState] = useState<AsyncState<A, E>>(asyncApi.idle);
    const [error, setError] = useState<Cause.Cause<E> | null>(null);
    const reset = useCallback(() => {
        setError(null);
        setState(asyncApi.idle());
    }, []);
    useEffect(() => {
        setState(asyncApi.loading());
        const fiber = runtime.runFork(effect);
        runtime.runFork(
            awaitAndMatch(
                fiber,
                (cause) => {
                    setError(cause);
                    setState(asyncApi.failure(Cause.squash(cause) as E));
                },
                (data) => {
                    setError(null);
                    setState(asyncApi.success(data));
                },
            ),
        );
        return () => {
            runtime.runFork(Fiber.interrupt(fiber));
        };
        // biome-ignore lint/correctness/useExhaustiveDependencies: caller-controlled deps
    }, deps);
    return { error, reset, state };
};

// --- [EXPORT] ----------------------------------------------------------------

export type { BoundaryState, EffectErrorBoundaryProps, ErrorFallbackProps };
export { useEffectBoundary };
