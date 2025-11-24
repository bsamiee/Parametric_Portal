import { Effect } from 'effect';
import { defineConfig } from 'vite';
import { createLibraryConfig } from '../../vite.config.ts';

// --- Export ------------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createLibraryConfig({
            entry: {
                branded: './src/branded.ts',
                dates: './src/dates.ts',
                identifiers: './src/identifiers.ts',
                matchers: './src/matchers.ts',
                registry: './src/registry.ts',
            },
            external: ['effect', '@effect/schema', 'uuid', 'date-fns', 'zustand'],
            name: 'ParametricTypes',
        }),
    ),
);
