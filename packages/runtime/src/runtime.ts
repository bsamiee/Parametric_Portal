/**
 * Bridge Effect ManagedRuntime to React context.
 * Provides unified Runtime object with UI coordination (FloatingDelayGroup).
 * CSS variable readers exported for component hooks (floating, toast).
 */
import { FloatingDelayGroup, FloatingTree } from '@floating-ui/react';
import { type Layer, ManagedRuntime, Option } from 'effect';
import { createContext, createElement, type ReactNode, useContext, useEffect, useMemo } from 'react';

// --- [TYPES] -----------------------------------------------------------------

type ProviderProps<R, E> = {
    readonly children: ReactNode;
    readonly disposeOnUnmount?: boolean;
    readonly runtime: ManagedRuntime.ManagedRuntime<R, E>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    cssVars: Object.freeze({
        floatingDelay: Object.freeze({
            close: '--tooltip-group-close-delay',
            open: '--tooltip-group-open-delay',
            timeout: '--tooltip-group-timeout',
        }),
    }),
} as const);
// biome-ignore lint/suspicious/noExplicitAny: Generic context requires any for React Context variance
const ctx = createContext<ManagedRuntime.ManagedRuntime<any, any> | null>(null);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

const readCssVar = (name: string): string => {
    const root = globalThis.document?.documentElement;
    return root === undefined ? '' : getComputedStyle(root).getPropertyValue(name).trim();
};
const readCssMs = (name: string): number => {
    const parsed = Number.parseInt(readCssVar(name).replace('ms', ''), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
};
const readCssPx = (name: string): number => {
    const parsed = Number.parseFloat(readCssVar(name).replace('px', ''));
    return Number.isNaN(parsed) ? 0 : parsed;
};
const readCssInt = (name: string): number => {
    const parsed = Number.parseInt(readCssVar(name), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
};
const Provider = <R, E>({ children, disposeOnUnmount, runtime }: ProviderProps<R, E>): ReactNode => {
    const floatingConfig = useMemo(
        () => ({
            close: readCssMs(B.cssVars.floatingDelay.close),
            open: readCssMs(B.cssVars.floatingDelay.open),
            timeout: readCssMs(B.cssVars.floatingDelay.timeout),
        }),
        [],
    );
    useEffect(
        () =>
            disposeOnUnmount
                ? () => {
                      runtime.dispose();
                  }
                : undefined,
        [disposeOnUnmount, runtime],
    );
    return createElement(
        ctx.Provider,
        { value: runtime },
        createElement(
            FloatingTree,
            null,
            createElement(
                FloatingDelayGroup,
                {
                    delay: { close: floatingConfig.close, open: floatingConfig.open },
                    timeoutMs: floatingConfig.timeout,
                },
                children,
            ),
        ),
    );
};
const useRuntimeHook = <R = unknown, E extends never = never>(): ManagedRuntime.ManagedRuntime<R, E> =>
    Option.fromNullable(useContext(ctx)).pipe(
        Option.getOrThrowWith(() => new Error('Runtime.use must be called within Runtime.Provider')),
    ) as ManagedRuntime.ManagedRuntime<R, E>;
const make = <R, E>(layer: Layer.Layer<R, E, never>): ManagedRuntime.ManagedRuntime<R, E> => ManagedRuntime.make(layer);

// --- [ENTRY_POINT] -----------------------------------------------------------

const Runtime = Object.freeze({
    make,
    Provider,
    use: useRuntimeHook,
});

// --- [EXPORT] ----------------------------------------------------------------

export { B as RUNTIME_TUNING, clamp, readCssInt, readCssMs, readCssPx, readCssVar, Runtime };
export type { ProviderProps as RuntimeProviderProps };
