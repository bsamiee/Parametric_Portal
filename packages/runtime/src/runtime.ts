/**
 * Bridge Effect ManagedRuntime to React context.
 * Provides unified Runtime object for Layer composition and hook consumption.
 */
import { type Layer, ManagedRuntime, Option } from 'effect';
import { createContext, createElement, type ReactNode, useContext } from 'react';

// --- [TYPES] -----------------------------------------------------------------

type ProviderProps<R, E> = {
    readonly children: ReactNode;
    readonly runtime: ManagedRuntime.ManagedRuntime<R, E>;
};

// --- [CONSTANTS] -------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: Generic context requires any for React Context variance
const ctx = createContext<ManagedRuntime.ManagedRuntime<any, any> | null>(null);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const provider = <R, E>({ children, runtime }: ProviderProps<R, E>): ReactNode =>
    createElement(ctx.Provider, { value: runtime }, children);
const useRuntimeHook = <R = unknown, E extends never = never>(): ManagedRuntime.ManagedRuntime<R, E> =>
    Option.fromNullable(useContext(ctx)).pipe(
        Option.getOrThrowWith(() => new Error('Runtime.use must be called within Runtime.Provider')),
    ) as ManagedRuntime.ManagedRuntime<R, E>;
const make = <R, E>(layer: Layer.Layer<R, E, never>): ManagedRuntime.ManagedRuntime<R, E> => ManagedRuntime.make(layer);

// --- [ENTRY_POINT] -----------------------------------------------------------

const Runtime = Object.freeze({
    make,
    Provider: provider,
    use: useRuntimeHook,
});

// --- [EXPORT] ----------------------------------------------------------------

export type { ProviderProps as RuntimeProviderProps };
export { Runtime };
