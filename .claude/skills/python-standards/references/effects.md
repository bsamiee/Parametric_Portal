# [H1][EFFECTS]
>**Dictum:** *Effects encode failure, absence, async work, and dependencies as types; pipelines keep control flow explicit.*

Use `returns >= 0.26` as one algebra: `Result[T, E]`, `Maybe[T]`, `FutureResult[T, E]`, `IO[T]`, `RequiresContextResult[T, E, Deps]`, and `RequiresContextFutureResult[T, E, Deps]`. Compose with `flow()`/`pipe()` plus pointfree combinators; unwrap only at the terminal boundary.

---
## [1][EFFECT_STACK]
>**Dictum:** *One railway handles sync, absence, and async failure when each stage declares the right container.*

`Result[T, E]` models expected sync failure. `Maybe[T]` models semantic absence. `FutureResult[T, E]` models async failure. `flow(value, *fns)` is eager and linear; `pipe(*fns)` builds reusable fragments; `bind` chains monadic stages, `map_` maps pure stages, `lash` remaps the error track.

```python
# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Callable, Mapping
from dataclasses import dataclass

import msgspec
from returns.converters import maybe_to_result
from returns.future import FutureResult, future_safe
from returns.maybe import maybe
from returns.pipeline import flow, pipe
from returns.pointfree import bind, lash, map_
from returns.result import Failure, Result, Success, safe

# --- [CODE] ----------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class ValidationError:
    field: str
    message: str

# -- Foreign boundary: exceptions -> Result ---------------------------------
@safe
def parse_json(raw: bytes) -> dict[str, object]:
    return msgspec.json.decode(raw, type=dict[str, object])

# -- Semantic absence: None -> Maybe ----------------------------------------
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

# -- Domain stages: explicit Success/Failure --------------------------------
def validate_age(raw: int) -> Result[int, ValidationError]:
    match raw:
        case n if 0 < n < 150:
            return Success(n)
        case _:
            return Failure(ValidationError(field="age", message=f"out of range: {raw}"))

def classify(age: int) -> Result[str, ValidationError]:
    match age:
        case n if n >= 18:
            return Success(f"adult-{n}")
        case _:
            return Failure(ValidationError(field="age", message="must be adult"))

# -- Reusable fragment: compose once, reuse in multiple flows ---------------
age_pipeline: Callable[[Result[int, ValidationError]], Result[str, ValidationError]] = pipe(
    bind(validate_age),
    bind(classify),
)

def validate_and_classify(raw: int) -> Result[str, ValidationError]:
    """Eager flow with reusable pipe fragment."""
    return flow(raw, Success, age_pipeline)

def validate_with_recovery(raw: int) -> Result[str, ValidationError]:
    """Error-track recovery stays inside the railway via lash."""
    return flow(
        raw,
        validate_age,
        bind(classify),
        lash(lambda err: Success(f"fallback:{err.field}")),
    )

def parse_enrich_classify(raw: bytes) -> Result[str, Exception | ValidationError]:
    """Mixed stage shapes: @safe boundary + pure map + Result binds."""
    return flow(
        raw,
        parse_json,
        map_(lambda data: int(data["age"])),
        bind(validate_age),
        bind(classify),
    )

# -- Async railway: FutureResult + bind_awaitable ---------------------------
@future_safe
async def fetch_profile(email: str) -> dict[str, str]:
    return {"email": email, "name": "User"}

@future_safe
async def persist_profile(profile: dict[str, str]) -> int:
    return 42

def async_user_pipeline(email: str) -> FutureResult[int, Exception]:
    return (
        FutureResult.from_value(email)
        .bind_awaitable(fetch_profile)
        .bind_awaitable(persist_profile)
    )
```

[CRITICAL]:
- [ALWAYS] Wrap `Result`-returning stages in `bind(...)` inside `flow(...)`.
- [ALWAYS] Use `@safe` / `@future_safe` only at foreign boundaries.
- [ALWAYS] Model absence as `Maybe`, then bridge via `maybe_to_result` when failure is required.
- [NEVER] Unwrap (`.unwrap()`, `.value_or()`, `.failure()`) before the terminal boundary.

---
## [2][CONTEXTUAL_EFFECTS]
>**Dictum:** *Reader effects thread dependencies through the same railway without globals or constructor wiring.*

`RequiresContextResult[T, E, Deps]` is `Deps -> Result[T, E]`. `RequiresContextFutureResult[T, E, Deps]` is `Deps -> FutureResult[T, E]`. Use `.ask()` + `.from_result()` for sync reader stages, `.bind_async(...)` for async stages, and `.modify_env(...)` to compose stages needing narrower dependency contracts.

```python
# --- [IMPORTS] -------------------------------------------------------------
from typing import Protocol

from pydantic import BaseModel
from returns.context import RequiresContextFutureResult, RequiresContextResult
from returns.future import future_safe
from returns.result import Result, Success

# --- [CODE] ----------------------------------------------------------------

class _RepoDeps(Protocol):
    db_url: str

class _CacheDeps(Protocol):
    cache_ttl: int

class ServiceDeps(BaseModel, frozen=True):
    db_url: str
    cache_ttl: int

def fetch_user(user_id: int) -> RequiresContextResult[str, Exception, _RepoDeps]:
    """ask() retrieves deps; from_result() lifts sync Result into reader context."""
    return RequiresContextResult.ask().bind(
        lambda deps: RequiresContextResult.from_result(
            Success(f"user:{user_id}@{deps.db_url}")
        )
    )

def enrich_with_cache(label: str) -> RequiresContextResult[str, Exception, _CacheDeps]:
    return RequiresContextResult.ask().bind(
        lambda deps: RequiresContextResult.from_result(
            Success(f"{label}:ttl={deps.cache_ttl}")
        )
    )

def lookup_and_enrich(user_id: int) -> RequiresContextResult[str, Exception, ServiceDeps]:
    """Compose heterogeneous reader stages via modify_env context narrowing."""
    return (
        fetch_user(user_id)
        .modify_env(lambda deps: deps)  # ServiceDeps -> _RepoDeps
        .bind(
            lambda label: enrich_with_cache(label)
            .modify_env(lambda deps: deps)  # ServiceDeps -> _CacheDeps
        )
    )

@future_safe
async def fetch_from_db(user_id: int, db_url: str) -> dict[str, object]:
    return {"user_id": user_id, "db_url": db_url}

def async_lookup_user(
    user_id: int,
) -> RequiresContextFutureResult[dict[str, object], Exception, ServiceDeps]:
    return RequiresContextFutureResult.ask().bind_async(
        lambda deps: fetch_from_db(user_id, deps.db_url)
    )

# Terminal boundary only:
# deps = ServiceDeps(db_url="postgres://...", cache_ttl=300)
# sync_result: Result[str, Exception] = lookup_and_enrich(42)(deps)
# async_result = async_lookup_user(42)(deps)
```

[IMPORTANT]:
- [ALWAYS] Keep dependency shape explicit in the reader type parameter.
- [ALWAYS] Provide concrete deps once at the composition root.
- [NEVER] Build reader effects from raw `_inner` closures when `.ask()` and constructors cover the case.

---
## [3][BOUNDARY_IO_AND_ERROR_ALGEBRA]
>**Dictum:** *Impure boundaries and error unions are explicit values; boundary handlers pattern-match the closed algebra.*

`IO[T]` marks synchronous impurity. `@impure_safe` bridges exception-raising sync IO into `IOResult`. `@trampoline` keeps deep recursion stack-safe. Error unions are closed via PEP 695 `type` aliases over frozen dataclass variants and are handled with structural `match/case`.

```python
# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Callable
from dataclasses import dataclass
from typing import cast

from returns.io import IO, impure_safe
from returns.result import Failure, Result, Success
from returns.trampolines import Trampoline, trampoline

# --- [TYPES] ---------------------------------------------------------------

type DomainError = AtomError | NotFoundError | ConflictError

# -- IO marker for sync impurity --------------------------------------------
pure_io: IO[int] = IO.from_value(42)
greeting: IO[str] = pure_io.map(lambda n: f"Value: {n}")

@impure_safe
def read_file(path: str) -> str:
    with open(path) as fh:
        return fh.read()

# -- Stack-safe recursion ----------------------------------------------------
@trampoline
def factorial(n: int, acc: int = 1) -> int | Trampoline[int]:
    match n:
        case n if n <= 1:
            return acc
        case _:
            return Trampoline(cast(Callable[[int, int], int], factorial), n - 1, acc * n)

# -- Closed error algebra ----------------------------------------------------
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

def handle_result(result: Result[str, DomainError]) -> str:
    """Boundary handler: structural dispatch on closed error variants."""
    match result:
        case Success(value):
            return f"OK: {value}"
        case Failure(AtomError(atom=atom, message=msg)):
            return f"VALIDATION: {atom} -- {msg}"
        case Failure(NotFoundError(entity=ent, identifier=ident)):
            return f"NOT_FOUND: {ent}/{ident}"
        case Failure(ConflictError(entity=ent, reason=reason)):
            return f"CONFLICT: {ent} -- {reason}"
        case _:
            return "UNEXPECTED_RESULT"
```

[CRITICAL]:
- [ALWAYS] Keep IO markers and IO bridges at boundaries only.
- [ALWAYS] Encode domain errors as frozen variants in a closed union.
- [NEVER] Use string parsing or `isinstance` trees for error routing when structural patterns are available.

---
## [4][RULES_AND_REFERENCE]
>**Dictum:** *One compact contract governs effect usage.*

| [INDEX] | [CONSTRUCT]                              | [USAGE_RULE]                                                                       |
| :-----: | ---------------------------------------- | ---------------------------------------------------------------------------------- |
|   [1]   | `Result[T, E]`                           | Expected sync failure; compose with `Success`/`Failure` + `bind`                   |
|   [2]   | `Maybe[T]`                               | Absence-only channel; promote via `maybe_to_result` when absence is an error       |
|   [3]   | `FutureResult[T, E]`                     | Expected async failure; compose with `@future_safe` and bind-chain stages          |
|   [4]   | `flow(...)` / `pipe(...)`                | `flow` for eager linear execution; `pipe` for reusable stage fragments             |
|   [5]   | `bind(...)` / `map_(...)` / `lash(...)`  | `bind` for monadic stages, `map_` for pure stages, `lash` for error-track recovery |
|   [6]   | `RequiresContextResult`                  | Sync typed DI: `Deps -> Result[T, E]`                                              |
|   [7]   | `RequiresContextFutureResult`            | Async typed DI: `Deps -> FutureResult[T, E]`                                       |
|   [8]   | `.modify_env(...)`                       | Lift narrower dependency contracts into wider runtime dependency bundles           |
|   [9]   | `IO[T]` / `@impure_safe`                 | Boundary-only synchronous effects; keep out of domain transforms                   |
|  [10]   | `@trampoline`                            | Stack-safe recursion for deep recursive paths                                      |
|  [11]   | `type DomainError = A B C`               | Keep closed frozen variant unions for domain error algebras                        |
|  [12]   | Structural `match/case`                  | Handle `Success`/`Failure` and error variants at boundaries                        |
|  [13]   | [NEVER] `try/except` in domain pipelines | Permit only foreign-boundary bridges                                               |
|  [14]   | [NEVER] container unwrap mid-pipeline    | Avoid `.unwrap()`, `.value_or()`, `.failure()` before terminals                    |
