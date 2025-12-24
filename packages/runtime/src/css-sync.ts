/**
 * CSS variable synchronization for Tailwind v4 - syncs Zustand store state to DOM CSS variables via subscription.
 */
import { types } from '@parametric-portal/types/types';
import { Option, pipe } from 'effect';
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
type SyncPayload = {
    readonly entries: ReadonlyArray<readonly [string, string]>;
    readonly prefix?: string;
    readonly root: HTMLElement;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        prefix: 'app',
        root: () => document.documentElement,
    },
} as const);
const typesApi = types();

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const validatePrefix = (prefix: string): string =>
    pipe(
        Option.liftPredicate(prefix, typesApi.guards.htmlId),
        Option.getOrElse(() => {
            console.warn(`[css-sync] Invalid prefix "${prefix}", using default`);
            return B.defaults.prefix;
        }),
    );
const toEntries = (classes: ReadonlyArray<string>): ReadonlyArray<readonly [string, string]> =>
    classes.map((c) => [c, ''] as const);
const syncVariables = <T>(
    root: HTMLElement,
    state: T,
    prefix: string,
    selector: Option.Option<(state: T) => Record<string, string>>,
): void => {
    pipe(
        selector,
        Option.map((sel) => syncHandlers.variables({ entries: Object.entries(sel(state)), prefix, root })),
    );
};
const syncClassNames = <T>(
    root: HTMLElement,
    state: T,
    classNames: Option.Option<(state: T) => ClassNameResult>,
): void => {
    pipe(
        classNames,
        Option.map((fn) => fn(state)),
        Option.map((result) =>
            (['add', 'remove'] as const).map((op) =>
                pipe(
                    Option.fromNullable(result[op]),
                    Option.map((arr) => classNameDispatch[op]({ entries: toEntries(arr), prefix: '', root })),
                ),
            ),
        ),
    );
};

// --- [DISPATCH_TABLES] -------------------------------------------------------

const syncHandlers = {
    classesAdd: ({ entries, root }: SyncPayload) => entries.map(([cn]) => root.classList.add(cn)),
    classesRemove: ({ entries, root }: SyncPayload) => entries.map(([cn]) => root.classList.remove(cn)),
    variables: ({ entries, prefix = '', root }: SyncPayload) =>
        entries.map(([key, value]) => root.style.setProperty(`--${prefix}-${key}`, value)),
} as const;
const classNameDispatch = {
    add: syncHandlers.classesAdd,
    remove: syncHandlers.classesRemove,
} as const satisfies Record<keyof ClassNameResult, (payload: SyncPayload) => ReadonlyArray<void>>;

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
