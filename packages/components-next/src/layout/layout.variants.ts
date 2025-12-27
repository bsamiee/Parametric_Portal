/**
 * Layout component CVA variants with composable spacing.
 * Grounding: Single file for all layout variants - box, flex, grid, divider.
 */
import { cva } from 'class-variance-authority';

// --- [TYPES] -----------------------------------------------------------------

type SpacingSize = 'sm' | 'md' | 'lg' | boolean;
type FlexDirection = 'row' | 'col' | 'row-reverse' | 'col-reverse';
type FlexAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
type FlexJustify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
type GridAutoFlow = 'row' | 'col' | 'dense' | 'row-dense' | 'col-dense';
type DividerOrientation = 'horizontal' | 'vertical';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    gap: {
        false: '',
        lg: 'gap-6',
        md: 'gap-4',
        sm: 'gap-2',
        true: 'gap-[var(--el-gap,1rem)]',
    },
    padding: {
        false: '',
        lg: 'p-6',
        md: 'p-4',
        sm: 'p-2',
        true: 'p-[var(--el-padding,1rem)]',
    },
    radius: {
        false: '',
        lg: 'rounded-lg',
        md: 'rounded-md',
        sm: 'rounded-sm',
        true: 'rounded-[var(--el-radius,0.5rem)]',
    },
} as const);

// --- [VARIANTS] --------------------------------------------------------------

const boxVariants = cva('', {
    variants: {
        gap: B.gap,
        padding: B.padding,
        radius: B.radius,
    },
});
const flexVariants = cva('flex', {
    defaultVariants: {
        align: 'stretch',
        direction: 'row',
        justify: 'start',
    },
    variants: {
        align: {
            baseline: 'items-baseline',
            center: 'items-center',
            end: 'items-end',
            start: 'items-start',
            stretch: 'items-stretch',
        },
        direction: {
            col: 'flex-col',
            'col-reverse': 'flex-col-reverse',
            row: 'flex-row',
            'row-reverse': 'flex-row-reverse',
        },
        gap: B.gap,
        justify: {
            around: 'justify-around',
            between: 'justify-between',
            center: 'justify-center',
            end: 'justify-end',
            evenly: 'justify-evenly',
            start: 'justify-start',
        },
        padding: B.padding,
        radius: B.radius,
        wrap: {
            false: 'flex-nowrap',
            true: 'flex-wrap',
        },
    },
});
const gridVariants = cva('grid', {
    variants: {
        autoFlow: {
            col: 'grid-flow-col',
            'col-dense': 'grid-flow-col-dense',
            dense: 'grid-flow-dense',
            row: 'grid-flow-row',
            'row-dense': 'grid-flow-row-dense',
        },
        gap: B.gap,
        padding: B.padding,
        radius: B.radius,
    },
});
const dividerVariants = cva('shrink-0 bg-[var(--color-border-200,currentColor)]', {
    defaultVariants: {
        orientation: 'horizontal',
    },
    variants: {
        orientation: {
            horizontal: 'h-px w-full',
            vertical: 'h-full w-px',
        },
    },
});

// --- [EXPORT] ----------------------------------------------------------------

export { boxVariants, dividerVariants, flexVariants, gridVariants };
export type { DividerOrientation, FlexAlign, FlexDirection, FlexJustify, GridAutoFlow, SpacingSize };
