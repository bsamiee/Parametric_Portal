---
name: ts-standards
type: standard
depth: extended
description: >-
  Enforces TypeScript/Effect standards: algebraic data types, exhaustive pattern matching, schema-first types, branded types, tagged errors, Effect composition. Use when writing, refactoring, or reviewing TypeScript code.
---

# [H1][TS-STANDARDS]
>**Dictum:** *Consolidation-first, polymorphic, functionally pure TypeScript. Effect orchestrates; domain computes.*

<br>

Enforce dense, consolidated, ADT-first TypeScript. Prefer namespace merges over scattered exports. Prefer polymorphic functions over proliferated helpers. Prefer Effect modules over hand-rolled utilities. Keep pure transformations pure; Effect orchestrates IO, errors, dependencies, concurrency.

**Tasks:** Read this file. Read [index.md](./index.md) for navigation. Read reference files matching work domain: [consolidation.md](references/consolidation.md), [composition.md](references/composition.md), [adts-and-matching.md](references/adts-and-matching.md), [errors-and-services.md](references/errors-and-services.md), [repo-conventions.md](references/repo-conventions.md). Apply standards. Validate against [VERIFY] checklist.

**Versions:** TypeScript 6.0-dev, Effect 3.19+, React 19, Vite 7.

---
## [1][WORKFLOW]
>**Dictum:** *Structured workflow prevents drift.*

<br>

1. Read SKILL.md (this file) for constraints and checklist.
2. Read [index.md](./index.md) to identify relevant reference files.
3. Read reference file(s) matching domain of work.
4. Implement following constraints in section [3].
5. Validate against [VERIFY] checklist in section [6].

---
## [2][CORE_PHILOSOPHY]
>**Dictum:** *Five pillars govern all implementation decisions.*

<br>

- **Consolidation first** -- Namespace merges, IIFE companions, const+namespace exports. Use ONE import per domain concept. [->consolidation.md](references/consolidation.md).
- **No hand-rolling** -- Effect ships `Array`, `Record`, `Option`, `Match`, `TMap`, `FiberMap`, `Schedule`, `Stream`, `PubSub`, `Queue`, `Semaphore`, `Pool`. Use them. [->consolidation.md](references/consolidation.md).
- **No extraction/helper spam** -- Restructure logic to reduce complexity, never extract. No helper files, no thin wrappers, no single-use aliases.
- **Functional core, effectful shell** -- Keep pure `A -> B` pure. Effect orchestrates IO, errors, dependencies, concurrency. Use `Effect.gen` for 3+ deps; `pipe` for linear flows. [->composition.md](references/composition.md).
- **Polymorphism over proliferation** -- Consolidate 3+ functions sharing similar signatures into ONE with discriminated config param. [->consolidation.md](references/consolidation.md).

---
## [3][NON_NEGOTIABLES]
>**Dictum:** *Constraints eliminate entire categories of bugs at compile time.*

<br>

[IMPORTANT]:
- [ALWAYS] Prefix private/internal values with `_`.
- [ALWAYS] Apply IIFE companion pattern for every branded domain primitive.
- [ALWAYS] Apply namespace merge for domain concepts: `const X = { ... } as const; namespace X { ... }; export { X };`.
- [ALWAYS] Use 4-space indentation (no tabs). Reserve comments for "why", never "what".
- [ALWAYS] Derive types from schemas/tables -- never duplicate type alongside schema.

[CRITICAL]:
- [NEVER] `any` -- use branded types via `Schema.brand()`.
- [NEVER] `let`/`var` -- use `const` exclusively.
- [NEVER] `for`/`while` -- use `.map`, `.filter`, `Effect.forEach`, `Effect.iterate`.
- [NEVER] `try/catch` -- use Effect error channel (`Effect.tryPromise`, `Effect.catchTag`).
- [NEVER] Default exports -- named exports only (exception: `*.config.ts`, migrations).
- [NEVER] Barrel files (`index.ts`) -- import directly from source.
- [NEVER] Inline exports -- declare first, export in `[EXPORT]` section.
- [NEVER] `if/else if` chains, `switch` on discriminants -- use `Match.type` + `Match.exhaustive`.
- [NEVER] Dispatch tables with functions/Effects as values -- use `Match.type` or `$match`.
- [NEVER] String errors, generic `Error`, `try/catch` in Effect code -- use `Data.TaggedError`/`Schema.TaggedError`.
- [NEVER] Plain `string` for domain identifiers -- use branded types via `Schema.brand`.
- [NEVER] Module-level type declarations separate from schema -- derive with `typeof XSchema.Type`.
- [NEVER] Helper/utility files (`helpers.ts`, `utils.ts`) -- colocate with domain module.
- [NEVER] Wrappers, thin indirection, const spam -- every binding must justify its existence.

[CONDITIONAL]:
- [ALLOW] Static data maps (`Record<string, string>`) for immutable key-to-value lookups with no behavior.
- [ALLOW] Ternary for binary conditions with simple expressions.
- [PREFER] `Match.type`/`Match.value`/`$match` for exhaustive variant handling.

---
## [4][TYPE_DISCIPLINE]
>**Dictum:** *Fewer, more powerful types reduce API surface. Derive, do not duplicate.*

<br>

| [PATTERN]           | [SYNTAX]                                | [WHEN]                           |
| ------------------- | --------------------------------------- | -------------------------------- |
| Schema-derived type | `type X = typeof XSchema.Type`          | All domain types                 |
| Table-derived type  | `type User = typeof users.$inferSelect` | Database models                  |
| Branded type        | `S.String.pipe(S.brand('UserId'))`      | Domain primitives (IIFE pattern) |

[CRITICAL]:
- [NEVER] Type aliases adding no semantic value.
- [NEVER] `Object.freeze` -- `as const` suffices.
- [NEVER] Parallel `XCreateSchema`/`XUpdateSchema` -- derive via `pick`/`omit`/`partial`.

[REFERENCE] Type-level patterns (`satisfies`, `as const`, `using`, `NoInfer`, const type params): [->adts-and-matching.md](references/adts-and-matching.md) section 5. Schema consolidation: [->consolidation.md](references/consolidation.md) section 5.

---
## [5][LIBRARIES]
>**Dictum:** *External libraries eliminate hand-rolled utilities.*

<br>

| [PACKAGE]               | [KEY_IMPORTS]                                                     | [WHEN]                        |
| ----------------------- | ----------------------------------------------------------------- | ----------------------------- |
| `effect`                | `Effect`, `Schema as S`, `Match`, `pipe`, `Array as A`, `Option`  | Core composition              |
| `effect`                | `STM`, `TMap`, `TRef`, `FiberMap`, `Schedule`, `Stream`, `PubSub` | Advanced concurrency/reactive |
| `effect`                | `Queue`, `Deferred`, `Semaphore`, `Pool`, `Latch`, `Mailbox`      | Concurrency primitives        |
| `@effect/platform`      | `HttpClient`, `FileSystem`, `Path`, `Command`, `Socket`           | Platform IO                   |
| `@effect/sql`           | `SqlClient`, `Statement`                                          | Database access               |
| `@effect/opentelemetry` | `NodeSdk`, `Resource`                                             | Tracing                       |
| `@effect/experimental`  | `Machine`, `VariantSchema`                                        | Server-side state machines    |
| `@effect/workflow`      | `Workflow`, `Activity`                                            | Durable execution             |
| `@effect/rpc`           | `Router`, `Resolver`                                              | Type-safe RPC                 |
| `ts-toolbelt`           | `O.Merge`, `L.Concat`                                             | Type-level ops (quarantine)   |
| `type-fest`             | `Simplify`, `LiteralUnion`                                        | Public API readability        |
| `ts-essentials`         | `XOR`, `DeepReadonly`                                             | Exclusive unions, deep immut  |

[REFERENCE] No-hand-rolling table: [->consolidation.md](references/consolidation.md).

---
## [6][VALIDATION]
>**Dictum:** *Gates prevent non-compliant output.*

<br>

[FILE_LAYOUT]: Types -> Schema -> Constants -> Errors -> Services -> Functions -> Layers -> Export. **Extensions:** TABLES (after SCHEMA), REPOSITORIES (after SERVICES). **Forbidden labels:** Helpers, Handlers, Utils, Config, Dispatch_Tables.

[VERIFY]:
- [ ] No `any`, `let`/`var`, `for`/`while`, `try/catch`, default exports, barrel files, inline exports.
- [ ] No `if/else if`/`switch` on discriminants -- `Match.type`/`$match` for all variant branching.
- [ ] No plain `string` for domain identifiers -- branded types via `Schema.brand`.
- [ ] No module-level type declarations separate from schema -- derive with `typeof`.
- [ ] No helper/utility files -- colocate with domain module.
- [ ] No hand-rolled utilities that exist in Effect modules (`Array`, `Record`, `Option`, `Match`, `TMap`, `FiberMap`, `Schedule`, `Stream`, `PubSub`).
- [ ] Branded types use IIFE companion pattern (schema + operations bundled).
- [ ] Domain concepts use namespace merge: `const X = { ... } as const; namespace X { ... }`.
- [ ] One canonical schema per entity -- variants derived via `pick`/`omit`/`partial`.
- [ ] Services use `Effect.Service`, not `Context.Tag` -- methods have `R = never`.
- [ ] Effect combinators match table in composition.md -- `Effect.fn` for services, `Telemetry.routeSpan` for routes.
- [ ] Errors use `Data.TaggedError` (domain) or `Schema.TaggedError` (boundary) -- boundary mapping exhaustive.
- [ ] Nullable values use `Option` -- no null checks.
- [ ] Sum types use `Data.TaggedEnum` -- no string literal unions with per-variant data.
- [ ] File layout follows canonical order. All exports in `[EXPORT]` section.

[REFERENCE] Navigation: [->index.md](./index.md). Conventions: [->repo-conventions.md](references/repo-conventions.md).
