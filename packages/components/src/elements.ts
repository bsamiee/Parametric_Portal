import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { clsx } from 'clsx';
import { Effect, pipe } from 'effect';
import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef } from 'react';
import { twMerge } from 'tailwind-merge';
import type { BehaviorConfig, ComputedDimensions, DimensionConfig } from './schema.ts';
import {
    ALGORITHM_CONFIG,
    computeDimensions,
    createBehaviorDefaults,
    createDimensionDefaults,
    decodeBehavior,
    decodeDimensions,
} from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type ElementTag = 'article' | 'aside' | 'div' | 'footer' | 'header' | 'main' | 'nav' | 'section' | 'span';
type FlexDirection = 'column' | 'column-reverse' | 'row' | 'row-reverse';
type FlexAlign = 'baseline' | 'center' | 'end' | 'start' | 'stretch';
type FlexJustify = 'around' | 'between' | 'center' | 'end' | 'evenly' | 'start';

type ElementTuning = {
    readonly algorithms: typeof ALGORITHM_CONFIG;
    readonly defaults: {
        readonly behavior: BehaviorConfig;
        readonly dimensions: DimensionConfig;
    };
};

type ElementFactoryInput<T extends ElementTag> = {
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

type ElementComponent<_T extends ElementTag> = ReturnType<
    typeof forwardRef<
        HTMLElement,
        HTMLAttributes<HTMLElement> & {
            readonly asChild?: boolean;
            readonly children?: ReactNode;
        }
    >
>;

type ElementFactory = {
    readonly Box: ElementComponent<'div'>;
    readonly create: <T extends ElementTag>(input: ElementFactoryInput<T>) => ElementComponent<T>;
    readonly Flex: ElementComponent<'div'>;
    readonly Stack: ElementComponent<'div'>;
};

// --- Constants (Unified Factory -> Frozen) ----------------------------------

const { elementTuning, flexVariants } = Effect.runSync(
    Effect.all({
        elementTuning: Effect.succeed({
            algorithms: ALGORITHM_CONFIG,
            defaults: {
                behavior: createBehaviorDefaults(),
                dimensions: createDimensionDefaults(),
            },
        } as const),
        flexVariants: Effect.succeed({
            align: {
                baseline: 'items-baseline',
                center: 'items-center',
                end: 'items-end',
                start: 'items-start',
                stretch: 'items-stretch',
            },
            direction: {
                column: 'flex-col',
                'column-reverse': 'flex-col-reverse',
                row: 'flex-row',
                'row-reverse': 'flex-row-reverse',
            },
            justify: {
                around: 'justify-around',
                between: 'justify-between',
                center: 'justify-center',
                end: 'justify-end',
                evenly: 'justify-evenly',
                start: 'justify-start',
            },
            wrap: {
                false: 'flex-nowrap',
                true: 'flex-wrap',
            },
        } as const),
    }),
);

const ELEMENT_TUNING: ElementTuning = Object.freeze(elementTuning);
const FLEX_VARIANTS = Object.freeze(flexVariants);

// --- Pure Utility Functions -------------------------------------------------

const mergeClasses = (...inputs: ReadonlyArray<string | undefined>): string => twMerge(clsx(inputs));

const computeStyleVars = (dims: ComputedDimensions): Record<string, string> => ({
    '--element-font-size': dims.fontSize,
    '--element-gap': dims.gap,
    '--element-height': dims.height,
    '--element-icon-size': dims.iconSize,
    '--element-padding-x': dims.paddingX,
    '--element-padding-y': dims.paddingY,
    '--element-radius': dims.radius,
});

const createBaseVariants = () =>
    cva('', {
        compoundVariants: [],
        defaultVariants: {
            gap: false,
            padding: false,
            radius: false,
        },
        variants: {
            gap: {
                false: '',
                true: 'gap-[var(--element-gap)]',
            },
            padding: {
                false: '',
                true: 'px-[var(--element-padding-x)] py-[var(--element-padding-y)]',
            },
            radius: {
                false: '',
                true: 'rounded-[var(--element-radius)]',
            },
        },
    });

const createFlexVariants = () =>
    cva('flex', {
        compoundVariants: [],
        defaultVariants: {
            align: 'stretch',
            direction: 'row',
            justify: 'start',
            wrap: false,
        },
        variants: {
            align: FLEX_VARIANTS.align,
            direction: FLEX_VARIANTS.direction,
            justify: FLEX_VARIANTS.justify,
            wrap: FLEX_VARIANTS.wrap,
        },
    });

// --- Effect Pipelines & Builders --------------------------------------------

const resolveConfig = (
    dimInput: Partial<DimensionConfig> | undefined,
    behInput: Partial<BehaviorConfig> | undefined,
): Effect.Effect<{ behavior: BehaviorConfig; dimensions: DimensionConfig }, never, never> =>
    pipe(
        Effect.all({
            behavior: pipe(
                decodeBehavior({ ...ELEMENT_TUNING.defaults.behavior, ...behInput }),
                Effect.catchAll(() => Effect.succeed(ELEMENT_TUNING.defaults.behavior)),
            ),
            dimensions: pipe(
                decodeDimensions({ ...ELEMENT_TUNING.defaults.dimensions, ...dimInput }),
                Effect.catchAll(() => Effect.succeed(ELEMENT_TUNING.defaults.dimensions)),
            ),
        }),
    );

const createElementComponent = <T extends ElementTag>(factoryInput: ElementFactoryInput<T>): ElementComponent<T> => {
    const baseVariants = createBaseVariants();
    const flexVars = createFlexVariants();

    const resolved = Effect.runSync(resolveConfig(factoryInput.dimensions, factoryInput.behavior));
    const dims = Effect.runSync(computeDimensions(resolved.dimensions));
    const staticStyleVars = computeStyleVars(dims);
    const staticBehavior = resolved.behavior;

    const staticBaseClasses = baseVariants({
        gap: factoryInput.gap ?? false,
        padding: factoryInput.padding ?? false,
        radius: factoryInput.radius ?? false,
    });

    const staticFlexClasses =
        factoryInput.direction !== undefined
            ? flexVars({
                  align: factoryInput.align ?? 'stretch',
                  direction: factoryInput.direction,
                  justify: factoryInput.justify ?? 'start',
                  wrap: factoryInput.wrap ?? false,
              })
            : '';

    const Component = forwardRef(
        (
            props: HTMLAttributes<HTMLElement> & { readonly asChild?: boolean; readonly children?: ReactNode },
            ref: ForwardedRef<HTMLElement>,
        ) => {
            const { asChild, children, className, style, ...rest } = props;
            const useSlot = asChild ?? factoryInput.asChild ?? false;

            const finalClassName = mergeClasses(
                staticBaseClasses,
                staticFlexClasses,
                factoryInput.className,
                className,
            );
            const finalStyle = { ...staticStyleVars, ...style } as CSSProperties;

            const elementProps = {
                ...rest,
                'aria-busy': staticBehavior.loading ? true : undefined,
                'aria-disabled': staticBehavior.disabled ? true : undefined,
                className: finalClassName,
                ref,
                style: finalStyle,
                tabIndex:
                    staticBehavior.focusable && staticBehavior.interactive && !staticBehavior.disabled ? 0 : undefined,
            };

            return useSlot
                ? createElement(Slot, elementProps, children)
                : createElement(factoryInput.tag, elementProps, children);
        },
    );

    Component.displayName = `Element(${factoryInput.tag})`;
    return Component as ElementComponent<T>;
};

const createElements = (tuning?: Partial<ElementTuning>): ElementFactory => {
    const mergedTuning = {
        algorithms: tuning?.algorithms ?? ELEMENT_TUNING.algorithms,
        defaults: {
            behavior: { ...ELEMENT_TUNING.defaults.behavior, ...tuning?.defaults?.behavior },
            dimensions: { ...ELEMENT_TUNING.defaults.dimensions, ...tuning?.defaults?.dimensions },
        },
    };

    return Object.freeze({
        Box: createElementComponent({
            dimensions: mergedTuning.defaults.dimensions,
            tag: 'div',
        }),
        create: <T extends ElementTag>(input: ElementFactoryInput<T>) =>
            createElementComponent({
                ...input,
                behavior: { ...mergedTuning.defaults.behavior, ...input.behavior },
                dimensions: { ...mergedTuning.defaults.dimensions, ...input.dimensions },
            }),
        Flex: createElementComponent({
            align: 'stretch',
            dimensions: mergedTuning.defaults.dimensions,
            direction: 'row',
            gap: true,
            justify: 'start',
            tag: 'div',
        }),
        Stack: createElementComponent({
            align: 'stretch',
            dimensions: mergedTuning.defaults.dimensions,
            direction: 'column',
            gap: true,
            justify: 'start',
            tag: 'div',
        }),
    });
};

// --- Export -----------------------------------------------------------------

export { createElements, ELEMENT_TUNING };
