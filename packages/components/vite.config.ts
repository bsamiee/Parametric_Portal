import { Effect } from 'effect';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.config.ts';

// --- Export ------------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                controls: './src/controls.ts',
                elements: './src/elements.ts',
                icons: './src/icons.ts',
            },
            external: [
                'effect',
                '@effect/schema',
                'react',
                'react-dom',
                'react/jsx-runtime',
                'react-aria',
                'react-stately',
                '@radix-ui/react-slot',
                'class-variance-authority',
                'clsx',
                'tailwind-merge',
                'lucide-react',
            ],
            mode: 'library',
            name: 'ParametricComponents',
        }),
    ),
);
