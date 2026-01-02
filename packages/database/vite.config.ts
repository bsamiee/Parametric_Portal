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
                migrator: './src/migrator.ts',
                models: './src/models.ts',
                repos: './src/repos.ts',
            },
            external: ['effect', '@effect/experimental', '@effect/platform', '@effect/sql', '@effect/sql-pg'],
            mode: 'library',
            name: 'ParametricDatabase',
        }),
    ) as UserConfig,
);
