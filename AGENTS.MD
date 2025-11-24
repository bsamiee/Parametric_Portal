# Parametric Portal — Agent Charter (Bleeding-Edge, Dogmatic)

You are operating inside a bleeding-edge Nx/Vite/Effect monorepo. This is the single source of truth for agent behavior. All constraints are immutable. Never relax or suppress rules to "make it work." Always align with `REQUIREMENTS.md`, `biome.json`, `tsconfig.base.json`, `vite.config.ts`, `vitest.config.ts`, `nx.json`, `.npmrc`, `package.json`, `pnpm-workspace.yaml`.

## Stack Pins (catalog, bleeding-edge only)
- Nx `22.2.0-canary.20251121-9a6c7ad`
- Vite `7.2.4` + Vite 7 env API
- React `19.3.0-canary-*` + React Compiler `19.0.0-beta-*`
- Tailwind CSS `4.1.17` via `@tailwindcss/vite` (v4 alpha)
- LightningCSS `1.30.2` (exclusive CSS pipeline; PostCSS is forbidden)
- Effect `3.19.6`
- Zod `4.1.13`
- Biome `2.3.7`
- TypeScript `6.0.0-dev.20251121`
- Vitest `4.0.13`
- Node `25.2.1`, pnpm `10.23.0`

## Executive Protocol (read before touching code)
1) Read all root configs: `.npmrc`, `pnpm-workspace.yaml`, `package.json`, `nx.json`, `tsconfig.base.json`, `vite.config.ts`, `vitest.config.ts`, `biome.json`, `REQUIREMENTS.md`.
2) Check catalog versions; never use anything outside the pinned bleeding-edge catalog.
3) Plan changes around existing factories/constants (Vite/Vitest) and Nx targets; no ad-hoc scripts.
4) Validate design against dogmatic FP/ROP + ultra-strong types; reject any approach needing rule suppression.
5) For any tool/feature: do deep doc research (latest ≤6 months) before implementation. If no recent docs, choose a newer alternative or block the change.

## Non-Negotiable Principles (code philosophy)
- **Bleeding-edge TypeScript**: TypeScript `6.0.0-dev`, zero `any` (except sanctioned experimental APIs), branded types, const type params, `as const` everywhere, `ReadonlyArray` by default, no stringly-typed params/flags.
- **Functional + Monadic ROP**: Pure, side-effect–free logic. No `let`, no mutation, no imperative loops, no `if/else`. Use `Effect` for sequencing/error channel, `Option` for nullables. No `try/catch`.
- **Expression-only, DRY, Parameterized**: Single-expression arrows; Option pattern matching; no duplicated constants. Derive from base values; freeze (`Object.freeze`) after construction.
- **Polymorphic & Algorithmic Density**: Generic, structural, zero-cost abstractions. Parameterized builders over literals. Ultra-dense, multi-feature composition without sacrificing type soundness.
- **No rule softening**: Do not disable Biome/TypeScript rules. Redesign code to comply.

## Stack & Versions (root-only, catalog-driven)
- Node `25.2.1`, pnpm `10.23.0` (engine-strict, frozen lockfile, isolated linker, no hoisting).
- Catalog-only installs in `pnpm-workspace.yaml`; reference via `catalog:` (no ranges, no direct versions). Tools installed at root only, never per-project.
- Workspaces: `apps/*`, `packages/*`. Scripts: `pnpm build | test | typecheck | check` (Nx run-many). No hand-rolled equivalents.

## Config Intelligence (reuse, never reimplement)
- **`nx.json`**: Cacheable ops (build/test/typecheck/check); named inputs include `sharedGlobals` (all root configs). Outputs go to `{projectRoot}/dist` for builds, `{projectRoot}/coverage` for tests. Use Nx target defaults and dependency graph; keep inference plugins on.
- **`tsconfig.base.json`**: Strict, ESNext target/module, bundler resolution, JSX react-jsx, `@/* -> packages/*`, `verbatimModuleSyntax: true`, `noUncheckedSideEffectImports: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. Extend, never weaken.
- **`biome.json`**: 120 width, 4 spaces, single quotes, trailing commas (JS). No default exports (except configs), no console (warn), no `any`, no `forEach`, complexity ≤10, exhaustive deps/switch, naming conventions enforced. GritQL plugins (Effect/Zod/Functional) are canonical patterns—even if disabled upstream, treat as required behavior.
- **`vite.config.ts`**: Unified factory via `Effect.runSync(Effect.all({...}))`. Frozen constants: `BROWSER_TARGETS`, `CHUNK_PATTERNS`, `ASSET_PATTERNS`, `PLUGIN_CONFIGS`, `PWA_MANIFEST`, `PWA_WORKBOX_CONFIG`, `SVGR_OPTIONS`, `BUILD_MESSAGES`, `SSR_CONFIG`. Use `createBuildConstants`, `getDropTargets`, `createChunkStrategy`, `createAllPlugins`. Respect: LightningCSS (no PostCSS), React 19 compiler, Tailwind v4 alpha via `@tailwindcss/vite`, PWA with Workbox, esbuild purity, chunk naming, worker config, warmup. Never inline or bypass factories.
- **`vitest.config.ts`**: Frozen coverage thresholds (80%), include/exclude, reporters, UI on, happy-dom env, Playwright browser disabled by default, benchmarks separated, typecheck config present (off by default). Always merge with base Vite config.
- **`.npmrc`**: engine-strict, isolated linker, highest resolution, save-exact, frozen lockfile, no hoist. Never override locally.
- **`.gitignore`**: Respect `.vite`, coverage, caches, build outputs.

## LightningCSS/Tailwind/React Policy (CSS and UI stack)
- LightningCSS is the only CSS pipeline; PostCSS is forbidden. Keep `lightningcss` drafts/nonStandard flags intact (custom media, deep selector).
- Tailwind v4 alpha is provided solely via `@tailwindcss/vite`; do not add legacy Tailwind/PostCSS chains. Extend via configless utilities or Vite plugin options only.
- Prefer CSS features that LightningCSS optimizes (custom media, nesting). Keep targets aligned with `BROWSER_TARGETS`.
- React 19 + React Compiler stay enabled through `PLUGIN_CONFIGS.react`; do not switch to classic JSX transforms.

## Nx/Vite/Vitest Usage Patterns
- Use Nx targets (`build`, `test`, `typecheck`, `check`) with run-many or affected; never bypass with raw vite/vitest scripts.
- Respect Nx outputs (`{projectRoot}/dist`, `{projectRoot}/coverage`) and named inputs (`sharedGlobals`, `production`); add new inputs/outputs if you introduce new artifacts.
- Extend Vite/Vitest only through existing factories: add plugins via `createAllPlugins` (reuse `PLUGIN_CONFIGS`), extend build constants via `createBuildConstants`, adjust chunking via `createChunkStrategy`.
- Keep Vite manifest + ssrManifest on; preserve esbuild purity (`pure`, `drop`, `minify*`) and treeshake settings.
- Keep Vitest merged with Vite config; preserve coverage thresholds/reporters; keep browser mode off unless explicitly enabled through config.

## API & Type Design (ultra-strong, dense, polymorphic)
- Prefer Zod schemas with `.brand()` for all external/IO data; mirror with exported types. No string unions; use branded discriminants.
- Encode variability via const generics and parameterized builders. Keep API surface small but multimodal (options objects with branded keys, validated).
- Use `satisfies` for exhaustiveness and to constrain literal widening. Avoid `as` casts; redesign the type if a cast feels necessary.
- Model nullables as `Option`; model async/failable as `Effect`. Do not leak raw promises or `undefined`.
- Freeze derived constants; hoist shared baselines; DRY across packages by reusing factories and aliases (`@/*`).

## Functional/ROP Patterns (senior-level defaults)
- Expression-only arrows; no statements/blocks except minimal config objects.
- Control flow via `Option.match` and `Effect` combinators (`map`, `flatMap`, `all`, `match`, `catchAll` only when typed).
- Composition via `pipe`; no nested inline lambdas when a named helper increases clarity and reuse.
- No mutation; no `let`; no loops—prefer `ReadonlyArray` combinators and `EffectArray` helpers.

## Research Workflow (must precede implementation)
- For every tool/plugin/addon/extension touched: read latest docs/RFC/changelog ≤6 months old. If unavailable, choose a newer alternative or redesign.
- Verify API signatures and type definitions from official sources (not blogs/older gists). Prefer canary/beta docs matching our pinned versions.
- Re-open root configs after research to ensure integration points (Nx targets, Vite factories, tsconfig strictness, Biome rules) are honored.

## Dependency & Tool Onboarding (root-only, catalog-first)
1) Research latest (≤6 months) stable/canary version; prefer official Nx plugin if available.
2) Add exact version to `pnpm-workspace.yaml` catalog.
3) Reference via `catalog:` in root `package.json` (and workspace package manifests if needed).
4) If Nx plugin exists, wire targets/inputs/outputs in `nx.json` (cacheable ops, standard output paths, sharedGlobals).
5) If Vite/Vitest plugin, integrate through existing factories (`createAllPlugins`, `createBuildConstants`, `createChunkStrategy`) and reuse `PLUGIN_CONFIGS`. No ad-hoc plugin wiring.
6) Run `pnpm install --lockfile-only` (root). Never per-project installs.
7) Re-read configs to ensure alignment; update docs/comments only if needed—never relax rules.

## Implementation Protocol (dogmatic)
1. **Model first (Zod + brands)**: Strict schemas with `.brand()`; mirror with types. Validate every IO boundary; reject stringly-typed flags.
2. **Pipeline everything (Effect/Option)**: `pipe(Effect.all(...), Effect.map(...))`; `Option.fromNullable(...).pipe(Option.match(...))`. No statements.
3. **Freeze + derive**: Build constants in a factory, schema-validate, then `Object.freeze`. Reuse frozen constants before introducing new ones.
4. **Parameterize**: Builders accept baselines/params, derive outputs (chunk strategies, targets, runtime options). No literals.
5. **Imports/order**: External → `@/` aliases → relatives; type imports isolated. No barrel files, no re-export-all.
6. **Outputs/paths**: `{projectRoot}/dist` for builds, `{projectRoot}/coverage` for tests; respect Nx target outputs.
7. **LightningCSS-only CSS**: No PostCSS. Tailwind v4 via `@tailwindcss/vite`. Keep LightningCSS drafts/nonStandard flags as configured.
8. **React 19 compiler**: Keep babel plugin via `PLUGIN_CONFIGS.react`. Do not downgrade.
9. **Vite 7 env API**: Keep manifest + ssrManifest; do not remove `buildApp` hooks or chunk strategy.
10. **SSR config**: Use `SSR_CONFIG` helper; no inline SSR overrides.

## File Organization Standard (mandatory structure)
**Top-down dependency flow** (simple → complex, abstract → concrete):

1. **Imports** (lines 1-10)
   - External packages (alphabetical)
   - Internal `@/` aliases (alphabetical)
   - Relative imports (alphabetical)
   - Type-only imports (separate, `import type`)
   - Biome auto-sorts via `organizeImports: "on"`

2. **Type Definitions** (atomic types first)
   - Utility types (e.g., `ChunkDecision = Option.Option<string>`)
   - Derived types (e.g., `ConfigSchemas = ReturnType<...>`)
   - Branded types via `z.infer<...>`
   - No implementations—pure type declarations

3. **Schema Definitions** (validation layer)
   - Zod schemas via factory functions
   - Foundation for runtime validation
   - Mirrors type definitions

4. **Constants** (frozen, immutable data)
   - Unified Effect factory: `Effect.runSync(Effect.all({...}))`
   - Individual `Object.freeze(...)` per constant
   - Validated via schemas before freezing

5. **Pure Utility Functions** (predicates, transformers)
   - Smallest/simplest first (e.g., `matchesNodeModules`)
   - No side effects, no mutations
   - Single-expression arrows

6. **Effect Pipelines & Builders** (composition layer)
   - Simple helpers first (e.g., `createSSRConfig`)
   - Complex factories last (e.g., `createViteConfig`)
   - Monadic composition via `pipe`

7. **Export** (entry point)
   - Default export for configs (allowed via Biome override)
   - Named exports for reusable utilities

**Section Separators** (mandatory format):
```typescript
// --- Section Name -------------------------------------------------------
```
- Triple-dash prefix, single space, title, space, dashes to ~77 chars total (80 - 3 for `//` + space)
- Sections: `Type Definitions`, `Schema Definitions`, `Constants (Unified Factory → Frozen)`, `Pure Utility Functions`, `Effect Pipelines & Builders`, `Export`
- Visual clarity for 100+ line files; scanability at-a-glance

## Code Density & Type Rigor
- Target ultra-dense functions (multi-feature per ~25-30 LOC) without complexity >10.
- Use generics + const generics to preserve literals.
- Prefer `satisfies` for exhaustiveness.
- No string unions for flags—use branded enums/types.
- Treat every nullable as `Option`; every async/failable as `Effect`.
- Ban implicit `any`; ban structural holes; ban unchecked casts.

## Debugging & Research Protocol
- Before fixes/changes: read latest docs (≤6 months) for every involved tool/plugin/addon/extension. If docs are older, find newer canary/beta or redesign.
- Cross-check API signatures and type definitions; prefer official RFC/CHANGELOG for breaking changes.
- Re-open root configs to ensure compliance (Nx targets, Vite/Vitest factories, tsconfig strictness, Biome rules).
- Never apply “suppress/disable rule” fixes; redesign code to satisfy constraints.

## Testing & Quality Gates
- Run `pnpm check` (Biome) and `pnpm typecheck` before commit; `pnpm test` (Vitest UI/coverage) as needed. Coverage ≥80% (frozen).
- Keep cognitive complexity ≤10 unless explicitly covered by overrides (effects/services/schemas).
- Ensure Nx caching remains valid (inputs/outputs untouched).

## Exemplar References

**Canonical Implementations** (study these):
- `/packages/theme/` - Perfect adherence to all patterns
- `/vite.config.ts` - Unified factory pattern, frozen constants, Effect pipelines
- `/vitest.config.ts` - Config merging, Effect all pattern
- `/tsconfig.base.json` - Strictest TypeScript configuration
- `/biome.json` - Comprehensive linting rules

**Patterns to Apply Verbatim**:
```typescript
// Option flow
const value = Option.fromNullable(input).pipe(
    Option.match({ onNone: () => fallback, onSome: transform })
);

// Effect pipeline
const task = pipe(
    Effect.all({ a, b }),
    Effect.map(derive),
    Effect.map(validateWithSchema)
);

// Unified factory
const { a, b } = Effect.runSync(Effect.all({
    a: Effect.succeed({...} as const),
    b: Effect.succeed({...} as const),
}));
const A = Object.freeze(a);
const B = Object.freeze(b);

// Branded types
import * as S from '@effect/schema/Schema';
const PositiveInt = pipe(S.Number, S.int(), S.positive(), S.brand('PositiveInt'));
type PositiveInt = S.Schema.Type<typeof PositiveInt>;
```

## Agent Capabilities Matrix

| Agent | Primary Domain | Key Capabilities | When to Use |
|-------|---------------|------------------|-------------|
| **typescript-advanced** | TS 6.0-dev, FP/ROP | Branded types, Effect/Option pipelines, generic optimization | Complex type transformations, FP patterns |
| **react-specialist** | React 19 canary | Compiler optimization, Server Components, use() hook | Any React component or hook work |
| **vite-nx-specialist** | Build config | Vite 7 env API, Nx Crystal, factory patterns | Build configuration, monorepo orchestration |
| **testing-specialist** | Vitest, testing | Property-based tests, Effect/Option testing, coverage | Writing/fixing tests, test architecture |
| **performance-analyst** | Optimization | Bundle analysis, tree-shaking, code splitting | Performance issues, bundle size reduction |
| **refactoring-architect** | Code transformation | Pipeline migration, dispatch tables, holistic refactor | Large-scale refactoring, pattern migration |
| **library-planner** | Package creation | Research, Nx package setup, vite.config factories | Creating new packages, dependency research |
| **integration-specialist** | Cross-package | Unified factories, catalog versions, workspace integration | Ensuring consistency across packages |
| **documentation-specialist** | Documentation | REQUIREMENTS.md, code comments, consistency | Updating docs, comment cleanup |
| **cleanup-specialist** | Code cleanup | Algorithmic density, pattern consolidation | Final polish, density optimization |

**Delegation Priority**: Always check if a custom agent matches your task domain before implementing yourself. Agents have 500+ lines of specialized guidance each.

## Modern Prompt Engineering Principles

**2024-2025 Best Practices Incorporated**:

### 1. Precision & Task Specificity
- **Unambiguous Instructions**: Every agent has explicit MUST/MUST NOT sections
- **Format Requirements**: Exact output formats specified (TypeScript, file structure, etc.)
- **Compliance Gates**: Biome checks, TypeScript strict mode, Zod validation required
- **Success Criteria**: Measurable outcomes (80% coverage, ≤10 complexity, 100% type safety)

### 2. Context Framing
- **Rich Background**: All agents reference REQUIREMENTS.md (385 lines), vite.config.ts (460 lines)
- **Exemplar References**: packages/theme as canonical pattern implementation
- **Architectural Patterns**: Effect/Option pipelines, unified factories, catalog system
- **Stack Versions**: Exact catalog versions prevent outdated assumptions

### 3. Stepwise Structure
- **Research Protocol**: Always research latest docs (≤6 months) before implementation
- **Sequential Workflows**: Read context → Research → Plan → Implement → Validate → Document
- **Iterative Refinement**: Quality checklists, validation loops, re-check after changes
- **Subtask Breakdown**: Complex tasks decomposed into manageable steps

### 4. Few-Shot Learning
- **Concrete Examples**: 1-5 before/after code samples in each agent
- **Anti-Patterns**: Explicit "never do this" examples with explanations
- **Pattern Libraries**: Canonical patterns section with working code
- **Transformation Guides**: Step-by-step refactoring examples

### 5. Security-First Design
- **Type Safety**: 100% type coverage required, no `any` except experimental APIs
- **Branded Types**: Zod `.brand()` for all external/IO boundaries
- **Effect Error Channels**: No try/catch, proper error typing via Effect
- **Validation Gates**: Runtime validation with Zod before business logic
- **Immutability**: Object.freeze, const-only, no mutations enforced

### 6. Iterative Refinement
- **Continuous Improvement**: Re-run checks after each change
- **Feedback Integration**: Biome explain → redesign, never suppress
- **Automated Optimization**: pnpm check, typecheck, test loops
- **Quality Metrics**: Density (25-30 LOC/feature), complexity (≤10), coverage (≥80%)

### 7. Adaptive Context
- **Self-Adjusting**: Agents reference current catalog, not hardcoded versions
- **Multimodal**: Code + diagrams (architectural), docs + examples
- **Intent Recognition**: Task description → agent selection → specialized workflow
- **Scope Awareness**: Monorepo-wide vs package-specific context

## Agent Interaction Patterns

### Sequential Chains (Dependent Tasks)
```
User Request: "Create authentication package"
  ↓
1. library-planner (research + create package structure)
  ↓
2. typescript-advanced (implement Effect-based auth service)
  ↓
3. testing-specialist (write property-based tests)
  ↓
4. documentation-specialist (update docs)
  ↓
5. integration-specialist (verify workspace integration)
```

### Parallel Tasks (Independent)
```
User Request: "Polish codebase"
  ↓
├─ documentation-specialist (update REQUIREMENTS.md)
├─ cleanup-specialist (optimize code density)
└─ integration-specialist (verify catalog consistency)
  ↓
  Merge results
```

### Iterative Refinement (Quality Loop)
```
User Request: "Refactor legacy code to Effect patterns"
  ↓
1. refactoring-architect (migrate to Effect pipelines)
  ↓
2. cleanup-specialist (optimize density)
  ↓
3. refactoring-architect (review, adjust)
  ↓
4. testing-specialist (ensure coverage maintained)
  ↓
  Repeat until quality targets met
```

### Validation Loop (Safety Gate)
```
Any Agent Completes Work
  ↓
integration-specialist (verify):
  - Catalog versions correct?
  - Factories extended (not bypassed)?
  - File organization compliant?
  - Type safety maintained?
  ↓
  Pass → Done
  Fail → Return to original agent
```

## Success Criteria

**Code Quality**:
- Code and configs remain strict, unsuppressed
- Functional, monadic, expression-only style preserved
- Strong typing enforced (branded, generic, no stringly flags)
- Ultra-dense, parameterized, polymorphic implementations
- DRY maintained at all levels (constants, factories, pipelines)

**Architecture Compliance**:
- New work composes with existing factories/plugins/constants
- Artifacts, caching, manifests align with Nx/Vite defaults
- LightningCSS-only, React 19 compiler, Tailwind v4 alpha retained
- Vite 7 env API, Nx 22 Crystal inference leveraged

**Process Adherence**:
- Research protocol followed (latest docs, ≤6 months)
- Catalog-root onboarding pattern used (no direct versions)
- Custom agents delegated to when domain matches
- Stepwise workflows completed (Research → Validate)

**Agent-Specific Success**:
- **typescript-advanced**: 100% type coverage, branded types, Effect/Option used
- **react-specialist**: React Compiler enabled, Server Components async, use() hook proper
- **vite-nx-specialist**: Factories extended (not bypassed), Nx Crystal inference active
- **testing-specialist**: 80% coverage, property-based tests, Effect testing patterns
- **performance-analyst**: Bundle size optimized, tree-shaking verified, lazy loading applied
- **refactoring-architect**: Pipelines migrated, dispatch tables used, holistic consistency
- **library-planner**: Catalog versions, vite.config factory, tsconfig.json extends base
- **integration-specialist**: Unified factories used, catalog references, workspace coherent
- **documentation-specialist**: Cross-references valid, examples compile, 1-line XML comments
- **cleanup-specialist**: 25-30 LOC/feature density, complexity ≤10, no scattered patterns


<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- You have access to the Nx MCP server and its tools, use them to help the user
- When answering questions about the repository, use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable.
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies
- For questions around nx configuration, best practices or if you're unsure, use the `nx_docs` tool to get relevant, up-to-date docs. Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the `nx_workspace` tool to get any errors

<!-- nx configuration end-->