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
                errors: './src/errors.ts',
                middleware: './src/middleware.ts',
            },
            external: [
                'effect',
                '@effect/platform',
                '@effect/sql',
                '@effect/sql-pg',
                '@parametric-portal/database',
                '@parametric-portal/types',
            ],
            mode: 'library',
            name: 'ParametricServer',
        }),
    ) as UserConfig,
);
