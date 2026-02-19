---
name: python-standards
description: >-
  Enforce pure functional Python 3.14+ standards with returns ROP,
  Protocol-first DI, Pydantic frozen models, match/case exhaustive dispatch,
  typed atoms via NewType/Annotated, ParamSpec decorator algebra,
  structured observability via structlog + OTel, and anyio structured concurrency.
  Use when editing, creating, reviewing, or refactoring any .py module,
  implementing domain services, defining typed atoms, composing railway
  pipelines, or applying functional programming standards to Python code.
---

# [H1][PYTHON-STANDARDS]
>**Dictum:** *Functional discipline unifies Python 3.14+ authoring with returns ROP, Protocol-first DI, and immutable Pydantic models.*

This skill enforces one dense style for Python 3.14+ modules: typed atoms via `NewType`/`Annotated` smart constructors, frozen Pydantic models, exhaustive `match/case` variant dispatch, railway pipelines with pointfree combinators, Protocol-first DI via reader monads, ParamSpec-preserving decorators, and fused structlog + OpenTelemetry observability.

---
## [1][BEHAVIOR]
>**Dictum:** *Constraints govern all Python modules and template outputs.*

[CRITICAL]:
- [NEVER] `if`/`else`/`elif` for variant dispatch; use structural `match/case`.
- [NEVER] `try/except` in domain transforms.
- [NEVER] `class(ABC)`/`abstractmethod`; use `Protocol`.
- [NEVER] bare primitives in public signatures when typed atoms exist.
- [NEVER] `Any`/`cast()` without explicit boundary justification.
- [NEVER] `Optional[T]` for fallible returns; use `Result[T, E]` or `Maybe[T]`.
- [NEVER] helper utility files (`helpers.py`, `*_utils.py`); colocate logic in domain module.

[BOUNDARY_EXCEPTIONS]:
- [ALLOW] `try/except get_cancelled_exc_class(): raise` inside anyio cancellation boundaries.
- [ALLOW] value-or-raise adapters required by Pydantic `core_schema` and msgspec hooks.
- [ALLOW] `except*` at TaskGroup boundaries for `ExceptionGroup` handling.

[IMPORTANT]:
- [ALWAYS] Return `Result[T, E]` for fallible sync operations; `FutureResult[T, E]` for async fallible operations.
- [ALWAYS] Use `flow(value, ...)` for eager pipelines and `pipe(...)` for reusable fragments.
- [ALWAYS] Wrap every `Result`-returning stage inside `bind(...)` when composing with `flow`.
- [ALWAYS] Use `lash(...)`/`alt(...)` for error-track transforms; never unwrap mid-pipeline.
- [ALWAYS] Use `ParamSpec` + `Concatenate` + `@wraps` for decorators.
- [ALWAYS] Keep models immutable (`frozen=True`); update with `model_copy(update=...)`.
- [ALWAYS] Use `TypeAdapter` at module scope for boundary validation.
- [ALWAYS] Keep loop-based side effects explicit (`for` at boundary only) and comment the boundary.

[PREFER]:
- [PREFER] guard clauses (`case value if predicate:`) over boolean-match abuse.
- [PREFER] `RequiresContextResult`/`RequiresContextFutureResult` for typed DI.
- [PREFER] `annotationlib` for annotation introspection, `TypeForm` for runtime narrowing.
- [PREFER] `singledispatch` for open extension dispatch where unions are not closed.

---
## [2][LOAD_SEQUENCE]
>**Dictum:** *Load foundation first, then core, then targeted specialization.*

Load order is strict; keep loaded references active through task completion.

| [INDEX]  | [PHASE]     | [REFERENCE]                   | [FOCUS]                                                                 |
| :------: | ----------- | ----------------------------- | ----------------------------------------------------------------------- |
| **[1]**  | Foundation  | `validation.md`               | Compliance checklist and audit gates                                    |
| **[2]**  | Foundation  | `patterns.md`                 | Anti-pattern codex and detection heuristics                             |
| **[3]**  | Core        | `types.md`                    | Typed atoms, frozen models, discriminated unions, Pydantic object hooks |
| **[4]**  | Core        | `effects.md`                  | Result/Maybe/FutureResult/IO composition and reader monads              |
| **[5]**  | Core        | `decorators.md`               | ParamSpec algebra, class instrumentation, ordering validation           |
| **[6]**  | Specialized | `protocols.md`                | Protocol ports, adapter boundaries, structural runtime checks           |
| **[7]**  | Specialized | `concurrency.md`              | TaskGroup/CancelScope algebra, `except*`, free-threading safety         |
| **[8]**  | Specialized | `observability.md`            | Fused traces/logs/metrics and context propagation                       |
| **[9]**  | Specialized | `serialization.md`            | Pydantic ingress, msgspec egress, settings, serializer hooks            |
| **[10]** | Template    | `domain-module.template.md`   | Domain scaffolding                                                      |
| **[11]** | Template    | `pipeline-module.template.md` | Pipeline scaffolding                                                    |
| **[12]** | Template    | `service-module.template.md`  | Service scaffolding                                                     |
| **[13]** | Template    | `api-module.template.md`      | API scaffolding                                                         |

---
## [3][ROUTING]
>**Dictum:** *Routing selects focused references and scaffold type.*

| [INDEX] | [TASK_SHAPE]              | [LOAD]                                         | [SCAFFOLD]                    |
| :-----: | ------------------------- | ---------------------------------------------- | ----------------------------- |
|   [1]   | Domain model, atom, union | Core only                                      | `domain-module.template.md`   |
|   [2]   | Railway pipeline          | Core only                                      | `pipeline-module.template.md` |
|   [3]   | Protocol-driven service   | Core + `protocols.md`                          | `service-module.template.md`  |
|   [4]   | API boundary              | Core + `serialization.md` + `observability.md` | `api-module.template.md`      |
|   [5]   | Concurrency refactor      | Core + `concurrency.md`                        | None                          |
|   [6]   | Telemetry refactor        | Core + `observability.md`                      | None                          |
|   [7]   | Serialization refactor    | Core + `serialization.md`                      | None                          |
|   [8]   | Review-only audit         | References only                                | None                          |

---
## [4][DECISION_TREES]
>**Dictum:** *Choose encodings by failure mode, object shape, and execution context.*

Type family decisions:
- Opaque scalar (`id`, `token`): `NewType` (zero runtime overhead).
- Constrained scalar (`email`, `slug`): `Annotated[..., core_schema/constraints]`.
- Rich invariant object: `BaseModel(frozen=True)` with validators/serializers.
- Closed variant space: `Annotated[Union[...], Discriminator(...)]`.
- Open extension dispatch: `singledispatch` + `Protocol`.
- Runtime narrowing: `TypeForm` + `beartype`/`TypeAdapter`.

Error/effect channel decisions:
- Sync fallible: `Result[T, E]`.
- Absence-only: `Maybe[T]`.
- Async fallible: `FutureResult[T, E]`.
- Sync DI: `RequiresContextResult[T, E, Deps]`.
- Async DI: `RequiresContextFutureResult[T, E, Deps]`.
- Sync boundary effect: `IO[T]`.

Pydantic object stack decisions:
- Field invariants: `Annotated[...]`, `StringConstraints`, `Field(...)`.
- Cross-field rules: `@model_validator(mode=\"after\")`.
- Inbound aliasing: `AliasChoices`, `AliasPath`.
- Outbound shape control: `@field_serializer`, `@model_serializer(mode=\"wrap\")`.
- Functional updates: `model_copy(update=...)`.

---
## [5][CONSTRAINTS]
>**Dictum:** *Reference-level rules collapse into a compact operational contract.*

**Type Integrity** (`types.md`)
- [ALWAYS] typed atoms + total smart constructors (`Result`, not raises).
- [ALWAYS] frozen object carriers (`BaseModel`/dataclass with `frozen=True`).
- [ALWAYS] discriminated unions via `Discriminator` + `Tag`.
- [NEVER] mutable collections in domain model fields.

**Effect Integrity** (`effects.md`)
- [ALWAYS] compose with `flow` + pointfree combinators (`bind`, `map_`, `lash`, `alt`).
- [ALWAYS] keep Result extraction at terminal boundary only.
- [NEVER] nested `Result[Result[...], ...]` from missing `bind`.

**Decorator Integrity** (`decorators.md`)
- [ALWAYS] signature-preserving decorators with `ParamSpec`.
- [ALWAYS] canonical ordering: trace > retry > cache > validate > authorize.
- [NEVER] god decorators or mutable closure state.

**Concurrency Integrity** (`concurrency.md`)
- [ALWAYS] `anyio.create_task_group()` for spawning.
- [ALWAYS] explicit deadlines (`CancelScope`) and cooperative checkpoints.
- [ALWAYS] handle `ExceptionGroup` via `except*` at group boundaries.
- [NEVER] unbounded concurrency or global mutable singletons.

**Surface Quality**
- [ALWAYS] one canonical schema per entity; derive projections at call sites.
- [ALWAYS] comments explain why, not what.
- [NEVER] framework types in domain/ops layers.

---
## [6][QUICK_REFERENCE]
>**Dictum:** *Use focused docs, not broad scans.*

- `validation.md`: final audit and compliance gate.
- `patterns.md`: anti-pattern detection and refactor planning.
- `types.md`: atoms, models, unions, and Pydantic object design.
- `effects.md`: pipeline composition and effect-channel architecture.
- `decorators.md`: decorator factories, class instrumentation, ordering.
- `protocols.md`: Protocol contracts, typed DI, runtime structural checks.
- `concurrency.md`: task orchestration, cancellation, free-threading safety.
- `observability.md`: telemetry fusion and correlation propagation.
- `serialization.md`: ingress validation, egress encoding, settings.
