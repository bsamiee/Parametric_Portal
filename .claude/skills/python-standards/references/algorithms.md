# [H1][ALGORITHMS]
>**Dictum:** *Algorithms compose from primitives; complexity emerges from combination, not from code.*

<br>

Cross-cutting algorithmic patterns for Python 3.14+. Patterns covered in sibling files are cross-referenced, not duplicated. Snippets assume `returns >= 0.26`, `expression >= 5.6`.

---
## [1][RECURSION_AND_FOLDS]
>**Dictum:** *Factor out the recursion; vary only the algebra.*

<br>

`functools.reduce` is the canonical catamorphism (fold). `itertools.accumulate` is the scan (prefix-fold exposing intermediates). Generators serve as anamorphisms (unfolds) -- `yield` builds structure from a seed. Composing a generator with `reduce` yields a hylomorphism where the intermediate never materializes (deforestation). `@trampoline` (see `effects.md` [3]) keeps deep recursion stack-safe.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from collections.abc import Callable, Generator, Iterable
from dataclasses import dataclass
from decimal import Decimal
from functools import reduce
from itertools import accumulate
from typing import cast

from returns.trampolines import Trampoline, trampoline

# --- [TYPES] ------------------------------------------------------------------

type OrderId = str
type TransactionAmount = Decimal

# --- [CLASSES] ----------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class LineItem:
    order_id: OrderId
    amount: TransactionAmount

# --- [FUNCTIONS] --------------------------------------------------------------

def total_revenue(items: Iterable[LineItem]) -> TransactionAmount:
    """Catamorphism: single-pass fold replacing accumulator loops."""
    return reduce(lambda acc, item: acc + item.amount, items, Decimal("0"))

def running_totals(items: Iterable[LineItem]) -> Iterable[TransactionAmount]:
    """Scan: prefix-fold exposing cumulative sums at each point."""
    return accumulate((item.amount for item in items), initial=Decimal("0"))

def generate_invoice_ids(prefix: str, count: int) -> Generator[str]:
    """Anamorphism: unfold from seed via yield; terminates on count."""
    sequence: int = 0
    while sequence < count:
        yield f"{prefix}-{sequence:04d}"
        sequence += 1

def count_invoices(prefix: str, count: int) -> int:
    """Hylomorphism: fused unfold+fold -- intermediate never materializes."""
    return reduce(lambda acc, _: acc + 1, generate_invoice_ids(prefix, count), 0)

@trampoline
def factorial(value: int, acc: int = 1) -> int | Trampoline[int]:
    """Stack-safe recursion via CPS. See effects.md [3]."""
    match value:
        case n if n <= 1:
            return acc
        case _:
            return Trampoline(
                cast(Callable[[int, int], int], factorial), value - 1, acc * value,
            )
```

[CRITICAL]: `reduce` replaces imperative accumulator loops. Generators are Python's native anamorphism -- composing one with `reduce` yields deforestation (hylomorphism). `@trampoline` converts deep recursion to continuation-passing -- mandatory for recursive depths exceeding Python's default 1000-frame stack limit.

---
## [2][SINGLE_PASS_TRANSFORMS]
>**Dictum:** *One traversal; zero intermediate collections.*

<br>

Generator expressions compose lazy filter+map without materializing intermediates. `itertools.chain.from_iterable` flattens nested iterables in a single pass. `expression.Seq` provides trait-integrated `seq.map`/`seq.filter`/`seq.fold` for domain/collection modules (see `SKILL.md` [8]).

```python
# --- [IMPORTS] ----------------------------------------------------------------

from collections.abc import Iterable
from decimal import Decimal
from itertools import chain

from expression import pipe
from expression.collections import Seq, seq

# --- [FUNCTIONS] --------------------------------------------------------------

def active_amounts(items: Iterable[LineItem]) -> Iterable[TransactionAmount]:
    """Generator: fused filter+map in single pass -- zero intermediate lists."""
    return (item.amount for item in items if item.amount > Decimal("0"))

def flatten_orders(
    order_groups: Iterable[Iterable[LineItem]],
) -> Iterable[LineItem]:
    """Single-pass flattening via chain.from_iterable -- no list concat."""
    return chain.from_iterable(order_groups)

def seq_total(items: Iterable[LineItem]) -> TransactionAmount:
    """expression.Seq pipeline: of_iterable -> filter -> map -> fold.
    Canonical for domain/collection modules. See SKILL.md [8]."""
    return pipe(
        Seq.of_iterable(items),
        seq.filter(lambda item: item.amount > Decimal("0")),
        seq.map(lambda item: item.amount),
        seq.fold(lambda acc, amount: acc + amount, Decimal("0")),
    )
```

[IMPORTANT]: Generator expressions are the default for lazy single-pass in pipeline modules using `returns`. `expression.Seq` pipelines belong in domain/collection modules per library conventions (see `SKILL.md` [8]). Never mix `expression.pipe` and `returns.flow` in the same file.

---
## [3][DISPATCH_PATTERNS]
>**Dictum:** *Closed unions match exhaustively; open extension dispatches structurally.*

<br>

`match/case` handles closed discriminated unions exhaustively -- the type checker enforces totality. `functools.singledispatch` enables open extension without modifying source. `expression.@tagged_union` (see `types.md` [3]) constructs typed unions for expression-based modules. Protocol-based dispatch (see `protocols.md` [1]) uses structural typing for registration contracts.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from dataclasses import dataclass
from decimal import Decimal
from functools import singledispatch

# --- [TYPES] ------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class CardPayment:
    last_four: str
    amount: Decimal

@dataclass(frozen=True, slots=True)
class BankPayment:
    iban: str
    amount: Decimal

type Payment = CardPayment | BankPayment

# --- [FUNCTIONS] --------------------------------------------------------------

def payment_label(payment: Payment) -> str:
    """Exhaustive closed-union dispatch via match/case. See types.md [3]."""
    match payment:
        case CardPayment(last_four=digits, amount=amount):
            return f"card ***{digits}: {amount}"
        case BankPayment(iban=iban, amount=amount):
            return f"bank {iban}: {amount}"

@singledispatch
def format_receipt(item: object) -> str:
    """Open extension: default arm for unregistered types."""
    return repr(item)

@format_receipt.register
def _format_card(item: CardPayment) -> str:
    return f"RECEIPT: Card ending {item.last_four} charged {item.amount}"

@format_receipt.register
def _format_bank(item: BankPayment) -> str:
    return f"RECEIPT: Bank transfer {item.iban} for {item.amount}"
```

[IMPORTANT]: `match/case` for closed unions where all variants are compile-time known. `singledispatch` for open extension where new types register handlers additively. `@tagged_union` (see `types.md` [3]) is preferred union construction in expression-based modules.

---
## [4][PIPELINE_COMPOSITION]
>**Dictum:** *Pipelines read left-to-right; each combinator declares its transformation category.*

<br>

`expression.pipe(value, *fns)` threads a value left-to-right -- canonical for domain modules. `expression.compose(*fns)` builds reusable right-to-left composition. `returns.flow()` is the pipeline equivalent for Result-track modules. Kleisli composition chains `A -> Result[B, E]` via `bind` with automatic short-circuit. `@effect.result` generators (see `effects.md` [5]) provide the same semantics with full Python control flow.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from collections.abc import Callable
from decimal import Decimal

from expression import compose, pipe, effect

from returns.pipeline import flow
from returns.pointfree import bind
from returns.result import Failure, Result, Success

# --- [TYPES] ------------------------------------------------------------------

type FinalPrice = Decimal

# --- [FUNCTIONS] --------------------------------------------------------------

# -- expression.pipe: left-to-right (domain modules) -----------------------
def calculate_price(base: Decimal) -> FinalPrice:
    """Pure pipeline: value flows left-to-right through transforms."""
    return pipe(
        base,
        lambda amount: amount * Decimal("1.08"),
        lambda amount: round(amount, 2),
    )

# -- expression.compose: reusable right-to-left composition -----------------
def apply_tax(amount: Decimal) -> Decimal:
    """Apply 8% tax to amount."""
    return amount * Decimal("1.08")

def apply_rounding(amount: Decimal) -> Decimal:
    """Round to 2 decimal places."""
    return round(amount, 2)

price_calculator: Callable[[Decimal], Decimal] = compose(apply_rounding, apply_tax)

# -- returns.flow + bind: Result-track Kleisli (pipeline modules) -----------
def validate_and_price(raw: str) -> Result[FinalPrice, str]:
    """Kleisli composition: each stage is A -> Result[B, E]."""
    return flow(raw, _parse_amount, bind(_apply_discount), bind(_finalize))

def _parse_amount(raw: str) -> Result[Decimal, str]:
    match raw:
        case s if s.replace(".", "", 1).isdigit():
            return Success(Decimal(s))
        case _:
            return Failure(f"Invalid amount: {raw}")

def _apply_discount(amount: Decimal) -> Result[Decimal, str]:
    match amount:
        case a if a >= Decimal("100"):
            return Success(a * Decimal("0.90"))
        case a if a > Decimal("0"):
            return Success(a)
        case _:
            return Failure(f"Non-positive amount: {amount}")

def _finalize(amount: Decimal) -> Result[FinalPrice, str]:
    return Success(round(amount * Decimal("1.08"), 2))

# -- @effect.result: generator-based Kleisli (complex branching) ------------
@effect.result[FinalPrice, str]()
def validate_and_price_gen(raw: str):
    """Monadic generator: yield unwraps Result; early return on Failure.
    See effects.md [5] for computational expressions."""
    amount: Decimal = yield from _parse_amount(raw)
    discounted: Decimal = yield from _apply_discount(amount)
    return (yield from _finalize(discounted))
```

[CRITICAL]: `expression.pipe` for domain modules, `returns.flow` for pipeline modules -- never both in one file (see `SKILL.md` [8]). `bind` is Kleisli composition: chains `A -> Result[B, E]` with short-circuit on `Failure`. `@effect.result` generators provide identical semantics with full Python control flow -- use when `flow` + `bind` becomes deeply nested. `compose` reads right-to-left; `pipe` reads left-to-right.

---
## [5][NUMERIC_PATTERNS]
>**Dictum:** *Narrow constraints widen applicability; generic numeric protocols prevent type erasure.*

<br>

`Decimal` is mandatory for financial arithmetic (IEEE 754 float is lossy). `math.fsum` provides exact float summation when float precision matters. Generic numeric functions constrain via Protocol, not `Union[int, float, Decimal]`. Safe narrowing via `match/case` replaces unchecked casts.

```python
# --- [IMPORTS] ----------------------------------------------------------------

import math
from collections.abc import Iterable
from decimal import Decimal, ROUND_HALF_EVEN

from returns.result import Failure, Result, Success

# --- [FUNCTIONS] --------------------------------------------------------------

def allocate_proportional(
    total: Decimal,
    weights: tuple[Decimal, ...],
) -> Result[tuple[Decimal, ...], str]:
    """Proportional allocation with banker's rounding + remainder distribution."""
    weight_sum: Decimal = sum(weights)
    match weight_sum:
        case Decimal() as ws if ws <= Decimal("0"):
            return Failure("Weights must sum to positive value")
        case _:
            raw_shares: tuple[Decimal, ...] = tuple(
                (weight / weight_sum * total).quantize(
                    Decimal("0.01"), rounding=ROUND_HALF_EVEN,
                )
                for weight in weights
            )
            remainder: Decimal = total - sum(raw_shares)
            adjusted: list[Decimal] = list(raw_shares)
            match remainder:
                case Decimal() as rem if rem != Decimal("0"):
                    max_idx: int = max(range(len(adjusted)), key=lambda idx: adjusted[idx])
                    adjusted[max_idx] += rem
                case _:
                    pass  # boundary: no remainder to distribute
            return Success(tuple(adjusted))

def precise_float_sum(values: Iterable[float]) -> float:
    """Exact float summation compensating IEEE 754 rounding via math.fsum.

    Use Decimal for financial; fsum only when float domain is required.
    """
    return math.fsum(values)

def safe_int_from_decimal(value: Decimal) -> Result[int, str]:
    """Overflow-safe narrowing: Decimal -> int with truncation check."""
    match value:
        case Decimal() as dec if dec == dec.to_integral_value():
            return Success(int(dec))
        case _:
            return Failure(f"Cannot narrow {value} to int without truncation")
```

[IMPORTANT]: `Decimal` with `ROUND_HALF_EVEN` (banker's rounding) is mandatory for financial computations. `math.fsum` is for scientific float summation only. Safe narrowing via `match/case` replaces unchecked `int()` casts. Generic numeric functions should constrain via Protocol (see `protocols.md` [1]) to remain open to new types.

---
## [6][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] `functools.reduce` for catamorphisms -- replaces imperative accumulator loops.
- [ALWAYS] `itertools.accumulate` for scans exposing intermediate states.
- [ALWAYS] Generator expressions for lazy single-pass filter+map -- zero intermediate collections.
- [ALWAYS] `@trampoline` for deep recursion -- stack-safe via CPS. See `effects.md` [3].
- [ALWAYS] `match/case` for exhaustive closed-union dispatch; `singledispatch` for open extension.
- [ALWAYS] `expression.pipe` in domain modules; `returns.flow` in pipeline modules. See `SKILL.md` [8].
- [ALWAYS] `bind` for Kleisli composition of `A -> Result[B, E]` stages -- automatic short-circuit.
- [ALWAYS] `Decimal` with explicit rounding for financial arithmetic -- never `float`.
- [ALWAYS] `math.fsum` when float precision matters and Decimal is not an option.
- [NEVER] Imperative `for` loops for accumulation -- use `reduce` or `Seq.fold`.

---
## [7][QUICK_REFERENCE]
>**Dictum:** *One table maps pattern to context.*

<br>

| [INDEX] | [PATTERN]                   | [WHEN]                                         | [KEY_TRAIT]                                 |
| :-----: | --------------------------- | ---------------------------------------------- | ------------------------------------------- |
|   [1]   | `functools.reduce`          | Fold iterable to single value                  | Catamorphism; replaces accumulator loops    |
|   [2]   | `itertools.accumulate`      | Running totals / prefix-fold                   | Scan exposing intermediate states           |
|   [3]   | Generator unfold            | Build structure from seed lazily               | Anamorphism via `yield`                     |
|   [4]   | Generator + reduce          | Fused unfold+fold (deforestation)              | Hylomorphism; no intermediate allocation    |
|   [5]   | `@trampoline`               | Deep recursion without stack overflow          | CPS-based stack safety. See effects.md [3]  |
|   [6]   | Generator expression        | Lazy single-pass filter+map                    | Zero intermediate collections               |
|   [7]   | `chain.from_iterable`       | Flatten nested iterables                       | Single-pass; no list concatenation          |
|   [8]   | `expression.Seq` pipeline   | Trait-integrated transform (domain modules)    | `seq.map`/`seq.filter`/`seq.fold`           |
|   [9]   | `match/case` dispatch       | Exhaustive closed-union handling               | Type checker enforces totality              |
|  [10]   | `singledispatch`            | Open extension dispatch                        | New types register without modifying source |
|  [11]   | `expression.pipe`           | Left-to-right value threading (domain modules) | Pure transform pipeline                     |
|  [12]   | `expression.compose`        | Reusable right-to-left function composition    | Mathematical convention                     |
|  [13]   | `returns.flow` + `bind`     | Result-track Kleisli (pipeline modules)        | Short-circuits on Failure                   |
|  [14]   | `@effect.result` generator  | Complex branching Kleisli composition          | Full control flow in monadic context        |
|  [15]   | `Decimal` + ROUND_HALF_EVEN | Financial arithmetic                           | Banker's rounding; zero float drift         |
|  [16]   | `math.fsum`                 | Exact float summation (scientific)             | IEEE 754 compensation                       |
