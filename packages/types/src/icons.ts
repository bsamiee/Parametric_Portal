/**
 * Define icon generation request/response schemas and design configuration constants.
 * Consolidates canvas/layer/palette specifications for AI provider consumption.
 */
import { Schema as S } from 'effect';
import { SvgAsset } from './svg.ts';
import { HexColor, Uuidv7, VariantCount } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type ColorMode = S.Schema.Type<typeof ColorMode>
type Intent = S.Schema.Type<typeof Intent>
type OutputMode = S.Schema.Type<typeof OutputMode>

// --- [SCHEMA] ----------------------------------------------------------------

const AiProvider = S.Literal('anthropic', 'openai', 'gemini');
const ColorMode = S.Literal('dark', 'light');
const Intent = S.Literal('create', 'refine');
const OutputMode = S.Literal('single', 'batch');

// --- [CLASSES] ---------------------------------------------------------------

class IconRequest extends S.Class<IconRequest>('IconRequest')({
	attachments: S.optional(S.Array(SvgAsset.schema)),
	colorMode: S.optional(ColorMode),
	intent: S.optional(Intent),
	prompt: S.NonEmptyTrimmedString,
	provider: S.optional(AiProvider),
	referenceSvg: S.optional(S.String),
	variantCount: S.optional(VariantCount.schema),
}) {}
class IconResponse extends S.Class<IconResponse>('IconResponse')({
	id: Uuidv7.schema,
	variants: S.Array(SvgAsset.schema),
}) {}
const IconServiceInput = S.extend(IconRequest, S.Struct({ apiKey: S.optional(S.String) }));

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/** Decode hex string to branded HexColor type for palette definitions. */
const hex = (value: string): HexColor => HexColor.decodeSync(value);

// --- [ENTRY_POINT] -----------------------------------------------------------

/** Freeze design constants to prevent runtime mutation. */
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
