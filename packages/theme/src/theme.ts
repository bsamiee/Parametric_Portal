/**
 * Generate type-safe theme CSS from OKLCH specifications.
 * Grounding: Single-source-of-truth for Tailwind @theme blocks via Vite virtual modules.
 */
import { Effect, pipe } from 'effect';
import type { ParseError } from 'effect/ParseResult';
import { colors } from './colors.ts';
import { createParametricPlugin, normalizeInputs } from './plugin.ts';
import { type OklchColor, type ThemeInput, validate } from './schemas.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const c = colors();

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
    clamp: { max: 0.98, min: 0.02 },
    multipliers: { alpha: 0.5, chroma: 0.03, lightness: 0.08 },
    scale: {
        algorithm: { chromaDecay: 0.4, targetRange: 0.1 },
        increment: 50,
    },
    spacing: { increment: 0.25 },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/** Format color CSS variable or skip if undefined. Grounding: Schema permits optional modifier overrides. */
const formatColorStep = (name: string, step: number, color: OklchColor | null | undefined): ReadonlyArray<string> =>
    color ? [`  --color-${name}-${step}: ${c.toCSS(color)};`] : [];

// --- [EFFECT_PIPELINE] -------------------------------------------------------

/** Apply relative shifts to OKLCH channels. Grounding: Multiplicative shifts preserve perceptual relationships. */
const applyShifts = (
    shifts: { alphaShift: number; chromaShift: number; lightnessShift: number },
    color: OklchColor,
): Effect.Effect<OklchColor, ParseError> =>
    c.create(
        color.l * (1 + shifts.lightnessShift * B.multipliers.lightness),
        color.c * (1 + shifts.chromaShift * B.multipliers.chroma),
        color.h,
        color.a * (1 + shifts.alphaShift * B.multipliers.alpha),
    );

const createThemeBlock = (input: ThemeInput): Effect.Effect<string, ParseError> =>
    pipe(
        c.create(input.lightness, input.chroma, input.hue, input.alpha),
        Effect.flatMap((base) => {
            const steps = Array.from({ length: input.scale }, (_, i) => (i + 1) * B.scale.increment);
            const enabledBaseline = (Object.keys(B.baseline) as ReadonlyArray<keyof typeof B.baseline>).filter(
                (key) => input.modifiers?.[key] !== undefined,
            );
            const midIndex = Math.floor(steps.length / 2);
            const range = input.targetRange ?? B.scale.algorithm.targetRange;
            const stepSize = range / Math.max(1, midIndex);

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
                    scale: Effect.forEach(steps, (_, stepIndex) => {
                        const stepsFromMid = stepIndex - midIndex;
                        const rawL = base.l + stepsFromMid * stepSize;
                        const chromaFactor =
                            1 - Math.abs(stepsFromMid / Math.max(1, midIndex)) * B.scale.algorithm.chromaDecay;
                        return c.create(
                            Math.max(B.clamp.min, Math.min(B.clamp.max, rawL)),
                            base.c * chromaFactor,
                            base.h,
                            base.a,
                        );
                    }),
                    spacing: Effect.succeed(
                        input.spacing
                            ? Array.from(
                                  { length: input.spacing },
                                  (_, i) => `  --spacing-${i + 1}: ${(i + 1) * B.spacing.increment}rem;`,
                              )
                            : [],
                    ),
                }),
                Effect.map(({ scale, baseline, custom, spacing }) =>
                    [
                        '@theme {',
                        ...steps.flatMap((step, i) => formatColorStep(input.name, step, scale[i])),
                        ...baseline.map(([name, color]) => `  --color-${input.name}-${name}: ${c.toCSS(color)};`),
                        ...custom.map(([name, color]) => `  --color-${input.name}-${name}: ${c.toCSS(color)};`),
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
                    validate.theme(input),
                    Effect.flatMap(createThemeBlock),
                    Effect.catchAll((error) => Effect.succeed(`/* Failed: ${input.name} - ${error._tag} */`)),
                ),
            ),
            Effect.map((blocks) => blocks.join('\n\n')),
        ),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const defineThemes = createParametricPlugin<ThemeInput>({
    generate: generateAllThemes,
    name: 'theme',
    sectionLabel: 'THEME',
    virtualId: 'theme',
});

// --- [EXPORT] ----------------------------------------------------------------

export { B as THEME_TUNING, defineThemes };
export type { ThemeInput } from './schemas.ts';
