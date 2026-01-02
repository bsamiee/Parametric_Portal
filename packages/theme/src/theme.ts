/**
 * Generate type-safe theme CSS from OKLCH specifications.
 * Grounding: Single defineTheme() export, Tailwind v4 aligned, unified token generation.
 */

import type { ColorCategory } from '@parametric-portal/types/ui';
import { Array as A, Effect, Option, pipe, Schema as S } from 'effect';
import { OklchColor, ThemeError } from './colors.ts';
import { createParametricPlugin, normalizeInputs } from './plugin.ts';

// --- [TYPES] -----------------------------------------------------------------

type ModifierConfig = Record<string, typeof OklchColor.StateShift.Type>;
type LchInput = { readonly l: number; readonly c: number; readonly h: number };
type ThemeInput = S.Schema.Type<typeof ThemeInputSchema>;
type StringToken = 'container' | 'easing' | 'focusRing' | 'shadow' | 'tracking';
type NumberToken = 'duration' | 'fontWeight' | 'leading' | 'opacity' | 'radius' | 'state' | 'zIndex';
type TokenValues = { readonly [K in StringToken]: Record<string, string> } & {
    readonly [K in NumberToken]: Record<string, number>;
} & { readonly spacing: number };
type DefineThemeInput = { readonly [K in ColorCategory]?: LchInput } & {
    readonly targetRange: number;
    readonly scales: { readonly [K in ColorCategory]?: number };
    readonly modifiers: { readonly [K in ColorCategory]?: ModifierConfig };
    readonly tokens: TokenValues;
};

// --- [SCHEMA] ----------------------------------------------------------------

const ModifierOverrideSchema = S.Struct({ alphaShift: S.Number, chromaShift: S.Number, lightnessShift: S.Number });
const ThemeInputSchema = S.Struct({
    alpha: S.optional(pipe(S.Number, S.between(0, 1))),
    chroma: pipe(S.Number, S.between(0, 0.4)),
    hue: pipe(S.Number, S.between(0, 360)),
    lightness: pipe(S.Number, S.between(0, 1)),
    modifiers: S.optional(
        S.partial(
            S.Struct({
                disabled: ModifierOverrideSchema,
                focused: ModifierOverrideSchema,
                hovered: ModifierOverrideSchema,
                pressed: ModifierOverrideSchema,
                selected: ModifierOverrideSchema,
            }),
        ),
    ),
    name: pipe(S.String, S.pattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
    scale: pipe(S.Number, S.int(), S.between(2, 20)),
    targetRange: S.optional(pipe(S.Number, S.between(0.05, 0.9))),
});

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    colorCategories: [
        'surface',
        'text',
        'border',
        'destructive',
        'success',
        'warning',
        'info',
        'muted',
    ] satisfies readonly ColorCategory[],
    contrastMax: 'oklch(100% 0 0)',
    lightnessClamp: Object.freeze({ max: 0.98, min: 0.02 }),
    multipliers: Object.freeze({ alpha: 0.5, chroma: 0.03, lightness: 0.08 }),
    prefix: Object.freeze({
        container: 'container',
        duration: 'animation-duration',
        easing: 'animation-easing',
        focusRing: 'focus-ring',
        fontWeight: 'font-weight',
        leading: 'leading',
        opacity: 'opacity',
        radius: 'radius',
        shadow: 'shadow',
        spacing: 'spacing',
        state: 'state',
        tracking: 'tracking',
        zIndex: 'z',
    }),
    scale: Object.freeze({ chromaDecay: 0.4, increment: 50 }),
    surfaceBorderSteps: [100, 200] as const,
    textOnCategories: ['accent', 'destructive', 'info', 'muted', 'success', 'warning'] as const,
    valueFormatters: Object.freeze({
        duration: (v: number) => `${v}ms`,
        radius: (v: number) => (v === 9999 ? '9999px' : `${v}rem`),
    }),
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const clampLightness = (value: number): number => Math.max(B.lightnessClamp.min, Math.min(B.lightnessClamp.max, value));

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const createThemeBlock = (input: ThemeInput, targetRange: number): Effect.Effect<string, ThemeError> =>
    pipe(
        Effect.gen(function* () {
            const base = yield* OklchColor.create(input.lightness, input.chroma, input.hue, input.alpha);
            const steps = Array.from({ length: input.scale }, (_, i) => (i + 1) * B.scale.increment);
            const midIndex = Math.floor(steps.length / 2);
            const stepSize = targetRange / Math.max(1, midIndex);
            const enabledModifiers = Object.entries(input.modifiers ?? {}).filter(
                ([, v]) => v !== undefined,
            ) as readonly [string, typeof OklchColor.StateShift.Type][];
            const { modifierColors, scale } = yield* Effect.all({
                modifierColors: Effect.forEach(enabledModifiers, ([key, shifts]) =>
                    Effect.gen(function* () {
                        const c = yield* OklchColor.create(
                            base.l * (1 + shifts.lightnessShift * B.multipliers.lightness),
                            base.c * (1 + shifts.chromaShift * B.multipliers.chroma),
                            base.h,
                            base.a * (1 + shifts.alphaShift * B.multipliers.alpha),
                        );
                        return [key, c] as const;
                    }),
                ),
                scale: Effect.forEach(steps, (_, i) =>
                    OklchColor.create(
                        clampLightness(base.l + (i - midIndex) * stepSize),
                        base.c * (1 - (Math.abs(i - midIndex) / Math.max(1, midIndex)) * B.scale.chromaDecay),
                        base.h,
                        base.a,
                    ),
                ),
            });
            const first = scale[0];
            const scaleLines = steps.flatMap((step, i) =>
                scale[i] ? [`  --color-${input.name}-${step}: ${scale[i].to('css')};`] : [],
            );
            const modifierLines = modifierColors.map(([n, c]) => `  --color-${input.name}-${n}: ${c.to('css')};`);
            const borderLines =
                input.name === 'surface'
                    ? B.surfaceBorderSteps.flatMap((step) => {
                          const c = scale[steps.indexOf(step)];
                          return c ? [`  --color-border-${step}: ${c.to('css')};`] : [];
                      })
                    : [];
            const textOnLine = yield* pipe(
                Option.fromNullable(first),
                Option.filter(() => (B.textOnCategories as readonly string[]).includes(input.name)),
                Option.match({
                    onNone: () => Effect.succeed([] as readonly string[]),
                    onSome: (firstColor) =>
                        Effect.gen(function* () {
                            const { black, white } = yield* Effect.all({
                                black: OklchColor.create(0, 0, 0, 1),
                                white: OklchColor.create(1, 0, 0, 1),
                            });
                            const textOnColor: OklchColor =
                                Math.abs(white.contrast(firstColor)) >= Math.abs(black.contrast(firstColor))
                                    ? white
                                    : black;
                            return [`  --color-text-on-${input.name}: ${textOnColor.to('css')};`];
                        }),
                }),
            );
            return ['@theme {', ...scaleLines, ...modifierLines, ...borderLines, ...textOnLine, '}'].join('\n');
        }),
        Effect.mapError((e) => ThemeError.Generation({ category: 'theme', message: e.message, phase: 'color' })),
    );
const formatValue = (cat: string, v: number | string): string =>
    typeof v === 'string' ? v : (B.valueFormatters[cat as keyof typeof B.valueFormatters]?.(v) ?? `${v}rem`);
const generateAllThemes = (
    inputs: readonly ThemeInput[],
    tokens: TokenValues,
    targetRange: number,
): Effect.Effect<string, ThemeError> =>
    Effect.gen(function* () {
        const tokenLines = Object.entries(tokens)
            .flatMap(([cat, vals]) => {
                const prefix = B.prefix[cat as keyof typeof B.prefix] ?? cat;
                return typeof vals === 'number'
                    ? [`  --${prefix}: ${vals}rem;`]
                    : Object.entries(vals).map(([k, v]) => `  --${prefix}-${k}: ${formatValue(cat, v)};`);
            })
            .concat([`  --color-contrast-max: ${B.contrastMax};`]);
        const blocks = yield* Effect.forEach(inputs, (input) =>
            pipe(
                S.decodeUnknown(ThemeInputSchema)(input),
                Effect.mapError((e) =>
                    ThemeError.Validation({ field: input.name, message: e.message, received: input }),
                ),
                Effect.flatMap((validated) => createThemeBlock(validated, targetRange)),
            ),
        );
        return [`@theme {\n${tokenLines.join('\n')}\n}`, blocks.join('\n\n')].join('\n\n');
    });

// --- [ENTRY_POINT] -----------------------------------------------------------

const defineTheme = (input: DefineThemeInput) =>
    createParametricPlugin<ThemeInput>({
        generate: (inputs) => generateAllThemes(normalizeInputs(inputs), input.tokens, input.targetRange),
        name: 'theme',
        sectionLabel: 'THEME',
        virtualId: 'theme',
    })(
        pipe(
            B.colorCategories,
            A.filterMap((name) =>
                pipe(
                    Option.fromNullable(input[name]),
                    Option.map((lch) => ({
                        alpha: 1,
                        chroma: lch.c,
                        hue: lch.h,
                        lightness: lch.l,
                        modifiers: input.modifiers[name] ?? {},
                        name,
                        scale: input.scales[name] ?? 10,
                        targetRange: input.targetRange,
                    })),
                ),
            ),
        ) as unknown as ThemeInput,
    );

// --- [EXPORT] ----------------------------------------------------------------

export { defineTheme, B as THEME_TUNING };
export type { DefineThemeInput, ModifierConfig, TokenValues };
