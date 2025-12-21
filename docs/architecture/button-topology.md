# [H1][BUTTON_TOPOLOGY]
>**Dictum:** *Packages export mechanisms; apps define values.*

<br>

Button component architecture from schema formulas through factory invocation to visual overrides.

```
packages/components/src/schema.ts    → Formulas, multipliers, CSS variable slots
packages/components/src/*.ts         → Component factories (createControls, etc.)
apps/*/src/ui.ts                     → Scale configs, factory invocations, computed constants
apps/*/src/**/*.tsx                  → Visual overrides, layout containers, app-specific colors
```

---
## [1][SCHEMA_LAYER]
>**Dictum:** *Formulas derive dimensions from scale inputs.*

<br>

**File:** `packages/components/src/schema.ts`

Define `B` constant with algorithmic multipliers.<br>
Define `compute` table with dimension formulas.<br>
Define variant classes including hover behavior.<br>
Define CSS variable slot patterns.<br>
Export `createBuilderContext` for resolving scale/behavior inputs.

<br>

### [1.1][STRUCTURES]

```typescript
// Algorithmic multipliers (tunable base values)
B.algo = {
    hBase: 1.5,        // Height base
    hStep: 0.5,        // Height step per scale unit
    iconGapMul: 1,     // Gap multiplier for icon spacing
    pxMul: 2,          // Padding-x multiplier
    pyMul: 0.5,        // Padding-y multiplier
}

// Formulas derive dimensions
compute = {
    height: (scale) => (hBase + scale × hStep) × density × baseUnit × 4,
    paddingX: (scale) => scale × pxMul × density × baseUnit,
    iconGap: (scale) => scale × iconGapMul × density × baseUnit,
}

// Variant classes reference CSS variable slots (apps define actual colors)
B.ctrl.variant = {
    ghost: 'bg-transparent hover:bg-[var(--ctrl-ghost-hover)]',
    secondary: 'bg-[var(--ctrl-secondary-bg)] hover:bg-[var(--ctrl-secondary-hover)]',
}
```

---
### [1.2][SCALE_REFERENCE]

| [INDEX] | [SCALE] | [FORMULA]                    | [RESULT]      |
| :-----: | :-----: | ---------------------------- | ------------- |
|   [1]   |    2    | (1.5 + 2×0.5) × 1 × 0.25 × 4 | 2.5rem (40px) |
|   [2]   |    3    | (1.5 + 3×0.5) × 1 × 0.25 × 4 | 3rem (48px)   |
|   [3]   |    4    | (1.5 + 4×0.5) × 1 × 0.25 × 4 | 3.5rem (56px) |
|   [4]   |    5    | (1.5 + 5×0.5) × 1 × 0.25 × 4 | 4rem (64px)   |

---
## [2][FACTORY_LAYER]
>**Dictum:** *Factories accept tuning and produce styled components.*

<br>

**Files:** `packages/components/src/controls.ts`, `feedback.ts`, `selection.ts`

Accept scale/behavior tuning via factory parameters.<br>
Resolve inputs to computed CSS variables.<br>
Apply class order: `baseCls` → `variant` → `className`.<br>
Provide accessible, styled components.

<br>

### [2.1][FACTORY_PATTERN]

```typescript
// Factory accepts tuning parameters
const createControls = (tuning?: TuningFor<'ctrl'>) => ({
    Button: createButtonControl({ ...pick(tuning, TUNING_KEYS.ctrl) }),
});

// Button applies classes in order
className: utilities.cls(base, B.ctrl.variant[variant], className)
//                       ↑        ↑                      ↑
//                    baseCls   variant             user className
```

---
### [2.2][CLASS_MERGE_ORDER]

| [INDEX] | [POSITION] | [SOURCE]    | [CONTENT]                         |
| :-----: | :--------: | ----------- | --------------------------------- |
|   [1]   |   First    | `baseCls`   | Height, padding, radius from CSS  |
|   [2]   |   Second   | `variant`   | Variant-specific hover, colors    |
|   [3]   |   Third    | `className` | User overrides via tailwind-merge |

---
## [3][APP_CONFIG_LAYER]
>**Dictum:** *Apps supply scale values and invoke factories.*

<br>

**File:** `apps/*/src/ui.ts`

Define app-specific `B` constant with scale values.<br>
Compute derived constants (e.g., `ICON_GAP`).<br>
Invoke factories with app-specific tuning.<br>
Export configured components for app use.

<br>

### [3.1][CONFIG_EXAMPLE]

```typescript
const B = Object.freeze({
    algo: { iconGapMul: 3 },
    behavior: { disabled: false, loading: false, readonly: false },
    iconScale: { baseUnit: 0.25, density: 1, scale: 2 },   // 40px buttons
    scale: { baseUnit: 0.25, density: 1, scale: 5 },       // 64px standard
});

// Computed constant from formula
const ICON_GAP = `${B.iconScale.scale * B.algo.iconGapMul * B.iconScale.density * B.iconScale.baseUnit}rem`;
// = 2 × 3 × 1 × 0.25 = 1.5rem (24px)

// Factory invocations with app-specific tuning
const iconControls = createControls({ behavior: B.behavior, scale: B.iconScale });
const { Button: IconButton } = iconControls;

export { IconButton, ICON_GAP };
```

---
## [4][VISUAL_LAYER]
>**Dictum:** *Visual overrides apply app-specific colors and dimensions.*

<br>

**Files:** `apps/*/src/**/*.tsx` (e.g., `panels.tsx`, `shell.tsx`)

Define container layout classes.<br>
Apply app-specific visual overrides (colors, dimensions).<br>
Override component defaults when needed.<br>
Use computed constants from `ui.ts`.

<br>

### [4.1][OVERRIDE_EXAMPLE]

```typescript
const B = Object.freeze({
    styles: {
        // Container: layout + CSS variable references for colors
        rail: 'h-full flex flex-col items-center py-6 gap-4 w-[72px] ' +
              'border-r border-(--panel-border-dark) bg-(--panel-bg-dark)',

        // Button overrides: dimensions + CSS variable references (never hardcode colors)
        railButton: 'w-10 h-10 !p-0 flex items-center justify-center rounded-lg ' +
                    'text-(--panel-icon-default) hover:text-(--panel-icon-hover) ' +
                    'hover:bg-(--panel-bg-lighter)',
    },
});

// Usage with gap from ui.ts
<div className='flex flex-col' style={{ gap: ICON_GAP }}>
    <IconButton variant="ghost" className={B.styles.railButton}>
        <Icon name="History" />
    </IconButton>
</div>
```

---
### [4.2][OVERRIDE_PATTERNS]

| [INDEX] | [OVERRIDE]         | [PATTERN]                          | [EXAMPLE]                     |
| :-----: | ------------------ | ---------------------------------- | ----------------------------- |
|   [1]   | Fixed dimensions   | `w-N h-N`                          | `w-10 h-10` (40×40px)         |
|   [2]   | Remove padding     | `!p-0`                             | Override CSS var padding      |
|   [3]   | Force centering    | `flex items-center justify-center` | Override inline-flex          |
|   [4]   | App-specific color | `*-(--app-var-name)`               | `hover:bg-(--panel-bg-light)` |

---
## [5][DATA_FLOW]
>**Dictum:** *Import chain establishes layer dependencies.*

<br>

```
┌─────────────────────────────────────────────────────────────────┐
│  packages/components/src/schema.ts                              │
│  ├── B.algo (multipliers: hBase, hStep, iconGapMul)             │
│  ├── compute (formulas: height, paddingX, iconGap)              │
│  └── B.ctrl.variant (hover classes: ghost, secondary)           │
└────────────────────────┬────────────────────────────────────────┘
                         │ imports
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  packages/components/src/controls.ts                            │
│  └── createControls({ scale }) → Button, Input                  │
│      └── applies: baseCls → variant → className                 │
└────────────────────────┬────────────────────────────────────────┘
                         │ imports
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  apps/*/src/ui.ts                                               │
│  ├── B.iconScale = { scale: 2 }  → 40px buttons                 │
│  ├── B.algo.iconGapMul = 3       → 1.5rem gap                   │
│  ├── ICON_GAP = computed                                        │
│  └── IconButton = createControls({ behavior, scale }).Button    │
└────────────────────────┬────────────────────────────────────────┘
                         │ imports
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  apps/*/src/layout/panels.tsx                                   │
│  ├── B.styles.rail (container layout)                           │
│  ├── B.styles.railButton (visual overrides)                     │
│  └── <IconButton className={railButton}> with ICON_GAP          │
└─────────────────────────────────────────────────────────────────┘
```

---
## [6][CONTROL_MATRIX]
>**Dictum:** *Matrix maps aspects to responsible layers.*

<br>

| [INDEX] | [ASPECT]          | [LAYER]    | [FILE]       | [MECHANISM]             |
| :-----: | ----------------- | ---------- | ------------ | ----------------------- |
|   [1]   | Height formula    | Schema     | `schema.ts`  | `compute.height`        |
|   [2]   | Base hover class  | Schema     | `schema.ts`  | `B.ctrl.variant.ghost`  |
|   [3]   | Scale value       | App Config | `ui.ts`      | `B.iconScale.scale = 2` |
|   [4]   | Gap multiplier    | App Config | `ui.ts`      | `B.algo.iconGapMul = 3` |
|   [5]   | Gap constant      | App Config | `ui.ts`      | `ICON_GAP` computed     |
|   [6]   | Button dimensions | Visual     | `panels.tsx` | `w-10 h-10`             |
|   [7]   | App hover color   | Visual     | `panels.tsx` | `hover:bg-(--panel-*)`  |
|   [8]   | Container layout  | Visual     | `panels.tsx` | `B.styles.rail`         |

---
## [7][INVARIANTS]
>**Dictum:** *Rules maintain topology integrity.*

<br>

[CRITICAL]:
- [NEVER] Hardcode colors in packages — use CSS variable slots (`--ctrl-*`, `--panel-*`).
- [NEVER] Hardcode colors in app TSX — reference CSS variables defined in `main.css`.
- [NEVER] Modify package files from apps — override via `className` or `style`.

[IMPORTANT]:
- [ALWAYS] Place formulas in `schema.ts` — apps supply input values only.
- [ALWAYS] Respect class order — `baseCls` → `variant` → `className` (tailwind-merge resolves).
- [ALWAYS] Derive computed constants from `B` — no magic numbers in app code.
- [ALWAYS] Define CSS variable values in `main.css` — reference via `*-(--var-name)` in TSX.
