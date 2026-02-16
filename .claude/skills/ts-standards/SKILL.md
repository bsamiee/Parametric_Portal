---
name: ts-standards
description: >-
  ALWAYS apply when editing, reviewing, or scaffolding any .ts/.tsx file.
  Schema-first authoring with Effect; exhaustive dispatch via tagged unions;
  capability-grouped services; namespace-merged types; no branching.
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
## [3][REFERENCES]
>**Dictum:** *Domain determines reference selection.*

<br>

Load exactly one reference unless the task spans multiple domains.

- **Schema and models** — `objects.md`
- **Error algebra** — `errors.md`
- **Tagged union dispatch** — `matching.md`
- **Services and layers** — `services.md`
- **Type extraction and narrowing** — `types.md`

---
## [4][TEMPLATES]
>**Dictum:** *Scaffolds enforce structural compliance from first line.*

<br>

- **Domain module (entity-centric)** — `domain.template.md`
- **Service module (capability-centric)** — `service.template.md`
