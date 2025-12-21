/**
 * Bridge StoreSlice with React via useSyncExternalStore.
 */

import type { StoreActions, StoreSlice } from '@parametric-portal/types/stores';
import { Effect, Fiber, Stream, SubscriptionRef } from 'effect';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RuntimeApi } from './runtime';

// --- [TYPES] -----------------------------------------------------------------

type DevToolsConnection = {
    readonly init: (state: unknown) => void;
    readonly send: (action: { readonly type: string }, state: unknown) => void;
    readonly subscribe: (listener: (message: DevToolsMessage) => void) => () => void;
};

type DevToolsMessage = {
    readonly payload?: { readonly type: string };
    readonly state?: string;
    readonly type: string;
};

type DevToolsExtension = {
    readonly connect: (options: { readonly name: string }) => DevToolsConnection;
};

type PersistOptions<T = unknown> = {
    readonly debounceMs?: number;
    readonly migrate?: (stored: unknown, initialState: T) => T;
    readonly onError?: (error: unknown) => void;
};

type StoreHooksApi<_R = never> = {
    readonly usePersist: <T, A extends Record<string, unknown> = Record<string, never>>(
        slice: StoreSlice<T, A>,
        key: string,
        options?: PersistOptions<T>,
    ) => void;
    readonly useStoreActions: <T, A extends Record<string, unknown> = Record<string, never>>(
        slice: StoreSlice<T, A>,
    ) => StoreActions<T> & A;
    readonly useStoreSelector: <T, S, A extends Record<string, unknown> = Record<string, never>>(
        slice: StoreSlice<T, A>,
        selector: (state: T) => S,
    ) => S;
    readonly useStoreSlice: <T, A extends Record<string, unknown> = Record<string, never>>(
        slice: StoreSlice<T, A>,
    ) => T;
    readonly useSubscriptionRef: <A>(ref: SubscriptionRef.SubscriptionRef<A>) => A;
};

type StoreHooksConfig<R = never> = {
    readonly enableDevtools?: boolean;
    readonly name?: string;
    readonly runtimeApi?: RuntimeApi<R, never>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        enableDevtools: false,
        name: 'StoreHooks',
        persistDebounceMs: 300,
    },
    devtools: {
        actionTypes: {
            init: '@@INIT',
            update: 'UPDATE',
        },
    },
} as const);

const connectedSlices = new WeakMap<StoreSlice<unknown>, DevToolsConnection>();

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const getDevToolsExtension = (): DevToolsExtension | null =>
    globalThis.window === undefined
        ? null
        : // biome-ignore lint/style/useNamingConvention: External Redux DevTools API uses __REDUX_DEVTOOLS_EXTENSION__
          ((globalThis as unknown as { __REDUX_DEVTOOLS_EXTENSION__?: DevToolsExtension })
              .__REDUX_DEVTOOLS_EXTENSION__ ?? null);

const connectSliceToDevtools = <T, A extends Record<string, unknown> = Record<string, never>>(
    slice: StoreSlice<T, A>,
    storeName: string,
): DevToolsConnection | null => {
    const extension = getDevToolsExtension();
    if (extension === null) {
        return null;
    }

    const existing = connectedSlices.get(slice as StoreSlice<unknown>);
    if (existing) {
        return existing;
    }

    const connection = extension.connect({ name: `${storeName}/${slice.name}` });
    connection.init(slice.getState());
    connectedSlices.set(slice as StoreSlice<unknown>, connection);

    return connection;
};

const mkValueUpdater =
    <A>(setValue: React.Dispatch<React.SetStateAction<A>>) =>
    (a: A) =>
        Effect.sync(() => setValue(a));

const interruptFiberSync = <A, E>(fiber: Fiber.RuntimeFiber<A, E>): void => {
    Effect.runSync(Fiber.interrupt(fiber));
};

const interruptFiberAsync = <A, E, R>(
    runtime: { runPromise: (effect: Effect.Effect<unknown, unknown, R>) => Promise<unknown> },
    fiber: Fiber.RuntimeFiber<A, E>,
): void => void runtime.runPromise(Fiber.interrupt(fiber)).catch(() => {});

const createUseStoreSlice =
    (enableDevtools: boolean, storeName: string) =>
    <T, A extends Record<string, unknown> = Record<string, never>>(slice: StoreSlice<T, A>): T => {
        const connectionRef = useRef<DevToolsConnection | null>(null);

        // biome-ignore lint/correctness/useExhaustiveDependencies: enableDevtools and storeName are stable factory closure captures
        useEffect(() => {
            if (enableDevtools && connectionRef.current === null) {
                connectionRef.current = connectSliceToDevtools(slice, storeName);
            }

            const connection = connectionRef.current;
            if (connection === null) {
                return slice.subscribe(() => {});
            }

            const unsubscribe = slice.subscribe((state) => {
                connection.send({ type: `${slice.name}/${B.devtools.actionTypes.update}` }, state);
            });

            return unsubscribe;
        }, [slice]);

        return useSyncExternalStore(slice.subscribe, slice.getState, slice.getState);
    };

const createUseStoreActions =
    () =>
    <T, A extends Record<string, unknown> = Record<string, never>>(slice: StoreSlice<T, A>): StoreActions<T> & A =>
        slice.actions;

const createUseStoreSelector =
    () =>
    <T, S, A extends Record<string, unknown> = Record<string, never>>(
        slice: StoreSlice<T, A>,
        selector: (state: T) => S,
    ): S => {
        const getSnapshot = useCallback(() => selector(slice.getState()), [slice, selector]);
        return useSyncExternalStore(slice.subscribe, getSnapshot, getSnapshot);
    };

const createUseSubscriptionRef =
    <R>(runtimeApi?: RuntimeApi<R, never>) =>
    <A>(ref: SubscriptionRef.SubscriptionRef<A>): A => {
        const [value, setValue] = useState<A>(() => Effect.runSync(SubscriptionRef.get(ref)));
        const updateValue = mkValueUpdater(setValue);

        // biome-ignore lint/correctness/useExhaustiveDependencies: runtimeApi is stable factory closure capture
        useEffect(() => {
            const getRuntime = runtimeApi?.useRuntime;
            const runtime = getRuntime?.();
            const streamEffect = Stream.runForEach(ref.changes, updateValue);
            const fiber = runtime?.runFork(streamEffect) ?? Effect.runFork(streamEffect);

            return () => (runtime === undefined ? interruptFiberSync(fiber) : interruptFiberAsync(runtime, fiber));
        }, [ref, updateValue]);

        return value;
    };

const usePersist = <T, A extends Record<string, unknown> = Record<string, never>>(
    slice: StoreSlice<T, A>,
    key: string,
    options?: PersistOptions<T>,
): void => {
    const debounceMs = options?.debounceMs ?? B.defaults.persistDebounceMs;
    const migrate = options?.migrate;
    const errorHandler =
        options?.onError ??
        ((error: unknown) => {
            globalThis.console?.error?.(`[StorePersist:${key}]`, error);
        });
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        // SSR guard
        if (globalThis.window === undefined) {
            return;
        }

        // Effect-compatible error wrapper defined inside effect to avoid dep issues
        const wrapError = (error: unknown) => Effect.sync(() => errorHandler(error));

        // Hydrate on mount - merge with initialState to handle schema evolution
        const stored = localStorage.getItem(key);
        const handleParsed = (value: unknown) => {
            const next = migrate
                ? migrate(value, slice.initialState)
                : ({ ...slice.initialState, ...(value as Partial<T>) } as T);
            slice.actions.set(next);
        };
        stored !== null &&
            Effect.runSync(
                Effect.try(() => JSON.parse(stored) as unknown).pipe(
                    Effect.match({
                        onFailure: errorHandler,
                        onSuccess: handleParsed,
                    }),
                ),
            );

        // Persist handler - Effect wraps localStorage for error resilience
        const persistState = (state: T) =>
            Effect.runSync(
                Effect.sync(() => localStorage.setItem(key, JSON.stringify(state))).pipe(Effect.catchAll(wrapError)),
            );

        const unsubscribe = slice.subscribe((state) => {
            timeoutRef.current !== null && clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(persistState, debounceMs, state);
        });

        return () => {
            timeoutRef.current !== null && clearTimeout(timeoutRef.current);
            unsubscribe();
        };
    }, [slice, key, debounceMs, migrate, errorHandler]);
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createStoreHooks = <R = never>(config: StoreHooksConfig<R> = {}): StoreHooksApi<R> => {
    const enableDevtools = config.enableDevtools ?? B.defaults.enableDevtools;
    const storeName = config.name ?? B.defaults.name;

    return Object.freeze({
        usePersist,
        useStoreActions: createUseStoreActions(),
        useStoreSelector: createUseStoreSelector(),
        useStoreSlice: createUseStoreSlice(enableDevtools, storeName),
        useSubscriptionRef: createUseSubscriptionRef(config.runtimeApi),
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { DevToolsConnection, DevToolsExtension, DevToolsMessage, PersistOptions, StoreHooksApi, StoreHooksConfig };
export { B as STORE_HOOKS_TUNING, createStoreHooks };
