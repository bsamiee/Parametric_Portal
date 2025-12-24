/**
 * Store configuration types with middleware support (immer, persist, computed, temporal, devtools).
 */
import { Either, pipe, Schema as S } from 'effect';
import type { StorageType } from './storage';

// --- [TYPES] -----------------------------------------------------------------

type PersistConfig<T = unknown> = {
    readonly enabled?: boolean;
    readonly exclude?: ReadonlyArray<string | RegExp>;
    readonly include?: ReadonlyArray<string | RegExp>;
    readonly schema?: S.Schema<T, T>;
    readonly storage?: StorageType;
};
type ComputedConfig<T, C> = {
    readonly compute: (state: T) => C;
    readonly keys?: ReadonlyArray<keyof T>;
};
type TemporalConfig<T> = {
    readonly enabled?: boolean;
    readonly limit?: number;
    readonly partialize?: (state: T) => Partial<T>;
};
type DevtoolsConfig = {
    readonly enabled?: boolean;
};
type StoreConfig<T, C = object> = {
    readonly computed?: ComputedConfig<T, C>;
    readonly devtools?: boolean | DevtoolsConfig;
    readonly immer?: boolean;
    readonly name: string;
    readonly persist?: boolean | PersistConfig<T>;
    readonly temporal?: boolean | TemporalConfig<T>;
};
type SlicedStoreConfig<T, C = object> = Omit<StoreConfig<T, C>, 'immer'> & {
    readonly immer?: boolean;
};
type ExtractState<S> = S extends { getState: () => infer T } ? T : never;
type WithSelectors<S> = S & {
    readonly use: { readonly [K in keyof ExtractState<S>]: () => ExtractState<S>[K] };
};

// --- [SCHEMA] ----------------------------------------------------------------

const B = Object.freeze({
    bounds: { historyLimit: { max: 1000, min: 1 } },
    patterns: { storeName: /^[a-z0-9][a-z0-9:-]*$/ },
} as const);

const StoreNameSchema = pipe(
    S.String,
    S.pattern(B.patterns.storeName, {
        message: () => 'Store name must be lowercase alphanumeric with hyphens/colons',
    }),
);

const HistoryLimitSchema = pipe(S.Number, S.int(), S.between(B.bounds.historyLimit.min, B.bounds.historyLimit.max));

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const validateStoreName = (name: string): boolean => Either.isRight(S.decodeUnknownEither(StoreNameSchema)(name));

// --- [EXPORT] ----------------------------------------------------------------

export { B as STORE_TYPES_TUNING, HistoryLimitSchema, StoreNameSchema, validateStoreName };
export type {
    ComputedConfig,
    DevtoolsConfig,
    ExtractState,
    PersistConfig,
    SlicedStoreConfig,
    StoreConfig,
    TemporalConfig,
    WithSelectors,
};
