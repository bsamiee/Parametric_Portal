/**
 * Define icon generation request/response schemas and design constants.
 * Schema-first types; S.Class for request/response entities.
 */
import { Schema as S } from 'effect';
import { Svg } from './svg.ts';
import { HexColor, VariantCount } from './types.ts';

// --- [PRIVATE_SCHEMAS] -------------------------------------------------------

const _AiProvider = S.Literal('anthropic', 'gemini', 'openai');

// --- [SCHEMA] ----------------------------------------------------------------

const ColorMode = S.Literal('dark', 'light');
type ColorMode = typeof ColorMode.Type;

const Intent = S.Literal('create', 'refine');
type Intent = typeof Intent.Type;

// --- [CLASSES] ---------------------------------------------------------------

class IconRequest extends S.Class<IconRequest>('IconRequest')({
    assetType: S.optionalWith(S.NonEmptyTrimmedString, { default: () => 'icon' }),
    colorMode: S.optional(ColorMode),
    intent: S.optional(Intent),
    prompt: S.NonEmptyTrimmedString,
    provider: S.optional(_AiProvider),
    referenceSvg: S.optional(S.String),
    variantCount: S.optional(VariantCount),
}) {}

const IconAsset = S.Struct({ id: S.UUID, svg: Svg.schema });
type IconAsset = typeof IconAsset.Type;

class IconResponse extends S.Class<IconResponse>('IconResponse')({assets: S.Array(IconAsset),}) {}

const IconServiceInput = S.extend(IconRequest, S.Struct({ apiKey: S.optional(S.String) }));
type IconServiceInput = typeof IconServiceInput.Type;

// --- [CONSTANTS] -------------------------------------------------------------

const hex = (value: string): HexColor => S.decodeSync(HexColor)(value);

const ICON_DESIGN = {
    canvas: {
        center: { x: 16, y: 16 },
        gridSize: 32,
        safeArea: 2,
        viewBox: '0 0 32 32',
    },
    layers: {
        context: { dasharray: 'none', fill: 'none' as const, id: 'Context', strokeWidth: 0.5 },
        detail: { dasharray: 'none', fill: 'none' as const, id: 'Detail', strokeWidth: 0.5 },
        grips: { dasharray: 'none', fill: hex('#ffffff'), id: 'Grips',  strokeWidth: 0.5 },
        guide: { dasharray: '2 1', fill: 'none' as const, id: 'Guide', strokeWidth: 0.25 },
        primary: { dasharray: 'none', fill: 'none' as const, id: 'Primary', strokeWidth: 1 },
    },
    palettes: {
        dark: {
            semantic: { grip: hex('#ffffff'), gripStroke: hex('#000000') },
            structural: { context: hex('#52525b'), guide: hex('#71717a'), primary: hex('#000000'), secondary: hex('#52525b') },
        },
        light: {
            semantic: { grip: hex('#ffffff'), gripStroke: hex('#000000') },
            structural: { context: hex('#52525b'), guide: hex('#71717a'), primary: hex('#000000'), secondary: hex('#52525b') },
        },
    } satisfies Record<'dark' | 'light', { semantic: { grip: HexColor; gripStroke: HexColor }; structural: Record<string, HexColor> }>,
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { ColorMode, IconAsset, ICON_DESIGN, IconRequest, IconResponse, IconServiceInput, Intent };
