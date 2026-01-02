/**
 * Store configuration types with middleware support (immer, persist, computed, temporal, devtools).
 */
import { Either, Schema as S } from 'effect';
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

// --- [SCHEMA] ----------------------------------------------------------------

const B = Object.freeze({
    bounds: { historyLimit: { max: 1000, min: 1 } },
    patterns: { storeName: /^[a-z0-9][a-z0-9:-]*$/ },
} as const);
const StoreNameSchema = S.String.pipe(
    S.pattern(B.patterns.storeName, { message: () => 'Store name must be lowercase alphanumeric with hyphens/colons' }),
);
const HistoryLimitSchema = S.Number.pipe(S.int(), S.between(B.bounds.historyLimit.min, B.bounds.historyLimit.max));

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const validateStoreName = (name: string): boolean => Either.isRight(S.decodeUnknownEither(StoreNameSchema)(name));

// --- [EXPORT] ----------------------------------------------------------------

export { B as STORE_TYPES_TUNING, HistoryLimitSchema, StoreNameSchema, validateStoreName };
export type { ComputedConfig, DevtoolsConfig, PersistConfig, SlicedStoreConfig, StoreConfig, TemporalConfig };
