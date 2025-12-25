import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                bootstrap: './src/bootstrap.tsx',
                boundary: './src/boundary.tsx',
                console: './src/console.ts',
                env: './src/env.ts',
                experimental: './src/experimental.ts',
                handlers: './src/handlers.ts',
                hooks: './src/hooks.ts',
                logger: './src/logger.ts',
                overlay: './src/overlay.tsx',
                performance: './src/performance.ts',
                session: './src/session.tsx',
                trace: './src/trace.ts',
                types: './src/types.ts',
                'vite-plugin': './src/vite-plugin.ts',
            },
            external: [
                '@effect/experimental',
                '@effect/schema',
                'effect',
                'fdir',
                'picomatch',
                'react',
                'react-dom',
                'react-dom/client',
                'react-error-boundary',
                'react/jsx-runtime',
                'tinyglobby',
                'unimport',
                'unplugin',
                'unplugin-auto-import',
                'unplugin-auto-import/vite',
                'webpack-virtual-modules',
            ],
            mode: 'library',
            name: 'ParametricDevtools',
        }),
    ) as UserConfig,
);
