import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                devtools: './src/devtools.ts',
            },
            external: [
                '@effect/experimental',
                '@effect/platform',
                'effect',
                'react',
                'react-dom',
                'react-dom/client',
                'react-error-boundary',
                'react/jsx-runtime',
                'vite',
            ],
            mode: 'library',
            name: 'ParametricDevtools',
        }),
    ) as UserConfig,
);
