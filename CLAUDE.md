# Parametric Portal - Code Standards

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
- **@effect/schema**: `3.19.6` (schema validation)
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

### Quality Targets

- **Functionality Density**: 25-30 lines/feature
- **Type Coverage**: 100% (strict TypeScript)
- **Test Coverage**: 80% minimum (V8)
- **Cognitive Complexity**: ≤25 per function
- **Build Performance**: <3s dev server start
- **Bundle Size**: <250KB gzipped (main chunk)

<!-- SYNC_HASH: 06b155c5d7d6e9c7058b56c6a66082f0199e26b5eaa7e3136756c78dc1b12b63 -->
