# [H1][ADAPTER_MODULE]
>**Dictum:** *Adapter modules satisfy Protocol ports structurally, bridge IO via effect decorators, bound concurrency, and fuse telemetry at the infrastructure boundary.*

<br>

Produces one infrastructure adapter module: structural Protocol satisfaction without inheritance, `@future_safe`/`@safe` at every IO boundary, `anyio.create_task_group()` + `CancelScope(deadline=...)` for bounded operations, `CapacityLimiter` for backpressure, `CancelScope(shield=True)` for shielded commit/ack, `@instrument_async` for fused adapter-level telemetry, and `Result[T, E]` returns on all public methods. Adapters live in `/adapters/` and import only from `/protocols/` and `/domain/`.

**Density:** ~225 LOC signals a refactoring opportunity. No helper files; no god adapters.
**References:** `protocols.md` ([1] PROTOCOL_ARCHITECTURE, [2] TYPED_DI), `effects.md` ([1] EFFECT_STACK, [3] ERROR_ALGEBRA), `concurrency.md` ([1] STRUCTURED_CONCURRENCY_ALGEBRA, [2] FREE_THREADING), `observability.md` ([1] SIGNAL_PIPELINE, [2] CONTEXT_THREADING), `serialization.md` ([2] MSGSPEC_STRUCTS).
**Anti-Pattern Awareness:** See `patterns.md` [1] for IMPORT_TIME_IO, MODEL_WITH_BEHAVIOR, BARE_TRY_EXCEPT, MISSING_CHECKPOINT.
**Workflow:** Fill placeholders, remove guidance blocks, verify with ty and ruff.

---
**Placeholders**

| [INDEX] | [PLACEHOLDER]           | [EXAMPLE]                             |
| :-----: | ----------------------- | ------------------------------------- |
|   [1]   | `{{module_path}}`       | `pinnacle/adapters/user_repo.py`      |
|   [2]   | `{{adapter_name}}`      | `PostgresUserRepo`                    |
|   [3]   | `{{protocol_name}}`     | `Repository[User, UserId]`            |
|   [4]   | `{{protocol_module}}`   | `pinnacle.protocols.repository`       |
|   [5]   | `{{entity_type}}`       | `User`                                |
|   [6]   | `{{entity_id_type}}`    | `UserId`                              |
|   [7]   | `{{domain_module}}`     | `pinnacle.domain.users`               |
|   [8]   | `{{adapter_error}}`     | `RepoError`                           |
|   [9]   | `{{error_variants}}`    | `NotFoundError, InfraConnectionError` |
|  [10]   | `{{resource_name}}`     | `"user_repo"`                         |
|  [11]   | `{{connection_type}}`   | `AsyncConnection`                     |
|  [12]   | `{{concurrency_limit}}` | `10`                                  |
|  [13]   | `{{timeout_seconds}}`   | `30.0`                                |
|  [14]   | `{{trace_operation}}`   | `"repo.user"`                         |

---
```python
"""{{module_path}} -- Adapter module: Protocol satisfaction, bounded IO, fused telemetry."""

# --- [IMPORTS] ----------------------------------------------------------------

from __future__ import annotations

from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from functools import wraps
from typing import cast, Final

import anyio
from anyio import CancelScope, CapacityLimiter, create_task_group, get_cancelled_exc_class
from anyio.lowlevel import checkpoint
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from returns.future import future_safe
from returns.result import Failure, Result, Success
import structlog

from {{protocol_module}} import {{protocol_name}}
from {{domain_module}} import {{entity_type}}, {{entity_id_type}}

# --- [ERRORS] -----------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class NotFoundError:
    """Entity not found in persistence layer."""

    entity: str
    identifier: str


@dataclass(frozen=True, slots=True)
class InfraConnectionError:
    """Infrastructure connection or timeout error."""

    operation: str
    cause: str


type {{adapter_error}} = NotFoundError | InfraConnectionError

# --- [CONSTANTS] --------------------------------------------------------------

_CONCURRENCY_LIMIT: Final[int] = {{concurrency_limit}}
_TIMEOUT_SECONDS: Final[float] = {{timeout_seconds}}
_TRACER_NAME: Final[str] = "pinnacle.adapters"

# --- [PROTOCOL_PORT] ----------------------------------------------------------

# Protocol imported from {{protocol_module}} -- adapter satisfies structurally.
# Verification: beartype.door.is_bearable(adapter, {{protocol_name}})
# See protocols.md [1] for structural satisfaction; [3] for runtime checks.

# --- [TELEMETRY] --------------------------------------------------------------


type _AsyncResultFn[**P, R, E] = Callable[P, Coroutine[object, object, Result[R, E]]]


def instrument_async[**P, R](
    func: _AsyncResultFn[P, R, {{adapter_error}}],
) -> _AsyncResultFn[P, R, {{adapter_error}}]:
    """Fused adapter telemetry: span + structured log + outcome projection.
    See observability.md [1] for signal pipeline, [4] for RED metrics."""
    operation: str = f"{{trace_operation}}.{func.__qualname__}"

    @wraps(func)
    async def wrapper(*args: object, **kwargs: object) -> object:
        tracer: trace.Tracer = trace.get_tracer(_TRACER_NAME)
        log: structlog.stdlib.BoundLogger = structlog.get_logger()
        with tracer.start_as_current_span(operation) as span:
            await log.ainfo("adapter_start", operation=operation)
            result: Result[R, {{adapter_error}}] = await cast(
                "_AsyncResultFn[..., R, {{adapter_error}}]", func,
            )(*args, **kwargs)
            match result:
                case Success(_):
                    span.set_status(StatusCode.OK)
                    await log.ainfo("adapter_success", operation=operation)
                case Failure(error):
                    span.set_status(StatusCode.ERROR, str(error))
                    await log.aerror(
                        "adapter_failure", operation=operation,
                        error_type=type(error).__name__,
                    )
            return result
    return cast("_AsyncResultFn[P, R, {{adapter_error}}]", wrapper)

# --- [ADAPTER] ----------------------------------------------------------------


class {{adapter_name}}:
    """Satisfies {{protocol_name}} structurally -- no inheritance.
    See protocols.md [1] for adapter pattern."""
    __slots__ = ("_connection", "_limiter", "_log")

    def __init__(self, connection: {{connection_type}}) -> None:
        self._connection: {{connection_type}} = connection
        self._limiter: CapacityLimiter = CapacityLimiter(_CONCURRENCY_LIMIT)
        self._log: structlog.stdlib.BoundLogger = structlog.get_logger().bind(
            adapter={{resource_name}},
        )

    @instrument_async
    async def get(
        self, entity_id: {{entity_id_type}},
    ) -> Result[{{entity_type}}, {{adapter_error}}]:
        """Bounded fetch: limiter + deadline + shielded result capture."""
        return await self._bounded_operation(
            lambda: self._fetch_entity(entity_id),
        )

    @instrument_async
    async def save(
        self, entity: {{entity_type}},
    ) -> Result[{{entity_id_type}}, {{adapter_error}}]:
        """Bounded persist: limiter + deadline + shielded commit."""
        return await self._bounded_operation(
            lambda: self._persist_entity(entity),
        )

    # --- [CONCURRENCY] --------------------------------------------------------

    async def _bounded_operation[T](
        self, operation: Callable[[], Coroutine[object, object, T]],
    ) -> Result[T, {{adapter_error}}]:
        """CapacityLimiter + CancelScope(deadline) + shielded result capture.
        See concurrency.md [1] for structured concurrency algebra."""
        async with self._limiter:
            with CancelScope(
                deadline=anyio.current_time() + _TIMEOUT_SECONDS,
            ) as scope:
                result: Result[T, {{adapter_error}}] = await self._safe_execute(
                    operation,
                )
                await checkpoint()
            match scope:
                case CancelScope(cancelled_caught=True):
                    return Failure(InfraConnectionError(
                        operation={{resource_name}},
                        cause=f"timeout after {_TIMEOUT_SECONDS}s",
                    ))
                case _:
                    pass
            # Shielded ack: protect result capture from parent cancellation.
            # [BOUNDARY]: try/except required -- anyio cancellation protocol
            try:
                with CancelScope(shield=True):
                    await checkpoint()
            except get_cancelled_exc_class():  # noqa: TRY203 -- anyio cancellation protocol requires re-raise
                raise
            return result

    @future_safe
    async def _fetch_entity(
        self, entity_id: {{entity_id_type}},
    ) -> {{entity_type}}:
        """@future_safe bridges async IO exceptions into Result.
        See effects.md [1] for @future_safe boundary pattern."""
        # Replace with actual connection query:
        # row = await self._connection.fetchrow(query, entity_id)
        raise NotImplementedError("Replace with connection query")

    @future_safe
    async def _persist_entity(
        self, entity: {{entity_type}},
    ) -> {{entity_id_type}}:
        """@future_safe + shielded commit via CancelScope in _bounded_operation.
        See concurrency.md [1] for shielded ack pattern."""
        # Replace with actual connection mutation:
        # result = await self._connection.execute(query, entity)
        raise NotImplementedError("Replace with connection mutation")

    async def _safe_execute[T](  # noqa: PLR6301 -- method for adapter interface consistency
        self, operation: Callable[[], Coroutine[object, object, T]],
    ) -> Result[T, {{adapter_error}}]:
        """Wraps @future_safe result, remapping generic exceptions to typed InfraConnectionError."""
        match await operation():
            case Success(value):
                return Success(value)
            case Failure(error):
                return Failure(InfraConnectionError(
                    operation={{resource_name}},
                    cause=str(error),
                ))

    # --- batch: fan-out with TaskGroup + CapacityLimiter --------------------

    async def get_batch(
        self, entity_ids: tuple[{{entity_id_type}}, ...],
    ) -> tuple[Result[{{entity_type}}, {{adapter_error}}], ...]:
        """Fan-out bounded by CapacityLimiter + per-item CancelScope.
        See concurrency.md [1] for bounded pipeline pattern."""
        send_stream, recv_stream = anyio.create_memory_object_stream[
            tuple[int, Result[{{entity_type}}, {{adapter_error}}]]
        ](max_buffer_size=len(entity_ids))

        async def _fetch_one(
            index: int, entity_id: {{entity_id_type}},
        ) -> None:
            result = await self._bounded_operation(
                lambda eid=entity_id: self._fetch_entity(eid),
            )
            await send_stream.send((index, result))

        async with create_task_group() as task_group:
            for index, entity_id in enumerate(entity_ids):
                task_group.start_soon(_fetch_one, index, entity_id)
        await send_stream.aclose()
        collected: list[tuple[int, Result[{{entity_type}}, {{adapter_error}}]]] = []
        async for item in recv_stream:
            collected.append(item)
        return tuple(result for _, result in sorted(collected))

# --- [EXPORT] -----------------------------------------------------------------

# All symbols above use explicit naming. No __all__, no default exports.
# Consumers import directly: from {{module_path}} import {{adapter_name}}
# Structural verification at composition root:
#   from beartype.door import is_bearable
#   assert is_bearable(adapter_instance, {{protocol_name}})
```

---
**Guidance**

- Protocol satisfaction: `{{adapter_name}}` satisfies `{{protocol_name}}` structurally -- no inheritance. `beartype.is_bearable()` verifies at the composition root. See `protocols.md` [1] for variance, [3] for runtime checks. Imports from `/protocols` and `/domain` only.
- Bounded IO: every external call flows through `_bounded_operation` -- `CapacityLimiter` caps to downstream capacity, `CancelScope(deadline=...)` enforces timeout, `CancelScope(shield=True)` protects ack. `@future_safe` captures exceptions into `Result`. `get_batch` demonstrates `TaskGroup` + `MemoryObjectStream` fan-out. See `concurrency.md` [1], `performance.md` [4].
- Fused telemetry: `@instrument_async` creates span + structured log + outcome projection in one surface. See `observability.md` [1] for signal pipeline, [4] for RED metrics.

---
**Post-Scaffold Checklist** (from `validation.md`)

- [ ] PROTOCOL_SATISFACTION: Adapter satisfies Protocol structurally; verified via `beartype.is_bearable`
- [ ] EFFECT_BOUNDARY: `@future_safe`/`@safe` at all IO boundaries; domain code returns `Result` explicitly
- [ ] CONCURRENCY_BOUNDED: `CapacityLimiter` + `CancelScope(deadline=...)` on every external call
- [ ] SHIELDED_ACK: Commit/ack in `CancelScope(shield=True)` with `except get_cancelled_exc_class(): raise`
- [ ] NO_DOMAIN_COUPLING: Imports from `/protocols` and `/domain` only; zero framework types in signatures
- [ ] TELEMETRY: `@instrument_async` at boundary; `structlog.contextvars` per operation; RED projection
