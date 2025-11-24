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

## Working with the Monorepo

### Creating a Package (Step-by-Step)

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
6. **Write code** (follow file organization standard)
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

## FAQ

**Q: Why bleeding-edge?**
A: Showcase state-of-the-art, dogmatic bet on the future. Trade-off: breaking changes for latest features.

**Q: Why no ESLint/Prettier?**
A: Biome 100x faster (Rust), single tool, better FP rules.

**Q: Why no PostCSS?**
A: Lightning CSS 100x faster, Tailwind v4 doesn't need it.

**Q: Why Effect instead of promises?**
A: Type-safe errors (no `try/catch`), composable pipelines, better DX.

**Q: Why no default exports?**
A: Tree-shaking, explicit imports, avoid namespace collisions.

**Q: Can I relax Biome rules?**
A: **No**. Redesign code to comply. Rules enforce dogmatic patterns.

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

---

**Remember**: Bleeding-edge monorepo, dogmatic FP/ROP, zero rule suppression. Study `packages/theme` exemplar, research latest docs (≤6 months), redesign to comply with constraints.
