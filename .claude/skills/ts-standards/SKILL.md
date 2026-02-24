---
name: ts-standards
description: >-
  Sole authority on TypeScript + Effect style, type discipline, error handling,
  concurrency, and module organization in this workspace. MUST be loaded for
  every TypeScript code interaction. Use when performing ANY TS-related task:
  (1) writing, editing, creating, reviewing, refactoring, or debugging any
  .ts/.tsx module, Effect.Service, Layer, tagged error algebra, or schema;
  (2) implementing domain services, HTTP endpoints, cluster entities, RPC
  groups, durable workflows, or repository factories;
  (3) working with @effect/sql, @effect/platform, @effect/cluster,
  @effect/opentelemetry, @effect/rpc, @effect/workflow, @effect/ai, or any
  Effect ecosystem package in this monorepo;
  (4) writing or editing Vitest spec files, @effect/vitest property tests,
  or test configuration.
metadata:
  token_estimates:
    entry_point: 4500
    full_load: 26500
    max_load: 70000
---

# [H1][TS-STANDARDS]
>**Dictum:** *Minimal-surface discipline unifies TypeScript 6.0 + Effect 3.19 authoring.*

Single dense style: polymorphic entrypoints over method families, schema only when codec/validation requires it, tagged-error algebras with exhaustive dispatch, Effect.Service capability groups, type inference from runtime values, zero imperative branching.

---
## [1][LOAD_SEQUENCE]
>**Dictum:** *Selective loading creates blind spots -- load layered.*

Hold all loaded references stable through task completion.

**Step 1 -- Foundation (always load first)**

| [IDX] | [REFERENCE]     | [FOCUS]            |
| :---: | --------------- | ------------------ |
|  [1]  | `validation.md` | Compliance checks  |
|  [2]  | `patterns.md`   | Anti-pattern codex |

**Step 2 -- Core (always load second)**

| [IDX] | [REFERENCE]      | [FOCUS]                            |
| :---: | ---------------- | ---------------------------------- |
|  [3]  | `types.md`       | Inference, branded, TaggedEnum     |
|  [4]  | `effects.md`     | Effect.gen/fn, Schedule, recovery  |
|  [5]  | `matching.md`    | $match, Match.type/value/valueTags |
|  [6]  | `composition.md` | Layer topology, pipe/flow, Stream  |

**Step 3 -- Specialized (load when task requires)**

| [IDX] | [REFERENCE]        | [LOAD_WHEN]                           |
| :---: | ------------------ | ------------------------------------- |
|  [7]  | `errors.md`        | Tagged error algebras, Cause/Exit     |
|  [8]  | `services.md`      | Effect.Service, scoped, caps          |
|  [9]  | `concurrency.md`   | STM, TMap, Fiber, Queue, Semaphore    |
| [10]  | `persistence.md`   | @effect/sql, Model.Class, SqlClient   |
| [11]  | `surface.md`       | HttpApi, @effect/rpc, @effect/cluster |
| [12]  | `observability.md` | Tracing, metrics, FiberRef            |
| [13]  | `testing.md`       | @effect/vitest, PBT, layer testing    |
| [14]  | `algorithms.md`    | Stream, Chunk, transformations        |
| [15]  | `performance.md`   | V8 optimization, Effect perf          |

**Step 4 -- Template (scaffolding only)**

| [IDX] | [TEMPLATE]                   | [ARCHETYPE] |
| :---: | ---------------------------- | :---------: |
| [16]  | `entity.module.template.md`  |   Entity    |
| [17]  | `service.module.template.md` |   Service   |
| [18]  | `utility.module.template.md` |   Utility   |

---
## [2][CONTRACTS]
>**Dictum:** *Structural invariants constrain all modules.*

**Density** -- ~225 LOC signals refactor. Dense polymorphic patterns compress well. File proliferation is always a smell.

**Single export** -- every module exports ONE `const` namespace (with merge) or ONE `Effect.Service` class. Internals use `_` prefix.

**Schema when needed** -- `S.Class`/`S.TaggedClass`/`Model.Class` only when: parsing external input, codec required, Hash/Equal needed, or validation pipeline. Plain objects + `typeof` otherwise.

**Zero module-level `type` aliases** -- types are inline at call site (`typeof Schema.Type`, `Extract<...>`) or exported inside a `const+namespace` / `class+namespace` merge.

**Inference over annotation** -- derive from runtime values (`typeof`, `ReturnType`, `Parameters`). Never redeclare what the compiler infers.

**Zero imperative branching** -- no `if`/`switch`/`try`/`catch`/`for`/`while`. Route through `Match.valueTags`, `$match`, `Option.match`, `Either.match`, `Effect.filterOrFail`, `Effect.catchTag`, ternary (binary only).

**One service class per module** (`Effect.Service`). Capabilities as groups (`{ read, write, observe } as const`). Methods traced via `Effect.fn('Service.method')`.

**One polymorphic entrypoint** per concern -- not method families. One function owns all modalities via generics, overloads, or tagged dispatch.

**Tagged errors only** -- `Data.TaggedError` (internal), `Schema.TaggedError` (boundary). Zero `new Error(...)`, zero `throw`.

**FiberRef** for context propagation -- not parameter drilling.

**Imports convention**

| [SCOPE]  | [IMPORT]                                              |
| -------- | ----------------------------------------------------- |
| Core     | `{ Effect, Schema as S, Match, Option, Data }` from   |
|          | `'effect'`                                            |
| Platform | `{ HttpApi, HttpApiGroup }` from `'@effect/platform'` |
| SQL      | `{ SqlClient, Model }` from `'@effect/sql'`           |
| Cluster  | `{ Sharding, Entity }` from `'@effect/cluster'`       |
| RPC      | `{ Rpc, RpcGroup }` from `'@effect/rpc'`              |
| Workflow | `{ Workflow, Activity }` from `'@effect/workflow'`    |
| AI       | `{ AiChat }` from `'@effect/ai'`                      |
| OTel     | `{ NodeSdk }` from `'@effect/opentelemetry'`          |

---
## [3][ROUTING]
>**Dictum:** *Foundation+core load unconditionally; routing selects specialization.*

| [IDX] | [TASK]                   | [ADD_SPECIALIZED]        | [TEMPLATE]       |
| :---: | ------------------------ | ------------------------ | ---------------- |
|  [1]  | Scaffold entity          | `errors` `matching`      | `entity.module`  |
|  [2]  | Scaffold service         | `services`               | `service.module` |
|  [3]  | Scaffold utility         | --                       | `utility.module` |
|  [4]  | Error algebra            | `errors`                 | --               |
|  [5]  | Dispatch logic           | `matching`               | --               |
|  [6]  | Type organization        | --                       | --               |
|  [7]  | Concurrency patterns     | `concurrency`            | --               |
|  [8]  | Service layers           | `services` `composition` | --               |
|  [9]  | Cluster/sharding         | `services` `surface`     | --               |
| [10]  | HTTP API                 | `surface` `errors`       | --               |
| [11]  | RPC contract             | `surface`                | --               |
| [12]  | Persistence layer        | `persistence`            | --               |
| [13]  | Observability/tracing    | `observability`          | --               |
| [14]  | Write/review tests       | `testing`                | --               |
| [15]  | Stream pipeline          | `algorithms`             | --               |
| [16]  | Performance optimization | `performance`            | --               |
| [17]  | Review existing module   | --                       | --               |

---
## [4][DECISION_TREES]
>**Dictum:** *Route decisions before loading references.*

**Schema family** -- choose minimal representation satisfying the constraint.

| [IDX] | [DATA_SHAPE]                   | [USE]             |
| :---: | ------------------------------ | ----------------- |
|  [1]  | Persistence model, field meta  | `Model.Class`     |
|  [2]  | Domain object, codec/Hash/Eq   | `S.Class`         |
|  [3]  | Union member (current/future)  | `S.TaggedClass`   |
|  [4]  | Request/response + cache key   | `S.TaggedRequest` |
|  [5]  | Config, internal state         | Plain object      |
|  [6]  | Recursive/mutual tree          | `S.suspend`       |
|  [7]  | Nominal refinement (Email, Id) | `S.brand`         |
|  [8]  | Closed union with generics     | `Data.TaggedEnum` |

**Match API** -- see `matching.md` for full dispatch patterns.

| [IDX] | [SITUATION]                     | [USE]             |
| :---: | ------------------------------- | ----------------- |
|  [1]  | `Data.taggedEnum` with generics | `$match`          |
|  [2]  | `S.TaggedClass/Error` union     | `Match.valueTags` |
|  [3]  | Branches return Effects         | `Match.type`      |
|  [4]  | Non-tagged structural matching  | `Match.value`     |
|  [5]  | Type guard for `.filter`        | `$is`             |

**Service constructor mode** -- see `services.md` for anatomy.

| [IDX] | [SERVICE_NEEDS]                 | [MODE]    |
| :---: | ------------------------------- | --------- |
|  [1]  | No deps, no lifecycle, pure     | `succeed` |
|  [2]  | Yields services, no resources   | `effect`  |
|  [3]  | Connections, caches, finalizers | `scoped`  |

**Module archetype** -- determines scaffold template.

| [IDX] | [WHAT_YOU_ARE_BUILDING]            | [ARCHETYPE] |
| :---: | ---------------------------------- | ----------- |
|  [1]  | Domain object + command + dispatch | Entity      |
|  [2]  | Managed resource + capability caps | Service     |
|  [3]  | Pure `A -> B` + traced pipelines   | Utility     |

---
## [5][ANTI_PATTERNS]
>**Dictum:** *Expert knowledge is knowing which landmines to avoid.*

See `patterns.md [1-6]` for full codex; `validation.md [6]` for detection heuristics.

**Surface-area violations**
- **SCHEMA_SPAM** -- schema for internal state/config that never serializes.
- **API_SURFACE_INFLATION** -- method families instead of one polymorphic function.
- **EXPORT_BLOAT** -- 5+ named exports per file. One namespace or service class.
- **HELPER_SPAM** -- `helpers.ts`/`utils.ts`/`shared/`. Colocate in domain module.
- **TYPE_PROLIFERATION** -- standalone `type X = {...}` at module scope.

**Control-flow violations**
- **IMPERATIVE_BRANCHING** -- `if`/`switch`/`for`/`while` in domain logic.
- **EXCEPTION_CONTROL_FLOW** -- `try`/`catch`/`throw` hides failure from types.

**Effect-specific violations**
- **UNBOUNDED_CONCURRENCY** -- unbounded `Effect.all` for database queries.
- **GOD_SERVICE** -- 8+ capabilities spanning multiple concerns.
- **INDIRECTION_FACTORY** -- wrapper adding zero logic.
- **FORWARD_REFERENCE_STATIC** -- class static in `extends` clause.
- **BOUNDARY_ERROR_NO_FACTORY** -- `Schema.TaggedError` without `of`/`from`.
- **MIXED_TENANT_CONTEXT** -- `within()`/`withinSync()` in same path.
- **SILENT_ERROR_SWALLOW** -- `Effect.catchAll` hiding failures.
- **MATCH_TYPE_GENERIC_ENUM** -- `Match.type` re-specifying generics. Use `$match`.

---
## [6][TEMPLATES]
>**Dictum:** *Scaffolds enforce structural compliance from first line.*

- **Entity** (`entity.module.template.md`) -- schema, projections, command algebra, failure algebra, single `execute` entrypoint, const+namespace export.
- **Service** (`service.module.template.md`) -- deps, scoped acquisition, traced capability groups, stream batching, layer assembly.
- **Utility** (`utility.module.template.md`) -- typed errors, pure `A -> B`, `Effect.fn` traced pipelines, const+namespace export.

---
## [7][EFFECT_ECOSYSTEM]
>**Dictum:** *Leverage the ecosystem -- never hand-roll.*

**Installed packages**

| [IDX] | [PACKAGE]               | [PROVIDES]                        |
| :---: | ----------------------- | --------------------------------- |
|  [1]  | `effect`                | Effect, Schema, Match, Data, etc. |
|  [2]  | `@effect/platform`      | HTTP API, file system, workers    |
|  [3]  | `@effect/sql`           | SqlClient, SqlSchema, Model       |
|  [4]  | `@effect/sql-pg`        | PgClient, advisory locks          |
|  [5]  | `@effect/cluster`       | Sharding, Entity, Singleton       |
|  [6]  | `@effect/opentelemetry` | Tracing, metrics via OTel         |
|  [7]  | `@effect/rpc`           | Typed RPC with schema validation  |
|  [8]  | `@effect/workflow`      | Durable workflow execution        |
|  [9]  | `@effect/ai`            | AI provider abstraction           |
| [10]  | `@effect/ai-anthropic`  | Anthropic Claude integration      |

**Core APIs** (from `effect`)

| [IDX] | [API]            | [PURPOSE]                           |
| :---: | ---------------- | ----------------------------------- |
|  [1]  | `Effect.gen`     | Generator-based monadic composition |
|  [2]  | `Effect.fn`      | Traced function with span           |
|  [3]  | `Effect.Service` | Tag + constructor + Default layer   |
|  [4]  | `Schema as S`    | Codec, validation, brand, class     |
|  [5]  | `Match`          | Exhaustive structural dispatch      |
|  [6]  | `Data`           | TaggedEnum, TaggedError, Case       |
|  [7]  | `Stream`         | Lazy pull-based async sequences     |
|  [8]  | `Schedule`       | Retry/repeat policies               |
|  [9]  | `Layer`          | Dependency injection + lifecycle    |
| [10]  | `FiberRef`       | Scoped context propagation          |
| [11]  | `STM/TMap`       | Software transactional memory       |
| [12]  | `Queue`          | Bounded concurrent message queues   |
| [13]  | `Ref`            | Mutable reference in Effect context |
| [14]  | `Duration`       | Type-safe time representation       |
| [15]  | `Option`         | Typed absence                       |
| [16]  | `Function`       | `pipe`, `flow`, `identity`          |
