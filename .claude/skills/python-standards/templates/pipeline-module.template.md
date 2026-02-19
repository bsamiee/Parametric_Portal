# [H1][PIPELINE_MODULE]
>**Dictum:** *Pipeline modules compose ROP stages, typed decorators, and structured logging into left-to-right data flow.*

Produces one railway-oriented pipeline module: stages returning `Result[T, E]` composed via `flow()` + `bind` from `returns.pointfree`, `@safe` bridging at foreign boundaries, typed decorator stacks with frozen config, and structured logging via `structlog.contextvars`. Pipeline modules own orchestration logic -- domain models and atoms are imported, never defined here.

**Density:** ~225 LOC signals a refactoring opportunity. No file proliferation; colocate stages in the pipeline module.
**References:** `effects.md` ([1] EFFECT_STACK, [2] CONTEXTUAL_EFFECTS), `decorators.md` ([1] PARAMSPEC_ALGEBRA, [3] ORDERING_ALGEBRA), `observability.md` ([1] SIGNAL_PIPELINE).
**Anti-Pattern Awareness:** See `patterns.md` [1] for BARE_TRY_EXCEPT, GOD_DECORATOR, MODEL_WITH_BEHAVIOR, NONE_RETURNS.
**Workflow:** Fill placeholders, remove guidance blocks, verify with ty and ruff.

---
**Placeholders**

- `{{module_path}}`: `pinnacle/ops/user_pipeline.py`
- `{{pipeline_name}}`: `process_user_request`
- `{{input_type}}`: `bytes`
- `{{output_type}}`: `UserId`
- `{{error_type}}`: `Exception`
- `{{stage_1_name}}` / `{{stage_2_name}}` / `{{stage_3_name}}` / `{{stage_4_name}}`: `parse_input`, `validate`, `enrich`, `persist`
- `{{stage_1_output}}` / `{{stage_2_output}}` / `{{stage_3_output}}`: `dict[str, object]`, `User`, `tuple[User, CorrelationId]`
- `{{retry_config}}`: `RetryConfig(max_attempts=3)`
- `{{trace_operation}}`: `user.process`
- `{{log_event}}`: `"user_processed"` + suffix
- `{{stage_2_success_expr}}`: `User.model_validate(data)`
- `{{stage_3_success_expr}}`: `(validated, CorrelationId("cid"))`
- `{{stage_4_success_expr}}`: `enriched[0].user_id`

---
```python
"""{{module_path}} -- Pipeline module: ROP stages composed via flow()."""

# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Callable
from functools import wraps

import structlog
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from pydantic import BaseModel, ConfigDict
from returns.pipeline import flow
from returns.pointfree import bind, lash, map_
from returns.result import Failure, Result, Success, safe

# Import domain types from their canonical modules:
# from pinnacle.domain.atoms import {{output_type}}, CorrelationId
# from pinnacle.domain.models import {{stage_2_output}}

# --- [TYPES] ----------------------------------------------------------------

# --- [ERRORS] ---------------------------------------------------------------

# Pipeline errors are typed values, not exceptions. Error types inherit from
# a frozen dataclass hierarchy. See effects.md [3] for error type patterns.
# Import domain-specific errors from the domain module.

# --- [STAGES] ---------------------------------------------------------------

# Stage 1: Foreign boundary -- @safe bridges exception-raising code into Result.
# @safe transforms the return type: def f(x) -> T becomes f(x) -> Result[T, Exception].
# See effects.md [1] for @safe usage at boundaries.
@safe
def {{stage_1_name}}(raw: {{input_type}}) -> {{stage_1_output}}:
    """Returns Result[{{stage_1_output}}, Exception] via @safe."""
    import msgspec
    return msgspec.json.decode(raw, type={{stage_1_output}})

# Stage 2: Domain validation -- returns Result explicitly, no @safe needed.
# Domain code constructs Success/Failure directly via match/case.
def {{stage_2_name}}(
    data: {{stage_1_output}},
) -> Result[{{stage_2_output}}, {{error_type}}]:
    structlog.contextvars.bind_contextvars(stage="{{stage_2_name}}")
    # Delegate to domain validation (TypeAdapter, smart constructors).
    return Success({{stage_2_success_expr}})

# Stage 3: Enrichment -- adds context (correlation IDs, timestamps, lookups).
def {{stage_3_name}}(
    validated: {{stage_2_output}},
) -> Result[{{stage_3_output}}, {{error_type}}]:
    structlog.contextvars.bind_contextvars(stage="{{stage_3_name}}")
    structlog.get_logger().info({{log_event}} + "_enriched")
    # Compose enrichment from domain atoms.
    return Success({{stage_3_success_expr}})

# Stage 4: Persistence boundary -- adapter interaction returning Result.
def {{stage_4_name}}(
    enriched: {{stage_3_output}},
) -> Result[{{output_type}}, {{error_type}}]:
    structlog.contextvars.bind_contextvars(stage="{{stage_4_name}}")
    structlog.get_logger().info({{log_event}} + "_persisted")
    # Delegate to adapter via Protocol port.
    return Success({{stage_4_success_expr}})

# --- [DECORATORS] -----------------------------------------------------------

# Decorator config as frozen Pydantic models -- immutable, validated,
# deterministic under free-threading (PEP 779).
# See decorators.md [1] for typed factory patterns.
class TraceConfig(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    record_args: bool = False
    span_name: str | None = None

class RetryConfig(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    max_attempts: int = 3
    timeout_seconds: float = 30.0

# Canonical ordering: trace > retry > cache > validate > authorize.
# See decorators.md [3] for ordering algebra and import-time validation.
def trace_span[**P, R](
    config: TraceConfig = TraceConfig(),
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """OpenTelemetry span decorator with frozen config."""
    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        name: str = config.span_name or func.__qualname__
        @wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            tracer: trace.Tracer = trace.get_tracer("pinnacle")
            with tracer.start_as_current_span(name) as span:
                match config:
                    case TraceConfig(record_args=True):
                        span.set_attribute("args", repr(args)[:256])
                    case _:
                        pass
                result: R = func(*args, **kwargs)
                span.set_status(StatusCode.OK)
                return result
        return wrapper
    return decorator

def retry[**P, R](
    config: RetryConfig,
    on: type[Exception] | tuple[type[Exception], ...] = Exception,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """stamina-backed retry with frozen config. See decorators.md [4]."""
    import stamina
    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        @wraps(func)
        @stamina.retry(on=on, attempts=config.max_attempts, timeout=config.timeout_seconds)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            return func(*args, **kwargs)
        return wrapper
    return decorator

# --- [PIPELINE] -------------------------------------------------------------

# Composed pipeline via flow(): left-to-right railway composition.
# Each stage returns Result; bind from returns.pointfree threads success
# values through the railway. Failure at any stage short-circuits.
# See effects.md [1] for flow() composition patterns.
@trace_span(TraceConfig(span_name="{{trace_operation}}"))
def {{pipeline_name}}(raw: {{input_type}}) -> Result[{{output_type}}, {{error_type}}]:
    """Railway: {{stage_1_name}} -> {{stage_2_name}} -> {{stage_3_name}} -> {{stage_4_name}}."""
    return flow(
        raw,
        {{stage_1_name}},               # @safe boundary -> Result
        bind({{stage_2_name}}),          # success-track monadic chain
        # map_(transform_fn),            # success-track pure transform (no Result)
        bind({{stage_3_name}}),          # success-track monadic chain
        # lash(recovery_fn),             # error-track recovery (fallback/remap)
        bind({{stage_4_name}}),          # success-track monadic chain
        # lash(log_and_remap_error),     # error-track transform (remap before boundary)
    )

# -- Boundary match: Result destructuring at program boundary only ---------
# match/case on Success/Failure is reserved for terminal boundaries
# (HTTP handlers, CLI entry points). Mid-pipeline, use map/bind exclusively.
def handle_{{pipeline_name}}_result(
    result: Result[{{output_type}}, {{error_type}}],
) -> tuple[int, str]:
    """Terminal boundary: destructure Result via match/case into typed HTTP response."""
    match result:
        case Success(value):
            structlog.get_logger().info({{log_event}} + "_success")
            return (200, str(value))
        case Failure(error):
            structlog.get_logger().error({{log_event}} + "_failure", error_type=type(error).__name__)
            return (500, str(error))
        case _:
            return (500, "unexpected result")

# --- [EXPORT] ---------------------------------------------------------------

# All symbols above use explicit naming. No __all__, no default exports.
# Consumers import directly: from {{module_path}} import {{pipeline_name}}
```

---
**Guidance**

- Railway composition: use `flow()` + `bind` as the default linear pipeline form; keep monadic stages explicit.
- Boundary bridging: use `@safe` only at foreign boundaries; domain stages should construct `Success`/`Failure` directly.
- Decorator ordering: preserve `trace > retry > cache > validate > authorize` and keep decorator config frozen.
- Structured logging: bind per-stage contextvars and emit structured events, never f-string logs.

---
**Post-Scaffold Checklist** (from `validation.md`)

- [ ] PIPELINE_INTEGRITY: Each stage returns `Result[T, E]`; no bare values or `None` returns; `@safe` at foreign boundaries only
- [ ] FLOW_COMPOSITION: `flow()` + `bind` for left-to-right composition; no manual `if result.is_success()` branching
- [ ] DECORATOR_ORDER: Canonical ordering (trace > retry > cache > validate > authorize); `ParamSpec` + `@wraps` on every decorator
- [ ] LOGGING: Structured event keys via `structlog.contextvars`; zero f-string log interpolation; `bind_contextvars` per stage
- [ ] NO_MATCH_MID_PIPELINE: `match`/`case` on `Success`/`Failure` appears ONLY at terminal boundary; mid-pipeline uses `map`/`bind`
- [ ] DENSITY: ~225 LOC target; stages are self-contained; no single-call private helpers
