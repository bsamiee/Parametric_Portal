# Pinnacle Python 3.14+ Engineering Reference

## 0. Canonical stack declaration

### Boundary map

Each library owns exactly one architectural concern with zero overlap:

- **Validation** → Pydantic `TypeAdapter` + validators — all external data enters through schema-driven validation with `core_schema` primitives
- **Serialization** → msgspec `Encoder`/`Decoder` — outbound JSON exits through zero-copy `Struct(gc=False)` serialization
- **Error/effect** → returns `Result`/`Maybe`/`IO`/`FutureResult` — no domain function raises for expected failures; railway composition via `pipe()`/`flow()`
- **Concurrency** → anyio `TaskGroup` + `CancelScope` — all async coordination uses structured concurrency; no bare `asyncio.create_task`
- **Observability** → OpenTelemetry SDK + structlog — trace IDs and structured log context share `contextvars`; a single `CorrelationId` threads through spans and log lines
- **Runtime enforcement** → beartype `BeartypeConf` — import-time hook decorates all public API surfaces with **O(1)** type checks

### pyproject.toml

```toml
[project]
name = "pinnacle"
requires-python = ">=3.14"
dependencies = [
    "pydantic>=2.12,<3",
    "pydantic-settings>=2.12,<3",
    "structlog>=25.5,<26",
    "returns>=0.26,<1",
    "beartype>=0.22,<1",
    "msgspec>=0.20,<1",
    "anyio>=4.12,<5",
    "opentelemetry-sdk>=1.39,<2",
    "opentelemetry-api>=1.39,<2",
    "stamina>=25.2,<26",
    "typing-extensions>=4.15,<5",
]

[project.optional-dependencies]
test = ["hypothesis>=6.150,<7", "pytest>=8,<9", "pytest-anyio>=0.0.0"]

[tool.ty.environment]
python-version = "3.14"

[tool.ty.rules]
all = "error"
unused-ignore-comment = "error"

[tool.ruff]
target-version = "py314"
line-length = 99

[tool.ruff.lint]
select = ["ALL"]
ignore = ["D203", "D213", "COM812", "ISC001", "ANN401"]

[tool.ruff.lint.isort]
known-first-party = ["pinnacle"]

[tool.pytest.ini_options]
addopts = "-ra --strict-markers --strict-config"
xfail_strict = true

[tool.hypothesis]
database_backend = "directory"
```

## 1. Python 3.14+ features that change pinnacle practice

Four GA features plus one draft-typing extension reshape how pinnacle-grade Python is written. **PEP 649** eliminates forward-reference friction — `annotationlib` lazily evaluates annotations via `__annotate__`, making quoted type strings obsolete. **PEP 750** introduces `t"..."` template strings that yield `Template`/`Interpolation` objects for context-aware safe output. **PEP 779** promotes free-threading to officially supported status, demanding immutable-first design for all shared state. **PEP 696** (landed in 3.13, fully usable on 3.14) adds `TypeVar` defaults that collapse verbose generic signatures. **PEP 747** remains draft, while `TypeForm` is usable today via `typing_extensions`.

The module below demonstrates architectural consequences, not a feature tour.

```python
"""pinnacle/runtime/features.py — 3.14 features as architectural drivers."""

# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Callable
from contextvars import ContextVar
from string.templatelib import Interpolation, Template
from typing import ParamSpec, TypeVar

from beartype.door import die_if_unbearable
from returns.result import Failure, Result, Success
from typing_extensions import TypeForm


# --- [CODE] ----------------------------------------------------------------

# —— PEP 696: TypeVar defaults collapse generic boilerplate ———————————
T = TypeVar("T", default=str)
E = TypeVar("E", default=Exception)
P = ParamSpec("P")
R = TypeVar("R")


class Pipeline[T, E = Exception]:
    """Consumers specify only T; E defaults to Exception."""

    __slots__ = ("_steps",)

    def __init__(self, steps: tuple[Callable[[T], Result[T, E]], ...]) -> None:
        self._steps = steps


# —— PEP 747: TypeForm bridges static types and runtime checks ————————
def narrow[V](form: TypeForm[V], raw: object) -> Result[V, str]:
    """Runtime narrowing returning Result instead of raising."""
    try:
        die_if_unbearable(raw, form)
    except Exception:
        return Failure(f"Expected {form}, got {type(raw).__name__}")
    return Success(raw)  # type: ignore[return-value]


# —— PEP 750: t-strings for context-aware safe output —————————————————
def safe_html(template: Template) -> str:
    """Escape interpolated values; preserve static fragments."""
    return "".join(_render_part(p) for p in template)


def _render_part(part: str | Interpolation) -> str:
    match part:
        case str() as static:                                  # AS pattern
            return static
        case Interpolation(value=v, conversion="r"):           # class + literal
            return repr(v)
        case Interpolation(value=v):
            return (str(v).replace("&", "&amp;")
                          .replace("<", "&lt;")
                          .replace(">", "&gt;"))


# —— PEP 649: forward references just work — no quotes needed —————————
def process(order: Order) -> Result[Confirmation, str]:
    match order.total_cents:
        case n if n > 0:                                        # guard clause
            return Success(Confirmation(order_id=order.order_id))
        case _:
            return Failure("Order total must be positive")


class Order:
    __slots__ = ("order_id", "total_cents")

    def __init__(self, order_id: str, total_cents: int) -> None:
        self.order_id = order_id
        self.total_cents = total_cents


class Confirmation:
    __slots__ = ("order_id",)

    def __init__(self, order_id: str) -> None:
        self.order_id = order_id


# —— PEP 703/779: free-threaded CPython — immutable + contextvars —————
# On python3.14t the GIL is disabled. Frozen models + ContextVar replace
# global mutable singletons. Every shared datum must be immutable or local.
_correlation: ContextVar[str] = ContextVar("correlation_id", default="none")
```

## 2. Canonical architecture layout

```text
pinnacle/
├── domain/              # Pure types, zero IO imports
│   ├── atoms.py         # NewType / Annotated constrained scalars
│   └── models.py        # Frozen Pydantic models
├── protocols/           # runtime_checkable Protocol defs — no implementations
│   └── repo.py          # Repository, EventPublisher, CachePort
├── decorators/          # ParamSpec decorator library
│   ├── core.py          # Foundations, ordering validator
│   └── stack.py         # @trace, @retry, @cache, @validate, @authorize
├── adapters/            # Protocol implementations — sole layer with IO
│   ├── postgres.py      # Repository → asyncpg
│   ├── serialization.py # msgspec Encoder/Decoder boundary
│   └── otel.py          # Tracer → opentelemetry-sdk
├── ops/                 # Railway pipelines via flow()/pipe()
│   └── user_ops.py      # parse → validate → enrich → persist
├── runtime/             # Bootstrap: settings, logging, beartype hooks
│   ├── settings.py      # BaseSettings
│   ├── logging.py       # structlog + OTel correlation
│   └── boot.py          # BeartypeConf, TracerProvider init
└── tests/
    ├── strategies.py    # Hypothesis composite strategies
    └── test_ops.py      # Property + stateful tests
```

Dependency flows **inward**: adapters → protocols ← ops → domain. Decorators apply orthogonally at the composition root. Runtime bootstraps everything. No layer may import from a layer further outward.

## 3. Typed atoms and domain models

```python
"""pinnacle/domain/atoms.py — System-wide vocabulary types."""

# --- [IMPORTS] -------------------------------------------------------------
import re
from decimal import Decimal
from typing import Annotated, Any, NewType
from uuid import uuid4

from pydantic import GetCoreSchemaHandler, GetJsonSchemaHandler
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import core_schema
from returns.result import Failure, Result, Success


# --- [CODE] ----------------------------------------------------------------

# ── NewType atoms: zero-cost at runtime, distinct at type-check ──────
UserId = NewType("UserId", int)
CorrelationId = NewType("CorrelationId", str)

# ── Annotated constrained atoms with core_schema enforcement ─────────
EMAIL_RE: re.Pattern[str] = re.compile(r"^[\w.+-]+@[\w-]+\.[\w.]+$")


class _EmailMeta:
    def __get_pydantic_core_schema__(
        self, source_type: type[Any], handler: GetCoreSchemaHandler,
    ) -> core_schema.CoreSchema:
        return core_schema.no_info_after_validator_function(
            self._validate,
            core_schema.str_schema(min_length=5, max_length=320),
        )

    def __get_pydantic_json_schema__(
        self, _schema: core_schema.CoreSchema, handler: GetJsonSchemaHandler,
    ) -> JsonSchemaValue:
        return {"type": "string", "format": "email", "minLength": 5}

    @staticmethod
    def _validate(value: str) -> str:
        match EMAIL_RE.fullmatch(value):
            case None:
                raise ValueError(f"Invalid email: {value}")
            case _:
                return value


Email = Annotated[str, _EmailMeta()]


class _NonEmptyStrMeta:
    def __get_pydantic_core_schema__(
        self, source_type: type[Any], handler: GetCoreSchemaHandler,
    ) -> core_schema.CoreSchema:
        return core_schema.str_schema(min_length=1, strip_whitespace=True)


NonEmptyStr = Annotated[str, _NonEmptyStrMeta()]


class _MoneyMeta:
    def __get_pydantic_core_schema__(
        self, source_type: type[Any], handler: GetCoreSchemaHandler,
    ) -> core_schema.CoreSchema:
        return core_schema.no_info_after_validator_function(
            self._quantize,
            core_schema.decimal_schema(ge=Decimal("0"), decimal_places=2),
        )

    @staticmethod
    def _quantize(value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))


Money = Annotated[Decimal, _MoneyMeta()]

# ── Smart constructors — public API returns Result, never raises ─────
def make_user_id(raw: int) -> Result[UserId, str]:
    match raw:
        case n if n > 0:                                        # guard clause
            return Success(UserId(n))
        case _:
            return Failure(f"UserId must be positive, got {raw}")


def make_email(raw: str) -> Result[Email, str]:
    match EMAIL_RE.fullmatch(raw.strip()):
        case None:
            return Failure(f"Invalid email: {raw}")
        case _:
            return Success(Email(raw.strip()))


def make_correlation_id() -> CorrelationId:
    return CorrelationId(uuid4().hex)


def make_money(raw: int | float | Decimal) -> Result[Money, str]:
    match raw:
        case int() | float() as num:                            # OR + AS pattern
            return Success(Money(Decimal(str(num)).quantize(Decimal("0.01"))))
        case Decimal() as d:
            return Success(Money(d.quantize(Decimal("0.01"))))
        case _:
            return Failure(f"Cannot coerce {type(raw).__name__} to Money")
```

## 4. Decorator-first architecture

### 4a. Why `@wraps` alone is insufficient

`functools.wraps` copies runtime metadata — `__name__`, `__doc__`, `__module__`, `__qualname__`, `__wrapped__`. It does **not** preserve the static type signature. Without `ParamSpec`, every decorated function degrades to `(*args: Any, **kwargs: Any) -> Any` under strict type-checking (ty), breaking IDE autocompletion and downstream type narrowing. `ParamSpec` + `Concatenate` preserve the full parameter spec; `@wraps` preserves runtime identity. Both are required for pinnacle-grade decorators.

```python
"""pinnacle/decorators/core.py — Signature-preserving foundations."""

# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Callable
from functools import wraps
from typing import Concatenate, ParamSpec, TypeVar


# --- [CODE] ----------------------------------------------------------------

P = ParamSpec("P")
R = TypeVar("R")


def transparent[**P, R](func: Callable[P, R]) -> Callable[P, R]:
    """Identity decorator proving ParamSpec + wraps preserves everything."""
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        return func(*args, **kwargs)
    return wrapper
```

### 4b. Composed capability stack with typed Pydantic config

```python
"""pinnacle/decorators/stack.py — Production capability decorators."""

# --- [IMPORTS] -------------------------------------------------------------
import time
from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar

import stamina
import structlog
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from pydantic import BaseModel, ConfigDict


# --- [CODE] ----------------------------------------------------------------

P = ParamSpec("P")
R = TypeVar("R")
_tracer: trace.Tracer = trace.get_tracer("pinnacle")
_log: structlog.stdlib.BoundLogger = structlog.get_logger()


class RetryConfig(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    max_attempts: int = 3
    backoff_base: float = 2.0
    timeout_seconds: float = 30.0


class CacheConfig(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    ttl: int = 300
    max_size: int = 128


class TraceConfig(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    record_args: bool = False
    span_name: str | None = None


# ── @retry: stamina-backed with typed config ─────────────────────────
def retry(
    config: RetryConfig,
    on: type[Exception] | tuple[type[Exception], ...] = Exception,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        @wraps(func)
        @stamina.retry(
            on=on,
            attempts=config.max_attempts,
            timeout=config.timeout_seconds,
            wait_exp_base=config.backoff_base,
        )
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            return func(*args, **kwargs)
        return wrapper
    return decorator


# ── @cache_result: TTL cache with config ─────────────────────────────
def cache_result(
    config: CacheConfig,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        _store: dict[int, tuple[float, R]] = {}

        @wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            key: int = hash((args, tuple(sorted(kwargs.items()))))
            match _store.get(key):
                case (ts, val) if (time.monotonic() - ts) < config.ttl:
                    return val
                case _:
                    result: R = func(*args, **kwargs)
                    fresh: dict[int, tuple[float, R]] = {
                        **{k: v for k, v in _store.items()
                           if (time.monotonic() - v[0]) < config.ttl},
                        key: (time.monotonic(), result),
                    }
                    _store.clear()
                    _store.update(fresh)
                    return result
        return wrapper
    return decorator


# ── @trace_span: OpenTelemetry-backed with config ────────────────────
def trace_span(
    config: TraceConfig = TraceConfig(),
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        name: str = config.span_name or func.__qualname__

        @wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            with _tracer.start_as_current_span(name) as span:
                match config.record_args:
                    case True:
                        span.set_attribute("args", repr(args)[:256])
                    case _:
                        pass
                result: R = func(*args, **kwargs)
                span.set_status(StatusCode.OK)
                return result
        return wrapper
    return decorator
```

### 4c. Class-based decorator as descriptor protocol

```python
"""pinnacle/decorators/descriptor.py — Descriptor-protocol decorator."""

# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Callable
from functools import wraps
from typing import Generic, ParamSpec, TypeVar, overload


# --- [CODE] ----------------------------------------------------------------

P = ParamSpec("P")
R = TypeVar("R")


class Validated(Generic[P, R]):
    """Method descriptor: intercepts access to inject validation logic."""

    __slots__ = ("_func", "_owner", "_name")

    def __init__(self, func: Callable[P, R]) -> None:
        self._func: Callable[P, R] = func
        self._owner: type | None = None
        self._name: str = func.__name__

    def __set_name__(self, owner: type, name: str) -> None:
        self._owner = owner
        self._name = name

    @overload
    def __get__(self, obj: None, objtype: type) -> Callable[P, R]: ...
    @overload
    def __get__(self, obj: object, objtype: type) -> Callable[P, R]: ...

    def __get__(self, obj: object | None, objtype: type | None = None) -> Callable[P, R]:
        match obj:
            case None:
                return self._func
            case instance:
                @wraps(self._func)
                def bound(*args: P.args, **kwargs: P.kwargs) -> R:
                    return self._func(instance, *args, **kwargs)  # type: ignore[arg-type]
                return bound

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R:
        return self._func(*args, **kwargs)
```

### 4d. `__init_subclass__` + `__class_getitem__` as hierarchy-wide decorators

```python
"""pinnacle/decorators/subclass.py — Implicit decorator application."""

# --- [IMPORTS] -------------------------------------------------------------
from typing import Any, ClassVar


# --- [CODE] ----------------------------------------------------------------

class Traceable:
    """All subclasses auto-instrument public methods with @trace_span."""

    _trace_name: ClassVar[str] = ""

    def __init_subclass__(cls, /, trace_name: str = "", **kw: Any) -> None:
        super().__init_subclass__(**kw)
        cls._trace_name = trace_name or cls.__qualname__
        wrapped: dict[str, Any] = {
            k: trace_span(TraceConfig(span_name=f"{cls._trace_name}.{k}"))(v)
            for k, v in vars(cls).items()
            if callable(v) and not k.startswith("_")
        }
        for k, v in wrapped.items():
            setattr(cls, k, v)

    def __class_getitem__(cls, params: type | tuple[type, ...]) -> type:
        match params:
            case (cfg,):
                return type(f"{cls.__name__}[{cfg.__name__}]", (cls,), {"_config": cfg})
            case single:
                return type(f"{cls.__name__}[{single.__name__}]", (cls,), {"_config": single})
```

### 4e. Import-time decorator ordering validator

```python
"""pinnacle/decorators/ordering.py — Enforce decorator application order."""

# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Callable
from typing import Any, TypeVar


# --- [CODE] ----------------------------------------------------------------

T = TypeVar("T")
CANONICAL_ORDER: tuple[str, ...] = ("trace", "retry", "cache", "validate", "authorize")


def _extract_names(func: Callable[..., Any]) -> tuple[str, ...]:
    match getattr(func, "__wrapped__", None):
        case None:
            return ()
        case inner:
            return (getattr(func, "__decorator_tag__", "?"), *_extract_names(inner))


def _is_ordered(names: tuple[str, ...]) -> bool:
    indices: tuple[int, ...] = tuple(
        CANONICAL_ORDER.index(n) for n in names if n in CANONICAL_ORDER
    )
    return indices == tuple(sorted(indices))


def validate_ordering(cls: type[T]) -> type[T]:
    """Class decorator: asserts methods follow CANONICAL_ORDER at import time."""
    violations: tuple[str, ...] = tuple(
        f"{name}: {names}"
        for name, method in vars(cls).items()
        if callable(method)
        for names in (_extract_names(method),)
        if not _is_ordered(names)
    )
    match violations:
        case [first, *rest]:                                    # sequence pattern
            raise TypeError(
                f"Ordering violations in {cls.__name__}: "
                + ", ".join((first, *rest))
            )
        case _:
            return cls
```

## 5. Pydantic v2 apex integration

```python
"""pinnacle/domain/models.py — Pydantic v2 apex patterns."""

# --- [IMPORTS] -------------------------------------------------------------
from functools import cached_property
from typing import Annotated, Any, Literal, Self, Union

from pinnacle.domain.atoms import CorrelationId, Email, Money, NonEmptyStr, UserId
from pydantic import (
    # --- [CODE] ----------------------------------------------------------------
    BaseModel,
    ConfigDict,
    Discriminator,
    Field,
    Tag,
    TypeAdapter,
    computed_field,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict
from returns.result import Result, safe


# ── Frozen domain models ─────────────────────────────────────────────
class Address(BaseModel, frozen=True):
    street: NonEmptyStr
    city: NonEmptyStr
    country_code: Annotated[str, Field(min_length=2, max_length=2)]  # ISO 3166 alpha-2


class User(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    user_id: UserId
    email: Email
    name: NonEmptyStr
    address: Address

    @computed_field
    @cached_property
    def display(self) -> str:
        return f"{self.name} <{self.email}>"

    @model_validator(mode="after")
    def _cross_validate(self) -> Self:
        match len(self.address.country_code):
            case 2:
                return self
            case _:
                raise ValueError("country_code must be 2 chars")


# ── Discriminated unions via Annotated + Discriminator ────────────────
def _payment_disc(raw: Any) -> str:
    match raw:
        case {"method": str() as m}:                            # mapping pattern
            return m
        case obj if hasattr(obj, "method"):
            return str(getattr(obj, "method"))
        case _:
            return "unknown"


class CardPayment(BaseModel, frozen=True):
    method: Literal["card"]
    last_four: Annotated[str, Literal[4]]
    amount: Money


class BankPayment(BaseModel, frozen=True):
    method: Literal["bank"]
    iban: NonEmptyStr
    amount: Money


Payment = Annotated[
    Union[
        Annotated[CardPayment, Tag("card")],
        Annotated[BankPayment, Tag("bank")],
    ],
    Discriminator(_payment_disc),
]

PaymentAdapter: TypeAdapter[Payment] = TypeAdapter(Payment)


@safe
def validate_payment(raw: dict[str, Any]) -> Payment:
    return PaymentAdapter.validate_python(raw)


@safe
def validate_user(raw: dict[str, Any]) -> User:
    return TypeAdapter(User).validate_python(raw)


# ── BaseSettings ─────────────────────────────────────────────────────
class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="PINNACLE_",
        env_file=".env",
        env_nested_delimiter="__",
    )
    service_name: str = "pinnacle"
    debug: bool = False
    db_url: str = "postgresql://localhost/pinnacle"
    otel_endpoint: str = "http://localhost:4317"
```

## 6. Railway-oriented programming with returns

```python
"""pinnacle/ops/user_ops.py — Railway pipeline: parse → validate → enrich → persist."""

# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Callable
from typing import Any

import structlog
from pinnacle.domain.atoms import CorrelationId, UserId, make_correlation_id
from pinnacle.domain.models import User, validate_user
from returns.context import RequiresContextResult
from returns.pipeline import flow
from returns.pointfree import bind
from returns.result import Failure, Result, Success, safe


# --- [CODE] ----------------------------------------------------------------

_log: structlog.stdlib.BoundLogger = structlog.get_logger()


# ── Stage 1: parse raw input ─────────────────────────────────────────
@safe
def parse_input(raw: bytes) -> dict[str, Any]:
    import msgspec
    return msgspec.json.decode(raw, type=dict[str, Any])


# ── Stage 2: validate into domain model ──────────────────────────────
def validate(data: dict[str, Any]) -> Result[User, Exception]:
    structlog.contextvars.bind_contextvars(stage="validate")
    return validate_user(data)


# ── Stage 3: enrich with correlation ID ──────────────────────────────
def enrich(user: User) -> Result[tuple[User, CorrelationId], Exception]:
    cid: CorrelationId = make_correlation_id()
    structlog.contextvars.bind_contextvars(correlation_id=cid, stage="enrich")
    _log.info("enriched_user", user_id=user.user_id)
    return Success((user, cid))


# ── Stage 4: persist (adapter boundary) ──────────────────────────────
def persist(pair: tuple[User, CorrelationId]) -> Result[UserId, Exception]:
    user, cid = pair
    structlog.contextvars.bind_contextvars(stage="persist")
    _log.info("persisted", user_id=user.user_id, correlation_id=cid)
    return Success(user.user_id)


# ── Composed pipeline via flow() ─────────────────────────────────────
def process_user_request(raw: bytes) -> Result[UserId, Exception]:
    """Full railway: parse → validate → enrich → persist."""
    return flow(
        raw,
        parse_input,
        bind(validate),
        bind(enrich),
        bind(persist),
    )


# ── RequiresContextResult for typed dependency injection ─────────────
class Deps:
    __slots__ = ("db_url", "timeout")

    def __init__(self, db_url: str, timeout: float) -> None:
        self.db_url = db_url
        self.timeout = timeout


def lookup_user(
    user_id: UserId,
) -> RequiresContextResult[User, Exception, Deps]:
    def _inner(deps: Deps) -> Result[User, Exception]:
        structlog.contextvars.bind_contextvars(db_url=deps.db_url)
        return validate_user({
            "user_id": user_id, "email": "a@b.com",
            "name": "Test", "address": {"street": "1 Main",
            "city": "NYC", "country_code": "US"},
        })
    return RequiresContextResult(_inner)
```

## 7. Structured concurrency with anyio

```python
"""pinnacle/adapters/concurrent.py — TaskGroup + FutureResult composition."""

# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from typing import AsyncIterator, TypeVar

import anyio
from anyio import CancelScope, CapacityLimiter, create_task_group
from returns.result import Failure, Result, Success


# --- [CODE] ----------------------------------------------------------------

T = TypeVar("T")


# ── Typed result collection via MemoryObjectStream ───────────────────
async def gather_results[T](
    *operations: Callable[[], Awaitable[Result[T, Exception]]],
) -> tuple[Result[T, Exception], ...]:
    send, recv = anyio.create_memory_object_stream[tuple[int, Result[T, Exception]]](
        max_buffer_size=len(operations),
    )
    async with create_task_group() as tg:
        async def _run(idx: int, op: Callable[[], Awaitable[Result[T, Exception]]]) -> None:
            try:
                r: Result[T, Exception] = await op()
            except Exception as exc:
                r = Failure(exc)
            await send.send((idx, r))

        for i, op in enumerate(operations):
            tg.start_soon(_run, i, op)
    await send.aclose()
    indexed: list[tuple[int, Result[T, Exception]]] = [
        item async for item in recv
    ]
    return tuple(r for _, r in sorted(indexed))


# ── Nested CancelScope + CapacityLimiter ─────────────────────────────
async def bounded_fetch[T](
    urls: tuple[str, ...],
    fetcher: Callable[[str], Awaitable[T]],
    concurrency: int = 10,
    timeout: float = 30.0,
) -> tuple[Result[T, Exception], ...]:
    limiter: CapacityLimiter = CapacityLimiter(concurrency)
    send, recv = anyio.create_memory_object_stream[tuple[int, Result[T, Exception]]](
        max_buffer_size=len(urls),
    )

    async with create_task_group() as tg:
        async def _fetch(idx: int, url: str) -> None:
            async with limiter:
                with CancelScope(deadline=anyio.current_time() + timeout):
                    try:
                        val: T = await fetcher(url)
                        await send.send((idx, Success(val)))
                    except Exception as exc:
                        await send.send((idx, Failure(exc)))
                    await anyio.lowlevel.checkpoint()           # checkpoint discipline

        for i, u in enumerate(urls):
            tg.start_soon(_fetch, i, u)
    await send.aclose()
    collected: list[tuple[int, Result[T, Exception]]] = [
        item async for item in recv
    ]
    return tuple(r for _, r in sorted(collected))


# ── asynccontextmanager for service lifecycle ────────────────────────
@asynccontextmanager
async def managed_service(
    startup: Callable[[], Awaitable[None]],
    shutdown: Callable[[], Awaitable[None]],
) -> AsyncIterator[anyio.abc.TaskGroup]:
    await startup()
    async with create_task_group() as tg:
        yield tg
        tg.cancel_scope.cancel()
    await shutdown()
```

```python
"""tests/test_concurrent.py"""

# --- [IMPORTS] -------------------------------------------------------------
import anyio
import pytest
from pinnacle.adapters.concurrent import gather_results
from returns.result import Failure, Success


# --- [CODE] ----------------------------------------------------------------

@pytest.mark.anyio
async def test_gather_collects_all_results() -> None:
    async def ok() -> Success[int]:
        return Success(42)

    async def fail() -> Failure[Exception]:
        return Failure(ValueError("boom"))

    results = await gather_results(ok, fail)
    match results:
        case (Success(v), Failure(e)):
            assert v == 42
            assert "boom" in str(e)
        case _:
            pytest.fail("Unexpected result shape")
```

## 8. Serialization boundary: msgspec + Pydantic

```python
"""pinnacle/adapters/serialization.py — Pydantic inbound, msgspec outbound."""

# --- [IMPORTS] -------------------------------------------------------------
from datetime import datetime
from decimal import Decimal
from typing import Any, Union

import msgspec
from pinnacle.domain.models import Payment, PaymentAdapter


# --- [CODE] ----------------------------------------------------------------

# ── msgspec Structs for outbound serialization ───────────────────────
class UserResponse(msgspec.Struct, frozen=True, gc=False):
    user_id: int
    email: str
    name: str
    created_at: str


class PaymentResponse(msgspec.Struct, frozen=True, gc=False, tag_field="kind"):
    amount: str
    currency: str = "USD"


class CardResponse(PaymentResponse, tag="card"):
    last_four: str


class BankResponse(PaymentResponse, tag="bank"):
    iban: str


# ── enc_hook / dec_hook for boundary types ───────────────────────────
def enc_hook(obj: Any) -> Any:
    match obj:
        case Decimal() as d:
            return str(d)
        case datetime() as dt:
            return dt.isoformat()
        case _:
            raise TypeError(f"Cannot encode {type(obj)}")


def dec_hook(tp: type[Any], obj: Any) -> Any:
    match (tp, obj):
        case (t, str() as s) if t is Decimal:
            return Decimal(s)
        case _:
            raise TypeError(f"Cannot decode {tp}")


_encoder: msgspec.json.Encoder = msgspec.json.Encoder(enc_hook=enc_hook)
_decoder: msgspec.json.Decoder[Union[CardResponse, BankResponse]] = (
    msgspec.json.Decoder(Union[CardResponse, BankResponse], dec_hook=dec_hook)
)


# ── Pydantic validates inbound → msgspec serializes outbound ─────────
def handle_payment(raw: bytes) -> bytes:
    payment: Payment = PaymentAdapter.validate_json(raw)
    response: PaymentResponse = _to_response(payment)
    return _encoder.encode(response)


def _to_response(payment: Payment) -> PaymentResponse:
    match payment:
        case p if hasattr(p, "last_four"):
            return CardResponse(
                amount=str(p.amount), last_four=p.last_four,  # type: ignore[attr-defined]
            )
        case p:
            return BankResponse(
                amount=str(p.amount), iban=p.iban,  # type: ignore[attr-defined]
            )


PAYMENT_SCHEMA: dict[str, Any] = PaymentAdapter.json_schema()
```

## 9. Observability as typed decorator layers

```python
"""pinnacle/runtime/logging.py — OTel + structlog correlated via contextvars."""

# --- [IMPORTS] -------------------------------------------------------------
import logging
from collections.abc import Callable
from contextvars import ContextVar
from functools import wraps
from typing import Any, ParamSpec, TypeVar

import structlog
from opentelemetry import trace
from opentelemetry.trace import StatusCode


# --- [CODE] ----------------------------------------------------------------

P = ParamSpec("P")
R = TypeVar("R")
_tracer: trace.Tracer = trace.get_tracer("pinnacle.observability")
_cid_var: ContextVar[str] = ContextVar("correlation_id", default="none")


# ── OTel trace-ID injection processor ────────────────────────────────
def add_otel_context(
    logger: Any, method_name: str, event_dict: dict[str, Any],
) -> dict[str, Any]:
    span: trace.Span = trace.get_current_span()
    ctx: trace.SpanContext = span.get_span_context()
    match ctx.is_valid:
        case True:
            return {
                **event_dict,
                "trace_id": format(ctx.trace_id, "032x"),
                "span_id": format(ctx.span_id, "016x"),
                "correlation_id": _cid_var.get(),
            }
        case _:
            return {**event_dict, "correlation_id": _cid_var.get()}


# ── structlog processor pipeline configuration ───────────────────────
def configure_logging() -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.CallsiteParameterAdder(
                {
                    structlog.processors.CallsiteParameter.MODULE,
                    structlog.processors.CallsiteParameter.FUNC_NAME,
                    structlog.processors.CallsiteParameter.LINENO,
                }
            ),
            add_otel_context,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


# ── @trace_operation: signature-preserving span + structured log ─────
def trace_operation[**P, R](func: Callable[P, R]) -> Callable[P, R]:
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        with _tracer.start_as_current_span(func.__qualname__) as span:
            log: structlog.stdlib.BoundLogger = structlog.get_logger()
            log.info("op_start", operation=func.__qualname__)
            result: R = func(*args, **kwargs)
            span.set_status(StatusCode.OK)
            return result
    return wrapper


# ── @instrument: full observability with exception recording ─────────
def instrument[**P, R](func: Callable[P, R]) -> Callable[P, R]:
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        with _tracer.start_as_current_span(func.__qualname__) as span:
            log: structlog.stdlib.BoundLogger = structlog.get_logger()
            try:
                result: R = func(*args, **kwargs)
                span.set_status(StatusCode.OK)
                log.info("op_ok", operation=func.__qualname__)
                return result
            except Exception as exc:
                span.record_exception(exc)
                span.set_status(StatusCode.ERROR, str(exc))
                log.error("op_fail", operation=func.__qualname__, error=str(exc))
                raise
    return wrapper


async def emit_async_operation(operation: str, amount_cents: int) -> None:
    """Use BoundLogger async methods; AsyncBoundLogger wrapper is deprecated."""
    log: structlog.stdlib.BoundLogger = structlog.get_logger()
    await log.ainfo("op_async", operation=operation, amount_cents=amount_cents)
```

## 10. Protocol-first interfaces and adapters

```python
"""pinnacle/protocols/repo.py — Protocol definitions + concrete adapter."""

# --- [IMPORTS] -------------------------------------------------------------
from typing import Protocol, Self, TypeVar, runtime_checkable

from pinnacle.domain.atoms import UserId
from pinnacle.domain.models import User
from returns.result import Failure, Result, Success


# --- [CODE] ----------------------------------------------------------------

T = TypeVar("T")


@runtime_checkable
class Repository(Protocol[T]):
    async def get(self, entity_id: int) -> Result[T, Exception]: ...
    async def save(self, entity: T) -> Result[int, Exception]: ...


class FluentBuilder(Protocol):
    def with_timeout(self, seconds: float) -> Self: ...
    def with_retries(self, count: int) -> Self: ...


# ── Pure core function depending only on Protocol ────────────────────
async def transfer_user(
    source: Repository[User],
    target: Repository[User],
    user_id: UserId,
) -> Result[UserId, Exception]:
    match await source.get(user_id):
        case Success(user):
            return await target.save(user)
        case Failure() as err:
            return err


# ── Concrete adapter satisfying Repository[User] ────────────────────
class InMemoryUserRepo:
    __slots__ = ("_data",)

    def __init__(self, initial: tuple[tuple[int, User], ...] = ()) -> None:
        self._data: dict[int, User] = dict(initial)

    async def get(self, entity_id: int) -> Result[User, Exception]:
        match self._data.get(entity_id):
            case None:
                return Failure(KeyError(f"User {entity_id} not found"))
            case user:
                return Success(user)

    async def save(self, entity: User) -> Result[int, Exception]:
        self._data = {**self._data, entity.user_id: entity}
        return Success(entity.user_id)
```

## 11. Testing with hypothesis

```python
"""tests/test_ops.py — Property-based and stateful testing."""

# --- [IMPORTS] -------------------------------------------------------------
import anyio
import pytest
from hypothesis import given, settings, strategies as st
from hypothesis.stateful import RuleBasedStateMachine, invariant, rule
from pinnacle.domain.atoms import Email, Money, UserId, make_email, make_user_id
from pinnacle.domain.models import Address, User
from pinnacle.protocols.repo import InMemoryUserRepo
from pydantic import TypeAdapter
from returns.result import Failure, Success


# --- [CODE] ----------------------------------------------------------------

# ── Composite strategies for typed atoms ─────────────────────────────
email_st: st.SearchStrategy[str] = st.from_regex(
    r"^[a-z]{3,10}@[a-z]{3,8}\.[a-z]{2,4}$"
)
user_id_st: st.SearchStrategy[int] = st.integers(min_value=1, max_value=2**31)
money_st: st.SearchStrategy[str] = st.decimals(
    min_value="0.01", max_value="999999.99", places=2,
).map(str)

address_st: st.SearchStrategy[Address] = st.builds(
    Address,
    street=st.text(min_size=1, max_size=50),
    city=st.text(min_size=1, max_size=30),
    country_code=st.sampled_from(["US", "GB", "DE", "FR", "JP"]),
)

# ── st.builds for Pydantic models ───────────────────────────────────
user_st: st.SearchStrategy[User] = st.builds(
    User,
    user_id=user_id_st,
    email=email_st,
    name=st.text(min_size=1, max_size=50),
    address=address_st,
)


@given(user=user_st)
def test_user_roundtrips_json(user: User) -> None:
    raw: bytes = TypeAdapter(User).dump_json(user)
    restored: User = TypeAdapter(User).validate_json(raw)
    assert restored.user_id == user.user_id


@given(raw_id=st.integers())
def test_make_user_id_never_raises(raw_id: int) -> None:
    match make_user_id(raw_id):
        case Success(uid):
            assert uid > 0
        case Failure(msg):
            assert "positive" in msg


@given(raw_email=st.text(max_size=100))
def test_make_email_total(raw_email: str) -> None:
    match make_email(raw_email):
        case Success(_):
            pass
        case Failure(_):
            pass


# ── Stateful testing for Repository protocol ─────────────────────────
class RepositoryStateMachine(RuleBasedStateMachine):
    def __init__(self) -> None:
        super().__init__()
        self.repo: InMemoryUserRepo = InMemoryUserRepo()
        self.model: dict[int, User] = {}

    @rule(user=user_st)
    def save_user(self, user: User) -> None:
        result = anyio.from_thread.run(self.repo.save, user)
        self.model = {**self.model, user.user_id: user}
        match result:
            case Success(uid):
                assert uid == user.user_id
            case _:
                pass

    @invariant()
    def size_matches(self) -> None:
        assert len(self.repo._data) == len(self.model)


TestRepository = RepositoryStateMachine.TestCase
```

## 12. Anti-patterns

**1. DTO soup** — Untyped dicts flow across layers, blurring domain boundaries → Define frozen Pydantic models and share typed atoms system-wide.
```python
# --- [CODE] ----------------------------------------------------------------

class UserDTO(BaseModel, frozen=True):
    user_id: UserId
    email: Email
```

**2. @wraps-only decorators** — Runtime name preserved but type signature erased under strict type-checking (ty) → Always pair `ParamSpec` with `@wraps`.
```python
# --- [CODE] ----------------------------------------------------------------

def logged[**P, R](func: Callable[P, R]) -> Callable[P, R]:
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        return func(*args, **kwargs)
    return wrapper
```

**3. Exception-driven control flow** — `try/except` for expected paths hides logic branches and defeats exhaustiveness → Return `Result`.
```python
# --- [CODE] ----------------------------------------------------------------

@safe
def parse_age(raw: str) -> int:
    return int(raw)
# Caller matches Success/Failure instead of catching ValueError
```

**4. isinstance dispatch** — Chains of isinstance degrade with each new type and lack exhaustiveness → Use `match`/`case`.
```python
# --- [CODE] ----------------------------------------------------------------

def area(shape: Circle | Rect) -> float:
    match shape:
        case Circle(radius=r):
            return 3.14159 * r * r
        case Rect(w=w, h=h):
            return w * h
```

**5. Bare dict/list** — Untyped containers propagate `Any` silently → Use `tuple`, `frozenset`, or `Mapping` with explicit type params.
```python
# --- [CODE] ----------------------------------------------------------------

Scores = tuple[tuple[UserId, Money], ...]
```

**6. Mutable defaults** — Shared mutable default arguments cause cross-call contamination → Use `None` sentinel + immutable factory.
```python
# --- [CODE] ----------------------------------------------------------------

def fetch(ids: tuple[int, ...] = ()) -> tuple[User, ...]:
    return tuple(lookup(i) for i in ids)
```

**7. Import-time side effects** — Module-level IO (DB connections, HTTP calls) breaks testability and free-threaded safety → Defer to explicit `boot()` functions.
```python
# --- [CODE] ----------------------------------------------------------------

def boot() -> AppSettings:
    return AppSettings()  # reads env at call time, not import time
```

**8. Global mutable state in async** — Shared mutable singletons race under free-threading and concurrent tasks → Use `ContextVar` for request-scoped state.
```python
# --- [CODE] ----------------------------------------------------------------

_cid: ContextVar[str] = ContextVar("cid", default="none")
```

**9. Async iteration without checkpoints** — Tight async loops starve the scheduler → Insert explicit `checkpoint()` calls.
```python
# --- [CODE] ----------------------------------------------------------------

results: tuple[int, ...] = tuple(
    await _process(item) for item in items  # each await is a checkpoint
)
```

**10. runtime_checkable misuse** — Using `isinstance(x, Protocol)` for structural checks at runtime only verifies method *existence*, not *signatures* → Reserve `runtime_checkable` for adapter registration; use beartype for full checks.
```python
# --- [CODE] ----------------------------------------------------------------

@runtime_checkable
class Repo(Protocol[T]):
    async def get(self, entity_id: int) -> Result[T, Exception]: ...
# Use beartype for signature enforcement, isinstance only for registration
```

**11. Framework-first design** — Domain logic coupled to Flask/FastAPI request objects → Depend on Protocols; frameworks live in adapters only.
```python
# --- [CODE] ----------------------------------------------------------------

async def create_user(repo: Repository[User], data: UserDTO) -> Result[UserId, Exception]:
    return await repo.save(data)  # no framework imports
```

**12. Any/cast erasure** — `Any` and `cast()` silence type errors without fixing them → Use `TypeVar` bounds, `Annotated`, or `TypeForm`.
```python
# --- [CODE] ----------------------------------------------------------------

def narrow[V](form: TypeForm[V], raw: object) -> Result[V, str]: ...
```

**13. Pydantic models with behavior** — Business logic inside models couples validation to orchestration → Models are pure data; logic lives in `ops/` pipelines.
```python
# --- [CODE] ----------------------------------------------------------------

class Order(BaseModel, frozen=True):
    total: Money  # no methods beyond computed_field
```

**14. God decorators** — Single decorator doing auth + logging + caching + retry → One decorator per concern; compose via stacking.
```python
# --- [CODE] ----------------------------------------------------------------

@trace_span(TraceConfig())
@retry(RetryConfig(), on=IOError)
def fetch_data(url: str) -> bytes: ...
```

**15. Implicit coupling** — Module A imports Module B's internals → Depend on Protocols in `protocols/`; never import from `adapters/` into `domain/`.
```python
# --- [CODE] ----------------------------------------------------------------

async def transfer(source: Repository[User], target: Repository[User]) -> ...:
    ...  # depends on Protocol, not on InMemoryUserRepo
```

**16. @dataclass for validated data** — `@dataclass` provides no validation or schema generation → Use Pydantic `BaseModel(frozen=True)` at boundaries.
```python
# --- [CODE] ----------------------------------------------------------------

class Config(BaseModel, frozen=True):
    timeout: Annotated[float, Field(gt=0)]
```

**17. Untyped ParamSpec** — Decorator uses `**kwargs: Any` instead of `ParamSpec` → Always bind `P = ParamSpec("P")`.
```python
# --- [CODE] ----------------------------------------------------------------

P = ParamSpec("P")
R = TypeVar("R")
def deco(f: Callable[P, R]) -> Callable[P, R]: ...
```

**18. String-based discriminated union dispatch** — Manual `data["type"]` lookups with no exhaustiveness → Use Pydantic `Discriminator` + `Tag`.
```python
# --- [CODE] ----------------------------------------------------------------

Payment = Annotated[
    Union[Annotated[CardPayment, Tag("card")], Annotated[BankPayment, Tag("bank")]],
    Discriminator(_payment_disc),
]
```

**19. Optional masking failure semantics** — `Optional[T]` conflates "absent" with "failed" → Use `Maybe` for absence, `Result` for failure.
```python
# --- [CODE] ----------------------------------------------------------------

def find(uid: UserId) -> Maybe[User]: ...   # absence
def parse(raw: str) -> Result[User, str]: ... # failure
```

**20. Free-threaded CPython GIL assumptions** — Code assumes GIL protects shared state; races silently under `python3.14t` → Design for immutability; use `ContextVar` for scoped state; audit all shared mutables.
```python
# --- [CODE] ----------------------------------------------------------------

# WRONG mental model: "GIL protects my dict"
# Correct: frozen models + ContextVar + explicit locks for truly shared state
_request_ctx: ContextVar[str] = ContextVar("ctx", default="")
```

## 13. Further considerations

### Deferred annotations reshape the decorator-metaclass contract

PEP 649 changes when annotations become available. Under eager semantics, a class decorator could inspect `cls.__annotations__` immediately. Under deferred semantics, `cls.__annotations__` triggers `cls.__annotate__(Format.VALUE)` on first access, which may fail if referenced names are not yet defined. **Decorators and metaclasses that inspect annotations at class-creation time must migrate to `annotationlib.get_annotations(cls, format=Format.FORWARDREF)`**, which returns `ForwardRef` proxies instead of raising `NameError`. Libraries like Pydantic v2.12+ and attrs have already adapted, but custom metaclasses and descriptor-based decorators that read `__annotations__` directly will break silently — returning stale or empty dicts — unless updated. The `annotationlib` module's three-format API (`VALUE`, `FORWARDREF`, `STRING`) gives decorators fine-grained control: use `FORWARDREF` during class construction, resolve to `VALUE` lazily when the full module scope is available.

### Free-threaded CPython demands immutable decorator stacks

Under `python3.14t` (GIL disabled, PEP 779 Phase II), decorator closures that capture mutable state — caches, counters, rate-limit buckets — become **data races** when the decorated function is called from multiple threads simultaneously. The single-threaded overhead of the free-threaded build has dropped to **~5–10%** in 3.14 (from ~40% in 3.13), making production deployment viable, but the threading model is fundamentally different. **Every decorator in a cross-cutting stack must either close over immutable data or use `ContextVar` for scoped state.** The cache decorator in Section 4b, for example, must be wrapped in a `threading.Lock` or replaced with a concurrent-safe LRU under free-threading. Frozen Pydantic models, immutable `msgspec.Struct(frozen=True, gc=False)`, and `tuple`-based collections are inherently thread-safe and should be the default vocabulary for all shared data. The `contextvars` module is the correct primitive for request-scoped state because each `anyio` task and each thread automatically gets an isolated context snapshot.

### TypeForm + beartype unlock typed runtime validation without Any leaks

Before `TypeForm`, functions accepting "a type" as an argument had to annotate it as `type[T]` — which excludes unions, `Annotated`, `TypedDict`, `Literal`, and `Protocol`. This forced runtime validators like beartype's `is_bearable()` and Pydantic's `TypeAdapter` to accept `Any`, punching a hole in the type graph. With `TypeForm[T]` from `typing_extensions` v4.15 (tracking draft PEP 747), a function can declare `def validate(form: TypeForm[T], data: object) -> T` and type checkers will verify that callers pass valid type expressions — including `int | None`, `Annotated[str, MinLen(1)]`, and `Literal["a", "b"]` — while preserving the relationship between the form and the return type via the bound `T`. This closes the last major `Any` leak in validation-heavy architectures. Beartype's `die_if_unbearable(obj, TypeForm[T])` and Pydantic's `TypeAdapter(TypeForm[T])` both benefit, and the narrowing function in Section 1 demonstrates the pattern: accept `TypeForm[V]`, return `Result[V, str]`, with the type parameter flowing through the entire railway pipeline.
