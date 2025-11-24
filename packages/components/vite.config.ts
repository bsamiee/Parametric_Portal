import { Effect } from 'effect';
import { defineConfig } from 'vite';
import { createLibraryConfig } from '../../vite.config.ts';

// --- Export ------------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createLibraryConfig({
            entry: './src/components.ts',
            external: ['effect', '@effect/schema', 'class-variance-authority', 'clsx', 'tailwind-merge'],
            name: 'ParametricComponents',
        }),
    ),
);
