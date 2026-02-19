# [H1][TYPES]
>**Dictum:** *Types are closed proofs; typed atoms eradicate primitive obsession; discriminated unions exhaust state space.*

Domain types in Python 3.14+ encode invariants at construction through smart constructors returning `Result`, block invalid state with frozen models, and use Pydantic Rust-backed `core_schema` for boundary validation. Modeling remains schema-first: strict `ConfigDict`, targeted validators/serializers, and functional updates via `model_copy(update=...)`. All snippets assume `returns >= 0.26`, `pydantic >= 2.12`, `typing-extensions >= 4.15`, `beartype >= 0.22`.

---
## [1][TYPED_ATOM_PATTERN]
>**Dictum:** *Primitives validate inline; construction is total; collections are immutable.*

`NewType` provides compile-time distinction. `Annotated` + `__get_pydantic_core_schema__` provides Rust-backed runtime validation. Smart constructors return `Result[Atom, Error]` via `match/case` -- the caller composes via `bind`/`map` on the railway. Signatures use `tuple[T, ...]` over `list`, `frozenset` over `set`, `Mapping` over `dict`.

```python
# --- [IMPORTS] -------------------------------------------------------------
import re
from collections.abc import Sequence
from decimal import Decimal
from dataclasses import dataclass
from typing import Annotated, NewType

from pydantic import GetCoreSchemaHandler, GetJsonSchemaHandler, StringConstraints, TypeAdapter
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import CoreSchema, core_schema
from returns.result import Failure, Result, Success

# --- [CODE] ----------------------------------------------------------------

# -- Typed error atom for validation failures ------------------------------
@dataclass(frozen=True, slots=True)
class AtomError:
    atom: str
    message: str

# -- NewType atoms: zero-cost at runtime, distinct at type-check -----------
UserId = NewType("UserId", int)
CorrelationId = NewType("CorrelationId", str)

# -- Annotated constrained atom with core_schema enforcement ---------------
EMAIL_RE: re.Pattern[str] = re.compile(r"^[\w.+-]+@[\w-]+\.[\w.]+$")

class _EmailValidator:
    """Rust-backed validator via __get_pydantic_core_schema__."""
    __slots__ = ()

    def __get_pydantic_core_schema__(
        self, source_type: type[str], handler: GetCoreSchemaHandler,
    ) -> CoreSchema:
        # Canonical pattern: parse primitive first, then run domain validator.
        return core_schema.chain_schema([
            core_schema.str_schema(min_length=5, max_length=320, strip_whitespace=True),
            core_schema.no_info_plain_validator_function(self._validate),
        ])

    def __get_pydantic_json_schema__(
        self, schema: CoreSchema, handler: GetJsonSchemaHandler,
    ) -> JsonSchemaValue:
        json_schema: JsonSchemaValue = handler(schema)
        return {**json_schema, "format": "email", "x-domain-atom": "Email"}

    @staticmethod
    def _validate(value: str) -> str:
        match EMAIL_RE.fullmatch(value):
            case None:
                raise ValueError(f"Invalid email: {value}")
            case _:
                return value

type Email = Annotated[str, _EmailValidator()]
type Slug = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[a-z0-9-]+$")]

# -- Smart constructors: sole public API for atom creation -----------------
def make_user_id(raw: int) -> Result[UserId, AtomError]:
    match raw:
        case n if n > 0:
            return Success(UserId(n))
        case _:
            return Failure(AtomError(atom="UserId", message=f"UserId must be positive, got {raw}"))

def make_email(raw: str) -> Result[Email, AtomError]:
    stripped: str = raw.strip()
    match EMAIL_RE.fullmatch(stripped):
        case None:
            return Failure(AtomError(atom="Email", message=f"Invalid email: {raw}"))
        case _:
            return Success(stripped)  # Annotated alias validated; raw str is the Email type

# -- Immutable collections: tuple > list, frozenset > set, Mapping > dict -
def top_scores(
    scores: Sequence[tuple[UserId, Decimal]],
    limit: int,
) -> tuple[tuple[UserId, Decimal], ...]:
    return tuple(sorted(scores, key=lambda pair: pair[1], reverse=True)[:limit])
```

[CRITICAL]: Every domain scalar follows this shape. `NewType` for compile-time distinction; `Annotated` + `core_schema` for runtime enforcement; smart constructors return `Result`. `tuple` over `list`, `frozenset` over `set`, `Mapping` over `dict` in all domain signatures. No raw `str`, `int`, or `Decimal` where a typed atom exists.

---
## [2][FROZEN_MODELS]
>**Dictum:** *Models are pure data; behavior lives in pipelines.*

Pydantic `BaseModel(frozen=True)` with strict config disables coercion globally and keeps object state deterministic. Inbound shape normalization uses `model_validator(mode="before")`; cross-field invariants use `mode="after"`; alias compatibility uses `AliasChoices`/`AliasPath`; outbound shape control uses serializer hooks. BaseModel exposes `__match_args__` automatically -- prefer keyword patterns for stability.

```python
# --- [IMPORTS] -------------------------------------------------------------
from typing import Annotated, Self

from pydantic import (
    AliasChoices,
    AliasPath,
    BaseModel,
    ConfigDict,
    Field,
    SerializerFunctionWrapHandler,
    computed_field,
    field_serializer,
    model_serializer,
    model_validator,
)

from pinnacle.domain.atoms import Email, Slug, UserId

# --- [CODE] ----------------------------------------------------------------

class Address(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True, extra="forbid")
    street: Annotated[str, Field(min_length=1)]
    city: Annotated[str, Field(min_length=1)]
    country_code: Annotated[str, Field(min_length=2, max_length=2)]

class User(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True, extra="forbid", revalidate_instances="never")
    user_id: UserId
    email: Email
    name: Annotated[
        str,
        Field(
            min_length=1,
            validation_alias=AliasChoices("name", AliasPath("profile", "name")),
        ),
    ]
    slug: Slug
    address: Address

    @model_validator(mode="before")
    @classmethod
    def _normalize_ingress(cls, data: object) -> object:
        """Compatibility layer for legacy ingress payloads."""
        match data:
            case {"full_name": str() as full_name, **rest}:
                return {"name": full_name, **rest}
            case _:
                return data

    @computed_field
    @property
    def display(self) -> str:
        return f"{self.name} <{self.email}>"

    @model_validator(mode="after")
    def _cross_validate(self) -> Self:
        """Cross-field validation: US addresses require 5-digit zip in slug."""
        match (self.address.country_code, self.slug):
            case ("US", slug) if not slug[:5].isdigit():
                raise ValueError("US users require zip-prefixed slug")
            case _:
                return self

    @field_serializer("email")
    def _serialize_email(self, value: Email) -> str:
        return str(value).lower()

    @model_serializer(mode="wrap")
    def _serialize_user(self, handler: SerializerFunctionWrapHandler) -> dict[str, object]:
        payload: dict[str, object] = handler(self)
        return {**payload, "kind": "user", "schema_version": 1}

# -- Keyword pattern matching on BaseModel (via __match_args__) -----------
def describe_user(user: User) -> str:
    match user:
        case User(name=name, email=email, slug=slug):
            return f"{name} ({email}) [{slug}]"

# -- Functional update via model_copy: frozen models are never mutated ----
def rename_user(user: User, new_name: str) -> User:
    """model_copy(update={...}) returns a new frozen instance -- the original is untouched."""
    return user.model_copy(update={"name": new_name})
```

[CRITICAL]: All models declare `frozen=True`. Use `model_copy(update={...})` for functional updates -- never mutate fields directly. Use strict configs (`strict=True`, `extra=\"forbid\"`) to keep object contracts closed. Use `model_validator(mode=\"before\")` for ingress normalization and `mode=\"after\"` for invariant checks. Keep serializer logic in model serializers only for boundary shape; domain behavior remains in `ops/` pipelines.

---
## [3][DISCRIMINATED_UNIONS]
>**Dictum:** *Unions exhaust state space; the type checker and runtime enforce totality.*

Pydantic `Discriminator` + `Tag` + `Literal` fields route validation to the correct variant. `TypeAdapter` provides eager boundary initialization. Callable discriminators handle polymorphic dispatch via structural `match/case` on dict keys and model attributes.

```python
# --- [IMPORTS] -------------------------------------------------------------
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Discriminator, Field, Tag, TypeAdapter

from pinnacle.domain.atoms import Email

# --- [CODE] ----------------------------------------------------------------

type Money = Annotated[str, Field(pattern=r"^\d+\.\d{2}$")]

def _payment_disc(raw: dict[str, object] | CardPayment | BankPayment) -> str:
    match raw:
        case {"method": str() as method}:
            return method
        case object(method=str() as method):
            return method
        case _:
            return "unknown"

class CardPayment(BaseModel, frozen=True):
    method: Literal["card"]
    last_four: Annotated[str, Field(min_length=4, max_length=4)]
    amount: Money

class BankPayment(BaseModel, frozen=True):
    method: Literal["bank"]
    iban: Annotated[str, Field(min_length=1)]
    amount: Money

type Payment = Annotated[
    Union[
        Annotated[CardPayment, Tag("card")],
        Annotated[BankPayment, Tag("bank")],
    ],
    Discriminator(_payment_disc),
]

PaymentAdapter: TypeAdapter[Payment] = TypeAdapter(Payment)

# -- Structural destructuring replaces hasattr/getattr --------------------
def payment_label(payment: Payment) -> str:
    match payment:
        case CardPayment(amount=amount, last_four=last_four):
            return f"card ending {last_four}: {amount}"
        case BankPayment(amount=amount, iban=iban):
            return f"bank {iban}: {amount}"
```

[IMPORTANT]: `TypeAdapter` initialization is eager -- create at module level, not per-request. Callable discriminators use structural `match/case`: dict pattern for raw ingress, `object(attr=value)` for model instances. [NEVER] `hasattr`/`getattr` -- use keyword patterns.

---
## [4][TYPE_SYNTAX]
>**Dictum:** *Modern syntax reduces ceremony; type parameters are first-class.*

PEP 695 (`type X = Y`) replaces `TypeAlias`. PEP 696 (`TypeVar` defaults) collapses boilerplate. PEP 747 (`TypeForm`) bridges static types and runtime checks.

```python
# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Callable
from typing import cast

from beartype.door import die_if_unbearable
from returns.result import Failure, Result, Success, safe
from typing_extensions import TypeForm

# --- [CODE] ----------------------------------------------------------------

# -- PEP 695: type statement as canonical alias syntax --------------------
type DomainError = str
type Pipeline[A, B] = Callable[[A], Result[B, DomainError]]
type Validator[T] = Pipeline[object, T]

# -- PEP 696: TypeVar defaults collapse generic arity --------------------
class Processor[T, E = str]:
    """Consumers specify only T; E defaults to str."""
    __slots__ = ("_transform",)

    def __init__(self, transform: Pipeline[T, T]) -> None:
        self._transform = transform

# -- PEP 747: TypeForm runtime narrowing returning Result ----------------
@safe
def _check_beartype[V](form: object, raw: object) -> V:
    """Beartype bridge: raises on mismatch, @safe captures into Result."""
    die_if_unbearable(raw, form)
    return cast(V, raw)

def narrow[V](form: object, raw: object) -> Result[V, Exception]:
    """Runtime narrowing via beartype -- Result instead of raising."""
    return _check_beartype(form, raw)

# -- Phantom types: compile-time state tracking via unused type parameter ---
class _Unvalidated: ...
class _Validated: ...

class Token[State]:
    """Phantom type: State is never stored, only checked at type level."""
    __slots__ = ("_value",)
    def __init__(self, value: str) -> None:
        self._value = value
    @property
    def value(self) -> str:
        return self._value

def create_token(raw: str) -> Token[_Unvalidated]:
    return Token[_Unvalidated](raw)

def validate_token(token: Token[_Unvalidated]) -> Result[Token[_Validated], str]:
    """Only accepts unvalidated tokens; returns validated. Type checker prevents double-validation."""
    match token.value:
        case str() as value if len(value) > 0:
            return Success(Token[_Validated](value))
        case _:
            return Failure("empty token")

def use_token(token: Token[_Validated]) -> str:
    """Only accepts validated tokens -- unvalidated tokens are a type error."""
    return f"authorized:{token.value}"
```

[IMPORTANT]: `type X = Y` replaces `TypeAlias` assignments. Generic pipeline aliases (`type Pipeline[A, B] = ...`) express reusable effect shapes. `TypeVar` defaults via PEP 696 reduce generic arity at call sites. `TypeForm` from `typing_extensions` closes the last `Any` leak in validation-heavy architectures.

---
## [5][RULES]
>**Dictum:** *Rules compress into constraints.*

- [ALWAYS] `NewType` for compile-time scalar distinction -- zero runtime overhead.
- [ALWAYS] `Annotated` + `__get_pydantic_core_schema__` for Rust-backed validation atoms.
- [ALWAYS] `StringConstraints` for simple pattern/length constraints on strings.
- [ALWAYS] Smart constructors return `Result[Atom, Error]` -- construction is total.
- [ALWAYS] `frozen=True` on every Pydantic model -- immutability is default.
- [ALWAYS] `model_copy(update={...})` for functional updates on frozen models -- never mutate directly.
- [ALWAYS] `ConfigDict(strict=True, extra=\"forbid\")` for closed object contracts.
- [ALWAYS] `AliasChoices` / `AliasPath` for backward-compatible ingress fields.
- [ALWAYS] `model_validator(mode=\"before\")` to normalize legacy payloads before field checks.
- [ALWAYS] `field_serializer` / `model_serializer` only for boundary shape projection.
- [ALWAYS] `@property` (not `@cached_property`) with `@computed_field` on frozen models.
- [ALWAYS] `tuple` over `list`, `frozenset` over `set`, `Mapping` over `dict` in domain signatures.
- [ALWAYS] `TypeAdapter` initialized eagerly at module level for boundary validation.
- [ALWAYS] Keyword patterns (`case Model(field=value)`) for `__match_args__` stability.
- [NEVER] Raw `str`/`int`/`Decimal` as method parameters where a typed atom exists.
- [NEVER] Public constructors that raise for expected invalid input -- return `Result`.
- [NEVER] Mutable collections in domain model fields -- use `tuple` and `frozenset`.
- [NEVER] `hasattr`/`getattr` -- use structural pattern matching.

---
## [6][QUICK_REFERENCE]

- NewType atoms: compile-time scalar distinction with zero runtime overhead.
- Annotated atoms: runtime-validated scalars through `core_schema`.
- `StringConstraints`: concise string range/pattern constraints.
- Smart constructors: `make_x(raw) -> Result[X, Error]` as sole creation path.
- Frozen models: strict `ConfigDict` and `model_copy`-based updates.
- Alias compatibility: `AliasChoices` / `AliasPath` for ingress evolution.
- Ingress normalization: `model_validator(mode=\"before\")`.
- Boundary projection: `field_serializer` / `model_serializer`.
- Discriminated unions: `Discriminator` + `Tag` + eager `TypeAdapter`.
- Immutable collections: `tuple`, `frozenset`, `Mapping` in domain signatures.
- PEP 695 aliases: compact reusable shape definitions.
- PEP 747 `TypeForm`: runtime narrowing without `Any` leakage.
- Phantom types: compile-time state tracking with unused type parameters.
