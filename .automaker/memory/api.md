---
tags: [api]
summary: api implementation decisions and patterns
relevantTo: [api]
importance: 0.7
relatedFiles: []
usageStats:
  loaded: 3
  referenced: 2
  successfulFeatures: 2
---
# api

### Minimalist public API export strategy - only export useToast hook and ToastConfig type, keeping all internal types and utilities private (2026-01-12)
- **Context:** Toast module had 8 exports including internal constants (B, ConfigResolver, globalQueue, POSITION_STYLES) and 5 type exports that consumers don't directly use
- **Why:** Reduces cognitive load on consumers and prevents them from depending on implementation details that should be encapsulated. Matches established pattern in floating.tsx (useTooltip + TooltipConfig only). Internal consumers access what they need within the module; external consumers only need the hook and its configuration shape
- **Rejected:** Exporting all types and constants for 'flexibility' or 'in case consumers need them' - this violates single responsibility and creates maintenance burden when refactoring internals
- **Trade-offs:** Easier: Consumers have clear contract; easier to refactor internals without breaking external code. Harder: Consumers can't directly inspect internal positioning types or override internal utilities directly (but they shouldn't need to)
- **Breaking if changed:** If external code depends on TOAST_TUNING, ConfigResolver, globalQueue, POSITION_STYLES, or the exported types (ToastPayload, ToastPosition, ToastResult, ToastType), they will break. However, grep showed these are only used internally within toast.tsx, indicating they weren't actually being consumed externally

### Spy's assertCalledWith() accepts variadic arguments to match flexible call patterns, not a single array parameter (2026-01-12)
- **Context:** Services get called with varying numbers of arguments. API design choice between assertCalledWith([...args]) vs assertCalledWith(...args)
- **Why:** Variadic signature assertCalledWith(method, arg1, arg2) reads more naturally at call sites and matches Jest/Vitest assertion patterns. Consumers expect (method, ...expectedArgs) not (method, [expectedArgs])
- **Rejected:** Single array parameter assertCalledWith(method, [...args]) would be more uniform but less readable and breaks user familiarity with standard assertion libraries
- **Trade-offs:** Variadic signature requires spread operator in internal implementation but provides better DX at call sites
- **Breaking if changed:** If changed to array parameter, all existing assertCalledWith() calls would break