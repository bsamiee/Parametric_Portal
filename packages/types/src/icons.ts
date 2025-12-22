/**
 * Icon domain primitives: ColorMode, Intent, and SvgAsset schemas.
 * Single source of truth for icon-related types across packages and apps.
 */
import { Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const ColorModeSchema = S.Literal('dark', 'light');
const IntentSchema = S.Literal('create', 'refine');

const SvgAssetSchema = S.Struct({
    id: S.String,
    name: S.String,
    svg: S.String,
});

// --- [TYPES] -----------------------------------------------------------------

type ColorMode = S.Schema.Type<typeof ColorModeSchema>;
type Intent = S.Schema.Type<typeof IntentSchema>;
type SvgAsset = S.Schema.Type<typeof SvgAssetSchema>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    colorModes: ['dark', 'light'] as const,
    intents: ['create', 'refine'] as const,
} as const);

// --- [EXPORT] ----------------------------------------------------------------

export { B as ICONS_TUNING, ColorModeSchema, IntentSchema, SvgAssetSchema };
export type { ColorMode, Intent, SvgAsset };
