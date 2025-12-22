/**
 * Reactive store slices with subscription support.
 * Grounding: Zustand-style pub/sub with typed actions.
 */
import { Schema as S } from 'effect';

import type { BivariantFunction } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: Required for heterogeneous slice collections
type AnySlice = StoreSlice<any, Record<string, unknown>>;
type SliceRecord = Record<string, AnySlice>;

type SliceName = S.Schema.Type<typeof S.NonEmptyTrimmedString>;

type StoreActions<T> = {
    readonly reset: BivariantFunction<() => T>;
    readonly set: BivariantFunction<(value: T) => T>;
    readonly update: BivariantFunction<(updater: (prev: T) => T) => T>;
};

type StoreSlice<T, A extends Record<string, unknown> = Record<string, never>> = {
    readonly actions: StoreActions<T> & A;
    readonly getState: () => T;
    readonly initialState: T;
    readonly name: SliceName;
    readonly subscribe: BivariantFunction<(listener: (state: T) => void) => () => void>;
};

type SliceConfig<T, A extends Record<string, unknown> = Record<string, never>> = {
    readonly actions?: (set: (value: T) => void, get: () => T) => A;
    readonly initialState: T;
    readonly name: string;
};

type CombinedStore<S extends SliceRecord> = {
    readonly getState: () => { readonly [K in keyof S]: ReturnType<S[K]['getState']> };
    readonly slices: S;
    readonly subscribe: (
        listener: (state: { readonly [K in keyof S]: ReturnType<S[K]['getState']> }) => void,
    ) => () => void;
};

type StoreConfig = {
    readonly enableDevtools?: boolean;
    readonly name?: string;
};

type StoreApi = {
    readonly combineSlices: <S extends SliceRecord>(slices: S) => CombinedStore<S>;
    readonly createSlice: <T, A extends Record<string, unknown> = Record<string, never>>(
        config: SliceConfig<T, A>,
    ) => StoreSlice<T, A>;
    readonly schemas: typeof schemas;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: { enableDevtools: false, name: 'store' },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const SliceConfigSchema = <A extends S.Schema.Any>(stateSchema: A) =>
    S.Struct({
        initialState: stateSchema,
        name: S.NonEmptyTrimmedString,
    });

const schemas = Object.freeze({
    sliceConfig: SliceConfigSchema,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const mkSlice = <T, A extends Record<string, unknown> = Record<string, never>>(
    config: SliceConfig<T, A>,
): StoreSlice<T, A> => {
    const listeners = new Set<(state: T) => void>();
    const state = { current: config.initialState };

    const notify = (): void => {
        for (const listener of listeners) {
            listener(state.current);
        }
    };

    const set = (value: T): void => {
        state.current = value;
        notify();
    };

    const get = (): T => state.current;

    const baseActions: StoreActions<T> = {
        reset: () => {
            set(config.initialState);
            return config.initialState;
        },
        set: (value: T) => {
            set(value);
            return value;
        },
        update: (updater: (prev: T) => T) => {
            const next = updater(state.current);
            set(next);
            return next;
        },
    };

    const customActions = config.actions?.(set, get) ?? ({} as A);

    return {
        actions: { ...baseActions, ...customActions } as StoreActions<T> & A,
        getState: get,
        initialState: config.initialState,
        name: config.name,
        subscribe: (listener: (state: T) => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
};

const mkCombinedStore = <S extends SliceRecord>(slices: S): CombinedStore<S> => {
    const listeners = new Set<(state: { readonly [K in keyof S]: ReturnType<S[K]['getState']> }) => void>();

    const getState = (): { readonly [K in keyof S]: ReturnType<S[K]['getState']> } =>
        Object.fromEntries(Object.entries(slices).map(([key, slice]) => [key, slice.getState()])) as {
            readonly [K in keyof S]: ReturnType<S[K]['getState']>;
        };

    const notify = (): void => {
        const state = getState();
        for (const listener of listeners) {
            listener(state);
        }
    };

    for (const slice of Object.values(slices)) {
        slice.subscribe(() => notify());
    }

    return {
        getState,
        slices,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const store = (_config: StoreConfig = {}): StoreApi =>
    Object.freeze({
        combineSlices: <S extends SliceRecord>(slices: S) => mkCombinedStore(slices),
        createSlice: <T, A extends Record<string, unknown> = Record<string, never>>(sliceConfig: SliceConfig<T, A>) =>
            mkSlice(sliceConfig),
        schemas,
    } as StoreApi);

// --- [EXPORT] ----------------------------------------------------------------

export { B as STORE_TUNING, store };
export type { CombinedStore, SliceConfig, SliceName, StoreActions, StoreApi, StoreConfig, StoreSlice };
