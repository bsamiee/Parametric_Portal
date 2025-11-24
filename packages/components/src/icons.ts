import { cva } from 'class-variance-authority';
import { clsx } from 'clsx';
import { Effect, pipe } from 'effect';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { icons } from 'lucide-react';
import type { CSSProperties, ForwardedRef, SVGAttributes } from 'react';
import { createElement, forwardRef, memo } from 'react';
import { twMerge } from 'tailwind-merge';
import type { ComputedDimensions, DimensionConfig } from './schema.ts';
import { ALGORITHM_CONFIG, computeDimensions, createDimensionDefaults, decodeDimensions } from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type IconName = keyof typeof icons;

type IconTuning = {
    readonly algorithms: typeof ALGORITHM_CONFIG;
    readonly defaults: {
        readonly dimensions: DimensionConfig;
        readonly strokeWidth: number;
    };
    readonly strokeScaling: {
        readonly base: number;
        readonly factor: number;
    };
};

type IconFactoryInput = {
    readonly className?: string;
    readonly dimensions?: Partial<DimensionConfig>;
    readonly name: IconName;
    readonly strokeWidth?: number;
};

type IconProps = SVGAttributes<SVGElement> & {
    readonly dimensions?: Partial<DimensionConfig>;
    readonly strokeWidth?: number;
};

type IconComponent = ReturnType<typeof forwardRef<SVGSVGElement, IconProps>>;

type IconFactory = {
    readonly create: (input: IconFactoryInput) => IconComponent;
    readonly get: (name: IconName) => LucideIcon;
    readonly Icon: (props: IconProps & { readonly name: IconName }) => ReturnType<typeof createElement>;
    readonly names: ReadonlyArray<IconName>;
};

// --- Constants (Unified Factory -> Frozen) ----------------------------------

const { iconTuning, strokeConfig } = Effect.runSync(
    Effect.all({
        iconTuning: Effect.succeed({
            algorithms: ALGORITHM_CONFIG,
            defaults: {
                dimensions: createDimensionDefaults(),
                strokeWidth: 2,
            },
            strokeScaling: {
                base: 2.5,
                factor: 0.15,
            },
        } as const),
        strokeConfig: Effect.succeed({
            max: 3,
            min: 1,
        } as const),
    }),
);

const ICON_TUNING: IconTuning = Object.freeze(iconTuning);
const STROKE_CONFIG = Object.freeze(strokeConfig);
const ICON_NAMES: ReadonlyArray<IconName> = Object.freeze(Object.keys(icons) as IconName[]);

// --- Pure Utility Functions -------------------------------------------------

const mergeClasses = (...inputs: ReadonlyArray<string | undefined>): string => twMerge(clsx(inputs));

const computeStyleVars = (dims: ComputedDimensions): Record<string, string> => ({
    '--icon-size': dims.iconSize,
});

const computeStrokeWidth = (scale: number): number =>
    Math.max(
        STROKE_CONFIG.min,
        Math.min(STROKE_CONFIG.max, ICON_TUNING.strokeScaling.base - scale * ICON_TUNING.strokeScaling.factor),
    );

const createIconVariants = () =>
    cva('inline-block flex-shrink-0', {
        compoundVariants: [],
        defaultVariants: {},
        variants: {},
    });

const getIconByName = (name: IconName): LucideIcon => icons[name];

// --- Effect Pipelines & Builders --------------------------------------------

const resolveConfig = (dimInput: Partial<DimensionConfig> | undefined): Effect.Effect<DimensionConfig, never, never> =>
    pipe(
        decodeDimensions({ ...ICON_TUNING.defaults.dimensions, ...dimInput }),
        Effect.catchAll(() => Effect.succeed(ICON_TUNING.defaults.dimensions)),
    );

const createIconComponent = (factoryInput: IconFactoryInput): IconComponent => {
    const iconVariants = createIconVariants();
    const LucideIconComponent = getIconByName(factoryInput.name);

    const Component = forwardRef((props: IconProps, ref: ForwardedRef<SVGSVGElement>) => {
        const { className, dimensions: propDimensions, strokeWidth: propStrokeWidth, style, ...svgProps } = props;

        const dimensions = Effect.runSync(resolveConfig({ ...factoryInput.dimensions, ...propDimensions }));

        const computed = Effect.runSync(computeDimensions(dimensions));
        const styleVars = computeStyleVars(computed);

        const calculatedStroke = propStrokeWidth ?? factoryInput.strokeWidth ?? computeStrokeWidth(dimensions.scale);

        const baseClasses = iconVariants({});
        const finalClassName = mergeClasses(baseClasses, factoryInput.className, className);

        const iconProps: LucideProps = {
            ...svgProps,
            'aria-hidden': svgProps['aria-label'] === undefined,
            className: finalClassName,
            height: 'var(--icon-size)',
            ref,
            strokeWidth: calculatedStroke,
            style: { ...styleVars, ...style } as CSSProperties,
            width: 'var(--icon-size)',
        };

        return createElement(LucideIconComponent, iconProps);
    });

    Component.displayName = `Icon(${factoryInput.name})`;
    return memo(Component);
};

const createDynamicIcon = (props: IconProps & { readonly name: IconName }): ReturnType<typeof createElement> => {
    const { className, dimensions: propDimensions, name, strokeWidth: propStrokeWidth, style, ...svgProps } = props;

    const LucideIconComponent = getIconByName(name);

    const dimensions = Effect.runSync(resolveConfig(propDimensions));
    const computed = Effect.runSync(computeDimensions(dimensions));
    const styleVars = computeStyleVars(computed);

    const calculatedStroke = propStrokeWidth ?? computeStrokeWidth(dimensions.scale);

    const iconVariants = createIconVariants();
    const baseClasses = iconVariants({});
    const finalClassName = mergeClasses(baseClasses, className);

    const iconProps: LucideProps = {
        ...svgProps,
        'aria-hidden': svgProps['aria-label'] === undefined,
        className: finalClassName,
        height: 'var(--icon-size)',
        strokeWidth: calculatedStroke,
        style: { ...styleVars, ...style } as CSSProperties,
        width: 'var(--icon-size)',
    };

    return createElement(LucideIconComponent, iconProps);
};

const createIcons = (tuning?: Partial<IconTuning>): IconFactory => {
    const mergedTuning = {
        algorithms: tuning?.algorithms ?? ICON_TUNING.algorithms,
        defaults: {
            dimensions: { ...ICON_TUNING.defaults.dimensions, ...tuning?.defaults?.dimensions },
            strokeWidth: tuning?.defaults?.strokeWidth ?? ICON_TUNING.defaults.strokeWidth,
        },
        strokeScaling: { ...ICON_TUNING.strokeScaling, ...tuning?.strokeScaling },
    };

    return Object.freeze({
        create: (input: IconFactoryInput) =>
            createIconComponent({
                ...input,
                dimensions: { ...mergedTuning.defaults.dimensions, ...input.dimensions },
                strokeWidth: input.strokeWidth ?? mergedTuning.defaults.strokeWidth,
            }),
        get: getIconByName,
        Icon: createDynamicIcon,
        names: ICON_NAMES,
    });
};

// --- Export -----------------------------------------------------------------

export { createIcons, ICON_TUNING };
