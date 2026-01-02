import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                'css-sync': './src/css-sync.ts',
                'hooks/browser': './src/hooks/browser.ts',
                'hooks/effect': './src/hooks/effect.ts',
                'hooks/file': './src/hooks/file.ts',
                'hooks/query': './src/hooks/query.ts',
                'hooks/suspense': './src/hooks/suspense.ts',
                'hooks/transition': './src/hooks/transition.ts',
                messaging: './src/messaging.ts',
                runtime: './src/runtime.tsx',
                'services/browser': './src/services/browser.ts',
                'services/telemetry': './src/services/telemetry.ts',
                'store/factory': './src/store/factory.ts',
                'store/provider': './src/store/provider.tsx',
                'store/storage': './src/store/storage.ts',
                'store/types': './src/store/types.ts',
                'stores/auth': './src/stores/auth.ts',
                url: './src/url.ts',
            },
            external: [
                '@effect/opentelemetry',
                '@effect/platform',
                '@effect/platform-browser',
                '@parametric-portal/types',
                '@tanstack/react-query',
                'date-fns',
                'effect',
                'idb-keyval',
                'immer',
                'jszip',
                'nuqs',
                'persist-and-sync',
                'react',
                'react-dom',
                'react/jsx-runtime',
                'zundo',
                'zustand',
                'zustand-computed',
                'zustand-slices',
                'zustand-x',
                'zustand/middleware',
                'zustand/middleware/immer',
            ],
            mode: 'library',
            name: 'ParametricRuntime',
        }),
    ) as UserConfig,
);
