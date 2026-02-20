# [H1][SERVICE_MODULE]
>**Dictum:** *Service modules compose Protocol-based capabilities through reader monads, typed effect channels, and lazy collection pipelines.*

<br>

Produces one service module with Protocol ports defining capability contracts, `RequiresContextResult[T, E, Deps]` reader monad for typed dependency injection, and frozen dependency bundles. Uses `expression.Seq` for lazy collection operations and `expression.collections.Block[T]` as frozen return type for list-yielding service methods. Service modules depend on Protocol ports -- never on concrete adapter implementations; domain models and atoms are imported while IO lives in adapters.

**Density:** ~225 LOC signals a refactoring opportunity. No file proliferation; colocate operations in the service module.
**References:** `protocols.md` ([1] PROTOCOL_ARCHITECTURE, [2] TYPED_DI), `effects.md` ([1] EFFECT_STACK, [2] CONTEXTUAL_EFFECTS), `types.md` ([2] DISCRIMINATED_UNIONS, [3] FROZEN_MODELS), `algorithms.md` ([2] SINGLE_PASS_TRANSFORMS).
**Anti-Pattern Awareness:** See `patterns.md` [1] for FRAMEWORK_FIRST, INHERITANCE_HIERARCHIES, ANY_CAST_ERASURE, MODEL_WITH_BEHAVIOR.
**Workflow:** Fill placeholders, remove guidance blocks, verify with ty and ruff.

---
**Placeholders**

| [INDEX] | [PLACEHOLDER]              | [EXAMPLE]                                              |
| :-----: | -------------------------- | ------------------------------------------------------ |
|   [1]   | `{{module_path}}`          | `pinnacle/ops/order_service.py`                        |
|   [2]   | `{{service_name}}`         | `OrderService`                                         |
|   [3]   | `{{protocol_name}}`        | `Repository`                                           |
|   [4]   | `{{protocol_method}}`      | `get`                                                  |
|   [5]   | `{{protocol_return}}`      | `Result[Order, Exception]`                             |
|   [6]   | `{{protocol_list_method}}` | `list_by_customer`                                     |
|   [7]   | `{{deps_class}}`           | `ServiceDeps`                                          |
|   [8]   | `{{dep_field_a}}`          | `db_url: DbUrl`                                        |
|   [9]   | `{{dep_field_b}}`          | `cache_ttl: CacheTtl`                                  |
|  [10]   | `{{operation_name}}`       | `lookup_and_enrich`                                    |
|  [11]   | `{{operation_input}}`      | `CustomerId`                                           |
|  [12]   | `{{operation_output}}`     | `tuple[Order, str]`                                    |
|  [13]   | `{{collection_output}}`    | `Block[Order]`                                         |
|  [14]   | `{{entity_type}}`          | `Order`                                                |
|  [15]   | `{{context_result_type}}`  | `RequiresContextResult[Order, Exception, ServiceDeps]` |
|  [16]   | `{{capability_name}}`      | `order_capability`                                     |

---
```python
"""{{module_path}} -- Service module: Protocol-based DI via reader monads."""

# --- [IMPORTS] ----------------------------------------------------------------

from dataclasses import dataclass
from typing import NewType, Protocol, runtime_checkable, TYPE_CHECKING

from expression import pipe
from expression.collections import Seq, Block, seq
from pydantic import BaseModel
from returns.context import RequiresContextResult
from returns.result import Failure, Result, Success

# from pinnacle.domain.atoms import {{operation_input}}
# from pinnacle.domain.models import {{entity_type}}

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable

# --- [TYPES] ------------------------------------------------------------------

DbUrl = NewType("DbUrl", str)
CacheTtl = NewType("CacheTtl", int)

# --- [ERRORS] -----------------------------------------------------------------


# Flat error hierarchy: 3-5 variants per service. See effects.md [3].
@dataclass(frozen=True, slots=True)
class ServiceError:
    """Base service error."""

    message: str


@dataclass(frozen=True, slots=True)
class NotFoundError(ServiceError):
    """Entity not found error."""

    entity: str
    identifier: str


@dataclass(frozen=True, slots=True)
class ValidationError(ServiceError):
    """Validation failure error."""

    field: str


# --- [PROTOCOLS] --------------------------------------------------------------


# Protocols define structural capability ports. Adapters satisfy implicitly.
# See protocols.md [1] PROTOCOL_ARCHITECTURE.
@runtime_checkable
class {{protocol_name}}[T, Id](Protocol):
    """Persistence port -- any object with matching methods satisfies."""

    def {{protocol_method}}(
        self, entity_id: Id,
    ) -> {{protocol_return}}:
        """Retrieve entity by identity."""
        ...

    def save(self, entity: T) -> Result[Id, Exception]:
        """Persist entity, returning identity."""
        ...

    def {{protocol_list_method}}(
        self, customer_id: Id,
    ) -> Result[Block[T], Exception]:
        """List entities by parent identity, returning an immutable Block collection."""
        ...


# See protocols.md [1] for dependency inversion through module topology.
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

# --- [DEPENDENCIES] -----------------------------------------------------------


# Protocol defines shape; frozen dataclass satisfies structurally.
# See protocols.md [2] TYPED_DI for full pattern.
class _ServiceDeps(Protocol):
    """Protocol-based dependency contract -- structural, not nominal."""
    {{dep_field_a}}
    {{dep_field_b}}


class {{deps_class}}(BaseModel, frozen=True):
    """Concrete deps satisfying _ServiceDeps structurally. See protocols.md [2]."""
    {{dep_field_a}}
    {{dep_field_b}}

# --- [OPERATIONS] -------------------------------------------------------------


# RequiresContextResult defers dependency resolution to the composition root.
# See effects.md [2] CONTEXTUAL_EFFECTS.
def fetch_entity(
    entity_id: {{operation_input}},
) -> RequiresContextResult[{{entity_type}}, Exception, _ServiceDeps]:
    """Reader: .ask() retrieves deps, .from_result() lifts sync Result."""
    return RequiresContextResult.ask().bind(
        lambda deps: RequiresContextResult.from_result(
            Success(entity_id)  # placeholder -- delegate to Protocol adapter
        )
    )


def enrich_entity(
    entity: {{entity_type}},
) -> RequiresContextResult[{{operation_output}}, Exception, _ServiceDeps]:
    """Reader using deps for enrichment via .ask() pattern."""
    return RequiresContextResult.ask().bind(
        lambda deps: RequiresContextResult.from_result(
            Success((entity, f"cached:{deps.cache_ttl}"))  # placeholder
        )
    )

# --- [COLLECTIONS] ------------------------------------------------------------


# expression.Seq for lazy single-pass transforms; Block[T] freezes the result.
# See algorithms.md [2] SINGLE_PASS_TRANSFORMS for Seq pipeline patterns.
def list_active_entities(
    entity_id: {{operation_input}},
) -> RequiresContextResult[Block[{{entity_type}}], Exception, _ServiceDeps]:
    """Reader yielding frozen Block via Seq pipeline -- lazy filter+map."""
    return RequiresContextResult.ask().bind(
        lambda deps: RequiresContextResult.from_result(
            _filter_active(
                ()  # placeholder -- delegate to Protocol adapter list method
            )
        )
    )


def _filter_active(
    raw_entities: Iterable[{{entity_type}}],
) -> Result[Block[{{entity_type}}], Exception]:
    """Pure transform: Seq pipeline filters and freezes into Block.
    Single traversal, zero intermediate collections. See algorithms.md [2]."""
    filtered: Block[{{entity_type}}] = pipe(
        seq.of_iterable(raw_entities),
        seq.filter(lambda entity: entity.is_active),  # replace with domain predicate
        Block.of_seq,
    )
    return Success(filtered)

# --- [COMPOSITION] ------------------------------------------------------------


# Compose readers via bind: deps threaded implicitly. See effects.md [2].
def {{operation_name}}(
    entity_id: {{operation_input}},
) -> RequiresContextResult[{{operation_output}}, Exception, _ServiceDeps]:
    """Pipeline composing fetch -> enrich via bind over shared Deps."""
    return fetch_entity(entity_id).bind(enrich_entity)


# -- Capability grouping: expose as a frozen namespace ----------------------
# Routes and composition roots import the capability, not individual operations.
@dataclass(frozen=True, slots=True)
class {{service_name}}Capability:
    """Read-only capability namespace for {{service_name}} operations."""
    fetch: Callable[
        [{{operation_input}}],
        RequiresContextResult[{{entity_type}}, Exception, _ServiceDeps],
    ]
    enrich: Callable[
        [{{entity_type}}],
        RequiresContextResult[{{operation_output}}, Exception, _ServiceDeps],
    ]
    list_active: Callable[
        [{{operation_input}}],
        RequiresContextResult[Block[{{entity_type}}], Exception, _ServiceDeps],
    ]
    {{operation_name}}: Callable[
        [{{operation_input}}],
        RequiresContextResult[{{operation_output}}, Exception, _ServiceDeps],
    ]


{{capability_name}} = {{service_name}}Capability(
    fetch=fetch_entity,
    enrich=enrich_entity,
    list_active=list_active_entities,
    {{operation_name}}={{operation_name}},
)

# -- Composition root: provide concrete deps once ---------------------------
# Execute at boundary: deps resolved once at the outermost composition root.
# This is the ONLY place where match/case on Success/Failure is appropriate.
#
# deps = {{deps_class}}(db_url=DbUrl("postgresql://..."), cache_ttl=CacheTtl(300))
# result: Result[{{operation_output}}, Exception] = {{operation_name}}(entity_id)(deps)
# match result:
#     case Success(value): ...
#     case Failure(error): ...

# --- [EXPORT] -----------------------------------------------------------------

# All symbols above use explicit naming. No __all__, no default exports.
# Consumers import directly: from {{module_path}} import {{capability_name}}
```

---
**Guidance**

`RequiresContextResult[T, E, Deps]` threads deps implicitly through `bind` chains. For list-returning operations, `expression.Seq` provides lazy single-pass transforms; the result freezes into `Block[T]` at the boundary -- Pydantic-compatible (see `types.md` [3]), so API modules embed it directly. Use `returns.flow` + `bind` in pipeline modules; `expression.pipe` + `seq.*` for collection transforms within the service (see `SKILL.md` [8]). Protocol ports declare structural contracts -- `_ServiceDeps` Protocol defines shape, `{{deps_class}}` satisfies structurally. Capability grouping exposes a frozen namespace that routes import instead of individual operations. Deps resolve once at the composition root.

---
**Post-Scaffold Checklist** (from `validation.md`)

- [ ] PROTOCOL_PURITY: Protocols in `/protocols`; implementations in `/adapters`; no `abc.ABC`; structural satisfaction only
- [ ] READER_COMPOSITION: `RequiresContextResult` composes via `bind`; deps threaded implicitly; no manual parameter passing
- [ ] DEPS_IMMUTABILITY: `@dataclass(frozen=True, slots=True)` or frozen `BaseModel` for dependency bundles; no mutable fields
- [ ] COLLECTION_IMMUTABILITY: List-returning operations yield `Block[T]` via `Seq` pipeline; no mutable `list` returns
- [ ] NO_IMPLEMENTATION_LEAK: Domain/ops modules import zero adapter types; dependency arrow points inward
- [ ] EFFECT_BOUNDARY: `match`/`case` on `Success`/`Failure` at composition root only; mid-pipeline uses `bind`/`map`
- [ ] DENSITY: ~225 LOC target; one Protocol per capability port; one dependency bundle per service boundary
