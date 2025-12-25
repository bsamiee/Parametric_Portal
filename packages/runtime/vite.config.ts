import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                runtime: './src/runtime.tsx',
                'store/factory': './src/store/factory.ts',
                'store/types': './src/store/types.ts',
                'stores/auth': './src/stores/auth.ts',
                temporal: './src/temporal.ts',
            },
            external: [
                '@parametric-portal/types',
                'date-fns',
                'effect',
                'immer',
                'persist-and-sync',
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
        }),
    ) as UserConfig,
);
