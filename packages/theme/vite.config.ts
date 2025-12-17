/**
 * Configure theme library build with fonts, layouts, and theme entry points.
 */
import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.config.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: { fonts: './src/fonts.ts', layouts: './src/layouts.ts', theme: './src/theme.ts' },
            external: ['effect', '@effect/schema'],
            mode: 'library',
            name: 'ParametricTheme',
        }),
    ) as UserConfig,
);
