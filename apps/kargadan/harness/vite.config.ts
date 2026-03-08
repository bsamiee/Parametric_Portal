import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: './src/cli.ts',
            external: [],
            mode: 'server',
            name: 'KargadanHarness',
            port: 4010,
        }),
    ) as UserConfig,
);
