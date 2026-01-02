/**
 * CSS variable synchronization for Tailwind v4 - syncs Zustand store state to DOM CSS variables via subscription.
 */
import { HtmlId } from '@parametric-portal/types/types';
import { Option } from 'effect';
import { useCallback, useEffect, useMemo } from 'react';
import type { StoreApi } from 'zustand';

// --- [TYPES] -----------------------------------------------------------------

type ClassNameResult = {
    readonly add?: ReadonlyArray<string>;
    readonly remove?: ReadonlyArray<string>;
};
type CssSyncConfig<T> = {
    readonly classNames?: (state: T) => ClassNameResult;
    readonly prefix?: string;
    readonly root?: () => HTMLElement;
    readonly selector?: (state: T) => Record<string, string>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        prefix: 'app',
        root: () => document.documentElement,
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const validatePrefix = (prefix: string): string => {
    HtmlId.is(prefix) || console.warn(`[css-sync] Invalid prefix "${prefix}", using default`);
    return HtmlId.is(prefix) ? prefix : B.defaults.prefix;
};
const syncVariables = <T>(
    root: HTMLElement,
    state: T,
    prefix: string,
    sel: Option.Option<(s: T) => Record<string, string>>,
): void =>
    Option.match(sel, {
        onNone: () => {},
        onSome: (fn) => {
            Object.entries(fn(state)).forEach(([k, v]) => {
                root.style.setProperty(`--${prefix}-${k}`, v);
            });
        },
    });
const syncClassNames = <T>(root: HTMLElement, state: T, classNames: Option.Option<(s: T) => ClassNameResult>): void =>
    Option.match(classNames, {
        onNone: () => {},
        onSome: (fn) => {
            const result = fn(state);
            (result.add ?? []).forEach((c) => {
                root.classList.add(c);
            });
            (result.remove ?? []).forEach((c) => {
                root.classList.remove(c);
            });
        },
    });

// --- [ENTRY_POINT] -----------------------------------------------------------

const useCssSync = <T extends object>(
    store: Pick<StoreApi<T>, 'getState' | 'subscribe'>,
    config: CssSyncConfig<T>,
): void => {
    const { classNames, prefix = B.defaults.prefix, root = B.defaults.root, selector } = config;
    const validatedPrefix = useMemo(() => validatePrefix(prefix), [prefix]);
    const selectorOpt = useMemo(() => Option.fromNullable(selector), [selector]);
    const classNamesOpt = useMemo(() => Option.fromNullable(classNames), [classNames]);
    const rootStable = useCallback(root, []);
    useEffect(() => {
        const rootEl = rootStable();
        const sync = (state: T): void => {
            syncVariables(rootEl, state, validatedPrefix, selectorOpt);
            syncClassNames(rootEl, state, classNamesOpt);
        };
        sync(store.getState());
        return store.subscribe(sync);
    }, [classNamesOpt, rootStable, selectorOpt, store, validatedPrefix]);
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as CSS_SYNC_TUNING, useCssSync };
export type { CssSyncConfig };
