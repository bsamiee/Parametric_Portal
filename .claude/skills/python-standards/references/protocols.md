# [H1][PROTOCOLS]
>**Dictum:** *Protocol ports define structural contracts -- implementations satisfy without inheritance, adapters invert dependencies, reader monads thread typed environments.*

<br>

Protocol-first structural typing for Python 3.14+. Protocols live in `/protocols`; implementations in `/adapters`; domain depends on neither. Cross-references: effects.md [1][2], types.md [2][3], decorators.md [1], concurrency.md [1].

---
## [1][PROTOCOL_ARCHITECTURE]
>**Dictum:** *A Protocol is a structural contract with explicit variance -- adapters satisfy without inheritance, dependency inversion through module topology.*

<br>

Mark with `@runtime_checkable` only when composition-root registration requires `isinstance`. Variance governs substitutability: covariant for producers, contravariant for consumers, invariant for bidirectional ports. `Self` preserves concrete return type through fluent chains. Adapters satisfy structurally -- no `class Foo(MyProtocol)`.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from typing import Protocol, Self, TypeVar, runtime_checkable

from returns.result import Failure, Result, Success

# --- [TYPES] ------------------------------------------------------------------

T = TypeVar("T")
T_co = TypeVar("T_co", covariant=True)
T_contra = TypeVar("T_contra", contravariant=True)
ProductT = TypeVar("ProductT")

# --- [PROTOCOL_PORT] ----------------------------------------------------------

@runtime_checkable
class Repository(Protocol[T]):
    """Invariant persistence port -- T in both input and output position."""
    async def get(self, entity_id: int) -> Result[T, Exception]: ...
    async def save(self, entity: T) -> Result[int, Exception]: ...

class Readable(Protocol[T_co]):
    """Covariant -- produces T. A Readable[Dog] is a Readable[Animal]."""
    def read(self) -> T_co: ...

class Writable(Protocol[T_contra]):
    """Contravariant -- consumes T. A Writable[Animal] is a Writable[Dog]."""
    def write(self, value: T_contra) -> None: ...

class FluentBuilder(Protocol[ProductT]):
    """Self preserves concrete subtype through chaining; build() yields product."""
    def with_timeout(self, seconds: float) -> Self: ...
    def with_retries(self, count: int) -> Self: ...
    def build(self) -> ProductT: ...

# --- [ADAPTER] ----------------------------------------------------------------

from pydantic import BaseModel

class User(BaseModel, frozen=True):
    user_id: int
    email: str
    name: str

class InMemoryUserRepo:
    """Satisfies Repository[User] structurally -- no inheritance needed."""
    __slots__ = ("_store",)
    def __init__(self, initial: tuple[tuple[int, User], ...] = ()) -> None:
        self._store: dict[int, User] = dict(initial)
    async def get(self, entity_id: int) -> Result[User, Exception]:
        match self._store.get(entity_id):
            case None:
                return Failure(KeyError(f"User {entity_id} not found"))
            case user:
                return Success(user)
    async def save(self, entity: User) -> Result[int, Exception]:
        self._store = {**self._store, entity.user_id: entity}
        return Success(entity.user_id)

# --- [FUNCTIONS] --------------------------------------------------------------

async def transfer_entity(
    source: Repository[T], target: Repository[T], entity_id: int,
) -> Result[int, Exception]:
    """Pure orchestration depending only on Protocol -- no adapter imports."""
    match await source.get(entity_id):
        case Success(entity):
            return await target.save(entity)
        case Failure() as err:
            return err
```

| [INDEX] | [VARIANCE]    | [TYPEVAR]                                 | [DIRECTION] | [EXAMPLE]                  |
| :-----: | :------------ | :---------------------------------------- | :---------- | :------------------------- |
|   [1]   | Invariant     | `TypeVar("T")`                            | Both        | `Repository[T]` (get+save) |
|   [2]   | Covariant     | `TypeVar("T_co", covariant=True)`         | Output only | `Readable[T_co]` (produce) |
|   [3]   | Contravariant | `TypeVar("T_contra", contravariant=True)` | Input only  | `Writable[T_contra]`       |

Layer boundaries enforce dependency inversion:
- `/protocols`: structural contracts; may import domain model types only.
- `/adapters`: concrete implementations; depend on `/protocols` and `/domain`.
- `/ops`: orchestration pipelines; depend on `/protocols` and `/domain`.
- `/runtime`: composition root and wiring; owns full graph assembly.

[CRITICAL]:
- [ALWAYS] Use `Protocol[T]` with explicit variance for generic capability ports.
- [ALWAYS] Use `Self` for fluent builder protocols -- preserves concrete return type.
- [ALWAYS] Adapters satisfy protocols via structural matching -- never via `class Foo(MyProtocol)`.
- [ALWAYS] Wire adapters at the composition root only -- domain and ops never import from `/adapters`.
- [NEVER] Use `abc.ABC` or `abc.abstractmethod` -- Protocol provides structural subtyping.
- [NEVER] Mix covariance and contravariance on the same `TypeVar` within one Protocol.

---
## [2][TYPED_DI]
>**Dictum:** *`RequiresContextResult` is a reader monad -- deferring dependency resolution to the composition root while preserving typed error channels.*

<br>

Define `_Deps` as a `Protocol` with typed attributes (never bare primitives). Concrete deps use frozen `BaseModel`. Use `.ask()` + `.from_result()` for idiomatic construction -- not raw `_inner` closures. For async services, use `RequiresContextFutureResult`. For heterogeneous deps composition via `.modify_env()`, see effects.md [2].

```python
# --- [IMPORTS] ----------------------------------------------------------------

from typing import NewType, Protocol

import anyio
from pydantic import BaseModel
from returns.context import RequiresContextFutureResult, RequiresContextResult
from returns.future import future_safe
from returns.result import Success

# --- [TYPES] ------------------------------------------------------------------

DbUrl = NewType("DbUrl", str)
CacheTtl = NewType("CacheTtl", int)

class _ServiceDeps(Protocol):
    """Protocol-based dependency contract -- structural, not nominal."""
    db_url: DbUrl
    cache_ttl: CacheTtl

class ServiceDeps(BaseModel, frozen=True):
    """Concrete deps satisfying _ServiceDeps structurally."""
    db_url: DbUrl
    cache_ttl: CacheTtl

class User(BaseModel, frozen=True):
    user_id: int
    email: str
    name: str

# --- [FUNCTIONS] --------------------------------------------------------------

# -- Sync reader: .ask() retrieves deps, .from_result() lifts Result -------
def fetch_user(
    user_id: int,
) -> RequiresContextResult[User, Exception, _ServiceDeps]:
    return RequiresContextResult.ask().bind(
        lambda deps: RequiresContextResult.from_result(
            Success(User(user_id=user_id, email="a@b.com", name="Test"))
        )
    )

def enrich_user(
    user: User,
) -> RequiresContextResult[str, Exception, _ServiceDeps]:
    return RequiresContextResult.ask().bind(
        lambda deps: RequiresContextResult.from_result(
            Success(f"{user.name}:ttl={deps.cache_ttl}")
        )
    )

# -- Compose readers: deps threaded implicitly via bind --------------------
def process_user(
    user_id: int,
) -> RequiresContextResult[str, Exception, _ServiceDeps]:
    """Pipeline composing fetch -> enrich via bind over shared Deps."""
    return fetch_user(user_id).bind(enrich_user)

# -- Async reader: RequiresContextFutureResult for production services -----
@future_safe
async def fetch_user_from_db(user_id: int, db_url: DbUrl) -> User:
    await anyio.sleep(0)  # placeholder for real DB IO
    return User(user_id=user_id, email="a@b.com", name="Test")

def async_fetch_user(
    user_id: int,
) -> RequiresContextFutureResult[User, Exception, _ServiceDeps]:
    """Async reader: deps -> FutureResult. Production service pattern."""
    return RequiresContextFutureResult.ask().bind_async(
        lambda deps: fetch_user_from_db(user_id, deps.db_url)
    )

# Composition root resolves Deps once:
# result: Result[str, Exception] = process_user(42)(deps)
# async_result: FutureResult[User, Exception] = async_fetch_user(42)(deps)
```

[IMPORTANT]:
- [ALWAYS] Define `Deps` as a Protocol with typed atoms -- never bare `str`/`int` in deps.
- [ALWAYS] Concrete deps use `BaseModel(frozen=True)` -- immutable and validated.
- [ALWAYS] Use `.ask()` + `.from_result()` for reader construction -- not raw `_inner` closures.
- [ALWAYS] Use `RequiresContextFutureResult` for async DI -- production services are async.
- [ALWAYS] Compose with `bind` -- manual deps threading defeats the reader pattern.

---
## [3][RUNTIME_CHECKABLE_LIMITS]
>**Dictum:** *`runtime_checkable` checks method existence, not signatures -- beartype fills the gap with O(1) structural verification.*

<br>

`isinstance` with `@runtime_checkable` verifies method **names** only -- not parameter types, return types, or arity. `beartype.door.is_bearable` provides full PEP 544 structural verification. `beartype.door.is_subhint` enables type-driven dispatch registries.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from typing import Protocol, cast, runtime_checkable

from beartype.door import is_bearable, is_subhint
from returns.result import Result, Success, Failure

# --- [PROTOCOL_PORT] ----------------------------------------------------------

@runtime_checkable
class Repo(Protocol):
    async def get(self, entity_id: int) -> Result[object, Exception]: ...

class FakeRepo:
    """Wrong signature -- isinstance still passes."""
    async def get(self) -> str:
        return "wrong"

# isinstance(FakeRepo(), Repo) == True  -- MISLEADING

# --- [FUNCTIONS] --------------------------------------------------------------

def verify_structural[T](obj: object, form: object) -> Result[T, str]:
    """Full structural check via beartype -- verifies signatures, not just names."""
    match obj:
        case candidate if is_bearable(candidate, form):
            return Success(cast(T, candidate))
        case _:
            return Failure(f"Object {type(obj).__name__} does not satisfy {form}")

def is_compatible_hint(source: type, target: type) -> bool:
    """Structural subtype check between type hints -- drives dispatch registries."""
    return is_subhint(source, target)

# is_subhint(bool, int)             -> True  (bool is subtype of int)
# is_bearable([1, "a"], list[int])   -> False (runtime container sampling)
```

| [INDEX] | [CHECK_TYPE]           | [METHOD_NAMES] | [PARAM_TYPES] | [RETURN_TYPES] | [ARITY] |
| :-----: | :--------------------- | :------------: | :-----------: | :------------: | :-----: |
|   [1]   | `isinstance` (runtime) |      Yes       |      No       |       No       |   No    |
|   [2]   | `beartype.is_bearable` |      Yes       |      Yes      |      Yes       |   Yes   |
|   [3]   | `beartype.is_subhint`  |      N/A       |      Yes      |      Yes       |   Yes   |
|   [4]   | Static type checker    |      Yes       |      Yes      |      Yes       |   Yes   |

[CRITICAL]:
- [ALWAYS] Use `is_bearable()` when runtime structural verification of signatures is required.
- [ALWAYS] Use `is_subhint()` for type-driven dispatch registries -- structural hint comparison.
- [NEVER] Rely on `isinstance(obj, Protocol)` as a correctness gate -- verifies names only.

---
## [4][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] Define protocols in `/protocols`, implementations in `/adapters` -- structural inversion.
- [ALWAYS] Use `Protocol[T]` with explicit variance for generic capability ports.
- [ALWAYS] `RequiresContextResult[T, E, Deps]` for typed DI -- compose via `bind`, resolve at composition root.
- [ALWAYS] Define DI deps as `Protocol` -- concrete deps satisfy structurally via frozen `BaseModel`.
- [ALWAYS] Use `Self` for fluent builder protocols -- preserves concrete return type.
- [ALWAYS] Use `is_bearable()` for runtime structural checks requiring signature verification.
- [ALWAYS] Use `is_subhint()` for structural type comparison in dispatch registries.
- [ALLOW] `expression.Result` with Protocol-typed service methods as alternative for simpler compositions where reader monad overhead is not justified.
- [NEVER] Use `abc.ABC` or `abc.abstractmethod` -- Protocol provides structural subtyping.
- [NEVER] Inherit from Protocol in adapters -- structural satisfaction requires no inheritance.

---
## [5][QUICK_REFERENCE]
>**Dictum:** *Patterns indexed by shape and intent.*

<br>

| [INDEX] | [PATTERN]                     | [WHEN]                                         | [KEY_TRAIT]                               |
| :-----: | ----------------------------- | ---------------------------------------------- | ----------------------------------------- |
|   [1]   | `Protocol[T]` with variance   | Generic capability port (repos, publishers)    | Structural subtyping without inheritance  |
|   [2]   | `Self` return type            | Fluent builder chaining                        | Concrete return preservation              |
|   [3]   | Structural adapter            | `/adapters` satisfying `/protocols`            | No import path from domain to adapter     |
|   [4]   | `RequiresContextResult`       | Sync typed DI                                  | Reader monad; resolve at composition root |
|   [5]   | `RequiresContextFutureResult` | Async typed DI (production services)           | Async reader monad                        |
|   [6]   | Protocol-shaped deps          | Dependency contracts across boundaries         | Structural satisfaction via frozen model  |
|   [7]   | `beartype.is_bearable`        | Runtime structural signature verification      | Full PEP 544 check (params + returns)     |
|   [8]   | `beartype.is_subhint`         | Type-hint compatibility in dispatch registries | Structural hint subtype comparison        |
|   [9]   | `runtime_checkable`           | Composition-root registration only             | Name-only check; not correctness proof    |
