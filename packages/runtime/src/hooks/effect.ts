/**
 * Bridge Effect execution with React state via managed fibers.
 * Enables declarative effect runs with auto-cleanup and imperative mutations with manual triggers.
 */
import { type AsyncHookReturn, AsyncState, type MutateActions } from '@parametric-portal/types/async';
import { Effect, Fiber } from 'effect';
import { type DependencyList, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Runtime } from '../runtime';

// --- [TYPES] -----------------------------------------------------------------

type RunOptions<A, E> = {
    readonly enabled?: boolean;
    readonly onError?: (error: E) => void;
    readonly onSettled?: () => void;
    readonly onSuccess?: (data: A) => void;
};
type MutateOptions<A, I, E> = {
    readonly onError?: (error: E, input: I) => void;
    readonly onSettled?: (input: I) => void;
    readonly onSuccess?: (data: A, input: I) => void;
};
type MutateState<A, I, E> = AsyncHookReturn<A, E, MutateActions<I>> & { readonly isPending: boolean };

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    spans: {
        mutate: 'effect-mutate',
        run: 'effect-run',
    },
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const useFiberCleanup = <R>(fiberRef: RefObject<Fiber.RuntimeFiber<unknown, unknown> | null>): void => {
    const runtime = Runtime.use<R, never>();
    useEffect(
        () => () => {
            fiberRef.current && runtime.runFork(Fiber.interrupt(fiberRef.current));
        },
        [runtime, fiberRef],
    );
};
const useEffectRun = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    deps: DependencyList,
    options: RunOptions<A, E> = {},
): AsyncState<A, E> => {
    const { enabled = true, onError, onSettled, onSuccess } = options;
    const runtime = Runtime.use<R, never>();
    const [state, setState] = useState<AsyncState<A, E>>(AsyncState.Idle());
    const fiberRef = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);
    useFiberCleanup<R>(fiberRef);
    // biome-ignore lint/correctness/useExhaustiveDependencies: effect/callbacks intentionally excluded (identity changes on every render)
    useEffect(() => {
        setState(enabled ? AsyncState.Loading() : AsyncState.Idle());
        fiberRef.current = enabled
            ? runtime.runFork(
                  Effect.gen(function* () {
                      const data = yield* effect;
                      onSuccess?.(data);
                      setState(AsyncState.Success(data));
                      onSettled?.();
                      return data;
                  }).pipe(
                      Effect.withSpan(B.spans.run),
                      Effect.catchAll((error: E) => {
                          onError?.(error);
                          setState(AsyncState.Failure(error));
                          onSettled?.();
                          return Effect.void;
                      }),
                  ),
              )
            : null;
    }, [enabled, ...deps, runtime]);
    return state;
};
const useEffectMutate = <A, I, E, R>(
    fn: (input: I) => Effect.Effect<A, E, R>,
    options: MutateOptions<A, I, E> = {},
): MutateState<A, I, E> => {
    const { onError, onSettled, onSuccess } = options;
    const runtime = Runtime.use<R, never>();
    const [state, setState] = useState<AsyncState<A, E>>(AsyncState.Idle);
    const fiberRef = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);
    useFiberCleanup<R>(fiberRef);
    const mutate = useCallback(
        (input: I) => {
            setState(AsyncState.Loading());
            fiberRef.current = runtime.runFork(
                Effect.gen(function* () {
                    const data = yield* fn(input);
                    onSuccess?.(data, input);
                    setState(AsyncState.Success(data));
                    onSettled?.(input);
                    return data;
                }).pipe(
                    Effect.withSpan(B.spans.mutate),
                    Effect.catchAll((error: E) => {
                        onError?.(error, input);
                        setState(AsyncState.Failure(error));
                        onSettled?.(input);
                        return Effect.void;
                    }),
                ),
            );
        },
        [runtime, fn, onError, onSettled, onSuccess],
    );
    const reset = useCallback(() => {
        fiberRef.current && runtime.runFork(Fiber.interrupt(fiberRef.current));
        fiberRef.current = null;
        setState(AsyncState.Idle());
    }, [runtime]);
    return { isPending: AsyncState.isPending(state), mutate, reset, state };
};

// --- [EXPORT] ----------------------------------------------------------------

export type { MutateOptions, MutateState, RunOptions };
export { useEffectMutate, useEffectRun, useFiberCleanup };
