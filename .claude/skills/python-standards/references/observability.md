# [H1][OBSERVABILITY]
>**Dictum:** *Signals are one algebra: span, log, and metric execute as a fused tap over typed outcomes.*

<br>

Observability in Python 3.14+ fuses traces, logs, and metrics behind one `@instrument` surface. `structlog` builds event dicts, `logging` transports, and `OpenTelemetry SDK >= 1.39` exports spans/logs through `ReadableLogRecord`. Correlation flows through `ContextVar` and `merge_contextvars`. All snippets target `structlog >= 25.5`, `opentelemetry-sdk >= 1.39`, `match/case` dispatch, and explicit boundary loops only.

---
## [1][SIGNAL_PIPELINE]
>**Dictum:** *One decorator owns span + log + metric projection; the processor chain is a pure transformation pipeline.*

<br>

`@instrument` creates a span, emits structured start/success/failure events, and projects `Result` outcomes into telemetry. The structlog chain is pure transformation: `merge_contextvars` -> `CallsiteParameterAdder` -> `add_log_level` -> `TimeStamper` -> `inject_trace_identifiers` -> stdlib bridge.

```python
"""@instrument + structlog processor chain: fused signal pipeline."""

# --- [IMPORTS] ----------------------------------------------------------------

import logging
from collections.abc import Callable
from contextvars import ContextVar
from functools import wraps
from typing import cast

import structlog
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from returns.result import Failure, Result, Success
from structlog.contextvars import merge_contextvars
from structlog.processors import (
    CallsiteParameter, CallsiteParameterAdder, TimeStamper, add_log_level,
)
from structlog.stdlib import BoundLogger, LoggerFactory, ProcessorFormatter
from structlog.types import Processor

# --- [CODE] -------------------------------------------------------------------

_correlation_id: ContextVar[str] = ContextVar("correlation_id", default="none")

def _record_outcome[R](
    span: trace.Span, log: BoundLogger, name: str, result: Result[R, Exception],
) -> None:
    match result:
        case Success(_):
            span.set_status(StatusCode.OK)
            log.info("op_success", operation=name)
        case Failure(error):
            span.record_exception(error)
            span.set_status(StatusCode.ERROR, str(error))
            log.error("op_failure", operation=name, error_type=type(error).__name__)

def instrument[**P, R](
    func: Callable[P, Result[R, Exception]],
) -> Callable[P, Result[R, Exception]]:
    """Fused observability: span + structured log + outcome projection."""
    operation: str = f"{func.__module__}.{func.__qualname__}"
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> Result[R, Exception]:
        tracer: trace.Tracer = trace.get_tracer("pinnacle.observability")
        with tracer.start_as_current_span(operation) as span:
            log: BoundLogger = structlog.get_logger()
            log.info("op_start", operation=operation)
            result: Result[R, Exception] = func(*args, **kwargs)
            _record_outcome(span, log, operation, result)
            return result
    return wrapper
# instrument_async: identical structure with async/await + ainfo/aerror log methods

def _inject_trace_identifiers(
    _logger: object, _method_name: str, event_dict: dict[str, object],
) -> dict[str, object]:
    """Inject OTel trace/span IDs + correlation ID. See CONTEXT_THREADING [2]."""
    ctx: trace.SpanContext = trace.get_current_span().get_span_context()
    return {
        **event_dict, "correlation_id": _correlation_id.get(),
        **({"trace_id": format(ctx.trace_id, "032x"),
            "span_id": format(ctx.span_id, "016x")} if ctx.is_valid else {}),
    }

def configure_structlog() -> None:
    processors: tuple[Processor, ...] = (
        cast(Processor, merge_contextvars),
        cast(Processor, CallsiteParameterAdder(
            {CallsiteParameter.MODULE, CallsiteParameter.FUNC_NAME, CallsiteParameter.LINENO},
        )),
        cast(Processor, add_log_level),
        cast(Processor, TimeStamper(fmt="iso", utc=True)),
        cast(Processor, _inject_trace_identifiers),
        cast(Processor, ProcessorFormatter.wrap_for_formatter),
    )
    structlog.configure(
        processors=processors, logger_factory=LoggerFactory(),
        wrapper_class=BoundLogger, cache_logger_on_first_use=True,
    )
    handler: logging.StreamHandler = logging.StreamHandler()
    handler.setFormatter(ProcessorFormatter(
        processor=structlog.processors.JSONRenderer(),
    ))
    root: logging.Logger = logging.getLogger()  # noqa: TID251 -- bootstrap wires stdlib root
    root.handlers = [handler]
    root.setLevel(logging.INFO)
```

| [INDEX] | [PROCESSOR]                | [RESPONSIBILITY]                                          |
| :-----: | -------------------------- | --------------------------------------------------------- |
|   [1]   | `merge_contextvars`        | Inject context-local bindings into event dict             |
|   [2]   | `CallsiteParameterAdder`   | Attach module, function name, line number                 |
|   [3]   | `add_log_level`            | Add `level` key from stdlib log level                     |
|   [4]   | `TimeStamper(fmt="iso")`   | ISO 8601 UTC timestamp                                    |
|   [5]   | `inject_trace_identifiers` | OTel `trace_id` + `span_id` + `correlation_id`            |
|   [6]   | `wrap_for_formatter`       | Bridge to stdlib `ProcessorFormatter` -- MUST be terminal |

[CRITICAL]:
- [NEVER] Split logging, tracing, and metrics into separate decorator layers -- fuse in one surface.
- [ALWAYS] Project outcome via match/case on `Result` -- never catch exceptions for observability.
- [NEVER] Use `AsyncBoundLogger` -- deprecated since 23.1.0. Use `FilteringBoundLogger` with `ainfo`/`aerror`.
- [ALWAYS] Place `merge_contextvars` first in the processor chain.

---
## [2][CONTEXT_THREADING]
>**Dictum:** *ContextVar is the sole mechanism for threading correlation through async boundaries.*

<br>

A custom processor reads `trace_id` (32-char hex) and `span_id` (16-char hex) from the active OTel span context. `bind_contextvars()` sets context-local pairs that `merge_contextvars` injects into every log event. Each `anyio` task inherits a snapshot of the parent context automatically.

```python
"""OTel trace correlation + ContextVar lifecycle management."""

# --- [IMPORTS] ----------------------------------------------------------------

from contextvars import ContextVar

import structlog
from anyio import create_task_group
from anyio.lowlevel import checkpoint
from structlog.contextvars import bind_contextvars, bound_contextvars, clear_contextvars

# --- [CODE] -------------------------------------------------------------------

_correlation_id: ContextVar[str] = ContextVar("correlation_id", default="none")

def set_correlation_id(value: str) -> None:
    """Thread correlation ID into ContextVar for downstream log injection."""
    _correlation_id.set(value)

async def handle_request(request_id: str, tasks: tuple[str, ...]) -> None:
    """Bind context at entry; child tasks inherit; scoped binds for sub-ops."""
    clear_contextvars()
    bind_contextvars(request_id=request_id, handler="ingress")
    log: structlog.stdlib.BoundLogger = structlog.get_logger()
    await log.ainfo("request_accepted", task_count=len(tasks))
    # Side-effect boundary: task spawning is inherently imperative IO
    async with create_task_group() as task_group:
        for name in tasks:
            task_group.start_soon(_process_task, name)
    clear_contextvars()

async def _process_task(task_name: str) -> None:
    with bound_contextvars(task_name=task_name):
        log: structlog.stdlib.BoundLogger = structlog.get_logger()
        await log.ainfo("task_start")
        await checkpoint()
        await log.ainfo("task_complete")
```

Propagation paths:
- Request entry: `clear_contextvars()` -> `bind_contextvars(...)` -> clear on exit.
- Child task: `ContextVar` snapshot inheritance via AnyIO task groups.
- Scoped sub-op: `bound_contextvars(...)` with automatic unbind on exit.
- Cross-thread: per-thread `ContextVar` isolation. See `concurrency.md` [2].
- Span correlation: `trace.get_current_span()` via OTel context propagation.

---
## [3][BOOTSTRAP]
>**Dictum:** *Telemetry initialization is an imperative shell concern; SDK wiring executes once at startup.*

<br>

`bootstrap_telemetry()` configures: (1) `Resource` identity, (2) `TracerProvider` + `BatchSpanProcessor`, (3) `LoggerProvider` + `BatchLogRecordProcessor` (OTel >= 1.39 -- `LogData` removed), (4) structlog chain. Init order: Resource -> Exporters -> Processors -> Providers -> Global. Called once at startup -- never at import time.

```python
"""bootstrap_telemetry(): OTel TracerProvider + LoggerProvider + structlog."""

# --- [IMPORTS] ----------------------------------------------------------------

import logging

from opentelemetry import trace
from opentelemetry._logs import set_logger_provider  # noqa: PLC2701
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler  # noqa: PLC2701
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor, InMemoryLogRecordExporter  # noqa: PLC2701
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

# --- [FUNCTIONS] --------------------------------------------------------------

def bootstrap_telemetry(
    service_name: str, service_version: str = "0.0.0",
) -> tuple[TracerProvider, LoggerProvider]:
    """Wire OTel TracerProvider + LoggerProvider + structlog processor chain."""
    resource: Resource = Resource.create({
        "service.name": service_name, "service.version": service_version,
    })
    trace_provider: TracerProvider = TracerProvider(resource=resource)
    trace_provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    trace.set_tracer_provider(trace_provider)
    # on_emit receives ReadWriteLogRecord; exporters get ReadableLogRecord
    log_provider: LoggerProvider = LoggerProvider(resource=resource)
    log_provider.add_log_record_processor(BatchLogRecordProcessor(InMemoryLogRecordExporter()))
    set_logger_provider(log_provider)
    logging.getLogger().addHandler(  # noqa: TID251 -- OTel handler must attach to stdlib root
        LoggingHandler(level=logging.NOTSET, logger_provider=log_provider),
    )
    LoggingInstrumentor().instrument(set_logging_format=False)
    configure_structlog()
    return trace_provider, log_provider
```

[CRITICAL]:
- [NEVER] Initialize telemetry at import time -- SDK setup belongs in the imperative shell.
- [ALWAYS] Use `BatchSpanProcessor` / `BatchLogRecordProcessor` for production.
- [ALWAYS] Use `ReadableLogRecord` for export (OTel >= 1.39) -- `LogData` removed.
- [ALWAYS] All global registrations (`set_tracer_provider`, `set_meter_provider`, `set_logger_provider`) are write-once.

---
## [4][METRICS_PROJECTION]
>**Dictum:** *RED metrics (Rate/Error/Duration) are projections from Result outcomes, not parallel instrumentation branches.*

<br>

`@instrument` projects counters and histograms from `Success`/`Failure` via `opentelemetry.metrics`. Rate is a monotonic counter per call. Error is a monotonic counter per `Failure`. Duration is a histogram recording elapsed seconds. All share the `operation` dimension for dashboard correlation.

```python
"""RED metrics projection from Result outcomes via @instrument."""

# --- [IMPORTS] ----------------------------------------------------------------

import time
from collections.abc import Callable
from functools import wraps

from opentelemetry import metrics, trace
from opentelemetry.trace import StatusCode
from returns.result import Failure, Result, Success

# --- [CONSTANTS] --------------------------------------------------------------

_meter: metrics.Meter = metrics.get_meter("pinnacle.service")
_request_counter: metrics.Counter = _meter.create_counter(
    name="service.requests.total", unit="requests",
    description="Total request outcomes by operation and status.",
)
_error_counter: metrics.Counter = _meter.create_counter(
    name="service.errors.total", unit="errors",
    description="Total error outcomes by operation and error type.",
)
_duration_histogram: metrics.Histogram = _meter.create_histogram(
    name="service.request.duration", unit="s",
    description="Request duration in seconds.",
)

# --- [FUNCTIONS] --------------------------------------------------------------

def _record_outcome_with_metrics[R](
    span: trace.Span, name: str, result: Result[R, Exception], elapsed: float,
) -> None:
    _request_counter.add(1, {"operation": name, "outcome": "total"})
    _duration_histogram.record(elapsed, {"operation": name})
    match result:
        case Success(_):
            span.set_status(StatusCode.OK)
            _request_counter.add(1, {"operation": name, "outcome": "success"})
        case Failure(error):
            span.record_exception(error)
            span.set_status(StatusCode.ERROR, str(error))
            _error_counter.add(1, {"operation": name, "error_type": type(error).__name__})

def instrument_with_metrics[**P, R](
    func: Callable[P, Result[R, Exception]],
) -> Callable[P, Result[R, Exception]]:
    """Fused: span + RED metrics projected from Result outcome."""
    operation: str = f"{func.__module__}.{func.__qualname__}"
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> Result[R, Exception]:
        tracer: trace.Tracer = trace.get_tracer("pinnacle.observability")
        start: float = time.monotonic()
        with tracer.start_as_current_span(operation) as span:
            result: Result[R, Exception] = func(*args, **kwargs)
            elapsed: float = time.monotonic() - start
            _record_outcome_with_metrics(span, operation, result, elapsed)
            return result
    return wrapper
```

**expression.Result alternative** -- `expression.Ok`/`expression.Error` match identically in `_record_outcome_with_metrics`; substitute `case Ok(_):`/`case Err(error):` for `case Success(_):`/`case Failure(error):`. Bridge at the observability boundary via `from expression import Result as ExprResult, Ok, Error as Err`. See `SKILL.md` [8] for library split.

RED instruments: **Rate** `service.requests.total` (counter, `operation` + `outcome`), **Error** `service.errors.total` (counter, `operation` + `error_type`), **Duration** `service.request.duration` (histogram, `operation`). Dimension stability is critical -- `operation` keys must match across all three for dashboard joins.

Cross-references: `effects.md` [3] for Result error algebra, `decorators.md` [1] for ParamSpec signatures.

---
## [5][RULES]
>**Dictum:** *Observability quality is consistency under composition pressure.*

<br>

- [NEVER] Split logs, traces, and metrics across separate decorators -- fuse in one surface.
- [NEVER] Use deprecated `AsyncBoundLogger`; use async methods on `BoundLogger`.
- [NEVER] Scatter `get_current_span()` through business logic -- inject via `@instrument`.
- [NEVER] Initialize telemetry providers at import time.
- [ALWAYS] Export logs with `ReadableLogRecord` (OTel >= 1.39).
- [ALWAYS] Implement `on_emit()` for custom log processors.
- [ALWAYS] Keep `merge_contextvars` first, `wrap_for_formatter` terminal in processor chain.
- [ALWAYS] Clear, bind, and scope context vars per request lifecycle.
- [ALWAYS] Project RED metrics from `Result` outcomes -- never from exception handlers.
- [ALWAYS] Use stable `operation` dimension keys across all metric instruments.
- [PREFER] `msgspec.json.encode` as JSON serializer backend for structlog.
- [PREFER] `expression.Result` match in domain-model-heavy modules. See `SKILL.md` [8].

---
## [6][QUICK_REFERENCE]
>**Dictum:** *One table maps pattern to context.*

<br>

| [INDEX] | [PATTERN]                  | [WHEN]                                    | [KEY_TRAIT]                            |
| :-----: | -------------------------- | ----------------------------------------- | -------------------------------------- |
|   [1]   | `@instrument[_async]`      | Fused result-aware telemetry (sync/async) | Span + log + outcome projection        |
|   [2]   | Processor chain            | Structured log shaping + stdlib bridge    | Pure transformation pipeline           |
|   [3]   | Trace correlation          | Inject `trace_id`/`span_id` centrally     | Custom structlog processor             |
|   [4]   | Context propagation        | Carry request metadata across async tasks | `ContextVar` + `bind_contextvars`      |
|   [5]   | `ReadableLogRecord`        | Modern OTel log export shape              | Required for OTel >= 1.39              |
|   [6]   | `bootstrap_telemetry`      | One-shot startup wiring                   | Resource -> Providers -> Global        |
|   [7]   | RED metrics projection     | Rate/Error/Duration from Result outcomes  | Counter + Counter + Histogram          |
|   [8]   | `expression.Result` bridge | RED projection for domain-model modules   | Same match/case, `Ok`/`Error` variants |
|   [9]   | Scoped context binding     | Per-request bind/unbind lifecycle         | `clear` -> `bind` -> clear             |
