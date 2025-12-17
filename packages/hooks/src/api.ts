/**
 * API hooks bridging ApiResponse with React for queries and mutations.
 */

import type { ApiResponse } from '@parametric-portal/types/api';
import { ASYNC_TUNING, type AsyncState, mkIdle, mkLoading } from '@parametric-portal/types/async';
import { type Effect, Fiber } from 'effect';
import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import { interruptFiber, type StateSetter, wrapEffect } from './async.ts';
import type { RuntimeApi } from './runtime.ts';

// --- [TYPES] -----------------------------------------------------------------

type MutationState<T, I, E> = {
    readonly mutate: (input: I) => void;
    readonly reset: () => void;
    readonly state: AsyncState<ApiResponse<T>, E>;
};

type ApiHooksApi<R> = {
    readonly useApiMutation: <T, I, E>(fn: (input: I) => Effect.Effect<ApiResponse<T>, E, R>) => MutationState<T, I, E>;
    readonly useApiQuery: <T, E>(
        effect: Effect.Effect<ApiResponse<T>, E, R>,
        deps: DependencyList,
    ) => AsyncState<ApiResponse<T>, E>;
};

type ApiHooksConfig = {
    readonly timestampProvider?: () => number;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        timestamp: ASYNC_TUNING.timestamp,
    },
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const createApiHooks = <R, E>(runtimeApi: RuntimeApi<R, E>, config: ApiHooksConfig = {}): ApiHooksApi<R> => {
    const { useRuntime } = runtimeApi;
    const ts = config.timestampProvider ?? B.defaults.timestamp;

    const useApiQuery = <T, Err>(
        effect: Effect.Effect<ApiResponse<T>, Err, R>,
        deps: DependencyList,
    ): AsyncState<ApiResponse<T>, Err> => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<ApiResponse<T>, Err>>(mkIdle);

        useEffect(() => {
            setState(mkLoading(ts));
            const fiber = runtime.runFork(wrapEffect(effect, setState as StateSetter<ApiResponse<T>, Err>, ts));
            return interruptFiber(runtime, fiber);
            // biome-ignore lint/correctness/useExhaustiveDependencies: deps is intentionally dynamic for caller control
        }, deps);

        return state;
    };

    const useApiMutation = <T, I, Err>(
        fn: (input: I) => Effect.Effect<ApiResponse<T>, Err, R>,
    ): MutationState<T, I, Err> => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<ApiResponse<T>, Err>>(mkIdle);
        const fiberRef = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);

        const mutate = useCallback(
            (input: I) => {
                setState(mkLoading(ts));
                fiberRef.current = runtime.runFork(
                    wrapEffect(fn(input), setState as StateSetter<ApiResponse<T>, Err>, ts),
                );
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

        return { mutate, reset, state };
    };

    return Object.freeze({
        useApiMutation,
        useApiQuery,
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { ApiHooksApi, ApiHooksConfig, MutationState };
export { B as API_HOOKS_TUNING, createApiHooks };
