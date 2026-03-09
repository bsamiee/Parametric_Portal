# Types

Type authority for Python 3.14+. All snippets assume expression v5.6+ and PEP 695/696 type syntax.

---

## Type Features

PEP 695 `type` aliases (lazy-evaluated, no forward-reference quoting), PEP 696 defaults on type parameters, `Literal` vocabularies as compile-time value sets, `TypeIs` (PEP 742) for complement-narrowed predicates, and `@overload` for input-dependent return type narrowing — composed through `Result` rails and `@effect.result` generators to eliminate `if`/`else` dispatch entirely.

```python
from collections.abc import Callable
from dataclasses import dataclass
from math import fma, isfinite
from typing import Literal, NewType, TypeIs, assert_never, overload

from expression import Ok, Result, curry_flip, effect, pipe
from expression.collections import Block, block

Kelvin = NewType("Kelvin", float)
type Unit = Literal["C", "F", "K"]
type Rejection = tuple[Unit, float]
type Convert[A, B] = Callable[[float], Result[float, Rejection]]

@dataclass(frozen=True, slots=True)
class Measurement[U: Unit = "K"]:
    value: float; unit: U  # type: ignore[assignment]

def is_absolute(m: Measurement) -> TypeIs[Measurement["K"]]:
    return m.unit == "K" and m.value >= 0

@overload
def to_kelvin(m: Measurement["C"]) -> Result[Kelvin, Rejection]: ...
@overload
def to_kelvin(m: Measurement["F"]) -> Result[Kelvin, Rejection]: ...
def to_kelvin(m: Measurement) -> Result[Kelvin, Rejection]:
    match m.unit:
        case "C": k = m.value + 273.15
        case "F": k = fma(m.value - 32, 5 / 9, 273.15)
        case "K": k = m.value
        case _ as u: assert_never(u)
    return Ok(Kelvin(k)).filter_with(lambda v: v >= 0 and isfinite(v), lambda _: (m.unit, m.value))

@curry_flip(1)
def energy(readings: Block[Measurement], ref: Kelvin) -> Result[float, Rejection]:
    @effect.result[float, Rejection]()
    def _run():
        kelvins = yield from pipe(readings, block.map(to_kelvin), block.fold(
            lambda acc, r: acc.bind(lambda vs: r.map(lambda v: vs + block.of(v))), Ok(block.empty())))
        return pipe(kelvins, block.fold(lambda a, k: fma(k - ref, k - ref, a), 0.0)) / max(kelvins.length, 1)
    return _run()
```

PEP 695 `type` aliases evaluate lazily — `Convert[A, B]` and `Rejection` require no quoting for forward references, replacing legacy `TypeAlias`. PEP 696 default `U: Unit = "K"` on `Measurement` makes absolute scale the default; non-`"K"` construction requires explicit parameterization. `TypeIs` (PEP 742) narrows both branches: `is_absolute` returning `False` provably excludes `Measurement["K"]` in the negative path — `TypeGuard` cannot provide this complement guarantee. `@overload` stubs narrow `to_kelvin`'s return per `Literal` unit at call sites, eliminating runtime `isinstance` for consumers; the implementation uses exhaustive `match/case` with `assert_never` on the `Unit` vocabulary. `fma(m.value - 32, 5/9, 273.15)` fuses Fahrenheit conversion with extended precision; `filter_with` gates non-physical values (negative Kelvin, IEEE specials) into typed `Rejection` tuples. `@curry_flip(1)` defers `ref` to data position; inside `@effect.result`, `block.fold` with sequential `bind` accumulates converted `Kelvin` values, short-circuiting on first rejection — `fma(k - ref, k - ref, a)` then computes mean squared deviation single-pass.

## Type Family Governance

`Signal[P]` parameterized by `Literal` phantom tags eliminates parallel model definitions without sentinel class boilerplate. `Morph[A, B]` generalizes stage transitions as a composable callable morphism, `Rejection[P]` reuses the failing `Transition` as typed error context.

```python
from collections.abc import Callable
from dataclasses import dataclass
from math import fma, sqrt, tau
from typing import Literal, NewType, TypeIs, assert_never

from expression import Ok, Result, pipe
from expression.collections import Block, block

Hertz, Radian = NewType("Hertz", float), NewType("Radian", float)
type Stage = Literal["raw", "cal"]

@dataclass(frozen=True, slots=True)
class Signal[P: Stage = "raw"]:
    frequency: Hertz; phase: Radian; samples: Block[float]

@dataclass(frozen=True, slots=True)
class RmsNorm:
    floor: float

@dataclass(frozen=True, slots=True)
class PhaseAlign:
    modulus: float = tau

type Transition = RmsNorm | PhaseAlign
type Rejection[P: Stage] = tuple[Transition, Signal[P]]
type Morph[A: Stage, B: Stage] = Callable[[Signal[A]], Result[Signal[B], Rejection[A]]]
type Transform = Morph["raw", "cal"]

def is_calibrated(sig: Signal) -> TypeIs[Signal["cal"]]:
    return 0 <= sig.phase < tau

def project(t: Transition) -> Transform:
    match t:
        case RmsNorm(floor=f):
            return lambda sig: pipe(sig.samples,
                block.fold(lambda sn, x: (fma(x, x, sn[0]), sn[1] + 1), (0.0, 0)),
                lambda sn: sqrt(sn[0] / max(sn[1], 1)),
                lambda rms: Ok(rms).filter_with(lambda r: r > f, lambda _: (t, sig)).map(lambda r: Signal["cal"](
                    sig.frequency, Radian(sig.phase % tau), pipe(sig.samples, block.map(lambda x: x / r)))))
        case PhaseAlign(modulus=m): return lambda sig: Ok(Signal["cal"](sig.frequency, Radian(sig.phase % m), sig.samples))
        case _ as unreachable: assert_never(unreachable)
```

- `Literal["raw", "cal"]` phantom tags via PEP 695 `type` alias eliminate sentinel class declarations — `Signal["cal"]` reads identically to `Signal[Cal]` with zero class definitions. PEP 696 default `P: Stage = "raw"` bounds the phantom parameter to the vocabulary while defaulting to uncalibrated state.
- `TypeIs` (PEP 742) bridges phantom parameter erasure at boundaries — `isinstance` cannot distinguish `Signal["raw"]` from `Signal["cal"]` at runtime. The predicate re-derives the phantom tag from domain invariants (phase $\in [0, \tau)$ is `PhaseAlign`'s post-condition), narrowing **both** branches (complement narrowing). Domain-internal code uses `Morph[A, B]` for static proof; `TypeIs` is reserved for deserialization, FFI, and dynamic dispatch boundaries.
- `Morph[A: Stage, B: Stage]` constrains the callable algebra to valid stage transitions — unbounded phantom parameters accept any type including nonsense tags. `block.fold` accumulates sum-of-squares via `fma` and count in one pass; `filter_with` gates on the energy floor with `Rejection[P]` carrying the failing configuration. `PhaseAlign` demonstrates total refinement — modular wrapping maps all reals to the valid range without failure witness.

---

## Refined Scalars and Smart Constructor Rails

`Constraint` union replaces stringly-typed validation — `Modular` and `Bounded` carry configuration, `Literal["bit_aligned"]` replaces the zero-field marker class. `Violation` carries `Literal`-discriminated field identity and the failing constraint as structured error context, composed through `@effect.result` generator sequencing.

```python
from dataclasses import dataclass
from math import frexp, isfinite, tau
from typing import Literal, NewType, assert_never

from expression import Ok, Result, effect

PhaseAngle, Amplitude, SampleRate = NewType("PhaseAngle", float), NewType("Amplitude", float), NewType("SampleRate", int)

@dataclass(frozen=True, slots=True)
class Modular:
    period: float

@dataclass(frozen=True, slots=True)
class Bounded:
    lo: float; hi: float

type Constraint = Modular | Bounded | Literal["bit_aligned"]
type ViolationField = Literal["phase", "amplitude", "rate"]

@dataclass(frozen=True, slots=True)
class Violation:
    field: ViolationField; raw: float; constraint: Constraint

@dataclass(frozen=True, slots=True, kw_only=True)
class Tone:
    phase: PhaseAngle; amplitude: Amplitude; rate: SampleRate

def refine(field: ViolationField, con: Constraint, v: float) -> Result[float, Violation]:
    err = lambda _: Violation(field, v, con)
    match con:
        case Modular(period=p): return Ok(v % p)
        case Bounded(lo=lo, hi=hi): return Ok(v).filter_with(lambda x: lo <= x <= hi and isfinite(x) and frexp(x)[1] > -1022, err)
        case "bit_aligned": return Ok(float(int(v))).filter_with(lambda n: int(n) > 0 and int(n) & (int(n) - 1) == 0, err)
        case _ as u: assert_never(u)

def mk_tone(p: float, a: float, r: float) -> Result[Tone, Violation]:
    @effect.result[Tone, Violation]()
    def _build():
        ph = yield from refine("phase", Modular(tau), p)
        am = yield from refine("amplitude", Bounded(0.0, 1.0), a)
        rt = yield from refine("rate", "bit_aligned", r)
        return Tone(phase=PhaseAngle(ph), amplitude=Amplitude(am), rate=SampleRate(int(rt)))
    return _build()
```

`Literal["bit_aligned"]` replaces the zero-field marker dataclass `BitAligned()` — marker classes with no fields add no information beyond their tag, which `Literal` provides natively with exhaustive `match/case` support via `case "bit_aligned":`. `ViolationField` PEP 695 alias replaces the nested `Enum` class — bounded string vocabularies are `Literal`'s domain per type discipline; `Enum` is reserved for vocabularies needing programmatic iteration or runtime methods. `Bounded` rejects IEEE 754 specials — `isfinite` gates infinities/NaN, `frexp` exponent $\leq -1022$ rejects subnormals (denormalized representation causes DSP pipeline stalls). `@effect.result` flattens the three-bind chain into `yield from` sequencing. `kw_only=True` on `Tone` prevents silent positional swap of type-compatible `NewType` fields.

---

## Tagged Unions and Exhaustive Dispatch Contracts

`Sink.weight` parameterizes absorbing-state behavior: self-loop adjacency `(0, weight)` and single-element entropy $-w \log_2 w$ ensure the field carries analytical weight, not dead storage.

```python
from dataclasses import dataclass
from math import log2, sumprod
from typing import assert_never

from expression import Ok, Result, pipe
from expression.collections import Block, seq

@dataclass(frozen=True, slots=True)
class Sink:
    weight: float

@dataclass(frozen=True, slots=True)
class Transient:
    target: int; rate: float

@dataclass(frozen=True, slots=True)
class Emitting:
    coeffs: tuple[float, ...]

type Phase = Sink | Transient | Emitting

@dataclass(frozen=True, slots=True)
class Deadlock:
    phase: Phase; target: int

def adjacency(phase: Phase) -> Result[Block[tuple[int, float]], Deadlock]:
    match phase:
        case Sink(weight=w): return Ok(Block.of_seq([(0, w)]))
        case Transient(target=t, rate=r):
            return Ok(Block.of_seq([(t, r)])).filter_with(lambda _: r > 0, lambda _: Deadlock(phase, t))
        case Emitting(coeffs=cs): return Ok(Block(pipe(enumerate(cs), seq.filter(lambda iv: iv[1] > 0))))
        case _ as unreachable: assert_never(unreachable)

def entropy(phase: Phase) -> float:
    match phase:
        case Transient(): return 0.0
        case Sink(weight=w): cs = (w,)
        case Emitting(coeffs=cs): pass
        case _ as unreachable: assert_never(unreachable)
    return pipe(cs, seq.filter(bool), tuple, lambda ps: -sumprod(ps, tuple(map(log2, ps))))
```

Self-loop `(0, w)` for `Sink` makes the absorbing transition explicit in graph structure. Match-based coefficient extraction unifies `Sink → (w,)` and `Emitting → coeffs` into one `sumprod` pipeline — `Sink` contributes $-w \log_2 w$, collapsing to 0 only at $w = 1$ (certain absorption). `seq.filter(bool)` gates zero-probability coefficients before $\log_2$ — domain restriction is structural, not conditional.

---

## Literal Vocabularies and Key Routing Types

Minkowski signature $(-1, 1, 1)$ makes the metric physically non-trivial — the inner product can be negative (timelike), exposing sign-dependent bugs that Euclidean identity metrics silently pass. Single-pass `block.fold` accumulates resolved components and gap axes simultaneously.

```python
from enum import StrEnum, auto
from math import sumprod

from expression import Option, Result, pipe
from expression.collections import Block, Map, block

type Metric = tuple[float, ...]

class Axis(StrEnum):
    T = auto(); X = auto(); Y = auto()

def contract(u: Map[Axis, float], v: Map[Axis, float], metric: Metric = (-1.0, 1.0, 1.0)) -> Result[float, Block[Axis]]:
    match len(Axis) == len(metric):
        case False: raise ValueError(f"metric length {len(metric)} != Axis count {len(Axis)}")
        case True: pass
    resolved, gaps = pipe(
        Block(zip(Axis, metric)),
        block.fold(
            lambda acc, am: u.try_find(am[0]).map2(
                lambda ui, vi: ((*acc[0], (am[1], ui * vi)), acc[1]),
                v.try_find(am[0])
            ).default_value((acc[0], (*acc[1], am[0]))),
            ((), ())))
    return (Option.Some(resolved)
        .filter(lambda r: len(r) == len(metric))
        .map(lambda r: sumprod(*zip(*r)))
        .to_result(Block(gaps)))
```

`zip(Axis, metric)` makes the zipped iterator the single source of truth versus parallel `ClassVar` lookups. `map2` expresses independent combination (both `Some` required) versus `bind`'s sequential dependency — the applicative/monadic distinction matters for reasoning about failure independence.

---

## Collection Invariants and Non-Empty Semantics

Where domain semantics require $\geq 1$ member, the emptiness check is paid once at construction — every downstream fold, map, and projection inherits the non-empty proof through its return type.

```python
from collections.abc import Callable
from dataclasses import dataclass
from math import hypot, sumprod

from expression import Option, pipe
from expression.collections import Block, block

type Vec = tuple[float, ...]

@dataclass(frozen=True, slots=True)
class Span[T]:
    head: T
    tail: Block[T]

    @staticmethod
    def of(xs: Block[T]) -> Option[Span[T]]:
        return xs.head.map(lambda h: Span(h, xs.tail))

    def reduce(self, f: Callable[[T, T], T]) -> T:
        return pipe(self.tail, block.fold(f, self.head))

    def fmap[R](self, f: Callable[[T], R]) -> Span[R]:
        return Span(f(self.head), pipe(self.tail, block.map(f)))

def gram(basis: Span[Vec]) -> tuple[Span[Vec], float]:
    norms = basis.fmap(lambda v: hypot(*v))
    lo, hi = pipe(norms.tail, block.fold(
        lambda acc, x: (min(acc[0], x), max(acc[1], x)),
        (norms.head, norms.head)))
    kappa = Option.Some(lo).filter(lambda lo: lo > 0.0).map(
        lambda lo: hi / lo).default_value(float('inf'))
    row = lambda u: (sumprod(u, basis.head), *pipe(
        basis.tail, block.map(lambda v: sumprod(u, v))))
    return basis.fmap(row), kappa
```

PEP 695 infers `T` covariant from field/return positions — no manual `TypeVar("T", covariant=True)`. `reduce` seeds `block.fold` with `head`, making seedless reduction total by type. `gram` uses `block.map` per row — $O(n)$ materialization versus the quadratic `(*acc, sumprod)` fold — and extracts condition number via single-pass `(lo, hi)` accumulation. `hypot(*v)` avoids intermediate overflow that `sqrt(sumprod(v, v))` silently corrupts.

---

## Boundary Projection Types and Compatibility Shapes

Version-dispatched projection from one canonical source makes the projection function the enforcement surface — adding a field to an egress struct forces a constructor-arity type error until every match arm threads it.

```python
from dataclasses import dataclass
from typing import Final, Literal, assert_never, overload
import msgspec

from expression import Ok, Result, curry_flip

type Version = Literal[1, 2]

_I32_LIMIT: Final[int] = 2**31

@dataclass(frozen=True, slots=True)
class QOverflow:
    version: Version; raw: float; quantized: int

@dataclass(frozen=True, slots=True, kw_only=True)
class Sample:
    epoch_ns: int; magnitude: float; phase: float; uncertainty: float; source_id: int

class _EgressBase(msgspec.Struct, frozen=True, gc=False, tag_field="v", forbid_unknown_fields=True):
    epoch_ns: int; source_id: int

class EgressV1(_EgressBase, frozen=True):
    mag_e4: int; phase_e4: int

class EgressV2(_EgressBase, frozen=True):
    mag_e6: int; phase_e6: int; unc_e6: int

type Egress = EgressV1 | EgressV2

@curry_flip(1)
def quantize(scale: float, value: float) -> int:
    return round(value * scale)

@overload
def project(version: Literal[1], s: Sample) -> Result[EgressV1, QOverflow]: ...
@overload
def project(version: Literal[2], s: Sample) -> Result[EgressV2, QOverflow]: ...
def project(version: Version,    s: Sample) -> Result[Egress, QOverflow]:
    match version:
        case 1:
            m, p = (q := quantize(1e4))(s.magnitude), q(s.phase)
            return Ok(s).filter_with(
                lambda _: max(abs(m), abs(p)) < _I32_LIMIT,
                lambda _: QOverflow(version, s.magnitude, m)).map(
                lambda s: EgressV1(s.epoch_ns, s.source_id, m, p))
        case 2:
            m, p, u = (q := quantize(1e6))(s.magnitude), q(s.phase), q(s.uncertainty)
            return Ok(s).filter_with(
                lambda _: max(abs(m), abs(p), abs(u)) < _I32_LIMIT,
                lambda _: QOverflow(version, s.magnitude, m)).map(
                lambda s: EgressV2(s.epoch_ns, s.source_id, m, p, u))
        case _ as unreachable:
            assert_never(unreachable)
```

`_EgressBase` config: `gc=False` (leaf int-only structs, no reference cycles), `tag_field="v"` (O(1) discriminated-union wire decoding), `forbid_unknown_fields=True` (strict deserialization). Version is a precision discriminant — V1 at $10^4$, V2 at $10^6$. `@curry_flip(1)` + walrus produces a reusable `float → int` quantizer per scale; `@overload` stubs narrow return type per `Literal` version, eliminating runtime `isinstance` at consumption sites.

---

## Callable Signature Algebra and Decorator Compatibility

`Wrapped[**P, T, E = Never]` is the morphism object of the decorator algebra: `**P` and `T` remain rigid while `E` widens under union at each stacking layer. `block.fold(with_concern, fn)` makes composition left-associative over `Block[Concern]` — decorators.md, effects.md, and validation.md consume these contracts.

```python
from collections.abc import Callable
from dataclasses import dataclass
from functools import wraps
from time import monotonic
from typing import Never, assert_never

from expression import Ok, Option, Result, curry_flip, pipe
from expression.collections import Block, block

@dataclass(frozen=True, slots=True)
class Budget:
    limit: float

@dataclass(frozen=True, slots=True)
class Quota:
    capacity: float; cost: float

@dataclass(frozen=True, slots=True)
class Breach[C]:
    concern: C; measured: float

type Wrapped[**P, T, E = Never] = Callable[P, Result[T, E]]
type Concern = Budget | Quota

def with_concern[**P, T, E, C: Concern](concern: C, fn: Wrapped[P, T, E]) -> Wrapped[P, T, E | Breach[C]]:
    match concern:
        case Budget(limit=lim):
            @wraps(fn)
            def timed(*args: P.args, **kwargs: P.kwargs) -> Result[T, E | Breach[Budget]]:
                t0 = monotonic()
                return fn(*args, **kwargs).bind(lambda v: Ok(v).filter_with(
                    lambda _: monotonic() - t0 < lim, lambda _: Breach(concern, monotonic() - t0)))
            return timed
        case Quota(capacity=cap, cost=c):
            @wraps(fn)
            def gated(*args: P.args, **kwargs: P.kwargs) -> Result[T, E | Breach[Quota]]:
                return Option.Some(rem := cap - c).filter(lambda r: r >= 0).to_result(
                    Breach(concern, rem)).bind(lambda _: fn(*args, **kwargs))
            return gated
        case _ as unreachable:
            assert_never(unreachable)

@curry_flip(1)
def apply_concerns[**P, T, E](concerns: Block[Concern], fn: Wrapped[P, T, E]) -> Wrapped[P, T, E | Breach[Concern]]:
    return pipe(concerns, block.fold(lambda f, c: with_concern(c, f), fn))
```

Match outside the wrapper binds concern coefficients at decoration time — per-call wrappers see closed-over configuration and a rigid `[**P, T, E]` signature. `Budget` post-gates (fn executes, result filtered); `Quota` pre-gates (capacity checked before invocation). See transforms.md for stateful `ContextVar`-backed concerns (Retry, Govern) composing via the same fold.

---

## Rules

- One canonical type anchor per domain concept; derive all projections — never parallel type families.
- `NewType` for opaque scalar distinction, `Annotated` + constraints for validated scalars — never mix. Zero bare primitives in public signatures when a typed atom exists.
- Exhaust `@tagged_union` / `Annotated[Union, Discriminator]` via `match`/`case` + `assert_never` — silent fallthrough is a type error.
- `StrEnum` for bounded vocabularies, `Literal` for finite non-string value sets — zero stringly-typed routing.
- Domain collections immutable: `tuple[T, ...]`, `frozenset[T]`, `Mapping[K, V]`, `Block[T]`/`Seq[T]`. Non-empty witness types mandatory for `fold`/`reduce`/`head`.
- Boundary projections derive from canonical model via field subsetting — no independent schema classes for the same concept.
- `Result[T, E]` for fallible returns, `Option[T]` for absence — sole monadic rails. Zero `Optional[T]`; `X | None` only in Pydantic fields requiring JSON Schema nullability.
- Error codomain widening (`E -> E | Breach[C]`) carries typed concern witness — zero stringly-typed error messages or unstructured propagation.
- `type X = Y` (PEP 695) for aliases, PEP 696 defaults for generics — lazy evaluation in 3.14+ eliminates forward-reference quoting. Zero legacy `TypeAlias`.
- `TypeIs` (PEP 742) over `TypeGuard` — complement narrowing in both branches; sole mechanism for phantom parameter recovery at boundaries.
- `ParamSpec` + `@wraps` on every decorator; `Concatenate` when prepending parameters. `block.fold(with_concern, fn)` for algebraic stacking — concern match at decoration time, not per-call.
- `@effect.result[T, E]()` for $\geq 3$ sequential binds; `result.bind` for $\leq 2$. `compose` for deferred pipelines, `pipe` for immediate — never wrap `pipe` in a lambda when `compose` expresses intent.
- `dataclasses.replace()` / `msgspec.structs.replace()` as sole functional updates — never reconstruct from field extraction.
- Zero `Any`/`cast()` in domain code — boundary `cast` requires `# BOUNDARY ADAPTER` marker.
