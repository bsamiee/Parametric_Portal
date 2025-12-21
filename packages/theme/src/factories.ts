/**
 * Create validated theme/font/layout configurations.
 * Grounding: Effect pipelines ensure runtime schema validation.
 */

import type { Effect } from 'effect';
import type { ParseError } from 'effect/ParseResult';
import {
    type ContainerLayout,
    type FontAxisConfig,
    type FontInput,
    type GapScale,
    type GridLayout,
    type PixelValue,
    type StackLayout,
    type StickyLayout,
    type ThemeInput,
    type ThemeModifiers,
    validateContainerLayout,
    validateFont,
    validateGridLayout,
    validateStackLayout,
    validateStickyLayout,
    validateTheme,
} from './schemas.ts';

// --- [TYPES] -----------------------------------------------------------------

type OklchParams = { readonly chroma: number; readonly hue: number; readonly lightness: number };
type ThemeOptions = {
    readonly alpha?: number;
    readonly modifiers?: Partial<ThemeModifiers>;
    readonly scale?: number;
    readonly spacing?: number;
};
type FontOptions = {
    readonly axes?: Record<string, FontAxisConfig>;
    readonly display?: 'auto' | 'block' | 'fallback' | 'optional' | 'swap';
    readonly fallback?: ReadonlyArray<'monospace' | 'sans-serif' | 'serif' | 'system-ui'>;
    readonly features?: ReadonlyArray<string>;
};
type GridOptions = {
    readonly alignItems?: 'baseline' | 'center' | 'end' | 'start' | 'stretch';
    readonly containerQuery?: boolean;
    readonly justifyItems?: 'center' | 'end' | 'start' | 'stretch';
    readonly maxColumns?: number;
};
type StackOptions = {
    readonly align?: 'baseline' | 'center' | 'end' | 'start' | 'stretch';
    readonly containerQuery?: boolean;
    readonly justify?: 'around' | 'between' | 'center' | 'end' | 'evenly' | 'start';
    readonly wrap?: boolean;
};
type ContainerOptions = {
    readonly containerQuery?: boolean;
};
type StickyOptions = {
    readonly zIndex?: number;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/** Create validated theme from OKLCH parameters. Grounding: Effect pipeline validates schema at runtime. */
const createTheme = (
    name: string,
    oklch: OklchParams,
    options: ThemeOptions = {},
): Effect.Effect<ThemeInput, ParseError> =>
    validateTheme({
        alpha: options.alpha,
        chroma: oklch.chroma,
        hue: oklch.hue,
        lightness: oklch.lightness,
        modifiers: options.modifiers,
        name,
        scale: options.scale ?? 11,
        spacing: options.spacing,
    });

/** Create variable font with weight axis. Grounding: Effect pipeline validates axis constraints. */
const createVariableFont = (
    name: string,
    family: string,
    src: string,
    weights: Record<string, number>,
    options: FontOptions = {},
): Effect.Effect<FontInput, ParseError> =>
    validateFont({
        axes: options.axes,
        display: options.display ?? 'swap',
        fallback: options.fallback,
        family,
        features: options.features,
        name,
        src,
        type: 'variable' as const,
        weights,
    });

/** Create static font with fixed weights. Grounding: Effect pipeline validates weight array. */
const createStaticFont = (
    name: string,
    family: string,
    src: string,
    weights: Record<string, number>,
    options: FontOptions = {},
): Effect.Effect<FontInput, ParseError> =>
    validateFont({
        axes: options.axes,
        display: options.display ?? 'swap',
        fallback: options.fallback,
        family,
        features: options.features,
        name,
        src,
        type: 'static' as const,
        weights,
    });

/** Create responsive grid layout. Grounding: Effect pipeline validates column/gap constraints. */
const createGrid = (
    name: string,
    gap: number,
    minItemWidth: number,
    options: GridOptions = {},
): Effect.Effect<GridLayout, ParseError> =>
    validateGridLayout({
        alignItems: options.alignItems,
        containerQuery: options.containerQuery,
        gap: gap as GapScale,
        justifyItems: options.justifyItems,
        maxColumns: options.maxColumns,
        minItemWidth: minItemWidth as PixelValue,
        name,
        type: 'grid' as const,
    });

/** Create flexbox stack layout. Grounding: Effect pipeline validates direction and gap. */
const createStack = (
    name: string,
    direction: 'horizontal' | 'vertical',
    options: StackOptions & { readonly gap?: number } = {},
): Effect.Effect<StackLayout, ParseError> =>
    validateStackLayout({
        align: options.align,
        containerQuery: options.containerQuery,
        direction,
        gap: (options.gap ?? 4) as GapScale,
        justify: options.justify,
        name,
        type: 'stack' as const,
        wrap: options.wrap,
    });

/** Create centered container with max-width. Grounding: Effect pipeline validates size constraints. */
const createContainer = (
    name: string,
    maxWidth: number,
    padding: number,
    options: ContainerOptions = {},
): Effect.Effect<ContainerLayout, ParseError> =>
    validateContainerLayout({
        containerQuery: options.containerQuery,
        maxWidth: maxWidth as PixelValue,
        name,
        padding: padding as GapScale,
        type: 'container' as const,
    });

/** Create sticky-positioned element. Grounding: Effect pipeline validates offset and container. */
const createSticky = (
    name: string,
    position: 'bottom' | 'left' | 'right' | 'top',
    offset: number,
    options: StickyOptions = {},
): Effect.Effect<StickyLayout, ParseError> =>
    validateStickyLayout({
        name,
        offset: offset as GapScale,
        position,
        type: 'sticky' as const,
        zIndex: options.zIndex,
    });

/** Create theme color modifier. Grounding: Frozen object prevents mutation. */
const createModifier = (
    name: string,
    shifts: { readonly alpha?: number; readonly chroma?: number; readonly lightness?: number },
): {
    readonly alphaShift: number;
    readonly chromaShift: number;
    readonly lightnessShift: number;
    readonly name: string;
} =>
    Object.freeze({
        alphaShift: shifts.alpha ?? 0,
        chromaShift: shifts.chroma ?? 0,
        lightnessShift: shifts.lightness ?? 0,
        name,
    });

/** Create variable font axis configuration. Grounding: Defines min/max/default for OpenType axes. */
const createFontAxis = (min: number, max: number, defaultVal: number): FontAxisConfig =>
    Object.freeze({
        default: defaultVal,
        max,
        min,
    });

// --- [EXPORT] ----------------------------------------------------------------

export {
    createContainer,
    createFontAxis,
    createGrid,
    createModifier,
    createStack,
    createStaticFont,
    createSticky,
    createTheme,
    createVariableFont,
};

export type { ContainerOptions, FontOptions, GridOptions, OklchParams, StackOptions, StickyOptions, ThemeOptions };
