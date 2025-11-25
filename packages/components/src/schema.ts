import { Schema as S } from '@effect/schema';
import { clsx } from 'clsx';
import { Effect, pipe } from 'effect';
import type { CSSProperties } from 'react';
import { twMerge } from 'tailwind-merge';

// --- Schema Definitions -----------------------------------------------------

const PositiveSchema = pipe(S.Number, S.positive());
const NonNegativeIntSchema = pipe(S.Number, S.int(), S.nonNegative());

const ScaleSchema = S.Struct({
    // biome-ignore lint/style/useNamingConvention: Effect Schema discriminant convention
    _tag: S.optionalWith(S.Literal('scale'), { default: () => 'scale' as const }),
    baseUnit: S.optionalWith(pipe(PositiveSchema, S.brand('Unit')), { default: () => 0.25 as never }),
    density: S.optionalWith(pipe(S.Number, S.between(0.5, 2), S.brand('Density')), { default: () => 1 as never }),
    radiusMultiplier: S.optionalWith(pipe(S.Number, S.between(0, 1), S.brand('Radius')), {
        default: () => 0.25 as never,
    }),
    scale: S.optionalWith(pipe(S.Number, S.between(1, 10), S.brand('Scale')), { default: () => 5 as never }),
});

const BehaviorSchema = S.Struct({
    // biome-ignore lint/style/useNamingConvention: Effect Schema discriminant convention
    _tag: S.optionalWith(S.Literal('behavior'), { default: () => 'behavior' as const }),
    asChild: S.optionalWith(S.Boolean, { default: () => false }),
    disabled: S.optionalWith(S.Boolean, { default: () => false }),
    focusable: S.optionalWith(S.Boolean, { default: () => true }),
    interactive: S.optionalWith(S.Boolean, { default: () => true }),
    loading: S.optionalWith(S.Boolean, { default: () => false }),
    readonly: S.optionalWith(S.Boolean, { default: () => false }),
});

const OverlaySchema = S.Struct({
    // biome-ignore lint/style/useNamingConvention: Effect Schema discriminant convention
    _tag: S.optionalWith(S.Literal('overlay'), { default: () => 'overlay' as const }),
    backdrop: S.optionalWith(S.Boolean, { default: () => true }),
    closeOnEscape: S.optionalWith(S.Boolean, { default: () => true }),
    closeOnOutsideClick: S.optionalWith(S.Boolean, { default: () => true }),
    modal: S.optionalWith(S.Boolean, { default: () => true }),
    position: S.optionalWith(S.Union(S.Literal('top'), S.Literal('bottom'), S.Literal('left'), S.Literal('right')), {
        default: () => 'bottom' as const,
    }),
    trapFocus: S.optionalWith(S.Boolean, { default: () => true }),
    zIndex: S.optionalWith(pipe(S.Number, S.int(), S.between(0, 9999)), { default: () => 50 as never }),
});

const FeedbackSchema = S.Struct({
    // biome-ignore lint/style/useNamingConvention: Effect Schema discriminant convention
    _tag: S.optionalWith(S.Literal('feedback'), { default: () => 'feedback' as const }),
    autoDismiss: S.optionalWith(S.Boolean, { default: () => true }),
    dismissible: S.optionalWith(S.Boolean, { default: () => true }),
    duration: S.optionalWith(PositiveSchema, { default: () => 5000 as never }),
});

const AnimationSchema = S.Struct({
    // biome-ignore lint/style/useNamingConvention: Effect Schema discriminant convention
    _tag: S.optionalWith(S.Literal('animation'), { default: () => 'animation' as const }),
    delay: S.optionalWith(NonNegativeIntSchema, { default: () => 0 as never }),
    duration: S.optionalWith(NonNegativeIntSchema, { default: () => 200 as never }),
    easing: S.optionalWith(S.String, { default: () => 'ease-out' as never }),
    enabled: S.optionalWith(S.Boolean, { default: () => true }),
});

// --- Type Definitions -------------------------------------------------------

type Scale = S.Schema.Type<typeof ScaleSchema>;
type Behavior = S.Schema.Type<typeof BehaviorSchema>;
type Overlay = S.Schema.Type<typeof OverlaySchema>;
type Feedback = S.Schema.Type<typeof FeedbackSchema>;
type Animation = S.Schema.Type<typeof AnimationSchema>;
type Computed = {
    readonly [K in 'fontSize' | 'gap' | 'height' | 'iconSize' | 'paddingX' | 'paddingY' | 'radius']: string;
};

// --- Input Types (match Schema.Encoded to handle optionals correctly) -------

type ScaleInput = {
    readonly baseUnit?: number;
    readonly density?: number;
    readonly radiusMultiplier?: number;
    readonly scale?: number;
};
type BehaviorInput = {
    readonly asChild?: boolean;
    readonly disabled?: boolean;
    readonly focusable?: boolean;
    readonly interactive?: boolean;
    readonly loading?: boolean;
    readonly readonly?: boolean;
};
type OverlayInput = {
    readonly backdrop?: boolean;
    readonly closeOnEscape?: boolean;
    readonly closeOnOutsideClick?: boolean;
    readonly modal?: boolean;
    readonly position?: 'top' | 'bottom' | 'left' | 'right';
    readonly trapFocus?: boolean;
    readonly zIndex?: number;
};
type FeedbackInput = { readonly autoDismiss?: boolean; readonly dismissible?: boolean; readonly duration?: number };
type AnimationInput = {
    readonly delay?: number;
    readonly duration?: number;
    readonly easing?: string;
    readonly enabled?: boolean;
};

// --- Constants (Algorithmic Only) -------------------------------------------

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
    stroke: { base: 2.5, factor: 0.15, max: 3, min: 1 },
} as const);

// --- Compute Dispatch Table -------------------------------------------------

const compute: { readonly [K in keyof Computed]: (c: Scale) => string } = {
    fontSize: (c) => `${(B.algo.fontBase + c.scale * B.algo.fontStep).toFixed(3)}rem`,
    gap: (c) => `${(c.scale * B.algo.gapMul * c.density * c.baseUnit).toFixed(3)}rem`,
    height: (c) => `${((B.algo.hBase + c.scale * B.algo.hStep) * c.density * c.baseUnit * 4).toFixed(3)}rem`,
    iconSize: (c) =>
        `${((B.algo.fontBase + c.scale * B.algo.fontStep) * B.algo.iconRatio * c.baseUnit * 4).toFixed(3)}rem`,
    paddingX: (c) => `${(c.scale * B.algo.pxMul * c.density * c.baseUnit).toFixed(3)}rem`,
    paddingY: (c) => `${(c.scale * B.algo.pyMul * c.density * c.baseUnit).toFixed(3)}rem`,
    radius: (c) =>
        c.radiusMultiplier >= 1
            ? `${B.algo.rMax}px`
            : `${(c.scale * c.radiusMultiplier * 2 * c.baseUnit).toFixed(3)}rem`,
};

// --- Pure Utility Functions -------------------------------------------------

const cls = (...inputs: ReadonlyArray<string | undefined>): string => twMerge(clsx(inputs));
const strokeWidth = (scale: number): number =>
    Math.max(B.stroke.min, Math.min(B.stroke.max, B.stroke.base - scale * B.stroke.factor));
const cssVars = (d: Computed, prefix: string): Record<string, string> =>
    Object.fromEntries(
        Object.entries(d).map(([k, v]) => [`--${prefix}-${k.replace(/([A-Z])/g, '-$1').toLowerCase()}`, v]),
    );
const computeScale = (s: Scale): Computed =>
    Object.fromEntries(
        (Object.keys(compute) as ReadonlyArray<keyof Computed>).map((k) => [k, compute[k](s)]),
    ) as Computed;

// --- Generic Resolver (DRY pattern for all schemas) -------------------------

const resolve =
    <A, I>(schema: S.Schema<A, I>) =>
    (input?: I): A =>
        Effect.runSync(
            pipe(
                Effect.try(() => S.decodeUnknownSync(schema)(input ?? {})),
                Effect.catchAll(() => Effect.succeed(S.decodeUnknownSync(schema)({}))),
                Effect.orDie,
            ),
        );

// --- Typed Resolvers (generated from generic) -------------------------------
// Note: We let TypeScript infer types from schemas to work with exactOptionalPropertyTypes

const resolveScale = (input?: ScaleInput) => resolve(ScaleSchema)(input);
const resolveBehavior = (input?: BehaviorInput) => resolve(BehaviorSchema)(input);
const resolveOverlay = (input?: OverlayInput) => resolve(OverlaySchema)(input);
const resolveFeedback = (input?: FeedbackInput) => resolve(FeedbackSchema)(input);
const resolveAnimation = (input?: AnimationInput) => resolve(AnimationSchema)(input);

// --- Generic Utilities ------------------------------------------------------

const merge = <T extends Record<string, unknown>>(a?: T, b?: T): T | undefined =>
    a || b ? ({ ...a, ...b } as T) : undefined;
const animStyle = (a: Animation): CSSProperties =>
    a.enabled
        ? { transition: `all ${a.duration}ms ${a.easing}`, transitionDelay: a.delay ? `${a.delay}ms` : undefined }
        : {};

// --- Export -----------------------------------------------------------------

export {
    animStyle,
    AnimationSchema,
    B as TUNING,
    BehaviorSchema,
    cls,
    compute,
    computeScale,
    cssVars,
    FeedbackSchema,
    merge,
    OverlaySchema,
    resolveAnimation,
    resolveBehavior,
    resolveFeedback,
    resolveOverlay,
    resolveScale,
    ScaleSchema,
    strokeWidth,
};
export type {
    Animation,
    AnimationInput,
    Behavior,
    BehaviorInput,
    Computed,
    Feedback,
    FeedbackInput,
    Overlay,
    OverlayInput,
    Scale,
    ScaleInput,
};
