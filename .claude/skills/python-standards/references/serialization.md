# [H1][SERIALIZATION]
>**Dictum:** *Pydantic validates ingress; msgspec encodes egress; domain code touches neither raw bytes nor untyped dicts.*

<br>

Serialization in Python 3.14+ uses a dual-library boundary: Pydantic `TypeAdapter` validates ingress with `model_validator`/`model_serializer` hooks, msgspec `Struct(frozen=True, gc=False)` serializes egress. Domain models never handle raw wire formats. All snippets assume `pydantic >= 2.12`, `msgspec >= 0.20`, `pydantic-settings >= 2.12`, with `match/case` dispatch only. See types.md [1] for atom-level `__get_pydantic_core_schema__` patterns.

---
## [1][INBOUND_VALIDATION_PIPELINE]
>**Dictum:** *Validate once at ingress via eager TypeAdapter; extend via model_validator/model_serializer hooks; dispatch variants via structural match/case.*

<br>

`TypeAdapter(type, *, config=ConfigDict(...))` compiles Pydantic core schema once -- create at module level (expensive construction). `validate_json()` returns typed objects; `validate_python()` for dict/object input; `json_schema()` for OpenAPI generation. `@safe` bridges `ValidationError` into `Result`. `model_validator(mode="before")` receives `cls, data: Any` (preprocessor). `model_validator(mode="after")` receives `self`, returns `Self` (cross-field -- only `after` has typed field access). `model_serializer(mode="wrap")` calls `handler(self)` first then post-processes; `mode="plain"` bypasses defaults. ONE serializer per model max.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from typing import Annotated, Literal, Self

import msgspec
from pydantic import (
    AliasChoices,
    AliasPath,
    BaseModel,
    ConfigDict,
    Discriminator,
    Field,
    SerializerFunctionWrapHandler,
    Tag,
    TypeAdapter,
    model_serializer,
    model_validator,
)
from returns.result import Result, safe
from pinnacle.domain.atoms import Email, Money

# --- [SCHEMA] -----------------------------------------------------------------

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
    Annotated[CardPayment, Tag("card")] | Annotated[BankPayment, Tag("bank")],
    Discriminator(_payment_disc),
]

# -- model_validator: before (preprocessor) vs after (cross-field) ---------

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
            case {}:
                raise ValueError("payload must not be empty")
            case _:
                return self
    @model_serializer(mode="wrap")
    def _serialize(self, handler: SerializerFunctionWrapHandler) -> dict[str, object]:
        base: dict[str, object] = handler(self)
        return {**base, "version": 1}

# --- [CONSTANTS] --------------------------------------------------------------

PaymentAdapter: TypeAdapter[Payment] = TypeAdapter(Payment)
UserAdapter: TypeAdapter[Email] = TypeAdapter(Email)
PAYMENT_SCHEMA: dict[str, object] = PaymentAdapter.json_schema()

# --- [FUNCTIONS] --------------------------------------------------------------

@safe
def validate_payment(raw: bytes) -> Payment:
    return PaymentAdapter.validate_json(raw)

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
        lambda payment: _encoder.encode(to_response(payment))
    )
```

[CRITICAL]: `TypeAdapter` at module level -- never per-request. `model_validator(mode="before")` preprocesses raw data before field validation. `model_validator(mode="after")` has typed field access for cross-field rules. ONE `model_serializer` per model. `@safe` bridges into `Result` railway. See types.md [1] for `__get_pydantic_core_schema__` + `__get_pydantic_json_schema__` atom-level patterns.

---
## [2][MSGSPEC_STRUCTS]
>**Dictum:** *Egress structs are frozen, GC-exempt, and tag-discriminated.*

<br>

`msgspec.Struct(frozen=True, gc=False)` produces zero-allocation C-backed objects excluded from garbage collection. `tag`/`tag_field` for discriminated unions. `msgspec.structs.replace()` for functional updates (NOTE: `__post_init__` NOT called by `replace`). Custom type handling via `enc_hook`/`dec_hook` passed to `Encoder`/`Decoder` or via `Annotated[T, Meta(enc_hook=...)]`. `msgspec.json.schema(type)` outputs JSON Schema 2020-12; `schema_components` for multi-type OpenAPI specs. See performance.md [3] for throughput benchmarks.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from datetime import datetime
from decimal import Decimal

import msgspec
from msgspec import Struct, structs

# --- [SCHEMA] -----------------------------------------------------------------

class EventBase(Struct, frozen=True, gc=False, tag_field="event_type"):
    timestamp: str
    correlation_id: str

class UserCreated(EventBase, tag="user.created"):
    user_id: int
    email: str

class UserDeleted(EventBase, tag="user.deleted"):
    user_id: int
    reason: str

# -- structs.replace: functional update (NOTE: __post_init__ NOT called) ---
updated: UserCreated = structs.replace(
    UserCreated(timestamp="2025-01-01", correlation_id="c1", user_id=1, email="a@b.com"),
    email="new@b.com",
)

# --- [FUNCTIONS] --------------------------------------------------------------

def _enc_hook(obj: object) -> str:
    """Foreign boundary: msgspec hook contract requires raise TypeError for unknown types."""
    match obj:
        case Decimal() as decimal_value:
            return str(decimal_value)
        case datetime() as dt_value:
            return dt_value.isoformat()
        case _:
            raise TypeError(f"Cannot encode {type(obj)}")

def _dec_hook(tp: type, obj: object) -> Decimal | datetime:
    """Foreign boundary: msgspec hook contract requires type/object params."""
    match (tp, obj):
        case (target, str() as raw) if target is Decimal:
            return Decimal(raw)
        case (target, str() as raw) if target is datetime:
            return datetime.fromisoformat(raw)
        case _:
            raise TypeError(f"Cannot decode {tp}")

# --- [CONSTANTS] --------------------------------------------------------------

_event_encoder: msgspec.json.Encoder = msgspec.json.Encoder(enc_hook=_enc_hook)
_event_decoder: msgspec.json.Decoder[UserCreated | UserDeleted] = (
    msgspec.json.Decoder(UserCreated | UserDeleted, dec_hook=_dec_hook)
)
EVENT_SCHEMA: dict[str, object] = msgspec.json.schema(UserCreated | UserDeleted)

# --- [FUNCTIONS] --------------------------------------------------------------

def encode_event(event: EventBase) -> bytes:
    return _event_encoder.encode(event)

def decode_event(raw: bytes) -> UserCreated | UserDeleted:
    return _event_decoder.decode(raw)
```

[CRITICAL]: `frozen=True` ensures immutability. `gc=False` excludes from garbage collection -- use for short-lived wire objects without circular references. `structs.replace()` for functional updates; `__post_init__` is NOT called. Encoder/decoder are module-level singletons.

---
## [3][SETTINGS]
>**Dictum:** *Configuration is validated at startup; secrets never leak into domain.*

<br>

`pydantic-settings` `BaseSettings` with `SettingsConfigDict` provides layered config: env vars > `.env` file > secrets dir > field defaults. Always `frozen=True`. `@safe` bridges startup validation into `Result`. Settings loaded once at bootstrap, injected as immutable dependency via reader monad. See protocols.md [2] for typed DI composition.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from returns.result import safe

# --- [SCHEMA] -----------------------------------------------------------------

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

# --- [FUNCTIONS] --------------------------------------------------------------

@safe
def load_settings() -> AppSettings:
    return AppSettings()
```

[CRITICAL]: `frozen=True` prevents mutation after startup. Settings loaded once at bootstrap, injected as immutable dependency. Layered precedence: env vars > `.env` file > secrets dir > field defaults.

---
## [4][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] Pydantic `TypeAdapter` for inbound validation -- `validate_python`/`validate_json` at boundaries.
- [ALWAYS] `TypeAdapter` initialized eagerly at module level -- never per-request.
- [ALWAYS] `AliasChoices`/`AliasPath` for validation-only field aliasing.
- [ALWAYS] `model_validator(mode="after")` for cross-field rules -- only `after` has typed field access.
- [ALWAYS] msgspec `Struct(frozen=True, gc=False)` for outbound serialization -- zero-GC wire objects.
- [ALWAYS] `structs.replace()` for functional updates on msgspec Structs.
- [ALWAYS] `enc_hook`/`dec_hook` for custom type serialization -- `match/case` dispatch.
- [ALWAYS] `BaseSettings(frozen=True)` for configuration -- loaded once, injected immutably.
- [ALWAYS] Keyword patterns (`case Model(field=value)`) for variant dispatch -- not `hasattr`/`getattr`.
- [ALWAYS] ONE `model_serializer` per model max.
- [ALLOW] `expression.collections.Block[T]` as alternative to `tuple[T, ...]` in msgspec struct fields for frozen collection semantics.
- [NEVER] Domain models import `msgspec` -- wire formats are adapter-layer concerns.
- [NEVER] `hasattr`/`getattr` for variant detection -- use structural `match/case`.
- [NEVER] `model_validator(mode="before")` for cross-field rules -- only `after` has typed field access.

---
## [5][QUICK_REFERENCE]
>**Dictum:** *Patterns indexed by shape and intent.*

<br>

| [INDEX] | [PATTERN]                        | [WHEN]                                         | [KEY_TRAIT]                                    |
| :-----: | -------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
|   [1]   | `TypeAdapter.validate_json`      | Ingress boundary (HTTP, queue, file)           | Eager module-level init; `@safe` into Result   |
|   [2]   | `AliasChoices` / `AliasPath`     | Wire field names differ from domain            | Validation-only aliasing                       |
|   [3]   | `Discriminator` + `Tag`          | Union dispatch on ingress                      | Callable or field-based discriminator          |
|   [4]   | `model_validator(mode="before")` | Preprocessing raw data before field validation | Receives `cls, data`; returns normalized data  |
|   [5]   | `model_validator(mode="after")`  | Cross-field invariant enforcement              | Has typed field access; returns `Self`         |
|   [6]   | `model_serializer(mode="wrap")`  | Post-processing default serialization output   | Calls `handler(self)` then transforms          |
|   [7]   | `Struct(frozen=True, gc=False)`  | Egress wire objects (events, responses)        | Zero-GC C-backed; tag-discriminated unions     |
|   [8]   | `structs.replace()`              | Functional update on msgspec Structs           | `__post_init__` NOT called                     |
|   [9]   | `enc_hook` / `dec_hook`          | Custom type serialization (Decimal, datetime)  | `match/case` dispatch; module-level singletons |
|  [10]   | `BaseSettings(frozen=True)`      | App config validated at startup                | Layered: env > .env > secrets > defaults       |
|  [11]   | `msgspec.json.schema()`          | JSON Schema 2020-12 / OpenAPI generation       | `schema_components` for multi-type specs       |
