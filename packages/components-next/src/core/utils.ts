/**
 * Export utilities not achievable via tailwind-variants or tw-animate-css.
 */
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/** Merge Tailwind classes with conflict resolution. `cn('px-2 py-1', 'px-4')` → `'py-1 px-4'` */
const cn = (...inputs: readonly ClassValue[]): string => twMerge(clsx(inputs));

// --- [EXPORT] ----------------------------------------------------------------

export { cn };
