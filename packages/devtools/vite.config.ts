import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

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
                logger: './src/logger.ts',
                overlay: './src/overlay.tsx',
                performance: './src/performance.ts',
                types: './src/types.ts',
            },
            external: [
                '@effect/experimental',
                '@effect/schema',
                'effect',
                'react',
                'react-dom',
                'react-dom/client',
                'react-error-boundary',
                'react/jsx-runtime',
            ],
            mode: 'library',
            name: 'ParametricDevtools',
        }),
    ) as UserConfig,
);
