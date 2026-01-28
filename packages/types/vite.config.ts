/**
 * Vite configuration for types package.
 * Builds library with multiple entry points for tree-shakeable exports.
 */
import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory';

// --- [CONSTANTS] -------------------------------------------------------------

const config = Effect.runSync(
    createConfig({
        entry: {
            'app-error': './src/app-error.ts',
            async: './src/async.ts',
            files: './src/files.ts',
            icons: './src/icons.ts',
            svg: './src/svg.ts',
            types: './src/types.ts',
            ui: './src/ui.ts',
        },
        external: ['effect', 'happy-dom', 'isomorphic-dompurify'],
        mode: 'library',
        name: 'ParametricTypes',
    }),
) as UserConfig;

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(config);
