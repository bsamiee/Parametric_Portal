/**
 * Generate @font-face rules and semantic utilities via validated schema.
 * Grounding: Vite plugin exposes virtual module for Tailwind integration.
 */
import { Effect, Option, pipe, type Schema as S } from 'effect';
import type { ParseError } from 'effect/ParseResult';
import { createParametricPlugin, normalizeInputs } from './plugin.ts';
import { type FontInput, type FontInputSchema, type FontWeight, validate } from './schemas.ts';

// --- [TYPES] -----------------------------------------------------------------

type FontType = 'static' | 'variable';
type FontInputRaw = S.Schema.Encoded<typeof FontInputSchema>;
type FontAxisConfig = { readonly default: number; readonly max: number; readonly min: number };
type FontOptions = {
    readonly axes?: Record<string, FontAxisConfig>;
    readonly display?: 'auto' | 'block' | 'fallback' | 'optional' | 'swap';
    readonly fallback?: ReadonlyArray<'monospace' | 'sans-serif' | 'serif' | 'system-ui'>;
    readonly features?: ReadonlyArray<string>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    format: {
        static: { format: 'woff2', tech: undefined },
        variable: { format: 'woff2', tech: 'variations' },
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const fontUtilities = {
    fallbackStack: (family: string, fallback: ReadonlyArray<string> | undefined): string =>
        pipe(
            Option.fromNullable(fallback),
            Option.match({
                onNone: () => `"${family}"`,
                onSome: (fb) => `"${family}", ${fb.join(', ')}`,
            }),
        ),
    weightRange: (weights: Record<string, FontWeight>): string =>
        pipe(
            Object.values(weights),
            (vals) => ({ max: Math.max(...vals), min: Math.min(...vals) }),
            ({ min, max }) => (min === max ? `${min}` : `${min} ${max}`),
        ),
} as const;

// --- [EFFECT_PIPELINE] -------------------------------------------------------

/** Generate @font-face CSS block from validated input. Grounding: Handles static and variable font formats with optional features. */
const createFontFaceBlock = (input: FontInput): Effect.Effect<readonly string[], ParseError> =>
    pipe(
        Effect.succeed(B.format[input.type]),
        Effect.map(({ format, tech }) =>
            [
                '@font-face {',
                `  font-family: "${input.family}";`,
                `  src: url('${input.src}') format(${pipe(
                    Option.fromNullable(tech),
                    Option.match({
                        onNone: () => `'${format}'`,
                        onSome: (t) => `'${format}-${t}'`,
                    }),
                )});`,
                `  font-weight: ${fontUtilities.weightRange(input.weights)};`,
                pipe(
                    Option.fromNullable(input.display),
                    Option.match({ onNone: () => '', onSome: (d) => `  font-display: ${d};` }),
                ),
                pipe(
                    Option.fromNullable(input.features),
                    Option.match({
                        onNone: () => '',
                        onSome: (fs) => {
                            const formatted = fs.map((f) => `"${f}"`).join(', ');
                            return `  font-feature-settings: ${formatted};`;
                        },
                    }),
                ),
                '}',
            ].filter((line) => line !== ''),
        ),
    );

/** Generate semantic weight utility classes. Grounding: Enables .font-{name}-{weight} pattern for design tokens. */
const createSemanticUtilities = (
    input: FontInput,
): Effect.Effect<ReadonlyArray<readonly [string, string]>, ParseError> =>
    Effect.succeed(
        Object.entries(input.weights).map(
            ([name, weight]) =>
                [
                    `font-${input.name}-${name}`,
                    `.font-${input.name}-${name} { font-family: var(--font-${input.name}); font-weight: ${weight}; }`,
                ] as const,
        ),
    );

/** Generate CSS custom properties for font family. Grounding: Exposes --font-{name} variables for Tailwind theme integration. */
const createThemeVariables = (input: FontInput): Effect.Effect<readonly string[], ParseError> =>
    pipe(
        Effect.all({
            family: Effect.succeed(
                `--font-${input.name}: ${fontUtilities.fallbackStack(input.family, input.fallback)};`,
            ),
            variations: pipe(
                Option.fromNullable(input.axes),
                Option.match({
                    onNone: () => Effect.succeed(undefined),
                    onSome: (axes) =>
                        Effect.succeed(
                            `--font-${input.name}--font-variation-settings: ${Object.entries(axes)
                                .map(([axis, { default: defaultVal }]) => `"${axis}" ${defaultVal}`)
                                .join(', ')};`,
                        ),
                }),
            ),
        }),
        Effect.map(({ family, variations }) =>
            pipe(
                Option.fromNullable(variations),
                Option.match({
                    onNone: () => [':root {', `  ${family}`, '}'],
                    onSome: (v) => [':root {', `  ${family}`, `  ${v}`, '}'],
                }),
            ),
        ),
    );

/** Orchestrate font-face, variables, and utility generation. Grounding: Validates input then combines three CSS block types. */
const createFontBlocks = (input: FontInputRaw): Effect.Effect<readonly string[], ParseError> =>
    pipe(
        validate.font(input),
        Effect.flatMap((validated) =>
            Effect.all({
                fontFace: createFontFaceBlock(validated),
                theme: createThemeVariables(validated),
                utilities: createSemanticUtilities(validated),
            }),
        ),
        Effect.map(({ fontFace, theme, utilities }) => [
            fontFace.join('\n'),
            theme.join('\n'),
            ...utilities.map(([, css]) => css),
        ]),
        Effect.catchAll((error) => Effect.succeed([`/* Font parsing failed: ${input.name} - ${error._tag} */`])),
    );

/** Generate all font CSS blocks without Tailwind import. */
const generateAllFonts = (inputs: FontInputRaw | ReadonlyArray<FontInputRaw>): string =>
    Effect.runSync(
        pipe(
            Effect.forEach(normalizeInputs(inputs), createFontBlocks),
            Effect.map((results) => results.flat().join('\n\n')),
        ),
    );

/** Create validated font configuration. Grounding: Effect pipeline validates schema at runtime. */
const createFont = (
    type: FontType,
    name: string,
    family: string,
    src: string,
    weights: Record<string, number>,
    options: FontOptions = {},
): Effect.Effect<FontInput, ParseError> =>
    validate.font({
        axes: options.axes,
        display: options.display ?? 'swap',
        fallback: options.fallback,
        family,
        features: options.features,
        name,
        src,
        type,
        weights,
    });

/** Create variable font axis configuration. Grounding: Defines min/max/default for OpenType axes. */
const createFontAxis = (min: number, max: number, defaultVal: number): FontAxisConfig =>
    Object.freeze({ default: defaultVal, max, min });

// --- [ENTRY_POINT] -----------------------------------------------------------

/** Create Vite plugin exposing virtual font module. Grounding: Resolves virtual:parametric-fonts for runtime CSS injection. */
const defineFonts = createParametricPlugin<FontInputRaw>({
    generate: generateAllFonts,
    name: 'fonts',
    sectionLabel: 'FONTS',
    virtualId: 'fonts',
});

// --- [EXPORT] ----------------------------------------------------------------

export { B as FONT_TUNING, createFont, createFontAxis, defineFonts };
export type { FontAxisConfig, FontInputRaw, FontOptions, FontType };
export type { FontInput } from './schemas.ts';
