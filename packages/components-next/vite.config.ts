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
                'core/animate': './src/core/animate.ts',
                'core/announce': './src/core/announce.tsx',
                'core/css-slots': './src/core/css-slots.ts',
                'core/floating': './src/core/floating.tsx',
                'core/focus': './src/core/focus.tsx',
                'core/layout': './src/core/layout.ts',
                'core/slots': './src/core/slots.ts',
                'file-preview': './src/file-preview/file-preview.tsx',
                'file-upload': './src/file-upload/file-upload.tsx',
                menu: './src/menu/menu.tsx',
                radio: './src/radio/radio.tsx',
                select: './src/select/select.tsx',
                tabs: './src/tabs/tabs.tsx',
                toggle: './src/toggle/toggle.tsx',
            },
            external: [
                '@floating-ui/react',
                '@formkit/auto-animate',
                '@parametric-portal/runtime',
                '@parametric-portal/theme',
                '@parametric-portal/types',
                '@radix-ui/react-visually-hidden',
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
