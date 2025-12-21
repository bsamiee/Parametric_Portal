/**
 * Generate @font-face rules and semantic utilities via validated schema.
 * Grounding: Vite plugin exposes virtual module for Tailwind integration.
 */
import { Effect, Option, pipe, Schema as S } from 'effect';
import type { ParseError } from 'effect/ParseResult';
import type { Plugin } from 'vite';
import { type FontInput, FontInputSchema, type FontWeight } from './schemas.ts';

// --- [TYPES] -----------------------------------------------------------------

type EnvironmentConsumer = { readonly config: { readonly consumer: 'client' | 'server' } };
type FontInputRaw = S.Schema.Encoded<typeof FontInputSchema>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    format: {
        static: { format: 'woff2', tech: undefined },
        variable: { format: 'woff2', tech: 'variations' },
    },
    tailwindMarker: '@import "tailwindcss";',
    virtualImportPattern: /@import\s+['"]virtual:parametric-fonts['"];?\s*/g,
} as const);

const VIRTUAL_MODULE_ID = Object.freeze({
    resolved: '\0virtual:parametric-fonts' as const,
    virtual: 'virtual:parametric-fonts' as const,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isArray = <T>(input: T | ReadonlyArray<T>): input is ReadonlyArray<T> => Array.isArray(input);
const normalizeInputs = (input: FontInputRaw | ReadonlyArray<FontInputRaw>): ReadonlyArray<FontInputRaw> =>
    isArray(input) ? input : [input];

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

/** Generate all font CSS blocks without Tailwind import. */
const generateAllFonts = (inputs: FontInputRaw | ReadonlyArray<FontInputRaw>): string =>
    Effect.runSync(
        pipe(
            Effect.forEach(normalizeInputs(inputs), createFontBlocks),
            Effect.map((results) => results.flat().join('\n\n')),
        ),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

/** Create Vite plugin exposing virtual font module. Grounding: Resolves virtual:parametric-fonts for runtime CSS injection. */
const defineFonts = (inputs: FontInputRaw | ReadonlyArray<FontInputRaw>): Plugin => ({
    applyToEnvironment: (environment: EnvironmentConsumer) => environment.config.consumer === 'client',
    enforce: 'pre',
    load: (id) =>
        id === VIRTUAL_MODULE_ID.resolved ? `${B.tailwindMarker}\n\n${generateAllFonts(inputs)}` : undefined,
    name: 'parametric-fonts',
    resolveId: (id) => (id === VIRTUAL_MODULE_ID.virtual ? VIRTUAL_MODULE_ID.resolved : undefined),
    transform: (code, id) =>
        // Inject fonts CSS into entry CSS file (bypasses enhanced-resolve limitation)
        !id.endsWith('main.css') || !code.includes(B.tailwindMarker)
            ? undefined
            : code
                  .replaceAll(B.virtualImportPattern, '')
                  .replace(
                      B.tailwindMarker,
                      `${B.tailwindMarker}\n\n/* --- [FONTS] --- */\n${generateAllFonts(inputs)}`,
                  ),
});

// --- [EXPORT] ----------------------------------------------------------------

export { B, defineFonts };
export type { FontInputRaw };
export type { FontInput } from './schemas.ts';
