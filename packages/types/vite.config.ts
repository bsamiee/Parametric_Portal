import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                api: './src/api.ts',
                async: './src/async.ts',
                forms: './src/forms.ts',
                stores: './src/stores.ts',
                temporal: './src/temporal.ts',
                types: './src/types.ts',
            },
            external: ['effect', '@effect/schema', 'date-fns', 'immer', 'ts-pattern', 'uuid', 'zustand'],
            mode: 'library',
            name: 'ParametricTypes',
        }),
    ) as UserConfig,
);
