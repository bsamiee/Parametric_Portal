/// <reference types="vite/client" />
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devtoolsPlugin } from '@parametric-portal/devtools/vite-plugin';
import { defineTheme } from '@parametric-portal/theme/theme';
import { Effect } from 'effect';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

const APP_ROOT = dirname(fileURLToPath(import.meta.url));

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    app: { name: 'ParametricIcons', port: 3001 },
    pwa: {
        description: 'AI-powered SVG icon generator for Grasshopper/Rhino',
        name: 'Parametric Icons',
        shortName: 'Icons',
        themeColor: '#1a1a2e',
    },
    theme: {
        colors: {
            accent: { c: 0.2, h: 280, l: 0.55 },
            cyan: { c: 0.15, h: 195, l: 0.6 },
            destructive: { c: 0.22, h: 25, l: 0.55 },
            highlight: { c: 0.18, h: 320, l: 0.65 },
            info: { c: 0.12, h: 220, l: 0.6 },
            muted: { c: 0.04, h: 260, l: 0.5 },
            pink: { c: 0.2, h: 350, l: 0.6 },
            success: { c: 0.18, h: 145, l: 0.55 },
            surface: { c: 0.01, h: 260, l: 0.18 },
            text: { c: 0.02, h: 260, l: 0.92 },
            warning: { c: 0.15, h: 45, l: 0.7 },
        },
        components: [],
        fonts: {},
        stateShifts: {
            disabled: { alpha: -0.5, chroma: -0.1, hue: 0, lightness: 0 },
            focused: { alpha: 0, chroma: 0.05, hue: 0, lightness: 0.05 },
            hovered: { alpha: 0, chroma: 0.02, hue: 0, lightness: 0.08 },
            pressed: { alpha: 0, chroma: 0.02, hue: 0, lightness: -0.05 },
            selected: { alpha: 0, chroma: 0.05, hue: 0, lightness: 0.1 },
        },
    },
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const baseConfig = Effect.runSync(
    createConfig({
        mode: 'app',
        name: B.app.name,
        port: B.app.port,
        pwa: B.pwa,
        root: APP_ROOT,
    }),
);

export default defineConfig({
    ...baseConfig,
    plugins: [
        defineTheme(B.theme, ['src/main.css']),
        ...devtoolsPlugin({ app: B.app.name }),
        ...(baseConfig.plugins ?? []),
    ],
});
