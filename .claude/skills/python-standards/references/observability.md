# [H1][OBSERVABILITY]
>**Dictum:** *Signals are one algebra: span, log, and metric execute as a fused tap over typed outcomes.*

Observability in Python 3.14+ fuses traces, logs, and metrics behind one `@instrument` surface. `structlog` builds event dicts, `logging` transports, and `OpenTelemetry SDK >= 1.39` exports spans/logs through `ReadableLogRecord`. Correlation flows through `ContextVar` and `merge_contextvars`. All snippets target `structlog >= 25.5`, `opentelemetry-sdk >= 1.39`, `match/case` dispatch, and explicit boundary loops only.

---
## [1][SIGNAL_PIPELINE]
>**Dictum:** *One decorator owns span + log + metric projection; the processor chain is a pure transformation pipeline.*

`@instrument` creates a span, emits structured start/success/failure events, and projects `Result` outcomes into telemetry. Business code does not call tracing/logging APIs directly. The structlog chain is pure transformation: `merge_contextvars` -> `CallsiteParameterAdder` -> `add_log_level` -> `TimeStamper` -> `inject_trace_identifiers` -> stdlib bridge.

```python
"""@instrument + structlog processor chain: fused signal pipeline."""

# --- [IMPORTS] -------------------------------------------------------------
import logging
from collections.abc import Callable, Coroutine
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

# --- [CODE] ----------------------------------------------------------------

_correlation_id: ContextVar[str] = ContextVar("correlation_id", default="none")

def _record_outcome[R](
    span: trace.Span, log: BoundLogger, name: str, result: Result[R, Exception],
) -> None:
    """Project Result into span status + structured log via match/case."""
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

def instrument_async[**P, R](
    func: Callable[P, Coroutine[object, object, Result[R, Exception]]],
) -> Callable[P, Coroutine[object, object, Result[R, Exception]]]:
    """Async variant: FilteringBoundLogger.ainfo (not deprecated AsyncBoundLogger)."""
    operation: str = f"{func.__module__}.{func.__qualname__}"
    @wraps(func)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> Result[R, Exception]:
        tracer: trace.Tracer = trace.get_tracer("pinnacle.observability")
        with tracer.start_as_current_span(operation) as span:
            log: BoundLogger = structlog.get_logger()
            await log.ainfo("op_start", operation=operation)
            result: Result[R, Exception] = await func(*args, **kwargs)
            _record_outcome(span, log, operation, result)
            return result
    return wrapper

def _inject_trace_identifiers(
    _logger: object, _method_name: str, event_dict: dict[str, object],
) -> dict[str, object]:
    """Inject OTel trace/span IDs and correlation ID into every event dict.

    Full context-threading lifecycle: see CONTEXT_THREADING [2].
    """
    ctx: trace.SpanContext = trace.get_current_span().get_span_context()
    return {
        **event_dict, "correlation_id": _correlation_id.get(),
        **({"trace_id": format(ctx.trace_id, "032x"),
            "span_id": format(ctx.span_id, "016x")} if ctx.is_valid else {}),
    }

def configure_structlog() -> None:
    """Configure structlog with full processor chain + stdlib bridge."""
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
        processors=processors,
        logger_factory=LoggerFactory(),
        wrapper_class=BoundLogger,
        cache_logger_on_first_use=True,
    )
    handler: logging.StreamHandler = logging.StreamHandler()
    handler.setFormatter(ProcessorFormatter(
        processor=structlog.processors.JSONRenderer(),
    ))
    root: logging.Logger = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
```

| [PROCESSOR_ORDER] | [PROCESSOR]                | [RESPONSIBILITY]                                              |
| ----------------- | -------------------------- | ------------------------------------------------------------- |
| 1 (first)         | `merge_contextvars`        | Inject context-local bindings into event dict                 |
| 2                 | `CallsiteParameterAdder`   | Attach module, function name, line number (`QUAL_NAME` 3.11+) |
| 3                 | `add_log_level`            | Add `level` key from stdlib log level                         |
| 4                 | `TimeStamper(fmt="iso")`   | ISO 8601 UTC timestamp                                        |
| 5                 | `inject_trace_identifiers` | OTel `trace_id` + `span_id` + `correlation_id`                |
| 6 (last)          | `wrap_for_formatter`       | Bridge to stdlib `ProcessorFormatter` — MUST be terminal      |

[CRITICAL]:
- [NEVER] Split logging, tracing, and metrics into separate decorator layers — fuse in one surface.
- [ALWAYS] Project outcome via match/case on `Result` — never catch exceptions for observability.
- [NEVER] Use `AsyncBoundLogger` — deprecated since 23.1.0. Use `FilteringBoundLogger` with `ainfo`/`aerror`.
- [ALWAYS] Place `merge_contextvars` first — context bindings must be available to all downstream processors.

---
## [2][CONTEXT_THREADING]
>**Dictum:** *trace_id and span_id injection is a structlog processor; ContextVar is the sole mechanism for threading correlation through async boundaries.*

A single custom processor reads `trace_id` (32-char hex) and `span_id` (16-char hex) from the active OTel span context. `bind_contextvars()` sets context-local pairs that `merge_contextvars` injects into every log event. Each `anyio` task inherits a snapshot of the parent context automatically.

```python
"""OTel trace correlation processor + ContextVar lifecycle management."""

# --- [IMPORTS] -------------------------------------------------------------
from contextvars import ContextVar

import anyio, structlog
from anyio import create_task_group
from anyio.lowlevel import checkpoint
from opentelemetry import trace
from structlog.contextvars import bind_contextvars, bound_contextvars, clear_contextvars

# --- [CODE] ----------------------------------------------------------------

_correlation_id: ContextVar[str] = ContextVar("correlation_id", default="none")

def inject_trace_identifiers(
    _logger: object, _method_name: str, event_dict: dict[str, object],
) -> dict[str, object]:
    """Inject OTel trace/span IDs and correlation ID into every event dict."""
    ctx: trace.SpanContext = trace.get_current_span().get_span_context()
    return {
        **event_dict, "correlation_id": _correlation_id.get(),
        **({"trace_id": format(ctx.trace_id, "032x"),
            "span_id": format(ctx.span_id, "016x")} if ctx.is_valid else {}),
    }

def set_correlation_id(value: str) -> None:
    _correlation_id.set(value)

async def handle_request(request_id: str, tasks: tuple[str, ...]) -> None:
    """Bind context at entry; child tasks inherit; scoped binds for sub-ops."""
    clear_contextvars()
    bind_contextvars(request_id=request_id, handler="ingress")
    log: structlog.stdlib.BoundLogger = structlog.get_logger()
    await log.ainfo("request_accepted", task_count=len(tasks))
    # Side-effect boundary: task spawning is inherently imperative IO.
    async with create_task_group() as task_group:
        for name in tasks:
            task_group.start_soon(_process_task, name)
    clear_contextvars()

async def _process_task(task_name: str) -> None:
    """Child task: inherits parent ContextVar snapshot; scoped bind for operation."""
    with bound_contextvars(task_name=task_name):
        log: structlog.stdlib.BoundLogger = structlog.get_logger()
        await log.ainfo("task_start")
        await checkpoint()
        await log.ainfo("task_complete")
```

Propagation paths:
- Request entry: `clear_contextvars()` then `bind_contextvars(...)`; clear again on exit.
- Child task: `ContextVar` snapshot inheritance via AnyIO task groups.
- Scoped sub-operation: `bound_contextvars(...)` with automatic unbind on exit.
- Cross-thread: per-thread `ContextVar` isolation.
- Span correlation: `trace.get_current_span()` via OTel context propagation.

---
## [3][BOOTSTRAP]
>**Dictum:** *Telemetry initialization is an imperative shell concern; SDK wiring executes once at startup with ReadableLogRecord export.*

`bootstrap_telemetry()` configures: (1) `Resource` identity, (2) `TracerProvider` with `BatchSpanProcessor`, (3) `LoggerProvider` with `BatchLogRecordProcessor` (OTel >= 1.39 — `LogData` removed), (4) structlog processor chain. `BatchLogRecordProcessor.on_emit()` receives a mutable `ReadWriteLogRecord`; the processor then forwards finalized `ReadableLogRecord` sequences to exporters, which accept `Sequence[ReadableLogRecord]`. Init order: Resource -> Exporters -> Processors -> Providers -> Global registration. Called once at startup — never at import time.

```python
"""bootstrap_telemetry(): OTel TracerProvider + LoggerProvider + structlog init."""

# --- [IMPORTS] -------------------------------------------------------------
import logging

from opentelemetry import trace
from opentelemetry._logs import set_logger_provider
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor, InMemoryLogRecordExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

# --- [CODE] ----------------------------------------------------------------

def bootstrap_telemetry(
    service_name: str, service_version: str = "0.0.0",
) -> tuple[TracerProvider, LoggerProvider]:
    """One-shot: Resource -> Exporters -> Processors -> Providers -> Global."""
    resource: Resource = Resource.create({
        "service.name": service_name, "service.version": service_version,
    })
    # Traces
    trace_provider: TracerProvider = TracerProvider(resource=resource)
    trace_provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    trace.set_tracer_provider(trace_provider)
    # Logs (LogData removed in 1.39; on_emit receives ReadWriteLogRecord for
    # mutation, exporters receive the finalized ReadableLogRecord)
    log_provider: LoggerProvider = LoggerProvider(resource=resource)
    log_provider.add_log_record_processor(BatchLogRecordProcessor(InMemoryLogRecordExporter()))
    set_logger_provider(log_provider)
    logging.getLogger().addHandler(
        LoggingHandler(level=logging.NOTSET, logger_provider=log_provider),
    )
    # structlog
    configure_structlog()
    return trace_provider, log_provider
```

Bootstrap phases:
- Identity: `Resource.create({...})`.
- Traces: `BatchSpanProcessor` + `set_tracer_provider`.
- Logs: `BatchLogRecordProcessor` (`on_emit` receives `ReadWriteLogRecord`; exports `Sequence[ReadableLogRecord]`) + `set_logger_provider`.
- Logging bridge: attach `LoggingHandler` after provider registration.
- structlog: call `configure_structlog()` once during startup.

Phase note for `Logs`: attach `LoggingHandler` after provider registration.

[CRITICAL]:
- [NEVER] Initialize telemetry at import time — SDK setup belongs in the imperative shell.
- [ALWAYS] Use `BatchSpanProcessor` and `BatchLogRecordProcessor` for production — Simple variants block on export.
- [ALWAYS] Use `ReadableLogRecord` for export (OTel >= 1.39) — `LogData` removed; `BatchLogRecordProcessor.on_emit()` (renamed from `emit()` in v1.35.0) receives `ReadWriteLogRecord` for mutation, then forwards `Sequence[ReadableLogRecord]` to exporters.
- [ALWAYS] All three global registrations (`set_tracer_provider`, `set_meter_provider`, `set_logger_provider`) are write-once.

---
## [4][RULES]

- [NEVER] Split logs, traces, and metrics across separate decorators.
- [NEVER] Use deprecated `AsyncBoundLogger`; use async methods on `BoundLogger`.
- [ALWAYS] Export logs with `ReadableLogRecord`.
- [ALWAYS] Implement `on_emit()` for custom log processors.
- [ALWAYS] Keep `merge_contextvars` first in the chain.
- [NEVER] Scatter `get_current_span()` calls through business logic.
- [NEVER] initialize telemetry providers at import time.
- [ALWAYS] clear, bind, and scope context vars per request lifecycle.
- [ALWAYS] keep `wrap_for_formatter` terminal.
- [PREFER] `msgspec.json.encode` as JSON serializer backend.

Rule note for `FILTERING_BOUND_LOGGER`: use `ainfo`/`aerror` async methods.

---
## [5][QUICK_REFERENCE]

- `@instrument`: fused result-aware telemetry for handlers (`decorators.md` [2]).
- Processor chain: structured log shaping and stdlib bridge.
- Trace correlation: inject `trace_id`/`span_id` centrally in a processor.
- Context propagation: carry request metadata across async tasks (`concurrency.md` [2]).
- `ReadableLogRecord`: required log export shape for modern OTel Python SDK.
- `bootstrap_telemetry`: one-shot startup wiring for providers and processors.
- `ProcessorFormatter`: structlog-to-stdlib logging bridge.
- Scoped context binding: per-request bind/unbind lifecycle.
- RED metrics: rate/error/duration projections around boundary handlers.
