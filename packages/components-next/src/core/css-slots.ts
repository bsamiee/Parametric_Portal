/**
 * CSS utilities for tailwind-merge and RAC render props integration.
 */
import { type ClassValue, clsx } from 'clsx';
import { composeRenderProps } from 'react-aria-components';
import { type ClassNameValue, twMerge } from 'tailwind-merge';

// --- [TYPES] -----------------------------------------------------------------

type RenderPropsClassName<T> = ((state: T) => string) | string | undefined;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const cn = (...inputs: readonly ClassValue[]): string => twMerge(clsx(inputs));
const cssVar = (n: string, f?: string): string => (f === undefined ? `var(--${n})` : `var(--${n}, ${f})`);
const composeTailwindRenderProps = <T>(cls: RenderPropsClassName<T>, tw: ClassNameValue): ((v: T) => string) | string =>
    composeRenderProps(cls, (prev) => twMerge(tw, prev));

// --- [EXPORT] ----------------------------------------------------------------

export { cn, composeTailwindRenderProps, cssVar };
export type { RenderPropsClassName };
