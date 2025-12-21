# [H1][COMPONENTS]
>**Dictum:** *Factory pattern produces accessible components with algorithmic dimensions.*

<br>

Parametric component factory system for React 19 with react-aria accessibility, algorithmic sizing, and unified tuning.

---
## [1][INSTALLATION]
>**Dictum:** *Single dependency enables full component system.*

<br>

```bash
pnpm add @parametric-portal/components
```

---
## [2][QUICK_START]
>**Dictum:** *Factory functions return frozen API objects.*

<br>

```typescript
import { createControls } from '@parametric-portal/components/controls';
import { createElements } from '@parametric-portal/components/elements';
import { createNavigation } from '@parametric-portal/components/navigation';
import { createOverlays } from '@parametric-portal/components/overlays';
import { createData } from '@parametric-portal/components/data';
import { createFeedback } from '@parametric-portal/components/feedback';
import { createSelection } from '@parametric-portal/components/selection';
import { createCommand } from '@parametric-portal/components/command';

const Controls = createControls({ scale: { scale: 5 } });
const Elements = createElements({ scale: { scale: 5 } });
```

---
## [3][CONTROLS]
>**Dictum:** *Form controls inherit accessibility from react-aria.*

<br>

### [3.1][FACTORY]

```typescript
import { createControls } from '@parametric-portal/components/controls';

const { Button, Input, Checkbox, Radio, Switch, Textarea, create } = createControls();

<Button>Submit</Button>
<Input placeholder="Email" />
<Checkbox>Accept terms</Checkbox>
<Switch>Dark mode</Switch>
```

---
### [3.2][CONTROL_TYPES]

| [INDEX] | [TYPE]     | [COMPONENT] | [ARIA_SOURCE] |
| :-----: | ---------- | ----------- | ------------- |
|   [1]   | `button`   | Button      | useButton     |
|   [2]   | `input`    | Input       | useTextField  |
|   [3]   | `checkbox` | Checkbox    | useCheckbox   |
|   [4]   | `radio`    | Radio       | useRadio      |
|   [5]   | `switch`   | Switch      | useSwitch     |
|   [6]   | `textarea` | Textarea    | useTextField  |

---
### [3.3][CUSTOM_VARIANTS]

```typescript
const SmallButton = create({ type: 'button', dimensions: { scale: 3 } });
const LargeInput = create({ type: 'input', dimensions: { scale: 7 } });
const PillButton = create({ type: 'button', dimensions: { radiusMultiplier: 1 } });
```

---
### [3.4][TUNING_KEYS]

`['behavior', 'scale']`

---
## [4][ELEMENTS]
>**Dictum:** *Layout primitives compose via flex and grid properties.*

<br>

### [4.1][FACTORY]

```typescript
import { createElements } from '@parametric-portal/components/elements';

const { Box, Flex, Stack, Grid, Divider, create, createDivider } = createElements();

<Stack gap>{children}</Stack>
<Flex justify="between" align="center">{children}</Flex>
<Grid>{children}</Grid>
```

---
### [4.2][ELEMENT_TAGS]

| [INDEX] | [TAG]     | [SEMANTIC]             |
| :-----: | --------- | ---------------------- |
|   [1]   | `div`     | Generic container      |
|   [2]   | `span`    | Inline container       |
|   [3]   | `article` | Self-contained content |
|   [4]   | `aside`   | Tangential content     |
|   [5]   | `footer`  | Footer section         |
|   [6]   | `header`  | Header section         |
|   [7]   | `main`    | Main content           |
|   [8]   | `nav`     | Navigation section     |
|   [9]   | `section` | Generic section        |

---
### [4.3][FLEX_OPTIONS]

| [INDEX] | [PROP]      | [VALUES]                                                                      |
| :-----: | ----------- | ----------------------------------------------------------------------------- |
|   [1]   | `direction` | `'row'` \| `'column'` \| `'row-reverse'` \| `'column-reverse'`                |
|   [2]   | `align`     | `'start'` \| `'center'` \| `'end'` \| `'stretch'` \| `'baseline'`             |
|   [3]   | `justify`   | `'start'` \| `'center'` \| `'end'` \| `'between'` \| `'around'` \| `'evenly'` |
|   [4]   | `wrap`      | `boolean`                                                                     |
|   [5]   | `gap`       | `boolean`                                                                     |

---
### [4.4][CUSTOM_ELEMENTS]

```typescript
const Header = create({ tag: 'header', direction: 'row', padding: true });
const Card = create({ tag: 'article', padding: true, radius: true });
const Nav = create({ tag: 'nav', direction: 'row', justify: 'between' });
```

---
### [4.5][TUNING_KEYS]

`['behavior', 'scale']`

---
## [5][NAVIGATION]
>**Dictum:** *Navigation components manage keyboard focus automatically.*

<br>

### [5.1][FACTORY]

```typescript
import { createNavigation } from '@parametric-portal/components/navigation';

const { Tabs, Breadcrumb, Pagination, create } = createNavigation();
```

---
### [5.2][TABS]

```typescript
<Tabs
  items={[
    { key: 'tab1', title: 'First', content: <div>Content 1</div> },
    { key: 'tab2', title: 'Second', content: <div>Content 2</div> },
  ]}
  orientation="horizontal"
  onSelectionChange={(key) => console.log(key)}
/>
```

| [INDEX] | [PROP]              | [TYPE]                         | [DEFAULT]      |
| :-----: | ------------------- | ------------------------------ | -------------- |
|   [1]   | `items`             | `TabItem[]`                    | required       |
|   [2]   | `orientation`       | `'horizontal'` \| `'vertical'` | `'horizontal'` |
|   [3]   | `selectedKey`       | `Key`                          | undefined      |
|   [4]   | `onSelectionChange` | `(key: Key) => void`           | undefined      |

---
### [5.3][BREADCRUMB]

```typescript
<Breadcrumb
  items={[
    { key: 'home', label: 'Home', href: '/' },
    { key: 'products', label: 'Products', href: '/products' },
    { key: 'current', label: 'Item' },
  ]}
  separator="/"
/>
```

---
### [5.4][PAGINATION]

```typescript
<Pagination
  current={1}
  total={100}
  onChange={(page) => setPage(page)}
  siblingCount={1}
/>
```

---
### [5.5][TUNING_KEYS]

`['animation', 'behavior', 'scale']`

---
## [6][OVERLAYS]
>**Dictum:** *Overlay components manage focus trap and escape dismissal.*

<br>

### [6.1][FACTORY]

```typescript
import { createOverlays } from '@parametric-portal/components/overlays';

const { Modal, Dialog, Drawer, Sheet, Popover, Tooltip, create } = createOverlays();
```

---
### [6.2][OVERLAY_TYPES]

| [INDEX] | [TYPE]    | [DESCRIPTION]             | [POSITION]            |
| :-----: | --------- | ------------------------- | --------------------- |
|   [1]   | `modal`   | Centered modal dialog     | center                |
|   [2]   | `dialog`  | Alert with confirm/cancel | center                |
|   [3]   | `drawer`  | Slide-out panel           | top/bottom/left/right |
|   [4]   | `sheet`   | Bottom drawer preset      | bottom                |
|   [5]   | `popover` | Position-relative popup   | trigger-relative      |
|   [6]   | `tooltip` | Positioned tooltip        | trigger-relative      |

---
### [6.3][MODAL]

```typescript
<Modal isOpen={open} onClose={() => setOpen(false)} size="md" title="Settings">
  {content}
</Modal>
```

| [INDEX] | [SIZE] | [MAX_WIDTH] |
| :-----: | ------ | ----------: |
|   [1]   | `sm`   |       384px |
|   [2]   | `md`   |       512px |
|   [3]   | `lg`   |       640px |
|   [4]   | `xl`   |       768px |
|   [5]   | `2xl`  |       896px |
|   [6]   | `full` |        100% |

---
### [6.4][DIALOG]

```typescript
<Dialog
  isOpen={open}
  onClose={() => setOpen(false)}
  title="Confirm Delete"
  onConfirm={() => handleDelete()}
  onCancel={() => setOpen(false)}
>
  Are you sure?
</Dialog>
```

---
### [6.5][DRAWER]

```typescript
<Drawer isOpen={open} onClose={() => setOpen(false)} position="right">
  {sidebarContent}
</Drawer>
```

---
### [6.6][TUNING_KEYS]

`['animation', 'overlay', 'scale']`

---
## [7][DATA]
>**Dictum:** *Data display components render collections with type safety.*

<br>

### [7.1][FACTORY]

```typescript
import { createData } from '@parametric-portal/components/data';

const { Avatar, Badge, Card, List, Table, create } = createData();
```

---
### [7.2][DATA_TYPES]

| [INDEX] | [TYPE]   | [PURPOSE]                    |
| :-----: | -------- | ---------------------------- |
|   [1]   | `avatar` | Image with fallback          |
|   [2]   | `badge`  | Inline status indicator      |
|   [3]   | `card`   | Container with header/footer |
|   [4]   | `list`   | Render function list         |
|   [5]   | `table`  | Full-featured data table     |

---
### [7.3][TABLE]

```typescript
<Table
  columns={[
    { key: 'name', header: 'Name', allowsSorting: true, isRowHeader: true },
    { key: 'email', header: 'Email' },
    { key: 'status', header: 'Status', allowsSorting: true },
  ]}
  data={users}
  rowKey={(row) => row.id}
  selectionMode="multiple"
  onSelectionChange={(selection) => setSelected(selection)}
  onSortChange={(sort) => setSort(sort)}
/>
```

---
### [7.4][LIST]

```typescript
<List
  items={items}
  keyExtractor={(item, idx) => item.id}
  renderItem={(item, idx) => <div>{item.name}</div>}
/>
```

---
### [7.5][TUNING_KEYS]

`['behavior', 'scale']`

---
## [8][FEEDBACK]
>**Dictum:** *Feedback components communicate system state to users.*

<br>

### [8.1][FACTORY]

```typescript
import { createFeedback } from '@parametric-portal/components/feedback';

const { Alert, Toast, Progress, Skeleton, Spinner, create } = createFeedback();
```

---
### [8.2][FEEDBACK_TYPES]

| [INDEX] | [TYPE]     | [PURPOSE]                        |
| :-----: | ---------- | -------------------------------- |
|   [1]   | `alert`    | Dismissible alert container      |
|   [2]   | `toast`    | Alert with title + shadow        |
|   [3]   | `progress` | Progress bar (0-100)             |
|   [4]   | `skeleton` | Loading placeholder (multi-line) |
|   [5]   | `spinner`  | SVG loading indicator            |

---
### [8.3][USAGE]

```typescript
<Alert variant="warning" icon={<Icon name="AlertTriangle" />} onDismiss={() => {}}>
  Warning message
</Alert>

<Toast title="Success" variant="success">
  Operation completed
</Toast>

<Progress value={75} />

<Skeleton lines={3} />

<Spinner />
```

---
### [8.4][TUNING_KEYS]

`['animation', 'feedback', 'scale']`

---
## [9][SELECTION]
>**Dictum:** *Selection components manage single and multi-select states.*

<br>

### [9.1][FACTORY]

```typescript
import { createSelection } from '@parametric-portal/components/selection';

const { Menu, Select, Combobox, create } = createSelection();
```

---
### [9.2][MENU]

```typescript
<Menu
  trigger={<Button>Options</Button>}
  items={[
    { key: 'edit', label: 'Edit' },
    { key: 'delete', label: 'Delete', disabled: true },
  ]}
  selectionMode="single"
  onAction={(key) => handleAction(key)}
/>
```

---
### [9.3][SELECT]

```typescript
<Select
  label="Country"
  items={[
    { key: 'us', label: 'United States' },
    { key: 'ca', label: 'Canada' },
  ]}
  placeholder="Select country"
  isRequired
  onSelectionChange={(key) => setCountry(key)}
/>
```

---
### [9.4][COMBOBOX]

```typescript
<Combobox
  label="Search"
  items={suggestions}
  placeholder="Type to search..."
  allowsCustomValue
  onInputChange={(value) => search(value)}
  onSelectionChange={(key) => select(key)}
/>
```

---
### [9.5][TUNING_KEYS]

`['animation', 'behavior', 'overlay', 'scale']`

---
## [10][COMMAND]
>**Dictum:** *Command palettes enable keyboard-driven navigation.*

<br>

### [10.1][FACTORY]

```typescript
import { createCommand, useCommandState } from '@parametric-portal/components/command';

const { Dialog, Palette, Inline, create } = createCommand();
```

---
### [10.2][COMMAND_TYPES]

| [INDEX] | [TYPE]    | [PURPOSE]                                 |
| :-----: | --------- | ----------------------------------------- |
|   [1]   | `dialog`  | Modal command dialog with global shortcut |
|   [2]   | `palette` | Full-screen command palette with pages    |
|   [3]   | `inline`  | Inline command input                      |

---
### [10.3][DIALOG]

```typescript
<Dialog
  open={open}
  onOpenChange={setOpen}
  globalShortcut="cmd+k"
  placeholder="Type a command..."
  pages={[
    {
      key: 'home',
      groups: [
        {
          key: 'actions',
          heading: 'Actions',
          items: [
            { key: 'new', label: 'New File', shortcut: 'N', icon: <Icon name="Plus" /> },
            { key: 'open', label: 'Open...', shortcut: 'O' },
          ],
        },
      ],
    },
  ]}
/>
```

---
### [10.4][ITEM_DATA]

| [INDEX] | [FIELD]    | [TYPE]    | [PURPOSE]         |
| :-----: | ---------- | --------- | ----------------- |
|   [1]   | `key`      | string    | Unique identifier |
|   [2]   | `label`    | ReactNode | Display text      |
|   [3]   | `icon`     | ReactNode | Optional icon     |
|   [4]   | `keywords` | string[]  | Search keywords   |
|   [5]   | `shortcut` | string    | Keyboard shortcut |
|   [6]   | `disabled` | boolean   | Disabled state    |
|   [7]   | `onSelect` | function  | Selection handler |

---
### [10.5][TUNING_KEYS]

`['animation', 'behavior', 'overlay', 'scale']`

---
## [11][SCHEMA]
>**Dictum:** *Centralized configuration enables consistent component theming.*

<br>

### [11.1][B_CONSTANT]

```typescript
import { B, utilities, stateCls, resolve, pick, merged } from '@parametric-portal/components/schema';
```

The `B` constant contains 62+ algorithmic tuning parameters:

| [INDEX] | [NAMESPACE] | [PURPOSE]                       |
| :-----: | ----------- | ------------------------------- |
|   [1]   | `B.algo`    | Scale multipliers, base units   |
|   [2]   | `B.ctrl`    | Control variants, state classes |
|   [3]   | `B.el`      | Element flex/grid config        |
|   [4]   | `B.nav`     | Navigation theming              |
|   [5]   | `B.ov`      | Overlay backdrop, sizes         |
|   [6]   | `B.data`    | Table/list theming              |
|   [7]   | `B.fb`      | Feedback animation              |
|   [8]   | `B.menu`    | Selection theming               |
|   [9]   | `B.cmd`     | Command palette config          |
|  [10]   | `B.icon`    | Stroke scaling                  |

---
### [11.2][UTILITIES]

| [INDEX] | [UTILITY]      | [SIGNATURE]                              | [PURPOSE]               |
| :-----: | -------------- | ---------------------------------------- | ----------------------- |
|   [1]   | `cls`          | `(...args) => string`                    | clsx + tailwind-merge   |
|   [2]   | `computeScale` | `(scale) => Computed`                    | Derive CSS values       |
|   [3]   | `cssVars`      | `(computed, prefix) => Record`           | Generate CSS variables  |
|   [4]   | `merge`        | `<T>(first, second) => T`                | Object merge            |
|   [5]   | `optProps`     | `<T>(obj) => Partial<T>`                 | Filter undefined        |
|   [6]   | `strokeWidth`  | `(scale) => number`                      | Icon stroke calculation |
|   [7]   | `zStyle`       | `(overlay, isUnderlay) => CSSProperties` | Z-index styling         |

---
### [11.3][HOOKS]

| [INDEX] | [HOOK]            | [SIGNATURE]                  | [PURPOSE]                  |
| :-----: | ----------------- | ---------------------------- | -------------------------- |
|   [1]   | `useForwardedRef` | `<T>(ref) => RefObject<T>`   | Unified ref handling       |
|   [2]   | `useCollectionEl` | `<T>(focusClass?) => Result` | Focus ring for collections |

---
### [11.4][SCHEMAS]

| [INDEX] | [SCHEMA]          | [FIELDS]                                                                                       |
| :-----: | ----------------- | ---------------------------------------------------------------------------------------------- |
|   [1]   | `ScaleSchema`     | `scale`, `density`, `baseUnit`, `radiusMultiplier`                                             |
|   [2]   | `BehaviorSchema`  | `disabled`, `loading`, `readonly`, `interactive`, `focusable`, `asChild`                       |
|   [3]   | `OverlaySchema`   | `backdrop`, `modal`, `zIndex`, `position`, `closeOnEscape`, `closeOnOutsideClick`, `trapFocus` |
|   [4]   | `FeedbackSchema`  | `autoDismiss`, `dismissible`, `duration`                                                       |
|   [5]   | `AnimationSchema` | `enabled`, `duration`, `delay`, `easing`                                                       |

---
## [12][DIMENSIONS]
>**Dictum:** *Single scale value derives all dimensional properties.*

<br>

### [12.1][SCALE_INPUT]

| [INDEX] | [FIELD]            | [RANGE] | [DEFAULT] | [PURPOSE]                |
| :-----: | ------------------ | ------- | --------- | ------------------------ |
|   [1]   | `scale`            | 1-10    | 5         | Base scale factor        |
|   [2]   | `density`          | 0.5-2   | 1         | Spacing multiplier       |
|   [3]   | `baseUnit`         | rem     | 0.25      | Base rem unit            |
|   [4]   | `radiusMultiplier` | 0-1     | 0.25      | Border radius (1 = pill) |

---
### [12.2][COMPUTED_VALUES]

```typescript
fontSize  = 0.75rem + (scale × 0.125rem)
height    = (1.5 + scale × 0.5) × density × baseUnit × 4
paddingX  = scale × 2 × density × baseUnit
paddingY  = scale × 0.5 × density × baseUnit
gap       = scale × 1 × density × baseUnit
radius    = scale × radiusMultiplier × 2 × baseUnit (or 9999px if radiusMultiplier >= 1)
iconSize  = fontSize × 0.6 × baseUnit × 4
```

---
### [12.3][CSS_VARIABLES]

Controls: `--control-height`, `--control-padding-x`, `--control-padding-y`, `--control-font-size`, `--control-radius`, `--control-gap`, `--control-icon-size`

Elements: `--element-height`, `--element-padding-x`, `--element-padding-y`, `--element-font-size`, `--element-radius`, `--element-gap`

---
## [13][POLYMORPHIC]
>**Dictum:** *asChild pattern enables semantic element composition.*

<br>

All components support `asChild` via `@radix-ui/react-slot`:

```typescript
<Button asChild>
  <a href="/path">Link styled as button</a>
</Button>

<Stack asChild>
  <nav>Navigation styled as stack</nav>
</Stack>

<Card asChild>
  <article>Article styled as card</article>
</Card>
```

---
## [14][TUNING_REFERENCE]
>**Dictum:** *Per-component tuning keys control configuration scope.*

<br>

| [INDEX] | [MODULE]   | [TUNING_KEYS]                               |
| :-----: | ---------- | ------------------------------------------- |
|   [1]   | controls   | `behavior`, `scale`                         |
|   [2]   | elements   | `behavior`, `scale`                         |
|   [3]   | navigation | `animation`, `behavior`, `scale`            |
|   [4]   | overlays   | `animation`, `overlay`, `scale`             |
|   [5]   | data       | `behavior`, `scale`                         |
|   [6]   | feedback   | `animation`, `feedback`, `scale`            |
|   [7]   | selection  | `animation`, `behavior`, `overlay`, `scale` |
|   [8]   | command    | `animation`, `behavior`, `overlay`, `scale` |
|   [9]   | utility    | `scale`                                     |

---
## [15][REQUIREMENTS]
>**Dictum:** *Peer dependencies enforce compatible runtime.*

<br>

| [INDEX] | [DEPENDENCY]             |    [VERSION] |
| :-----: | ------------------------ | -----------: |
|   [1]   | React                    | 19+ (canary) |
|   [2]   | react-aria               |        3.40+ |
|   [3]   | @radix-ui/react-slot     |         1.1+ |
|   [4]   | class-variance-authority |         0.7+ |
|   [5]   | effect                   |        3.19+ |
|   [6]   | lucide-react             |       0.500+ |
|   [7]   | cmdk                     |         1.0+ |
