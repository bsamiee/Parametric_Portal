# [H1][NUMERIC]
>**Dictum:** *Numeric computation flows through typed pipelines -- Protocols define algebraic contracts, polars expresses lazy transformations, numpy vectorizes without loops, Decimal encodes precision, memoryview avoids copies.*

<br>

Protocol-driven numeric abstractions for Python 3.14+. Numeric tower via structural subtyping replaces inheritance hierarchies. Polars lazy frames compose via `.pipe()` chains. Numpy operations replace iteration with vectorized expressions. Decimal contexts enforce financial precision. Cross-references: protocols.md [1][4], types.md [2][3], effects.md [1], performance.md [1].

---
## [1][PROTOCOL_NUMERIC_ALGEBRA]
>**Dictum:** *The numeric tower is structural -- Protocols define algebraic capabilities, implementations satisfy without inheritance.*

<br>

Python's `typing.SupportsFloat`, `SupportsInt`, `SupportsComplex`, and `SupportsAbs` define structural numeric contracts. Compose these into domain-specific algebraic Protocols. Implementations satisfy structurally -- frozen Pydantic models carry validated numeric payloads through pipelines. Use `TypeVar` with Protocol bounds for generic numeric functions.

```python
# --- [IMPORTS] ----------------------------------------------------------------
from typing import Protocol, Self, TypeVar, runtime_checkable
from pydantic import BaseModel, ConfigDict
from returns.result import Failure, Result, Success

# --- [TYPES] ------------------------------------------------------------------
N = TypeVar("N")
N_co = TypeVar("N_co", covariant=True)

# --- [PROTOCOL_PORT] ----------------------------------------------------------
@runtime_checkable
class SupportsArithmetic(Protocol):
    """Structural contract for types supporting basic arithmetic."""
    def __add__(self, other: Self) -> Self: ...
    def __mul__(self, other: Self) -> Self: ...
    def __neg__(self) -> Self: ...

class Measurable(Protocol[N_co]):
    """Covariant numeric producer -- yields a measurement value."""
    def magnitude(self) -> N_co: ...
    def unit(self) -> str: ...

class NumericReducer(Protocol[N]):
    """Invariant -- consumes and produces numeric values."""
    def identity(self) -> N: ...
    def combine(self, left: N, right: N) -> N: ...

# --- [ADAPTER] ----------------------------------------------------------------
class Measurement(BaseModel, frozen=True):
    """Satisfies Measurable[float] structurally -- no inheritance needed."""
    model_config = ConfigDict(strict=True)
    value: float
    unit_label: str
    def magnitude(self) -> float: return self.value
    def unit(self) -> str: return self.unit_label

# --- [FUNCTIONS] --------------------------------------------------------------
def total_magnitude[M: Measurable[float]](
    items: tuple[M, ...], reducer: NumericReducer[float],
) -> Result[float, str]:
    """Reduce measurements via Protocol-typed reducer -- pure, no loops."""
    from functools import reduce
    match items:
        case (): return Failure("empty measurement sequence")
        case _: return Success(reduce(
            reducer.combine, (m.magnitude() for m in items), reducer.identity(),
        ))
```

---
## [2][POLARS_LAZY_PATTERNS]
>**Dictum:** *Polars LazyFrames compose declaratively -- `.pipe()` chains express transformations, `.collect()` materializes once at the boundary.*

<br>

Polars lazy evaluation defers computation until `.collect()`. Compose transformations as standalone functions accepting and returning `LazyFrame`. Chain via `.pipe()` for linear flows. Type-safe column access via `pl.col()` expressions. Predicate pushdown and projection pruning happen automatically in the query planner.

```python
# --- [IMPORTS] ----------------------------------------------------------------
from typing import Protocol
import polars as pl

# --- [PROTOCOL_PORT] ----------------------------------------------------------
class FrameTransform(Protocol):
    """Structural contract for LazyFrame transformations."""
    def __call__(self, frame: pl.LazyFrame) -> pl.LazyFrame: ...

# --- [FUNCTIONS] --------------------------------------------------------------
def normalize_column(column: str, alias: str) -> FrameTransform:
    """Factory producing a column-normalizing transform."""
    def _apply(frame: pl.LazyFrame) -> pl.LazyFrame:
        col = pl.col(column)
        return frame.with_columns(((col - col.mean()) / col.std()).alias(alias))
    return _apply

def filter_outliers(column: str, z_threshold: float = 3.0) -> FrameTransform:
    """Factory producing an outlier-filtering transform."""
    def _apply(frame: pl.LazyFrame) -> pl.LazyFrame:
        col = pl.col(column)
        return frame.filter(((col - col.mean()) / col.std()).abs() <= z_threshold)
    return _apply

def aggregate_by(group_col: str, agg_col: str) -> FrameTransform:
    """Factory producing a grouped aggregation."""
    def _apply(frame: pl.LazyFrame) -> pl.LazyFrame:
        return frame.group_by(group_col).agg(
            pl.col(agg_col).mean().alias(f"{agg_col}_mean"),
            pl.col(agg_col).std().alias(f"{agg_col}_std"),
            pl.col(agg_col).len().alias(f"{agg_col}_count"))
    return _apply

# Compose via .pipe() -- single .collect() at boundary:
# pl.scan_parquet("data.parquet").pipe(filter_outliers("price", 2.5))
#   .pipe(normalize_column("price", "price_z"))
#   .pipe(aggregate_by("category", "price_z")).collect()
```

---
## [3][NUMPY_TYPED_VECTORIZATION]
>**Dictum:** *Numpy replaces loops with vectorized expressions -- type stubs enforce array dtype contracts at static analysis time.*

<br>

`numpy.typing.NDArray[np.float64]` provides typed array annotations verified by mypy/pyright via numpy's bundled stubs. Vectorized operations express element-wise computation without iteration. Boolean masking replaces conditional filtering. `np.where` replaces ternary dispatch over arrays.

```python
# --- [IMPORTS] ----------------------------------------------------------------
from typing import Protocol
import numpy as np
from numpy.typing import NDArray

# --- [PROTOCOL_PORT] ----------------------------------------------------------
class VectorTransform(Protocol):
    """Structural contract for typed array transformations."""
    def __call__(self, data: NDArray[np.float64]) -> NDArray[np.float64]: ...

# --- [FUNCTIONS] --------------------------------------------------------------
def z_normalize(data: NDArray[np.float64]) -> NDArray[np.float64]:
    """Vectorized z-score normalization -- no loops."""
    std = np.std(data)
    return np.where(std > 0.0, (data - np.mean(data)) / std, np.zeros_like(data))

def clip_to_quantile(
    data: NDArray[np.float64], lower: float = 0.01, upper: float = 0.99,
) -> NDArray[np.float64]:
    """Vectorized quantile clipping -- replaces iterative bounds checking."""
    lo, hi = np.quantile(data, lower), np.quantile(data, upper)
    return np.clip(data, lo, hi)

def compose_transforms(*transforms: VectorTransform) -> VectorTransform:
    """Left-to-right composition of typed array transforms."""
    from functools import reduce
    def _composed(data: NDArray[np.float64]) -> NDArray[np.float64]:
        return reduce(lambda acc, fn: fn(acc), transforms, data)
    return _composed

# pipeline = compose_transforms(clip_to_quantile, z_normalize)
# result: NDArray[np.float64] = pipeline(raw_data)
```

---
## [4][DECIMAL_PRECISION]
>**Dictum:** *Financial arithmetic demands Decimal -- frozen models carry precision context, validators reject float contamination at boundaries.*

<br>

`decimal.Decimal` with explicit `Context` prevents silent precision loss. Pydantic frozen models encode monetary values with `Field(decimal_places=N)` constraints. Decode `str -> Decimal` at boundaries -- never construct `Decimal` from `float`. Use `match/case` for rounding mode dispatch.

```python
# --- [IMPORTS] ----------------------------------------------------------------
import decimal
from decimal import Decimal
from typing import Protocol
from pydantic import BaseModel, ConfigDict, Field, field_validator

# --- [PROTOCOL_PORT] ----------------------------------------------------------
class PreciseArithmetic(Protocol):
    """Structural contract for precision-safe numeric operations."""
    def add(self, other: "PreciseArithmetic") -> "PreciseArithmetic": ...
    def quantize(self, precision: Decimal) -> "PreciseArithmetic": ...

# --- [SCHEMA] -----------------------------------------------------------------
FINANCIAL_CONTEXT = decimal.Context(
    prec=28, rounding=decimal.ROUND_HALF_EVEN,
    traps={decimal.InvalidOperation: True, decimal.Overflow: True, decimal.DivisionByZero: True},
)

class MoneyAmount(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    value: Decimal = Field(max_digits=12, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")

    @field_validator("value", mode="before")
    @classmethod
    def reject_float(cls, raw: object) -> object:
        """Reject float inputs -- Decimal must originate from str or int."""
        match raw:
            case float(): raise ValueError("float -> Decimal loses precision; pass str")
            case _: return raw

    def add(self, other: "MoneyAmount") -> "MoneyAmount":
        return MoneyAmount(value=FINANCIAL_CONTEXT.add(self.value, other.value), currency=self.currency)

    def quantize(self, precision: Decimal) -> "MoneyAmount":
        return MoneyAmount(value=self.value.quantize(precision, context=FINANCIAL_CONTEXT), currency=self.currency)

# total = MoneyAmount(value=Decimal("19.99"), currency="USD").add(
#     MoneyAmount(value=Decimal("3.01"), currency="USD")).quantize(Decimal("0.01"))
```

---
## [5][ZERO_COPY_MEMORYVIEW]
>**Dictum:** *Buffer protocol enables zero-copy slicing -- memoryview exposes typed views over contiguous memory without allocation.*

<br>

`memoryview` wraps objects supporting the buffer protocol (`bytes`, `bytearray`, `array.array`, numpy arrays). Slicing a `memoryview` produces a new view -- no data copy. Use `struct.unpack_from` for typed extraction from binary buffers. Cast between formats via `.cast()`.

```python
# --- [IMPORTS] ----------------------------------------------------------------
import struct
from typing import Protocol
from pydantic import BaseModel, ConfigDict

# --- [PROTOCOL_PORT] ----------------------------------------------------------
class BufferReadable(Protocol):
    """Structural contract for objects exposing the buffer protocol."""
    def __buffer__(self, flags: int, /) -> memoryview: ...

# --- [SCHEMA] -----------------------------------------------------------------
class PacketHeader(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    version: int
    payload_length: int
    checksum: int

# --- [FUNCTIONS] --------------------------------------------------------------
HEADER_FORMAT: str = "!BHI"  # version(u8), length(u16), checksum(u32)
HEADER_SIZE: int = struct.calcsize(HEADER_FORMAT)

def parse_header(buffer: memoryview) -> PacketHeader:
    """Zero-copy header extraction from binary buffer."""
    version, payload_length, checksum = struct.unpack_from(
        HEADER_FORMAT, buffer[:HEADER_SIZE],
    )
    return PacketHeader(
        version=version, payload_length=payload_length, checksum=checksum,
    )

def extract_payload(buffer: memoryview, header: PacketHeader) -> memoryview:
    """Zero-copy payload slice -- no allocation."""
    return buffer[HEADER_SIZE : HEADER_SIZE + header.payload_length]

# raw = memoryview(bytearray(data))
# header = parse_header(raw)
# payload = extract_payload(raw, header)  # zero-copy view
```

---
## [6][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] Define numeric contracts as `Protocol` -- structural satisfaction, no `abc.ABC`.
- [ALWAYS] Use `NDArray[np.float64]` (or specific dtype) -- never bare `np.ndarray`.
- [ALWAYS] Compose polars transforms as standalone `LazyFrame -> LazyFrame` functions chained via `.pipe()`.
- [ALWAYS] Construct `Decimal` from `str` or `int` at boundaries -- reject `float` inputs via validators.
- [ALWAYS] Use `memoryview` for binary slicing -- zero-copy avoids allocation overhead.
- [ALWAYS] Materialize polars `LazyFrame` via `.collect()` once at the pipeline boundary, not mid-chain.
- [ALWAYS] Use frozen Pydantic models for validated numeric payloads -- immutability prevents silent mutation.
- [PREFER] `np.where` over conditional dispatch on array elements -- vectorized branching.
- [PREFER] `functools.reduce` with typed combiners over imperative accumulation loops.
- [NEVER] Use `for`/`while` loops for element-wise array operations -- vectorize via numpy/polars expressions.
- [NEVER] Construct `Decimal(0.1)` from float literal -- always `Decimal("0.1")`.
- [NEVER] Call `.collect()` inside polars transform functions -- defer materialization to caller.
- [NEVER] Use `abc.ABC`/`abstractmethod` for numeric abstractions -- `Protocol` provides structural subtyping.
- [NEVER] Use bare `np.ndarray` without dtype annotation -- loses static type safety.
- [NEVER] Copy buffer data when `memoryview` slicing suffices -- unnecessary allocation.

---
## [7][QUICK_REFERENCE]
>**Dictum:** *Patterns indexed by shape and intent.*

<br>

| [INDEX] | [PATTERN]                        | [WHEN]                                         | [KEY_TRAIT]                                   |
| :-----: | -------------------------------- | ---------------------------------------------- | --------------------------------------------- |
|   [1]   | `SupportsArithmetic` Protocol    | Generic numeric functions across types         | Structural numeric tower without inheritance  |
|   [2]   | `Measurable[N_co]` Protocol      | Typed producer of numeric measurements         | Covariant -- preserves subtype relationships  |
|   [3]   | `NumericReducer[N]` Protocol     | Fold/reduce operations over numeric streams    | Invariant -- identity + combine contract      |
|   [4]   | Polars `.pipe()` chain           | Multi-step LazyFrame transformations           | Deferred execution, single `.collect()`       |
|   [5]   | `FrameTransform` Protocol        | Composable polars transform functions          | `LazyFrame -> LazyFrame` structural contract  |
|   [6]   | `NDArray[np.float64]` annotation | Typed numpy arrays with static dtype checking  | Mypy/pyright verify dtype at analysis time    |
|   [7]   | `VectorTransform` Protocol       | Composable numpy array pipelines               | Structural contract for vectorized transforms |
|   [8]   | `MoneyAmount` frozen model       | Financial arithmetic with precision guarantees | Decimal context + float rejection validator   |
|   [9]   | `memoryview` zero-copy slicing   | Binary protocol parsing without allocation     | Buffer protocol views, `struct.unpack_from`   |
|  [10]   | `compose_transforms` pipeline    | Left-to-right numeric function composition     | `functools.reduce` over typed callables       |
