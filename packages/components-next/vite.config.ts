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
                dialog: './src/overlay/dialog.tsx',
                input: './src/input/input.tsx',
                layout: './src/layout/layout.tsx',
                panel: './src/layout/panel.tsx',
                popover: './src/overlay/popover.tsx',
                provider: './src/core/context.ts',
                select: './src/select/select.tsx',
                sidebar: './src/layout/sidebar.tsx',
            },
            external: [
                '@radix-ui/react-slot',
                'class-variance-authority',
                'clsx',
                'effect',
                'motion',
                'motion/react',
                'react',
                'react-aria',
                'react-dom',
                'react-stately',
                'react/jsx-runtime',
                'tailwind-merge',
            ],
            mode: 'library',
            name: 'ParametricComponentsNext',
        }),
    ) as UserConfig,
);
