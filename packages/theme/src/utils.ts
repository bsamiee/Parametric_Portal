/**
 * Access CSS custom properties via unified runtime API.
 * Grounding: Theme tokens injected at document root require runtime resolution for dynamic theming.
 */

// --- [TYPES] -----------------------------------------------------------------

type LayoutProperty = 'cols' | 'gap' | 'max' | 'padding';
type ValidationResult = { readonly found: ReadonlyArray<string>; readonly missing: ReadonlyArray<string> };
type ThemeUtilsApi = {
    readonly applyStyles: typeof applyStyles;
    readonly get: {
        readonly color: typeof getColor;
        readonly font: typeof getFont;
        readonly layout: typeof getLayout;
        readonly spacing: typeof getSpacing;
        readonly var: typeof getVar;
    };
    readonly preview: {
        readonly color: typeof previewColor;
        readonly theme: typeof previewTheme;
    };
    readonly setVar: typeof setVar;
    readonly validate: typeof validate;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    prefix: {
        color: '--color-',
        font: '--font-',
        layout: '--layout-',
        spacing: '--spacing-',
    },
    preview: {
        swatchSize: 40,
    },
} as const);

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

const getColor = (name: string, step: number | string): string => getVar(`${B.prefix.color}${name}-${step}`);

const getSpacing = (scale: number): string => getVar(`${B.prefix.spacing}${scale}`);

const getFont = (name: string): string => getVar(`${B.prefix.font}${name}`);

const getLayout = (name: string, prop: LayoutProperty): string => getVar(`${B.prefix.layout}${name}-${prop}`);

/** Apply multiple CSS properties in batch. Grounding: Single reflow vs per-property updates. */
const applyStyles = (styles: Record<string, string>, scope?: HTMLElement): void => {
    const target = scope ?? (typeof document === 'undefined' ? null : document.documentElement);
    Object.entries(styles).forEach(([name, value]) => {
        target?.style?.setProperty(name, value);
    });
};

/** Validate CSS property availability in DOM. Grounding: Runtime check for missing theme tokens. */
const validate = (names: ReadonlyArray<string>): ValidationResult => {
    const root = typeof document === 'undefined' ? null : document.documentElement;
    const styles = root ? getComputedStyle(root) : null;
    const results = names.map((name) => ({ exists: Boolean(styles?.getPropertyValue(name).trim()), name }));
    return {
        found: results.filter((r) => r.exists).map((r) => r.name),
        missing: results.filter((r) => !r.exists).map((r) => r.name),
    };
};

/** Generate HTML preview for color scale. Grounding: Dev tooling for theme validation. */
const previewColor = (colorName: string, steps: ReadonlyArray<number>): string =>
    steps
        .map(
            (step) =>
                `<div style="background: var(${B.prefix.color}${colorName}-${step}); width: ${B.preview.swatchSize}px; height: ${B.preview.swatchSize}px;"></div>`,
        )
        .join('');

/** Generate HTML preview for theme palette. Grounding: Visual audit of all color scales. */
const previewTheme = (colors: ReadonlyArray<{ name: string; steps: ReadonlyArray<number> }>): string => {
    const sections = colors
        .map(({ name, steps }) => {
            const preview = previewColor(name, steps);
            return `<div><div style="font-size: 12px; margin-bottom: 4px;">${name}</div><div style="display: flex;">${preview}</div></div>`;
        })
        .join('');
    return `<div style="display: flex; flex-wrap: wrap; gap: 8px;">${sections}</div>`;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const themeUtils = (): ThemeUtilsApi =>
    Object.freeze({
        applyStyles,
        get: Object.freeze({
            color: getColor,
            font: getFont,
            layout: getLayout,
            spacing: getSpacing,
            var: getVar,
        }),
        preview: Object.freeze({
            color: previewColor,
            theme: previewTheme,
        }),
        setVar,
        validate,
    });

// --- [EXPORT] ----------------------------------------------------------------

export { B as UTILS_TUNING, themeUtils };
export type { LayoutProperty, ThemeUtilsApi, ValidationResult };
