---
name: enforcing-python
description: >-
  Enforces Python + expression style, type discipline, error handling,
  concurrency, and module organization standards.
  Use when writing, editing, reviewing, refactoring, or debugging
  .py/.pyi modules, implementing domain models, ROP pipelines,
  Protocol-driven services, or configuring pyproject.toml, ruff, or mypy.
---

# Enforcing Python

All code follows six governing principles:
- **Polymorphic** — one entrypoint per concern, generic over specific, extend over duplicate
- **Functional + ROP** — pure pipelines, typed error rails, monadic composition
- **Strongly typed** — inference-first, one canonical model per concept, zero `Any`/`cast` leakage
- **Programmatic** — variable-driven dispatch, `Literal` vocabularies, zero stringly-typed routing
- **Algorithmic** — reduce branching through transforms, folds, and discriminant-driven projection
- **AOP-driven** — cross-cutting concerns via `ParamSpec`-preserving decorator stacks, not in-method duplication


## Paradigm

- **Immutability**: `frozen=True` models, `model_copy(update=...)` transitions, `expression.Block`/`Map` collections
- **Typed error channels**: `@tagged_union` error variants for file-internal errors (never exported), shared domain error types at package level (few per system, boundary-crossing); `Result[T, E]` sync, `@effect.async_result` async
- **Exhaustive dispatch**: `match/case` on `@tagged_union` / `Annotated[Union, Discriminator]` closed domains, `singledispatch` for open extension
- **Type anchoring**: `NewType` for opaque scalars, `Annotated` + constraints for validated scalars, `BaseModel(frozen=True)` for rich objects — derive projections, never parallel models
- **Expression control flow**: `pipe` + curried projections (`result.bind`, `result.map`, `seq.filter`), `@effect.result` / `@effect.async_result` generators, zero statement branching
- **Programmatic logic**: `Literal` types for bounded vocabularies, `singledispatch` for open extension, zero stringly-typed routing
- **Surface ownership**: one polymorphic entrypoint per concern, `ParamSpec`-preserving decorators, no helpers
- **Cross-cutting composition**: decorator stacks (`trace > authorize > validate > cache > retry`), `Protocol`-first DI via `@effect.result` dependency threading


## Conventions

| Layer | Library | Owns |
|---|---|---|
| Domain models + pipelines | expression | `Option`, `Result`, `@tagged_union`, `Block`, `Map`, `Seq`, `pipe`, `compose`, `@effect.result`, `@effect.async_result`, `curry` |
| Dependency injection | Protocol + expression | Protocol-typed parameters, `@effect.result` dependency threading |
| Concurrency | anyio | `TaskGroup`, `CancelScope`, structured concurrency |
| Boundary validation | Pydantic | `BaseModel`, `TypeAdapter`, `@field_validator`, ingress/egress |


## Contracts

**Type discipline**
- `NewType` for opaque scalars, `Annotated` + constraints for validated scalars.
- `BaseModel(frozen=True)` for domain objects with smart constructors returning `Result[T, E]`.
- `@tagged_union` / `Annotated[Union, Discriminator]` for closed variant spaces.
- One canonical model per concept; derive projections, never parallel models.
- Zero `Any`/`cast()` without explicit boundary justification.
- Zero bare primitives in public signatures when typed atoms exist.
- Zero mutable collections in model fields — `tuple[T, ...]` or `expression.Block[T]`.
- Zero `class(ABC)`/`abstractmethod` — use `Protocol`.

**Control flow**
- Zero `if`/`else`/`elif` for variant dispatch — `match/case` only.
- Zero `try`/`except` in domain transforms.
- `pipe` + curried projections (`result.bind`, `result.map`) for linear pipelines.
- `@effect.result` / `@effect.async_result` generators for branching compositions.
- `.or_else_with(fn)` for error recovery at composition boundaries — never inside `@effect.result` generators.
- Boundary adapters may use required statement forms with marker: `# BOUNDARY ADAPTER — reason`.

**Error handling**
- `@tagged_union` error variants for file-internal errors — never exported, never cross module boundaries.
- Shared domain error types at package level — few per system, boundary-crossing, co-located in owning package (no dedicated error files).
- Domain error types carry polymorphic/agnostic logic reusable across all call sites.
- `Result[T, E]` sync fallible, `@effect.async_result` async fallible, `Option[T]` for absence.
- Zero `Optional[T]` for fallible returns — `Result[T, E]` or `Option[T]`.

**Decorators**
- `ParamSpec` + `Concatenate` + `@wraps` for all decorators.
- Canonical execution order (outer → inner): `trace > authorize > validate > cache > retry > operation`.
- Idempotency + double-decoration guards (`__wrapped__`/marker attr).
- Zero god decorators, zero mutable closure state, preserve `contextvars` propagation.
- Deterministic stacks — every decorator states its effect surface in code.

**Surface**
- One polymorphic entrypoint per concern.
- No helper files (`helpers.py`, `*_utils.py`) — colocate in domain module.
- No single-caller extracted functions, no one-use module-level declarations.
- `~350 LOC` scrutiny threshold — investigate for compression via polymorphism, not file splitting.

**Resources**
- `anyio.create_task_group()` for structured concurrency.
- Explicit deadlines via `CancelScope`, cooperative checkpoints.
- `except*` at TaskGroup boundaries for `ExceptionGroup` handling.
- Zero unbounded concurrency, zero global mutable singletons.


## Load sequence

**Foundation** (always):

| Reference | Focus |
|---|---|
| [validation.md](references/validation.md) | Compliance checklist and completion gate |
| [patterns.md](references/patterns.md) | Anti-pattern detection heuristics |

**Core** (always):

| Reference | Focus |
|---|---|
| [types.md](references/types.md) | Python typing, NewType, Annotated, generics |
| [objects.md](references/objects.md) | Pydantic models, tagged unions, expression structures |
| [effects.md](references/effects.md) | Result pipelines, @effect builders, ROP |
| [decorators.md](references/decorators.md) | ParamSpec algebra, ordering, composition |
| [errors.md](references/errors.md) | Error construction, tagged union hierarchies, policy |
| [transforms.md](references/transforms.md) | Compositional logic substrate — dispatch, folds, keyed ops, polymorphism, monadic composition, AOP algebra |
| [surface.md](references/surface.md) | Public API creation and refinement |

**Specialized** (load when task matches):

| Reference | Load when |
|---|---|
| [protocols.md](references/protocols.md) | Protocol ports, adapter boundaries, reader DI |
| [concurrency.md](references/concurrency.md) | TaskGroup, CancelScope, ExceptionGroup |
| [observability.md](references/observability.md) | structlog, OpenTelemetry, context propagation |
| [serialization.md](references/serialization.md) | Pydantic ingress, msgspec egress, TypeAdapter |
| [performance.md](references/performance.md) | Memory, CPython internals, profiling |

**Templates** (scaffold only):

| Template | Archetype |
|---|---|
| TBD | Templates will be defined after reference content is finalized |


## Validation gate

- Required during iteration: `pnpm py:check`.
- Required for final completion: `pnpm ts:check`, `pnpm cs:check`, `pnpm py:check`.
- Reject completion when load order, contracts, or checks are not satisfied.


## First-class libraries

These packages are standard libraries — use over stdlib equivalents.

| Package | Provides |
|---|---|
| expression | Tagged unions, Result/Option, pipe/compose, @effect builders, Block/Map/Seq, curry |
| anyio | Structured async concurrency |
| Pydantic | Frozen models, validation, serialization |
| structlog | Structured logging |
| OpenTelemetry | Distributed tracing, metrics |
| msgspec | High-performance serialization |
| httpx | Async HTTP client |
| polars | DataFrame operations |
| beartype | Runtime type checking |
| pytest | Test framework |
| hypothesis | Property-based testing |
