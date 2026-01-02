/**
 * Theme configuration using @parametric-portal/theme.
 * Single source of truth for design tokens.
 */

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    fonts: {
        geist: {
            mono: 'https://cdn.jsdelivr.net/npm/geist@1.4.1/dist/fonts/geist-mono/GeistMono-Variable.woff2',
            sans: 'https://cdn.jsdelivr.net/npm/geist@1.4.1/dist/fonts/geist-sans/Geist-Variable.woff2',
        },
        weights: { bold: 700, light: 300, medium: 500, regular: 400, semibold: 600 },
    },
    layouts: {
        container: { maxWidth: 1280, padding: 6 },
        grid: { gap: 4, minItemWidth: 280 },
        stack: { gap: 4 },
        toolbar: { gap: 2 },
    },
} as const);

// --- [THEME_CONFIG] ----------------------------------------------------------

const themes = {} as const;

// --- [FONT_CONFIG] -----------------------------------------------------------

const fonts = [
    {
        axes: { wght: { default: 400, max: 900, min: 100 } },
        display: 'swap' as const,
        fallback: ['system-ui', 'sans-serif'] as const,
        family: 'Geist',
        name: 'ui',
        src: B.fonts.geist.sans,
        type: 'variable' as const,
        weights: B.fonts.weights,
    },
    {
        axes: { wght: { default: 400, max: 900, min: 100 } },
        display: 'swap' as const,
        fallback: ['monospace'] as const,
        family: 'Geist Mono',
        name: 'mono',
        src: B.fonts.geist.mono,
        type: 'variable' as const,
        weights: B.fonts.weights,
    },
];

// --- [LAYOUT_CONFIG] ---------------------------------------------------------

const layouts = [
    {
        containerQuery: true,
        gap: B.layouts.grid.gap,
        minItemWidth: B.layouts.grid.minItemWidth,
        name: 'cards',
        type: 'grid' as const,
    },
    {
        align: 'stretch' as const,
        direction: 'vertical' as const,
        gap: B.layouts.stack.gap,
        justify: 'start' as const,
        name: 'stack',
        type: 'stack' as const,
    },
    {
        align: 'center' as const,
        direction: 'horizontal' as const,
        gap: B.layouts.stack.gap,
        justify: 'between' as const,
        name: 'row',
        type: 'stack' as const,
    },
    {
        align: 'center' as const,
        direction: 'horizontal' as const,
        gap: B.layouts.toolbar.gap,
        justify: 'start' as const,
        name: 'toolbar',
        type: 'stack' as const,
    },
    {
        containerQuery: true,
        maxWidth: B.layouts.container.maxWidth,
        name: 'container',
        padding: B.layouts.container.padding,
        type: 'container' as const,
    },
    { name: 'header', offset: 0, position: 'top' as const, type: 'sticky' as const, zIndex: 50 },
] as const;

// --- [EXPORT] ----------------------------------------------------------------

export { B as THEME_TUNING, fonts, layouts, themes };
