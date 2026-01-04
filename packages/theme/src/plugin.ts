/**
 * Shared Vite plugin factory for parametric CSS generation with HMR support.
 * Grounding: Effect-based generation with proper error channel, file watching, and hot reload.
 */
import { Effect, Match, Option } from 'effect';
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
    tailwindMarkerCanonical: '@import "tailwindcss";',
    tailwindMarkerPattern: /@import\s+['"]tailwindcss['"];?/,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

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
        const regenerate = (): void => {
            Effect.runSync(
                config.generate(inputs).pipe(
                    Effect.match({
                        onFailure: (error) => {
                            state.error = error;
                            state.css = `/* Theme generation failed: ${formatError(error)} */`;
                        },
                        onSuccess: (css) => {
                            state.error = null;
                            state.css = css;
                        },
                    }),
                ),
            );
        };
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
        const setupWatcher = (server: ViteDevServer): void => {
            config.watchFiles?.forEach((file) => {
                server.watcher.add(file);
            });
            config.watchFiles?.length &&
                server.watcher.on('change', (f) => config.watchFiles?.includes(f) && invalidateAndReload(server));
        };
        const handleHotUpdate = (ctx: HmrContext): ModuleNode[] | undefined =>
            Option.match(
                Option.filter(Option.fromNullable(config.watchFiles), (wf) => wf.includes(ctx.file)),
                {
                    onNone: () => undefined,
                    onSome: () => {
                        regenerate();
                        state.error && ctx.server.config.logger.error(`[${config.name}] ${formatError(state.error)}`);
                        return [] as ModuleNode[];
                    },
                },
            );
        regenerate();
        return {
            applyToEnvironment: (environment: EnvironmentConsumer) => environment.config.consumer === 'client',
            configureServer: setupWatcher,
            enforce: 'pre',
            handleHotUpdate,
            load: (id) => (id === vmid.resolved ? `${B.tailwindMarkerCanonical}\n\n${state.css}` : undefined),
            name: `parametric-${config.name}`,
            resolveId: (id) => (id === vmid.virtual ? vmid.resolved : undefined),
            transform: (code, id) =>
                !id.endsWith('main.css') || !B.tailwindMarkerPattern.test(code)
                    ? undefined
                    : code
                          .replaceAll(vmid.pattern, '')
                          .replace(
                              B.tailwindMarkerPattern,
                              `${B.tailwindMarkerCanonical}\n\n/* --- [${config.sectionLabel}] --- */\n${state.css}`,
                          ),
        };
    };

// --- [EXPORT] ----------------------------------------------------------------

export { createParametricPlugin };
export type { PluginConfig };
