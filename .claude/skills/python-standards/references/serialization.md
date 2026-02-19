# [H1][SERIALIZATION]
>**Dictum:** *Pydantic validates ingress; msgspec encodes egress; domain code touches neither raw bytes nor untyped dicts.*

Serialization in Python 3.14+ uses a dual-library boundary: Pydantic `TypeAdapter` validates ingress, msgspec `Struct(frozen=True, gc=False)` serializes egress. Domain models never handle raw wire formats. All snippets assume `pydantic >= 2.12`, `msgspec >= 0.20`, `pydantic-settings >= 2.12`, with `match/case` dispatch only.

---
## [1][INBOUND_VALIDATION_PIPELINE]
>**Dictum:** *Validate once at ingress via eager TypeAdapter; dispatch variants via structural match/case.*

`TypeAdapter(type, *, config=ConfigDict(...))` compiles Pydantic core schema once -- create at module level (expensive construction). `validate_json()` returns typed objects; `validate_python()` for dict/object input; `json_schema()` for OpenAPI generation. `@safe` bridges `ValidationError` into `Result`. Variant dispatch uses structural destructuring via keyword patterns on `__match_args__` -- [NEVER] `hasattr`/`getattr`.

```python
# --- [IMPORTS] -------------------------------------------------------------
from typing import Annotated, Literal, Union

import msgspec
from pydantic import (
    AliasChoices,
    AliasPath,
    BaseModel,
    ConfigDict,
    Discriminator,
    Field,
    Tag,
    TypeAdapter,
)
from returns.result import Result, safe

from pinnacle.domain.atoms import Email, Money

# --- [CODE] ----------------------------------------------------------------

# -- Frozen domain models with alias support ------------------------------
class CardPayment(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    method: Literal["card"]
    last_four: Annotated[str, Field(min_length=4, max_length=4)]
    amount: Money
    label: str = Field(
        default="",
        validation_alias=AliasChoices("label", AliasPath("meta", "display_name")),
    )

class BankPayment(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    method: Literal["bank"]
    iban: Annotated[str, Field(min_length=1)]
    amount: Money

def _payment_disc(raw: dict[str, object] | CardPayment | BankPayment) -> str:
    match raw:
        case {"method": str() as method}:
            return method
        case object(method=str() as method):
            return method
        case _:
            return "unknown"

type Payment = Annotated[
    Union[
        Annotated[CardPayment, Tag("card")],
        Annotated[BankPayment, Tag("bank")],
    ],
    Discriminator(_payment_disc),
]

# -- Eager module-level TypeAdapter initialization ------------------------
PaymentAdapter: TypeAdapter[Payment] = TypeAdapter(Payment)
UserAdapter: TypeAdapter[Email] = TypeAdapter(Email)

# -- @safe bridges ValidationError into Result railway --------------------
@safe
def validate_payment(raw: bytes) -> Payment:
    return PaymentAdapter.validate_json(raw)

# -- Structural destructuring for variant dispatch (no hasattr) -----------
class PaymentResponse(msgspec.Struct, frozen=True, gc=False, tag_field="kind"):
    amount: str
    currency: str = "USD"

class CardResponse(PaymentResponse, tag="card"):
    last_four: str

class BankResponse(PaymentResponse, tag="bank"):
    iban: str

def to_response(payment: Payment) -> PaymentResponse:
    match payment:
        case CardPayment(amount=amount, last_four=last_four):
            return CardResponse(amount=str(amount), last_four=last_four)
        case BankPayment(amount=amount, iban=iban):
            return BankResponse(amount=str(amount), iban=iban)

_encoder: msgspec.json.Encoder = msgspec.json.Encoder()

def handle_payment(raw: bytes) -> Result[bytes, Exception]:
    """Pydantic validates ingress; structural match dispatches; msgspec encodes egress."""
    return validate_payment(raw).map(
        lambda p: _encoder.encode(to_response(p))
    )

# -- JSON schema generation for OpenAPI documentation --------------------
PAYMENT_SCHEMA: dict[str, object] = PaymentAdapter.json_schema()
```

[CRITICAL]: `TypeAdapter` at module level -- never per-request. `AliasChoices`/`AliasPath` are validation-only aliases. Structural `match/case` with keyword patterns replaces `hasattr`/`getattr`. `@safe` bridges into `Result` railway.

---
## [2][MSGSPEC_STRUCTS]
>**Dictum:** *Egress structs are frozen, GC-exempt, and tag-discriminated.*

`msgspec.Struct(frozen=True, gc=False)` produces zero-allocation C-backed objects excluded from garbage collection. `tag`/`tag_field` for discriminated unions. `msgspec.structs.replace()` for functional updates (NOTE: `__post_init__` NOT called by `replace`). Custom type handling via `enc_hook`/`dec_hook` passed to `Encoder`/`Decoder` or via `Annotated[T, Meta(enc_hook=...)]`. `msgspec.toml.decode(buf, type=T)` / `msgspec.toml.encode(obj)` for TOML config. `msgspec.json.schema(type)` outputs JSON Schema 2020-12; `schema_components` for multi-type OpenAPI specs.

```python
# --- [IMPORTS] -------------------------------------------------------------
from datetime import datetime
from decimal import Decimal
from typing import Union

import msgspec
from msgspec import Struct, structs

# --- [CODE] ----------------------------------------------------------------

# -- Base wire struct: frozen + gc=False for zero-GC throughput -----------
class EventBase(Struct, frozen=True, gc=False, tag_field="event_type"):
    timestamp: str
    correlation_id: str

class UserCreated(EventBase, tag="user.created"):
    user_id: int
    email: str

class UserDeleted(EventBase, tag="user.deleted"):
    user_id: int
    reason: str

# -- structs.replace: functional update (NOTE: __post_init__ NOT called) --
updated: UserCreated = structs.replace(
    UserCreated(timestamp="2025-01-01", correlation_id="c1", user_id=1, email="a@b.com"),
    email="new@b.com",
)

# -- enc_hook / dec_hook: custom type serialization -----------------------
def _enc_hook(obj: object) -> str:
    """Foreign boundary: msgspec hook contract requires raise TypeError for unknown types."""
    match obj:
        case Decimal() as d:
            return str(d)
        case datetime() as dt:
            return dt.isoformat()
        case _:
            # Foreign boundary: msgspec enc_hook contract requires TypeError
            raise TypeError(f"Cannot encode {type(obj)}")

def _dec_hook(tp: type, obj: object) -> Decimal | datetime:
    """Foreign boundary: msgspec hook contract requires type/object params."""
    match (tp, obj):
        case (t, str() as s) if t is Decimal:
            return Decimal(s)
        case (t, str() as s) if t is datetime:
            return datetime.fromisoformat(s)
        case _:
            # Foreign boundary: msgspec dec_hook contract requires TypeError
            raise TypeError(f"Cannot decode {tp}")

# -- Module-level encoder/decoder singletons with hooks -------------------
_event_encoder: msgspec.json.Encoder = msgspec.json.Encoder(enc_hook=_enc_hook)
_event_decoder: msgspec.json.Decoder[Union[UserCreated, UserDeleted]] = (
    msgspec.json.Decoder(Union[UserCreated, UserDeleted], dec_hook=_dec_hook)
)

def encode_event(event: EventBase) -> bytes:
    return _event_encoder.encode(event)

def decode_event(raw: bytes) -> Union[UserCreated, UserDeleted]:
    return _event_decoder.decode(raw)

# -- JSON Schema 2020-12 generation for OpenAPI ---------------------------
EVENT_SCHEMA: dict[str, object] = msgspec.json.schema(Union[UserCreated, UserDeleted])
```

[CRITICAL]: `frozen=True` ensures immutability. `gc=False` excludes from garbage collection -- use for short-lived wire objects without circular references. `structs.replace()` for functional updates; `__post_init__` is NOT called. Encoder/decoder are module-level singletons.

---
## [3][CORE_SCHEMA]
>**Dictum:** *Custom core_schema atoms extend Pydantic's Rust validation without Python overhead.*

`__get_pydantic_core_schema__` defines Rust-backed validation. `__get_pydantic_json_schema__` generates OpenAPI docs. `model_validator(mode="before")` receives `cls, data: Any` (preprocessor). `model_validator(mode="after")` receives `self`, returns `Self` (cross-field -- only `after` has typed field access). `model_serializer(mode="wrap")` calls `handler(self)` first then post-processes; `mode="plain"` bypasses defaults. ONE serializer per model max.

```python
# --- [IMPORTS] -------------------------------------------------------------
from typing import Self

from pydantic import BaseModel, SerializerFunctionWrapHandler, model_serializer, model_validator

# --- [CODE] ----------------------------------------------------------------

# -- model_validator: before (preprocessor) vs after (cross-field) --------
class Envelope(BaseModel, frozen=True):
    source: str
    payload: dict[str, object]

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data: dict[str, object] | object) -> dict[str, object] | object:
        match data:
            case {"src": str() as src, **rest}:
                return {"source": src, **rest}
            case _:
                return data

    @model_validator(mode="after")
    def _cross_validate(self) -> Self:
        match self.payload:
            case {}: raise ValueError("payload must not be empty")
            case _: return self

    @model_serializer(mode="wrap")
    def _serialize(self, handler: SerializerFunctionWrapHandler) -> dict[str, object]:
        base: dict[str, object] = handler(self)
        return {**base, "version": 1}
```

[IMPORTANT]: `mode="before"` preprocesses raw data before field validation. `mode="after"` has typed field access for cross-field rules. ONE `model_serializer` per model. See types.md [1] for `__get_pydantic_core_schema__` + `__get_pydantic_json_schema__` atom pattern.

---
## [4][SETTINGS]
>**Dictum:** *Configuration is validated at startup; secrets never leak into domain.*

`pydantic-settings` `BaseSettings` with `SettingsConfigDict` provides layered config: env vars > `.env` file > secrets dir > field defaults. Always `frozen=True`. `@safe` bridges startup validation into `Result`.

```python
# --- [IMPORTS] -------------------------------------------------------------
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from returns.result import safe

# --- [CODE] ----------------------------------------------------------------

class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="PINNACLE_", env_file=".env",
        env_nested_delimiter="__", secrets_dir="/run/secrets", frozen=True,
    )
    service_name: str = Field(min_length=1, default="pinnacle")
    debug: bool = False
    db_url: str = Field(min_length=1, default="postgresql://localhost/pinnacle")
    otel_endpoint: str = "http://localhost:4317"
    max_connections: int = Field(ge=1, le=1000, default=50)

@safe
def load_settings() -> AppSettings:
    return AppSettings()
```

[CRITICAL]: `frozen=True` prevents mutation after startup. Settings loaded once at bootstrap, injected as immutable dependency.

---
## [5][RULES]
>**Dictum:** *Rules compress into constraints.*

- [ALWAYS] Pydantic `TypeAdapter` for inbound validation -- `validate_python`/`validate_json` at boundaries.
- [ALWAYS] `TypeAdapter` initialized eagerly at module level -- never per-request.
- [ALWAYS] `AliasChoices`/`AliasPath` for validation-only field aliasing.
- [ALWAYS] msgspec `Struct(frozen=True, gc=False)` for outbound serialization -- zero-GC wire objects.
- [ALWAYS] `structs.replace()` for functional updates on msgspec Structs.
- [ALWAYS] `enc_hook`/`dec_hook` for custom type serialization -- `match/case` dispatch.
- [ALWAYS] `BaseSettings(frozen=True)` for configuration -- loaded once, injected immutably.
- [ALWAYS] Keyword patterns (`case Model(field=value)`) for variant dispatch -- not `hasattr`/`getattr`.
- [ALWAYS] ONE `model_serializer` per model max.
- [NEVER] Domain models import `msgspec` -- wire formats are adapter-layer concerns.
- [NEVER] `hasattr`/`getattr` for variant detection -- use structural `match/case`.
- [NEVER] `model_validator(mode="before")` for cross-field rules -- only `after` has typed field access.

---
## [6][QUICK_REFERENCE]

- Pydantic ingress: `TypeAdapter.validate_python/json` + `@safe` at boundaries.
- Alias compatibility: `AliasChoices` / `AliasPath` for validation-only field aliasing.
- msgspec egress: `Struct(frozen=True, gc=False)` plus module-level `Encoder`.
- Functional update: `structs.replace()` for immutable struct rewrites.
- Tagged union wire contracts: `tag_field` + `tag` on struct hierarchies.
- Custom encode/decode hooks: `enc_hook` / `dec_hook` with structural `match/case`.
- Custom atoms: `__get_pydantic_core_schema__` + `Annotated`.
- Validator split: `before` for preprocessing, `after` for cross-field invariants.
- Serializer modes: `wrap` post-processes; `plain` bypasses default output.
- Settings boundary: `BaseSettings` with `SettingsConfigDict(frozen=True)`.
- Schema generation: `msgspec.json.schema()` / `schema_components()` for JSON Schema 2020-12 and OpenAPI composition.
