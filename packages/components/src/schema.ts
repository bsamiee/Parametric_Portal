import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { Effect, pipe } from 'effect';

// --- Type Definitions -------------------------------------------------------

type DimensionConfig = S.Schema.Type<typeof DimensionSchema>;
type BehaviorConfig = S.Schema.Type<typeof BehaviorSchema>;
type ComputedDimensions = {
    readonly [K in 'fontSize' | 'gap' | 'height' | 'iconSize' | 'paddingX' | 'paddingY' | 'radius']: string;
};
type ComputeKey = keyof ComputedDimensions;

// --- Schema Definitions -----------------------------------------------------

const DimensionSchema = S.Struct({
    baseUnit: S.optionalWith(pipe(S.Number, S.positive(), S.brand('BaseUnit')), { default: () => 0.25 as never }),
    density: S.optionalWith(pipe(S.Number, S.between(0.5, 2), S.brand('Density')), { default: () => 1 as never }),
    radiusMultiplier: S.optionalWith(pipe(S.Number, S.between(0, 1), S.brand('Radius')), {
        default: () => 0.25 as never,
    }),
    scale: pipe(S.Number, S.between(1, 10), S.brand('Scale')),
});

const BehaviorSchema = S.Struct({
    asChild: S.optionalWith(S.Boolean, { default: () => false }),
    disabled: S.optionalWith(S.Boolean, { default: () => false }),
    focusable: S.optionalWith(S.Boolean, { default: () => true }),
    interactive: S.optionalWith(S.Boolean, { default: () => true }),
    loading: S.optionalWith(S.Boolean, { default: () => false }),
});

// --- Constants (Unified Base) -----------------------------------------------

const B = Object.freeze({
    algo: {
        fontBase: 0.75,
        fontStep: 0.125,
        gapMul: 1,
        hBase: 1.5,
        hStep: 0.5,
        iconRatio: 0.6,
        pxMul: 2,
        pyMul: 0.5,
        rMax: 9999,
    },
    defaults: { behavior: {} as const, dimensions: { scale: 5 } as const },
    stroke: { base: 2.5, factor: 0.15, max: 3, min: 1 },
} as const);

// --- Compute Dispatch Table -------------------------------------------------

const rem = (v: number, u: number): string => `${(v * u).toFixed(3)}rem`;

const compute: { readonly [K in ComputeKey]: (c: DimensionConfig) => string } = {
    fontSize: (c) => rem(B.algo.fontBase + c.scale * B.algo.fontStep, 1),
    gap: (c) => rem(c.scale * B.algo.gapMul * c.density, c.baseUnit),
    height: (c) => rem((B.algo.hBase + c.scale * B.algo.hStep) * c.density, c.baseUnit * 4),
    iconSize: (c) => rem((B.algo.fontBase + c.scale * B.algo.fontStep) * B.algo.iconRatio, c.baseUnit * 4),
    paddingX: (c) => rem(c.scale * B.algo.pxMul * c.density, c.baseUnit),
    paddingY: (c) => rem(c.scale * B.algo.pyMul * c.density, c.baseUnit),
    radius: (c) => (c.radiusMultiplier >= 1 ? `${B.algo.rMax}px` : rem(c.scale * c.radiusMultiplier * 2, c.baseUnit)),
};

// --- Pure Utility Functions -------------------------------------------------

const strokeWidth = (scale: number): number =>
    Math.max(B.stroke.min, Math.min(B.stroke.max, B.stroke.base - scale * B.stroke.factor));

const styleVars = (d: ComputedDimensions, prefix: string): Record<string, string> =>
    Object.fromEntries(
        Object.entries(d).map(([k, v]) => [`--${prefix}-${k.replace(/([A-Z])/g, '-$1').toLowerCase()}`, v]),
    );

// --- Effect Pipelines -------------------------------------------------------

const computeDimensions = (c: DimensionConfig): Effect.Effect<ComputedDimensions, never, never> =>
    Effect.succeed(
        Object.fromEntries(
            (Object.keys(compute) as ReadonlyArray<ComputeKey>).map((k) => [k, compute[k](c)]),
        ) as ComputedDimensions,
    );

const decodeDimensions = (
    input: S.Schema.Encoded<typeof DimensionSchema>,
): Effect.Effect<DimensionConfig, ParseError, never> => S.decode(DimensionSchema)(input);

const decodeBehavior = (
    input: S.Schema.Encoded<typeof BehaviorSchema>,
): Effect.Effect<BehaviorConfig, ParseError, never> => S.decode(BehaviorSchema)(input);

const createDimensionDefaults = (): DimensionConfig => Effect.runSync(S.decode(DimensionSchema)(B.defaults.dimensions));
const createBehaviorDefaults = (): BehaviorConfig => Effect.runSync(S.decode(BehaviorSchema)(B.defaults.behavior));

// --- Export -----------------------------------------------------------------

export {
    B,
    BehaviorSchema,
    compute,
    computeDimensions,
    createBehaviorDefaults,
    createDimensionDefaults,
    decodeBehavior,
    decodeDimensions,
    DimensionSchema,
    strokeWidth,
    styleVars,
};
export type { BehaviorConfig, ComputedDimensions, DimensionConfig };
