/**
 * Sidebar component CVA variants.
 * Grounding: Rail + Drawer pattern with animated transitions.
 */
import { cva } from 'class-variance-authority';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    drawer: { width: '20rem' },
    rail: { width: '72px' },
} as const);

// --- [VARIANTS] --------------------------------------------------------------

const sidebarRootVariants = cva('flex h-full shrink-0', {
    variants: {},
});
const sidebarRailVariants = cva(
    'flex flex-col items-center py-4 bg-[var(--color-surface-100)] border-r border-[var(--color-border-100)]',
    {
        defaultVariants: {
            gap: 'md',
        },
        variants: {
            gap: {
                lg: 'gap-4',
                md: 'gap-2',
                sm: 'gap-1',
            },
        },
    },
);
const sidebarDrawerVariants = cva(
    'flex flex-col bg-[var(--color-surface-50)] border-r border-[var(--color-border-100)] overflow-hidden',
    {
        variants: {},
    },
);
const sidebarDrawerHeaderVariants = cva(
    'shrink-0 px-4 py-3 border-b border-[var(--color-border-100)] text-xs font-bold tracking-widest uppercase text-[var(--color-text-200)]',
    {
        variants: {},
    },
);
const sidebarDrawerContentVariants = cva('flex-1 overflow-y-auto p-4', {
    variants: {},
});

// --- [EXPORT] ----------------------------------------------------------------

export {
    B as SIDEBAR_TUNING,
    sidebarDrawerContentVariants,
    sidebarDrawerHeaderVariants,
    sidebarDrawerVariants,
    sidebarRailVariants,
    sidebarRootVariants,
};
