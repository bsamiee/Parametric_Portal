/**
 * Access CSS custom properties via type-safe runtime utilities.
 * Grounding: Theme tokens injected at document root require runtime resolution for dynamic theming.
 */

// --- [TYPES] -----------------------------------------------------------------

type LayoutProperty = 'cols' | 'gap' | 'max' | 'padding';
type ValidationResult = { readonly found: ReadonlyArray<string>; readonly missing: ReadonlyArray<string> };

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/** Retrieve CSS custom property from document root. Grounding: SSR-safe resolution with fallback chain. */
const getVar = (name: string, fallback?: string): string => {
    const root = typeof document === 'undefined' ? null : document.documentElement;
    const value = root ? getComputedStyle(root).getPropertyValue(name).trim() : '';
    return value || fallback || '';
};

/** Set CSS custom property on target element. Grounding: Scoped style injection for dynamic themes. */
const setVar = (name: string, value: string, scope?: HTMLElement): void => {
    const target = scope ?? (typeof document === 'undefined' ? null : document.documentElement);
    target?.style?.setProperty(name, value);
};

const getColor = (name: string, step: number | string): string => getVar(`--color-${name}-${step}`);

const getSpacing = (scale: number): string => getVar(`--spacing-${scale}`);

const getFont = (name: string): string => getVar(`--font-${name}`);

const getLayout = (name: string, prop: LayoutProperty): string => getVar(`--layout-${name}-${prop}`);

/** Apply multiple CSS properties in batch. Grounding: Single reflow vs per-property updates. */
const applyThemeStyles = (styles: Record<string, string>, scope?: HTMLElement): void => {
    const target = scope ?? (typeof document === 'undefined' ? null : document.documentElement);
    for (const [name, value] of Object.entries(styles)) {
        target?.style?.setProperty(name, value);
    }
};

/** Validate CSS property availability in DOM. Grounding: Runtime check for missing theme tokens. */
const validateDOMVariables = (names: ReadonlyArray<string>): ValidationResult => {
    const root = typeof document === 'undefined' ? null : document.documentElement;
    const styles = root ? getComputedStyle(root) : null;
    const found: string[] = [];
    const missing: string[] = [];

    for (const name of names) {
        const value = styles?.getPropertyValue(name).trim();
        (value ? found : missing).push(name);
    }

    return { found, missing };
};

/** Generate HTML preview for color scale. Grounding: Dev tooling for theme validation. */
const generateColorPreview = (colorName: string, steps: ReadonlyArray<number>): string =>
    steps
        .map((step) => `<div style="background: var(--color-${colorName}-${step}); width: 40px; height: 40px;"></div>`)
        .join('');

/** Generate HTML preview for theme palette. Grounding: Visual audit of all color scales. */
const generateThemePreview = (colors: ReadonlyArray<{ name: string; steps: ReadonlyArray<number> }>): string => {
    const sections = colors
        .map(({ name, steps }) => {
            const preview = generateColorPreview(name, steps);
            return `<div><div style="font-size: 12px; margin-bottom: 4px;">${name}</div><div style="display: flex;">${preview}</div></div>`;
        })
        .join('');
    return `<div style="display: flex; flex-wrap: wrap; gap: 8px;">${sections}</div>`;
};

// --- [EXPORT] ----------------------------------------------------------------

export {
    applyThemeStyles,
    generateColorPreview,
    generateThemePreview,
    getColor,
    getFont,
    getLayout,
    getSpacing,
    getVar,
    setVar,
    validateDOMVariables,
};

export type { LayoutProperty, ValidationResult };
