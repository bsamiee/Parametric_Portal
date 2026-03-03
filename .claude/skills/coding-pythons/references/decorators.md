# Decorators

Decorator type algebra, stack ordering, context propagation, and AOP composition for Python 3.14+. This file is the canonical location for all decorator stack variant patterns — all other reference files delegate stack ordering and variant concerns here. All snippets assume expression v5.6+ with `Result`, `pipe`, `Block`, `Map`, `curry_flip`.

---

## Signature-Preserving Decorator Type Algebra

Decorators typed as `Callable[..., Any] → Callable[..., Any]` erase parameter variance — the checker sees opaque signatures after two stacks. `ParamSpec` with `Concatenate` (PEP 612) encodes context obligations in the callable's domain; `absorb` discharges via `ContextVar` resolution, projecting to `Hom[P, T, E | Fault[C, Ctx]]` with `**P` preserved. PEP 696 default `E = Never` on `Hom` is the identity of error-union accumulation: $\bot \cup F \equiv F$, so `stack` over $n$ layers produces $E \cup \bigcup_{i=1}^{n} F_i$ with no phantom channels.

```python
from collections.abc import Callable
from contextvars import ContextVar
from dataclasses import dataclass
from functools import wraps
from typing import Concatenate, Never

from expression import Result, curry_flip, pipe
from expression.collections import Block, block

@dataclass(frozen=True, slots=True)
class Fault[C, Ctx]:
    source: C; snapshot: Ctx; magnitude: float

type Hom[**P, T, E = Never] = Callable[P, Result[T, E]]

def absorb[Ctx, **P, T, E, C](
    ctx: ContextVar[Ctx], source: C, gate: Callable[[Ctx, C], Result[Ctx, Fault[C, Ctx]]],
    fn: Callable[Concatenate[Ctx, P], Result[T, E]],
) -> Hom[P, T, E | Fault[C, Ctx]]:
    @wraps(fn)
    def closed(*args: P.args, **kwargs: P.kwargs) -> Result[T, E | Fault[C, Ctx]]:
        return gate(ctx.get(), source).bind(lambda c: (ctx.set(c), fn(c, *args, **kwargs))[1])
    return closed

@curry_flip(1)
def stack[**P, T, E](layers: Block[Callable[[Hom[P, T, E]], Hom[P, T, E]]], fn: Hom[P, T, E]) -> Hom[P, T, E]:
    return pipe(layers, block.fold(lambda f, g: g(f), fn))
```

`Concatenate[Ctx, P]` declares context dependency structurally — `absorb` discharges via `ContextVar.get()` and `@wraps` propagates `__wrapped__`/`__type_params__` for `inspect.signature` chain traversal. `gate` returns `Result[Ctx, Fault[C, Ctx]]`: `C` identifies the faulting concern, `Ctx` snapshots state at failure, `magnitude` carries quantitative deviation. The `(ctx.set(c), fn(...))[1]` tuple sequences the side effect in expression position — left-to-right evaluation is language-guaranteed. Async callables requiring `Coroutine` return types: see Async Contracts section. Callable anchor governance: types.md.

---

## Stack Order Law and Approved Variants

Decorator order is semantically load-bearing — `@trace @retry fn` spans all attempts while `@retry @trace fn` traces each independently, yet both produce identical error-union types. `Slot(IntEnum)` assigns concerns a total order; `assemble` validates monotonicity in a single-pass fold, short-circuiting into `Inversion` at the first regression.

```python
from collections.abc import Callable
from dataclasses import dataclass
from enum import IntEnum, auto
from typing import Never

from expression import Ok, Result, curry_flip, pipe
from expression.collections import Block, block

class Slot(IntEnum):
    trace = 0; authorize = 1; validate = 2; cache = 3; govern = 4; retry = 5

@dataclass(frozen=True, slots=True)
class Inversion:
    outer: Slot; inner: Slot; depth: int

type Hom[**P, T, E = Never] = Callable[P, Result[T, E]]
type Layer[**P, T, E] = tuple[Slot, Callable[[Hom[P, T, E]], Hom[P, T, E]]]

@curry_flip(1)
def assemble[**P, T, E](layers: Block[Layer[P, T, E]], fn: Hom[P, T, E]) -> Result[Hom[P, T, E], Inversion]:
    return pipe(
        layers,
        block.fold(
            lambda acc, l: acc.bind(lambda st:
                Ok((l[0], st[1] + 1, l[1](st[2])))
                .filter_with(lambda _: l[0] >= st[0], lambda _: Inversion(st[0], l[0], st[1]))
            ),
            Ok((Slot(-1), 0, fn))
        )
    ).map(lambda st: st[2])
```

`Slot(-1)` seeds below all valid positions. The fold accumulates `(last_slot, depth, composed_fn)` — `depth` in `Inversion` localizes the violation for decoration-time diagnostics. `filter_with` gates $s_i \geq s_{i-1}$: shared slots are permitted (multiple validators at position 2), regressions short-circuit via `bind`. Approved variants constrain slot sets per operation class: queries `{trace, cache}`, commands `{trace, authorize, validate, retry}`, events `{trace, validate}`. Retry semantics: effects.md; boundary application: surface.md.

---

## ContextVar Propagation and Reversible Scope Ownership

`var.set(old)` reversal is a data race — concurrent `set` calls are silently overwritten when the restoring task writes a stale snapshot. `Token` from `ContextVar.set()` binds to the specific modification; `reset(token)` reverses that transition regardless of interleaving. `Map.add` returns a new persistent node, so scope transitions are whole-map replacements — partial-key leakage is structurally impossible.

```python
from collections.abc import Callable
from contextvars import ContextVar, Token, copy_context
from dataclasses import dataclass
from functools import wraps

from expression import Ok, Result, curry_flip, pipe
from expression.collections import Block, Map, block

type Scope = Map[str, float]

@dataclass(frozen=True, slots=True)
class Impulse:
    channel: str; magnitude: float

_propagation: ContextVar[Scope] = ContextVar("_propagation", default=Map.empty())

def scoped[S, **P, T, E, F](var: ContextVar[S], project: Callable[[S], Result[S, F]]) -> Callable[[Callable[P, Result[T, E]]], Callable[P, Result[T, E | F]]]:
    def decorator(fn: Callable[P, Result[T, E]]) -> Callable[P, Result[T, E | F]]:
        @wraps(fn)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> Result[T, E | F]:
            return project(var.get()).map(lambda s: var.set(s)).bind(lambda token: (res := fn(*args, **kwargs), var.reset(token), res)[2])
        return wrapper
    return decorator

def isolated[**P, T, E](fn: Callable[P, Result[T, E]]) -> Callable[P, Result[T, E]]:
    @wraps(fn)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> Result[T, E]:
        return copy_context().run(fn, *args, **kwargs)
    return wrapper

@curry_flip(1)
def apply_impulses[**P, T, E](impulses: Block[Impulse], fn: Callable[P, Result[T, E]]) -> Callable[P, Result[T, E]]:
    return pipe(impulses, block.fold(lambda f, imp: scoped(_propagation, lambda s: Ok(s.add(
        imp.channel, s.try_find(imp.channel).map(lambda v: v + imp.magnitude).default_value(imp.magnitude)
    )))(f), fn))
```

`project(var.get()).map(var.set).bind(...)` chains through the Result rail: failed projection produces no `Token`, propagating without scope corruption. `var.reset(token)` targets the operation — concurrent `set` calls are unaffected. `scoped[S, ...]` parameterizes over any `ContextVar[S]`, not just `Map`-backed scopes — `apply_impulses` specializes to `Scope` via the projection lambda. `block.fold` stacking $n$ impulses produces $n$ independently-reversible layers unwinding innermost-first. `isolated` via `copy_context().run` forks a snapshot for task boundaries; structured-concurrency scoping: concurrency.md.

---

## Idempotency, Double-Decoration Guards, and Introspection Parity

Double-decoration corrupts the codomain: `E | Breach[C] | Breach[C]` collapses at the type level while runtime doubles every interception — duplicate spans, duplicate token acquisitions, quadratic compounding under `block.fold`. Behavioral guards break under reimport and concurrent decoration; the guard keys on `id(dec)` stored in `frozenset[int]`.

```python
from collections.abc import Callable
from dataclasses import dataclass
from functools import wraps
from typing import Never

from expression import Ok, Result, pipe

type Wrapped[**P, T, E = Never] = Callable[P, Result[T, E]]

@dataclass(frozen=True, slots=True)
class Breach[C]:
    decorator_id: int; source: C

def once[**P, T, E, F](dec: Callable[[Wrapped[P, T, E]], Wrapped[P, T, E | F]]) -> Callable[[Wrapped[P, T, E]], Wrapped[P, T, E | F]]:
    tag = id(dec)
    @wraps(dec)
    def guard(fn: Wrapped[P, T, E]) -> Wrapped[P, T, E | F]:
        ids: frozenset[int] = getattr(fn, "_applied_ids", frozenset())
        return (
            Ok(fn)
            .filter_with(lambda _: tag not in ids, lambda _: Breach(tag, fn))
            .map(lambda f: pipe(dec(f), lambda w: (wraps(fn)(w), setattr(w, "_applied_ids", ids | {tag}), w)[-1]))
            .default_value(fn)
        )
    return guard
```

`id(dec)` is process-scoped and unique; `frozenset[int]` on the wrapper gives $O(1)$ membership testing, survives `copy.copy` via attribute propagation through `wraps`. `filter_with` mirrors the errors.md gate: tag-absent proceeds to `.map(dec)`, tag-present short-circuits through `Breach` into `.default_value(fn)` — idempotent passthrough with zero branching. Post-application `wraps(fn)` preserves `__wrapped__` for `inspect.unwrap` and `__type_params__` for PEP 695 generic bounds through the decoration chain.

---

## Rail-Safe Wrappers for Result, Option, and Effect Pipelines

Caching `Error` results crystallizes transient failures; exception-catching inside wrappers collapses the exception/error boundary. `Rail[T, E, F]` types the natural transformation: receives `Result`, returns `Result`, can widen `E` to `E | F`, structurally cannot collapse `Error` to `Ok`. `memoize_ok` caches only `Ok` values via persistent `Map`; `convolve` lifts any `Rail` into a decorator.

```python
from collections.abc import Callable, Hashable
from contextvars import ContextVar
from functools import wraps
from typing import Never

from expression import Ok, Result
from expression.collections import Map

type Hom[**P, T, E = Never] = Callable[P, Result[T, E]]
type Rail[T, E, F] = Callable[[Result[T, E]], Result[T, E | F]]

def memoize_ok[**P, T, E, K: Hashable](extract: Callable[..., K]) -> Callable[[Hom[P, T, E]], Hom[P, T, E]]:
    _store: ContextVar[Map[K, T]] = ContextVar("_memo", default=Map.empty())
    def decorator(fn: Hom[P, T, E]) -> Hom[P, T, E]:
        @wraps(fn)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> Result[T, E]:
            key = extract(*args, **kwargs)
            return _store.get().try_find(key).map(Ok).default_with(
                lambda: fn(*args, **kwargs).map(lambda v: (_store.set(_store.get().add(key, v)), v)[1])
            )
        return wrapper
    return decorator

def convolve[**P, T, E, F](transform: Rail[T, E, F]) -> Callable[[Hom[P, T, E]], Hom[P, T, E | F]]:
    def decorator(fn: Hom[P, T, E]) -> Hom[P, T, E | F]:
        @wraps(fn)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> Result[T, E | F]:
            return transform(fn(*args, **kwargs))
        return wrapper
    return decorator
```

`Rail[T, E, F]` makes codomain widening explicit — no pathway from `Result` back to bare `T`. `memoize_ok` stores in `ContextVar[Map[K, T]]`: persistent `Map` guarantees task isolation per the ContextVar section, `Option.map(Ok)` wraps hits, `.default_with` falls through on miss. `convolve` is the universal lifter: any `Rail` becomes a decorator with the same error-widening contract as `absorb`. Rail composition: effects.md; error construction: errors.md.

---

## Async Decorator Contracts: Cancellation, Deadlines, and Backpressure

Catching `Cancelled` converts structural cancellation into something the error rail never carried — termination, not recovery. `deadline` enforces wall-clock budget via `anyio.move_on_after`, translating scope cancellation into typed `Timeout`. `bounded_retry` uses $\varphi$-backoff ($\approx 1.618$ — irrational spacing prevents resonance at power-of-two doubling intervals) and gates on a retryability predicate — non-retryable errors propagate immediately.

```python
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from functools import wraps
from time import monotonic
from typing import Never

import anyio
from expression import Error, Ok, Result

type AsyncHom[**P, T, E = Never] = Callable[P, Coroutine[None, None, Result[T, E]]]

@dataclass(frozen=True, slots=True)
class Timeout:
    elapsed: float; budget: float

@dataclass(frozen=True, slots=True)
class Exhausted[E]:
    attempts: int; last: E; total_wait: float

def deadline[**P, T, E](budget: float) -> Callable[[AsyncHom[P, T, E]], AsyncHom[P, T, E | Timeout]]:
    def decorator(fn: AsyncHom[P, T, E]) -> AsyncHom[P, T, E | Timeout]:
        @wraps(fn)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> Result[T, E | Timeout]:
            t0 = monotonic()
            with anyio.move_on_after(budget):
                return await fn(*args, **kwargs)
            return Error(Timeout(monotonic() - t0, budget))
        return wrapper
    return decorator

def bounded_retry[**P, T, E](max_n: int, base: float, retryable: Callable[[E], bool]) -> Callable[[AsyncHom[P, T, E]], AsyncHom[P, T, E | Exhausted[E]]]:
    def decorator(fn: AsyncHom[P, T, E]) -> AsyncHom[P, T, E | Exhausted[E]]:
        @wraps(fn)  # BOUNDARY ADAPTER — structured retry requires imperative iteration
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> Result[T, E | Exhausted[E]]:
            err, delay, waited = None, base, 0.0
            for i in range(max_n):
                match await fn(*args, **kwargs):
                    case Ok() as ok: return ok
                    case Error(e) if retryable(e): err, delay, waited = e, delay * 1.618, waited + delay; await anyio.sleep(delay)
                    case Error(e): return Error(Exhausted(i + 1, e, waited))
            return Error(Exhausted(max_n, err, waited))
        return wrapper
    return decorator
```

`move_on_after` catches `Cancelled` internally and falls through to `Error(Timeout(...))` — the wrapper never intercepts the exception. Stacking `@deadline(5.0) @bounded_retry(3, 0.1, pred)` bounds total time including backoff; swapping order converts to per-attempt timeout — the stack order law determines interpretation. The `BOUNDARY ADAPTER` marker acknowledges imperative iteration: `anyio.sleep` is effectful and early exit on `Ok` requires short-circuit semantics `block.fold` cannot express. Task topology: concurrency.md.

---

## singledispatch Dispatch-Surface Propagation

`.register(type)(fn)` mutates an internal `MappingProxy` that `@wraps` does not transfer — `register`, `dispatch`, `registry` are absent from `WRAPPER_ASSIGNMENTS`. Policy decorators using only `@wraps` silently amputate the registration surface. `lift_dispatch` propagates dispatch attributes from the base — found via `unwrap` with a `registry`-detecting stop predicate — through unlimited decoration depth.

```python
from collections.abc import Callable
from functools import singledispatch, update_wrapper, wraps
from inspect import unwrap
from typing import Never

from expression import Result, pipe
from expression.collections import Block, block

type Hom[**P, T, E = Never] = Callable[P, Result[T, E]]

def lift_dispatch[**P, T, E](dec: Callable[[Hom[P, T, E]], Hom[P, T, E]]) -> Callable[[Hom[P, T, E]], Hom[P, T, E]]:
    @wraps(dec)
    def safe(fn: Hom[P, T, E]) -> Hom[P, T, E]:
        wrapped, base = dec(fn), unwrap(fn, stop=lambda f: hasattr(f, "registry"))
        return pipe(
            Block(("register", "dispatch", "registry")),
            block.fold(
                lambda w, a: (setattr(w, a, getattr(base, a)), w)[-1] if hasattr(base, a) else w,
                update_wrapper(wrapped, fn)
            )
        )
    return safe
```

`unwrap(fn, stop=lambda f: hasattr(f, 'registry'))` halts at the singledispatch base regardless of intermediate wrappers. `block.fold` conditionally transfers each attribute via `(setattr(...), w)[-1]`; `update_wrapper` seeds the accumulator with `__wrapped__`/`__module__`/`__qualname__`. For method-level dispatch, policy decorators must stay INSIDE `@singledispatchmethod` or implement `__get__` to preserve the descriptor protocol. Protocol contracts: protocols.md; callable governance: types.md.

---

## Rules

- `ParamSpec` + `Concatenate` + `@wraps` — every decorator must preserve parameter types, codomain widening must be explicit in the return type, and `__wrapped__` must enable `inspect.unwrap` traversal.
- Canonical stack order: `trace > authorize > validate > cache > govern > retry > operation` — reordering changes runtime semantics even when types are invariant; validate via `assemble` fold or equivalent monotonicity check.
- `ContextVar` scope reversal exclusively via `Token.reset()` — never `var.set(old_value)`; persistent `Map` values eliminate partial-key mutation under concurrency.
- Zero hidden `try`/`except` inside wrappers — exceptions propagate as exceptions, `Result` errors propagate as `Result` errors; collapsing the boundary is a rail-safety violation.
- Idempotency via structural identity (`id(dec)` + `frozenset` on wrapper) — behavioral guards (call counting, string markers) break under reimport and concurrent decoration.
- Async wrappers must never catch `Cancelled`/`CancelledError` — deadline enforcement via `CancelScope`, not exception interception.
- `singledispatch` registration surface (`register`, `dispatch`, `registry`) must propagate through every policy wrapper via `lift_dispatch` or equivalent — `@wraps` alone does not transfer these attributes.
