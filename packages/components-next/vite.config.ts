import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                // --- actions ---
                'actions/button': './src/actions/button.tsx',
                'actions/toggle': './src/actions/toggle.tsx',
                // --- core ---
                'core/announce': './src/core/announce.tsx',
                'core/floating': './src/core/floating.tsx',
                'core/focus': './src/core/focus.tsx',
                'core/gesture': './src/core/gesture.ts',
                'core/utils': './src/core/utils.ts',
                // --- inputs ---
                'inputs/radio': './src/inputs/radio.tsx',
                'inputs/select': './src/inputs/select.tsx',
                // --- navigation ---
                'navigation/accordion': './src/navigation/accordion.tsx',
                'navigation/menu': './src/navigation/menu.tsx',
                'navigation/tabs': './src/navigation/tabs.tsx',
                // --- overlays ---
                'overlays/dialog': './src/overlays/dialog.tsx',
                // --- pickers ---
                'pickers/file-preview': './src/pickers/file-preview.tsx',
                'pickers/file-upload': './src/pickers/file-upload.tsx',
            },
            external: [
                '@floating-ui/react',
                '@formkit/auto-animate',
                '@parametric-portal/runtime',
                '@parametric-portal/theme',
                '@parametric-portal/types',
                '@radix-ui/react-visually-hidden',
                '@tanstack/react-virtual',
                '@use-gesture/react',
                'clsx',
                'effect',
                'lucide-react',
                'react',
                'react-aria',
                'react-aria-components',
                'react-dom',
                'react/jsx-runtime',
                'tailwind-merge',
                'ts-essentials',
                'tw-animate-css',
                'type-fest',
            ],
            mode: 'library',
            name: 'ParametricComponentsNext',
            react: true,
        }),
    ) as UserConfig,
);
