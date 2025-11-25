---
name: review-typescript
description: Review code against REQUIREMENTS.md TypeScript standards
---

Review the specified code against REQUIREMENTS.md standards.

## CRITICAL VIOLATIONS (must fix)

| Pattern | Check |
|---------|-------|
| `any` type | Use branded types via @effect/schema |
| `var`/`let` | Use `const` only |
| `if/else` | Use dispatch tables or ternaries |
| `for`/`while` | Use .map/.filter/Effect |
| `try/catch` | Use Effect error channel |
| Scattered constants | Consolidate to single B constant |
| `null`/`undefined` checks | Use Option.match |
| Default exports | Named exports only (except *.config.ts) |

## FILE ORGANIZATION (>50 LOC)

Required section order with 77-char separators:
```typescript
// --- Imports -----------------------------------------------------------------
// --- Type Definitions --------------------------------------------------------
// --- Schema Definitions ------------------------------------------------------
// --- Constants ---------------------------------------------------------------
// --- Pure Utility Functions --------------------------------------------------
// --- Dispatch Tables ---------------------------------------------------------
// --- Effect Pipeline ---------------------------------------------------------
// --- Export ------------------------------------------------------------------
```

## QUALITY METRICS

- Cognitive complexity: ≤25 per function
- Functionality density: 25-30 LOC/feature
- Type coverage: 100%
- NO biome-ignore comments (except `_tag`)

## VERIFICATION

```bash
pnpm typecheck  # Must pass
pnpm check      # Must pass
```
