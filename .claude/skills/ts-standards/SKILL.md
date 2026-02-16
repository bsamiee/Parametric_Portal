---
name: ts-standards
description: >-
  ALWAYS apply when editing, reviewing, or scaffolding any .ts/.tsx file.
  Schema-first types derived from Effect Schema, exhaustive pattern matching
  via Match.type, branded primitives, capability-grouped Effect.Service,
  polymorphic tagged unions, inline type derivation, no-if policy.
---

# [H1][TS-STANDARDS]
>**Dictum:** *Schema-first discipline unifies TypeScript + Effect authoring.*

<br>

Schema-first, polymorphic authoring discipline for TypeScript 6 + Effect 3.19 modules. CLAUDE.md defines banned constructs and Effect patterns. This skill adds: structural invariants (one schema, one algebra, one service per module), polymorphic dispatch via exhaustive matching, inline type derivation from schemas, and reference patterns for schema families, error algebras, service composition, and command dispatch.

---
## [1][LOAD_SEQUENCE]
>**Dictum:** *Ordered loading prevents context pollution.*

<br>

1. Read SKILL.md for routing and constraints.
2. Load **one** reference file matching active problem domain.
3. Load **one** template file when scaffolding new module.
4. Hold selected pattern stable through task completion.

---
## [2][CONTRACTS]
>**Dictum:** *Structural invariants constrain all modules.*

<br>

- **One schema source of truth** per entity -- all projections, codecs, and types derive from it.
- **One command algebra** per domain -- `Data.taggedEnum` with exhaustive `Match` execution.
- **One failure algebra** per domain -- tagged union; never string errors or generic `Error`.
- **One service class** maximum per module -- `Effect.Service` with capability groups.
- **One polymorphic entrypoint** per command algebra -- exhaustive `Match.type` over all variants.
- **Schema-derived types only** -- `typeof XSchema.Type` at use site; never detached module-level type declarations that duplicate schema shape.
- **Effect integrated throughout** -- STM/TMap for transactional state, Schedule for resilience, HashMap/HashSet for immutable collections -- within service and domain code, not isolated sections.
- **Pipe for linear, gen for orchestration** -- `pipe()` for A->B->C transforms; `Effect.gen` only when 3+ dependent operations require intermediate bindings.
- **Data-driven dispatch** -- behavior emerges from data shape via `Match.type`/`Match.tag`; no programmatic helpers, no intermediate const spam, no utility functions.

---
## [3][REFERENCES]
>**Dictum:** *Domain determines reference selection.*

<br>

*Selection:* Schema shapes and codec derivation load `objects.md`. Type extraction across boundaries loads `types.md`. Error design loads `errors.md`. Command algebras and pattern dispatch load `matching.md`. Service implementation, composition, and layers load `services.md`.

*Boundary:* `objects.md` defines data. `types.md` extracts types from that data. `matching.md` dispatches behavior. `services.md` composes services and layers. `errors.md` defines failure algebras. Load one unless the task spans domains.

**Schema and models** -- [objects.md](references/objects.md)
`S.Class`, `S.TaggedClass`, `S.TaggedRequest`, branded pipelines, `pick`/`omit`/`partial` projections, `S.parseJson`/`S.transform`/`S.attachPropertySignature` codecs, `HashMap`/`HashSet` collections, `Data.struct`, `Array` module transforms.
**Error algebra** -- [errors.md](references/errors.md)
`Data.TaggedError` vs `S.TaggedError`, yieldable errors, `HttpApiSchema.annotations`, `static of`/`from` factories, boundary collapse via `Match.tag`, selective recovery via `Effect.catchTag`.
**Pattern matching and dispatch** -- [matching.md](references/matching.md)
`Data.taggedEnum`, `$match`/`$is`, `Match.type`/`Match.value`/`Match.valueTags`, exhaustive and structural dispatch, `Data.TaggedEnum.WithGenerics`, generic type propagation, companion objects with namespace merge.
**Service implementation** -- [services.md](references/services.md)
`Effect.Service` constructor modes, scoped constructors with STM/TMap state, dual-mode service access, generic static methods, Schedule retry, Stream+Sink batch processing, `Layer.mergeAll`/`Layer.provideMerge`, composition root, test overrides.
**Type extraction and narrowing** -- [types.md](references/types.md)
`typeof XSchema.Type` inline derivation, `const+namespace` merge, `Extract` narrowing, `<const T>` type parameters, constructor map inference, `HashMap` type extractors.

---
## [4][TEMPLATES]
>**Dictum:** *Scaffolds enforce structural compliance from first line.*

<br>

**Domain module** (entity-centric) -- [domain.template.md](templates/domain.template.md)
Schema class, command algebra, failure algebra, projections, codec family, polymorphic `run` entrypoint, namespace types.
**Service module** (capability-centric) -- [service.template.md](templates/service.template.md)
Entity schema, command algebra, dependency tag, `Effect.Service` class with grouped capabilities, layer composition root.
