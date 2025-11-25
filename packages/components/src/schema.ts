import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { clsx } from 'clsx';
import { Effect, pipe } from 'effect';
import { twMerge } from 'tailwind-merge';

// --- Type Definitions -------------------------------------------------------

type DimensionConfig = S.Schema.Type<typeof DimensionSchema>;
type BehaviorConfig = S.Schema.Type<typeof BehaviorSchema>;
type OverlayConfig = S.Schema.Type<typeof OverlaySchema>;
type FeedbackConfig = S.Schema.Type<typeof FeedbackSchema>;
type AnimationConfig = S.Schema.Type<typeof AnimationSchema>;
type ComputedDimensions = {
    readonly [K in 'fontSize' | 'gap' | 'height' | 'iconSize' | 'paddingX' | 'paddingY' | 'radius']: string;
};
type ComputeKey = keyof ComputedDimensions;
type FeedbackVariant = 'error' | 'info' | 'success' | 'warning';
type OverlayPosition = 'bottom' | 'left' | 'right' | 'top';

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

const OverlaySchema = S.Struct({
    backdrop: S.optionalWith(S.Boolean, { default: () => true }),
    closeOnEscape: S.optionalWith(S.Boolean, { default: () => true }),
    closeOnOutsideClick: S.optionalWith(S.Boolean, { default: () => true }),
    modal: S.optionalWith(S.Boolean, { default: () => true }),
    position: S.optionalWith(S.Union(S.Literal('top'), S.Literal('bottom'), S.Literal('left'), S.Literal('right')), {
        default: () => 'bottom' as never,
    }),
    trapFocus: S.optionalWith(S.Boolean, { default: () => true }),
});

const FeedbackSchema = S.Struct({
    autoDismiss: S.optionalWith(S.Boolean, { default: () => true }),
    dismissible: S.optionalWith(S.Boolean, { default: () => true }),
    duration: S.optionalWith(pipe(S.Number, S.positive()), { default: () => 5000 as never }),
    variant: S.optionalWith(
        S.Union(S.Literal('info'), S.Literal('success'), S.Literal('warning'), S.Literal('error')),
        {
            default: () => 'info' as never,
        },
    ),
});

const AnimationSchema = S.Struct({
    duration: S.optionalWith(pipe(S.Number, S.positive()), { default: () => 200 as never }),
    easing: S.optionalWith(S.String, { default: () => 'ease-out' as never }),
    enabled: S.optionalWith(S.Boolean, { default: () => true }),
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

// --- Pure Utility Functions -------------------------------------------------

const rem = (v: number, u: number): string => `${(v * u).toFixed(3)}rem`;
const cls = (...inputs: ReadonlyArray<string | undefined>): string => twMerge(clsx(inputs));
const strokeWidth = (scale: number): number =>
    Math.max(B.stroke.min, Math.min(B.stroke.max, B.stroke.base - scale * B.stroke.factor));
const styleVars = (d: ComputedDimensions, prefix: string): Record<string, string> =>
    Object.fromEntries(
        Object.entries(d).map(([k, v]) => [`--${prefix}-${k.replace(/([A-Z])/g, '-$1').toLowerCase()}`, v]),
    );
const createVars =
    (prefix: string) =>
    (d: ComputedDimensions): Record<string, string> =>
        styleVars(d, prefix);

// --- Compute Dispatch Table -------------------------------------------------

const compute: { readonly [K in ComputeKey]: (c: DimensionConfig) => string } = {
    fontSize: (c) => rem(B.algo.fontBase + c.scale * B.algo.fontStep, 1),
    gap: (c) => rem(c.scale * B.algo.gapMul * c.density, c.baseUnit),
    height: (c) => rem((B.algo.hBase + c.scale * B.algo.hStep) * c.density, c.baseUnit * 4),
    iconSize: (c) => rem((B.algo.fontBase + c.scale * B.algo.fontStep) * B.algo.iconRatio, c.baseUnit * 4),
    paddingX: (c) => rem(c.scale * B.algo.pxMul * c.density, c.baseUnit),
    paddingY: (c) => rem(c.scale * B.algo.pyMul * c.density, c.baseUnit),
    radius: (c) => (c.radiusMultiplier >= 1 ? `${B.algo.rMax}px` : rem(c.scale * c.radiusMultiplier * 2, c.baseUnit)),
};

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

const decodeOverlay = (
    input: S.Schema.Encoded<typeof OverlaySchema>,
): Effect.Effect<OverlayConfig, ParseError, never> => S.decode(OverlaySchema)(input);

const decodeFeedback = (
    input: S.Schema.Encoded<typeof FeedbackSchema>,
): Effect.Effect<FeedbackConfig, ParseError, never> => S.decode(FeedbackSchema)(input);

const decodeAnimation = (
    input: S.Schema.Encoded<typeof AnimationSchema>,
): Effect.Effect<AnimationConfig, ParseError, never> => S.decode(AnimationSchema)(input);

const createDimensionDefaults = (): DimensionConfig => Effect.runSync(S.decode(DimensionSchema)(B.defaults.dimensions));
const createBehaviorDefaults = (): BehaviorConfig => Effect.runSync(S.decode(BehaviorSchema)(B.defaults.behavior));
const createOverlayDefaults = (): OverlayConfig => Effect.runSync(S.decode(OverlaySchema)({}));
const createFeedbackDefaults = (): FeedbackConfig => Effect.runSync(S.decode(FeedbackSchema)({}));
const createAnimationDefaults = (): AnimationConfig => Effect.runSync(S.decode(AnimationSchema)({}));

const resolve = (
    dim?: Partial<DimensionConfig>,
    beh?: Partial<BehaviorConfig>,
    defaults?: { behavior: BehaviorConfig; dimensions: DimensionConfig },
): Effect.Effect<{ behavior: BehaviorConfig; dimensions: DimensionConfig }, never, never> => {
    const defs = defaults ?? (() => ({ behavior: createBehaviorDefaults(), dimensions: createDimensionDefaults() }))();
    return pipe(
        Effect.all({
            behavior: pipe(
                decodeBehavior({ ...defs.behavior, ...beh }),
                Effect.catchAll(() => Effect.succeed(defs.behavior)),
            ),
            dimensions: pipe(
                decodeDimensions({ ...defs.dimensions, ...dim }),
                Effect.catchAll(() => Effect.succeed(defs.dimensions)),
            ),
        }),
    );
};

// Unified resolvers for consistent config resolution across components
const resolveDimensions = (
    dim?: Partial<DimensionConfig>,
    defaults?: DimensionConfig,
): Effect.Effect<DimensionConfig, never, never> => {
    const defs = defaults ?? createDimensionDefaults();
    return pipe(
        decodeDimensions({ ...defs, ...dim }),
        Effect.catchAll(() => Effect.succeed(defs)),
    );
};

const resolveFeedback = (
    fb?: Partial<FeedbackConfig>,
    defaults?: FeedbackConfig,
): Effect.Effect<FeedbackConfig, never, never> => {
    const defs = defaults ?? createFeedbackDefaults();
    return pipe(
        decodeFeedback({ ...defs, ...fb }),
        Effect.catchAll(() => Effect.succeed(defs)),
    );
};

const resolveOverlay = (
    ovr?: Partial<OverlayConfig>,
    defaults?: OverlayConfig,
): Effect.Effect<OverlayConfig, never, never> => {
    const defs = defaults ?? createOverlayDefaults();
    return pipe(
        decodeOverlay({ ...defs, ...ovr }),
        Effect.catchAll(() => Effect.succeed(defs)),
    );
};

const resolveAnimation = (
    anim?: Partial<AnimationConfig>,
    defaults?: AnimationConfig,
): Effect.Effect<AnimationConfig, never, never> => {
    const defs = defaults ?? createAnimationDefaults();
    return pipe(
        decodeAnimation({ ...defs, ...anim }),
        Effect.catchAll(() => Effect.succeed(defs)),
    );
};

// --- Export -----------------------------------------------------------------

export {
    AnimationSchema,
    B as SCHEMA_TUNING,
    BehaviorSchema,
    cls,
    compute,
    computeDimensions,
    createAnimationDefaults,
    createBehaviorDefaults,
    createDimensionDefaults,
    createFeedbackDefaults,
    createOverlayDefaults,
    createVars,
    decodeAnimation,
    decodeBehavior,
    decodeDimensions,
    decodeFeedback,
    decodeOverlay,
    DimensionSchema,
    FeedbackSchema,
    OverlaySchema,
    resolve,
    resolveAnimation,
    resolveDimensions,
    resolveFeedback,
    resolveOverlay,
    strokeWidth,
    styleVars,
};
export type {
    AnimationConfig,
    BehaviorConfig,
    ComputedDimensions,
    DimensionConfig,
    FeedbackConfig,
    FeedbackVariant,
    OverlayConfig,
    OverlayPosition,
};
