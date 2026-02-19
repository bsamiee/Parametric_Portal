# [H1][PROTOCOLS]
>**Dictum:** *Protocol ports define structural contracts — implementations satisfy without inheritance, dependencies invert through reader monads, runtime checks defer to beartype.*

Protocol-first structural typing for Python 3.14+. Cross-references: effects.md [4], types.md [6], decorators.md [4].

---
## [1][PROTOCOL_DESIGN]
>**Dictum:** *A Protocol is a structural contract with explicit variance — covariance for producers, contravariance for consumers, `Self` for fluent builders.*

Mark with `@runtime_checkable` only when composition-root registration requires `isinstance`. Protocols live in `/protocols`; implementations live in `/adapters`.

```python
from typing import Protocol, Self, TypeVar, runtime_checkable
from returns.result import Failure, Result, Success

T = TypeVar("T")
T_co = TypeVar("T_co", covariant=True)
T_contra = TypeVar("T_contra", contravariant=True)
ProductT = TypeVar("ProductT")

@runtime_checkable
class Repository(Protocol[T]):
    """Invariant persistence port — T in both input and output position."""
    async def get(self, entity_id: int) -> Result[T, Exception]: ...
    async def save(self, entity: T) -> Result[int, Exception]: ...

class Readable(Protocol[T_co]):
    """Covariant — produces T. A Readable[Dog] is a Readable[Animal]."""
    def read(self) -> T_co: ...

class Writable(Protocol[T_contra]):
    """Contravariant — consumes T. A Writable[Animal] is a Writable[Dog]."""
    def write(self, value: T_contra) -> None: ...

class FluentBuilder(Protocol[ProductT]):
    """Self preserves the concrete subtype through chaining; build() returns the product."""
    def with_timeout(self, seconds: float) -> Self: ...
    def with_retries(self, count: int) -> Self: ...
    def build(self) -> ProductT: ...

@runtime_checkable
class EventPublisher(Protocol):
    """Event dispatch port — decoupled from transport implementation."""
    async def publish(self, topic: str, payload: bytes) -> Result[None, Exception]: ...

async def transfer_entity(
    source: Repository[T], target: Repository[T], entity_id: int,
) -> Result[int, Exception]:
    """Pure orchestration depending only on Protocol — no adapter imports."""
    match await source.get(entity_id):
        case Success(entity): return await target.save(entity)
        case Failure() as err: return err
        case _: return Failure(RuntimeError("Unexpected repository result"))
```

| [VARIANCE]    | [TYPEVAR]                                 | [DIRECTION] | [EXAMPLE]                       |
| :------------ | :---------------------------------------- | :---------- | :------------------------------ |
| Invariant     | `TypeVar("T")`                            | Both        | `Repository[T]` (get + save)    |
| Covariant     | `TypeVar("T_co", covariant=True)`         | Output only | `Readable[T_co]` (produces)     |
| Contravariant | `TypeVar("T_contra", contravariant=True)` | Input only  | `Writable[T_contra]` (consumes) |

[CRITICAL]:
- [ALWAYS] Use `Protocol[T]` with explicit variance for generic capability ports.
- [ALWAYS] Use `Self` for fluent builder protocols — preserves concrete return type.
- [NEVER] Use `abc.ABC` or `abc.abstractmethod` — Protocol provides structural subtyping.
- [NEVER] Mix covariance and contravariance on the same `TypeVar` within one Protocol.

---
## [2][ADAPTER_PATTERN]
>**Dictum:** *Protocols live in `/protocols`, implementations in `/adapters` — dependency inversion through structural satisfaction.*

Adapters satisfy Protocol contracts without inheriting from them. Domain code depends on the Protocol; no import path flows from domain to adapter.

```python
from pydantic import BaseModel
from returns.result import Failure, Result, Success

class User(BaseModel, frozen=True):
    user_id: int
    email: str
    name: str

class InMemoryUserRepo:
    """Satisfies Repository[User] structurally — no inheritance needed."""
    __slots__ = ("_data",)

    def __init__(self, initial: tuple[tuple[int, User], ...] = ()) -> None:
        self._data: dict[int, User] = dict(initial)

    async def get(self, entity_id: int) -> Result[User, Exception]:
        match self._data.get(entity_id):
            case None: return Failure(KeyError(f"User {entity_id} not found"))
            case user: return Success(user)

    async def save(self, entity: User) -> Result[int, Exception]:
        self._data = {**self._data, entity.user_id: entity}
        return Success(entity.user_id)
```

Layer boundaries:
- `/protocols`: structural contracts; may import domain model types only.
- `/adapters`: concrete implementations; depend on `/protocols` and `/domain`.
- `/ops`: orchestration pipelines; depend on `/protocols` and `/domain`.
- `/runtime`: composition root and wiring; owns full graph assembly.

[CRITICAL]:
- [ALWAYS] Adapters satisfy protocols via structural matching — never via `class Foo(MyProtocol)`.
- [ALWAYS] Wire adapters at the composition root only — domain and ops never import from `/adapters`.

---
## [3][TYPED_DI]
>**Dictum:** *`RequiresContextResult` is a reader monad — deferring dependency resolution to the composition root while preserving typed error channels.*

Define `_Deps` as a `Protocol` with typed attributes (never bare primitives) — threads typed deps through the pipeline via `bind`. Concrete deps use frozen `BaseModel`. Use `.ask()` + `.from_result()` class methods for construction -- not raw `_inner` closures. For async services, use `RequiresContextFutureResult`.

```python
from typing import NewType, Protocol
from pydantic import BaseModel
from returns.context import RequiresContextFutureResult, RequiresContextResult
from returns.future import FutureResult, future_safe
from returns.pipeline import flow
from returns.pointfree import bind
from returns.result import Result, Success

# -- Typed atoms for deps (not bare str/int) --------------------------------
DbUrl = NewType("DbUrl", str)
CacheTtl = NewType("CacheTtl", int)
TracerName = NewType("TracerName", str)

class _ServiceDeps(Protocol):
    """Protocol-based dependency contract — structural, not nominal."""
    db_url: DbUrl
    cache_ttl: CacheTtl
    tracer_name: TracerName

class ServiceDeps(BaseModel, frozen=True):
    """Concrete deps satisfying _ServiceDeps structurally."""
    db_url: DbUrl
    cache_ttl: CacheTtl
    tracer_name: TracerName

class User(BaseModel, frozen=True):
    user_id: int
    email: str
    name: str

# -- .ask() + .from_result(): idiomatic reader construction -----------------
# .ask() retrieves the deps from context; .from_result() lifts a sync Result.
# This replaces verbose raw _inner closure construction.
def fetch_user(user_id: int) -> RequiresContextResult[User, Exception, _ServiceDeps]:
    """Reader: .ask() retrieves deps, .from_result() lifts sync Result."""
    return RequiresContextResult.ask().bind(
        lambda deps: RequiresContextResult.from_result(
            Success(User(user_id=user_id, email="a@b.com", name="Test"))
        )
    )

def enrich_user(user: User) -> RequiresContextResult[str, Exception, _ServiceDeps]:
    """Reader using deps for enrichment."""
    return RequiresContextResult.ask().bind(
        lambda deps: RequiresContextResult.from_result(
            Success(f"{user.name}:ttl={deps.cache_ttl}")
        )
    )

# -- Compose readers: deps threaded implicitly via bind --------------------
def process_user(user_id: int) -> RequiresContextResult[str, Exception, _ServiceDeps]:
    """Pipeline composing fetch -> enrich via bind over shared Deps."""
    return fetch_user(user_id).bind(enrich_user)

# -- RequiresContextFutureResult: async DI for production services ---------
# Production Python services are async. RequiresContextFutureResult combines
# async effects (FutureResult) with reader-based DI (RequiresContext).
@future_safe
async def fetch_user_from_db(user_id: int, db_url: DbUrl) -> User:
    """Async operation that may fail -- bridged via @future_safe."""
    return User(user_id=user_id, email="a@b.com", name="Test")

def async_fetch_user(
    user_id: int,
) -> RequiresContextFutureResult[User, Exception, _ServiceDeps]:
    """Async reader: deps -> FutureResult. The actual type for production services."""
    return RequiresContextFutureResult.ask().bind_async(
        lambda deps: fetch_user_from_db(user_id, deps.db_url)
    )

# Composition root resolves Deps once:
# deps = ServiceDeps(db_url=DbUrl("postgresql://localhost/app"), cache_ttl=CacheTtl(300), tracer_name=TracerName("pinnacle"))
# sync_result: Result[str, Exception] = process_user(42)(deps)
# async_result: FutureResult[User, Exception] = async_fetch_user(42)(deps)

# -- Heterogeneous deps: composing across different dep types ---------------
# Production services have different dependency shapes. Use .modify_env()
# to adapt a wider deps bundle to the narrower type each operation needs.
# This enables composing readers with incompatible Deps types.

class _RepoDeps(Protocol):
    db_url: DbUrl

class _CacheDeps(Protocol):
    cache_ttl: CacheTtl

def fetch_from_repo(
    user_id: int,
) -> RequiresContextResult[User, Exception, _RepoDeps]:
    """Needs only _RepoDeps (db_url)."""
    return RequiresContextResult.ask().bind(
        lambda deps: RequiresContextResult.from_result(
            Success(User(user_id=user_id, email="a@b.com", name="Test"))
        )
    )

def cache_user(
    user: User,
) -> RequiresContextResult[str, Exception, _CacheDeps]:
    """Needs only _CacheDeps (cache_ttl)."""
    return RequiresContextResult.ask().bind(
        lambda deps: RequiresContextResult.from_result(
            Success(f"{user.name}:ttl={deps.cache_ttl}")
        )
    )

def fetch_and_cache(
    user_id: int,
) -> RequiresContextResult[str, Exception, ServiceDeps]:
    """Compose heterogeneous readers via .modify_env() context narrowing.
    ServiceDeps satisfies both _RepoDeps and _CacheDeps structurally."""
    return (
        fetch_from_repo(user_id)
        .modify_env(lambda wider: wider)  # ServiceDeps -> _RepoDeps (structural)
        .bind(
            lambda user: cache_user(user)
            .modify_env(lambda wider: wider)  # ServiceDeps -> _CacheDeps (structural)
        )
    )
```

[IMPORTANT]:
- [ALWAYS] Define `Deps` as a Protocol with typed atoms -- never bare `str`/`int` in deps.
- [ALWAYS] Concrete deps use `BaseModel(frozen=True)` -- immutable and validated.
- [ALWAYS] Use `.ask()` + `.from_result()` for reader construction -- not raw `_inner` closures.
- [ALWAYS] Use `RequiresContextFutureResult` for async DI -- production services are async.
- [ALWAYS] Compose with `bind` -- manual deps threading defeats the reader pattern.
- [ALWAYS] Use `.modify_env()` to compose readers with heterogeneous dep types -- the composition root provides a wider deps bundle satisfying all narrower Protocols structurally.

---
## [4][RUNTIME_CHECKABLE_LIMITS]
>**Dictum:** *`runtime_checkable` checks method existence, not signatures — beartype fills the gap with O(1) structural verification and `is_subhint` for type-driven dispatch.*

`isinstance` with `@runtime_checkable` verifies method **names** only — not parameter types, return types, or arity. `beartype.door.is_bearable` provides full PEP 544 structural verification. `beartype.door.is_subhint` enables type-driven dispatch registries.

```python
from typing import Protocol, cast, runtime_checkable
from beartype.door import is_bearable, is_subhint
from returns.result import Failure, Result, Success
from typing_extensions import TypeForm

@runtime_checkable
class Repo(Protocol):
    async def get(self, entity_id: int) -> Result[object, Exception]: ...

class FakeRepo:
    """Wrong signature — isinstance still passes."""
    async def get(self) -> str: return "wrong"
# isinstance(FakeRepo(), Repo) == True  -- MISLEADING

def verify_structural[T](obj: object, form: object) -> Result[T, str]:
    """Full structural check via beartype — verifies signatures, not just names."""
    match obj:
        case o if is_bearable(o, form):
            return Success(cast(T, o))
        case _:
            return Failure(f"Object {type(obj).__name__} does not satisfy {form}")

def is_compatible_hint(source: type, target: type) -> bool:
    """Structural subtype check between type hints — drives dispatch registries."""
    return is_subhint(source, target)

# is_subhint(bool, int)             -> True  (bool is subtype of int)
# is_bearable([1, "a"], list[int])   -> False (runtime container sampling)
```

| [CHECK_TYPE]           | [METHOD_NAMES] | [PARAM_TYPES] | [RETURN_TYPES] | [ARITY] |
| :--------------------- | :------------: | :-----------: | :------------: | :-----: |
| `isinstance` (runtime) |      Yes       |      No       |       No       |   No    |
| `beartype.is_bearable` |      Yes       |      Yes      |      Yes       |   Yes   |
| `beartype.is_subhint`  |      N/A       |      Yes      |      Yes       |   Yes   |
| Static type checker    |      Yes       |      Yes      |      Yes       |   Yes   |

[CRITICAL]:
- [ALWAYS] Use `is_bearable()` when runtime structural verification of signatures is required.
- [ALWAYS] Use `is_subhint()` for type-driven dispatch registries — structural hint comparison.
- [NEVER] Rely on `isinstance(obj, Protocol)` as a correctness gate — verifies names only.

---
## [5][RULES]
>**Dictum:** *Rules compress into constraints.*

- [ALWAYS] Define protocols in `/protocols`, implementations in `/adapters` — structural inversion.
- [ALWAYS] Use `Protocol[T]` with explicit variance for generic capability ports.
- [ALWAYS] `RequiresContextResult[T, E, Deps]` for typed DI — compose via `bind`, resolve at composition root.
- [ALWAYS] Define DI deps as `Protocol` — concrete deps satisfy structurally via frozen `BaseModel`.
- [ALWAYS] Use `Self` for fluent builder protocols — preserves concrete return type.
- [ALWAYS] Use `is_bearable()` for runtime structural checks requiring signature verification.
- [ALWAYS] Use `is_subhint()` for structural type comparison in dispatch registries.
- [NEVER] Use `abc.ABC` or `abc.abstractmethod` — Protocol provides structural subtyping.
- [NEVER] Inherit from Protocol in adapters — structural satisfaction requires no inheritance.

---
## [6][QUICK_REFERENCE]

- `Protocol[T]`: define capability contracts without nominal inheritance.
- Variance: covariant producers, contravariant consumers, invariant mixed ports.
- `Self`: fluent builders with concrete return preservation.
- Adapter pattern: keep `/protocols` and `/adapters` separated.
- `RequiresContextResult`: typed sync DI; resolve at composition root.
- Protocol-shaped deps: structural dependency contracts across service boundaries.
- `beartype.is_bearable`: runtime structural signature verification.
- `beartype.is_subhint`: type-hint compatibility checks for dispatch registries.
- `runtime_checkable`: composition-root registration checks only, not correctness proofs.
