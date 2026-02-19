# [H1][DOMAIN_MODULE]
>**Dictum:** *Domain modules unify typed atoms, frozen models, and exhaustive unions without effect overhead.*

Produces one self-contained domain module: typed atoms via `NewType`/`Annotated` with smart constructors returning `Result[T, E]`, frozen Pydantic models as pure data carriers, discriminated unions via `Discriminator` + `Tag` + `TypeAdapter`, and pure functions composed via `match`/`case` exhaustive dispatch. Domain modules contain zero IO, zero framework imports, and zero side effects.

**Density:** ~225 LOC signals a refactoring opportunity. No file proliferation; colocate logic in the domain module.
**References:** `types.md` ([1] TYPED_ATOM_PATTERN, [2] FROZEN_MODELS, [3] DISCRIMINATED_UNIONS, [4] TYPE_SYNTAX), `effects.md` ([1] EFFECT_STACK, [3] BOUNDARY_IO_AND_ERROR_ALGEBRA), `patterns.md` ([1] ANTI_PATTERN_CODEX).
**Anti-Pattern Awareness:** See `patterns.md` [1] for PRIMITIVE_OBSESSION, MUTABLE_DEFAULT, BARE_COLLECTION, MODEL_WITH_BEHAVIOR, STRING_DISCRIMINATOR, DATACLASS_FOR_VALIDATION, OPTIONAL_MASKING_FAILURE.
**Workflow:** Fill placeholders, remove guidance blocks, verify with ty and ruff.

---
**Placeholders**

- `{{module_path}}`: `pinnacle/domain/payments.py`
- `{{atom_name}}`: `Email`
- `{{atom_name_lower}}`: `email`
- `{{atom_repr}}`: `str`
- `{{atom_predicate}}`: `EMAIL_RE.fullmatch(value)`
- `{{atom_message}}`: `"Invalid email: {value}"`
- `{{normalize_expr}}`: `value.strip().lower()`
- `{{model_name}}`: `User`
- `{{field_a}}`: `user_id: UserId`
- `{{field_b}}`: `email: Email`
- `{{union_name}}`: `Payment`
- `{{union_name_lower}}`: `payment`
- `{{variant_a}}` / `{{variant_b}}` / `{{variant_c}}` / `{{variant_d}}`: `CardPayment`, `BankPayment`, `CryptoPayment`, `WirePayment`
- `{{variant_a_lower}}` / `{{variant_b_lower}}` / `{{variant_c_lower}}` / `{{variant_d_lower}}`: `card_payment`, `bank_payment`, `crypto_payment`, `wire_payment`
- `{{discriminator_field}}`: `method`
- `{{domain_error}}`: `AtomError`
- `{{adapter_name}}`: `PaymentAdapter`

---
```python
"""{{module_path}} -- Domain module: typed atoms, frozen models, discriminated unions."""

# --- [IMPORTS] -------------------------------------------------------------
import re
from dataclasses import dataclass
from typing import Annotated, Literal, NewType, Union

from pydantic import (
    BaseModel,
    ConfigDict,
    Discriminator,
    Field,
    GetCoreSchemaHandler,
    GetJsonSchemaHandler,
    Tag,
    TypeAdapter,
)
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import CoreSchema, core_schema
from returns.result import Failure, Result, Success

# --- [ERRORS] --------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class DomainError:
    message: str

@dataclass(frozen=True, slots=True)
class {{domain_error}}(DomainError):
    atom: str

# --- [ATOMS] ---------------------------------------------------------------

# -- NewType atom: zero-cost compile-time distinction ----------------------
# Use NewType when the scalar needs no runtime validation beyond type identity.
# See types.md [1] for NewType vs Annotated decision criteria.
{{atom_name}}Id = NewType("{{atom_name}}Id", int)
EMAIL_RE: re.Pattern[str] = re.compile(r"^[\\w.+-]+@[\\w-]+\\.[\\w.]+$")

# -- Annotated atom: Rust-backed validation via core_schema ----------------
# Use Annotated + __get_pydantic_core_schema__ when the scalar carries
# runtime invariants (format, range, pattern). See types.md [1], serialization.md [4].
class _{{atom_name}}Validator:
    """Rust-backed validator for {{atom_name}} via core_schema."""

    def __get_pydantic_core_schema__(
        self, source_type: type[str], handler: GetCoreSchemaHandler,
    ) -> CoreSchema:
        return core_schema.chain_schema([
            core_schema.str_schema(min_length=1, max_length=320, strip_whitespace=True),
            core_schema.no_info_plain_validator_function(self._validate),
        ])

    def __get_pydantic_json_schema__(
        self, schema: CoreSchema, handler: GetJsonSchemaHandler,
    ) -> JsonSchemaValue:
        json_schema: JsonSchemaValue = handler(schema)
        return {**json_schema, "x-domain-atom": "{{atom_name}}"}

    @staticmethod
    def _validate(value: {{atom_repr}}) -> {{atom_repr}}:
        # Foreign boundary: Pydantic core_schema requires value-or-raise protocol.
        # Delegates to smart constructor; match/case bridges Result into Pydantic.
        # Public API is make_{{atom_name_lower}}() returning Result[T, E].
        match make_{{atom_name_lower}}(value):
            case Success(validated):
                return validated
            case Failure(error):
                # Pydantic foreign boundary -- raise required by core_schema contract
                raise ValueError(error.message)
            case _:
                raise ValueError("Unexpected atom constructor result")

type {{atom_name}} = Annotated[{{atom_repr}}, _{{atom_name}}Validator()]

# -- Smart constructors: public API returning Result, never raising --------
# Smart constructors are the sole public API for atom creation.
# Internal code receives validated atoms; only boundary code calls constructors.
# See types.md [2] for the canonical smart constructor pattern.
def make_{{atom_name_lower}}(value: {{atom_repr}}) -> Result[{{atom_name}}, {{domain_error}}]:
    match {{atom_predicate}}:
        case None:
            return Failure({{domain_error}}(
                atom="{{atom_name}}",
                message={{atom_message}},
            ))
        case _:
            return Success({{normalize_expr}})

def make_{{atom_name_lower}}_id(raw: int) -> Result[{{atom_name}}Id, {{domain_error}}]:
    match raw:
        case n if n > 0:
            return Success({{atom_name}}Id(n))
        case _:
            return Failure({{domain_error}}(
                atom="{{atom_name}}Id",
                message=f"{{atom_name}}Id must be positive, got {raw}",
            ))

# --- [MODELS] --------------------------------------------------------------

# Frozen Pydantic models are pure data carriers. No methods beyond
# @computed_field and @model_validator. Business logic lives in ops/ pipelines.
# See types.md [3] for frozen model patterns.
class {{model_name}}(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    {{field_a}}
    {{field_b}}

# --- [UNIONS] ---------------------------------------------------------------

# Callable discriminator handles both dict ingress and model ingress
# via match/case. See types.md [4] for discriminated union patterns.
def _{{union_name_lower}}_disc(
    raw: dict[str, object] | {{variant_a}} | {{variant_b}} | {{variant_c}} | {{variant_d}},
) -> str:
    match raw:
        case {"{{discriminator_field}}": str() as method}:
            return method
        case object({{discriminator_field}}=str() as method):
            return method
        case _:
            return "unknown"

class {{variant_a}}(BaseModel, frozen=True):
    {{discriminator_field}}: Literal["{{variant_a_lower}}"]
    # variant-specific fields here

class {{variant_b}}(BaseModel, frozen=True):
    {{discriminator_field}}: Literal["{{variant_b_lower}}"]
    # variant-specific fields here

class {{variant_c}}(BaseModel, frozen=True):
    {{discriminator_field}}: Literal["{{variant_c_lower}}"]
    # variant-specific fields here

class {{variant_d}}(BaseModel, frozen=True):
    {{discriminator_field}}: Literal["{{variant_d_lower}}"]
    # variant-specific fields here

type {{union_name}} = Annotated[
    Union[
        Annotated[{{variant_a}}, Tag("{{variant_a_lower}}")],
        Annotated[{{variant_b}}, Tag("{{variant_b_lower}}")],
        Annotated[{{variant_c}}, Tag("{{variant_c_lower}}")],
        Annotated[{{variant_d}}, Tag("{{variant_d_lower}}")],
    ],
    Discriminator(_{{union_name_lower}}_disc),
]

# TypeAdapter initialized eagerly at module level -- never per-request.
# See serialization.md [1] for TypeAdapter boundary patterns.
{{adapter_name}}: TypeAdapter[{{union_name}}] = TypeAdapter({{union_name}})

# --- [FUNCTIONS] ------------------------------------------------------------

# Pure functions operate on validated atoms and frozen models.
# match/case is the sole dispatch mechanism. No if/else, no for/while.
# See effects.md [1] for composing these functions in flow() pipelines.
def process_{{union_name_lower}}(
    {{union_name_lower}}: {{union_name}},
) -> Result[str, {{domain_error}}]:
    match {{union_name_lower}}:
        case {{variant_a}}():
            return Success("processed_{{variant_a_lower}}")
        case {{variant_b}}():
            return Success("processed_{{variant_b_lower}}")
        case {{variant_c}}():
            return Success("processed_{{variant_c_lower}}")
        case {{variant_d}}():
            return Success("processed_{{variant_d_lower}}")
        case _:
            return Failure({{domain_error}}(
                atom="{{union_name}}",
                message="Unknown {{union_name}} variant",
            ))

# --- [EXPORT] ---------------------------------------------------------------

# All symbols above use explicit naming. No __all__, no default exports.
# Consumers import directly: from {{module_path}} import {{atom_name}}, {{model_name}}
```

---
**Guidance**

- Typed atoms: use `NewType` for opaque scalars and `Annotated` + `core_schema` for constrained scalars; expose smart constructors returning `Result`.
- Frozen models and unions: keep `BaseModel(frozen=True)` strict and route variants with `Discriminator` + `Tag` + eager `TypeAdapter`.
- Immutability discipline: prefer `tuple`/`frozenset`/`Mapping`; keep error types as frozen slotted dataclasses.

---
**Post-Scaffold Checklist** (from `validation.md`)

- [ ] TYPE_INTEGRITY: Typed atoms via `NewType`/`Annotated`; smart constructors return `Result[T, E]`; no bare primitives in public signatures
- [ ] IMMUTABILITY: `frozen=True` on all models and dataclasses; `tuple`/`frozenset`/`Mapping` in signatures; no mutable defaults
- [ ] CONTROL_FLOW: Zero `if`/`else`/`elif`; zero `for`/`while`; exhaustive `match`/`case` with `case _:` defensive arm
- [ ] UNION_EXHAUSTIVENESS: `Discriminator` + `Tag` + `TypeAdapter`; callable discriminator handles both dict and model ingress
- [ ] SURFACE_QUALITY: No helper files; no single-call private functions; no model methods beyond `@computed_field`/`@model_validator`
- [ ] DENSITY: ~225 LOC target; one canonical schema per entity; derive variants via `pick`/`omit`/`partial` at call site
