# [H1][DOMAIN_MODULE]
>**Dictum:** *Domain modules unify typed atoms, frozen models, and exhaustive unions without effect overhead.*

<br>

Produces one self-contained domain module: typed atoms via `NewType`/`Annotated` with smart constructors returning `expression.Result[T, E]`, frozen Pydantic models with `expression.Option[T]` and `Block[T]` as fields, discriminated unions via `@tagged_union` (domain-internal) or `Discriminator` + `Tag` (boundary), and pure functions composed via exhaustive `match/case`. Domain modules contain zero IO, zero framework imports, and zero side effects.

**Density:** ~225 LOC signals a refactoring opportunity. No file proliferation; colocate logic in the domain module.
**References:** `types.md` ([1] TYPED_ATOM_PATTERN, [2] DISCRIMINATED_UNIONS, [3] FROZEN_MODELS, [5] PHANTOM_TYPES), `effects.md` ([3] ERROR_ALGEBRA, [5] EXPRESSION_EFFECTS), `algorithms.md` ([3] DISPATCH_PATTERNS), `patterns.md` ([1] ANTI_PATTERN_CODEX).
**Anti-Pattern Awareness:** See `patterns.md` [1] for PRIMITIVE_OBSESSION, MUTABLE_MODELS, BARE_COLLECTION, MODEL_WITH_BEHAVIOR, MUTABLE_STATE, MIXED_RESULT_LIBRARIES.
**Workflow:** Fill placeholders, remove guidance blocks, verify with ty and ruff.

---
**Placeholders**

| [INDEX] | [PLACEHOLDER]             | [EXAMPLE]                     |
| :-----: | ------------------------- | ----------------------------- |
|   [1]   | `{{module_path}}`         | `pinnacle/domain/payments.py` |
|   [2]   | `{{atom_name}}`           | `Email`                       |
|   [3]   | `{{atom_name_lower}}`     | `email`                       |
|   [4]   | `{{atom_repr}}`           | `str`                         |
|   [5]   | `{{atom_predicate}}`      | `EMAIL_RE.fullmatch(value)`   |
|   [6]   | `{{atom_message}}`        | `"Invalid email: {value}"`    |
|   [7]   | `{{normalize_expr}}`      | `value.strip().lower()`       |
|   [8]   | `{{model_name}}`          | `User`                        |
|   [9]   | `{{field_a}}`             | `user_id: UserId`             |
|  [10]   | `{{field_b}}`             | `email: Email`                |
|  [11]   | `{{union_name}}`          | `OrderState`                  |
|  [12]   | `{{variant_a}}`           | `Pending`                     |
|  [13]   | `{{variant_b}}`           | `Processing`                  |
|  [14]   | `{{variant_c}}`           | `Shipped`                     |
|  [15]   | `{{variant_d}}`           | `Cancelled`                   |
|  [16]   | `{{variant_a_fields}}`    | (none -- unit case)           |
|  [17]   | `{{variant_b_fields}}`    | `order_id=str, worker_id=str` |
|  [18]   | `{{variant_c_fields}}`    | `tracking=str`                |
|  [19]   | `{{variant_d_fields}}`    | `reason=str`                  |
|  [20]   | `{{domain_error}}`        | `AtomError`                   |
|  [21]   | `{{boundary_union_name}}` | `Payment`                     |
|  [22]   | `{{boundary_variant_a}}`  | `CardPayment`                 |
|  [23]   | `{{boundary_variant_b}}`  | `BankPayment`                 |
|  [24]   | `{{discriminator_field}}` | `method`                      |

---
```python
"""{{module_path}} -- Domain module: typed atoms, frozen models, discriminated unions."""

# --- [IMPORTS] ----------------------------------------------------------------

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Annotated, Literal, NewType, Self, TYPE_CHECKING

from expression import case, Error, Nothing, Ok, Option, Result, Some, tagged_union
from expression.collections import Block
from pydantic import (
    BaseModel,
    computed_field,
    ConfigDict,
    Discriminator,
    Field,
    model_validator,
    Tag,
    TypeAdapter,
)
from pydantic_core import core_schema

if TYPE_CHECKING:
    from pydantic import GetCoreSchemaHandler
    from pydantic_core import CoreSchema

# --- [ERRORS] -----------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class DomainError:
    """Base domain error."""

    message: str


@dataclass(frozen=True, slots=True)
class {{domain_error}}(DomainError):
    """Atom validation error."""

    atom: str


# --- [ATOMS] ------------------------------------------------------------------

# -- NewType atom: zero-cost compile-time distinction ----------------------
# Use when the scalar needs no runtime validation beyond type identity.
# See types.md [1] for NewType vs Annotated decision criteria.
{{atom_name}}Id = NewType("{{atom_name}}Id", int)
EMAIL_RE: re.Pattern[str] = re.compile(r"^[\w.+-]+@[\w-]+\.[\w.]+$")

# -- StringConstraints shorthand for pattern-only atoms --------------------
# type Slug = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[a-z0-9-]+$")]


# -- Annotated atom: Rust-backed validation via core_schema ----------------
# Use when the scalar carries runtime invariants (format, range, pattern).
# See types.md [1], serialization.md [1].
class _{{atom_name}}Validator:
    """Rust-backed validator for {{atom_name}} via core_schema."""
    __slots__ = ()

    def __get_pydantic_core_schema__(
        self, source_type: type[str], handler: GetCoreSchemaHandler,
    ) -> CoreSchema:
        return core_schema.chain_schema([
            core_schema.str_schema(min_length=1, max_length=320, strip_whitespace=True),
            core_schema.no_info_plain_validator_function(self._validate),
        ])

    @staticmethod
    def _validate(value: {{atom_repr}}) -> {{atom_repr}}:
        # Foreign boundary: core_schema requires value-or-raise protocol.
        match {{atom_predicate}}:
            case None:
                raise ValueError({{atom_message}})
            case _:
                return {{normalize_expr}}


type {{atom_name}} = Annotated[{{atom_repr}}, _{{atom_name}}Validator()]


# -- Smart constructors: expression.Result return (domain convention) ------
# expression.Result[T, E] is the domain-layer return type -- Pydantic-compatible
# via __get_pydantic_core_schema__. See types.md [2], effects.md [5].
def make_{{atom_name_lower}}(value: {{atom_repr}}) -> Result[{{atom_name}}, {{domain_error}}]:
    """Validate and normalize {{atom_name}} value."""
    stripped: {{atom_repr}} = value.strip()
    match {{atom_predicate}}:
        case None:
            return Error({{domain_error}}(atom="{{atom_name}}", message={{atom_message}}))
        case _:
            return Ok({{normalize_expr}})


def make_{{atom_name_lower}}_id(raw: int) -> Result[{{atom_name}}Id, {{domain_error}}]:
    """Validate positive integer identity for {{atom_name}}."""
    match raw:
        case n if n > 0:
            return Ok({{atom_name}}Id(n))
        case _:
            return Error({{domain_error}}(
                atom="{{atom_name}}Id", message=f"{{atom_name}}Id must be positive, got {raw}",
            ))

# --- [MODELS] -----------------------------------------------------------------


# Frozen Pydantic models are pure data carriers. No methods beyond
# @computed_field and @model_validator. Business logic lives in ops/ pipelines.
# expression.Option[T] replaces X | None; Block[T] replaces tuple[T, ...].
# Both auto-serialize via built-in __get_pydantic_core_schema__. See types.md [3].
class {{model_name}}(BaseModel, frozen=True):
    """Frozen domain model with expression fields."""

    model_config = ConfigDict(strict=True, extra="forbid")
    {{field_a}}
    {{field_b}}
    nickname: Option[str] = Nothing
    tags: Block[str] = Block.empty()

    @model_validator(mode="after")
    def _cross_validate(self) -> Self:  # noqa: N804 -- Pydantic v2 mode="after" receives instance
        match self.nickname:
            case Some(nick) if len(nick) > 100:
                raise ValueError("Nickname exceeds 100 characters")
            case _:
                return self

    @computed_field
    @property
    def display(self) -> str:
        """Formatted display name."""
        match self.nickname:
            case Some(nick):
                return f"{nick} <{self.{{field_b}}}>"
            case _:
                return str(self.{{field_b}})

# --- [UNIONS] -----------------------------------------------------------------


# -- Domain-internal union: @tagged_union (preferred for non-boundary) ------
# Zero boilerplate, exhaustive match/case, no Pydantic overhead.
# See types.md [2] for @tagged_union vs Discriminator+Tag decision.
@tagged_union
class {{union_name}}:
    """Domain-internal discriminated union."""

    tag: Literal[{{variant_options}}] = tag()
    {{variant_a}} = case({{variant_a_fields}})
    {{variant_b}} = case({{variant_b_fields}})
    {{variant_c}} = case({{variant_c_fields}})
    {{variant_d}} = case({{variant_d_fields}})


# -- Boundary union: Pydantic Discriminator+Tag (JSON Schema generation) ----
# Use when the union crosses serialization boundaries. See types.md [2].
class {{boundary_variant_a}}(BaseModel, frozen=True):
    """Boundary variant for card payment."""

    {{discriminator_field}}: Literal["{{boundary_variant_a | lower}}"]
    amount: Annotated[str, Field(pattern=r"^\d+\.\d{2}$")]


class {{boundary_variant_b}}(BaseModel, frozen=True):
    """Boundary variant for bank payment."""

    {{discriminator_field}}: Literal["{{boundary_variant_b | lower}}"]
    amount: Annotated[str, Field(pattern=r"^\d+\.\d{2}$")]


def _{{boundary_union_name | lower}}_disc(
    raw: dict[str, object] | {{boundary_variant_a}} | {{boundary_variant_b}},
) -> str:
    match raw:
        case {"{{discriminator_field}}": str() as method}:
            return method
        case object({{discriminator_field}}=str() as method):
            return method
        case _:
            return "unknown"


type {{boundary_union_name}} = Annotated[
    Annotated[{{boundary_variant_a}}, Tag("{{boundary_variant_a | lower}}")]
    | Annotated[{{boundary_variant_b}}, Tag("{{boundary_variant_b | lower}}")],
    Discriminator(_{{boundary_union_name | lower}}_disc),
]
{{boundary_union_name}}Adapter: TypeAdapter[{{boundary_union_name}}] = TypeAdapter({{boundary_union_name}})

# --- [FUNCTIONS] --------------------------------------------------------------


# Pure functions dispatch via match/case. Domain-internal unions use
# @tagged_union variant patterns; boundary unions use Pydantic model patterns.
# See algorithms.md [3] for dispatch pattern selection.
def {{union_name | lower}}_label(state: {{union_name}}) -> str:
    """Exhaustive label projection for {{union_name}} variants."""
    match state:
        case {{union_name}}.{{variant_a}}():
            return "awaiting processing"
        case {{union_name}}.{{variant_b}}(order_id=order_id, worker_id=worker_id):
            return f"processing {order_id} by {worker_id}"
        case {{union_name}}.{{variant_c}}(tracking=tracking):
            return f"shipped: {tracking}"
        case {{union_name}}.{{variant_d}}(reason=reason):
            return f"cancelled: {reason}"


def process_{{boundary_union_name | lower}}(
    payment: {{boundary_union_name}},
) -> Result[str, {{domain_error}}]:
    """Smart constructor return for boundary union processing."""
    match payment:
        case {{boundary_variant_a}}(amount=amount):
            return Ok(f"processed_card_{amount}")
        case {{boundary_variant_b}}(amount=amount):
            return Ok(f"processed_bank_{amount}")

# --- [EXPORT] -----------------------------------------------------------------

# All symbols above use explicit naming. No __all__, no default exports.
# Consumers import directly: from {{module_path}} import {{atom_name}}, {{model_name}}
```

---
**Guidance**

*Typed atoms and smart constructors* -- `NewType` for opaque scalars; `Annotated` + `core_schema` for constrained scalars. Smart constructors return `expression.Result[T, E]` (domain convention per `SKILL.md` [8]) -- `Ok` for valid, `Error` for invalid. The Pydantic validator bridges via `match/case` on the Result at the foreign boundary. See `types.md` [1] for the atom decision table.

*Frozen models with expression fields* -- `expression.Option[T]` replaces `X | None` with `Some`/`Nothing` match semantics and Pydantic auto-serialization. `expression.Block[T]` replaces `tuple[T, ...]` for frozen collections with structural sharing and 30+ combinators. Both integrate via `__get_pydantic_core_schema__`. See `types.md` [3].

*Dual union strategy* -- `@tagged_union` for domain-internal closed unions (zero boilerplate, exhaustive `match/case`). Pydantic `Discriminator` + `Tag` + `TypeAdapter` for boundary unions requiring JSON Schema. Bridge between the two at layer boundaries via `match/case` destructuring. See `types.md` [2], `effects.md` [5] for computational expressions over union outcomes.

---
**Post-Scaffold Checklist** (from `validation.md`)

- [ ] TYPE_INTEGRITY: Typed atoms via `NewType`/`Annotated`; smart constructors return `expression.Result[T, E]`; no bare primitives in public signatures. See `validation.md` [1].
- [ ] IMMUTABILITY: `frozen=True` on all models and dataclasses; `expression.Option[T]`/`Block[T]` for optional/collection fields; no mutable defaults. See `validation.md` [1].
- [ ] CONTROL_FLOW: Zero `if`/`else`/`elif`; zero `for`/`while`; exhaustive `match`/`case` with complete variant coverage. See `validation.md` [3].
- [ ] UNION_EXHAUSTIVENESS: `@tagged_union` for domain-internal; `Discriminator` + `Tag` + `TypeAdapter` for boundary; callable discriminator handles dict and model ingress. See `validation.md` [1].
- [ ] LIBRARY_DISCIPLINE: Domain module uses `expression.Result`/`Option` exclusively; no `returns.Success`/`Failure` in this module. Bridge at boundaries only. See `validation.md` [2].
- [ ] SURFACE_QUALITY: No helper files; no single-call private functions; no model methods beyond `@computed_field`/`@model_validator`. See `validation.md` [6].
- [ ] DENSITY: ~225 LOC target; one canonical schema per entity; derive variants via `pick`/`omit`/`partial` at call site. See `validation.md` [1].
