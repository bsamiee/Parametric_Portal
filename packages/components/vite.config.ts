import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                command: './src/command.ts',
                controls: './src/controls.ts',
                data: './src/data.ts',
                elements: './src/elements.ts',
                feedback: './src/feedback.ts',
                icons: './src/icons.ts',
                'input-bar': './src/input-bar.ts',
                navigation: './src/navigation.ts',
                overlays: './src/overlays.ts',
                schema: './src/schema.ts',
                selection: './src/selection.ts',
                upload: './src/upload.ts',
                utility: './src/utility.ts',
            },
            external: [
                '@floating-ui/react-dom',
                '@parametric-portal/types',
                '@radix-ui/react-slot',
                'class-variance-authority',
                'clsx',
                'cmdk',
                'effect',
                'lucide-react',
                'react',
                'react-aria',
                'react-aria-components',
                'react-dom',
                'react-stately',
                'react/jsx-runtime',
                'tailwind-merge',
            ],
            mode: 'library',
            name: 'ParametricComponents',
            react: true,
        }),
    ) as UserConfig,
);
