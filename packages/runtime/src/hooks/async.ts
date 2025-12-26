/**
 * Bridge Effect execution with React state via managed fibers; unified async hooks: useQuery (declarative), useMutation (imperative).
 */
import { type AsyncState, async } from '@parametric-portal/types/async';
import { Effect, Fiber } from 'effect';
import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import { useRuntime } from '../runtime';

// --- [CONSTANTS] -------------------------------------------------------------

const asyncApi = async();

// --- [TYPES] -----------------------------------------------------------------

type QueryOptions<A, E> = {
    readonly enabled?: boolean;
    readonly onError?: (error: E) => void;
    readonly onSettled?: () => void;
    readonly onSuccess?: (data: A) => void;
};
type MutationOptions<A, I, E> = {
    readonly onError?: (error: E, input: I) => void;
    readonly onSettled?: (input: I) => void;
    readonly onSuccess?: (data: A, input: I) => void;
};
type MutationState<A, I, E> = {
    readonly mutate: (input: I) => void;
    readonly reset: () => void;
    readonly state: AsyncState<A, E>;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const useQuery = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    deps: DependencyList,
    options: QueryOptions<A, E> = {},
): AsyncState<A, E> => {
    const { enabled = true, onError, onSettled, onSuccess } = options;
    const runtime = useRuntime<R, never>();
    const [state, setState] = useState<AsyncState<A, E>>(asyncApi.idle);
    // biome-ignore lint/correctness/useExhaustiveDependencies: effect/callbacks intentionally excluded (identity changes on every render)
    useEffect(
        () =>
            enabled
                ? (() => {
                      setState(asyncApi.loading());
                      const fiber = runtime.runFork(
                          Effect.gen(function* () {
                              const data = yield* effect;
                              onSuccess?.(data);
                              setState(asyncApi.success(data));
                              onSettled?.();
                              return data;
                          }).pipe(
                              Effect.catchAll((error: E) => {
                                  onError?.(error);
                                  setState(asyncApi.failure(error));
                                  onSettled?.();
                                  return Effect.void;
                              }),
                          ),
                      );
                      return () => {
                          runtime.runFork(Fiber.interrupt(fiber));
                      };
                  })()
                : (() => {
                      setState(asyncApi.idle());
                  })(),
        [enabled, ...deps, runtime],
    );
    return state;
};
const useMutation = <A, I, E, R>(
    fn: (input: I) => Effect.Effect<A, E, R>,
    options: MutationOptions<A, I, E> = {},
): MutationState<A, I, E> => {
    const { onError, onSettled, onSuccess } = options;
    const runtime = useRuntime<R, never>();
    const [state, setState] = useState<AsyncState<A, E>>(asyncApi.idle);
    const fiberRef = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);
    const mutate = useCallback(
        (input: I) => {
            setState(asyncApi.loading());
            fiberRef.current = runtime.runFork(
                Effect.gen(function* () {
                    const data = yield* fn(input);
                    onSuccess?.(data, input);
                    setState(asyncApi.success(data));
                    onSettled?.(input);
                    return data;
                }).pipe(
                    Effect.catchAll((error: E) => {
                        onError?.(error, input);
                        setState(asyncApi.failure(error));
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
        setState(asyncApi.idle());
    }, [runtime]);
    useEffect(
        () => () => {
            fiberRef.current && runtime.runFork(Fiber.interrupt(fiberRef.current));
        },
        [runtime],
    );
    return { mutate, reset, state };
};

// --- [EXPORT] ----------------------------------------------------------------

export type { MutationOptions, MutationState, QueryOptions };
export { useMutation, useQuery };
