/**
 * Define CSS custom property requirements for component theming.
 * Apps implement contracts in theme CSS.
 */

// --- [TYPES] -----------------------------------------------------------------

type IconContract = CSSContract<'color' | 'size'>;
type LayoutContract = CSSContract<'bg' | 'gap' | 'padding' | 'radius'>;
type CSSContract<T extends string> = {
    readonly [K in T]: `--${string}`;
};
type ButtonContract = CSSContract<
    | 'bg'
    | 'border-color'
    | 'border-width'
    | 'disabled-opacity'
    | 'fg'
    | 'focus-ring'
    | 'focus-ring-offset'
    | 'focus-ring-width'
    | 'font-size'
    | 'font-weight'
    | 'gap'
    | 'height'
    | 'hover-bg'
    | 'icon-size'
    | 'min-width'
    | 'padding-x'
    | 'padding-y'
    | 'pressed-scale'
    | 'radius'
    | 'shadow'
    | 'transition-duration'
    | 'transition-easing'
    // Animation slots
    | 'animation-duration'
    | 'animation-easing'
>;

// --- [CONSTANTS] -------------------------------------------------------------

/** Generate documentation and type-safe theme builders. */
const buttonContract = Object.freeze({
    // Animation
    'animation-duration': '--button-animation-duration',
    'animation-easing': '--button-animation-easing',
    // Colors
    bg: '--button-bg',
    'border-color': '--button-border-color',
    // Sizing
    'border-width': '--button-border-width',
    // States
    'disabled-opacity': '--button-disabled-opacity',
    fg: '--button-fg',
    'focus-ring': '--button-focus-ring',
    'focus-ring-offset': '--button-focus-ring-offset',
    'focus-ring-width': '--button-focus-ring-width',
    'font-size': '--button-font-size',
    'font-weight': '--button-font-weight',
    gap: '--button-gap',
    height: '--button-height',
    'hover-bg': '--button-hover-bg',
    'icon-size': '--button-icon-size',
    'min-width': '--button-min-width',
    'padding-x': '--button-padding-x',
    'padding-y': '--button-padding-y',
    'pressed-scale': '--button-pressed-scale',
    radius: '--button-radius',
    shadow: '--button-shadow',
    'transition-duration': '--button-transition-duration',
    'transition-easing': '--button-transition-easing',
} as const satisfies ButtonContract);

/** Icon CSS variable definitions. */
const iconContract = Object.freeze({
    color: '--icon-color',
    size: '--icon-size',
} as const satisfies IconContract);

/** Generate CSS variable reference. `varRef(buttonContract, 'bg')` → `'var(--button-bg)'` */
const varRef = <T extends Record<string, string>>(contract: T, key: keyof T): string => `var(${contract[key]})`;

/** Generate CSS variable slot class. `varSlot('bg', buttonContract, 'bg')` → `'bg-(--button-bg)'` */
const varSlot = <T extends Record<string, string>>(twProp: string, contract: T, key: keyof T): string =>
    `${twProp}-(${contract[key]})`;

/** Generate example CSS for documentation. */
const generateExampleCSS = <T extends Record<string, string>>(contract: T, selector: string = ':root'): string => {
    const lines = Object.entries(contract).map(([, varName]) => `  ${varName}: /* your value */;`);
    return `${selector} {\n${lines.join('\n')}\n}`;
};

// --- [EXPORT] ----------------------------------------------------------------

export { buttonContract, generateExampleCSS, iconContract, varRef, varSlot };
export type { ButtonContract, CSSContract, IconContract, LayoutContract };
