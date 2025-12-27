/**
 * Layout primitives: Box, Flex, Grid, Divider.
 * Grounding: Polymorphic components with CVA variants.
 */
import type { ComponentPropsWithoutRef, ElementType, ReactElement } from 'react';
import { createElement, forwardRef } from 'react';
import { cn } from '../core/variants.ts';
import {
    boxVariants,
    type DividerOrientation,
    dividerVariants,
    type FlexAlign,
    type FlexDirection,
    type FlexJustify,
    flexVariants,
    type GridAutoFlow,
    gridVariants,
    type SpacingSize,
} from './layout.variants.ts';

// --- [TYPES] -----------------------------------------------------------------

type PolymorphicRef<C extends ElementType> = ComponentPropsWithoutRef<C>['ref'];
type PolymorphicProps<C extends ElementType, Props = object> = Props &
    Omit<ComponentPropsWithoutRef<C>, keyof Props | 'as'> & {
        readonly as?: C;
    };
type BoxProps<C extends ElementType = 'div'> = PolymorphicProps<
    C,
    {
        readonly className?: string;
        readonly gap?: SpacingSize;
        readonly padding?: SpacingSize;
        readonly radius?: SpacingSize;
    }
>;
type FlexProps<C extends ElementType = 'div'> = PolymorphicProps<
    C,
    {
        readonly align?: FlexAlign;
        readonly className?: string;
        readonly direction?: FlexDirection;
        readonly gap?: SpacingSize;
        readonly justify?: FlexJustify;
        readonly padding?: SpacingSize;
        readonly radius?: SpacingSize;
        readonly wrap?: boolean;
    }
>;
type GridProps<C extends ElementType = 'div'> = PolymorphicProps<
    C,
    {
        readonly autoFlow?: GridAutoFlow;
        readonly className?: string;
        readonly cols?: number | string;
        readonly gap?: SpacingSize;
        readonly padding?: SpacingSize;
        readonly radius?: SpacingSize;
        readonly rows?: number | string;
    }
>;
type DividerProps = {
    readonly className?: string;
    readonly decorative?: boolean;
    readonly orientation?: DividerOrientation;
};

// --- [COMPONENTS] ------------------------------------------------------------

const Box = forwardRef(
    <C extends ElementType = 'div'>(
        { as, className, gap, padding, radius, ...props }: BoxProps<C>,
        ref: PolymorphicRef<C>,
    ) => {
        const Component = as ?? 'div';
        return createElement(Component, {
            ...props,
            className: cn(boxVariants({ gap, padding, radius }), className),
            ref,
        });
    },
) as <C extends ElementType = 'div'>(props: BoxProps<C> & { ref?: PolymorphicRef<C> }) => ReactElement | null;
const Flex = forwardRef(
    <C extends ElementType = 'div'>(
        { align, as, className, direction, gap, justify, padding, radius, wrap, ...props }: FlexProps<C>,
        ref: PolymorphicRef<C>,
    ) => {
        const Component = as ?? 'div';
        return createElement(Component, {
            ...props,
            className: cn(flexVariants({ align, direction, gap, justify, padding, radius, wrap }), className),
            ref,
        });
    },
) as <C extends ElementType = 'div'>(props: FlexProps<C> & { ref?: PolymorphicRef<C> }) => ReactElement | null;
const Grid = forwardRef(
    <C extends ElementType = 'div'>(
        { as, autoFlow, className, cols, gap, padding, radius, rows, style, ...props }: GridProps<C>,
        ref: PolymorphicRef<C>,
    ) => {
        const Component = as ?? 'div';
        const gridStyle = {
            ...(cols === undefined
                ? {}
                : { gridTemplateColumns: typeof cols === 'number' ? `repeat(${cols}, minmax(0, 1fr))` : cols }),
            ...(rows === undefined
                ? {}
                : { gridTemplateRows: typeof rows === 'number' ? `repeat(${rows}, minmax(0, 1fr))` : rows }),
            ...style,
        };
        return createElement(Component, {
            ...props,
            className: cn(gridVariants({ autoFlow, gap, padding, radius }), className),
            ref,
            style: gridStyle,
        });
    },
) as <C extends ElementType = 'div'>(props: GridProps<C> & { ref?: PolymorphicRef<C> }) => ReactElement | null;
(Box as { displayName?: string }).displayName = 'Box';
(Flex as { displayName?: string }).displayName = 'Flex';
(Grid as { displayName?: string }).displayName = 'Grid';
const Divider = forwardRef<HTMLDivElement, DividerProps>(
    ({ className, decorative = true, orientation = 'horizontal' }, ref) =>
        createElement('div', {
            'aria-hidden': decorative,
            className: cn(dividerVariants({ orientation }), className),
            'data-orientation': orientation,
            ref,
            role: 'separator',
        }),
);
Divider.displayName = 'Divider';

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/useComponentExportOnlyModules: Polymorphic components with type assertions
export { Box, Divider, Flex, Grid };
// biome-ignore lint/style/useComponentExportOnlyModules: Type exports for polymorphic components
export type { BoxProps, DividerProps, FlexProps, GridProps };
