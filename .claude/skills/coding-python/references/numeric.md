# Numeric

Protocol-driven numeric abstractions for Python 3.14+. Structural subtyping replaces inheritance hierarchies. Expression `block.fold`/`seq.fold` replace imperative accumulation. All snippets assume expression v5.6+, NumPy 2.4+, Polars 1.32+.

---
## Protocol Numeric Algebra

Monoidal reduction requires identity + associative combine — `Protocol` encodes both structurally, and PEP 695 infers `T` invariant from dual-position (`identity` produces, `combine` consumes). `@curry_flip(1)` defers the data parameter; `block.fold` threads the monoid through the error rail via `bind`, short-circuiting on first `Defect`.

```python
from dataclasses import dataclass
from typing import Protocol

from expression import Ok, Result, curry_flip, pipe
from expression.collections import Block, block

@dataclass(frozen=True, slots=True)
class Defect:
    index: int; measured: float; bound: float

class Monoid[T](Protocol):
    def identity(self) -> T: ...
    def combine(self, a: T, b: T) -> T: ...
    def validate(self, v: T, idx: int) -> Result[T, Defect]: ...

@curry_flip(1)
def reduce_checked[T](m: Monoid[T], xs: Block[T]) -> Result[T, Defect]:
    return pipe(xs.indexed(), block.fold(
        lambda acc, ix: acc.bind(lambda a: m.validate(ix[1], ix[0]).map(lambda v: m.combine(a, v))),
        Ok(m.identity())))
```

`Monoid[T]` unifies identity element, associative binary operation, and per-element validation into one Protocol surface. PEP 695 infers `T` invariant because `identity` returns `T` (covariant) while `combine` accepts `T` (contravariant), preventing `Monoid[int]` from structurally satisfying `Monoid[float]`. The `bind`→`validate`→`map`→`combine` chain inside `block.fold` threads the accumulator through the error rail — first invalid element short-circuits the entire fold. `@curry_flip(1)` makes `reduce_checked(monoid)` a reusable `Block[T] -> Result[T, Defect]` arrow. Concrete `combine` implementations benefit from `math.fma(a, weight, b)` for fused multiply-add precision when the monoid accumulates weighted sums.

---
## Polars Lazy Patterns

`pipe` chains compose `LazyFrame → LazyFrame` transforms with deferred execution — predicate pushdown, projection pruning, and join reordering happen at `.collect()`. `pl.struct(*cols)` packs multiple columns into a single struct Series for atomic multi-column operations via `map_batches`. `when/then/otherwise` replaces conditional branching with expression-level dispatch.

```python
from collections.abc import Callable

import numpy as np
import polars as pl
from expression import Ok, Result, curry_flip, pipe
from expression.collections import Block, block

type FrameArrow = Callable[[pl.LazyFrame], pl.LazyFrame]

def mahalanobis_regime(cols: tuple[str, ...], threshold: float) -> FrameArrow:
    def _distance(s: pl.Series) -> pl.Series:
        raw = np.column_stack([s.struct.field(c).to_numpy() for c in cols])
        d = raw - raw.mean(axis=0)
        inv_cov = np.linalg.pinv(np.cov(d, rowvar=False) + np.eye(len(cols)) * 1e-10)
        return pl.Series(np.sqrt(np.einsum('...i,ij,...j->...', d, inv_cov, d)))
    return lambda lf: lf.with_columns(
        pl.struct(*cols).map_batches(_distance, return_dtype=pl.Float64).alias("mdist")
    ).with_columns(pl.when(pl.col("mdist") > threshold).then(pl.lit("outlier"))
        .otherwise(pl.lit("inlier")).alias("regime"))

@curry_flip(1)
def compose_lazy(transforms: Block[FrameArrow], lf: pl.LazyFrame) -> pl.LazyFrame:
    return pipe(transforms, block.fold(lambda acc, f: f(acc), lf))

def analyze(lf: pl.LazyFrame, cols: tuple[str, ...], by: str) -> Result[pl.DataFrame, str]:
    return Ok(cols).filter_with(
        lambda c: len(c) >= 2, lambda c: f"need >= 2 columns, got {len(c)}"
    ).map(lambda _: pipe(Block((mahalanobis_regime(cols, 3.0),)),
        compose_lazy, lambda build: build(lf).group_by(by, "regime")
        .agg(pl.col("mdist").mean().alias("mean_dist"),
             pl.len().alias("count")).collect()))
```

`mahalanobis_regime` returns a `FrameArrow` that fuses multivariate distance computation with regime classification. `pl.struct(*cols).map_batches(_distance, return_dtype=pl.Float64)` packs columns atomically — `_distance` receives the entire struct Series, extracts typed arrays via `s.struct.field(c).to_numpy()`, and computes Mahalanobis distance via `einsum('...i,ij,...j->...', d, inv_cov, d)` as a batched bilinear form. `np.linalg.pinv` handles rank-deficient covariance where `inv` would fail; `np.eye(len(cols)) * 1e-10` regularizes near-singular matrices. `when/then/otherwise` classifies regime labels at the expression level — the query optimizer pushes predicates through the conditional. `compose_lazy` folds `Block[FrameArrow]` left-to-right via `block.fold` with zero intermediate `.collect()`. `analyze` validates minimum dimensionality ($\geq 2$ features for covariance) via `filter_with` before the terminal `.collect()` materializes the fused plan.

---
## NumPy Typed Vectorization

`NDArray[np.float64]` provides compile-time dtype enforcement via numpy 2.4+ stubs. `np.isdtype` gates on Array API dtype taxonomy — backend-agnostic validation across NumPy, CuPy, and JAX. `svdvals` extracts singular values without full $U$/$V$ decomposition; `vector_norm` provides explicit batched norm computation via the Array API norm split.

```python
from typing import NewType

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view
from numpy.typing import NDArray
from expression import Ok, Result, curry_flip, effect

ConditionNumber = NewType("ConditionNumber", float)

@curry_flip(1)
def spectral_energy(window: int, signal: NDArray[np.float64]) -> Result[NDArray[np.float64], str]:
    return Ok(signal).filter_with(
        lambda s: np.isdtype(s.dtype, "real floating") and s.shape[0] >= window,
        lambda s: f"need real floating with >= {window} samples, got {s.dtype}:{s.shape[0]}"
    ).map(lambda s: np.einsum('...i,...i->...', (w := sliding_window_view(s, window)), w) / window)

@effect.result[tuple[int, ConditionNumber, float], str]()
def rank_decomposition(data: NDArray[np.float64], tol: float = 1e-10):
    yield from Ok(data).filter_with(
        lambda d: np.isdtype(d.dtype, "real floating") and d.ndim == 2,
        lambda d: f"need 2D real floating, got {d.dtype}:{d.ndim}D")
    sv = np.linalg.svdvals(data)
    yield from Ok(sv).filter_with(lambda s: s[0] > 0, lambda _: "zero matrix")
    rank = int(np.sum(sv > sv[0] * tol * max(data.shape)))
    return rank, ConditionNumber(float(sv[0] / sv[max(rank - 1, 0)])), float(np.linalg.vector_norm(sv[rank:]))
```

`spectral_energy` computes windowed energy without allocation: `sliding_window_view(s, window)` returns a strided view, and `einsum('...i,...i->...', w, w)` contracts the window axis as a batched dot product. `np.isdtype(s.dtype, "real floating")` replaces fragile `np.issubdtype` hierarchy checks with the declarative Array API dtype taxonomy. `rank_decomposition` uses `np.linalg.svdvals` — singular values in descending order without computing full $U$/$V$ matrices — where `eigvalsh` requires Hermitian input, `svdvals` handles arbitrary rectangular matrices. Effective rank counts singular values above relative tolerance `sv[0] * tol * max(shape)`, the condition number `sv[0] / sv[rank-1]` uses the smallest *significant* singular value (not the potentially-zero trailing value), and `np.linalg.vector_norm(sv[rank:])` computes the 2-norm of the truncated residual via the Array API norm decomposition. The `@effect.result` generator sequences two `yield from` gates — dtype/shape validation and zero-matrix rejection — making the dependent computation chain explicit.

---
## Numeric Precision & Stability

Pydantic's full validator lifecycle — `BeforeValidator` → core `Field` constraints → `AfterValidator` → `PlainSerializer` — controls numeric precision end-to-end in a single `Annotated` stack. `localcontext` scopes `Decimal` precision without global mutation. Kahan-Babuška compensated summation via `block.fold` tracks accumulated rounding error; `math.ulp` quantifies IEEE 754 representational granularity for stability gating.

```python
import decimal
from decimal import Decimal, localcontext
from math import ulp
from typing import Annotated, NewType

from pydantic import AfterValidator, BeforeValidator, Field, PlainSerializer, TypeAdapter
from expression import Ok, Result, curry_flip, effect, pipe
from expression.collections import Block, block

RelativeError = NewType("RelativeError", float)

MonetaryDecimal = TypeAdapter(Annotated[Decimal,
    BeforeValidator(lambda v: Decimal(str(v))),
    Field(max_digits=12, decimal_places=2, ge=0, allow_inf_nan=False),
    AfterValidator(lambda v: v.quantize(Decimal("0.01"))),
    PlainSerializer(lambda v: f"{v:.2f}", return_type=str)])

@effect.result[Decimal, str]()
def convert(amount: Decimal, rate: Decimal, target: str):
    validated = yield from Ok(MonetaryDecimal.validate_python(amount)).filter_with(
        lambda v: v > 0, lambda _: f"non-positive: {amount}")
    with localcontext(prec=28, rounding=decimal.ROUND_HALF_EVEN):
        converted = (validated * rate).quantize(Decimal("0.01"))
    yield from Ok(converted).filter_with(lambda v: v > 0, lambda _: f"underflow: {target}")
    return converted

@curry_flip(1)
def compensated_sum(threshold: float, xs: Block[float]) -> Result[tuple[float, RelativeError], str]:
    s, c = pipe(xs, block.fold(
        lambda acc, x: ((t := acc[0] + (y := x - acc[1])), (t - acc[0]) - y), (0.0, 0.0)))
    return Ok(s + c).filter_with(
        lambda t: abs(c) < threshold * ulp(abs(t)) * 128,
        lambda t: f"residual {abs(c):.2e} exceeds {threshold} ULPs of {t:.2e}"
    ).map(lambda t: (t, RelativeError(abs(c) / max(abs(t), ulp(1.0)))))
```

`MonetaryDecimal` demonstrates the complete Pydantic validator lifecycle in one `Annotated` stack: `BeforeValidator(lambda v: Decimal(str(v)))` coerces raw inputs to `Decimal` before core validation, `Field(max_digits=12, decimal_places=2, ge=0, allow_inf_nan=False)` applies structural constraints, `AfterValidator` quantizes to cents, and `PlainSerializer(lambda v: f"{v:.2f}", return_type=str)` controls serialization format — `TypeAdapter.json_schema(mode='serialization')` emits `{"type": "string"}` matching the actual wire format. `convert` sequences two `filter_with` gates: pre-conversion validates non-positive amounts, `localcontext(prec=28, rounding=ROUND_HALF_EVEN)` scopes banker's rounding to IEEE 754 decimal128 significance, and post-conversion catches underflow-to-zero from extreme rate ratios. `compensated_sum` implements Kahan-Babuška summation within `block.fold`: the walrus-operator step `(t := acc[0] + (y := x - acc[1]), (t - acc[0]) - y)` recovers algebraically-lost low-order bits — `y` captures the compensated input, `t` the partial sum. `filter_with` gates on ULP-relative stability: `abs(c) < threshold * ulp(abs(t)) * 128` ensures residual stays within a caller-specified multiple of machine epsilon; factor 128 accounts for $O(n)$ error growth.

---
## Zero-Copy Memoryview

`memoryview` wraps buffer-protocol objects with zero allocation on slicing. Pre-compiled `struct.Struct` amortizes format parsing; `.iter_unpack` streams typed records lazily. `Result` rails gate structural integrity — malformed buffers produce typed errors instead of `struct.error` exceptions.

```python
import struct
from dataclasses import dataclass
from typing import Final

from expression import Ok, Result, curry_flip, pipe
from expression.collections import Block, block

@dataclass(frozen=True, slots=True)
class Frame:
    epoch: int; channel: int; amplitude: float

_STRUCT: Final[struct.Struct] = struct.Struct("!IHd")

@curry_flip(1)
def decode_frames(max_frames: int, raw: memoryview) -> Result[Block[Frame], tuple[int, int]]:
    return Ok(raw).filter_with(
        lambda b: len(b) >= _STRUCT.size and len(b) % _STRUCT.size == 0,
        lambda b: (len(b), _STRUCT.size)
    ).map(lambda b: pipe(
        block.of_seq(Frame(*fields) for fields in _STRUCT.iter_unpack(b[:max_frames * _STRUCT.size])),
        block.filter(lambda f: f.amplitude > 0)))
```

`struct.Struct("!IHd")` pre-compiles the format at module load — `.iter_unpack` returns a lazy iterator of tuples without per-record `unpack_from` overhead. `_STRUCT.size` and `_STRUCT.iter_unpack` derive from the singleton, eliminating the prior `_FMT`/`_SZ`/`_ITER` triple. `raw[:max_frames * _STRUCT.size]` slices the `memoryview` producing a new view with zero copy — the cap prevents unbounded iteration over oversized buffers. `filter_with` gates two structural invariants simultaneously: minimum size ensures at least one record, alignment ensures no trailing partial records — the `Error` tuple `(actual_len, stride)` provides diagnostic context. `block.of_seq` materializes from the iterator into persistent `Block`, then `block.filter` removes non-positive amplitudes — the filter operates on the materialized Block, so the memoryview can be released after `of_seq` completes.
