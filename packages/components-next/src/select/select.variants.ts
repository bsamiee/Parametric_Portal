/**
 * Select CVA variant definitions.
 * Grounding: Type-safe variants referencing theme CSS variable slots.
 */
import { cva, type VariantProps } from 'class-variance-authority';

// --- [TYPES] -----------------------------------------------------------------

type SelectTriggerVariants = VariantProps<typeof selectTriggerVariants>;
type SelectContentVariants = VariantProps<typeof selectContentVariants>;
type SelectItemVariants = VariantProps<typeof selectItemVariants>;
type SelectSize = NonNullable<SelectTriggerVariants['size']>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    content: [
        'absolute z-50 min-w-[8rem] overflow-hidden rounded-lg border shadow-lg',
        'bg-[var(--color-surface-100)] border-[var(--color-surface-300)]',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
    ].join(' '),
    item: [
        'relative flex cursor-pointer select-none items-center rounded-md px-3 py-2 outline-none transition-colors',
        'text-[var(--color-text-100)]',
        'data-[focused]:bg-[var(--color-surface-200)]',
        'data-[selected]:bg-[var(--color-accent-200)] data-[selected]:text-white',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
    ].join(' '),
    trigger: [
        'flex w-full items-center justify-between rounded-lg border px-3 transition-all',
        'bg-[var(--color-surface-100)] border-[var(--color-surface-300)]',
        'text-[var(--color-text-100)]',
        'hover:border-[var(--color-surface-200)]',
        'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-200)]/20 focus:border-[var(--color-accent-200)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=open]:border-[var(--color-accent-200)]',
    ].join(' '),
} as const);

// --- [CVA_DEFINITION] --------------------------------------------------------

const selectTriggerVariants = cva(B.trigger, {
    defaultVariants: {
        size: 'md',
    },
    variants: {
        size: {
            lg: 'h-12 text-lg gap-3',
            md: 'h-10 text-base gap-2',
            sm: 'h-8 text-sm gap-1.5',
        },
    },
});
const selectContentVariants = cva(B.content, {
    defaultVariants: {
        position: 'bottom',
    },
    variants: {
        position: {
            bottom: 'top-full mt-1',
            top: 'bottom-full mb-1',
        },
    },
});
const selectItemVariants = cva(B.item, {
    defaultVariants: {
        size: 'md',
    },
    variants: {
        size: {
            lg: 'text-lg py-3',
            md: 'text-base py-2',
            sm: 'text-sm py-1.5',
        },
    },
});

// --- [EXPORT] ----------------------------------------------------------------

export { selectContentVariants, selectItemVariants, selectTriggerVariants };
export type { SelectContentVariants, SelectItemVariants, SelectSize, SelectTriggerVariants };
