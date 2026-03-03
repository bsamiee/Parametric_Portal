# Errors

Error taxonomy, routing, accumulation, boundary translation, and recovery ownership for Python 3.14+. Every error variant, policy projection, and observability mapping across all reference files is governed by this file — errors.md defines what "typed, bounded, exhaustively-routed error rails" means at the domain level. All snippets assume expression v5.6+ with `Result`, `Option`, `@effect.result`, `pipe`, `Block`, `Map`, `seq`.

---

## Error Taxonomy and Routing

Without projection from fault discriminants to a uniform `(Policy, severity)` pair, recovery logic branches on variant identity — each new `SpectralFault` variant silently creates handler gaps across every consumer. A closed `match/case` + `assert_never` taxonomy guarantees exhaustive routing at definition time; `block.fold` threads the signal through the fault chain, short-circuiting on the first abort-policy fault.

```python
from dataclasses import dataclass
from enum import StrEnum, auto
from math import sumprod
from typing import Final, NewType, assert_never

from expression import Ok, Result, curry_flip, pipe
from expression.collections import Block, block

Hertz = NewType("Hertz", float)

class Policy(StrEnum):
    retry = auto(); degrade = auto(); abort = auto()

@dataclass(frozen=True, slots=True)
class Leakage:
    sidelobe_ratio: float; windowed: Block[float]

@dataclass(frozen=True, slots=True)
class Aliasing:
    detected: Hertz; nyquist: Hertz

@dataclass(frozen=True, slots=True, kw_only=True)
class Stall:
    residual: float; coeffs: tuple[float, ...]; prior_energy: float

type SpectralFault = Leakage | Aliasing | Stall

_EPS: Final[float] = 1e-15

@curry_flip(1)
def triage(faults: Block[SpectralFault], signal: Block[float]) -> Result[Block[float], tuple[SpectralFault, Policy, float]]:
    def gate(f: SpectralFault):
        match f:
            case Leakage(sidelobe_ratio=r, windowed=w):
                policy, severity = Policy.retry, r * pipe(w, block.fold(lambda a, x: a + x * x, 0.0))
            case Aliasing(detected=d, nyquist=n):
                policy, severity = Policy.abort, d / max(n, _EPS)
            case Stall(residual=r, coeffs=cs, prior_energy=e):
                policy, severity = Policy.degrade, sumprod((r, float(len(cs))), (1.0 / max(e, _EPS), r))
            case _ as unreachable:
                assert_never(unreachable)
        return lambda s: Ok(s).filter_with(lambda _: policy is not Policy.abort, lambda _: (f, policy, severity))
    return pipe(faults, block.fold(lambda acc, f: acc.bind(gate(f)), Ok(signal)))
```

`gate` closes over the routed `(policy, severity)` pair at fold time and returns a filter that short-circuits via `filter_with` on `Policy.abort`, propagating `(fault, policy, severity)` as `Err` context. `block.fold(lambda acc, f: acc.bind(gate(f)), Ok(signal))` mirrors `apply_chain` — `bind` skips remaining faults after the first abort while threading the signal unchanged through retry/degrade faults. `sumprod` computes order-weighted residual for `Stall` as an extended-precision dot product $r/e + n \cdot r$; the inner `block.fold` accumulates windowed energy for `Leakage` severity inline.

---

## Error Metadata and Observability Mapping

Raw fault values in telemetry expose calibration internals and create dimensional coupling between domain logic and observability schema — changing a sensor's threshold range forces updates in every downstream dashboard and alert rule. `Envelope` splits dimensions into `safe` (derived ratios and counts exportable to external surfaces) and `redacted` (absolute thresholds retained for internal diagnostics only), with `Reason(StrEnum)` providing a bounded machine-routable vocabulary that prevents reason-key proliferation across independent modules. Isomorphic variants sharing identical field structure collapse into one discriminated dataclass — `SensorFault` carries `Reason` as its discriminant, eliminating the match and the `type` alias.

```python
from dataclasses import dataclass
from enum import StrEnum, auto
from typing import Final, NewType

from expression.collections import Map

CorrId = NewType("CorrId", str)
Ratio = NewType("Ratio", float)
Count = NewType("Count", float)
Threshold = NewType("Threshold", float)

class Severity(StrEnum):
    critical = auto(); major = auto(); minor = auto()

class Reason(StrEnum):
    drift = auto(); saturation = auto(); noise = auto()

class Dim(StrEnum):
    ratio = auto(); threshold = auto(); count = auto()

@dataclass(frozen=True, slots=True, kw_only=True)
class SensorFault:
    reason: Reason; value: Ratio; reference: Threshold; count: Count

@dataclass(frozen=True, slots=True, kw_only=True)
class Envelope:
    cid: CorrId; severity: Severity; reason: Reason
    safe: Map[Dim, float]; redacted: Map[Dim, float]

_EPS: Final[float] = 1e-15
_SEVERITY: Final[Map[Reason, Severity]] = Map.empty().add(
    Reason.drift, Severity.major).add(
    Reason.saturation, Severity.critical).add(
    Reason.noise, Severity.minor)

def project(fault: SensorFault, cid: CorrId) -> Envelope:
    return Envelope(cid=cid, severity=_SEVERITY[fault.reason], reason=fault.reason,
        safe=Map.empty().add(Dim.ratio, fault.value / max(fault.reference, _EPS)).add(Dim.count, float(fault.count)),
        redacted=Map.empty().add(Dim.threshold, float(fault.reference)))
```

Three isomorphic variants carrying identical `(Ratio, Threshold, Count)` structure collapse into one `SensorFault` with `Reason` as its discriminant — the match that previously extracted uniform locals is eliminated because the fields are already uniform. `_SEVERITY: Final[Map[Reason, Severity]]` pre-computes the `Reason → Severity` mapping at module scope; `project` is a direct field-access pipeline with zero branching. `NewType` wrappers (`Ratio`, `Count`, `Threshold`) prevent cross-dimensional assignment at the call site, while `kw_only=True` on both `SensorFault` and `Envelope` forces named construction, blocking positional mis-ordering. `safe` carries only derived `ratio` and `count` dimensions; `redacted` carries the absolute `threshold` — the redaction boundary is structural, not policy-based, so adding a `Dim` variant without updating `project` produces a missing-key gap visible at the consumption site rather than a silent zero.

---

## Accumulation, Collapse, and Context Preservation

`Result.bind` short-circuits on first `Error`, making batch validation structurally incomplete — downstream faults are silently unreachable. The monoidal accumulator collects all failures through `Block`-concatenation satisfying identity (`_EMPTY` reused without allocation via `Final`) and associativity, enabling deterministic parallel partition-then-merge without ordering sensitivity. Collapse to `DiagPayload` strips internal `Bound` evidence and measured values, projecting only `Axis.name` strings and defect count into the wire-safe `msgspec.Struct` form — `.name` is the boundary projection point where typed enum members become protocol-safe strings.

```python
from dataclasses import dataclass
from enum import Enum, auto
from math import fma, sumprod
from typing import Final
import msgspec

from expression import Option, Result, pipe
from expression.collections import Block, block

class Axis(Enum):
    GAIN = auto(); BIAS = auto(); RESIDUAL = auto()

@dataclass(frozen=True, slots=True)
class Bound:
    lo: float; hi: float

@dataclass(frozen=True, slots=True, kw_only=True)
class Defect:
    axis: Axis; measured: float; bound: Bound

class DiagPayload(msgspec.Struct, frozen=True):
    axes: tuple[str, ...]; count: int

_EMPTY: Final[Block[Defect]] = Block(())

def calibrate(stim: Block[float], resp: Block[float], bounds: tuple[Bound, Bound, Bound]) -> Result[tuple[float, float, float], DiagPayload]:
    n, sx, sy, sxy, sxx, syy = pipe(Block(zip(stim, resp)), block.fold(
        lambda a, xy: (a[0] + 1, a[1] + xy[0], a[2] + xy[1], fma(xy[0], xy[1], a[3]), fma(xy[0], xy[0], a[4]), fma(xy[1], xy[1], a[5])),
        (0, 0.0, 0.0, 0.0, 0.0, 0.0)))
    det = sumprod((n, -sx), (sxx, sx))
    gain, bias = sumprod((n, -sx), (sxy, sy)) / det, sumprod((sxx, -sx), (sy, sxy)) / det
    resid = syy - sumprod((gain, bias), (sxy, sy))
    gate = lambda ax, v, bnd: Option.Some(v).filter(lambda x: bnd.lo <= x <= bnd.hi).map(
        lambda _: _EMPTY).default_value(Block.of_seq([Defect(axis=ax, measured=v, bound=bnd)]))
    faults = pipe(Block(((Axis.GAIN, gain, bounds[0]), (Axis.BIAS, bias, bounds[1]), (Axis.RESIDUAL, resid, bounds[2]))),
        block.fold(lambda acc, t: Block((*acc, *gate(*t))), _EMPTY))
    return Option.Some((gain, bias, resid)).filter(lambda _: len(faults) == 0).to_result(
        DiagPayload(axes=pipe(faults, block.map(lambda d: d.axis.name), tuple), count=len(faults)))
```

Single-pass `block.fold` accumulates six sufficient statistics $(n, \Sigma x, \Sigma y, \Sigma xy, \Sigma x^2, \Sigma y^2)$ with `fma` for fused precision; the normal-equations residual $\text{SSR} = \Sigma y^2 - \hat\beta_1 \Sigma xy - \hat\beta_0 \Sigma y$ via `sumprod` eliminates the second data traversal. `gate` returns `_EMPTY` (the `Final` monoid identity, zero allocation per passing check) on success or a singleton `Block[Defect]` on failure — `block.fold` over the three-element `Block` with `(*acc, *gate(*t))` accumulates unconditionally because monoid concatenation does not short-circuit; `gate(*t)` star-unpacks each `(Axis, value, Bound)` triple. `Option.Some(...).filter(lambda _: len(faults) == 0).to_result(DiagPayload(...))` pivots the accumulated count as the sole `Ok`/`Error` discriminant — `block.map(lambda d: d.axis.name)` projects typed `Axis` members to boundary-safe strings, constituting the redacted transport form with internal `Bound` constraints and measured values stripped.

---

## Boundary Translation for HTTP, CLI, and Message Surfaces

Internal sensor faults carry raw ADC millivolts and calibration gain constants that must never leak through the process boundary — exposing gains reveals proprietary transfer functions, exposing raw ADC values creates false precision signals consumable by downstream systems assuming calibrated output. `_Spec(kw_only=True)` consolidates every `FaultKind`-derived egress field — URI, status code, exit code, title, routing key — into a single pre-computed `Final[Map[FaultKind, _Spec]]` built via `pipe` + `seq.fold`, eliminating `.name` reflection, f-string construction, and magic arithmetic at the translation site; `translate` is a pure projection function with zero logging, zero mutation, and zero string literals in its body.

```python
from dataclasses import dataclass
from enum import Enum, auto
from typing import Final, Literal, NewType, assert_never
import msgspec

from expression import pipe
from expression.collections import Map, seq

MilliVolt, CalGain = NewType("MilliVolt", float), NewType("CalGain", float)
EpochNs, Channel = NewType("EpochNs", int), NewType("Channel", int)

class FaultKind(Enum):
    DIVERGENCE = auto(); SATURATION = auto(); DROPOUT = auto()

@dataclass(frozen=True, slots=True, kw_only=True)
class Fault:
    kind: FaultKind; channel: Channel; raw_mv: MilliVolt; cal_gain: CalGain; epoch_ns: EpochNs

@dataclass(frozen=True, slots=True)
class Http:
    version: Literal[1, 2]

@dataclass(frozen=True, slots=True)
class Cli: ...

@dataclass(frozen=True, slots=True)
class Msg:
    prefix: str

class Problem(msgspec.Struct, frozen=True):
    type_uri: str; status: int; title: str

class ProblemExt(Problem, frozen=True):
    channel: Channel; epoch_ns: EpochNs

class Exit(msgspec.Struct, frozen=True):
    code: int; message: str

class Envelope(msgspec.Struct, frozen=True):
    key: str; reason: str; channel: Channel; epoch_ns: EpochNs

@dataclass(frozen=True, slots=True, kw_only=True)
class _Spec:
    uri: str; status: int; exit_code: int; title: str; key: str

type Surface = Http | Cli | Msg
type Egress = Problem | ProblemExt | Exit | Envelope

_EGRESS: Final[Map[FaultKind, _Spec]] = pipe(
    ((FaultKind.DIVERGENCE, _Spec(uri="urn:sensor:divergence", status=502, exit_code=70, title="DIVERGENCE", key="divergence")),
     (FaultKind.SATURATION, _Spec(uri="urn:sensor:saturation", status=503, exit_code=71, title="SATURATION", key="saturation")),
     (FaultKind.DROPOUT, _Spec(uri="urn:sensor:dropout", status=504, exit_code=72, title="DROPOUT", key="dropout"))),
    seq.fold(lambda m, kv: m.add(kv[0], kv[1]), Map.empty()))

def translate(surface: Surface, fault: Fault) -> Egress:
    s = _EGRESS[fault.kind]
    match surface:
        case Http(version=v):
            match v:
                case 1: return Problem(s.uri, s.status, s.title)
                case 2: return ProblemExt(s.uri, s.status, s.title, fault.channel, fault.epoch_ns)
                case _ as uv: assert_never(uv)
        case Cli(): return Exit(code=s.exit_code, message=s.title)
        case Msg(prefix=pfx): return Envelope(".".join((pfx, s.key)), s.title, fault.channel, fault.epoch_ns)
        case _ as unreachable: assert_never(unreachable)
```

`_EGRESS[fault.kind]` yields every protocol-specific field — URI, status, exit code, title, routing key — in one `Map` lookup with zero runtime derivation; `_Spec(kw_only=True)` prevents swap risk across its five fields and `Final` forbids rebinding. Nested `match/case` exhausts two orthogonal closed vocabularies — `Surface` via `assert_never(unreachable)` and `Literal[1, 2]` via `assert_never(uv)` — with `ProblemExt(Problem, frozen=True)` using `msgspec.Struct` inheritance to extend V2 without duplicating the base triple. Redaction is structural omission: `Fault` carries `raw_mv: MilliVolt` and `cal_gain: CalGain` but no egress type includes either field — `NewType` scalars enforce nominal distinction at zero runtime cost; `translate` is a pure function with zero inline logging (boundary observability is a trace decorator concern per decorators.md).

---

## Recovery Ownership and Compensation Boundaries

The generator's `EffectError` is builder-internal — catching it re-enters a computation whose intermediate witness bindings are already consumed by short-circuit, making in-generator recovery structurally impossible. Recoverability is a type-level property encoded by field presence: an error variant carrying captured prior state IS the typed recovery discriminant, while a variant carrying only diagnostic scalars is structurally terminal. `.or_else_with(compensate)` at the composition boundary (called as `step(...).or_else_with(compensate)`) consumes the full union once, producing either an alternative value from the error's captured context or propagating the terminal variant unchanged.

```python
from dataclasses import dataclass
from math import fma
from typing import Final, assert_never

from expression import Error, Ok, Result, effect

@dataclass(frozen=True, slots=True)
class State:
    x: float; p: float

@dataclass(frozen=True, slots=True)
class Diverged:
    variance: float; prior: State

@dataclass(frozen=True, slots=True)
class Rejected:
    nis: float

type Fault = Diverged | Rejected

_COV_CEILING: Final[float] = 1e6
_COV_FLOOR: Final[float] = 1e-6
_INFLATION: Final[int] = 100

@effect.result[State, Fault]()
def step(f: float, q: float, h: float, r: float, chi2: float, prior: State, z: float):
    pred = yield from Ok(State(x=f * prior.x, p=fma(f * f, prior.p, q))).filter_with(
        lambda r: r.p < _COV_CEILING, lambda r: Diverged(r.p, prior))
    y, S = z - h * pred.x, fma(h * h, pred.p, r)
    K, nis = pred.p * h / S, y * y / S
    return (yield from Ok(State(x=fma(K, y, pred.x), p=(1 - K * h) * pred.p)).filter_with(
        lambda _: nis < chi2, lambda _: Rejected(nis)))

def compensate(fault: Fault) -> Result[State, Fault]:
    match fault:
        case Diverged(prior=s): return Ok(State(x=s.x, p=max(s.p, _COV_FLOOR) * _INFLATION))
        case Rejected() as terminal: return Error(terminal)
        case _ as unreachable: assert_never(unreachable)
```

Predict and update are inlined as `yield from` expressions inside the `@effect.result` generator — covariance prediction via `fma(f * f, prior.p, q)` feeds `filter_with` against `_COV_CEILING`, and the measurement-update Kalman gain/NIS computation feeds a second `filter_with` against `chi2`, with the generator widening disjoint error types (`Diverged`, `Rejected`) into `Fault` via covariant `yield from`. `step(...).or_else_with(compensate)` is the sole recovery site at the composition boundary — `compensate` eliminates `Diverged` at the value level by destructuring `prior: State` to produce an inflated-covariance reset where `max(s.p, _COV_FLOOR)` guards degenerate priors before $_\text{INFLATION}\times$ scaling, while `Rejected` passes through as `Error`, ensuring the post-recovery error space is a strict subset of the pre-recovery union. `Diverged` carries `prior: State` making it structurally recoverable; `Rejected` carries only `nis: float` making it structurally terminal — recoverability is field presence, not a boolean flag.

---

## Rules

- Every error variant is `frozen dataclass(slots=True)` with typed fields only — zero `str` payloads, `dict` context, or `Exception` subclassing. Zero string literals as identifiers or routing keys — `StrEnum` for reason vocabularies, `Literal` for diagnostic code sets, `NewType` for correlation IDs.
- Error taxonomies are module-scoped; shared families cross boundaries only through explicit `type` alias re-export — never import a sibling module's internal variant directly.
- `match`/`case` + `assert_never` on every error union dispatch — adding a variant without exhausting all match sites is a type error.
- Zero `try`/`except` in domain code; boundary adapters convert third-party exceptions through `@result_from` marked `# BOUNDARY ADAPTER`.
- Recovery is one-shot at composition boundaries via `.or_else_with(compensate)`: `Fault -> Result[T, Fault]` — destructure captured context for `Ok`, propagate terminal as `Error`. Never inside `@effect.result` generators. Recoverability is field presence (captured state = recoverable, diagnostic scalars only = terminal) — zero boolean flags.
- Error accumulation uses `Block[E]` with monoidal semantics — per-item context sufficient for element-level diagnostics without re-deriving upstream state.
- Boundary translation exhausts the internal error union — field names, stack traces, and domain state are redacted; only projection-safe codes and machine-routable keys cross the boundary.
- Error codomain widening (`E -> E | Breach[C]`) carries typed concern witness per layer. `map_error` is the sole wrapping mechanism at `yield from` sites for non-union stage errors; covariant widening via bare `yield from` when the stage error IS a union member.
- Every error variant maps to exactly one observability signal — the mapping is a total function from the error union, exhausted via `match`/`case`.
