# [H1][API_MODULE]
>**Dictum:** *API modules own boundary translation: external data enters validated, internal results exit serialized with expression types, telemetry observes both channels.*

<br>

Produces one API boundary module: Pydantic `TypeAdapter` validates inbound data, domain logic processes validated models, `expression.Option[T]` and `expression.Result[T, E]` appear in Pydantic response models with auto-serialization, msgspec `Struct(frozen=True, gc=False)` serializes outbound wire formats, a bridge function converts `returns.Result` pipeline output to `expression.Result` response fields, error mapping translates domain errors to HTTP errors, and fused telemetry via `@instrument` observes the full request lifecycle. API modules are thin adapters -- zero domain logic lives here.

**Density:** ~225 LOC signals a refactoring opportunity. No file proliferation; colocate boundary concerns in the API module.
**References:** `observability.md` ([1] SIGNAL_PIPELINE, [4] METRICS_PROJECTION), `serialization.md` ([1] INBOUND_VALIDATION_PIPELINE, [2] MSGSPEC_STRUCTS), `effects.md` ([1] EFFECT_STACK), `types.md` ([2] DISCRIMINATED_UNIONS, [3] FROZEN_MODELS).
**Anti-Pattern Awareness:** See `patterns.md` [1] for BARE_TRY_EXCEPT, MODEL_WITH_BEHAVIOR, STRING_ERROR_DISPATCH, MIXED_RESULT_LIBRARIES.
**Workflow:** Fill placeholders, remove guidance blocks, verify with ty and ruff.

---
**Placeholders**

| [INDEX] | [PLACEHOLDER]          | [EXAMPLE]                                           |
| :-----: | ---------------------- | --------------------------------------------------- |
|   [1]   | `{{module_path}}`      | `pinnacle/adapters/order_api.py`                    |
|   [2]   | `{{resource_name}}`    | `order`                                             |
|   [3]   | `{{request_model}}`    | `OrderRequest`                                      |
|   [4]   | `{{response_model}}`   | `OrderResponse`                                     |
|   [5]   | `{{domain_model}}`     | `Order`                                             |
|   [6]   | `{{error_mapping}}`    | `NotFoundError -> 404, ValidationError -> 422`      |
|   [7]   | `{{request_adapter}}`  | `OrderRequestAdapter`                               |
|   [8]   | `{{response_encoder}}` | `_encoder`                                          |
|   [9]   | `{{trace_operation}}`  | `"order.create"`                                    |
|  [10]   | `{{service_stage}}`    | `bind(service.create_order)`                        |
|  [11]   | `{{http_error_type}}`  | `HttpError`                                         |
|  [12]   | `{{request_fields}}`   | `customer_id: CustomerId`                           |
|  [13]   | `{{response_fields}}`  | See response model section                          |
|  [14]   | `{{response_expr}}`    | `{{response_model}}(order_id=domain.order_id, ...)` |

---
```python
"""{{module_path}} -- API module: boundary validation, serialization, telemetry."""

# --- [IMPORTS] ----------------------------------------------------------------

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from functools import wraps
from typing import TYPE_CHECKING
from uuid import UUID

from expression import Error as ExprError, Nothing, Ok, Option, Result as ExprResult, Some
import msgspec
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from pydantic import BaseModel, ConfigDict, TypeAdapter
from returns.pipeline import flow
from returns.pointfree import lash, map_
from returns.result import Failure, Result, safe, Success
import structlog

if TYPE_CHECKING:
    from collections.abc import Callable

# from pinnacle.domain.errors import NotFoundError, ValidationError, ServiceError
# from pinnacle.domain.models import {{domain_model}}
# from pinnacle.ops.service import service

# --- [ERRORS] -----------------------------------------------------------------


# HTTP errors: frozen dataclasses; exhaustive match/case mapping.
@dataclass(frozen=True, slots=True)
class {{http_error_type}}:
    """Base HTTP error."""

    message: str = "Error"
    status_code: int = 500


@dataclass(frozen=True, slots=True)
class NotFoundHttpError({{http_error_type}}):
    """Not found HTTP error."""

    message: str = "Not found"
    status_code: int = 404


@dataclass(frozen=True, slots=True)
class ValidationHttpError({{http_error_type}}):
    """Validation HTTP error."""

    message: str = "Validation error"
    status_code: int = 422


@dataclass(frozen=True, slots=True)
class InternalHttpError({{http_error_type}}):
    """Internal server error."""

    message: str = "Internal server error"
    status_code: int = 500

# --- [REQUEST] ----------------------------------------------------------------


# TypeAdapter eager at module level; @safe bridges into Result.
# See serialization.md [1] INBOUND_VALIDATION_PIPELINE.
class {{request_model}}(BaseModel, frozen=True):
    """Inbound request schema -- Pydantic validates at ingress."""
    model_config = ConfigDict(strict=True, extra="forbid")
    {{request_fields}}

{{request_adapter}}: TypeAdapter[{{request_model}}] = TypeAdapter({{request_model}})


@safe
def validate_{{resource_name}}_request(
    raw: bytes,
) -> {{request_model}}:
    """Pydantic validates JSON ingress into typed request model."""
    return {{request_adapter}}.validate_json(raw)


@safe
def validate_{{resource_name}}_dict(
    data: dict[str, object],
) -> {{request_model}}:
    """Pydantic validates dict ingress into typed request model."""
    return {{request_adapter}}.validate_python(data)

# --- [RESPONSE] ---------------------------------------------------------------


# expression.Option[T] and expression.Result[T, E] as Pydantic fields --
# auto-serialization via __get_pydantic_core_schema__. See types.md [3].
class {{response_model}}(BaseModel, frozen=True):
    """Outbound response with expression types -- Pydantic auto-serializes.
    Option[T] serializes as value or null; Result[T, E] as tagged union."""
    order_id: int
    discount: Option[Decimal]
    validation_outcome: ExprResult[str, str]

# Optional: add {{response_model}}Wire(msgspec.Struct, frozen=True, gc=False)
# for high-throughput egress. See serialization.md [2] MSGSPEC_STRUCTS.


def _enc_hook(obj: object) -> str | float:
    """Custom type serialization -- see serialization.md [2] for enc_hook patterns."""
    match obj:
        case datetime() | date() as value:
            return value.isoformat()
        case UUID() | Decimal() as value:
            return str(value)
        case Enum() as value:
            return value.value
        case _:
            raise TypeError(f"Cannot encode {type(obj)}")

{{response_encoder}}: msgspec.json.Encoder = msgspec.json.Encoder(
    enc_hook=_enc_hook,
)

# --- [BRIDGE] -----------------------------------------------------------------


# Bridge: returns.Result -> expression.Result at API boundary only.
# See SKILL.md [8] LIBRARY_CONVENTIONS for integration rules.
def bridge_result[T, E](
    pipeline_result: Result[T, E],
) -> ExprResult[T, E]:
    """Canonical bridge -- the ONE place both libraries coexist."""
    match pipeline_result:
        case Success(value):
            return Ok(value)
        case Failure(error):
            return ExprError(error)


def bridge_option[T](
    pipeline_result: Result[T, object],
) -> Option[T]:
    """Convert returns.Result to expression.Option -- collapses error to Nothing."""
    match pipeline_result:
        case Success(value):
            return Some(value)
        case Failure(_):
            return Nothing

# --- [TELEMETRY] --------------------------------------------------------------


# Fused telemetry: @instrument owns span + log + metric.
# See observability.md [1] SIGNAL_PIPELINE + [4] METRICS_PROJECTION.
def _record_outcome[R, E](
    span: trace.Span, log: structlog.stdlib.BoundLogger,
    name: str, result: Result[R, E],
) -> None:
    match result:
        case Success(_):
            span.set_status(StatusCode.OK)
            log.info("op_success", operation=name)
        case Failure(Exception() as error):
            span.record_exception(error)
            span.set_status(StatusCode.ERROR, str(error))
            log.error("op_failure", operation=name, error_type=type(error).__name__)
        case Failure(error):
            span.set_status(StatusCode.ERROR, str(error))
            log.error("op_failure", operation=name, error_type=type(error).__name__)


def instrument[**P, R, E](
    func: Callable[P, Result[R, E]],
) -> Callable[P, Result[R, E]]:
    """Fused observability: span + structured log + outcome projection."""
    operation: str = f"{func.__module__}.{func.__qualname__}"

    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> Result[R, E]:
        tracer: trace.Tracer = trace.get_tracer("pinnacle.api")
        log: structlog.stdlib.BoundLogger = structlog.get_logger()
        with tracer.start_as_current_span(operation) as span:
            log.info("op_start", operation=operation)
            result: Result[R, E] = func(*args, **kwargs)
            _record_outcome(span, log, operation, result)
            return result
    return wrapper

# --- [FUNCTIONS] --------------------------------------------------------------


# Handler lifecycle: validate -> execute -> bridge -> serialize -> observe.
# API modules are thin adapters -- ALL business logic in domain services.
# See serialization.md [1] for dual-library boundary architecture.
def map_error(error: object) -> {{http_error_type}}:
    """Exhaustive error mapping from domain to HTTP via type dispatch."""
    match error:
        case NotFoundError() as err:
            return NotFoundHttpError(message=err.message)
        case ValidationError() as err:
            return ValidationHttpError(message=err.message)
        case ServiceError() as err:
            return InternalHttpError(message=err.message)
        case _:
            return InternalHttpError(message="Internal server error")


def to_{{resource_name}}_response(domain: {{domain_model}}) -> {{response_model}}:
    """Map domain -> response; use bridge_result/bridge_option for expression fields."""
    return {{response_expr}}


def encode_{{resource_name}}_response(
    response: {{response_model}},
) -> bytes:
    """Pydantic serializes response (including expression fields), then msgspec encodes."""
    wire: dict[str, object] = response.model_dump()
    return {{response_encoder}}.encode(wire)


@instrument
def handle_{{resource_name}}(raw: bytes) -> Result[bytes, {{http_error_type}}]:
    """Full boundary handler: validate -> process -> serialize -> remap errors."""
    return flow(
        raw,
        validate_{{resource_name}}_request,
        {{service_stage}},
        map_(to_{{resource_name}}_response),
        map_(encode_{{resource_name}}_response),
        lash(lambda err: Failure(map_error(err))),
    )


def handle_{{resource_name}}_result(
    result: Result[bytes, {{http_error_type}}],
) -> tuple[int, bytes]:
    """Terminal boundary: map Result to HTTP status + body."""
    match result:
        case Success(body):
            return (200, body)
        case Failure(http_error):
            return (
                http_error.status_code,
                {{response_encoder}}.encode(
                    {"error": http_error.message},
                ),
            )

# --- [EXPORT] -----------------------------------------------------------------

# All symbols above use explicit naming. No __all__, no default exports.
# Consumers import directly: from {{module_path}} import handle_{{resource_name}}
```

---
**Guidance: Expression Types and Boundary Architecture**

`expression.Option[T]` serializes as value or `null`; `expression.Result[T, E]` as tagged `{"ok": value}` / `{"error": err}` -- both via built-in `__get_pydantic_core_schema__`, no custom serializers needed. The bridge functions (`bridge_result`, `bridge_option`) convert `returns.Result` pipeline outputs to expression types at the boundary -- the ONE place both libraries coexist (see `SKILL.md` [8]). Pydantic validates ingress; for egress, use `BaseModel(frozen=True)` with expression fields or msgspec `Struct(frozen=True, gc=False)` for throughput. Domain models import neither. Error mapping is exhaustive via `match/case`; `@instrument` owns fused span + log + outcome projection. See `serialization.md` [1] for full dual-library pattern.

---
**Post-Scaffold Checklist** (from `validation.md`)

- [ ] BOUNDARY_VALIDATION: `TypeAdapter` at module level; `@safe` bridges `ValidationError` into `Result`; no per-request adapter creation
- [ ] SERIALIZATION_SPLIT: Pydantic validates inbound; expression types in response models auto-serialize; domain models import neither
- [ ] BRIDGE_EXPLICIT: `bridge_result`/`bridge_option` converts `returns.Result` -> `expression.Result`/`Option` at boundary only; no mid-pipeline mixing
- [ ] ERROR_MAPPING: Exhaustive `match`/`case` from domain errors to HTTP errors; `case _:` maps to 500
- [ ] TELEMETRY_FUSED: Single `@instrument` decorator owns span + log + metric; no split observability pipelines
- [ ] NO_DOMAIN_LOGIC: Handler delegates ALL business logic to domain services; API module is a thin adapter
- [ ] DENSITY: ~225 LOC target; one handler per resource action; no god handlers combining multiple resources
