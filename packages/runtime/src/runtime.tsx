/**
 * Effect ManagedRuntime via React Context. RuntimeProvider wraps app, useRuntime consumes context.
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

// --- [FACTORIES] -------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: Generic context requires any
const RuntimeContext = createContext<ManagedRuntime.ManagedRuntime<any, any> | null>(null);
const RuntimeProvider = <R, E>({ children, runtime }: RuntimeProviderProps<R, E>): ReactNode => (
    <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>
);
const useRuntime = <R = unknown, E extends never = never>(): ManagedRuntime.ManagedRuntime<R, E> =>
    Option.fromNullable(useContext(RuntimeContext)).pipe(
        Option.getOrThrowWith(() => new Error(B.errors.missingRuntime(B.defaults.name))),
    ) as ManagedRuntime.ManagedRuntime<R, E>;
const createAppRuntime = <R, E>(layer: Layer.Layer<R, E, never>): ManagedRuntime.ManagedRuntime<R, E> =>
    ManagedRuntime.make(layer);
const createRuntimeHooks = <R, E extends never = never>(config: RuntimeConfig = {}): RuntimeApi<R, E> => {
    const name = config.name ?? B.defaults.name;
    const CustomContext = createContext<ManagedRuntime.ManagedRuntime<R, E> | null>(null);
    return Object.freeze({
        RuntimeContext: CustomContext,
        RuntimeProvider: ({ children, runtime }: RuntimeProviderProps<R, E>): ReactNode => (
            <CustomContext.Provider value={runtime}>{children}</CustomContext.Provider>
        ),
        useRuntime: (): ManagedRuntime.ManagedRuntime<R, E> =>
            Option.fromNullable(useContext(CustomContext)).pipe(
                Option.getOrThrowWith(() => new Error(B.errors.missingRuntime(name))),
            ),
    });
};

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/useComponentExportOnlyModules: Runtime module exports component, context, hook, and factories as cohesive unit
export type { RuntimeApi, RuntimeConfig, RuntimeProviderProps };
// biome-ignore lint/style/useComponentExportOnlyModules: Runtime module exports component, context, hook, and factories as cohesive unit
export { B as RUNTIME_TUNING, createAppRuntime, createRuntimeHooks, RuntimeContext, RuntimeProvider, useRuntime };
