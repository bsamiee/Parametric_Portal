# Components Roadmap

## Phase 2: Critical Components (HIGH Priority)

### overlays.ts
- `Modal` - Focus-trapped, keyboard-dismissible, backdrop
- `Dialog` - Confirmation dialogs with action buttons
- `Popover` - Positioned floating content (Radix)
- `Tooltip` - Hover/focus hints with delay
- `Drawer` - Slide-in panels (left/right/bottom)
- `Sheet` - Mobile-first bottom sheets

### forms.ts
- `Select` - Single/multi selection (cmdk integration)
- `Combobox` - Searchable select with typeahead
- `Slider` - Range input with marks/steps
- `Switch` - Binary toggle (animated)
- `RadioGroup` - Exclusive selection group
- `Checkbox` - Styled tri-state checkbox

### feedback.ts
- `Toast` - Auto-dismiss notifications (stacked)
- `Progress` - Linear/circular progress indicators
- `Spinner` - Loading spinners (size variants)
- `Skeleton` - Content placeholder animations
- `Alert` - Inline status messages (info/warn/error/success)

### data.ts
- `Table` - Sortable, paginated (@tanstack/react-table)
- `List` - Virtualized lists (@tanstack/react-virtual)
- `Card` - Content container with header/footer
- `Badge` - Status indicators
- `Avatar` - User avatars with fallback

## Phase 3: Extended Components (MEDIUM Priority)

### navigation.ts
- `Tabs` - Tabbed content panels
- `Breadcrumb` - Navigation hierarchy
- `Pagination` - Page controls
- `Menu` - Action menus (keyboard nav)
- `DropdownMenu` - Contextual menus

### typography.ts
- `Heading` - h1-h6 with semantic scale
- `Text` - Body text variants
- `Label` - Form labels (required indicator)
- `Code` - Inline/block code
- `Kbd` - Keyboard shortcuts

### layout.ts
- `Divider` - Horizontal/vertical separators
- `Grid` - CSS Grid with responsive breakpoints
- `AspectRatio` - Fixed aspect containers

### utility.ts
- `Portal` - Render outside DOM tree
- `VisuallyHidden` - Accessible hidden content
- `FocusTrap` - Focus containment
- `ScrollArea` - Custom scrollbars

## Schema Extensions Needed
- `OverlaySchema` - open/close, backdrop, animation
- `AnimationSchema` - duration, easing, motion
- `ColorSchema` - semantic tokens (primary/secondary/destructive)
- `TypographySchema` - font scale, line-height
