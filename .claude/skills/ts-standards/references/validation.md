# [H1][VALIDATION]
>**Dictum:** *Operational criteria verify TypeScript + Effect standards compliance.*

<br>

Checklists for verifying module compliance with ts-standards contracts. Use after scaffolding, editing, or reviewing any `.ts/.tsx` module.

---
## [1][SCHEMA]

- [ ] One canonical schema per entity — no duplicate struct definitions
- [ ] Types derived from schemas: `typeof XSchema.Type`, not standalone `type X = {...}`
- [ ] Domain primitives use `S.brand()` for nominal typing
- [ ] Projections derived via `pick`/`omit`/`partial` from canonical schema
- [ ] External data decoded at boundaries via `S.decodeUnknown`
- [ ] No `S.Class` where `S.TaggedClass` is needed for union membership

---
## [2][ERRORS]

- [ ] Internal errors use `Data.TaggedError` (small union, yieldable)
- [ ] Boundary errors use `Schema.TaggedError` + `HttpApiSchema.annotations` (status + codec)
- [ ] Error unions contain 3-5 variants per service boundary (not more)
- [ ] Multi-reason errors use `S.Literal` reason field instead of many variants
- [ ] Boundary collapse is exhaustive via `Match.valueTags` inside `Effect.mapError`
- [ ] No `new Error(...)`, no string errors, no ad-hoc `throw`

---
## [3][DISPATCH]

- [ ] Exhaustive matching via `$match`, `Match.valueTags`, or `Match.type` + `Match.exhaustive`
- [ ] No `if`, `else if`, `switch`, or `try/catch` for control flow
- [ ] Binary conditions use ternary (allowed) or `Option.match`/`Either.match`
- [ ] `$match` preferred for `Data.taggedEnum` instances; `Match.valueTags` for schema classes
- [ ] `Match.type` pipeline used only when branches return Effects or require composition
- [ ] Every `_tag` branch handled — compiler-enforced exhaustiveness

---
## [4][SERVICES]

- [ ] One `Effect.Service` class maximum per module
- [ ] Constructor mode matches need: `succeed` (pure), `effect` (deps), `scoped` (lifecycle)
- [ ] Capabilities returned as groups: `{ read, write, observe }` with `as const`
- [ ] Service methods traced via `Telemetry.span('Service.method', { metrics: false })`; `Effect.fn` for lightweight internal helpers only
- [ ] Scoped constructors use `Effect.acquireRelease` for resource handles
- [ ] Dual-mode access: module-level factories for `R=never`, static delegates for `R=Service`
- [ ] `dependencies: [X.Default]` for inline layer provision

---
## [5][TYPES]

- [ ] No standalone `type X = ...` at module scope
- [ ] Types live under `const+namespace` merge or inline (`typeof Schema.Type`)
- [ ] Narrowing via `Extract<Union, { _tag: 'X' }>` + type predicate at call site
- [ ] Failure routed through `Effect.filterOrFail`, not `if` checks
- [ ] Union derivation from constructor maps: `InstanceType<(typeof errors)[keyof typeof errors]>`
- [ ] `satisfies` for shape validation; `as const` for immutability
- [ ] No re-export of external lib types — consumers import directly

---
## [6][ERROR_SYMPTOMS]

| [INDEX] | [SYMPTOM]                               | [CAUSE]                      | [FIX]                                            |
| :-----: | --------------------------------------- | ---------------------------- | ------------------------------------------------ |
|   [1]   | `type X = ...` at module scope          | Standalone type alias        | Move into `namespace X { export type ... }`      |
|   [2]   | `if (x)` or `switch (x._tag)`           | Imperative branching         | Replace with `$match`/`Match.valueTags`          |
|   [3]   | `try { } catch (e) { }`                 | Exception-based control flow | Use `Effect.tryPromise` + error channel          |
|   [4]   | `let x = ...; x = ...`                  | Mutable variable             | Use `const` + functional transform               |
|   [5]   | `new Error('message')`                  | Stringly-typed error         | Use `Data.TaggedError` with structured fields    |
|   [6]   | `export default`                        | Default export               | Use named export at file end                     |
|   [7]   | `for (const x of arr)`                  | Imperative loop              | Use `.map`/`.filter`/`Effect.forEach`            |
|   [8]   | `helpers.ts` or `utils.ts`              | Helper/utility file          | Colocate logic in domain module                  |
|   [9]   | Multiple `type` aliases for same entity | Schema/type proliferation    | One canonical schema, derive variants via `pick` |
|  [10]   | `Object.freeze(config)`                 | Runtime immutability attempt | Use `as const` (compile-time sufficient)         |
