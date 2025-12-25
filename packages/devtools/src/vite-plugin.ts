/**
 * Vite plugin for auto-import and virtual modules.
 * Enables zero-config trace utilities that tree-shake in production.
 */
import AutoImport from 'unplugin-auto-import/vite';
import type { Plugin } from 'vite';
import { DEVTOOLS_TUNING } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type EnvironmentConsumer = { readonly config: { readonly consumer: 'client' | 'server' } };
type DevtoolsPluginConfig = {
    readonly app?: string | undefined;
};

// --- [CONSTANTS] -------------------------------------------------------------

const T = DEVTOOLS_TUNING.vitePlugin;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isPlugin = (x: unknown): x is Plugin => typeof x === 'object' && x !== null && 'name' in x;

// --- [ENTRY_POINT] -----------------------------------------------------------

const devtoolsPlugin = (config: DevtoolsPluginConfig = {}): Plugin[] => {
    const app = config.app ?? T.defaults.app;
    const virtualModule: Plugin = {
        apply: 'serve',
        applyToEnvironment: (environment: EnvironmentConsumer) => environment.config.consumer === 'client',
        load(id) {
            return id === T.virtualModule.resolvedId
                ? `export const __DEV__ = true;\nexport const __APP__ = '${app}';`
                : undefined;
        },
        name: 'devtools-virtual',
        resolveId(id) {
            return id === T.virtualModule.id ? T.virtualModule.resolvedId : undefined;
        },
    };
    const autoImport = AutoImport({
        dts: false,
        imports: [
            {
                '@parametric-portal/devtools/trace': ['measure', 'span', 'trace'],
            },
        ],
    });
    const normalized = Array.isArray(autoImport) ? autoImport : [autoImport];
    const autoImportPlugins = normalized.filter(isPlugin);
    const clientAutoImportPlugins = autoImportPlugins.map((plugin) => ({
        ...plugin,
        applyToEnvironment: (environment: EnvironmentConsumer) => environment.config.consumer === 'client',
    }));
    return [virtualModule, ...clientAutoImportPlugins];
};

// --- [EXPORT] ----------------------------------------------------------------

export type { DevtoolsPluginConfig };
export { devtoolsPlugin };
