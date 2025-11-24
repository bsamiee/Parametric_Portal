import { Effect } from 'effect';
import { defineConfig } from 'vite';
import { createLibraryConfig } from '../../vite.config.ts';

// --- Export ------------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createLibraryConfig({
            entry: {
                fonts: './src/fonts.ts',
                layouts: './src/layouts.ts',
                theme: './src/theme.ts',
            },
            external: ['effect', '@effect/schema'],
            name: 'ParametricTheme',
        }),
    ),
);
