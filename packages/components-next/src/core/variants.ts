/**
 * Integrate tailwind-variants with CSS variable slots.
 * Single tv() pattern with typed VariantProps.
 */
import { composeRenderProps } from 'react-aria-components';
import { type ClassNameValue, twMerge } from 'tailwind-merge';

// --- [TYPES] -----------------------------------------------------------------

type RenderPropsClassName<T> = ((state: T) => string) | string | undefined;
type SlotMap = Record<string, string>;
type CSSVarContract<T extends string> = { readonly [K in T]: `--${string}` };

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const composeTailwindRenderProps = <T>(cls: RenderPropsClassName<T>, tw: ClassNameValue): ((v: T) => string) | string =>
    composeRenderProps(cls, (prev) => twMerge(tw, prev));
const cssVarSlots = (c: string, m: SlotMap): string =>
    Object.entries(m)
        .map(([p, v]) => `${p}-(--${c}-${v})`)
        .join(' ');
const cssVar = (n: string, f?: string): string => (f === undefined ? `var(--${n})` : `var(--${n}, ${f})`);
const createContract = <T extends readonly string[]>(c: string, ps: T): CSSVarContract<T[number]> =>
    Object.freeze(Object.fromEntries(ps.map((p) => [p, `--${c}-${p}`]))) as CSSVarContract<T[number]>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    colors: { bg: 'bg', border: 'border-color', text: 'fg' },
    interactive: {
        'data-[disabled]:opacity': 'disabled-opacity',
        'focus-visible:ring': 'focus-ring',
        'hover:bg': 'hover-bg',
    },
    sizing: { gap: 'gap', h: 'height', 'min-w': 'min-width', px: 'padding-x', py: 'padding-y' },
    typography: { font: 'font-weight', text: 'font-size', tracking: 'letter-spacing' },
    visual: { rounded: 'radius', shadow: 'shadow' },
} as const);

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/performance/noBarrelFile: Re-exporting tv() is intentional API surface for variants
export { tv, type VariantProps } from 'tailwind-variants';
export { B as SLOT_TUNING, composeTailwindRenderProps, createContract, cssVar, cssVarSlots };
export type { CSSVarContract, RenderPropsClassName, SlotMap };
