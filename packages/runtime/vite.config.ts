/**
 * Vite build config with multiple entry points for runtime library package.
 */
import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory';

// --- [CONSTANTS] -------------------------------------------------------------

const config = Effect.runSync(
    createConfig({
        entry: {
            browser: './src/browser.ts',
            'css-sync': './src/css-sync.ts',
            effect: './src/effect.ts',
            messaging: './src/messaging.ts',
            runtime: './src/runtime.ts',
            'stores/auth': './src/stores/auth.ts',
            'stores/factory': './src/stores/factory.ts',
            'stores/storage': './src/stores/storage.ts',
            url: './src/url.ts',
        },
        external: [
            '@effect/opentelemetry',
            '@effect/platform',
            '@effect/platform-browser',
            '@floating-ui/react',
            '@parametric-portal/types',
            'effect',
            'idb-keyval',
            'immer',
            'jszip',
            'nuqs',
            'react',
            'react-dom',
            'react/jsx-runtime',
            'zundo',
            'zustand',
            'zustand-computed',
            'zustand-slices',
            'zustand/middleware',
            'zustand/middleware/immer',
        ],
        mode: 'library',
        name: 'ParametricRuntime',
        react: true,
    }),
) as UserConfig;

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(config);
