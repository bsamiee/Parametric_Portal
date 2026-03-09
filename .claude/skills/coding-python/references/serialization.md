# Serialization

Three-tier codec boundary for Python 3.14+: Pydantic `TypeAdapter` validates ingress, `dataclass(frozen=True, slots=True)` anchors domain, msgspec `Struct(frozen=True, gc=False)` serializes egress, Suitkaise `cucumber` crosses process boundaries for unpicklable resources. Domain models never import wire libraries.

---

## Codec Architecture

A polymorphic `capture` combinator eliminates all boundary `try/except` repetition -- parameterized on exception type for Pydantic vs cucumber vs arbitrary boundaries. `async_capture` is the async counterpart -- sole `try/except` site for coroutine boundaries. `pipe(raw, validate(adapter), result.bind(transform), result.map(encode))` is the canonical pipeline. `result.bind` and `result.map` are module-level curried functions from `expression` -- never `Result.bind` (unbound instance method).

```python
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Final, Literal

from expression import Error, Ok, Result, curry_flip, pipe, result
from pydantic import TypeAdapter, ValidationError

# --- [ERRORS] -----------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class CodecFault:
    origin: Literal["parse", "transport", "settings"]
    violations: tuple[str, ...]

# --- [FUNCTIONS] --------------------------------------------------------------

def _pydantic_extract(exc: ValidationError) -> tuple[str, ...]:
    return tuple(
        f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()
    )

@curry_flip(1)
def capture[T, E: Exception](
    origin: Literal["parse", "transport", "settings"],
    thunk: Callable[[], T],
    *,
    catch: type[E] = Exception,
    extract: Callable[[E], tuple[str, ...]] = lambda e: (str(e),),
) -> Result[T, CodecFault]:
    """BOUNDARY ADAPTER -- sole try/except site for all sync codec boundaries."""
    try:  # noqa: SIM105
        return Ok(thunk())
    except catch as exc:
        return Error(CodecFault(origin, extract(exc)))

async def async_capture[T, E: Exception](
    origin: Literal["parse", "transport", "settings"],
    thunk: Callable[[], Awaitable[T]],
    *,
    catch: type[E] = Exception,
    extract: Callable[[E], tuple[str, ...]] = lambda e: (str(e),),
) -> Result[T, CodecFault]:
    """BOUNDARY ADAPTER -- sole try/except site for all async codec boundaries."""
    try:  # noqa: SIM105
        return Ok(await thunk())
    except catch as exc:
        return Error(CodecFault(origin, extract(exc)))

@curry_flip(1)
def validate[T](adapter: TypeAdapter[T], raw: bytes, *, source: str = "") -> Result[T, CodecFault]:
    return capture("parse")(
        lambda: adapter.validate_json(raw),
        catch=ValidationError,
        extract=_pydantic_extract,
    )

def ingest[I, D, W](
    adapter: TypeAdapter[I],
    transform: Callable[[I], Result[D, CodecFault]],
    project: Callable[[D], W],
    encoder: "msgspec.json.Encoder",
) -> Callable[[bytes], Result[bytes, CodecFault]]:
    return lambda raw: pipe(
        raw, validate(adapter),
        result.bind(transform),
        result.map(lambda d: encoder.encode(project(d))))
```

`capture` generalizes over exception type via `catch` parameter -- Pydantic boundaries pass `catch=ValidationError, extract=_pydantic_extract`; cucumber boundaries pass `catch=Exception`. `async_capture` mirrors the signature for coroutine boundaries -- the `thunk` returns an `Awaitable[T]` that is `await`ed inside the sole async `try/except`. `ingest` wires the full decode-validate-transform-project-encode pipeline. `_pydantic_extract` is a named function (not lambda assignment per PEP 8 E731) extracting structured violation paths from Pydantic `ValidationError`.

---

## Inbound Validation

Functional validators via `Annotated` compose per-field without `model_validator` ceremony. `Discriminator("method")` resolves the correct subclass from the shared `method: Literal[...]` field -- when the discriminant is a direct field present on all union members, no manual callable or `Tag()` wrappers are needed. `model_validator(mode="before")` is permitted exclusively for wire-shape normalization (field renaming); cross-field rules require `mode="after"`.

```python
from typing import Annotated, Final, Literal, Self

from pydantic import (
    AliasChoices, AliasPath, BaseModel, ConfigDict, Discriminator,
    Field, TypeAdapter, model_serializer, model_validator,
)
from pydantic.functional_validators import BeforeValidator

# --- [SCHEMA:INGRESS] --------------------------------------------------------

type Trimmed = Annotated[str, BeforeValidator(str.strip), Field(min_length=1)]

class _PaymentBase(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    amount: Trimmed

class CardPayment(_PaymentBase, frozen=True):
    method: Literal["card"]
    last_four: Annotated[str, Field(min_length=4, max_length=4)]
    label: str = Field(
        default="",
        validation_alias=AliasChoices("label", AliasPath("meta", "display_name")),
    )

class BankPayment(_PaymentBase, frozen=True):
    method: Literal["bank"]
    iban: Annotated[str, Field(min_length=1)]

type Payment = Annotated[CardPayment | BankPayment, Discriminator("method")]

# --- [SCHEMA:ENVELOPE] -------------------------------------------------------

class Envelope(BaseModel, frozen=True):
    source: str
    payload: dict[str, object]

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data: object) -> object:
        """Wire-shape normalization only -- NOT cross-field validation."""
        match data:
            case {"src": str() as src, **rest}: return {"source": src, **rest}
            case _: return data

    @model_validator(mode="after")
    def _cross_validate(self) -> Self:
        """Pydantic contract: raise ValueError for cross-field violations."""
        match bool(self.payload):
            case False: raise ValueError("payload must not be empty")
            case True: return self

    @model_serializer(mode="wrap")
    def _serialize(self, handler) -> dict[str, object]:
        return {**handler(self), "version": 1}

# --- [CONSTANTS] --------------------------------------------------------------

PaymentAdapter: Final[TypeAdapter[Payment]] = TypeAdapter(Payment)
```

`_PaymentBase` hoists shared `ConfigDict(strict=True)` and `amount: Trimmed` -- subclasses inherit config and common fields without duplication. `ConfigDict` resolves via MRO: when multiple bases define `model_config`, Pydantic merges them silently without warning -- restrict Pydantic base hierarchies to single-inheritance chains to avoid ambiguous config resolution. `Discriminator("method")` resolves the correct subclass when the discriminant is a direct `Literal` field present on all union members -- no callable, no `Tag()` wrappers needed. Reserve the manual `Discriminator(callable)` + `Tag()` pattern for cases where the discriminant requires computation (nested field access, derived value, heterogeneous field names across variants). `Trimmed` collapses strip + nonblank into a single `Annotated` composition -- `str.strip` as `BeforeValidator` (method reference, zero wrapper), `Field(min_length=1)` as structural constraint. `_cross_validate` uses `match bool(self.payload)` since `case {}` in PEP 636 matches ANY mapping (not just empty) -- `bool({})` is `False`, providing the correct emptiness check. `_normalize` accepts `object` (not `dict[str, object] | object` -- `dict` is already a subtype of `object`, so the union is redundant).

---

## Wire Serialization & Schema Evolution

Custom hooks via dispatch table `dict[type, Callable]` -- `_ENC_HOOKS` and `_DEC_HOOKS` map types to codec strategies, `_enc_hook`/`_dec_hook` resolve via table lookup with `Never`-typed fallback. `WireCodec` and `WireDecoder` structural `Protocol`s decouple dispatch tables from concrete encoder classes -- third-party codecs satisfying `.encode(obj) -> bytes` or `.decode(data) -> object` participate without class-identity coupling. Symmetric `_WIRE_ENC`/`_WIRE_DEC` tables wire hook dispatch into all encode/decode paths. Version-dispatched decoding uses `Map.try_find` returning `Option`, converting version miss to typed `CodecFault` via `.to_result`. Forward-compatible via field defaults; backward-compatible via absent `forbid_unknown_fields`.

```python
from datetime import datetime
from decimal import Decimal
from collections.abc import Callable
from typing import Final, Never, Protocol

from expression import Result, curry_flip, pipe, result
from expression.collections import Map
import msgspec
from msgspec import Raw, Struct
from suitkaise.timing import Sktimer, timethis

# --- [TYPES] ------------------------------------------------------------------

class WireCodec(Protocol):
    """Structural contract for wire format codecs -- extensible to third-party encoders."""
    def encode(self, obj: object) -> bytes: ...

class WireDecoder(Protocol):
    """Structural contract for wire format decoders."""
    def decode(self, data: bytes) -> object: ...

# --- [SCHEMA:EVENTS] ---------------------------------------------------------

class EventBase(Struct, frozen=True, gc=False, tag_field="t"):
    ts: str; cid: str

class UserCreated(EventBase, tag="user.created"):
    uid: int; email: str

class UserDeleted(EventBase, tag="user.deleted"):
    uid: int; reason: str

type DomainEvent = UserCreated | UserDeleted

# --- [SCHEMA:VERSIONS] -------------------------------------------------------

class ResponseV1(Struct, frozen=True, gc=False, tag_field="v", tag="1"):
    amount: str

class ResponseV2(ResponseV1, tag="2"):
    precision: int

type VersionedResponse = ResponseV1 | ResponseV2

# --- [SCHEMA:ENVELOPE] -------------------------------------------------------

class WireEnvelope(Struct, frozen=True, gc=False):
    version: int; payload: Raw

# --- [CONSTANTS] --------------------------------------------------------------

def _unsupported(label: str) -> Never:
    raise NotImplementedError(label)

_ENC_HOOKS: Final[dict[type, Callable]] = {Decimal: str, datetime: datetime.isoformat}
_DEC_HOOKS: Final[dict[type, Callable]] = {Decimal: lambda _, v: Decimal(v), datetime: lambda _, v: datetime.fromisoformat(v)}

def _enc_hook(obj: object) -> object:
    """BOUNDARY ADAPTER -- msgspec contract: raise NotImplementedError for unknown."""
    return _ENC_HOOKS.get(type(obj), lambda o: _unsupported(f"enc:{type(o).__name__}"))(obj)

def _dec_hook(tp: type, obj: object) -> object:
    """BOUNDARY ADAPTER -- msgspec contract: raise NotImplementedError for unknown."""
    return _DEC_HOOKS.get(tp, lambda t, o: _unsupported(f"dec:{t.__name__}"))(tp, obj)

_WIRE_ENC: Final[dict[type, WireCodec]] = {
    msgspec.json.Encoder: msgspec.json.Encoder(enc_hook=_enc_hook),
    msgspec.msgpack.Encoder: msgspec.msgpack.Encoder(enc_hook=_enc_hook),
}
_WIRE_DEC: Final[dict[type, Callable[[bytes, type], object]]] = {
    msgspec.json.Encoder: lambda data, tp: msgspec.json.decode(data, type=tp, dec_hook=_dec_hook),
    msgspec.msgpack.Encoder: lambda data, tp: msgspec.msgpack.decode(data, type=tp, dec_hook=_dec_hook),
}
_VERSION_REGISTRY: Final[Map[int, type[VersionedResponse]]] = Map.of_list([
    (1, ResponseV1), (2, ResponseV2),
])

# --- [FUNCTIONS] --------------------------------------------------------------

_encode_perf: Final[Sktimer] = Sktimer(max_times=1000)

@timethis(_encode_perf)
def encode_event(event: EventBase, *, wire: type = msgspec.json.Encoder) -> bytes:
    return _WIRE_ENC[wire].encode(event)

def decode_event(data: bytes, *, wire: type = msgspec.json.Encoder) -> Result[DomainEvent, CodecFault]:
    return capture("parse")(lambda: _WIRE_DEC[wire](data, DomainEvent))

def materialize[T: Struct](envelope: WireEnvelope, target: type[T]) -> T:
    return msgspec.json.decode(envelope.payload, type=target)

def coerce[S: Struct, T: Struct](source: S, target: type[T]) -> T:
    return msgspec.convert(source, target)

@curry_flip(1)
def decode_versioned(
    registry: Map[int, type[VersionedResponse]],
    raw: bytes,
) -> Result[VersionedResponse, CodecFault]:
    envelope = msgspec.json.decode(raw, type=WireEnvelope)
    return pipe(
        registry.try_find(envelope.version)
        .to_result(CodecFault("parse", (f"unknown version: {envelope.version}",))),
        result.bind(lambda target: capture("parse")(
            lambda: msgspec.json.decode(envelope.payload, type=target))))
```

`WireCodec` and `WireDecoder` are structural `Protocol`s -- any object with `.encode(obj) -> bytes` or `.decode(data) -> object` satisfies the contract, enabling third-party encoder extensions without class-identity coupling. `_WIRE_ENC` and `_WIRE_DEC` dispatch tables map wire format types to codec/decoder instances symmetrically -- `_WIRE_DEC` wires `_dec_hook` through `msgspec.json.decode`/`msgspec.msgpack.decode` at call site (module-level decoder allocation eliminated for decoders, reserved for hot-path encoders only). `decode_event` consumes `_WIRE_DEC` and wraps in `capture("parse")` for `Result` error rail -- symmetric counterpart to `encode_event`. `_unsupported` returns `Never` (`typing.Never`) -- the type checker proves all code paths through the fallback raise unconditionally, enabling dead-code elimination in downstream branches. `_WIRE_ENC` dispatch table replaces the boolean-index tuple hack -- `KeyError` on unknown wire types vs silent fallback. `_encode_perf: Final[Sktimer]` tracks the last 1000 encode latencies on a rolling window -- access `_encode_perf.mean`, `.percentile(99)`, `.stdev` for production profiling. `@timethis(_encode_perf)` injects start/stop around every `encode_event` call with zero ceremony. `decode_versioned` composes `Map.try_find` (returns `Option`) with `capture` for deferred `msgspec.json.decode` -- each version's Struct inherits from the previous, adding fields with defaults for forward compatibility.

---

## Transport & Process Boundaries

Suitkaise `cucumber` serializes objects `pickle` cannot handle -- locks, loggers, sockets, database connections, generators, coroutines, executors, context managers. 53 specialized handlers in a priority-ordered registry: custom protocol (`__serialize__`/`__deserialize__`) > `to_dict`/`from_dict` > `__dict__` > `__slots__` > catch-all `ClassInstanceHandler`. Primitive fast-paths (int, float, str, bool, None) bypass handler dispatch entirely.

Serialization produces an intermediate representation (IR) with `__cucumber_type__`, `__handler__`, `__object_id__` metadata for circular reference resolution. Two-pass deserialization: pass 1 registers `_ReconstructionPlaceholder` per `__object_id__`, pass 2 reconstructs recursively replacing `__cucumber_ref__` back-pointers.

`sk.asynced()` routes blocking calls through `asyncio.to_thread` internally. When the codebase uses `anyio` for structured concurrency, `asyncio.to_thread` and `anyio.to_thread.run_sync` are not interchangeable -- `asyncio.to_thread` bypasses anyio's task group cancellation semantics. Transport functions under anyio `TaskGroup` governance must use `anyio.to_thread.run_sync` directly with `capture`/`async_capture` instead of `sk.asynced()`.

```python
from dataclasses import dataclass
from typing import ClassVar, Final, Literal, Protocol, Self, runtime_checkable

from expression import Error, Ok, Result, pipe, result
import structlog
from suitkaise import (
    BreakingCircuit, Circuit, Pool, Share, blocking, sk,
    serialize, deserialize, reconnect_all,
)
from suitkaise.cucumber import Reconnector, serialize_ir, ir_to_jsonable, to_json
from suitkaise.timing import Sktimer, TimeThis, timethis

_transport_log: Final = structlog.get_logger("transport.circuit")

# --- [PROTOCOL] ---------------------------------------------------------------

@runtime_checkable
class Transportable(Protocol):
    """Priority 1 in cucumber's 53-handler strategy hierarchy.
    Implement for domain objects needing deterministic serialization."""
    def __serialize__(self) -> object: ...
    @classmethod
    def __deserialize__(cls, state: object) -> Self: ...

# --- [IR INSPECTION] ----------------------------------------------------------

def inspect_ir(obj: object, *, verbose: bool = False) -> dict:
    """Intermediate representation without pickling -- handler dispatch, circular refs visible."""
    return serialize_ir(obj, verbose=verbose)

def to_debug_json(obj: object, *, indent: int = 2) -> str:
    """Full IR -> JSON string for transport debugging / logging."""
    return to_json(obj, indent=indent, sort_keys=True)

def to_portable_dict(obj: object) -> object:
    """IR -> JSON-safe dict for cross-language boundaries.
    Handles: bytes (base64), complex, Decimal, UUID, Path, datetime, deque, Counter."""
    return ir_to_jsonable(serialize_ir(obj))

# --- [BLOCKING MARKERS] -------------------------------------------------------

@blocking
def _serialize_blocking(obj: object) -> bytes:
    """cucumber.serialize is opaque to sk AST analysis -- @blocking forces detection."""
    return serialize(obj)

@blocking
def _deserialize_blocking(data: bytes) -> object:
    """cucumber.deserialize is opaque to sk AST analysis -- @blocking forces detection."""
    return deserialize(data)

# --- [TRANSPORT CORE] ---------------------------------------------------------

_transport_circuit: Final[BreakingCircuit] = BreakingCircuit(
    5, sleep_time_after_trip=2.0, backoff_factor=2.0, max_sleep_time=30.0, jitter=0.5,
)
_transport_perf: Final[Sktimer] = Sktimer(max_times=500)

@timethis(_transport_perf)
def freeze(obj: object) -> Result[bytes, CodecFault]:
    """Serialize to bytes via cucumber IR + pickle. Circuit-breaks after 5 consecutive failures."""
    match _transport_circuit.broken:
        case True:
            return Error(CodecFault("transport", ("circuit open: transport breaker tripped",)))
        case False:
            outcome = capture("transport")(lambda: serialize(obj), catch=Exception)
            match outcome:
                case Error(value=fault):
                    _transport_circuit.short()
                    _transport_log.warning("transport_fault",
                        total_trips=_transport_circuit.total_trips,
                        sleep_time=_transport_circuit.current_sleep_time,
                        p99_latency=_transport_perf.percentile(99),
                        mean_latency=_transport_perf.mean,
                        fault_origin=fault.origin,
                        violations=fault.violations,
                    )
                case _:
                    pass
            return outcome

_thaw_sk = sk(_deserialize_blocking).retry(
    times=3, delay=0.5, backoff_factor=2.0, exceptions=(Exception,),
).timeout(10)

def thaw(data: bytes) -> Result[object, CodecFault]:
    """Deserialize with retry (3x, 0.5s exponential backoff) and 10s hard timeout."""
    return capture("transport")(lambda: _thaw_sk(data), catch=Exception)

# --- [ASYNC TRANSPORT] --------------------------------------------------------

_freeze_async = sk(_serialize_blocking).asynced()
_thaw_async = sk(_deserialize_blocking).asynced().retry(
    times=3, delay=0.5, backoff_factor=2.0,
).timeout(10)

async def freeze_async(obj: object) -> Result[bytes, CodecFault]:
    """Async serialize via asyncio.to_thread -- use anyio.to_thread.run_sync under TaskGroup."""
    return await async_capture("transport", lambda: _freeze_async(obj))

async def thaw_async(data: bytes) -> Result[object, CodecFault]:
    """Async deserialize with retry + timeout -- use anyio.to_thread.run_sync under TaskGroup."""
    return await async_capture("transport", lambda: _thaw_async(data))

# --- [RECONNECTION] -----------------------------------------------------------

_RECONNECT_AUTH: Final[dict[str, object]] = {
    "db_host": "localhost", "db_port": 5432, "db_user": "app",
    "socket_addr": ("0.0.0.0", 8080),
}
"""Auth dict is kwarg-keyed: DbReconnector consumes db_*, SocketReconnector consumes socket_*,
ThreadReconnector consumes target/daemon, SubprocessReconnector consumes args/cwd/env.
Each Reconnector subclass picks its own kwargs -- unrecognized keys are ignored."""

def reconnect(obj: object, *, start_threads: bool = False) -> Result[object, CodecFault]:
    """Resolve all Reconnector stubs post-deserialization.
    DbReconnector, SocketReconnector, ThreadReconnector, PipeReconnector, SubprocessReconnector.
    reconnect_all traverses the full object graph recursively."""
    return capture("transport")(
        lambda: reconnect_all(obj, start_threads=start_threads, **_RECONNECT_AUTH),
        catch=Exception,
    )

def verify_reconnected[T](obj: T) -> Result[T, CodecFault]:
    """Guard: reconnect_all returns Reconnector stubs unchanged on individual failure.
    Structural match on Reconnector base class -- no hasattr/getattr detection."""
    match obj:
        case Reconnector():
            return Error(CodecFault("transport", (f"unresolved Reconnector: {type(obj).__name__}",)))
        case _:
            return Ok(obj)

def full_transport_pipeline(data: bytes, *, start_threads: bool = False) -> Result[object, CodecFault]:
    """Thaw -> reconnect -> verify -- complete deserialization with reconnection guarantee."""
    return pipe(
        data, thaw,
        result.bind(lambda obj: reconnect(obj, start_threads=start_threads)),
        result.bind(verify_reconnected),
    )

# --- [CUSTOM TRANSPORTABLE] ---------------------------------------------------

@dataclass(frozen=True, slots=True)
class SessionState:
    """Domain object implementing Transportable for deterministic cucumber serialization.
    __serialize__ extracts picklable state; __deserialize__ reconstructs from IR."""
    user_id: int
    token_hash: str
    permissions: tuple[str, ...]

    def __serialize__(self) -> dict[str, object]:
        return {"user_id": self.user_id, "token_hash": self.token_hash,
                "permissions": list(self.permissions)}

    @classmethod
    def __deserialize__(cls, state: dict[str, object]) -> Self:
        return cls(state["user_id"], state["token_hash"], tuple(state["permissions"]))

# --- [CROSS-PROCESS STATE] ----------------------------------------------------

def shared_transport_state() -> Share:
    """Share wraps coordinator-proxy pattern with cucumber backbone for IPC.
    Attribute assignment auto-generates _shared_meta via @sk AST analysis.
    PrimitiveProxy provides atomic augmented assignment (+=, -=) cross-process.

    Classes using __getattr__-based delegation or descriptor protocols are invisible
    to sk AST analysis -- provide manual _shared_meta dict mapping method names to
    {"reads": set[str], "writes": set[str], "has_return_value": bool} for accurate
    Share synchronization. Without it, Share cannot determine which attributes a method
    reads/writes, causing silent state desync across processes."""
    shared = Share()
    shared.processed_count = 0
    shared.circuit = Circuit(
        3, sleep_time_after_trip=1.0, backoff_factor=1.5,
    )
    shared.perf = Sktimer(max_times=200)
    return shared

def batch_freeze(objects: list[object], *, workers: int = 4) -> list[bytes]:
    """Parallel serialization via Pool -- cucumber handles cross-process transfer."""
    return Pool(workers=workers).map(serialize, objects)
```

`Transportable` Protocol mirrors cucumber's `__serialize__`/`__deserialize__` contract (highest priority in the 53-handler registry). `_serialize_blocking`/`_deserialize_blocking` carry the `@blocking` marker because cucumber's internal calls are opaque to `sk` AST analysis -- without the marker, `sk(fn).asynced()` raises `SkModifierError` ("no blocking calls detected"). `freeze` composes `BreakingCircuit` (5 shorts to trip, 2s sleep with 2x backoff, 30s max, 0.5s jitter) with `capture` and emits a structured log on every `short()` pairing circuit state (`total_trips`, `current_sleep_time`) with timer metrics (`p99_latency`, `mean_latency`) and fault detail -- closing the gap between circuit state and alerting infrastructure. `_thaw_sk` chains `sk` modifiers on `_deserialize_blocking`: `.retry(times=3, delay=0.5, backoff_factor=2.0)` for transient failures with exponential backoff, `.timeout(10)` as a hard deadline via `ThreadPoolExecutor`.

`freeze_async`/`thaw_async` use `async_capture` (not sync `capture`) to properly `await` the coroutines returned by `sk.asynced()`. The async transport functions note the `anyio` caveat: `sk.asynced()` uses `asyncio.to_thread` internally, which bypasses `anyio` task group cancellation semantics -- under `anyio.create_task_group()` governance, use `anyio.to_thread.run_sync` with `async_capture` directly instead.

`verify_reconnected` uses structural `match/case` on the `Reconnector` base class (class pattern) instead of `hasattr`/`getattr` probing -- adhering to the [NEVER] rule. `SessionState.__deserialize__` returns `Self` (PEP 673) instead of a string forward reference. `_RECONNECT_AUTH` is typed `dict[str, object]` reflecting the heterogeneous kwargs consumed by different Reconnector subclasses. `Share` synchronization depends on `_shared_meta` generated by `@sk` AST analysis -- classes using `__getattr__`-based delegation, descriptor protocols, or dynamically-constructed methods must provide manual `_shared_meta` dicts for accurate cross-process attribute synchronization.

---

## Settings

`BaseSettings(frozen=True)` loaded once at bootstrap via `capture`, injected as immutable dependency. `SecretStr` redacts from logs/repr.

```python
from expression import Result
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="APP_", env_file=".env",
        env_nested_delimiter="__", secrets_dir="/run/secrets", frozen=True,
    )
    service_name: str = Field(min_length=1, default="app")
    debug: bool = False
    db_url: SecretStr = Field(default=SecretStr("postgresql://localhost/app"))
    max_connections: int = Field(ge=1, le=1000, default=50)

def load_settings() -> Result[AppSettings, CodecFault]:
    return capture("settings")(AppSettings, catch=ValidationError, extract=_pydantic_extract)
```

`load_settings` reuses `capture` with `catch=ValidationError` -- zero standalone `try/except`. Settings class demonstrates `SecretStr`, `SettingsConfigDict`, and constraint validators in 10 lines.

---

## Rules

- [ALWAYS] `capture(origin)(thunk, catch=E, extract=fn)` for all sync boundary exception handling -- sole `try/except` site.
- [ALWAYS] `async_capture(origin, thunk, catch=E, extract=fn)` for all async boundary exception handling -- sole async `try/except` site.
- [ALWAYS] `result.bind`/`result.map` (module-level curried functions) in `pipe` -- never `Result.bind` (unbound method).
- [ALWAYS] Pydantic `TypeAdapter` at module level -- never per-request.
- [ALWAYS] `BeforeValidator`/`AfterValidator` via `Annotated` for field-level transforms -- prefer over `model_validator`.
- [ALWAYS] `model_validator(mode="after")` for cross-field rules; `mode="before"` exclusively for wire-shape normalization.
- [ALWAYS] `Discriminator("field")` (string form) when discriminant is a direct `Literal` field on all union members -- no callable, no `Tag()` wrappers.
- [ALWAYS] `Discriminator(callable)` + `Tag()` only when discriminant requires computation (nested access, derived value, heterogeneous field names) -- callable returns `Literal` with `assert_never` on wildcard.
- [ALWAYS] Single-inheritance chains for Pydantic `BaseModel` hierarchies sharing `model_config` -- `ConfigDict` merges silently via MRO without warning on multi-base conflicts.
- [ALWAYS] msgspec `Struct(frozen=True, gc=False)` for egress wire objects.
- [ALWAYS] `enc_hook`/`dec_hook` via dispatch table `dict[type, Callable]` raising `NotImplementedError` -- never `TypeError`, never guard-based `if`.
- [ALWAYS] Symmetric `_WIRE_ENC`/`_WIRE_DEC` dispatch tables -- `_WIRE_DEC` wires `dec_hook` at call site; module-level decoder allocation reserved for hot-path encoders only.
- [ALWAYS] `WireCodec`/`WireDecoder` structural `Protocol` for wire format extensibility -- never class-identity coupling via `type[Encoder]`.
- [ALWAYS] `msgspec.msgpack` for internal service-to-service boundaries -- JSON for external only.
- [ALWAYS] `msgspec.Raw` for deferred payload decode in versioned envelopes.
- [ALWAYS] `msgspec.convert` for Struct-to-Struct coercion -- never manual field mapping.
- [ALWAYS] `BaseSettings(frozen=True)` with `SecretStr` for sensitive fields.
- [ALWAYS] Suitkaise `cucumber` exclusively for cross-process transport of unpicklable objects.
- [ALWAYS] `Transportable` Protocol (`__serialize__`/`__deserialize__`) for custom cucumber serialization -- highest priority in 53-handler hierarchy.
- [ALWAYS] `@blocking` decorator on functions wrapping opaque blocking calls (C extensions, cucumber, external libs) -- `sk` AST analysis cannot detect these.
- [ALWAYS] `sk` modifiers (`.retry()`, `.timeout()`, `.asynced()`) on transport boundary functions -- never hand-rolled retry/timeout loops.
- [ALWAYS] `BreakingCircuit` at transport boundaries with repeated failure potential -- `short()` on failure, check `.broken` before attempt.
- [ALWAYS] Structured log emission on every circuit `short()` pairing circuit state (`total_trips`, `current_sleep_time`) with timer metrics (`p99_latency`, `mean_latency`) and fault detail.
- [ALWAYS] `Sktimer` with `@timethis` for transport/encode/decode latency profiling -- rolling window via `max_times`.
- [ALWAYS] `Share` for cross-process shared state -- never raw `multiprocessing.Value`/`Manager`.
- [ALWAYS] Manual `_shared_meta` dict on classes using `__getattr__`, descriptor protocols, or dynamically-constructed methods -- `sk` AST analysis cannot detect dynamic attribute access patterns.
- [ALWAYS] `Pool.map` for batch cucumber serialization -- never manual `multiprocessing.Pool` with pickle.
- [ALWAYS] `reconnect_all` + `verify_reconnected` after deserialization of objects with unpicklable resources.
- [ALWAYS] `serialize_ir`/`ir_to_jsonable`/`to_json` for transport debugging -- never `json.dumps(vars(obj))`.
- [ALWAYS] PEP 695 `type` aliases for union definitions.
- [ALWAYS] `Never` return type (`typing.Never`) on functions that unconditionally raise -- enables type-checker dead-code analysis.
- [ALWAYS] `Self` return type (PEP 673) on classmethods returning instances -- never string forward references.
- [ALWAYS] `anyio.to_thread.run_sync` with `async_capture` for transport under `anyio.create_task_group()` -- `sk.asynced()` uses `asyncio.to_thread` which bypasses anyio cancellation.
- [NEVER] Domain models import `msgspec` or `suitkaise` -- wire/transport formats are adapter-layer.
- [NEVER] `hasattr`/`getattr` for variant detection -- structural `match/case` only (use class patterns for `Reconnector` etc.).
- [NEVER] Per-request `TypeAdapter`/`Encoder`/`Decoder` construction.
- [NEVER] `json.loads()` + `validate_python()` -- use `validate_json()` (single-pass).
- [NEVER] `cucumber` for wire-format serialization -- msgspec owns ingress/egress codecs.
- [NEVER] Standalone `try/except` outside `capture`/`async_capture` -- all exception handling routes through the combinators.
- [NEVER] Hand-rolled retry loops, sleep-based backoff, or thread-pool timeouts -- `sk` modifiers own these concerns.
- [NEVER] Raw `pickle` for cross-process transport -- `cucumber` handles all IPC serialization.
- [NEVER] Manual `multiprocessing.Process`/`Queue`/`Pipe` -- use `Skprocess`, `Pool`, `Share`, `Pipe.pair`.
- [NEVER] `.asynced()` on functions without detected blocking calls -- `sk` raises `SkModifierError`. Use `@blocking` marker for opaque calls.
- [NEVER] Lambda assignment to identifiers -- use `def` (PEP 8 E731). Lambda in default args and dispatch table values is acceptable.
- [NEVER] `sk.asynced()` under `anyio.create_task_group()` -- `asyncio.to_thread` escapes anyio structured concurrency.

---

## Quick Reference

| Pattern                                | When                                   | Key Trait                                      |
| -------------------------------------- | -------------------------------------- | ---------------------------------------------- |
| `capture(origin)(thunk, catch=E)`      | Sync boundary into `Result`            | Parameterized exc type; sole sync `try/except` |
| `async_capture(origin, thunk)`         | Async boundary into `Result`           | `await`s thunk; sole async `try/except`        |
| `validate(adapter)`                    | Ingress (HTTP, queue, file)            | Curried; `pipe` + `result.bind`                |
| `ingest(adapter, xform, proj, enc)`    | Full ingress-to-egress pipeline        | decode -> validate -> transform -> encode      |
| `BeforeValidator` / `AfterValidator`   | Field-level ingress transforms         | `Annotated` stacking; zero wrappers            |
| `Discriminator("field")`               | Union dispatch (direct Literal field)  | String form; no callable, no `Tag()`           |
| `Discriminator(callable)` + `Tag`      | Union dispatch (computed discriminant) | Returns `Literal`; `assert_never` on wildcard  |
| `model_validator(mode="after")`        | Cross-field invariants                 | Typed field access; returns `Self`             |
| `Struct(frozen=True, gc=False)`        | Egress wire objects                    | `tag_field` unions; zero-GC                    |
| `_ENC_HOOKS` / `_DEC_HOOKS`            | Custom type hooks                      | `dict[type, Callable]`; merge-extensible       |
| `msgspec.Raw`                          | Deferred versioned payload             | Partial parse; version-then-materialize        |
| `msgspec.convert`                      | Struct-to-Struct coercion              | Type-safe; no manual field mapping             |
| `_WIRE_ENC` / `_WIRE_DEC` dispatch     | Wire format (JSON / MsgPack)           | `WireCodec` Protocol; `KeyError` on unknown    |
| `decode_event`                         | Symmetric counterpart to encode        | `_WIRE_DEC` + `capture` for `Result` rail      |
| `serialize` / `deserialize`            | Cross-process unpicklable transport    | 53-handler IR; circular ref resolution         |
| `Transportable` Protocol               | Custom cucumber contract               | Priority 1; `__serialize__`/`__deser__`        |
| `decode_versioned(registry)`           | Version-dispatched decoding            | `Map.try_find` -> `Option` -> `Result`         |
| `BaseSettings(frozen=True)`            | Config at startup                      | Layered: env > .env > secrets > defaults       |
| `@blocking` + `sk(fn).asynced()`       | Opaque blocking -> async               | AST-invisible calls need explicit marker       |
| `sk(fn).retry().timeout()`             | Resilient transport boundary           | Composable; backoff + hard deadline            |
| `BreakingCircuit(n, sleep, backoff)`   | Trip after repeated failures           | Broken until `.reset()`; jitter + backoff      |
| `_transport_log.warning` on `short()`  | Circuit trip observability             | Circuit state + timer metrics + fault          |
| `Sktimer(max_times=N)` + `@timethis`   | Rolling latency profiling              | `.mean`, `.percentile(p)`, `.stdev`            |
| `Share()` + attribute assignment       | Cross-process shared state             | Auto-proxy: `PrimitiveProxy` / `ObjectProxy`   |
| Manual `_shared_meta` dict             | `__getattr__` / descriptor classes     | Required when sk AST analysis is blind         |
| `Pool(workers=N).map(serialize, objs)` | Batch parallel serialization           | cucumber IPC; ordered results                  |
| `serialize_ir` / `ir_to_jsonable`      | IR inspection / debug                  | `__cucumber_type__`, `__object_id__` metadata  |
| `reconnect_all(obj, **auth)`           | Post-deser resource reconnection       | Recursive traversal; 6 Reconnector subtypes    |
| `full_transport_pipeline(data)`        | Thaw -> reconnect -> verify            | `pipe` + `result.bind`; zero partial states    |
