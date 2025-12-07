/**
 * Generate @font-face rules and semantic weight utilities via schema validation.
 */
import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { Effect, Option, pipe } from 'effect';
import type { Plugin } from 'vite';

// --- [TYPES] -----------------------------------------------------------------

type FontWeight = S.Schema.Type<typeof FontWeightSchema>;
type FontInput = S.Schema.Type<typeof FontInputSchema>;

// --- [SCHEMA] ----------------------------------------------------------------

const FontWeightSchema = pipe(S.Number, S.int(), S.between(100, 900), S.brand('FontWeight'));

const FontAxisConfigSchema = S.Struct({
    default: S.Number,
    max: S.Number,
    min: S.Number,
});

const WeightSpecSchema = S.Record({
    key: pipe(S.String, S.pattern(/^[a-z]+$/)),
    value: FontWeightSchema,
});

const FontInputSchema = S.Struct({
    axes: S.optional(
        S.Record({
            key: pipe(S.String, S.pattern(/^[a-z]{4}$/)),
            value: FontAxisConfigSchema,
        }),
    ),
    display: S.optional(S.Literal('swap', 'block', 'fallback', 'optional', 'auto')),
    fallback: S.optional(S.Array(S.Literal('sans-serif', 'serif', 'monospace', 'system-ui'))),
    family: S.String,
    features: S.optional(S.Array(S.String)),
    name: pipe(S.String, S.pattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
    src: S.String,
    type: S.Literal('variable', 'static'),
    weights: WeightSpecSchema,
});

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    format: {
        static: { format: 'woff2', tech: undefined },
        variable: { format: 'woff2', tech: 'variations' },
    },
} as const);

const VIRTUAL_MODULE_ID = Object.freeze({
    resolved: '\0virtual:parametric-fonts' as const,
    virtual: 'virtual:parametric-fonts' as const,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const fn = {
    // Invert undefined check: output quoted family-only when no fallback provided.
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

const createFontFaceBlock = (input: FontInput): Effect.Effect<readonly string[], ParseError> =>
    pipe(
        Effect.succeed(B.format[input.type]),
        Effect.map(({ format, tech }) =>
            [
                '@font-face {',
                `  font-family: "${input.family}";`,
                // Include tech as space-delimited string for @supports() compatibility in variable fonts.
                `  src: url('${input.src}') 			format(${pipe(
                    Option.fromNullable(tech),
                    Option.match({
                        onNone: () => `'${format}'`,
                        onSome: (t) => `'${format} ${t}'`,
                    }),
                )});
                `,
                `  font-weight: ${fn.weightRange(input.weights)};`,
                pipe(
                    Option.fromNullable(input.display),
                    Option.match({ onNone: () => '', onSome: (d) => `  font-display: ${d};` }),
                ),
                pipe(
                    Option.fromNullable(input.features),
                    Option.match({
                        onNone: () => '',
                        onSome: (fs) => `  font-feature-settings: ${fs.map((f) => `"${f}"`).join(', ')};`,
                    }),
                ),
                '}',
            ].filter((line) => line !== ''),
        ),
    );

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

const createThemeVariables = (input: FontInput): Effect.Effect<readonly string[], ParseError> =>
    pipe(
        Effect.all({
            family: Effect.succeed(`--font-${input.name}: ${fn.fallbackStack(input.family, input.fallback)};`),
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
                    onNone: () => ['@theme {', `  ${family}`, '}'],
                    onSome: (v) => ['@theme {', `  ${family}`, `  ${v}`, '}'],
                }),
            ),
        ),
    );

const createFontBlocks = (input: FontInput): Effect.Effect<readonly string[], ParseError> =>
    pipe(
        S.decode(FontInputSchema)(input),
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

// --- [ENTRY_POINT] -----------------------------------------------------------

const defineFonts = (inputs: FontInput | ReadonlyArray<FontInput>): Plugin => ({
    enforce: 'pre',
    load: (id) =>
        id === VIRTUAL_MODULE_ID.resolved
            ? Effect.runSync(
                  pipe(
                      Effect.forEach(Array.isArray(inputs) ? inputs : [inputs], createFontBlocks),
                      Effect.map((results) => ['@import "tailwindcss";', ...results.flat()].join('\n\n')),
                  ),
              )
            : undefined,
    name: 'parametric-fonts',
    resolveId: (id) => (id === VIRTUAL_MODULE_ID.virtual ? VIRTUAL_MODULE_ID.resolved : undefined),
});

// --- [EXPORT] ----------------------------------------------------------------

export { B, defineFonts };
export type { FontInput };
