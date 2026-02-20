# [H1][CONCURRENCY]
>**Dictum:** *Structured concurrency is algebraic: bounded spawning, explicit cancellation, typed backpressure, and immutable shared state.*

<br>

Concurrency in Python 3.14+ is boundary architecture. `anyio.create_task_group()` is the spawn primitive, `CancelScope` owns deadlines and shielding, `CapacityLimiter` + `MemoryObjectStream` enforce backpressure, and `ContextVar[tuple]` replaces mutable globals under free-threading. All snippets target `anyio >= 4.12`, `match/case` dispatch, and explicit boundary loops only.

---
## [1][STRUCTURED_CONCURRENCY_ALGEBRA]
>**Dictum:** *TaskGroup, CancelScope, CapacityLimiter, MemoryObjectStream, and checkpoint compose as one algebra; no primitive stands alone.*

<br>

Seven primitives compose one bounded pipeline: `TaskGroup` owns lifecycle, `CancelScope(deadline)` enforces timeout, `CancelScope(shield=True)` protects critical sections, `CapacityLimiter` caps concurrency, `MemoryObjectStream[T]` carries typed backpressure, and `checkpoint()` yields cooperatively.

```python
"""Bounded pipeline: deadline + backpressure + shielded ack + checkpoints."""

# --- [IMPORTS] ----------------------------------------------------------------

from collections.abc import Awaitable, Callable, Coroutine

import anyio
from anyio import CancelScope, CapacityLimiter, create_task_group, get_cancelled_exc_class
from anyio.abc import ObjectSendStream
from anyio.lowlevel import checkpoint
from returns.future import future_safe
from returns.result import Failure, Result, Success

# --- [CODE] -------------------------------------------------------------------

async def bounded_pipeline[T, U](
    items: tuple[T, ...],
    process: Callable[[T], Coroutine[object, object, U]],
    acknowledge: Callable[[U], Awaitable[None]],
    concurrency: int = 10,
    timeout: float = 30.0,
) -> tuple[Result[U, Exception], ...]:
    limiter: CapacityLimiter = CapacityLimiter(concurrency)
    send_result, recv_result = anyio.create_memory_object_stream[
        tuple[int, Result[U, Exception]]
    ](max_buffer_size=len(items))

    @future_safe
    async def safe_process(item: T) -> U:
        return await process(item)
    async def _worker(
        index: int, item: T,
        sender: ObjectSendStream[tuple[int, Result[U, Exception]]],
    ) -> None:
        async with limiter:
            with CancelScope(deadline=anyio.current_time() + timeout) as scope:
                result: Result[U, Exception] = await safe_process(item)
                await checkpoint()
            match scope:
                case CancelScope(cancelled_caught=True):
                    await sender.send((index, Failure(TimeoutError(f"item {index}"))))
                    return
                case _:
                    pass
            # [BOUNDARY]: try/except required -- anyio cancellation protocol
            match result:
                case Success(value):
                    try:
                        with CancelScope(shield=True):
                            await acknowledge(value)
                    except get_cancelled_exc_class():
                        raise
                case _:
                    pass
            await sender.send((index, result))
    # Side-effect boundary: task spawning is inherently imperative IO
    async with create_task_group() as task_group:
        for index, item in enumerate(items):
            task_group.start_soon(_worker, index, item, send_result)
    await send_result.aclose()
    collected: list[tuple[int, Result[U, Exception]]] = []
    async for result_item in recv_result:
        collected.append(result_item)
    return tuple(r for _, r in sorted(collected))
```

**Pipeline stage composition** chains stages via `MemoryObjectStream` pairs with explicit `max_buffer_size`.

```python
async def pipeline_stage[TIn, TOut](
    receive: ObjectReceiveStream[TIn],
    send: ObjectSendStream[TOut],
    transform: Callable[[TIn], Awaitable[TOut]],
    limiter: CapacityLimiter,
) -> None:
    async with send:
        async for item in receive:
            async with limiter:
                await send.send(await transform(item))
                await checkpoint()
```

Timeout semantics: `deadline` (absolute), `shield=True` (defer parent cancel), `move_on_after` (soft -- inspect `cancelled_caught`), `fail_after` (hard -- raises `TimeoutError`).<br>
Checkpoint variants: `checkpoint()` (yield + cancel check), `checkpoint_if_cancelled()` (cheaper in hot paths; see `performance.md` [4]), `cancel_shielded_checkpoint()` (yield inside shielded scopes).

[CRITICAL]:
- [NEVER] Use bare `asyncio.create_task()` or `asyncio.gather()` -- violates structured cancellation.
- [ALWAYS] Route results through `MemoryObjectStream`, not shared mutable collections.
- [ALWAYS] Set `max_buffer_size` explicitly -- default 0 is rendezvous.
- [ALWAYS] Close send streams via `async with send:` to signal completion downstream.
- [ALWAYS] Wrap commit/ack in `CancelScope(shield=True)` and re-raise cancellation.

---
## [2][FREE_THREADING]
>**Dictum:** *Free-threading demands immutable shared state; ContextVar snapshots replace mutable globals.*

<br>

Under `python3.14t` (GIL disabled via PEP 779), decorator closures capturing mutable state become data races. `ContextVar[tuple[...]]` provides scoped immutable snapshots, `threading.Lock` guards genuinely shared mutable resources, and frozen models are inherently thread-safe.

```python
"""Free-threading: ContextVar snapshots + Lock + frozen models."""

# --- [IMPORTS] ----------------------------------------------------------------

import threading
from contextvars import ContextVar
from typing import Final

from pydantic import BaseModel

# --- [CONSTANTS] --------------------------------------------------------------

# ContextVar: immutable snapshot replacement (free-threading safe)
_request_metrics: ContextVar[tuple[tuple[str, int], ...]] = ContextVar(
    "request_metrics", default=(),
)

# --- [FUNCTIONS] --------------------------------------------------------------

def record_metric(name: str, value: int) -> None:
    current: tuple[tuple[str, int], ...] = _request_metrics.get()
    _request_metrics.set((*current, (name, value)))

def read_metrics() -> tuple[tuple[str, int], ...]:
    return _request_metrics.get()

# threading.Lock: genuinely shared cross-thread mutable state
_registry_lock: Final[threading.Lock] = threading.Lock()
_service_registry: dict[str, str] = {}

def register_service(name: str, endpoint: str) -> None:
    with _registry_lock:
        _service_registry[name] = endpoint

# --- [CLASSES] ----------------------------------------------------------------

# Frozen models: inherently thread-safe
class WorkItem(BaseModel, frozen=True):
    task_id: str
    payload: bytes
```

Free-threading rules:
- `ContextVar[tuple]` snapshots for append-style state -- no locking needed.
- `threading.Lock` only for genuinely shared mutable resources.
- Frozen Pydantic models are inherently safe. See `types.md` [3].
- `expression.CancellationToken` for cooperative cross-thread cancellation: `token.cancel()` signals, workers check `token.is_cancellation_requested` at yield points.

---
## [3][INTERPRETER_ISOLATION]
>**Dictum:** *Subinterpreters demand bytes wire contracts; rich objects cannot cross the boundary.*

<br>

`InterpreterPoolExecutor` provides process-level isolation without fork overhead -- values crossing must be `bytes`, `int`, `float`, `bool`, or `None`.

```python
"""InterpreterPoolExecutor: bytes wire contract for CPU-parallel work."""

# --- [IMPORTS] ----------------------------------------------------------------

from concurrent.futures import InterpreterPoolExecutor

import msgspec
from pydantic import BaseModel, TypeAdapter
from returns.result import safe

# --- [CLASSES] ----------------------------------------------------------------

class IngressPayload(BaseModel, frozen=True):
    account_id: str
    amount_cents: int

_adapter: TypeAdapter[IngressPayload] = TypeAdapter(IngressPayload)

# --- [FUNCTIONS] --------------------------------------------------------------

def _decode_on_worker(payload: bytes) -> bytes:
    raw: object = msgspec.json.decode(payload)
    validated: IngressPayload = _adapter.validate_python(raw)
    return msgspec.json.encode(
        {"account_id": validated.account_id, "cents": validated.amount_cents},
    )

@safe
def decode_batch_isolated(
    payloads: tuple[bytes, ...], max_workers: int = 4,
) -> tuple[bytes, ...]:
    with InterpreterPoolExecutor(max_workers=max_workers) as pool:
        return tuple(pool.map(_decode_on_worker, payloads))
```

Interpreter boundary rules:
- Input/output must be `bytes` (or primitive-safe values) across boundaries.
- Recreate validators per interpreter; `TypeAdapter` internals are not shareable.
- Prefer `msgspec.json` wire encoding. See `serialization.md` [2].
- `@safe` wrapping captures `NotShareableError` in the Result error channel.

---
## [4][EXCEPTION_GROUPS]
>**Dictum:** *`except*` is the structured handler for TaskGroup multi-failure; pattern-match grouped exceptions for selective recovery.*

<br>

When multiple tasks fail concurrently inside a `TaskGroup`, anyio raises an `ExceptionGroup`. `except*` (PEP 654) provides structured handling -- each clause matches a subset, unmatched exceptions propagate automatically.

```python
"""except* structured handling at TaskGroup boundaries."""

# --- [IMPORTS] ----------------------------------------------------------------

import anyio
from anyio import create_task_group
from returns.result import Failure, Result, Success

# --- [CODE] -------------------------------------------------------------------

class RetryableError(Exception):
    def __init__(self, operation: str) -> None:
        super().__init__(operation)
        self.operation: str = operation

class FatalError(Exception):
    """Non-recoverable failure; propagate immediately."""

async def resilient_batch[T](
    items: tuple[T, ...],
) -> tuple[Result[T, Exception], ...]:
    results: list[Result[T, Exception]] = []

    async def _attempt(item: T) -> None:
        results.append(Success(item))
        await anyio.sleep(0)
    # [BOUNDARY]: except* required -- TaskGroup surfaces concurrent failures
    # as ExceptionGroup; no Result-based alternative for multi-task failure
    try:
        async with create_task_group() as task_group:
            for item in items:
                task_group.start_soon(_attempt, item)
    except* RetryableError as group:
        for exc in group.exceptions:
            results.append(Failure(exc))
    except* FatalError:
        raise
    return tuple(results)
```

Exception group rules:
- `except*` clauses are subtractive: each matched subset removed, unmatched propagate.
- Use typed exception hierarchies for exhaustive `except*` clause coverage.
- `ExceptionGroup` from `TaskGroup` is the ONLY context for `except*` in domain-adjacent code.
- For finer-grained isolation, `expression.MailboxProcessor` processes messages sequentially -- converting concurrent failures to ordered Result values. See `effects.md` [5] for expression patterns.

---
## [5][RULES]
>**Dictum:** *Concurrency correctness is structural, not aspirational.*

<br>

- [ALWAYS] Spawn via `anyio.create_task_group()` only.
- [ALWAYS] Set explicit `CancelScope` deadlines for bounded execution.
- [ALWAYS] Shield commit/ack paths and re-raise cancellation.
- [ALWAYS] Set `max_buffer_size` on every memory stream.
- [ALWAYS] Add cooperative checkpoints in hot async loops.
- [ALWAYS] Handle TaskGroup multi-failure via `except*` at group boundaries.
- [ALWAYS] Use `bytes` as the interpreter-crossing wire contract.
- [ALWAYS] Wrap `InterpreterPoolExecutor` calls with `@safe`.
- [NEVER] Use mutable globals under free-threading -- `ContextVar[tuple]` snapshots instead.
- [NEVER] Use bare `asyncio.create_task()` or `asyncio.gather()`.
- [PREFER] `threading.Lock` only for genuinely shared mutable resources.
- [PREFER] `expression.CancellationToken` for cooperative cross-thread cancellation.

Rule note: `try/except get_cancelled_exc_class(): raise` is the only permitted domain-adjacent `try/except`; cancellation is a foreign exception protocol.

---
## [6][QUICK_REFERENCE]
>**Dictum:** *One table maps pattern to context.*

<br>

| [INDEX] | [PATTERN]                    | [WHEN]                                      | [KEY_TRAIT]                              |
| :-----: | ---------------------------- | ------------------------------------------- | ---------------------------------------- |
|   [1]   | Bounded pipeline             | Fan-out with deadline + backpressure + ack  | `CancelScope` + `CapacityLimiter`        |
|   [2]   | Pipeline stage               | Multi-stage async typed transformation      | `MemoryObjectStream` + `CapacityLimiter` |
|   [3]   | `move_on_after`/`fail_after` | Soft vs hard timeout per-operation          | `scope.cancelled_caught` inspection      |
|   [4]   | `CancelScope(shield=True)`   | Protect commit/ack under parent cancel      | Defer cancel until scope exit            |
|   [5]   | Checkpoint discipline        | Fairness for CPU-heavy async loops          | `checkpoint_if_cancelled()` in hot paths |
|   [6]   | ContextVar snapshots         | Free-threaded safety for scoped state       | Immutable tuple replacement              |
|   [7]   | Interpreter isolation        | CPU-parallel with `bytes` wire contract     | `InterpreterPoolExecutor` + `@safe`      |
|   [8]   | `except*` groups             | TaskGroup multi-failure structured handling | Subtractive clause matching              |
|   [9]   | `MailboxProcessor`           | Actor-based sequential message processing   | Ordered Result from concurrent input     |
|  [10]   | `CancellationToken`          | Cooperative cross-thread cancellation       | `is_cancellation_requested` check        |
