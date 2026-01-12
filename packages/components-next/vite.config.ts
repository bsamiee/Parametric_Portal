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
                'actions/toolbar': './src/actions/toolbar.tsx',
                // --- collections ---
                'collections/grid-list': './src/collections/grid-list.tsx',
                'collections/table': './src/collections/table.tsx',
                'collections/tag-group': './src/collections/tag-group.tsx',
                'collections/tree': './src/collections/tree.tsx',
                // --- core ---
                'core/announce': './src/core/announce.tsx',
                'core/floating': './src/core/floating.tsx',
                'core/gesture': './src/core/gesture.ts',
                'core/utils': './src/core/utils.ts',
                // --- feedback ---
                'feedback/progress': './src/feedback/progress.tsx',
                // --- inputs ---
                'inputs/field': './src/inputs/field.tsx',
                'inputs/radio': './src/inputs/radio.tsx',
                'inputs/select': './src/inputs/select.tsx',
                'inputs/slider': './src/inputs/slider.tsx',
                // --- navigation ---
                'navigation/accordion': './src/navigation/accordion.tsx',
                'navigation/breadcrumbs': './src/navigation/breadcrumbs.tsx',
                'navigation/link': './src/navigation/link.tsx',
                'navigation/menu': './src/navigation/menu.tsx',
                'navigation/tabs': './src/navigation/tabs.tsx',
                // --- overlays ---
                'overlays/dialog': './src/overlays/dialog.tsx',
                'overlays/drawer': './src/overlays/drawer.tsx',
                // --- pickers ---
                'pickers/color-picker': './src/pickers/color-picker.tsx',
                'pickers/date-picker': './src/pickers/date-picker.tsx',
                'pickers/file-preview': './src/pickers/file-preview.tsx',
                'pickers/file-upload': './src/pickers/file-upload.tsx',
            },
            external: [
                '@floating-ui/react',
                '@formkit/auto-animate',
                '@internationalized/date',
                '@parametric-portal/runtime',
                '@parametric-portal/theme',
                '@parametric-portal/types',
                '@radix-ui/react-visually-hidden',
                '@react-aria/live-announcer',
                '@tanstack/react-table',
                '@tanstack/react-virtual',
                '@use-gesture/react',
                'clsx',
                'colorjs.io',
                'effect',
                'lucide-react',
                'motion',
                'react',
                'react-aria',
                'react-aria-components',
                'react-dom',
                'vaul',
                'react/jsx-runtime',
                'tailwind-merge',
                'ts-essentials',
                'ts-toolbelt',
                'tw-animate-css',
                'type-fest',
            ],
            mode: 'library',
            name: 'ParametricComponentsNext',
            react: true,
        }),
    ) as UserConfig,
);
