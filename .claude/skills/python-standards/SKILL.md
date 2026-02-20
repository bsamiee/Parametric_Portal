---
name: python-standards
description: >-
  Sole authority on Python style, type discipline, error handling, concurrency,
  and module organization in this workspace. MUST be loaded for every Python
  code interaction. Use when performing ANY Python-related task:
  (1) writing, editing, creating, reviewing, refactoring, or debugging any
  .py/.pyi module or Python script;
  (2) defining domain models, Pydantic frozen models or settings, typed atoms,
  discriminated unions, or railway pipelines with returns/expression;
  (3) implementing Protocol-driven services, infrastructure adapters, CLI tools,
  or structured concurrency with anyio;
  (4) building API endpoints, httpx client adapters, or serialization boundaries
  with msgspec/Pydantic;
  (5) configuring pyproject.toml, ruff rules, mypy/ty settings, or working with
  structlog, beartype, polars, or any Python library in this monorepo;
  (6) writing or editing pytest tests, conftest.py fixtures, hypothesis
  property tests, or test configuration.
---

# [H1][PYTHON-STANDARDS]
>**Dictum:** *Functional discipline unifies Python 3.14+ authoring with returns ROP, expression structures, Protocol-first DI, and immutable Pydantic models.*

<br>

This skill enforces one dense style for Python 3.14+ modules: typed atoms via `NewType`/`Annotated` smart constructors, frozen Pydantic models, exhaustive `match/case` variant dispatch, railway pipelines with pointfree combinators, `expression` structures for domain models and computational effects, Protocol-first DI via reader monads, ParamSpec-preserving decorators, and fused structlog + OpenTelemetry observability.

---
## [1][BEHAVIOR]
>**Dictum:** *Constraints govern all Python modules and template outputs.*

<br>

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
## [2][CONTRACTS]
>**Dictum:** *Structural invariants constrain all modules.*

<br>

**Type discipline**
- [ALWAYS] typed atoms + total smart constructors (`Result`, not raises). See `types.md` [1].
- [ALWAYS] frozen object carriers (`BaseModel`/dataclass with `frozen=True`). See `types.md` [3].
- [ALWAYS] discriminated unions via `Discriminator` + `Tag` or `expression.@tagged_union`. See `types.md` [2].
- [NEVER] mutable collections in domain model fields; use `tuple[T, ...]` or `expression.Block[T]`.

**Effect discipline**
- [ALWAYS] compose with `flow` + pointfree combinators (`bind`, `map_`, `lash`, `alt`). See `effects.md` [1].
- [ALWAYS] keep Result extraction at terminal boundary only. See `effects.md` [3].
- [ALWAYS] use `@effect.result` generators for complex branching compositions. See `effects.md` [5].
- [NEVER] nested `Result[Result[...], ...]` from missing `bind`.

**Decorator discipline**
- [ALWAYS] signature-preserving decorators with `ParamSpec`. See `decorators.md` [1].
- [ALWAYS] canonical ordering: trace > retry > cache > validate > authorize. See `decorators.md` [2].
- [NEVER] god decorators or mutable closure state.

**Concurrency discipline**
- [ALWAYS] `anyio.create_task_group()` for spawning. See `concurrency.md` [1].
- [ALWAYS] explicit deadlines (`CancelScope`) and cooperative checkpoints.
- [ALWAYS] handle `ExceptionGroup` via `except*` at group boundaries. See `concurrency.md` [4].
- [NEVER] unbounded concurrency or global mutable singletons.

**Surface quality**
- [ALWAYS] one canonical schema per entity; derive projections at call sites.
- [ALWAYS] comments explain why, not what.
- [NEVER] framework types in domain/ops layers.

---
## [3][LOAD_SEQUENCE]
>**Dictum:** *Load foundation first, then core, then targeted specialization.*

<br>

Load order is strict; keep loaded references active through task completion.

| [INDEX] | [PHASE]     | [REFERENCE]                   | [FOCUS]                                                        |
| :-----: | ----------- | ----------------------------- | -------------------------------------------------------------- |
|   [1]   | Foundation  | `validation.md`               | Compliance checklist and audit gates                           |
|   [2]   | Foundation  | `patterns.md`                 | Anti-pattern codex and detection heuristics                    |
|   [3]   | Core        | `types.md`                    | Typed atoms, frozen models, discriminated unions, tagged_union |
|   [4]   | Core        | `effects.md`                  | Result/Maybe/FutureResult/IO, reader monads, @effect           |
|   [5]   | Core        | `decorators.md`               | ParamSpec algebra, class instrumentation, ordering             |
|   [6]   | Specialized | `protocols.md`                | Protocol ports, adapter boundaries, structural runtime checks  |
|   [7]   | Specialized | `concurrency.md`              | TaskGroup/CancelScope, `except*`, free-threading safety        |
|   [8]   | Specialized | `observability.md`            | Fused traces/logs/metrics, context propagation, RED metrics    |
|   [9]   | Specialized | `serialization.md`            | Pydantic ingress, msgspec egress, settings, serializer hooks   |
|  [10]   | Specialized | `algorithms.md`               | Recursion, folds, dispatch, pipeline composition               |
|  [11]   | Specialized | `performance.md`              | Memory, CPython internals, profiling                           |
|  [12]   | Template    | `domain-module.template.md`   | Domain scaffolding                                             |
|  [13]   | Template    | `pipeline-module.template.md` | Pipeline scaffolding                                           |
|  [14]   | Template    | `service-module.template.md`  | Service scaffolding                                            |
|  [15]   | Template    | `api-module.template.md`      | API scaffolding                                                |
|  [16]   | Template    | `adapter-module.template.md`  | Adapter scaffolding                                            |

---
## [4][ROUTING]
>**Dictum:** *Foundation and core load unconditionally; routing selects specialization and templates.*

<br>

The routing table selects specialized references and templates to add beyond foundation and core.

| [INDEX] | [TASK_SHAPE]              | [ADD_SPECIALIZED]                       | [SCAFFOLD]                    |
| :-----: | ------------------------- | --------------------------------------- | ----------------------------- |
|   [1]   | Domain model, atom, union | --                                      | `domain-module.template.md`   |
|   [2]   | Railway pipeline          | --                                      | `pipeline-module.template.md` |
|   [3]   | Protocol-driven service   | `protocols.md`                          | `service-module.template.md`  |
|   [4]   | API boundary              | `serialization.md` + `observability.md` | `api-module.template.md`      |
|   [5]   | Infrastructure adapter    | `protocols.md` + `concurrency.md`       | `adapter-module.template.md`  |
|   [6]   | Concurrency refactor      | `concurrency.md`                        | --                            |
|   [7]   | Telemetry refactor        | `observability.md`                      | --                            |
|   [8]   | Serialization refactor    | `serialization.md`                      | --                            |
|   [9]   | Algorithm/fold implement. | `algorithms.md`                         | --                            |
|  [10]   | Performance optimization  | `performance.md`                        | --                            |
|  [11]   | Review-only audit         | References only                         | --                            |

---
## [5][DECISION_TREES]
>**Dictum:** *Choose encodings by failure mode, object shape, and execution context.*

<br>

**Type family** -- select the encoding that makes illegal states unrepresentable.

| [INDEX] | [DATA_SHAPE]            | [USE]                                      | [KEY_TRAIT]                    |
| :-----: | ----------------------- | ------------------------------------------ | ------------------------------ |
|   [1]   | Opaque scalar           | `NewType` (zero runtime)                   | Alias-level nominal typing     |
|   [2]   | Constrained scalar      | `Annotated` + `core_schema/constraints`    | Validation at construction     |
|   [3]   | Rich invariant object   | `BaseModel(frozen=True)` + validators      | Pydantic v2 auto-serialization |
|   [4]   | Closed variant space    | `@tagged_union` / `Annotated[Union, Disc]` | Exhaustive match/case dispatch |
|   [5]   | Open extension dispatch | `singledispatch` + `Protocol`              | Additive without source change |
|   [6]   | Frozen collection       | `expression.Block[T]` / `Map[K,V]`         | Structural sharing, Pydantic   |

**Error/effect channel** -- match the effect type to the failure mode.

| [INDEX] | [FAILURE_SHAPE]   | [USE]                                     | [KEY_TRAIT]                       |
| :-----: | ----------------- | ----------------------------------------- | --------------------------------- |
|   [1]   | Sync fallible     | `Result[T, E]`                            | `bind`/`map_` chain               |
|   [2]   | Absence-only      | `Maybe[T]` / `expression.Option[T]`       | `Some`/`Nothing` match            |
|   [3]   | Async fallible    | `FutureResult[T, E]`                      | `@future_safe` boundary decorator |
|   [4]   | Sync DI           | `RequiresContextResult[T, E, Deps]`       | Reader monad typed environment    |
|   [5]   | Async DI          | `RequiresContextFutureResult[T, E, Deps]` | Async reader monad                |
|   [6]   | Sync boundary     | `IO[T]`                                   | Purity tracking for side effects  |
|   [7]   | Complex branching | `@effect.result` generator                | Full control flow in monadic ctx  |

**Module archetype** -- determines which template to scaffold.

| [INDEX] | [WHAT_YOU_ARE_BUILDING]                   | [ARCHETYPE] | [TEMPLATE]                    |
| :-----: | ----------------------------------------- | ----------- | ----------------------------- |
|   [1]   | Types + validators + frozen models        | Domain      | `domain-module.template.md`   |
|   [2]   | Railway pipelines + flow + error tracks   | Pipeline    | `pipeline-module.template.md` |
|   [3]   | Protocol-driven service + reader DI       | Service     | `service-module.template.md`  |
|   [4]   | HTTP boundary + Pydantic ingress/egress   | API         | `api-module.template.md`      |
|   [5]   | Protocol adapter + `@future_safe` + anyio | Adapter     | `adapter-module.template.md`  |

---
## [6][ANTI_PATTERNS]
>**Dictum:** *Expert knowledge is knowing which landmines to avoid.*

<br>

See `patterns.md` for the full codex with detection heuristics and corrected forms.

- **Type-system** -- `Any`/`cast` erasure, bare primitives, mutable model fields, `hasattr`/`getattr` over structural match.
- **Control-flow** -- imperative branching, bare `try/except`, `raise` for control flow, mid-pipeline `unwrap`, boolean-match abuse.
- **Surface-area** -- god decorators, helper/utility files, map-side-effect abuse, missing checkpoints.
- **Library-mixing** -- mixed `expression.Result` + `returns.Result` in same module, `expression.pipe` in `returns.flow` pipelines.

---
## [7][TEMPLATES]
>**Dictum:** *Scaffolds enforce structural compliance from first line.*

<br>

- **Domain module** (`domain-module.template.md`) -- typed atoms, frozen Pydantic models, `@tagged_union` discriminated unions, `expression.Option[T]`/`Block[T]` as model fields. Start here for any entity or value object.
- **Pipeline module** (`pipeline-module.template.md`) -- `returns.flow()` + pointfree ROP chains, `@effect.result` generators for complex branching, bridge functions at layer boundaries. Start here for any data transformation pipeline.
- **Service module** (`service-module.template.md`) -- Protocol-driven ports, `RequiresContextResult` DI, `expression.Seq` for lazy collection operations. Start here for any domain service with injected dependencies.
- **API module** (`api-module.template.md`) -- Pydantic ingress/egress, `expression.Option[T]`/`Result[T, E]` response fields with auto-serialization, boundary bridge from returns to expression. Start here for any HTTP endpoint.
- **Adapter module** (`adapter-module.template.md`) -- Protocol satisfaction, `@future_safe` boundaries, anyio structured concurrency, `CapacityLimiter` backpressure, fused telemetry. Start here for any infrastructure adapter (repos, HTTP clients, caches).

---
## [8][LIBRARY_CONVENTIONS]
>**Dictum:** *returns owns pipelines; expression owns structures. The split is architectural.*

<br>

**Canonical split:**

| [INDEX] | [LAYER]              | [LIBRARY]    | [RATIONALE]                                                        |
| :-----: | -------------------- | ------------ | ------------------------------------------------------------------ |
|   [1]   | Domain models        | `expression` | `Option`/`Result` Pydantic-compat; `@tagged_union`; `Block`/`Map`  |
|   [2]   | Pipelines / ROP      | `returns`    | `flow` + `bind`/`map_`/`lash`/`alt`; `@safe`/`@future_safe`        |
|   [3]   | Complex branching    | `expression` | `@effect.result`/`@effect.option` generator monadic comprehension  |
|   [4]   | Dependency injection | `returns`    | `RequiresContextResult`/`RequiresContextFutureResult` reader monad |
|   [5]   | Parser / DSL         | `expression` | `expression.extra.parser` combinator library                       |
|   [6]   | Immutable colls      | `expression` | `Block[T]`, `Map[K,V]`, `Seq[T]` (30+ combinators), `AsyncSeq[T]`  |
|   [7]   | Concurrency actors   | `expression` | `MailboxProcessor[Msg]` typed message passing                      |
|   [8]   | Async orchestration  | `returns`    | `FutureResult` + `@future_safe` + anyio integration                |

**Integration rules:**
1. ONE library's `Result`/`Option` per module -- never mix `expression.Ok` with `returns.Success` in same file.
2. Domain models use expression types (Pydantic-compatible); pipeline modules use returns types.
3. Bridge functions at layer boundaries via `match/case` destructuring.
4. `expression.pipe(val, *fns)` = `returns.flow(val, *fns)` -- use `flow` in pipeline modules, `pipe` in domain/collection modules.
5. `@effect.result` generators for complex branching; `flow()` + pointfree for linear pipelines.
6. `@tagged_union` replaces manual frozen dataclass union hierarchies.

**Import convention:** `from expression import Option, Some, Nothing, Result, Ok, Error, tagged_union, effect` in domain modules; `from returns.result import Result, Success, Failure` / `from returns.pointfree import bind, map_` in pipeline modules.
