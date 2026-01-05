/**
 * Generate type-safe theme CSS from open OKLCH specifications.
 * Single defineTheme() export, Tailwind v4 aligned, arbitrary color names.
 * ALL config fields REQUIRED - dev defines everything explicitly.
 */

import { Effect, pipe, Schema as S } from 'effect';
import type { Plugin } from 'vite';
import { OklchColor, ThemeError } from './colors.ts';
import { ComponentSpecSchema, generateComponentWiring } from './component-wiring.ts';
import { createParametricPlugin } from './plugin.ts';

// --- [TYPES] -----------------------------------------------------------------

type ThemeConfig = S.Schema.Type<typeof ThemeConfigSchema>;
type ColorSpec = { readonly c: number; readonly h: number; readonly l: number };
type StateShifts = ThemeConfig['stateShifts'];

// --- [SCHEMA] ----------------------------------------------------------------

const ThemeConfigSchema = S.Struct({
    colors: S.Record({
        key: S.String,
        value: S.Struct({
            c: S.Number.pipe(S.clamp(0, 0.4)),
            h: S.Number.pipe(S.clamp(0, 360)),
            l: S.Number.pipe(S.clamp(0, 1)),
        }),
    }),
    components: S.Array(ComponentSpecSchema),
    fonts: S.Record({ key: S.String, value: S.String }),
    stateShifts: S.Struct({
        disabled: S.Struct({ alpha: S.Number, chroma: S.Number, hue: S.Number, lightness: S.Number }),
        focused: S.Struct({ alpha: S.Number, chroma: S.Number, hue: S.Number, lightness: S.Number }),
        hovered: S.Struct({ alpha: S.Number, chroma: S.Number, hue: S.Number, lightness: S.Number }),
        pressed: S.Struct({ alpha: S.Number, chroma: S.Number, hue: S.Number, lightness: S.Number }),
        selected: S.Struct({ alpha: S.Number, chroma: S.Number, hue: S.Number, lightness: S.Number }),
    }),
});

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    colorStates: ['hovered', 'pressed', 'focused', 'selected', 'disabled'] as const,
    lightnessClamp: Object.freeze({ max: 0.98, min: 0.02 }),
    scaleRange: Object.freeze({ chromaDecay: 0.4, targetRange: 0.6 }),
    textOnChromaThreshold: 0.08,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const clampLightness = (v: number): number => Math.max(B.lightnessClamp.min, Math.min(B.lightnessClamp.max, v));
const formatVar = (prefix: string, segments: readonly (string | number)[], value: string): string =>
    `  --${[prefix, ...segments.map(String)].join('-')}: ${value};`;
const computeStepLightness = (base: number, idx: number, total: number): number =>
    clampLightness(base + (idx - Math.floor(total / 2)) * (B.scaleRange.targetRange / Math.max(1, Math.floor(total / 2))));
const computeStepChroma = (base: number, idx: number, total: number): number =>
    Math.max(0, base * (1 - (Math.abs(idx - Math.floor(total / 2)) / Math.max(1, Math.floor(total / 2))) * B.scaleRange.chromaDecay));

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const deriveScale = (name: string, spec: ColorSpec) =>
    Effect.forEach(OklchColor.Step, (step, idx) =>
        pipe(
            OklchColor.create(
                computeStepLightness(spec.l, idx, OklchColor.Step.length),
                computeStepChroma(spec.c, idx, OklchColor.Step.length),
                spec.h,
                1,
            ),
            Effect.map((c) => formatVar('color', [name, step], c.to('css'))),
        ),
    );
const deriveStates = (name: string, spec: ColorSpec, stateShifts: StateShifts) =>
    Effect.gen(function* () {
        const base = yield* OklchColor.create(spec.l, spec.c, spec.h, 1);
        return yield* Effect.forEach(B.colorStates, (state) =>
            pipe(
                base.withAdjustment(
                    stateShifts[state].lightness,
                    stateShifts[state].chroma,
                    stateShifts[state].hue,
                    stateShifts[state].alpha,
                ),
                Effect.map((c) => formatVar('color', [name, state], c.to('css'))),
            ),
        );
    });
const deriveTextOn = (name: string, spec: ColorSpec) =>
    Effect.gen(function* () {
        const base = yield* OklchColor.create(spec.l, spec.c, spec.h, 1);
        const [black, white] = yield* Effect.all([OklchColor.create(0, 0, 0, 1), OklchColor.create(1, 0, 0, 1)]);
        const textOn = Math.abs(white.contrast(base)) >= Math.abs(black.contrast(base)) ? white : black;
        return formatVar('color', ['text-on', name], textOn.to('css'));
    });
const generateCategoryCSS = (name: string, spec: ColorSpec, stateShifts: StateShifts) =>
    Effect.gen(function* () {
        const { scale, states } = yield* Effect.all({
            scale: deriveScale(name, spec),
            states: deriveStates(name, spec, stateShifts),
        });
        const textOnLine = spec.c >= B.textOnChromaThreshold ? yield* deriveTextOn(name, spec) : null;
        return [...scale, ...states, ...(textOnLine === null ? [] : [textOnLine])];
    });
const generateFontCSS = (fonts: Record<string, string>): readonly string[] =>
    Object.entries(fonts).map(([name, family]) => formatVar('font', [name], `'${family}', system-ui, sans-serif`));
const generateThemeCSS = (config: ThemeConfig): Effect.Effect<string, ThemeError> =>
    pipe(
        Effect.gen(function* () {
            const colorNames = Object.keys(config.colors);
            const colorLines = yield* pipe(
                Effect.forEach(Object.entries(config.colors), ([name, spec]) =>
                    generateCategoryCSS(name, spec, config.stateShifts),
                ),
                Effect.map((lines) => lines.flat()),
            );
            const fontLines = generateFontCSS(config.fonts);
            const themeBlock = ['@theme {', ...colorLines, ...fontLines, '}'].join('\n');
            const wiringBlock = yield* generateComponentWiring(config.components, colorNames);
            return [themeBlock, wiringBlock].filter(Boolean).join('\n\n');
        }),
        Effect.mapError((e) => ThemeError.Generation({ category: 'theme', message: String(e), phase: 'color' })),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const defineTheme = (config: ThemeConfig, watchFiles?: readonly string[]): Plugin =>
    createParametricPlugin<ThemeConfig>({
        generate: () => generateThemeCSS(config),
        name: 'theme',
        sectionLabel: 'THEME',
        virtualId: 'theme',
        ...(watchFiles === undefined ? {} : { watchFiles }),
    })(config);

// --- [EXPORT] ----------------------------------------------------------------

export { defineTheme };
export type { ThemeConfig };
