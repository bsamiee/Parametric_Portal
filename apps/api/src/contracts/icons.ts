/**
 * Icon generation domain contracts.
 * App-specific request/response schemas for icon generation.
 */
import { type ColorMode, database } from '@parametric-portal/types/database';
import { svg } from '@parametric-portal/types/svg';
import { types } from '@parametric-portal/types/types';
import { Schema as S } from 'effect';

const db = database();
const svgApi = svg();
const typesApi = types();

// --- [TYPES] -----------------------------------------------------------------

type GenerateRequest = S.Schema.Type<typeof GenerateRequestSchema>;
type GenerateResponse = S.Schema.Type<typeof GenerateResponseSchema>;
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

const GenerateRequestSchema = S.Struct({
    attachments: S.optional(S.Array(svgApi.schemas.SvgAsset)),
    colorMode: S.optional(db.schemas.entities.ColorMode),
    intent: S.optional(db.schemas.entities.Intent),
    prompt: S.NonEmptyTrimmedString,
    referenceSvg: S.optional(S.String),
    variantCount: S.optional(typesApi.schemas.VariantCount),
});
const GenerateResponseSchema = S.Struct({
    id: S.String,
    variants: S.Array(svgApi.schemas.SvgAsset),
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

export { GenerateRequestSchema, GenerateResponseSchema, ICON_DESIGN };
export type { GenerateRequest, GenerateResponse, LayerSpec, Palette };
