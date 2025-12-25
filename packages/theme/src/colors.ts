/**
 * Manipulate OKLCH colors at runtime via unified API.
 * Grounding: OKLCH preserves perceptual uniformity across lightness adjustments.
 */

import Color from 'colorjs.io';
import { Effect, pipe } from 'effect';
import type { ParseError } from 'effect/ParseResult';
import { type OklchColor, validate } from './schemas.ts';

// --- [TYPES] -----------------------------------------------------------------

type HueInterpolation = 'longer' | 'shorter';
type Gamut = 'p3' | 'srgb';
type OklchAdjust = {
    readonly alpha?: number;
    readonly chroma?: number;
    readonly hue?: number;
    readonly lightness?: number;
};
type ColorsApi = {
    readonly adjust: typeof adjust;
    readonly contrast: typeof contrast;
    readonly create: typeof create;
    readonly gamutMap: typeof gamutMap;
    readonly getVar: typeof getVar;
    readonly isInGamut: typeof isInGamut;
    readonly mix: typeof mix;
    readonly parse: typeof parse;
    readonly toCSS: typeof toCSS;
    readonly toSRGB: typeof toSRGB;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    regex: {
        oklch: /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\)/i,
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/** Wrap hue to 0-360 range. Grounding: OKLCH hue wraps cylindrically. */
const normalizeHue = (h: number): number => ((h % 360) + 360) % 360;

const formatAlpha = (a: number): string => (a < 1 ? ` / ${a.toFixed(2)}` : '');

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const hueAdjust = {
    neg: (h2: number) => h2 + 360,
    none: (h2: number) => h2,
    pos: (h2: number) => h2 - 360,
} as const;

/** Interpolate hue via shortest/longest arc. Grounding: Perceptual color mixing requires arc-aware interpolation. */
const interpolateHue = (h1: number, h2: number, t: number, method: HueInterpolation): number => {
    const diff = h2 - h1;
    const absDiff = Math.abs(diff);
    const useShort = method === 'shorter' ? absDiff <= 180 : absDiff > 180;
    const signKey = diff > 0 ? 'pos' : 'neg';
    const adjustKey = useShort ? 'none' : signKey;
    return normalizeHue(lerp(h1, hueAdjust[adjustKey](h2), t));
};

/** Convert OklchColor to Color.js object. Grounding: Enables Color.js API usage with branded types. */
const toColorJs = (color: OklchColor): Color => new Color('oklch', [color.l, color.c, color.h], color.a);

/** Generate CSS custom property reference. Grounding: Standardized var() syntax for theme integration. */
const getVar = (name: string, step: number | string): string => `var(--color-${name}-${step})`;

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const create = (l: number, c: number, h: number, a = 1): Effect.Effect<OklchColor, ParseError> =>
    validate.oklchColor({ a, c, h, l });

const toCSS = (color: OklchColor): string =>
    `oklch(${(color.l * 100).toFixed(1)}% ${color.c.toFixed(3)} ${color.h.toFixed(1)}${formatAlpha(color.a)})`;

const parse = (css: string): Effect.Effect<OklchColor, ParseError> => {
    const match = B.regex.oklch.exec(css);
    const lVal = match?.[1];
    const lPercent = match?.[2];
    const cVal = match?.[3];
    const hVal = match?.[4];
    const aVal = match?.[5];
    const aPercent = match?.[6];

    const parseAlpha = (val: string | undefined, isPercent: string | undefined): number => {
        const divisor = isPercent === '%' ? 100 : 1;
        return val ? Number.parseFloat(val) / divisor : 1;
    };

    return match && lVal && cVal && hVal
        ? pipe(
              Effect.succeed({
                  a: parseAlpha(aVal, aPercent),
                  c: Number.parseFloat(cVal),
                  h: Number.parseFloat(hVal),
                  l: lPercent === '%' ? Number.parseFloat(lVal) / 100 : Number.parseFloat(lVal),
              }),
              Effect.flatMap((parsed) => validate.oklchColor(parsed)),
          )
        : Effect.fail({ _tag: 'ParseError', message: `Invalid OKLCH string: ${css}` } as ParseError);
};

const mix = (
    a: OklchColor,
    b: OklchColor,
    ratio: number,
    hueMethod: HueInterpolation = 'shorter',
): Effect.Effect<OklchColor, ParseError> =>
    create(
        lerp(a.l, b.l, ratio),
        lerp(a.c, b.c, ratio),
        interpolateHue(a.h, b.h, ratio, hueMethod),
        lerp(a.a, b.a, ratio),
    );

const adjust = (color: OklchColor, delta: OklchAdjust): Effect.Effect<OklchColor, ParseError> =>
    create(
        Math.max(0, Math.min(1, color.l + (delta.lightness ?? 0))),
        Math.max(0, Math.min(0.4, color.c + (delta.chroma ?? 0))),
        normalizeHue(color.h + (delta.hue ?? 0)),
        Math.max(0, Math.min(1, color.a + (delta.alpha ?? 0))),
    );

/** Calculate APCA contrast score. Grounding: Color.js implements WCAG 3.0 APCA algorithm. */
const contrast = (fg: OklchColor, bg: OklchColor): number => toColorJs(bg).contrastAPCA(toColorJs(fg));

/** Check if color is within gamut. Grounding: Color.js uses proper gamut boundary detection. */
const isInGamut = (color: OklchColor, gamut: Gamut = 'srgb'): boolean => toColorJs(color).inGamut(gamut);

/** Map color to gamut using CSS Color 4 algorithm. Grounding: Preserves perceptual uniformity. */
const gamutMap = (color: OklchColor, gamut: Gamut = 'srgb'): Effect.Effect<OklchColor, ParseError> => {
    const mapped = toColorJs(color).to(gamut).toGamut({ space: 'oklch' });
    const [l, c, h] = mapped.coords;
    return create(l, c, h, mapped.alpha ?? 1);
};

/** Convert OKLCH to sRGB via Color.js. Grounding: CSS Color 4 spec-compliant gamut mapping. */
const toSRGB = (color: OklchColor): string =>
    toColorJs(color)
        .to('srgb')
        .toGamut()
        .toString({ format: color.a < 1 ? 'rgba' : 'rgb' });

// --- [ENTRY_POINT] -----------------------------------------------------------

const colors = (): ColorsApi =>
    Object.freeze({
        adjust,
        contrast,
        create,
        gamutMap,
        getVar,
        isInGamut,
        mix,
        parse,
        toCSS,
        toSRGB,
    });

// --- [EXPORT] ----------------------------------------------------------------

export { B as COLOR_TUNING, colors };
export type { ColorsApi, Gamut, HueInterpolation, OklchAdjust };
