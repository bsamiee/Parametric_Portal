import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: './src/main.ts',
            external: ['@parametric-portal/database', '@parametric-portal/server'],
            mode: 'server',
            name: 'ParametricApi',
            port: 4000,
        }),
    ) as UserConfig,
);
