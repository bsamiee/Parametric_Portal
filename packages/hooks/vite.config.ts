import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.config.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                api: './src/api.ts',
                async: './src/async.ts',
                boundary: './src/boundary.ts',
                form: './src/form.ts',
                runtime: './src/runtime.ts',
                store: './src/store.ts',
                suspense: './src/suspense.ts',
                transition: './src/transition.ts',
            },
            external: [
                '@effect/schema',
                '@parametric-portal/types',
                'effect',
                'react',
                'react-dom',
                'react/jsx-runtime',
            ],
            mode: 'library',
            name: 'ParametricHooks',
        }),
    ) as UserConfig,
);
