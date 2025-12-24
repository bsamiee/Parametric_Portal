/**
 * Store provider factory with React 19-safe lazy initialization via useRef.
 */
import { Option } from 'effect';
import { type Context, createContext, type ReactNode, useContext, useRef } from 'react';
import { type StoreApi, useStore } from 'zustand';

// --- [TYPES] -----------------------------------------------------------------

type StoreProviderProps<T> = {
    readonly children: ReactNode;
    readonly initialState?: Partial<T>;
};
type StoreProviderFactory<T> = {
    readonly Provider: (props: StoreProviderProps<T>) => ReactNode;
    readonly StoreContext: Context<StoreApi<T> | null>;
    readonly useSelector: <U>(selector: (state: T) => U) => U;
    readonly useStoreContext: () => StoreApi<T>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    errors: {
        missingProvider: (name: string) => `useStoreContext must be used within ${name}Provider`,
    },
} as const);

// --- [FACTORY] ---------------------------------------------------------------

const createStoreProvider = <T extends object>(
    createStoreFn: (initialState?: Partial<T>) => StoreApi<T>,
    displayName: string,
): StoreProviderFactory<T> => {
    const StoreContext = createContext<StoreApi<T> | null>(null);
    StoreContext.displayName = `${displayName}Context`;
    const Provider = ({ children, initialState }: StoreProviderProps<T>): ReactNode => {
        const storeRef = useRef<StoreApi<T> | null>(null);
        storeRef.current ??= createStoreFn(initialState);
        return <StoreContext.Provider value={storeRef.current}>{children}</StoreContext.Provider>;
    };
    const useStoreContext = (): StoreApi<T> =>
        Option.fromNullable(useContext(StoreContext)).pipe(
            Option.getOrThrowWith(() => new Error(B.errors.missingProvider(displayName))),
        );
    const useSelector = <U,>(selector: (state: T) => U): U => useStore(useStoreContext(), selector);
    return Object.freeze({ Provider, StoreContext, useSelector, useStoreContext });
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as STORE_PROVIDER_TUNING, createStoreProvider };
export type { StoreProviderFactory, StoreProviderProps };
