import { Effect } from 'effect';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.config.ts';

// --- Export ------------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                branded: './src/branded.ts',
                dates: './src/dates.ts',
                identifiers: './src/identifiers.ts',
                matchers: './src/matchers.ts',
                registry: './src/registry.ts',
            },
            external: ['effect', '@effect/schema', 'uuid', 'zustand'],
            mode: 'library',
            name: 'ParametricTypes',
        }),
    ),
);
