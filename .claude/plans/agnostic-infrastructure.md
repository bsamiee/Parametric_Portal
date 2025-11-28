# Plan: Agnostic Infrastructure for Cross-Repository Transfer

**Created**: 2025-11-28
**Updated**: 2025-11-28
**Reference**: `docs/PORTAL-ARSENAL-COMPARISON.md`
**Goal**: Make Portal's `.github/scripts/` infrastructure repository-agnostic for transfer to Arsenal

---

## Current State Analysis

### LOC Distribution (1919 total across 10 files)

| File | LOC | Primary B Dependencies |
|------|-----|------------------------|
| schema.ts | 873 | Core definitions |
| dashboard.ts | 307 | B.dashboard, B.gen, B.api, B.time, fn.* |
| probe.ts | 201 | B.probe, B.gen, fn.* |
| report.ts | 131 | B.content, B.thresholds, fn.* |
| gate.ts | 93 | B.gating, B.algo, B.defaults.spec, fn.* |
| release.ts | 87 | B.types, B.typeOrder, B.bump, B.release, fn.* |
| env.ts | 75 | ENV definitions |
| pr-meta.ts | 68 | B.types, B.pr |
| review.ts | 57 | B.reports, B.alerts.quality, fn.* |
| failure-alert.ts | 41 | B.alerts, fn.* |

### Redundancies Identified

1. **Duplicate defaults pattern (2 places)**
   - `schema.ts:217` - `B.defaults.spec.gating: { check, migrate, title }`
   - `schema.ts:250` - `B.gating.defaults: { check, marker, migrationLabels, migrationPattern, title }`
   - SAME VALUES duplicated → ~10 LOC redundant

2. **SpecRegistry type system - 100+ LOC of complex types barely used**
   - Only `report.ts` uses these types with 5+ type casts
   - Types don't provide safety, just complexity
   - Impact: ~110 LOC → ~30 LOC possible

3. **B.content - Over-engineered for 2 use cases**
   - `schema.ts:154-177` - aging and bundle configs (~25 LOC)
   - Only `report.ts:119` uses this via dynamic lookup
   - Impact: Should be inline in report.ts

4. **Body template arrays - 5 separate arrays**
   - `B.alerts.ci.body` (7 entries)
   - `B.alerts.quality.body` (4 entries)
   - `B.alerts.security.body` (9 entries)
   - `B.gating.body.block` (5 entries)
   - `B.gating.body.migration` (7 entries)
   - Total: ~50 LOC → ~15 LOC factory possible

5. **fn.withDefaults - Used exactly twice**
   - `schema.ts:704-708` (definition)
   - `gate.ts:37` and `dashboard.ts:299` (usage)
   - Impact: 4 LOC for 2 uses, inline both

6. **B.types null fields**
   - Each type has `{ c, p, r, t }` but most are null
   - `enhancement: { c: null, p: null, r: [...], t: null }`
   - `help: { c: null, p: null, r: [...], t: null }`
   - Nulls complicate consumer code

---

## Key Pattern: Dynamic Discovery (from dashboard.ts)

**Why it matters**: Dashboard.ts is our GOLD STANDARD for agnostic code.

```typescript
// GOOD: Dynamic discovery - works for ANY repo (dashboard.ts:74, 84-121)
const allWorkflows = await call(ctx, 'actions.listWorkflows');
const workflowMetrics = await Promise.all(
    (allWorkflows ?? []).map(async (w) => { ... })
);

// GOOD: ENV-driven bot detection (dashboard.ts:55)
const isBot = (p: PR): boolean => B.dashboard.bots.some((b) => p.user.login === b);
// B.dashboard.bots is now ENV.bots - fully agnostic

// BAD: Hardcoded workflow list (Arsenal's status-dashboard.yml)
const workflows = ['claude-issues.yml', 'claude-code-review.yml', ...]; // Breaks on transfer
```

**Dashboard already demonstrates:**
- Dynamic workflow discovery via API
- ENV-driven bot detection
- No hardcoded repo-specific values

---

## Dependency Graph

```
ENV (external config) ← AGNOSTIC
└── B (derives from ENV)
    ├── B.gen.* (markdown utils) ← KEEP, pure, universal
    ├── B.api.* (GitHub constants) ← KEEP, universal
    ├── B.time (constants) ← KEEP
    ├── B.types (commit types) ← SIMPLIFY, remove nulls
    ├── B.dashboard.* ← Uses ENV, already agnostic
    ├── B.gating.* ← CONSOLIDATE defaults, move check to ENV
    ├── B.alerts.* ← SIMPLIFY, factory instead of arrays
    ├── B.content.* ← INLINE to report.ts (single consumer)
    ├── B.defaults.spec ← DELETE, inline where used
    ├── B.reports ← SIMPLIFY
    └── B.probe ← Already minimal
```

---

## Completed Work

### Phase 1: Environment-Based Configuration Layer ✅

- Created `.github/scripts/env.ts` (63 LOC)
- Updated `schema.ts` to use ENV values (-16 LOC)
- ENV now controls: bots, agentLabels, prScopes, dashboardWorkflow, mutationThreshold, bundleThresholdKb, lang
- CMD dispatch provides language-specific commands (ts/cs)

---

## Phase 2: Code Cleanup & Reduction

### Task 2.1: Remove claude-implement Legacy Code

**Rationale**: `claude-implement` label is redundant - we have `claude.yml` for @claude mentions and `implement` label for general use.

**Files to modify**:
1. **DELETE** `.github/workflows/claude-issues.yml` (entire file)
2. **EDIT** `.github/labels.yml` - Remove lines 40-42 (claude-implement label)
3. **EDIT** `.github/scripts/schema.ts:189` - Remove `claude: 'claude-implement'` from `B.dashboard.labels`
4. **EDIT** `docs/AUTOMATION.md` - Remove claude-implement references
5. **EDIT** `docs/AGENTIC-INFRASTRUCTURE.md` - Remove claude-implement references
6. **EDIT** `.github/workflows/claude-maintenance.yml` - Remove claude-implement suggestion if present

**Estimated reduction**: ~3 LOC schema + 3 LOC labels + workflow file

### Task 2.2: Remove B.defaults.spec Layer & fn.withDefaults

**Rationale**: Only used in `gate.ts:37,84` and `dashboard.ts:299`, adds unnecessary indirection.

**Current usage**:
```typescript
// gate.ts:37
const spec = { ...fn.withDefaults('gating', {}), ...params.spec };
// gate.ts:84
(spec.migrate ?? B.defaults.spec.gating.migrate)

// dashboard.ts:299
pin: params.spec.pin ?? fn.withDefaults('dashboard', {}).pin,
```

**Changes**:
1. Inline `B.defaults.spec.gating.migrate` directly in gate.ts (~line 84)
2. Inline `B.defaults.spec.dashboard.pin` directly in dashboard.ts (~line 299)
3. Delete `B.defaults.spec` section from schema.ts (~10 LOC)
4. Delete `fn.withDefaults` helper from schema.ts (~4 LOC)

**Estimated reduction**: ~15 LOC

### Task 2.3: Consolidate B.gating.defaults

**Rationale**: `B.gating.defaults` (schema.ts:250-256) and `B.defaults.spec.gating` (schema.ts:217) are duplicates.

**Current state**:
```typescript
// B.defaults.spec.gating (schema.ts:217)
gating: { check: 'mutation-score', migrate: true, title: '[BLOCKED] Auto-merge blocked' }

// B.gating.defaults (schema.ts:250-256)
defaults: { check: 'mutation-score', marker: 'GATE-BLOCK', migrationLabels: [...], migrationPattern: 'Migration:', title: '[BLOCKED] Auto-merge blocked' }
```

**Changes**:
1. Keep only `B.gating.defaults` with all values
2. Add `migrate: true` to `B.gating.defaults`
3. Remove `B.defaults.spec.gating` (already done in 2.2)

**Estimated reduction**: ~10 LOC

---

## Phase 3: Higher-Order Abstractions

### Task 3.1: Add Surgical ENV Values (2 values only)

**Only add what's truly environment-dependent**:
```typescript
// env.ts additions (~4 LOC)
gatingCheck: process.env.GATING_CHECK ?? 'mutation-score',
standardsFile: process.env.STANDARDS_FILE ?? 'REQUIREMENTS.md',
```

**Do NOT add more configs** - solve through better patterns instead.

### Task 3.2: Create alertBody Factory

**Rationale**: 5 hardcoded body template arrays (~50 LOC) can be 1 factory (~15 LOC).

**Before** (50+ LOC):
```typescript
B.alerts.ci.body = [{ k: 'h', l: 2, t: 'CI Failure' }, { k: 'f', l: 'Run', v: S.runUrl }, ...]
B.alerts.security.body = [{ k: 'h', l: 2, t: 'Security Scan Alert' }, ...]
B.alerts.quality.body = [{ k: 'h', l: 2, t: '{{title}}' }, ...]
B.gating.body.block = [{ k: 'h', l: 2, t: '{{title}}' }, ...]
B.gating.body.migration = [{ k: 'h', l: 2, t: 'Migration: {{package}}' }, ...]
```

**After** (15 LOC factory):
```typescript
const alertBody = (title: string, fields: Record<string, string>, steps?: ReadonlyArray<string>): BodySpec => [
    { k: 'h', l: 2, t: title },
    ...Object.entries(fields).map(([l, v]) => ({ k: 'f' as const, l, v })),
    { k: 's' },
    { k: 'h', l: 3, t: 'Action Required' },
    ...(steps ? [{ k: 'n' as const, i: steps }] : [{ k: 't' as const, c: 'Review and address the issues.' }]),
];
```

**Estimated reduction**: ~35 LOC

### Task 3.3: Simplify SpecRegistry Types

**Rationale**: 100+ LOC of complex polymorphic types, barely used (report.ts does type casts anyway).

**Before** (100+ LOC):
```typescript
type SpecRegistry = {
    readonly alert: { readonly ci: {...}; readonly security: {...}; };
    readonly dashboard: { readonly update: {...}; };
    readonly filter: { readonly age: {...}; readonly label: {...}; };
    // ... 8 more categories
};
type Kind = keyof SpecRegistry;
type U<K extends Kind> = SpecRegistry[K][keyof SpecRegistry[K]];
```

**After** (~30 LOC):
```typescript
type AlertSpec = { kind: 'ci' | 'security'; job?: string; runUrl: string };
type GateSpec = { number: number; sha: string; title: string; label: string };
type FilterSpec = { kind: 'age'; days?: number } | { kind: 'label'; cat: LabelCat; idx?: number };
// Simple inline types where needed
```

**Estimated reduction**: ~80 LOC

---

## Phase 4: Script-Specific Optimizations

### Task 4.1: Move B.content Inline to report.ts

**Rationale**: Only `report.ts:119` uses `B.content`, no need to centralize.

**Current** (schema.ts:154-177, ~25 LOC):
```typescript
content: {
    aging: { filters: [...], fmt: {...}, out: {...}, row: 'count', src: {...} },
    bundle: { default: {...}, fmt: {...}, out: {...}, row: 'diff', src: {...} },
}
```

**After**: Move directly into report.ts as local constants.

**Estimated reduction**: ~25 LOC from schema.ts

### Task 4.2: Clean B.types Null Fields

**Rationale**: Many `B.types` entries have `c: null, p: null, t: null` - adds noise.

**Current**:
```typescript
enhancement: { c: null, p: null, r: ['Current Behavior', ...], t: null },
help: { c: null, p: null, r: ['Question', 'Context'], t: null },
```

**After**: Make fields optional, only include when non-null:
```typescript
enhancement: { r: ['Current Behavior', ...] },
help: { r: ['Question', 'Context'] },
```

**Changes**:
1. Update type definition to make c, p, t optional
2. Remove explicit nulls from B.types entries
3. Update consumers (release.ts, pr-meta.ts) to handle undefined

**Estimated reduction**: ~15 LOC + cleaner consumer code

---

## Estimated LOC Impact

| Phase | Task | Reduction |
|-------|------|-----------|
| Phase 1 (ENV) | Already done | +63, -16 = +47 |
| Phase 2.1 | Remove claude-implement | ~-10 |
| Phase 2.2 | Remove B.defaults.spec + fn.withDefaults | ~-15 |
| Phase 2.3 | Consolidate B.gating.defaults | ~-10 |
| Phase 3.1 | Add 2 ENV values | ~+4 |
| Phase 3.2 | alertBody factory | ~-35 |
| Phase 3.3 | Simplify SpecRegistry | ~-80 |
| Phase 4.1 | Move B.content to report.ts | ~-25 |
| Phase 4.2 | Clean B.types nulls | ~-15 |
| **Total** | | **~-140 LOC** |

**Current total**: 1919 LOC across 10 scripts
**Target**: ~1780 LOC (same functionality, more agnostic)

**New schema.ts**: 873 - 170 = ~700 LOC

---

## Files Summary

### Files to Delete
| File | Reason |
|------|--------|
| `.github/workflows/claude-issues.yml` | Legacy, redundant with claude.yml |

### Files to Modify
| File | Changes |
|------|---------|
| `.github/scripts/schema.ts` | Remove B.defaults.spec, B.content, simplify SpecRegistry, alertBody factory, clean B.types |
| `.github/scripts/env.ts` | Add gatingCheck, standardsFile (2 values only) |
| `.github/scripts/report.ts` | Inline B.content configs |
| `.github/scripts/gate.ts` | Inline defaults, use new B.gating structure |
| `.github/scripts/dashboard.ts` | Inline pin default |
| `.github/labels.yml` | Remove claude-implement |
| `docs/AUTOMATION.md` | Remove claude-implement refs |
| `docs/AGENTIC-INFRASTRUCTURE.md` | Remove claude-implement refs |

---

## Key Principles

1. **Dynamic over static** - Discover via API, don't hardcode lists (like dashboard.ts)
2. **Factories over arrays** - Generate templates, don't enumerate
3. **ENV for external, B for internal** - ENV = repo-specific, B = logic
4. **Inline where single-use** - Don't centralize script-specific config
5. **Remove, don't add** - Solve through better patterns, not more config

---

## Success Criteria

1. Portal works identically with no env vars
2. Total LOC reduced by ~140
3. All scripts use dynamic patterns where possible
4. claude-implement completely removed
5. B constant is leaner, ENV handles external config
6. Transfer to Arsenal requires only: copy files + set env vars
