# [H1][VALIDATION]
>**Dictum:** *Operational criteria verify Python 3.14+ standards compliance.*

<br>

Checklist for auditing `.py` modules against python-standards contracts. Items below are not fully enforced by ty or ruff and require human/agent judgment.

---
## [1][TYPE_INTEGRITY]
>**Dictum:** *Types make illegal states unrepresentable.*

<br>

- [ ] One canonical schema per entity -- no duplicate model definitions across files
- [ ] Typed atoms (`NewType`/`Annotated`) -- raw `str`/`int` absent from public signatures
- [ ] Smart constructors return `Result[T, E]` -- never raise for invalid input
- [ ] `frozen=True` on all `BaseModel` subclasses and `@dataclass` (with `slots=True`)
- [ ] Discriminated unions via `Discriminator` + `Tag` + `TypeAdapter` or `@tagged_union`
- [ ] Immutable collections: `tuple`/`frozenset`/`Mapping`/`Block[T]` over mutable equivalents

---
## [2][EFFECT_INTEGRITY]
>**Dictum:** *Effects encode failure as types; extraction happens once at the boundary.*

<br>

- [ ] `Result[T, E]` sync, `FutureResult[T, E]` async, `Maybe[T]` absence -- correct container per channel
- [ ] `@safe`/`@future_safe` at foreign boundaries only -- domain returns `Result` explicitly
- [ ] Zero `try`/`except` and zero `.unwrap()`/`.value_or()` in `domain/` or `ops/`
- [ ] `flow()` + `bind`/`map_`/`lash` as primary composition -- not method chaining for 3+ stages
- [ ] Result library consistency: ONE library's `Result`/`Option` per module (no `expression.Ok` + `returns.Success`)
- [ ] No mid-pipeline library mixing: `expression.pipe` and `returns.flow` never in same file

---
## [3][CONTROL_FLOW]
>**Dictum:** *Dispatch is structural and exhaustive; iteration is declarative.*

<br>

- [ ] Zero `if`/`else`/`elif` -- `match`/`case` exhaustive dispatch with `case _:` defensive arm
- [ ] Zero `for`/`while` in domain transforms -- boundary loops only with side-effect comments
- [ ] Guard clauses via `case x if predicate:` -- not bare `if` statements

---
## [4][DECORATOR_INTEGRITY]
>**Dictum:** *Decorators preserve signatures and compose cleanly.*

<br>

- [ ] `ParamSpec` + `Concatenate` + `@wraps` on every decorator
- [ ] Canonical ordering: trace > retry > cache > validate > authorize
- [ ] One concern per decorator; factories accept frozen `BaseModel` config
- [ ] Class-based decorators implement descriptor protocol (`__set_name__` + `__get__`)

---
## [5][CONCURRENCY_INTEGRITY]
>**Dictum:** *Concurrency is bounded, structured, and cooperative.*

<br>

- [ ] `anyio.create_task_group()` sole spawn -- no bare `asyncio.create_task`
- [ ] `checkpoint()` in tight async loops; `CapacityLimiter` for backpressure
- [ ] `ContextVar` for request-scoped state; `CancelScope` with explicit deadlines

---
## [6][SURFACE_QUALITY]
>**Dictum:** *Surface area reflects domain boundaries, not implementation artifacts.*

<br>

- [ ] No helper spam, class proliferation, DTO soup, framework coupling, or import-time IO

---
## [7][ALGORITHM_INTEGRITY]
>**Dictum:** *Accumulators are folds, not loops.*

<br>

- [ ] `reduce` replaces accumulator loops; `accumulate` for scans; generators for lazy transforms
- [ ] `@trampoline` for unbounded recursion depth -- stack safety mandatory
- [ ] `Decimal` + `ROUND_HALF_EVEN` for financial arithmetic -- zero `float` in monetary paths

---
## [8][PERFORMANCE_INTEGRITY]
>**Dictum:** *Measure before optimizing; allocation discipline is structural.*

<br>

- [ ] `__slots__` on non-Pydantic domain classes; module-level singletons for Encoder/Decoder/TypeAdapter
- [ ] `CapacityLimiter` sized to downstream; `checkpoint_if_cancelled()` in hot loops
- [ ] Profiling evidence before optimization -- no premature tuning

---
## [9][DETECTION_HEURISTICS]
>**Dictum:** *Grep patterns surface violations faster than reading every line.*

<br>

| [INDEX] | [CAUSE]                  | [GREP_ID] | [RG_PATTERN]                                          | [FIX]                                      |
| :-----: | ------------------------ | :-------: | ----------------------------------------------------- | ------------------------------------------ |
|   [1]   | Optional masking failure |   `G1`    | `"is None:" -g "*.py"`                                | `Maybe[T]` + `.to_result()`                |
|   [2]   | Exception control flow   |   `G2`    | `"^\s*except " -g "*.py"`                             | `@safe` at edge, `Result` in domain        |
|   [3]   | Imperative iteration     |   `G3`    | `"^\s*for " -g "*.py"`                                | Comprehension or `map`                     |
|   [4]   | Nominal dispatch         |   `G4`    | `"isinstance\\(" -g "*.py"`                           | Structural `match`/`case`                  |
|   [5]   | ABC-based interface      |   `G5`    | `"class.*ABC\|from abc import" -g "*.py"`             | `Protocol` structural typing               |
|   [6]   | Signature erasure        |   `G6`    | `"Callable\\[\\.\\.\\.," -g "*.py"`                   | `ParamSpec[P]` + `Callable[P, R]`          |
|   [7]   | Mutable domain model     |   `G7`    | `"class.*BaseModel" -g "*.py"`                        | Set `frozen=True`                          |
|   [8]   | Bare collection          |   `G8`    | `"-> list\\[\|-> dict\\[" -g "*.py"`                  | Frozen model or `TypeAdapter`              |
|   [9]   | Unstructured concurrency |   `G9`    | `"asyncio\\.create_task\|asyncio\\.gather" -g "*.py"` | `TaskGroup` + `start_soon`                 |
|  [10]   | Unstructured logging     |   `G10`   | `"logging\\.info\\(f\\\"\|logger\\.info\\(f\\\""...`  | Key-value structured logs                  |
|  [11]   | Global mutable state     |   `G11`   | `"^[A-Z_]*: dict\|= \\[\\]\|= \\{\\}" -g "*.py"`      | `ContextVar[tuple]` snapshots              |
|  [12]   | Bare primitive I/O       |   `G12`   | `"def .*: str\\) -> str:" -g "*.py"`                  | Typed atoms + `Result[T, E]`               |
|  [13]   | Import-time IO           |   `G13`   | `"^db = \|^conn = \|^client = " -g "*.py"`            | Defer to `boot()`                          |
|  [14]   | Imperative branching     |   `G14`   | `"^\s*if \|^\s*elif " -g "*.py"`                      | Exhaustive `match`/`case`                  |
|  [15]   | `hasattr`/`getattr`      |   `G15`   | `"hasattr\\(\|getattr\\(" -g "*.py"`                  | `case object(attr=value)`                  |
|  [16]   | Imperative accumulation  |   `G16`   | `"^\s*total\s*[+=]\|^\s*count\s*[+=]" -g "*.py"`      | `reduce` or `Seq.fold`                     |
|  [17]   | Premature optimization   |   `G17`   | `"# TODO.*optim\|# PERF" -g "*.py"`                   | Profile with `cProfile`/`tracemalloc`      |
|  [18]   | Mixed Result libraries   |   `G18`   | `"from expression.*Result\|from returns.*Result"...`  | ONE library per module; bridge at boundary |

All patterns use `rg -n`. Combine G2+G14 for full control-flow audit; G4+G15 for dispatch audit.

---
## [10][QUICK_REFERENCE]
>**Dictum:** *One table maps checklist to reference.*

<br>

| [INDEX] | [CHECKLIST_AREA]      | [WHAT_IT_VALIDATES]                                                            | [REFERENCE]                |
| :-----: | --------------------- | ------------------------------------------------------------------------------ | -------------------------- |
|   [1]   | TYPE_INTEGRITY        | Atoms, frozen models, unions, immutable collections                            | `types.md` [1]-[5]         |
|   [2]   | EFFECT_INTEGRITY      | Result/Maybe/FutureResult, flow, library consistency                           | `effects.md` [1]-[5]       |
|   [3]   | CONTROL_FLOW          | match/case exhaustive, zero imperative branching                               | `patterns.md` [1]          |
|   [4]   | DECORATOR_INTEGRITY   | ParamSpec, ordering, single-concern                                            | `decorators.md` [1]-[2]    |
|   [5]   | CONCURRENCY_INTEGRITY | TaskGroup, CancelScope, CapacityLimiter, ContextVar                            | `concurrency.md` [1]-[4]   |
|   [6]   | SURFACE_QUALITY       | No helpers, framework coupling, import-time IO                                 | `protocols.md` [1], [3]    |
|   [7]   | ALGORITHM_INTEGRITY   | Folds, scans, generators, @trampoline, Decimal                                 | `algorithms.md` [1]-[5]    |
|   [8]   | PERFORMANCE_INTEGRITY | __slots__, singletons, backpressure, profiling-first                           | `performance.md` [1]-[5]   |
|   [9]   | DETECTION_HEURISTICS  | Grep-based violation surface scan (G1-G18)                                     | Section [9] in this file   |
|  [10]   | SERIALIZATION         | TypeAdapter at module level, Pydantic ingress, msgspec egress, Settings frozen | `serialization.md` [1]-[3] |
|  [11]   | OBSERVABILITY         | Fused @instrument, processor chain, RED metrics, context propagation           | `observability.md` [1]-[4] |
