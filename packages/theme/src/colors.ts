/**
 * OKLCH color class: validation + behavior in single Schema.Class.
 * Minimal surface: create, adjust, to(format), contrast.
 */

import Color from 'colorjs.io';
import { Data, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

class OklchColor extends S.Class<OklchColor>('OklchColor')({
    a: S.Number.pipe(S.clamp(0, 1)),
    c: S.Number.pipe(S.clamp(0, 0.4)),
    h: S.transform(S.Number, S.Number, { decode: (h) => ((h % 360) + 360) % 360, encode: (h) => h }),
    l: S.Number.pipe(S.clamp(0, 1)),
}) {
    // --- [CONSTANTS] ---------------------------------------------------------
    static readonly Step = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
    // --- [FORMAT_DISPATCH] ---------------------------------------------------
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
    // --- [CORE_METHODS] ------------------------------------------------------
    contrast(bg: OklchColor): number {
        return bg.toColorJs().contrastAPCA(this.toColorJs());
    }
    withAdjustment(dl = 0, dc = 0, dh = 0, da = 0) {
        return OklchColor.create(this.l + dl, this.c + dc, this.h + dh, this.a + da);
    }
    // --- [FACTORIES] ---------------------------------------------------------
    static readonly create = (l: number, c: number, h: number, a = 1) => S.decodeUnknown(OklchColor)({ a, c, h, l });
}

// --- [THEME_ERROR] -----------------------------------------------------------

type ThemeError = Data.TaggedEnum<{
    Generation: { category: string; message: string; phase: 'color' | 'scale' | 'token' };
    Plugin: { code: 'CONFIG_WATCH_FAILED' | 'GENERATION_FAILED' | 'HMR_FAILED'; message: string };
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
