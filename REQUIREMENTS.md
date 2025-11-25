# Parametric Portal - Requirements & Code Standards

## Bleeding-Edge Technology Stack

### Core Versioning Requirements

**Strict Version Policy**: Latest stable + experimental features enabled

- **Node.js**: `25.2.1` (enforced via `.npmrc`)
- **pnpm**: `10.23.0` (package manager)
- **TypeScript**: `6.0.0-dev.20251121` (bleeding-edge daily builds)
- **React**: `19.3.0-canary-40b4a5bf-20251120` (experimental)
- **React Compiler**: `19.0.0-beta-af1b7da-20250417` (experimental, auto-optimization)
- **Vite**: `7.2.4` (latest with experimental Environment API)
- **Vitest**: `4.0.13` (latest with V8 AST-based coverage)
- **Effect**: `3.19.6` (functional effect system)
- **Zod**: `4.1.13` (schema validation)
- **Tailwind CSS**: `4.1.17` (v4 bleeding-edge)
- **Lightning CSS**: `1.30.2` (Rust-powered CSS)
- **Biome**: `2.3.7` (Rust linter/formatter)
- **Nx**: `22.2.0-canary.20251121-9a6c7ad` (monorepo orchestrator)

### Experimental Features Enabled

- **Vite 7 Environment API**: Multi-environment builds (`buildApp` hook)
- **React 19 Compiler**: Automatic memoization/optimization
- **TypeScript 6.0-dev**: Latest language features
- **Vite Manifest**: `.vite/manifest.json` + `ssr-manifest.json` generation

## Dogmatic Code Philosophy

### Immutable Principles

**ALL code MUST adhere to these standards without exception:**

1. **Bleeding-Edge TypeScript**
   - TypeScript 6.0-dev features
   - Super strong types (no `any` except for unstable experimental APIs)
   - Branded types for nominal typing (Zod `.brand()`)
   - Const type parameters where literal types matter
   - `as const` for all object literals
   - `ReadonlyArray` for all collections
   - Exhaustive pattern matching with `satisfies`

2. **Functional Programming (FP)**
   - Pure functions only (no side effects except hooks/plugins)
   - No mutations - `Object.freeze` for all constants
   - No `let` - only `const`
   - No imperative loops - use `Array` methods or Effect
   - Point-free style where applicable

3. **Monadic Railway-Oriented Programming (ROP)**
   - Effect pipelines for all async/failable operations
   - Option monads for nullable values (`Option.fromNullable`, `Option.match`)
   - Proper error handling via `Effect.all`, `pipe`, `Effect.map`
   - No try/catch - use Effect error channel

4. **Expression-Based Code**
   - No `if/else` statements - use ternaries
   - No null checks - use `Option.match`
   - All code as expressions, not statements
   - Single-expression arrow functions

5. **DRY (Don't Repeat Yourself)**
   - Single source of truth for all constants
   - **Single B Constant** pattern: `const B = Object.freeze({...} as const)`
   - **Dispatch tables** replace if/else: `handlers[mode]()`
   - **Single polymorphic entry point**: `createConfig(input)` handles all modes

6. **Algorithmic & Parameterized**
   - No hard-coded values
   - All constants derived from base values
   - Parameterized builders with schema validation
   - Runtime validation via `@effect/schema`

7. **Polymorphic & Type-Safe**
   - Generic type parameters for reusable logic
   - Const generics preserve literal types
   - Structural typing with `satisfies`
   - Zero-cost abstractions

## Infrastructure & Capabilities

### Configuration Files

#### `vite.config.ts` (392 lines)

**Architecture** (5 Pillars):
1. **Single B Constant**: All 18 configuration properties in one frozen object
2. **Discriminated Union Schema**: `CfgSchema` with `mode: 'app' | 'library'` polymorphism
3. **Dispatch Tables**: `plugins[mode]()`, `config[mode]()` for type-safe lookup
4. **Pure Utility Functions**: 14 single-expression helpers (browsers, chunk, css, etc.)
5. **Single Polymorphic Entry Point**: `createConfig(input)` → decode → dispatch → UserConfig

**Single B Constant** (18 properties):
```typescript
const B = Object.freeze({
    assets, browsers, cache, chunks, comp, csp, exts, glob, img, port, pwa, ssr, svgr, treeshake, viz
} as const);
// Access: B.browsers, B.chunks, B.pwa.manifest, etc.
```

**Discriminated Union Schema**:
```typescript
const CfgSchema = S.Union(
    S.Struct({ mode: S.Literal('app'), port: S.optional(S.Number), ... }),
    S.Struct({ mode: S.Literal('library'), entry: ..., name: S.String, ... }),
);
// One schema validates all modes, TypeScript narrows automatically
```

**Dispatch Tables** (replace if/else):
```typescript
const plugins = {
    app: (c, prod) => [...app-specific plugins...],
    library: () => [...library-specific plugins...],
} as const;

const config = {
    app: (c, b, env) => UserConfig,
    library: (c, b) => UserConfig,
} as const;
// Usage: config[mode](c, b, env) — type-safe, extensible
```

**Single Polymorphic Entry Point**:
```typescript
const createConfig = (input: unknown): Effect.Effect<UserConfig, never, never> =>
    pipe(
        Effect.try(() => S.decodeUnknownSync(CfgSchema)(input)),
        Effect.orDie,
        Effect.flatMap((c) => pipe(
            Effect.all({ b, p, t, v }),
            Effect.map(({ b, p, t, v }) => config[c.mode](c as never, b, { prod: p, time: t, ver: v })),
        )),
    );
// Usage: defineConfig(Effect.runSync(createConfig({ mode: 'library', entry, name })))
```

**Pure Utility Functions** (14 total):
- `browsers()`: Parse browserslist to esbuild targets
- `chunk(id)`: Chunk strategy with Option pattern matching
- `css(b, dev)`: LightningCSS config with custom media drafts
- `esbuild(app, prod)`: esbuild purity + minification
- `compress(alg, ext, t)`: Compression plugin factory
- `cache(h, n, s, u)`: Runtime caching strategy
- `output(p)`: Output path configuration
- `icons()`: PWA icon generation
- `imgOpt(q)`: Image optimizer config
- `resolve(browser)`: Resolution config

**Vite Configuration Features**:
- Manifest generation: `manifest: true`, `ssrManifest: true`
- CSS: Lightning CSS transformer, custom media drafts
- esbuild: ESNext target, pure annotations, tree-shaking
- Warmup: Pre-bundle `main.tsx`, `**/*.tsx`, `index.ts`
- Build Hooks: `buildStart`, `buildEnd` (Option monads), `buildApp` (Vite 7 experimental)
- Rollup Plugins: Visualizer (treemap with Brotli sizes)

#### `vitest.config.ts` (103 lines)

**Unified Constant Factory** (lines 7-19):
```typescript
Effect.runSync(Effect.all({
    coverage, patterns, reporters
}))
```

**Frozen Constants** (7 total):
- `COVERAGE_THRESHOLDS`: 80% across branches/functions/lines/statements
- `COVERAGE_EXCLUDE_PATTERNS`: Config/types/mocks/dist exclusions
- `TEST_EXCLUDE_PATTERNS`: E2E test exclusions
- `TEST_INCLUDE_PATTERNS`: `**/*.{test,spec}.{ts,tsx}`
- `BENCHMARK_INCLUDE_PATTERNS`: `**/*.bench.{ts,tsx}`
- `COVERAGE_REPORTERS`: text, JSON, HTML, lcov
- `TEST_REPORTERS`: default, HTML, JSON, JUnit

**Features**:
- **Coverage**: V8 provider, 80% thresholds, 4 reporters
- **Browser Mode**: Playwright/Chromium (disabled by default)
- **UI Mode**: Vitest UI enabled
- **Benchmarks**: Separate patterns
- **Projects**: Unit tests (happy-dom)
- **Typecheck**: TSC checker (disabled by default)

#### `biome.json` (133 lines)

**Linter Rules** (70+ rules):
- **Correctness**: No unused imports/variables, exhaustive deps, yield enforcement
- **Style**: No default exports, block statements, const preference, import types
- **Complexity**: Max cognitive complexity 25, no forEach, arrow functions
- **Suspicious**: No console (warn), no any, no var
- **Performance**: No barrel files, no re-export-all
- **Nursery**: No floating promises, exhaustive switch

**GritQL Plugins** (3 master-level):
- `effect-patterns.grit`: 23 rules (ROP, pipelines, Option/Either monads)
- `zod-patterns.grit`: 26 rules (branded types, _tag discriminators, strict schemas)
- `functional-patterns.grit`: 47 rules (immutability, pure functions, no mutations)

**Overrides**:
- Config files: Allow default exports
- Effects/services: Use universal complexity limit (25)
- JSONC: Trailing commas

#### `.npmrc` (35 lines)

**Strict Enforcement**:
- `engine-strict=true`: Fail on version mismatch
- `use-node-version=25.2.1`: Lock Node.js
- `resolution-mode=highest`: Always latest versions
- `save-exact=true`: No version ranges
- `frozen-lockfile=true`: Immutable lockfile

**Workspace**:
- `prefer-workspace-packages=true`
- `link-workspace-packages=deep`
- `save-workspace-protocol=rolling`
- `node-linker=isolated`: Strict isolation

**Performance**:
- `side-effects-cache=true`
- `public-hoist-pattern=[]`: No hoisting

#### `nx.json` (131 lines)

**Cacheable Operations**: build, test, typecheck, check, analyze

**Named Inputs**:
- `sharedGlobals`: Tracks all config files (vite, vitest, biome, tsconfig, package, lockfile)
- `production`: Excludes tests/specs

**Plugins**:
- `@nx/vite`: build/dev/preview/serve-static targets
- Smart caching, dependency graphs, parallel execution (4 workers)

**Custom Targets** (tool-specific workflows):
- `analyze`: Bundle visualization server (port 8080, requires build)
- `inspect:dev`: Dev-time plugin inspection (`http://localhost:5173/__inspect/`)
- `inspect:build`: Post-build analysis server (port 8081, requires build)
- `pwa:icons`: Generate PWA icons with tsx (`--no-warnings` flag)
- `pwa:icons:watch`: Hot-reload icon generation for development
- `validate:compression`: Verify Brotli/gzip artifacts after build

#### `pnpm-workspace.yaml`

**Catalog** (version single-source-of-truth):
- All dependencies centralized
- Exact versions (no ranges)
- Bleeding-edge canaries/betas included

**Workspaces**: `apps/*`, `packages/*`

#### `tsconfig.base.json`

**Compiler Options**:
- `strict: true`
- `exactOptionalPropertyTypes: true`
- `noUncheckedIndexedAccess: true`
- ES2022 target, ESNext module
- Path aliases: `@/*` → `/packages/*`

### Plugins & Tools

**Vite Plugins** (12):
1. `@vitejs/plugin-react` (React 19 compiler integration)
2. `@tailwindcss/vite` (Tailwind v4)
3. `vite-plugin-pwa` (Workbox 7, manifest, auto-update)
4. `vite-plugin-svgr` (SVG→React, TypeScript, memo)
5. `parametric-build-hooks` (custom, Option monads)
6. `vite-plugin-inspect` (bundle analysis, dev/build modes)
7. `vite-plugin-compression` (Brotli + gzip, 10KB threshold, text-only)
8. `vite-plugin-image-optimizer` (AVIF/WebP, Sharp-based, progressive JPEG)
9. `vite-plugin-csp` (Content Security Policy + SRI generation, security)
10. `vite-plugin-webfont-dl` (self-host web fonts, performance optimization)
11. `rollup-plugin-visualizer` (treemap, Brotli sizes, sourcemap integration)
12. `vite-tsconfig-paths` (tsconfig path alias resolution)

**Development Tools**:
- `tsx`: TypeScript execution (10-100x faster than ts-node, ESM-native)
- `@vitest/ui`: Visual test interface
- `@vitest/coverage-v8`: V8 coverage provider
- `happy-dom`: Lightweight DOM for tests
- Playwright: Browser testing (Chromium)

### Patterns & Conventions

**File Naming**: (from Biome overrides)
- `*.config.ts`: Configuration files
- `*.{test,spec}.{ts,tsx}`: Unit tests
- `*.bench.{ts,tsx}`: Benchmarks
- `*.{test,spec}-d.{ts,tsx}`: Type tests
- `*.e2e.{test,spec}.{ts,tsx}`: E2E tests

**Import Organization**: (Biome auto-sort)
1. External packages
2. Internal aliases (`@/`)
3. Relative imports
4. Type imports (separate)

**Constant Pattern** (Single B Constant):
```typescript
// ❌ OLD: Scattered constants
const SIZES = Object.freeze({...});
const VARIANTS = Object.freeze({...});
const DEFAULTS = Object.freeze({...});

// ✅ NEW: Single B constant
const B = Object.freeze({
    defaults: { size: 'md', variant: 'primary' },
    sizes: { sm: 8, md: 12, lg: 16 },
    variants: { primary: 'bg-blue', secondary: 'bg-gray' },
} as const);
// Access: B.defaults.size, B.sizes.md, B.variants.primary
```

**Dispatch Table Pattern** (replace if/else):
```typescript
// ❌ OLD: if/else chains
if (mode === 'app') return appConfig();
else if (mode === 'library') return libConfig();

// ✅ NEW: Dispatch table
const handlers = {
    app: (c) => appConfig(c),
    library: (c) => libConfig(c),
} as const;
return handlers[mode](config); // Type-safe lookup
```

**Polymorphic Entry Point Pattern**:
```typescript
// ❌ OLD: Separate factory functions
export const createAppConfig = () => {...};
export const createLibraryConfig = () => {...};

// ✅ NEW: Single polymorphic entry
export const createConfig = (input: unknown) =>
    pipe(
        Effect.try(() => S.decodeUnknownSync(CfgSchema)(input)),
        Effect.orDie,
        Effect.map((c) => handlers[c.mode](c)),
    );
```

**Effect Pipeline Pattern**:
```typescript
const fn = (): Effect.Effect<Result, never, never> =>
    pipe(
        Effect.all({...}),
        Effect.map(transform),
        Effect.map(validate)
    );
```

**Option Monad Pattern**:
```typescript
const result = pipe(
    Option.fromNullable(value),
    Option.match({
        onNone: () => defaultValue,
        onSome: (v) => transform(v),
    })
);
```

**Factory Export Pattern** (packages/components style):
```typescript
export { B as COMPONENT_TUNING, createComponents };
// Consumers: import { COMPONENT_TUNING, createComponents } from '@/components';
```

**Tool Integration Patterns**:

*tsx Usage* (TypeScript script execution):
```bash
# Nx targets (preferred)
nx pwa:icons                    # Run script once with --no-warnings
nx pwa:icons:watch              # Watch mode for development

# Direct usage
tsx --no-warnings scripts/my-script.ts    # Single run
tsx watch scripts/my-script.ts             # Hot-reload mode
```

*Bundle Analysis* (visualizer + inspect):
```bash
# After build, analyze bundle composition
nx analyze                      # Serve .vite/ at http://localhost:8080
# Opens treemap, network view, stats.json

# Inspect plugin transformations
nx inspect:dev                  # Dev: http://localhost:5173/__inspect/
nx inspect:build                # Build: http://localhost:8081 (serves .vite-inspect/)
```

*Compression Validation*:
```bash
# Verify production artifacts include Brotli + gzip
nx validate:compression         # Checks for .br and .gz files
```

**File Organization Standard** (mandatory for all `.ts` files >50 LOC):
```typescript
// Imports (external → @/ → relative → type-only)
import * as S from '@effect/schema/Schema';
import { Effect, pipe } from 'effect';
import type { UserConfig } from 'vite';

// --- Type Definitions -------------------------------------------------------
type MyType = { readonly field: string };

// --- Schema Definitions -----------------------------------------------------
const ConfigSchema = S.Union(
    S.Struct({ mode: S.Literal('app'), ... }),
    S.Struct({ mode: S.Literal('library'), ... }),
);

// --- Constants --------------------------------------------------------------
const B = Object.freeze({
    defaults: { ... },
    settings: { ... },
} as const);

// --- Pure Utility Functions -------------------------------------------------
const helper = (x: string): boolean => x.includes('test');

// --- Dispatch Tables --------------------------------------------------------
const handlers = {
    app: (c) => appConfig(c),
    library: (c) => libConfig(c),
} as const;

// --- Effect Pipeline --------------------------------------------------------
const createConfig = (input: unknown) =>
    pipe(
        Effect.try(() => S.decodeUnknownSync(ConfigSchema)(input)),
        Effect.orDie,
        Effect.map((c) => handlers[c.mode](c)),
    );

// --- Export -----------------------------------------------------------------
export { B as CONFIG_TUNING, createConfig };
```

**Separator Format**:
- `// --- Section Name -------------------------------------------------------`
- Triple-dash, space, title (PascalCase words), space, dashes to 77 chars total
- Required sections: Type Definitions, Schema Definitions, Constants, Pure Utility Functions, Dispatch Tables, Effect Pipeline, Export
- **Rationale**: Top-down dependency flow (types → schemas → constants → utils → dispatch → pipeline → export). Cognitive load reduction: abstract/small at top, concrete/large at bottom. Scanability: reference material immediately visible.

## Custom Agent Profiles

**10 Specialized Agents** (`.github/agents/*.agent.md`):

1. **cleanup-specialist** - Ultra-dense code cleanup with algorithmic density focus
2. **documentation-specialist** - Documentation consistency across all project files
3. **integration-specialist** - Ensures unified factories and catalog-driven dependencies
4. **library-planner** - Research and create new Nx packages with proper structure
5. **performance-analyst** - Bundle size, tree-shaking, code splitting optimization
6. **react-specialist** - React 19 canary + Compiler + Server Components expertise
7. **refactoring-architect** - Holistic refactoring with Effect/Option pipeline migration
8. **testing-specialist** - Vitest + property-based testing with Effect/Option patterns
9. **typescript-advanced** - Bleeding-edge TypeScript with ultra-dense functional code
10. **vite-nx-specialist** - Vite 7 Environment API + Nx 22 Crystal inference mastery

**Agent Delegation**: Use custom agents for specialized tasks before attempting yourself. They have domain-specific knowledge, exemplar references, and modern prompt engineering patterns built-in.

## Modern Prompt Engineering (2024-2025)

**Core Principles Applied**:

1. **Precision & Task Specificity**: Unambiguous language, explicit output formats, compliance requirements upfront
2. **Context Framing**: Rich background (REQUIREMENTS.md, exemplars), architectural patterns, stack versions
3. **Stepwise Structure**: Multi-step protocols, sequential subtasks, iterative refinement loops
4. **Few-Shot Learning**: 1-5 concrete examples of desired patterns (before/after transformations)
5. **Security-First**: Type safety emphasis (100% coverage), Effect error channels, Zod validation gates
6. **Iterative Refinement**: Continuous improvement, automated optimization, feedback integration
7. **Adaptive Context**: Self-adjusting to user intent, multimodal when needed (code + diagrams + docs)

**Implementation**:
- All agent profiles use stepwise protocols (Research → Plan → Implement → Validate)
- Exemplar references (vite.config.ts, packages/components) provide few-shot learning foundation
- Security gates enforce schema validation, branded types, Effect error handling
- Iterative loops via quality checklists and validation steps

## Working with Custom Agents

**When to Delegate**:

```typescript
// Decision Tree (use first matching agent)
const agentForTask = (task: Task): AgentName =>
  task.involves.react19 ? 'react-specialist' :
  task.involves.viteConfig ? 'vite-nx-specialist' :
  task.involves.testing ? 'testing-specialist' :
  task.involves.performance ? 'performance-analyst' :
  task.involves.refactoring ? 'refactoring-architect' :
  task.involves.newPackage ? 'library-planner' :
  task.involves.typescript ? 'typescript-advanced' :
  task.involves.documentation ? 'documentation-specialist' :
  task.involves.integration ? 'integration-specialist' :
  task.involves.cleanup ? 'cleanup-specialist' :
  'self'; // Do it yourself as fallback
```

**Agent Interaction Patterns**:

1. **Sequential Chain**: library-planner → typescript-advanced → testing-specialist
2. **Parallel Tasks**: documentation-specialist + integration-specialist (independent)
3. **Iterative Refinement**: refactoring-architect → cleanup-specialist → refactoring-architect
4. **Validation Loop**: Any agent → integration-specialist (verify integration)

**Providing Context** (required for effective delegation):
- Pass relevant file paths (absolute from repo root)
- Reference catalog versions from `pnpm-workspace.yaml`
- Cite exemplar patterns (vite.config.ts, packages/components)
- Specify exact success criteria and constraints

## Integration Requirements

### For New Code

**MUST**:
1. Use single `B` constant pattern (never scatter multiple frozen constants)
2. Use dispatch tables (replace if/else with `handlers[mode]()`)
3. Use discriminated union schemas for polymorphic validation
4. Follow Effect pipeline pattern for async operations
5. Use Option monads for nullable values
6. Single `Object.freeze` for B constant
7. Use `as const` for all object literals
8. Type all functions with Effect/Option return types
9. Follow expression-based style (no if/else)
10. Validate with @effect/schema (runtime safety)
11. Run Biome check before committing
12. **Delegate to custom agents** when task matches their expertise

**MUST NOT**:
1. Scatter multiple frozen constants (use single B)
2. Use if/else (use dispatch tables)
3. Use `any` type (except experimental APIs)
4. Use `let` or mutations
5. Use imperative loops
6. Use try/catch (use Effect error channel)
7. Create separate builder functions (use polymorphic entry point)
8. Create default exports (except config files)
9. Omit type annotations
10. Skip schema validation
11. **Bypass custom agents** for their specialized domains

### Quality Targets

- **Functionality Density**: 25-30 lines/feature
- **Type Coverage**: 100% (strict TypeScript)
- **Test Coverage**: 80% minimum (V8)
- **Cognitive Complexity**: ≤25 per function
- **Build Performance**: <3s dev server start
- **Bundle Size**: <250KB gzipped (main chunk)

## Maintenance

**Version Updates**:
- Check for bleeding-edge versions weekly
- Update `pnpm-workspace.yaml` catalog
- Run `pnpm update --latest`
- Verify with `pnpm exec tsc --noEmit`
- Validate with `pnpm exec biome check .`

**Adding Dependencies**:
1. Add to `pnpm-workspace.yaml` catalog with exact version
2. Reference via `catalog:` in `package.json`
3. Document in this file if it affects code patterns
4. Update GritQL plugins if new patterns emerge

**GritQL Plugins** (currently disabled due to Biome 2.3.7 bug):
- Re-enable when Biome fixes `grit-pattern-matcher` panic
- GitHub issue: biomejs/biome#7771
- Plugins validated syntactically, ready for activation

---

**Last Updated**: 2025-01-XX
**Agent Profiles**: 10 specialized agents (+5,056 lines comprehensive guidance)
**Modern Prompt Engineering**: 2024-2025 best practices (precision, context, stepwise, few-shot, security-first)
**Vite Config**: 392 lines, single B constant (18 props), dispatch tables, polymorphic createConfig
**Exemplars**: vite.config.ts (master pattern), packages/components (B constant + factory API)
**Security & Performance**: CSP + SRI, web font self-hosting, comprehensive optimization
**Vitest Config**: 103 lines, 7+ features
**Nx Targets**: 10+ custom targets (analyze, inspect, validate, pwa:icons)
**Tool Integration**: tsx, compression, visualizer, image-optimizer, inspect (fully optimized)
**Custom Agents**: Sequential chains, parallel tasks, iterative refinement patterns
