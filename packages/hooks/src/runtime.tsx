/**
 * Inject Effect runtime via React Context for layer substitution per subtree.
 */
import { type Layer, ManagedRuntime, Option } from 'effect';
import { type Context, createContext, type ReactNode, useContext } from 'react';

// --- [TYPES] -----------------------------------------------------------------

type RuntimeProviderProps<R, E> = {
    readonly children: ReactNode;
    readonly runtime: ManagedRuntime.ManagedRuntime<R, E>;
};

type RuntimeApi<R, E> = {
    readonly RuntimeContext: Context<ManagedRuntime.ManagedRuntime<R, E> | null>;
    readonly RuntimeProvider: (props: RuntimeProviderProps<R, E>) => ReactNode;
    readonly useRuntime: () => ManagedRuntime.ManagedRuntime<R, E>;
};

type RuntimeConfig = {
    readonly name?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        name: 'AppRuntime',
    },
    errors: {
        missingRuntime: (name: string) => `useRuntime must be used within a RuntimeProvider (${name})`,
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createRuntimeContext = <R, E>(): Context<ManagedRuntime.ManagedRuntime<R, E> | null> =>
    createContext<ManagedRuntime.ManagedRuntime<R, E> | null>(null);

const createRuntimeProvider =
    <R, E>(ctx: Context<ManagedRuntime.ManagedRuntime<R, E> | null>) =>
    ({ children, runtime }: RuntimeProviderProps<R, E>): ReactNode => (
        <ctx.Provider value={runtime}>{children}</ctx.Provider>
    );

const createUseRuntime =
    <R, E>(ctx: Context<ManagedRuntime.ManagedRuntime<R, E> | null>, name: string) =>
    (): ManagedRuntime.ManagedRuntime<R, E> =>
        Option.fromNullable(useContext(ctx)).pipe(
            Option.getOrThrowWith(() => new Error(B.errors.missingRuntime(name))),
        );

// --- [ENTRY_POINT] -----------------------------------------------------------

const createAppRuntime = <R, E>(layer: Layer.Layer<R, E, never>): ManagedRuntime.ManagedRuntime<R, E> =>
    ManagedRuntime.make(layer);

const createRuntimeHooks = <R, E = never>(config: RuntimeConfig = {}): RuntimeApi<R, E> => {
    const name = config.name ?? B.defaults.name;
    const RuntimeContext = createRuntimeContext<R, E>();
    return Object.freeze({
        RuntimeContext,
        RuntimeProvider: createRuntimeProvider(RuntimeContext),
        useRuntime: createUseRuntime(RuntimeContext, name),
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { RuntimeApi, RuntimeConfig, RuntimeProviderProps };
export { B as RUNTIME_TUNING, createAppRuntime, createRuntimeHooks };
