# [H1][PATTERNS]
>**Dictum:** *Expert knowledge is knowing which landmines to avoid and which gates to enforce.*

<br>

Anti-pattern codex with corrective examples for Python 3.14+ functional modules. For operational checklists, see `validation.md`.

---
## [1][ANTI_PATTERN_CODEX]
>**Dictum:** *Each anti-pattern is a local decision that compounds into global drag.*

<br>

### Inline Anti-Patterns

**HASATTR_GETATTR** -- ANTI-PATTERN: `return getattr(obj, "name", "unknown")` -- CORRECT: `case object(name=name):` structural pattern matching. See `types.md` [4].

**MUTABLE_MODELS** -- ANTI-PATTERN: `class Config(BaseModel): timeout: float` -- CORRECT: `class Config(BaseModel, frozen=True): timeout: Annotated[float, Field(gt=0)]`. See `serialization.md` [1].

**RAISE_CONTROL_FLOW** -- ANTI-PATTERN: `raise NotFoundError(f"user {uid}")` -- CORRECT: `maybe_to_result(find_in_db(uid), default_error=NotFoundError(...))`. See `effects.md` [1].

**NONE_RETURNS** -- ANTI-PATTERN: `def find_user(uid: UserId) -> User | None:` -- CORRECT: `-> Maybe[User]` (absence) or `-> Result[User, RepoError]` (failure). See `effects.md` [1].

**IMPORT_TIME_IO** -- ANTI-PATTERN: `db = connect_to_database("postgresql://...")  # module level` -- CORRECT: Defer to `boot()` at composition root. See `serialization.md` [3].

**BARE_COLLECTION** -- ANTI-PATTERN: `def get_scores() -> list[dict[str, Any]]:` -- CORRECT: `-> tuple[tuple[UserId, Money], ...]` or `-> Block[Score]`. See `types.md` [6].

**MODEL_WITH_BEHAVIOR** -- ANTI-PATTERN: `class Order(BaseModel, frozen=True): async def persist(self, db):` -- CORRECT: Models are pure data; logic in `ops/` pipelines via `flow()`. See `effects.md` [3].

**ANY_CAST_ERASURE** -- ANTI-PATTERN: `data: Any = get_payload()` -- CORRECT: `data: dict[str, object]` + `TypeForm` + `beartype.is_bearable()` for narrowing. See `types.md` [4].

**PRIMITIVE_OBSESSION** -- ANTI-PATTERN: `def create_user(email: str, balance: int):` -- CORRECT: `def create_user(email: Email, balance: Money) -> Result[User, AtomError]:`. See `types.md` [1].

**INHERITANCE_HIERARCHIES** -- ANTI-PATTERN: `class Repository(ABC): @abstractmethod ...` -- CORRECT: `class Repository(Protocol[T]): ...` structural subtyping. See `protocols.md` [1].

**WRAPS_ONLY_ERASURE** -- ANTI-PATTERN: `def logged(func: Callable[..., Any]):` -- CORRECT: `def logged[**P, R](func: Callable[P, R]) -> Callable[P, R]:` with `ParamSpec`. See `decorators.md` [1].

**STRING_ERROR_DISPATCH** -- ANTI-PATTERN: `if "not found" in str(err):` -- CORRECT: `match err: case NotFound(entity=entity):` typed variant dispatch. See `effects.md` [3].

**MUTABLE_STATE** -- ANTI-PATTERN: `CACHE: dict[str, str] = {}` -- CORRECT: `_cache: ContextVar[tuple[tuple[str, str], ...]] = ContextVar("cache", default=())`. See `concurrency.md` [2].

**DATACLASS_FOR_VALIDATION** -- ANTI-PATTERN: `@dataclass class UserInput: email: str` -- CORRECT: `class UserInput(BaseModel, frozen=True): email: Email`. Reserve `dataclass(frozen=True, slots=True)` for error types only. See `types.md` [3].

**IMPERATIVE_LOOPS** -- ANTI-PATTERN: `results = []; for x in xs: results.append(f(x))` -- CORRECT: `tuple(map(transform, items))` or `functools.reduce(...)` for folds. See `algorithms.md` [1].

**FRAMEWORK_FIRST** -- ANTI-PATTERN: `from fastapi import Depends  # in domain/service.py` -- CORRECT: Domain depends on Protocol ports only; framework imports in adapters/runtime. See `protocols.md` [1].

### Complex Anti-Patterns

**IMPERATIVE_BRANCHING**
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
        case Success(CardPayment(amount=Money(cents=cents), last_four=last_four)) if cents > 100_00:
            return HttpResponse(status=200, body=f"Large card {last_four}: {cents}")
        case Success(CardPayment(last_four=last_four)):
            return HttpResponse(status=200, body=f"Card: {last_four}")
        case Success(BankPayment(iban=iban)):
            return HttpResponse(status=200, body=f"Bank: {iban}")
        case Failure(NotFoundError(entity=entity, identifier=identifier)):
            return HttpResponse(status=404, body=f"{entity}/{identifier}")
        case Failure(err):
            return HttpResponse(status=500, body=err.message)
        case _:
            return HttpResponse(status=500, body="unexpected outcome")
```
Nested structural destructuring on `Result` + domain union with guard clauses. See `types.md` [2], `effects.md` [3].

**BARE_TRY_EXCEPT**
> **DETECT:** `grep -rn "^\s*try:\|^\s*except " --include="*.py" | grep -v "adapters/"`

**Violation:**
```python
def parse_age(raw: str) -> int:
    try: return int(raw)
    except ValueError: raise ValueError("invalid age")
```
**Resolution:**
```python
@safe
def parse_age(raw: str) -> int:
    return int(raw)

def validate_age(age: int) -> Result[int, ValidationError]:
    match age:
        case n if 0 < n < 150: return Success(n)
        case _: return Failure(ValidationError(field="age", message=f"out of range: {age}"))

def process_age(raw: str) -> Result[int, Exception]:
    return flow(raw, parse_age, bind(validate_age))
```
`@safe` captures exceptions into `Result[T, Exception]`, composable via `flow()` + `bind`. See `effects.md` [1].

**UNWRAP_MID_PIPELINE**
> **DETECT:** `grep -rn "\.unwrap()\|\.value_or(\|\.failure()" --include="*.py" | grep -v "adapters/"`

**Violation:**
```python
def process_order(raw: bytes) -> Result[OrderId, Exception]:
    parsed: dict[str, object] = parse_input(raw).unwrap()
    validated: Order = validate(parsed).unwrap()
    return persist(validated)
```
**Resolution:**
```python
def process_order(raw: bytes) -> Result[OrderId, Exception]:
    return flow(raw, parse_input, bind(validate), bind(persist))
```
`.unwrap()` short-circuits the error channel into untyped `UnwrapFailedError`. Reserve `.value_or()` for terminal boundaries only. See `effects.md` [1].

**BARE_FLOW_WITHOUT_BIND**
> **DETECT:** `grep -rn "flow(" --include="*.py" -A 5 | grep -v "bind\|map_\|lash\|alt"` (manual review)

**Violation:**
```python
def process(raw: bytes) -> Result[Result[UserId, Exception], Exception]:
    return flow(raw, parse_input, validate, persist)
```
**Resolution:**
```python
def process(raw: bytes) -> Result[UserId, Exception]:
    return flow(raw, parse_input, bind(validate), bind(persist))
```
Without `bind()`, Result nests: `Result[Result[T, E], E]`. Only the first stage omits `bind()`. See `effects.md` [1].

**GOD_DECORATOR**
> **DETECT:** `grep -rn "@handle_everything\|@do_all" --include="*.py"`

**Violation:**
```python
@handle_everything  # auth + logging + caching + retry + tracing
def process(data: Input) -> Output: ...
```
**Resolution:**
```python
@trace_span(TraceConfig(span_name="process"))
@retry(RetryConfig(max_attempts=3), on=IOError)
@cache_result(CacheConfig(ttl=300))
def process(data: Input) -> Output: ...
```
One decorator per concern; canonical ordering: trace > retry > cache > validate > authorize. See `decorators.md` [2].

**MISSING_CHECKPOINT**
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
CPU-bound async loops starve the event loop. `checkpoint()` yields control for cooperative scheduling. See `concurrency.md` [1].

**MAP_SIDE_EFFECT_ABUSE**
> **DETECT:** `grep -rn "tuple(map.*start_soon\|tuple(map.*send\b" --include="*.py"`

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
`map` is for pure transformations. `tuple(map(side_effect))` abuses map as a loop driver and allocates a discarded tuple. At side-effect boundaries, use explicit `for` with a boundary comment.

**BOOLEAN_MATCH_ABUSE**
> **DETECT:** `grep -rn "match.*True\|case True:\|case False:" --include="*.py"`

**Violation:**
```python
def validate_positive(number: int) -> Result[int, str]:
    match number > 0:
        case True: return Success(number)
        case False: return Failure("not positive")
```
**Resolution:**
```python
def validate_positive(number: int) -> Result[int, str]:
    match number:
        case value if value > 0: return Success(value)
        case _: return Failure("not positive")
```
`match True/False` is `if/else` in disguise. Use guard clauses (`case value if pred:`) for conditional validation.

### Library-Mixing Anti-Patterns

**MIXED_RESULT_LIBRARIES**
> **DETECT:** `grep -rn "from expression import.*Result\|from expression import.*Ok" --include="*.py"` cross-referenced with `grep -rn "from returns.result import" --include="*.py"` in same file

**Violation:**
```python
from expression import Ok, Error as ExprError
from returns.result import Success, Failure

def transform(order: Order) -> Success[Order]:
    validated: Ok[Order] = validate_domain(order)  # expression Result
    return Success(validated.value)  # returns Result -- MIXED
```
**Resolution:** ONE library's `Result`/`Option` per module. Domain modules use `expression`; pipeline modules use `returns`. Bridge at layer boundaries via `match/case`. See SKILL.md [8].

**EXPRESSION_PIPE_IN_RETURNS_FLOW**
> **DETECT:** `grep -rn "expression.pipe\|from expression import pipe" --include="*.py"` in files containing `from returns.pipeline import flow`

ANTI-PATTERN: `expression.pipe(value, step_a, step_b)` in a `returns.flow()` module.
CORRECT: Use `returns.flow(value, step_a, bind(step_b))` consistently. `expression.pipe` and `returns.flow` are equivalent left-to-right composition -- choose one per module. See SKILL.md [8].

---
## [2][ERROR_SYMPTOMS]
>**Dictum:** *Symptoms point to structural causes; fixes are architectural.*

<br>

| [INDEX] | [SYMPTOM]                                    | [CAUSE]                        | [FIX]                                             |
| :-----: | -------------------------------------------- | ------------------------------ | ------------------------------------------------- |
|   [1]   | `isinstance(result, Success)` checks         | Imperative branching           | `match/case` structural destructuring             |
|   [2]   | `-> X | None` in domain signature            | None-based architecture        | `Maybe[T]` or `expression.Option[T]`              |
|   [3]   | `try/except` outside adapters                | Exception-driven control flow  | `@safe` / `Result[T, E]` error channel            |
|   [4]   | `Result[Result[T, E], E]` nested type        | Missing `bind()` in `flow()`   | Wrap monadic stages in `bind()`                   |
|   [5]   | `.unwrap()` in domain/ops code               | Mid-pipeline extraction        | Keep on railway; extract at terminal boundary     |
|   [6]   | `from expression import Ok` + `from returns` | Mixed Result libraries         | ONE library per module; bridge at boundaries      |
|   [7]   | `list[...]` / `dict[...]` in model fields    | Mutable collections            | `tuple[...]` / `Block[T]` / `frozenset[...]`      |
|   [8]   | `class X(BaseModel):` without `frozen=True`  | Mutable model                  | Add `frozen=True` to class declaration            |
|   [9]   | `@decorator` erasing `*args, **kwargs` types | Missing `ParamSpec`            | `ParamSpec` + `Concatenate` + `@wraps`            |
|  [10]   | `while True:` without `await` in body        | Missing cooperative checkpoint | `await checkpoint()` or `await sleep(0)`          |
|  [11]   | `hasattr(obj, "name")` in domain code        | Dynamic attribute probing      | `match obj: case object(name=name):` pattern      |
|  [12]   | `Any` in domain/ops type annotations         | Type erasure                   | `object` + `TypeForm` narrowing or concrete types |

---
## [3][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                  | [CATEGORY]           | [KEY_TRAIT]                                       |
| :-----: | -------------------------- | -------------------- | ------------------------------------------------- |
|   [1]   | IMPERATIVE_BRANCHING       | Control flow         | Exhaustive `match/case` + guards                  |
|   [2]   | BOOLEAN_MATCH_ABUSE        | Control flow         | Guard clauses over `match True/False`             |
|   [3]   | HASATTR_GETATTR            | Control flow         | Structural keyword patterns                       |
|   [4]   | BARE_TRY_EXCEPT            | Effect integrity     | `@safe` at boundaries + `Result` in domain        |
|   [5]   | RAISE_CONTROL_FLOW         | Effect integrity     | `Failure(...)` / `maybe_to_result`                |
|   [6]   | NONE_RETURNS               | Effect integrity     | `Maybe` (absence) / `Result` (failure)            |
|   [7]   | UNWRAP_MID_PIPELINE        | Effect integrity     | Railway stays intact; extract at terminal only    |
|   [8]   | BARE_FLOW_WITHOUT_BIND     | Effect integrity     | `bind()` wraps every monadic stage in `flow()`    |
|   [9]   | MUTABLE_MODELS             | Type integrity       | `frozen=True` + strict `ConfigDict`               |
|  [10]   | ANY_CAST_ERASURE           | Type integrity       | `TypeForm` + `beartype` narrowing                 |
|  [11]   | BARE_COLLECTION            | Type integrity       | `tuple`/`frozenset`/`Block[T]` over mutable       |
|  [12]   | MODEL_WITH_BEHAVIOR        | Architecture         | Models are carriers; logic in pipelines           |
|  [13]   | IMPORT_TIME_IO             | Architecture         | Defer IO to `boot()` at composition root          |
|  [14]   | GOD_DECORATOR              | Decorator discipline | One concern per decorator; canonical ordering     |
|  [15]   | MAP_SIDE_EFFECT_ABUSE      | Concurrency          | Explicit `for` at side-effect boundaries          |
|  [16]   | MISSING_CHECKPOINT         | Concurrency          | `checkpoint()` in CPU-bound async loops           |
|  [17]   | PRIMITIVE_OBSESSION        | Type integrity       | Typed atoms replace raw `str`/`int`/`Decimal`     |
|  [18]   | INHERITANCE_HIERARCHIES    | Architecture         | `Protocol` over `ABC`; structural subtyping       |
|  [19]   | WRAPS_ONLY_ERASURE         | Decorator discipline | `ParamSpec` + `Concatenate` + `@wraps`            |
|  [20]   | STRING_ERROR_DISPATCH      | Control flow         | Typed variant `match/case` over string inspection |
|  [21]   | MUTABLE_STATE              | Concurrency          | `ContextVar` + frozen snapshots                   |
|  [22]   | DATACLASS_FOR_VALIDATION   | Type integrity       | `BaseModel(frozen=True)` over plain `@dataclass`  |
|  [23]   | IMPERATIVE_LOOPS           | Control flow         | `map`/`reduce`/`accumulate` over `for`            |
|  [24]   | FRAMEWORK_FIRST            | Architecture         | Protocol ports in domain; framework in adapters   |
|  [25]   | MIXED_RESULT_LIBRARIES     | Library discipline   | ONE Result/Option library per module              |
|  [26]   | EXPRESSION_PIPE_IN_RETURNS | Library discipline   | `flow` in returns modules; `pipe` in expression   |
