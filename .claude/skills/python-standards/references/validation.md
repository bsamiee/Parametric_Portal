# [H1][VALIDATION]
>**Dictum:** *Operational criteria verify Python 3.14+ standards compliance.*

Checklist for auditing `.py` modules against python-standards contracts. Items below are not fully enforced by ty or ruff and require human/agent judgment.

---
## [1][TYPE_INTEGRITY]

- [ ] One canonical schema per entity -- no duplicate model definitions across files
- [ ] Domain primitives use typed atoms (`NewType`/`Annotated`) -- raw `str`/`int` absent from public signatures
- [ ] Smart constructors return `Result[T, E]` -- never raise for invalid input
- [ ] All `BaseModel` subclasses declare `frozen=True`
- [ ] All `@dataclass` definitions include `frozen=True, slots=True`
- [ ] Discriminated unions use `Discriminator` + `Tag` + `TypeAdapter`
- [ ] Immutable collections: `tuple` over `list`, `frozenset` over `set`, `Mapping` over `dict`

---
## [2][EFFECT_INTEGRITY]

- [ ] `Result[T, E]` for synchronous fallible ops -- `map`/`bind` chain; `match` at boundaries only
- [ ] `Maybe[T]` for semantic absence -- not `Optional[T]` conflating absence with failure
- [ ] `FutureResult[T, E]` for async fallible ops -- async `map`/`bind` pipeline
- [ ] `@safe` at foreign boundaries only -- domain code returns `Result` explicitly
- [ ] Zero `try`/`except` in `domain/` or `ops/`
- [ ] No `Result` unwrapping mid-pipeline -- zero `.unwrap()` / `.value_or()` / `.failure()` in domain or ops code
- [ ] `flow()` + pointfree `bind`/`map_`/`lash` as primary composition -- not method chaining for 3+ stages
- [ ] Monadic law compliance for custom bind implementations: left identity, right identity, associativity

---
## [3][CONTROL_FLOW]

- [ ] Zero `if`/`else`/`elif` -- `match`/`case` exhaustive dispatch only
- [ ] Zero `for`/`while` in pure/domain transforms -- boundary loops only with explicit side-effect comments
- [ ] Exhaustive `match`/`case` with `case _:` defensive arm on all dispatches
- [ ] Guard clauses via `case x if predicate:` -- not bare `if` statements

---
## [4][DECORATOR_INTEGRITY]

- [ ] Every decorator uses `ParamSpec` + `Concatenate` + `@wraps`
- [ ] Canonical ordering: trace > retry > cache > validate > authorize
- [ ] One concern per decorator -- no god decorators
- [ ] Decorator factories accept frozen `BaseModel` config objects
- [ ] Class-based decorators implement descriptor protocol (`__set_name__` + `__get__`)

---
## [5][CONCURRENCY_INTEGRITY]

- [ ] `anyio.create_task_group()` as sole spawn mechanism -- no bare `asyncio.create_task`
- [ ] `anyio.lowlevel.checkpoint()` in tight async loops
- [ ] `CapacityLimiter` for backpressure -- no unbounded concurrency
- [ ] `ContextVar` for request-scoped state -- no global mutable singletons
- [ ] `CancelScope` with explicit deadlines -- no unbounded timeouts

---
## [6][SURFACE_QUALITY]

- [ ] No helper spam: private functions called from 2+ sites or inlined
- [ ] No class proliferation: Protocol in `protocols/`, implementations in `adapters/`
- [ ] No DTO soup: one frozen model per entity, derive variants at call site
- [ ] No framework coupling: domain/ops import zero framework types
- [ ] No import-time IO: module-level code is pure; IO deferred to `boot()`

---
## [7][DIAGNOSTIC_TABLE]

| [CAUSE]                  | [GREP_ID] | [FIX]                                        |
| ------------------------ | --------- | -------------------------------------------- |
| Optional masking failure | `G1`      | `Maybe[T]` then `.to_result()` at boundary   |
| Exception control flow   | `G2`      | `@safe` at edge, `Result[T, E]` in domain    |
| Imperative iteration     | `G3`      | Comprehension or `map` over immutable output |
| Nominal dispatch         | `G4`      | Structural `match`/`case`                    |
| ABC-based interface      | `G5`      | `Protocol` structural typing                 |
| Signature erasure        | `G6`      | `ParamSpec[P]` + `Callable[P, R]`            |
| Mutable domain model     | `G7`      | Set `frozen=True`                            |
| Bare collection          | `G8`      | Validate via frozen model or `TypeAdapter`   |
| Unstructured concurrency | `G9`      | Use `TaskGroup` + `start_soon`               |
| Unstructured logging     | `G10`     | Emit key-value structured logs               |
| Global mutable state     | `G11`     | `ContextVar[tuple[...]]` snapshot state      |
| Bare primitive I/O       | `G12`     | Typed atoms + `Result[T, E]`                 |
| Import-time IO           | `G13`     | Defer initialization to `boot()`             |
| Imperative branching     | `G14`     | Exhaustive `match`/`case`                    |
| `hasattr`/`getattr`      | `G15`     | `case object(attr=value)` patterns           |

`GREP_ID` commands (prefer `rg`):
- `G1`: `rg -n "is None:" -g "*.py"`
- `G2`: `rg -n "^\s*except " -g "*.py"`
- `G3`: `rg -n "^\s*for " -g "*.py"`
- `G4`: `rg -n "isinstance\\(" -g "*.py"`
- `G5`: `rg -n "class.*ABC|from abc import" -g "*.py"`
- `G6`: `rg -n "Callable\\[\\.\\.\\.," -g "*.py"`
- `G7`: `rg -n "class.*BaseModel" -g "*.py"`
- `G8`: `rg -n "-> list\\[|-> dict\\[" -g "*.py"`
- `G9`: `rg -n "asyncio\\.create_task|asyncio\\.gather" -g "*.py"`
- `G10`: `rg -n "logging\\.info\\(f\\\"|logger\\.info\\(f\\\"" -g "*.py"`
- `G11`: `rg -n "^[A-Z_]*: dict|= \\[\\]|= \\{\\}" -g "*.py"`
- `G12`: `rg -n "def .*: str\\) -> str:" -g "*.py"`
- `G13`: `rg -n "^db = |^conn = |^client = " -g "*.py"`
- `G14`: `rg -n "^\s*if |^\s*elif " -g "*.py"`
- `G15`: `rg -n "hasattr\\(|getattr\\(" -g "*.py"`

---
## [8][QUICK_REFERENCE]

- `TYPE_INTEGRITY`: `types.md` [1]-[4].
- `EFFECT_INTEGRITY`: `effects.md` [1]-[4].
- `CONTROL_FLOW`: `patterns.md` [1].
- `DECORATOR_INTEGRITY`: `decorators.md` [1], [5].
- `CONCURRENCY_INTEGRITY`: `concurrency.md` [1], [4].
- `SURFACE_QUALITY`: `protocols.md` [1], [3].
- `DIAGNOSTIC_TABLE`: section [7] in this file.
