import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                anthropic: './src/anthropic.ts',
            },
            external: ['effect', '@effect/platform', '@anthropic-ai/sdk', '@parametric-portal/server'],
            mode: 'library',
            name: 'ParametricAI',
        }),
    ) as UserConfig,
);
