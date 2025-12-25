import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                api: './src/api.ts',
                async: './src/async.ts',
                database: './src/database.ts',
                files: './src/files.ts',
                forms: './src/forms.ts',
                svg: './src/svg.ts',
                types: './src/types.ts',
            },
            external: ['effect', '@effect/schema', 'isomorphic-dompurify', 'uuid'],
            mode: 'library',
            name: 'ParametricTypes',
        }),
    ) as UserConfig,
);
