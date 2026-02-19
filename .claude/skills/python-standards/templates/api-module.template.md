# [H1][API_MODULE]
>**Dictum:** *API modules own boundary translation: external data enters validated, internal results exit serialized, telemetry observes both channels.*

Produces one API boundary module: Pydantic `TypeAdapter` validates inbound data, domain logic processes validated models, msgspec `Struct(frozen=True, gc=False)` serializes outbound responses, error mapping translates domain errors to HTTP errors, and fused telemetry via `@instrument` observes the full request lifecycle. API modules are thin adapters -- zero domain logic lives here.

**Density:** ~225 LOC signals a refactoring opportunity. No file proliferation; colocate boundary concerns in the API module.
**References:** `observability.md` ([1] SIGNAL_PIPELINE), `serialization.md` ([1] INBOUND_VALIDATION_PIPELINE, [2] MSGSPEC_STRUCTS, [3] CORE_SCHEMA), `effects.md` ([1] EFFECT_STACK).
**Anti-Pattern Awareness:** See `patterns.md` [1] for BARE_TRY_EXCEPT, MODEL_WITH_BEHAVIOR, STRING_ERROR_DISPATCH, HASATTR_GETATTR.
**Workflow:** Fill placeholders, remove guidance blocks, verify with ty and ruff.

---
**Placeholders**

- `{{module_path}}`: `pinnacle/adapters/user_api.py`
- `{{resource_name}}`: `user`
- `{{request_model}}`: `UserRequest`
- `{{response_model}}`: `UserResponse`
- `{{domain_model}}`: `User`
- `{{error_mapping}}`: `NotFoundError -> 404, ValidationError -> 422`
- `{{request_adapter}}`: `UserRequestAdapter`
- `{{response_encoder}}`: `_encoder`
- `{{trace_operation}}`: `"user.create"`
- `{{service_protocol}}`: `Repository[User]`
- `{{deps_class}}`: `ApiDeps`
- `{{http_error_type}}`: `HttpError`
- `{{request_fields}}`: `email: Email`
- `{{response_fields}}`: `user_id: int`
- `{{service_stage}}`: `bind(service.create_user)`
- `{{response_expr}}`: `{{response_model}}(user_id=domain.user_id)`

---
```python
"""{{module_path}} -- API module: boundary validation, serialization, telemetry."""

# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from functools import wraps
from pathlib import Path
from uuid import UUID

import msgspec
import structlog
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from pydantic import BaseModel, ConfigDict, TypeAdapter
from returns.pipeline import flow
from returns.pointfree import bind, lash, map_
from returns.result import Failure, Result, Success, safe

# Import domain types from their canonical modules:
# from pinnacle.domain.errors import NotFoundError, ValidationError
# from pinnacle.domain.models import {{domain_model}}
# from pinnacle.ops.service import {{service_protocol}}

# --- [ERRORS] ---------------------------------------------------------------

# HTTP-level errors are frozen dataclasses mapping domain errors to status codes.
# Error mapping is exhaustive via match/case -- no unmapped error escapes.
@dataclass(frozen=True, slots=True)
class {{http_error_type}}:
    message: str = "Error"
    status_code: int = 500

@dataclass(frozen=True, slots=True)
class NotFoundHttpError({{http_error_type}}):
    message: str = "Not found"
    status_code: int = 404

@dataclass(frozen=True, slots=True)
class ValidationHttpError({{http_error_type}}):
    message: str = "Validation error"
    status_code: int = 422

@dataclass(frozen=True, slots=True)
class InternalHttpError({{http_error_type}}):
    message: str = "Internal server error"
    status_code: int = 500

# --- [REQUEST] --------------------------------------------------------------

# Pydantic TypeAdapter validates inbound data at the API boundary.
# TypeAdapter initialization is eager at module level -- never per-request.
# @safe bridges ValidationError into Result[T, Exception].
# See serialization.md [1] for TypeAdapter boundary patterns.

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

# --- [RESPONSE] -------------------------------------------------------------

# msgspec Struct(frozen=True, gc=False) serializes outbound responses.
# Zero-GC, C-backed objects excluded from garbage collection cycles.
# Domain models never import msgspec; wire formats are adapter concerns.
# See serialization.md [2] for msgspec struct patterns.

class {{response_model}}(msgspec.Struct, frozen=True, gc=False):
    """Outbound response schema -- msgspec encodes at egress."""
    {{response_fields}}

def _enc_hook(obj: object) -> str | float:
    """Custom type serialization for boundary types."""
    match obj:
        case datetime() as value:
            return value.isoformat()
        case date() as value:
            return value.isoformat()
        case UUID() as value:
            return str(value)
        case Decimal() as value:
            return str(value)
        case Path() as value:
            return str(value)
        case Enum() as value:
            return value.value
        case _:
            # Foreign boundary: msgspec hook contract requires TypeError for unknown types.
            raise TypeError(f"Cannot encode {type(obj)}")

{{response_encoder}}: msgspec.json.Encoder = msgspec.json.Encoder(
    enc_hook=_enc_hook,
)

def to_{{resource_name}}_response(
    domain: {{domain_model}},
) -> {{response_model}}:
    """Map domain model to wire response via match/case."""
    # Transform domain model fields to response struct fields.
    return {{response_expr}}

def encode_{{resource_name}}_response(
    response: {{response_model}},
) -> bytes:
    """msgspec encodes response struct to JSON bytes."""
    return {{response_encoder}}.encode(response)

# --- [TELEMETRY] ------------------------------------------------------------

# Fused telemetry: single @instrument decorator owns span + log + metric.
# Business code never calls tracing/logging APIs directly.
# See observability.md [1] for signal fusion patterns.

def instrument[**P, R](
    func: Callable[P, Result[R, Exception]],
) -> Callable[P, Result[R, Exception]]:
    """Fused observability: span + structured log + outcome projection."""
    # Derives operation from wrapped function; override with a literal if needed
    # (e.g., operation: str = "{{resource_name}}.handler").
    operation: str = f"{func.__module__}.{func.__qualname__}"
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> Result[R, Exception]:
        tracer: trace.Tracer = trace.get_tracer("pinnacle.api")
        log: structlog.stdlib.BoundLogger = structlog.get_logger()
        with tracer.start_as_current_span(operation) as span:
            log.info("op_start", operation=operation)
            result: Result[R, Exception] = func(*args, **kwargs)
            match result:
                case Success(_):
                    span.set_status(StatusCode.OK)
                    log.info("op_success", operation=operation)
                case Failure(error):
                    span.record_exception(error)
                    span.set_status(StatusCode.ERROR, str(error))
                    log.error(
                        "op_failure",
                        operation=operation,
                        error_type=type(error).__name__,
                    )
            return result
    return wrapper

# --- [FUNCTIONS] ------------------------------------------------------------

# The handler composes the full boundary lifecycle:
# 1. Validate inbound (Pydantic TypeAdapter)
# 2. Execute domain logic (service Protocol)
# 3. Map errors (match/case exhaustive)
# 4. Serialize outbound (msgspec Encoder)
# 5. Observe both channels (fused telemetry)
#
# API modules are thin adapters -- ALL business logic lives in domain services.
# See serialization.md [1] for dual-library boundary architecture.

def map_error(error: object) -> {{http_error_type}}:
    """Exhaustive error mapping from domain to HTTP via type dispatch.
    Import domain errors: from pinnacle.domain.errors import ServiceError, NotFoundError, ValidationError
    ServiceError subclasses are frozen dataclasses (not Exception subclasses);
    the union type handles both domain errors and unexpected exceptions.
    """
    match error:
        case NotFoundError() as err:
            return NotFoundHttpError(message=err.message)
        case ValidationError() as err:
            return ValidationHttpError(message=err.message)
        case ServiceError() as err:
            return InternalHttpError(message=err.message)
        case _:
            return InternalHttpError(message="Internal server error")

@instrument
def handle_{{resource_name}}(raw: bytes) -> Result[bytes, {{http_error_type}}]:
    """Full boundary handler: validate -> process -> serialize -> remap errors."""
    return flow(
        raw,
        validate_{{resource_name}}_request,
        {{service_stage}},
        map_(to_{{resource_name}}_response),
        map_(encode_{{resource_name}}_response),
        lash(lambda err: Failure(map_error(err))),  # error mapping inside the railway
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
        case _:
            return (500, {{response_encoder}}.encode({"error": "unexpected result"}))

# --- [EXPORT] ---------------------------------------------------------------

# All symbols above use explicit naming. No __all__, no default exports.
# Consumers import directly: from {{module_path}} import handle_{{resource_name}}
```

---
**Guidance**

- Boundary validation: keep `TypeAdapter` module-scoped; use `validate_json()` / `validate_python()` plus `@safe` for railway compatibility.
- Serialization split: Pydantic validates ingress, msgspec encodes egress, domain models remain wire-agnostic.
- Error mapping: exhaustive `match/case` from domain errors to HTTP errors; reserve `case _:` for internal fallback.
- Fused telemetry: `@instrument` owns span/log outcome projection; business code remains telemetry-agnostic.

---
**Post-Scaffold Checklist** (from `validation.md`)

- [ ] BOUNDARY_VALIDATION: `TypeAdapter` at module level; `@safe` bridges `ValidationError` into `Result`; no per-request adapter creation
- [ ] SERIALIZATION_SPLIT: Pydantic validates inbound; msgspec encodes outbound; domain models import neither
- [ ] ERROR_MAPPING: Exhaustive `match`/`case` from domain errors to HTTP errors; `case _:` maps to 500
- [ ] TELEMETRY_FUSED: Single `@instrument` decorator owns span + log + metric; no split observability pipelines
- [ ] NO_DOMAIN_LOGIC: Handler delegates ALL business logic to domain services; API module is a thin adapter
- [ ] DENSITY: ~225 LOC target; one handler per resource action; no god handlers combining multiple resources
