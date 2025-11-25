import { Effect } from 'effect';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.config.ts';

// --- Export ------------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                types: './src/types.ts',
                utils: './src/utils.ts',
            },
            external: ['effect', '@effect/schema', 'date-fns', 'uuid', 'zustand'],
            mode: 'library',
            name: 'ParametricTypes',
        }),
    ),
);
