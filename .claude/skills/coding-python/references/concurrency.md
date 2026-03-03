# Concurrency

Concurrency in Python 3.14+ is boundary architecture. `anyio.create_task_group()` is the spawn primitive, `CancelScope` owns deadlines and shielding, `CapacityLimiter` + `MemoryObjectStream` enforce backpressure, and `ContextVar[tuple]` replaces mutable globals under free-threading. All snippets target `anyio >= 4.12`, expression v5.6+ with `Result`, `Ok`, `Error`, `Option`, `@effect.async_result`, `pipe`, `Block`, `match/case` dispatch, and explicit boundary loops only.

---
## Structured Concurrency Algebra

Seven primitives compose one bounded pipeline: `TaskGroup` owns lifecycle, `CancelScope(deadline)` enforces timeout, `CancelScope(shield=True)` protects critical sections, `CapacityLimiter` caps concurrency, `MemoryObjectStream[T]` carries typed backpressure, and `checkpoint()` yields cooperatively.

```python
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass

import anyio
from anyio import CancelScope, CapacityLimiter, create_task_group, get_cancelled_exc_class
from anyio.abc import ObjectReceiveStream, ObjectSendStream
from anyio.lowlevel import checkpoint
from expression import Error, Ok, Option, Result, pipe
from expression.collections import Block, block

@dataclass(frozen=True, slots=True)
class Timeout: index: int; budget: float

async def bounded_pipeline[T, U](
    items: Block[T], process: Callable[[T], Coroutine[None, None, U]],
    acknowledge: Callable[[U], Awaitable[None]], concurrency: int = 10, budget: float = 30.0,
) -> Block[Result[U, Timeout | Exception]]:
    limiter = CapacityLimiter(concurrency)
    tx, rx = anyio.create_memory_object_stream[tuple[int, Result[U, Timeout | Exception]]](items.length)
    async def _worker(idx: int, item: T, sender: ObjectSendStream[tuple[int, Result[U, Timeout | Exception]]]) -> None:
        r: Result[U, Exception] | None = None
        async with limiter:
            with anyio.move_on_after(budget):
                # BOUNDARY ADAPTER — async process may raise; typed cancellation via sentinel
                try: r = Ok(await process(item))
                except Exception as exc: r = Error(exc)  # noqa: BLE001
                await checkpoint()
        match r:
            case None: await sender.send((idx, Error(Timeout(idx, budget)))); return
            case Ok(value):
                # BOUNDARY ADAPTER — anyio cancellation protocol requires try/except
                try:
                    with CancelScope(shield=True): await acknowledge(value)
                except get_cancelled_exc_class(): await sender.send((idx, r)); raise
                except Exception as exc: await sender.send((idx, Error(exc))); return  # noqa: BLE001
            case _: pass
        await sender.send((idx, r))
    async with create_task_group() as tg:
        pipe(items.indexed(), block.fold(lambda _, iv: tg.start_soon(_worker, iv[0], iv[1], tx), None))
    await tx.aclose()
    collected = block.of_seq(rx.receive_nowait() for _ in range(items.length))
    return pipe(collected, block.sort_with(lambda a, b: a[0] - b[0]), block.map(lambda iv: iv[1]))
```

`move_on_after` scopes both process execution and checkpoint — cancellation sentinel `r: ... | None = None` absorbs scope expiration into `match`, converting to typed `Timeout(idx, budget)` with full index provenance. `block.fold` drives task registration as a void fold over `items.indexed()`, producing index/item pairs without `enumerate`. `block.sort_with` on the collected `(index, result)` tuples restores deterministic ordering; `block.map` projects to the result channel. `CancelScope(shield=True)` protects acknowledgment from parent cancellation — the `try/except get_cancelled_exc_class(): raise` re-throw is the sole permitted domain-adjacent exception handling.

**Pipeline stage composition** chains stages via `MemoryObjectStream` pairs with explicit `max_buffer_size`.

```python
async def pipeline_stage[TIn, TOut](
    receive: ObjectReceiveStream[TIn], send: ObjectSendStream[TOut],
    transform: Callable[[TIn], Awaitable[TOut]], limiter: CapacityLimiter,
) -> None:
    async with send:
        async for item in receive:
            async with limiter:
                await send.send(await transform(item))
                await checkpoint()
```

Timeout semantics: `deadline` (absolute), `shield=True` (defer parent cancel), `move_on_after` (soft — inspect `cancelled_caught`), `fail_after` (hard — raises `TimeoutError`).
Checkpoint variants: `checkpoint()` (yield + cancel check), `checkpoint_if_cancelled()` (cheaper in hot paths), `cancel_shielded_checkpoint()` (yield inside shielded scopes).

[CRITICAL]:
- [NEVER] Use bare `asyncio.create_task()` or `asyncio.gather()` — violates structured cancellation.
- [ALWAYS] Route results through `MemoryObjectStream`, not shared mutable collections.
- [ALWAYS] Set `max_buffer_size` explicitly — default 0 is rendezvous.
- [ALWAYS] Close send streams via `async with send:` to signal completion downstream.
- [ALWAYS] Wrap commit/ack in `CancelScope(shield=True)` and re-raise cancellation.

---
## Free Threading

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
- Frozen Pydantic models are inherently safe.
- `expression.CancellationToken` for cooperative cross-thread cancellation: `token.cancel()` signals, workers check `token.is_cancellation_requested` at yield points.

---
## Interpreter Isolation

`InterpreterPoolExecutor` provides process-level isolation without fork overhead -- values crossing must be `bytes`, `int`, `float`, `bool`, or `None`.

```python
"""InterpreterPoolExecutor: bytes wire contract for CPU-parallel work."""

from concurrent.futures import InterpreterPoolExecutor

import msgspec
from expression import Error, Ok, Result
from pydantic import BaseModel, TypeAdapter

class IngressPayload(BaseModel, frozen=True):
    account_id: str
    amount_cents: int

_adapter: TypeAdapter[IngressPayload] = TypeAdapter(IngressPayload)

def _decode_on_worker(payload: bytes) -> bytes:
    raw: object = msgspec.json.decode(payload)
    validated: IngressPayload = _adapter.validate_python(raw)
    return msgspec.json.encode(
        {"account_id": validated.account_id, "cents": validated.amount_cents},
    )

def decode_batch_isolated(payloads: tuple[bytes, ...], max_workers: int = 4) -> Result[tuple[bytes, ...], Exception]:
    # BOUNDARY ADAPTER — InterpreterPoolExecutor may raise NotShareableError
    try:
        with InterpreterPoolExecutor(max_workers=max_workers) as pool:
            return Ok(tuple(pool.map(_decode_on_worker, payloads)))
    except Exception as exc:  # noqa: BLE001
        return Error(exc)
```

Interpreter boundary rules:
- Input/output must be `bytes` (or primitive-safe values) across boundaries.
- Recreate validators per interpreter; `TypeAdapter` internals are not shareable.
- Prefer `msgspec.json` wire encoding.
- Manual `try/except` at boundary with `# BOUNDARY ADAPTER` marker wraps into `Result`.

---
## Exception Groups

When multiple tasks fail concurrently inside a `TaskGroup`, anyio raises an `ExceptionGroup`. `except*` (PEP 654) provides structured handling -- each clause matches a subset, unmatched exceptions propagate automatically.

```python
"""except* structured handling at TaskGroup boundaries."""

import anyio
from anyio import create_task_group
from collections.abc import Callable, Coroutine
from expression import Error, Ok, Result
from expression.collections import Block

class RetryableError(Exception):
    def __init__(self, operation: str) -> None:
        super().__init__(operation)
        self.operation: str = operation

class FatalError(Exception):
    """Non-recoverable failure; propagate immediately."""

type Processor[T] = Callable[[T], Coroutine[None, None, None]]

async def resilient_batch[T](items: Block[T], process: Processor[T]) -> Block[Result[T, Exception]]:
    tx, rx = anyio.create_memory_object_stream[Result[T, Exception]](items.length)
    async def _attempt(item: T) -> None:
        await process(item)  # may raise RetryableError or FatalError
        await tx.send(Ok(item))
    # BOUNDARY ADAPTER — except* required; TaskGroup surfaces concurrent failures
    # as ExceptionGroup; no Result-based alternative for multi-task failure
    try:
        async with create_task_group() as tg:
            items.iterate(lambda item: tg.start_soon(_attempt, item))
    except* RetryableError as group:
        Block(group.exceptions).iterate(lambda exc: tx.send_nowait(Error(exc)))
    except* FatalError:
        raise
    await tx.aclose()
    return Block(rx.receive_nowait() for _ in range(items.length))
```

Exception group rules:
- `except*` clauses are subtractive: each matched subset removed, unmatched propagate.
- Use typed exception hierarchies for exhaustive `except*` clause coverage.
- `ExceptionGroup` from `TaskGroup` is the ONLY context for `except*` in domain-adjacent code.
- For finer-grained isolation, `expression.MailboxProcessor` processes messages sequentially — converting concurrent failures to ordered `Result` values.

---
## Rules

- [ALWAYS] Spawn via `anyio.create_task_group()` only.
- [ALWAYS] Set explicit `CancelScope` deadlines for bounded execution.
- [ALWAYS] Shield commit/ack paths and re-raise cancellation.
- [ALWAYS] Set `max_buffer_size` on every memory stream.
- [ALWAYS] Add cooperative checkpoints in hot async loops.
- [ALWAYS] Handle TaskGroup multi-failure via `except*` at group boundaries.
- [ALWAYS] Use `bytes` as the interpreter-crossing wire contract.
- [ALWAYS] Wrap `InterpreterPoolExecutor` calls with `# BOUNDARY ADAPTER` try/except into `Result`.
- [NEVER] Use mutable globals under free-threading -- `ContextVar[tuple]` snapshots instead.
- [NEVER] Use bare `asyncio.create_task()` or `asyncio.gather()`.
- [PREFER] `threading.Lock` only for genuinely shared mutable resources.
- [PREFER] `expression.CancellationToken` for cooperative cross-thread cancellation.

Rule note: `try/except get_cancelled_exc_class(): raise` is the only permitted domain-adjacent `try/except`; cancellation is a foreign exception protocol. `# BOUNDARY ADAPTER` marks all other `try/except` at interpreter and process boundaries.

---
## Quick Reference

| [INDEX] | [PATTERN]                    | [WHEN]                                      | [KEY_TRAIT]                              |
| :-----: | ---------------------------- | ------------------------------------------- | ---------------------------------------- |
|   [1]   | Bounded pipeline             | Fan-out with deadline + backpressure + ack  | `CancelScope` + `CapacityLimiter`        |
|   [2]   | Pipeline stage               | Multi-stage async typed transformation      | `MemoryObjectStream` + `CapacityLimiter` |
|   [3]   | `move_on_after`/`fail_after` | Soft vs hard timeout per-operation          | `scope.cancelled_caught` inspection      |
|   [4]   | `CancelScope(shield=True)`   | Protect commit/ack under parent cancel      | Defer cancel until scope exit            |
|   [5]   | Checkpoint discipline        | Fairness for CPU-heavy async loops          | `checkpoint_if_cancelled()` in hot paths |
|   [6]   | ContextVar snapshots         | Free-threaded safety for scoped state       | Immutable tuple replacement              |
|   [7]   | Interpreter isolation        | CPU-parallel with `bytes` wire contract     | `InterpreterPoolExecutor` + boundary adapter |
|   [8]   | `except*` groups             | TaskGroup multi-failure structured handling | Subtractive clause matching              |
|   [9]   | `MailboxProcessor`           | Actor-based sequential message processing   | Ordered Result from concurrent input     |
|  [10]   | `CancellationToken`          | Cooperative cross-thread cancellation       | `is_cancellation_requested` check        |
