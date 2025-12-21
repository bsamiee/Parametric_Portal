/**
 * Vite plugin for auto-import and virtual modules.
 * Enables zero-config trace utilities that tree-shake in production.
 */
import AutoImport from 'unplugin-auto-import/vite';
import type { Plugin } from 'vite';

// --- [TYPES] -----------------------------------------------------------------

type DevtoolsPluginConfig = {
    readonly app?: string | undefined;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        app: 'app',
    },
    virtualModule: {
        id: 'virtual:devtools',
        resolvedId: '\0virtual:devtools',
    },
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const devtoolsPlugin = (config: DevtoolsPluginConfig = {}): Plugin[] => {
    const app = config.app ?? B.defaults.app;

    const virtualModule: Plugin = {
        apply: 'serve',
        load(id) {
            return id === B.virtualModule.resolvedId
                ? `export const __DEV__ = true;\nexport const __APP__ = '${app}';`
                : undefined;
        },
        name: 'devtools-virtual',
        resolveId(id) {
            return id === B.virtualModule.id ? B.virtualModule.resolvedId : undefined;
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

    const autoImportPlugins = (Array.isArray(autoImport) ? autoImport : [autoImport]) as unknown as Plugin[];
    return [virtualModule, ...autoImportPlugins];
};

// --- [EXPORT] ----------------------------------------------------------------

export type { DevtoolsPluginConfig };
export { B as VITE_PLUGIN_TUNING, devtoolsPlugin };
