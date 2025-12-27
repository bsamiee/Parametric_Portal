/**
 * Button CVA variant definitions.
 * Grounding: Type-safe variants referencing theme CSS variable slots.
 */
import { cva, type VariantProps } from 'class-variance-authority';

// --- [TYPES] -----------------------------------------------------------------

type ButtonVariants = VariantProps<typeof buttonVariants>;
type ButtonSize = NonNullable<ButtonVariants['size']>;
type ButtonVariant = NonNullable<ButtonVariants['variant']>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    base: [
        'inline-flex items-center justify-center gap-2',
        'font-medium transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
    ].join(' '),
    focus: 'focus-visible:ring-[var(--color-accent-200)]',
} as const);

// --- [CVA_DEFINITION] --------------------------------------------------------

const buttonVariants = cva([B.base, B.focus].join(' '), {
    compoundVariants: [{ className: 'font-semibold', size: 'lg', variant: 'primary' }],
    defaultVariants: {
        size: 'md',
        variant: 'primary',
    },
    variants: {
        size: {
            icon: 'h-10 w-10 p-0',
            lg: 'h-12 px-6 text-lg rounded-lg',
            md: 'h-10 px-4 text-base rounded-lg',
            sm: 'h-8 px-3 text-sm rounded-md',
            xs: 'h-6 px-2 text-xs rounded-sm',
        },
        variant: {
            destructive: [
                'bg-[var(--color-destructive-200)] text-white',
                'hover:bg-[var(--color-destructive-hover)]',
            ].join(' '),
            ghost: ['bg-transparent', 'hover:bg-[var(--color-surface-200)]'].join(' '),
            outline: [
                'border border-[var(--color-surface-300)] bg-transparent',
                'hover:bg-[var(--color-surface-100)]',
            ].join(' '),
            primary: ['bg-[var(--color-accent-200)] text-white', 'hover:bg-[var(--color-accent-hover)]'].join(' '),
            secondary: [
                'bg-[var(--color-surface-200)] text-[var(--color-text-100)]',
                'hover:bg-[var(--color-surface-300)]',
            ].join(' '),
        },
    },
});

// --- [EXPORT] ----------------------------------------------------------------

export { buttonVariants };
export type { ButtonSize, ButtonVariant, ButtonVariants };
