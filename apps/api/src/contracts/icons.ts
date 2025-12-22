/**
 * Icon generation domain contracts.
 * Extends shared schemas from @parametric-portal/types/icons.
 */
import {
    type ColorMode,
    ColorModeSchema,
    type Intent,
    IntentSchema,
    type SvgAsset,
    SvgAssetSchema,
} from '@parametric-portal/types/icons';
import { Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

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

// Re-export base SvgAsset as ReferenceAttachment and SvgVariant (identical structures)
const ReferenceAttachmentSchema = SvgAssetSchema;
const SvgVariantSchema = SvgAssetSchema;

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

// --- [TYPES] -----------------------------------------------------------------

type GenerateRequest = S.Schema.Type<typeof GenerateRequestSchema>;
type GenerateResponse = S.Schema.Type<typeof GenerateResponseSchema>;
type ReferenceAttachment = SvgAsset;
type SvgVariant = SvgAsset;

// --- [EXPORT] ----------------------------------------------------------------

export {
    ColorModeSchema,
    GenerateRequestSchema,
    GenerateResponseSchema,
    ICON_DESIGN,
    IntentSchema,
    ReferenceAttachmentSchema,
    SvgAssetSchema,
    SvgVariantSchema,
};

export type {
    ColorMode,
    GenerateRequest,
    GenerateResponse,
    Intent,
    LayerSpec,
    Palette,
    ReferenceAttachment,
    SvgAsset,
    SvgVariant,
};
