/**
 * Sync Zustand store state to DOM CSS variables via subscription.
 */
import { HtmlId } from '@parametric-portal/types/types';
import { Schema as S } from 'effect';
import { useCallback, useEffect, useMemo } from 'react';
import type { StoreApi } from 'zustand';

// --- [TYPES] -----------------------------------------------------------------

type ClassNameResult = { readonly add?: ReadonlyArray<string>; readonly remove?: ReadonlyArray<string> };
type CssSyncConfig<T> = {
    readonly classNames?: (state: T) => ClassNameResult;
    readonly prefix?: string;
    readonly root?: () => HTMLElement;
    readonly selector?: (state: T) => Record<string, string>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = {
    defaults: {
        prefix: 'app',
        root: () => document.documentElement,
    },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const validatePrefix = (prefix: string): string => {
    S.is(HtmlId)(prefix) || console.warn(`[css-sync] Invalid prefix "${prefix}", using default`);
    return S.is(HtmlId)(prefix) ? prefix : B.defaults.prefix;
};
const syncVariables = <T>(
    root: HTMLElement,
    state: T,
    prefix: string,
    selector: ((s: T) => Record<string, string>) | undefined,
): void => {
    selector &&
        Object.entries(selector(state)).forEach(([k, v]) => {
            root.style.setProperty(`--${prefix}-${k}`, v);
        });
};
const syncClassNames = <T>(root: HTMLElement, state: T, classNames: ((s: T) => ClassNameResult) | undefined): void => {
    classNames &&
        ((result: ClassNameResult) => {
            (result.add ?? []).forEach((c) => {
                root.classList.add(c);
            });
            (result.remove ?? []).forEach((c) => {
                root.classList.remove(c);
            });
        })(classNames(state));
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const useCssSync = <T extends object>(
    store: Pick<StoreApi<T>, 'getState' | 'subscribe'>,
    config: CssSyncConfig<T>,
): void => {
    const { classNames, prefix = B.defaults.prefix, root = B.defaults.root, selector } = config;
    const validatedPrefix = useMemo(() => validatePrefix(prefix), [prefix]);
    const rootStable = useCallback(root, []);
    useEffect(() => {
        const rootEl = rootStable();
        const sync = (state: T): void => {
            syncVariables(rootEl, state, validatedPrefix, selector);
            syncClassNames(rootEl, state, classNames);
        };
        sync(store.getState());
        return store.subscribe(sync);
    }, [classNames, rootStable, selector, store, validatedPrefix]);
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as CSS_SYNC_TUNING, useCssSync };
export type { CssSyncConfig };
