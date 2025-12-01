# Parametric Portal — Claude Code Development Guide

**Last Updated**: 2025-01-XX
**Target**: Claude Code (long context, code generation, debugging)

---

## Quick Orientation (Read First)

**Context Files** (read before working):
- `REQUIREMENTS.md` - Authoritative spec (complete technical details)
- `AGENTS.MD` - Dogmatic protocol (non-negotiable principles)
- `vite.config.ts` - Master pattern (392 lines, single B constant, dispatch tables, polymorphic createConfig)
- `packages/components/` - Canonical exemplar (B constant + factory API)

**Verify Environment**:
```bash
node --version  # 25.2.1 (frozen)
pnpm --version  # 10.23.0 (frozen)
pnpm typecheck  # Should pass
pnpm check      # Should pass
```

---

## Stack Versions (Catalog Truth)

All versions in `pnpm-workspace.yaml` catalog (98 dependencies, exact versions):

**Core** (bleeding-edge canaries/nightlies):
- TypeScript `6.0.0-dev.20251121` • React `19.3.0-canary-*` • Vite `7.2.4` • Vitest `4.0.13` • Effect `3.19.6` • @effect/schema • Nx `22.2.0-canary.*` • Tailwind `4.1.17` • LightningCSS `1.30.2` • Biome `2.3.7` • Node `25.2.1` • pnpm `10.23.0`

**Philosophy**: Dogmatic FP/ROP + super-strong types. Zero compromises, zero rule suppression.

---

## Custom Agents Available

**10 Specialized Agents** (`.github/agents/*.agent.md`) - 5,056 lines total:

| Agent | Domain | Use When |
|-------|--------|----------|
| **typescript-advanced** | TS 6.0-dev, FP/ROP | Complex types, Effect/Option |
| **react-specialist** | React 19 canary | Components, hooks, Server Components |
| **vite-nx-specialist** | Build config | Vite/Nx configuration, dispatch tables |
| **testing-specialist** | Vitest, testing | Writing/fixing tests |
| **performance-analyst** | Optimization | Bundle size, performance |
| **refactoring-architect** | Transformation | Large refactors, B constant consolidation |
| **library-planner** | Package creation | New packages |
| **integration-specialist** | Cross-package | Single B constants, workspace consistency |
| **documentation-specialist** | Documentation | Docs, comments |
| **cleanup-specialist** | Code polish | Final density optimization |

**Delegation Priority**: Check agent domain before implementing yourself. Agents have modern prompt engineering patterns built-in.

## Dogmatic Code Rules (Build-Failing)

**Read REQUIREMENTS.md for complete list**. Summary:

1. **Single B Constant**: All config in one frozen object `const B = Object.freeze({...} as const)`
2. **Dispatch Tables**: Replace if/else with `handlers[mode]()` type-safe lookup
3. **No `any`** (branded types via @effect/schema)
4. **No `var`/`let`** (`const` only)
5. **No `if/else`** (dispatch tables, ternaries, `Option.match`)
6. **No loops** (`.map`/`.filter`/Effect)
7. **ReadonlyArray<T>** + `as const`
8. **Effect** for async/failable, **Option** for nullable
9. **No try/catch** (Effect error channel)
10. **No default exports** (except `*.config.ts`)
11. **Single polymorphic entry point**: `createConfig(input)` handles all modes
12. **Delegate to agents** when task matches their expertise

**File Organization** (>50 LOC):
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

**Separator format**: `// --- Section Name -------` (77 chars, triple-dash)

---

## Configuration Cascade

**Master Pattern** - Single B constant + polymorphic entry:

```typescript
// Root: vite.config.ts (392 lines)
const B = Object.freeze({
    assets, browsers, cache, chunks, comp, csp, exts, glob, img, port, pwa, ssr, svgr, treeshake, viz
} as const);

const plugins = { app: (c, prod) => [...], library: () => [...] } as const;
const config = { app: (c, b, env) => UserConfig, library: (c, b) => UserConfig } as const;

export const createConfig = (input: unknown): Effect.Effect<UserConfig, never, never> =>
    pipe(decode, dispatch);

// Apps: createConfig with mode: 'app'
export default defineConfig(Effect.runSync(createConfig({ mode: 'app' })));

// Packages: createConfig with mode: 'library'
export default defineConfig(Effect.runSync(createConfig({
  mode: 'library',
  entry: { index: './src/index.ts' },
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
  task.involves.react19 || task.involves.reactComponent ? 'react-specialist' :
  task.involves.viteConfig || task.involves.nxConfig ? 'vite-nx-specialist' :
  task.involves.newPackage || task.involves.libraryResearch ? 'library-planner' :
  
  // 2. Quality & optimization
  task.involves.testing || task.involves.propertyTests ? 'testing-specialist' :
  task.involves.performance || task.involves.bundleSize ? 'performance-analyst' :
  task.involves.refactoring || task.involves.pipelines ? 'refactoring-architect' :
  
  // 3. Infrastructure & consistency
  task.involves.integration || task.involves.catalog ? 'integration-specialist' :
  task.involves.documentation || task.involves.comments ? 'documentation-specialist' :
  task.involves.cleanup || task.involves.density ? 'cleanup-specialist' :
  
  // 4. Core TypeScript patterns
  task.involves.complexTypes || task.involves.effectPipelines ? 'typescript-advanced' :
  
  // 5. Fallback to self (use patterns below)
  'self';
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
- Reference to exemplar (vite.config.ts, packages/components)
```

**Option 2: Manual creation**:
1. **Study exemplar**: `cat packages/components/src/*.ts` (B constant + factory pattern)
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
import { createConfig } from '../../vite.config.ts';

export default defineConfig(Effect.runSync(createConfig({
  mode: 'library',
  entry: { index: './src/index.ts' },
  external: ['effect', '@effect/schema'],
  name: 'MyPackage'
})));
```
6. **Write code** (follow B constant + factory pattern) - **Consider delegating to typescript-advanced**
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

**Never bypass Nx** (breaks caching): [AVOID] `vite build`, [AVOID] `vitest run`

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

### vite.config.ts (392 lines, master pattern)
**Architecture** (5 Pillars):
1. **Single B Constant**: `B = Object.freeze({ assets, browsers, cache, chunks, ... } as const)`
2. **Discriminated Union Schema**: `CfgSchema` with `mode: 'app' | 'library'`
3. **Dispatch Tables**: `plugins[mode]()`, `config[mode]()`
4. **Pure Utility Functions**: 14 single-expression helpers
5. **Single Polymorphic Entry Point**: `createConfig(input)`

**Usage**: `defineConfig(Effect.runSync(createConfig({ mode: 'library', entry, name })))`

### vitest.config.ts (103 lines)
**Merges vite**, adds:
- `COVERAGE_THRESHOLDS` (80%), `COVERAGE_REPORTERS`, `TEST_REPORTERS`
- Happy-DOM, Vitest UI enabled

### nx.json (88 lines)
**Crystal inference** + caching. `sharedGlobals` = all root configs.

### tsconfig.base.json (64 lines)
**Strictest TS**. Path aliases: `@/*` → `packages/*`, `@theme/*`, `@types/*`

### biome.json (141 lines)
**70+ rules**. No default exports (except configs), no `any`, no `forEach`, complexity ≤25

### pnpm-workspace.yaml (98 lines)
**Catalog** with 98 exact versions. Single source of truth.

### .npmrc (35 lines)
**Strict**: `engine-strict`, `use-node-version=25.2.1`, `save-exact`, `node-linker=isolated`, `public-hoist-pattern=[]`

---

## Canonical Patterns

**Single B Constant** (replace scattered constants):
```typescript
// [AVOID] OLD
const SIZES = Object.freeze({...});
const VARIANTS = Object.freeze({...});
const DEFAULTS = Object.freeze({...});

// [USE] NEW
const B = Object.freeze({
    defaults: { size: 'md', variant: 'primary' },
    sizes: { sm: 8, md: 12, lg: 16 },
    variants: { primary: 'bg-blue', secondary: 'bg-gray' },
} as const);
// Access: B.defaults.size, B.sizes.md, B.variants.primary
```

**Dispatch Tables** (replace if/else):
```typescript
// [AVOID] OLD
if (mode === 'app') return appConfig();
else if (mode === 'library') return libConfig();

// [USE] NEW
const handlers = {
    app: (c) => appConfig(c),
    library: (c) => libConfig(c),
} as const;
return handlers[mode](config);
```

**Single Polymorphic Entry Point**:
```typescript
// [AVOID] OLD (separate functions)
export const createAppConfig = () => {...};
export const createLibraryConfig = () => {...};

// [USE] NEW (polymorphic)
export const createConfig = (input: unknown) =>
    pipe(decode, dispatch);
```

**Factory Export Pattern** (packages/components style):
```typescript
export { B as COMPONENT_TUNING, createComponents };
// Consumers: import { COMPONENT_TUNING, createComponents } from '@/components';
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
// [AVOID] Vague
"Make the code better"

// [USE] Precise
"Consolidate scattered constants into single B constant per vite.config.ts pattern,
replace if/else with dispatch tables, use @effect/schema for validation"
```

### 2. Context Framing
```typescript
// Always provide
- File paths: "packages/components/src/controls.ts"
- Catalog versions: "Effect 3.19.6 per pnpm-workspace.yaml"
- Exemplars: "Follow vite.config.ts B constant + dispatch table pattern"
- Constraints: "Must pass pnpm typecheck + pnpm check"
```

### 3. Stepwise Structure
```typescript
// Request sequential subtasks
"1. Research latest @effect/schema docs (≤6 months)
 2. Plan B constant structure with discriminated union schema
 3. Implement with dispatch tables (no if/else)
 4. Write property-based tests with testing-specialist patterns
 5. Validate with pnpm typecheck && pnpm check"
```

### 4. Few-Shot Learning
```typescript
// Provide 1-3 examples
"Convert scattered constants:
  const SIZES = Object.freeze({...});
  const VARIANTS = Object.freeze({...});

To single B constant (like vite.config.ts):
  const B = Object.freeze({
      sizes: {...},
      variants: {...},
  } as const);"
```

### 5. Security-First
```typescript
// Emphasize type safety
"Use branded type for UserId: S.String.pipe(S.brand('UserId'))
 Validate at IO boundary with S.decodeUnknownSync before business logic
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
"Delegate to refactoring-architect for B constant consolidation"
"Use vite-nx-specialist for dispatch table optimization"
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
- `REQUIREMENTS.md` - Authoritative spec
- `AGENTS.MD` - Agent charter
- `vite.config.ts` - Master pattern (392 lines, B constant, dispatch tables)
- `packages/components/` - Canonical exemplar (B constant + factory API)

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
- **vite-nx-specialist**: Build config changes, Nx targets, dispatch tables, B constant patterns
- **testing-specialist**: Writing tests, property-based testing, Effect/Option test patterns, coverage optimization
- **performance-analyst**: Bundle size reduction, tree-shaking analysis, code splitting, lazy loading
- **refactoring-architect**: Large refactors, pipeline migrations, B constant consolidation, dispatch table conversion
- **library-planner**: New package creation, dependency research, vite.config setup, tsconfig structure
- **integration-specialist**: Cross-package consistency, catalog verification, single B constant usage, workspace coherence
- **documentation-specialist**: REQUIREMENTS.md updates, code comments (1-line XML), cross-reference validation
- **cleanup-specialist**: Final density optimization (25-30 LOC/feature), pattern consolidation, algorithmic improvements

**Delegation improves outcomes**: Agents have domain expertise, modern prompt patterns, and 500+ lines of specialized guidance each.

---

**Remember**: Bleeding-edge monorepo, dogmatic FP/ROP, zero rule suppression. **Delegate to custom agents first** when task matches domain. Study `vite.config.ts` (master pattern) and `packages/components` (exemplar), research latest docs (≤6 months), redesign to comply with constraints.