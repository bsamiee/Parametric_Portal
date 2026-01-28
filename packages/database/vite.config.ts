import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                client: './src/client.ts',
                factory: './src/factory.ts',
                field: './src/field.ts',
                migrator: './src/migrator.ts',
                models: './src/models.ts',
                page: './src/page.ts',
                repos: './src/repos.ts',
                search: './src/search.ts',
            },
            external: [
                '@effect/experimental',
                '@effect/platform-node',
                '@effect/sql',
                '@effect/sql-pg',
                '@parametric-portal/types',
                'effect',
            ],
            mode: 'library',
            name: 'ParametricDatabase',
        }),
    ) as UserConfig,
);
