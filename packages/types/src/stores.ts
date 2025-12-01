/**
 * Define store slice contracts via typed patterns: StoreSlice, StoreActions, CombinedStore with subscription management.
 */
import { Schema as S } from '@effect/schema';
import { Effect, Option, pipe } from 'effect';
import { match, P } from 'ts-pattern';

// --- Types -------------------------------------------------------------------

type SliceName = S.Schema.Type<typeof SliceNameSchema>;

type StoreActions<T> = {
    readonly reset: () => T;
    readonly set: (value: T) => T;
    readonly update: (updater: (prev: T) => T) => T;
};

type StoreSlice<T, A extends Record<string, unknown> = Record<string, never>> = {
    readonly actions: StoreActions<T> & A;
    readonly getState: () => T;
    readonly initialState: T;
    readonly name: SliceName;
    readonly subscribe: (listener: (state: T) => void) => () => void;
};

type SliceConfig<T, A extends Record<string, unknown> = Record<string, never>> = {
    readonly actions?: (set: (value: T) => void, get: () => T) => A;
    readonly initialState: T;
    readonly name: string;
};

type CombinedStore<S extends Record<string, StoreSlice<unknown>>> = {
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
    readonly combineSlices: <S extends Record<string, StoreSlice<unknown>>>(slices: S) => CombinedStore<S>;
    readonly createSlice: <T, A extends Record<string, unknown> = Record<string, never>>(
        config: SliceConfig<T, A>,
    ) => StoreSlice<T, A>;
    readonly match: typeof match;
    readonly Option: typeof Option;
    readonly P: typeof P;
    readonly schemas: typeof schemas;
};

// --- Constants ---------------------------------------------------------------

const B = Object.freeze({
    defaults: { enableDevtools: false, name: 'store' },
} as const);

// --- Schema ------------------------------------------------------------------

const SliceNameSchema = pipe(S.String, S.nonEmptyString(), S.brand('SliceName'));

const SliceConfigSchema = <A extends S.Schema.Any>(stateSchema: A) =>
    S.Struct({
        initialState: stateSchema,
        name: S.String,
    });

const schemas = Object.freeze({
    sliceConfig: SliceConfigSchema,
    sliceName: SliceNameSchema,
} as const);

// --- Pure Functions ----------------------------------------------------------

const mkSliceName = (name: string): SliceName => name as SliceName;

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
        name: mkSliceName(config.name),
        subscribe: (listener: (state: T) => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
};

const mkCombinedStore = <S extends Record<string, StoreSlice<unknown>>>(slices: S): CombinedStore<S> => {
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

// --- Entry Point -------------------------------------------------------------

const createStore = (config: StoreConfig = {}): Effect.Effect<StoreApi, never, never> =>
    pipe(
        Effect.sync(() => ({
            enableDevtools: config.enableDevtools ?? B.defaults.enableDevtools,
            name: config.name ?? B.defaults.name,
        })),
        Effect.map((_cfg) =>
            Object.freeze({
                combineSlices: <S extends Record<string, StoreSlice<unknown>>>(slices: S) => mkCombinedStore(slices),
                createSlice: <T, A extends Record<string, unknown> = Record<string, never>>(
                    sliceConfig: SliceConfig<T, A>,
                ) => mkSlice(sliceConfig),
                match,
                Option,
                P,
                schemas,
            } as StoreApi),
        ),
    );

// --- Export ------------------------------------------------------------------

export { B as STORE_TUNING, createStore };
export type { CombinedStore, SliceConfig, SliceName, StoreActions, StoreApi, StoreConfig, StoreSlice };
