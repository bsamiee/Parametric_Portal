import { Effect } from 'effect';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.config.ts';

// --- Export ------------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                temporal: './src/temporal.ts',
                types: './src/types.ts',
            },
            external: ['effect', '@effect/schema', 'date-fns', 'immer', 'ts-pattern', 'uuid', 'zustand'],
            mode: 'library',
            name: 'ParametricTypes',
        }),
    ),
);
