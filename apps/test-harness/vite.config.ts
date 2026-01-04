/// <reference types="vite/client" />
/**
 * Test harness Vite config: Dracula theme + Button ComponentSpec.
 * Validates theme generation + component wiring pipeline.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devtoolsPlugin } from '@parametric-portal/devtools/vite-plugin';
import { defineTheme } from '@parametric-portal/theme/theme';
import { Effect } from 'effect';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const APP_ROOT = dirname(fileURLToPath(import.meta.url));
const B = Object.freeze({
    app: { name: 'TestHarness', port: 3002 },
    theme: {
        colors: {
            // Dracula palette → OKLCH
            accent: { c: 0.22, h: 340, l: 0.72 }, // Pink #ff79c6
            danger: { c: 0.25, h: 25, l: 0.65 }, // Red #ff5555
            primary: { c: 0.18, h: 290, l: 0.72 }, // Purple #bd93f9
            secondary: { c: 0.12, h: 195, l: 0.85 }, // Cyan #8be9fd
            success: { c: 0.25, h: 145, l: 0.85 }, // Green #50fa7b
            surface: { c: 0.02, h: 260, l: 0.22 }, // Background #282a36
            text: { c: 0.01, h: 90, l: 0.97 }, // Foreground #f8f8f2
            warning: { c: 0.15, h: 55, l: 0.82 }, // Orange #ffb86c
        },
        components: [
            {
                asyncStyles: {
                    failure: { 'icon-animation': 'shake 0.3s ease-in-out' },
                    idle: { 'icon-animation': 'none' },
                    loading: { 'icon-animation': 'spin 0.8s ease-in-out infinite' },
                    success: { 'icon-animation': 'none' },
                },
                base: {
                    'disabled-opacity': '0.5',
                    'focus-ring-color': 'var(--color-primary-400)',
                    'focus-ring-offset': '2px',
                    'focus-ring-width': '2px',
                    'font-size': '0.875rem',
                    'font-weight': '500',
                    gap: '0.5rem',
                    height: '2.5rem',
                    'icon-size': '1rem',
                    'pressed-scale': '0.98',
                    px: '1rem',
                    radius: '0.5rem',
                    shadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
                    'transition-duration': '150ms',
                    'transition-easing': 'ease-out',
                    width: '8rem',
                },
                colorSlots: {
                    bg: '500',
                    'border-color': '500',
                    fg: 'text-on',
                    'focus-ring-color': '400',
                    'hover-bg': 'hovered',
                    'pressed-bg': 'pressed',
                },
                name: 'button',
                sizes: {
                    lg: { 'font-size': '1rem', height: '3rem', 'icon-size': '1.25rem', px: '1.25rem', width: '10rem' },
                    md: {},
                    sm: {
                        'font-size': '0.75rem',
                        height: '2rem',
                        'icon-size': '0.875rem',
                        px: '0.75rem',
                        width: '6rem',
                    },
                },
                variants: {
                    ghost: { bg: 'transparent', 'border-color': 'transparent', 'hover-bg': '100', shadow: 'none' },
                    outline: { bg: 'transparent', 'border-width': '1px', shadow: 'none' },
                    solid: { 'border-color': 'transparent' },
                },
            },
        ],
        fonts: { mono: 'monospace', ui: 'system-ui' },
        stateShifts: {
            disabled: { alpha: -0.4, chroma: -0.1, hue: 0, lightness: 0 },
            focused: { alpha: 0, chroma: 0.01, hue: 0, lightness: 0.03 },
            hovered: { alpha: 0, chroma: 0, hue: 0, lightness: 0.05 },
            pressed: { alpha: 0, chroma: 0.02, hue: 0, lightness: -0.05 },
            selected: { alpha: 0, chroma: 0.03, hue: 0, lightness: -0.08 },
        },
    },
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const baseConfig = Effect.runSync(
    createConfig({
        mode: 'app',
        name: B.app.name,
        port: B.app.port,
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
