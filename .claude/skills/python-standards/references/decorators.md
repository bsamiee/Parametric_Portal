# [H1][DECORATORS]
>**Dictum:** *Decorators are typed algebra -- ParamSpec preserves signatures, frozen config drives factories, descriptor protocol binds context, ordering validates at import time.*

<br>

Python-native decorator architecture for 3.14+. Cross-references: `effects.md` [3], `observability.md` [1], `protocols.md` [1].

---
## [1][PARAMSPEC_ALGEBRA]
>**Dictum:** *`@wraps` preserves runtime identity; `ParamSpec` preserves static identity. Frozen config drives factory decorators.*

<br>

Graduated progression: identity decorator, `Concatenate` prepend, traced factory with frozen config, `@safe` for fallible parse.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from collections.abc import Callable
from functools import wraps
from typing import Concatenate, cast
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from pydantic import BaseModel, ConfigDict
from returns.result import safe

# --- [CLASSES] ----------------------------------------------------------------

class TraceConfig(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    record_args: bool = False
    span_name: str | None = None

# --- [FUNCTIONS] --------------------------------------------------------------

def transparent[**P, R](func: Callable[P, R]) -> Callable[P, R]:
    """Identity decorator -- ParamSpec + wraps preserves everything."""
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        return func(*args, **kwargs)
    return cast(Callable[P, R], wrapper)

def inject_context[Ctx, **P, R](
    ctx: Ctx,
) -> Callable[[Callable[Concatenate[Ctx, P], R]], Callable[P, R]]:
    """Factory prepending a context argument via Concatenate."""
    def decorator(func: Callable[Concatenate[Ctx, P], R]) -> Callable[P, R]:
        @wraps(func)
        def wrapper(*args: object, **kwargs: object) -> object:
            return cast(Callable[..., object], func)(ctx, *args, **kwargs)
        return cast(Callable[P, R], wrapper)
    return cast(Callable[[Callable[Concatenate[Ctx, P], R]], Callable[P, R]], decorator)

def trace_span[**P, R](
    config: TraceConfig = TraceConfig(),
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """OpenTelemetry span factory with frozen config. Tracer acquired at call time."""
    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        name: str = config.span_name or "operation"
        @wraps(func)
        def wrapper(*args: object, **kwargs: object) -> object:
            tracer: trace.Tracer = trace.get_tracer("pinnacle")
            with tracer.start_as_current_span(name) as span:
                match config:
                    case TraceConfig(record_args=True):
                        span.set_attribute("args", repr(args)[:256])
                    case _: pass
                result = cast(Callable[..., object], func)(*args, **kwargs)
                span.set_status(StatusCode.OK)
                return result
        return cast(Callable[P, R], wrapper)
    return cast(Callable[[Callable[P, R]], Callable[P, R]], decorator)

@safe
def parse_config(raw: str) -> TraceConfig:
    return TraceConfig.model_validate_json(raw)
```

[CRITICAL]:
- [ALWAYS] Pair `ParamSpec` with `@wraps` -- runtime metadata and static signature both required.
- [ALWAYS] Declare decorator config as `BaseModel(frozen=True)` -- mutable closures race under free-threading.
- [ALWAYS] Use `@safe` from returns to wrap fallible sync operations -- never bare `try/except`.
- [NEVER] Return `Callable[..., Any]` -- erases the entire downstream type graph.

---
## [2][CLASS_LEVEL_PATTERNS]
>**Dictum:** *Descriptors bind context, `__init_subclass__` instruments hierarchies, ordering validates at import time -- all class-scoped.*

<br>

Three unified patterns: `Validated` descriptor for method-level injection via `__get__` binding, `Traceable.__init_subclass__` for hierarchy-wide auto-instrumentation, and canonical ordering validation as a class decorator via pure recursive `__wrapped__` chain walking. Canonical order (outermost to innermost): **trace > retry > cache > validate > authorize**.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from collections.abc import Callable
from functools import wraps
from typing import ClassVar, Protocol, overload
from returns.result import Failure, Result, Success

# --- [CONSTANTS] --------------------------------------------------------------

CANONICAL_ORDER: tuple[str, ...] = ("trace", "retry", "cache", "validate", "authorize")

# --- [CLASSES] ----------------------------------------------------------------

class _Tagged(Protocol):
    __decorator_tag__: str

class Validated[**P, R]:
    """Method descriptor injecting validation via __get__ binding.
    NOTE: Instance overload uses Callable[..., R] because Python's type system
    cannot express "ParamSpec minus first parameter" after self-binding.
    """
    __slots__ = ("_func", "_owner", "_name")

    def __init__(self, func: Callable[P, R]) -> None:
        self._func: Callable[P, R] = func
        self._owner: type | None = None
        self._name: str = "validated"
    def __set_name__(self, owner: type, name: str) -> None:
        self._owner = owner
        self._name = name

    @overload
    def __get__(self, obj: None, objtype: type) -> Callable[P, R]: ...
    @overload
    def __get__(self, obj: object, objtype: type) -> Callable[..., R]: ...
    def __get__(self, obj: object | None, objtype: type | None = None) -> Callable[..., R]:
        match obj:
            case None: return self._func
            case instance:
                @wraps(self._func)
                def bound(*args: P.args, **kwargs: P.kwargs) -> R:
                    return self._func(instance, *args, **kwargs)
                return bound
    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R:
        return self._func(*args, **kwargs)

class Traceable:
    """All subclasses auto-instrument public methods with trace spans."""
    _trace_name: ClassVar[str] = ""
    def __init_subclass__(cls, /, trace_name: str = "", **kwargs: object) -> None:
        super().__init_subclass__(**kwargs)
        cls._trace_name = trace_name or cls.__qualname__
        # Side-effect boundary: class mutation via setattr required by descriptor protocol
        public: tuple[tuple[str, Callable[..., object]], ...] = tuple(
            (name, method) for name, method in vars(cls).items()
            if callable(method) and not name.startswith("_")
        )
        for name, method in public:
            setattr(cls, name, trace_span(TraceConfig(span_name=f"{cls._trace_name}.{name}"))(method))

class UserCommandHandler(Traceable, trace_name="user"):
    def create(self, payload: bytes) -> None: ...
    def update(self, payload: bytes) -> None: ...

# --- [FUNCTIONS] --------------------------------------------------------------

def _extract_names(func: Callable[..., object]) -> tuple[str, ...]:
    """Recursively walk __wrapped__ chain collecting decorator tags."""
    match func:
        case object(__wrapped__=inner, __decorator_tag__=str() as tag):
            return (tag, *_extract_names(inner))
        case object(__wrapped__=inner):
            return ("?", *_extract_names(inner))
        case _:
            return ()

def _is_ordered(names: tuple[str, ...]) -> bool:
    known: tuple[int, ...] = tuple(
        map(CANONICAL_ORDER.index, filter(lambda name: name in CANONICAL_ORDER, names))
    )
    return known == tuple(sorted(known))

def validate_ordering[T](cls: type[T]) -> Result[type[T], str]:
    """Class decorator asserting all methods follow CANONICAL_ORDER."""
    violations: tuple[str, ...] = tuple(map(
        lambda pair: f"{pair[0]}: {pair[1]}",
        filter(
            lambda pair: not _is_ordered(pair[1]),
            map(
                lambda pair: (pair[0], _extract_names(pair[1])),
                filter(lambda pair: callable(pair[1]), vars(cls).items()),
            ),
        ),
    ))
    match violations:
        case (): return Success(cls)
        case (first, *rest):
            return Failure(f"Ordering violations in {cls.__name__}: " + ", ".join((first, *rest)))

def _tag_decorator[**P, R](tag: str, func: Callable[P, R]) -> Callable[P, R]:
    setattr(func, "__decorator_tag__", tag)
    return func
```

[IMPORTANT]:
- [ALWAYS] `__set_name__` + `__get__` for class-aware descriptors -- not metaclasses.
- [ALWAYS] `__init_subclass__` for hierarchy-wide instrumentation -- filter `not name.startswith("_")`.
- [ALWAYS] Validate ordering at import time -- misordering must fail before any request is served.
- [NEVER] Store mutable state on descriptor instances -- shared across all class instances.
- [NEVER] Place `@authorize` outside `@trace` -- authorization decisions must be observable.

---
## [3][ASYNC_DECORATORS]
>**Dictum:** *Async decorators thread environment via `Concatenate[Env, P]`, integrate stamina retry + returns safe capture.*

<br>

Type alias compresses repeated async decorator signatures. Stack order: `@future_safe` OUTER, `@stamina.retry` INNER.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from collections.abc import Callable
from functools import wraps
from typing import Concatenate, cast
import stamina
from opentelemetry import trace
from pydantic import BaseModel, ConfigDict
from returns.future import FutureResult

# --- [TYPES] ------------------------------------------------------------------

type AsyncEnvFn[Env, **P] = Callable[Concatenate[Env, P], FutureResult[object, Exception]]

# --- [CLASSES] ----------------------------------------------------------------

class RetryConfig(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    max_attempts: int = 3
    timeout_seconds: float = 30.0

# --- [FUNCTIONS] --------------------------------------------------------------

def trace_async[Env, **P](
    span_name: str,
) -> Callable[[AsyncEnvFn[Env, P]], AsyncEnvFn[Env, P]]:
    """Async trace threading Env through Concatenate. Tracer acquired at call time."""
    def decorator(func: AsyncEnvFn[Env, P]) -> AsyncEnvFn[Env, P]:
        @wraps(func)
        def wrapper(env: Env, *args: object, **kwargs: object) -> object:
            tracer: trace.Tracer = trace.get_tracer("pinnacle")
            with tracer.start_as_current_span(span_name) as span:
                match env:
                    case object(correlation_id=str() as correlation_id):
                        span.set_attribute("correlation_id", correlation_id)
                    case _: pass
                return cast(Callable[..., object], func)(env, *args, **kwargs)
        return cast(AsyncEnvFn[Env, P], wrapper)
    return cast(Callable[[AsyncEnvFn[Env, P]], AsyncEnvFn[Env, P]], decorator)

def retry_async[**P, A](
    config: RetryConfig,
    on: type[Exception] | tuple[type[Exception], ...] = Exception,
) -> Callable[[Callable[P, A]], Callable[P, A]]:
    """stamina-backed retry with frozen config."""
    def decorator(func: Callable[P, A]) -> Callable[P, A]:
        @wraps(func)
        @stamina.retry(on=on, attempts=config.max_attempts, timeout=config.timeout_seconds)
        def wrapper(*args: object, **kwargs: object) -> object:
            return cast(Callable[..., object], func)(*args, **kwargs)
        return cast(Callable[P, A], wrapper)
    return cast(Callable[[Callable[P, A]], Callable[P, A]], decorator)

# Correct composition: @future_safe (OUTER) > @stamina.retry (INNER) > @trace_async (innermost)
# def create_user(env: AppEnv, payload: bytes) -> User: ...
```

[IMPORTANT]:
- [ALWAYS] Stack order: `@future_safe` OUTER, `@stamina.retry` INNER.
- [ALWAYS] Use `Concatenate[Env, P]` when threading an environment parameter.
- [NEVER] Unwrap async results inside the decorator -- preserve `FutureResult` return type.

---
## [4][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] `ParamSpec` + `@wraps` on every decorator -- both static and runtime identity preserved.
- [ALWAYS] Frozen `BaseModel` for decorator config -- mutable closures race under free-threading.
- [ALWAYS] `@safe` / `@future_safe` for fallible operations -- never bare `try/except`.
- [ALWAYS] `__set_name__` + `__get__` for class-aware descriptors -- not metaclasses.
- [ALWAYS] `__init_subclass__` for hierarchy-wide instrumentation -- filter `not name.startswith("_")`.
- [ALWAYS] Validate ordering at import time via structural matching on `__wrapped__` chain.
- [ALWAYS] `Concatenate[Env, P]` for async decorators threading environment.
- [ALWAYS] Stack `@future_safe` OUTER, `@stamina.retry` INNER for retried fallible async ops.
- [ALWAYS] PEP 695 `type` aliases for repeated complex callable signatures.
- [ALLOW] `expression.curry(n)` for auto-curried partial application in domain/collection modules.
- [NEVER] Return `Callable[..., Any]` -- erases the downstream type graph.
- [NEVER] Capture mutable state in decorator closures -- use `ContextVar` or frozen config.
- [NEVER] Use `getattr` for attribute probing -- use structural `match/case` with `object(attr=...)`.

---
## [5][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                | [WHEN]                               | [KEY_TRAIT]                               |
| :-----: | ------------------------ | ------------------------------------ | ----------------------------------------- |
|   [1]   | `ParamSpec` + `@wraps`   | Every decorator                      | Static signature + runtime metadata       |
|   [2]   | `Concatenate[Ctx, P]`    | Prepend injected context             | Caller shape preserved                    |
|   [3]   | Frozen config factory    | Decorator with configuration         | `BaseModel(frozen=True)` closure state    |
|   [4]   | `@safe` / `@future_safe` | Fallible sync/async capture          | Exceptions -> typed containers            |
|   [5]   | Descriptor protocol      | Class-aware method decorators        | `__set_name__` + `__get__` binding        |
|   [6]   | `__init_subclass__`      | Hierarchy-wide instrumentation       | No metaclass coupling                     |
|   [7]   | Ordering algebra         | Validate decorator stack order       | Recursive `__wrapped__` walk at import    |
|   [8]   | `AsyncEnvFn` type alias  | Compress repeated async signatures   | PEP 695 `type` alias for readability      |
|   [9]   | `@stamina.retry`         | Retried fallible operations          | Explicit attempt count + timeout contract |
|  [10]   | Async env threading      | Environment through async decorators | `Concatenate[Env, P]` + `FutureResult`    |
|  [11]   | `expression.curry(n)`    | Auto-curried partial application     | Domain/collection module convenience      |
