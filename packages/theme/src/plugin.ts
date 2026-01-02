/**
 * Shared Vite plugin factory for parametric CSS generation with HMR support.
 * Grounding: Effect-based generation with proper error channel, file watching, and hot reload.
 */
import { Effect, Exit, Match, Option, pipe } from 'effect';
import type { HmrContext, ModuleNode, Plugin, ViteDevServer } from 'vite';
import type { ThemeError } from './colors.ts';

// --- [TYPES] -----------------------------------------------------------------

type EnvironmentConsumer = { readonly config: { readonly consumer: 'client' | 'server' } };
type PluginConfig<T> = {
    readonly name: string;
    readonly virtualId: string;
    readonly generate: (inputs: T | ReadonlyArray<T>) => Effect.Effect<string, ThemeError>;
    readonly sectionLabel: string;
    readonly watchFiles?: ReadonlyArray<string>;
};
type PluginState = { css: string; error: ThemeError | null };

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    nullPrefix: '\0',
    tailwindMarker: '@import "tailwindcss";',
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const normalizeInputs = <T>(input: T | ReadonlyArray<T>): ReadonlyArray<T> =>
    Array.isArray(input) ? (input as ReadonlyArray<T>) : [input as T];
const formatError = (error: ThemeError): string =>
    Match.value(error).pipe(
        Match.tag('Validation', (e) => `Validation failed for ${e.field}: ${e.message}`),
        Match.tag('Generation', (e) => `Generation failed in ${e.phase} phase for ${e.category}: ${e.message}`),
        Match.tag('Plugin', (e) => `Plugin error [${e.code}]: ${e.message}`),
        Match.exhaustive,
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const createParametricPlugin =
    <T>(config: PluginConfig<T>) =>
    (inputs: T | ReadonlyArray<T>): Plugin => {
        const vmid = Object.freeze({
            pattern: new RegExp(String.raw`@import\s+['"]virtual:parametric-${config.virtualId}['"];?\s*`, 'g'),
            resolved: `${B.nullPrefix}virtual:parametric-${config.virtualId}` as const,
            virtual: `virtual:parametric-${config.virtualId}` as const,
        });
        const state: PluginState = { css: '', error: null };
        const regenerate = (): void =>
            Exit.match(Effect.runSyncExit(config.generate(inputs)), {
                onFailure: (cause) => {
                    const error = cause._tag === 'Fail' ? cause.error : null;
                    state.error = error;
                    state.css = error
                        ? `/* Theme generation failed: ${formatError(error)} */`
                        : '/* Theme generation failed: Unknown error */';
                },
                onSuccess: (result) => {
                    state.css = result;
                    state.error = null;
                },
            });
        const logResult = (server: ViteDevServer): void => {
            state.error
                ? server.config.logger.error(`[${config.name}] ${formatError(state.error)}`, { timestamp: true })
                : server.config.logger.info(`[${config.name}] Theme regenerated`, { timestamp: true });
        };
        const invalidateAndReload = (server: ViteDevServer): void => {
            regenerate();
            const mod = server.moduleGraph.getModuleById(vmid.resolved);
            mod && server.moduleGraph.invalidateModule(mod);
            server.ws.send({ path: '*', type: 'full-reload' });
            logResult(server);
        };
        const isWatchedFile = (file: string): boolean =>
            pipe(
                Option.fromNullable(config.watchFiles),
                Option.map((wf) => wf.includes(file)),
                Option.getOrElse(() => false),
            );
        const setupWatcher = (server: ViteDevServer): void =>
            pipe(
                Option.fromNullable(config.watchFiles),
                Option.filter((files) => files.length > 0),
                Option.map((files) => {
                    files.forEach((file) => {
                        server.watcher.add(file);
                    });
                    server.watcher.on('change', (file) => {
                        isWatchedFile(file) && invalidateAndReload(server);
                    });
                    return undefined;
                }),
                Option.getOrElse(() => undefined),
            );
        const handleHotUpdate = (ctx: HmrContext): ModuleNode[] | undefined =>
            pipe(
                Option.fromNullable(config.watchFiles),
                Option.filter((wf) => wf.includes(ctx.file)),
                Option.map(() => {
                    regenerate();
                    state.error && ctx.server.config.logger.error(`[${config.name}] ${formatError(state.error)}`);
                    return [] as ModuleNode[];
                }),
                Option.getOrElse(() => undefined as ModuleNode[] | undefined),
            );
        regenerate();
        return {
            applyToEnvironment: (environment: EnvironmentConsumer) => environment.config.consumer === 'client',
            configureServer: setupWatcher,
            enforce: 'pre',
            handleHotUpdate,
            load: (id) => (id === vmid.resolved ? `${B.tailwindMarker}\n\n${state.css}` : undefined),
            name: `parametric-${config.name}`,
            resolveId: (id) => (id === vmid.virtual ? vmid.resolved : undefined),
            transform: (code, id) =>
                !id.endsWith('main.css') || !code.includes(B.tailwindMarker)
                    ? undefined
                    : code
                          .replaceAll(vmid.pattern, '')
                          .replace(
                              B.tailwindMarker,
                              `${B.tailwindMarker}\n\n/* --- [${config.sectionLabel}] --- */\n${state.css}`,
                          ),
        };
    };

// --- [EXPORT] ----------------------------------------------------------------

export { createParametricPlugin, normalizeInputs };
export type { PluginConfig };
