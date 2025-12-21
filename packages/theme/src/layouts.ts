/**
 * Generate CSS layout utilities from schema-validated inputs.
 * Grounding: Single-source schema enforcement prevents runtime CSS errors.
 */
import { Effect, pipe, Schema as S } from 'effect';
import type { ParseError } from 'effect/ParseResult';
import type { Plugin } from 'vite';
import {
    ContainerLayoutSchema,
    GridLayoutSchema,
    type LayoutInput,
    LayoutInputSchema,
    StackLayoutSchema,
    StickyLayoutSchema,
} from './schemas.ts';

// --- [TYPES] -----------------------------------------------------------------

type LayoutInputRaw = S.Schema.Encoded<typeof LayoutInputSchema>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    gap: { multiplier: 4, remBase: 16 },
    sticky: { zindex: 10 },
    tailwindMarker: '@import "tailwindcss";',
    virtualImportPattern: /@import\s+['"]virtual:parametric-layouts['"];?\s*/g,
} as const);

const VIRTUAL_MODULE_ID = Object.freeze({
    resolved: '\0virtual:parametric-layouts' as const,
    virtual: 'virtual:parametric-layouts' as const,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isArray = <T>(input: T | ReadonlyArray<T>): input is ReadonlyArray<T> => Array.isArray(input);
const normalizeInputs = (input: LayoutInputRaw | ReadonlyArray<LayoutInputRaw>): ReadonlyArray<LayoutInputRaw> =>
    isArray(input) ? input : [input];

const fn = {
    gap: (scale: number): string =>
        scale === 0 ? '0' : `var(--spacing-${scale}, ${(scale * B.gap.multiplier) / B.gap.remBase}rem)`,
    gridFormula: (minWidth: number, maxCols?: number): string => {
        const minmax = `minmax(min(${minWidth}px, 100%), 1fr)`;
        return maxCols ? `repeat(${maxCols}, ${minmax})` : `repeat(auto-fit, ${minmax})`;
    },
    stickyOffset: (position: 'top' | 'bottom' | 'left' | 'right', gap: string): string => `${position}: ${gap};`,
} as const;

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const generateGridLayout = (input: Extract<LayoutInput, { type: 'grid' }>): Effect.Effect<string, ParseError> =>
    pipe(
        S.decode(GridLayoutSchema)(input),
        Effect.map((config) => {
            const gridFormula = fn.gridFormula(config.minItemWidth, config.maxColumns);
            const gapValue = fn.gap(config.gap);
            const alignRule = config.alignItems ? `  align-items: ${config.alignItems};\n` : '';
            const containerRule = config.containerQuery ? `  container-type: inline-size;\n` : '';
            const justifyRule = config.justifyItems ? `  justify-items: ${config.justifyItems};\n` : '';

            return `
@theme {
  --layout-${config.name}-cols: ${gridFormula};
  --layout-${config.name}-gap: ${gapValue};
}

.layout-${config.name} {
${containerRule}  display: grid;
  grid-template-columns: var(--layout-${config.name}-cols);
  gap: var(--layout-${config.name}-gap);
${alignRule}${justifyRule}}
`.trim();
        }),
    );

const generateStackLayout = (input: Extract<LayoutInput, { type: 'stack' }>): Effect.Effect<string, ParseError> =>
    pipe(
        S.decode(StackLayoutSchema)(input),
        Effect.map((config) => {
            const flexDirection = config.direction === 'horizontal' ? 'row' : 'column';
            const gapValue = fn.gap(config.gap);
            const alignItems = config.align ?? 'stretch';
            const containerRule = config.containerQuery ? `  container-type: inline-size;\n` : '';
            const justifyContent = config.justify ?? 'start';
            const flexWrap = config.wrap ? 'wrap' : 'nowrap';

            return `
@theme {
  --layout-${config.name}-gap: ${gapValue};
}

.layout-${config.name} {
${containerRule}  display: flex;
  flex-direction: ${flexDirection};
  gap: var(--layout-${config.name}-gap);
  align-items: ${alignItems};
  justify-content: ${justifyContent};
  flex-wrap: ${flexWrap};
}
`.trim();
        }),
    );

const generateStickyLayout = (input: Extract<LayoutInput, { type: 'sticky' }>): Effect.Effect<string, ParseError> =>
    pipe(
        S.decode(StickyLayoutSchema)(input),
        Effect.map((config) => {
            const offsetValue = fn.gap(config.offset);
            const offsetRule = fn.stickyOffset(config.position, offsetValue);
            const zIndex = config.zIndex ?? B.sticky.zindex;

            return `
.layout-${config.name} {
  position: sticky;
  ${offsetRule}
  z-index: ${zIndex};
}
`.trim();
        }),
    );

const generateContainerLayout = (
    input: Extract<LayoutInput, { type: 'container' }>,
): Effect.Effect<string, ParseError> =>
    pipe(
        S.decode(ContainerLayoutSchema)(input),
        Effect.map((config) => {
            const containerRule = config.containerQuery ? `  container-type: inline-size;\n` : '';
            const paddingValue = fn.gap(config.padding);

            return `
@theme {
  --layout-${config.name}-max: ${config.maxWidth}px;
  --layout-${config.name}-padding: ${paddingValue};
}

.layout-${config.name} {
${containerRule}  max-width: var(--layout-${config.name}-max);
  margin-inline: auto;
  padding-inline: var(--layout-${config.name}-padding);
}
`.trim();
        }),
    );

// --- [DISPATCH_TABLES] -------------------------------------------------------

const layoutHandlers = Object.freeze({
    container: generateContainerLayout as (input: LayoutInput) => Effect.Effect<string, ParseError>,
    grid: generateGridLayout as (input: LayoutInput) => Effect.Effect<string, ParseError>,
    stack: generateStackLayout as (input: LayoutInput) => Effect.Effect<string, ParseError>,
    sticky: generateStickyLayout as (input: LayoutInput) => Effect.Effect<string, ParseError>,
} as const);

const generateLayout = (input: LayoutInput): Effect.Effect<string, ParseError> => layoutHandlers[input.type](input);

/** Generate all layout CSS blocks without Tailwind import. */
const generateAllLayouts = (input: LayoutInputRaw | ReadonlyArray<LayoutInputRaw>): string =>
    Effect.runSync(
        pipe(
            Effect.forEach(normalizeInputs(input), (layoutInput) =>
                pipe(
                    S.decode(LayoutInputSchema)(layoutInput),
                    Effect.flatMap(generateLayout),
                    Effect.catchAll((error) => Effect.succeed(`/* Failed: ${layoutInput.name} - ${error._tag} */`)),
                ),
            ),
            Effect.map((blocks) => blocks.join('\n\n')),
        ),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const defineLayouts = (input: LayoutInputRaw | ReadonlyArray<LayoutInputRaw>): Plugin => ({
    enforce: 'pre',
    load: (id) =>
        id === VIRTUAL_MODULE_ID.resolved ? `${B.tailwindMarker}\n\n${generateAllLayouts(input)}` : undefined,
    name: 'parametric-layouts',
    resolveId: (id) => (id === VIRTUAL_MODULE_ID.virtual ? VIRTUAL_MODULE_ID.resolved : undefined),
    transform: (code, id) =>
        // Inject layouts CSS into entry CSS file (bypasses enhanced-resolve limitation)
        !id.endsWith('main.css') || !code.includes(B.tailwindMarker)
            ? undefined
            : code
                  .replaceAll(B.virtualImportPattern, '')
                  .replace(
                      B.tailwindMarker,
                      `${B.tailwindMarker}\n\n/* --- [LAYOUTS] --- */\n${generateAllLayouts(input)}`,
                  ),
});

// --- [EXPORT] ----------------------------------------------------------------

export { B, defineLayouts };
export type { LayoutInputRaw };
export type { LayoutInput } from './schemas.ts';
