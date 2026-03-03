# Effects

Effect rail selection, accumulation, Kleisli composition, async cancellation, Protocol-threaded dependencies, recovery algebra, and boundary adapters for Python 3.14+. This file governs effectful computation — all other reference files assume these rail semantics. All snippets assume expression v5.6+ with `Result`, `Option`, `@effect.result`, `@effect.async_result`, `pipe`, `Block`, `Map`, `curry_flip`.

---

## Rail Selection, Accumulation, and Collapse

Rail selection encodes failure semantics at the type level — `Result[T, Block[Defect]]` carries per-axis diagnostic context through the error channel, while `to_option()` erases the error type to presence/absence when downstream only needs a sentinel for "validation failed." The accumulator discriminates on `mode`: `"seq"` threads `bind` through the fold, short-circuiting on first `Error` and discarding subsequent diagnostics; `"par"` decomposes each `Result` into value/defect channels via `swap().default_value(_EMPTY)`, concatenating both through Block's monoidal `+` without short-circuit. Terminal collapse selects exactly one projection at the boundary — `to_option().map(f).default_value(fallback)` for absence-to-sentinel, `swap().default_value(identity)` for typed error extraction — ensuring the rail-safe interior never leaks raw `Result` to the untyped exterior.

```python
from dataclasses import dataclass
from math import fma
from typing import Final, Literal, assert_never

from expression import Ok, Option, Result, curry_flip, pipe
from expression.collections import Block, block

@dataclass(frozen=True, slots=True)
class Defect:
    axis: str; measured: float; limit: float

_EMPTY: Final[Block[Defect]] = block.empty()

@curry_flip(1)
def accumulate[T](mode: Literal["par", "seq"], checks: Block[Result[T, Block[Defect]]]) -> Result[Block[T], Block[Defect]]:
    match mode:
        case "seq":
            return pipe(checks, block.fold(
                lambda acc, r: acc.bind(lambda vs: r.map(lambda v: vs + block.of(v))),
                Ok(block.empty())))
        case "par":
            oks, errs = pipe(checks, block.fold(
                lambda acc, r: (
                    acc[0] + r.map(block.of).default_value(block.empty()),
                    acc[1] + r.swap().default_value(_EMPTY)),
                (block.empty(), _EMPTY)))
            return Option.Some(oks).filter(lambda _: errs.length == 0).to_result(errs)
        case _ as unreachable:
            assert_never(unreachable)

@curry_flip(1)
def boundary(specs: Block[tuple[str, float, float]], samples: Block[float]) -> tuple[float, Block[Defect]]:
    gate = lambda spec, v: Ok(v).filter_with(
        lambda x: spec[1] <= x <= spec[2],
        lambda _: block.of(Defect(spec[0], v, spec[2])))
    result = pipe(block.of_seq(zip(specs, samples)), block.map(lambda sv: gate(*sv)), accumulate("par"))
    energy = result.to_option().map(lambda vs: pipe(vs, block.fold(lambda a, x: fma(x, x, a), 0.0))).default_value(0.0)
    return energy, result.swap().default_value(_EMPTY)
```

`r.map(block.of).default_value(block.empty())` extracts the Ok value as a singleton Block or returns the monoid identity on failure — dual to `r.swap().default_value(_EMPTY)` which extracts the Error block or returns identity on success; `+` concatenates both channels unconditionally because Block monoid does not short-circuit, and `_EMPTY: Final` is reused without allocation. `Option.Some(oks).filter(lambda _: errs.length == 0).to_result(errs)` pivots on defect presence: empty errs passes the filter converting `Some(oks)` to `Ok(oks)`, non-empty fails it producing `Nothing`, which `to_result(errs)` lifts to `Error(errs)`. `boundary` composes `gate` (per-sample `filter_with` producing `Result[float, Block[Defect]]`), `block.map` (element-wise application), and `accumulate("par")` in a single `pipe` chain; collapse uses `to_option().map(...)` for signal energy via `fma(x, x, a)` (squared-magnitude fold with fused precision), and independently `swap().default_value(_EMPTY)` for defect extraction — the two projections operate on the same `result` without interference.

---

## Kleisli Pipelines and Generator Algebra

Kleisli composition via `bind` erases intermediate bindings — each arrow sees only its predecessor's `Ok`, making cross-step reference structurally impossible without witness capture. `compose_k` recovers provenance by pairing the final result with `Witness(prior=a, mid=b)`, while `map_error` at each stage lifts per-arrow error types into the unified channel `G` through `lift_f` and `lift_g` — ceremony that scales linearly with pipeline depth. The `@effect.result` generator eliminates this ceremony: `yield from` binds intermediates into the generator scope, making cross-step dependencies live computation inputs rather than inert witness data, with `filter_with` producing stage-tagged error triples directly at each gate site.

```python
from collections.abc import Callable
from dataclasses import dataclass
from math import fma, sqrt

from expression import Ok, Result, effect, pipe
from expression.collections import Block, block

type Kleisli[A, B, E] = Callable[[A], Result[B, E]]

@dataclass(frozen=True, slots=True)
class Witness[A, B]:
    prior: A; mid: B

def compose_k[A, B, C, E, F, G](
    f: Kleisli[A, B, E], g: Kleisli[B, C, F],
    lift_f: Callable[[A, E], G], lift_g: Callable[[B, F], G]
) -> Kleisli[A, tuple[C, Witness[A, B]], G]:
    return lambda a: f(a).map_error(lambda e: lift_f(a, e)).bind(
        lambda b: g(b).map_error(lambda e: lift_g(b, e)).map(lambda c: (c, Witness(a, b))))

@effect.result[float, tuple[str, Block[float], float]]()
def pipeline(spectrum: Block[float], noise_floor: float, threshold: float):
    rms = yield from Ok(sqrt(pipe(
        spectrum, block.fold(lambda a, x: fma(x, x, a), 0.0)
    ) / max(spectrum.length, 1))).filter_with(
        lambda v: v > noise_floor, lambda v: ("rms_gate", spectrum, v))
    normed = pipe(spectrum, block.map(lambda x: x / rms))
    peak = yield from Ok(pipe(normed, block.fold(max, 0.0))).filter_with(
        lambda v: v > threshold, lambda v: ("peak_gate", normed, v))
    return fma(peak, rms, 0.0)
```

`compose_k` returns `Kleisli[A, tuple[C, Witness[A, B]], G]` — `Witness` captures `prior: A` and `mid: B` as named fields replacing untyped tuple nesting, enabling destructured access at the call site; `lift_f` closes over the input `a` at the first `map_error` site while `lift_g` closes over the intermediate `b` at the second, and the `G` unification target is the composition's error-channel ceremony requiring one wrapper function per arrow. The `@effect.result` generator eliminates all lifter ceremony: `rms` binds via `yield from` and feeds both `normed = pipe(spectrum, block.map(lambda x: x / rms))` and the final `fma(peak, rms, 0.0)` — a denormalization that uses step-1 (`rms`) and step-2 (`peak`) results simultaneously, which `compose_k` cannot express because intermediate values are trapped in `Witness` rather than in scope. `filter_with` at each gate site produces the error triple `(stage_name, intermediate_data, metric)` inline — `block.fold(lambda a, x: fma(x, x, a), 0.0)` accumulates spectral energy with fused precision, and `block.fold(max, 0.0)` extracts the spectral peak, both via the same combinator with different binary operators.

---

## Async Rail Composition: Cancellation and Backpressure

Async rail composition threads typed cancellation through `move_on_after` deadline scoping — the sentinel `r = None` absorbs scope expiration into the `match` algebra, and the deadline encompasses both semaphore acquisition and `fn()` execution so contended backpressure correctly consumes budget. `_with_backoff` recurses with φ-scaled delay `(1 + √5) / 2` inlined at the call site, spacing retries irrationally to prevent harmonic resonance with power-of-two rate limiters; generator-based `@effect.async_result` assumes linear bind chains incompatible with recursive re-entry, requiring explicit recursion. `fanout` collects through a bounded memory stream sized to task count, partitions via `block.choose`, and the terminal `Option.Some(errs).filter(...).to_result(oks).swap()` replaces conditional branching with pure rail polarity inversion.

```python
from collections.abc import Callable, Coroutine
from dataclasses import dataclass

import anyio
from anyio import Semaphore, create_task_group, move_on_after
from expression import Error, Ok, Option, Result, pipe
from expression.collections import Block, block

@dataclass(frozen=True, slots=True)
class Deadline: elapsed: float; budget: float

@dataclass(frozen=True, slots=True)
class Saturated[E]: remaining: int; last: E

async def _with_backoff[T, E](
    fn: Callable[[], Coroutine[None, None, Result[T, E]]], sem: Semaphore,
    budget: float, pred: Callable[[E], bool], n: int, d: float, w: float,
) -> Result[T, Deadline | Saturated[E]]:
    r: Result[T, E] | None = None
    with move_on_after(budget - w):
        async with sem:
            r = await fn()
    match r:
        case None: return Error(Deadline(w, budget))
        case Ok(v): return Ok(v)
        case Error(e) if n <= 0 or not pred(e): return Error(Saturated(n, e))
        case _:
            await anyio.sleep(d)
            return await _with_backoff(
                fn, sem, budget, pred, n - 1, d * (1 + 5**0.5) / 2, w + d)

async def fanout[T, E](
    tasks: Block[Callable[[], Coroutine[None, None, Result[T, E]]]],
    sem: Semaphore, budget: float, retries: int, pred: Callable[[E], bool],
) -> Result[Block[T], Block[Deadline | Saturated[E]]]:
    tx, rx = anyio.create_memory_object_stream[Result[T, Deadline | Saturated[E]]](tasks.length)
    async def _go(f: Callable[[], Coroutine[None, None, Result[T, E]]]) -> None:
        await tx.send(await _with_backoff(f, sem, budget, pred, retries, 0.1, 0.0))
    async with create_task_group() as tg:
        pipe(tasks, block.fold(lambda _, f: tg.start_soon(_go, f), None))
    await tx.aclose()
    collected = block.of_seq(rx.receive_nowait() for _ in range(tasks.length))
    oks = pipe(collected, block.choose(lambda r: r.to_option()))
    errs = pipe(collected, block.choose(lambda r: r.swap().to_option()))
    return Option.Some(errs).filter(lambda b: b.length > 0).to_result(oks).swap()
```

`r: Result[T, E] | None = None` serves as cancellation sentinel — `move_on_after` expiration leaves `r` as `None`, which `case None` converts to `Deadline(w, budget)` with full temporal provenance; successful completion overwrites `r` for `Ok`/`Error` dispatch. The guard `n <= 0 or not pred(e)` folds retry exhaustion and non-retryable errors into one `Saturated` arm; the recursive tail call scales delay by `(1 + 5**0.5) / 2` and accumulates `w + d` for deadline tracking. `fanout` drives task registration through `block.fold(lambda _, f: tg.start_soon(_go, f), None)` — side-effect-only fold with discarded accumulator — then drains the memory stream synchronously via `receive_nowait()` since all sends completed before `async with` exit; `block.choose` with `.to_option()` / `.swap().to_option()` partitions into typed `Block` accumulators, and `Option.Some(errs).filter(length > 0).to_result(oks).swap()` inverts rail polarity without conditional branching.

---

## Protocol-Threaded Dependency Flow

Reader-style capability threading reifies dependency acquisition as a monadic yield — `ask[C]` is a single-yield generator that binds from a `ContextVar[Scope]` lookup, producing `Missing[C]` when the scope lacks registration instead of raising. Scope construction folds capabilities through `pipe(block.of_seq(caps), block.fold(...))`, replacing `singledispatch`/`reduce` with a single chain that threads `type(c)` → `c` bindings into the parent scope — no registration decorator, no dispatch table, no `raise TypeError` default. `scoped` forks the `ContextVar` snapshot via `copy_context().run`, ensuring capability mutations remain invisible to sibling tasks; `@effect.result` generators bind sequentially through `yield from`, short-circuiting on `Missing` with full type-level provenance.

```python
from collections.abc import Callable, Generator
from contextvars import ContextVar, copy_context
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from expression import Error, Ok, Result, effect, pipe
from expression.collections import Map, block

type Scope = Map[type, object]
_scope: ContextVar[Scope] = ContextVar("_scope", default=Map.empty())

@dataclass(frozen=True, slots=True)
class Missing[C]:
    capability: type[C]

def ask[C](cap: type[C]) -> Generator[Result[C, Missing[C]], C, C]:
    return (yield _scope.get().try_find(cap).map(Ok).default_value(Error(Missing(cap))))

def scoped[T](thunk: Callable[[], T], *caps: object) -> T:
    scope = pipe(block.of_seq(caps), block.fold(
        lambda s, c: s.add(type(c), c), _scope.get()))
    return copy_context().run(lambda: (_scope.set(scope), thunk())[1])

@runtime_checkable
class SensorBus(Protocol):
    def read(self, channel: int) -> Result[float, str]: ...

@effect.result[float, Missing[SensorBus] | str]()
def run(channel: int):
    bus: SensorBus = yield from ask(SensorBus)
    reading = yield from bus.read(channel)
    return reading * (1 + 5**0.5) / 2
```

`ask[C]` yields exactly once — `.try_find(cap)` returns `Option[object]`, chained through `.map(Ok).default_value(Error(Missing(cap)))` to normalize absent capabilities to typed error rails without exceptions. `scoped` folds variadic capabilities via `block.fold(lambda s, c: s.add(type(c), c), _scope.get())` — polymorphic registration by runtime type replaces `singledispatch` entirely, and the tuple expression `(_scope.set(scope), thunk())[1]` evaluates set-then-execute in expression position inside `copy_context().run`. `run` demonstrates staged composition: `SensorBus` binds from scope via `yield from ask(SensorBus)`, the second `yield from` absorbs `bus.read`'s `Result[float, str]` into the error rail, and the return expression applies φ-scaled calibration — two distinct error types (`Missing[SensorBus]`, `str`) merge into the unified rail declared in `@effect.result[float, Missing[SensorBus] | str]`.

---

## Recovery, Fallback, and Resilience Algebra

Recovery algebra decomposes into three pure layers: circuit-breaker gate over `Map[type, int]` failure counts (`Option` chain replaces windowed-time conditionals), policy routing via exhaustive `match/case` on `Anomaly` variants with structurally distinct post-recovery transforms (`map` for offset compensation, `filter_with` for magnitude validation, terminal `Error` for non-recoverable faults), and strategy composition through `block.fold` seeded with `Error(anomaly)` and threaded via `.or_else_with`. `gate` chains `try_find → filter → map → to_result → swap`, converting "count above threshold" into `Error(CircuitOpen)` and "circuit closed" into `Ok(Anomaly)` without a single conditional branch. `recover` composes gate and route through `pipe` and `bind`, producing `Result[float, Anomaly | CircuitOpen]` where all three failure modes (circuit open, non-recoverable variant, exhausted strategies) resolve on the same error rail.

```python
from dataclasses import dataclass
from typing import Callable, assert_never

from expression import Error, Result, curry_flip, pipe
from expression.collections import Block, Map, block

type Anomaly = Drift | Spike | Dropout

@dataclass(frozen=True, slots=True)
class Drift: channel: int; offset: float

@dataclass(frozen=True, slots=True)
class Spike: channel: int; magnitude: float

@dataclass(frozen=True, slots=True)
class Dropout: channel: int

@dataclass(frozen=True, slots=True)
class CircuitOpen:
    fault_type: type[Anomaly]; count: int

type Strategy = Callable[[Anomaly], Result[float, Anomaly]]

@curry_flip(2)
def gate(counts: Map[type, int], threshold: int, anomaly: Anomaly) -> Result[Anomaly, CircuitOpen]:
    return counts.try_find(type(anomaly)).filter(lambda n: n >= threshold).map(
        lambda n: CircuitOpen(type(anomaly), n)).to_result(anomaly).swap()

def route(anomaly: Anomaly, base: Result[float, Anomaly]) -> Result[float, Anomaly]:
    match anomaly:
        case Drift(offset=o): return base.map(lambda v: v - o)
        case Spike(magnitude=m): return base.filter_with(lambda v: abs(v) < abs(m), lambda _: anomaly)
        case Dropout(): return Error(anomaly)
        case _ as unreachable: assert_never(unreachable)

def recover(anomaly: Anomaly, strategies: Block[Strategy],
            counts: Map[type, int], threshold: int) -> Result[float, Anomaly | CircuitOpen]:
    compose = lambda a: pipe(strategies, block.fold(lambda acc, s: acc.or_else_with(lambda: s(a)), Error(a)))
    return pipe(anomaly, gate(counts, threshold), lambda r: r.bind(lambda a: route(a, compose(a))))
```

`gate` converts the circuit-breaker check into a pure `Option` chain: `try_find` yields `Option[int]`, `filter(n >= threshold)` retains only above-threshold counts, `map` wraps into `CircuitOpen`, `to_result` normalizes to `Result`, and `swap` flips polarity so circuit-open becomes the error rail — zero conditionals. `@curry_flip(2)` on the 3-parameter function means `gate(counts, threshold)` binds both config arguments, returning `Callable[[Anomaly], Result[Anomaly, CircuitOpen]]` for direct use in `pipe`. `route` applies policy-specific post-processing after the strategy fold: `Drift.map` compensates the sensor offset on the recovered signal, `Spike.filter_with` validates the recovery magnitude stays below the anomaly's spike threshold, and `Dropout` rejects strategies entirely as non-recoverable. The fold seeds with `Error(anomaly)` so the first strategy receives the original fault via `or_else_with`; subsequent strategies receive the prior strategy's error — ordering in the `Block` directly encodes recovery priority.

---

## Boundary Adapters for HTTP/CLI/Worker Surfaces

Boundary projection collapses domain `SensorFault` to transport-specific egress via `match/case` on `Surface.transport` — a `Literal["http", "cli", "worker"]` discriminant replaces three separate surface classes while `assert_never` guarantees exhaustive coverage at the type level. `collapse` with `@curry_flip(1)` takes `fault` as data argument (piped/mapped) and `surface` as config, computing transport-native numeric codes through positional tuple indexing (`502 + index` for HTTP status, `70 + index` for POSIX exit) — `collapse(surface)` partially applies the transport, yielding `Callable[[SensorFault], Egress]` directly compatible with `map_error`. `validate` with `@curry_flip(1)` owns the sole `try/except` (`# BOUNDARY ADAPTER`), converting Pydantic deserialization failure to `Error(SensorFault)` before any domain transform executes. `ingest` composes the full boundary pipeline: `pipe` threads raw bytes through `validate(adapter)`, `bind(transform)`, and `map_error(collapse(surface))` — the error rail carries `SensorFault` until the terminal `map_error` projects it to wire-format `Problem | Exit | Envelope`.

```python
from dataclasses import dataclass
from typing import Callable, Literal, assert_never

import msgspec
from pydantic import TypeAdapter

from expression import Error, Ok, Result, curry_flip, pipe

@dataclass(frozen=True, slots=True)
class Surface:
    transport: Literal["http", "cli", "worker"]
    qualifier: str

@dataclass(frozen=True, slots=True)
class SensorFault:
    channel: int; code: Literal["drift", "spike", "dropout", "malformed"]; detail: str = ""

class Egress  (msgspec.Struct, frozen=True, gc=False, tag_field="t"): ...
class Problem (Egress, tag="http"):   uri:  str;  status:  int; title: str
class Exit    (Egress, tag="cli"):    code: int;  message: str
class Envelope(Egress, tag="worker"): key:  str;  reason:  str

@curry_flip(1)
def collapse(surface: Surface, fault: SensorFault) -> Problem | Exit | Envelope:
    codes = ("drift", "spike", "dropout", "malformed")
    rank, label = codes.index(fault.code), fault.code.upper()
    match surface.transport:
        case "http": return Problem(f"urn:sensor:{fault.channel}:{fault.code}", 502 + rank, label)
        case "cli": return Exit(70 + rank, label)
        case "worker": return Envelope(f"{surface.qualifier}.{fault.code}", f"ch{fault.channel}")
        case _ as unreachable: assert_never(unreachable)

@curry_flip(1)
def validate[T](adapter: TypeAdapter[T], raw: bytes) -> Result[T, SensorFault]:
    # BOUNDARY ADAPTER — pydantic deserialization boundary
    try: return Ok(adapter.validate_json(raw))
    except Exception as exc: return Error(SensorFault(channel=-1, code="malformed", detail=str(exc)))

def ingest[T, R](adapter: TypeAdapter[T], surface: Surface,
    transform: Callable[[T], Result[R, SensorFault]],
    raw: bytes) -> Result[R, Problem | Exit | Envelope]:
    return pipe(raw, validate(adapter),
                lambda r: r.bind(transform).map_error(collapse(surface)))
```

`Surface` carries a `qualifier` field (HTTP version string, AMQP queue name, empty for CLI) that `collapse` threads into transport-specific constructors — `Envelope` composes `qualifier` with `fault.code` as the routing key, while HTTP and CLI arms discard it structurally. The positional invariant `("drift", "spike", "dropout").index(fault.code)` is type-safe: `code`'s `Literal` constraint makes `ValueError` structurally unreachable — `rank` and `label` pre-compute the index and uppercase projection once before the match, eliminating duplication and feeding HTTP status (`502 + rank`) and POSIX exit code (`70 + rank`) via arithmetic offset. `@curry_flip(1)` on both `collapse` and `validate` enables uniform partial-application style: `collapse(surface)` and `validate(adapter)` each bind their config argument first, producing unary functions that slot directly into `map_error` and `pipe` respectively. `ingest` is the composition root: `bind(transform)` chains the domain function on the success rail, `map_error(collapse(surface))` projects faults to egress on the error rail — callers receive `Result[R, Problem | Exit | Envelope]` with zero access to `SensorFault` internals.

---

## Rules

- `Result[T, E]` sync, `@effect.async_result` async, `Option[T]` absence-only — failure encoded as `Nothing` is a type error.
- Zero `try`/`except` in domain transforms; exception handling confined to `# BOUNDARY ADAPTER` markers.
- Validation boundaries accumulate via `traverse`/`sequence`; transform-stage short-circuits on first `Error`.
- Single terminal collapse per boundary family — one `match`/`default_value` owns projection; no intermediate run points.
- `compose_k` with explicit witness capture; `@effect.result` generators when intermediate values feed subsequent steps.
- `fold`/`bind` pipelines for linear chains; generator builders for dependent multi-step composition with branching.
- `CancelledError` never caught — typed cancellation propagates inward; `@timeout` sits interior to `@retry`.
- Semaphore backpressure bounds fan-out; φ-backoff on retry; partial success collection via `Block` monoid accumulator.
- `ask[Cap]()` Reader-style threading; `ContextVar` scope isolation per task — zero ambient globals or module singletons.
- `.or_else_with(fn)` at composition boundaries only — never inside `@effect.result` generators or mid-transform.
- Recovery policy routes `abort`/`retry`/`degrade`; circuit breaker as pure function returning `Result[T, CircuitOpen]`.
- Boundary adapters own collapse and `# BOUNDARY ADAPTER` marker; validate before collapse; domain never projects to transport.
