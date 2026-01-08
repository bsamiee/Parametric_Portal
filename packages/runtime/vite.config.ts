/**
 * Configure Vite build for runtime package.
 * Exports multiple entry points for browser hooks, stores, and services.
 */
import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory';

// --- [CONSTANTS] -------------------------------------------------------------

const config = Effect.runSync(
    createConfig({
        entry: {
            'css-sync': './src/css-sync.ts',
            'hooks/browser': './src/hooks/browser.ts',
            'hooks/effect': './src/hooks/effect.ts',
            'hooks/file-upload': './src/hooks/file-upload.ts',
            'hooks/suspense': './src/hooks/suspense.ts',
            messaging: './src/messaging.ts',
            runtime: './src/runtime.ts',
            'services/browser': './src/services/browser.ts',
            'services/file': './src/services/file.ts',
            'services/telemetry': './src/services/telemetry.ts',
            'store/factory': './src/store/factory.ts',
            'store/storage': './src/store/storage.ts',
            'stores/auth': './src/stores/auth.ts',
            url: './src/url.ts',
        },
        external: [
            '@effect/opentelemetry',
            '@effect/platform',
            '@effect/platform-browser',
            '@floating-ui/react',
            '@parametric-portal/database',
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
