/**
 * Generate type-safe theme CSS from open OKLCH specifications.
 * Single defineTheme() export, Tailwind v4 aligned, arbitrary color names.
 * ALL config fields REQUIRED - dev defines everything explicitly.
 */

import type { DeepReadonly } from 'ts-essentials';
import { Array as A, Effect, pipe, Record as R, Schema as S } from 'effect';
import type { Plugin } from 'vite';
import { OklchColor, ThemeError, type ThemeErrorType } from './colors.ts';
import { ComponentSpecSchema, generateComponentWiring, generateTooltipWiring, TooltipStyleSpecSchema } from './component-wiring.ts';
import { createParametricPlugin } from './plugin.ts';

// --- [TYPES] -----------------------------------------------------------------

type ThemeConfig = S.Schema.Type<typeof ThemeConfigSchema>;
type ColorSpec = { readonly c: number; readonly h: number; readonly l: number };
type StateShifts = ThemeConfig['stateShifts'];

// --- [SCHEMA] ----------------------------------------------------------------

const FocusColorRefSchema = S.Struct({
    name: S.String,
    step: S.Number,
});
const ThemeConfigSchema = S.Struct({
    animation: S.Struct({
        enterScale: S.Number.pipe(S.clamp(0, 1)),
        exitScale: S.Number.pipe(S.clamp(0, 1)),
    }),
    colors: S.Record({
        key: S.String,
        value: S.Struct({
            c: S.Number.pipe(S.clamp(0, 0.4)),
            h: S.Number.pipe(S.clamp(0, 360)),
            l: S.Number.pipe(S.clamp(0, 1)),
        }),
    }),
    components: S.Array(ComponentSpecSchema),
    focus: S.Struct({
        color: FocusColorRefSchema,
        offset: S.String,
        width: S.String,
        z: S.String,
    }),
    fonts: S.Record({ key: S.String, value: S.String }),
    interaction: S.Struct({
        announceDuration: S.Number.pipe(S.positive()),
        haptic: S.Boolean,
        hapticDuration: S.Number.pipe(S.positive()),
        longPressThreshold: S.Number.pipe(S.positive()),
    }),
    stateShifts: S.Struct({
        disabled: S.Struct({ alpha: S.Number, chroma: S.Number, hue: S.Number, lightness: S.Number }),
        focused: S.Struct({ alpha: S.Number, chroma: S.Number, hue: S.Number, lightness: S.Number }),
        hovered: S.Struct({ alpha: S.Number, chroma: S.Number, hue: S.Number, lightness: S.Number }),
        pressed: S.Struct({ alpha: S.Number, chroma: S.Number, hue: S.Number, lightness: S.Number }),
        selected: S.Struct({ alpha: S.Number, chroma: S.Number, hue: S.Number, lightness: S.Number }),
    }),
    tooltipGroup: S.Struct({
        boundary: S.optional(S.Union(S.Literal('viewport'), S.Literal('clippingAncestors'))),
        closeDelay: S.Number,
        openDelay: S.Number,
        timeout: S.Number,
    }),
    tooltipStyles: S.optional(S.Array(TooltipStyleSpecSchema)),
});

// --- [CONSTANTS] -------------------------------------------------------------

/** Immutable config for theme generation */
const B = Object.freeze({
    /** Interactive state variants for color derivation */
    colorStates: ['hovered', 'pressed', 'focused', 'selected', 'disabled'] as const,
    /** Prevent pure black/white edge cases in OKLCH color space */
    lightnessClamp: Object.freeze({ max: 0.98, min: 0.02 }),
    /** chromaDecay: chroma fade at scale extremes (50, 950). targetRange: total lightness span */
    scaleRange: Object.freeze({ chromaDecay: 0.4, targetRange: 0.6 }),
    /** Minimum chroma to generate text-on variants; below this, color too desaturated */
    textOnChromaThreshold: 0.08,
}) satisfies DeepReadonly<{
    colorStates: readonly string[];
    lightnessClamp: { max: number; min: number };
    scaleRange: { chromaDecay: number; targetRange: number };
    textOnChromaThreshold: number;
}>;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const CSS = Object.freeze({
    clampLightness: (v: number): number => Math.max(B.lightnessClamp.min, Math.min(B.lightnessClamp.max, v)),
    computeStepChroma: (base: number, idx: number, total: number): number =>
        Math.max(0, base * (1 - (Math.abs(idx - Math.floor(total / 2)) / Math.max(1, Math.floor(total / 2))) * B.scaleRange.chromaDecay)),
    computeStepLightness: (base: number, idx: number, total: number): number =>
        CSS.clampLightness(base + (idx - Math.floor(total / 2)) * (B.scaleRange.targetRange / Math.max(1, Math.floor(total / 2)))),
    formatVar: (prefix: string, segments: readonly (string | number)[], value: string): string =>
        `  --${[prefix, ...segments.map(String)].join('-')}: ${value};`,
});

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const deriveScale = (name: string, spec: ColorSpec) =>
    Effect.forEach(OklchColor.Step, (step, idx) =>
        pipe(
            OklchColor.create(
                CSS.computeStepLightness(spec.l, idx, OklchColor.Step.length),
                CSS.computeStepChroma(spec.c, idx, OklchColor.Step.length),
                spec.h,
                1,
            ),
            Effect.map((c) => CSS.formatVar('color', [name, step], c.to('css'))),
        ),
    );
const deriveStates = (name: string, spec: ColorSpec, stateShifts: StateShifts) =>
    Effect.gen(function* () {
        const base = yield* OklchColor.create(spec.l, spec.c, spec.h, 1);
        return A.map(B.colorStates, (state: keyof StateShifts) => {
            const adjusted = base.adjust(
                stateShifts[state].lightness,
                stateShifts[state].chroma,
                stateShifts[state].hue,
                stateShifts[state].alpha,
            );
            return CSS.formatVar('color', [name, state], adjusted.to('css'));
        });
    });
const deriveTextOnVariants = (name: string, spec: ColorSpec) =>
    Effect.gen(function* () {
        const [black, white] = yield* Effect.all([OklchColor.create(0, 0, 0, 1), OklchColor.create(1, 0, 0, 1)]);
        // APCA polarity: light bg (high L) → dark text, dark bg (low L) → light text
        const best = spec.l > 0.5 ? black : white;
        return [
            CSS.formatVar('color', ['text-on', name], best.to('css')),
            CSS.formatVar('color', ['text-on', name, 'light'], black.to('css')),
            CSS.formatVar('color', ['text-on', name, 'dark'], white.to('css')),
        ];
    });
const generateCategoryCSS = (name: string, spec: ColorSpec, stateShifts: StateShifts) =>
    Effect.gen(function* () {
        const { scale, states } = yield* Effect.all({
            scale: deriveScale(name, spec),
            states: deriveStates(name, spec, stateShifts),
        });
        const textOnLines = spec.c >= B.textOnChromaThreshold ? yield* deriveTextOnVariants(name, spec) : [];
        return [...scale, ...states, ...textOnLines];
    });
const generateFontCSS = (fonts: Record<string, string>): readonly string[] =>
    pipe(
        R.toEntries(fonts),
        A.map(([name, family]) => CSS.formatVar('font', [name], `'${family}', system-ui, sans-serif`)),
    );
const generateAnimationCSS = (animation: ThemeConfig['animation']): readonly string[] => [
    CSS.formatVar('animate', ['enter-scale'], String(animation.enterScale)),
    CSS.formatVar('animate', ['exit-scale'], String(animation.exitScale)),
];
const generateTooltipGroupCSS = (tooltipGroup: ThemeConfig['tooltipGroup']): readonly string[] => [
    ...(tooltipGroup.boundary === undefined ? [] : [CSS.formatVar('tooltip', ['boundary'], tooltipGroup.boundary)]),
    CSS.formatVar('tooltip-group', ['open-delay'], `${tooltipGroup.openDelay}ms`),
    CSS.formatVar('tooltip-group', ['close-delay'], `${tooltipGroup.closeDelay}ms`),
    CSS.formatVar('tooltip-group', ['timeout'], `${tooltipGroup.timeout}ms`),
];
const generateInteractionCSS = (interaction: ThemeConfig['interaction']): readonly string[] => [
    CSS.formatVar('announce', ['duration'], `${interaction.announceDuration}ms`),
    CSS.formatVar('interaction', ['haptic-duration'], `${interaction.hapticDuration}ms`),
    CSS.formatVar('interaction', ['long-press-threshold'], `${interaction.longPressThreshold}ms`),
];
const generateFocusCSS = (focus: ThemeConfig['focus']): readonly string[] => [
    CSS.formatVar('focus-ring', ['width'], focus.width),
    CSS.formatVar('focus-ring', ['color'], `var(--color-${focus.color.name}-${focus.color.step})`),
    CSS.formatVar('focus-ring', ['offset'], focus.offset),
    CSS.formatVar('focus-ring', ['z'], focus.z),
];
const generateThemeCSS = (config: ThemeConfig): Effect.Effect<string, ThemeErrorType> =>
    pipe(
        Effect.gen(function* () {
            const colorEntries = R.toEntries(config.colors);
            const colorNames = A.map(colorEntries, ([name]) => name);
            const colorLines = yield* pipe(
                Effect.forEach(colorEntries, ([name, spec]) => generateCategoryCSS(name, spec, config.stateShifts)),
                Effect.map(A.flatten),
            );
            const fontLines = generateFontCSS(config.fonts);
            const animationLines = generateAnimationCSS(config.animation);
            const tooltipGroupLines = generateTooltipGroupCSS(config.tooltipGroup);
            const interactionLines = generateInteractionCSS(config.interaction);
            const focusLines = generateFocusCSS(config.focus);
            const themeBlock = ['@theme {', ...colorLines, ...fontLines, ...animationLines, ...tooltipGroupLines, ...interactionLines, ...focusLines, '}'].join('\n');
            const wiringBlock = yield* generateComponentWiring(config.components, colorNames);
            const tooltipBlock = config.tooltipStyles === undefined || config.tooltipStyles.length === 0
                ? ''
                : yield* generateTooltipWiring(config.tooltipStyles);
            return [themeBlock, wiringBlock, tooltipBlock].filter(Boolean).join('\n\n');
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
export type { ComponentSpec, TooltipStyleSpec } from './component-wiring.ts';
