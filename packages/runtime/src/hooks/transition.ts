/**
 * Bridge React 19 useTransition/useOptimistic with Effect fiber execution.
 */
import { AsyncState } from '@parametric-portal/types/async';
import { Effect, Fiber, type ManagedRuntime } from 'effect';
import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { useRuntime } from '../runtime';

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

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const cleanupFiber = <R, E>(
    fiberRef: React.RefObject<Fiber.RuntimeFiber<unknown, unknown> | null>,
    runtime: ManagedRuntime.ManagedRuntime<R, E>,
): void => {
    fiberRef.current && runtime.runFork(Fiber.interrupt(fiberRef.current));
};
const wrapEffect = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    setState: React.Dispatch<React.SetStateAction<AsyncState<A, E>>>,
): Effect.Effect<A, E, R> =>
    effect.pipe(
        Effect.tap((data: A) => Effect.sync(() => setState(AsyncState.Success(data)))),
        Effect.catchAll((error: E) => {
            setState(AsyncState.Failure(error));
            return Effect.fail(error);
        }),
    );

// --- [HOOKS] -----------------------------------------------------------------

const useEffectTransition = <A, E, R>(effect: Effect.Effect<A, E, R>): TransitionState<A, E> => {
    const runtime = useRuntime<R, never>();
    const [isPending, startTransition] = useTransition();
    const [state, setState] = useState<AsyncState<A, E>>(AsyncState.Idle);
    const fiberRef = useRef<Fiber.RuntimeFiber<A, E> | null>(null);
    const start = useCallback(() => {
        startTransition(() => {
            setState(AsyncState.Loading());
            fiberRef.current = runtime.runFork(wrapEffect(effect, setState));
        });
    }, [runtime, effect]);
    useEffect(() => () => cleanupFiber(fiberRef, runtime), [runtime]);
    return { isPending, start, state };
};
const useOptimisticEffect = <A, E, R>(
    currentState: A,
    updateFn: (current: A, optimistic: A) => A,
    effect: (optimistic: A) => Effect.Effect<A, E, R>,
): OptimisticState<A, E> => {
    const runtime = useRuntime<R, never>();
    const [optimisticState, setOptimistic] = useOptimistic(currentState, updateFn);
    const [state, setState] = useState<AsyncState<A, E>>(AsyncState.Idle);
    const fiberRef = useRef<Fiber.RuntimeFiber<A, E> | null>(null);
    const addOptimistic = useCallback(
        (update: A) => {
            setOptimistic(update);
            setState(AsyncState.Loading());
            fiberRef.current = runtime.runFork(wrapEffect(effect(update), setState));
        },
        [runtime, effect, setOptimistic],
    );
    useEffect(() => () => cleanupFiber(fiberRef, runtime), [runtime]);
    return { addOptimistic, optimisticState, state };
};

// --- [EXPORT] ----------------------------------------------------------------

export type { OptimisticState, TransitionState };
export { useEffectTransition, useOptimisticEffect };
