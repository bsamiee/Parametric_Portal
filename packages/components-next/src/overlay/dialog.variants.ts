/**
 * Dialog CVA variant definitions.
 * Grounding: Type-safe variants for modal overlay pattern.
 */
import { cva, type VariantProps } from 'class-variance-authority';

// --- [TYPES] -----------------------------------------------------------------

type DialogContentVariants = VariantProps<typeof dialogContentVariants>;
type DialogSize = NonNullable<DialogContentVariants['size']>;
type DialogPosition = NonNullable<DialogContentVariants['position']>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    backdrop: 'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm',
    content: [
        'fixed z-50 flex flex-col overflow-hidden rounded-lg border shadow-lg',
        'bg-[var(--color-surface-100)] border-[var(--color-surface-300)]',
        'focus:outline-none',
    ].join(' '),
    description: 'text-sm text-[var(--color-text-200)]',
    footer: 'flex items-center justify-end gap-2 border-t border-[var(--color-surface-300)] px-6 py-4',
    header: 'flex items-center justify-between border-b border-[var(--color-surface-300)] px-6 py-4',
    title: 'text-lg font-semibold text-[var(--color-text-100)]',
} as const);

// --- [VARIANTS] --------------------------------------------------------------

const dialogBackdropVariants = cva(B.backdrop, {
    variants: {},
});
const dialogContentVariants = cva(B.content, {
    defaultVariants: {
        position: 'center',
        size: 'md',
    },
    variants: {
        position: {
            center: 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            top: 'left-1/2 top-16 -translate-x-1/2',
        },
        size: {
            full: 'h-[calc(100vh-8rem)] w-[calc(100vw-4rem)] max-w-none',
            lg: 'w-full max-w-2xl',
            md: 'w-full max-w-lg',
            sm: 'w-full max-w-sm',
        },
    },
});
const dialogHeaderVariants = cva(B.header, {
    variants: {},
});
const dialogTitleVariants = cva(B.title, {
    variants: {},
});
const dialogDescriptionVariants = cva(B.description, {
    variants: {},
});
const dialogFooterVariants = cva(B.footer, {
    variants: {},
});

// --- [EXPORT] ----------------------------------------------------------------

export {
    dialogBackdropVariants,
    dialogContentVariants,
    dialogDescriptionVariants,
    dialogFooterVariants,
    dialogHeaderVariants,
    dialogTitleVariants,
};
export type { DialogContentVariants, DialogPosition, DialogSize };
