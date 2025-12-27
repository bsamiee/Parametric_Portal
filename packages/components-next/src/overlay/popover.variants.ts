/**
 * Popover CVA variant definitions.
 * Grounding: Type-safe variants for positioned overlay pattern.
 */
import { cva, type VariantProps } from 'class-variance-authority';

// --- [TYPES] -----------------------------------------------------------------

type PopoverContentVariants = VariantProps<typeof popoverContentVariants>;
type PopoverSide = NonNullable<PopoverContentVariants['side']>;
type PopoverPadding = NonNullable<PopoverContentVariants['padding']>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    arrow: 'absolute h-2 w-2 rotate-45 bg-[var(--color-surface-100)] border-[var(--color-surface-300)]',
    content: [
        'z-50 overflow-hidden rounded-lg border shadow-lg',
        'bg-[var(--color-surface-100)] border-[var(--color-surface-300)]',
        'focus:outline-none',
    ].join(' '),
} as const);

// --- [VARIANTS] --------------------------------------------------------------

const popoverContentVariants = cva(B.content, {
    defaultVariants: {
        padding: 'md',
        side: 'bottom',
    },
    variants: {
        padding: {
            lg: 'p-6',
            md: 'p-4',
            none: 'p-0',
            sm: 'p-2',
        },
        side: {
            bottom: '',
            left: '',
            right: '',
            top: '',
        },
    },
});
const popoverArrowVariants = cva(B.arrow, {
    defaultVariants: {
        side: 'bottom',
    },
    variants: {
        side: {
            bottom: 'border-l border-t -top-1',
            left: 'border-r border-t -right-1',
            right: 'border-l border-b -left-1',
            top: 'border-r border-b -bottom-1',
        },
    },
});

// --- [EXPORT] ----------------------------------------------------------------

export { popoverArrowVariants, popoverContentVariants };
export type { PopoverContentVariants, PopoverPadding, PopoverSide };
