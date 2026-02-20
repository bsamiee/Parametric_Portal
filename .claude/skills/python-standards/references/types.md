# [H1][TYPES]
>**Dictum:** *Types are closed proofs; typed atoms eradicate primitive obsession; discriminated unions exhaust state space.*

<br>

Domain types in Python 3.14+ encode invariants at construction through smart constructors returning `Result`, block invalid state with frozen models, and use Pydantic Rust-backed `core_schema` for boundary validation. `expression` types (`Option[T]`, `Block[T]`, `@tagged_union`) integrate natively with Pydantic v2 via `__get_pydantic_core_schema__`. All snippets assume `returns >= 0.26`, `expression >= 5.6`, `pydantic >= 2.12`, `beartype >= 0.22`.

---
## [1][TYPED_ATOM_PATTERN]
>**Dictum:** *Primitives validate inline; construction is total.*

<br>

`NewType` provides compile-time distinction. `Annotated` + `__get_pydantic_core_schema__` provides Rust-backed runtime validation. Smart constructors return `Result[Atom, Error]` via `match/case` -- the caller composes via `bind`/`map` on the railway.

```python
# --- [IMPORTS] ----------------------------------------------------------------

import re
from dataclasses import dataclass
from typing import Annotated, NewType

from pydantic import GetCoreSchemaHandler, StringConstraints
from pydantic_core import CoreSchema, core_schema
from returns.result import Failure, Result, Success

# --- [TYPES] ------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class AtomError:
    atom: str
    message: str

UserId = NewType("UserId", int)
CorrelationId = NewType("CorrelationId", str)

# --- [SCHEMA] -----------------------------------------------------------------

EMAIL_RE: re.Pattern[str] = re.compile(r"^[\w.+-]+@[\w-]+\.[\w.]+$")

class _EmailValidator:
    """Rust-backed validator via __get_pydantic_core_schema__."""
    __slots__ = ()

    def __get_pydantic_core_schema__(
        self, source_type: type[str], handler: GetCoreSchemaHandler,
    ) -> CoreSchema:
        return core_schema.chain_schema([
            core_schema.str_schema(min_length=5, max_length=320, strip_whitespace=True),
            core_schema.no_info_plain_validator_function(self._validate),
        ])
    @staticmethod
    def _validate(value: str) -> str:
        match EMAIL_RE.fullmatch(value):
            case None: raise ValueError(f"Invalid email: {value}")
            case _: return value

type Email = Annotated[str, _EmailValidator()]
type Slug = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[a-z0-9-]+$")]

# --- [FUNCTIONS] --------------------------------------------------------------

def make_user_id(raw: int) -> Result[UserId, AtomError]:
    match raw:
        case n if n > 0: return Success(UserId(n))
        case _: return Failure(AtomError(atom="UserId", message=f"Must be positive, got {raw}"))

def make_email(raw: str) -> Result[Email, AtomError]:
    stripped: str = raw.strip()
    match EMAIL_RE.fullmatch(stripped):
        case None: return Failure(AtomError(atom="Email", message=f"Invalid email: {raw}"))
        case _: return Success(stripped)
```

[CRITICAL]: Every domain scalar follows this shape. `NewType` for compile-time distinction; `Annotated` + `core_schema` for runtime enforcement; smart constructors return `Result`. Immutable collection signatures (`tuple` over `list`, `frozenset` over `set`, `Mapping` over `dict`) apply to all domain returns and parameters.

---
## [2][DISCRIMINATED_UNIONS]
>**Dictum:** *Unions exhaust state space; the type checker and runtime enforce totality.*

<br>

Two construction mechanisms, selected by context. **Pydantic `Discriminator` + `Tag`** for boundary models requiring JSON Schema generation and ingress validation. **`expression.@tagged_union`** for internal domain unions with zero Pydantic overhead -- preferred when the union does not cross a serialization boundary.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from typing import Annotated, Literal, Union

from expression import tagged_union, case, tag
from pydantic import BaseModel, Discriminator, Field, Tag, TypeAdapter

# --- [SCHEMA] -----------------------------------------------------------------

type Money = Annotated[str, Field(pattern=r"^\d+\.\d{2}$")]

class CardPayment(BaseModel, frozen=True):
    method: Literal["card"]
    last_four: Annotated[str, Field(min_length=4, max_length=4)]
    amount: Money

class BankPayment(BaseModel, frozen=True):
    method: Literal["bank"]
    iban: Annotated[str, Field(min_length=1)]
    amount: Money

def _payment_disc(raw: dict[str, object] | CardPayment | BankPayment) -> str:
    match raw:
        case {"method": str() as method}: return method
        case object(method=str() as method): return method
        case _: return "unknown"

type Payment = Annotated[
    Union[Annotated[CardPayment, Tag("card")], Annotated[BankPayment, Tag("bank")]],
    Discriminator(_payment_disc),
]
PaymentAdapter: TypeAdapter[Payment] = TypeAdapter(Payment)

# --- [SCHEMA] -----------------------------------------------------------------

@tagged_union
class OrderState:
    tag: Literal["Pending", "Processing", "Shipped", "Cancelled"] = tag()
    Pending = case()
    Processing = case(order_id=str, worker_id=str)
    Shipped = case(tracking=str)
    Cancelled = case(reason=str)

# --- [FUNCTIONS] --------------------------------------------------------------

def order_label(state: OrderState) -> str:
    match state:
        case OrderState.Pending(): return "awaiting processing"
        case OrderState.Processing(order_id=oid, worker_id=wid): return f"processing {oid} by {wid}"
        case OrderState.Shipped(tracking=tracking): return f"shipped: {tracking}"
        case OrderState.Cancelled(reason=reason): return f"cancelled: {reason}"

def payment_label(payment: Payment) -> str:
    match payment:
        case CardPayment(amount=amount, last_four=last_four): return f"card ending {last_four}: {amount}"
        case BankPayment(amount=amount, iban=iban): return f"bank {iban}: {amount}"
```

[IMPORTANT]: `@tagged_union` replaces manual frozen dataclass hierarchies for domain-internal unions -- zero boilerplate, exhaustive `match/case` via generated variant constructors. `TypeAdapter` initialization is eager -- create at module level. See `effects.md` [3] for `Result` dispatch over union outcomes.

---
## [3][FROZEN_MODELS]
>**Dictum:** *Models are pure data; behavior lives in pipelines.*

<br>

Pydantic `BaseModel(frozen=True)` with strict config. `expression.Option[T]` and `expression.collections.Block[T]` integrate as Pydantic model fields via built-in `__get_pydantic_core_schema__` -- use for optional domain values and frozen collections respectively. Functional updates via `model_copy(update=...)`.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from typing import Annotated, Self

from expression import Option, Some, Nothing
from expression.collections import Block
from pydantic import (
    AliasChoices, AliasPath, BaseModel, ConfigDict, Field,
    computed_field, model_validator,
)
from pinnacle.domain.atoms import Email, Slug, UserId

# --- [SCHEMA] -----------------------------------------------------------------

class User(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True, extra="forbid", revalidate_instances="never")
    user_id: UserId
    email: Email
    name: Annotated[str, Field(
        min_length=1, validation_alias=AliasChoices("name", AliasPath("profile", "name")),
    )]
    slug: Slug
    country_code: Annotated[str, Field(min_length=2, max_length=2)]
    # -- expression types as Pydantic fields (auto-serialization via core_schema) --
    nickname: Option[str] = Nothing
    tags: Block[str] = Block.empty()

    @model_validator(mode="before")
    @classmethod
    def _normalize_ingress(cls, data: object) -> object:
        match data:
            case {"full_name": str() as full_name, **rest}: return {"name": full_name, **rest}
            case _: return data
    @computed_field
    @property
    def display(self) -> str:
        return f"{self.name} <{self.email}>"
    @model_validator(mode="after")
    def _cross_validate(self) -> Self:
        match (self.country_code, self.slug):
            case ("US", slug) if not slug[:5].isdigit():
                raise ValueError("US users require zip-prefixed slug")
            case _: return self

# --- [FUNCTIONS] --------------------------------------------------------------

def rename_user(user: User, new_name: str) -> User:
    return user.model_copy(update={"name": new_name})

def user_greeting(user: User) -> str:
    """Option.match for presence/absence -- never if/else."""
    match user.nickname:
        case Some(nick):
            return f"Hello, {nick}!"
        case _:
            return f"Hello, {user.name}!"
```

[CRITICAL]: `frozen=True` on all models. `expression.Option[T]` replaces `X | None` for model fields -- provides `Some`/`Nothing` match semantics and Pydantic auto-serialization. `expression.Block[T]` replaces `tuple[T, ...]` when structural sharing or 30+ collection combinators are needed. See `serialization.md` [1] for ingress pipeline details.

---
## [4][MODERN_SYNTAX]
>**Dictum:** *Modern syntax reduces ceremony; type parameters are first-class.*

<br>

PEP 695 (`type X = Y`) replaces `TypeAlias`. PEP 696 (`TypeVar` defaults) collapses boilerplate. PEP 747 (`TypeForm`) bridges static types and runtime checks.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from collections.abc import Callable
from typing import cast

from beartype.door import die_if_unbearable
from returns.result import Result, safe
from typing_extensions import TypeForm

# --- [TYPES] ------------------------------------------------------------------

type DomainError = str
type Pipeline[A, B] = Callable[[A], Result[B, DomainError]]
type Validator[T] = Pipeline[object, T]

# --- [SCHEMA] -----------------------------------------------------------------

class Processor[T, E = str]:
    """PEP 696: consumers specify only T; E defaults to str."""
    __slots__ = ("_transform",)
    def __init__(self, transform: Pipeline[T, T]) -> None:
        self._transform = transform

# --- [FUNCTIONS] --------------------------------------------------------------

@safe
def _check_beartype[V](form: TypeForm[V], raw: object) -> V:
    """Beartype bridge: raises on mismatch, @safe captures into Result."""
    die_if_unbearable(raw, form)
    return cast(V, raw)

def narrow[V](form: TypeForm[V], raw: object) -> Result[V, Exception]:
    """PEP 747: runtime narrowing via beartype -- Result instead of raising."""
    return _check_beartype(form, raw)
```

[IMPORTANT]: `type X = Y` replaces `TypeAlias`. Generic pipeline aliases (`type Pipeline[A, B] = ...`) express reusable effect shapes. `TypeVar` defaults via PEP 696 reduce generic arity. `TypeForm` closes the last `Any` leak in validation architectures. See `patterns.md` [1] for `ANY_CAST_ERASURE` anti-pattern.

---
## [5][PHANTOM_TYPES]
>**Dictum:** *Compile-time state is zero-cost; runtime enforcement is unnecessary.*

<br>

Empty classes parameterize a generic type. Method signatures accept only the validated variant -- compile-time enforcement with zero runtime overhead. The type checker prevents double-validation and use of unvalidated values.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from returns.result import Failure, Result, Success

# --- [TYPES] ------------------------------------------------------------------

class _Unvalidated: ...
class _Validated: ...
class Token[State]:
    """Phantom: State is never stored, only checked at type level."""
    __slots__ = ("_value",)
    def __init__(self, value: str) -> None: self._value = value
    @property
    def value(self) -> str: return self._value

# --- [FUNCTIONS] --------------------------------------------------------------

def create_token(raw: str) -> Token[_Unvalidated]:
    return Token[_Unvalidated](raw)

def validate_token(token: Token[_Unvalidated]) -> Result[Token[_Validated], str]:
    match token.value:
        case str() as value if len(value) > 0: return Success(Token[_Validated](value))
        case _: return Failure("empty token")

def use_token(token: Token[_Validated]) -> str:
    return f"authorized:{token.value}"
```

[CRITICAL]: `use_token(Token[_Validated])` rejects `Token[_Unvalidated]` at type-check time. The phantom parameter carries no runtime data. Combine with `@tagged_union` (see [2]) for state machines where transitions also carry variant data.

---
## [6][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] `NewType` for compile-time scalar distinction -- zero runtime overhead.
- [ALWAYS] `Annotated` + `__get_pydantic_core_schema__` for Rust-backed validation atoms.
- [ALWAYS] Smart constructors return `Result[Atom, Error]` -- construction is total.
- [ALWAYS] `frozen=True` on every Pydantic model -- immutability is default.
- [ALWAYS] `model_copy(update={...})` for functional updates -- never mutate directly.
- [ALWAYS] `ConfigDict(strict=True, extra="forbid")` for closed object contracts.
- [ALWAYS] `TypeAdapter` initialized eagerly at module level for boundary validation.
- [ALWAYS] Keyword patterns (`case Model(field=value)`) for `__match_args__` stability.
- [ALWAYS] `tuple` over `list`, `frozenset` over `set`, `Mapping` over `dict` in domain signatures. `expression.Block[T]` when 30+ combinators or structural sharing needed.
- [ALWAYS] `expression.Option[T]` for optional model fields; `Some`/`Nothing` match semantics.
- [ALWAYS] `@tagged_union` for domain-internal closed unions; Pydantic `Discriminator` + `Tag` for boundary unions.
- [NEVER] Raw `str`/`int`/`Decimal` as parameters where a typed atom exists.
- [NEVER] Public constructors that raise for expected invalid input -- return `Result`.
- [NEVER] Mutable collections in domain model fields.
- [NEVER] `hasattr`/`getattr` -- use structural pattern matching. See `patterns.md` [1].
- [NEVER] `Optional[T]` for model fields -- use `expression.Option[T]`.

---
## [7][QUICK_REFERENCE]

| [INDEX] | [PATTERN]          | [WHEN]                               | [KEY_TRAIT]                                 |
| :-----: | ------------------ | ------------------------------------ | ------------------------------------------- |
|   [1]   | NewType atoms      | Compile-time scalar distinction      | Zero runtime overhead, nominal typing       |
|   [2]   | Annotated atoms    | Runtime-validated scalars            | `core_schema` Rust-backed enforcement       |
|   [3]   | Smart constructors | `make_x(raw) -> Result[X, Error]`    | Total construction, railway-composable      |
|   [4]   | Frozen models      | Strict `ConfigDict` + `model_copy`   | Immutability, Pydantic auto-serialization   |
|   [5]   | expression.Option  | Optional model fields                | `Some`/`Nothing` match, Pydantic-compatible |
|   [6]   | expression.Block   | Frozen collection model fields       | Structural sharing, 30+ combinators         |
|   [7]   | Pydantic DU        | Boundary unions with JSON Schema     | `Discriminator` + `Tag` + `TypeAdapter`     |
|   [8]   | @tagged_union      | Domain-internal closed unions        | Zero boilerplate, exhaustive `match/case`   |
|   [9]   | PEP 695 aliases    | Compact reusable shape definitions   | `type Pipeline[A, B] = Callable[...]`       |
|  [10]   | PEP 696 defaults   | Reducing generic arity at call sites | `class Processor[T, E = str]`               |
|  [11]   | PEP 747 TypeForm   | Runtime narrowing without `Any` leak | `beartype` + `Result` bridge                |
|  [12]   | Phantom types      | Compile-time state tracking          | Empty class markers, zero runtime data      |
