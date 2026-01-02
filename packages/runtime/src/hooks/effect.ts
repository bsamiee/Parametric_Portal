/**
 * Bridge Effect execution with React state via managed fibers.
 * - useEffectRun: Declarative effect execution with auto-cleanup
 * - useEffectMutate: Imperative effect execution with manual trigger
 * - useEffectBoundary: Effect execution with Cause exposure for ErrorBoundary
 */
import {
    type AsyncHookReturn,
    AsyncState,
    type BoundaryActions,
    type MutateActions,
} from '@parametric-portal/types/async';
import { Cause, Effect, Exit, Fiber } from 'effect';
import {
    type ComponentType,
    type DependencyList,
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';
import { useRuntime } from '../runtime';

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
type MutateState<A, I, E> = AsyncHookReturn<A, E, MutateActions<I>>;
type BoundaryState<A, E> = AsyncHookReturn<A, E, BoundaryActions<E>>;
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

const B = Object.freeze({
    spans: {
        awaitMatch: 'effect-await-match',
        boundary: 'effect-boundary',
        mutate: 'effect-mutate',
        run: 'effect-run',
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const awaitAndMatch = <A, E>(
    fiber: Fiber.RuntimeFiber<A, E>,
    onFailure: (cause: Cause.Cause<E>) => void,
    onSuccess: (data: A) => void,
): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
        const exit = yield* Fiber.await(fiber);
        Exit.match(exit, { onFailure, onSuccess });
    }).pipe(Effect.withSpan(B.spans.awaitMatch));

// --- [ENTRY_POINT] -----------------------------------------------------------

const useEffectRun = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    deps: DependencyList,
    options: RunOptions<A, E> = {},
): AsyncState<A, E> => {
    const { enabled = true, onError, onSettled, onSuccess } = options;
    const runtime = useRuntime<R, never>();
    const [state, setState] = useState<AsyncState<A, E>>(AsyncState.Idle);
    // biome-ignore lint/correctness/useExhaustiveDependencies: effect/callbacks intentionally excluded (identity changes on every render)
    useEffect(() => {
        setState(enabled ? AsyncState.Loading() : AsyncState.Idle());
        const fiber = enabled
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
        return () => {
            fiber && runtime.runFork(Fiber.interrupt(fiber));
        };
    }, [enabled, ...deps, runtime]);
    return state;
};
const useEffectMutate = <A, I, E, R>(
    fn: (input: I) => Effect.Effect<A, E, R>,
    options: MutateOptions<A, I, E> = {},
): MutateState<A, I, E> => {
    const { onError, onSettled, onSuccess } = options;
    const runtime = useRuntime<R, never>();
    const [state, setState] = useState<AsyncState<A, E>>(AsyncState.Idle);
    const fiberRef = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);
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
    useEffect(
        () => () => {
            fiberRef.current && runtime.runFork(Fiber.interrupt(fiberRef.current));
        },
        [runtime],
    );
    return { mutate, reset, state };
};

const useEffectBoundary = <A, E, R>(effect: Effect.Effect<A, E, R>, deps: DependencyList): BoundaryState<A, E> => {
    const runtime = useRuntime<R, never>();
    const [state, setState] = useState<AsyncState<A, E>>(AsyncState.Idle);
    const [error, setError] = useState<Cause.Cause<E> | null>(null);
    const reset = useCallback(() => {
        setError(null);
        setState(AsyncState.Idle());
    }, []);
    useEffect(() => {
        setState(AsyncState.Loading());
        const fiber = runtime.runFork(effect);
        runtime.runFork(
            awaitAndMatch(
                fiber,
                (cause) => {
                    setError(cause);
                    setState(AsyncState.Failure(Cause.squash(cause) as E));
                },
                (data) => {
                    setError(null);
                    setState(AsyncState.Success(data));
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

export type { BoundaryState, EffectErrorBoundaryProps, ErrorFallbackProps, MutateOptions, MutateState, RunOptions };
export { useEffectBoundary, useEffectMutate, useEffectRun };
