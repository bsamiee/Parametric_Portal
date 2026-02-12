/**
 * OKLCH color primitive with branded channel types and ROP-friendly factories.
 * Separates pure color math from validation effects per strict FP.
 *
 * Design:
 * - Branded schemas for channels (Lightness, Chroma, Hue, Alpha) enforce invariants at type level
 * - Pure `adjust` method for internal transforms (no Effect overhead)
 * - Factory variants: create (Effect), unsafeFromNumbers (pure), fromNumbers (Either), fromNumbersEffect (domain error)
 * - contrast wrapped with Effect.try (colorjs.io can throw)
 * - ThemeError with cause field preserves error chain
 */
import type { DeepReadonly } from 'ts-essentials';
import Color from 'colorjs.io';
import { Data, Effect, Either, Match, type ParseResult, pipe, Schema as S } from 'effect';
import { TW } from '@parametric-portal/types/ui';

// --- [TYPES] -----------------------------------------------------------------

type ThemeErrorType = Data.TaggedEnum<{
    Generation: {
        readonly category: string;
        readonly message: string;
        readonly phase: 'color' | 'scale' | 'token';
        readonly cause?: unknown;
    };
    Plugin: {
        readonly code: 'CONFIG_WATCH_FAILED' | 'GENERATION_FAILED' | 'HMR_FAILED';
        readonly message: string;
        readonly cause?: unknown;
    };
    Validation: {
        readonly field: string;
        readonly message: string;
        readonly received: unknown;
        readonly cause?: ParseResult.ParseError;
    };
}>;
type OklchColorType = InstanceType<typeof OklchColorClass>;
type ColorStep = (typeof COLOR_STEPS)[number];
type FormatKey = keyof typeof Format;

// --- [SCHEMA] ----------------------------------------------------------------

const COLOR_STEPS = TW.colorStep;
const ColorStepSchema = S.Union(...COLOR_STEPS.map((n) => S.Literal(n)));
const CssIdentifierSchema = S.String.pipe(S.pattern(/^[a-z][a-z0-9-]*$/), S.brand('CssIdentifier'));

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    bounds: Object.freeze({             /** Channel bounds for clamping */
        alpha: Object.freeze({ max: 1, min: 0 }),
        chroma: Object.freeze({ max: 0.4, min: 0 }),
        hue: Object.freeze({ max: 360, min: 0 }),
        lightness: Object.freeze({ max: 1, min: 0 }),
    }),
    colorSteps: COLOR_STEPS,
}) satisfies DeepReadonly<{
    colorSteps: readonly number[];
    bounds: { lightness: { min: number; max: number }; chroma: { min: number; max: number }; hue: { min: number; max: number }; alpha: { min: number; max: number }; };
}>;

// --- [CLASSES] ---------------------------------------------------------------

const taggedEnum = Data.taggedEnum<ThemeErrorType>();

class OklchColorClass extends S.Class<OklchColorClass>('OklchColor')({
    a: S.Number.pipe(S.clamp(B.bounds.alpha.min, B.bounds.alpha.max)),
    c: S.Number.pipe(S.clamp(B.bounds.chroma.min, B.bounds.chroma.max)),
    h: S.transform(S.Number, S.Number, {
        decode: (h) => ((h % B.bounds.hue.max) + B.bounds.hue.max) % B.bounds.hue.max,
        encode: (h) => h,
    }),
    l: S.Number.pipe(S.clamp(B.bounds.lightness.min, B.bounds.lightness.max)),
}) {
    private toColorJs(): Color { return new Color('oklch', [this.l, this.c, this.h], this.a); }
    to<F extends FormatKey>(format: F): ReturnType<(typeof Format)[F]> { return Format[format](this) as ReturnType<(typeof Format)[F]>; }
    /** Pure adjustment — clamps internally, no Effect.Use for internal transforms where values are already validated. */
    adjust(dl = 0, dc = 0, dh = 0, da = 0): OklchColorClass { return OklchColor.unsafeFromNumbers(this.l + dl, this.c + dc, this.h + dh, this.a + da); }
    /** APCA contrast ratio (can throw, use contrastEffect for safety) */
    contrast(bg: OklchColorClass): number { return bg.toColorJs().contrastAPCA(this.toColorJs()); }
    /** Safe contrast computation wrapped in Effect */
    contrastEffect(bg: OklchColorClass): Effect.Effect<number, ThemeErrorType> {
        return Effect.try({
            catch: (e) =>
                ThemeError.Generation({
                    category: 'contrast',
                    cause: e,
                    message: e instanceof Error ? e.message : String(e),
                    phase: 'color',
                }),
            try: () => this.contrast(bg),
        });
    }
}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const clamp = Object.freeze({           /** Pure clamping — no Effect, no decode. For internal use. */
    a: (v: number) => Math.max(B.bounds.alpha.min, Math.min(B.bounds.alpha.max, v)),
    c: (v: number) => Math.max(B.bounds.chroma.min, Math.min(B.bounds.chroma.max, v)),
    h: (v: number) => ((v % B.bounds.hue.max) + B.bounds.hue.max) % B.bounds.hue.max,
    l: (v: number) => Math.max(B.bounds.lightness.min, Math.min(B.bounds.lightness.max, v)),
});
const Format = Object.freeze({
    colorjs: (c: OklchColorClass) => c['toColorJs'](),
    css: (c: OklchColorClass) => {
        const alpha = c.a < 1 ? ` / ${c.a.toFixed(2)}` : '';
        return `oklch(${(c.l * 100).toFixed(1)}% ${c.c.toFixed(3)} ${c.h.toFixed(1)}${alpha})`;
    },
    srgb: (c: OklchColorClass) =>
        c['toColorJs']()
            .to('srgb')
            .toGamut()
            .toString({ format: c.a < 1 ? 'rgba' : 'rgb' }),
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const ThemeError = Object.freeze({      /** ThemeError ADT with getMessage renderer */
    ...taggedEnum,
    getMessage: (e: ThemeErrorType): string =>
        Match.value(e).pipe(
            Match.tag('Generation', (g) => `[${g.phase}] ${g.category}: ${g.message}`),
            Match.tag('Plugin', (p) => `[${p.code}] ${p.message}`),
            Match.tag('Validation', (v) => `${v.field}: ${v.message}`),
            Match.exhaustive,
        ),
});
const OklchColor = Object.freeze({      /** OKLCH color namespace with factory variants */
    /** Effect-based factory — validates via schema, returns ParseError on failure. Use at boundaries where input is untrusted. */
    create: (l: number, c: number, h: number, a = 1): Effect.Effect<OklchColorClass, ParseResult.ParseError> => S.decodeUnknown(OklchColorClass)({ a, c, h, l }),
    /** ROP-friendly Either factory — maps parse error to ThemeError.Validation. Preferred for composition in ROP pipelines. */
    fromNumbers: (l: number, c: number, h: number, a = 1): Either.Either<OklchColorClass, ThemeErrorType> =>
        pipe(
            S.decodeEither(OklchColorClass)({ a, c, h, l }),
            Either.mapLeft((e) =>
                ThemeError.Validation({
                    cause: e,
                    field: 'OklchColor',
                    message: `Invalid OKLCH values: l=${l}, c=${c}, h=${h}, a=${a}`,
                    received: { a, c, h, l },
                }),
            ),
        ),
    /** Effect factory with domain error — wraps fromNumbers. Use in Effect.gen pipelines for consistent error typing. */
    fromNumbersEffect: (l: number, c: number, h: number, a = 1): Effect.Effect<OklchColorClass, ThemeErrorType> =>
        pipe(
            OklchColor.fromNumbers(l, c, h, a),
            Either.match({
                onLeft: Effect.fail,
                onRight: Effect.succeed,
            }),
        ),
    Step: B.colorSteps,                 /** Color scale steps (50-950) */
    /** Pure unsafe factory — clamps values, no validation Effect. Use for internal transforms where source values are already validated. */
    unsafeFromNumbers: (l: number, c: number, h: number, a = 1): OklchColorClass => new OklchColorClass({ a: clamp.a(a), c: clamp.c(c), h: clamp.h(h), l: clamp.l(l) }),
});

// --- [EXPORT] ----------------------------------------------------------------

export { ColorStepSchema, CssIdentifierSchema, OklchColor, ThemeError };
export type { ColorStep, OklchColorType, ThemeErrorType };
