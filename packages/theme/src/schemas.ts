/**
 * Define schemas for theme, font, and layout validation.
 * Grounding: Effect-based runtime validation with branded types.
 */
import { type Effect, pipe, Schema as S } from 'effect';
import type { ParseError } from 'effect/ParseResult';

// --- [TYPES] -----------------------------------------------------------------

type Alpha = S.Schema.Type<typeof AlphaSchema>;
type Chroma = S.Schema.Type<typeof ChromaSchema>;
type ContainerLayout = S.Schema.Type<typeof ContainerLayoutSchema>;
type FontAxisConfig = S.Schema.Type<typeof FontAxisConfigSchema>;
type FontInput = S.Schema.Type<typeof FontInputSchema>;
type FontWeight = S.Schema.Type<typeof FontWeightSchema>;
type GapScale = S.Schema.Type<typeof GapScaleSchema>;
type GridColumns = S.Schema.Type<typeof GridColumnsSchema>;
type GridLayout = S.Schema.Type<typeof GridLayoutSchema>;
type Hue = S.Schema.Type<typeof HueSchema>;
type LayoutInput = S.Schema.Type<typeof LayoutInputSchema>;
type Lightness = S.Schema.Type<typeof LightnessSchema>;
type ModifierOverride = S.Schema.Type<typeof ModifierOverrideSchema>;
type OklchColor = S.Schema.Type<typeof OklchColorSchema>;
type PixelValue = S.Schema.Type<typeof PixelValueSchema>;
type StackLayout = S.Schema.Type<typeof StackLayoutSchema>;
type StickyLayout = S.Schema.Type<typeof StickyLayoutSchema>;
type ThemeInput = S.Schema.Type<typeof ThemeInputSchema>;
type ThemeModifiers = S.Schema.Type<typeof ThemeModifiersSchema>;
type WeightSpec = S.Schema.Type<typeof WeightSpecSchema>;

// --- [SCHEMA] ----------------------------------------------------------------

const AlphaSchema = pipe(S.Number, S.between(0, 1), S.brand('Alpha'));
const ChromaSchema = pipe(S.Number, S.between(0, 0.4), S.brand('Chroma'));

/** Normalize hue to 0-360 range. Grounding: OKLCH hue wraps cylindrically. */
const HueSchema = pipe(
    S.Number,
    S.transform(S.Number, { decode: (h) => ((h % 360) + 360) % 360, encode: (h) => h }),
    S.brand('Hue'),
);
const LightnessSchema = pipe(S.Number, S.between(0, 1), S.brand('Lightness'));

const OklchColorSchema = pipe(
    S.Struct({
        a: AlphaSchema,
        c: ChromaSchema,
        h: HueSchema,
        l: LightnessSchema,
    }),
    S.brand('OklchColor'),
);

const ModifierOverrideSchema = S.Union(
    S.Literal(true),
    S.Struct({
        alphaShift: S.optional(S.Number),
        chromaShift: S.optional(S.Number),
        lightnessShift: S.optional(S.Number),
    }),
);

const CustomModifierSchema = S.Struct({
    alphaShift: S.Number,
    chromaShift: S.Number,
    lightnessShift: S.Number,
    name: pipe(S.String, S.pattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
});

const ThemeModifiersSchema = S.partial(
    S.Struct({
        active: ModifierOverrideSchema,
        disabled: ModifierOverrideSchema,
        dragged: ModifierOverrideSchema,
        focus: ModifierOverrideSchema,
        hover: ModifierOverrideSchema,
        pressed: ModifierOverrideSchema,
        selected: ModifierOverrideSchema,
    }),
);

const ThemeInputSchema = S.Struct({
    alpha: S.optional(pipe(S.Number, S.between(0, 1))),
    chroma: pipe(S.Number, S.between(0, 0.4)),
    customModifiers: S.optional(S.Array(CustomModifierSchema)),
    hue: pipe(S.Number, S.between(0, 360)),
    lightness: pipe(S.Number, S.between(0, 1)),
    modifiers: S.optional(ThemeModifiersSchema),
    name: pipe(S.String, S.pattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
    scale: pipe(S.Number, S.int(), S.between(2, 20)),
    spacing: S.optional(pipe(S.Number, S.int(), S.between(1, 100))),
});

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

const PixelValueSchema = pipe(S.Number, S.int(), S.positive(), S.brand('PixelValue'));
const GridColumnsSchema = pipe(S.Number, S.int(), S.between(1, 12), S.brand('GridColumns'));
const GapScaleSchema = pipe(S.Number, S.int(), S.nonNegative(), S.brand('GapScale'));

const GridLayoutSchema = S.Struct({
    alignItems: S.optional(S.Literal('start', 'end', 'center', 'stretch', 'baseline')),
    containerQuery: S.optional(S.Boolean),
    gap: S.optionalWith(GapScaleSchema, { default: () => 4 as GapScale }),
    justifyItems: S.optional(S.Literal('start', 'end', 'center', 'stretch')),
    maxColumns: S.optional(GridColumnsSchema),
    minItemWidth: PixelValueSchema,
    name: pipe(S.String, S.pattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
    type: S.Literal('grid'),
});

const StackLayoutSchema = S.Struct({
    align: S.optional(S.Literal('start', 'end', 'center', 'stretch', 'baseline')),
    containerQuery: S.optional(S.Boolean),
    direction: S.Literal('horizontal', 'vertical'),
    gap: S.optionalWith(GapScaleSchema, { default: () => 4 as GapScale }),
    justify: S.optional(S.Literal('start', 'end', 'center', 'between', 'around', 'evenly')),
    name: pipe(S.String, S.pattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
    type: S.Literal('stack'),
    wrap: S.optional(S.Boolean),
});

const StickyLayoutSchema = S.Struct({
    name: pipe(S.String, S.pattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
    offset: GapScaleSchema,
    position: S.Literal('top', 'bottom', 'left', 'right'),
    type: S.Literal('sticky'),
    zIndex: S.optional(pipe(S.Number, S.int(), S.between(0, 100))),
});

const ContainerLayoutSchema = S.Struct({
    containerQuery: S.optional(S.Boolean),
    maxWidth: PixelValueSchema,
    name: pipe(S.String, S.pattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
    padding: S.optionalWith(GapScaleSchema, { default: () => 4 as GapScale }),
    type: S.Literal('container'),
});

const LayoutInputSchema = S.Union(GridLayoutSchema, StackLayoutSchema, StickyLayoutSchema, ContainerLayoutSchema);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isAlpha = S.is(AlphaSchema);
const isChroma = S.is(ChromaSchema);
const isContainerLayout = S.is(ContainerLayoutSchema);
const isFontWeight = S.is(FontWeightSchema);
const isGapScale = S.is(GapScaleSchema);
const isGridColumns = S.is(GridColumnsSchema);
const isGridLayout = S.is(GridLayoutSchema);
const isHue = S.is(HueSchema);
const isLightness = S.is(LightnessSchema);
const isOklchColor = S.is(OklchColorSchema);
const isPixelValue = S.is(PixelValueSchema);
const isStackLayout = S.is(StackLayoutSchema);
const isStickyLayout = S.is(StickyLayoutSchema);

const validateTheme = (input: unknown): Effect.Effect<ThemeInput, ParseError> =>
    S.decodeUnknown(ThemeInputSchema)(input);

const validateFont = (input: unknown): Effect.Effect<FontInput, ParseError> => S.decodeUnknown(FontInputSchema)(input);

const validateLayout = (input: unknown): Effect.Effect<LayoutInput, ParseError> =>
    S.decodeUnknown(LayoutInputSchema)(input);

const validateOklchColor = (input: unknown): Effect.Effect<OklchColor, ParseError> =>
    S.decodeUnknown(OklchColorSchema)(input);

const validateGridLayout = (input: unknown): Effect.Effect<GridLayout, ParseError> =>
    S.decodeUnknown(GridLayoutSchema)(input);

const validateStackLayout = (input: unknown): Effect.Effect<StackLayout, ParseError> =>
    S.decodeUnknown(StackLayoutSchema)(input);

const validateStickyLayout = (input: unknown): Effect.Effect<StickyLayout, ParseError> =>
    S.decodeUnknown(StickyLayoutSchema)(input);

const validateContainerLayout = (input: unknown): Effect.Effect<ContainerLayout, ParseError> =>
    S.decodeUnknown(ContainerLayoutSchema)(input);

// --- [EXPORT] ----------------------------------------------------------------

export {
    AlphaSchema,
    ChromaSchema,
    ContainerLayoutSchema,
    CustomModifierSchema,
    FontAxisConfigSchema,
    FontInputSchema,
    FontWeightSchema,
    GapScaleSchema,
    GridColumnsSchema,
    GridLayoutSchema,
    HueSchema,
    LayoutInputSchema,
    LightnessSchema,
    ModifierOverrideSchema,
    OklchColorSchema,
    PixelValueSchema,
    StackLayoutSchema,
    StickyLayoutSchema,
    ThemeInputSchema,
    ThemeModifiersSchema,
    WeightSpecSchema,
    isAlpha,
    isChroma,
    isContainerLayout,
    isFontWeight,
    isGapScale,
    isGridColumns,
    isGridLayout,
    isHue,
    isLightness,
    isOklchColor,
    isPixelValue,
    isStackLayout,
    isStickyLayout,
    validateContainerLayout,
    validateFont,
    validateGridLayout,
    validateLayout,
    validateOklchColor,
    validateStackLayout,
    validateStickyLayout,
    validateTheme,
};

export type {
    Alpha,
    Chroma,
    ContainerLayout,
    FontAxisConfig,
    FontInput,
    FontWeight,
    GapScale,
    GridColumns,
    GridLayout,
    Hue,
    LayoutInput,
    Lightness,
    ModifierOverride,
    OklchColor,
    PixelValue,
    StackLayout,
    StickyLayout,
    ThemeInput,
    ThemeModifiers,
    WeightSpec,
};
