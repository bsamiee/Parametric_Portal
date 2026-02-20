# [H1][TESTING]
>**Dictum:** *Property-based tests verify algebraic laws; fixtures compose as pipelines; mutation testing quantifies residual risk.*

<br>

Use `hypothesis >= 6.100` for property-based testing with custom strategies for `Result`/`Maybe`/`FutureResult`. Compose `pytest >= 8.0` fixtures via Protocol-typed factories in `conftest.py`. Enforce mutation score gates with `mutmut >= 3.2`. All test code follows the same functional constraints as production -- `match/case`, Protocol DI, pipeline assertions, zero `if`/`for`/`try-except`.

---
## [1][HYPOTHESIS_STRATEGIES]
>**Dictum:** *Custom strategies generate the full shape of monadic containers -- Success, Failure, Some, Nothing -- so properties hold across the entire domain.*

<br>

Build Hypothesis strategies for `returns` containers via `st.builds` and `st.one_of`. Each strategy mirrors the container's two-track shape: success + failure for `Result`, present + absent for `Maybe`. Stateful testing via `RuleBasedStateMachine` verifies sequential invariants without imperative setup.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from dataclasses import dataclass
from typing import TypeVar
from hypothesis import given, settings
from hypothesis import strategies as st
from hypothesis.stateful import Bundle, RuleBasedStateMachine, initialize, rule
from returns.maybe import Maybe, Nothing, Some
from returns.result import Failure, Result, Success

# --- [TYPES] ------------------------------------------------------------------

T = TypeVar("T")
E = TypeVar("E")

@dataclass(frozen=True, slots=True)
class DomainError:
    reason: str

# --- [STRATEGIES] -------------------------------------------------------------

def result_strategy(
    value_st: st.SearchStrategy[T], error_st: st.SearchStrategy[E],
) -> st.SearchStrategy[Result[T, E]]:
    """Two-track strategy: Success values and Failure errors in equal measure."""
    return st.one_of(
        st.builds(Success, value_st),
        st.builds(Failure, error_st),
    )

def maybe_strategy(value_st: st.SearchStrategy[T]) -> st.SearchStrategy[Maybe[T]]:
    """Present-or-absent strategy: Some values interleaved with Nothing."""
    return st.one_of(st.builds(Some, value_st), st.just(Nothing))

results: st.SearchStrategy[Result[int, DomainError]] = result_strategy(
    st.integers(min_value=0, max_value=1000),
    st.builds(DomainError, reason=st.text(min_size=1, max_size=50)),
)
maybes: st.SearchStrategy[Maybe[str]] = maybe_strategy(st.text(min_size=1, max_size=20))

# --- [STATEFUL] ---------------------------------------------------------------

class ResultAccumulatorMachine(RuleBasedStateMachine):
    """Verify that sequential map/bind operations preserve container invariants."""
    values: Bundle[Result[int, DomainError]] = Bundle("values")

    @initialize(target=values)
    def seed(self) -> Result[int, DomainError]:
        return Success(0)

    @rule(target=values, prior=values, delta=st.integers(min_value=1, max_value=100))
    def accumulate(self, prior: Result[int, DomainError], delta: int) -> Result[int, DomainError]:
        accumulated: Result[int, DomainError] = prior.map(lambda value: value + delta)
        match accumulated:
            case Success(inner):
                assert inner >= delta
            case Failure(_):
                pass
        return accumulated

TestAccumulator = ResultAccumulatorMachine.TestCase
```

[CRITICAL]:
- [ALWAYS] Generate both tracks of every container -- `Success`+`Failure`, `Some`+`Nothing`.
- [ALWAYS] Use `st.builds` over manual lambda construction for shrinkability.
- [NEVER] Filter strategies to only one track -- properties must hold across the full domain.

---
## [2][FIXTURE_COMPOSITION]
>**Dictum:** *Fixtures are Protocol-typed factories that compose as pipeline stages -- each yields one concern, teardown is automatic.*

<br>

Define fixture contracts as `Protocol` types. Factory fixtures return callables so tests control instantiation timing. Async fixtures use `anyio` backend for structured concurrency. `conftest.py` owns fixture composition; test modules own assertions.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from collections.abc import AsyncIterator, Callable, Iterator
from dataclasses import dataclass
from typing import Protocol
import pytest
from returns.result import Result, Success

# --- [PROTOCOLS] --------------------------------------------------------------

class ServiceFactory(Protocol):
    def __call__(self, tenant_id: str) -> Result[dict[str, str], Exception]: ...

class AsyncResourceFactory(Protocol):
    async def __call__(self, label: str) -> dict[str, object]: ...

# --- [FIXTURES: conftest.py] --------------------------------------------------

@dataclass(frozen=True, slots=True)
class TestConfig:
    db_url: str
    cache_ttl: int

@pytest.fixture(scope="session")
def test_config() -> TestConfig:
    return TestConfig(db_url="sqlite:///:memory:", cache_ttl=60)

@pytest.fixture()
def service_factory(test_config: TestConfig) -> Iterator[ServiceFactory]:
    """Yield a Protocol-typed factory; teardown releases resources."""
    created: list[str] = []

    def factory(tenant_id: str) -> Result[dict[str, str], Exception]:
        created.append(tenant_id)
        return Success({"tenant": tenant_id, "db": test_config.db_url})

    yield factory
    created.clear()

@pytest.fixture()
async def async_resource() -> AsyncIterator[AsyncResourceFactory]:
    """Async factory fixture -- anyio-compatible structured teardown."""
    allocated: list[str] = []

    async def factory(label: str) -> dict[str, object]:
        allocated.append(label)
        return {"label": label, "active": True}

    yield factory
    allocated.clear()

# --- [TESTS] ------------------------------------------------------------------

def test_service_produces_success(service_factory: ServiceFactory) -> None:
    result: Result[dict[str, str], Exception] = service_factory("tenant-001")
    match result:
        case Success(value):
            assert value["tenant"] == "tenant-001"
        case _:
            pytest.fail("Expected Success track")
```

[IMPORTANT]:
- [ALWAYS] Type fixtures with Protocol -- callers depend on shape, not implementation.
- [ALWAYS] Use `yield` fixtures for automatic teardown; `scope="session"` for immutable config.
- [NEVER] Perform assertions inside fixtures -- fixtures produce, tests assert.

---
## [3][PROPERTY_LAWS]
>**Dictum:** *Algebraic laws are mathematical truths independent of implementation -- functor, monad, identity laws validate container semantics.*

<br>

Property tests verify that `Result` and `Maybe` satisfy functor and monad laws. Each law is an equation between two pipelines -- Hypothesis generates arbitrary inputs, the test asserts both sides produce identical containers. Expected values derive from the law itself, never from pasting implementation output.

```python
# --- [IMPORTS] ----------------------------------------------------------------

from collections.abc import Callable
from hypothesis import given
from hypothesis import strategies as st
from returns.maybe import Maybe, Nothing, Some
from returns.result import Failure, Result, Success

# --- [FUNCTOR_LAWS] -----------------------------------------------------------

@given(value=st.integers())
def test_result_functor_identity(value: int) -> None:
    """Functor identity: fmap(id, x) == x."""
    container: Result[int, str] = Success(value)
    assert container.map(lambda x: x) == container

@given(value=st.integers())
def test_result_functor_composition(value: int) -> None:
    """Functor composition: fmap(f . g, x) == fmap(f, fmap(g, x))."""
    double: Callable[[int], int] = lambda x: x * 2
    inc: Callable[[int], int] = lambda x: x + 1
    container: Result[int, str] = Success(value)
    left: Result[int, str] = container.map(lambda x: double(inc(x)))
    right: Result[int, str] = container.map(inc).map(double)
    assert left == right

# --- [MONAD_LAWS] -------------------------------------------------------------

@given(value=st.integers(min_value=-100, max_value=100))
def test_result_left_identity(value: int) -> None:
    """Left identity: return a >>= f == f(a)."""
    step: Callable[[int], Result[str, str]] = lambda x: Success(f"v:{x}")
    assert Success(value).bind(step) == step(value)

@given(value=st.integers(min_value=-100, max_value=100))
def test_result_right_identity(value: int) -> None:
    """Right identity: m >>= return == m."""
    container: Result[int, str] = Success(value)
    assert container.bind(Success) == container

@given(value=st.integers(min_value=0, max_value=50))
def test_result_bind_associativity(value: int) -> None:
    """Associativity: (m >>= f) >>= g == m >>= (lambda x: f(x) >>= g)."""
    step_a: Callable[[int], Result[int, str]] = lambda x: Success(x + 1)
    step_b: Callable[[int], Result[str, str]] = lambda x: Success(f"done:{x}")
    container: Result[int, str] = Success(value)
    left: Result[str, str] = container.bind(step_a).bind(step_b)
    right: Result[str, str] = container.bind(lambda x: step_a(x).bind(step_b))
    assert left == right

# --- [MAYBE_LAWS] -------------------------------------------------------------

@given(value=st.text(min_size=1, max_size=20))
def test_maybe_left_identity(value: str) -> None:
    step: Callable[[str], Maybe[str]] = lambda x: Some(x.upper())
    assert Some(value).bind(step) == step(value)

@given(value=st.text(min_size=1, max_size=20))
def test_maybe_nothing_propagation(value: str) -> None:
    """Nothing propagates through bind -- failure track is inert."""
    step: Callable[[str], Maybe[str]] = lambda x: Some(x.upper())
    assert Nothing.bind(step) == Nothing
```

[CRITICAL]:
- [ALWAYS] Derive expected values from the algebraic law equation, not from running the implementation.
- [ALWAYS] Test both tracks: Success/Some AND Failure/Nothing propagation.
- [NEVER] Use `@example` as sole coverage -- `@given` must generate the property domain.

---
## [4][MUTATION_TESTING]
>**Dictum:** *Mutation score quantifies test suite strength -- surviving mutants reveal untested logic branches.*

<br>

Configure `mutmut` to target domain modules while excluding generated code and test infrastructure. Score thresholds gate CI: 80+ is the target, 60+ triggers investigation, below 50 fails the build. Analyze survivors by category -- arithmetic, boundary, negation -- to identify systematic blind spots.

```toml
# --- [pyproject.toml] ---------------------------------------------------------

[tool.mutmut]
paths_to_mutate = "packages/domain/"
tests_dir = "tests/"
runner = "python -m pytest -x --tb=short"
dict_synonyms = "Struct, Frozen"

[tool.mutmut.settings]
# Exclude generated and infra code from mutation
paths_to_exclude = [
    "packages/domain/generated/",
    "packages/domain/_vendor/",
]
```

```python
# --- [IMPORTS] ----------------------------------------------------------------

from dataclasses import dataclass

# --- [CLASSES] ----------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class MutationReport:
    killed: int
    survived: int
    timeout: int
    suspicious: int

    @property
    def score(self) -> float:
        total: int = self.killed + self.survived + self.timeout + self.suspicious
        match total:
            case 0:
                return 100.0
            case _:
                return (self.killed / total) * 100.0

# --- [FUNCTIONS] --------------------------------------------------------------

def evaluate_gate(report: MutationReport) -> str:
    """CI gate evaluation: score thresholds drive build outcome."""
    match report.score:
        case score if score >= 80.0:
            return "PASS"
        case score if score >= 60.0:
            return "INVESTIGATE"
        case _:
            return "FAIL"
```

**Survival analysis workflow**:
1. Run `mutmut run` (incremental -- caches prior results).
2. Inspect survivors: `mutmut results` -- group by mutation operator (arithmetic, boundary, negation, statement deletion).
3. Prioritize boundary and negation survivors -- these indicate missing edge-case assertions.
4. Add targeted property tests for each surviving category before re-running.

[IMPORTANT]:
- [ALWAYS] Run mutation testing after line coverage reaches 80+ -- mutations on uncovered code are noise.
- [ALWAYS] Investigate boundary/negation survivors first -- highest signal-to-noise ratio.
- [PREFER] Incremental runs (`mutmut run`) over full sweeps -- use `pnpm clean` equivalent for fresh baseline only when module structure changes.

---
## [5][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] Custom Hypothesis strategies for every `returns` container used in domain -- `Result`, `Maybe`, `FutureResult`.
- [ALWAYS] Generate both tracks (success + failure, present + absent) in every container strategy.
- [ALWAYS] Verify functor identity, functor composition, left identity, right identity, bind associativity for each container.
- [ALWAYS] Type fixtures with `Protocol` -- callers depend on shape, not implementation.
- [ALWAYS] Factory fixtures (`Callable[..., T]`) over value fixtures when tests need control over instantiation timing.
- [ALWAYS] `match/case` for asserting container track in tests -- zero `isinstance` checks.
- [ALWAYS] Derive expected values from algebraic law equations, not from implementation output.
- [ALWAYS] Mutation score gates: 80+ target, 60+ investigate, 50+ fail.
- [NEVER] `if`/`elif`/`else` in test code -- use `match/case`, `pytest.param`, parametrize.
- [NEVER] `for`/`while` in test code -- use `@given`, `@pytest.mark.parametrize`, comprehensions.
- [NEVER] `try`/`except` in test assertions -- containers encode failure; match on `Failure`/`Nothing`.
- [NEVER] Filter Hypothesis strategies to single track -- properties must cover full container domain.
- [NEVER] Assert inside fixtures -- fixtures produce data, tests assert properties.
- [NEVER] Paste implementation output as expected value -- expected values are external oracles.
- [PREFER] `st.builds` over `st.from_type` for container strategies -- explicit construction preserves shrinkability.
- [PREFER] `RuleBasedStateMachine` for sequential invariant testing over manual loop-based state checks.

---
## [6][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                      | [WHEN]                               | [KEY_TRAIT]                                              |
| :-----: | ------------------------------ | ------------------------------------ | -------------------------------------------------------- |
|   [1]   | `result_strategy(val, err)`    | Property tests on `Result` pipelines | `st.one_of(Success, Failure)` -- both tracks generated   |
|   [2]   | `maybe_strategy(val)`          | Property tests on `Maybe` pipelines  | `st.one_of(Some, Nothing)` -- presence + absence         |
|   [3]   | `@given` + functor/monad laws  | Algebraic law verification           | Law equation as oracle -- implementation-independent     |
|   [4]   | `RuleBasedStateMachine`        | Sequential invariant testing         | Stateful property: rules + bundles, no manual loops      |
|   [5]   | Protocol-typed factory fixture | DI in tests without coupling         | `Callable[..., Result[T, E]]` via `Protocol`             |
|   [6]   | `conftest.py` factory pattern  | Shared fixture composition           | `yield` for teardown, `scope` for lifecycle              |
|   [7]   | `async` fixture + `anyio`      | Async resource lifecycle in tests    | `AsyncIterator` yield pattern, structured teardown       |
|   [8]   | `match/case` assertion         | Container track dispatch in tests    | Exhaustive `Success`/`Failure`/`Some`/`Nothing` matching |
|   [9]   | `mutmut` + score gates         | Mutation testing CI integration      | 80+ pass, 60+ investigate, 50+ fail                      |
|  [10]   | Survival analysis by operator  | Post-mutation investigation          | Boundary/negation survivors highest priority             |
|  [11]   | `@pytest.mark.parametrize`     | Data-driven tests without loops      | Declarative cases replace imperative iteration           |
|  [12]   | Incremental `mutmut run`       | Regression mutation checks           | Cached results -- fresh baseline on structural changes   |
