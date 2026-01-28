/**
 * Bridge Effect execution to React state via managed fibers with auto-cleanup.
 */
import { AsyncState } from '@parametric-portal/types/async';
import { Effect, Fiber, type ManagedRuntime } from 'effect';
import { type DependencyList, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Runtime } from '../runtime';

// --- [TYPES] -----------------------------------------------------------------

type FiberRef = RefObject<Fiber.RuntimeFiber<unknown, unknown> | null>;
type MutateActions<I> = { readonly mutate: (input: I) => void; readonly reset: () => void };
type AsyncHookReturn<A, E, Actions extends object> = { readonly state: AsyncState.Of<A, E> } & Actions;
type MutateState<A, I, E> = AsyncHookReturn<A, E, MutateActions<I>>;
type RunOptions<A, E> = {
    readonly enabled?: boolean;
    readonly onError?: (e: E) => void;
    readonly onSettled?: () => void;
    readonly onSuccess?: (a: A) => void;
};
type MutateOptions<A, I, E> = {
    readonly onError?: (e: E, i: I) => void;
    readonly onSettled?: (i: I) => void;
    readonly onSuccess?: (a: A, i: I) => void;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const makeCallbacks = <A, E>(
    set: (state: AsyncState.Of<A, E>) => void,
    onSuccess?: (a: A) => void,
    onError?: (e: E) => void,
    onSettled?: () => void,
) =>
    ({
        onErr: (e: E): void => {
            onError?.(e);
            set(AsyncState.failure(e));
            onSettled?.();
        },
        onOk: (a: A): void => {
            onSuccess?.(a);
            set(AsyncState.success(a));
            onSettled?.();
        },
    }) as const;
const runFiber = <A, E, R>(
    rt: ManagedRuntime.ManagedRuntime<R, never>,
    ref: FiberRef,
    effect: Effect.Effect<A, E, R>,
    onOk: (a: A) => void,
    onErr: (e: E) => void,
    span: string,
): void => {
    // biome-ignore lint/style/noParameterAssign: React ref mutation pattern
    ref.current = rt.runFork(
        effect.pipe(
            Effect.tap((a) => Effect.sync(() => onOk(a))),
            Effect.withSpan(span),
            Effect.catchAll((e: E) => Effect.sync(() => onErr(e))),
        ),
    );
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const useEffectRun = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    deps: DependencyList,
    opts: RunOptions<A, E> = {},
): AsyncState.Of<A, E> => {
    const { enabled = true, onError, onSettled, onSuccess } = opts;
    const rt = Runtime.use<R, never>();
    const [asyncState, setAsyncState] = useState<AsyncState.Of<A, E>>(AsyncState.idle());
    const ref = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);
    useEffect(
        () => () => {
            ref.current && rt.runFork(Fiber.interrupt(ref.current));
        },
        [rt],
    );
    // biome-ignore lint/correctness/useExhaustiveDependencies: effect/callbacks identity changes
    useEffect(() => {
        ref.current && rt.runFork(Fiber.interrupt(ref.current));
        setAsyncState(enabled ? AsyncState.loading() : AsyncState.idle());
        const cbs = enabled ? makeCallbacks(setAsyncState, onSuccess, onError, onSettled) : null;
        cbs && runFiber(rt, ref, effect, cbs.onOk, cbs.onErr, 'effect-run');
    }, [enabled, ...deps, rt]);
    return asyncState;
};
const useEffectMutate = <A, I, E, R>(
    fn: (i: I) => Effect.Effect<A, E, R>,
    opts: MutateOptions<A, I, E> = {},
): MutateState<A, I, E> => {
    const { onError, onSettled, onSuccess } = opts;
    const rt = Runtime.use<R, never>();
    const [asyncState, setAsyncState] = useState<AsyncState.Of<A, E>>(AsyncState.idle());
    const ref = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);
    useEffect(
        () => () => {
            ref.current && rt.runFork(Fiber.interrupt(ref.current));
        },
        [rt],
    );
    const mutate = useCallback(
        (i: I) => {
            ref.current && rt.runFork(Fiber.interrupt(ref.current));
            setAsyncState(AsyncState.loading());
            const { onErr, onOk } = makeCallbacks(
                setAsyncState,
                onSuccess ? (a: A) => onSuccess(a, i) : undefined,
                onError ? (e: E) => onError(e, i) : undefined,
                onSettled ? () => onSettled(i) : undefined,
            );
            runFiber(rt, ref, fn(i), onOk, onErr, 'effect-mutate');
        },
        [rt, fn, onError, onSettled, onSuccess],
    );
    const reset = useCallback(() => {
        ref.current && rt.runFork(Fiber.interrupt(ref.current));
        ref.current = null;
        setAsyncState(AsyncState.idle());
    }, [rt]);
    return { mutate, reset, state: asyncState };
};

// --- [EXPORT] ----------------------------------------------------------------

export type { AsyncHookReturn, MutateActions, MutateOptions, MutateState, RunOptions };
export { useEffectMutate, useEffectRun };
