# @parametric-portal/components

Algorithmic parametric component factory system for React 19 with react-aria accessibility.

## Installation

```bash
pnpm add @parametric-portal/components
```

## Quick Start

```typescript
import { createControls } from '@parametric-portal/components/controls';
import { createElements } from '@parametric-portal/components/elements';
import { createIcons } from '@parametric-portal/components/icons';

const Controls = createControls({ defaults: { dimensions: { scale: 5 } } });
const Elements = createElements({ defaults: { dimensions: { scale: 5 } } });
const Icons = createIcons({ defaults: { dimensions: { scale: 5 } } });
```

---

## Controls (`controls`)

Accessible button and input components with algorithmic sizing.

```typescript
import { createControls, CONTROL_TUNING } from '@parametric-portal/components/controls';

const { Button, Input, create } = createControls();

// Pre-configured components
<Button>Submit</Button>
<Input placeholder="Email" />

// Factory for custom variants
const SmallButton = create({ type: 'button', dimensions: { scale: 3 } });
const Checkbox = create({ type: 'checkbox', dimensions: { scale: 4 } });
```

**Generated CSS Variables**: `--control-height`, `--control-padding-x`, `--control-padding-y`, `--control-font-size`, `--control-radius`, `--control-gap`, `--control-icon-size`

**Control Types**: `button`, `input`, `checkbox`, `radio`, `switch`, `textarea`

**API**:
- Factory: `createControls(tuning?) => { Button, Input, create }`
- Create: `create({ type, dimensions?, behavior?, className?, fullWidth?, asChild? })`
- Dimensions: `{ scale: 1-10, density?: 0.5-2, baseUnit?: number, radiusMultiplier?: 0-1 }`
- Behavior: `{ disabled?, loading?, focusable?, interactive?, asChild? }`

**Config**: `CONTROL_TUNING.algorithms`, `CONTROL_TUNING.defaults`, `CONTROL_TUNING.stateClasses`

---

## Elements (`elements`)

Layout primitives with algorithmic spacing and flex utilities.

```typescript
import { createElements, ELEMENT_TUNING } from '@parametric-portal/components/elements';

const { Box, Flex, Stack, create } = createElements();

// Pre-configured components
<Stack gap>{children}</Stack>
<Flex justify="between" align="center">{children}</Flex>

// Factory for semantic elements
const Header = create({ tag: 'header', direction: 'row', padding: true });
const Card = create({ tag: 'article', padding: true, radius: true });
```

**Generated CSS Variables**: `--element-height`, `--element-padding-x`, `--element-padding-y`, `--element-font-size`, `--element-radius`, `--element-gap`, `--element-icon-size`

**Element Tags**: `div`, `span`, `article`, `aside`, `footer`, `header`, `main`, `nav`, `section`

**API**:
- Factory: `createElements(tuning?) => { Box, Flex, Stack, create }`
- Create: `create({ tag, dimensions?, behavior?, direction?, align?, justify?, wrap?, gap?, padding?, radius?, className?, asChild? })`
- Flex options: `direction: 'row' | 'column' | 'row-reverse' | 'column-reverse'`
- Align: `'start' | 'center' | 'end' | 'stretch' | 'baseline'`
- Justify: `'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'`

**Config**: `ELEMENT_TUNING.algorithms`, `ELEMENT_TUNING.defaults`

---

## Icons (`icons`)

Dynamic icon rendering with Lucide React and algorithmic stroke scaling.

```typescript
import { createIcons, ICON_TUNING } from '@parametric-portal/components/icons';

const { Icon, create, get, names } = createIcons();

// Dynamic icon component
<Icon name="Check" dimensions={{ scale: 5 }} />
<Icon name="ChevronRight" strokeWidth={2} />

// Factory for specific icons
const CheckIcon = create({ name: 'Check', dimensions: { scale: 4 } });
const AlertIcon = create({ name: 'AlertCircle', strokeWidth: 1.5 });

// Direct access
const LucideCheck = get('Check');
console.log(names); // all available icon names
```

**Generated CSS Variables**: `--icon-size`

**Stroke Scaling**: Automatically adjusts stroke width based on scale (larger icons get thinner strokes)

**API**:
- Factory: `createIcons(tuning?) => { Icon, create, get, names }`
- Icon: `<Icon name={IconName} dimensions? strokeWidth? />`
- Create: `create({ name, dimensions?, strokeWidth?, className? })`
- Get: `get(name) => LucideIcon`

**Config**: `ICON_TUNING.algorithms`, `ICON_TUNING.defaults`, `ICON_TUNING.strokeScaling`

---

## Algorithmic Dimension System

All components share a unified dimension schema computed from a single `scale` value (1-10):

```typescript
// Dimension Config
{
  scale: 5,           // Required: 1-10, drives all calculations
  density: 1,         // Optional: 0.5-2, multiplier for spacing
  baseUnit: 0.25,     // Optional: rem multiplier
  radiusMultiplier: 0.25  // Optional: 0-1 (1 = pill shape)
}

// Computed Dimensions (derived algorithmically)
fontSize  = 0.75rem + (scale × 0.125rem)
height    = (1.5 + scale × 0.5) × density × baseUnit × 4
paddingX  = scale × 2 × density × baseUnit
paddingY  = scale × 0.5 × density × baseUnit
gap       = scale × 1 × density × baseUnit
radius    = scale × radiusMultiplier × 2 × baseUnit (or 9999px if radiusMultiplier >= 1)
iconSize  = fontSize × 0.6 × baseUnit × 4
```

---

## Polymorphic Rendering

All components support the `asChild` pattern via `@radix-ui/react-slot`:

```typescript
<Button asChild>
  <a href="/path">Link styled as button</a>
</Button>

<Stack asChild>
  <nav>Navigation styled as stack</nav>
</Stack>
```

---

## Requirements

- **React** 19+ (canary)
- **react-aria** 3.40+
- **@radix-ui/react-slot** 1.1+
- **class-variance-authority** 0.7+
- **effect** 4+
- **lucide-react** 0.500+

**License**: MIT
