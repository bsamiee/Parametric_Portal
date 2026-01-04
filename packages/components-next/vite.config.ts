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
                'core/css-slots': './src/core/css-slots.ts',
                'core/layout': './src/core/layout.ts',
                'core/slots': './src/core/slots.ts',
                'file-preview': './src/file-preview/file-preview.tsx',
                'file-upload': './src/file-upload/file-upload.tsx',
            },
            external: [
                '@parametric-portal/runtime',
                '@parametric-portal/theme',
                '@parametric-portal/types',
                '@radix-ui/react-slot',
                'clsx',
                'effect',
                'lucide-react',
                'react',
                'react-aria',
                'react-aria-components',
                'react-dom',
                'react/jsx-runtime',
                'tailwind-merge',
                'tw-animate-css',
            ],
            mode: 'library',
            name: 'ParametricComponentsNext',
            react: true,
        }),
    ) as UserConfig,
);
