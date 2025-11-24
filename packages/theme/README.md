# @parametric-portal/theme

Algorithmic color generation, semantic fonts, and layout primitives for Tailwind CSS v4 + Vite 7.

## Installation

```bash
pnpm add @parametric-portal/theme
```

## Quick Start

```typescript
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { defineThemes } from '@parametric-portal/theme/theme';
import { defineFonts } from '@parametric-portal/theme/fonts';
import { defineLayouts } from '@parametric-portal/theme/layouts';

export default defineConfig({
    plugins: [
        defineLayouts([/* ... */]),  // optional
        defineFonts([/* ... */]),    // optional
        defineThemes([/* ... */]),   // required
        tailwindcss(),
    ],
});
```

---

## Colors (`theme`)

Algorithmic OKLCH color generation with Material Design baselines.

### Usage

```typescript
import { defineThemes } from '@parametric-portal/theme/theme';

defineThemes([{
    name: 'brand',
    lightness: 0.6,    // 0-1
    chroma: 0.15,      // 0-0.4
    hue: 250,          // 0-360
    scale: 11,         // generates 50, 100, ... 550
    spacing: 20,       // optional: generates --spacing-1 through --spacing-20
    modifiers: {
        hover: true,
        disabled: true,
    },
}])
```

**Generates**:
```css
@theme {
    --color-brand-50: oklch(95% 0.15 250);
    --color-brand-500: oklch(60% 0.15 250);
    --color-brand-hover: oklch(62% 0.153 250);
    --color-brand-disabled: oklch(75% 0.09 250 / 0.5);
    --spacing-1: 0.25rem;
    --spacing-4: 1rem;
    /* ... */
}
```

**In Components**:
```tsx
<button className="bg-brand-500 hover:bg-brand-hover">
    Submit
</button>
```

### API

```typescript
{
    name: string;              // kebab-case
    lightness: number;         // 0-1 (OKLCH L)
    chroma: number;            // 0-0.4 (OKLCH C)
    hue: number;               // 0-360 (OKLCH H)
    alpha?: number;            // 0-1 (default: 1)
    scale: number;             // 2-20 (step count)
    spacing?: number;          // 1-100 (optional spacing vars)
    modifiers?: {
        hover?: true | { chromaShift?: number; lightnessShift?: number; alphaShift?: number };
        active?: true | { /* ... */ };
        focus?: true | { /* ... */ };
        disabled?: true | { /* ... */ };
        selected?: true | { /* ... */ };
        pressed?: true | { /* ... */ };
        dragged?: true | { /* ... */ };
    };
    customModifiers?: Array<{
        name: string;
        chromaShift: number;
        lightnessShift: number;
        alphaShift: number;
    }>;
}
```

### Config

```typescript
import { THEME_CONFIG } from '@parametric-portal/theme/theme';

THEME_CONFIG.scaleIncrement      // 50 (scale steps)
THEME_CONFIG.spacingIncrement    // 0.25 (rem per spacing unit)
THEME_CONFIG.scaleAlgorithm      // { chromaDecay: 0.4, lightnessRange: 0.9 }
THEME_CONFIG.multipliers         // { alpha: 0.5, chroma: 0.03, lightness: 0.08 }
THEME_CONFIG.baselineModifiers   // Material Design shift values
```

---

## Fonts (`fonts`)

Automated `@font-face` generation with semantic weight utilities.

### Usage

```typescript
import { defineFonts } from '@parametric-portal/theme/fonts';

defineFonts([{
    name: 'brand',
    family: 'Inter Variable',
    type: 'variable',
    src: '/fonts/InterVariable.woff2',
    weights: {
        regular: 400,
        bold: 700,
    },
    axes: {
        wght: { min: 100, max: 900, default: 400 },
    },
    features: ['liga', 'kern'],
    display: 'swap',
    fallback: ['system-ui', 'sans-serif'],
}])
```

**Generates**:
```css
@font-face {
    font-family: "Inter Variable";
    src: url('/fonts/InterVariable.woff2') format('woff2 variations');
    font-weight: 100 900;
    font-display: swap;
    font-feature-settings: "liga", "kern";
}

@theme {
    --font-brand: "Inter Variable", system-ui, sans-serif;
    --font-brand--font-variation-settings: "wght" 400;
}

.font-brand-regular { font-family: var(--font-brand); font-weight: 400; }
.font-brand-bold { font-family: var(--font-brand); font-weight: 700; }
```

**In Components**:
```tsx
<h1 className="font-brand-bold">Title</h1>
```

### API

```typescript
{
    name: string;                        // kebab-case
    family: string;                      // CSS font-family name
    type: 'variable' | 'static';
    src: string;                         // path to font file
    weights: Record<string, number>;     // { regular: 400, bold: 700 }
    axes?: Record<string, {              // variable font axes
        min: number;
        max: number;
        default: number;
    }>;
    features?: string[];                 // ['liga', 'kern', ...]
    display?: 'swap' | 'block' | 'fallback' | 'optional' | 'auto';
    fallback?: Array<'sans-serif' | 'serif' | 'monospace' | 'system-ui'>;
}
```

### Config

```typescript
import { FORMAT_CONFIG } from '@parametric-portal/theme/fonts';

FORMAT_CONFIG.variable  // { format: 'woff2', tech: 'variations' }
FORMAT_CONFIG.static    // { format: 'woff2', tech: undefined }
```

---

## Layouts (`layouts`)

Algorithmic responsive grid/flex utilities.

### Usage

```typescript
import { defineLayouts } from '@parametric-portal/theme/layouts';

defineLayouts([
    // Responsive grid
    {
        type: 'grid',
        name: 'cards',
        minItemWidth: 280,
        maxColumns: 4,
        // gap defaults to 4 (16px)
    },
    // Flex stack
    {
        type: 'stack',
        name: 'nav',
        direction: 'horizontal',
        align: 'center',
        justify: 'between',
        // gap defaults to 4
    },
    // Sticky element
    {
        type: 'sticky',
        name: 'header',
        position: 'top',
        offset: 0,
        zIndex: 50,
    },
    // Centered container
    {
        type: 'container',
        name: 'content',
        maxWidth: 1280,
        // padding defaults to 4 (16px)
    },
])
```

**Generates**:
```css
@theme {
    --layout-cards-cols: repeat(4, minmax(min(280px, 100%), 1fr));
    --layout-cards-gap: 1rem;
}

.layout-cards {
    display: grid;
    grid-template-columns: var(--layout-cards-cols);
    gap: var(--layout-cards-gap);
}
```

**In Components**:
```tsx
<div className="layout-cards">
    <div>Card 1</div>
    <div>Card 2</div>
</div>
```

### API

**Grid**:
```typescript
{
    type: 'grid';
    name: string;
    minItemWidth: number;                // pixels
    maxColumns?: number;                 // 1-12 (optional, defaults to auto-fit)
    gap?: number;                        // gap scale (default: 4 = 16px)
    containerQuery?: boolean;            // enable container queries (default: false)
    alignItems?: 'start' | 'end' | 'center' | 'stretch' | 'baseline';
    justifyItems?: 'start' | 'end' | 'center' | 'stretch';
}
```

### Container Queries

Enable component-based responsive design where elements respond to their container width:

```typescript
defineLayouts([
    {
        type: 'grid',
        name: 'cards',
        minItemWidth: 280,
        containerQuery: true,  // Children respond to grid width
    },
    {
        type: 'stack',
        name: 'nav',
        direction: 'horizontal',
        containerQuery: true,  // Children respond to flex width
    },
    {
        type: 'container',
        name: 'content',
        maxWidth: 1280,
        containerQuery: true,  // Children respond to container width
    },
]);
```

**Generated CSS**:
```css
.layout-cards {
    container-type: inline-size;  /* Enables @container queries */
    display: grid;
    /* ... */
}
```

**Usage with Tailwind v4**:
```html
<div class="layout-cards">
    <div class="@md:flex @lg:grid">
        <!-- Responds to .layout-cards width, not viewport -->
    </div>
</div>
```

**Benefit**: Components adapt to available space without knowing global context

**Stack**:
```typescript
{
    type: 'stack';
    name: string;
    direction: 'horizontal' | 'vertical';
    gap?: number;                        // gap scale (default: 4)
    containerQuery?: boolean;            // enable container queries (default: false)
    align?: 'start' | 'end' | 'center' | 'stretch' | 'baseline';
    justify?: 'start' | 'end' | 'center' | 'between' | 'around' | 'evenly';
    wrap?: boolean;
}
```

**Sticky**:
```typescript
{
    type: 'sticky';
    name: string;
    position: 'top' | 'bottom' | 'left' | 'right';
    offset: number;                      // gap scale
    zIndex?: number;                     // default: 10
}
```

**Container**:
```typescript
{
    type: 'container';
    name: string;
    maxWidth: number;                    // pixels
    padding?: number;                    // gap scale (default: 4)
    containerQuery?: boolean;            // enable container queries (default: false)
}
```

### Config

```typescript
import { LAYOUT_CONFIG } from '@parametric-portal/theme/layouts';

LAYOUT_CONFIG.gapMultiplier  // 4 (gap scale × 4 = pixels)
LAYOUT_CONFIG.remBase        // 16 (16px = 1rem)
LAYOUT_CONFIG.stickyZindex   // 10 (default sticky z-index)
```

**Gap Calculation**: `gap: 4` → `4 × 4px = 16px = 1rem`

---

## Requirements

- **Vite** 7+
- **Tailwind CSS** 4+ (`@tailwindcss/vite`)
- **LightningCSS** 1.30+

---

**License**: MIT
