import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                client: './src/client.ts',
                models: './src/models.ts',
                schema: './src/schema.ts',
            },
            external: ['effect', '@effect/sql', '@effect/sql-pg'],
            mode: 'library',
            name: 'ParametricDatabase',
        }),
    ) as UserConfig,
);
