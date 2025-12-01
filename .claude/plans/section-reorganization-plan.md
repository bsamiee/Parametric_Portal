# SECTION REORGANIZATION PLAN - ROUND 2: Concrete Restructuring Plan

**OBJECTIVE:** Fix section ordering, remove 70 violations, and standardize all section headers to exactly 80 characters across 11 files in `/packages/components/src/`.

**CANONICAL ORDER (MUST FOLLOW):**
1. Types
2. Schema
3. Constants
4. Pure Functions
5. Dispatch Tables
6. Effect Pipeline
7. Entry Point
8. Export

**LINE WIDTH REQUIREMENT:** Exactly 80 chars per section header (including dashes and spaces)

---

## MASTER VIOLATION SUMMARY

| File | Dup EP | Dup DT | Dup PF | Dash Issues | Total |
|------|--------|--------|--------|------------|-------|
| command.ts | 2 | 1 | 2 | 5 | 10 |
| controls.ts | 1 | 0 | 0 | 4 | 5 |
| data.ts | 2 | 1 | 0 | 5 | 8 |
| elements.ts | 1 | 0 | 0 | 4 | 5 |
| feedback.ts | 1 | 0 | 0 | 4 | 5 |
| icons.ts | 1 | 0 | 0 | 4 | 5 |
| navigation.ts | 1 | 1 | 1 | 4 | 7 |
| overlays.ts | 1 | 0 | 0 | 4 | 5 |
| **schema.ts** | **0** | **4** | **2** | **8** | **14** |
| selection.ts | 1 | 0 | 1 | 4 | 6 |
| utility.ts | 1 | 0 | 0 | 3 | 4 |
| **TOTAL** | **12** | **7** | **6** | **45** | **70** |

---

## FILE-BY-FILE RESTRUCTURING PLANS

---

### FILE 1: command.ts

**CURRENT STRUCTURE (VIOLATED):**
```
Lines 19-78:    Types ✓ (correct header)
Lines 81-115:   Pure Functions (DASH: 73, should be 80)
Lines 117-137:  Dispatch Tables (DASH: 72, should be 80)
Lines 139-233:  Dispatch Tables DUPLICATE (DASH: 72) - contains render object
Lines 235-266:  Pure Functions DUPLICATE (DASH: 73) - usePageNav
Lines 268-333:  Pure Functions DUPLICATE (DASH: 73) - ListContent
Lines 335-439:  Entry Point (DASH: 78, should be 80)
Lines 441-453:  Entry Point DUPLICATE (DASH: 78) - createCommand
Lines 455-464:  Export (DASH: 73, should be 80)
```

**VIOLATIONS:** 2 dup EP, 1 dup DT, 2 dup PF, 5 dash issues

**PROPOSED STRUCTURE:**
```
Lines 1-18:     Imports (unchanged)
Lines 19-78:    Types
                // --- Pure Functions --------------------------------------------------
Lines 81-115:   cmd object (helpers)
Lines 238-266:  usePageNav hook
Lines 271-333:  ListContent component
                // --- Dispatch Tables -------------------------------------------------
Lines 117-137:  wrappers, rootStyles, dialogPropsFor
Lines 142-233:  render object
                // --- Entry Point -----------------------------------------------------
Lines 335-428:  mkCmd function
Lines 430-439:  createCmd function
Lines 441-453:  createCommand factory
                // --- Export ------------------------------------------------------------------
Lines 458-464:  exports
```

**SPECIFIC MOVES:**
1. DELETE line 81 header (Pure Functions - incorrect dashes)
2. DELETE line 118 header (Dispatch Tables - incorrect dashes)
3. DELETE line 140 header (DUPLICATE Dispatch Tables)
4. DELETE line 236 header (DUPLICATE Pure Functions)
5. DELETE line 269 header (DUPLICATE Pure Functions)
6. DELETE line 336 header (Entry Point - incorrect dashes)
7. DELETE line 442 header (DUPLICATE Entry Point)
8. DELETE line 456 header (Export - incorrect dashes)
9. ADD new section header after Types (line 78):
   ```
   // --- Pure Functions --------------------------------------------------
   ```
10. ADD new section header before wrappers (line 117):
    ```
    // --- Dispatch Tables -------------------------------------------------
    ```
11. ADD new section header before mkCmd (line 335):
    ```
    // --- Entry Point -----------------------------------------------------
    ```
12. ADD new section header before exports (line 455):
    ```
    // --- Export ------------------------------------------------------------------
    ```

---

### FILE 2: controls.ts

**CURRENT STRUCTURE (VIOLATED):**
```
Lines 13-38:    Types ✓
Lines 41-44:    Pure Functions (DASH: 73)
Lines 47-148:   Entry Point (DASH: 78) - createBtn/Inp/Switch
Lines 150-161:  Dispatch Tables (DASH: 72) - builders, create
Lines 164-175:  Entry Point DUPLICATE (DASH: 78) - createControls
Lines 178:      Export (DASH: 73)
```

**VIOLATIONS:** 1 dup EP, 4 dash issues

**PROPOSED STRUCTURE:**
```
Lines 13-38:    Types
                // --- Pure Functions --------------------------------------------------
Lines 43-44:    baseCls
                // --- Entry Point -----------------------------------------------------
Lines 49-148:   createBtn, createInp, createSwitch (component factories)
Lines 150-161:  builders dispatch table
Lines 160-161:  create function
Lines 166-175:  createControls factory
                // --- Export ------------------------------------------------------------------
Lines 177-178:  exports
```

**SPECIFIC MOVES:**
1. DELETE line 41 header (incorrect dashes)
2. DELETE line 47 header (incorrect dashes)
3. DELETE line 151 header (Dispatch Tables - incorrect dashes) - MERGE with Entry Point
4. DELETE line 164 header (DUPLICATE Entry Point)
5. DELETE line 178 header (Export - incorrect dashes)
6. ADD new section header before baseCls (line 41):
   ```
   // --- Pure Functions --------------------------------------------------
   ```
7. ADD new section header before createBtn (line 49):
   ```
   // --- Entry Point -----------------------------------------------------
   ```
8. ADD new section header before exports (line 177):
   ```
   // --- Export ------------------------------------------------------------------
   ```
9. NOTE: Consolidate builders + create + createControls all under Entry Point

---

### FILE 3: data.ts

**CURRENT STRUCTURE (VIOLATED):**
```
Lines 11-59:    Types ✓
Lines 62-64:    Constants (DASH: 78)
Lines 67-176:   Entry Point (DASH: 78) - mkAvatar/Badge/Card/List (WRONG ORDER)
Lines 179-324:  Pure Functions (DASH: 73) - TColHeader, TRow, TCell, mkTable
Lines 327-427:  Entry Point DUPLICATE (DASH: 78) - mkTable again (ARTIFACT?)
Lines 430-445:  Dispatch Tables (DASH: 72) - builders, createDT
Lines 448-461:  Entry Point DUPLICATE x2 (DASH: 78) - createData
Lines 464:      Export (DASH: 73)
```

**VIOLATIONS:** 2 dup EP, 1 dup DT, 5 dash issues + ORDERING + mkTable duplicate

**CRITICAL ISSUE:** mkTable defined twice (lines 181-324 and 329-427) - MUST CONSOLIDATE

**PROPOSED STRUCTURE:**
```
Lines 11-59:    Types
                // --- Constants -------------------------------------------------------
Lines 61-64:    px, py, dRadius
                // --- Pure Functions --------------------------------------------------
Lines 181-195:  TColHeader function
Lines 197-205:  THeaderRow function
Lines 207-223:  TRow function
Lines 225-234:  TCell function
                // --- Entry Point -----------------------------------------------------
Lines 69-99:    mkAvatar
Lines 101-119:  mkBadge
Lines 121-152:  mkCard
Lines 154-176:  mkList
Lines 181-324:  mkTable (KEEP - remove duplicate 329-427)
Lines 429-436:  builders dispatch
Lines 438-445:  createDT
Lines 450-461:  createData
                // --- Export ------------------------------------------------------------------
Lines 463-464:  exports
```

**SPECIFIC MOVES:**
1. DELETE line 62 header (Constants - incorrect dashes)
2. DELETE line 67 header (Entry Point - incorrect dashes)
3. DELETE line 179 header (Pure Functions - incorrect dashes)
4. DELETE line 327 header (DUPLICATE Entry Point)
5. DELETE line 430 header (Dispatch Tables - incorrect dashes)
6. DELETE line 448 header (DUPLICATE Entry Point)
7. DELETE line 464 header (Export - incorrect dashes)
8. **DELETE lines 329-427 ENTIRELY** (duplicate mkTable definition)
9. ADD new section header after Types (line 59):
   ```
   // --- Constants -------------------------------------------------------
   ```
10. ADD new section header after Constants (line 64):
    ```
    // --- Pure Functions --------------------------------------------------
    ```
11. ADD new section header before mkAvatar (line 67):
    ```
    // --- Entry Point -----------------------------------------------------
    ```
12. ADD new section header before exports (line 463):
    ```
    // --- Export ------------------------------------------------------------------
    ```

---

### FILE 4: elements.ts

**CURRENT STRUCTURE (VIOLATED):**
```
Lines 9-40:     Types ✓
Lines 43-50:    Constants (DASH: 78)
Lines 53-74:    Pure Functions (DASH: 73)
Lines 77-120:   Entry Point (DASH: 78) - createEl, createDivider
Lines 123-132:  Entry Point DUPLICATE (DASH: 78) - createElements
Lines 135:      Export (DASH: 73)
```

**VIOLATIONS:** 1 dup EP, 4 dash issues

**PROPOSED STRUCTURE:**
```
Lines 9-40:     Types
                // --- Constants -------------------------------------------------------
Lines 42-50:    dir, align, justify, wrap, autoFlow, gap, px, py, r
                // --- Pure Functions --------------------------------------------------
Lines 52-74:    flexCls, gridCls, gridStyle, varCls
                // --- Entry Point -----------------------------------------------------
Lines 76-107:   createEl
Lines 109-120:  createDivider
Lines 122-132:  createElements
                // --- Export ------------------------------------------------------------------
Lines 134-135:  exports
```

**SPECIFIC MOVES:**
1. DELETE line 43 header (Constants - incorrect dashes)
2. DELETE line 53 header (Pure Functions - incorrect dashes)
3. DELETE line 77 header (Entry Point - incorrect dashes)
4. DELETE line 123 header (DUPLICATE Entry Point)
5. DELETE line 135 header (Export - incorrect dashes)
6. ADD new section header after Types (line 40):
   ```
   // --- Constants -------------------------------------------------------
   ```
7. ADD new section header before flexCls (line 52):
   ```
   // --- Pure Functions --------------------------------------------------
   ```
8. ADD new section header before createEl (line 76):
   ```
   // --- Entry Point -----------------------------------------------------
   ```
9. ADD new section header before exports (line 134):
   ```
   // --- Export ------------------------------------------------------------------
   ```

---

### FILE 5: feedback.ts

**CURRENT STRUCTURE (VIOLATED):**
```
Lines 7-29:     Types ✓
Lines 32-85:    Entry Point (DASH: 78) - mkAlertBase
Lines 87-91:    mkAlert, mkToast
Lines 93-168:   mkProgress, mkSkeleton, mkSpinner
Lines 171-194:  Dispatch Tables (DASH: 72) - builders, createFB
Lines 197-207:  Entry Point DUPLICATE (DASH: 78) - createFeedback
Lines 210:      Export (DASH: 73)
```

**VIOLATIONS:** 1 dup EP, 4 dash issues

**PROPOSED STRUCTURE:**
```
Lines 7-29:     Types
                // --- Entry Point -----------------------------------------------------
Lines 31-85:    mkAlertBase
Lines 87-88:    mkAlert
Lines 90-91:    mkToast
Lines 93-145:   mkProgress
Lines 147-165:  mkSkeleton
Lines 167-193:  mkSpinner
Lines 195-207:  createFB
Lines 209:      createFeedback
                // --- Dispatch Tables -------------------------------------------------
                (Embed builders dispatch or move to Entry Point)
                // --- Export ------------------------------------------------------------------
Lines 209-210:  exports
```

**SPECIFIC MOVES:**
1. DELETE line 32 header (Entry Point - incorrect dashes)
2. DELETE line 171 header (Dispatch Tables - incorrect dashes)
3. DELETE line 197 header (DUPLICATE Entry Point)
4. DELETE line 210 header (Export - incorrect dashes)
5. ADD new section header before mkAlertBase (line 31):
   ```
   // --- Entry Point -----------------------------------------------------
   ```
6. Consolidate all mk* functions + createFB + createFeedback under Entry Point
7. ADD new section header before exports (line 209):
   ```
   // --- Export ------------------------------------------------------------------
   ```

---

### FILE 6: icons.ts

**CURRENT STRUCTURE (VIOLATED):**
```
Lines 7-20:     Types ✓
Lines 23-25:    Constants (DASH: 78)
Lines 28-72:    Entry Point (DASH: 78) - createIcon, DynamicIcon
Lines 75-87:    Entry Point DUPLICATE (DASH: 78) - createIcons
Lines 90:       Export (DASH: 73)
```

**VIOLATIONS:** 1 dup EP, 4 dash issues

**PROPOSED STRUCTURE:**
```
Lines 7-20:     Types
                // --- Constants -------------------------------------------------------
Lines 22-25:    iconNames, getIcon
                // --- Entry Point -----------------------------------------------------
Lines 27-49:    createIcon
Lines 51-72:    DynamicIcon
Lines 74-87:    createIcons
                // --- Export ------------------------------------------------------------------
Lines 89-90:    exports
```

**SPECIFIC MOVES:**
1. DELETE line 23 header (Constants - incorrect dashes)
2. DELETE line 28 header (Entry Point - incorrect dashes)
3. DELETE line 75 header (DUPLICATE Entry Point)
4. DELETE line 90 header (Export - incorrect dashes)
5. ADD new section header after Types (line 20):
   ```
   // --- Constants -------------------------------------------------------
   ```
6. ADD new section header before createIcon (line 27):
   ```
   // --- Entry Point -----------------------------------------------------
   ```
7. ADD new section header before exports (line 89):
   ```
   // --- Export ------------------------------------------------------------------
   ```

---

### FILE 7: navigation.ts

**CURRENT STRUCTURE (VIOLATED):**
```
Lines 7-45:     Types ✓
Lines 48-51:    Pure Functions (DASH: 73) - range
Lines 54-84:    Dispatch Tables (DASH: 72) - paginationStrategy
Lines 87-145:   Pure Functions DUPLICATE (DASH: 73) - TabComp, TabPanelComp
Lines 148-352:  Entry Point (DASH: 78) - mkTabs, mkBreadcrumb, mkPagination
Lines 355-369:  Dispatch Tables DUPLICATE (DASH: 72) - builders, createNav
Lines 372-381:  Entry Point DUPLICATE (DASH: 78) - createNavigation
Lines 384:      Export (DASH: 73)
```

**VIOLATIONS:** 1 dup EP, 1 dup PF, 1 dup DT, 4 dash issues (ORDERING: DT before first PF)

**PROPOSED STRUCTURE:**
```
Lines 7-45:     Types
                // --- Pure Functions --------------------------------------------------
Lines 47-51:    range
Lines 53-84:    paginationStrategy, computePages
Lines 86-145:   TabComp, TabPanelComp
                // --- Entry Point -----------------------------------------------------
Lines 147-352:  mkTabs, mkBreadcrumb, mkPagination
Lines 354-369:  builders, createNav
Lines 371-381:  createNavigation
                // --- Export ------------------------------------------------------------------
Lines 383-384:  exports
```

**SPECIFIC MOVES:**
1. DELETE line 48 header (Pure Functions - incorrect dashes)
2. DELETE line 54 header (Dispatch Tables - incorrect dashes)
3. DELETE line 87 header (DUPLICATE Pure Functions)
4. DELETE line 148 header (Entry Point - incorrect dashes)
5. DELETE line 355 header (DUPLICATE Dispatch Tables)
6. DELETE line 372 header (DUPLICATE Entry Point)
7. DELETE line 384 header (Export - incorrect dashes)
8. ADD new section header after Types (line 45):
   ```
   // --- Pure Functions --------------------------------------------------
   ```
9. ADD new section header before mkTabs (line 147):
   ```
   // --- Entry Point -----------------------------------------------------
   ```
10. ADD new section header before exports (line 383):
    ```
    // --- Export ------------------------------------------------------------------
    ```

---

### FILE 8: overlays.ts

**CURRENT STRUCTURE (VIOLATED):**
```
Lines 7-36:     Types ✓
Lines 39-42:    Pure Functions (DASH: 73) - focus
Lines 45-342:   Entry Point (DASH: 78) - mkModal, mkDialog, mkDrawer, etc.
Lines 345-365:  Dispatch Tables (DASH: 72) - builders, createOV
Lines 368-390:  Entry Point DUPLICATE (DASH: 78) - createOverlays
Lines 393:      Export (DASH: 73)
```

**VIOLATIONS:** 1 dup EP, 4 dash issues

**PROPOSED STRUCTURE:**
```
Lines 7-36:     Types
                // --- Pure Functions --------------------------------------------------
Lines 38-42:    focus
                // --- Entry Point -----------------------------------------------------
Lines 44-115:   mkModal
Lines 117-186:  mkDialog
Lines 188-248:  mkDrawer
Lines 250-295:  mkPopover
Lines 297-342:  mkTooltip
Lines 344-365:  builders, createOV
Lines 367-390:  createOverlays
                // --- Export ------------------------------------------------------------------
Lines 392-393:  exports
```

**SPECIFIC MOVES:**
1. DELETE line 39 header (Pure Functions - incorrect dashes)
2. DELETE line 45 header (Entry Point - incorrect dashes)
3. DELETE line 345 header (Dispatch Tables - incorrect dashes)
4. DELETE line 368 header (DUPLICATE Entry Point)
5. DELETE line 393 header (Export - incorrect dashes)
6. ADD new section header after Types (line 36):
   ```
   // --- Pure Functions --------------------------------------------------
   ```
7. ADD new section header before mkModal (line 44):
   ```
   // --- Entry Point -----------------------------------------------------
   ```
8. ADD new section header before exports (line 392):
   ```
   // --- Export ------------------------------------------------------------------
   ```

---

### FILE 9: schema.ts (WORST OFFENDER - 238-line B constant)

**CURRENT STRUCTURE (MOST VIOLATED):**
```
Lines 7-24:     Pure Functions (DASH: 73) - rem, optBool, cv, coreVars, mul, add
Lines 27-90:    Schema (DASH: 73) - 5 schema definitions
Lines 93-102:   Dispatch Tables (DASH: 72) - Schemas constant
Lines 105-181:  Dispatch Tables DUPLICATE (DASH: 72) - compute object
Lines 187-427:  Dispatch Tables DUPLICATE x2 (DASH: 72) - B constant (238 LINES!)
Lines 430-451:  Pure Functions DUPLICATE (DASH: 73) - fn utilities
Lines 454-471:  Dispatch Tables DUPLICATE x3 (DASH: 72) - stateCls
Lines 473-485:  Pure Functions DUPLICATE x2 (DASH: 73) - useForwardedRef, useCollectionEl
Lines 487:      Export incomplete
```

**VIOLATIONS:** 4 dup DT, 2 dup PF, 8 dash issues + MASSIVE disorder

**CRITICAL ISSUE:** B constant is 238 lines (186-427) - MUST KEEP TOGETHER

**PROPOSED STRUCTURE:**
```
Lines 1-9:      Imports (unchanged)
                // --- Pure Functions --------------------------------------------------
Lines 11-24:    rem, optBool, DIS, LOAD, cv, coreVars, mul, add
                // --- Schema ------------------------------------------------------------------
Lines 26-90:    ScaleSchema, BehaviorSchema, OverlaySchema, FeedbackSchema, AnimationSchema
                // --- Dispatch Tables -------------------------------------------------
Lines 92-102:   Schemas constant + types
Lines 104-181:  compute object
Lines 183-427:  B constant (KEEP TOGETHER - 244 lines)
Lines 429-451:  fn utilities
Lines 453-471:  stateCls dispatch
                // --- Pure Functions --------------------------------------------------
Lines 473-485:  useForwardedRef, useCollectionEl
                // --- Export ------------------------------------------------------------------
Lines 487-end:  exports
```

**SPECIFIC MOVES:**
1. DELETE line 8 header (Pure Functions - incorrect dashes)
2. DELETE line 27 header (Schema - incorrect dashes)
3. DELETE line 93 header (Dispatch Tables - incorrect dashes)
4. DELETE line 105 header (DUPLICATE Dispatch Tables)
5. DELETE line 187 header (DUPLICATE Dispatch Tables)
6. DELETE line 430 header (DUPLICATE Pure Functions)
7. DELETE line 454 header (DUPLICATE Dispatch Tables)
8. DELETE line 474 header (DUPLICATE Pure Functions)
9. ADD new section header before rem (line 10):
   ```
   // --- Pure Functions --------------------------------------------------
   ```
10. ADD new section header before PositiveSchema (line 26):
    ```
    // --- Schema ------------------------------------------------------------------
    ```
11. ADD new section header before Schemas constant (line 92):
    ```
    // --- Dispatch Tables -------------------------------------------------
    ```
12. ADD new section header before useForwardedRef (line 473):
    ```
    // --- Pure Functions --------------------------------------------------
    ```
13. ADD new section header at very end (after useCollectionEl):
    ```
    // --- Export ------------------------------------------------------------------
    ```
14. CONSOLIDATE all exports at end

---

### FILE 10: selection.ts

**CURRENT STRUCTURE (VIOLATED):**
```
Lines 7-48:     Types ✓
Lines 51-138:   Pure Functions (DASH: 73) - Option, MenuItemComp, SectionComp
Lines 141-173:  Pure Functions DUPLICATE (DASH: 73) - isSection, buildItems, etc.
Lines 176-421:  Entry Point (DASH: 78) - mkMenu, mkSelect, mkCombobox
Lines 424-428:  Dispatch Tables (DASH: 72) - K, builders, createSel
Lines 431-441:  Entry Point DUPLICATE (DASH: 78) - createSelection
Lines 444:      Export (DASH: 73)
```

**VIOLATIONS:** 1 dup EP, 1 dup PF, 4 dash issues

**PROPOSED STRUCTURE:**
```
Lines 7-48:     Types
                // --- Pure Functions --------------------------------------------------
Lines 50-138:   Option, MenuItemComp, SectionComp
Lines 140-173:  isSection, buildItems, buildSections, dropdownCls, baseStyle
                // --- Entry Point -----------------------------------------------------
Lines 175-421:  mkMenu, mkSelect, mkCombobox
Lines 423-428:  K, builders, createSel
Lines 430-441:  createSelection
                // --- Export ------------------------------------------------------------------
Lines 443-444:  exports
```

**SPECIFIC MOVES:**
1. DELETE line 51 header (Pure Functions - incorrect dashes)
2. DELETE line 141 header (DUPLICATE Pure Functions)
3. DELETE line 176 header (Entry Point - incorrect dashes)
4. DELETE line 424 header (Dispatch Tables - incorrect dashes)
5. DELETE line 431 header (DUPLICATE Entry Point)
6. DELETE line 444 header (Export - incorrect dashes)
7. ADD new section header after Types (line 48):
   ```
   // --- Pure Functions --------------------------------------------------
   ```
8. ADD new section header before mkMenu (line 175):
   ```
   // --- Entry Point -----------------------------------------------------
   ```
9. ADD new section header before exports (line 443):
   ```
   // --- Export ------------------------------------------------------------------
   ```

---

### FILE 11: utility.ts

**CURRENT STRUCTURE (VIOLATED):**
```
Lines 7-18:     Types ✓
Lines 21-42:    Entry Point (DASH: 78) - createScrollArea
Lines 45-51:    Entry Point DUPLICATE (DASH: 78) - createUtility
Lines 54:       Export (DASH: 73)
```

**VIOLATIONS:** 1 dup EP, 3 dash issues

**PROPOSED STRUCTURE:**
```
Lines 7-18:     Types
                // --- Entry Point -----------------------------------------------------
Lines 20-42:    createScrollArea
Lines 44-51:    createUtility
                // --- Export ------------------------------------------------------------------
Lines 53-54:    exports
```

**SPECIFIC MOVES:**
1. DELETE line 21 header (Entry Point - incorrect dashes)
2. DELETE line 45 header (DUPLICATE Entry Point)
3. DELETE line 54 header (Export - incorrect dashes)
4. ADD new section header after Types (line 18):
   ```
   // --- Entry Point -----------------------------------------------------
   ```
5. ADD new section header before exports (line 53):
   ```
   // --- Export ------------------------------------------------------------------
   ```

---

## SECTION HEADER REFERENCE

Each header MUST be exactly 80 characters:

```
// --- Types -------------------------------------------------------------------
// --- Schema ------------------------------------------------------------------
// --- Constants ---------------------------------------------------------------
// --- Pure Functions --------------------------------------------------
// --- Dispatch Tables -------------------------------------------------
// --- Effect Pipeline -------------------------------------------------
// --- Entry Point ---------------------------------------------------
// --- Export ------------------------------------------------------------------
```

**VERIFICATION:** Count dashes in each header:
- `// --- ` = 7 chars
- Label = varies
- Total dashes = 80 - 7 - len(label) - 1 space before dashes

Examples:
- "Types" (5 chars) + space = 6 → 80 - 7 - 6 = 67 dashes
- "Schema" (6 chars) + space = 7 → 80 - 7 - 7 = 66 dashes
- "Pure Functions" (14 chars) + space = 15 → 80 - 7 - 15 = 58 dashes
- "Entry Point" (11 chars) + space = 12 → 80 - 7 - 12 = 61 dashes

---

## EXECUTION CHECKLIST

**BEFORE STARTING:**
- [ ] All files read and analyzed
- [ ] 70 violations identified
- [ ] Line-by-line restructuring plan created (THIS DOCUMENT)

**FOR EACH FILE (in order):**
1. [ ] schema.ts - highest complexity (4 dup DT, 2 dup PF)
2. [ ] command.ts - high complexity (2 dup EP, 2 dup PF, 1 dup DT)
3. [ ] data.ts - high complexity (2 dup EP, 1 dup DT, mkTable duplicate)
4. [ ] navigation.ts - medium complexity
5. [ ] selection.ts - medium complexity
6. [ ] controls.ts - medium complexity
7-11. [ ] overlays, elements, feedback, icons, utility - low complexity

**AFTER EACH FILE:**
1. Run `pnpm typecheck` → zero errors
2. Run `pnpm check` → zero Biome violations
3. Verify canonical order in file
4. Verify all section headers are 80 chars
5. Verify imports/exports unchanged
6. Commit: `fix: reorganize sections in [filename] per canonical order`

**FINAL VERIFICATION:**
- [ ] All 11 files processed
- [ ] All 70 violations resolved
- [ ] All section headers are 80 chars
- [ ] Canonical order in all files
- [ ] All tests pass
- [ ] All type checks pass

---

**PLAN STATUS:** Ready for implementation
