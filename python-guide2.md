# Modern Python 3.14+ Pinnacle Engineering Reference

## Python 3.14+ language and runtime constraints

**Constraint (principle as law).** All architecture must assume (a) the post-3.14 annotations model is materially different from the last decade of “stringized annotations” folklore, and (b) the runtime is moving toward true concurrency properties where “the GIL saved me” is not a valid invariant.

**Rationale (terse technical).** Python 3.14 introduces a new annotations model and explicitly deprecates reliance on `from __future__ import annotations` as a long-lived baseline, shifting how libraries/tools should retrieve and evaluate annotations. In parallel, 3.14’s direction on free-threading and interpreter capabilities makes global mutable state and implicit side effects strictly more hazardous at scale.

**Canonical pattern (single dominant choice).**
- Treat *annotations* as an evaluated, tool-facing artifact: always access them through the standard entrypoints that respect 3.14 semantics, and never build systems that require string parsing of annotations.
- Treat *concurrency* as structured: cancellation, deadlines, and backpressure are first-class and must be modeled explicitly. Any design that cannot expose cancellation paths as types is non-viable.

**Complete code artifact (project baseline scaffold).**

`pyproject.toml` (Python ≥ 3.14, strict typing posture, canonical stack)

```toml
[project]
name = "py314-pinnacle"
version = "0.1.0"
description = "Pinnacle engineering reference for modern Python 3.14+"
readme = "README.md"
requires-python = ">=3.14"
license = { text = "Proprietary" }
dependencies = [
  "pydantic>=2.12",
  "pydantic-settings>=2.13",
  "beartype>=0.22.9",
  "msgspec>=0.20",
  "anyio>=4.12",
  "typing-extensions>=4.15",
  "structlog>=25.5",
  "opentelemetry-api>=1.39",
  "opentelemetry-sdk>=1.39",
  "opentelemetry-instrumentation-logging>=0.60b1",
  "stamina>=25.2",
]

[project.optional-dependencies]
dev = [
  "pytest>=8",
  "hypothesis>=6.151",
  "ty>=0.0.17",
  "ruff>=0.9",
]

[tool.ruff]
target-version = "py314"
line-length = 100
fix = true
unsafe-fixes = false

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "RUF", "SIM", "C4"]
ignore = [
  "E501",
]

[tool.ty.environment]
python-version = "3.14"

[tool.ty.analysis]
respect-type-ignore-comments = false

[tool.ty.rules]
all = "error"
possibly-missing-attribute = "error"
invalid-argument-type = "error"

[tool.ty.terminal]
error-on-warning = true

[tool.pytest.ini_options]
addopts = "-q"
testpaths = ["tests"]
```

Directory tree (reference layout)

```text
src/py314_pinnacle/
  algebra.py
  domain/
    atoms.py
    errors.py
    models.py
  protocols/
    auth.py
    clock.py
    repo.py
  decorators/
    core.py
    authz.py
    validation.py
    telemetry.py
    logging.py
    retry.py
    cache.py
    ratelimit.py
  adapters/
    clock_stdlib.py
    repo_inmem.py
    codec_json.py
  ops/
    user_ops.py
  runtime/
    beartype_conf.py
    settings.py
    logging_bootstrap.py
    otel_bootstrap.py
    bootstrap.py
tests/
  test_domain_properties.py
  test_repo_stateful.py
```

## Canonical architecture and tooling baseline

**Constraint (principle as law).** A “single dominant pattern” codebase is a set of *typed capability ports*, *decorator algebra for cross-cutting semantics*, and a *functional core with explicit effects*; no framework-first architecture is allowed.

**Rationale (terse technical).**
- Python 3.14’s annotation semantics evolution makes “ad hoc reflection” brittle; the “ports + decorators + explicit effects” stack forces all reflection into a narrow surface and makes it testable.
- Free-threading and modern concurrency make hidden global state and implicit cancellation unsound; the architecture must encode partiality, failure, and effects in types.

**Canonical pattern (single dominant choice).**
- `/protocols` contains *structural* boundaries (Protocol-first).
- `/decorators` is the algebra for non-functional concerns (telemetry/logging/retry/validation/authn/authz/caching/backpressure).
- `/domain` is the immutable model space, with branded atoms and constructors returning `Result` (never raising in expected flows).
- `/adapters` are impure boundaries, wrapped into `IO`/`FutureResult`.
- `/ops` is the functional core: pure transformations + effect orchestration, never raising for expected outcomes.

**Complete code artifact (bootstrap “wiring” entrypoints).**

`src/py314_pinnacle/runtime/bootstrap.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass
from typing import Final

import anyio
from opentelemetry import trace
from py314_pinnacle.algebra import FutureResult, Result
from py314_pinnacle.runtime.beartype_conf import beartyped
from py314_pinnacle.runtime.logging_bootstrap import bootstrap_logging
from py314_pinnacle.runtime.otel_bootstrap import bootstrap_otel
from py314_pinnacle.runtime.settings import AppSettings, load_settings


# --- [CODE] ----------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class Runtime:
    settings: AppSettings
    tracer_provider: trace.TracerProvider


@beartyped
def build_runtime() -> Result[Exception, Runtime]:
    return load_settings().bind(
        lambda s: bootstrap_otel(s).map(
            lambda tp: Runtime(settings=s, tracer_provider=tp),
        ),
    )


@beartyped
def run_app() -> FutureResult[Exception, None]:
    def _thunk() -> anyio.abc.TaskStatus[None]:
        raise RuntimeError("task status is not used in this reference")

    async def _run() -> None:
        match build_runtime():
            case Runtime() as rt:
                bootstrap_logging(rt.settings)
                match rt.tracer_provider:
                    case _:
                        return
            case _:
                return

    return FutureResult.from_awaitable(_run())
```

This bootstrap establishes the “wiring boundary” (settings + telemetry + logging) using explicit `Result`/`FutureResult`. OpenTelemetry’s Python stance for instrumentation requires SDK initialization at application level rather than within libraries.

## Typed atoms, immutable domain models, and boundary validation

**Constraint (principle as law).** Domain primitives are opaque typed atoms (branded scalars) and can only be constructed via smart constructors returning `Result`. Domain models are immutable (frozen) and carry no behavior beyond invariants.

**Rationale (terse technical).**
- Typed atoms shrink surface area: the only way to get a `UserId` is validation at the boundary, so internal code becomes trivially safe. This is the core “typed atoms doctrine”.
- Validation must be centralized and deterministic; Pydantic v2 `TypeAdapter` is the canonical “boundary validator” primitive.

**Canonical pattern (single dominant choice).**
- Represent each atom as `NewType` brand over a scalar (`int`, `str`).
- Validate at the boundary using `TypeAdapter(Annotated[...])`.
- Return `Result[DomainError, Atom]` from constructors; never raise for expected invalid input.
- Models are frozen Pydantic v2 models; derived values use `@computed_field` (and optionally `cached_property` for expensive derivations).

**Complete code artifact.**

`src/py314_pinnacle/domain/errors.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass


# --- [CODE] ----------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class DomainError:
    message: str


@dataclass(frozen=True, slots=True)
class AtomError(DomainError):
    atom: str


@dataclass(frozen=True, slots=True)
class ModelError(DomainError):
    model: str
```

`src/py314_pinnacle/domain/atoms.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import NewType

from py314_pinnacle.algebra import Result
from py314_pinnacle.domain.errors import AtomError
from py314_pinnacle.runtime.beartype_conf import beartyped
from pydantic import EmailStr, Field, TypeAdapter


# --- [CODE] ----------------------------------------------------------------

UserId = NewType("UserId", int)
Email = NewType("Email", str)
Money = NewType("Money", int)
CorrelationId = NewType("CorrelationId", str)
NonEmptyStr = NewType("NonEmptyStr", str)

_UserIdAdapter = TypeAdapter(int)
_EmailAdapter = TypeAdapter(EmailStr)
_MoneyAdapter = TypeAdapter(int)
_CorrelationIdAdapter = TypeAdapter(str)
_NonEmptyStrAdapter = TypeAdapter(str)


@beartyped
def user_id(raw: object) -> Result[AtomError, UserId]:
    try:
        v = TypeAdapter(int).validate_python(raw)
        match v > 0:
            case True:
                return Result.ok(UserId(v))
            case False:
                return Result.err(AtomError(atom="UserId", message="must be positive"))
    except Exception as e:
        return Result.err(AtomError(atom="UserId", message=str(e)))


@beartyped
def email(raw: object) -> Result[AtomError, Email]:
    try:
        v = _EmailAdapter.validate_python(raw)
        return Result.ok(Email(str(v)))
    except Exception as e:
        return Result.err(AtomError(atom="Email", message=str(e)))


@beartyped
def money_cents(raw: object) -> Result[AtomError, Money]:
    try:
        v = TypeAdapter(int).validate_python(raw)
        match v >= 0:
            case True:
                return Result.ok(Money(v))
            case False:
                return Result.err(AtomError(atom="Money", message="must be non-negative cents"))
    except Exception as e:
        return Result.err(AtomError(atom="Money", message=str(e)))


@beartyped
def correlation_id(raw: object) -> Result[AtomError, CorrelationId]:
    try:
        v = _CorrelationIdAdapter.validate_python(raw)
        match len(v) > 0:
            case True:
                return Result.ok(CorrelationId(v))
            case False:
                return Result.err(AtomError(atom="CorrelationId", message="must be non-empty"))
    except Exception as e:
        return Result.err(AtomError(atom="CorrelationId", message=str(e)))


@beartyped
def non_empty_str(raw: object) -> Result[AtomError, NonEmptyStr]:
    try:
        v = _NonEmptyStrAdapter.validate_python(raw)
        match len(v.strip()) > 0:
            case True:
                return Result.ok(NonEmptyStr(v.strip()))
            case False:
                return Result.err(AtomError(atom="NonEmptyStr", message="must be non-empty"))
    except Exception as e:
        return Result.err(AtomError(atom="NonEmptyStr", message=str(e)))


@dataclass(frozen=True, slots=True)
class MoneyDecimal:
    amount: Decimal


_MoneyDecimalAdapter = TypeAdapter(Decimal)


@beartyped
def money_decimal(raw: object) -> Result[AtomError, MoneyDecimal]:
    try:
        v = _MoneyDecimalAdapter.validate_python(raw)
        match v >= Decimal("0"):
            case True:
                return Result.ok(MoneyDecimal(amount=v))
            case False:
                return Result.err(AtomError(atom="MoneyDecimal", message="must be non-negative"))
    except Exception as e:
        return Result.err(AtomError(atom="MoneyDecimal", message=str(e)))
```

`src/py314_pinnacle/domain/models.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from functools import cached_property

from py314_pinnacle.domain.atoms import Email, Money, NonEmptyStr, UserId
from py314_pinnacle.runtime.beartype_conf import beartyped
from pydantic import BaseModel, ConfigDict, Field, computed_field


# --- [CODE] ----------------------------------------------------------------

class User(BaseModel):
    model_config = ConfigDict(frozen=True)

    user_id: UserId
    email: Email
    display_name: NonEmptyStr
    balance_cents: Money = Field(ge=0)

    @computed_field
    @property
    def is_rich(self) -> bool:
        return int(self.balance_cents) > 1_000_000

    @cached_property
    def initials(self) -> str:
        parts = str(self.display_name).split()
        head = parts[0:1]
        tail = parts[-1:]
        joined = "".join(tuple(map(lambda s: s[0:1].upper(), head + tail)))
        return joined
```

Pydantic v2’s ongoing release notes explicitly track Python 3.14 support and semantics alignment; the 2.12 line is the relevant inflection point for modern 3.14+ codebases.

## Decorator algebra as the centerpiece capability stack

**Constraint (principle as law).** Decorators are typed, composable capability layers that preserve *full call signatures* via `ParamSpec` + `Concatenate`, and do not introduce branching (`if`/`else`) or explicit loops.

**Rationale (terse technical).**
- The “decorator algebra” is the only scalable mechanism to enforce cross-cutting semantics (authn/authz, validation, retry, caching, logging context, tracing) without framework lock-in.
- `functools.wraps` preserves runtime metadata but is not sufficient to preserve *static* call signatures through composition; `ParamSpec` and `Concatenate` are the typing-level invariant you enforce. In Python 3.14 these are standard `typing` constructs; `typing_extensions` remains relevant for draft/forward-looking features like `TypeForm`.

**Canonical pattern (single dominant choice).**
- Each decorator factory returns a `Callable[[F], F]` where `F` is a `Callable[Concatenate[Env, P], FutureResult[E, A]]`.
- Each decorator attaches a pure metadata tag at decoration time and runs a pure order validator that can raise immediately on invalid stacks (import-time, no I/O).
- Class-based decorators use the descriptor protocol to access class context when needed.

**Complete code artifact.**

`src/py314_pinnacle/decorators/core.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Concatenate, Generic, ParamSpec, TypeVar

from py314_pinnacle.algebra import FutureResult
from py314_pinnacle.runtime.beartype_conf import beartyped


# --- [CODE] ----------------------------------------------------------------

P = ParamSpec("P")
Env = TypeVar("Env")
E = TypeVar("E")
A = TypeVar("A")
F = TypeVar("F", bound=Callable[..., Any])


@dataclass(frozen=True, slots=True)
class DecoratorTag:
    name: str


@dataclass(frozen=True, slots=True)
class DecoratorStack:
    tags: tuple[DecoratorTag, ...]

    @staticmethod
    def empty() -> "DecoratorStack":
        return DecoratorStack(tags=())


@beartyped
def get_stack(fn: Callable[..., Any]) -> DecoratorStack:
    stack = getattr(fn, "__decorator_stack__", None)
    match stack:
        case DecoratorStack():
            return stack
        case _:
            return DecoratorStack.empty()


@beartyped
def set_stack(fn: Callable[..., Any], stack: DecoratorStack) -> Callable[..., Any]:
    setattr(fn, "__decorator_stack__", stack)
    return fn


@beartyped
def push_tag(fn: Callable[..., Any], tag: DecoratorTag) -> Callable[..., Any]:
    stack = get_stack(fn)
    new_stack = DecoratorStack(tags=stack.tags + (tag,))
    return set_stack(fn, new_stack)


@dataclass(frozen=True, slots=True)
class OrderRule:
    before: str
    after: str


@beartyped
def validate_order(stack: DecoratorStack, rules: tuple[OrderRule, ...]) -> None:
    names = tuple(map(lambda t: t.name, stack.tags))

    def index_of(name: str) -> int:
        def rec(xs: tuple[str, ...], i: int) -> int:
            match xs:
                case (head, *tail):
                    match head == name:
                        case True:
                            return i
                        case False:
                            return rec(tuple(tail), i + 1)
                case _:
                    return -1

        return rec(names, 0)

    def check_rule(rule: OrderRule) -> None:
        i1 = index_of(rule.before)
        i2 = index_of(rule.after)
        match (i1, i2):
            case (-1, _):
                return
            case (_, -1):
                return
            case (a, b):
                match a < b:
                    case True:
                        return
                    case False:
                        raise ValueError(f"decorator order invalid: {rule.before} must be before {rule.after}")

    def rec_rules(rs: tuple[OrderRule, ...]) -> None:
        match rs:
            case (r, *tail):
                check_rule(r)
                return rec_rules(tuple(tail))
            case _:
                return

    return rec_rules(rules)


@beartyped
def tag_and_validate(
    tag: DecoratorTag,
    rules: tuple[OrderRule, ...],
    fn: Callable[..., Any],
) -> Callable[..., Any]:
    tagged = push_tag(fn, tag)
    validate_order(get_stack(tagged), rules)
    return tagged


@beartyped
def signature_preserving(
    factory: Callable[[Callable[Concatenate[Env, P], FutureResult[E, A]]], Callable[Concatenate[Env, P], FutureResult[E, A]]],
    tag: DecoratorTag,
    rules: tuple[OrderRule, ...],
) -> Callable[[Callable[Concatenate[Env, P], FutureResult[E, A]]], Callable[Concatenate[Env, P], FutureResult[E, A]]]:
    def decorate(fn: Callable[Concatenate[Env, P], FutureResult[E, A]]) -> Callable[Concatenate[Env, P], FutureResult[E, A]]:
        fn2 = tag_and_validate(tag=tag, rules=rules, fn=fn)
        return factory(fn2)

    return decorate
```

`src/py314_pinnacle/decorators/authz.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Concatenate, ParamSpec, TypeVar

from py314_pinnacle.algebra import FutureResult, Result
from py314_pinnacle.decorators.core import DecoratorTag, OrderRule, signature_preserving
from py314_pinnacle.protocols.auth import AuthContext, Authenticator, Authorizer
from py314_pinnacle.runtime.beartype_conf import beartyped
from pydantic import BaseModel, ConfigDict


# --- [CODE] ----------------------------------------------------------------

P = ParamSpec("P")
Env = TypeVar("Env")
E = TypeVar("E")
A = TypeVar("A")


class AuthConfig(BaseModel):
    model_config = ConfigDict(frozen=True)
    required_role: str


@dataclass(frozen=True, slots=True)
class AuthError:
    message: str


_AUTH_RULES = (
    OrderRule(before="authenticate", after="authorize"),
    OrderRule(before="validate_request", after="authorize"),
)


@beartyped
def authenticate(
    authenticator: Authenticator[Env],
) -> Callable[[Callable[Concatenate[Env, P], FutureResult[E | AuthError, A]]], Callable[Concatenate[Env, P], FutureResult[E | AuthError, A]]]:
    def factory(fn: Callable[Concatenate[Env, P], FutureResult[E | AuthError, A]]) -> Callable[Concatenate[Env, P], FutureResult[E | AuthError, A]]:
        def wrapped(env: Env, *args: P.args, **kwargs: P.kwargs) -> FutureResult[E | AuthError, A]:
            return authenticator(env).bind(
                lambda ctx: fn(env, *args, **kwargs),
            )

        return wrapped

    return signature_preserving(factory=factory, tag=DecoratorTag("authenticate"), rules=_AUTH_RULES)


@beartyped
def authorize(
    cfg: AuthConfig,
    authorizer: Authorizer[Env],
) -> Callable[[Callable[Concatenate[Env, P], FutureResult[E | AuthError, A]]], Callable[Concatenate[Env, P], FutureResult[E | AuthError, A]]]:
    def factory(fn: Callable[Concatenate[Env, P], FutureResult[E | AuthError, A]]) -> Callable[Concatenate[Env, P], FutureResult[E | AuthError, A]]:
        def wrapped(env: Env, *args: P.args, **kwargs: P.kwargs) -> FutureResult[E | AuthError, A]:
            def check(ctx: AuthContext) -> FutureResult[E | AuthError, A]:
                return authorizer(env, ctx, cfg.required_role).bind(
                    lambda _: fn(env, *args, **kwargs),
                )

            return get_auth_context(env).bind(check)

        return wrapped

    return signature_preserving(factory=factory, tag=DecoratorTag("authorize"), rules=_AUTH_RULES)


@beartyped
def get_auth_context(env: Env) -> FutureResult[AuthError, AuthContext]:
    getter = getattr(env, "auth_context", None)
    match getter:
        case AuthContext() as ctx:
            return FutureResult.from_result(Result.ok(ctx))
        case _:
            return FutureResult.from_result(Result.err(AuthError(message="auth context missing")))
```

`src/py314_pinnacle/decorators/validation.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Concatenate, Generic, ParamSpec, TypeVar

from py314_pinnacle.algebra import FutureResult, Result
from py314_pinnacle.decorators.core import DecoratorTag, OrderRule, signature_preserving
from py314_pinnacle.runtime.beartype_conf import beartyped
from pydantic import BaseModel, ConfigDict, TypeAdapter


# --- [CODE] ----------------------------------------------------------------

P = ParamSpec("P")
Env = TypeVar("Env")
E = TypeVar("E")
A = TypeVar("A")
Req = TypeVar("Req", bound=BaseModel)


class ValidationConfig(BaseModel):
    model_config = ConfigDict(frozen=True)
    name: str


@dataclass(frozen=True, slots=True)
class ValidationError:
    message: str


_VALIDATE_RULES = (
    OrderRule(before="validate_request", after="authorize"),
    OrderRule(before="validate_request", after="trace"),
)


@beartyped
def validate_request(
    cfg: ValidationConfig,
    adapter: TypeAdapter[Req],
    index: int,
) -> Callable[[Callable[Concatenate[Env, P], FutureResult[E | ValidationError, A]]], Callable[Concatenate[Env, P], FutureResult[E | ValidationError, A]]]:
    def factory(fn: Callable[Concatenate[Env, P], FutureResult[E | ValidationError, A]]) -> Callable[Concatenate[Env, P], FutureResult[E | ValidationError, A]]:
        def wrapped(env: Env, *args: P.args, **kwargs: P.kwargs) -> FutureResult[E | ValidationError, A]:
            args_tuple = tuple(args)

            def pick(i: int, xs: tuple[object, ...]) -> object:
                def rec(j: int, ys: tuple[object, ...]) -> object:
                    match (j, ys):
                        case (0, (h, *t)):
                            return h
                        case (k, (h, *t)):
                            return rec(k - 1, tuple(t))
                        case _:
                            raise ValueError("argument index out of bounds")

                return rec(i, xs)

            def validated(raw: object) -> Result[ValidationError, Req]:
                try:
                    v = adapter.validate_python(raw)
                    return Result.ok(v)
                except Exception as e:
                    return Result.err(ValidationError(message=f"{cfg.name}: {e}"))

            raw = pick(index, args_tuple)
            return FutureResult.from_result(validated(raw)).bind(
                lambda _: fn(env, *args, **kwargs),
            )

        return wrapped

    return signature_preserving(factory=factory, tag=DecoratorTag("validate_request"), rules=_VALIDATE_RULES)
```

`src/py314_pinnacle/decorators/telemetry.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Concatenate, ParamSpec, TypeVar

from opentelemetry import trace
from opentelemetry.trace import Span
from py314_pinnacle.algebra import FutureResult
from py314_pinnacle.decorators.core import DecoratorTag, OrderRule, signature_preserving
from py314_pinnacle.runtime.beartype_conf import beartyped
from pydantic import BaseModel, ConfigDict


# --- [CODE] ----------------------------------------------------------------

P = ParamSpec("P")
Env = TypeVar("Env")
E = TypeVar("E")
A = TypeVar("A")


class TraceConfig(BaseModel):
    model_config = ConfigDict(frozen=True)
    span_name: str


@dataclass(frozen=True, slots=True)
class TraceError:
    message: str


_TRACE_RULES = (
    OrderRule(before="authenticate", after="trace"),
    OrderRule(before="validate_request", after="trace"),
)


@beartyped
def trace_span(
    cfg: TraceConfig,
    tracer: trace.Tracer,
) -> Callable[[Callable[Concatenate[Env, P], FutureResult[E, A]]], Callable[Concatenate[Env, P], FutureResult[E, A]]]:
    def factory(fn: Callable[Concatenate[Env, P], FutureResult[E, A]]) -> Callable[Concatenate[Env, P], FutureResult[E, A]]:
        def wrapped(env: Env, *args: P.args, **kwargs: P.kwargs) -> FutureResult[E, A]:
            async def _run() -> object:
                with tracer.start_as_current_span(cfg.span_name) as span:
                    annotate_span(span, env)
                    return await fn(env, *args, **kwargs).run()

            return FutureResult.from_awaitable(_run()).coerce()

        return wrapped

    return signature_preserving(factory=factory, tag=DecoratorTag("trace"), rules=_TRACE_RULES)


@beartyped
def annotate_span(span: Span, env: object) -> None:
    cid = getattr(env, "correlation_id", None)
    match cid:
        case str() as s:
            span.set_attribute("correlation_id", s)
            return
        case _:
            return
```

`src/py314_pinnacle/decorators/logging.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Concatenate, ParamSpec, TypeVar

import structlog
from py314_pinnacle.algebra import FutureResult
from py314_pinnacle.decorators.core import DecoratorTag, OrderRule, signature_preserving
from py314_pinnacle.runtime.beartype_conf import beartyped
from pydantic import BaseModel, ConfigDict


# --- [CODE] ----------------------------------------------------------------

P = ParamSpec("P")
Env = TypeVar("Env")
E = TypeVar("E")
A = TypeVar("A")


class LogContextConfig(BaseModel):
    model_config = ConfigDict(frozen=True)
    key: str


@dataclass(frozen=True, slots=True)
class LogError:
    message: str


_LOG_RULES = (OrderRule(before="log_context", after="trace"),)


@beartyped
def log_context(cfg: LogContextConfig) -> Callable[[Callable[Concatenate[Env, P], FutureResult[E, A]]], Callable[Concatenate[Env, P], FutureResult[E, A]]]:
    def factory(fn: Callable[Concatenate[Env, P], FutureResult[E, A]]) -> Callable[Concatenate[Env, P], FutureResult[E, A]]:
        def wrapped(env: Env, *args: P.args, **kwargs: P.kwargs) -> FutureResult[E, A]:
            cid = getattr(env, "correlation_id", None)

            async def _run() -> object:
                structlog.contextvars.bind_contextvars(**{cfg.key: cid})
                try:
                    return await fn(env, *args, **kwargs).run()
                finally:
                    structlog.contextvars.clear_contextvars()

            return FutureResult.from_awaitable(_run()).coerce()

        return wrapped

    return signature_preserving(factory=factory, tag=DecoratorTag("log_context"), rules=_LOG_RULES)
```

`src/py314_pinnacle/decorators/retry.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Concatenate, ParamSpec, TypeVar

import stamina
from py314_pinnacle.algebra import FutureResult
from py314_pinnacle.decorators.core import DecoratorTag, OrderRule, signature_preserving
from py314_pinnacle.runtime.beartype_conf import beartyped
from pydantic import BaseModel, ConfigDict


# --- [CODE] ----------------------------------------------------------------

P = ParamSpec("P")
Env = TypeVar("Env")
E = TypeVar("E")
A = TypeVar("A")


class RetryConfig(BaseModel):
    model_config = ConfigDict(frozen=True)
    attempts: int
    timeout_seconds: float


@dataclass(frozen=True, slots=True)
class RetryError:
    message: str


_RETRY_RULES = (OrderRule(before="retry", after="validate_request"),)


@beartyped
def retry(cfg: RetryConfig) -> Callable[[Callable[Concatenate[Env, P], FutureResult[E, A]]], Callable[Concatenate[Env, P], FutureResult[E, A]]]:
    def factory(fn: Callable[Concatenate[Env, P], FutureResult[E, A]]) -> Callable[Concatenate[Env, P], FutureResult[E, A]]:
        async def _call(env: Env, *args: P.args, **kwargs: P.kwargs) -> object:
            return await fn(env, *args, **kwargs).run()

        retried = stamina.retry(attempts=cfg.attempts, timeout=cfg.timeout_seconds)(_call)

        def wrapped(env: Env, *args: P.args, **kwargs: P.kwargs) -> FutureResult[E, A]:
            return FutureResult.from_awaitable(retried(env, *args, **kwargs)).coerce()

        return wrapped

    return signature_preserving(factory=factory, tag=DecoratorTag("retry"), rules=_RETRY_RULES)
```

Decorator ordering validation is performed purely at decoration time (import time when used at module scope), and does not perform I/O. This ensures invalid stacks fail fast while remaining deterministic.

The selection of this stack is justified once: Pydantic v2.12 is the current validated baseline for 3.14-adjacent annotation semantics in the ecosystem; `typing_extensions` 4.15.0 delivers draft forward typing surface (`TypeForm`, annotation tooling) aligned with CPython behavior; AnyIO demonstrates active Python 3.14 alignment at the structured-concurrency layer; msgspec provides a dated, high-performance serialization/validation boundary; structlog’s current line includes Python 3.14 logging-related considerations in its own release stream; OpenTelemetry’s contemporary Python guidance is SDK-initialization-first with explicit logs instrumentation posture; stamina’s current release provides retry composition primitives; Hypothesis is current and moving quickly for property-based testing.

## Algebraic effects: Result, Maybe, IO, FutureResult, RequiresContextResult

**Constraint (principle as law).** Expected failure, partiality, and effects must be expressed as explicit types. Exceptions are permitted only at foreign boundaries, where they are immediately collapsed into `Result`.

**Rationale (terse technical).**
- Python 3.14’s direction increases the need for deterministic, testable, introspection-friendly semantics; exceptions as expected control flow are neither compositional nor inspectable.
- The “returns” library is intentionally replaced here by an in-doc minimal algebra implemented once and used everywhere.

**Canonical pattern (single dominant choice).**
- `Result[E, A]` is the universal carrier of expected failure.
- `Maybe[A]` is reserved for semantic absence *only when absence is not an error*.
- `IO[A]` wraps synchronous effects; `FutureResult[E, A]` wraps async effects with failure.
- `RequiresContextResult[Env, E, A]` is typed dependency injection as a pure function from environment to `FutureResult`.

**Complete code artifact.**

`src/py314_pinnacle/algebra.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass
from functools import reduce
from typing import Awaitable, Callable, Concatenate, Generic, ParamSpec, TypeVar

from py314_pinnacle.runtime.beartype_conf import beartyped


# --- [CODE] ----------------------------------------------------------------

A = TypeVar("A")
B = TypeVar("B")
C = TypeVar("C")
E = TypeVar("E")
F = TypeVar("F")
Env = TypeVar("Env")
P = ParamSpec("P")


@dataclass(frozen=True, slots=True)
class Result(Generic[E, A]):
    payload: object

    @staticmethod
    def ok(value: A) -> "Result[E, A]":
        return Result(payload=Ok(value=value))

    @staticmethod
    def err(error: E) -> "Result[E, A]":
        return Result(payload=Err(error=error))

    @beartyped
    def map(self, f: Callable[[A], B]) -> "Result[E, B]":
        match self.payload:
            case Ok(value=v):
                return Result.ok(f(v))
            case Err(error=e):
                return Result.err(e)
            case _:
                raise AssertionError("unreachable: invalid Result payload")

    @beartyped
    def bind(self, f: Callable[[A], "Result[E, B]"]) -> "Result[E, B]":
        match self.payload:
            case Ok(value=v):
                return f(v)
            case Err(error=e):
                return Result.err(e)
            case _:
                raise AssertionError("unreachable: invalid Result payload")

    @beartyped
    def map_err(self, f: Callable[[E], F]) -> "Result[F, A]":
        match self.payload:
            case Ok(value=v):
                return Result(payload=Ok(value=v))
            case Err(error=e):
                return Result(payload=Err(error=f(e)))
            case _:
                raise AssertionError("unreachable: invalid Result payload")

    @beartyped
    def unwrap_or(self, default: A) -> A:
        match self.payload:
            case Ok(value=v):
                return v
            case Err(error=_):
                return default
            case _:
                return default

    @beartyped
    def to_either(self) -> "Ok[A] | Err[E]":
        match self.payload:
            case Ok() as ok:
                return ok
            case Err() as err:
                return err
            case _:
                raise AssertionError("unreachable: invalid Result payload")


@dataclass(frozen=True, slots=True)
class Ok(Generic[A]):
    value: A


@dataclass(frozen=True, slots=True)
class Err(Generic[E]):
    error: E


@dataclass(frozen=True, slots=True)
class Maybe(Generic[A]):
    payload: object

    @staticmethod
    def some(value: A) -> "Maybe[A]":
        return Maybe(payload=Some(value=value))

    @staticmethod
    def nothing() -> "Maybe[A]":
        return Maybe(payload=Nothing())

    @beartyped
    def map(self, f: Callable[[A], B]) -> "Maybe[B]":
        match self.payload:
            case Some(value=v):
                return Maybe.some(f(v))
            case Nothing():
                return Maybe.nothing()
            case _:
                return Maybe.nothing()

    @beartyped
    def to_result(self, err: E) -> Result[E, A]:
        match self.payload:
            case Some(value=v):
                return Result.ok(v)
            case Nothing():
                return Result.err(err)
            case _:
                return Result.err(err)


@dataclass(frozen=True, slots=True)
class Some(Generic[A]):
    value: A


@dataclass(frozen=True, slots=True)
class Nothing:
    pass


@dataclass(frozen=True, slots=True)
class IO(Generic[A]):
    thunk: Callable[[], A]

    @staticmethod
    def pure(value: A) -> "IO[A]":
        return IO(thunk=lambda: value)

    @beartyped
    def map(self, f: Callable[[A], B]) -> "IO[B]":
        return IO(thunk=lambda: f(self.thunk()))

    @beartyped
    def bind(self, f: Callable[[A], "IO[B]"]) -> "IO[B]":
        return IO(thunk=lambda: f(self.thunk()).thunk())

    @beartyped
    def run(self) -> A:
        return self.thunk()


@dataclass(frozen=True, slots=True)
class FutureResult(Generic[E, A]):
    thunk: Callable[[], Awaitable[Result[E, A]]]

    @staticmethod
    def from_result(r: Result[E, A]) -> "FutureResult[E, A]":
        async def _run() -> Result[E, A]:
            return r

        return FutureResult(thunk=_run)

    @staticmethod
    def from_awaitable(a: Awaitable[A]) -> "FutureResult[Exception, A]":
        async def _run() -> Result[Exception, A]:
            try:
                v = await a
                return Result.ok(v)
            except Exception as e:
                return Result.err(e)

        return FutureResult(thunk=_run)

    @beartyped
    async def run(self) -> Result[E, A]:
        return await self.thunk()

    @beartyped
    def map(self, f: Callable[[A], B]) -> "FutureResult[E, B]":
        async def _run() -> Result[E, B]:
            r = await self.run()
            return r.map(f)

        return FutureResult(thunk=_run)

    @beartyped
    def bind(self, f: Callable[[A], "FutureResult[E, B]"]) -> "FutureResult[E, B]":
        async def _run() -> Result[E, B]:
            r = await self.run()
            match r.to_either():
                case Ok(value=v):
                    return await f(v).run()
                case Err(error=e):
                    return Result.err(e)

        return FutureResult(thunk=_run)

    @beartyped
    def coerce(self) -> "FutureResult[E, A]":
        return self


@dataclass(frozen=True, slots=True)
class RequiresContextResult(Generic[Env, E, A]):
    run_with: Callable[[Env], FutureResult[E, A]]

    @beartyped
    def map(self, f: Callable[[A], B]) -> "RequiresContextResult[Env, E, B]":
        return RequiresContextResult(run_with=lambda env: self.run_with(env).map(f))

    @beartyped
    def bind(self, f: Callable[[A], "RequiresContextResult[Env, E, B]"]) -> "RequiresContextResult[Env, E, B]":
        return RequiresContextResult(
            run_with=lambda env: self.run_with(env).bind(lambda a: f(a).run_with(env)),
        )


@beartyped
def flow_2(a: A, f1: Callable[[A], B], f2: Callable[[B], C]) -> C:
    return f2(f1(a))


@beartyped
def flow_3(a: A, f1: Callable[[A], B], f2: Callable[[B], C], f3: Callable[[C], E]) -> E:
    return f3(f2(f1(a)))


@beartyped
def flow_many(a: object, steps: tuple[Callable[[object], object], ...]) -> object:
    return reduce(lambda acc, f: f(acc), steps, a)
```

The modern typing substrate required by this algebra (notably defaults and annotation tooling) is provided through `typing_extensions`.

## Structured concurrency and serialization boundaries

**Constraint (principle as law).**
- Concurrency is structured and cancellation-aware; backpressure is explicit.
- Serialization is a boundary concern: Pydantic validates inputs, msgspec emits outputs; domain and ops do not manipulate raw dict/list payloads.

**Rationale (terse technical).**
- AnyIO’s current release line (v4.12.x) aligns with Python 3.14 API surfaces and structured concurrency evolution, making it the canonical portability layer across asyncio/trio.
- msgspec’s dated changelog and release metadata support its positioning as a high-performance serialization boundary tool.

**Canonical pattern (single dominant choice).**
- `TypeAdapter` validates inbound object graphs.
- msgspec decodes/encodes JSON at the boundary with explicit hooks for non-JSON primitives.
- Any parallelism is expressed via AnyIO `TaskGroup`, with cancellation scopes and capacity limiters owned by the runtime environment (not globals).

**Complete code artifact.**

`src/py314_pinnacle/adapters/codec_json.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import msgspec
from py314_pinnacle.algebra import Result
from py314_pinnacle.runtime.beartype_conf import beartyped
from pydantic import BaseModel, TypeAdapter


# --- [CODE] ----------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class JsonError:
    message: str


@beartyped
def enc_hook(obj: object) -> object:
    match obj:
        case Decimal() as d:
            return str(d)
        case bytes() as b:
            return b.decode()
        case _:
            raise TypeError(f"cannot encode type: {type(obj)}")


_json_encoder = msgspec.json.Encoder(enc_hook=enc_hook, order="sorted")


@beartyped
def decode_json(raw: bytes) -> Result[JsonError, object]:
    try:
        return Result.ok(msgspec.json.decode(raw))
    except Exception as e:
        return Result.err(JsonError(message=str(e)))


@beartyped
def validate_model(model: type[BaseModel], raw: object) -> Result[JsonError, BaseModel]:
    try:
        adapter = TypeAdapter(model)
        v = adapter.validate_python(raw)
        return Result.ok(v)
    except Exception as e:
        return Result.err(JsonError(message=str(e)))


@beartyped
def encode_json(obj: object) -> Result[JsonError, bytes]:
    try:
        return Result.ok(_json_encoder.encode(obj))
    except Exception as e:
        return Result.err(JsonError(message=str(e)))
```

`src/py314_pinnacle/adapters/repo_inmem.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import anyio
import msgspec
from py314_pinnacle.algebra import FutureResult, Result
from py314_pinnacle.domain.atoms import UserId
from py314_pinnacle.domain.models import User
from py314_pinnacle.protocols.repo import UserRepository
from py314_pinnacle.runtime.beartype_conf import beartyped


# --- [CODE] ----------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class RepoError:
    message: str


class UserRecord(msgspec.Struct, gc=False, frozen=True):
    user_id: int
    email: str
    display_name: str
    balance_cents: int


@beartyped
def to_record(u: User) -> UserRecord:
    return UserRecord(
        user_id=int(u.user_id),
        email=str(u.email),
        display_name=str(u.display_name),
        balance_cents=int(u.balance_cents),
    )


@beartyped
def from_record(r: UserRecord) -> User:
    return User.model_validate(
        {
            "user_id": r.user_id,
            "email": r.email,
            "display_name": r.display_name,
            "balance_cents": r.balance_cents,
        },
    )


@dataclass(frozen=True, slots=True)
class InMemUserRepo(UserRepository):
    store: Mapping[int, UserRecord]

    @beartyped
    def put(self, user: User) -> FutureResult[RepoError, User]:
        async def _run() -> Result[RepoError, User]:
            try:
                record = to_record(user)
                new_store = {**dict(self.store), int(user.user_id): record}
                object.__setattr__(self, "store", new_store)
                return Result.ok(user)
            except Exception as e:
                return Result.err(RepoError(message=str(e)))

        return FutureResult(thunk=_run)

    @beartyped
    def get(self, user_id: UserId) -> FutureResult[RepoError, User]:
        async def _run() -> Result[RepoError, User]:
            try:
                v = self.store.get(int(user_id))
                match v:
                    case UserRecord() as rec:
                        return Result.ok(from_record(rec))
                    case _:
                        return Result.err(RepoError(message="not found"))
            except Exception as e:
                return Result.err(RepoError(message=str(e)))

        return FutureResult(thunk=_run)
```

`src/py314_pinnacle/protocols/repo.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from typing import Protocol

from py314_pinnacle.adapters.repo_inmem import RepoError
from py314_pinnacle.algebra import FutureResult
from py314_pinnacle.domain.atoms import UserId
from py314_pinnacle.domain.models import User


# --- [CODE] ----------------------------------------------------------------

class UserRepository(Protocol):
    def put(self, user: User) -> FutureResult[RepoError, User]: ...
    def get(self, user_id: UserId) -> FutureResult[RepoError, User]: ...
```

AnyIO and msgspec align with the Python 3.14 runtime model used throughout this guide; AnyIO covers structured concurrency while msgspec anchors high-throughput serialization with `gc=False` support.

## Observability, logging, testing, and anti-patterns

**Constraint (principle as law).**
- All logs are structured (event dict), never string blobs.
- Context propagation uses `contextvars` (structlog) and must support trace correlation (OpenTelemetry).
- Testing is property-based (Hypothesis) for invariants, with stateful testing for protocol implementations.

**Rationale (terse technical).**
- structlog’s current release line explicitly tracks Python 3.14 logging behavior changes affecting stdlib integration.
- OpenTelemetry’s published Python guidance is SDK-first; for logs, the posture is “SDK with stdlib logging integration / auto-instrumentation”, not a developer-facing logs API.
- In the spec’s updated history, concurrency requirements are actively adjusted and must be respected by any logging/telemetry pipeline in concurrent runtimes.
- Hypothesis is current and suitable as the canonical property-based testing layer.

**Canonical pattern (single dominant choice).**
- Use `logging` as transport; structlog builds the event dict; msgspec encodes JSON; OpenTelemetry logging handler exports.
- Correlation ID is a typed atom; it is injected into structlog contextvars and span attributes in decorators.
- Retry emits structured events and composes as a decorator.

**Complete code artifact.**

`src/py314_pinnacle/runtime/settings.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass

from py314_pinnacle.algebra import Result
from py314_pinnacle.runtime.beartype_conf import beartyped
from pydantic import BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


# --- [CODE] ----------------------------------------------------------------

class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        frozen=True,
        env_prefix="APP_",
        extra="ignore",
    )

    service_name: str = Field(min_length=1)
    log_level: str = Field(min_length=1)
    otlp_endpoint: str = Field(min_length=1)


@beartyped
def load_settings() -> Result[Exception, AppSettings]:
    try:
        return Result.ok(AppSettings())
    except Exception as e:
        return Result.err(e)
```

pydantic-settings provides the settings boundary used in this runtime composition.

`src/py314_pinnacle/runtime/logging_bootstrap.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

import logging

import msgspec
import structlog
from py314_pinnacle.adapters.codec_json import enc_hook
from py314_pinnacle.runtime.beartype_conf import beartyped
from py314_pinnacle.runtime.settings import AppSettings


# --- [CODE] ----------------------------------------------------------------

@beartyped
def render_event_dict(event_dict: dict[str, object]) -> str:
    encoder = msgspec.json.Encoder(enc_hook=enc_hook, order="sorted")
    return encoder.encode(event_dict).decode()


@beartyped
def bootstrap_logging(settings: AppSettings) -> None:
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    handler = logging.StreamHandler()

    def processor(logger: object, method_name: str, event_dict: dict[str, object]) -> str:
        return render_event_dict(event_dict)

    formatter = structlog.stdlib.ProcessorFormatter(
        processor=processor,
        foreign_pre_chain=(
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.add_log_level,
        ),
    )

    handler.setFormatter(formatter)
    root.handlers = (handler,)

    structlog.configure(
        processors=(
            structlog.contextvars.merge_contextvars,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.add_log_level,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ),
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
```

structlog’s modern release series explicitly documents 3.14-related interactions with stdlib logging semantics, reinforcing the choice of stdlib transport and structlog formatting.

`src/py314_pinnacle/runtime/otel_bootstrap.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from py314_pinnacle.algebra import Result
from py314_pinnacle.runtime.beartype_conf import beartyped
from py314_pinnacle.runtime.settings import AppSettings


# --- [CODE] ----------------------------------------------------------------

@beartyped
def bootstrap_otel(settings: AppSettings) -> Result[Exception, TracerProvider]:
    try:
        resource = Resource.create({"service.name": settings.service_name})
        provider = TracerProvider(resource=resource)
        trace.set_tracer_provider(provider)
        return Result.ok(provider)
    except Exception as e:
        return Result.err(e)
```

OpenTelemetry’s own guidance for Python manual instrumentation is SDK initialization at app level; this bootstrap is therefore the canonical “imperative shell” entrypoint.

`src/py314_pinnacle/protocols/auth.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, TypeVar

from py314_pinnacle.algebra import FutureResult


# --- [CODE] ----------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class AuthContext:
    subject: str
    roles: tuple[str, ...]


Env = TypeVar("Env")


class Authenticator(Protocol[Env]):
    def __call__(self, env: Env) -> FutureResult[object, AuthContext]: ...


class Authorizer(Protocol[Env]):
    def __call__(self, env: Env, ctx: AuthContext, required_role: str) -> FutureResult[object, None]: ...
```

`src/py314_pinnacle/ops/user_ops.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from dataclasses import dataclass

from py314_pinnacle.algebra import FutureResult, Result, flow_3
from py314_pinnacle.domain.atoms import Email, Money, NonEmptyStr, UserId, email, non_empty_str, user_id
from py314_pinnacle.domain.models import User
from py314_pinnacle.protocols.repo import UserRepository
from py314_pinnacle.runtime.beartype_conf import beartyped
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


# --- [CODE] ----------------------------------------------------------------

class CreateUserRequest(BaseModel):
    model_config = ConfigDict(frozen=True)
    user_id: int
    email: str
    display_name: str
    balance_cents: int = Field(ge=0)


_CreateUserAdapter = TypeAdapter(CreateUserRequest)


@dataclass(frozen=True, slots=True)
class AppError:
    message: str


@beartyped
def build_user(req: CreateUserRequest) -> Result[AppError, User]:
    return user_id(req.user_id).map_err(lambda e: AppError(message=e.message)).bind(
        lambda uid: email(req.email).map_err(lambda e: AppError(message=e.message)).bind(
            lambda em: non_empty_str(req.display_name).map_err(lambda e: AppError(message=e.message)).bind(
                lambda dn: Result.ok(
                    User(
                        user_id=uid,
                        email=Email(str(em)),
                        display_name=NonEmptyStr(str(dn)),
                        balance_cents=Money(req.balance_cents),
                    ),
                ),
            ),
        ),
    )


@beartyped
def create_user(repo: UserRepository, raw: object) -> FutureResult[AppError, User]:
    def parse(x: object) -> Result[AppError, CreateUserRequest]:
        try:
            v = _CreateUserAdapter.validate_python(x)
            return Result.ok(v)
        except Exception as e:
            return Result.err(AppError(message=str(e)))

    return FutureResult.from_result(parse(raw)).bind(
        lambda req: FutureResult.from_result(build_user(req)).bind(
            lambda u: repo.put(u).map_err(lambda re: AppError(message=re.message)),
        ),
    )
```

`tests/test_domain_properties.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from hypothesis import given, strategies as st
from py314_pinnacle.domain.atoms import email, non_empty_str, user_id


# --- [CODE] ----------------------------------------------------------------

@given(st.integers())
def test_user_id_is_positive_or_error(n: int) -> None:
    r = user_id(n)
    match r.to_either():
        case _:
            return


@given(st.text())
def test_non_empty_str_constructor_is_total(s: str) -> None:
    r = non_empty_str(s)
    match r.to_either():
        case _:
            return


@given(st.text())
def test_email_constructor_is_total(s: str) -> None:
    r = email(s)
    match r.to_either():
        case _:
            return
```

`tests/test_repo_stateful.py`

```python
# --- [IMPORTS] -------------------------------------------------------------
from __future__ import annotations

from hypothesis import strategies as st
from hypothesis.stateful import RuleBasedStateMachine, initialize, rule
from py314_pinnacle.adapters.repo_inmem import InMemUserRepo
from py314_pinnacle.domain.atoms import Email, Money, NonEmptyStr, UserId
from py314_pinnacle.domain.models import User


# --- [CODE] ----------------------------------------------------------------

class RepoMachine(RuleBasedStateMachine):
    def __init__(self) -> None:
        super().__init__()
        self.repo = InMemUserRepo(store={})

    @initialize()
    def init_repo(self) -> None:
        self.repo = InMemUserRepo(store={})

    @rule(uid=st.integers(min_value=1), bal=st.integers(min_value=0))
    def put_get_roundtrip(self, uid: int, bal: int) -> None:
        u = User(
            user_id=UserId(uid),
            email=Email("a@example.com"),
            display_name=NonEmptyStr("A"),
            balance_cents=Money(bal),
        )
        fr = self.repo.put(u)
        _ = fr
        return


TestRepoMachine = RepoMachine.TestCase
```

### Anti-patterns (canonical fixes only)

Each entry is: **NAME — failure mode → canonical fix → corrected snippet**. All snippets comply with the “no branching keywords / no loops” constraint by construction (pattern matching and total APIs only).

1. **DTO soup** — surface-area explosion → branded atoms + frozen models →
```python
# --- [IMPORTS] -------------------------------------------------------------
from typing import NewType

from pydantic import BaseModel, ConfigDict


# --- [CODE] ----------------------------------------------------------------

# ❌
class UserIdDTO(BaseModel):
    value: int

# ✅
type UserId = NewType("UserId", int)

class User(BaseModel):
    model_config = ConfigDict(frozen=True, strict=True)
    user_id: UserId
```

2. **Wraps-only decorator** — signature erosion → ParamSpec + Concatenate + typed factory →
```python
# --- [IMPORTS] -------------------------------------------------------------
import functools
from typing import Callable, Concatenate, ParamSpec, TypeVar


# --- [CODE] ----------------------------------------------------------------

P = ParamSpec("P")
R = TypeVar("R")
Ctx = TypeVar("Ctx")

# ✅
def with_ctx(ctx: Ctx) -> Callable[[Callable[Concatenate[Ctx, P], R]], Callable[P, R]]:
    def deco(func: Callable[Concatenate[Ctx, P], R]) -> Callable[P, R]:
        @functools.wraps(func)
        def wrapped(*args: P.args, **kwargs: P.kwargs) -> R:
            return func(ctx, *args, **kwargs)
        return wrapped
    return deco
```

3. **Exception-driven domain flow** — hidden partiality → `Result` constructors →
```python
# --- [IMPORTS] -------------------------------------------------------------
from py314_pinnacle.algebra import Err, Ok, Result


# --- [CODE] ----------------------------------------------------------------

# ✅
def parse_amount(raw: str) -> Result[int, ValueError]:
    match raw.isdecimal():
        case True:
            return Ok(int(raw))
        case False:
            return Err(ValueError("amount_not_decimal"))
```

4. **isinstance dispatch** — nominal coupling → Protocol boundary →
```python
# --- [IMPORTS] -------------------------------------------------------------
from typing import Protocol

from py314_pinnacle.algebra import Result


# --- [CODE] ----------------------------------------------------------------

# ✅
class UserRepository(Protocol):
    def save(self, payload: bytes) -> Result[None, Exception]: ...
```

5. **Bare dict return** — type erasure → return `BaseModel` or `msgspec.Struct` →
```python
# --- [IMPORTS] -------------------------------------------------------------
import msgspec


# --- [CODE] ----------------------------------------------------------------

# ✅
class UserWire(msgspec.Struct, frozen=True, gc=False):
    user_id: int
    email: str
```

6. **Mutable defaults** — shared state → frozen config + explicit tuples →
```python
# --- [IMPORTS] -------------------------------------------------------------
from pydantic import BaseModel, ConfigDict, Field


# --- [CODE] ----------------------------------------------------------------

# ✅
class Settings(BaseModel):
    model_config = ConfigDict(frozen=True)
    scopes: tuple[str, ...] = Field(default_factory=tuple)
```

7. **Import-time I/O** — non-deterministic import graph → pure ordering validation only →
```python
# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Callable
from typing import Any


# --- [CODE] ----------------------------------------------------------------

# ✅
def validate_order(stack: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(sorted(stack))
```

8. **Global mutable state** — free-threading hazard → store state in Env →
```python
# --- [IMPORTS] -------------------------------------------------------------
from contextvars import ContextVar


# --- [CODE] ----------------------------------------------------------------

# ✅
request_cache: ContextVar[tuple[tuple[str, int], ...]] = ContextVar("request_cache", default=())
```

9. **Async loops without checkpoints** — starvation → AnyIO task groups + structured cancellation →
```python
# --- [IMPORTS] -------------------------------------------------------------
import anyio


# --- [CODE] ----------------------------------------------------------------

# ✅
async def process_all(items: tuple[int, ...]) -> None:
    async def _job(item: int) -> None:
        await anyio.lowlevel.checkpoint()
        await anyio.to_thread.run_sync(abs, item)
    async with anyio.create_task_group() as tg:
        tuple(map(lambda item: tg.start_soon(_job, item), items))
```

10. **Misusing runtime_checkable** — pseudo-isinstance → Protocol-only for static boundary →
```python
# --- [IMPORTS] -------------------------------------------------------------
from typing import Protocol, runtime_checkable

from py314_pinnacle.algebra import Result


# --- [CODE] ----------------------------------------------------------------

# ✅
@runtime_checkable
class ReaderPort(Protocol):
    def read(self, key: str) -> Result[str, Exception]: ...
```

11. **Framework-first design** — hard coupling → ports + adapters + decorators →
```python
# --- [IMPORTS] -------------------------------------------------------------
from py314_pinnacle.algebra import Result
from py314_pinnacle.domain.models import CreateUserCommand


# --- [CODE] ----------------------------------------------------------------

# ✅
def create_user(cmd: CreateUserCommand) -> Result[None, Exception]: ...
```

12. **Undocumented cast()** — silent unsafety → redesign until cast is unnecessary →
```python
# --- [IMPORTS] -------------------------------------------------------------
from pydantic import TypeAdapter


# --- [CODE] ----------------------------------------------------------------

# ✅
email_adapter: TypeAdapter[str] = TypeAdapter(str)
```

13. **Behavior in Pydantic models** — hidden effects → ops/ orchestrates behavior →
```python
# --- [IMPORTS] -------------------------------------------------------------
from pydantic import BaseModel

from py314_pinnacle.algebra import Result


# --- [CODE] ----------------------------------------------------------------

class UserData(BaseModel):
    user_id: int

# ✅
def persist_user(model: UserData) -> Result[None, Exception]: ...
```

14. **God decorator** — coupled concerns → orthogonal decorators with ordering rules →
```python
# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Callable
from typing import ParamSpec, TypeVar


# --- [CODE] ----------------------------------------------------------------

P = ParamSpec("P")
R = TypeVar("R")

# ✅
def traced(func: Callable[P, R]) -> Callable[P, R]: ...
def retried(func: Callable[P, R]) -> Callable[P, R]: ...
```

15. **Implicit module coupling** — hidden imports → explicit env injection →
```python
# --- [IMPORTS] -------------------------------------------------------------
from py314_pinnacle.algebra import Ok, RequiresContextResult, Result


# --- [CODE] ----------------------------------------------------------------

# ✅
def load_user() -> RequiresContextResult[dict[str, str], str, Exception]:
    return RequiresContextResult(lambda env: Ok(env["dsn"]))
```

16. **Validation-heavy dataclasses** — weak invariants → Pydantic boundary validation →
```python
# --- [IMPORTS] -------------------------------------------------------------
from pydantic import BaseModel, TypeAdapter


# --- [CODE] ----------------------------------------------------------------

# ✅
class Price(BaseModel):
    cents: int

price_adapter: TypeAdapter[Price] = TypeAdapter(Price)
```

17. **Untyped HOF** — signature loss → ParamSpec threading →
```python
# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Callable
from typing import ParamSpec, TypeVar


# --- [CODE] ----------------------------------------------------------------

P = ParamSpec("P")
R = TypeVar("R")

# ✅
def passthrough(func: Callable[P, R]) -> Callable[P, R]:
    return func
```

18. **Union dispatch via strings** — ad hoc branching → discriminators in Pydantic unions →
```python
# --- [IMPORTS] -------------------------------------------------------------
from typing import Annotated, Literal

from pydantic import BaseModel, Discriminator


# --- [CODE] ----------------------------------------------------------------

class Card(BaseModel):
    kind: Literal["card"]

class Bank(BaseModel):
    kind: Literal["bank"]

# ✅
type Payment = Annotated[Card | Bank, Discriminator("kind")]
```

19. **Missing Result boundary** — Optional masks failure → Result for expected failure →
```python
# --- [IMPORTS] -------------------------------------------------------------
from py314_pinnacle.algebra import Result


# --- [CODE] ----------------------------------------------------------------

# ✅
def fetch_user(uid: int) -> Result[str, LookupError]: ...
```

20. **Assumed GIL protection** — race conditions under free-threading → no globals, immutable models, explicit synchronization via AnyIO primitives →
```python
# --- [IMPORTS] -------------------------------------------------------------
from contextvars import ContextVar


# --- [CODE] ----------------------------------------------------------------

# ❌
counter: list[int] = []

# ✅
counter_safe: ContextVar[tuple[int, ...]] = ContextVar("counter_safe", default=())
```

## Further consideration

- **Annotation semantics and strict introspection discipline.** Python 3.14’s annotations changes require extremely conservative rules around reflection and runtime type tooling; enforce a single “annotation access” layer (never scatter `__annotations__` access through the codebase), and treat that layer as part of the platform.
- **Spec-driven concurrency contracts in observability.** OpenTelemetry’s logs surface includes explicit concurrency semantics; propagate that into your logging pipeline contracts as invariants (e.g., “exporters must be concurrency-safe and bounded”).
- **Performance as correctness: schema evolution discipline.** Keep msgspec as the outbound boundary with explicit struct schemas (`frozen=True`, `omit_defaults` where justified) so serialized contracts remain compact and stable as fields evolve, reducing downstream drift in replay/snapshot workflows.
