/**
 * Bridge React 19 useTransition/useOptimistic with Effect fiber execution.
 */
import { type AsyncState, async } from '@parametric-portal/types/async';
import { Effect, type Fiber } from 'effect';
import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { useRuntime } from '../runtime';
import { interruptFiber } from './file';

// --- [CONSTANTS] -------------------------------------------------------------

const asyncApi = async();

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

// --- [DISPATCH_TABLES] -------------------------------------------------------

const TransitionCallbacks = Object.freeze({
    onFailure:
        <A, E>(setState: React.Dispatch<React.SetStateAction<AsyncState<A, E>>>) =>
        (error: E) => {
            setState(asyncApi.failure(error));
            return Effect.fail(error);
        },
    onSuccess:
        <A, E>(setState: React.Dispatch<React.SetStateAction<AsyncState<A, E>>>) =>
        (data: A) =>
            Effect.sync(() => setState(asyncApi.success(data))),
    wrap: <A, E, R>(
        effect: Effect.Effect<A, E, R>,
        setState: React.Dispatch<React.SetStateAction<AsyncState<A, E>>>,
    ): Effect.Effect<A, E, R> =>
        effect.pipe(
            Effect.tap(TransitionCallbacks.onSuccess(setState)),
            Effect.catchAll(TransitionCallbacks.onFailure<A, E>(setState)),
        ),
});

// --- [HOOKS] -----------------------------------------------------------------

const useEffectTransition = <A, E, R>(effect: Effect.Effect<A, E, R>): TransitionState<A, E> => {
    const runtime = useRuntime<R, never>();
    const [isPending, startTransition] = useTransition();
    const [state, setState] = useState<AsyncState<A, E>>(asyncApi.idle);
    const fiberRef = useRef<Fiber.RuntimeFiber<A, E> | null>(null);
    const start = useCallback(() => {
        startTransition(() => {
            setState(asyncApi.loading());
            fiberRef.current = runtime.runFork(TransitionCallbacks.wrap(effect, setState));
        });
    }, [runtime, effect]);
    useEffect(() => {
        const fiber = fiberRef.current;
        const cleanup = fiber === null ? undefined : interruptFiber(runtime, fiber);
        return cleanup;
    }, [runtime]);
    return { isPending, start, state };
};
const useOptimisticEffect = <A, E, R>(
    currentState: A,
    updateFn: (current: A, optimistic: A) => A,
    effect: (optimistic: A) => Effect.Effect<A, E, R>,
): OptimisticState<A, E> => {
    const runtime = useRuntime<R, never>();
    const [optimisticState, setOptimistic] = useOptimistic(currentState, updateFn);
    const [state, setState] = useState<AsyncState<A, E>>(asyncApi.idle);
    const fiberRef = useRef<Fiber.RuntimeFiber<A, E> | null>(null);
    const addOptimistic = useCallback(
        (update: A) => {
            setOptimistic(update);
            setState(asyncApi.loading());
            const eff = effect(update).pipe(
                Effect.tap(TransitionCallbacks.onSuccess(setState)),
                Effect.catchAll(TransitionCallbacks.onFailure<A, E>(setState)),
            );
            fiberRef.current = runtime.runFork(eff);
        },
        [runtime, effect, setOptimistic],
    );
    useEffect(() => {
        const fiber = fiberRef.current;
        const cleanup = fiber === null ? undefined : interruptFiber(runtime, fiber);
        return cleanup;
    }, [runtime]);
    return { addOptimistic, optimisticState, state };
};

// --- [EXPORT] ----------------------------------------------------------------

export type { OptimisticState, TransitionState };
export { useEffectTransition, useOptimisticEffect };
