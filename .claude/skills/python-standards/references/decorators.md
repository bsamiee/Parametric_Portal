# [H1][DECORATORS]
>**Dictum:** *Decorators are typed algebra — ParamSpec preserves signatures, frozen config drives factories, descriptor protocol binds context, ordering validates at import time.*

Python-native decorator architecture for 3.14+. Cross-references: effects.md [3], observability.md [1], protocols.md [1].

---
## [1][PARAMSPEC_ALGEBRA]
>**Dictum:** *`@wraps` preserves runtime identity; `ParamSpec` preserves static identity. Frozen config drives factory decorators.*

Graduated progression: identity decorator, `Concatenate` prepend, traced factory with frozen config, `@safe` for fallible parse.

```python
from collections.abc import Callable
from functools import wraps
from typing import Concatenate, cast
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from pydantic import BaseModel, ConfigDict
from returns.result import Result, Success, safe

class TraceConfig(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    record_args: bool = False
    span_name: str | None = None

def transparent[**P, R](func: Callable[P, R]) -> Callable[P, R]:
    """Identity decorator — ParamSpec + wraps preserves everything."""
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
                    case _:
                        pass
                result = cast(Callable[..., object], func)(*args, **kwargs)
                span.set_status(StatusCode.OK)
                return result
        return cast(Callable[P, R], wrapper)
    return cast(Callable[[Callable[P, R]], Callable[P, R]], decorator)

@safe
def parse_config(raw: str) -> TraceConfig:
    """Fallible parse returning Result[TraceConfig, Exception]."""
    return TraceConfig.model_validate_json(raw)
```

[CRITICAL]:
- [ALWAYS] Pair `ParamSpec` with `@wraps` — runtime metadata and static signature both required.
- [ALWAYS] Declare decorator config as `BaseModel(frozen=True)` — mutable closures race under free-threading.
- [ALWAYS] Use `@safe` from returns to wrap fallible sync operations — never bare `try/except`.
- [NEVER] Return `Callable[..., Any]` — erases the entire downstream type graph.

---
## [2][CLASS_INSTRUMENTATION]
>**Dictum:** *`Validated` descriptor + `Traceable.__init_subclass__` instruments public methods without metaclass machinery.*

```python
from collections.abc import Callable
from functools import wraps
from typing import ClassVar, overload

class Validated[**P, R]:
    """Method descriptor injecting validation via __get__ binding.

    NOTE: ParamSpec limitation -- when accessed on an instance, the returned
    bound function has `self` already applied, so its actual signature is
    `P minus first arg`. Python's type system cannot express "ParamSpec minus
    first parameter", so the instance overload uses `Callable[..., R]` to
    acknowledge this gap. The class-level access preserves the full `P`.
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
        # Side-effect boundary: __init_subclass__ is inherently imperative --
        # class mutation via setattr is required by the descriptor protocol.
        public: tuple[tuple[str, Callable[..., object]], ...] = tuple(
            (name, method) for name, method in vars(cls).items()
            if callable(method) and not name.startswith("_")
        )
        for name, method in public:
            setattr(cls, name, trace_span(TraceConfig(span_name=f"{cls._trace_name}.{name}"))(method))

class UserCommandHandler(Traceable, trace_name="user"):
    def create(self, payload: bytes) -> None: ...
    def update(self, payload: bytes) -> None: ...
```

[IMPORTANT]:
- [ALWAYS] `__set_name__` + `__get__` for class-aware descriptors — not metaclasses.
- [ALWAYS] `__init_subclass__` for hierarchy-wide instrumentation — filter `not name.startswith("_")`.
- [NEVER] Store mutable state on descriptor instances — shared across all instances of the owning class.

---
## [3][ORDERING_ALGEBRA]
>**Dictum:** *Decorator ordering is validated at import time via pure recursion — invalid stacks fail before IO.*

Canonical order (outermost to innermost): **trace > retry > cache > validate > authorize**.

```python
from collections.abc import Callable
from typing import Protocol
from returns.result import Failure, Result, Success

CANONICAL_ORDER = ("trace", "retry", "cache", "validate", "authorize")

class _Tagged(Protocol):
    __decorator_tag__: str

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
        map(CANONICAL_ORDER.index, filter(lambda n: n in CANONICAL_ORDER, names))
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
    """Attach ordering tag to decorated function via object.__setattr__."""
    object.__setattr__(func, "__decorator_tag__", tag)
    return func
```

[CRITICAL]:
- [ALWAYS] Validate ordering at import time — misordering must fail before any request is served.
- [ALWAYS] Use structural pattern matching for `__wrapped__` chain walking — no `getattr`.
- [NEVER] Place `@authorize` outside `@trace` — authorization decisions must be observable.

---
## [4][ASYNC_DECORATORS]
>**Dictum:** *Async decorators thread environment via `Concatenate[Env, P]`, integrate stamina retry + returns safe capture.*

Stack order: `@future_safe` OUTER, `@stamina.retry` INNER. `on` accepts exception type, tuple, or predicate.

```python
from collections.abc import Callable
from functools import wraps
from typing import Concatenate, cast
import stamina
from opentelemetry import trace
from pydantic import BaseModel, ConfigDict
from returns.future import FutureResult

class RetryConfig(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    max_attempts: int = 3
    timeout_seconds: float = 30.0

def trace_async[Env, **P](
    span_name: str,
) -> Callable[
    [Callable[Concatenate[Env, P], FutureResult[object, Exception]]],
    Callable[Concatenate[Env, P], FutureResult[object, Exception]],
]:
    """Async trace decorator threading Env through Concatenate. Tracer acquired at call time."""
    def decorator(
        func: Callable[Concatenate[Env, P], FutureResult[object, Exception]],
    ) -> Callable[Concatenate[Env, P], FutureResult[object, Exception]]:
        @wraps(func)
        def wrapper(env: Env, *args: object, **kwargs: object) -> object:
            tracer: trace.Tracer = trace.get_tracer("pinnacle")
            with tracer.start_as_current_span(span_name) as span:
                match env:
                    case object(correlation_id=str() as cid):
                        span.set_attribute("correlation_id", cid)
                    case _: pass
                return cast(Callable[..., object], func)(env, *args, **kwargs)
        return cast(Callable[Concatenate[Env, P], FutureResult[object, Exception]], wrapper)
    return cast(
        Callable[
            [Callable[Concatenate[Env, P], FutureResult[object, Exception]]],
            Callable[Concatenate[Env, P], FutureResult[object, Exception]],
        ],
        decorator,
    )

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

# Correct async decorator composition:
# @returns.future.future_safe         # OUTER — captures final outcome as Result
# @stamina.retry(on=ConnectionError)  # INNER — retries on exception
# @trace_async("user.create")         # innermost — observes each attempt
# def create_user(env: AppEnv, payload: bytes) -> User: ...
```

[IMPORTANT]:
- [ALWAYS] Stack order: `@future_safe` OUTER, `@stamina.retry` INNER.
- [ALWAYS] Use `Concatenate[Env, P]` when threading an environment parameter.
- [NEVER] Unwrap async results inside the decorator — preserve `FutureResult` return type.

---
## [5][RULES]
>**Dictum:** *Rules compress into constraints.*

- [ALWAYS] `ParamSpec` + `@wraps` on every decorator — both static and runtime identity preserved.
- [ALWAYS] Frozen `BaseModel` for decorator config — mutable closures race under free-threading.
- [ALWAYS] `@safe` / `@future_safe` for fallible operations — never bare `try/except`.
- [ALWAYS] `__set_name__` + `__get__` for class-aware descriptors — not metaclasses.
- [ALWAYS] `__init_subclass__` for hierarchy-wide instrumentation — filter `not name.startswith("_")`.
- [ALWAYS] Validate ordering at import time via structural matching on `__wrapped__` chain.
- [ALWAYS] `Concatenate[Env, P]` for async decorators threading environment.
- [ALWAYS] Stack `@future_safe` OUTER, `@stamina.retry` INNER for retried fallible async ops.
- [NEVER] Return `Callable[..., Any]` — erases the downstream type graph.
- [NEVER] Capture mutable state in decorator closures — use `ContextVar` or frozen config.
- [NEVER] Use `getattr` for attribute probing — use structural `match`/`case` with `object(attr=...)`.

---
## [6][QUICK_REFERENCE]

- `ParamSpec + @wraps`: preserve static signature and runtime metadata.
- `Concatenate[Ctx, P]`: prepend injected context without erasing caller shape.
- Frozen config factories: `BaseModel(frozen=True)` for deterministic closure state.
- `@safe` / `@future_safe`: convert raised exceptions into typed containers.
- Descriptor protocol: `__set_name__` + `__get__` for class-aware decorators.
- `__init_subclass__`: hierarchy-wide instrumentation without metaclass coupling.
- Ordering algebra: recursive `__wrapped__` walk validates stack order at import time.
- `@stamina.retry`: retried fallible operations with explicit retry contract.
- Async retry capture: `@future_safe` outer, retry inner.
- Async env threading: `Concatenate[Env, P]` keeps `FutureResult` return type intact.
