/**
 * Panel component CVA variants.
 * Grounding: Collapsible container with header/content pattern.
 */
import { cva } from 'class-variance-authority';

// --- [VARIANTS] --------------------------------------------------------------

const panelRootVariants = cva('flex flex-col overflow-hidden', {
    defaultVariants: {
        rounded: true,
    },
    variants: {
        rounded: {
            false: '',
            true: 'rounded-[var(--el-radius,0.5rem)]',
        },
    },
});
const panelHeaderVariants = cva(
    'flex items-center justify-between px-4 py-3 cursor-pointer select-none bg-[var(--color-surface-100)] hover:bg-[var(--color-surface-200)] transition-colors',
    {
        defaultVariants: {
            size: 'md',
        },
        variants: {
            size: {
                lg: 'px-6 py-4 text-lg',
                md: 'px-4 py-3 text-base',
                sm: 'px-3 py-2 text-sm',
            },
        },
    },
);
const panelContentVariants = cva('bg-[var(--color-surface-50)]', {
    defaultVariants: {
        padding: true,
    },
    variants: {
        padding: {
            false: '',
            lg: 'p-6',
            md: 'p-4',
            sm: 'p-2',
            true: 'p-4',
        },
    },
});

// --- [EXPORT] ----------------------------------------------------------------

export { panelContentVariants, panelHeaderVariants, panelRootVariants };
