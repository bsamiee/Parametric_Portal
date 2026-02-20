# [H1][EFFECTS]
>**Dictum:** *Effects encode failure, absence, async work, and dependencies as types; pipelines keep control flow explicit.*

<br>

Use `returns >= 0.26` as one algebra: `Result[T, E]`, `Maybe[T]`, `FutureResult[T, E]`, `IO[T]`, `RequiresContextResult[T, E, Deps]`, and `RequiresContextFutureResult[T, E, Deps]`. Compose with `flow()`/`pipe()` plus pointfree combinators; unwrap only at the terminal boundary. Use `expression >= 5.6` computational effects (`@effect.result`, `@effect.option`) for complex branching that exceeds linear pipeline shape.

---
## [1][EFFECT_STACK]
>**Dictum:** *One railway handles sync, absence, and async failure when each stage declares the right container.*

<br>

`Result[T, E]` models expected sync failure. `Maybe[T]` models semantic absence. `FutureResult[T, E]` models async failure. `flow(value, *fns)` is eager and linear; `pipe(*fns)` builds reusable fragments; `bind` chains monadic stages, `map_` maps pure stages, `lash` remaps the error track.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from collections.abc import Callable, Mapping
from dataclasses import dataclass
import msgspec
from returns.converters import maybe_to_result
from returns.future import FutureResult, future_safe
from returns.maybe import maybe
from returns.pipeline import flow, pipe
from returns.pointfree import bind, lash, map_
from returns.result import Failure, Result, Success, safe

# --- [CLASSES] ----------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class ValidationError:
    field: str
    message: str

# --- [FUNCTIONS] --------------------------------------------------------------

@safe
def parse_json(raw: bytes) -> dict[str, object]:
    return msgspec.json.decode(raw, type=dict[str, object])

@maybe
def find_in_cache(key: str) -> int | None:
    cache: Mapping[str, int] = {"alpha": 1, "beta": 2}
    return cache.get(key)

def lookup_or_fail(key: str) -> Result[int, ValidationError]:
    """Bridge Maybe -> Result with typed absence error."""
    return maybe_to_result(
        find_in_cache(key),
        default_error=ValidationError(field="cache", message=f"missing key: {key}"),
    )

def validate_age(raw: int) -> Result[int, ValidationError]:
    match raw:
        case age if 0 < age < 150:
            return Success(age)
        case _:
            return Failure(ValidationError(field="age", message=f"out of range: {raw}"))

def classify(age: int) -> Result[str, ValidationError]:
    match age:
        case value if value >= 18:
            return Success(f"adult-{value}")
        case _:
            return Failure(ValidationError(field="age", message="must be adult"))

# -- Reusable fragment via pipe; eager execution via flow -------------------
age_pipeline: Callable[[Result[int, ValidationError]], Result[str, ValidationError]] = pipe(
    bind(validate_age), bind(classify),
)
def validate_and_classify(raw: int) -> Result[str, ValidationError]:
    return flow(raw, Success, age_pipeline)
# Error-track recovery via lash: flow(raw, validate_age, bind(classify), lash(lambda e: Success(...)))

# -- Async railway: FutureResult + bind_awaitable ---------------------------
@future_safe
async def fetch_profile(email: str) -> dict[str, str]:
    return {"email": email, "name": "User"}

@future_safe
async def persist_profile(profile: dict[str, str]) -> int:
    return 42

def async_user_pipeline(email: str) -> FutureResult[int, Exception]:
    return FutureResult.from_value(email).bind_awaitable(fetch_profile).bind_awaitable(persist_profile)
```

[CRITICAL]:
- [ALWAYS] Wrap `Result`-returning stages in `bind(...)` inside `flow(...)`.
- [ALWAYS] Use `@safe` / `@future_safe` only at foreign boundaries.
- [ALWAYS] Model absence as `Maybe`, then bridge via `maybe_to_result` when failure is required.
- [NEVER] Unwrap (`.unwrap()`, `.value_or()`, `.failure()`) before the terminal boundary.

---
## [2][CONTEXTUAL_EFFECTS]
>**Dictum:** *Reader effects thread dependencies through the same railway without globals or constructor wiring.*

<br>

`RequiresContextResult[T, E, Deps]` is `Deps -> Result[T, E]`; `RequiresContextFutureResult` is the async variant. Use `.ask()` + `.from_result()` for sync stages, `.bind_async(...)` for async, `.modify_env(...)` for narrower dependency contracts.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from typing import Protocol
from pydantic import BaseModel
from returns.context import RequiresContextFutureResult, RequiresContextResult
from returns.future import future_safe
from returns.result import Success

# --- [CLASSES] ----------------------------------------------------------------

class _RepoDeps(Protocol):
    db_url: str

class _CacheDeps(Protocol):
    cache_ttl: int

class ServiceDeps(BaseModel, frozen=True):
    db_url: str
    cache_ttl: int

# --- [FUNCTIONS] --------------------------------------------------------------

def fetch_user(user_id: int) -> RequiresContextResult[str, Exception, _RepoDeps]:
    return RequiresContextResult.ask().bind(
        lambda deps: RequiresContextResult.from_result(Success(f"user:{user_id}@{deps.db_url}"))
    )

def enrich_with_cache(label: str) -> RequiresContextResult[str, Exception, _CacheDeps]:
    return RequiresContextResult.ask().bind(
        lambda deps: RequiresContextResult.from_result(Success(f"{label}:ttl={deps.cache_ttl}"))
    )

def lookup_and_enrich(user_id: int) -> RequiresContextResult[str, Exception, ServiceDeps]:
    """Compose heterogeneous reader stages via modify_env context narrowing."""
    return (
        fetch_user(user_id)
        .modify_env(lambda deps: deps)  # ServiceDeps -> _RepoDeps
        .bind(lambda label: enrich_with_cache(label).modify_env(lambda deps: deps))
    )

@future_safe
async def fetch_from_db(user_id: int, db_url: str) -> dict[str, object]:
    return {"user_id": user_id, "db_url": db_url}

def async_lookup_user(user_id: int) -> RequiresContextFutureResult[dict[str, object], Exception, ServiceDeps]:
    return RequiresContextFutureResult.ask().bind_async(lambda deps: fetch_from_db(user_id, deps.db_url))
# Terminal: lookup_and_enrich(42)(ServiceDeps(db_url="postgres://...", cache_ttl=300))
```

[IMPORTANT]:
- [ALWAYS] Keep dependency shape explicit in the reader type parameter.
- [ALWAYS] Provide concrete deps once at the composition root.
- [NEVER] Build reader effects from raw closures when `.ask()` and constructors cover the case.

---
## [3][ERROR_ALGEBRA]
>**Dictum:** *Error unions are closed values; boundary handlers pattern-match the algebra exhaustively.*

<br>

Encode domain errors as frozen dataclass variants combined into a closed union via PEP 695 `type` alias. Structural `match/case` at boundaries exhausts the algebra. See `types.md` [2] for `@tagged_union` alternative.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from dataclasses import dataclass
from returns.result import Failure, Result, Success

# --- [CLASSES] ----------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class AtomError:
    atom: str
    message: str
@dataclass(frozen=True, slots=True)
class NotFoundError:
    entity: str
    identifier: str
@dataclass(frozen=True, slots=True)
class ConflictError:
    entity: str
    reason: str
type DomainError = AtomError | NotFoundError | ConflictError

# --- [FUNCTIONS] --------------------------------------------------------------

def handle_result(result: Result[str, DomainError]) -> str:
    """Boundary handler: structural dispatch on closed error variants."""
    match result:
        case Success(value):
            return f"OK: {value}"
        case Failure(AtomError(atom=atom, message=message)):
            return f"VALIDATION: {atom} -- {message}"
        case Failure(NotFoundError(entity=entity, identifier=identifier)):
            return f"NOT_FOUND: {entity}/{identifier}"
        case Failure(ConflictError(entity=entity, reason=reason)):
            return f"CONFLICT: {entity} -- {reason}"
```

[CRITICAL]:
- [ALWAYS] Encode domain errors as frozen variants in a closed union.
- [ALWAYS] Exhaust all variants in boundary `match/case` -- no catch-all `case _` for error dispatch.
- [NEVER] Use string parsing or `isinstance` trees when structural patterns are available.

---
## [4][BOUNDARY_IO]
>**Dictum:** *Impure operations are marked at the boundary; deep recursion is stack-safe.*

<br>

`IO[T]` marks synchronous impurity; `@impure_safe` bridges exception-raising sync IO into `IOResult`; `@trampoline` keeps deep recursion stack-safe. See `algorithms.md` [1] for extended recursion patterns.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from collections.abc import Callable
from typing import cast
from returns.io import IO, impure_safe
from returns.trampolines import Trampoline, trampoline

# --- [CONSTANTS] --------------------------------------------------------------

pure_io: IO[int] = IO.from_value(42)
greeting: IO[str] = pure_io.map(lambda value: f"Value: {value}")

# --- [FUNCTIONS] --------------------------------------------------------------

@impure_safe
def read_file(path: str) -> str:
    with open(path) as handle:
        return handle.read()

@trampoline
def factorial(number: int, accumulator: int = 1) -> int | Trampoline[int]:
    match number:
        case value if value <= 1:
            return accumulator
        case _:
            return Trampoline(cast(Callable[[int, int], int], factorial), number - 1, accumulator * number)
```

[IMPORTANT]:
- [ALWAYS] Keep IO markers and IO bridges at boundaries only.
- [ALWAYS] Use `@trampoline` for recursive functions with unbounded depth.
- [NEVER] Embed `IO` construction in domain transforms -- `IO` is a boundary concern.

---
## [5][EXPRESSION_EFFECTS]
>**Dictum:** *Computational expressions unlock full Python control flow within monadic context -- use for branching that exceeds linear pipeline shape.*

<br>

`expression >= 5.6` provides generator-based monadic comprehension via `@effect.result[T, E]()` and `@effect.option[T]()`. Generator `yield` acts as monadic bind -- short-circuiting on `Error`/`Nothing` while preserving `match/case`, loops, and early returns. Use for **complex branching**; `returns.flow()` for **linear pipelines**. See `SKILL.md` [8].

```python
# --- [IMPORTS] ----------------------------------------------------------------
from dataclasses import dataclass
from expression import Effect, Error, Option, Result, Some, effect

# --- [CLASSES] ----------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class OrderError:
    reason: str

# --- [FUNCTIONS] --------------------------------------------------------------
# Linear pipeline: flow(raw_order, parse_order, bind(validate_items), bind(calculate_total))
# Complex branching: @effect.result excels ---------------------------------
@effect.result[float, OrderError]()
def calculate_order_total(
    items: tuple[tuple[str, int, float], ...], discount_code: str | None,
) -> Effect[Result[float, OrderError]]:
    """Conditional discount, per-item validation, accumulation -- yield from = monadic bind."""
    subtotal: float = 0.0
    for name, quantity, price in items:
        validated: float = yield from validate_line_item(name, quantity, price)
        subtotal += validated
    match discount_code:
        case "HALF" if subtotal >= 100.0:
            return subtotal * 0.5
        case "HALF":
            yield from Error(OrderError(reason="HALF requires subtotal >= 100"))
        case None:
            return subtotal
        case unknown:
            yield from Error(OrderError(reason=f"unknown discount: {unknown}"))
    return subtotal  # unreachable after Error -- satisfies return type

@effect.result[float, OrderError]()
def validate_line_item(
    name: str, quantity: int, price: float,
) -> Effect[Result[float, OrderError]]:
    match quantity:
        case value if value <= 0:
            yield from Error(OrderError(reason=f"invalid quantity for {name}"))
        case _: pass
    match price:
        case value if value < 0:
            yield from Error(OrderError(reason=f"negative price for {name}"))
        case _: pass
    return quantity * price

@effect.option[str]()
def find_display_name(primary: Option[str], fallback: Option[str]) -> Effect[Option[str]]:
    """Try primary, fall back, transform -- Nothing short-circuits."""
    match primary:
        case Some(name):
            return name.upper()
        case _: pass
    name: str = yield from fallback
    return name.upper()
```

**Bridge pattern** -- convert at layer boundaries via `match/case`:

```python
# --- [IMPORTS] ----------------------------------------------------------------

from expression import Result as ExprResult, Ok, Err
from returns.result import Result as ReturnsResult, Success, Failure

# --- [FUNCTIONS] --------------------------------------------------------------

def bridge_result[T, E](expr: ExprResult[T, E]) -> ReturnsResult[T, E]:
    match expr:
        case Ok(value): return Success(value)
        case Err(error): return Failure(error)
```

[CRITICAL]:
- [ALWAYS] `@effect.result` for complex branching; `returns.flow()` for linear pipelines.
- [ALWAYS] Bridge between expression and returns via `match/case` at layer boundaries only.
- [NEVER] Mix `expression.Ok`/`Error` with `returns.Success`/`Failure` in the same module (except bridges).
- [NEVER] Use `@effect.result` for linear A -> B -> C pipelines -- `flow()` + `bind` is more readable.

---
## [6][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] `Result[T, E]` for sync failure; `FutureResult[T, E]` for async; `Maybe[T]` for absence.
- [ALWAYS] `flow(...)` for eager linear execution; `pipe(...)` for reusable stage fragments.
- [ALWAYS] `bind` for monadic stages, `map_` for pure, `lash` for error-track recovery.
- [ALWAYS] `RequiresContextResult` / `RequiresContextFutureResult` for typed DI via `.ask()`.
- [ALWAYS] `IO[T]` / `@impure_safe` at boundaries only; `@trampoline` for stack-safe recursion.
- [ALWAYS] Closed frozen variant unions for domain error algebras. See `types.md` [2].
- [ALWAYS] `@effect.result` for complex branching; bridge via `match/case` at boundaries.
- [NEVER] `try/except` in domain pipelines -- only at foreign-boundary bridges.
- [NEVER] Container unwrap mid-pipeline (`.unwrap()`, `.value_or()`, `.failure()`).
- [NEVER] Mix expression and returns Result/Option types in the same module.

---
## [7][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                     | [WHEN]                          | [KEY_TRAIT]                                  |
| :-----: | ----------------------------- | ------------------------------- | -------------------------------------------- |
|   [1]   | `Result[T, E]`                | Sync fallible operation         | `bind`/`map_` chain + `Success`/`Failure`    |
|   [2]   | `Maybe[T]`                    | Absence-only channel            | `maybe_to_result` bridge when failure needed |
|   [3]   | `FutureResult[T, E]`          | Async fallible operation        | `@future_safe` + `bind_awaitable`            |
|   [4]   | `flow(...)` / `pipe(...)`     | Linear pipeline composition     | `flow` eager; `pipe` reusable fragment       |
|   [5]   | `bind` / `map_` / `lash`      | Stage combinators               | Monadic / pure / error-track recovery        |
|   [6]   | `RequiresContextResult`       | Sync typed DI                   | `Deps -> Result[T, E]` + `.ask()`            |
|   [7]   | `RequiresContextFutureResult` | Async typed DI                  | `Deps -> FutureResult[T, E]`                 |
|   [8]   | `IO[T]` / `@impure_safe`      | Boundary sync effects           | Purity marker + safe capture                 |
|   [9]   | `@trampoline`                 | Stack-safe deep recursion       | Continuation-passing via `Trampoline`        |
|  [10]   | `@effect.result[T, E]()`      | Complex branching composition   | Generator `yield from` as monadic bind       |
|  [11]   | `@effect.option[T]()`         | Absence-aware branching         | `Nothing` short-circuits generator           |
|  [12]   | Closed error union            | Domain error algebra            | PEP 695 `type` alias + `match/case`          |
|  [13]   | Bridge function               | expression <-> returns boundary | `match/case` destructure + re-wrap           |
