# [H1][PIPELINE_MODULE]
>**Dictum:** *Pipeline modules compose ROP stages, typed decorators, and structured logging into left-to-right data flow.*

<br>

Produces one railway-oriented pipeline module: stages returning `Result[T, E]` composed via `flow()` + `bind` from `returns.pointfree` as the primary linear form, `@effect.result` generators as the alternative for complex branching, bridge functions converting `expression.Result` domain outputs to `returns.Result` pipeline inputs, `@safe` bridging at foreign boundaries, typed decorator stacks with frozen config, and structured logging via `structlog.contextvars`. Pipeline modules own orchestration logic -- domain models and atoms are imported, never defined here.

**Density:** ~225 LOC signals a refactoring opportunity. No file proliferation; colocate stages in the pipeline module.
**References:** `effects.md` ([1] EFFECT_STACK, [2] CONTEXTUAL_EFFECTS, [5] EXPRESSION_EFFECTS), `decorators.md` ([1] PARAMSPEC_ALGEBRA, [2] CLASS_LEVEL_PATTERNS), `algorithms.md` ([4] PIPELINE_COMPOSITION), `observability.md` ([1] SIGNAL_PIPELINE).
**Anti-Pattern Awareness:** See `patterns.md` [1] for BARE_TRY_EXCEPT, UNWRAP_MID_PIPELINE, BARE_FLOW_WITHOUT_BIND, MIXED_RESULT_LIBRARIES, EXPRESSION_PIPE_IN_RETURNS_FLOW.
**Workflow:** Fill placeholders, remove guidance blocks, verify with ty and ruff.

---
**Placeholders**

| [INDEX] | [PLACEHOLDER]          | [EXAMPLE]                       |
| :-----: | ---------------------- | ------------------------------- |
|   [1]   | `{{module_path}}`      | `pinnacle/ops/user_pipeline.py` |
|   [2]   | `{{pipeline_name}}`    | `process_user_request`          |
|   [3]   | `{{input_type}}`       | `bytes`                         |
|   [4]   | `{{output_type}}`      | `UserId`                        |
|   [5]   | `{{error_type}}`       | `Exception`                     |
|   [6]   | `{{stage_1_name}}`     | `parse_input`                   |
|   [7]   | `{{stage_2_name}}`     | `validate`                      |
|   [8]   | `{{stage_3_name}}`     | `enrich`                        |
|   [9]   | `{{stage_4_name}}`     | `persist`                       |
|  [10]   | `{{stage_1_output}}`   | `dict[str, object]`             |
|  [11]   | `{{stage_2_output}}`   | `User`                          |
|  [12]   | `{{stage_3_output}}`   | `tuple[User, CorrelationId]`    |
|  [13]   | `{{retry_config}}`     | `RetryConfig(max_attempts=3)`   |
|  [14]   | `{{trace_operation}}`  | `user.process`                  |
|  [15]   | `{{log_event}}`        | `"user_processed"`              |
|  [16]   | `{{domain_module}}`    | `pinnacle.domain.users`         |
|  [17]   | `{{domain_result_fn}}` | `make_email`                    |

---
```python
"""{{module_path}} -- Pipeline module: ROP stages composed via flow() + @effect.result."""

# --- [IMPORTS] ----------------------------------------------------------------

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import cast, TYPE_CHECKING

from expression import Result as ExprResult
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from pydantic import BaseModel, ConfigDict
from returns.pipeline import flow
from returns.pointfree import bind, lash, map_
from returns.result import Failure, Result, safe, Success
import structlog

# Domain types from canonical modules (expression.Result convention):
# from {{domain_module}} import {{output_type}}, {{stage_2_output}}, CorrelationId

if TYPE_CHECKING:
    pass  # Move annotation-only imports here

# --- [ERRORS] -----------------------------------------------------------------

# Pipeline errors are typed values, not exceptions. Import domain-specific
# errors from the domain module. See effects.md [3] for error algebra patterns.

# --- [BRIDGE] -----------------------------------------------------------------


# Bridge: expression.Result (domain outputs) -> returns.Result (pipeline inputs).
# Domain smart constructors return expression.Result; pipeline stages consume
# returns.Result. Bridge at the boundary only. See effects.md [5], SKILL.md [8].
def bridge_result[T, E](expr: ExprResult[T, E]) -> Result[T, E]:
    """Convert expression.Result to returns.Result at layer boundary."""
    match expr:
        case ExprResult(tag="ok", ok=value):
            return Success(value)
        case ExprResult(tag="error", error=error):
            return Failure(error)

# --- [STAGES] -----------------------------------------------------------------


# Stage 1: Foreign boundary -- @safe bridges exception-raising code into Result.
# @safe transforms: def f(x) -> T becomes f(x) -> Result[T, Exception].
# See effects.md [1] for @safe usage at boundaries.
@safe
def {{stage_1_name}}(raw: {{input_type}}) -> {{stage_1_output}}:
    """Returns Result[{{stage_1_output}}, Exception] via @safe."""
    import msgspec
    return msgspec.json.decode(raw, type={{stage_1_output}})


# Stage 2: Domain validation -- bridges expression.Result from smart constructor.
# Domain code returns expression.Result; pipeline bridges to returns.Result.
def {{stage_2_name}}(
    data: {{stage_1_output}},
) -> Result[{{stage_2_output}}, {{error_type}}]:
    """Validate domain input via smart constructor bridge."""
    structlog.contextvars.bind_contextvars(stage="{{stage_2_name}}")
    # Bridge domain smart constructor output into pipeline railway:
    # return bridge_result({{domain_result_fn}}(data))
    return Success({{stage_2_output}}.model_validate(data))


# Stage 3: Enrichment -- adds context (correlation IDs, timestamps, lookups).
def {{stage_3_name}}(
    validated: {{stage_2_output}},
) -> Result[{{stage_3_output}}, {{error_type}}]:
    """Enrich validated entity with correlation context."""
    structlog.contextvars.bind_contextvars(stage="{{stage_3_name}}")
    structlog.get_logger().info({{log_event}}, step="enriched")
    return Success((validated, CorrelationId("cid")))


# Stage 4: Persistence boundary -- adapter interaction returning Result.
def {{stage_4_name}}(
    enriched: {{stage_3_output}},
) -> Result[{{output_type}}, {{error_type}}]:
    """Persist enriched entity via adapter boundary."""
    structlog.contextvars.bind_contextvars(stage="{{stage_4_name}}")
    structlog.get_logger().info({{log_event}}, step="persisted")
    return Success(enriched[0].user_id)

# --- [DECORATORS] -------------------------------------------------------------


# Decorator config as frozen Pydantic models -- immutable, validated,
# deterministic under free-threading (PEP 779). See decorators.md [1].
class TraceConfig(BaseModel, frozen=True):
    """Immutable tracing configuration."""

    model_config = ConfigDict(strict=True)
    record_args: bool = False
    span_name: str | None = None


class RetryConfig(BaseModel, frozen=True):
    """Immutable retry configuration."""

    model_config = ConfigDict(strict=True)
    max_attempts: int = 3
    timeout_seconds: float = 30.0


_DEFAULT_TRACE_CONFIG: TraceConfig = TraceConfig()


# Canonical ordering: trace > retry > cache > validate > authorize.
# See decorators.md [2] for ordering algebra.
def trace_span[**P, R](
    config: TraceConfig = _DEFAULT_TRACE_CONFIG,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """OpenTelemetry span factory with frozen config. See decorators.md [1]."""
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
                result = cast("Callable[..., object]", func)(*args, **kwargs)
                span.set_status(StatusCode.OK)
                return result
        return cast("Callable[P, R]", wrapper)
    return cast("Callable[[Callable[P, R]], Callable[P, R]]", decorator)

# --- [PIPELINE] ---------------------------------------------------------------


# PRIMARY FORM: flow() + bind -- left-to-right railway composition.
# Each stage returns Result; bind threads success values. Failure short-circuits.
# See effects.md [1], algorithms.md [4] for composition patterns.
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
    )

# ALTERNATIVE FORM: @effect.result generator -- for complex branching.
# Use when flow() + bind becomes deeply nested or requires conditional logic.
# See effects.md [5], algorithms.md [4].
#
# from expression import Effect, effect
# @effect.result[{{output_type}}, {{error_type}}]()
# def {{pipeline_name}}_branching(raw: {{input_type}}) -> Effect[ExprResult[{{output_type}}, {{error_type}}]]:
#     parsed: {{stage_1_output}} = yield from bridge_to_expr({{stage_1_name}}(raw))
#     validated: {{stage_2_output}} = yield from bridge_to_expr(bind({{stage_2_name}})(Success(parsed)))
#     return (yield from bridge_to_expr(bind({{stage_4_name}})(Success(validated))))

# --- [BOUNDARY] ---------------------------------------------------------------


# match/case on Success/Failure is reserved for terminal boundaries
# (HTTP handlers, CLI entry points). Mid-pipeline, use map/bind exclusively.
# See effects.md [3] for error algebra patterns.
def handle_{{pipeline_name}}_result(
    result: Result[{{output_type}}, {{error_type}}],
) -> tuple[int, str]:
    """Terminal boundary: destructure Result into typed HTTP response."""
    log: structlog.stdlib.BoundLogger = structlog.get_logger()
    match result:
        case Success(value):
            log.info({{log_event}}, outcome="success")
            return (200, str(value))
        case Failure(error):
            log.error({{log_event}}, outcome="failure", error_type=type(error).__name__)
            return (500, str(error))

# --- [EXPORT] -----------------------------------------------------------------

# All symbols above use explicit naming. No __all__, no default exports.
# Consumers import directly: from {{module_path}} import {{pipeline_name}}
```

---
**Guidance**

*Railway composition* -- `flow()` + `bind` is the primary linear pipeline form. Each stage returns `Result[T, E]`; `bind` chains monadic stages, `map_` applies pure transforms, `lash` remaps the error track. Keep stages self-contained and composable. See `effects.md` [1], `algorithms.md` [4].

*Generator-based alternative* -- `@effect.result` (from `expression`) provides full Python control flow (`match/case`, loops, early returns) within monadic context. Use when branching complexity exceeds what `flow()` + `bind` expresses cleanly. Since `@effect.result` produces `expression.Result`, bridge to `returns.Result` at the pipeline boundary. See `effects.md` [5].

*Bridge pattern* -- Domain smart constructors return `expression.Result` per `SKILL.md` [8] convention. Pipeline modules use `returns.Result` for `flow()` composition. `bridge_result` converts at the boundary via `match/case` destructuring -- the only place both libraries' types coexist. See `effects.md` [5] for bridge details.

*Decorator ordering and config* -- Preserve canonical `trace > retry > cache > validate > authorize` ordering. Decorator config is a frozen Pydantic model -- immutable, validated, deterministic. See `decorators.md` [1][2].

---
**Post-Scaffold Checklist** (from `validation.md`)

- [ ] PIPELINE_INTEGRITY: Each stage returns `Result[T, E]`; no bare values or `None` returns; `@safe` at foreign boundaries only. See `validation.md` [2].
- [ ] FLOW_COMPOSITION: `flow()` + `bind` for left-to-right; `@effect.result` for complex branching; no manual `if result.is_success()` branching. See `validation.md` [2].
- [ ] BRIDGE_DISCIPLINE: `bridge_result` at domain->pipeline boundary only; no mixing `expression.Ok` and `returns.Success` in same stage. See `validation.md` [2].
- [ ] DECORATOR_ORDER: Canonical ordering (trace > retry > cache > validate > authorize); `ParamSpec` + `@wraps` on every decorator. See `validation.md` [4].
- [ ] LOGGING: Structured event keys via `structlog.contextvars`; zero f-string log interpolation; `bind_contextvars` per stage. See `observability.md` [1].
- [ ] NO_MATCH_MID_PIPELINE: `match`/`case` on `Success`/`Failure` appears ONLY at terminal boundary; mid-pipeline uses `map`/`bind`. See `validation.md` [2].
- [ ] DENSITY: ~225 LOC target; stages are self-contained; no single-call private helpers. See `validation.md` [6].
