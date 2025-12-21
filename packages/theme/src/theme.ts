/**
 * Generate type-safe theme CSS from OKLCH specifications.
 * Grounding: Single-source-of-truth for Tailwind @theme blocks via Vite virtual modules.
 */
import { Effect, Option, pipe, Schema as S } from 'effect';
import type { ParseError } from 'effect/ParseResult';
import type { Plugin } from 'vite';
import { createOklch, toCSS } from './colors.ts';
import { type OklchColor, type ThemeInput, ThemeInputSchema } from './schemas.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    baseline: {
        active: { alphaShift: 0, chromaShift: 2, lightnessShift: -1 },
        disabled: { alphaShift: -1, chromaShift: -20, lightnessShift: 1.88 },
        dragged: { alphaShift: 0, chromaShift: 0.5, lightnessShift: 0.5 },
        focus: { alphaShift: 0, chromaShift: 1.5, lightnessShift: 1.5 },
        hover: { alphaShift: 0, chromaShift: 1, lightnessShift: 1 },
        pressed: { alphaShift: 0, chromaShift: 2, lightnessShift: -1 },
        selected: { alphaShift: 0, chromaShift: 1, lightnessShift: 0.5 },
    },
    multipliers: { alpha: 0.5, chroma: 0.03, lightness: 0.08 },
    scale: {
        algorithm: { chromaDecay: 0.4, lightnessRange: 0.9 },
        increment: 50,
    },
    spacing: { increment: 0.25 },
    tailwindMarker: '@import "tailwindcss";',
    virtualImportPattern: /@import\s+['"]virtual:parametric-theme['"];?\s*/g,
} as const);

const VIRTUAL_MODULE_ID = Object.freeze({
    resolved: '\0virtual:parametric-theme' as const,
    virtual: 'virtual:parametric-theme' as const,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/** Type guard for theme input arrays. Grounding: TS 6.0-dev requires explicit narrowing for readonly arrays. */
const isThemeInputArray = (input: ThemeInput | ReadonlyArray<ThemeInput>): input is ReadonlyArray<ThemeInput> =>
    Array.isArray(input);

/** Normalize theme input to array. Grounding: API accepts single or batch definitions. */
const normalizeInputs = (input: ThemeInput | ReadonlyArray<ThemeInput>): ReadonlyArray<ThemeInput> =>
    isThemeInputArray(input) ? input : [input];

/** Format color CSS variable or skip if undefined. Grounding: Schema permits optional modifier overrides. */
const formatColorStep = (name: string, step: number, color: OklchColor | null | undefined): ReadonlyArray<string> =>
    color ? [`  --color-${name}-${step}: ${toCSS(color)};`] : [];

// --- [EFFECT_PIPELINE] -------------------------------------------------------

/** Apply relative shifts to OKLCH channels. Grounding: Multiplicative shifts preserve perceptual relationships. */
const applyShifts = (
    shifts: { alphaShift: number; chromaShift: number; lightnessShift: number },
    color: OklchColor,
): Effect.Effect<OklchColor, ParseError> =>
    createOklch(
        color.l * (1 + shifts.lightnessShift * B.multipliers.lightness),
        color.c * (1 + shifts.chromaShift * B.multipliers.chroma),
        color.h,
        color.a * (1 + shifts.alphaShift * B.multipliers.alpha),
    );

const createThemeBlock = (input: ThemeInput): Effect.Effect<string, ParseError> =>
    pipe(
        createOklch(input.lightness, input.chroma, input.hue, input.alpha),
        Effect.flatMap((base) => {
            const steps = Array.from({ length: input.scale }, (_, i) => (i + 1) * B.scale.increment);
            const mid = steps[Math.floor(input.scale / 2)] ?? steps[0] ?? 0;
            const enabledBaseline = (Object.keys(B.baseline) as ReadonlyArray<keyof typeof B.baseline>).filter((key) =>
                pipe(Option.fromNullable(input.modifiers?.[key]), Option.isSome),
            );
            return pipe(
                Effect.all({
                    baseline: Effect.forEach(enabledBaseline, (key) => {
                        const baseline = B.baseline[key];
                        const override = input.modifiers?.[key];
                        const shifts =
                            override === true
                                ? baseline
                                : {
                                      alphaShift: override?.alphaShift ?? baseline.alphaShift,
                                      chromaShift: override?.chromaShift ?? baseline.chromaShift,
                                      lightnessShift: override?.lightnessShift ?? baseline.lightnessShift,
                                  };
                        return pipe(
                            applyShifts(shifts, base),
                            Effect.map((color) => [key, color] as const),
                        );
                    }),
                    custom: Effect.forEach(input.customModifiers ?? [], (spec) =>
                        pipe(
                            applyShifts(spec, base),
                            Effect.map((color) => [spec.name, color] as const),
                        ),
                    ),
                    scale: Effect.forEach(steps, (step) => {
                        // Scale lightness asymmetrically. Grounding: Perceptual uniformity requires non-linear tint/shade distribution.
                        const norm = (step - mid) / mid;
                        return createOklch(
                            base.l + norm * (norm > 0 ? 1 - base.l : base.l) * B.scale.algorithm.lightnessRange,
                            base.c * (1 - (Math.abs(step - mid) / mid) * B.scale.algorithm.chromaDecay),
                            base.h,
                            base.a,
                        );
                    }),
                    spacing: pipe(
                        Option.fromNullable(input.spacing),
                        Option.match({
                            onNone: () => Effect.succeed([] as ReadonlyArray<string>),
                            onSome: (sp) =>
                                Effect.succeed(
                                    Array.from(
                                        { length: sp },
                                        (_, i) => `  --spacing-${i + 1}: ${(i + 1) * B.spacing.increment}rem;`,
                                    ),
                                ),
                        }),
                    ),
                }),
                Effect.map(({ scale, baseline, custom, spacing }) =>
                    [
                        '@theme {',
                        ...steps.flatMap((step, i) => formatColorStep(input.name, step, scale[i])),
                        ...baseline.map(([name, color]) => `  --color-${input.name}-${name}: ${toCSS(color)};`),
                        ...custom.map(([name, color]) => `  --color-${input.name}-${name}: ${toCSS(color)};`),
                        ...spacing,
                        '}',
                    ].join('\n'),
                ),
            );
        }),
    );

/** Generate all theme CSS blocks without Tailwind import. */
const generateAllThemes = (inputs: ThemeInput | ReadonlyArray<ThemeInput>): string =>
    Effect.runSync(
        pipe(
            Effect.forEach(normalizeInputs(inputs), (input) =>
                pipe(
                    S.decode(ThemeInputSchema)(input),
                    Effect.flatMap(createThemeBlock),
                    Effect.catchAll((error) => Effect.succeed(`/* Failed: ${input.name} - ${error._tag} */`)),
                ),
            ),
            Effect.map((blocks) => blocks.join('\n\n')),
        ),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const defineThemes = (inputs: ThemeInput | ReadonlyArray<ThemeInput>): Plugin => ({
    enforce: 'pre',
    load: (id) =>
        id === VIRTUAL_MODULE_ID.resolved ? `${B.tailwindMarker}\n\n${generateAllThemes(inputs)}` : undefined,
    name: 'parametric-theme',
    resolveId: (id) => (id === VIRTUAL_MODULE_ID.virtual ? VIRTUAL_MODULE_ID.resolved : undefined),
    transform: (code, id) =>
        // Inject theme CSS into entry CSS file (bypasses enhanced-resolve limitation)
        !id.endsWith('main.css') || !code.includes(B.tailwindMarker)
            ? undefined
            : code
                  .replaceAll(B.virtualImportPattern, '')
                  .replace(
                      B.tailwindMarker,
                      `${B.tailwindMarker}\n\n/* --- [THEME] --- */\n${generateAllThemes(inputs)}`,
                  ),
});

// --- [EXPORT] ----------------------------------------------------------------

export { B, defineThemes };
export type { ThemeInput } from './schemas.ts';
