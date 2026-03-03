# Transforms

Compositional logic substrate for Python 3.14+. Every code body across all reference files is written in this style — transforms.md defines what "algorithmic, functional, AOP-driven code" means at the logic level. All snippets assume expression v5.6+ with `Result`, `@effect.result`, `pipe`, `Block`, `Map`, `Seq`.

---

## Discriminant Projection

Without projection to a uniform `Transform` signature, composing match-arm transforms with `@register` extensions requires branching on provenance — `block.fold` becomes structurally impossible. Projection targets `Callable` returning `Result` because domain invariants make failure structural.

```python
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from functools import singledispatch
from typing import assert_never

from expression import Ok, Result, curry_flip, pipe
from expression.collections import Block, block

type Stage = Amplify | Gate | Compress | Saturate
type Rejection[S] = tuple[Stage, S]
type Transform[S] = Callable[[S], Result[S, Rejection[S]]]

@dataclass(frozen=True, slots=True)
class Amplify:
    gain: Decimal

@dataclass(frozen=True, slots=True)
class Gate:
    threshold: Decimal

@dataclass(frozen=True, slots=True)
class Compress:
    ratio: Decimal; knee: Decimal

@dataclass(frozen=True, slots=True)
class Saturate:
    ceiling: Decimal

@singledispatch
def project(_: object) -> Transform[Decimal]:
    raise TypeError

@project.register
def _(stage: Amplify | Gate | Compress | Saturate) -> Transform[Decimal]:
    match stage:
        case Amplify(gain=g):
            return lambda level: Ok(level * g)
        case Gate(threshold=floor):
            return lambda level: Ok(level).filter_with(lambda s: s >= floor, lambda s: (stage, s))
        case Compress(ratio=r, knee=k):
            return lambda level: Ok(min(level, k) + max(level - k, 0) / r)
        case Saturate(ceiling=c):
            return lambda level: Ok(min(level, c))
        case _ as unreachable:
            assert_never(unreachable)

@curry_flip(1)
def apply_chain(stages: Block[Stage], level: Decimal) -> Result[Decimal, Rejection[Decimal]]:
    return pipe(stages, block.fold(lambda acc, s: acc.bind(project(s)), Ok(level)))
```

`Rejection[S]` reuses the failing stage as error context, eliminating parallel hierarchy. Adding a `Stage` variant without a match arm fails at type-check. `@curry_flip(1)` defers the signal parameter, making `apply_chain(stages)` pipeable.

---

## Monoidal Accumulation

Sequential accumulation reveals within-stream statistics. When data arrives partitioned, the question shifts: do partitions share a distribution? Chan/Pebay's merge propagates variance through kurtosis — the delta-correction at each moment order IS a component of one-way ANOVA decomposition, and carrying `between` as a field turns the monoid into a heterogeneity detector where η² emerges from the same computation that corrects the variance.

```python
from bisect import bisect_right
from dataclasses import dataclass
from math import fma, sqrt, sumprod
from operator import itemgetter
from typing import Annotated, ClassVar, Final, Literal

from expression import Option, pipe
from expression.collections import Seq, seq

type Regime = Literal["stable", "drift", "stress"]
type Emission = tuple[float, Annotated[float, "z"], Regime]

@dataclass(frozen=True, slots=True, kw_only=True)
class Stats:
    _T: ClassVar[Final[tuple[float, ...]]] = (1.0, 2.0)
    _R: ClassVar[Final[tuple[Regime, ...]]] = ("stable", "drift", "stress")
    n: int = 0; mean: float = 0.0; m2: float = 0.0; m3: float = 0.0; m4: float = 0.0; between: float = 0.0

    @staticmethod
    def classify(z: float) -> Regime:
        return Stats._R[bisect_right(Stats._T, z)]

def merge(a: Stats, b: Stats) -> Stats:
    n, d = a.n + b.n, b.mean - a.mean
    return Option.Some(n).filter(bool).map(lambda n: (c := d * d * a.n * b.n / n, Stats(
        n=n, mean=sumprod([a.n, b.n], [a.mean, b.mean]) / n, m2=a.m2 + b.m2 + c,
        m3=a.m3 + b.m3 + fma(c * d, (a.n - b.n) / n, 3 * d * (a.n * b.m2 - b.n * a.m2) / n),
        m4=a.m4 + b.m4 + fma(c * d * d, fma(a.n / n, a.n / n - b.n / n, (b.n / n) ** 2),
            6 * d * d * (a.n ** 2 * b.m2 + b.n ** 2 * a.m2) / (n * n) + 4 * d * (a.n * b.m3 - b.n * a.m3) / n),
        between=a.between + b.between + c))[1]).default_value(Stats())

def step(s: Stats, x: float) -> tuple[Stats, Emission]:
    std = Option.Some(s.n).filter(lambda c: c > 1).map(lambda c: sqrt(s.m2 / (c - 1))).default_value(0.0)
    z = Option.Some(std).filter(bool).map(lambda v: abs(x - s.mean) / v).default_value(0.0)
    n, d = s.n + 1, x - s.mean
    d_n, inv_n = d / n, 1.0 / n
    term1 = d * (d - d_n)
    m3 = s.m3 + fma(d * term1, (n - 2) * inv_n, -3 * s.m2 * d_n)
    m4 = s.m4 + fma(d * d * term1, fma(fma(3.0, inv_n, -3.0), inv_n, 1.0), fma(6 * s.m2, d_n * d_n, -4 * s.m3 * d_n))
    return Stats(n=n, mean=s.mean + d_n, m2=s.m2 + term1, m3=m3, m4=m4, between=s.between), (x, z, Stats.classify(z))

def analyze(batches: Seq[Seq[float]]) -> tuple[Seq[Emission], Stats]:
    scored = Seq(pipe(
        batches.concat(), seq.scan(lambda sb, x: step(sb[0], x), (Stats(), (0.0, 0.0, "stable"))),
        seq.skip(1), seq.map(itemgetter(1))))
    combined = pipe(
        batches, seq.map(seq.fold(lambda s, x: step(s, x)[0], Stats())),
        seq.fold(merge, Stats()))
    return scored, combined
```

`merge` is associative with `Stats()` as identity — `Option.Some(n).filter(bool)` guards 0/0 while the walrus `c :=` binds the cross term for reuse in m2 and between; `sumprod` computes the weighted mean as extended-precision dot product. M3 merge carries the cross-M2 term `3δ(nA·M2_B − nB·M2_A)/n`; M4 adds corrections at O(δ²·M2) and O(δ·M3) — all cross-moment terms vanish when nB=1, collapsing the Welford step to pure δ-power corrections against `term1` and `d_n`. `step` scores against the PRIOR distribution; Welford update order remains load-bearing: `d` before mean, `d − d_n` after — non-negative product keeps m2 monotonic. `between` stays zero during scan; η² = between/m2 is populated ONLY through merge, making monoidal combination structurally necessary for heterogeneity detection — within-group SS is `m2 − between` by algebraic invariant, not a field. The two paths in `analyze` agree by monoid homomorphism: fold-then-merge produces the same `Stats` as fold over the concatenation — associativity is the gate, excluding EMA and exact median while admitting higher moments and reservoir sampling.

---

## Keyed Composition

Default-value joins erase the boundary between contribution and silence — no downstream computation can recover the distinction. Absence must be a type-level signal, not a default value; the vocabulary tuple defines totality, so every missing member is a gap, not a missing key. Pre-sorted preconditions are inexpressible in the type system — misordered input silently corrupts alignment.

```python
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from enum import StrEnum, auto
from heapq import merge as heap_merge
from itertools import groupby
from operator import attrgetter
from statistics import fmean

from expression import Option, Result, pipe
from expression.collections import Map, seq

class Zone(StrEnum):
    north = auto()
    south = auto()
    east = auto()

type Blackout = tuple[int, tuple[Zone, ...]]
type Fused = tuple[float, int, tuple[Zone, ...]]

@dataclass(frozen=True, slots=True)
class Reading:
    epoch: int; zone: Zone; load: float

def fuse(epoch: int, cov: Map[Zone, float]) -> Result[Fused, Blackout]:
    return Option.Some(tuple(pipe(Zone, seq.choose(cov.try_find)))).filter(bool).map(lambda vs: (fmean(vs), len(vs), tuple(pipe(Zone, seq.filter(lambda z: z not in cov))))).to_result((epoch, tuple(Zone)))

def align[K, S, V, W, R](
    *feeds: Iterable[V],
    key: Callable[[V], K],
    entry: Callable[[V], tuple[S, W]],
    reducer: Callable[[K, Map[S, W]], R],
    coalesce: Callable[[W, W], W] | None = None,
) -> Iterable[tuple[K, R]]:
    policy: Callable[[W, W], W] = coalesce or (lambda _, n: n)
    merge = lambda pairs: pipe(pairs, seq.fold(lambda m, kv: m.add(kv[0], m.try_find(kv[0]).map(lambda old: policy(old, kv[1])).default_value(kv[1])), Map.empty()))
    return pipe(groupby(heap_merge(*feeds, key=key), key=key), seq.map(lambda kv: (kv[0], reducer(kv[0], merge(pipe(kv[1], seq.map(entry)))))))

def monitor(*feeds: Iterable[Reading]) -> Iterable[tuple[int, Result[Fused, Blackout]]]:
    return align(*feeds, key=attrgetter("epoch"), entry=attrgetter("zone", "load"), reducer=fuse)
```

`seq.choose(cov.try_find)` is point-free: `try_find` IS the chooser signature (`Zone → Option[float]`). `entry: Callable[[V], tuple[S, W]]` produces the shape Map construction consumes. `policy = coalesce or LWW` totalizes merge, eliminating branches. `heapq.merge` stability guarantees deterministic feed interleaving — non-stable merge makes results non-reproducible.

---

## Structural Polymorphism

Protocol's structural contract guarantees `.measure() → float` without distinguishing celsius from hectopascals — folding raw readings from incommensurable sensors produces physically meaningless averages unless each type carries calibration constants that Protocol cannot express. Scale factors and chi-squared gate thresholds are type-level invariants — identical for every sensor of that type — making them functions of `type(self)` rather than `self`, which `singledispatch` dispatches on exactly. `@beartype` at the composition boundary catches untyped callers that bypass pyright, because Protocol bounds are erased at runtime unlike union discriminants in prior sections.

```python
from dataclasses import dataclass
from functools import singledispatch
from math import fma
from typing import Protocol, runtime_checkable

from beartype import beartype
from expression import Option, Result, curry_flip, pipe
from expression.collections import Seq, seq

type Failure[T] = tuple[T, float, int]

@runtime_checkable
class Fusible(Protocol):
    def measure(self) -> float: ...
    def confidence(self) -> float: ...

@dataclass(frozen=True, slots=True)
class Thermometer:
    celsius: float; precision: float
    def measure(self) -> float: return self.celsius
    def confidence(self) -> float: return self.precision

@dataclass(frozen=True, slots=True)
class Barometer:
    hpa: float; precision: float
    def measure(self) -> float: return self.hpa
    def confidence(self) -> float: return self.precision

@singledispatch
def calibrate(_: object) -> tuple[float, float]:
    raise TypeError

@calibrate.register
def _(s: Thermometer) -> tuple[float, float]: return (s.measure() / 100.0, 6.635)

@calibrate.register
def _(s: Barometer) -> tuple[float, float]: return (s.measure() / 1013.25, 3.841)

@beartype
@curry_flip(1)
def fuse[T: Fusible](ref: T, sensors: Seq[T]) -> Result[tuple[float, float], Failure[T]]:
    nref = calibrate(ref)[0]
    return pipe(
        sensors,
        seq.fold(lambda acc, s: ((cal := calibrate(s), p := s.confidence()),
            Option.Some(cal[0]).filter(lambda nv: (nv - nref) ** 2 * p < cal[1]).map(
                lambda nv: (fma(nv, p, acc[0]), acc[1] + p, acc[2])
            ).default_value((acc[0], acc[1], acc[2] + 1))
        )[1], (0.0, 0.0, 0)),
        lambda ws: Option.Some(ws).filter(lambda t: t[1] > 0).map(
            lambda t: (t[0] / t[1], 1.0 / t[1])).to_result((ref, nref, ws[2])))
```

`@runtime_checkable` enables beartype's `isinstance` delegation (attribute existence only); one Protocol consolidates both axes since no function uses either independently. Protocol registration with singledispatch silently falls through (MRO walk) — register concrete types; chi-squared critical values are type-level: 6.635 = 99%, 3.841 = 95%, df=1. Precision is triple-use: Mahalanobis gate scaler, `fma(nv, p, acc[0])` fusion weight, and `1/acc[1]` output variance — the information-filter accumulates `Σ(xᵢ/σᵢ²)` and `Σ(1/σᵢ²)` as natural parameters, finalize converts to moment parameters `(estimate, variance)`. Precision additivity makes the accumulator a commutative monoid with identity `(0, 0)`, guarded at extraction by `Option.filter(lambda t: t[1] > 0)`.

---

## Monadic Composition

`pipeline()` erases cross-step references — each stage sees only its predecessor's `Ok` value, so an update that needs both predicted state and raw observation is structurally inexpressible. `yield from` recovers those references through intermediate bindings, but each bind site is a `map_error` boundary where stage diagnostics must wrap with captured intermediates into the unified channel — ceremony scaling linearly with depth. Error variants that carry intermediate state through the wrapping make recovery self-contained at the `.or_else_with` call site — the captured context is all the recovery function receives.

```python
from dataclasses import dataclass
from math import fma
from typing import assert_never

from expression import Error, Ok, Result, effect

@dataclass(frozen=True, slots=True)
class State:
    x: float; p: float

@dataclass(frozen=True, slots=True)
class Diverged:
    variance: float; prior: State

@dataclass(frozen=True, slots=True)
class Rejected:
    nis: float; predicted: State

type Fault = Diverged | Rejected

def predict(f: float, q: float, s: State) -> Result[State, float]:
    return Ok(State(x=f * s.x, p=fma(f * f, s.p, q))).filter_with(
        lambda r: r.p > 0, lambda r: r.p)

def update(h: float, r: float, chi2: float, pred: State, z: float) -> Result[State, float]:
    y, S = z - h * pred.x, fma(h * h, pred.p, r)
    K, nis = pred.p * h / S, y * y / S
    return Ok(State(x=fma(K, y, pred.x), p=(1 - K * h) * pred.p)).filter_with(
        lambda _: nis < chi2, lambda _: nis)

@effect.result[State, Fault]()
def step(f: float, q: float, h: float, r: float, chi2: float, prior: State, z: float):
    pred = yield from predict(f, q, prior).map_error(lambda v: Diverged(v, prior))
    return (yield from update(h, r, chi2, pred, z).map_error(lambda n: Rejected(n, pred)))

def recover(err: Fault) -> Result[State, Fault]:
    match err:
        case Diverged(prior=s): return Ok(State(x=s.x, p=max(s.p, 1e-6) * 100))
        case Rejected() as e: return Error(e)
        case _ as unreachable: assert_never(unreachable)
```

Recovery is structurally impossible inside the generator — `EffectError` is `Builder`-internal, forcing `.or_else_with(recover)` at the call site. `y` is dual-use: state correction via `fma(K, y, pred.x)` and NIS numerator `y * y / S`; `S` is triple-use — gain denominator, NIS denominator, and innovation variance. `map_error(lambda v: Diverged(v, prior))` closes over `prior` from the generator scope — non-static capture is irreducible because `prior` is the generator's parameter. `predict` gates `p > 0` — covariance positivity structurally guarantees `update`'s divisions operate on non-degenerate quantities through the generator's short-circuit. `Diverged` destructures for inflated-covariance reset; `Rejected` propagates because no safe correction exists for a gain-innovation combination that violated the NIS gate.

---

## Decorator Algebra

Concatenate carries per-concern configuration type-safely but mutates the function signature at each wrapping layer — the fold accumulator type changes between steps, making compositional stacking inexpressible. Closing over concern coefficients at decoration time preserves `[**P, T, E]` invariantly — fold sees identical signatures at every step. Govern subsumes throttle, circuit breaker, and hybrid through continuous coefficient space — a single multiply-add interpolates behaviors via field values, not type dispatch.

```python
from collections.abc import Callable
from contextvars import ContextVar
from dataclasses import dataclass
from functools import wraps
from time import monotonic, sleep
from typing import assert_never

from expression import Ok, Result, curry_flip, pipe
from expression.collections import Block, Map, block, seq

@dataclass(frozen=True, slots=True)
class Retry:
    limit: int; backoff: float

@dataclass(frozen=True, slots=True)
class Govern:
    capacity: float; rate: float; cost: float; penalty: float

type Concern = Retry | Govern

@dataclass(frozen=True, slots=True)
class Resource:
    tokens: float; epoch: float

@dataclass(frozen=True, slots=True)
class Breach[E]:
    concern: Concern; snapshot: Resource; cause: E | None = None

_pool: ContextVar[Map[int, Resource]] = ContextVar("_pool", default=Map.empty())

def _acquire(cid: int, rate: float, cap: float) -> Resource:
    now, pool = monotonic(), _pool.get()
    rsrc = pool.try_find(cid).map(
        lambda r: Resource(min(rate * (now - r.epoch) + r.tokens, cap), now)
    ).default_value(Resource(cap, now))
    _pool.set(pool.add(cid, rsrc))
    return rsrc

def with_concern[**P, T, E](concern: Concern, fn: Callable[P, Result[T, E]]) -> Callable[P, Result[T, E | Breach[E]]]:
    match concern:
        case Retry(limit=n, backoff=b):
            @wraps(fn)
            def retry(*args: P.args, **kwargs: P.kwargs) -> Result[T, E | Breach[E]]:
                return pipe(range(n), seq.fold(
                    lambda r, j: r.or_else_with(lambda _: (sleep(b ** (j + 1)), fn(*args, **kwargs))[1]),
                    fn(*args, **kwargs)
                )).map_error(lambda e: Breach(concern, Resource(0.0, monotonic()), e))
            return retry
        case Govern(capacity=cap, rate=rate, cost=cost, penalty=pen):
            @wraps(fn)
            def governed(*args: P.args, **kwargs: P.kwargs) -> Result[T, E | Breach[E]]:
                return Ok(_acquire(id(concern), rate, cap)).filter_with(lambda r: r.tokens > 0, lambda r: Breach(concern, r)).bind(
                    lambda s: ((res := fn(*args, **kwargs),
                        _pool.set(_pool.get().add(id(concern), Resource(s.tokens - res.map(lambda _: cost).default_value(pen + cost), s.epoch)))),
                        res.map_error(lambda e: Breach(concern, s, e)))[1])
            return governed
        case _ as unreachable:
            assert_never(unreachable)

@curry_flip(1)
def apply_concerns[**P, T, E](concerns: Block[Concern], fn: Callable[P, Result[T, E]]) -> Callable[P, Result[T, E | Breach[E]]]:
    return pipe(concerns, block.fold(lambda f, c: with_concern(c, f), fn))
```

`with_concern` matches outside the wrapper — concern fields bind at construction, not per-call. Retry Ok passthrough is O(1): fold visits all `n` but `or_else_with` skips the sleep-retry body. Govern's `filter_with` gate returns `Breach(concern, rsrc)` with `cause=None` — fn never called; `res.map(lambda _: cost).default_value(pen + cost)` computes deduction directly — Ok pays `cost`, Error pays `pen + cost`, coefficient space interpolates throttle/breaker/hybrid without branching. `block.fold` stacks left-to-right — first concern in Block = innermost wrapper.

---

## Rules

- Discriminant values (`@tagged_union` cases) project behavior — never branch over conditions when a closed domain exists.
- `@effect.result` generators are the primary composition medium — `yield from` IS Kleisli composition.
- `pipe` + curried module functions (`result.bind`, `seq.filter`) for linear transform chains.
- `.or_else_with(fn)` for error recovery at composition boundaries — never inside `@effect.result` generators.
- Protocol-typed parameters for dependency injection — the Protocol constraint IS the reader effect.
- `seq.scan` → `seq.map` for state/emission decoupling — state serves computation, emission serves consumption.
- Generator-as-unfold composed with `seq.fold` for hylomorphism — zero intermediate materialization.
- `heapq.merge` for N-source sorted keyed merge — O(N log K) alignment.
- `Option Nothing` for explicit absence in keyed merges — never sentinel values, never defaults.
- Protocol intersection class for multi-constraint generics — Python's only path to ad-hoc polymorphism.
- `ParamSpec` + `Concatenate` mandatory on all decorator signatures — zero `*args, **kwargs`.
- Concern discriminant (frozen dataclass + union) for decorator factories — one factory, N behaviors via match/case projection.
- `block.fold(with_concern, fn)` for algebraic decorator stack composition — Block order is application order (first = innermost).
- `contextvars` for cross-call state threading — zero mutable closure state.
- `tailrec` for stack-safe recursion — mandatory for recursive depths exceeding 1000 frames.
