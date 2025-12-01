/**
 * Transform OKLCH color scales via Effect schema validation and modifier application.
 */
import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { Effect, Option, pipe } from 'effect';
import type { Plugin } from 'vite';

// --- Types -------------------------------------------------------------------

type OklchColor = S.Schema.Type<typeof OklchColorSchema>;
type ThemeInput = S.Schema.Type<typeof ThemeInputSchema>;

// --- Schema ------------------------------------------------------------------

const ModifierOverrideSchema = S.Union(
    S.Literal(true),
    S.Struct({
        alphaShift: S.optional(S.Number),
        chromaShift: S.optional(S.Number),
        lightnessShift: S.optional(S.Number),
    }),
);

const OklchColorSchema = pipe(
    S.Struct({
        a: pipe(S.Number, S.between(0, 1), S.brand('Alpha')),
        c: pipe(S.Number, S.between(0, 0.4), S.brand('Chroma')),
        // Normalize hue to [0, 360) using double-modulo to handle negative inputs.
        h: pipe(
            S.Number,
            S.transform(S.Number, { decode: (h) => ((h % 360) + 360) % 360, encode: (h) => h }),
            S.brand('Hue'),
        ),
        l: pipe(S.Number, S.between(0, 1), S.brand('Lightness')),
    }),
    S.brand('OklchColor'),
);

const ThemeInputSchema = S.Struct({
    alpha: S.optional(pipe(S.Number, S.between(0, 1))),
    chroma: pipe(S.Number, S.between(0, 0.4)),
    customModifiers: S.optional(
        S.Array(
            S.Struct({
                alphaShift: S.Number,
                chromaShift: S.Number,
                lightnessShift: S.Number,
                name: pipe(S.String, S.pattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
            }),
        ),
    ),
    hue: pipe(S.Number, S.between(0, 360)),
    lightness: pipe(S.Number, S.between(0, 1)),
    modifiers: S.optional(
        S.partial(
            S.Struct({
                active: ModifierOverrideSchema,
                disabled: ModifierOverrideSchema,
                dragged: ModifierOverrideSchema,
                focus: ModifierOverrideSchema,
                hover: ModifierOverrideSchema,
                pressed: ModifierOverrideSchema,
                selected: ModifierOverrideSchema,
            }),
        ),
    ),
    name: pipe(S.String, S.pattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
    scale: pipe(S.Number, S.int(), S.between(2, 20)),
    spacing: S.optional(pipe(S.Number, S.int(), S.between(1, 100))),
});

// --- Constants ---------------------------------------------------------------

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
} as const);

const VIRTUAL_MODULE_ID = Object.freeze({
    resolved: '\0virtual:parametric-theme' as const,
    virtual: 'virtual:parametric-theme' as const,
} as const);

// --- Pure Functions ----------------------------------------------------------

const oklchToCss = (color: OklchColor): string =>
    `oklch(${(color.l * 100).toFixed(1)}% ${color.c.toFixed(3)} ${color.h.toFixed(1)}${color.a < 1 ? ` / ${color.a.toFixed(2)}` : ''})`;

// --- Effect Pipeline ---------------------------------------------------------

const createOklchColor = (l: number, c: number, h: number, a = 1): Effect.Effect<OklchColor, ParseError> =>
    S.decode(OklchColorSchema)({ a, c, h, l } as const);

const applyShifts = (
    shifts: { alphaShift: number; chromaShift: number; lightnessShift: number },
    color: OklchColor,
): Effect.Effect<OklchColor, ParseError> =>
    createOklchColor(
        color.l * (1 + shifts.lightnessShift * B.multipliers.lightness),
        color.c * (1 + shifts.chromaShift * B.multipliers.chroma),
        color.h,
        color.a * (1 + shifts.alphaShift * B.multipliers.alpha),
    );

const createThemeBlock = (input: ThemeInput): Effect.Effect<string, ParseError> =>
    pipe(
        createOklchColor(input.lightness, input.chroma, input.hue, input.alpha),
        Effect.flatMap((base) => {
            const steps = Array.from({ length: input.scale }, (_, i) => (i + 1) * B.scale.increment);
            const mid = steps[Math.floor(input.scale / 2)] ?? steps[0] ?? 0;
            // Include only modifiers specified in input to inherit baseline defaults.
            const enabledBaseline = (Object.keys(B.baseline) as ReadonlyArray<keyof typeof B.baseline>).filter((key) =>
                pipe(Option.fromNullable(input.modifiers?.[key]), Option.isSome),
            );
            return pipe(
                Effect.all({
                    baseline: Effect.forEach(enabledBaseline, (key) => {
                        const baseline = B.baseline[key];
                        const override = input.modifiers?.[key];
                        // Merge partial modifier overrides with baseline defaults via nullish coalescing.
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
                        // Asymmetric lightness scaling: expand toward white [norm > 0] or black [norm < 0] from midpoint.
                        const norm = (step - mid) / mid;
                        return createOklchColor(
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
                        ...steps.flatMap((step, i) =>
                            pipe(
                                Option.fromNullable(scale[i]),
                                Option.match({
                                    onNone: () => [],
                                    onSome: (color) => [`  --color-${input.name}-${step}: ${oklchToCss(color)};`],
                                }),
                            ),
                        ),
                        ...baseline.map(([name, color]) => `  --color-${input.name}-${name}: ${oklchToCss(color)};`),
                        ...custom.map(([name, color]) => `  --color-${input.name}-${name}: ${oklchToCss(color)};`),
                        ...spacing,
                        '}',
                    ].join('\n'),
                ),
            );
        }),
    );

// --- Entry Point -------------------------------------------------------------

const defineThemes = (inputs: ThemeInput | ReadonlyArray<ThemeInput>): Plugin => ({
    enforce: 'pre',
    load: (id) =>
        id === VIRTUAL_MODULE_ID.resolved
            ? Effect.runSync(
                  pipe(
                      Effect.forEach(Array.isArray(inputs) ? inputs : [inputs], (input) =>
                          pipe(
                              S.decode(ThemeInputSchema)(input),
                              Effect.flatMap(createThemeBlock),
                              Effect.catchAll((error) => Effect.succeed(`/* Failed: ${input.name} - ${error._tag} */`)),
                          ),
                      ),
                      Effect.map((blocks) => ['@import "tailwindcss";', ...blocks].join('\n\n')),
                  ),
              )
            : undefined,
    name: 'parametric-theme',
    resolveId: (id) => (id === VIRTUAL_MODULE_ID.virtual ? VIRTUAL_MODULE_ID.resolved : undefined),
});

// --- Export ------------------------------------------------------------------

export { B, defineThemes };
export type { ThemeInput };
