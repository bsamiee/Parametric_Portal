# Parametric Portal — Copilot Instructions

Bleeding-edge Nx/Vite/Effect monorepo: TypeScript 6.0-dev, React 19 canary, dogmatic FP, zero-compromise type safety.

**Context**: [REQUIREMENTS.md](../REQUIREMENTS.md) • [AGENTS.MD](../AGENTS.MD) • Catalog: `pnpm-workspace.yaml`

## Stack (Catalog-Driven, Exact Versions)

TS `6.0.0-dev.20251121` • React `19.3.0-canary` • Compiler `19.0.0-beta` • Vite `7.2.4` • Vitest `4.0.13` • Effect `3.19.6` • Zod `4.1.13` • Nx `22.2.0-canary` • Tailwind `4.1.17` • LightningCSS `1.30.2` • Biome `2.3.7` • Node `25.2.1` • pnpm `10.23.0`

Versions in `pnpm-workspace.yaml` catalog only—reference via `catalog:` in `package.json`. Never hardcode.

## Dogmatic Rules (Build-Failing)

No `any` (Zod `.brand()`) • No `var`/`let` (`const` only) • No `if/else` (ternaries/`Option.match`) • No loops (`.map`/`.filter`/Effect) • `ReadonlyArray<T>` • `as const` • Trailing commas • No default exports (except `*.config.ts`) • No `forEach` • No `console` (warn) • `Option.fromNullable` for nullables • No barrel files (`export *`)

## Catalog & Structure

**Catalog** (`pnpm-workspace.yaml`): Single source, exact versions → reference `"dep": "catalog:"` → `pnpm install` (root only)

**Structure**: `apps/*` (createAppConfig: React 19+Compiler+PWA) • `packages/*` (createLibraryConfig: lib+declarations) • Imports: `@/* → packages/*` • Extend root factories+tsconfig

## Code Patterns

**TypeScript**: Branded types `z.string().brand('X')` • Const params `['a','b'] as const satisfies ReadonlyArray<string>` • `ReadonlyArray<T>` default

**ROP**: `Effect` (async/fail) • `Option` (nullable) • `pipe()` composition • Expression-only (ternaries, no `if/else`)

**Constants**: `Effect.runSync(Effect.all({...}))` → `Object.freeze()` per constant • DRY: single factory

**File Org** (90+ LOC): Imports (ext→@/→rel→type) • Type Defs • Schema Defs • Constants (Unified Factory) • Pure Utils • Effect Pipelines • Export • Separators: `// --- Section Name ---` (77 chars)

## Root Configs (Extend Only)

**vite.config.ts**: 10 frozen constants • Builders: `createAppConfig()` (apps), `createLibraryConfig()` (packages) • Usage: `defineConfig(Effect.runSync(createLibraryConfig({entry,external,name})))`

**vitest.config.ts**: Merges vite config • 80% coverage (V8) • Happy-DOM • UI on • `{projectRoot}/coverage`

**tsconfig.base.json**: Strictest (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess, verbatimModuleSyntax) • ESNext • Bundler • `@/* → packages/*` • Extend: `{"extends":"../../tsconfig.base.json","compilerOptions":{"composite":true,"outDir":"./dist"}}`

**biome.json**: No default exports (except configs) • No any/forEach • Complexity ≤25 • Exhaustive deps/switch • Import type separation • Auto-organize • 120w/4sp/single quotes

**nx.json**: Targets: build/test/typecheck/check • Crystal: auto-infers from vite.config • 4 workers • Outputs: `{projectRoot}/dist`, `{projectRoot}/coverage`

**.npmrc**: engine-strict • Node 25.2.1 • save-exact • frozen-lockfile • isolated linker • zero hoist

## Creating Packages

**Research**: Latest docs (≤6mo) • Check Nx plugins (prefer `@nx/*`) • Official APIs only • Study `packages/theme`

**Setup**: `mkdir packages/X/src` • `package.json` (type:module, exports, deps:catalog) • `tsconfig.json` (extends base, composite, outDir) • `vite.config.ts` (createLibraryConfig)

**Code**: Follow file org • Sections: Type Defs → Schema Defs → Constants (Effect factory) → Pure Utils → Effect Pipelines → Export

**Validate**: `pnpm typecheck` • `pnpm check` • `nx build my-package` • `nx test my-package`

## Project Structure

**Monorepo Layout**: `apps/*` (deployable applications) • `packages/*` (reusable libraries) • `plugins/*` (GritQL linting patterns)

**Key Files**: Root configs govern all projects • `vite.config.ts` (272 lines, 10 frozen constants, 2 builders) • `vitest.config.ts` (103 lines, 80% coverage) • `biome.json` (133 lines, 70+ rules) • `nx.json` (Nx Crystal auto-inference) • `pnpm-workspace.yaml` (catalog)

**Exemplar**: Study `packages/theme` for canonical patterns

## Integration Requirements

**MUST**: Use frozen constants (never recreate) • Effect pipelines (async) • Option monads (nullable) • Unified factory (new constants) • `Object.freeze` all data • `as const` all literals • Type Effect/Option returns • Expression-only style • Zod validation (all IO) • Run `pnpm check` before commit

**MUST NOT**: Use `any` (except experimental APIs) • Use `let`/mutations • Imperative loops • Scattered `Object.freeze` • try/catch (use Effect) • if/else statements • Default exports (except configs) • Omit type annotations • Handroll implementations • Skip validation

**Quality Targets**: 25-30 lines/feature • 100% type coverage • 80% test coverage (V8) • ≤25 complexity • <3s dev start • <250KB main chunk

## Custom Agents (Delegate First)

**10 Specialized Agents** (`.github/agents/*.agent.md`):

1. **typescript-advanced** - TS 6.0-dev, branded types, Effect/Option pipelines
2. **react-specialist** - React 19 canary, Compiler, Server Components
3. **vite-nx-specialist** - Vite 7 env API, Nx 22 Crystal inference
4. **testing-specialist** - Vitest, property-based tests, Effect/Option testing
5. **performance-analyst** - Bundle size, tree-shaking, code splitting
6. **refactoring-architect** - Pipeline migration, dispatch tables, holistic refactor
7. **library-planner** - Research, create Nx packages with proper structure
8. **integration-specialist** - Unified factories, catalog versions, workspace consistency
9. **documentation-specialist** - Update docs, code comments, cross-references
10. **cleanup-specialist** - Algorithmic density, pattern consolidation

**When to Delegate** (decision tree):
```typescript
task.involves.react19         → react-specialist
task.involves.viteConfig      → vite-nx-specialist
task.involves.testing         → testing-specialist
task.involves.performance     → performance-analyst
task.involves.refactoring     → refactoring-architect
task.involves.newPackage      → library-planner
task.involves.typescript      → typescript-advanced
task.involves.documentation   → documentation-specialist
task.involves.integration     → integration-specialist
task.involves.cleanup         → cleanup-specialist
task.involves.generalCoding   → self (use patterns below)
```

**Agent Benefits**: 500+ lines specialized guidance, modern prompt engineering (precision, context, stepwise, few-shot), domain expertise

## Modern Prompt Engineering Tips

**For Effective Copilot Interactions**:

1. **Be Precise**: "Create Effect pipeline for async fetch" vs "make it async"
2. **Provide Context**: Reference files (`packages/theme/src/index.ts`), catalog versions
3. **Request Stepwise**: "First research, then plan, then implement, then validate"
4. **Show Examples**: "Like packages/theme but for authentication"
5. **Emphasize Security**: "Use branded types for UserId, validate with Zod"
6. **Iterate**: "Check types → Fix errors → Check lint → Fix issues → Done"
7. **Cite Standards**: "Follow REQUIREMENTS.md file organization (77-char separators)"

**Anti-Patterns to Avoid**:
- ❌ "Fix this" (vague) → ✅ "Convert if/else to Option.match per AGENTS.MD"
- ❌ "Add types" (generic) → ✅ "Add branded type via z.string().uuid().brand('UserId')"
- ❌ "Make faster" (unclear) → ✅ "Apply lazy loading per performance-analyst patterns"

## Interaction Guidelines

**Code Generation**: Read context first (`vite.config.ts`, `package.json`, `tsconfig.base.json`) • Match patterns (`packages/theme`) • Use catalog versions • Apply Effect/Option monads • Follow file org (section separators) • Validate with Zod • No mutations • Expression-only • Research first (≤6mo docs) • **Delegate to custom agents** when domain matches • Never relax rules

**Questions**: Cite REQUIREMENTS.md/AGENTS.MD • Link official docs • Show concrete examples • Explain why (FP/ROP/type safety) • Reference agent capabilities matrix

**Debugging**: Check catalog versions → `pnpm typecheck` + `pnpm check` → `nx reset` if stale → Verify file org → Ensure Effect pipelines don't leak → Consider **performance-analyst** for slow builds

## Resources & Conventions

**Available Scripts**: `pnpm build` (all projects) • `pnpm test` (with coverage) • `pnpm typecheck` (strict TSC) • `pnpm check` (Biome lint+format)

**File Naming**: `*.config.ts` (configs) • `*.{test,spec}.{ts,tsx}` (unit tests) • `*.bench.{ts,tsx}` (benchmarks) • `*.{test,spec}-d.{ts,tsx}` (type tests) • `*.e2e.{test,spec}.{ts,tsx}` (E2E)

**Separator Format**: `// --- Section Name -------------------------------------------------------` (77 chars total) • Rationale: Top-down dependency flow (types→schemas→constants→functions→export) • Cognitive load: abstract/small at top, concrete/large at bottom • Scanability: instant reference lookup

**Maintenance**: Weekly version checks • Update catalog in `pnpm-workspace.yaml` • `pnpm update --latest` • Verify with `pnpm typecheck` • Validate with `pnpm check`

---

## Common Pitfalls

Deps directly → catalog • `any` → branded types • Loops → `.map`/Effect • Ignore Option/Effect → wrap nullables/async • Bypass configs → extend • PostCSS → LightningCSS only • Disable compiler → keep enabled • Forget `as const` → literals critical • Mutable → `ReadonlyArray` • Default exports → named only

---

## Tooling Reference

**Advanced Features**: Nx Console (VSCode: `Cmd+Shift+P` → "Nx: Show Project Details", Crystal inference) • Vite 7 Env API (`buildApp` hook, SSR+client parallel) • React 19 Compiler (auto-memo, **never disable**) • LightningCSS (only CSS pipeline, Tailwind v4 via `@tailwindcss/vite`)

**Primary Commands**: `pnpm build` (Nx cached) • `pnpm test` (coverage) • `pnpm typecheck` (TSC) • `pnpm check` (Biome)

**Quick Debug**: Type → `pnpm typecheck` • Lint → `pnpm check` + `biome explain <rule>` • Build → `nx reset` + `nx build <pkg> --verbose` • Test → `vitest run --reporter=verbose` • Cache → `nx reset` + `rm -rf node_modules/.vite` • Deps → check catalog + `pnpm install --force`

**CLI Commands** (use Nx/pnpm wrappers above when possible):

| Tool | Command | Purpose |
|------|---------|----------|
| **Biome** | `biome check --write .` | Check + fix |
| | `biome check --write --unsafe .` | Apply unsafe fixes |
| | `biome explain <rule>` | Explain rule |
| | `biome ci .` | CI mode (no writes) |
| **Nx** | `nx build <pkg>` | Build single project |
| | `nx run-many -t build` | Build all (4 workers) |
| | `nx affected -t test --base=main` | Test affected |
| | `nx show project <pkg>` | Show details |
| | `nx graph` | Visualize graph |
| | `nx reset` | Clear cache |
| **Vite** | `vite` | Dev server (port 3000) |
| | `vite --force` | Force re-bundle |
| | `vite build` | Production build |
| | `vite preview` | Preview build |
| **Vitest** | `vitest` | Watch mode |
| | `vitest run` | Run once |
| | `vitest run --coverage` | With coverage (V8) |
| | `vitest --ui` | UI mode |
| | `vitest bench` | Benchmarks |
| **pnpm** | `pnpm install` | Install (root only, frozen) |
| | `pnpm update --latest` | Update catalog deps |
| | `pnpm --filter <pkg> build` | Run in specific pkg |
| | `pnpm -r <cmd>` | Run in all pkgs |

**Internal Docs**: [REQUIREMENTS.md](../REQUIREMENTS.md) (full specs) • [AGENTS.MD](../AGENTS.MD) (protocols) • [vite.config.ts](../vite.config.ts) (factories) • [vitest.config.ts](../vitest.config.ts) (test config)

**External Docs**: [Nx 22](https://nx.dev/blog/nx-highlights-2024) • [Vite 7](https://vite.dev/blog/announcing-vite7) • [React 19 Compiler](https://react.dev/learn/react-compiler) • [Effect](https://effect.website/docs/introduction) • [Biome Rules](https://biomejs.dev/linter/rules/)

---

**Remember**: Bleeding-edge monorepo with dogmatic standards. Every constraint enforces ultra-modern, type-safe, functional patterns. Study existing code (`packages/theme`, root configs) and research latest docs (≤6mo). Never suppress rules—redesign to comply.
