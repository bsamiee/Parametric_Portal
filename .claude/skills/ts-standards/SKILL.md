---
name: ts-standards
type: standard
depth: extended
description: >-
  Enforces TypeScript/Effect standards: algebraic data types, exhaustive pattern matching, schema-first types, branded types, tagged errors, Effect composition. Use when writing, refactoring, or reviewing TypeScript code.
---

# [H1][TS-STANDARDS]
>**Dictum:** *Algebraic data types and exhaustive pattern matching produce provably correct, refactor-safe systems.*

<br>

Enforce dense, functional, ADT-first TypeScript. Pure transformations stay pure; Effect orchestrates IO, errors, dependencies, concurrency. Every behavioral branch uses exhaustive pattern matching. Every sum type uses tagged enums. Every error uses tagged errors. Every domain primitive uses branded types.

**Tasks:** Read this file, [patterns.md](./references/patterns.md), and [repo-conventions.md](./references/repo-conventions.md). Apply standards. Validate against [VERIFY] checklist.

**Versions:** TypeScript 6.0-dev, Effect 3.19+, React 19, Vite 7.

---
## [1][CORE_PHILOSOPHY]
>**Dictum:** *ADTs encode domain variants algebraically. Exhaustive matching guarantees completeness.*

<br>

| [PATTERN]                        | [WHEN]                                       | [GUARANTEE]                           |
| -------------------------------- | -------------------------------------------- | ------------------------------------- |
| `Match.type` / `Match.value`     | Behavioral branching on discriminated unions | Exhaustive, composable, type-safe     |
| `Data.TaggedEnum` + `$match`     | Sum types with per-variant data + match      | Structural equality, pattern matching |
| `Option` / `Either`              | Nullable values, fallible computations       | No null, composable chains            |
| Ternary expression               | Binary conditions only                       | Expression, not statement             |
| Pure data lookup (immutable map) | Static key-to-value with no behavior         | No branching, just data               |

[CRITICAL]:
- [NEVER] Dispatch tables (`Record<string, () => void>`) for behavioral branching -- use `Match.type` or `Data.TaggedEnum.$match`.
- [NEVER] `if/else if/else` chains on discriminant fields -- use `Match.type` with `Match.exhaustive`.
- [NEVER] `switch` statements -- use `Match.type` or `Match.value`.
- [NEVER] String literal unions for variants with data -- use `Data.TaggedEnum`.
- [NEVER] Plain `string` for domain identifiers -- use branded types via `Schema.brand`.

[CONDITIONAL]:
- [ALLOW] Pure data lookups (`Record<string, string>`) for static mappings. Ternary for binary conditions with simple expressions.

---
## [2][NON_NEGOTIABLES]
>**Dictum:** *Constraints eliminate entire categories of bugs at compile time.*

<br>

[CRITICAL]:
- [NEVER] `any` -- use branded types via `Schema.brand()`.
- [NEVER] `let`/`var` -- use `const` exclusively.
- [NEVER] `for`/`while` -- use `.map`, `.filter`, `Effect.forEach`, `Effect.iterate`.
- [NEVER] `try/catch` -- use Effect error channel (`Effect.tryPromise`, `Effect.catchTag`).
- [NEVER] Default exports -- named exports only (exception: `*.config.ts`, migrations).
- [NEVER] Barrel files (`index.ts`) -- import directly from source.
- [NEVER] Inline exports -- declare first, export in `[EXPORT]` section.
- [NEVER] Re-export external lib types -- import from source.
- [NEVER] `null` checks (`!== null && !== undefined`) -- use `Option.fromNullable`.
- [NEVER] String errors or generic `Error` -- use `Data.TaggedError` or `Schema.TaggedError`.

[IMPORTANT]:
- [ALWAYS] Prefix private/internal values with `_`.
- [ALWAYS] Derive types from schemas/tables -- never duplicate type alongside schema.
- [ALWAYS] Comments explain "why", never "what".
- [ALWAYS] 4-space indentation (no tabs).

---
## [3][ALGEBRAIC_DATA_TYPES]
>**Dictum:** *Make illegal states unrepresentable through algebraic type encoding.*

<br>

**Sum Types** via `Data.TaggedEnum` -- See [references/examples.md Section 3](./references/examples.md#section_3algebraic_data_types).<br>
**Generic Sum Types** -- Use `Data.TaggedEnum.WithGenerics<N>` for polymorphic variants.<br>
**Product Types** via `Schema.Struct` -- See [references/examples.md Section 3](./references/examples.md#section_3algebraic_data_types).<br>
**Tagged Errors** -- See [references/examples.md Section 3](./references/examples.md#section_3algebraic_data_types) for domain and boundary error examples.

---
## [4][PATTERN_MATCHING]
>**Dictum:** *Exhaustive matching guarantees every variant is handled -- missing a case is a compile error.*

<br>

**Match.type** (reusable matcher) and **Match.value** (inline dispatch) -- See [references/examples.md Section 4](./references/examples.md#section_4pattern_matching).

**Match Finalizers:**

| [FINALIZER]        | [BEHAVIOR]                                  |
| ------------------ | ------------------------------------------- |
| `Match.exhaustive` | Compile error if any variant unhandled      |
| `Match.orElse`     | Fallback for unmatched (non-exhaustive)     |
| `Match.option`     | `Option.some` on match, `Option.none` else  |
| `Match.either`     | `Either.right` on match, `Either.left` else |

**Decision:** Use `Match.type` for reusable matchers, `Match.value` for inline dispatch, `Match.when` for predicate-based primitives.

---
## [5][EFFECT_COMPOSITION]
>**Dictum:** *Consistent combinator selection communicates intent.*

<br>

| [COMBINATOR]     | [WHEN]                                               |
| ---------------- | ---------------------------------------------------- |
| `pipe()`         | Linear left-to-right composition                     |
| `Effect.map`     | Sync transform of success value (A -> B)             |
| `Effect.flatMap` | Chain Effect-returning functions (A -> Effect<B>)    |
| `Effect.andThen` | Mixed input (value, Promise, Effect, Option, Either) |
| `Effect.tap`     | Side effects without changing value                  |
| `Effect.all`     | Aggregate independent effects into struct/tuple      |
| `Effect.gen`     | 3+ dependent operations or control flow              |
| `Effect.fn`      | Named function with automatic tracing span           |
| `Match.type`     | Exhaustive pattern matching on discriminated unions  |

**Rules:** `pipe()` for linear flows; `Effect.gen` for 3+ operations or control flow; `Effect.fn` for service methods; `Telemetry.routeSpan` for routes; `Effect.all` for independent effects.

[CRITICAL]:
- [NEVER] Mix `async/await` with Effect -- use `Effect.promise` for interop.
- [NEVER] Wrap pure `A -> B` functions in Effect -- Effect orchestrates, domain computes.
- [NEVER] Use `Effect.fn` in route handlers -- use `Telemetry.routeSpan`.
- [NEVER] Use `Telemetry.span` in service methods -- use `Effect.fn`.

---
## [6][TYPE_DISCIPLINE]
>**Dictum:** *Fewer, more powerful types reduce API surface. Derive, do not duplicate.*

<br>

| [PATTERN]               | [SYNTAX]                                | [WHEN]                           |
| ----------------------- | --------------------------------------- | -------------------------------- |
| Schema-derived type     | `type X = typeof XSchema.Type`          | All domain types                 |
| Table-derived type      | `type User = typeof users.$inferSelect` | Database models                  |
| Branded type            | `S.String.pipe(S.brand('UserId'))`      | Domain primitives                |
| `satisfies` validation  | `const x = { ... } satisfies Config`    | Validate shape, preserve literal |
| `as const` immutability | `const CONFIG = { ... } as const`       | Immutable config objects         |
| `using` keyword         | `using handle = yield* resource`        | Deterministic resource cleanup   |
| Const type parameters   | `function f<const T>(x: T)`             | Preserve literal types           |
| `Data.TaggedEnum`       | `Data.taggedEnum<MyEnum>()`             | Sum types with pattern matching  |
| Conditional types       | `T extends U ? X : Y`                   | Type-level dispatch              |
| Mapped types            | `{ [K in keyof T]: ... }`               | Type-level transformations       |

[CRITICAL]:
- [NEVER] Create type aliases adding no semantic value.
- [NEVER] Use `Object.freeze` -- `as const` suffices.
- [NEVER] Declare types separately from schemas -- extract, do not duplicate.
- [NEVER] Use `string` for domain identifiers -- use branded types.

---
## [7][SERVICE_ARCHITECTURE]
>**Dictum:** *Services declare interfaces; Layers provide implementations.*

<br>

See [references/examples.md Section 7](./references/examples.md#section_7service_architecture) for complete service definition with Layer.

**Principles:** Service methods return `Effect<Success, Error, never>` (no dependency leakage). `Live` suffix for production, `Test` for test doubles.

---
## [8][ERROR_HANDLING]
>**Dictum:** *Errors are values in the type signature, not exceptions thrown into the void.*

<br>

See [references/examples.md Section 8](./references/examples.md#section_8error_handling) for error handling patterns.

**Principles:** Keep error unions small (3-5 variants per boundary). `Data.TaggedError` for domain errors, `Schema.TaggedError` for API/RPC. Use `Effect.mapError` + `Match.exhaustive` for boundary mapping.

---
## [9][LIBRARIES]
>**Dictum:** *External libraries eliminate hand-rolled utilities.*

<br>

| [PACKAGE]               | [KEY_IMPORTS]                            | [WHEN]                      |
| ----------------------- | ---------------------------------------- | --------------------------- |
| `effect`                | `Effect`, `Schema as S`, `Match`, `pipe` | Core composition            |
| `@effect/platform`      | `HttpClient`, `FileSystem`, `Path`       | Platform IO                 |
| `@effect/sql`           | `SqlClient`, `Statement`                 | Database access             |
| `@effect/opentelemetry` | `NodeSdk`, `Resource`                    | Tracing                     |
| `@effect/experimental`  | `Machine`, `VariantSchema`               | Server-side state machines  |
| `@effect/workflow`      | `Workflow`, `Activity`                   | Durable execution           |
| `@effect/rpc`           | `Router`, `Resolver`                     | Type-safe RPC               |
| `ts-toolbelt`           | `O.Merge`, `L.Concat`                    | Type-level ops (quarantine) |
| `type-fest`             | `Simplify`, `LiteralUnion`               | Public API readability      |

---
## [10][PLATFORM_INTEGRATION]
>**Dictum:** *Monorepo services provide canonical implementations.*

<br>

| [CONCERN]  | [CANONICAL_SOURCE]                         | [RULE]                                            |
| ---------- | ------------------------------------------ | ------------------------------------------------- |
| Caching    | `packages/server/src/platform/cache.ts`    | Use CacheService; no custom cache                 |
| Resilience | `packages/server/src/utils/resilience.ts`  | Use for retry, circuit, bulkhead, timeout         |
| Tracing    | `packages/server/src/observe/telemetry.ts` | `Telemetry.span` for routes; `Effect.fn` internal |
| Metrics    | `packages/server/src/observe/metrics.ts`   | Domain-specific metrics; generic as fallback      |
| Context    | `packages/server/src/context.ts`           | Propagate `Context.Request` in all effects        |
| Middleware | `packages/server/src/middleware.ts`        | Follow header/cookie/auth/tenant patterns         |

---
## [11][VALIDATION]
>**Dictum:** *Gates prevent non-compliant output.*

<br>

[FILE_LAYOUT]: Types -> Schema -> Constants -> Errors -> Services -> Functions -> Layers -> Export. **Extensions:** TABLES (after SCHEMA), REPOSITORIES (after SERVICES). **Forbidden:** Helpers, Handlers, Utils, Config, Dispatch_Tables.

[VERIFY]:
- [ ] No `any`, `let`/`var`, `for`/`while`, `try/catch`, default exports, barrel files.
- [ ] No dispatch tables for branching -- `Match.type`/`Match.value` or `$match` only.
- [ ] No `if/else if` or `switch` on discriminant fields -- `Match.type` + `Match.exhaustive`.
- [ ] No plain `string` for domain identifiers -- branded types via `Schema.brand`.
- [ ] Types derived from schemas/tables -- no duplicate type declarations.
- [ ] Effect combinators match table in [5]. Errors use `Data.TaggedError` or `Schema.TaggedError`.
- [ ] Nullable values use `Option`. Platform integration uses canonical sources from [10].
- [ ] File layout follows order above. All exports in `[EXPORT]` section. Service methods have `R = never`.
- [ ] Error mapping at boundaries uses `Match.value` + `Match.exhaustive` in `mapError`.

[REFERENCE]: [patterns.md](./references/patterns.md) -- Condensed BAD/GOOD pattern pairs, [repo-conventions.md](./references/repo-conventions.md) -- Sources of truth
