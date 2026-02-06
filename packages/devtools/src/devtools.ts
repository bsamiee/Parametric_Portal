import { Effect, Match } from 'effect';
import AutoImport from 'unplugin-auto-import/vite';
import type { Plugin } from 'vite';
import { Client } from './client.ts';
import { Domain } from './domain.ts';
import { ReactTools } from './react.ts';
import { Relay } from './relay.ts';

// --- [FUNCTIONS] -------------------------------------------------------------

const _trace = (message: string, context?: Readonly<Record<string, unknown>>): void => {
    Match.value(import.meta.env.DEV).pipe(
        Match.when(true, () => Effect.runFork(Effect.logDebug(message).pipe(Effect.annotateLogs(context ?? {})))),
        Match.orElse(() => undefined),
    );
};
const _span = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Match.value(import.meta.env.DEV).pipe(
        Match.when(true, () => Effect.withSpan(name)(effect)),
        Match.orElse(() => effect),
    );
const _measure =
    (label: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        Match.value(import.meta.env.DEV).pipe(
            Match.when(true, () => Effect.withLogSpan(label)(effect)),
            Match.orElse(() => effect),
        );
const _vite = (input: unknown = {}): Array<Plugin> => {
    const config = Domain.normalizeVite(input);
    const autoImport = AutoImport({
        dts: false,
        imports: [{ '@parametric-portal/devtools/devtools': ['Devtools'] }],
    });
    const autoImportPlugins = Match.value(autoImport).pipe(
        Match.when(
            (plugins: unknown): plugins is ReadonlyArray<Plugin | ReadonlyArray<Plugin>> => Array.isArray(plugins),
            (plugins) => plugins.flatMap((plugin) => (Array.isArray(plugin) ? plugin : [plugin])),
        ),
        Match.orElse((plugin): Array<Plugin> => [plugin]),
    );
    const virtualPlugin: Plugin = {
        apply: 'serve',
        load: (id) =>
            Match.value(id).pipe(
                Match.when(
                    Domain._CONFIG.vite.virtualModule.resolvedId,
                    () => `export const __DEV__ = true;\nexport const __APP__ = '${config.app}';`,
                ),
                Match.orElse(() => undefined),
            ),
        name: 'parametric-devtools-virtual',
        resolveId: (id) =>
            Match.value(id).pipe(
                Match.when(Domain._CONFIG.vite.virtualModule.id, () => Domain._CONFIG.vite.virtualModule.resolvedId),
                Match.orElse(() => undefined),
            ),
    };
    return [virtualPlugin, ...autoImportPlugins];
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const Devtools: {
    readonly bootstrap: {
        readonly create: typeof ReactTools.createBootstrap;
        readonly whenReady: typeof ReactTools.whenReady;
    };
    readonly Error: typeof Domain.Error;
    readonly measure: typeof _measure;
    readonly react: {
        readonly Boundary: typeof ReactTools.Boundary;
        readonly Provider: typeof ReactTools.Provider;
        readonly use: typeof ReactTools.use;
    };
    readonly relay: {
        readonly run: (input?: unknown) => Effect.Effect<unknown, unknown, unknown>;
    };
    readonly Schema: typeof Domain.Schema;
    readonly session: typeof Client.session;
    readonly sessionEffect: typeof Client.make;
    readonly span: typeof _span;
    readonly trace: typeof _trace;
    readonly vite: typeof _vite;
} = {
    bootstrap: {
        create: ReactTools.createBootstrap,
        whenReady: ReactTools.whenReady,
    },
    Error: Domain.Error,
    measure: _measure,
    react: {
        Boundary: ReactTools.Boundary,
        Provider: ReactTools.Provider,
        use: ReactTools.use,
    },
    relay: {
        run: Relay.run,
    },
    Schema: Domain.Schema,
    session: Client.session,
    sessionEffect: Client.make,
    span: _span,
    trace: _trace,
    vite: _vite,
};

// --- [EXPORT] ----------------------------------------------------------------

export { Devtools };
