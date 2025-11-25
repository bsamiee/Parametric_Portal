import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { clsx } from 'clsx';
import { Effect, pipe } from 'effect';
import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode, RefObject } from 'react';
import { createElement, forwardRef, useRef } from 'react';
import { twMerge } from 'tailwind-merge';
import type { BehaviorConfig, ComputedDimensions, DimensionConfig } from './schema.ts';
import {
    computeDimensions,
    createBehaviorDefaults,
    createDimensionDefaults,
    decodeBehavior,
    decodeDimensions,
    B as SB,
    styleVars,
} from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type ElementTag = 'article' | 'aside' | 'div' | 'footer' | 'header' | 'main' | 'nav' | 'section' | 'span';
type FlexDirection = 'column' | 'column-reverse' | 'row' | 'row-reverse';
type FlexAlign = 'baseline' | 'center' | 'end' | 'start' | 'stretch';
type FlexJustify = 'around' | 'between' | 'center' | 'end' | 'evenly' | 'start';
type ElementInput<T extends ElementTag> = {
    readonly align?: FlexAlign;
    readonly asChild?: boolean;
    readonly behavior?: Partial<BehaviorConfig>;
    readonly className?: string;
    readonly dimensions?: Partial<DimensionConfig>;
    readonly direction?: FlexDirection;
    readonly gap?: boolean;
    readonly justify?: FlexJustify;
    readonly padding?: boolean;
    readonly radius?: boolean;
    readonly tag: T;
    readonly wrap?: boolean;
};

// --- Constants (Unified Base) -----------------------------------------------

const B = Object.freeze({
    algo: SB.algo,
    align: {
        baseline: 'items-baseline',
        center: 'items-center',
        end: 'items-end',
        start: 'items-start',
        stretch: 'items-stretch',
    } as { readonly [K in FlexAlign]: string },
    defaults: { behavior: createBehaviorDefaults(), dimensions: createDimensionDefaults() },
    direction: {
        column: 'flex-col',
        'column-reverse': 'flex-col-reverse',
        row: 'flex-row',
        'row-reverse': 'flex-row-reverse',
    } as { readonly [K in FlexDirection]: string },
    justify: {
        around: 'justify-around',
        between: 'justify-between',
        center: 'justify-center',
        end: 'justify-end',
        evenly: 'justify-evenly',
        start: 'justify-start',
    } as { readonly [K in FlexJustify]: string },
    wrap: { false: 'flex-nowrap', true: 'flex-wrap' },
} as const);

// --- Pure Utility Functions -------------------------------------------------

const cls = (...inputs: ReadonlyArray<string | undefined>): string => twMerge(clsx(inputs));

const vars = (d: ComputedDimensions): Record<string, string> => styleVars(d, 'element');

const baseVariants = cva('', {
    defaultVariants: { gap: false, padding: false, radius: false },
    variants: {
        gap: { false: '', true: 'gap-[var(--element-gap)]' },
        padding: { false: '', true: 'px-[var(--element-padding-x)] py-[var(--element-padding-y)]' },
        radius: { false: '', true: 'rounded-[var(--element-radius)]' },
    },
});

const flexVariants = cva('flex', {
    defaultVariants: { align: 'stretch', direction: 'row', justify: 'start', wrap: false },
    variants: { align: B.align, direction: B.direction, justify: B.justify, wrap: B.wrap },
});

// --- Effect Pipelines -------------------------------------------------------

const resolve = (
    dim?: Partial<DimensionConfig>,
    beh?: Partial<BehaviorConfig>,
): Effect.Effect<{ behavior: BehaviorConfig; dimensions: DimensionConfig }, never, never> =>
    pipe(
        Effect.all({
            behavior: pipe(
                decodeBehavior({ ...B.defaults.behavior, ...beh }),
                Effect.catchAll(() => Effect.succeed(B.defaults.behavior)),
            ),
            dimensions: pipe(
                decodeDimensions({ ...B.defaults.dimensions, ...dim }),
                Effect.catchAll(() => Effect.succeed(B.defaults.dimensions)),
            ),
        }),
    );

// --- Component Factory ------------------------------------------------------

const createElementComponent = <T extends ElementTag>(i: ElementInput<T>) => {
    const { behavior: beh, dimensions: dims } = Effect.runSync(resolve(i.dimensions, i.behavior));
    const cssVars = vars(Effect.runSync(computeDimensions(dims)));
    const baseCls = baseVariants({ gap: i.gap ?? false, padding: i.padding ?? false, radius: i.radius ?? false });
    const flexCls =
        i.direction !== undefined
            ? flexVariants({
                  align: i.align ?? 'stretch',
                  direction: i.direction,
                  justify: i.justify ?? 'start',
                  wrap: i.wrap ?? false,
              })
            : '';
    const Component = forwardRef(
        (
            props: HTMLAttributes<HTMLElement> & { readonly asChild?: boolean; readonly children?: ReactNode },
            fRef: ForwardedRef<HTMLElement>,
        ) => {
            const { asChild, children, className, style, ...rest } = props;
            const internalRef = useRef<HTMLElement>(null);
            const ref = (fRef ?? internalRef) as RefObject<HTMLElement>;
            const elementProps = {
                ...rest,
                'aria-busy': beh.loading || undefined,
                'aria-disabled': beh.disabled || undefined,
                className: cls(baseCls, flexCls, i.className, className),
                ref,
                style: { ...cssVars, ...style } as CSSProperties,
                tabIndex: beh.focusable && beh.interactive && !beh.disabled ? 0 : undefined,
            };
            return (asChild ?? i.asChild)
                ? createElement(Slot, elementProps, children)
                : createElement(i.tag, elementProps, children);
        },
    );
    Component.displayName = `Element(${i.tag})`;
    return Component;
};

// --- Factory ----------------------------------------------------------------

const createElements = (tuning?: {
    defaults?: { behavior?: Partial<BehaviorConfig>; dimensions?: Partial<DimensionConfig> };
}) => {
    const defs = {
        behavior: { ...B.defaults.behavior, ...tuning?.defaults?.behavior },
        dimensions: { ...B.defaults.dimensions, ...tuning?.defaults?.dimensions },
    };
    return Object.freeze({
        Box: createElementComponent({ dimensions: defs.dimensions, tag: 'div' }),
        create: <T extends ElementTag>(i: ElementInput<T>) =>
            createElementComponent({
                ...i,
                behavior: { ...defs.behavior, ...i.behavior },
                dimensions: { ...defs.dimensions, ...i.dimensions },
            }),
        Flex: createElementComponent({
            align: 'stretch',
            dimensions: defs.dimensions,
            direction: 'row',
            gap: true,
            justify: 'start',
            tag: 'div',
        }),
        Stack: createElementComponent({
            align: 'stretch',
            dimensions: defs.dimensions,
            direction: 'column',
            gap: true,
            justify: 'start',
            tag: 'div',
        }),
    });
};

// --- Export -----------------------------------------------------------------

export { B as ELEMENT_TUNING, createElements };
