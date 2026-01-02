/**
 * Seed theme orchestrator: numbered accents + canonical scales -> CSS tokens.
 * Grounding: Combines color-derivation + scale-derivation for minimal-input theme generation.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ColorCategory } from '@parametric-portal/types/ui';
import { TW } from '@parametric-portal/types/ui';
import { Effect, pipe, Schema as S } from 'effect';
import type { ParseError } from 'effect/ParseResult';
import type { Plugin } from 'vite';
import { OklchColor, ThemeError } from './colors.ts';
import { createParametricPlugin } from './plugin.ts';
import type { Density, GeneratedTokens } from './scale-derivation.ts';
import { generateTokensFromScale, ScaleConfig } from './scale-derivation.ts';

// --- [TYPES] -----------------------------------------------------------------

type ColorScale = { readonly name: string; readonly steps: readonly number[]; readonly colors: readonly OklchColor[] };
type StateVariant = { readonly name: string; readonly state: string; readonly color: OklchColor };
type ModeSpec = { readonly l: number; readonly c: number };
type AccentConfig = {
    readonly hue: number;
    readonly label?: string;
    readonly chroma?: number;
    readonly lightness?: number;
};
type SeedThemeInput = {
    readonly surfaceHue: number;
    readonly mode: Mode;
    readonly destructiveHue: number;
    readonly successHue: number;
    readonly warningHue: number;
    readonly accent1: AccentConfig;
    readonly accent2?: AccentConfig;
    readonly accent3?: AccentConfig;
    readonly accent4?: AccentConfig;
    readonly accent5?: AccentConfig;
    readonly accent6?: AccentConfig;
    readonly accent7?: AccentConfig;
    readonly accent8?: AccentConfig;
    readonly accent9?: AccentConfig;
    readonly accent10?: AccentConfig;
    readonly scale: number;
    readonly density: Density;
    readonly baseSpacing: number;
    readonly baseRadius: number;
};
type CategoryDef = {
    readonly name: ColorCategory;
    readonly hue: number;
    readonly lc: ModeSpec;
};
type CategoryOutput = {
    readonly scale: ColorScale;
    readonly states: readonly StateVariant[];
    readonly textOn: OklchColor | null;
};

// --- [SCHEMA] ----------------------------------------------------------------

const HueSchema = pipe(S.Number, S.between(0, 360));
const ScaleSchema = pipe(S.Number, S.between(0.8, 1.5));
const ModeSchema = S.Literal('dark', 'light');
const DensitySchema = S.Literal('compact', 'comfortable', 'spacious');
const AccentConfigSchema = S.Struct({
    chroma: S.optional(S.Number),
    hue: HueSchema,
    label: S.optional(S.String),
    lightness: S.optional(S.Number),
});
const SeedThemeInputSchema = S.Struct({
    accent1: AccentConfigSchema,
    accent2: S.optional(AccentConfigSchema),
    accent3: S.optional(AccentConfigSchema),
    accent4: S.optional(AccentConfigSchema),
    accent5: S.optional(AccentConfigSchema),
    accent6: S.optional(AccentConfigSchema),
    accent7: S.optional(AccentConfigSchema),
    accent8: S.optional(AccentConfigSchema),
    accent9: S.optional(AccentConfigSchema),
    accent10: S.optional(AccentConfigSchema),
    baseRadius: S.Number,
    baseSpacing: S.Number,
    density: DensitySchema,
    destructiveHue: HueSchema,
    mode: ModeSchema,
    scale: ScaleSchema,
    successHue: HueSchema,
    surfaceHue: HueSchema,
    warningHue: HueSchema,
});
type ValidatedInput = S.Schema.Type<typeof SeedThemeInputSchema>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    fallbackColor: Object.freeze({ a: 1, c: 0.1, h: 0, l: 0.5 }) as OklchColor,
    infoHueOffset: 30,
    lightnessClamp: Object.freeze({ max: 0.98, min: 0.02 }),
    mode: Object.freeze({
        dark: Object.freeze({
            accent: { c: 0.2, l: 0.65 },
            border: { c: 0.02, l: 0.5 },
            surface: { c: 0.01, l: 0.18 },
            text: { c: 0.02, l: 0.92 },
        }),
        light: Object.freeze({
            accent: { c: 0.2, l: 0.55 },
            border: { c: 0.02, l: 0.35 },
            surface: { c: 0.01, l: 0.96 },
            text: { c: 0.02, l: 0.15 },
        }),
    }),
    scaleRange: Object.freeze({ chromaDecay: 0.4, targetRange: 0.6 }),
    semantic: Object.freeze({
        destructive: { c: 0.22, l: 0.6 },
        info: { c: 0.1, l: 0.65 },
        muted: { c: 0.04, l: 0.5 },
        success: { c: 0.18, l: 0.65 },
        warning: { c: 0.15, l: 0.7 },
    }),
    stateKeys: [
        'hovered',
        'pressed',
        'focused',
        'selected',
        'disabled',
    ] satisfies readonly (typeof OklchColor.RacState.Type)[],
    textOnCategories: [
        'accent1',
        'accent2',
        'accent3',
        'accent4',
        'accent5',
        'accent6',
        'accent7',
        'accent8',
        'accent9',
        'accent10',
        'destructive',
        'info',
        'success',
        'warning',
    ] as const,
    watchPaths: ['src/theme.config.ts', 'theme.config.ts'] as const,
} as const);
type Mode = keyof typeof B.mode;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const formatVar = (prefix: string, segments: readonly (string | number)[], value: string): string =>
    `  --${[prefix, ...segments.map(String)].join('-')}: ${value};`;
const clampLightness = (value: number): number => Math.max(B.lightnessClamp.min, Math.min(B.lightnessClamp.max, value));
const computeStepLightness = (baseLightness: number, stepIndex: number, totalSteps: number, range: number): number => {
    const midIndex = Math.floor(totalSteps / 2);
    const offset = (stepIndex - midIndex) * (range / Math.max(1, midIndex));
    return clampLightness(baseLightness + offset);
};
const computeStepChroma = (baseChroma: number, stepIndex: number, totalSteps: number): number => {
    const midIndex = Math.floor(totalSteps / 2);
    const decay = (Math.abs(stepIndex - midIndex) / Math.max(1, midIndex)) * B.scaleRange.chromaDecay;
    return Math.max(0, baseChroma * (1 - decay));
};
const getColorAt = (colors: readonly OklchColor[], idx: number): OklchColor =>
    colors[idx] ?? colors[0] ?? B.fallbackColor;
const formatScaleCSS = (scale: ColorScale): readonly string[] =>
    scale.steps.map((step, idx) => formatVar('color', [scale.name, step], getColorAt(scale.colors, idx).to('css')));
const formatStateCSS = (variants: readonly StateVariant[]): readonly string[] =>
    variants.map((v) => formatVar('color', [v.name, v.state], v.color.to('css')));
const formatTextOnCSS = (name: string, color: OklchColor): string =>
    formatVar('color', ['text-on', name], color.to('css'));
const formatTokensCSS = (tokens: GeneratedTokens): readonly string[] => [
    ...Object.entries(tokens.container).map(([k, v]) => formatVar('container', [k], v)),
    ...Object.entries(tokens.duration).map(([k, v]) => formatVar('animation-duration', [k], v)),
    ...Object.entries(tokens.easing).map(([k, v]) => formatVar('animation-easing', [k], v)),
    ...Object.entries(tokens.focusRing).map(([k, v]) => formatVar('focus-ring', [k], v)),
    ...Object.entries(tokens.fontSize).map(([k, v]) => formatVar('font-size', [k], v)),
    ...Object.entries(tokens.fontWeight).map(([k, v]) => formatVar('font-weight', [k], String(v))),
    ...Object.entries(tokens.leading).map(([k, v]) => formatVar('leading', [k], String(v))),
    ...Object.entries(tokens.lineHeight).map(([k, v]) => formatVar('line-height', [k], String(v))),
    ...Object.entries(tokens.opacity).map(([k, v]) => formatVar('opacity', [k], String(v))),
    ...Object.entries(tokens.radius).map(([k, v]) => formatVar('radius', [k], v)),
    ...Object.entries(tokens.shadow).map(([k, v]) => formatVar('shadow', [k], v)),
    ...Object.entries(tokens.spacing).map(([k, v]) => formatVar('spacing', [k], v)),
    ...Object.entries(tokens.state).map(([k, v]) => formatVar('state', [k], String(v))),
    ...Object.entries(tokens.tracking).map(([k, v]) => formatVar('tracking', [k], v)),
    ...Object.entries(tokens.zIndex).map(([k, v]) => formatVar('z', [k], String(v))),
];
const buildCategories = (input: ValidatedInput): readonly CategoryDef[] => {
    const m = B.mode[input.mode];
    const accents = [
        { config: input.accent1, name: 'accent1' as const },
        input.accent2 ? { config: input.accent2, name: 'accent2' as const } : null,
        input.accent3 ? { config: input.accent3, name: 'accent3' as const } : null,
        input.accent4 ? { config: input.accent4, name: 'accent4' as const } : null,
        input.accent5 ? { config: input.accent5, name: 'accent5' as const } : null,
        input.accent6 ? { config: input.accent6, name: 'accent6' as const } : null,
        input.accent7 ? { config: input.accent7, name: 'accent7' as const } : null,
        input.accent8 ? { config: input.accent8, name: 'accent8' as const } : null,
        input.accent9 ? { config: input.accent9, name: 'accent9' as const } : null,
        input.accent10 ? { config: input.accent10, name: 'accent10' as const } : null,
    ].filter((a): a is NonNullable<typeof a> => a !== null);
    return [
        { hue: input.surfaceHue, lc: m.surface, name: 'surface' },
        { hue: input.surfaceHue, lc: m.text, name: 'text' },
        { hue: input.surfaceHue, lc: m.border, name: 'border' },
        { hue: input.surfaceHue, lc: B.semantic.muted, name: 'muted' },
        { hue: input.destructiveHue, lc: B.semantic.destructive, name: 'destructive' },
        { hue: input.successHue, lc: B.semantic.success, name: 'success' },
        { hue: input.warningHue, lc: B.semantic.warning, name: 'warning' },
        { hue: (input.surfaceHue + B.infoHueOffset) % 360, lc: B.semantic.info, name: 'info' },
        ...accents.map((a) => ({
            hue: a.config.hue,
            lc: { c: a.config.chroma ?? m.accent.c, l: a.config.lightness ?? m.accent.l },
            name: a.name,
        })),
    ];
};
const resolveWatchFiles = (explicit?: ReadonlyArray<string>): ReadonlyArray<string> =>
    explicit ?? B.watchPaths.map((p) => path.resolve(process.cwd(), p)).filter((f) => fs.existsSync(f));
const mapParseError = (error: ParseError, category: string, phase: 'color' | 'scale' | 'token'): ThemeError =>
    ThemeError.Generation({ category, message: error.message, phase });

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const deriveTextOnColor = (bg: OklchColor): Effect.Effect<OklchColor, ParseError> =>
    Effect.gen(function* () {
        const { black, white } = yield* Effect.all({
            black: OklchColor.create(0, 0, 0, 1),
            white: OklchColor.create(1, 0, 0, 1),
        });
        return Math.abs(white.contrast(bg)) >= Math.abs(black.contrast(bg)) ? white : black;
    });
const createBaseOklch = (hue: number, lc: ModeSpec): Effect.Effect<OklchColor, ParseError> =>
    OklchColor.create(lc.l, lc.c, hue, 1);
const generateColorScale = (
    name: string,
    base: OklchColor,
    steps: readonly number[],
): Effect.Effect<ColorScale, ParseError> =>
    Effect.gen(function* () {
        const colors = yield* Effect.forEach(steps, (_, idx) =>
            OklchColor.create(
                computeStepLightness(base.l, idx, steps.length, B.scaleRange.targetRange),
                computeStepChroma(base.c, idx, steps.length),
                base.h,
                1,
            ),
        );
        return { colors, name, steps };
    });
const applyStateShift = (
    base: OklchColor,
    shifts: typeof OklchColor.StateShift.Type,
): Effect.Effect<OklchColor, ParseError> =>
    OklchColor.adjust(base, shifts.lightnessShift, shifts.chromaShift, 0, shifts.alphaShift);
const generateStateVariants = (
    name: string,
    base: OklchColor,
    category: ColorCategory,
): Effect.Effect<readonly StateVariant[], ParseError> =>
    Effect.gen(function* () {
        const shifts = base.deriveAllShifts(category);
        const stateVariants = yield* Effect.forEach(B.stateKeys, (state) =>
            Effect.gen(function* () {
                const color = yield* applyStateShift(base, shifts[state]);
                return { color, name, state };
            }),
        );
        return [{ color: base, name, state: 'base' }, ...stateVariants];
    });
const generateCategory = (name: ColorCategory, hue: number, lc: ModeSpec): Effect.Effect<CategoryOutput, ParseError> =>
    Effect.gen(function* () {
        const base = yield* createBaseOklch(hue, lc);
        const { scale, states } = yield* Effect.all({
            scale: generateColorScale(name, base, TW.colorStep),
            states: generateStateVariants(name, base, name),
        });
        const needsTextOn = B.textOnCategories.includes(name as (typeof B.textOnCategories)[number]);
        const textOn = needsTextOn ? yield* deriveTextOnColor(base) : null;
        return { scale, states, textOn };
    });
const generateThemeCSS = (input: ValidatedInput): Effect.Effect<string, ParseError> =>
    Effect.gen(function* () {
        const categories = buildCategories(input);
        const scaleConfig = ScaleConfig.fromDensity(input.scale, input.density);
        const tokens = generateTokensFromScale(scaleConfig);
        const results = yield* Effect.forEach(categories, (cat) => generateCategory(cat.name, cat.hue, cat.lc));
        const colorLines = results.flatMap((r) => [
            ...formatScaleCSS(r.scale),
            ...formatStateCSS(r.states),
            ...(r.textOn ? [formatTextOnCSS(r.scale.name, r.textOn)] : []),
        ]);
        const tokenLines = formatTokensCSS(tokens);
        return ['@theme {', ...colorLines, ...tokenLines, '}'].join('\n');
    });
const validateInput = (input: unknown): Effect.Effect<ValidatedInput, ParseError> =>
    S.decodeUnknown(SeedThemeInputSchema)(input);

// --- [ENTRY_POINT] -----------------------------------------------------------

const generateSeedThemeCSS = (input: SeedThemeInput): Effect.Effect<string, ThemeError> =>
    pipe(
        validateInput(input),
        Effect.mapError((e) => ThemeError.Validation({ field: 'SeedThemeInput', message: e.message, received: input })),
        Effect.flatMap((validated) =>
            pipe(
                generateThemeCSS(validated),
                Effect.mapError((e) => mapParseError(e, 'theme', 'color')),
            ),
        ),
    );
const defineSeedTheme = (input: SeedThemeInput, watchFiles?: ReadonlyArray<string>): Plugin =>
    createParametricPlugin<SeedThemeInput>({
        generate: () => generateSeedThemeCSS(input),
        name: 'seed-theme',
        sectionLabel: 'SEED_THEME',
        virtualId: 'seed-theme',
        watchFiles: resolveWatchFiles(watchFiles),
    })(input);

// --- [EXPORT] ----------------------------------------------------------------

export { defineSeedTheme, B as SEED_THEME_TUNING };
export type { AccentConfig, Mode, SeedThemeInput };
