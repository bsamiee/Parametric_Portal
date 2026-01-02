import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                button: './src/button/button.tsx',
                'core/generator': './src/core/generator.ts',
                'core/icons': './src/core/icons.tsx',
                'core/layout': './src/core/layout.ts',
                'core/slots': './src/core/slots.tsx',
            },
            external: [
                '@parametric-portal/types',
                'clsx',
                'lucide-react',
                'react',
                'react-aria-components',
                'react-dom',
                'react/jsx-runtime',
                'tailwind-merge',
                'effect',
                '@effect/experimental',
            ],
            mode: 'library',
            name: 'ParametricComponentsNext',
            react: true,
        }),
    ) as UserConfig,
);
