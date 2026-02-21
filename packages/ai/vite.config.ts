import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                mcp: './src/mcp.ts',
                registry: './src/registry.ts',
                runtime: './src/runtime.ts',
                'runtime-provider': './src/runtime-provider.ts',
                search: './src/search.ts',
            },
            external: [
                '@effect/ai',
                '@effect/ai-anthropic',
                '@effect/ai-google',
                '@effect/ai-openai',
                '@effect/platform',
                '@parametric-portal/database',
                '@parametric-portal/server',
                '@parametric-portal/types',
                'effect',
            ],
            mode: 'library',
            name: 'ParametricAI',
        }),
    ) as UserConfig,
);
