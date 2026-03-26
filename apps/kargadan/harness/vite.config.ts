import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../../vite.factory.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _version = /<Version>([^<]+)<\/Version>/u.exec(readFileSync(fileURLToPath(new URL('../plugin/ParametricPortal.Kargadan.Plugin.csproj', import.meta.url)), 'utf-8'))?.[1]?.trim()
    ?? (() => { process.stderr.write('[FATAL] Kargadan plugin version is missing from apps/kargadan/plugin/ParametricPortal.Kargadan.Plugin.csproj.\n'); process.exit(1); return '' as never; })();

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
                '__APP_VERSION__': JSON.stringify(_version),
            },
        };
    })(),
);
