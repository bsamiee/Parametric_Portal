# [H1][SERVICE_MODULE]
>**Dictum:** *Service modules compose Protocol-based capabilities through reader monads and typed effect channels.*

Produces one service module: Protocol ports defining capability contracts, `RequiresContextResult[T, E, Deps]` reader monad for typed dependency injection, frozen dependency bundles, and capability composition via `bind`. Service modules depend on Protocol ports -- never on concrete adapter implementations. Domain models and atoms are imported; IO lives in adapters.

**Density:** ~225 LOC signals a refactoring opportunity. No file proliferation; colocate operations in the service module.
**References:** `protocols.md` ([1] PROTOCOL_DESIGN, [2] ADAPTER_PATTERN, [3] TYPED_DI, [4] RUNTIME_CHECKABLE_LIMITS), `effects.md` ([1] EFFECT_STACK, [2] CONTEXTUAL_EFFECTS), `types.md` ([2] FROZEN_MODELS).
**Anti-Pattern Awareness:** See `patterns.md` [1] for IMPLICIT_COUPLING, FRAMEWORK_FIRST, RUNTIME_CHECKABLE_MISUSE, ANY_CAST_ERASURE.
**Workflow:** Fill placeholders, remove guidance blocks, verify with ty and ruff.

---
**Placeholders**

- `{{module_path}}`: `pinnacle/ops/user_service.py`
- `{{service_name}}`: `UserService`
- `{{protocol_name}}`: `Repository`
- `{{protocol_method}}`: `get`
- `{{protocol_return}}`: `Result[User, Exception]`
- `{{deps_class}}`: `ServiceDeps`
- `{{dep_field_a}}` / `{{dep_field_b}}`: `db_url: str`, `cache_ttl: int`
- `{{operation_name}}`: `lookup_and_enrich`
- `{{operation_input}}`: `UserId`
- `{{operation_output}}`: `tuple[User, str]`
- `{{context_result_type}}`: `RequiresContextResult[User, Exception, ServiceDeps]`
- `{{capability_name}}`: `user_capability`

---
```python
"""{{module_path}} -- Service module: Protocol-based DI via reader monads."""

# --- [IMPORTS] -------------------------------------------------------------
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from returns.context import RequiresContextResult
from returns.result import Failure, Result, Success

# Import domain types from their canonical modules:
# from pinnacle.domain.atoms import {{operation_input}}
# from pinnacle.domain.models import User

# --- [ERRORS] ---------------------------------------------------------------

# Service-level errors are frozen dataclasses. Keep error hierarchies flat:
# 3-5 variants per service boundary. See effects.md [3] BOUNDARY_IO_AND_ERROR_ALGEBRA.
@dataclass(frozen=True, slots=True)
class ServiceError:
    message: str

@dataclass(frozen=True, slots=True)
class NotFoundError(ServiceError):
    entity: str
    identifier: str

@dataclass(frozen=True, slots=True)
class ValidationError(ServiceError):
    field: str

# --- [PROTOCOLS] ------------------------------------------------------------

# Protocols define capability ports via structural typing. Adapters satisfy
# protocols implicitly -- no inheritance required. Protocols live in /protocols;
# implementations in /adapters. Domain code depends on Protocol, never concrete.
# See protocols.md [1] for Protocol definition patterns.
@runtime_checkable
class {{protocol_name}}[T, Id](Protocol):
    """Persistence port -- any object with matching methods satisfies."""
    def {{protocol_method}}(
        self, entity_id: Id,
    ) -> {{protocol_return}}: ...

    def save(self, entity: T) -> Result[Id, Exception]: ...

# Domain functions depend on Protocol ports, never on concrete implementations.
# See protocols.md [2] ADAPTER_PATTERN for dependency inversion.
def transfer_entity[T, Id](
    source: {{protocol_name}}[T, Id],
    target: {{protocol_name}}[T, Id],
    entity_id: Id,
) -> Result[Id, Exception]:
    """Pure orchestration depending only on Protocol -- no adapter imports."""
    match source.{{protocol_method}}(entity_id):
        case Success(entity):
            return target.save(entity)
        case Failure() as err:
            return err
        case _:
            return Failure(RuntimeError("Unexpected repository result"))

# --- [DEPENDENCIES] ---------------------------------------------------------

# Dependency bundle as frozen dataclass with slots=True -- immutable and
# allocation-efficient. Threaded via RequiresContextResult reader monad.
# See protocols.md [3] for typed DI patterns.
@dataclass(frozen=True, slots=True)
class {{deps_class}}:
    """Immutable dependency bundle threaded via reader monad."""
    {{dep_field_a}}
    {{dep_field_b}}

# --- [OPERATIONS] -----------------------------------------------------------

# Operations use RequiresContextResult[T, E, Deps] to defer dependency
# resolution to the composition root. Dependencies are declared in the type
# signature and provided once at the boundary.
# See effects.md [2] CONTEXTUAL_EFFECTS for RequiresContextResult composition.

def fetch_entity(
    entity_id: {{operation_input}},
) -> RequiresContextResult[{{operation_input}}, Exception, {{deps_class}}]:
    """Reader: .ask() retrieves deps, .from_result() lifts sync Result.
    Resolved at composition root. No raw _inner closures."""
    return RequiresContextResult.ask().bind(
        lambda deps: RequiresContextResult.from_result(
            Success(entity_id)  # placeholder -- delegate to Protocol adapter
        )
    )

def enrich_entity(
    entity: {{operation_input}},
) -> RequiresContextResult[{{operation_output}}, Exception, {{deps_class}}]:
    """Reader using deps for enrichment via .ask() pattern."""
    return RequiresContextResult.ask().bind(
        lambda deps: RequiresContextResult.from_result(
            Success((entity, f"cached:{deps.cache_ttl}"))  # placeholder
        )
    )

# --- [COMPOSITION] ----------------------------------------------------------

# Compose readers via bind: deps threaded implicitly through the pipeline.
# bind passes the same Deps instance to each stage without manual threading.
# See effects.md [2] CONTEXTUAL_EFFECTS for RequiresContextResult composition.
def {{operation_name}}(
    entity_id: {{operation_input}},
) -> RequiresContextResult[{{operation_output}}, Exception, {{deps_class}}]:
    """Pipeline composing fetch -> enrich via bind over shared Deps."""
    return fetch_entity(entity_id).bind(enrich_entity)

# -- Capability grouping: expose as a frozen namespace --------------------
# Capabilities are grouped as a namespace for clean imports.
# Routes and composition roots import the capability, not individual operations.
@dataclass(frozen=True, slots=True)
class {{service_name}}Capability:
    """Read-only capability namespace for {{service_name}} operations."""
    fetch: Callable[[{{operation_input}}], RequiresContextResult[{{operation_input}}, Exception, {{deps_class}}]]
    enrich: Callable[[{{operation_input}}], RequiresContextResult[{{operation_output}}, Exception, {{deps_class}}]]
    {{operation_name}}: Callable[[{{operation_input}}], RequiresContextResult[{{operation_output}}, Exception, {{deps_class}}]]

{{capability_name}} = {{service_name}}Capability(
    fetch=fetch_entity,
    enrich=enrich_entity,
    {{operation_name}}={{operation_name}},
)

# -- Composition root: provide concrete deps once -------------------------
# Execute at boundary: deps resolved once at the outermost composition root.
# This is the ONLY place where match/case on Success/Failure is appropriate.
#
# deps = {{deps_class}}(db_url="postgresql://...", cache_ttl=300)
# result: Result[{{operation_output}}, Exception] = {{operation_name}}(entity_id)(deps)
# match result:
#     case Success(value): ...
#     case Failure(error): ...

# --- [EXPORT] ---------------------------------------------------------------

# All symbols above use explicit naming. No __all__, no default exports.
# Consumers import directly: from {{module_path}} import {{capability_name}}
```

---
**Guidance**

- Protocol-based DI: depend on structural `Protocol` ports, never concrete adapters.
- Reader composition: `RequiresContextResult[T, E, Deps]` keeps dependency flow typed and explicit.
- Capability composition: combine operations via `bind`; resolve dependencies once at the composition root.

---
**Post-Scaffold Checklist** (from `validation.md`)

- [ ] PROTOCOL_PURITY: Protocols in `/protocols`; implementations in `/adapters`; no `abc.ABC`; structural satisfaction only
- [ ] READER_COMPOSITION: `RequiresContextResult` composes via `bind`; deps threaded implicitly; no manual parameter passing
- [ ] DEPS_IMMUTABILITY: `@dataclass(frozen=True, slots=True)` for dependency bundles; no mutable fields
- [ ] NO_IMPLEMENTATION_LEAK: Domain/ops modules import zero adapter types; dependency arrow points inward
- [ ] EFFECT_BOUNDARY: `match`/`case` on `Success`/`Failure` at composition root only; mid-pipeline uses `bind`/`map`
- [ ] DENSITY: ~225 LOC target; one Protocol per capability port; one dependency bundle per service boundary
