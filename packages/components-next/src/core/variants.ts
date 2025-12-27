/**
 * CVA utilities with tailwind-merge integration.
 * Grounding: Type-safe variant composition for compound components.
 */
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- [TYPES] -----------------------------------------------------------------

type ClassNameValue = ClassValue;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const cn = (...inputs: ReadonlyArray<ClassNameValue>): string => twMerge(clsx(inputs));
const composeVariants =
    <T extends Record<string, unknown>>(...fns: ReadonlyArray<(props: T) => string>) =>
    (props: T): string =>
        cn(...fns.map((fn) => fn(props)));

// --- [EXPORT] ----------------------------------------------------------------

export { cn, composeVariants };
export type { ClassNameValue };
