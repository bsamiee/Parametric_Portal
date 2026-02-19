# [H1][PATTERNS]
>**Dictum:** *Expert knowledge is knowing which landmines to avoid and which gates to enforce.*

Anti-pattern codex with inline grep detection for Python 3.14+ functional modules. For operational checklists, see `validation.md`.

---
## [1][ANTI_PATTERN_CODEX]
>**Dictum:** *Each anti-pattern is a local decision that compounds into global drag.*

### [MUTABLE_STATE]
> **DETECT:** `grep -rn "= \[\]\|= {}\|^[A-Z_]*: dict\|^[A-Z_]*: list" --include="*.py"`

**Violation:** `CACHE: dict[str, str] = {}`
**Resolution:** `_cache: ContextVar[tuple[tuple[str, str], ...]] = ContextVar("cache", default=())`
Shared mutable state races under free-threading (PEP 779). `ContextVar` provides task-local snapshots; frozen tuples prevent mutation. See `concurrency.md` [5].

### [IMPERATIVE_BRANCHING]
> **DETECT:** `grep -rn "^\s*if \|^\s*elif \|^\s*else:" --include="*.py"`

**Violation:**
```python
def handle_outcome(result: Result[Payment, DomainError]) -> HttpResponse:
    if isinstance(result, Success):
        payment = result.unwrap()
        if isinstance(payment, CardPayment):
            return HttpResponse(status=200, body=f"Card: {payment.last_four}")
        elif isinstance(payment, BankPayment):
            return HttpResponse(status=200, body=f"Bank: {payment.iban}")
    elif isinstance(result, Failure):
        return HttpResponse(status=500, body=str(result.failure()))
    return HttpResponse(status=500, body="unexpected outcome")
```
**Resolution:**
```python
def handle_outcome(result: Result[Payment, DomainError]) -> HttpResponse:
    match result:
        case Success(CardPayment(amount=Money(cents=c), last_four=last_four)) if c > 100_00:
            return HttpResponse(status=200, body=f"Large card {last_four}: {c}")
        case Success(CardPayment(last_four=last_four)):
            return HttpResponse(status=200, body=f"Card: {last_four}")
        case Success(BankPayment(iban=iban)):
            return HttpResponse(status=200, body=f"Bank: {iban}")
        case Failure(NotFoundError(entity=entity, identifier=ident)):
            return HttpResponse(status=404, body=f"{entity}/{ident}")
        case Failure(err):
            return HttpResponse(status=500, body=err.message)
        case _:
            return HttpResponse(status=500, body="unexpected outcome")
```
Nested structural destructuring on `Result` + domain union with guard clauses. `match`/`case` provides compiler-verifiable exhaustive dispatch. See `types.md` [3], `effects.md` [4].

### [IMPERATIVE_LOOPS]
> **DETECT:** `grep -rn "^\s*for \|^\s*while " --include="*.py"`

**Violation:** `results: list[str] = []; for item in items: results.append(transform(item))`
**Resolution:** `results: tuple[str, ...] = tuple(map(transform, items))`
For accumulation (fold): `total: int = functools.reduce(lambda acc, x: acc + x, items, 0)`.
For running totals (scan): `running: tuple[int, ...] = tuple(itertools.accumulate(items))`.
For flattening: `flat: tuple[T, ...] = tuple(itertools.chain.from_iterable(nested))`.
`map`/`filter`/`reduce`/`accumulate` express intent declaratively and produce immutable results. See `effects.md` [1].

### [HASATTR_GETATTR]
> **DETECT:** `grep -rn "hasattr(\|getattr(" --include="*.py"`

**Violation:** `return getattr(obj, "name", "unknown")`
**Resolution:**
```python
def extract_name(obj: object) -> str:
    match obj:
        case object(name=name):
            return name
        case _:
            return "unknown"
```
Structural pattern matching via `case object(attr=value):` provides type-safe dispatch ty can verify. See `types.md` [4].

### [BARE_TRY_EXCEPT]
> **DETECT:** `grep -rn "^\s*try:\|^\s*except " --include="*.py" | grep -v "adapters/"`

**Violation:**
```python
def parse_age(raw: str) -> int:
    try: return int(raw)
    except ValueError: raise ValueError("invalid age")
```
**Resolution:**
```python
from returns.pipeline import flow
from returns.pointfree import bind
from returns.result import safe

@safe
def parse_age(raw: str) -> int:
    return int(raw)

def validate_age(age: int) -> Result[int, ValidationError]:
    match age:
        case n if 0 < n < 150: return Success(n)
        case _: return Failure(ValidationError(field="age", message=f"out of range: {age}"))

# @safe makes parse_age composable in a flow() pipeline:
def process_age(raw: str) -> Result[int, Exception]:
    return flow(raw, parse_age, bind(validate_age))
```
`@safe` captures exceptions into `Result[T, Exception]`, making failure visible and composable via `flow()` + `bind`. See `effects.md` [1].

### [MUTABLE_MODELS]
> **DETECT:** `grep -rn "class.*BaseModel" --include="*.py" | grep -v "frozen=True"`

**Violation:** `class Config(BaseModel): timeout: float`
**Resolution:** `class Config(BaseModel, frozen=True): timeout: Annotated[float, Field(gt=0)]`
`frozen=True` enforces immutability and enables hashing. See `serialization.md` [2].

### [RAISE_CONTROL_FLOW]
> **DETECT:** `grep -rn "^\s*raise " --include="*.py" | grep -v "adapters/"`

**Violation:** `raise NotFoundError(f"user {uid}")`
**Resolution:**
```python
from returns.converters import maybe_to_result
from returns.maybe import maybe

@maybe
def find_in_db(uid: UserId) -> User | None:
    """@maybe bridges None-returning lookup into Maybe[User]."""
    return db.get(uid)

def find_user(uid: UserId) -> Result[User, NotFoundError]:
    """Bridge Maybe -> Result: absence becomes typed NotFoundError."""
    return maybe_to_result(
        find_in_db(uid),
        default_error=NotFoundError(entity="User", identifier=str(uid)),
    )
```
`@maybe` wraps the None-returning lookup; `maybe_to_result` bridges `Maybe` to `Result` with a typed error. The bare `db.get()` call never leaks into domain code unwrapped. See `effects.md` [1], [2].

### [NONE_RETURNS]
> **DETECT:** `grep -rn "-> .*| None\|-> Optional\[" --include="*.py" | grep -v "__init__\|-> None:"`

**Violation:** `def find_user(uid: UserId) -> User | None:`
**Resolution:** `def find_user(uid: UserId) -> Maybe[User]:` (absence) / `def fetch_user(uid: UserId) -> Result[User, RepoError]:` (failure)
`Optional[T]` conflates "absent" with "failed". `Maybe[T]` for absence, `Result[T, E]` for failure. See `effects.md` [2].

### [STRING_ERROR_DISPATCH]
> **DETECT:** `grep -rn "in str(err)\|str(e)\|\"not found\" in" --include="*.py"`

**Violation:** `case s if "not found" in s: return Response(status=404)`
**Resolution:**
```python
def map_error(err: object) -> Response:
    match err:
        case NotFound(entity=entity):
            return Response(status=404, body=entity)
        case Forbidden(reason=reason):
            return Response(status=403, body=reason)
        case _:
            return Response(status=500, body="unknown error")
```
Type dispatch via `match`/`case` on tagged variants is exhaustive and refactor-safe. See `effects.md` [2].

### [INHERITANCE_HIERARCHIES]
> **DETECT:** `grep -rn "class.*ABC\|from abc import" --include="*.py"`

**Violation:** `class Repository(ABC): @abstractmethod async def get(self, uid: str) -> dict: ...`
**Resolution:** `class Repository(Protocol[T]): async def get(self, uid: UserId) -> Result[T, RepoError]: ...`
`Protocol` provides structural subtyping -- any class satisfying the shape is valid without inheriting. See `protocols.md` [1].

### [PRIMITIVE_OBSESSION]
> **DETECT:** `grep -rn "def .*email: str\|def .*amount: int\|def .*-> dict\[" --include="*.py"`

**Violation:** `def create_user(email: str, balance: int) -> dict[str, str]:`
**Resolution:** `def create_user(email: Email, balance: Money) -> Result[User, AtomError]:`
Typed atoms via `NewType`/`Annotated` shrink the input space to valid values only. See `types.md` [1].

### [WRAPS_ONLY_ERASURE]
> **DETECT:** `grep -rn "Callable\[\.\.\.," --include="*.py"`

**Violation:** `def logged(func: Callable[..., Any]) -> Callable[..., Any]:`
**Resolution:**
```python
def logged[**P, R](func: Callable[P, R]) -> Callable[P, R]:
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        return func(*args, **kwargs)
    return wrapper
```
Without `ParamSpec`, decorated functions degrade to `(*args: Any, **kwargs: Any) -> Any`. See `decorators.md` [1].

### [IMPORT_TIME_IO]
> **DETECT:** `grep -rn "^db = \|^conn = \|^client = \|^settings = " --include="*.py"`

**Violation:** `db = connect_to_database("postgresql://localhost/app")  # module level`
**Resolution:** `def boot() -> AppSettings: return AppSettings()  # reads env at call time`
Module-level IO breaks testability and free-threaded safety. Defer to `boot()` at composition root. See `serialization.md` [4].

### [BARE_COLLECTION]
> **DETECT:** `grep -rn "def .*-> list\[\|def .*-> dict\[" --include="*.py"`

**Violation:** `def get_scores() -> list[dict[str, Any]]:`
**Resolution:** `def get_scores() -> tuple[tuple[UserId, Money], ...]:`
`tuple` with explicit type parameters preserves structural immutability. See `types.md` [5].

### [MODEL_WITH_BEHAVIOR]
> **DETECT:** `grep -rn "class.*BaseModel" -A 10 --include="*.py" | grep "async def\|def .*self.*db"`

**Violation:** `class Order(BaseModel, frozen=True): ... async def persist(self, db: Database) -> None:`
**Resolution:** Models are pure data carriers; logic lives in `ops/` pipelines composed via `flow()`/`pipe()`. See `effects.md` [3].

### [GOD_DECORATOR]
> **DETECT:** `grep -rn "@handle_everything\|@do_all" --include="*.py"`

**Violation:** `@handle_everything  # auth + logging + caching + retry + tracing`
**Resolution:**
```python
@trace_span(TraceConfig(span_name="process"))
@retry(RetryConfig(max_attempts=3), on=IOError)
@cache_result(CacheConfig(ttl=300))
def process(data: Input) -> Output: ...
```
One decorator per concern; canonical ordering: trace > retry > cache > validate > authorize. See `decorators.md` [5].

### [GLOBAL_MUTABLE_ASYNC]
> **DETECT:** `grep -rn "^[A-Z_]*: dict\|^_.*: list\|^_.*= {}" --include="*.py" | grep -v "ContextVar"`

**Violation:** `_CACHE: dict[str, bytes] = {}`
**Resolution:** `_cache: ContextVar[tuple[tuple[str, bytes], ...]] = ContextVar("cache", default=())`
Module-level mutable dicts race under free-threading (PEP 779) and async task interleaving. `ContextVar` provides task-local snapshots; immutable tuple snapshots prevent mutation. See `concurrency.md` [5].

### [MISSING_CHECKPOINT]
> **DETECT:** `grep -rn "while True\|async for" --include="*.py" | grep -v "checkpoint\|sleep\|await"`

**Violation:**
```python
async def poll_forever(queue: Queue[bytes]) -> None:
    while True:
        item = queue.get_nowait()
        process(item)
```
**Resolution:**
```python
async def poll_forever(queue: Queue[bytes]) -> None:
    from anyio.lowlevel import checkpoint
    while True:
        item = queue.get_nowait()
        process(item)
        await checkpoint()
```
CPU-bound async loops starve the event loop. `checkpoint()` yields control, enabling cooperative scheduling. See `concurrency.md` [3].

### [FRAMEWORK_FIRST]
> **DETECT:** `grep -rn "from flask\|from django\|from fastapi" --include="*.py" | grep -v "adapters/"`

**Violation:** `from fastapi import Depends  # in domain/service.py`
**Resolution:** Domain and ops modules depend on `Protocol` ports, never on framework types. Framework imports belong in `/adapters` and `/runtime` only. See `protocols.md` [2].

### [ANY_CAST_ERASURE]
> **DETECT:** `grep -rn "Any\|cast(Any" --include="*.py"`

**Violation:** `data: Any = get_payload()` / `result = cast(Any, value)`
**Resolution:** `data: dict[str, object] = get_payload()` / Use `TypeForm` + `beartype.is_bearable()` for runtime narrowing instead of `cast(Any, ...)`. `Any` erases the downstream type graph entirely. See `types.md` [4].

### [BOOLEAN_MATCH_ABUSE]
> **DETECT:** `grep -rn "match.*>.*:\|match.*True\|case True:\|case False:" --include="*.py"`

**Violation:**
```python
def validate_positive(n: int) -> Result[int, str]:
    match n > 0:
        case True: return Success(n)
        case False: return Failure("not positive")
```
**Resolution:**
```python
def validate_positive(n: int) -> Result[int, str]:
    match n:
        case v if v > 0: return Success(v)
        case _: return Failure("not positive")
```
`match True/False` is `if/else` in disguise. `match/case` is for structural dispatch on algebraic data -- use guard clauses (`case v if pred:`) for conditional validation. Boolean `case True:/case False:` provides zero exhaustiveness benefit over ternary.

### [MAP_SIDE_EFFECT_ABUSE]
> **DETECT:** `grep -rn "tuple(map.*setattr\|tuple(map.*start_soon\|tuple(map.*send\b" --include="*.py"`

**Violation:**
```python
tuple(map(
    lambda pair: task_group.start_soon(worker, pair[0], pair[1]),
    enumerate(items),
))
```
**Resolution:**
```python
# Side-effect boundary: task spawning is inherently imperative IO.
for index, item in enumerate(items):
    task_group.start_soon(worker, index, item)
```
`map` is for pure transformations. Using `tuple(map(side_effect))` abuses `map` as a loop driver, allocates a discarded tuple of `None`, and hides imperative intent behind a functional API. At side-effect boundaries (task spawning, `setattr`, I/O), use an explicit `for` loop with a boundary comment.

### [UNWRAP_MID_PIPELINE]
> **DETECT:** `grep -rn "\.unwrap()\|\.value_or(\|\.failure()" --include="*.py" | grep -v "adapters/\|runtime/"`

**Violation:**
```python
def process_order(raw: bytes) -> Result[OrderId, Exception]:
    parsed: dict[str, object] = parse_input(raw).unwrap()  # BREAKS the railway
    validated: Order = validate(parsed).unwrap()
    return persist(validated)
```
**Resolution:**
```python
from returns.pipeline import flow
from returns.pointfree import bind

def process_order(raw: bytes) -> Result[OrderId, Exception]:
    return flow(raw, parse_input, bind(validate), bind(persist))
```
`.unwrap()` short-circuits the error channel, converting typed `Failure` into an untyped `UnwrapFailedError` exception. This defeats monadic composition entirely. `.value_or()` and `.failure()` have the same problem -- they extract from the railway mid-pipeline. Reserve `.value_or()` for terminal boundaries only (e.g., HTTP response construction). See `effects.md` [2].

### [BARE_FLOW_WITHOUT_BIND]
> **DETECT:** `grep -rn "flow(" --include="*.py" -A 5 | grep -v "bind\|map_\|lash\|alt"` (manual review needed)

**Violation:**
```python
def process(raw: bytes) -> Result[Result[UserId, Exception], Exception]:
    return flow(raw, parse_input, validate, persist)
    # validate returns Result -- without bind(), Result nests: Result[Result[...]]
```
**Resolution:**
```python
from returns.pointfree import bind

def process(raw: bytes) -> Result[UserId, Exception]:
    return flow(raw, parse_input, bind(validate), bind(persist))
```
When a stage returns `Result[T, E]`, it MUST be wrapped in `bind()` inside `flow()`. Without `bind()`, the Result nests: `Result[Result[T, E], E]`. Only the first stage (which receives the raw value, not a Result) omits `bind()`. This is the most common `returns` footgun. See `effects.md` [2].

### [DATACLASS_FOR_VALIDATION]
> **DETECT:** `grep -rn "@dataclass" --include="*.py" | grep -v "frozen=True\|slots=True\|Error\|Exception"`

**Violation:**
```python
@dataclass
class UserInput:
    email: str
    age: int
```
**Resolution:**
```python
class UserInput(BaseModel, frozen=True):
    model_config = ConfigDict(strict=True)
    email: Email
    age: Annotated[int, Field(gt=0, lt=150)]
```
Plain `dataclass` provides no runtime validation. Pydantic `BaseModel(frozen=True)` with `ConfigDict(strict=True)` gives Rust-backed validation, immutability, and JSON Schema generation. Reserve `dataclass(frozen=True, slots=True)` for error types only. See `types.md` [2], `serialization.md` [3].

---
## [2][QUICK_REFERENCE]

- Dispatch and control flow:
  - `IMPERATIVE_BRANCHING`, `BOOLEAN_MATCH_ABUSE`: replace with exhaustive `match/case` plus guards.
  - `HASATTR_GETATTR`: replace with structural keyword patterns.
  - `STRING_ERROR_DISPATCH`: replace string checks with variant matching.
- Effect and pipeline integrity:
  - `BARE_TRY_EXCEPT`, `RAISE_CONTROL_FLOW`: use `@safe` at boundaries and `Failure(...)` in domain flow.
  - `NONE_RETURNS`: use `Maybe` (absence) or `Result` (failure), never `Optional` for fallible paths.
  - `UNWRAP_MID_PIPELINE`, `BARE_FLOW_WITHOUT_BIND`: keep the railway intact; bind monadic stages explicitly.
- Type and model integrity:
  - `PRIMITIVE_OBSESSION`, `BARE_COLLECTION`: enforce typed atoms and immutable signatures.
  - `MUTABLE_MODELS`, `DATACLASS_FOR_VALIDATION`: use frozen strict `BaseModel` for validated input models.
  - `ANY_CAST_ERASURE`: replace `Any`/`cast(Any, ...)` with `TypeForm` + runtime narrowing.
- Architecture boundaries:
  - `INHERITANCE_HIERARCHIES`: use `Protocol` capability ports over `abc.ABC`.
  - `FRAMEWORK_FIRST`: keep framework imports in adapters/runtime only.
  - `MODEL_WITH_BEHAVIOR`: keep models as carriers; move IO/business flow to pipelines.
  - `IMPORT_TIME_IO`: defer side effects to explicit bootstrap.
- Concurrency and shared state:
  - `MUTABLE_STATE`, `GLOBAL_MUTABLE_ASYNC`: use `ContextVar` immutable snapshots.
  - `MISSING_CHECKPOINT`: add cooperative checkpoints in hot async loops.
  - `MAP_SIDE_EFFECT_ABUSE`: use explicit boundary loops for side effects.
- Decorator discipline:
  - `WRAPS_ONLY_ERASURE`: preserve signatures with `ParamSpec` + `@wraps`.
  - `GOD_DECORATOR`: split concerns and enforce canonical ordering.
