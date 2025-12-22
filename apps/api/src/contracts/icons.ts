/**
 * Icon generation domain contracts.
 * Single source of truth for all icon-related types across apps.
 */
import { Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type ColorMode = 'dark' | 'light';
type ParametricIntent = 'create' | 'refine';

type Palette = {
    readonly structural: {
        readonly guide: string;
        readonly context: string;
        readonly secondary: string;
        readonly primary: string;
    };
    readonly semantic: {
        readonly grip: string;
        readonly gripStroke: string;
    };
};

type LayerSpec = {
    readonly id: string;
    readonly strokeWidth: number;
    readonly fill: string;
    readonly dasharray: string;
};

// --- [SCHEMA] ----------------------------------------------------------------

const ColorModeSchema = S.Literal('dark', 'light');
const IntentSchema = S.Literal('create', 'refine');

const ReferenceAttachmentSchema = S.Struct({
    id: S.String,
    name: S.String,
    svg: S.String,
});

const SvgVariantSchema = S.Struct({
    id: S.String,
    name: S.String,
    svg: S.String,
});

const GenerateRequestSchema = S.Struct({
    attachments: S.optional(S.Array(ReferenceAttachmentSchema)),
    colorMode: S.optional(ColorModeSchema),
    intent: S.optional(IntentSchema),
    prompt: S.NonEmptyTrimmedString,
    referenceSvg: S.optional(S.String),
    variantCount: S.optional(S.Int.pipe(S.between(1, 3))),
});

const GenerateResponseSchema = S.Struct({
    id: S.String,
    variants: S.Array(SvgVariantSchema),
});

// --- [CONSTANTS] -------------------------------------------------------------

const ICON_DESIGN = Object.freeze({
    canvas: {
        center: { x: 16, y: 16 },
        gridSize: 32,
        safeArea: 2,
        viewBox: '0 0 32 32',
    },
    layers: {
        context: { dasharray: 'none', fill: 'none', id: 'Context', strokeWidth: 0.5 },
        detail: { dasharray: 'none', fill: 'none', id: 'Detail', strokeWidth: 0.5 },
        grips: { dasharray: 'none', fill: '#FFFFFF', id: 'Grips', strokeWidth: 0.5 },
        guide: { dasharray: '2 1', fill: 'none', id: 'Guide', strokeWidth: 0.25 },
        primary: { dasharray: 'none', fill: 'none', id: 'Primary', strokeWidth: 1 },
    },
    palettes: {
        dark: {
            semantic: { grip: '#FFFFFF', gripStroke: '#000000' },
            structural: { context: '#52525b', guide: '#71717a', primary: '#000000', secondary: '#52525b' },
        },
        light: {
            semantic: { grip: '#FFFFFF', gripStroke: '#000000' },
            structural: { context: '#52525b', guide: '#71717a', primary: '#000000', secondary: '#52525b' },
        },
    } satisfies Record<ColorMode, Palette>,
} as const);

// --- [EXPORT] ----------------------------------------------------------------

export {
    ColorModeSchema,
    GenerateRequestSchema,
    GenerateResponseSchema,
    ICON_DESIGN,
    IntentSchema,
    ReferenceAttachmentSchema,
    SvgVariantSchema,
};

export type { ColorMode, LayerSpec, Palette, ParametricIntent };

type GenerateRequest = S.Schema.Type<typeof GenerateRequestSchema>;
type GenerateResponse = S.Schema.Type<typeof GenerateResponseSchema>;
type ReferenceAttachment = S.Schema.Type<typeof ReferenceAttachmentSchema>;
type SvgVariant = S.Schema.Type<typeof SvgVariantSchema>;

export type { GenerateRequest, GenerateResponse, ReferenceAttachment, SvgVariant };
