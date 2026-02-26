---
name: ts-standards
description: >-
  Sole authority on TypeScript + Effect style, type discipline, error handling,
  concurrency, and module organization in this workspace. MUST be loaded for
  every TypeScript code interaction. Use when performing ANY TypeScript-related
  task: (1) writing, editing, creating, reviewing, refactoring, or debugging
  `.ts/.tsx` modules; (2) implementing domain models, Effect services,
  persistence adapters, or boundary handlers; (3) configuring TypeScript,
  Effect, or lint/type-check posture.
metadata:
  token_estimates:
    entry_point: 4300
    full_load: 18500
    max_load: 58000
  refreshed_at: 2026-02-24
---

# [H1][TS-STANDARDS]
>**Dictum:** *Functional discipline keeps TypeScript + Effect modules explicit, branch-free, and boundary-safe.*

<br>

This skill enforces a single dense TypeScript style: runtime-first shapes via `Schema`, explicit error rails via `Data.TaggedError`, expression-only control flow via `Match` + monadic combinators, and boundary-safe services via `Effect.Service` + `Layer`.

---
## [1][LOAD_SEQUENCE]
>**Dictum:** *Load references in order; selective loading weakens enforcement.*

<br>

All steps are mandatory unless marked specialized.

**Step 1 -- Foundation (always first)**

| [INDEX] | [REFERENCE]     | [FOCUS]                        |
| :-----: | :-------------- | ------------------------------ |
|   [1]   | `validation.md` | Compliance and completion gate |
|   [2]   | `patterns.md`   | Anti-bloat and module topology |

**Step 2 -- Core (always second)**

| [INDEX] | [REFERENCE]      | [FOCUS]                               |
| :-----: | :--------------- | ------------------------------------- |
|   [3]   | `types.md`       | Runtime-first shape design            |
|   [4]   | `effects.md`     | Effect construction and error rails   |
|   [5]   | `matching.md`    | Exhaustive expression control flow    |
|   [6]   | `composition.md` | Layer and module boundary composition |

**Step 3 -- Specialized (load when task requires)**

| [INDEX] | [REFERENCE]        | [LOAD_WHEN]                               |
| :-----: | :----------------- | ----------------------------------------- |
|   [7]   | `errors.md`        | Domain/persistence error mapping          |
|   [8]   | `services.md`      | Service topology and dependency strategy  |
|   [9]   | `persistence.md`   | SQL/model boundary work                   |
|  [10]   | `concurrency.md`   | Streams, fibers, and bounded concurrency  |
|  [11]   | `surface.md`       | Public API minimization                   |
|  [12]   | `observability.md` | Logging, tracing, metrics                 |
|  [13]   | `performance.md`   | Hot path and allocation discipline        |
|  [14]   | `algorithms.md`    | Non-trivial transform and fold strategies |

**Step 4 -- Templates (scaffolding only)**

| [INDEX] | [TEMPLATE]                   | [ARCHETYPE]          |
| :-----: | :--------------------------- | :------------------- |
|  [15]   | `entity.module.template.md`  | Entity (Domain)      |
|  [16]   | `service.module.template.md` | Service (Capability) |
|  [17]   | `utility.module.template.md` | Utility (Pure Rail)  |
|  [18]   | `program.module.template.md` | Program              |
|  [19]   | `adapter.module.template.md` | Adapter              |
|  [20]   | `runtime.module.template.md` | Runtime              |

**Load parity rules**
- Foundation + core are non-optional for every TypeScript task.
- Specialized references must be loaded before editing matching surfaces.
- Templates accelerate authoring; templates do not replace references.
- If load order breaks, stop and reload from Step 1.

---
## [2][CONTRACTS]
>**Dictum:** *Structural invariants are mandatory; policy violations are defects, not style choices.*

<br>

**Density over volume**
- `~300 LOC` is a refactor trigger for a single-module concept, leveraging polymorphism, optimized code, removing indirection, proper projection, and replacing all single-caller helpers, and other refinements.
- Prefer extending the current module over creating helper files.
- One module owns one concept and one public ownership surface.

**External libraries are first-class**
- Use upstream primitives directly: `Effect`, `Schema`, `Option`, `Either`, `Match`, `Stream`, `Layer`, `SqlClient`, `Model`.
- Do not add convenience wrappers that only rename or forward external APIs.
- Add custom code only when domain semantics are missing upstream.

**Shape and type discipline**
- One canonical runtime anchor per concept (`S.Class`, `Model.Class`, or one tagged service contract).
- Derive all projections from that anchor (`S.pick`, `S.omit`, `S.partial`), never parallel `S.Struct` variants.
- One tagged failure rail per module (`Data.TaggedError` with bounded `reason` literals + one canonical `reason -> policy` projection table as the sole projection surface).
- No inline status/retry/transport literals outside the canonical reason-policy table.
- No parallel schemas/brands/types for the same domain concept.
- Avoid module-level `type`/`interface` declarations when inference from runtime declarations is sufficient.

**Control-flow discipline (anti-imperative)**
- Zero statement-level `if`, `else`, `switch`, `for`, `while`, `try/catch`, `throw` in domain transforms and templates.
- Use expression control flow: `Match.valueTags` / `Match.tagsExhaustive` for closed tagged domains, plus `Match`, `Option.match`, `Either.match`, `Effect.filterOrFail`, `Effect.catchTag`.
- Boundary adapters may use required statement forms only with explicit marker comment: `[BOUNDARY ADAPTER -- reason]`.

**Surface and error discipline**
- One polymorphic entrypoint per concern; avoid method-family inflation (`run`, `runSafe`, `runV2`).
- Decode unknown input at boundaries and map unknown causes immediately.
- Collapse optional/error channels explicitly; do not leak `unknown` across domain boundaries.

**Resource and concurrency discipline**
- Resource lifecycle goes through `Effect.acquireRelease`.
- Retry, timeout, and concurrency policy are declarative (`Schedule`, `Effect.forEach`, `Stream`).
- Hidden global state and untracked ambient dependencies are forbidden.

---
## [3][ROUTING]
>**Dictum:** *Foundation/core always load; routing selects specialized references and template entrypoints.*

<br>

| [INDEX] | [TASK]                         | [ADD_SPECIALIZED]                                                  | [TEMPLATE]                   |
| :-----: | ------------------------------ | ------------------------------------------------------------------ | ---------------------------- |
|   [1]   | Create/refactor entity module  | `errors.md` `persistence.md` `matching.md`                         | `entity.module.template.md`  |
|   [2]   | Create/refactor service module | `errors.md` `services.md` `concurrency.md` `observability.md`      | `service.module.template.md` |
|   [3]   | Create/refactor utility module | `validation.md` `errors.md` `types.md`                             | `utility.module.template.md` |
|   [4]   | Create/refactor program module | `services.md` `errors.md` `composition.md`                         | `program.module.template.md` |
|   [5]   | Create/refactor adapter module | `surface.md` `validation.md` `errors.md` `observability.md`        | `adapter.module.template.md` |
|   [6]   | Create/refactor runtime module | `composition.md` `services.md` `observability.md` `performance.md` | `runtime.module.template.md` |
|   [7]   | Public API surface refactor    | `surface.md` `errors.md`                                           | --                           |
|   [8]   | SQL/model boundary refactor    | `persistence.md` `errors.md`                                       | --                           |
|   [9]   | Observability instrumentation  | `observability.md` `performance.md`                                | --                           |
|  [10]   | Performance optimization       | `performance.md`                                                   | --                           |
|  [11]   | Algorithm-heavy transform      | `algorithms.md` `performance.md`                                   | --                           |

---
## [4][DECISION_TREES]
>**Dictum:** *Choose rails before coding; mismatched rails create drift and bloat.*

<br>

**Module archetype**

| [INDEX] | [WHAT_YOU_ARE_BUILDING]                    | [ARCHETYPE] | [PRIMARY_ANCHOR]                  |
| :-----: | ------------------------------------------ | :---------: | --------------------------------- |
|   [1]   | Aggregate with lifecycle transitions       |   Entity    | `S.Class` (+ optional `Model`)    |
|   [2]   | Capability module with lifecycle + DI      |   Service   | `Effect.Service` + `Layer`        |
|   [3]   | Reusable canonicalization/parse transform  |   Utility   | `Schema` + transform rail         |
|   [4]   | Use-case orchestration across capabilities |   Program   | `Effect.fn` + service composition |
|   [5]   | Transport/boundary translation             |   Adapter   | `Schema` + delegate rail          |
|   [6]   | Composition root / bootstrap               |   Runtime   | `Layer` graph + run rail          |

**Failure rail selection**

| [INDEX] | [FAILURE_SHAPE]                      | [USE]                | [BOUNDARY_RULE]                |
| :-----: | ------------------------------------ | -------------------- | ------------------------------ |
|   [1]   | Decode/parse failures                | `ParseResult` + map  | Convert to tagged module error |
|   [2]   | Domain validation/business rejection | `Effect.fail` tagged | Bounded reason literals        |
|   [3]   | Upstream/transport/persistence cause | `mapError` + matcher | Preserve cause: tagged failure |

**Shape strategy**

| [INDEX] | [NEED]                | [USE]                                        |
| :-----: | --------------------- | -------------------------------------------- |
|   [1]   | Stable identity shape | canonical schema + decode gate               |
|   [2]   | Aggregate state       | `S.Class`                                    |
|   [3]   | Storage row           | `Model.Class` when persistence is co-located |
|   [4]   | Operation dispatch    | Tagged command/event `S.Union`               |

---
## [5][ANTI_PATTERNS]
>**Dictum:** *Most regressions start as convenience shortcuts.*

<br>

Each anti-pattern names a structural defect that propagates if left unchecked. See `validation.md` [7] for detection laws.

**Type-system violations**
- **SHAPE_PROLIFERATION** -- duplicate schema/type for one concept. Keep one runtime anchor and derive projections via `pick`/`omit`/`partial`.
- **TYPE_PROLIFERATION** -- top-level `type`/`interface` aliases that mirror runtime shape. Derive from runtime declarations (`typeof XSchema.Type`).
- **NULL_ARCHITECTURE** -- `null`/`undefined` leaking across domain boundaries. `Option<T>` for absence, tagged failure for errors.

**Control-flow violations**
- **IMPERATIVE_BRANCH** -- statement branching (`if`/`else`/`switch`/`for`/`while`) in domain flow. Replace with `Match` + monadic operators.
- **EARLY_MATCH_COLLAPSE** -- calling `match`/`Match.exhaustive` mid-pipeline and losing composition. Keep `map`/`flatMap`; match at boundaries.
- **MUTABLE_ACCUMULATOR** -- `let` + loop accumulation breaks referential transparency. `Array.reduce`, `Effect.forEach`, or `Stream.runFold` replace it.

**Surface-area violations**
- **SURFACE_INFLATION** -- multiple entrypoints for one concern (`run`, `runSafe`, `runV2`). Collapse to one polymorphic surface.
- **WRAPPER_REDUNDANCY** -- thin wrappers around external library APIs. Call upstream primitives directly.
- **HELPER_FILE_DRIFT** -- moving one-use logic into helper modules. Inline and keep ownership local.
- **MODULE_CONST_SPAM** -- one-use top-level `const` values that are not semantic anchors (schemas, schedules, metrics, vocabularies). Inline into the owning rail.
- **STRINGLY_TELEMETRY** -- repeated raw telemetry keys/values (`"operation"`, `"status_class"`, `"obs.outcome"`) across spans/metrics/logs. Define one bounded vocabulary object and project through it.
- **GOD_FUNCTION** -- giant dispatch handling all variants in one function body. DU + exhaustive `Match.valueTags` makes extension additive.

**Error-rail violations**
- **ERROR_RAIL_FRAGMENTATION** -- separate error classes per method. Keep one tagged module failure rail with bounded `reason` literals.
- **STRINGLY_POLICY_DRIFT** -- duplicate inline status/retry/transport literals in handlers. Project via one canonical `reason -> policy` table only.
- **STRINGLY_SIGNATURE_DRIFT** -- delimiter-concatenated signatures (`${a}:${b}:${c}`) for equality/routing. Project structured tuples/records and compare fields directly.
- **VARIABLE_REASSIGNMENT** -- `let value = x; value = process(value)` creates temporal coupling. `pipe` chains make the computation graph explicit.

```ts
// [ANTI-PATTERN] IMPERATIVE_BRANCH -- statement branching in domain flow
if (status === 'active') { return handleActive(entity); }
else if (status === 'archived') { return handleArchived(entity); }
```
```ts
// [CORRECT] -- exhaustive expression dispatch
const Status = {
    active: 'active',
    archived: 'archived',
} as const satisfies Record<'active' | 'archived', string>;

Match.value(status).pipe(
    Match.when(Status.active, () => handleActive(entity)),
    Match.when(Status.archived, () => handleArchived(entity)),
    Match.exhaustive,
);
```

```ts
// [ANTI-PATTERN] SHAPE_PROLIFERATION -- parallel schema for same concept
const UserCreate = S.Struct({ name: S.String, email: S.String });
const UserUpdate = S.Struct({ name: S.String, email: S.String, id: S.UUID });
const UserResponse = S.Struct({ name: S.String, email: S.String, id: S.UUID, createdAt: S.DateTimeUtc });
```
```ts
// [CORRECT] -- one anchor, derived projections
class User extends S.Class<User>('User')({
    id: S.UUID, name: S.String, email: S.String, createdAt: S.DateTimeUtc,
}) {}
// derive: User.pipe(S.pick('name', 'email')) for create input
```

```ts
// [ANTI-PATTERN] EARLY_MATCH_COLLAPSE -- match destroys monadic context
const result = Option.match(maybeUser, {
    onNone: () => Option.none(),
    onSome: (user) => Option.some(user.email),
});
```
```ts
// [CORRECT] -- map preserves the functor
const result = Option.map(maybeUser, (user) => user.email);
```

---
## [6][TEMPLATE_GUIDANCE]
>**Dictum:** *Templates are dense production scaffolds, not tutorial prose.*

<br>

- **Entity template** (`entity.module.template.md`) -- one aggregate anchor via `S.Class`, one command union via `S.Union`, one transition entrypoint (`evolve`) with exhaustive `Match.valueTags` routing, one tagged failure rail plus one canonical `reason -> policy` table.
- **Service template** (`service.module.template.md`) -- one `Effect.Service` grouped by `write`/`read`/`observe`, one scoped lifecycle, one strict boundary decode rail, one bounded operation/reason failure policy, retry/timeout derived from policy.
- **Utility template** (`utility.module.template.md`) -- one canonical schema anchor, one decode+canonicalize rail, one explicit lookup reconciliation rail via `Option.match`, one bounded failure policy table, bounded batch concurrency.
- **Program template** (`program.module.template.md`) -- one use-case orchestration entrypoint (`run`) that composes services/capabilities, validates ingress/egress once, and exports one tagged failure rail.
- **Adapter template** (`adapter.module.template.md`) -- one transport-edge handler that decodes unknown boundary input, delegates domain execution, and projects errors to deterministic transport response shape.
- **Runtime template** (`runtime.module.template.md`) -- one root layer graph and one run bridge; feature modules never own root `provide` composition.

**Post-scaffold checklist**
- Remove all placeholder comments after instantiation.
- Verify one canonical schema and one tagged failure rail per module.
- Verify one canonical `reason -> policy` table per module and zero inline policy literals outside it.
- Run `pnpm ts:check`.
- Confirm zero `if`/`for`/`while`/`try` in domain transforms.
- Confirm closed finite-domain tagged matchers use `Match.valueTags`/`Match.tagsExhaustive` (or `Match.exhaustive` for non-tag domains); use `Match.option`/`Match.either`/`Match.orElse` only when unmatched semantics are intentional and collapsed immediately.

---
## [7][VALIDATION_GATE]
>**Dictum:** *Completion requires policy compliance and executed checks.*

- Required during TypeScript iteration: `pnpm ts:check`.
- Required for final repo completion gate: `pnpm ts:check`, `pnpm cs:check`, `pnpm py:check`.
- Reject completion when load order, contracts, or checks are not satisfied.
