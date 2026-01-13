/**
 * Define icon generation request/response schemas and design configuration constants.
 * Consolidates canvas/layer/palette specifications for AI provider consumption.
 */
import { Schema as S } from 'effect';
import { AiProvider } from './schema.ts';
import { SvgAsset } from './svg.ts';
import { companion, HexColor, Uuidv7, VariantCount } from './types.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const ColorModeSchema = S.Literal('dark', 'light');
type ColorMode = typeof ColorModeSchema.Type;
const ColorMode = Object.freeze(companion(ColorModeSchema));

const IntentSchema = S.Literal('create', 'refine');
type Intent = typeof IntentSchema.Type;
const Intent = Object.freeze(companion(IntentSchema));

const OutputModeSchema = S.Literal('single', 'batch');
type OutputMode = typeof OutputModeSchema.Type;
const OutputMode = Object.freeze(companion(OutputModeSchema));

// --- [CLASSES] ---------------------------------------------------------------

class IconRequest extends S.Class<IconRequest>('IconRequest')({
	attachments: S.optional(S.Array(SvgAsset.schema)),
	colorMode: S.optional(ColorMode.schema),
	intent: S.optional(Intent.schema),
	prompt: S.NonEmptyTrimmedString,
	provider: S.optional(AiProvider.schema),
	referenceSvg: S.optional(S.String),
	variantCount: S.optional(VariantCount.schema),
}) {}
class IconResponse extends S.Class<IconResponse>('IconResponse')({ id: Uuidv7.schema, variants: S.Array(SvgAsset.schema), }) {}
const IconServiceInput = S.extend(IconRequest, S.Struct({ apiKey: S.optional(S.String) }));

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const hex = (value: string): HexColor => HexColor.decodeSync(value);

// --- [ENTRY_POINT] -----------------------------------------------------------

const Icons = Object.freeze({
	design: {
		canvas: { center: { x: 16, y: 16 }, gridSize: 32, safeArea: 2, viewBox: '0 0 32 32' },
		layers: {
			context: { dasharray: 'none', fill: 'none' as const, id: 'Context', strokeWidth: 0.5 },
			detail: { dasharray: 'none', fill: 'none' as const, id: 'Detail', strokeWidth: 0.5 },
			grips: { dasharray: 'none', fill: hex('#ffffff'), id: 'Grips', strokeWidth: 0.5 },
			guide: { dasharray: '2 1', fill: 'none' as const, id: 'Guide', strokeWidth: 0.25 },
			primary: { dasharray: 'none', fill: 'none' as const, id: 'Primary', strokeWidth: 1 },
		},
		palettes: {
			dark: { semantic: { grip: hex('#ffffff'), gripStroke: hex('#000000') }, structural: { context: hex('#52525b'), guide: hex('#71717a'), primary: hex('#000000'), secondary: hex('#52525b') } },
			light: { semantic: { grip: hex('#ffffff'), gripStroke: hex('#000000') }, structural: { context: hex('#52525b'), guide: hex('#71717a'), primary: hex('#000000'), secondary: hex('#52525b') } },
		} satisfies Record<'dark' | 'light', { semantic: { grip: HexColor; gripStroke: HexColor }; structural: Record<string, HexColor> }>,
	},
	Request: IconRequest,
	Response: IconResponse,
} as const);

// --- [EXPORT] ----------------------------------------------------------------

export { ColorMode, IconRequest, IconResponse, Icons, IconServiceInput, Intent, OutputMode };
