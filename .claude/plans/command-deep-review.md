# Ultra-Deep Review: command.ts & schema.ts
## Hardcoded Values, Schema Misalignment, and Architectural Issues

**Review Date:** 2025-11-27  
**Files Analyzed:** 
- `/packages/components/src/command.ts` (391 lines)
- `/packages/components/src/schema.ts` (577 lines)

---

## ISSUES IDENTIFIED

### CRITICAL SEVERITY

#### 1. **Hardcoded UI Strings - NOT PARAMETRIC** 
**Locations & Impact:** 
- **Line 187:** `loadingContent ?? 'Loading...'` - Default loading message hard-coded
- **Line 190:** `'No results found.'` - Empty state message hard-coded
- **Lines 212, 262, 306:** `label = 'Command Menu'` - Default label hard-coded (duplicated 3x across mkPalette, mkInline, mkDialog)
- **Line 217:** `placeholder = 'Type a command or search...'` - Palette placeholder hard-coded
- **Line 267:** `placeholder = 'Search...'` - Inline placeholder hard-coded
- **Line 314:** `placeholder = 'Type a command or search...'` - Dialog placeholder hard-coded (duplicate of line 217)

**Why Critical:** These strings violate the "ALL code MUST be parametric" principle. They should be:
1. Defined in `B.cmd` object for single source of truth
2. Exposed as configurable tuning options via schema extension
3. Localization-friendly (i18n incompatible currently)

**Proposed Fix:**
```typescript
// In schema.ts - Add to B.cmd or create B.cmd.strings
const B = Object.freeze({
    cmd: {
        strings: {
            loading: 'Loading...',
            empty: 'No results found.',
            menuLabel: 'Command Menu',
            palettePlaceholder: 'Type a command or search...',
            inlinePlaceholder: 'Search...',
        },
        // ... rest
    }
});

// Then in command.ts use B.cmd.strings.loading instead of string literal
loadingContent ?? B.cmd.strings.loading
```

**Severity Justification:** Violates core "Single B Constant" pattern; prevents localization; creates three different defaults for same concept.

---

#### 2. **Inconsistent Default Placeholders - Three Different Strings for Similar Purpose**
**Locations:**
- Line 217 (Palette): `'Type a command or search...'`
- Line 267 (Inline): `'Search...'`
- Line 314 (Dialog): `'Type a command or search...'` (duplicates line 217!)

**Why Critical:** Same component type (palette vs dialog) has identical placeholders but inline is different. Violates DRY and creates maintenance burden.

**Impact:** If you need to change messaging, you must update 3 places. Dialog and Palette already duplicate.

**Proposed Fix:** Create placeholder compute function in schema.ts:
```typescript
// In compute dispatch table
cmdPalettePlaceholder: () => 'Type a command or search...',
cmdInlinePlaceholder: () => 'Search...',
```

Then expose via new schema field or use B.cmd directly.

---

### HIGH SEVERITY

#### 3. **Unused Schema Features - behavior Schema NOT Leveraged**
**Location:** `schema.ts` lines 38-47

**Defined but Unused in command.ts:**
- `disabled` - BehaviorSchema has this, not passed to mkPalette/mkInline/mkDialog
- `readonly` - Defined in schema, never used
- `loading` - In behavior schema but command.ts uses own `loading` prop
- `asChild` - Defined but no polymorphic child variant support
- `focusable` - Schema defined, no implementation
- `interactive` - Defined, no reactive binding

**Why High:** Schema design suggests command should support `behavior` tuning (line 369 passes `'behavior'` to createBuilderContext), but implementation ignores most behavior fields.

**Current Implementation vs. Schema Intent:**
```typescript
// Line 369 - CREATES behavior context
const ctx = createBuilderContext('cmd', ['animation', 'behavior', 'overlay'] as const, i);

// But mkPalette/mkInline/mkDialog IGNORE behavior except indirectly:
// Line 442 in schema.ts - only checks disabled/loading:
cmd: (b) => fn.cls(b.disabled ? B.cmd.state.disabled : undefined, b.loading ? B.cmd.state.loading : undefined),

// Lines 212-222, 262-271, 306-319 - hardcode 'disabled' and 'loading' as props, don't use ctx.behavior
```

**Proposed Refactor:**
- Move `loading` prop sourcing from `ctx.behavior.loading` 
- Use `ctx.behavior.disabled` to disable command palette
- Support `asChild` mode for polymorphic rendering

---

#### 4. **Hardcoded Default Values NOT Computed from Algo Constants**
**Locations:**
- Line 215: `loop = true` - Hard-coded default
- Line 218: `shouldFilter = true` - Hard-coded default
- Line 265: `loop = true` - Duplicate
- Line 268: `shouldFilter = true` - Duplicate
- Line 309: `loop = true` - Triplicate!
- Line 315: `shouldFilter = true` - Triplicate!

**Why High:** These are business logic defaults that should be:
1. Single source of truth in `B.cmd`
2. Potentially scale-sensitive or tuning-dependent
3. Parametric via CommandInput

**Duplication Count:** Each default appears **3 times** (once per builder: palette, inline, dialog)

**Proposed Fix:**
```typescript
// In B.cmd defaults object
const B = Object.freeze({
    cmd: {
        defaults: {
            loop: true,
            shouldFilter: true,
            loading: false,
        },
    }
});

// Then in each builder:
const {
    loop = B.cmd.defaults.loop,
    shouldFilter = B.cmd.defaults.shouldFilter,
} = props;
```

---

#### 5. **Overlay Classes in mkDialog - Hardcoded Position Classes**
**Location:** Lines 332-339

```typescript
overlayClassName: fn.cls(
    B.ov.pos.top,      // 'inset-x-0 top-0'
    B.ov.pos.bottom,    // 'inset-x-0 bottom-0'
    B.ov.pos.left,      // 'inset-y-0 left-0'
    B.ov.pos.right,     // 'inset-y-0 right-0'
    B.ov.backdrop,
    overlayClassName,
),
```

**Issue:** Applies ALL FOUR position classes (top, bottom, left, right) simultaneously. This creates conflicting CSS:
- `top-0` and `bottom-0` both apply (full height)
- `left-0` and `right-0` both apply (full width)
- CSS wins by last-specified, but it's semantically wrong

**Why High:** 
1. Inefficient CSS output
2. If ever css class order changes, behavior breaks
3. Should apply only relevant position OR use dialog's inherent fullscreen positioning
4. Violates principle of "single source of truth" for overlay positioning

**Proposed Fix:**
```typescript
// Option A: Let dialog handle its own positioning, use minimal overlay classes
overlayClassName: fn.cls(B.ov.backdrop, overlayClassName),

// Option B: If positioning needed, create specific dialog overlay class
overlayClassName: fn.cls(B.ov.dialogOverlay, overlayClassName),
// Where B.ov.dialogOverlay = 'fixed inset-0'
```

**Current B.ov.pos structure:** (schema.ts lines 382-387)
```typescript
pos: {
    bottom: 'inset-x-0 bottom-0',
    left: 'inset-y-0 left-0',
    right: 'inset-y-0 right-0',
    top: 'inset-x-0 top-0',
}
```

The class set is designed for Drawer/Popover positioning (one side), not full overlay.

---

#### 6. **Missing CommandInput Extension for Strings/Defaults**
**Location:** Lines 53-57 (CommandInput type)

**Current:**
```typescript
type CommandInput<T extends CommandType = 'palette'> = Partial<TuningFor<'cmd'>> & {
    readonly className?: string;
    readonly scale?: Inputs['scale'];
    readonly type?: T;
};
```

**Missing:** No way to override default strings, no way to set loop/shouldFilter via input config.

**Why High:** Violates DRY - defaults are magic values, not configurable. Compare with:
- `OverlayInput` (overlays.ts line 26-32) - has `animation`, `overlay`, `scale` as explicit options
- `createCommand` factory (line 378) - only passes `TuningFor<'cmd'>` which doesn't include text customization

**Proposed Addition:**
```typescript
type CommandInput<T extends CommandType = 'palette'> = Partial<TuningFor<'cmd'>> & {
    readonly className?: string;
    readonly loop?: boolean;
    readonly shouldFilter?: boolean;
    readonly scale?: Inputs['scale'];
    readonly type?: T;
    readonly strings?: Partial<{
        loading: ReactNode;
        empty: ReactNode;
        menuLabel: string;
        placeholder: string;
    }>;
};
```

---

### MEDIUM SEVERITY

#### 7. **Unused Compute Functions - Schema Has Many, Command Uses Few**
**Location:** `schema.ts` lines 96-137 (compute dispatch table)

**Computed values defined but NOT used in command.ts:**
- `badgePaddingX`, `badgePaddingY` - Badge component
- `dialogMaxWidth` - Might be relevant for mkDialog content (line 183: `B.cmd.dialog.content` hardcodes width)
- `dropdownGap`, `dropdownMaxHeight` - Dropdown/menu
- `ellipsisPadding` - Element utility
- `iconSize` - Used in schema but not exposed in command styling
- `listSpacing` - Could apply to group spacing
- `minButtonWidth` - Controls
- `modalMaxWidth` - Overlays
- `popoverOffset`, `tooltipOffset` - Positioning
- `separatorSpacing`, `skeletonSpacing` - Data/feedback
- `triggerMinWidth` - Controls

**Command.ts Uses:** Only cmd-prefixed:
- `cmdEmptyPaddingY` → `emptyPy` (line 69)
- `cmdHeadingPaddingX` → `headingPx` (line 69)
- `cmdHeadingPaddingY` → `headingPy` (line 69)
- `cmdInputHeight` → `inputH` (line 69)
- `cmdItemHeight` → `itemH` (line 69)
- `cmdListMaxHeight` → `listMaxH` (line 69)
- `cmdListMinHeight` → `listMinH` (line 69)
- `cmdShortcutPaddingX` → `shortcutPx` (line 69)
- `cmdShortcutPaddingY` → `shortcutPy` (line 69)
- `cmdSmallFontSize` → `smFs` (line 69)
- `cmdXsFontSize` → `xsFs` (line 69)

**Observation:** This is actually CORRECT - command.ts only uses command-specific computed values. Issue is design clarity - compute table is global but only subset used per component.

**Action:** LOW priority - this is working as designed. Document in schema.ts which compute values apply to which components.

---

#### 8. **Type Redundancy - ItemData/GroupData/PageData Could Be More Generic**
**Location:** Lines 10-32 (command.ts)

**Current Duplication:**
```typescript
type ItemData = { readonly key: string; readonly label: ReactNode; ... };
type GroupData = { readonly key: string; readonly items: ReadonlyArray<ItemData>; ... };
type PageData = { readonly key: string; readonly items?: ReadonlyArray<ItemData>; ... };
```

Each has `key: string`. Could be abstracted:
```typescript
type Keyed = { readonly key: string };
type ItemData = Keyed & { readonly label: ReactNode; ... };
type GroupData = Keyed & { readonly items: ReadonlyArray<ItemData>; ... };
type PageData = Keyed & { readonly items?: ReadonlyArray<ItemData>; ... };
```

**Or use const generic for key type:**
```typescript
type Keyed<K extends string = string> = { readonly key: K };
```

**Why Medium:** Minor type cleanup. Doesn't affect runtime. Pure code smell.

---

#### 9. **Duplicate Default Assignment Pattern - Multiple Builders**
**Locations:** Lines 212, 217-218, 262, 267-268, 306, 314-315

**Pattern:** Each builder (mkPalette, mkInline, mkDialog) repeats:
```typescript
const {
    label = 'Command Menu',
    placeholder = 'X...',
    shouldFilter = true,
    loop = true,
} = props;
```

**Why Medium:** Violates DRY. Not critical since builders differ in placeholder text, but creates 3 nearly-identical default blocks.

**Proposed Solution:** Extract shared defaults to builder factory:
```typescript
const mkBuilder = (builderType: CommandType, defaults: Pick<BaseProps, 'label' | 'loop' | 'shouldFilter'>) =>
    (i: CommandInput, ctx: Ctx) =>
        forwardRef((props: BaseProps, fRef) => {
            const { ...rest } = { ...defaults, ...props };
            // common setup
        });
```

---

#### 10. **Missing Empty State - No Skeleton/Loading UI Alternative**
**Location:** Lines 184-190 (ListContent)

**Current Implementation:**
```typescript
loading
    ? createElement(Cmdk.Loading, { className: fn.cls(B.cmd.loading.base, emptyPy) }, loadingContent ?? 'Loading...')
    : null,
```

**Issue:** Loading state shows loading text overlay, but no skeleton structure for better UX. Schema supports feedback patterns that could show progres/skeleton.

**Why Medium:** Not breaking, but reduces UX polish. Compare with overlays.ts which has no loading state at all.

**Proposed:** Could add skeleton mode:
```typescript
const { loadingMode = 'text', loadingContent } = props; // 'text' | 'skeleton'
```

---

#### 11. **createCommand Factory - Missing Preset Variants**
**Location:** Lines 378-385

**Current:**
```typescript
const createCommand = (tuning?: TuningFor<'cmd'>) =>
    Object.freeze({
        create: <T extends CommandType>(i: CommandInput<T>) => ...,
        Dialog: createCmd({ type: 'dialog', ...pick(tuning, K) }),
        Inline: createCmd({ type: 'inline', ...pick(tuning, K) }),
        Palette: createCmd({ type: 'palette', ...pick(tuning, K) }),
    });
```

**Comparison to createOverlays pattern** (overlays.ts 338-351):
```typescript
const createOverlays = (tuning?: TuningFor<'ov'>) =>
    Object.freeze({
        create: <T extends OverlayType>(i: OverlayInput<T>) => createOV({ ...i, ...merged(tuning, i, K) }),
        Dialog: createOV({ type: 'dialog', ...pick(tuning, K) }),
        Drawer: createOV({ type: 'drawer', ...pick(tuning, K) }),
        Modal: createOV({ type: 'modal', ...pick(tuning, K) }),
        Popover: createOV({ type: 'popover', ...pick(tuning, K) }),
        Sheet: createOV({ type: 'sheet', ...pick(tuning, ['animation', 'scale']), overlay: { ...tuning?.overlay, position: 'bottom' } }),
        Tooltip: createOV({ type: 'tooltip', ...pick(tuning, ['scale']) }),
    });
```

**Inconsistency:** 
- `createCommand.create` uses `merged(tuning, i, K)` (line 381)
- `createCommand.Dialog/Inline/Palette` use bare `pick(tuning, K)` (lines 382-384)
- `createOverlays.Sheet` has special handling with `overlay` merge (line 348)

**Why Medium:** Inconsistent patterns between similar factories. Sheet variant shows better pattern where overlay can be overridden.

**Proposed Alignment:**
```typescript
const createCommand = (tuning?: TuningFor<'cmd'>) =>
    Object.freeze({
        create: <T extends CommandType>(i: CommandInput<T>) =>
            createCmd({ ...i, ...merged(tuning, i, K) } as CommandInput<T>),
        // Pre-built with tuning applied
        Dialog: createCmd({ type: 'dialog', ...pick(tuning, K) } as CommandInput<'dialog'>),
        Inline: createCmd({ type: 'inline', ...pick(tuning, K) } as CommandInput<'inline'>),
        Palette: createCmd({ type: 'palette', ...pick(tuning, K) } as CommandInput<'palette'>),
    });
```

This is actually correct! No issue here.

---

### LOW SEVERITY

#### 12. **Vim Bindings - Hardcoded Keys Not Configurable**
**Location:** Lines 103-104 (usePageNav)

```typescript
const down = vimBindings && e.key === 'j' && e.ctrlKey;
const up = vimBindings && e.key === 'k' && e.ctrlKey;
```

**Issue:** Vim binding keys (j/k) are hard-coded. No way to customize to other keybindings.

**Why Low:** Niche feature. Works as intended for Vim users. Could be parameterized but not urgent.

**Proposed:** Optional keybinding override:
```typescript
type VimBindings = { down: string; up: string } | boolean;
const usePageNav = (vimBindings?: VimBindings): Nav => {
    const bindings = typeof vimBindings === 'object' ? vimBindings : { down: 'j', up: 'k' };
    const down = vimBindings && e.key === bindings.down && e.ctrlKey;
    // ...
};
```

---

#### 13. **Hardcoded Stack Initialization - 'home' Magic String**
**Location:** Line 94 (usePageNav)

```typescript
const [stack, setStack] = useState<ReadonlyArray<string>>(['home']);
```

**Issue:** Default page 'home' is hard-coded. Should be configurable or come from pages array.

**Why Low:** Reasonable convention. But violates parametric principle slightly.

**Proposed:** Accept as prop:
```typescript
const usePageNav = (vimBindings?: boolean, initialPage = 'home'): Nav => {
```

---

#### 14. **dispatchKey Utility - Undocumented Implementation**
**Location:** Line 86

```typescript
const dispatchKey = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key }));
```

**Issue:** Uses `document.dispatchEvent` which is low-level and might not work with all event listeners. KeyboardEvent constructor options incomplete (missing bubbles, cancelable, etc.)

**Why Low:** Works in practice for Cmdk.Item navigation. But architecturally weak.

**Proposed:** Extend with standard options:
```typescript
const dispatchKey = (key: string) => 
    document.dispatchEvent(new KeyboardEvent('keydown', { 
        key, 
        bubbles: true, 
        cancelable: true 
    }));
```

---

## SUMMARY TABLE

| Severity | Count | Issues |
|----------|-------|--------|
| CRITICAL | 3 | Hardcoded strings (5 locations), Inconsistent placeholders, Unused behavior schema |
| HIGH | 3 | Hardcoded loop/shouldFilter defaults (9 locations), Overlay class conflicts, Missing CommandInput fields |
| MEDIUM | 2 | Type redundancy, Duplicate default patterns |
| LOW | 3 | Vim binding keys hardcoded, 'home' magic string, dispatchKey implementation |

**Total Issues:** 11 distinct issues across 14 locations

---

## REFACTORING PRIORITY (Recommended Order)

### Phase 1: CRITICAL (High Impact, Medium Effort)
1. **Extract hardcoded strings to B.cmd.strings**
   - Estimated effort: 30 min
   - Impact: Unblocks localization, single source of truth
   - Files: schema.ts, command.ts

2. **Create B.cmd.defaults for loop/shouldFilter**
   - Estimated effort: 20 min
   - Impact: DRY, eliminates 9 duplicate assignments
   - Files: schema.ts, command.ts

3. **Expose behavior schema fields in command builders**
   - Estimated effort: 45 min
   - Impact: Complete schema utilization
   - Files: command.ts

### Phase 2: HIGH (Medium Impact, Medium Effort)
4. **Fix overlay class conflicts in mkDialog**
   - Estimated effort: 15 min
   - Impact: CSS efficiency, semantic correctness
   - Files: command.ts

5. **Extend CommandInput type for config**
   - Estimated effort: 25 min
   - Impact: API completeness, matches OverlayInput pattern
   - Files: command.ts

### Phase 3: MEDIUM (Low Impact, Low Effort)
6. **Refactor default assignment pattern**
   - Estimated effort: 40 min
   - Impact: DRY code, maintainability
   - Files: command.ts

7. **Improve type definitions with Keyed base**
   - Estimated effort: 20 min
   - Impact: Code elegance
   - Files: command.ts

### Phase 4: NICE-TO-HAVE (Low Impact, Variable Effort)
8. Parameterize vim binding keys
9. Make initial page configurable
10. Improve dispatchKey implementation
11. Add skeleton loading state

---

## DETAILED CODE LOCATIONS REFERENCE

### Lines with Hardcoded Values
- **187:** `'Loading...'` - Loading default
- **190:** `'No results found.'` - Empty default
- **212, 262, 306:** `'Command Menu'` - Label defaults (3x)
- **217, 314:** `'Type a command or search...'` - Palette placeholder (2x)
- **267:** `'Search...'` - Inline placeholder
- **215, 265, 309:** `loop = true` - Loop default (3x)
- **218, 268, 315:** `shouldFilter = true` - Filter default (3x)
- **94:** `['home']` - Stack init
- **103-104:** `'j'`, `'k'` - Vim keys
- **332-339:** Overlay position classes (all 4 applied)

### Schema Coverage Analysis
**B.cmd defined but not used by command.ts:**
- `B.cmd.dialog.content` - Used in className, not width control
- `B.ov.pos.*` - Misused (all 4 positions applied simultaneously)
- `B.cmd.separator` - No separator support in command
- `B.cmd.state.loading` - Defined, command uses inline `loadingContent`

**Behavior schema features unused:**
- `behavior.disabled` - Not connected
- `behavior.readonly` - Not used
- `behavior.asChild` - Not supported
- `behavior.focusable` - Not implemented
- `behavior.interactive` - Not reactive

---

## ACCEPTANCE CRITERIA FOR FIXES

Each fix should satisfy:
1. ✅ String moved to B constant
2. ✅ No string duplication across builders
3. ✅ CommandInput accepts all configurable values
4. ✅ Default values sourced from B.cmd
5. ✅ Context fields utilized (ctx.behavior, ctx.animation, ctx.overlay)
6. ✅ CSS classes applied efficiently (no conflicting positions)
7. ✅ Types match schema.ts patterns
8. ✅ Factory pattern consistent with createOverlays

---

## DOGMATIC PRINCIPLES VIOLATIONS

**Violated CLAUDE.md principles:**
1. **Algorithmic & Parameterized** - Hardcoded strings, defaults
2. **DRY** - Duplicated placeholders, defaults, builder patterns
3. **Single B Constant** - UI strings outside B object
4. **Expression-Based** - Most violations use valid patterns
5. **Polymorphic & Type-Safe** - CommandInput missing fields vs OverlayInput

**Compliant aspects:**
- ✅ No `any` types
- ✅ No imperative loops
- ✅ No mutations (Object.freeze used)
- ✅ Effect/Option patterns not applicable here
- ✅ Strong TypeScript usage

