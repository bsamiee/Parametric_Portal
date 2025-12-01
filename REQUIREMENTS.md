---
description: Technical specification and quality standards for Parametric Portal
alwaysApply: true
---

# Parametric Portal — Technical Specification

## [1][CONSTRAINTS]

[APPROACH]: Surgical, targeted changes. Examine existing patterns before proposing. Minimal modifications. Zero abstractions.

[FORBIDDEN]:

- NEVER create wrappers adding no semantic value beyond delegation
- NEVER create helpers serving fewer than three call-sites
- NEVER create separate single-item and array-item function variants
- NEVER create factory patterns when single implementation exists
- NEVER create barrel index files; import directly from source
- NEVER create documentation files unless explicitly requested
- NEVER write comments describing what; reserve for why

[REQUIRED]:

- Replace `any` with branded types via @effect/schema
- Replace `try/catch` with Effect error channel
- Replace `if/else` chains with dispatch tables
- Replace `for/while` with `.map`, `.filter`, or Effect
- Replace `let`/`var` with `const`
- Replace default exports with named exports (exception: `*.config.ts`)
- Consolidate related logic into single polymorphic constructs
- Accept `T | ReadonlyArray<T>` with `Array.isArray()` normalization
- Verify sources within 6 months of current date
- Confirm APIs via official changelogs, not cached knowledge

---
## [2][CONTEXT]

### [2.1][AGENTIC_AUTOMATION_INFRASTRUCTURE]

[AUTONOMY]: L4 Supervised — Agents execute within policy-as-code guardrails with human override gates.
[MIDDLEWARE]: Issue templates function as prompt-to-automation bridges, translating user intent into agent-executable workflows with structured context, intelligent routing, and validation gates.
[FEEDBACK]: Sub-3-minute builds via Nx caching. Auto-merge on CI green + policy validation. Instant rollback on SLO degradation.
[ORCHESTRATION]: 10 specialist agents with explicit delegation rules. Label routing dispatches work to domain experts. Commands serve as agent invocation points.

### [2.2][TOOLING_CONFIGURATIONS]

[STACK]: TypeScript 6.0-dev, React 19 canary, Vite 7, Tailwind v4, LightningCSS, Nx 22 Crystal.
[BUILD]: Nx distributed caching + affected commands. Single `vite.config.ts` extended per package. LightningCSS (Rust) replaces PostCSS.
[QUALITY]: Biome for lint + format. Vitest for tests. SonarCloud for static analysis. 80% V8 coverage minimum.
[CONFIG]: Single frozen B constant per file. Catalog-managed dependencies via pnpm-workspace.yaml. Target inference via Nx plugins.

---
## [3][CODE_STANDARDS]

**[CORE]**: Algorithmic → Parametric → Polymorphic pipeline. DERIVE values from base B, SUPPLY tuning at call-sites, SELECT implementation via dispatch tables. Every factory unifies multiple modes into single minimal-surface API.

**[COMPOSITION]**: Functional-Monadic CHAINS core outputs through Effect pipelines. Expression-Centric EXPRESSES all logic as value-producing constructs. Bleeding-Edge LEVERAGES newest APIs across all pillars.

**[INHERENT]**: DRY and strong typing apply universally. Examples demonstrate both. FORBIDDEN: Redundant definitions. REQUIRED: Branded types on domain primitives.

---
### [3.1][ALGORITHMIC]

[IMPORTANT]: DERIVE values from base constant via formula

The derivation formula IS the code. MUST compute ALL values from immutable base B—never hardcode.
- **Zero Literals**: FORBIDDEN: Numeric literals in logic. Exception: base constant `B`. MUST trace every value to `B` through visible arithmetic.
- **Explicit Arithmetic**: MUST express derivations as inline calculations. The formula appears in code structure—not pre-computed values.
- **Immutable Base**: MUST define ONE constant object `B` using `Object.freeze()`. ALWAYS derive ALL values from its properties.

```typescript
import { Schema } from 'effect';

// Immutable base: single source of all derived values
const B = Object.freeze({
  fontSize: 16,
  ratio: 1.333,   // Perfect Fourth interval (industry standard)
} as const);

// Branded type via Effect Schema
const Pixels = Schema.Number.pipe(Schema.positive(), Schema.brand('Pixels'));
type Pixels = typeof Pixels.Type;

// Algorithmic derivation: base × ratio^n (formula IS the code)
const derive = (step: number): Pixels =>
  Schema.decodeSync(Pixels)(B.fontSize * B.ratio ** step);

// Scale derived from formula, never hardcoded
const scale = Object.freeze({
  xs: derive(-2),  // 9px    = 16 × 1.333^-2
  sm: derive(-1),  // 12px   = 16 × 1.333^-1
  md: derive(0),   // 16px   = 16 × 1.333^0
  lg: derive(1),   // 21.3px = 16 × 1.333^1
  xl: derive(2),   // 28.4px = 16 × 1.333^2
} as const);
```

---
### [3.2][PARAMETRIC]

[IMPORTANT]: SUPPLY values at call-site via factory parameters

Configuration at call-site. MUST expose tuning parameters through factory functions—never bury controls.
- **Zero Scatter**: FORBIDDEN: Config access outside B constant. MUST centralize all tunable defaults in ONE object.
- **Factory Exposure**: MUST expose behavior controls through factory parameters. NEVER hardcode tunable values in implementation.
- **Call-Site Override**: MUST define defaults in B. ALWAYS allow call-site overrides without code changes.

```typescript
import { Schema } from 'effect';

// Default tuning parameters (call-site can override)
const B = Object.freeze({
  timeoutMs: 5000,
  maxAttempts: 3,
  backoffMs: 1000,
} as const);

// Schema validates config at boundary
const RetryConfig = Schema.Struct({
  timeoutMs: Schema.Number.pipe(Schema.positive()),
  maxAttempts: Schema.Number.pipe(Schema.between(1, 10)),
  backoffMs: Schema.Number.pipe(Schema.positive()),
});
type RetryConfig = typeof RetryConfig.Type;

// Factory exposes tuning at call-site
const createRetry = (overrides: Partial<RetryConfig> = {}) =>
  Object.freeze({
    config: Schema.decodeSync(RetryConfig)({ ...B, ...overrides }),
    execute: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  });

// Call-site tuning: same factory, different behavior
const fast = createRetry({ timeoutMs: 1000, maxAttempts: 1 });
const resilient = createRetry({ timeoutMs: 30000, maxAttempts: 5 });
```

---
### [3.3][POLYMORPHIC]

[IMPORTANT]: SELECT implementation via keyed dispatch table

Select implementation via dispatch. MUST route ALL behavior through keyed handler tables—never branch with conditionals.
- **Zero Branching**: FORBIDDEN: `if/else` or `switch` for type-based dispatch. MUST use handler tables: `handlers[discriminant](data)`.
- **Single Entry**: MUST route ALL variants through ONE dispatcher function. NEVER scatter selection logic across multiple sites.
- **Complete Coverage**: MUST type handlers via discriminated unions. ALWAYS enforce exhaustiveness with `satisfies Record<Discriminant, Handler>`.

```typescript
import { Schema } from 'effect';

// Discriminated union: shapes with positive dimensions
const Shape = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('circle'), radius: Schema.Number.pipe(Schema.positive()) }),
  Schema.Struct({ kind: Schema.Literal('rect'), width: Schema.Number.pipe(Schema.positive()), height: Schema.Number.pipe(Schema.positive()) }),
  Schema.Struct({ kind: Schema.Literal('tri'), base: Schema.Number.pipe(Schema.positive()), height: Schema.Number.pipe(Schema.positive()) }),
);
type Shape = typeof Shape.Type;

// Dispatch table: keyed handlers with exhaustiveness
const handlers = {
  circle: (s: Extract<Shape, { kind: 'circle' }>) => Math.PI * s.radius ** 2,
  rect: (s: Extract<Shape, { kind: 'rect' }>) => s.width * s.height,
  tri: (s: Extract<Shape, { kind: 'tri' }>) => (s.base * s.height) / 2,
} as const satisfies Record<Shape['kind'], (s: never) => number>;

// Single entry: dispatch by discriminant
const area = (shape: Shape): number => handlers[shape.kind](shape as never);

// Usage: one interface, three implementations
const circle = Schema.decodeSync(Shape)({ kind: 'circle', radius: 5 });
const rect = Schema.decodeSync(Shape)({ kind: 'rect', width: 4, height: 3 });
console.log(area(circle), area(rect)); // 78.54, 12
```

---
### [3.4][FUNCTIONAL-MONADIC]

[IMPORTANT]: CHAIN operations via monadic bind (`pipe`, `flatMap`)

Compose computations through typed channels. MUST route async/failable operations through Effect pipelines—never use try/catch.
- **Zero Exceptions**: FORBIDDEN: `try/catch` or `throw` in Effect code. MUST handle errors via Effect error channel (E parameter).
- **Pipe Composition**: MUST sequence operations via `pipe()` and `Effect.flatMap()`. NEVER nest Effect calls or manually unwrap.
- **Option Wrapping**: MUST wrap nullable values with `Option.fromNullable()`. NEVER use `null` checks or optional chaining in logic.
- **Typed Channels**: MUST track outcomes in type parameters: `Effect<A, E, R>`, `Option<A>`. ALWAYS let types document the computation.

```typescript
import { Effect, Option, pipe } from 'effect';

// Typed error for transform failures
class TransformError {
  readonly _tag = 'TransformError';
  constructor(readonly reason: string) {}
}

// Input: nullable user from external API
type RawUser = { name?: string; age?: number };

// CHAIN: Option for nullable, Effect for failable
const processUser = (raw: RawUser) =>
  pipe(
    Option.fromNullable(raw.name),
    Option.map((name) => name.trim().toUpperCase()),
    Option.match({
      onNone: () => Effect.fail(new TransformError('Missing name')),
      onSome: (name) =>
        pipe(
          Option.fromNullable(raw.age),
          Option.filter((age) => age >= 0),
          Option.match({
            onNone: () => Effect.succeed({ name, age: 'unknown' }),
            onSome: (age) => Effect.succeed({ name, age: String(age) }),
          }),
        ),
    }),
  );

// Effect<{ name: string; age: string }, TransformError, never>
```

---
### [3.5][EXPRESSION-CENTRIC]

[ESSENCE]: EXPRESS logic via value-producing constructs (ternary, implicit return, `pipe`)

Code as expressions, not statements. MUST write every construct to produce a value—never execute without returning.
- **Zero Blocks**: FORBIDDEN: curly braces `{}` in single-expression contexts. MUST use implicit returns: `x => x * 2`.
- **Ternary Branching**: FORBIDDEN: `if/else` for value selection. MUST use `condition ? valueA : valueB` for all conditionals.
- **Expression Composition**: MUST compose via chained expressions (`.map()`, `.filter()`, `pipe()`). NEVER use intermediate `let` bindings.

```typescript
// Input: array of raw user records
type RawUser = { readonly name: string; readonly age: number; readonly active?: boolean };

// EXPRESS: every construct produces a value
const processUsers = (users: ReadonlyArray<RawUser>) =>
  users
    .filter((u) => u.age >= 18)
    .map((u) => ({
      displayName: u.name.trim().toUpperCase(),
      ageGroup: u.age < 30 ? 'young' : u.age < 50 ? 'middle' : 'senior',
      status: u.active ?? true ? 'active' : 'inactive',
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

// EXPRESS: ternary for conditional, implicit return for arrow
const summarize = (users: ReadonlyArray<RawUser>) =>
  users.length === 0
    ? { total: 0, avgAge: 0, activeRate: 0 }
    : {
        total: users.length,
        avgAge: users.reduce((sum, u) => sum + u.age, 0) / users.length,
        activeRate: users.filter((u) => u.active ?? true).length / users.length,
      };

// Type: ReadonlyArray<{ displayName: string; ageGroup: string; status: string }>
```

---
### [3.6][BLEEDING-EDGE]

[ESSENCE]: LEVERAGE newest stable APIs via centralized base configurations

Platform-first tooling selection. MUST adopt cutting-edge stable or canary APIs—never rely on deprecated patterns.

- **Zero Legacy**: FORBIDDEN: Deprecated APIs, legacy transformers (PostCSS, Babel). MUST use newest stable or canary releases.
- **Native Transforms**: FORBIDDEN: Node.js-based transpilers for production. MUST use Rust/Go: LightningCSS, esbuild, SWC.
- **Centralized Config**: FORBIDDEN: Per-project config duplication. MUST extend from base via `extends`, factory functions, or catalog.
- **Inference First**: FORBIDDEN: Manual target definitions per project. MUST leverage Nx plugin inference + `targetDefaults`.
- **Algorithmic Tokens**: FORBIDDEN: Hardcoded design values. MUST compute via `@theme` directive with OKLCH color space.

```css
/* theme.css — Native CSS, NO PostCSS */
@import "tailwindcss";

@theme {
  --color-primary: oklch(0.55 0.22 260);
  --color-surface: oklch(0.98 0.01 260);
  --spacing-base: 0.25rem;
  --spacing-lg: calc(var(--spacing-base) * 6);
}
```

```typescript
// vite.config.ts — LightningCSS (Rust), not PostCSS
import { browserslistToTargets } from 'lightningcss';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss({ optimize: { minify: true } })],
  css: {
    transformer: 'lightningcss',
    lightningcss: {
      targets: browserslistToTargets(browserslist('>= 0.25%')),
    },
  },
  build: { cssMinify: 'lightningcss' },
});
```

```jsonc
// nx.json — Workspace brain (14:1 centralization ratio)
{
  "targetDefaults": {
    "build": {
      "cache": true,
      "dependsOn": ["^build"],
      "inputs": ["production", "^production"],
      "outputs": ["{projectRoot}/dist"]
    }
  },
  "namedInputs": {
    "production": ["default", "!{projectRoot}/**/*.spec.ts"]
  },
  "plugins": [{ "plugin": "@nx/vite/plugin" }]
}
```

```jsonc
// tsconfig.base.json (64 LOC — workspace root)
{ "compilerOptions": { "strict": true, "target": "esnext", "module": "preserve" } }

// packages/*/tsconfig.json (11 LOC — extends base)
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist" } }
```

---
## [4][FILE_ARCHITECTURE]

### [4.1][LAYER_STRUCTURE]

[LAYER]: Source

[LAYER]: Engine

[LAYER]: Consumer

[LAYER]: Action (when applicable)

### [4.2][CHAIN_PATTERNS]

<!-- Skeleton: 3-step and 4-step process documentation -->
