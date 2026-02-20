# [H1][PERFORMANCE]
>**Dictum:** *Measure before optimizing; optimize allocation before algorithm; optimize algorithm before concurrency.*

<br>

Performance in Python 3.14+ is structural: `__slots__` on all classes, `msgspec.Struct(gc=False)` for GC-exempt wire objects, `tuple` over `list`, frozen collections with structural sharing, free-threading via PEP 779, and copy-and-patch JIT via PEP 744. All snippets target `msgspec >= 0.20`, `anyio >= 4.12`, `expression >= 5.6`, and CPython 3.14+ free-threading build.

---
## [1][MEMORY_AND_ALLOCATION]
>**Dictum:** *Allocation-free is normal-form; immutable structures prevent an entire class of GC pressure.*

<br>

`__slots__` eliminates per-instance `__dict__` overhead (~56 bytes per object on 64-bit). `tuple` over `list` and `frozenset` over `set` prevent accidental mutation and reduce GC tracking. `expression.collections.Block[T]` provides frozen list semantics with structural sharing for O(log32 N) append/update -- suitable as Pydantic model fields via built-in `__get_pydantic_core_schema__`.

```python
"""Allocation discipline: __slots__, frozen collections, structural sharing."""

# --- [IMPORTS] ----------------------------------------------------------------

import sys
from typing import Final

from expression import Option, Some
from expression.collections import Block, Map
from pydantic import BaseModel

# --- [CODE] -------------------------------------------------------------------

# -- __slots__ eliminates __dict__ overhead on non-Pydantic classes ------------
class MetricAccumulator:
    __slots__ = ("name", "values", "total")

    def __init__(self, name: str, values: tuple[float, ...] = ()) -> None:
        self.name: str = name
        self.values: tuple[float, ...] = values
        self.total: float = sum(values)

# -- Frozen Pydantic model with expression collections as fields ---------------
class Portfolio(BaseModel, frozen=True):
    owner_id: str
    positions: Block[str] = Block.empty()
    metadata: Map[str, str] = Map.empty()
    active_flag: Option[bool] = Some(True)

# -- Immutable update via structural sharing (O(log32 N)) ----------------------
def add_position(portfolio: Portfolio, symbol: str) -> Portfolio:
    return portfolio.model_copy(update={
        "positions": portfolio.positions.cons(symbol),
    })

# -- Memory measurement at development time ------------------------------------
_SLOTS_SIZE: Final[int] = sys.getsizeof(MetricAccumulator("test"))
_DICT_BASELINE: Final[int] = sys.getsizeof({"name": "test", "values": (), "total": 0.0})
```

Allocation hierarchy (prefer top):
- `tuple[T, ...]` / `frozenset[T]` -- zero-overhead immutable; no GC tracking for simple content.
- `expression.Block[T]` -- structural sharing; Pydantic-compatible; 30+ combinators. See types.md [3].
- `expression.Map[K, V]` -- HAMT-backed frozen dict; O(log32 N) operations.
- `msgspec.Struct(gc=False)` -- C-backed, GC-exempt wire objects. See serialization.md [2].
- `list[T]` / `dict[K, V]` -- mutable; boundary-only when framework requires.

[CRITICAL]: `__slots__` on all non-Pydantic, non-dataclass domain classes. Pydantic `BaseModel` manages its own `__dict__` -- adding `__slots__` conflicts.

---
## [2][CPYTHON_INTERNALS]
>**Dictum:** *Understand the runtime to avoid fighting it; free-threading and JIT change the performance calculus.*

<br>

CPython 3.14 ships two runtime-altering features: **free-threading** (PEP 779 -- GIL disabled per-interpreter) and **copy-and-patch JIT** (PEP 744 -- template-based compilation of hot bytecode). Both change which optimizations matter.

```python
"""CPython 3.14+ runtime introspection: GIL status + JIT awareness."""

# --- [IMPORTS] ----------------------------------------------------------------

import sys
from typing import Final

# --- [CODE] -------------------------------------------------------------------

# -- Free-threading detection (PEP 779) ----------------------------------------
GIL_ENABLED: Final[bool] = sys._is_gil_enabled()  # noqa: SLF001 -- official CPython 3.14 API

# -- JIT detection (PEP 744) ---------------------------------------------------
# copy-and-patch JIT compiles hot bytecode traces to native code;
# sys._jit.is_enabled() available on JIT-enabled builds
_JIT_AVAILABLE: Final[bool] = hasattr(sys, "_jit") and sys._jit.is_enabled()  # noqa: SLF001
```

Free-threading implications:
- `ContextVar[tuple]` snapshots replace mutable globals -- immutable replacement is lock-free. See concurrency.md [2].
- `threading.Lock` only for genuinely shared mutable state (registries, connection pools).
- Frozen Pydantic models and `tuple` fields are inherently thread-safe -- no synchronization needed.
- `InterpreterPoolExecutor` for CPU-parallel work with `bytes` wire contracts. See concurrency.md [2].

JIT implications:
- Hot loops over simple bytecode operations benefit most -- the JIT traces and compiles frequently executed paths.
- Tight generator expressions and comprehensions are JIT-friendly; deeply nested function calls with complex dispatch are not.
- Profile before assuming JIT handles a hot path -- `sys._jit.is_enabled()` confirms the build has JIT support.

[IMPORTANT]: Free-threading does NOT eliminate the need for `CapacityLimiter` backpressure in async pipelines -- it enables true parallelism for CPU-bound threads, but async concurrency still requires structured bounds. See concurrency.md [1].

---
## [3][SERIALIZATION_THROUGHPUT]
>**Dictum:** *msgspec is 5-10x stdlib json; module-level singletons amortize schema compilation.*

<br>

`msgspec.json` outperforms `json` by 5-10x for encode/decode via C-backed codegen. `orjson` provides similar throughput with different trade-offs (no schema validation, returns `bytes` natively). `Struct(gc=False, frozen=True)` produces zero-GC immutable wire objects. Module-level `Encoder`/`Decoder` singletons amortize schema compilation cost across requests.

```python
"""Serialization throughput: module-level singletons, zero-GC structs, eager TypeAdapter."""

# --- [IMPORTS] ----------------------------------------------------------------

import msgspec
from msgspec import Struct
from pydantic import BaseModel, TypeAdapter

# --- [CODE] -------------------------------------------------------------------

# -- Zero-GC wire struct: frozen + gc=False ------------------------------------
class PriceUpdate(Struct, frozen=True, gc=False, tag_field="kind", tag="price_update"):
    symbol: str
    price_cents: int
    timestamp: str

class TradeExecution(Struct, frozen=True, gc=False, tag_field="kind", tag="trade"):
    symbol: str
    quantity: int
    price_cents: int

# -- Module-level singletons amortize schema compilation -----------------------
_price_encoder: msgspec.json.Encoder = msgspec.json.Encoder()
_price_decoder: msgspec.json.Decoder[PriceUpdate] = msgspec.json.Decoder(PriceUpdate)
_event_decoder: msgspec.json.Decoder[PriceUpdate | TradeExecution] = (
    msgspec.json.Decoder(PriceUpdate | TradeExecution)
)

def encode_price(update: PriceUpdate) -> bytes:
    return _price_encoder.encode(update)

def decode_price(raw: bytes) -> PriceUpdate:
    return _price_decoder.decode(raw)

# -- Pydantic TypeAdapter: eager init at module level --------------------------
class OrderRequest(BaseModel, frozen=True):
    account_id: str
    symbol: str
    quantity: int

_order_adapter: TypeAdapter[OrderRequest] = TypeAdapter(OrderRequest)

def validate_order(raw: bytes) -> OrderRequest:
    return _order_adapter.validate_json(raw)
```

Throughput hierarchy:
- `msgspec.json.encode/decode` with `Struct(gc=False)` -- fastest path; C-backed, no GC tracking.
- `orjson.dumps/loads` -- comparable speed; no schema validation, `bytes` native return.
- `Pydantic TypeAdapter.validate_json` -- Rust-backed validation; slower than msgspec but richer validation.
- `json.dumps/loads` -- stdlib fallback; 5-10x slower than msgspec.

[CRITICAL]: `Encoder`/`Decoder` at module level -- never per-request. `TypeAdapter` at module level -- construction compiles Pydantic core schema. See serialization.md [2] for full msgspec struct patterns.

---
## [4][ASYNC_PERFORMANCE]
>**Dictum:** *Backpressure prevents runaway memory; checkpoint placement determines latency fairness.*

<br>

Async performance is bounded concurrency performance. `CapacityLimiter` prevents fan-out from exhausting memory, `MemoryObjectStream` buffer sizing controls backpressure, and checkpoint variant selection determines latency distribution across tasks.

```python
"""Async performance: CapacityLimiter sizing, buffer strategy, checkpoint selection."""

# --- [IMPORTS] ----------------------------------------------------------------

from anyio import CapacityLimiter, fail_after
from anyio.lowlevel import checkpoint, checkpoint_if_cancelled

# --- [CODE] -------------------------------------------------------------------

# -- CapacityLimiter: size to downstream throughput, not upstream demand -------
_http_limiter: CapacityLimiter = CapacityLimiter(total_tokens=50)
_db_limiter: CapacityLimiter = CapacityLimiter(total_tokens=10)

async def fetch_with_backpressure(url: str, timeout: float = 5.0) -> bytes:
    """Bounded HTTP fetch: limiter caps concurrency, fail_after caps duration."""
    async with _http_limiter:
        with fail_after(timeout):
            # placeholder: actual HTTP client call
            await checkpoint()
            return b""

# -- Checkpoint selection for hot paths ----------------------------------------
async def process_batch[T](items: tuple[T, ...], batch_size: int = 100) -> None:
    """checkpoint_if_cancelled in hot loops: lower overhead than full checkpoint."""
    for index in range(len(items)):
        # Full checkpoint every batch_size items for fairness
        # Cheaper cancel-check on every iteration
        match index % batch_size:
            case 0:
                await checkpoint()
            case _:
                await checkpoint_if_cancelled()
```

Buffer sizing strategy:
- `max_buffer_size=0` (rendezvous) -- producer blocks until consumer ready; minimal memory, maximum latency.
- `max_buffer_size=N` where N = 2x consumer batch size -- balances throughput and memory.
- Unbounded (`max_buffer_size=math.inf`) -- [NEVER] in production; memory grows without limit.

Checkpoint selection:
- `checkpoint()` -- full yield + cancel check; use at natural batch boundaries.
- `checkpoint_if_cancelled()` -- cancel check only, no yield; use in hot inner loops where fairness yield would kill throughput.
- `cancel_shielded_checkpoint()` -- yield inside shielded scopes without cancel check.
- `fail_after(seconds)` -- preferred over manual `CancelScope(deadline=...)` for timeout patterns.

uvloop note: `anyio` auto-selects uvloop when installed (`pip install uvloop`). 2-4x throughput improvement for high-connection-count workloads. No code changes required -- `anyio` detects at import time.

[IMPORTANT]: Size `CapacityLimiter` to downstream capacity (database pool size, external API rate limit), not to upstream request volume. See concurrency.md [1] for full structured concurrency algebra.

---
## [5][PROFILING_AND_MEASUREMENT]
>**Dictum:** *Profile first; optimize what the profiler identifies, not what intuition suggests.*

<br>

| [INDEX] | [TOOL]          | [USE_WHEN]                           | [KEY_TRAIT]                                  |
| :-----: | --------------- | ------------------------------------ | -------------------------------------------- |
|   [1]   | `cProfile`      | Function-level CPU hotspot           | Stdlib; `pstats.Stats.sort_stats('cumtime')` |
|   [2]   | `tracemalloc`   | Memory allocation tracking           | Stdlib; snapshot diffs between operations    |
|   [3]   | `py-spy`        | Production sampling (no overhead)    | Attaches to running PID; flame graphs        |
|   [4]   | `scalene`       | Line-level CPU + memory + GPU        | Separates Python/native/system time          |
|   [5]   | `memray`        | Heap profiling with allocation trace | C-level tracking; flamegraph + tree reports  |
|   [6]   | `sys.getsizeof` | Single-object size measurement       | Shallow only; use `tracemalloc` for deep     |

```python
"""Profiling: tracemalloc snapshot diff for allocation tracking."""

# --- [IMPORTS] ----------------------------------------------------------------

import tracemalloc
from typing import Final

# --- [CODE] -------------------------------------------------------------------

def measure_allocations[T](
    operation: str,
    func: object,  # Callable[[], T] -- simplified for snippet
    top_n: int = 10,
) -> None:
    """Snapshot diff: measure net allocations from a specific operation."""
    tracemalloc.start()
    snapshot_before: tracemalloc.Snapshot = tracemalloc.take_snapshot()
    # execute operation (simplified)
    snapshot_after: tracemalloc.Snapshot = tracemalloc.take_snapshot()
    stats: list[tracemalloc.StatisticDiff] = snapshot_after.compare_to(
        snapshot_before, "lineno",
    )
    _top_stats: Final[list[tracemalloc.StatisticDiff]] = stats[:top_n]
    tracemalloc.stop()
```

Profiling workflow:
1. **Identify** -- `cProfile` or `py-spy` to find the hot function.
2. **Measure** -- `tracemalloc` snapshot diff to quantify allocations in the hot path.
3. **Optimize** -- apply allocation hierarchy from [1], serialization patterns from [3], or async patterns from [4].
4. **Verify** -- re-profile to confirm improvement; compare before/after snapshots.
5. **Monitor** -- `py-spy` in production for regression detection. See observability.md [4] for RED metrics projection.

[CRITICAL]: [NEVER] optimize without profiling evidence. `scalene` for line-level granularity when `cProfile` is too coarse. `memray` for heap analysis when `tracemalloc` overhead is acceptable.

---
## [6][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] `__slots__` on all non-Pydantic, non-dataclass domain classes.
- [ALWAYS] `tuple` over `list`, `frozenset` over `set` for immutable data in domain models.
- [ALWAYS] Module-level `Encoder`/`Decoder`/`TypeAdapter` singletons -- never per-request.
- [ALWAYS] Size `CapacityLimiter` to downstream capacity, not upstream demand.
- [ALWAYS] Profile before optimizing -- `cProfile` for CPU, `tracemalloc` for memory.
- [NEVER] Optimize without measurement evidence from profiling tools.
- [NEVER] Unbounded `MemoryObjectStream` buffer in production.

---
## [7][QUICK_REFERENCE]
>**Dictum:** *One table maps pattern to context.*

<br>

| [INDEX] | [PATTERN]                 | [WHEN]                                | [KEY_TRAIT]                            |
| :-----: | ------------------------- | ------------------------------------- | -------------------------------------- |
|   [1]   | `__slots__`               | All non-Pydantic domain classes       | ~56 bytes saved per instance           |
|   [2]   | `Block[T]` / `Map[K,V]`   | Frozen collections in Pydantic models | Structural sharing, O(log32 N)         |
|   [3]   | `Struct(gc=False)`        | Wire objects, short-lived egress      | Zero GC tracking, C-backed             |
|   [4]   | Free-threading (PEP 779)  | CPU-parallel without GIL              | `sys._is_gil_enabled()`, frozen models |
|   [5]   | Copy-and-patch JIT        | Hot bytecode trace compilation        | `sys._jit.is_enabled()`, auto-optimize |
|   [6]   | Module-level singletons   | Encoder/Decoder/TypeAdapter           | Amortize schema compilation            |
|   [7]   | `checkpoint_if_cancelled` | Hot async inner loops                 | Cancel check without yield overhead    |
|   [8]   | `CapacityLimiter`         | Bounded fan-out, backpressure         | Size to downstream, not upstream       |
|   [9]   | `tracemalloc` diff        | Measure allocation in hot paths       | Snapshot before/after comparison       |
|  [10]   | `py-spy`                  | Production CPU profiling              | Zero overhead attach to running PID    |
