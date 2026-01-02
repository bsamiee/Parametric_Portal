/**
 * OKLCH color class: validation + behavior + state derivation in single Schema.Class.
 * Pattern: crypto.ts (Effect.fn tracing, static schemas, instance transforms).
 * Grounding: Stevens' Power Law + Helmholtz-Kohlrausch effect govern perception.
 */

import type { ColorCategory } from '@parametric-portal/types/ui';
import Color from 'colorjs.io';
import { Data, Effect, ParseResult, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

class OklchColor extends S.Class<OklchColor>('OklchColor')({
    a: S.Number.pipe(S.clamp(0, 1)),
    c: S.Number.pipe(S.clamp(0, 0.4)),
    h: S.transform(S.Number, S.Number, { decode: (h) => ((h % 360) + 360) % 360, encode: (h) => h }),
    l: S.Number.pipe(S.clamp(0, 1)),
}) {
    // --- [FORMAT_DISPATCH] ---------------------------------------------------
    private static readonly Regex = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\)/i;
    private toColorJs(): Color {
        return new Color('oklch', [this.l, this.c, this.h], this.a);
    }
    to<F extends keyof typeof OklchColor.Format>(format: F): ReturnType<(typeof OklchColor.Format)[F]> {
        return OklchColor.Format[format](this) as ReturnType<(typeof OklchColor.Format)[F]>;
    }
    private static readonly Format = {
        colorjs: (c: OklchColor) => c.toColorJs(),
        css: (c: OklchColor) => {
            const a = c.a < 1 ? ` / ${c.a.toFixed(2)}` : '';
            return `oklch(${(c.l * 100).toFixed(1)}% ${c.c.toFixed(3)} ${c.h.toFixed(1)}${a})`;
        },
        srgb: (c: OklchColor) =>
            c
                .toColorJs()
                .to('srgb')
                .toGamut()
                .toString({ format: c.a < 1 ? 'rgba' : 'rgb' }),
    } as const;
    // --- [STATIC_SCHEMAS] ----------------------------------------------------
    static readonly Gamut = S.Literal('srgb', 'p3');
    static readonly RacState = S.Literal('disabled', 'focused', 'hovered', 'pressed', 'selected');
    static readonly StateShift = S.Struct({ alphaShift: S.Number, chromaShift: S.Number, lightnessShift: S.Number });
    // --- [STATE_DERIVATION] --------------------------------------------------
    // (Stevens' Power Law + Helmholtz-Kohlrausch), Tuning: magnitude per state, intensity per category, adaptive factors for perceptual uniformity
    private static readonly T = Object.freeze({
        intensity: {
            accent1: 1,
            accent2: 1,
            accent3: 1,
            accent4: 1,
            accent5: 1,
            accent6: 1,
            accent7: 1,
            accent8: 1,
            accent9: 1,
            accent10: 1,
            border: 0.5,
            destructive: 0.9,
            info: 0.9,
            muted: 0.7,
            success: 0.9,
            surface: 0.7,
            text: 0.6,
            warning: 0.9,
        } satisfies Record<ColorCategory, number>,
        magnitudes: {
            disabled: { a: -0.4, c: -0.08, l: 0.15 },
            focused: { a: 0, c: 0.03, l: 0.048 },
            hovered: { a: 0, c: 0.02, l: 0.06 },
            pressed: { a: 0, c: 0.025, l: 0.08 },
            selected: { a: 0, c: 0.01, l: 0.03 },
        },
    } as const);
    // --- [LIGHTNESS_SHIFT] ---------------------------------------------------
    // adaptiveFactor = (0.7 + min(l, 1-l)) × (1.5 - 0.5×min(c/0.2, 1)) — compensates for extremes, Stevens' Power Law — magnitude × adaptiveFactor × intensity × direction
    deriveShift<S extends typeof OklchColor.RacState.Type>(state: S, category: ColorCategory) {
        const m = OklchColor.T.magnitudes[state],
            i = OklchColor.T.intensity[category];
        const adaptive = (0.7 + Math.min(this.l, 1 - this.l)) * (1.5 - 0.5 * Math.min(this.c / 0.2, 1));
        const dir = state === 'pressed' ? (this.l < 0.3 ? 1 : -1) : this.l < 0.5 ? 1 : -1;
        return {
            alphaShift: m.a,
            chromaShift: state === 'disabled' ? m.c : m.c * i,
            lightnessShift: m.l * adaptive * i * dir,
        };
    }
    deriveAllShifts(category: ColorCategory) {
        type M = typeof OklchColor.T.magnitudes;
        return Object.freeze(
            Object.fromEntries(
                (Object.keys(OklchColor.T.magnitudes) as (keyof M)[]).map((s) => [s, this.deriveShift(s, category)]),
            ),
        ) as { readonly [K in keyof M]: typeof OklchColor.StateShift.Type };
    }
    // --- [CORE_METHODS] ------------------------------------------------------
    contrast(bg: OklchColor): number {
        return bg.toColorJs().contrastAPCA(this.toColorJs());
    }
    inGamut(gamut: typeof OklchColor.Gamut.Type = 'srgb'): boolean {
        return this.toColorJs().inGamut(gamut);
    }
    // --- [FACTORIES] ---------------------------------------------------------
    static readonly cssVar = (name: string, step: number | string): string => `var(--color-${name}-${step})`;
    static readonly create = Effect.fn('oklch.create')((l: number, c: number, h: number, a = 1) =>
        S.decodeUnknown(OklchColor)({ a, c, h, l }),
    );
    static readonly fromCSS = Effect.fn('oklch.fromCSS')((css: string) =>
        Effect.gen(function* () {
            const m = OklchColor.Regex.exec(css);
            const p = (v: string, pct?: string) => Number.parseFloat(v) / (pct === '%' ? 100 : 1);
            return yield* m?.[1] && m[3] && m[4]
                ? OklchColor.create(
                      p(m[1], m[2]),
                      Number.parseFloat(m[3]),
                      Number.parseFloat(m[4]),
                      m[5] ? p(m[5], m[6]) : 1,
                  )
                : Effect.fail(new ParseResult.Type(S.String.ast, css, `Invalid OKLCH: ${css}`));
        }),
    );
    static readonly adjust = Effect.fn('oklch.adjust')((c: OklchColor, dl = 0, dc = 0, dh = 0, da = 0) =>
        OklchColor.create(c.l + dl, c.c + dc, c.h + dh, c.a + da),
    );
}

// --- [THEME_ERROR] -----------------------------------------------------------

type ThemeError = Data.TaggedEnum<{
    Generation: { category: string; message: string; phase: 'color' | 'scale' | 'token' };
    Plugin: { code: 'CONFIG_WATCH_FAILED' | 'HMR_FAILED' | 'GENERATION_FAILED'; message: string };
    Validation: { field: string; message: string; received: unknown };
}>;

const ThemeError = (() => {
    const taggedEnum = Data.taggedEnum<ThemeError>();
    return {
        ...taggedEnum,
        getMessage: (e: ThemeError): string =>
            taggedEnum.$match(e, {
                Generation: (g) => `[${g.phase}] ${g.category}: ${g.message}`,
                Plugin: (p) => `[${p.code}] ${p.message}`,
                Validation: (v) => `${v.field}: ${v.message}`,
            }),
    };
})();

// --- [EXPORT] ----------------------------------------------------------------

export { OklchColor, ThemeError };
