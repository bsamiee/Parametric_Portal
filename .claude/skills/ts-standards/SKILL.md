---
name: ts-standards
description: >-
  Enforces schema-first TypeScript + Effect authoring conventions: tagged-union
  dispatch, Effect.Service capability groups, namespace-merged types, no
  imperative branching. Use when editing, creating, reviewing, or refactoring
  any .ts/.tsx module, implementing Effect services or layers, defining schemas
  or error algebras, scaffolding new domain modules, or applying codebase style
  standards to TypeScript code.
---

# [H1][TS-STANDARDS]
>**Dictum:** *Schema-first discipline unifies TypeScript + Effect authoring.*

<br>

This skill enforces a **single dense style** for TypeScript + Effect modules: schema-first data, tagged-union algebras, exhaustive dispatch, service capabilities grouped by purpose, and type safety derived by inference (not manual type declarations).

---
## [1][LOAD_SEQUENCE]
>**Dictum:** *Ordered loading prevents context pollution.*

<br>

1. Read **SKILL.md** for routing + constraints.
2. Load **one** reference file matching the active domain.
3. Load **one** template file only when scaffolding a new module.
4. Hold the selected pattern stable through task completion.

---
## [2][CONTRACTS]
>**Dictum:** *Structural invariants constrain all modules.*

<br>

**Hard limits**
- **≤ 225 LOC** per module. If exceeded, split by *domain boundary* (entity vs service), not by helpers.
- **No module-level type aliases.** All types are either:
  - inline at the call site (`typeof Schema.Type`, `Extract<...>`, `InstanceType<...>`), or
  - exported inside a `const+namespace` / `class+namespace` merge (types attach to a runtime symbol).

**Schema + algebra**
- **One schema source of truth** per entity (class or struct). All projections/codecs derive from it (`pick`/`omit`/`partial`/`transform`).
- **One command algebra** per domain via `Data.taggedEnum` (generic-first).
- **One failure algebra** per domain via `Data.TaggedError` (internal) or `Schema.TaggedError` (boundary).
- **No stringly errors**, no `new Error(...)`, no ad-hoc `throw`.

**Dispatch**
- **One polymorphic entrypoint** per command algebra (`$match` on the tagged enum).
- **Exhaustive by construction**: every `_tag` branch is handled (compiler-enforced).

**Control-flow discipline**
- **No imperative branching** (`if`, `switch`, `try/catch` blocks for control-flow).
- Route branching through `Match.valueTags`, `Match.value`, `Option.match`, `Either.match`, `Effect.filterOrFail`, `Effect.catchTag`.

**Services**
- **One service class maximum per module** (`Effect.Service`).
- Capabilities returned as **groups** (`{ read, write, observe } as const`).
- Methods are **traced** (`Effect.fn('Service.method')`) and return stable `Effect.Effect<_,_,_>` signatures.
- Prefer scoped constructors for resources (`acquireRelease`) and transactional state (`STM/TMap`).

---
## [3][ROUTING]
>**Dictum:** *Task type determines reference selection.*

<br>

Load exactly one reference unless the task spans multiple domains.

| [INDEX] | [TASK]                          | [MANDATORY]               | [TEMPLATE]                   |
| :-----: | ------------------------------- | ------------------------- | ---------------------------- |
|   [1]   | Scaffold entity module          | `objects.md` `errors.md`  | `entity.module.template.md`  |
|   [2]   | Scaffold service module         | `services.md`             | `service.module.template.md` |
|   [3]   | Scaffold utility module         | `types.md`                | `utility.module.template.md` |
|   [4]   | Add/refactor dispatch logic     | `matching.md`             | —                            |
|   [5]   | Add/refactor error algebra      | `errors.md`               | —                            |
|   [6]   | Add/refactor type organization  | `types.md`                | —                            |
|   [7]   | Review or audit existing module | `validation.md`           | —                            |
|   [8]   | Boundary collapse (HTTP/RPC)    | `errors.md` `matching.md` | —                            |

---
## [4][DECISION_TREES]
>**Dictum:** *Route decisions before loading references.*

<br>

**Schema family**

| [DATA_SHAPE]                             | [USE]             | [NOT]            |
| ---------------------------------------- | ----------------- | ---------------- |
| Plain data, no union membership          | `S.Class`         | `S.TaggedClass`  |
| Union member (current or future)         | `S.TaggedClass`   | `S.Class`        |
| Request/response contract with cache key | `S.TaggedRequest` | `S.TaggedClass`  |
| Two representations (wire vs domain)     | `S.transform`     | manual mapping   |
| Recursive / mutually recursive tree      | `S.suspend`       | circular imports |

**Match API**

| [SITUATION]                                  | [USE]             | [NOT]            |
| -------------------------------------------- | ----------------- | ---------------- |
| `Data.taggedEnum` — especially with generics | `$match`          | `Match.type`     |
| `S.TaggedClass` / `S.TaggedError` union      | `Match.valueTags` | `$match`         |
| Branches return Effects or need pipeline     | `Match.type`      | `$match`         |
| Non-tagged structural / compound conditions  | `Match.value`     | `Match.type`     |
| Type guard for `.filter` / `filterOrFail`    | `$is`             | manual predicate |

**Service constructor mode**

| [SERVICE_NEEDS]                             | [MODE]    |
| ------------------------------------------- | --------- |
| No deps, no lifecycle, pure values          | `succeed` |
| Yields other services, no managed resources | `effect`  |
| Connections, caches, streams, finalizers    | `scoped`  |

**Module archetype**

| [WHAT_YOU_ARE_BUILDING]                        | [ARCHETYPE] |
| ---------------------------------------------- | ----------- |
| Entity with schema + command + failure algebra | Entity      |
| Managed resource with capability groups        | Service     |
| Pure `A -> B` functions + traced pipelines     | Utility     |

---
## [5][ANTI_PATTERNS]
>**Dictum:** *Expert knowledge is knowing which landmines to avoid.*

<br>

**NEVER** define `S.TaggedRequest` at module level for scoped services — the class must capture closure dependencies from the scoped generator. Module-level placement breaks the closure; the request type cannot reference the acquired resource.

**NEVER** use `Match.type<Op<A, B>>()` for generic `Data.taggedEnum` — requires re-specifying generic parameters at every call site. `$match` inherits generics from the constructor automatically.

**NEVER** forward-reference class statics from the `extends` clause — TypeScript evaluates the extends clause before the class body exists. Place factories and config at module level with `_` prefix (e.g., `_makeKv`, `_redisConfig`).

**NEVER** mix `within()` and `withinSync()` in the same request path when using multi-tenant isolation — breaks tenant context propagation. In tenant-isolated systems, async routes (WebSocket, events, job subscriptions) use `within()`; DB-scoped routes and `Client.tenant.with()` use `withinSync()`.

**NEVER** use `Effect.catchAll` to silently swallow cache failures — this masks data corruption. Distinguish "key absent" (`Option.none`) from "deserialization failed" (tagged error with cause). Log or propagate the decode failure.

**NEVER** place `as const` on individual method definitions inside a scoped constructor — apply it once on the return object literal. Scattering `as const` across method bindings does not propagate to the capability group; the final return is what consumers see.

**NEVER** define boundary errors (`Schema.TaggedError`) without static factory methods (`of` / `from`) — callers should not construct schema payloads directly. Factories encapsulate defaults (e.g., `Option.fromNullable(id)` for optional message fields).

**NEVER** use `Effect.all({ concurrency: 'unbounded' })` for database queries — exhausts the connection pool under load. Use bounded concurrency matching your database connection pool size (e.g., `{ concurrency: N }` where N is typically 4–16 depending on pool and hardware), `Semaphore` for explicit in-flight query permits tied to available connections, `Effect.withConcurrency(N)` for inherited limits, or `Stream.groupedWithin` for batched processing.

---
## [6][TEMPLATES]
>**Dictum:** *Scaffolds enforce structural compliance from first line.*

<br>

- **Entity module (entity-centric)** — `entity.module.template.md`
- **Service module (capability-centric)** — `service.module.template.md`
- **Utility module (pure functions)** — `utility.module.template.md`
