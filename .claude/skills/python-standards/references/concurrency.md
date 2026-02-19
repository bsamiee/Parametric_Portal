# [H1][CONCURRENCY]
>**Dictum:** *Structured concurrency is algebraic: bounded spawning, explicit cancellation, typed backpressure, and immutable shared state.*

Concurrency in Python 3.14+ is boundary architecture. `anyio.create_task_group()` is the spawn primitive, `CancelScope` owns deadlines and shielding, `CapacityLimiter` + `MemoryObjectStream` enforce backpressure, and `ContextVar[tuple]` replaces mutable globals under free-threading. All snippets target `anyio >= 4.12`, `match/case` dispatch, and explicit boundary loops only.

---
## [1][STRUCTURED_CONCURRENCY_ALGEBRA]
>**Dictum:** *TaskGroup, CancelScope, CapacityLimiter, MemoryObjectStream, and checkpoint compose as one algebra; no primitive stands alone.*

Seven primitives compose one bounded pipeline: `TaskGroup` owns lifecycle, `CancelScope(deadline)` enforces timeout, `CancelScope(shield=True)` protects critical sections, `CapacityLimiter` caps concurrency, `MemoryObjectStream[T]` carries typed backpressure, and `checkpoint()` yields cooperatively.

```python
"""Bounded pipeline: all 7 structured concurrency primitives integrated."""

# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Awaitable, Callable, Coroutine

import anyio
from anyio import CancelScope, CapacityLimiter, create_task_group, get_cancelled_exc_class
from anyio.abc import ObjectReceiveStream, ObjectSendStream
from anyio.lowlevel import checkpoint
from returns.future import future_safe
from returns.result import Failure, Result, Success

# --- [CODE] ----------------------------------------------------------------

async def bounded_pipeline[T, U](
    items: tuple[T, ...],
    process: Callable[[T], Coroutine[object, object, U]],
    acknowledge: Callable[[U], Awaitable[None]],
    concurrency: int = 10,
    timeout: float = 30.0,
) -> tuple[Result[U, Exception], ...]:
    """Fan-out with deadline, backpressure, shielded ack, and checkpoints."""
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
            # Guard clause: cancelled scope short-circuits to timeout Failure
            match scope:
                case CancelScope(cancelled_caught=True):
                    await sender.send((index, Failure(TimeoutError(f"item {index}"))))
                    return
                case _:
                    pass
            # Shield the ack from parent cancellation
            # [BOUNDARY]: try/except required -- anyio cancellation is a foreign
            # protocol that communicates via exception; no Result-based alternative.
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

    # Side-effect boundary: task spawning is inherently imperative IO.
    # Explicit loop keeps side-effect intent visible.
    async with create_task_group() as task_group:
        for index, item in enumerate(items):
            task_group.start_soon(_worker, index, item, send_result)
    await send_result.aclose()
    collected_items: list[tuple[int, Result[U, Exception]]] = []
    async for result_item in recv_result:
        collected_items.append(result_item)
    collected: tuple[tuple[int, Result[U, Exception]], ...] = tuple(collected_items)
    return tuple(r for _, r in sorted(collected))
```

**Pipeline stage composition** chains stages within a `TaskGroup`, connecting via `MemoryObjectStream` pairs with explicit `max_buffer_size`.

```python
"""Multi-stage pipeline: typed stream channels + CapacityLimiter per stage."""

# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Awaitable, Callable

import anyio
from anyio import CapacityLimiter
from anyio.abc import ObjectReceiveStream, ObjectSendStream
from anyio.lowlevel import checkpoint

# --- [CODE] ----------------------------------------------------------------

async def pipeline_stage[TIn, TOut](
    receive: ObjectReceiveStream[TIn],
    send: ObjectSendStream[TOut],
    transform: Callable[[TIn], Awaitable[TOut]],
    limiter: CapacityLimiter,
) -> None:
    """Process items from receive stream, emit to send stream with backpressure."""
    async with send:
        async for item in receive:
            async with limiter:
                output: TOut = await transform(item)
                await send.send(output)
                await checkpoint()
```

Timeout and cancellation semantics:
- `deadline`: absolute timeout enforced by the scope.
- `shield=True`: defer parent cancellation until scope exit for commit/ack regions.
- Nested scopes: inner scope deadline remains the hard limit.
- `move_on_after(seconds)`: soft timeout; inspect `scope.cancelled_caught`.
- `fail_after(seconds)`: hard timeout; raises `TimeoutError`.

Checkpoint variants:
- `checkpoint()`: yields control and checks cancellation.
- `checkpoint_if_cancelled()`: cheaper yield in hot paths.
- `cancel_shielded_checkpoint()`: yield inside shielded scopes without cancel checks.

[CRITICAL]:
- [NEVER] Use bare `asyncio.create_task()` or `asyncio.gather()` — violates structured cancellation.
- [ALWAYS] Route results through `MemoryObjectStream`, not shared mutable dicts or lists.
- [ALWAYS] Set `max_buffer_size` explicitly — default 0 is rendezvous (blocks sender until receiver ready).
- [ALWAYS] Close send streams via `async with send:` to signal completion downstream.
- [ALWAYS] Wrap commit/ack operations in `CancelScope(shield=True)`.
- [ALWAYS] Re-raise `get_cancelled_exc_class()` after shielded critical section — never swallow cancellation.

---
## [2][PARALLELISM_ISOLATION]
>**Dictum:** *Free-threading demands immutable shared state; subinterpreters demand bytes wire contracts.*

Under `python3.14t` (GIL disabled via PEP 779), decorator closures capturing mutable state become data races. `ContextVar[tuple[...]]` provides scoped immutable snapshots, `threading.Lock` guards genuinely shared mutable resources, and frozen models are inherently thread-safe. `InterpreterPoolExecutor` provides process-level isolation without fork overhead — values crossing must be `bytes`, `int`, `float`, `bool`, or `None`.

```python
"""Parallelism: ContextVar snapshots + Lock + InterpreterPoolExecutor bytes contract."""

# --- [IMPORTS] -------------------------------------------------------------
import threading
from collections.abc import Callable
from concurrent.futures import InterpreterPoolExecutor
from contextvars import ContextVar
from typing import Final

import msgspec
from pydantic import BaseModel, TypeAdapter
from returns.result import Result, safe

# --- [CODE] ----------------------------------------------------------------

# --- ContextVar: immutable snapshot replacement (free-threading safe) ---
_request_metrics: ContextVar[tuple[tuple[str, int], ...]] = ContextVar(
    "request_metrics", default=(),
)

def record_metric(name: str, value: int) -> None:
    """Append metric via immutable snapshot replacement — no locking needed."""
    current: tuple[tuple[str, int], ...] = _request_metrics.get()
    _request_metrics.set((*current, (name, value)))

def read_metrics() -> tuple[tuple[str, int], ...]:
    """Read current snapshot — inherently thread-safe."""
    return _request_metrics.get()

# --- threading.Lock: genuinely shared cross-thread mutable state ---
_registry_lock: Final[threading.Lock] = threading.Lock()
_service_registry: dict[str, str] = {}

def register_service(name: str, endpoint: str) -> None:
    """Guarded mutation for genuinely shared cross-thread state."""
    with _registry_lock:
        _service_registry[name] = endpoint

# --- Frozen models: inherently thread-safe ---
class WorkItem(BaseModel, frozen=True):
    task_id: str
    payload: bytes

# --- InterpreterPoolExecutor: bytes wire contract ---
class IngressPayload(BaseModel, frozen=True):
    account_id: str
    amount_cents: int

_adapter: TypeAdapter[IngressPayload] = TypeAdapter(IngressPayload)

def _decode_on_worker(payload: bytes) -> bytes:
    """Worker: bytes in, bytes out — no rich objects cross boundary."""
    raw: object = msgspec.json.decode(payload)
    validated: IngressPayload = _adapter.validate_python(raw)
    return msgspec.json.encode(
        {"account_id": validated.account_id, "cents": validated.amount_cents},
    )

@safe
def decode_batch_isolated(
    payloads: tuple[bytes, ...],
    max_workers: int = 4,
) -> tuple[bytes, ...]:
    """Decode payloads in interpreter pool; bytes are the wire contract."""
    with InterpreterPoolExecutor(max_workers=max_workers) as pool:
        return tuple(pool.map(_decode_on_worker, payloads))
```

Interpreter boundary rules:
- Input/output must be `bytes` (or other primitive-safe values) across interpreter boundaries.
- Recreate validators per interpreter; `TypeAdapter` internals are not shareable.
- Prefer `msgspec.json` wire encoding for low-overhead bytes payloads.
- Wrap executor calls with `@safe` to capture `NotShareableError` in the error channel.
- Use `ContextVar[tuple]` snapshots instead of mutable globals.

Cross-references: serialization.md [3] for msgspec wire encoding, types.md [1] for immutable collections.

---
## [3][RULES]

- [ALWAYS] Spawn via `anyio.create_task_group()` only.
- [ALWAYS] Set explicit `CancelScope` deadlines for bounded execution.
- [ALWAYS] Shield commit/ack paths and re-raise cancellation.
- [ALWAYS] Set `max_buffer_size` on every memory stream.
- [ALWAYS] Add cooperative checkpoints in hot async loops.
- [ALWAYS] Handle TaskGroup multi-failure via `except*`.
- [ALWAYS] Use `bytes` as the interpreter-crossing wire contract.
- [NEVER] Use mutable globals under free-threading.
- [PREFER] Lock only truly shared mutable resources.

Rule note for `SHIELDED_CRITICAL`: `try/except get_cancelled_exc_class(): raise` is the only permitted domain-adjacent `try/except`; cancellation is a foreign exception protocol.

---
## [4][QUICK_REFERENCE]

- Bounded pipeline: deadline + backpressure + shielded ack (`effects.md` [1]).
- Pipeline stage: typed multi-stage async transformation (`effects.md` [1]).
- `move_on_after` vs `fail_after`: soft timeout vs hard timeout.
- `CancelScope(shield=True)`: protect commit/ack under parent cancellation.
- Checkpoint discipline: fairness for CPU-heavy async loops.
- Context propagation: `ContextVar` snapshots for free-threaded safety (`observability.md` [2]).
- Interpreter isolation: `bytes` wire contracts for CPU-parallel work (`serialization.md` [3]).
- Exception groups: task-group multi-failure handling with `except*`.
