# Protocols

Structural subtyping contracts, capability slicing, variance discipline, and protocol-threaded dependency injection for Python 3.14+. This file governs Protocol surface design — all other reference files assume these capability boundaries and variance rules. All snippets assume expression v5.6+ with `Result`, `Option`, `@effect.result`, `pipe`, `Block`, `Map`, `curry_flip`.

---

## Protocol Design: Capability Slicing and AOP Authorization

Capabilities as a `Literal` vocabulary with `frozenset` subset algebra turns authorization into a lattice meet — `req <= held` is O(1) versus per-scope string comparison, and `PortFault.denied` carries the first missing capability via `next(iter(req - c[1]))` as typed evidence. `gated` pre-computes the requirement set at decoration time; `collect` demonstrates severity-gated fold accumulation where `PortFault.absent` entries (recoverable) preserve the accumulator via `or_else_with` while `PortFault.denied` entries (terminal) short-circuit — the `@tagged_union` discriminant property IS the routing predicate.

```python
from collections.abc import Callable
from contextvars import ContextVar
from functools import wraps
from typing import Literal, NewType, Protocol, runtime_checkable

from expression import Ok, Result, curry_flip, pipe, tagged_union
from expression.collections import Block, Map, block

Token = NewType("Token", str)
type Cap = Literal["r", "w", "x"]

@tagged_union
class PortFault:
    absent: str
    denied: tuple[Cap, frozenset[Cap]]
    @property
    def recoverable(self) -> bool: return isinstance(self, PortFault.absent)

@runtime_checkable
class Readable[T](Protocol):
    def read(self, key: str) -> Result[T, PortFault]: ...

class Writable[T](Protocol):
    def write(self, key: str, val: T) -> Result[None, PortFault]: ...

class Dual[T](Readable[T], Writable[T], Protocol): ...

_ctx: ContextVar[tuple[Token, frozenset[Cap]]] = ContextVar("_ctx")

def gated[**P, T, E](*caps: Cap) -> Callable[[Callable[P, Result[T, E]]], Callable[P, Result[T, E | PortFault]]]:
    req = frozenset(caps)
    def dec(fn: Callable[P, Result[T, E]]) -> Callable[P, Result[T, E | PortFault]]:
        @wraps(fn)
        def w(*a: P.args, **kw: P.kwargs) -> Result[T, E | PortFault]:
            return Ok(_ctx.get()).filter_with(
                lambda c: req <= c[1], lambda c: PortFault.denied((next(iter(req - c[1])), c[1]))
            ).bind(lambda _: fn(*a, **kw))
        return w
    return dec

@curry_flip(1)
@gated("r")
def collect[T](port: Readable[T], keys: Block[str]) -> Result[Map[str, T], PortFault]:
    return pipe(keys, block.fold(lambda acc, k: acc.bind(lambda m: port.read(k).map(
        lambda v: m.add(k, v)).or_else_with(
        lambda f: Ok(m).filter_with(lambda _: f.recoverable, lambda _: f))), Ok(Map.empty())))
```

`filter_with` on `Ok(_ctx.get())` gates authorization as a single expression — `req <= c[1]` performs subset membership on `frozenset[Cap]`; the failure branch constructs `PortFault.denied` with `next(iter(req - c[1]))` extracting the first missing capability from the set difference (safe because `req <= held` was False, guaranteeing non-empty difference). Protocol intersection composes via multiple inheritance (`Dual[T]` = `Readable[T]` x `Writable[T]`); `collect` demands only `Readable[T]`, so bidirectional adapters satisfy structurally while `Writable`-only fails at the type level. The fold's `or_else_with` chain implements severity-gated accumulation: `.recoverable` routes `PortFault.absent` through `Ok(m)` preserving the map unchanged, while `PortFault.denied` propagates via `filter_with(lambda _: f.recoverable, lambda _: f)` — terminal authorization failures make all subsequent reads structurally unauthorized, so short-circuit IS the correct domain semantics, not a limitation.

---

## Variance Discipline and Severity-Routed Recovery

Variance is PEP 695-inferred from method signature positions — `Decode[T]` is covariant (`T` output-only in `parse`), `Refine[T, U]` is contravariant in `T` (input to `apply`) and covariant in `U` (output), and `Store[T]` is invariant (`put` consumes, `get` produces `T` — fixing both positions). `Literal[0]` on `Soft.sev` and `Literal[1]` on `Hard.sev` fix severity at definition time — `case Soft(sev=0)` is a type-narrowing match, not a runtime comparison. `recover` eliminates `Soft` from `Fault[T]`, contracting the post-recovery error space to `Hard[T]` at the type level.

```python
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, Protocol, assert_never

from expression import Error, Ok, Result, effect

type Arrow[A, B, E] = Callable[[A], Result[B, E]]

@dataclass(frozen=True, slots=True, kw_only=True)
class Soft:
    raw: bytes; offset: int; sev: Literal[0] = 0

@dataclass(frozen=True, slots=True, kw_only=True)
class Hard[T]:
    origin: T; stage: str; metric: float; sev: Literal[1] = 1

type Fault[T] = Soft | Hard[T]

class Decode[T](Protocol):
    def parse(self, raw: bytes) -> Result[T, Soft]: ...

class Refine[T, U](Protocol):
    def apply(self, val: T) -> Result[U, Hard[T]]: ...

class Store[T](Protocol):
    def put(self, key: str, val: T) -> Result[None, Hard[T]]: ...
    def get(self, key: str) -> Result[T, Soft]: ...

def compose[A, B, C, E, F](f: Arrow[A, B, E], g: Arrow[B, C, F]) -> Arrow[A, C, E | F]:
    return lambda a: f(a).bind(g)

def recover[T](fault: Fault[T], fb: T) -> Result[T, Hard[T]]:
    match fault:
        case Soft(sev=0): return Ok(fb)
        case Hard(sev=1) as h: return Error(h)
        case _ as u: assert_never(u)

@effect.result[float, Fault[str]]()
def ingest(dec: Decode[str], xf: Refine[str, float], store: Store[float], raw: bytes, fb: str, key: str):
    parsed: str = yield from dec.parse(raw).or_else_with(lambda e: recover(e, fb))
    refined: float = yield from xf.apply(parsed)
    yield from store.put(key, refined)
    return refined
```

`Arrow[A, B, E]` is the Kleisli category for `Result` — `compose` threads `E | F` union accumulation through `bind`, and `recover` is an arrow from `Fault[T]` to `Result[T, Hard[T]]` that eliminates `Soft` by `Literal` discriminant match. The `@effect.result` generator subsumes Kleisli ceremony: `parsed` binds from `dec.parse(raw).or_else_with(...)` where `or_else_with` applies recovery only on `Error`; subsequent `yield from xf.apply(parsed)` freely references `parsed` — the cross-step dependency `compose` cannot express because intermediate values are trapped in arrow return types. Error type parameterization tracks provenance: `Refine[T, U]` returns `Hard[T]` (not `Hard[U]`), preserving pre-refinement input for upstream retry context, while `Soft` carries `raw: bytes` (original wire payload). Adding a third severity level without a match arm triggers `assert_never` — exhaustive dispatch is structural, not policy-based.

---

## Reader-Threaded Capability Composition

`@curry_flip(1)` on `ask` makes `ask(Sensor)` structurally isomorphic to the Reader monad — a suspended computation `Scope -> Result[C, Missing[C]]` — without declaring a `Reader` type alias, since `yield from` inside `@effect.result` generators subsumes sequential Reader composition and `reader_bind` becomes superfluous. `scoped` maps to Reader's `local`: `copy_context().run` forks the `ContextVar` snapshot, and `block.fold(lambda s, c: s.add(type(c), c), _scope.get())` performs polymorphic capability registration by runtime type projection, eliminating `singledispatch` and explicit registry maps.

```python
from collections.abc import Callable
from contextvars import ContextVar, copy_context
from dataclasses import dataclass
from typing import Final, Protocol, runtime_checkable

from expression import Result, curry_flip, effect, pipe
from expression.collections import Map, block

type Scope = Map[type, object]
_scope: Final[ContextVar[Scope]] = ContextVar("_scope", default=Map.empty())

@dataclass(frozen=True, slots=True)
class Missing[C]:
    capability: type[C]

@runtime_checkable
class Sensor(Protocol):
    def sample(self, ch: int) -> Result[float, str]: ...

@curry_flip(1)
def ask[C](cap: type[C], scope: Scope) -> Result[C, Missing[C]]:
    return scope.try_find(cap).to_result(Missing(cap))

@curry_flip(1)
def scoped[T](caps: tuple[object, ...], thunk: Callable[[], T]) -> T:
    return copy_context().run(lambda: (
        _scope.set(pipe(block.of_seq(caps), block.fold(
            lambda s, c: s.add(type(c), c), _scope.get()))),
        thunk())[1])

@effect.result[float, Missing[Sensor] | str]()
def acquire(channel: int):
    sensor: Sensor = yield from ask(Sensor)(_scope.get())
    return (yield from sensor.sample(channel))
```

`ask(Sensor)` returns `Callable[[Scope], Result[Sensor, Missing[Sensor]]]` — the partially applied function IS the Reader value, produced by `curry_flip(1)` flipping the scope parameter to data position. `reader_bind` is eliminated entirely: inside the `@effect.result` generator, `yield from ask(Sensor)(_scope.get())` performs monadic bind through the generator protocol, and chaining two `yield from` calls composes Readers sequentially with cross-step references as local variables rather than witness data. `scoped(caps)` returns `Callable[[Callable[[], T]], T]` — a pipeable context injector that forks `ContextVar` snapshot via `copy_context().run`, walrus-assigns the built scope inside the tuple expression, and returns `thunk()` at index `[1]` — capability mutations within the forked context are invisible to sibling tasks without explicit scope threading via `Concatenate`. `block.fold(lambda s, c: s.add(type(c), c), ...)` replaces `singledispatch` registration, explicit dispatch tables, and decorator-based registries with a single fold that projects runtime type as the `Map` key.

---

## Conformance Algebra with TypeIs Narrowing

Runtime conformance checking bridges static Protocol contracts with dynamic adapter verification — `narrows` with `TypeIs[C]` (PEP 742) encodes both structural and semantic requirements as a single predicate with complement narrowing in both branches, nested inside `conform` because the semantic predicate varies per call site. The fold visits tiers in descending strength order, short-circuiting via `or_else_with` on first match — `Block` ordering IS the lattice structure with zero comparator overhead.

```python
from dataclasses import dataclass
from typing import Callable, Literal, NewType, TypeIs

from expression import Error, Ok, Result, pipe
from expression.collections import Block, block

Attestation = NewType("Attestation", str)
type Tier = Literal["primary", "secondary", "fallback"]
type Rejection[C] = tuple[type[C], type, Tier]

@dataclass(frozen=True, slots=True)
class Certified[C]:
    inner: C; attestation: Attestation; tier: Tier

def conform[C](
    obj: object, lattice: Block[tuple[Tier, type[C]]],
    pred: Callable[[C], bool], attest: Attestation,
) -> Result[Certified[C], Rejection[C]]:
    match lattice.head().to_list():
        case []: raise ValueError("conform requires non-empty lattice; no capability tiers defined")
        case _: pass
    def narrows(candidate: object, cap: type[C]) -> TypeIs[C]:
        return isinstance(candidate, cap) and pred(candidate)
    gate = lambda tc: Ok(Certified(obj, attest, tc[0])).filter_with(
        lambda _: narrows(obj, tc[1]), lambda _: (tc[1], type(obj), tc[0]))
    head = lattice.head().value  # safe: non-empty guard above
    return pipe(lattice, block.fold(
        lambda acc, tc: acc.or_else_with(lambda _: gate(tc)),
        Error((head[1], type(obj), head[0]))))
```

`narrows` is nested because `TypeIs[C]` requires a named function with return annotation — lambdas cannot carry `TypeIs` — yet the semantic predicate `pred` closes over `conform`'s scope, making module-level placement impossible without partial application ceremony. `gate` speculatively constructs `Certified(obj, attest, tc[0])` inside `Ok`, then `filter_with` validates through `narrows` — PEP 742 complement narrowing means the negative path provably excludes `C`, a guarantee `TypeGuard` cannot provide. `block.fold` with `or_else_with` implements the conformance lattice as a short-circuiting join: `or_else_with` evaluates `gate(tc)` only when the accumulator holds `Error`, so the first successful tier becomes the supremum and all weaker tiers are skipped. `Rejection[C]` as a tuple alias eliminates a dedicated error dataclass while preserving structured context — the triple `(expected_cap, actual_type, tier)` suffices for both pattern matching and diagnostics.

---

## Async Fan-Out and Recursive Retry Composition

`dispatch` unifies retry and fan-out as a single polymorphic entry point — a `Block` of one arrow is a retried unit, a `Block` of N is parallel fan-out with per-arrow retry. Inner `_k` is a recursive Kleisli arrow: `move_on_after(budget - w)` scopes both semaphore acquisition and `fn()` execution so contended backpressure correctly consumes budget, and the cancellation sentinel `r: Result | None` absorbs scope expiration into the four-arm `match` without boolean flags.

```python
from collections.abc import Callable, Coroutine
from dataclasses import dataclass

import anyio
from anyio import Semaphore, create_memory_object_stream, create_task_group, move_on_after
from expression import Error, Ok, Option, Result, pipe
from expression.collections import Block, block

@dataclass(frozen=True, slots=True)
class Timeout: elapsed: float; budget: float

@dataclass(frozen=True, slots=True)
class Exhausted[E]: remaining: int; last: E

type Fault[E] = Timeout | Exhausted[E]
type Task[T, E] = Callable[[], Coroutine[None, None, Result[T, E]]]

async def dispatch[T, E](
    arrows: Block[Task[T, E]], sem: Semaphore,
    budget: float, retries: int, pred: Callable[[E], bool],
) -> Result[Block[T], Block[Fault[E]]]:
    async def _k(fn: Task[T, E]) -> Result[T, Fault[E]]:
        n, d, w = retries, 0.1, 0.0
        phi = (1 + 5 ** 0.5) / 2
        while True:
            r: Result[T, E] | None = None
            with move_on_after(budget - w):
                async with sem: r = await fn()
            match r:
                case None: return Error(Timeout(w, budget))
                case Ok() as ok: return ok
                case Error(e) if n <= 0 or not pred(e): return Error(Exhausted(n, e))
                case _:
                    await anyio.sleep(d)
                    w += d
                    d *= phi
                    n -= 1
    tx, rx = create_memory_object_stream[Result[T, Fault[E]]](arrows.length)
    async def _emit(f: Task[T, E]) -> None: await tx.send(await _k(f))
    async with create_task_group() as tg: pipe(arrows, block.fold(lambda _, f: tg.start_soon(_emit, f), None))
    await tx.aclose()
    rs = block.of_seq(map(lambda _: rx.receive_nowait(), range(arrows.length)))
    oks, errs = pipe(rs, block.choose(Result.to_option)), pipe(rs, block.choose(lambda r: r.swap().to_option()))
    return Option.Some(errs).filter(lambda b: b.length > 0).to_result(oks).swap()
```

The recursive tail call scales delay by $(1 + \sqrt{5})/2$ — irrational spacing prevents harmonic resonance with power-of-two rate limiters — while `w + d` accumulates elapsed time as recursion state. `match r` discriminates a three-constructor variant space (`None | Ok | Error`): `None` absorbs cancellation into `Timeout`, `Ok` short-circuits success, guarded `Error` partitions retriable failures via `pred` from exhausted ones via `n <= 0`. `block.fold(lambda _, f: tg.start_soon(_emit, f), None)` drives task registration as a void fold; memory stream sized to arrow count collects via `receive_nowait` after `TaskGroup` exit guarantees all sends complete. `Option.Some(errs).filter(lambda b: b.length > 0).to_result(oks).swap()` inverts rail polarity without conditional logic — empty errors yields `Ok(oks)`, non-empty yields `Error(errs)`.

---

## Version-Gated Protocol Surfaces

Version negotiation reifies compatibility as a three-stage Kleisli chain: `routes.try_find(v).to_result(...)` verifies version support, `sunsets.try_find(method).map(...)` gates deprecation, and `.bind(adapter_call)` dispatches — the entire version-support-deprecation-dispatch pipeline threads through `Result.bind` with zero conditional branching. `M: StrEnum` makes deprecation keys type-safe: `Method.fetch` is a compile error where `"fecth"` silently misses.

```python
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from functools import wraps
from operator import itemgetter
from typing import Literal, Protocol, runtime_checkable

from expression import Ok, Result, pipe
from expression.collections import Map, Seq, block, seq

type Ver = Literal[1, 2, 3]

@runtime_checkable
class Versioned(Protocol):
    @property
    def version(self) -> Ver: ...

@dataclass(frozen=True, slots=True)
class Unsupported: offered: Ver; known: tuple[Ver, ...]

@dataclass(frozen=True, slots=True)
class Sunsetted[M]: method: M; since: Ver; removal: Ver

type Skew[M] = Unsupported | Sunsetted[M]

def gate[M: StrEnum, **P, T, E](
    routes: Map[Ver, Callable[P, Result[T, E]]], sunsets: Map[M, tuple[Ver, Ver]], method: M,
) -> Callable[[Callable[P, Result[T, E]]], Callable[P, Result[T, E | Skew[M]]]]:
    known = tuple(pipe(routes.to_seq(), seq.map(itemgetter(0))))
    match known:
        case (): raise ValueError("gate requires non-empty routes; cannot determine default version")
        case (default, *_): pass
    def dec(fn: Callable[P, Result[T, E]]) -> Callable[P, Result[T, E | Skew[M]]]:
        @wraps(fn)
        def guarded(*args: P.args, **kw: P.kwargs) -> Result[T, E | Skew[M]]:
            v = pipe(block.of_seq(args), block.try_find(lambda a: isinstance(a, Versioned)),
                lambda opt: opt.map(lambda a: a.version).default_value(default))
            return (routes.try_find(v).to_result(Unsupported(v, known))
                .bind(lambda adapter: sunsets.try_find(method).map(
                    lambda sr: Ok(adapter).filter_with(lambda _: v < sr[0], lambda _: Sunsetted(method, sr[0], sr[1]))
                ).default_value(Ok(adapter)))
                .bind(lambda adapter: adapter(*args, **kw)))
        return guarded
    return dec
```

`routes: Map[Ver, Callable]` provides O(log N) keyed lookup where `Literal[1, 2, 3]` constrains the vocabulary at the type level — adding a version extends the `Map` without `@singledispatch` ceremony, making this the categorical dual of open extension: closed versions, open implementations per version. `block.try_find(lambda a: isinstance(a, Versioned))` extracts the versioned adapter from positional args as `Option[Versioned]`, defaulting to the first known version for unversioned call sites. The deprecation gate `sunsets.try_find(method).map(lambda sr: Ok(adapter).filter_with(...)).default_value(Ok(adapter))` is a three-layer monad transformation: `Option.map` lifts `Option[tuple]` into `Option[Result]`, `.default_value` discharges the `Option` (no sunset entry -> `Ok`), and `filter_with` inside the map provides the threshold gate `v < sr[0]` — the adapter closure capture threads through all three layers without intermediate bindings.

---

## Rules

- **Capability Slicing**: One capability per protocol, compose via intersection inheritance; `@tagged_union` for file-internal error variants with `@property` discriminant routing; `NewType` for opaque scalars (`Token`, `Attestation`).
- **Variance**: PEP 695 inference from method positions (output-only = covariant, input-only = contravariant, both = invariant); `Literal` fields fix severity at definition time for type-narrowing `match/case`; `Arrow[A, B, E]` threads `E | F` through `compose.bind`.
- **Reader DI**: `curry_flip(1)` on `ask` IS the Reader constructor; `@effect.result` generators subsume `reader_bind`; `copy_context().run` in `scoped` forks `ContextVar` preventing capability leakage across tasks.
- **Conformance**: `TypeIs[C]` with nested `narrows` for semantic narrowing beyond `isinstance`; `block.fold` + `or_else_with` implements lattice join with short-circuit on first conformance; `Certified[C]` carries attestation + tier provenance.
- **Async**: `dispatch` unifies retry and fan-out; recursive `_k` with $\varphi$-scaled delay and accumulated elapsed time; `match r: Result | None` discriminates cancellation as sum-type member; `Option.Some(errs).filter(...).to_result(oks).swap()` inverts rail polarity.
- **Versioning**: `Map[Ver, Callable]` replaces `singledispatch` with closed-world keyed dispatch; `M: StrEnum` for type-safe deprecation keys; three-stage `try_find.to_result.bind` Kleisli chain threads version support, deprecation, and dispatch.
