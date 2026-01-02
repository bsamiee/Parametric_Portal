/**
 * Zustand store factories with middleware: immer → computed → persist → temporal → subscribeWithSelector → devtools
 */
import { Either, Match, Schema as S } from 'effect';
import { type TemporalState, temporal } from 'zundo';
import { create, type StateCreator, type UseBoundStore, type StoreApi as ZustandStoreApi } from 'zustand';
import { devtools, persist, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { createComputed } from 'zustand-computed';
import { type createSlice, withSlices } from 'zustand-slices';
import { createStorage, type StorageType } from './storage';
import type { SlicedStoreConfig, StoreConfig } from './types';
import { validateStoreName } from './types';

// --- [TYPES] -----------------------------------------------------------------

type ExtractState<S> = S extends { getState: () => infer T } ? T : never;
type WithSelectors<S> = S & {
    readonly use: { readonly [K in keyof ExtractState<S>]: () => ExtractState<S>[K] };
};
// biome-ignore lint/suspicious/noExplicitAny: Zustand middleware typing
type MiddlewareApplicator = (creator: any, ctx: MiddlewareContext) => any;
// biome-ignore lint/suspicious/noExplicitAny: Slice type inference
type AnySlice = ReturnType<typeof createSlice<any, any, any>>;
type StoreApi<T, C = object> = WithSelectors<UseBoundStore<ZustandStoreApi<T & C>>>;
type MiddlewareKey = 'immer' | 'computed' | 'persist' | 'temporal' | 'subscribeWithSelector' | 'devtools';
type SliceStateUnion<S extends AnySlice[]> = S[number] extends { value: infer V } ? V : never;
type SlicedStoreReturn<S extends AnySlice[], C extends object> = StoreApi<SliceStateUnion<S>, C> &
    TemporalApi<SliceStateUnion<S> & C>;
type TemporalApi<T> = {
    readonly temporal: {
        getState: () => TemporalState<Partial<T>>;
    };
};
type MiddlewareContext = {
    readonly name: string;
    readonly immer: { readonly enabled: boolean };
    readonly persist: {
        readonly enabled: boolean;
        readonly exclude?: ReadonlyArray<string | RegExp>;
        readonly include?: ReadonlyArray<string | RegExp>;
        // biome-ignore lint/suspicious/noExplicitAny: Schema generic typing
        readonly schema?: S.Schema<any, any>;
        readonly storage?: StorageType;
    };
    readonly temporal: {
        readonly enabled: boolean;
        readonly limit?: number;
        readonly partialize?: <T>(s: T) => Partial<T>;
    };
    readonly devtools: { readonly enabled: boolean };
    // biome-ignore lint/suspicious/noExplicitAny: Compute function typing
    readonly computeFn?: (state: any) => any;
    readonly computeOpts?: { keys?: ReadonlyArray<unknown> };
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        devtools: { enabled: true },
        immer: { enabled: true },
        persist: {
            enabled: true,
            exclude: [
                /^_/,
                /^set/,
                /^toggle/,
                /^add/,
                /^remove/,
                /^clear/,
                /^reset/,
            ] as const satisfies ReadonlyArray<RegExp>,
        },
        temporal: { enabled: true, limit: 100 },
    },
    order: ['immer', 'computed', 'persist', 'temporal', 'subscribeWithSelector', 'devtools'] as const,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const partializeState = <T extends object>(state: T): Partial<T> =>
    Object.fromEntries(Object.entries(state).filter(([, v]) => typeof v !== 'function')) as Partial<T>;
const attachSelectors = <T extends object>(
    store: UseBoundStore<ZustandStoreApi<T>>,
): WithSelectors<UseBoundStore<ZustandStoreApi<T>>> => {
    const keys = Object.keys(store.getState());
    const selectors = Object.fromEntries(keys.map((k) => [k, () => store((s) => s[k as keyof typeof s])])) as Record<
        string,
        () => unknown
    >;
    return Object.assign(store, { use: selectors }) as WithSelectors<typeof store>;
};
const normalizeConfig = <T extends { enabled?: boolean }>(
    value: boolean | T | undefined,
    defaults: T,
): T & { enabled: boolean } =>
    Match.value(value).pipe(
        Match.when(
            (v): v is undefined => v === undefined,
            () => ({ ...defaults, enabled: defaults.enabled ?? true }),
        ),
        Match.when(
            (v): v is boolean => typeof v === 'boolean',
            (v) => ({ ...defaults, enabled: v }),
        ),
        Match.orElse((v) => ({ ...defaults, ...v, enabled: v.enabled ?? true })),
    ) as T & { enabled: boolean };
const getEnvVar = (key: string): string | undefined =>
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];
const warnInvalidConfig = (name: string): void => {
    const isProd = getEnvVar('NODE_ENV') === 'production';
    const isValid = validateStoreName(name);
    isProd ||
        isValid ||
        console.warn(`[Zustand] Invalid store name "${name}": must be lowercase alphanumeric with hyphens/colons`);
};

// --- [DISPATCH_TABLES] -------------------------------------------------------

const middlewareApplicators: Record<MiddlewareKey, MiddlewareApplicator> = {
    computed: (creator, ctx) =>
        // biome-ignore lint/suspicious/noExplicitAny: zustand-computed opts typing
        ctx.computeFn ? createComputed(ctx.computeFn, (ctx.computeOpts ?? {}) as any)(creator) : creator,
    devtools: (creator, ctx) => (ctx.devtools.enabled ? devtools(creator, { enabled: true, name: ctx.name }) : creator),
    immer: (creator, ctx) => (ctx.immer.enabled ? immer(creator) : creator),
    persist: (creator, ctx) =>
        ctx.persist.enabled
            ? persist(creator, {
                  merge: (persisted, current) =>
                      ctx.persist.schema && persisted
                          ? Either.match(S.decodeUnknownEither(ctx.persist.schema)(persisted), {
                                onLeft: (err) => {
                                    console.warn(`[${ctx.name}] Hydration validation failed:`, err);
                                    return current;
                                },
                                onRight: (data) => ({ ...current, ...data }),
                            })
                          : { ...current, ...(persisted as object) },
                  name: ctx.name,
                  partialize: (state: Record<string, unknown>) =>
                      Object.fromEntries(
                          Object.entries(state).filter(
                              ([k]) => !ctx.persist.exclude?.some((p) => (typeof p === 'string' ? k === p : p.test(k))),
                          ),
                      ),
                  storage: createStorage(ctx.persist.storage ?? 'localStorage'),
              })
            : creator,
    subscribeWithSelector: (creator) => subscribeWithSelector(creator),
    temporal: (creator, ctx) =>
        ctx.temporal.enabled
            ? temporal(creator, {
                  limit: ctx.temporal.limit ?? B.defaults.temporal.limit,
                  // biome-ignore lint/suspicious/noExplicitAny: zundo partialize typing
                  partialize: (ctx.temporal.partialize ?? partializeState) as any,
              })
            : creator,
};
const buildMiddlewareChain = (
    // biome-ignore lint/suspicious/noExplicitAny: StateCreator generic typing
    initializer: any,
    ctx: MiddlewareContext,
    // biome-ignore lint/suspicious/noExplicitAny: Middleware chain typing
): any => B.order.reduce((creator, key) => middlewareApplicators[key](creator, ctx), initializer);

// --- [ENTRY_POINT] -----------------------------------------------------------

const createStore = <T extends object, C extends object = object>(
    initializer: StateCreator<T, [], []>,
    cfg: StoreConfig<T, C>,
): StoreApi<T, C> & TemporalApi<T & C> => {
    warnInvalidConfig(cfg.name);
    const ctx = {
        computeFn: cfg.computed?.compute,
        computeOpts: cfg.computed ? { keys: cfg.computed.keys as ReadonlyArray<unknown> } : undefined,
        devtools: normalizeConfig(cfg.devtools, B.defaults.devtools),
        immer: normalizeConfig(cfg.immer, B.defaults.immer),
        name: cfg.name,
        persist: {
            ...normalizeConfig(cfg.persist, B.defaults.persist),
            schema: typeof cfg.persist === 'object' && cfg.persist !== null ? cfg.persist.schema : undefined,
        },
        temporal: normalizeConfig(cfg.temporal, B.defaults.temporal),
    } as MiddlewareContext;
    return attachSelectors(create<T & C>()(buildMiddlewareChain(initializer, ctx))) as StoreApi<T, C> &
        TemporalApi<T & C>;
};
const createSlicedStore = <S extends AnySlice[], C extends object = object>(
    config: SlicedStoreConfig<object, C>,
    ...slices: S
): SlicedStoreReturn<S, C> => {
    // biome-ignore lint/suspicious/noExplicitAny: withSlices typing
    const sliceInitializer = withSlices(...(slices as any));
    return createStore(sliceInitializer as StateCreator<object, [], []>, {
        ...config,
        immer: false,
    }) as SlicedStoreReturn<S, C>;
};

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/performance/noBarrelFile: Intentional re-export for unified API
export { createSlice } from 'zustand-slices';
export { B as STORE_FACTORY_TUNING, createSlicedStore, createStore };
export type { StoreApi, TemporalApi };
