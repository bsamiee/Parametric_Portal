/**
 * Generate grid, stack, sticky, and container CSS utilities via schema validation.
 */
import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { Effect, pipe } from 'effect';
import type { Plugin } from 'vite';

// --- Types -------------------------------------------------------------------

type LayoutInput = S.Schema.Type<typeof LayoutInputSchema>;

// --- Schema ------------------------------------------------------------------

const PixelValue = pipe(S.Number, S.int(), S.positive(), S.brand('PixelValue'));
const GridColumns = pipe(S.Number, S.int(), S.between(1, 12), S.brand('GridColumns'));
const GapScale = pipe(S.Number, S.int(), S.nonNegative(), S.brand('GapScale'));

const GridLayoutSchema = S.Struct({
    alignItems: S.optional(S.Literal('start', 'end', 'center', 'stretch', 'baseline')),
    containerQuery: S.optional(S.Boolean),
    gap: S.optionalWith(GapScale, { default: () => 4 as S.Schema.Type<typeof GapScale> }),
    justifyItems: S.optional(S.Literal('start', 'end', 'center', 'stretch')),
    maxColumns: S.optional(GridColumns),
    minItemWidth: PixelValue,
    name: pipe(S.String, S.pattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
    type: S.Literal('grid'),
});

const StackLayoutSchema = S.Struct({
    align: S.optional(S.Literal('start', 'end', 'center', 'stretch', 'baseline')),
    containerQuery: S.optional(S.Boolean),
    direction: S.Literal('horizontal', 'vertical'),
    gap: S.optionalWith(GapScale, { default: () => 4 as S.Schema.Type<typeof GapScale> }),
    justify: S.optional(S.Literal('start', 'end', 'center', 'between', 'around', 'evenly')),
    name: pipe(S.String, S.pattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
    type: S.Literal('stack'),
    wrap: S.optional(S.Boolean),
});

const StickyLayoutSchema = S.Struct({
    name: pipe(S.String, S.pattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
    offset: GapScale,
    position: S.Literal('top', 'bottom', 'left', 'right'),
    type: S.Literal('sticky'),
    zIndex: S.optional(pipe(S.Number, S.int(), S.between(0, 100))),
});

const ContainerLayoutSchema = S.Struct({
    containerQuery: S.optional(S.Boolean),
    maxWidth: PixelValue,
    name: pipe(S.String, S.pattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
    padding: S.optionalWith(GapScale, { default: () => 4 as S.Schema.Type<typeof GapScale> }),
    type: S.Literal('container'),
});

const LayoutInputSchema = S.Union(GridLayoutSchema, StackLayoutSchema, StickyLayoutSchema, ContainerLayoutSchema);

// --- Constants ---------------------------------------------------------------

const B = Object.freeze({
    gap: { multiplier: 4, remBase: 16 },
    sticky: { zindex: 10 },
} as const);

const VIRTUAL_MODULE_ID = Object.freeze({
    resolved: '\0virtual:parametric-layouts' as const,
    virtual: 'virtual:parametric-layouts' as const,
} as const);

// --- Pure Functions ----------------------------------------------------------

const fn = {
    // Fallback pixel value calculated when CSS custom property undefined at runtime.
    gap: (scale: number): string =>
        scale === 0 ? '0' : `var(--spacing-${scale}, ${(scale * B.gap.multiplier) / B.gap.remBase}rem)`,
    // IIFE defers grid formula construction until CSS generation to isolate minmax string.
    gridFormula: (minWidth: number, maxCols?: number): string =>
        ((minmax) => (maxCols ? `repeat(${maxCols}, ${minmax})` : `repeat(auto-fit, ${minmax})`))(
            `minmax(min(${minWidth}px, 100%), 1fr)`,
        ),
    stickyOffset: (position: 'top' | 'bottom' | 'left' | 'right', gap: string): string => `${position}: ${gap};`,
} as const;

// --- Effect Pipeline ---------------------------------------------------------

const generateGridLayout = (input: Extract<LayoutInput, { type: 'grid' }>): Effect.Effect<string, ParseError> =>
    pipe(
        S.decode(GridLayoutSchema)(input),
        Effect.map((config) => {
            const gridFormula = fn.gridFormula(config.minItemWidth, config.maxColumns);
            const gapValue = fn.gap(config.gap);
            // Emit newline-terminated rules only when property defined to preserve CSS block formatting.
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

// --- Dispatch Tables ---------------------------------------------------------

const layoutHandlers = Object.freeze({
    container: generateContainerLayout as (input: LayoutInput) => Effect.Effect<string, ParseError>,
    grid: generateGridLayout as (input: LayoutInput) => Effect.Effect<string, ParseError>,
    stack: generateStackLayout as (input: LayoutInput) => Effect.Effect<string, ParseError>,
    sticky: generateStickyLayout as (input: LayoutInput) => Effect.Effect<string, ParseError>,
} as const);

const generateLayout = (input: LayoutInput): Effect.Effect<string, ParseError> => layoutHandlers[input.type](input);

// --- Entry Point -------------------------------------------------------------

const defineLayouts = (input: LayoutInput | ReadonlyArray<LayoutInput>): Plugin => ({
    enforce: 'pre',
    load: (id) =>
        id === VIRTUAL_MODULE_ID.resolved
            ? Effect.runSync(
                  pipe(
                      Effect.forEach(Array.isArray(input) ? input : [input], (layoutInput) =>
                          pipe(
                              S.decode(LayoutInputSchema)(layoutInput),
                              Effect.flatMap(generateLayout),
                              Effect.catchAll((error) =>
                                  Effect.succeed(`/* Failed: ${layoutInput.name} - ${error._tag} */`),
                              ),
                          ),
                      ),
                      Effect.map((blocks) => ['@import "tailwindcss";', ...blocks].join('\n\n')),
                  ),
              )
            : undefined,
    name: 'parametric-layouts',
    resolveId: (id) => (id === VIRTUAL_MODULE_ID.virtual ? VIRTUAL_MODULE_ID.resolved : undefined),
});

// --- Export ------------------------------------------------------------------

export { B, defineLayouts };
export type { LayoutInput };
