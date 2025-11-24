# Parametric Portal — Claude Code Development Guide

**Last Updated**: 2025-11-24
**Target**: Claude Code (long context, code generation, debugging)

---

## Quick Orientation (Read First)

**Context Files** (read before working):
- `REQUIREMENTS.md` - Authoritative spec (385 lines, complete technical details)
- `AGENTS.MD` - Dogmatic protocol (204 lines, non-negotiable principles)
- `vite.config.ts` - Master config with 10 frozen constants, 2 factories
- `packages/theme/` - Canonical exemplar (perfect pattern adherence)

**Verify Environment**:
```bash
node --version  # 25.2.1 (frozen)
pnpm --version  # 10.23.0 (frozen)
pnpm typecheck  # Should pass
pnpm check      # Should pass
```

**Critical Gap**: ⚠️ Git not initialized (affects nx affected, Biome VCS, cache keys)

---

## Stack Versions (Catalog Truth)

All versions in `pnpm-workspace.yaml` catalog (98 dependencies, exact versions):

**Core** (bleeding-edge canaries/nightlies):
- TypeScript `6.0.0-dev.20251121` • React `19.3.0-canary-40b4a5bf-20251120` • Vite `7.2.4` • Vitest `4.0.13` • Effect `3.19.6` • Zod `4.1.13` • Nx `22.2.0-canary.20251121-9a6c7ad` • Tailwind `4.1.17` • LightningCSS `1.30.2` • Biome `2.3.7` • Node `25.2.1` • pnpm `10.23.0`

**Philosophy**: Dogmatic FP/ROP + super-strong types. Zero compromises, zero rule suppression.

---

## Custom Agents Available

**10 Specialized Agents** (`.github/agents/*.agent.md`) - 5,056 lines total:

| Agent | Domain | Use When |
|-------|--------|----------|
| **typescript-advanced** | TS 6.0-dev, FP/ROP | Complex types, Effect/Option |
| **react-specialist** | React 19 canary | Components, hooks, Server Components |
| **vite-nx-specialist** | Build config | Vite/Nx configuration |
| **testing-specialist** | Vitest, testing | Writing/fixing tests |
| **performance-analyst** | Optimization | Bundle size, performance |
| **refactoring-architect** | Transformation | Large refactors |
| **library-planner** | Package creation | New packages |
| **integration-specialist** | Cross-package | Workspace integration |
| **documentation-specialist** | Documentation | Docs, comments |
| **cleanup-specialist** | Code polish | Final density optimization |

**Delegation Priority**: Check agent domain before implementing yourself. Agents have modern prompt engineering patterns built-in.

## Dogmatic Code Rules (Build-Failing)

**Read REQUIREMENTS.md lines 30-82 for complete list**. Summary:

1. **No `any`** (branded types via Zod `.brand()`)
2. **No `var`/`let`** (`const` only)
3. **No `if/else`** (ternaries, `Option.match`)
4. **No loops** (`.map`/`.filter`/Effect)
5. **ReadonlyArray<T>** + `as const`
6. **Effect** for async/failable, **Option** for nullable
7. **No try/catch** (Effect error channel)
8. **No default exports** (except `*.config.ts`)
9. **No barrel files** (`export *`)
10. **Unified factory pattern**: `Effect.runSync(Effect.all({...}))` → `Object.freeze` individually
11. **Delegate to agents** when task matches their expertise

**File Organization** (>50 LOC):
```typescript
// --- Imports -----------------------------------------------------------------
// --- Type Definitions --------------------------------------------------------
// --- Schema Definitions ------------------------------------------------------
// --- Constants (Unified Factory → Frozen) ------------------------------------
// --- Pure Utility Functions --------------------------------------------------
// --- Effect Pipelines & Builders ---------------------------------------------
// --- Export ------------------------------------------------------------------
```

**Separator format**: `// --- Section Name -------` (77 chars, triple-dash)

---

## Configuration Cascade

**Master Pattern** - Single source of truth:

```typescript
// Root: vite.config.ts (10 frozen constants, 2 factories)
export const BROWSER_TARGETS = Object.freeze({...});
export const createAppConfig = (): Effect.Effect<UserConfig, never, never> => ...;
export const createLibraryConfig = (opts): Effect.Effect<UserConfig, never, never> => ...;

// Apps: extend createAppConfig
import { createAppConfig } from '../../vite.config.ts';
export default defineConfig(Effect.runSync(createAppConfig()));

// Packages: extend createLibraryConfig
import { createLibraryConfig } from '../../vite.config.ts';
export default defineConfig(Effect.runSync(createLibraryConfig({
  entry: { main: './src/index.ts' },
  external: ['effect', '@effect/schema'],
  name: 'MyPackage'
})));
```

**TypeScript Cascade**:
- `tsconfig.base.json` - Strictest (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess)
- `tsconfig.json` (root) - Project references
- `packages/*/tsconfig.json` - Extends base + composite mode

**Nx**: Crystal inference auto-detects targets from `vite.config.ts`. `sharedGlobals` tracks all root configs.

**Catalog**: `pnpm-workspace.yaml` → `"dep": "catalog:"` in package.json → single source

---

## Agent Delegation Decision Tree

**Before implementing, check if agent matches your task**:

```typescript
// Stepwise delegation logic
const selectAgent = (task: Task): Agent | 'self' => {
  // 1. Specialized domains (highest priority)
  if (task.involves.react19 || task.involves.reactComponent) return 'react-specialist';
  if (task.involves.viteConfig || task.involves.nxConfig) return 'vite-nx-specialist';
  if (task.involves.newPackage || task.involves.libraryResearch) return 'library-planner';
  
  // 2. Quality & optimization
  if (task.involves.testing || task.involves.propertyTests) return 'testing-specialist';
  if (task.involves.performance || task.involves.bundleSize) return 'performance-analyst';
  if (task.involves.refactoring || task.involves.pipelines) return 'refactoring-architect';
  
  // 3. Infrastructure & consistency
  if (task.involves.integration || task.involves.catalog) return 'integration-specialist';
  if (task.involves.documentation || task.involves.comments) return 'documentation-specialist';
  if (task.involves.cleanup || task.involves.density) return 'cleanup-specialist';
  
  // 4. Core TypeScript patterns
  if (task.involves.complexTypes || task.involves.effectPipelines) return 'typescript-advanced';
  
  // 5. Fallback to self (use patterns below)
  return 'self';
};
```

**Agent Interaction Examples**:

```bash
# Sequential chain
"Create auth package" →
  library-planner (structure) →
  typescript-advanced (implement) →
  testing-specialist (tests) →
  documentation-specialist (docs)

# Parallel tasks
"Polish codebase" →
  [documentation-specialist, cleanup-specialist, integration-specialist] →
  Merge results

# Iterative refinement
"Refactor to Effect" →
  refactoring-architect (migrate) →
  cleanup-specialist (optimize) →
  refactoring-architect (review) →
  Repeat until quality gates pass
```

## Working with the Monorepo

### Creating a Package (Step-by-Step)

**Option 1: Use library-planner agent** (recommended):
```
Delegate to library-planner with:
- Package name and purpose
- Dependencies needed
- Reference to exemplar (packages/theme)
```

**Option 2: Manual creation**:
1. **Study exemplar**: `cat packages/theme/vite.config.ts packages/theme/package.json packages/theme/tsconfig.json`
2. **Create structure**: `mkdir -p packages/my-package/src`
3. **Create `package.json`**:
```json
{
  "name": "@parametric-portal/my-package",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "dependencies": { "effect": "catalog:", "@effect/schema": "catalog:" },
  "devDependencies": { "typescript": "catalog:", "vite": "catalog:" }
}
```
4. **Create `tsconfig.json`**:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "tsBuildInfoFile": ".tsbuildinfo" },
  "include": ["src/**/*"]
}
```
5. **Create `vite.config.ts`**:
```typescript
import { Effect } from 'effect';
import { defineConfig } from 'vite';
import { createLibraryConfig } from '../../vite.config.ts';

export default defineConfig(Effect.runSync(createLibraryConfig({
  entry: { index: './src/index.ts' },
  external: ['effect', '@effect/schema'],
  name: 'MyPackage'
})));
```
6. **Write code** (follow file organization standard) - **Consider delegating to typescript-advanced**
7. **Add to root `tsconfig.json`**: `"references": [{"path": "./packages/my-package"}]`
8. **Install**: `pnpm install` (root only)
9. **Validate**: `pnpm typecheck && pnpm check && nx build my-package`

### Adding a Dependency

1. **Check catalog**: `cat pnpm-workspace.yaml | grep my-dep`
2. **Add to catalog** (if missing): `my-dep: 1.2.3` (exact version)
3. **Reference**: `"dependencies": { "my-dep": "catalog:" }`
4. **Install**: `pnpm install`
5. **Validate**: `pnpm typecheck && pnpm check`

### Running Tasks (Always use Nx)

```bash
# Single project
nx build theme
nx test types
nx dev my-app

# All projects (4 workers, parallel)
pnpm build     # nx run-many -t build
pnpm test      # nx run-many -t test
pnpm typecheck # tsc -b (composite mode)

# Clear caches
nx reset
rm -rf node_modules/.vite packages/*/dist
```

**Never bypass Nx** (breaks caching): ❌ `vite build`, ❌ `vitest run`

### Testing with Effect/Option

```typescript
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

describe('myEffectFunction', () => {
  it('should succeed', () => {
    const result = Effect.runSync(myEffectFunction('valid'));
    expect(result).toEqual({ success: true });
  });

  it('should fail gracefully', () => {
    const exit = Effect.runSyncExit(myEffectFunction('invalid'));
    expect(exit._tag).toBe('Failure');
  });
});

describe('myOptionFunction', () => {
  it('should return Some', () => {
    const result = myOptionFunction({ name: 'Alice' });
    expect(Option.isSome(result)).toBe(true);
    expect(Option.getOrNull(result)).toBe('Alice');
  });

  it('should return None', () => {
    expect(Option.isNone(myOptionFunction(null))).toBe(true);
  });
});
```

---

## Debugging Workflows

### Type Errors
1. `pnpm typecheck` → check errors
2. Verify catalog versions: `cat pnpm-workspace.yaml | grep <dep>`
3. Clear tsbuildinfo: `rm -rf **/.tsbuildinfo`
4. Reinstall: `pnpm install --force`
5. Check tsconfig references: `cat tsconfig.json`

### Biome Errors
1. `pnpm check` → check errors
2. Explain rule: `biome explain <rule>`
3. **Never suppress** - redesign code to comply

### Build Cache Stale
```bash
nx reset
rm -rf node_modules/.vite
rm -rf packages/*/dist
nx build <project>
```

### Vite HMR Not Working
1. Check imports use `@/*` aliases (not relative across packages)
2. Verify `vite.config.ts` exports default
3. Restart: `nx reset && nx dev <app>`
4. Clear cache: `rm -rf node_modules/.vite`

### Nx Inference Broken
1. Check `vite.config.ts` exports `default defineConfig(...)`
2. Verify `@nx/vite/plugin` in `nx.json` plugins
3. `nx reset`

---

## Root Configs (Reuse Only, Never Modify)

### vite.config.ts (460 lines, master)
**Exports**:
- `BROWSER_TARGETS`, `CHUNK_PATTERNS`, `ASSET_PATTERNS`, `PORT_DEFAULT`, `PLUGIN_CONFIGS`, `PWA_MANIFEST`, `PWA_WORKBOX_CONFIG`, `SVGR_OPTIONS`, `SSR_CONFIG`
- `createAppConfig()`, `createLibraryConfig()`

**Usage**: Always extend factories, never inline configs

### vitest.config.ts (121 lines)
**Merges vite**, adds:
- `COVERAGE_THRESHOLDS` (80%), `COVERAGE_REPORTERS`, `TEST_REPORTERS`
- Happy-DOM, Vitest UI enabled

### nx.json (88 lines)
**Crystal inference** + caching. `sharedGlobals` = all root configs.

### tsconfig.base.json (64 lines)
**Strictest TS**. Path aliases: `@/*` → `packages/*`, `@theme/*`, `@types/*`

### biome.json (141 lines)
**70+ rules**. No default exports (except configs), no `any`, no `forEach`, complexity ≤10

### pnpm-workspace.yaml (98 lines)
**Catalog** with 98 exact versions. Single source of truth.

### .npmrc (35 lines)
**Strict**: `engine-strict`, `use-node-version=25.2.1`, `save-exact`, `node-linker=isolated`, `public-hoist-pattern=[]`

---

## Canonical Patterns

**Unified Factory**:
```typescript
const { a, b } = Effect.runSync(Effect.all({
  a: Effect.succeed({...} as const),
  b: Effect.succeed({...} as const),
}));
const A = Object.freeze(a);
const B = Object.freeze(b);
```

**Effect Pipeline**:
```typescript
const fn = (input: Input): Effect.Effect<Output, Error, never> =>
  pipe(
    Effect.all({ x, y }),
    Effect.map(transform),
    Effect.flatMap(validate),
  );
```

**Option Monad**:
```typescript
const result = pipe(
  Option.fromNullable(value),
  Option.match({
    onNone: () => defaultValue,
    onSome: (v) => transform(v),
  }),
);
```

**Branded Types**:
```typescript
import * as S from '@effect/schema/Schema';
const PositiveInt = pipe(S.Number, S.int(), S.positive(), S.brand('PositiveInt'));
type PositiveInt = S.Schema.Type<typeof PositiveInt>;
```

---

## Git Workflow (CRITICAL - Currently Missing)

**Initialize Git** (do immediately):
```bash
cd /Users/bardiasamiee/Documents/99.Github/Parametric_Portal
git init
git add .
git commit -m "chore: initial commit

Nx monorepo with bleeding-edge toolchain:
- TypeScript 6.0-dev + React 19 canary
- Effect 3 functional patterns
- Vite 7 + Nx 22 Crystal inference"
```

**Why critical**: Nx `affected`, Biome VCS, Husky hooks, stable cache keys all require Git.

**Standard workflow**:
```bash
git checkout -b feat/my-feature
# ... changes ...
pnpm typecheck && pnpm check
git add .
git commit -m "feat: my-feature"  # Husky → lint-staged → biome
```

---

## Catalog System Deep Dive

**How it works**:
```yaml
# pnpm-workspace.yaml
catalog:
  effect: 3.19.6
  zod: 4.1.13
```

```json
// package.json
{
  "dependencies": {
    "effect": "catalog:",
    "zod": "catalog:"
  }
}
```

**Adding dependency**:
1. `npm view <package> version` → get latest
2. Add to catalog: `my-package: 1.2.3`
3. Reference: `"my-package": "catalog:"`
4. `pnpm install`
5. `pnpm typecheck && pnpm check`

**Updating dependency**:
1. Update catalog version
2. `pnpm install`
3. `pnpm typecheck && pnpm check && pnpm build && pnpm test`

---

## Bleeding-Edge Features

### TypeScript 6.0-dev
- `ignoreDeprecations: "6.0"` set
- Latest nightly (20251121)
- No special syntax, automatic improvements

### React 19 Canary + Compiler
- Auto-memoization (no `useMemo`/`useCallback` needed)
- Enabled via `PLUGIN_CONFIGS.react`
- **Never disable compiler**

### Vite 7 Environment API
- `buildApp` hook for parallel SSR+client builds
- Currently dormant (no SSR app)

### Tailwind v4 Alpha
- No PostCSS (direct Vite plugin)
- No `tailwind.config.js` (v3 incompatible)
- Configure via CSS `@theme` or plugin options

### Lightning CSS
- 100x faster than PostCSS (Rust)
- Automatic vendor prefixes
- Drafts: `customMedia`, `deepSelectorCombinator`
- **PostCSS forbidden**

### Effect 3
- `Effect<Success, Error, Requirements>` - Railway-oriented
- `Option<T>` - Nullables without `null`
- `Schema` - Runtime validation + inferred types
- `pipe` - Composition

---

## Modern Prompt Engineering for Claude

**2024-2025 Best Practices Applied**:

### 1. Precision & Task Specificity
```typescript
// ❌ Vague
"Make the code better"

// ✅ Precise
"Migrate if/else to Option.match per AGENTS.MD, use branded types via Zod .brand(), 
follow vite.config.ts unified factory pattern with Effect.runSync(Effect.all({...}))"
```

### 2. Context Framing
```typescript
// Always provide
- File paths: "packages/theme/src/index.ts"
- Catalog versions: "Effect 3.19.6 per pnpm-workspace.yaml"
- Exemplars: "Follow packages/theme pattern"
- Constraints: "Must pass pnpm typecheck + pnpm check"
```

### 3. Stepwise Structure
```typescript
// Request sequential subtasks
"1. Research latest React 19 canary docs (≤6 months)
 2. Plan component structure with Server Components
 3. Implement with React Compiler patterns
 4. Write property-based tests with testing-specialist patterns
 5. Validate with pnpm typecheck && pnpm check"
```

### 4. Few-Shot Learning
```typescript
// Provide 1-3 examples
"Convert this imperative code:
  if (x === null) return default;
  return transform(x);

To Option monad (like packages/theme):
  pipe(
    Option.fromNullable(x),
    Option.match({
      onNone: () => default,
      onSome: transform,
    })
  )"
```

### 5. Security-First
```typescript
// Emphasize type safety
"Use branded type for UserId: z.string().uuid().brand('UserId')
 Validate at IO boundary with safeParse before business logic
 Return Effect<User, ValidationError> not Promise<User | undefined>"
```

### 6. Iterative Refinement
```bash
# Request validation loops
"Implement → pnpm typecheck → fix errors → 
 pnpm check → fix lint → nx build → fix issues → 
 nx test → ensure 80% coverage → done"
```

### 7. Agent Delegation
```typescript
// Prefer custom agents
"Delegate to react-specialist for this React 19 component work"
"Use vite-nx-specialist to optimize build configuration"
"Let testing-specialist write property-based tests"
```

## FAQ

**Q: Why bleeding-edge?**
A: Showcase state-of-the-art, dogmatic bet on the future. Trade-off: breaking changes for latest features.

**Q: Why custom agents?**
A: 500+ lines specialized guidance each, modern prompt engineering patterns, domain expertise. 10x better than generic prompts.

**Q: When to delegate vs implement?**
A: Delegate when task matches agent domain (react19 → react-specialist). Self-implement for general patterns with existing exemplars.

**Q: Why no ESLint/Prettier?**
A: Biome 100x faster (Rust), single tool, better FP rules.

**Q: Why no PostCSS?**
A: Lightning CSS 100x faster, Tailwind v4 doesn't need it.

**Q: Why Effect instead of promises?**
A: Type-safe errors (no `try/catch`), composable pipelines, better DX.

**Q: Why no default exports?**
A: Tree-shaking, explicit imports, avoid namespace collisions.

**Q: Can I relax Biome rules?**
A: **No**. Redesign code to comply. Rules enforce dogmatic patterns. Agents know compliant patterns.

**Q: Why UUIDv7 over v4?**
A: Time-ordered (sortable), better DB indexing.

**Q: Why OKLCH color space?**
A: Perceptually uniform, wider gamut, better interpolation (CSS Color 4).

---

## Maintenance

**Weekly**: Check catalog updates (`pnpm outdated`), review TS nightly/React canary changes

**Monthly**: Update catalog deps (one at a time, verify tests), review Nx/Vite releases, audit bundle sizes

**Quarterly**: Re-evaluate bleeding-edge deps, performance benchmarking, check Biome bug #7771 for GritQL fix

---

## Resources

**Internal**:
- `REQUIREMENTS.md` - Authoritative spec (385 lines)
- `AGENTS.MD` - Agent charter (204 lines)
- `vite.config.ts` - Master config (460 lines)

**External**:
- [Nx Docs](https://nx.dev) - Monorepo
- [Vite Docs](https://vite.dev) - Build tool
- [Effect Docs](https://effect.website/docs/introduction) - Functional ROP
- [Biome Docs](https://biomejs.dev) - Linter/formatter

**CLI Quick Reference**:
```bash
# Dev
nx dev <app>
nx build <pkg>
pnpm build     # All projects
pnpm test      # All tests
pnpm typecheck # tsc -b

# Debug
nx reset
biome explain <rule>
nx show project <pkg>
nx graph

# Advanced
nx affected -t build  # Requires Git
vitest --ui
```

## Agent Capabilities Summary

**When to use each agent**:

- **typescript-advanced**: Complex type transformations, branded types, Effect/Option pipelines, generic optimization
- **react-specialist**: React 19 components, Server Components, use() hook, React Compiler optimization
- **vite-nx-specialist**: Build config changes, Nx targets, factory patterns, caching strategies
- **testing-specialist**: Writing tests, property-based testing, Effect/Option test patterns, coverage optimization
- **performance-analyst**: Bundle size reduction, tree-shaking analysis, code splitting, lazy loading
- **refactoring-architect**: Large refactors, pipeline migrations, dispatch table optimization, holistic consistency
- **library-planner**: New package creation, dependency research, vite.config setup, tsconfig structure
- **integration-specialist**: Cross-package consistency, catalog verification, unified factory usage, workspace coherence
- **documentation-specialist**: REQUIREMENTS.md updates, code comments (1-line XML), cross-reference validation
- **cleanup-specialist**: Final density optimization (25-30 LOC/feature), pattern consolidation, algorithmic improvements

**Delegation improves outcomes**: Agents have domain expertise, modern prompt patterns, and 500+ lines of specialized guidance each.

---

**Remember**: Bleeding-edge monorepo, dogmatic FP/ROP, zero rule suppression. **Delegate to custom agents first** when task matches domain. Study `packages/theme` exemplar, research latest docs (≤6 months), redesign to comply with constraints.
