---
name: csharp-standards
description: >-
  Enforce pure functional C# 14 / .NET 10 standards with LanguageExt v5 ROP,
  discriminated unions, smart constructors, K<F,A> higher-kinded encoding,
  zero-branching monadic pipelines, and hardware-accelerated patterns.
  Use when editing, creating, reviewing, or refactoring any .cs module,
  implementing domain services, defining type algebras, or applying
  functional programming standards to C# code.
---

# [H1][CSHARP-STANDARDS]
>**Dictum:** *Functional discipline unifies C# 14 / .NET 10 authoring with LanguageExt v5.*

<br>

This skill enforces a **single dense style** for C# 14 / .NET 10 modules: smart constructors via `Fin<T>`, discriminated unions via sealed abstract records, zero-branching monadic pipelines via `Eff<RT,T>`, applicative validation via `Validation<Error,T>`, higher-kinded abstraction via `K<F,A>`, and hardware-accelerated hot paths via `TensorPrimitives` / `Vector512<T>`.

---
## [1][LOAD_SEQUENCE]
>**Dictum:** *Standards enforcement requires comprehensive awareness -- selective loading creates blind spots.*

<br>

Coding standards references are complementary, not mutually exclusive. Type discipline applies when writing effects; anti-pattern awareness applies when writing types; composition patterns apply when writing algorithms. Unlike domain-knowledge skills (where finance and sales data are independent), enforcement skills demand layered awareness to prevent violations that span concerns.

**Step 1 -- Foundation (always load first)**
Cross-cutting references that establish baseline discipline for ALL C# modules.

| [ORDER] | [REFERENCE]     | [ESTABLISHES]                               |
| :-----: | --------------- | ------------------------------------------- |
|   [1]   | `validation.md` | Compliance checklist and audit heuristics   |
|   [2]   | `patterns.md`   | Anti-pattern codex with corrective examples |

**Step 2 -- Core (always load second)**
Domain references covering the type system, object modeling, and computation. Nearly all implementation tasks touch multiple core domains simultaneously.

| [ORDER] | [REFERENCE]      | [ESTABLISHES]                                    |
| :-----: | ---------------- | ------------------------------------------------ |
|   [3]   | `types.md`       | Type primitives, sealed DUs, phantom parameters  |
|   [4]   | `objects.md`     | Object model topology and canonical shapes       |
|   [5]   | `effects.md`     | ROP pipelines, Eff<RT,T>, IO<A>, error channels  |
|   [6]   | `composition.md` | LINQ comprehensions, K<F,A>, monadic composition |

**Step 3 -- Specialized (load when task requires)**
Genuinely specialized domains. Load when the task involves HKT polymorphic algorithms, recursion schemes, hot-path optimization, observability, concurrency, or diagnostics.

| [ORDER] | [REFERENCE]        | [LOAD_WHEN]                                                         |
| :-----: | ------------------ | ------------------------------------------------------------------- |
|   [7]   | `algorithms.md`    | Recursion schemes, folds, K<F,A> generic algorithms                 |
|   [8]   | `performance.md`   | Hot paths, TensorPrimitives, Vector512, span code                   |
|   [9]   | `observability.md` | Structured logging, distributed tracing, metrics, ROP combinators   |
|  [10]   | `concurrency.md`   | Channels, cancellation, structured parallelism, async streams       |
|  [11]   | `diagnostics.md`   | Debugging functional code, error chains, pipeline probes, profiling |

**Step 4 -- Template (scaffolding only)**
Load exactly one template when creating a new module from scratch.

| [ORDER] | [TEMPLATE]                      | [ARCHETYPE] |
| :-----: | ------------------------------- | ----------- |
|  [12]   | `pure-module.template.md`       | Pure        |
|  [13]   | `effect-module.template.md`     | Effect      |
|  [14]   | `algebra-module.template.md`    | Algebra     |
|  [15]   | `observable-module.template.md` | Observable  |

Hold all loaded references stable through task completion.

---
## [2][CONTRACTS]
>**Dictum:** *Structural invariants constrain all modules.*

<br>

**Density over volume**
- **~400 LOC signals a refactoring opportunity** -- dense polymorphic patterns naturally compress well-architected modules. This is not a hard cap: a sealed DU hierarchy with exhaustive `Fold` may legitimately exceed it. The question is whether the module owns exactly one concept and whether repetitive arms indicate a missing abstraction. File proliferation and helper extraction are *always* code smells -- better patterns compress the logic.
- **File-scoped namespaces** only (`namespace X;`).
- **Explicit accessibility** on every member (`public`, `private`, `internal`).

**Imports convention**
- **`using static LanguageExt.Prelude;`** assumed in every module -- provides `Some`, `None`, `unit`, `pure`, `error`, `guard`, `liftIO`, `Seq`, `HashMap`, `Atom`, `Ref`, `ms`, `sec`.

**Type discipline**
- **Zero `var`** -- all types explicit in declarations and lambda parameters.
- **Named parameters** at every domain call site (`Create(candidate: value)`). Framework/LINQ predicate parameters and single-argument lambda invocations may use positional syntax.
- **`readonly record struct`** for domain primitives; `sealed abstract record` for DUs.
- **Expression-bodied members** where the body is a single expression.
- **Primary constructors** preferred per `.editorconfig` (`csharp_style_prefer_primary_constructors = true:error`).

**Control-flow discipline**
- **Zero `if`/`else`/`else if`/`while`/`for`/`foreach`** -- use `switch` expressions and monadic `Bind`/`Map`.
- **Zero `try`/`catch`/`throw`** -- use `Fin<T>`, `Validation<Error,T>`, `Eff<RT,T>`, or `IO<A>`.
- **Exhaustive `switch`** with compiler-enforced coverage on DU hierarchies. Include `_ => throw new UnreachableException()` as a defensive arm until C# ships first-class DU exhaustiveness (targeted C# 15 preview).

**Formatting** (compiler/editorconfig-enforced, listed for awareness)
- **K&R brace style** (`csharp_new_line_before_open_brace = none`), **zero consecutive blank lines**, **method group conversion** preferred over equivalent lambdas, **UTF-8 string literals** preferred.

**Effect discipline**
- **`Fin<T>`** for synchronous fallible operations (isomorphic to `Either<Error,A>`).
- **`Validation<Error,T>`** for parallel error accumulation (applicative, zero short-circuit).
- **`Eff<RT,T>`** for effectful pipelines with environmental DI via `Has<RT,Trait>`.
- **`IO<A>`** for boundary side effects (free monad: Pure/Fail/Sync/Async).
- **`K<F,A>`** for higher-kinded generic algorithms (`Fallible`, `Applicative`, `Monad` constraints).

**Surface minimization**
- **`params ReadOnlySpan<T>`** for arity collapse -- one method owns all arities.
- **Sealed DU hierarchies** with `private protected` constructors -- closed extension.
- **`static` lambdas** on hot-path closures -- zero capture bytes.
- **C# 14 extension blocks** for behavior projection without inheritance.

---
## [3][ROUTING]
>**Dictum:** *Foundation and core load unconditionally; routing selects specialization and templates.*

<br>

Foundation (`validation.md`, `patterns.md`) and core (`types.md`, `objects.md`, `effects.md`, `composition.md`) are active for every task. The routing table determines which specialized references and templates to add.

| [INDEX] | [TASK]                                  | [ADD_SPECIALIZED]  | [TEMPLATE]                      |
| :-----: | --------------------------------------- | ------------------ | ------------------------------- |
|   [1]   | Scaffold pure domain module             | --                 | `pure-module.template.md`       |
|   [2]   | Scaffold effectful service module       | --                 | `effect-module.template.md`     |
|   [3]   | Scaffold algebraic abstraction          | `algorithms.md`    | `algebra-module.template.md`    |
|   [4]   | Add/refactor object models              | --                 | --                              |
|   [5]   | Add/refactor domain types or DUs        | --                 | --                              |
|   [6]   | Add/refactor ROP pipeline or Eff        | --                 | --                              |
|   [7]   | Add/refactor composition or LINQ        | --                 | --                              |
|   [8]   | Optimize hot path or span code          | `performance.md`   | --                              |
|   [9]   | Review or audit existing module         | --                 | --                              |
|  [10]   | Implement recursion schemes or folds    | `algorithms.md`    | --                              |
|  [11]   | Implement K<F,A> polymorphic algorithms | `algorithms.md`    | --                              |
|  [12]   | Vectorize numeric computation           | `performance.md`   | --                              |
|  [13]   | Add/refactor logging, tracing, metrics  | `observability.md` | --                              |
|  [14]   | Add/refactor concurrent pipelines       | `concurrency.md`   | --                              |
|  [15]   | Debug or profile functional code        | `diagnostics.md`   | --                              |
|  [16]   | Scaffold observable service module      | `observability.md` | `observable-module.template.md` |

---
## [4][DECISION_TREES]
>**Dictum:** *Route decisions before loading references.*

<br>

**Type family** -- select the encoding that makes illegal states unrepresentable at the narrowest type boundary.

| [DATA_SHAPE]                        | [USE]                               | [KEY_TRAIT]                       |
| ----------------------------------- | ----------------------------------- | --------------------------------- |
| Object model topology selection     | See `objects.md`                    | Canonical shape before coding     |
| Domain primitive (ID, amount, code) | `readonly record struct` + `Fin<T>` | `field` keyword inline validation |
| Zero-alloc semantic wrapper         | `Newtype<TTag, TRepr>`              | Sealed tag class + `using` alias  |
| Exhaustive state space              | Sealed abstract record hierarchy    | `private protected` ctor + `Fold` |
| Compile-time state tracking         | `UserId<TState>` phantom parameter  | Empty `readonly struct` markers   |
| Inline property validation          | `field` keyword setter              | Auto-rounding, auto-normalization |

**Error channel** -- match the effect type to the failure mode. Mixing types (e.g. `Fin` where `Validation` is needed) collapses parallel error accumulation into sequential short-circuiting.

| [FAILURE_SHAPE]                    | [USE]                  | [KEY_TRAIT]                                   |
| ---------------------------------- | ---------------------- | --------------------------------------------- |
| Synchronous fallible operation     | `Fin<T>`               | `Bind`/`Map` chain; `Match` at boundary only  |
| Parallel multi-field validation    | `Validation<Error,T>`  | Applicative `.Apply()` tuple; collects all    |
| Effectful pipeline with DI         | `Eff<RT,T>`            | `Has<RT,Trait>` + LINQ `from..in..select`     |
| Boundary side effect               | `IO<A>`                | Pure/Fail/Sync/Async + `Run`/`RunAsync`       |
| Algorithm generic over computation | `K<F,A>` + constraints | `Fallible`/`Applicative`/`Monad`/`Foldable`   |
| Declarative fallback chain         | `pipe` operator        | `Alternative<F>`/`Choice<F>` trait on Eff/Fin |

**Module archetype** -- determines which template to scaffold.

| [WHAT_YOU_ARE_BUILDING]                          | [ARCHETYPE] | [TEMPLATE]                      |
| ------------------------------------------------ | ----------- | ------------------------------- |
| Types + validators + transforms + extensions     | Pure        | `pure-module.template.md`       |
| ROP pipelines + DI traits + boundary handling    | Effect      | `effect-module.template.md`     |
| Algebraic interfaces + HKT + query unions        | Algebra     | `algebra-module.template.md`    |
| ROP pipelines + DI traits + integrated telemetry | Observable  | `observable-module.template.md` |

---
## [5][ANTI_PATTERNS]
>**Dictum:** *Expert knowledge is knowing which landmines to avoid.*

<br>

Each anti-pattern names a structural defect that propagates if left unchecked. See `validation.md` [7] for concrete grep-level detection heuristics.

**Type-system violations** -- defects that weaken static guarantees:
- **VAR_INFERENCE** -- `var` hides codomain semantics; when `Fin<T>` silently becomes `Option<T>` under refactoring, the compiler cannot distinguish intention from accident. Explicit types are the proof obligation.
- **NULL_ARCHITECTURE** -- `null` encoding three states (not-found, error, uninitialized) collapses distinct failure modes into one opaque value. `Option<T>` for absence, `Fin<T>` for failure, explicit initialization for construction.
- **ANEMIC_DOMAIN** -- entities with `{ get; set; }` make invariants unenforceable because any consumer can construct invalid state. Smart constructors + `with`-expression transitions move validation to the only place it belongs: the type boundary.

**Control-flow violations** -- defects that break pipeline determinism:
- **IMPERATIVE_BRANCH** -- `if`/`else`/`while`/`for` fragments what should be a directed computation graph. Switch expressions and monadic `Bind` preserve exhaustiveness and totality.
- **EXCEPTION_CONTROL_FLOW** -- `try`/`catch`/`throw` hides failure paths from type signatures, defeating the entire ROP contract. `Fin`/`Validation`/`Eff` make failure *visible*.
- **PREMATURE_MATCH_COLLAPSE** -- calling `.Match()` mid-pipeline destroys the monadic context that downstream combinators need. `Map`/`Bind`/`BiMap` preserve the functor, reserving `Match` for the boundary where the caller consumes the result.
- **EARLY_RETURN_GUARDS** -- `if (!valid) return Error;` sequences scatter cyclomatic exits; `Validation<Error,T>` applicative pipeline collects all failures in one pass.

**Surface-area violations** -- defects that inflate API complexity:
- **OVERLOAD_SPAM** -- `ProcessSingle`/`ProcessBatch`/`ProcessAll` is three methods doing one thing at different arities. `params ReadOnlySpan<T>` + algebraic constraint collapses them.
- **API_SURFACE_INFLATION** -- `Get`/`GetMany`/`TryGet`/`GetOrDefault` is a query algebra disguised as method proliferation. One `Execute<R>(Query<K,V,R>)` entry point owns all variation.
- **INTERFACE_POLLUTION** -- `IFooService` with exactly one `FooService` implementation adds indirection without testability value. Remove the interface; use `Func<>` delegates or direct injection.
- **GOD_FUNCTION** -- a single function handling all variants via giant switch violates OCP. Each new variant requires modifying the god function. DU + `Fold` or `K<F,A>` abstraction makes extension additive.

**Allocation violations** -- defects specific to hot-path code:
- **CLOSURE_CAPTURE_HOT_PATH** -- implicit variable capture forces the runtime to allocate display classes. `static` lambdas + tuple threading keep the hot path allocation-free. Runtime closure allocation remains a known JIT frontier even in .NET 10.
- **MUTABLE_ACCUMULATOR** -- `var sum = 0; foreach...` breaks referential transparency and prevents vectorization. Tail-recursive folds or `Seq<T>.Fold` are the replacement.
- **LINQ_HOT_PATH** -- `IEnumerable` LINQ allocates state machines per enumerator. `ReadOnlySpan<T>` + `TensorPrimitives` for numeric aggregation, `Seq<T>.Choose` for functional filter+map.

**Naming violations**:
- **POSITIONAL_ARGS** -- unnamed arguments cause silent logic inversions when signature parameter order changes. Named parameters at domain call sites are the contract.
- **VARIABLE_REASSIGNMENT** -- `value = Process(value)` creates temporal coupling; `Bind`/`Map` chains make the directed computation graph explicit.

---
## [6][TEMPLATES]
>**Dictum:** *Scaffolds enforce structural compliance from first line.*

<br>

- **Pure domain module** (`pure-module.template.md`) -- types, smart constructors via `Fin<T>`, sealed DU hierarchies with `Fold`, C# 14 extension blocks for behavior projection. Start here for any entity or value object.
- **Effect service module** (`effect-module.template.md`) -- `Eff<RT,T>` ROP pipelines, `Has<RT,Trait>` environmental DI, LINQ comprehension with `guard`/`from..in..select`, `@catch` error recovery. Start here for any service or boundary adapter.
- **Algebraic abstraction module** (`algebra-module.template.md`) -- query algebras as sealed DUs, `K<F,A>` higher-kinded bridge with `.As()` downcast, `Foldable`/`Traversable` trait constraints. Start here for any cross-cutting generic abstraction.
- **Observable service module** (`observable-module.template.md`) -- `Eff<RT,T>` ROP pipelines with integrated `ActivitySource` tracing, `Meter` metrics, `[LoggerMessage]` logging, and `Observe` tap combinators. Start here for any service requiring structured telemetry.

---
## [7][LANGEXT_V5_CONVENTIONS]
>**Dictum:** *LanguageExt v5 idioms supersede v4 patterns.*

<br>

- **`.As()` downcast** -- `K<F,A>` results must be downcast to concrete types: `ParseInt<Fin>("123").As()` yields `Fin<int>`. Without `.As()`, consumers receive the unusable `K<Fin, int>`.
- **`@catch` operator** -- declarative error recovery via `|`: `CallApi(request) | @catch(Errors.TimedOut, error => Retry(request))`. Composes with `|` (Alternative/Choice) for fallback chains.
- **`|` fallback** -- `LoadFromFile(path) | LoadFromEnvironment() | Pure(Config.Default)`. Works across `Eff`, `IO`, `Fin`, `Option`.
- **Prefer LanguageExt collections** -- `Seq<T>` (10x faster than `Lst<T>`, trait-integrated), `HashMap<K,V>` (CHAMP, fastest immutable dict), `HashSet<T>`. BCL `ImmutableDictionary` does not implement `K<F,A>` traits.
- **`Validation<Error,T>`** standardized -- `Error` implements `Monoid` in v5, so `Validation<Error,T>` is valid. Use this form over `Validation<Seq<Error>,T>` unless explicit collection semantics are required.
- **Memoization boundary** -- `ConcurrentDictionary` + `Lazy<T>` wrapping inside memoize combinators is an intentional controlled side effect at the purity boundary. Document the exception.
