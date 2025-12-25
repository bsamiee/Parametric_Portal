import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                colors: './src/colors.ts',
                fonts: './src/fonts.ts',
                layouts: './src/layouts.ts',
                plugin: './src/plugin.ts',
                presets: './src/presets.ts',
                schemas: './src/schemas.ts',
                theme: './src/theme.ts',
                utils: './src/utils.ts',
            },
            external: ['effect', '@effect/schema'], // Peer dependencies excluded from bundle
            mode: 'library',
            name: 'ParametricTheme',
        }),
    ) as UserConfig, // Type assertion required: Effect.runSync returns unknown, defineConfig expects UserConfig
);
