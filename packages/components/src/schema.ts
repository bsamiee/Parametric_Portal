import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { Effect, pipe } from 'effect';

// --- Type Definitions -------------------------------------------------------

type DimensionConfig = S.Schema.Type<typeof DimensionSchema>;
type BehaviorConfig = S.Schema.Type<typeof BehaviorSchema>;
type ComputedDimensions = {
    readonly fontSize: string;
    readonly gap: string;
    readonly height: string;
    readonly iconSize: string;
    readonly paddingX: string;
    readonly paddingY: string;
    readonly radius: string;
};

// --- Schema Definitions (Master Schema 1: Dimensions) -----------------------

const ScaleValue = pipe(S.Number, S.between(1, 10), S.brand('ScaleValue'));
const DensityValue = pipe(S.Number, S.between(0.5, 2), S.brand('DensityValue'));
const BaseUnit = pipe(S.Number, S.positive(), S.brand('BaseUnit'));
const RadiusMultiplier = pipe(S.Number, S.between(0, 1), S.brand('RadiusMultiplier'));

const DimensionSchema = S.Struct({
    baseUnit: S.optionalWith(BaseUnit, { default: () => 0.25 as S.Schema.Type<typeof BaseUnit> }),
    density: S.optionalWith(DensityValue, { default: () => 1 as S.Schema.Type<typeof DensityValue> }),
    radiusMultiplier: S.optionalWith(RadiusMultiplier, {
        default: () => 0.25 as S.Schema.Type<typeof RadiusMultiplier>,
    }),
    scale: ScaleValue,
});

// --- Schema Definitions (Master Schema 2: Behavior) -------------------------

const BehaviorSchema = S.Struct({
    asChild: S.optionalWith(S.Boolean, { default: () => false }),
    disabled: S.optionalWith(S.Boolean, { default: () => false }),
    focusable: S.optionalWith(S.Boolean, { default: () => true }),
    interactive: S.optionalWith(S.Boolean, { default: () => true }),
    loading: S.optionalWith(S.Boolean, { default: () => false }),
});

// --- Constants (Unified Factory -> Frozen) ----------------------------------

const { algorithmConfig } = Effect.runSync(
    Effect.all({
        algorithmConfig: Effect.succeed({
            fontScaleBase: 0.75,
            fontScaleStep: 0.125,
            gapMultiplier: 1,
            heightBase: 1.5,
            heightStep: 0.5,
            iconScaleRatio: 0.6,
            paddingHorizontalMultiplier: 2,
            paddingVerticalMultiplier: 0.5,
            radiusMax: 9999,
        } as const),
    }),
);

const ALGORITHM_CONFIG = Object.freeze(algorithmConfig);

// --- Pure Utility Functions -------------------------------------------------

const computeRem = (value: number, baseUnit: number): string => `${(value * baseUnit).toFixed(3)}rem`;

const computeFontSize = (scale: number): string =>
    computeRem(ALGORITHM_CONFIG.fontScaleBase + scale * ALGORITHM_CONFIG.fontScaleStep, 1);

const computeHeight = (scale: number, density: number, baseUnit: number): string =>
    computeRem((ALGORITHM_CONFIG.heightBase + scale * ALGORITHM_CONFIG.heightStep) * density, baseUnit * 4);

const computePaddingX = (scale: number, density: number, baseUnit: number): string =>
    computeRem(scale * ALGORITHM_CONFIG.paddingHorizontalMultiplier * density, baseUnit);

const computePaddingY = (scale: number, density: number, baseUnit: number): string =>
    computeRem(scale * ALGORITHM_CONFIG.paddingVerticalMultiplier * density, baseUnit);

const computeGap = (scale: number, density: number, baseUnit: number): string =>
    computeRem(scale * ALGORITHM_CONFIG.gapMultiplier * density, baseUnit);

const computeRadius = (scale: number, radiusMultiplier: number, baseUnit: number): string =>
    radiusMultiplier >= 1 ? `${ALGORITHM_CONFIG.radiusMax}px` : computeRem(scale * radiusMultiplier * 2, baseUnit);

const computeIconSize = (scale: number, baseUnit: number): string =>
    computeRem(
        (ALGORITHM_CONFIG.fontScaleBase + scale * ALGORITHM_CONFIG.fontScaleStep) * ALGORITHM_CONFIG.iconScaleRatio,
        baseUnit * 4,
    );

// --- Effect Pipelines & Builders --------------------------------------------

const computeDimensions = (config: DimensionConfig): Effect.Effect<ComputedDimensions, never, never> =>
    Effect.succeed({
        fontSize: computeFontSize(config.scale),
        gap: computeGap(config.scale, config.density, config.baseUnit),
        height: computeHeight(config.scale, config.density, config.baseUnit),
        iconSize: computeIconSize(config.scale, config.baseUnit),
        paddingX: computePaddingX(config.scale, config.density, config.baseUnit),
        paddingY: computePaddingY(config.scale, config.density, config.baseUnit),
        radius: computeRadius(config.scale, config.radiusMultiplier, config.baseUnit),
    } as const);

const decodeDimensions = (
    input: S.Schema.Encoded<typeof DimensionSchema>,
): Effect.Effect<DimensionConfig, ParseError, never> => S.decode(DimensionSchema)(input);

const decodeBehavior = (
    input: S.Schema.Encoded<typeof BehaviorSchema>,
): Effect.Effect<BehaviorConfig, ParseError, never> => S.decode(BehaviorSchema)(input);

const createDimensionDefaults = (): DimensionConfig => Effect.runSync(S.decode(DimensionSchema)({ scale: 5 }));

const createBehaviorDefaults = (): BehaviorConfig => Effect.runSync(S.decode(BehaviorSchema)({}));

// --- Export (Internal - not public API) -------------------------------------

export {
    ALGORITHM_CONFIG,
    BehaviorSchema,
    computeDimensions,
    createBehaviorDefaults,
    createDimensionDefaults,
    decodeBehavior,
    decodeDimensions,
    DimensionSchema,
};
export type { BehaviorConfig, ComputedDimensions, DimensionConfig };
