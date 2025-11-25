# Parametric Portal — Copilot Instructions

Bleeding-edge Nx/Vite/Effect monorepo: TypeScript 6.0-dev, React 19 canary, dogmatic FP, zero-compromise type safety.

**Context**: [REQUIREMENTS.md](../REQUIREMENTS.md) • [AGENTS.MD](../AGENTS.MD) • Catalog: `pnpm-workspace.yaml`

## Stack (Catalog-Driven, Exact Versions)

TS `6.0.0-dev.20251121` • React `19.3.0-canary` • Compiler `19.0.0-beta` • Vite `7.2.4` • Vitest `4.0.13` • Effect `3.19.6` • @effect/schema • Nx `22.2.0-canary` • Tailwind `4.1.17` • LightningCSS `1.30.2` • Biome `2.3.7` • Node `25.2.1` • pnpm `10.23.0`

Versions in `pnpm-workspace.yaml` catalog only—reference via `catalog:` in `package.json`. Never hardcode.

## Dogmatic Rules (Build-Failing)

No `any` • No `var`/`let` (`const` only) • No `if/else` (ternaries/`Option.match`/dispatch tables) • No loops (`.map`/`.filter`/Effect) • `ReadonlyArray<T>` • `as const` • Trailing commas • No default exports (except `*.config.ts`) • No `forEach` • No `console` (warn) • `Option.fromNullable` for nullables • No barrel files (`export *`)

## Catalog & Structure

**Catalog** (`pnpm-workspace.yaml`): Single source, exact versions → reference `"dep": "catalog:"` → `pnpm install` (root only)

**Structure**: `apps/*` (mode: 'app') • `packages/*` (mode: 'library') • Imports: `@/* → packages/*` • Extend root `createConfig`

## Code Patterns (5 Pillars)

**1. Single B Constant**: All config in one frozen object `const B = Object.freeze({...}) as const` • Access via `B.prop` • Never scatter multiple frozen constants

**2. Discriminated Union Schema**: `S.Union(S.Struct({ mode: S.Literal('app'), ...}), S.Struct({ mode: S.Literal('library'), ...}))` • One schema, polymorphic validation

**3. Dispatch Tables**: `const handlers = { app: (c) => ..., library: (c) => ... } as const` • Replace if/else with `handlers[mode]()` • Type-safe lookup

**4. Pure Utility Functions**: Single-expression arrows • Parameterized • Composable • No side effects

**5. Single Polymorphic Entry Point**: `createConfig(input)` → decode → dispatch → typed output • One function handles all modes

**File Org** (90+ LOC): Imports → Type Defs → Schema Defs → Constants (`B`) → Pure Utils → Dispatch Tables → Effect Pipeline → Export • Separators: `// --- Section Name ---` (77 chars)

## Root Configs (Extend Only)

**vite.config.ts** (392 lines): Single `B` constant (18 props) • `CfgSchema` discriminated union • `plugins` dispatch table • `config` dispatch table • `createConfig()` polymorphic entry • Usage: `defineConfig(Effect.runSync(createConfig({ mode: 'library', entry, name })))`

**vitest.config.ts**: Merges vite config • 80% coverage (V8) • Happy-DOM • UI on • `{projectRoot}/coverage`

**tsconfig.base.json**: Strictest (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess, verbatimModuleSyntax) • ESNext • Bundler • `@/* → packages/*`

**biome.json**: No default exports (except configs) • No any/forEach • Complexity ≤25 • Exhaustive deps/switch • Auto-organize • 120w/4sp/single quotes

**nx.json**: Targets: build/test/typecheck/check • Crystal: auto-infers from vite.config • 4 workers

**.npmrc**: engine-strict • Node 25.2.1 • save-exact • frozen-lockfile • isolated linker • zero hoist

## Creating Packages

**Research**: Latest docs (≤6mo) • Check Nx plugins (prefer `@nx/*`) • Official APIs only

**Setup**: `mkdir packages/X/src` • `package.json` (type:module, exports, deps:catalog) • `tsconfig.json` (extends base) • `vite.config.ts` (createConfig with mode: 'library')

**Code**: Single `B` constant → Pure Utils → Dispatch Tables (if polymorphic) → Effect Pipeline → Factory Function → Export (`*_TUNING`, `create*`)

**Validate**: `pnpm typecheck` • `pnpm check` • `nx build my-package` • `nx test my-package`

## Project Structure

**Monorepo Layout**: `apps/*` (deployable applications) • `packages/*` (reusable libraries) • `plugins/*` (GritQL linting patterns)

**Key Files**: `vite.config.ts` (392 lines, single B constant, dispatch tables, polymorphic createConfig) • `vitest.config.ts` (103 lines) • `biome.json` (133 lines, 70+ rules) • `nx.json` (Crystal inference) • `pnpm-workspace.yaml` (catalog)

**Exemplars**: Study `vite.config.ts` (master pattern) • `packages/components` (B constant + factory API) • `packages/theme` (frozen configs)

## Integration Requirements

**MUST**: Single `B` constant per file • Dispatch tables (no if/else) • Discriminated union schemas • Effect pipelines (async) • Option monads (nullable) • `Object.freeze` once for B • `as const` all literals • Type Effect/Option returns • Expression-only style • Schema validation (all IO)

**MUST NOT**: Scatter multiple frozen constants • Use if/else (use dispatch tables) • Use `any` • Use `let`/mutations • Imperative loops • try/catch (use Effect) • Default exports (except configs) • Skip schema validation

**Quality Targets**: 25-30 lines/feature • 100% type coverage • 80% test coverage (V8) • ≤25 complexity • <3s dev start • <250KB main chunk

## Custom Agents (Delegate First)

**10 Specialized Agents** (`.github/agents/*.agent.md`):

1. **typescript-advanced** - TS 6.0-dev, branded types, Effect/Option pipelines
2. **react-specialist** - React 19 canary, Compiler, Server Components
3. **vite-nx-specialist** - Vite 7 env API, Nx 22 Crystal inference, dispatch tables
4. **testing-specialist** - Vitest, property-based tests, Effect/Option testing
5. **performance-analyst** - Bundle size, tree-shaking, code splitting
6. **refactoring-architect** - Pipeline migration, dispatch tables, B constant consolidation
7. **library-planner** - Research, create Nx packages with proper structure
8. **integration-specialist** - Unified B constants, catalog versions, workspace consistency
9. **documentation-specialist** - Update docs, code comments, cross-references
10. **cleanup-specialist** - Algorithmic density, pattern consolidation

## Canonical Patterns

**Single B Constant** (replace scattered constants):
```typescript
const B = Object.freeze({
    defaults: { size: 'md', variant: 'primary' },
    sizes: { sm: 8, md: 12, lg: 16 },
    variants: { primary: 'bg-blue', secondary: 'bg-gray' },
} as const);
// Access: B.defaults.size, B.sizes.md, B.variants.primary
```

**Dispatch Tables** (replace if/else):
```typescript
const handlers = {
    button: (props) => <Button {...props} />,
    input: (props) => <Input {...props} />,
    icon: (props) => <Icon {...props} />,
} as const;
// Usage: handlers[type](props) — type-safe, extensible
```

**Discriminated Union Schema** (polymorphic validation):
```typescript
const ConfigSchema = S.Union(
    S.Struct({ mode: S.Literal('app'), port: S.Number }),
    S.Struct({ mode: S.Literal('library'), entry: S.String }),
);
// One schema validates all modes, TypeScript narrows automatically
```

**Factory Export Pattern** (packages/components style):
```typescript
export { B as COMPONENT_TUNING, createComponents };
// Consumers: import { COMPONENT_TUNING, createComponents } from '@/components';
```

## Anti-Patterns to Avoid

❌ **Scattered Constants**:
```typescript
const SIZES = Object.freeze({...});
const VARIANTS = Object.freeze({...});
const DEFAULTS = Object.freeze({...});
```
✅ **Single B Constant**:
```typescript
const B = Object.freeze({ sizes, variants, defaults } as const);
```

❌ **If/Else Chains**:
```typescript
if (mode === 'app') return appConfig();
else if (mode === 'library') return libConfig();
```
✅ **Dispatch Table**:
```typescript
const config = { app: appConfig, library: libConfig } as const;
return config[mode]();
```

❌ **Separate Builder Functions**:
```typescript
export const createAppConfig = () => {...};
export const createLibraryConfig = () => {...};
```
✅ **Polymorphic Entry Point**:
```typescript
export const createConfig = (input) => pipe(decode, dispatch);
```

## Interaction Guidelines

**Code Generation**: Read `vite.config.ts` first (master pattern) • Match `packages/components` style • Single B constant • Dispatch tables • Schema validation • No mutations • Expression-only • Research first (≤6mo docs) • **Delegate to custom agents** when domain matches • Never relax rules

**Questions**: Cite REQUIREMENTS.md/AGENTS.MD • Link official docs • Show concrete examples • Explain why (density, type safety) • Reference vite.config.ts patterns

**Debugging**: Check catalog versions → `pnpm typecheck` + `pnpm check` → `nx reset` if stale → Verify B constant structure → Ensure dispatch tables type-check

## Resources & Conventions

**Available Scripts**: `pnpm build` • `pnpm test` • `pnpm typecheck` • `pnpm check`

**File Naming**: `*.config.ts` • `*.{test,spec}.{ts,tsx}` • `*.bench.{ts,tsx}`

**Separator Format**: `// --- Section Name -------------------------------------------------------` (77 chars)

**Internal Docs**: [REQUIREMENTS.md](../REQUIREMENTS.md) • [AGENTS.MD](../AGENTS.MD) • [vite.config.ts](../vite.config.ts) • [packages/components](../packages/components)

**External Docs**: [Nx 22](https://nx.dev) • [Vite 7](https://vite.dev) • [Effect](https://effect.website) • [Biome](https://biomejs.dev)

---

**Remember**: Study `vite.config.ts` (single B constant, dispatch tables, polymorphic createConfig). Apply same patterns to all code. Never scatter constants. Never use if/else. Never suppress rules—redesign to comply.
