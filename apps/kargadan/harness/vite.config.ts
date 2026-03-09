import { readFileSync } from 'node:fs';
import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../../vite.factory.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    (() => {
        const base = Effect.runSync(
            createConfig({
                entry: './src/cli.ts',
                external: [],
                mode: 'server',
                name: 'KargadanHarness',
                port: 4010,
            }),
        ) as UserConfig;
        return {
            ...base,
            define: {
                ...base.define,
                '__APP_VERSION__': JSON.stringify(_pkg.version),
            },
        };
    })(),
);
