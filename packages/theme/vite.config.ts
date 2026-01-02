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
                plugin: './src/plugin.ts',
                'scale-derivation': './src/scale-derivation.ts',
                seed: './src/seed.ts',
                theme: './src/theme.ts',
            },
            external: ['@parametric-portal/types', 'colorjs.io', 'effect'],
            mode: 'library',
            name: 'ParametricTheme',
        }),
    ) as UserConfig,
);
