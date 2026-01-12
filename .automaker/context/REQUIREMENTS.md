---
description: Technical specification and quality standards for Parametric Portal
alwaysApply: true
---

# Parametric Portal — Technical Specification

## [1][CONSTRAINTS]

[APPROACH] Surgical, targeted changes. Examine existing patterns before proposing. Minimal modifications. Zero abstractions.

[FORBIDDEN]:
- NEVER create wrappers adding no semantic value beyond delegation
- NEVER create scattered helpers—consolidate into namespace objects
- NEVER create separate single-item and array-item function variants
- NEVER create factory patterns when single implementation exists
- NEVER create barrel files (`index.ts`); consumers import directly from source
- NEVER re-export external lib types; import directly from ts-toolbelt, ts-essentials, type-fest
- NEVER use inline exports; declare first, export at file end
- NEVER create documentation files unless explicitly requested
- NEVER write comments describing what; reserve for why
- NEVER hand-roll utilities that exist in external libs
- NEVER duplicate type definitions; derive from schema/tables

[REQUIRED]:
- Replace `any` with branded types via @effect/schema
- Replace `try/catch` with Effect error channel
- Replace `for/while` with `.map`, `.filter`, or Effect
- Replace `let`/`var` with `const`
- Replace default exports with named exports (exception: `*.config.ts`)
- Use explicit exports at file end; never inline `export const`/`export function`
- Consolidate related logic into single polymorphic constructs
- Accept `T | ReadonlyArray<T>` with `Array.isArray()` normalization
- Verify sources within 6 months of current date
- Confirm APIs via official changelogs, not cached knowledge
- Derive types from schemas: `type X = S.Schema.Type<typeof XSchema>`
- Import external lib types directly from source

[CONDITIONAL]:
- PREFER dispatch tables for variant-based branching
- ALLOW ternary for binary conditions
- ALLOW guard expressions (`condition && fn()`) for early returns
- ALLOW `if` statements within Effect.gen for complex control flow

---
## [2][CONTEXT]

### [2.1][AGENTIC_AUTOMATION_INFRASTRUCTURE]

[AUTONOMY]: L4 Supervised — Agents execute within policy-as-code guardrails with human override gates.
[MIDDLEWARE]: Issue templates function as prompt-to-automation bridges, translating user intent into agent-executable workflows with structured context, intelligent routing, and validation gates.
[FEEDBACK]: Sub-3-minute builds via Nx caching. Auto-merge on CI green + policy validation. Instant rollback on SLO degradation.
[ORCHESTRATION]: 10 specialist agents with explicit delegation rules. Label routing dispatches work to domain experts. Commands serve as agent invocation points.

### [2.2][TOOLING_CONFIGURATIONS]

[STACK]: TypeScript 6.0-dev, React 19 canary, Vite 7, Tailwind v4, LightningCSS, Nx 22 Crystal.
[BUILD]: Nx distributed caching + affected commands. Single `vite.factory.ts` extended per package. LightningCSS (Rust) replaces PostCSS.
[CLI]: Always run Nx via `pnpm exec nx <command>`. Never use bare `nx` (binary not in PATH).
[QUALITY]: Biome for lint + format. Vitest for tests. SonarCloud for static analysis. 80% V8 coverage minimum.
[CONFIG]: Single frozen B constant per file. Catalog-managed dependencies via pnpm-workspace.yaml. Target inference via Nx plugins.

---
## [3][CODE_STANDARDS]

**[CORE]**: Algorithmic → Parametric → Polymorphic pipeline. DERIVE values from base B, SUPPLY tuning at call-sites, SELECT implementation via dispatch tables. Every factory unifies multiple modes into single minimal-surface API.

**[COMPOSITION]**: Functional-Monadic CHAINS core outputs through Effect pipelines. Expression-Centric EXPRESSES all logic as value-producing constructs. Bleeding-Edge LEVERAGES newest APIs across all pillars.

**[INHERENT]**: DRY and strong typing apply universally. Examples demonstrate both. FORBIDDEN: Redundant definitions. REQUIRED: Branded types on domain primitives.

---
### [3.1][ALGORITHMIC]

[IMPORTANT] DERIVE values from base constant via formula

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

[IMPORTANT] SUPPLY values at call-site via factory parameters

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

[IMPORTANT] SELECT implementation via keyed dispatch table

Select implementation via dispatch. MUST route variant-based behavior through keyed handler tables.
- **Dispatch for Variants**: PREFER handler tables for type-based dispatch: `handlers[discriminant](data)`. ALLOW ternary/guards for simple conditions.
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

[IMPORTANT] CHAIN operations via monadic bind (`pipe`, `flatMap`)

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

[ESSENCE] EXPRESS logic via value-producing constructs (ternary, implicit return, `pipe`)

Code as expressions, not statements. MUST write every construct to produce a value—never execute without returning.
- **Implicit Returns**: PREFER implicit returns where possible: `x => x * 2`. ALLOW blocks in Effect.gen and complex logic.
- **Ternary Branching**: PREFER `condition ? valueA : valueB` for binary conditionals. ALLOW `if` within Effect.gen.
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

[ESSENCE] LEVERAGE newest stable APIs via centralized base configurations

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
### [3.7][EFFECT_PIPELINES]

[IMPORTANT] COMPOSE via Effect pipeline functions with appropriate patterns

Effect composition follows consistent patterns for readability and tracing.

**[EFFECT.FN_PATTERN]** — Named function with automatic span for tracing:

```typescript
const findUser = Effect.fn('db.users.find')(
  (id: UserId) => Effect.gen(function* () {
    const db = yield* DatabaseService
    return yield* db.users.findById(id)
  })
)
```

**[EFFECT.GEN_PATTERN]** — Sequential composition with control flow:

```typescript
const processOrder = Effect.gen(function* () {
  const user = yield* UserService
  const order = yield* OrderService
  yield* Effect.log('Processing', { orderId: order.id })
  return yield* submitOrder(order)
})
```

**[LAYER_PATTERN]** — Dynamic layer selection via Config:

```typescript
const storeLayer = Layer.unwrapEffect(
  Config.string('STORE_TYPE').pipe(
    Config.withDefault('memory'),
    Effect.map((t) => t === 'redis' ? redisLayer : memoryLayer),
  ),
)
```

**[PIPELINE_FUNCTION_SELECTION]**:

| [INDEX] | [FUNCTION]       | [WHEN_TO_USE]                                              |
| :-----: | ---------------- | ---------------------------------------------------------- |
|   [1]   | `Effect.map`     | Sync transform of success value                            |
|   [2]   | `Effect.flatMap` | Chain Effect-returning functions                           |
|   [3]   | `Effect.andThen` | Mixed input types (value, Promise, Effect, Option, Either) |
|   [4]   | `Effect.tap`     | Side effects without changing value (logging, metrics)     |
|   [5]   | `Effect.all`     | Combine multiple effects into structured result            |
|   [6]   | `Effect.gen`     | Complex sequential logic with control flow                 |
|   [7]   | `Effect.fn`      | Named function with automatic span                         |

---
### [3.8][NAMESPACE_OBJECTS]

[IMPORTANT] BUNDLE schema, constructors, predicates, and methods into frozen namespace objects

Namespace objects provide unified API surface for domain primitives.

```typescript
// Schema defines structure
const TimestampSchema = pipe(S.Number, S.positive(), S.brand('Timestamp'))

// Type derived from schema
type Timestamp = S.Schema.Type<typeof TimestampSchema>

// Namespace bundles everything
const Timestamp = Object.freeze({
  // Schema utilities
  schema: TimestampSchema,
  decode: S.decodeUnknown(TimestampSchema),
  is: S.is(TimestampSchema),

  // Constructors
  now: Effect.sync(() => Date.now() as Timestamp),
  nowSync: (): Timestamp => Date.now() as Timestamp,
  fromDate: (d: Date): Timestamp => d.getTime() as Timestamp,

  // Operations
  diff: (a: Timestamp, b: Timestamp): DurationMs => (a - b) as DurationMs,
  addDuration: (ts: Timestamp, d: DurationMs): Timestamp => (ts + d) as Timestamp,
})
```

**[PATTERN_SELECTION]**:

| [INDEX] | [USE_NAMESPACE_OBJECT]                    | [USE_S_CLASS]                         |
| :-----: | ----------------------------------------- | ------------------------------------- |
|   [1]   | Primitives (Timestamp, DurationMs, Hex64) | Domain entities with instance methods |
|   [2]   | Utility collections (V2, CSS, Slot)       | Classes needing `this` context        |
|   [3]   | ADT wrappers (AsyncState, GestureEvent)   | Schemas with complex derivation logic |

---
### [3.9][EXTERNAL_LIBS]

[IMPORTANT] LEVERAGE external libraries; do not hand-roll utilities that exist

**[TS-TOOLBELT]** — Type-level operations:

```typescript
import type { O, L, N } from 'ts-toolbelt'

// Prefer O.Merge over intersection for cleaner hover types
type Combined = O.Merge<BaseProps, ExtendedProps>

// Type-level arithmetic
type MulDim<A extends Dim, B extends Dim> = { L: N.Add<A['L'], B['L']> }
```

**[TS-ESSENTIALS]** — Exclusive unions and immutability:

```typescript
import type { XOR, DeepReadonly } from 'ts-essentials'

type ControlledMode<T> = XOR<ControlledProps<T>, UncontrolledProps<T>>
type FrozenConfig = DeepReadonly<typeof B>
```

**[TYPE-FEST]** — Type manipulation:

```typescript
import type { Simplify, LiteralUnion, Paths } from 'type-fest'

type Flattened = Simplify<A & B>  // Clean hover types
type Status = LiteralUnion<'active' | 'inactive', string>  // Autocomplete + extensibility
```

**[@EFFECT/EXPERIMENTAL]** — Server-side patterns:

```typescript
import { RateLimiter } from '@effect/experimental/RateLimiter'
import { Machine } from '@effect/experimental/Machine'
import { VariantSchema } from '@effect/experimental/VariantSchema'
```

| [INDEX] | [LIBRARY]              | [KEY_UTILITIES]                           | [USE_WHEN]                     |
| :-----: | ---------------------- | ----------------------------------------- | ------------------------------ |
|   [1]   | `ts-toolbelt`          | `O.Merge`, `L.Concat`, `N.Add`            | Type-level operations          |
|   [2]   | `ts-essentials`        | `XOR`, `DeepReadonly`                     | Exclusive unions, immutability |
|   [3]   | `type-fest`            | `Simplify`, `LiteralUnion`, `Paths`       | Type manipulation              |
|   [4]   | `@effect/experimental` | `RateLimiter`, `Machine`, `VariantSchema` | Server-side patterns           |

---
## [4][FILE_ARCHITECTURE]

### [4.1][SECTION_ORGANIZATION]

[IMPORTANT] Canonical section order and naming. MUST use exact labels, exact order, maximum 2 words per label.

**Separator Format**: `// --- [LABEL] ` + dashes to column 80 (total 80 chars)

```typescript
// --- [TYPES] -----------------------------------------------------------------
// --- [SCHEMA] ----------------------------------------------------------------
// --- [CONSTANTS] -------------------------------------------------------------
// --- [CLASSES] ---------------------------------------------------------------
// --- [SERVICES] --------------------------------------------------------------
// --- [PURE_FUNCTIONS] --------------------------------------------------------
// --- [DISPATCH_TABLES] -------------------------------------------------------
// --- [EFFECT_PIPELINE] -------------------------------------------------------
// --- [LAYERS] ----------------------------------------------------------------
// --- [ENTRY_POINT] -----------------------------------------------------------
// --- [EXPORT] ----------------------------------------------------------------
```

**Character Breakdown**:
- `// --- ` = 7 chars (comment prefix + opening dashes + space)
- `[LABEL]` = variable (max 2 words, UPPERCASE, underscores for spaces)
- ` ` = 1 char (space before closing dashes)
- `---...---` = padding dashes to reach 80 chars total

**Canonical Sections** (order is mandatory, omit unused):

| [INDEX] | [SECTION]           | [PURPOSE]             | [CONTAINS]                                       |
| :-----: | ------------------- | --------------------- | ------------------------------------------------ |
|   [1]   | `[TYPES]`           | Shape definitions     | Type aliases, interfaces, unions, inferred types |
|   [2]   | `[SCHEMA]`          | Validation rules      | @effect/schema, branded types, enums             |
|   [3]   | `[CONSTANTS]`       | Immutable values      | B constant, frozen config, derived values        |
|   [4]   | `[CLASSES]`         | Typed structures      | S.Class, Data.TaggedError, Context.Tag           |
|   [5]   | `[SERVICES]`        | Dependency injection  | Effect services with Layer definitions           |
|   [6]   | `[PURE_FUNCTIONS]`  | Stateless logic       | Helpers, transformers, validators                |
|   [7]   | `[DISPATCH_TABLES]` | Polymorphic handlers  | Keyed dispatch objects                           |
|   [8]   | `[EFFECT_PIPELINE]` | Effect composition    | Effect.gen, pipe chains                          |
|   [9]   | `[LAYERS]`          | Infrastructure wiring | Layer.effect, Layer.mergeAll                     |
|  [10]   | `[ENTRY_POINT]`     | Execution start       | run(), main(), createX(), API definition         |
|  [11]   | `[EXPORT]`          | Public interface      | Named exports                                    |

**Domain Extensions** (insert after corresponding core section):

| [INDEX] | [DOMAIN] | [EXTENSION]      | [INSERT_AFTER] | [PURPOSE]                 |
| :-----: | -------- | ---------------- | -------------- | ------------------------- |
|   [1]   | Database | `[TABLES]`       | SCHEMA         | Drizzle table definitions |
|   [2]   | Database | `[RELATIONS]`    | TABLES         | Drizzle relations         |
|   [3]   | Database | `[REPOSITORIES]` | SERVICES       | Data access patterns      |
|   [4]   | API      | `[GROUPS]`       | SCHEMA         | HttpApiGroup definitions  |
|   [5]   | API      | `[MIDDLEWARE]`   | SERVICES       | Request middleware        |

**Consolidation Rules** (absorb into core sections):

| [INDEX] | [FOUND]            | [ABSORB_INTO]      | [RATIONALE]                      |
| :-----: | ------------------ | ------------------ | -------------------------------- |
|   [1]   | `[CONFIG]`         | `[CONSTANTS]`      | Config is runtime constants      |
|   [2]   | `[CONTEXT]`        | `[CLASSES]`        | Context.Tag is class pattern     |
|   [3]   | `[DOMAIN_ERRORS]`  | `[CLASSES]`        | Errors are TaggedError classes   |
|   [4]   | `[ERROR_MAPPERS]`  | `[PURE_FUNCTIONS]` | Mappers are pure functions       |
|   [5]   | `[SCHEMA_UTILS]`   | `[PURE_FUNCTIONS]` | Utils are pure functions         |
|   [6]   | `[INFERRED_TYPES]` | `[TYPES]`          | Inferred types are still types   |
|   [7]   | `[DERIVED]`        | `[CONSTANTS]`      | Derived values are constants     |
|   [8]   | `[FACTORIES]`      | `[ENTRY_POINT]`    | Factories create entry instances |

**FORBIDDEN**:
- Parentheticals in labels: `[CONSTANTS] (B)` → `[CONSTANTS]`
- Labels >2 words: `[PURE_UTILITY_FUNCTIONS]` → `[PURE_FUNCTIONS]`
- Non-canonical labels: `[HELPERS]`, `[HANDLERS]`, `[UTILS]`, `[CONFIG]`
- Descriptive suffixes: `[SCHEMA] (Single Union)` → `[SCHEMA]`
- Missing brackets: `// --- Types ---` → `// --- [TYPES] ---`

### [4.2][DOCUMENTATION_STANDARDS]

[IMPORTANT] JSDoc headers, comments, and naming conventions defined in `docs/standards/AGENTIC-DOCUMENTATION.md`.

### [4.3][LAYER_STRUCTURE]

[LAYER]: Source — Raw data, external inputs, API responses
[LAYER]: Engine — Business logic, transformations, validation
[LAYER]: Consumer — UI components, output formatters, renderers
[LAYER]: Action — Side effects, mutations, external calls (when applicable)

### [4.4][CHAIN_PATTERNS]

[PATTERN]: 3-step pipelines for simple transformations (input → transform → output)
[PATTERN]: 4-step pipelines for failable operations (input → validate → transform → handle)

---
## [5][MONOREPO_TOPOLOGY]

>**Dictum:** *Packages export mechanisms; apps define values.*

| [INDEX] | [LAYER]      | [OWNS]                                                                           | [EXAMPLE]                                                             |
| :-----: | ------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
|   [1]   | `packages/*` | Types, schemas, factories, pure functions, dispatch tables, CSS variable *slots* | `createMenu({ scale })` returns structure referencing `var(--menu-*)` |
|   [2]   | `apps/*`     | CSS variable values, factory invocations, visual overrides                       | `:root { --menu-item-selected-bg: oklch(32% 0.04 275); }`             |

**FORBIDDEN**: Color/font/spacing literals in `packages/*`.<br>
**Dropdown Menu**: Package renders title/label/active/checkmark structure. App provides `--menu-dropdown-bg`, `--menu-item-selected-bg` values.
