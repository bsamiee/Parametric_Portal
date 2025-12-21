# [H1][THEME]
>**Dictum:** *Algorithmic color generation produces consistent design tokens from minimal input.*

<br>

Vite plugins generating OKLCH color scales, @font-face rules, and layout utilities for Tailwind CSS v4.

---
## [1][INSTALLATION]
>**Dictum:** *Single dependency enables full theming pipeline.*

<br>

```bash
pnpm add @parametric-portal/theme
```

---
## [2][QUICK_START]
>**Dictum:** *Vite plugin order determines CSS generation sequence.*

<br>

```typescript
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { defineThemes } from '@parametric-portal/theme/theme';
import { defineFonts } from '@parametric-portal/theme/fonts';
import { defineLayouts } from '@parametric-portal/theme/layouts';

export default defineConfig({
    plugins: [
        defineLayouts([/* ... */]),
        defineFonts([/* ... */]),
        defineThemes([/* ... */]),
        tailwindcss(),
    ],
});
```

---
## [3][THEME]
>**Dictum:** *OKLCH color space enables perceptually uniform scale generation.*

<br>

### [3.1][FACTORY]

```typescript
import { defineThemes, B } from '@parametric-portal/theme/theme';
import type { ThemeInput } from '@parametric-portal/theme/theme';

defineThemes([{
    name: 'brand',
    lightness: 0.6,
    chroma: 0.15,
    hue: 250,
    scale: 11,
    modifiers: { hover: true, disabled: true },
}])
```

---
### [3.2][THEME_INPUT]

| [INDEX] | [FIELD]           | [TYPE]  | [CONSTRAINT]       | [DEFAULT] |
| :-----: | ----------------- | ------- | ------------------ | --------- |
|   [1]   | `name`            | string  | kebab-case         | required  |
|   [2]   | `lightness`       | number  | 0-1                | required  |
|   [3]   | `chroma`          | number  | 0-0.4              | required  |
|   [4]   | `hue`             | number  | 0-360              | required  |
|   [5]   | `scale`           | integer | 2-20               | required  |
|   [6]   | `alpha`           | number  | 0-1                | 1         |
|   [7]   | `spacing`         | integer | 1-100              | undefined |
|   [8]   | `modifiers`       | object  | partial override   | undefined |
|   [9]   | `customModifiers` | array   | custom shift specs | undefined |

---
### [3.3][MODIFIERS]

| [INDEX] | [MODIFIER] | [LIGHTNESS] | [CHROMA] | [ALPHA] |
| :-----: | ---------- | ----------: | -------: | ------: |
|   [1]   | `active`   |          -1 |        2 |       0 |
|   [2]   | `disabled` |        1.88 |      -20 |      -1 |
|   [3]   | `dragged`  |         0.5 |      0.5 |       0 |
|   [4]   | `focus`    |         1.5 |      1.5 |       0 |
|   [5]   | `hover`    |           1 |        1 |       0 |
|   [6]   | `pressed`  |          -1 |        2 |       0 |
|   [7]   | `selected` |         0.5 |        1 |       0 |

---
### [3.4][OUTPUT]

**Generated CSS variables:**
- Scale: `--color-{name}-50` through `--color-{name}-{scale×50}`
- Modifiers: `--color-{name}-{hover|disabled|...}`
- Spacing: `--spacing-1` through `--spacing-{spacing}`

**Usage:** `<button className="bg-brand-500 hover:bg-brand-hover">Submit</button>`

---
### [3.5][TUNING]

```typescript
B.baseline     // modifier shift values
B.multipliers  // { alpha: 0.5, chroma: 0.03, lightness: 0.08 }
B.scale        // { algorithm: { chromaDecay: 0.4, lightnessRange: 0.9 }, increment: 50 }
B.spacing      // { increment: 0.25 }
```

---
## [4][FONTS]
>**Dictum:** *Automated font-face generation eliminates manual CSS authoring.*

<br>

### [4.1][FACTORY]

```typescript
import { defineFonts, B } from '@parametric-portal/theme/fonts';
import type { FontInput } from '@parametric-portal/theme/fonts';

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

---
### [4.2][FONT_INPUT]

| [INDEX] | [FIELD]    | [TYPE]  | [CONSTRAINT]                                 | [DEFAULT] |
| :-----: | ---------- | ------- | -------------------------------------------- | --------- |
|   [1]   | `name`     | string  | kebab-case                                   | required  |
|   [2]   | `family`   | string  | font family name                             | required  |
|   [3]   | `type`     | literal | `'variable'` \| `'static'`                   | required  |
|   [4]   | `src`      | string  | URL path                                     | required  |
|   [5]   | `weights`  | record  | `{ [name]: 100-900 }`                        | required  |
|   [6]   | `axes`     | record  | `{ [axis]: { min, max, default } }`          | undefined |
|   [7]   | `features` | array   | OpenType tags                                | undefined |
|   [8]   | `display`  | literal | `'swap'` \| `'block'` \| `'fallback'` \| …   | undefined |
|   [9]   | `fallback` | array   | `'sans-serif'` \| `'serif'` \| `'monospace'` | undefined |

---
### [4.3][OUTPUT]

**Generated CSS:**
- `@font-face` block with format spec
- `--font-{name}` CSS variable with fallback stack
- `--font-{name}--font-variation-settings` (if axes)
- `.font-{name}-{weight}` utility classes

**Usage:** `<h1 className="font-brand-bold">Title</h1>`

---
## [5][LAYOUTS]
>**Dictum:** *Discriminated union enables type-safe layout generation.*

<br>

### [5.1][FACTORY]

```typescript
import { defineLayouts, B } from '@parametric-portal/theme/layouts';
import type { LayoutInput } from '@parametric-portal/theme/layouts';

defineLayouts([
    { type: 'grid', name: 'cards', minItemWidth: 280, maxColumns: 4 },
    { type: 'stack', name: 'nav', direction: 'horizontal', justify: 'between' },
    { type: 'sticky', name: 'header', position: 'top', offset: 0, zIndex: 50 },
    { type: 'container', name: 'content', maxWidth: 1280 },
])
```

---
### [5.2][GRID_INPUT]

| [INDEX] | [FIELD]          | [TYPE]  | [CONSTRAINT]                | [DEFAULT] |
| :-----: | ---------------- | ------- | --------------------------- | --------- |
|   [1]   | `type`           | literal | `'grid'`                    | required  |
|   [2]   | `name`           | string  | kebab-case                  | required  |
|   [3]   | `minItemWidth`   | integer | positive pixels             | required  |
|   [4]   | `maxColumns`     | integer | 1-12                        | auto-fit  |
|   [5]   | `gap`            | integer | scale                       | 4         |
|   [6]   | `containerQuery` | boolean | `@container`                | false     |
|   [7]   | `alignItems`     | literal | start \| end \| center \| … | undefined |
|   [8]   | `justifyItems`   | literal | start \| end \| center \| … | undefined |

---
### [5.3][STACK_INPUT]

| [INDEX] | [FIELD]          | [TYPE]  | [CONSTRAINT]                    | [DEFAULT] |
| :-----: | ---------------- | ------- | ------------------------------- | --------- |
|   [1]   | `type`           | literal | `'stack'`                       | required  |
|   [2]   | `name`           | string  | kebab-case                      | required  |
|   [3]   | `direction`      | literal | `'horizontal'` \| `'vertical'`  | required  |
|   [4]   | `gap`            | integer | scale                           | 4         |
|   [5]   | `containerQuery` | boolean | `@container`                    | false     |
|   [6]   | `align`          | literal | start \| end \| center \| …     | stretch   |
|   [7]   | `justify`        | literal | start \| between \| evenly \| … | start     |
|   [8]   | `wrap`           | boolean | flex-wrap                       | false     |

---
### [5.4][STICKY_INPUT]

| [INDEX] | [FIELD]    | [TYPE]  | [CONSTRAINT]                   | [DEFAULT] |
| :-----: | ---------- | ------- | ------------------------------ | --------- |
|   [1]   | `type`     | literal | `'sticky'`                     | required  |
|   [2]   | `name`     | string  | kebab-case                     | required  |
|   [3]   | `position` | literal | top \| bottom \| left \| right | required  |
|   [4]   | `offset`   | integer | gap scale                      | required  |
|   [5]   | `zIndex`   | integer | 0-100                          | 10        |

---
### [5.5][CONTAINER_INPUT]

| [INDEX] | [FIELD]          | [TYPE]  | [CONSTRAINT]    | [DEFAULT] |
| :-----: | ---------------- | ------- | --------------- | --------- |
|   [1]   | `type`           | literal | `'container'`   | required  |
|   [2]   | `name`           | string  | kebab-case      | required  |
|   [3]   | `maxWidth`       | integer | positive pixels | required  |
|   [4]   | `padding`        | integer | gap scale       | 4         |
|   [5]   | `containerQuery` | boolean | `@container`    | false     |

---
### [5.6][OUTPUT]

**Generated CSS variables:**
- Grid: `--layout-{name}-cols`, `--layout-{name}-gap`
- Stack: `--layout-{name}-gap`
- Container: `--layout-{name}-max`, `--layout-{name}-padding`

**Generated utility classes:** `.layout-{name}`<br>
**Gap calculation:** `gap: 4` → `4 × 4px = 16px = 1rem`<br>
**Usage:** `<div className="layout-cards">...</div>`

---
## [6][COLORS]
>**Dictum:** *OKLCH manipulation preserves perceptual uniformity.*

<br>

### [6.1][FACTORY]

```typescript
import { createOklch, mix, adjust, contrast, toCSS, toSRGB, parseOklch } from '@parametric-portal/theme/colors';
import { COLOR_TUNING } from '@parametric-portal/theme/colors';
import { Effect } from 'effect';

const color = Effect.runSync(createOklch(0.6, 0.15, 250));
const css = toCSS(color);  // oklch(60% 0.150 250.0)
const rgb = toSRGB(color); // rgb(R, G, B)
```

---
### [6.2][API_MEMBERS]

| [INDEX] | [MEMBER]      | [TYPE]                                            | [PURPOSE]              |
| :-----: | ------------- | ------------------------------------------------- | ---------------------- |
|   [1]   | `createOklch` | `(l, c, h, a?) => Effect<OklchColor>`             | Create validated color |
|   [2]   | `parseOklch`  | `(css: string) => Effect<OklchColor>`             | Parse CSS string       |
|   [3]   | `toCSS`       | `(color) => string`                               | Format to CSS          |
|   [4]   | `toSRGB`      | `(color) => string`                               | Convert to RGB         |
|   [5]   | `mix`         | `(a, b, ratio, hueMethod?) => Effect<OklchColor>` | Interpolate colors     |
|   [6]   | `adjust`      | `(color, delta) => Effect<OklchColor>`            | Shift channels         |
|   [7]   | `contrast`    | `(fg, bg) => number`                              | APCA contrast score    |
|   [8]   | `isInGamut`   | `(color, gamut?) => boolean`                      | Check gamut bounds     |
|   [9]   | `gamutMap`    | `(color, gamut?) => Effect<OklchColor>`           | Clamp to gamut         |
|  [10]   | `getColorVar` | `(name, step) => string`                          | CSS variable reference |

---
## [7][FACTORIES]
>**Dictum:** *Factory functions validate inputs via Effect pipelines.*

<br>

### [7.1][THEME_FACTORIES]

```typescript
import { createTheme, createModifier } from '@parametric-portal/theme/factories';
import { Effect } from 'effect';

const theme = Effect.runSync(createTheme('brand', { lightness: 0.6, chroma: 0.15, hue: 250 }));
const modifier = createModifier('glow', { lightness: 0.2, chroma: 0.05 });
```

---
### [7.2][FONT_FACTORIES]

```typescript
import { createVariableFont, createStaticFont, createFontAxis } from '@parametric-portal/theme/factories';

const font = Effect.runSync(createVariableFont('body', 'Inter', '/fonts/Inter.woff2', { regular: 400, bold: 700 }));
const axis = createFontAxis(100, 900, 400);
```

---
### [7.3][LAYOUT_FACTORIES]

```typescript
import { createGrid, createStack, createContainer, createSticky } from '@parametric-portal/theme/factories';

const grid = Effect.runSync(createGrid('cards', 4, 280, { maxColumns: 4 }));
const stack = Effect.runSync(createStack('nav', 'horizontal', { justify: 'between' }));
const container = Effect.runSync(createContainer('main', 1280, 4));
const sticky = Effect.runSync(createSticky('header', 'top', 0, { zIndex: 50 }));
```

---
### [7.4][API_MEMBERS]

| [INDEX] | [MEMBER]             | [TYPE]                                             | [PURPOSE]            |
| :-----: | -------------------- | -------------------------------------------------- | -------------------- |
|   [1]   | `createTheme`        | `(name, oklch, options?) => Effect<ThemeInput>`    | Create theme config  |
|   [2]   | `createVariableFont` | `(name, family, src, weights, options?) => Effect` | Variable font config |
|   [3]   | `createStaticFont`   | `(name, family, src, weights, options?) => Effect` | Static font config   |
|   [4]   | `createGrid`         | `(name, gap, minWidth, options?) => Effect`        | Grid layout config   |
|   [5]   | `createStack`        | `(name, direction, options?) => Effect`            | Stack layout config  |
|   [6]   | `createContainer`    | `(name, maxWidth, padding, options?) => Effect`    | Container config     |
|   [7]   | `createSticky`       | `(name, position, offset, options?) => Effect`     | Sticky config        |
|   [8]   | `createModifier`     | `(name, shifts) => frozen object`                  | Modifier spec        |
|   [9]   | `createFontAxis`     | `(min, max, default) => FontAxisConfig`            | Variable axis config |

---
## [8][PRESETS]
>**Dictum:** *Pre-configured palettes enable rapid theme application.*

<br>

### [8.1][FACTORY]

```typescript
import { getPresetThemes, fromPreset, semanticRoles } from '@parametric-portal/theme/presets';
import { PRESET_TUNING } from '@parametric-portal/theme/presets';
import { Effect } from 'effect';

const themes = getPresetThemes('catppuccin');
const customized = Effect.runSync(fromPreset('dracula', { accent: { hue: 300 } }));
```

---
### [8.2][PRESETS]

| [INDEX] | [PRESET]     | [SURFACE_HUE] | [ACCENT_HUE] | [LIGHTNESS] |
| :-----: | ------------ | ------------: | -----------: | ----------: |
|   [1]   | `catppuccin` |           284 |          280 |        0.21 |
|   [2]   | `dracula`    |           265 |          290 |        0.10 |
|   [3]   | `nord`       |           255 |          210 |        0.27 |

---
### [8.3][SEMANTIC_ROLES]

| [INDEX] | [ROLE]        | [SCALE] | [MODIFIERS]                    |
| :-----: | ------------- | ------: | ------------------------------ |
|   [1]   | `accent`      |      11 | all                            |
|   [2]   | `surface`     |      11 | all                            |
|   [3]   | `text`        |       5 | disabled, hover                |
|   [4]   | `muted`       |       5 | hover                          |
|   [5]   | `success`     |       7 | hover                          |
|   [6]   | `warning`     |       7 | hover                          |
|   [7]   | `destructive` |       7 | active, disabled, focus, hover |

---
### [8.4][API_MEMBERS]

| [INDEX] | [MEMBER]          | [TYPE]                                                 | [PURPOSE]           |
| :-----: | ----------------- | ------------------------------------------------------ | ------------------- |
|   [1]   | `getPresetThemes` | `(preset, overrides?) => ReadonlyArray<ThemeInput>`    | Sync preset loader  |
|   [2]   | `fromPreset`      | `(preset, overrides?) => Effect<ReadonlyArray<Theme>>` | Effect preset       |
|   [3]   | `getPalette`      | `(preset) => PaletteConfig`                            | Extract base colors |
|   [4]   | `semanticRoles`   | frozen object                                          | Role factory map    |

---
## [9][UTILS]
>**Dictum:** *Runtime utilities resolve CSS custom properties dynamically.*

<br>

### [9.1][API_MEMBERS]

| [INDEX] | [MEMBER]               | [TYPE]                          | [PURPOSE]                |
| :-----: | ---------------------- | ------------------------------- | ------------------------ |
|   [1]   | `getVar`               | `(name, fallback?) => string`   | Read CSS property        |
|   [2]   | `setVar`               | `(name, value, scope?) => void` | Write CSS property       |
|   [3]   | `getColor`             | `(name, step) => string`        | Read color token         |
|   [4]   | `getSpacing`           | `(scale) => string`             | Read spacing token       |
|   [5]   | `getFont`              | `(name) => string`              | Read font token          |
|   [6]   | `getLayout`            | `(name, prop) => string`        | Read layout token        |
|   [7]   | `applyThemeStyles`     | `(styles, scope?) => void`      | Batch property update    |
|   [8]   | `validateDOMVariables` | `(names) => ValidationResult`   | Check token availability |
|   [9]   | `generateColorPreview` | `(name, steps) => string`       | Dev preview HTML         |
|  [10]   | `generateThemePreview` | `(colors) => string`            | Full palette preview     |

---
### [9.2][USAGE]

```typescript
import { getColor, setVar, applyThemeStyles, validateDOMVariables } from '@parametric-portal/theme/utils';

const color = getColor('brand', 500);
setVar('--color-brand-500', 'oklch(60% 0.15 250)');

applyThemeStyles({
    '--color-brand-500': 'oklch(60% 0.15 250)',
    '--color-brand-600': 'oklch(55% 0.16 250)',
});

const { found, missing } = validateDOMVariables(['--color-brand-500', '--color-brand-600']);
```

---
## [10][MODULE_SUMMARY]
>**Dictum:** *Module catalog enables targeted imports.*

<br>

| [INDEX] | [MODULE]    | [PRIMARY_EXPORT]  | [PURPOSE]                  |
| :-----: | ----------- | ----------------- | -------------------------- |
|   [1]   | `theme`     | `defineThemes`    | Vite plugin for colors     |
|   [2]   | `fonts`     | `defineFonts`     | Vite plugin for @font-face |
|   [3]   | `layouts`   | `defineLayouts`   | Vite plugin for layouts    |
|   [4]   | `colors`    | `createOklch`     | OKLCH manipulation         |
|   [5]   | `factories` | `createTheme`     | Validated config builders  |
|   [6]   | `presets`   | `getPresetThemes` | Pre-configured palettes    |
|   [7]   | `schemas`   | validators        | Schema + type guards       |
|   [8]   | `utils`     | `getVar`          | Runtime CSS access         |

---
## [11][REQUIREMENTS]
>**Dictum:** *Peer dependencies enforce compatible runtime.*

<br>

| [INDEX] | [DEPENDENCY]   | [VERSION] |
| :-----: | -------------- | --------: |
|   [1]   | Vite           |        7+ |
|   [2]   | Tailwind CSS   |        4+ |
|   [3]   | effect         |     3.19+ |
|   [4]   | @effect/schema |     0.75+ |
