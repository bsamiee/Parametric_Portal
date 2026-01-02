import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                async: './src/async.ts',
                browser: './src/browser.ts',
                database: './src/database.ts',
                files: './src/files.ts',
                icons: './src/icons.ts',
                runtime: './src/runtime.ts',
                svg: './src/svg.ts',
                types: './src/types.ts',
                ui: './src/ui.ts',
            },
            external: ['@effect/experimental', 'effect', 'isomorphic-dompurify', 'uuid'],
            mode: 'library',
            name: 'ParametricTypes',
        }),
    ) as UserConfig,
);
