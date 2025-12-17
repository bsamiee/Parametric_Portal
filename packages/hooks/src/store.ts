/**
 * Store hooks bridging StoreSlice with React via useSyncExternalStore.
 */

import type { StoreActions, StoreSlice } from '@parametric-portal/types/stores';
import { Effect, Fiber, Stream, SubscriptionRef } from 'effect';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RuntimeApi } from './runtime.ts';

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

type StoreHooksApi<_R = never> = {
    readonly useStoreActions: <T, A extends Record<string, unknown>>(slice: StoreSlice<T, A>) => StoreActions<T> & A;
    readonly useStoreSelector: <T, S>(slice: StoreSlice<T>, selector: (state: T) => S) => S;
    readonly useStoreSlice: <T>(slice: StoreSlice<T>) => T;
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

const connectSliceToDevtools = <T>(slice: StoreSlice<T>, storeName: string): DevToolsConnection | null => {
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

const createUseStoreSlice =
    (enableDevtools: boolean, storeName: string) =>
    <T>(slice: StoreSlice<T>): T => {
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
    <T, A extends Record<string, unknown>>(slice: StoreSlice<T, A>): StoreActions<T> & A =>
        slice.actions;

const createUseStoreSelector =
    () =>
    <T, S>(slice: StoreSlice<T>, selector: (state: T) => S): S => {
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

            return () => {
                runtime ? void runtime.runPromise(Fiber.interrupt(fiber)) : Effect.runSync(Fiber.interrupt(fiber));
            };
        }, [ref, updateValue]);

        return value;
    };

// --- [ENTRY_POINT] -----------------------------------------------------------

const createStoreHooks = <R = never>(config: StoreHooksConfig<R> = {}): StoreHooksApi<R> => {
    const enableDevtools = config.enableDevtools ?? B.defaults.enableDevtools;
    const storeName = config.name ?? B.defaults.name;

    return Object.freeze({
        useStoreActions: createUseStoreActions(),
        useStoreSelector: createUseStoreSelector(),
        useStoreSlice: createUseStoreSlice(enableDevtools, storeName),
        useSubscriptionRef: createUseSubscriptionRef(config.runtimeApi),
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { DevToolsConnection, DevToolsExtension, DevToolsMessage, StoreHooksApi, StoreHooksConfig };
export { B as STORE_HOOKS_TUNING, createStoreHooks };
