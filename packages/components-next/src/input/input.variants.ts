/**
 * Input CVA variant definitions.
 * Grounding: Type-safe variants referencing theme CSS variable slots.
 */
import { cva, type VariantProps } from 'class-variance-authority';

// --- [TYPES] -----------------------------------------------------------------

type InputRootVariants = VariantProps<typeof inputRootVariants>;
type InputFieldVariants = VariantProps<typeof inputFieldVariants>;
type InputSize = NonNullable<InputRootVariants['size']>;
type InputState = NonNullable<InputRootVariants['state']>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    base: [
        'flex w-full rounded-lg border transition-all duration-200',
        'bg-[var(--color-surface-100)] border-[var(--color-surface-300)]',
        'text-[var(--color-text-100)] placeholder:text-[var(--color-text-200)]/50',
        'focus-within:border-[var(--color-accent-200)] focus-within:ring-2 focus-within:ring-[var(--color-accent-200)]/20',
        'disabled:cursor-not-allowed disabled:opacity-50',
    ].join(' '),
    input: [
        'flex-1 bg-transparent outline-none',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
    ].join(' '),
} as const);

// --- [CVA_DEFINITION] --------------------------------------------------------

const inputRootVariants = cva(B.base, {
    defaultVariants: {
        size: 'md',
        state: 'default',
    },
    variants: {
        size: {
            lg: 'h-12 px-4 text-lg gap-3',
            md: 'h-10 px-3 text-base gap-2',
            sm: 'h-8 px-2 text-sm gap-1.5',
        },
        state: {
            default: '',
            error: 'border-[var(--color-destructive-200)] focus-within:border-[var(--color-destructive-200)] focus-within:ring-[var(--color-destructive-200)]/20',
            success:
                'border-[var(--color-success-200)] focus-within:border-[var(--color-success-200)] focus-within:ring-[var(--color-success-200)]/20',
        },
    },
});
const inputFieldVariants = cva(B.input, {
    defaultVariants: {
        size: 'md',
    },
    variants: {
        size: {
            lg: 'text-lg',
            md: 'text-base',
            sm: 'text-sm',
        },
    },
});

// --- [EXPORT] ----------------------------------------------------------------

export { inputFieldVariants, inputRootVariants };
export type { InputFieldVariants, InputRootVariants, InputSize, InputState };
