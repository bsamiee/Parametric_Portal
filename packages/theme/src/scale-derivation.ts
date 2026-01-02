/**
 * Parametric token derivation via perceptual exponents.
 * Single scale (0.8-1.5) + density (0.75-1.25) drives ALL derived tokens.
 */

import { STATIC_TOKENS, TW } from '@parametric-portal/types/ui';
import { Array as A, pipe, Record as R, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type Density = keyof typeof B.density;
type SpacingKey = (typeof TW.spacing)[number];
type GeneratedTokens = typeof STATIC_TOKENS & {
    readonly duration: Record<string, string>;
    readonly fontSize: Record<string, string>;
    readonly lineHeight: Record<string, number>;
    readonly radius: Record<string, string>;
    readonly shadow: Record<string, string>;
    readonly spacing: Record<SpacingKey, string>;
};

// --- [SCHEMA] ----------------------------------------------------------------

class ScaleConfig extends S.Class<ScaleConfig>('ScaleConfig')({
    density: S.Number.pipe(S.clamp(0.75, 1.25)),
    scale: S.Number.pipe(S.clamp(0.8, 1.5)),
}) {
    static readonly fromDensity = (scale: number, density: Density = 'comfortable'): ScaleConfig =>
        ScaleConfig.make({ density: B.density[density], scale });
}

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    ...STATIC_TOKENS,
    base: Object.freeze({ duration: 200, fontSize: 1, lineHeight: 1.5, radius: 0.375, shadowBlur: 6, spacing: 0.25 }),
    density: Object.freeze({ comfortable: 1, compact: 0.75, spacious: 1.25 }),
    exp: Object.freeze({ duration: -0.5, fontSize: 0.875, lineHeight: 0.25, radius: 0.67, shadow: 0.75, spacing: 1 }),
    fmt: Object.freeze({
        ms: (v: number): string => `${Math.round(v)}ms`,
        num: (v: number): number => Number(v.toFixed(3)),
        px: (v: number): string => `${v.toFixed(1).replace(/\.?0+$/, '')}px`,
        rem: (v: number): string => `${v.toFixed(3).replace(/\.?0+$/, '')}rem`,
    }),
    lineHeightBase: Object.freeze({
        '2xl': 1.75,
        '3xl': 1.8,
        '4xl': 1.85,
        base: 1.5,
        lg: 1.6,
        sm: 1.35,
        xl: 1.7,
        xs: 1.2,
    }),
    mult: Object.freeze({
        duration: Object.fromEntries(
            pipe(
                TW.duration,
                A.map((k, i) => [String(k), i === 0 ? 0 : 0.5 + i * 0.5] as const),
            ),
        ),
        fontSize: pipe(
            TW.fontSize,
            A.map((k, i) => [k, i <= 2 ? 0.75 + i * 0.125 : 1 + (i - 2) * 0.25] as const),
            R.fromEntries,
        ),
        radius: pipe(
            TW.radius,
            A.map((k, i) => [k, 0.33 + i * 0.33] as const),
            R.fromEntries,
        ),
        shadow: pipe(
            TW.shadow,
            A.map((k, i) => [k, 0.33 + i * 0.67] as const),
            R.fromEntries,
        ),
    }),
    shadowColor: 'rgb(0 0 0 / 0.1)',
    shadowRatios: Object.freeze({ spread: 0.25, yOffset: 0.5 }),
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const derive = (b: number, s: number, e: number, m: number, d: number): number => b * s ** e * m * d;
const gen =
    (mults: Record<string, number>, base: number, exp: number, fmt: (v: number) => string, useDensity: boolean) =>
    (cfg: ScaleConfig): Record<string, string> =>
        R.map(mults, (m) => (m === 0 ? '0ms' : fmt(derive(base, cfg.scale, exp, m, useDensity ? cfg.density : 1))));

// --- [ENTRY_POINT] -----------------------------------------------------------

const generateTokensFromScale = (cfg: ScaleConfig): GeneratedTokens => {
    const tokens: GeneratedTokens = {
        ...STATIC_TOKENS,
        duration: gen(B.mult.duration, B.base.duration, B.exp.duration, B.fmt.ms, true)(cfg),
        fontSize: gen(B.mult.fontSize, B.base.fontSize, B.exp.fontSize, B.fmt.rem, false)(cfg),
        lineHeight: R.map(B.lineHeightBase, (v) => B.fmt.num(v * cfg.scale ** B.exp.lineHeight)),
        radius: gen(B.mult.radius, B.base.radius, B.exp.radius, B.fmt.rem, true)(cfg),
        shadow: R.map(B.mult.shadow, (m) => {
            const blur = derive(B.base.shadowBlur, cfg.scale, B.exp.shadow, m, cfg.density);
            return `0 ${B.fmt.px(blur * B.shadowRatios.yOffset)} ${B.fmt.px(blur)} ${B.fmt.px(blur * B.shadowRatios.spread)} ${B.shadowColor}`;
        }),
        spacing: Object.fromEntries(
            pipe(
                TW.spacing,
                A.map(
                    (step) =>
                        [
                            step,
                            B.fmt.rem(derive(B.base.spacing, cfg.scale, B.exp.spacing, Number(step), cfg.density)),
                        ] as const,
                ),
            ),
        ) as Record<SpacingKey, string>,
    };
    return Object.freeze(tokens);
};

// --- [EXPORT] ----------------------------------------------------------------

export { generateTokensFromScale, ScaleConfig, B as SCALE_DERIVATION_TUNING };
export type { Density, GeneratedTokens };
