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

```typescript
import { defineThemes } from '@parametric-portal/theme/theme';

defineThemes([{
    name: 'brand',
    lightness: 0.6,    // 0-1 (OKLCH L)
    chroma: 0.15,      // 0-0.4 (OKLCH C)
    hue: 250,          // 0-360 (OKLCH H)
    scale: 11,         // generates 50, 100, ... 550
    modifiers: { hover: true, disabled: true },
}])
```

**Generates**: `--color-brand-50` through `--color-brand-550`, plus `--color-brand-hover`, `--color-brand-disabled`
**Usage**: `<button className="bg-brand-500 hover:bg-brand-hover">Submit</button>`
**API**: `{ name, lightness, chroma, hue, alpha?, scale, spacing?, modifiers?, customModifiers? }`
**Config**: `THEME_CONFIG.scaleIncrement`, `THEME_CONFIG.multipliers`, `THEME_CONFIG.baselineModifiers`

---

## Fonts (`fonts`)

Automated `@font-face` generation with semantic weight utilities.

```typescript
import { defineFonts } from '@parametric-portal/theme/fonts';

defineFonts([{
    name: 'brand',
    family: 'Inter Variable',
    type: 'variable',
    src: '/fonts/InterVariable.woff2',
    weights: { regular: 400, bold: 700 },
    axes: { wght: { min: 100, max: 900, default: 400 } },
    display: 'swap',
}])
```

**Generates**: `@font-face`, `--font-brand` CSS variable, `.font-brand-regular`, `.font-brand-bold` utilities
**Usage**: `<h1 className="font-brand-bold">Title</h1>`
**API**: `{ name, family, type, src, weights, axes?, features?, display?, fallback? }`
**Config**: `FORMAT_CONFIG.variable`, `FORMAT_CONFIG.static`

---

## Layouts (`layouts`)

Algorithmic responsive grid/flex utilities.

```typescript
import { defineLayouts } from '@parametric-portal/theme/layouts';

defineLayouts([
    { type: 'grid', name: 'cards', minItemWidth: 280, maxColumns: 4 },
    { type: 'stack', name: 'nav', direction: 'horizontal', justify: 'between' },
    { type: 'sticky', name: 'header', position: 'top', zIndex: 50 },
    { type: 'container', name: 'content', maxWidth: 1280 },
])
```

**Generates**: `--layout-*` CSS variables and `.layout-*` utility classes
**Usage**: `<div className="layout-cards"><div>Card 1</div><div>Card 2</div></div>`
**Container Queries**: Set `containerQuery: true` to enable `@container` queries (children respond to parent width, not viewport)
**Config**: `LAYOUT_CONFIG.gapMultiplier`, `LAYOUT_CONFIG.remBase`, `LAYOUT_CONFIG.stickyZindex`
**Gap Calculation**: `gap: 4` → `4 × 4px = 16px = 1rem`

**API**:
- Grid: `{ type: 'grid', name, minItemWidth, maxColumns?, gap?, containerQuery?, alignItems?, justifyItems? }`
- Stack: `{ type: 'stack', name, direction, gap?, containerQuery?, align?, justify?, wrap? }`
- Sticky: `{ type: 'sticky', name, position, offset, zIndex? }`
- Container: `{ type: 'container', name, maxWidth, padding?, containerQuery? }`

---

## Requirements

- **Vite** 7+
- **Tailwind CSS** 4+ (`@tailwindcss/vite`)
- **LightningCSS** 1.30+

**License**: MIT
