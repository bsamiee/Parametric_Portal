/**
 * Shared Vite plugin factory for parametric CSS generation.
 * Grounding: Extracts common virtual module resolution pattern from fonts/layouts/theme.
 */
import type { Plugin } from 'vite';

// --- [TYPES] -----------------------------------------------------------------

type EnvironmentConsumer = { readonly config: { readonly consumer: 'client' | 'server' } };
type PluginConfig<T> = {
    readonly name: string;
    readonly virtualId: string;
    readonly generate: (inputs: T | ReadonlyArray<T>) => string;
    readonly sectionLabel: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    tailwindMarker: '@import "tailwindcss";',
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/** Normalize single or array input to array. Grounding: API accepts T | ReadonlyArray<T> per REQUIREMENTS.md. */
const normalizeInputs = <T>(input: T | ReadonlyArray<T>): ReadonlyArray<T> =>
    Array.isArray(input) ? (input as ReadonlyArray<T>) : [input as T];
const createVirtualModuleId = (id: string) =>
    Object.freeze({
        pattern: new RegExp(String.raw`@import\s+['"]virtual:parametric-${id}['"];?\s*`, 'g'),
        resolved: `\0virtual:parametric-${id}` as const,
        virtual: `virtual:parametric-${id}` as const,
    });

// --- [ENTRY_POINT] -----------------------------------------------------------

const createParametricPlugin =
    <T>(config: PluginConfig<T>) =>
    (inputs: T | ReadonlyArray<T>): Plugin => {
        const vmid = createVirtualModuleId(config.virtualId);
        const css = config.generate(inputs);
        return {
            applyToEnvironment: (environment: EnvironmentConsumer) => environment.config.consumer === 'client',
            enforce: 'pre',
            load: (id) => (id === vmid.resolved ? `${B.tailwindMarker}\n\n${css}` : undefined),
            name: `parametric-${config.name}`,
            resolveId: (id) => (id === vmid.virtual ? vmid.resolved : undefined),
            transform: (code, id) =>
                !id.endsWith('main.css') || !code.includes(B.tailwindMarker)
                    ? undefined
                    : code
                          .replaceAll(vmid.pattern, '')
                          .replace(
                              B.tailwindMarker,
                              `${B.tailwindMarker}\n\n/* --- [${config.sectionLabel}] --- */\n${css}`,
                          ),
        };
    };

// --- [EXPORT] ----------------------------------------------------------------

export { B as PLUGIN_TUNING, createParametricPlugin, normalizeInputs };
export type { EnvironmentConsumer, PluginConfig };
