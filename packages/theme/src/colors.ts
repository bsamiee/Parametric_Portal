/**
 * Manipulate OKLCH colors at runtime.
 * Grounding: OKLCH preserves perceptual uniformity across lightness adjustments.
 */

import { Effect, pipe } from 'effect';
import type { ParseError } from 'effect/ParseResult';
import { type OklchColor, validateOklchColor } from './schemas.ts';

// --- [TYPES] -----------------------------------------------------------------

type HueInterpolation = 'longer' | 'shorter';
type Gamut = 'p3' | 'srgb';
type OklchAdjust = {
    readonly alpha?: number;
    readonly chroma?: number;
    readonly hue?: number;
    readonly lightness?: number;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    apca: {
        blkClmp: Math.SQRT2,
        blkThrs: 0.022,
        deltaYMin: 0.0005,
        normBg: 0.56,
        normTxt: 0.57,
        revBg: 0.65,
        revTxt: 0.62,
        scaleBoW: 1.14,
        scaleWoB: 1.14,
    },
    gamut: {
        maxChroma: 0.37,
        p3MaxChroma: 0.45,
    },
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

/** Calculate relative luminance via gamma transform. Grounding: Approximates sRGB luminance for contrast calculations. */
const oklchToLuminance = (l: number): number => l ** 2.4;

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const createOklch = (l: number, c: number, h: number, a = 1): Effect.Effect<OklchColor, ParseError> =>
    validateOklchColor({ a, c, h, l });

const toCSS = (color: OklchColor): string =>
    `oklch(${(color.l * 100).toFixed(1)}% ${color.c.toFixed(3)} ${color.h.toFixed(1)}${formatAlpha(color.a)})`;

const parseOklch = (css: string): Effect.Effect<OklchColor, ParseError> => {
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
              Effect.flatMap((parsed) => validateOklchColor(parsed)),
          )
        : Effect.fail({ _tag: 'ParseError', message: `Invalid OKLCH string: ${css}` } as ParseError);
};

const mix = (
    a: OklchColor,
    b: OklchColor,
    ratio: number,
    hueMethod: HueInterpolation = 'shorter',
): Effect.Effect<OklchColor, ParseError> =>
    createOklch(
        lerp(a.l, b.l, ratio),
        lerp(a.c, b.c, ratio),
        interpolateHue(a.h, b.h, ratio, hueMethod),
        lerp(a.a, b.a, ratio),
    );

const adjust = (color: OklchColor, delta: OklchAdjust): Effect.Effect<OklchColor, ParseError> =>
    createOklch(
        Math.max(0, Math.min(1, color.l + (delta.lightness ?? 0))),
        Math.max(0, Math.min(0.4, color.c + (delta.chroma ?? 0))),
        normalizeHue(color.h + (delta.hue ?? 0)),
        Math.max(0, Math.min(1, color.a + (delta.alpha ?? 0))),
    );

/** Calculate APCA contrast score. Grounding: APCA accounts for perceptual asymmetry between dark-on-light and light-on-dark. */
const contrast = (fg: OklchColor, bg: OklchColor): number => {
    const Yfg = oklchToLuminance(fg.l);
    const Ybg = oklchToLuminance(bg.l);

    const Ytxt = Yfg > B.apca.blkThrs ? Yfg : Yfg + (B.apca.blkThrs - Yfg) ** B.apca.blkClmp;
    const Ybgc = Ybg > B.apca.blkThrs ? Ybg : Ybg + (B.apca.blkThrs - Ybg) ** B.apca.blkClmp;

    const Sapc =
        Ybgc > Ytxt
            ? (Ybgc ** B.apca.normBg - Ytxt ** B.apca.normTxt) * B.apca.scaleBoW
            : (Ybgc ** B.apca.revBg - Ytxt ** B.apca.revTxt) * B.apca.scaleWoB;

    return Math.abs(Sapc) < B.apca.deltaYMin ? 0 : Sapc * 100;
};

const isInGamut = (color: OklchColor, gamut: Gamut = 'srgb'): boolean => {
    const maxChroma = gamut === 'p3' ? B.gamut.p3MaxChroma : B.gamut.maxChroma;
    return color.c <= maxChroma && color.l >= 0 && color.l <= 1;
};

const gamutMap = (color: OklchColor, gamut: Gamut = 'srgb'): Effect.Effect<OklchColor, ParseError> => {
    const maxChroma = gamut === 'p3' ? B.gamut.p3MaxChroma : B.gamut.maxChroma;
    return createOklch(color.l, Math.min(color.c, maxChroma), color.h, color.a);
};

/** Convert OKLCH to sRGB via OKLAB transform. Grounding: Matrix coefficients from Bjorn Ottosson OKLCH specification. */
const toSRGB = (color: OklchColor): string => {
    const L = color.l;
    const C = color.c;
    const H = (color.h * Math.PI) / 180;

    const a = C * Math.cos(H);
    const b = C * Math.sin(H);

    const lPrime = L + 0.3963377774 * a + 0.2158037573 * b;
    const mPrime = L - 0.1055613458 * a - 0.0638541728 * b;
    const sPrime = L - 0.0894841775 * a - 1.291485548 * b;

    const l = lPrime * lPrime * lPrime;
    const m = mPrime * mPrime * mPrime;
    const s = sPrime * sPrime * sPrime;

    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

    const toGamma = (v: number): number => {
        const clamped = Math.max(0, Math.min(1, v));
        return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
    };

    const R = Math.round(toGamma(r) * 255);
    const G = Math.round(toGamma(g) * 255);
    const B = Math.round(toGamma(bl) * 255);

    return color.a < 1 ? `rgba(${R}, ${G}, ${B}, ${color.a.toFixed(2)})` : `rgb(${R}, ${G}, ${B})`;
};

const getColorVar = (name: string, step: number | string): string => `var(--color-${name}-${step})`;

// --- [EXPORT] ----------------------------------------------------------------

export {
    adjust,
    B as COLOR_TUNING,
    contrast,
    createOklch,
    gamutMap,
    getColorVar,
    isInGamut,
    mix,
    parseOklch,
    toCSS,
    toSRGB,
};

export type { Gamut, HueInterpolation, OklchAdjust };
