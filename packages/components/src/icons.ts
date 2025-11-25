import { cva } from 'class-variance-authority';
import { clsx } from 'clsx';
import { Effect, pipe } from 'effect';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { icons } from 'lucide-react';
import type { CSSProperties, ForwardedRef, SVGAttributes } from 'react';
import { createElement, forwardRef, memo, useMemo } from 'react';
import { twMerge } from 'tailwind-merge';
import type { ComputedDimensions, DimensionConfig } from './schema.ts';
import {
    computeDimensions,
    createDimensionDefaults,
    decodeDimensions,
    B as SB,
    strokeWidth,
    styleVars,
} from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type IconName = keyof typeof icons;
type IconProps = SVGAttributes<SVGElement> & {
    readonly dimensions?: Partial<DimensionConfig>;
    readonly strokeWidth?: number;
};
type IconInput = {
    readonly className?: string;
    readonly dimensions?: Partial<DimensionConfig>;
    readonly name: IconName;
    readonly strokeWidth?: number;
};
type DynamicIconProps = IconProps & { readonly name: IconName };

// --- Constants (Unified Base) -----------------------------------------------

const B = Object.freeze({
    algo: SB.algo,
    defaults: { dimensions: createDimensionDefaults(), strokeWidth: 2 },
    names: Object.freeze(Object.keys(icons) as ReadonlyArray<IconName>),
    stroke: SB.stroke,
} as const);

// --- Pure Utility Functions -------------------------------------------------

const cls = (...inputs: ReadonlyArray<string | undefined>): string => twMerge(clsx(inputs));

const vars = (d: ComputedDimensions): Record<string, string> => ({
    '--icon-size': styleVars(d, 'icon')['--icon-icon-size'] ?? d.iconSize,
});

const iconVariants = cva('inline-block flex-shrink-0', { defaultVariants: {}, variants: {} });

const getIcon = (name: IconName): LucideIcon => icons[name];

// --- Effect Pipelines -------------------------------------------------------

const resolve = (dim?: Partial<DimensionConfig>): Effect.Effect<DimensionConfig, never, never> =>
    pipe(
        decodeDimensions({ ...B.defaults.dimensions, ...dim }),
        Effect.catchAll(() => Effect.succeed(B.defaults.dimensions)),
    );

// --- Component Factory ------------------------------------------------------

const createIconComponent = (i: IconInput) => {
    const LucideIcon = getIcon(i.name);
    const factoryDims = i.dimensions;
    const factoryStroke = i.strokeWidth;
    const Component = forwardRef((props: IconProps, ref: ForwardedRef<SVGSVGElement>) => {
        const { className, dimensions: pd, strokeWidth: ps, style, ...svgProps } = props;
        const { calculatedStroke, cssVars } = useMemo(() => {
            const dims = Effect.runSync(resolve({ ...factoryDims, ...pd }));
            const computed = Effect.runSync(computeDimensions(dims));
            const stroke = ps ?? factoryStroke ?? strokeWidth(dims.scale);
            return { calculatedStroke: stroke, cssVars: vars(computed) };
        }, [pd, ps]);
        const iconProps: LucideProps = {
            ...svgProps,
            'aria-hidden': svgProps['aria-label'] === undefined,
            className: cls(iconVariants({}), i.className, className),
            height: 'var(--icon-size)',
            ref,
            strokeWidth: calculatedStroke,
            style: { ...cssVars, ...style } as CSSProperties,
            width: 'var(--icon-size)',
        };
        return createElement(LucideIcon, iconProps);
    });
    Component.displayName = `Icon(${i.name})`;
    return memo(Component);
};

const DynamicIcon = forwardRef((props: DynamicIconProps, ref: ForwardedRef<SVGSVGElement>) => {
    const { className, dimensions: pd, name, strokeWidth: ps, style, ...svgProps } = props;
    const LucideIcon = getIcon(name);
    const { calculatedStroke, cssVars } = useMemo(() => {
        const dims = Effect.runSync(resolve(pd));
        const computed = Effect.runSync(computeDimensions(dims));
        const stroke = ps ?? strokeWidth(dims.scale);
        return { calculatedStroke: stroke, cssVars: vars(computed) };
    }, [pd, ps]);
    const iconProps: LucideProps = {
        ...svgProps,
        'aria-hidden': svgProps['aria-label'] === undefined,
        className: cls(iconVariants({}), className),
        height: 'var(--icon-size)',
        ref,
        strokeWidth: calculatedStroke,
        style: { ...cssVars, ...style } as CSSProperties,
        width: 'var(--icon-size)',
    };
    return createElement(LucideIcon, iconProps);
});

DynamicIcon.displayName = 'DynamicIcon';

// --- Factory ----------------------------------------------------------------

const createIcons = (tuning?: { defaults?: { dimensions?: Partial<DimensionConfig>; strokeWidth?: number } }) => {
    const defs = {
        dimensions: { ...B.defaults.dimensions, ...tuning?.defaults?.dimensions },
        strokeWidth: tuning?.defaults?.strokeWidth ?? B.defaults.strokeWidth,
    };
    return Object.freeze({
        create: (i: IconInput) =>
            createIconComponent({
                ...i,
                dimensions: { ...defs.dimensions, ...i.dimensions },
                strokeWidth: i.strokeWidth ?? defs.strokeWidth,
            }),
        get: getIcon,
        Icon: DynamicIcon,
        names: B.names,
    });
};

// --- Export -----------------------------------------------------------------

export { B as ICON_TUNING, createIcons };
