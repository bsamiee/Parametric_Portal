/// <reference types="vite/client" />
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devtoolsPlugin } from '@parametric-portal/devtools/vite-plugin';
import { Effect } from 'effect';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

const APP_ROOT = dirname(fileURLToPath(import.meta.url));

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    app: {
        name: 'ParametricIcons',
        port: 3001,
    },
    pwa: {
        description: 'AI-powered SVG icon generator for Grasshopper/Rhino',
        name: 'Parametric Icons',
        shortName: 'Icons',
        themeColor: '#1a1a2e',
    },
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const baseConfig = Effect.runSync(
    createConfig({
        builder: { buildStrategy: 'serial' },
        mode: 'app',
        name: B.app.name,
        port: B.app.port,
        pwa: B.pwa,
        root: APP_ROOT,
    }),
);

export default defineConfig({
    ...baseConfig,
    plugins: [...devtoolsPlugin({ app: B.app.name }), ...(baseConfig.plugins ?? [])],
});
