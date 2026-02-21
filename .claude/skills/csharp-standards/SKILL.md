---
name: csharp-standards
description: >-
  Sole authority on C# style, type discipline, error handling, concurrency, and
  module organization in this workspace. MUST be loaded for every C# / .NET code
  interaction. Use when performing ANY C#-related task:
  (1) writing, editing, creating, reviewing, refactoring, or debugging any
  .cs module, sealed DU hierarchy, smart constructor, or LanguageExt
  Fin/Validation/Eff pipeline;
  (2) implementing domain services, boundary adapters, ASP.NET endpoints,
  gRPC stubs, or Thinktecture value objects;
  (3) configuring Directory.Build.props, .editorconfig, .csproj files, NuGet
  packages, or Roslyn analyzers (CSP0001-CSP0008);
  (4) working with Serilog, OpenTelemetry, Polly resilience, NodaTime,
  FluentValidation, Npgsql, or any .NET library in this monorepo;
  (5) writing or editing FsCheck property tests, xUnit test projects,
  BenchmarkDotNet benchmarks, or test configuration.
metadata:
  token_estimates:
    entry_point: 4800
    full_load: 26500
    max_load: 74000
---

# [H1][CSHARP-STANDARDS]
>**Dictum:** *Functional discipline unifies C# 14 / .NET 10 authoring with LanguageExt v5-beta-77.*

<br>

This skill enforces a **single dense style** for C# 14 / .NET 10 modules: smart constructors via `Fin<T>`, discriminated unions via sealed abstract records, zero-branching monadic pipelines via `Eff<RT,T>`, applicative validation via `Validation<Error,T>`, higher-kinded abstraction via `K<F,A>`, and hardware-accelerated hot paths via `TensorPrimitives` / `Vector512<T>`.

---
## [1][LOAD_SEQUENCE]
>**Dictum:** *Standards enforcement requires comprehensive awareness -- selective loading creates blind spots.*

<br>

References are complementary -- type discipline applies when writing effects; anti-patterns apply when writing types. Enforcement demands layered awareness. Hold all loaded references stable through task completion.

**Step 1 -- Foundation (always load first)**

| [INDEX] | [REFERENCE]     | [FOCUS]            |
| :-----: | :-------------- | ------------------ |
|   [1]   | `validation.md` | Compliance checks  |
|   [2]   | `patterns.md`   | Anti-pattern codex |

**Step 2 -- Core (always load second)**

| [INDEX] | [REFERENCE]      | [FOCUS]                        |
| :-----: | :--------------- | ------------------------------ |
|   [3]   | `types.md`       | Primitives, DUs, phantom state |
|   [4]   | `objects.md`     | Object topology (Thinktecture) |
|   [5]   | `effects.md`     | Fin/Validation/Eff/IO          |
|   [6]   | `composition.md` | LINQ + `K<F,A>` composition    |

**Step 3 -- Specialized (load when task requires)**

| [INDEX] | [REFERENCE]        | [LOAD_WHEN]                   |
| :-----: | :----------------- | ----------------------------- |
|   [7]   | `algorithms.md`    | Recursion schemes, folds      |
|   [8]   | `performance.md`   | SIMD/span hot paths           |
|   [9]   | `observability.md` | Logs/traces/metrics           |
|  [10]   | `concurrency.md`   | Channels + cancellation       |
|  [11]   | `diagnostics.md`   | Debugging + profiling         |
|  [12]   | `testing.md`       | PBT + benchmarks + containers |
|  [13]   | `persistence.md`   | EF Core + repositories        |

**Step 4 -- Template (scaffolding only)**

| [INDEX] | [TEMPLATE]                      | [ARCHETYPE] |
| :-----: | :------------------------------ | :---------: |
|  [14]   | `pure-module.template.md`       |    Pure     |
|  [15]   | `effect-module.template.md`     |   Effect    |
|  [16]   | `algebra-module.template.md`    |   Algebra   |
|  [17]   | `observable-module.template.md` | Observable  |

---
## [2][CONTRACTS]
>**Dictum:** *Structural invariants constrain all modules.*

<br>

**Density over volume**
- **~300 LOC signals a refactoring opportunity** -- dense polymorphic patterns compress well-architected modules. A sealed DU hierarchy with exhaustive arms may legitimately exceed it when the module owns exactly one concept. File proliferation and helper extraction are *always* code smells. Cap applies to `.cs` source modules only.
- **File-scoped namespaces** only (`namespace X;`). **Explicit accessibility** on every member.

**Imports convention**
- **`using static LanguageExt.Prelude;`** assumed in every module -- provides `Some`, `None`, `unit`, `pure`, `error`, `guard`, `liftIO`, `Seq`, `HashMap`, `Atom`, `ms`, `sec`. `Ref<T>` requires explicit `using LanguageExt;` (STM module, not in Prelude).

**Type discipline**
- **Zero `var`** -- all types explicit in declarations and lambda parameters.
- **Named parameters** at every domain call site (`Create(candidate: value)`). Framework/LINQ and single-argument lambdas may use positional syntax.
- **`readonly record struct`** for domain primitives; `sealed abstract record` for DUs. **Expression-bodied members** where the body is a single expression. **Primary constructors** preferred per `.editorconfig`.

**Control-flow discipline**
- **Zero `if`/`else`/`else if`/`while`/`for`/`foreach` in domain transforms** -- use `switch` expressions (C# equivalent of `Match.type`) and monadic `Bind`/`Map`.
- **Zero `try`/`catch`/`throw` in domain transforms** -- use `Fin<T>`, `Validation<Error,T>`, `Eff<RT,T>`, or `IO<A>`.
- **Exhaustive `switch`** with compiler-enforced coverage on DU hierarchies:
```csharp
result.Match(
    Succ: value => /* handle success */,
    Fail: error => error.Match(
        NotFound: _ => /* handle missing */,
        Validation: errs => /* handle invalid */
    )
);
// Alternatively: @catch to intercept specific errors in Eff pipelines
```
- **Time acquisition is injected** (`NodaTime.IClock` or `System.TimeProvider` bridge), never direct `DateTime*` calls.
- **Custom policy enforcement** via analyzers `CSP0001`-`CSP0008`.

**Boundary adapter exemptions** -- modules interfacing with external protocols (HTTP handlers, DB clients, message consumers, gRPC stubs).
- **Exempt flow** -- annotate each site with `[BOUNDARY ADAPTER -- reason]`:
  - `await foreach(...).WithCancellation(ct)` -- async stream enumeration
  - `if (ct.IsCancellationRequested)` -- cancellation guard
  - `if` + `yield return` in async iterator bodies -- C# spec requires statement form; no switch-expression or ternary equivalent exists
  - `try/finally` for resource cleanup -- acquire/use/release lifecycle
  - `yield return` in async generators adapting external I/O -- exempted from pure-function rules
- See `validation.md` [2].

**Effect discipline**
- **`Fin<T>`** for synchronous fallible operations (isomorphic to `Either<Error,A>`).
- **`Validation<Error,T>`** for parallel error accumulation (applicative, zero short-circuit).
- **`Eff<RT,T>`** for effectful pipelines with environmental DI via `Has<RT,Trait>`.
- **`IO<A>`** for boundary side effects (lazy effect: Pure/Fail/Sync/Async thunks).
- **`K<F,A>`** for higher-kinded generic algorithms (`Fallible`, `Applicative`, `Monad` constraints).
- **FluentValidation** for boundary-layer async rule sets (HTTP request DTOs, external payloads). Bridge to `Validation<Error,T>` via `ValidateAsync` before entering domain pipelines. See `validation.md` [2A].

**Surface minimization**
- **`params ReadOnlySpan<T>`** for arity collapse. See `composition.md` [2].
- **`SearchValues<char>` + `ContainsAnyExcept`/`IndexOfAnyExcept`** for fixed char-set validations (`length + allowed chars`) on hot paths; reserve `[GeneratedRegex]` for richer grammars. See `performance.md` [7A].
- **Sealed DU hierarchies**: `sealed abstract record` base + `sealed record` cases. Static factories on abstract base for construction.
- **`static` lambdas** on hot-path closures -- zero closure allocations.
- **C# 14 extension blocks** for behavior projection without inheritance. See `types.md` [4].
- **`static abstract` interface members** for compile-time dispatch (type classes, factories, defaults). See `types.md` [4], `algorithms.md` [3].

**Formatting** (compiler/editorconfig-enforced)
- **K&R brace style**, **zero consecutive blank lines**, **method group conversion** preferred, **UTF-8 string literals** preferred.

---
## [3][ROUTING]
>**Dictum:** *Foundation and core load unconditionally; routing selects specialization and templates.*

<br>

Core + foundation references are always loaded per [1]. The routing table selects additional specialized references and templates.

| [INDEX] | [TASK]                        | [ADD_SPECIALIZED]                   | [TEMPLATE]                      |
| :-----: | ----------------------------- | ----------------------------------- | ------------------------------- |
|   [1]   | Scaffold pure domain module   | --                                  | `pure-module.template.md`       |
|   [2]   | Scaffold effect service       | --                                  | `effect-module.template.md`     |
|   [3]   | Scaffold algebra module       | `algorithms.md`                     | `algebra-module.template.md`    |
|   [4]   | Refactor object model         | --                                  | --                              |
|   [5]   | Refactor domain types/DUs     | --                                  | --                              |
|   [6]   | Refactor ROP pipeline         | --                                  | --                              |
|   [7]   | Refactor composition/LINQ     | --                                  | --                              |
|   [8]   | Optimize hot path             | `performance.md`                    | --                              |
|   [9]   | Review existing module        | --                                  | --                              |
|  [10]   | Implement recursion/folds     | `algorithms.md`                     | --                              |
|  [11]   | Implement `K<F,A>` algo       | `algorithms.md`                     | --                              |
|  [12]   | Vectorize numeric code        | `performance.md`                    | --                              |
|  [13]   | Refactor logging/tracing      | `observability.md`                  | --                              |
|  [14]   | Refactor concurrency          | `concurrency.md`                    | --                              |
|  [15]   | Debug/profile functional code | `diagnostics.md`                    | --                              |
|  [16]   | Scaffold observable service   | `observability.md` `concurrency.md` | `observable-module.template.md` |
|  [17]   | Write/review tests            | `testing.md`                        | --                              |
|  [18]   | Implement persistence layer   | `persistence.md`                    | --                              |

---
## [4][DECISION_TREES]
>**Dictum:** *Route decisions before loading references.*

<br>

**Type family** -- select the encoding that makes illegal states unrepresentable at the narrowest type boundary.

| [INDEX] | [DATA_SHAPE]                    | [USE]                                  | [KEY_TRAIT]                           |
| :-----: | :------------------------------ | -------------------------------------- | ------------------------------------- |
|   [1]   | **Object model topology**       | See `objects.md` [1] topology table    | topology annotations                  |
|   [2]   | **Domain primitive**            | `readonly record struct` + `Fin<T>`    | `{ get; }` only; normalize in factory |
|   [3]   | **Source-gen payload DU**       | `[Union]` + `abstract partial record`  | Generated `Switch`/`Map` exhaustive   |
|   [4]   | **Sealed DU hierarchy**         | `sealed abstract record` + cases       | Switch expression arms                |
|   [5]   | **Zero-alloc wrapper**          | `Newtype<TTag, TRepr>`                 | `[ValueObject<T>]` for public API     |
|   [6]   | **Compile-time state tracking** | `UserId<TState>` phantom parameter     | Empty `readonly struct` markers       |
|   [7]   | **Inline property validation**  | `field` keyword setter (non-validated) | Auto-rounding; NOT for `Fin<T>` types |

**Error channel** -- match the effect type to the failure mode.

| [INDEX] | [FAILURE_SHAPE]                        | [USE]                  | [KEY_TRAIT]                                   |
| :-----: | :------------------------------------- | ---------------------- | --------------------------------------------- |
|   [1]   | **Synchronous fallible operation**     | `Fin<T>`               | `Bind`/`Map` chain; `Match` at boundary only  |
|   [2]   | **Parallel multi-field validation**    | `Validation<Error,T>`  | Applicative `.Apply()` tuple; collects all    |
|   [3]   | **Effectful pipeline with DI**         | `Eff<RT,T>`            | `Has<RT,Trait>` + LINQ `from..in..select`     |
|   [4]   | **Boundary side effect**               | `IO<A>`                | Pure/Fail/Sync/Async + `Run`/`RunAsync`       |
|   [5]   | **Algorithm generic over computation** | `K<F,A>` + constraints | `Fallible`/`Applicative`/`Monad`/`Foldable`   |
|   [6]   | **Declarative fallback chain**         | `\|` operator          | `Alternative<F>`/`Choice<F>` trait on Eff/Fin |

**Module archetype** -- determines which template to scaffold.

| [INDEX] | [WHAT_YOU_ARE_BUILDING]                              | [ARCHETYPE] | [TEMPLATE]                      |
| :-----: | :--------------------------------------------------- | :---------: | ------------------------------- |
|   [1]   | **Types + validators + transforms + extensions**     |    Pure     | `pure-module.template.md`       |
|   [2]   | **ROP pipelines + DI traits + boundary handling**    |   Effect    | `effect-module.template.md`     |
|   [3]   | **Algebraic interfaces + HKT + query unions**        |   Algebra   | `algebra-module.template.md`    |
|   [4]   | **ROP pipelines + DI traits + integrated telemetry** | Observable  | `observable-module.template.md` |

---
## [5][ANTI_PATTERNS]
>**Dictum:** *Expert knowledge is knowing which landmines to avoid.*

<br>

Each anti-pattern names a structural defect that propagates if left unchecked. See `validation.md` [7] for detection heuristics.

**Type-system violations**
- **VAR_INFERENCE** -- `var` hides codomain semantics; when `Fin<T>` silently becomes `Option<T>` under refactoring, the compiler cannot distinguish intention from accident.
- **NULL_ARCHITECTURE** -- `null` encoding three states (not-found, error, uninitialized) collapses distinct failure modes. `Option<T>` for absence, `Fin<T>` for failure.
- **ANEMIC_DOMAIN** -- entities with `{ get; set; }` make invariants unenforceable. Smart constructors + `with`-expression transitions move validation to the type boundary.

**Control-flow violations**
- **IMPERATIVE_BRANCH** -- `if`/`else`/`while`/`for` fragments directed computation. Switch expressions and monadic `Bind` preserve exhaustiveness.
- **EXCEPTION_CONTROL_FLOW** -- `try`/`catch`/`throw` hides failure from type signatures. `Fin`/`Validation`/`Eff` make failure *visible*.
- **PREMATURE_MATCH_COLLAPSE** -- `.Match()` mid-pipeline destroys monadic context. `Map`/`Bind`/`BiMap` preserve the functor; reserve `Match` for boundaries.
- **EARLY_RETURN_GUARDS** -- `if (!valid) return Error;` scatters cyclomatic exits. `Validation<Error,T>` applicative pipeline collects all failures in one pass.

```csharp
// [ANTI-PATTERN] VAR_INFERENCE -- hidden codomain
var result = TransformPayload(data);
```
```csharp
// [CORRECT] -- explicit effect type + named parameter
Fin<DomainState> result = TransformPayload(payload: data);
```

```csharp
// [ANTI-PATTERN] IMPERATIVE_BRANCH -- null check with early return
if (state == null) return Error.New("vacant");
```
```csharp
// [CORRECT] -- lift to Option, convert to Fin
Optional(state).ToFin(Error.New(message: "Vacant state"));
```

```csharp
// [ANTI-PATTERN] PREMATURE_MATCH_COLLAPSE -- Match destroys monadic context
Fin<int> x = Parse(input).Match(Succ: v => Fin.Succ(v + 1), Fail: e => Fin.Fail<int>(e));
```
```csharp
// [CORRECT] -- Map preserves the functor
Fin<int> x = Parse(input).Map((int value) => value + 1);
```

**Surface-area violations**
- **OVERLOAD_SPAM** -- three methods at different arities. `params ReadOnlySpan<T>` + algebraic constraint collapses them. See `composition.md` [2].
- **API_SURFACE_INFLATION** -- `Get`/`GetMany`/`TryGet`/`GetOrDefault` is query algebra as method proliferation. One `Execute<R>(Query<K,V,R>)` entry point owns all variation.
- **INTERFACE_POLLUTION** -- `IFooService` with exactly one implementation adds zero testability. Remove; use `Func<>` delegates or direct injection.
- **GOD_FUNCTION** -- giant switch handling all variants violates OCP. DU + exhaustive `Switch`/`Map` (Thinktecture) or `K<F,A>` abstraction makes extension additive.

**Allocation violations**
- **CLOSURE_CAPTURE_HOT_PATH** -- implicit capture forces display class allocation. `static` lambdas + tuple threading keep hot paths allocation-free.
- **MUTABLE_ACCUMULATOR** -- `var sum = 0; foreach...` breaks referential transparency. Tail-recursive folds or `Seq<T>.Fold` replace it.
- **LINQ_HOT_PATH** -- `IEnumerable` LINQ allocates state machines. `ReadOnlySpan<T>` + `TensorPrimitives` for numeric aggregation, `Seq<T>.Choose` for filter+map.

**Naming violations**
- **POSITIONAL_ARGS** -- unnamed arguments cause silent logic inversions. Named parameters at domain call sites.
- **VARIABLE_REASSIGNMENT** -- `value = Process(value)` creates temporal coupling. `Bind`/`Map` chains make the computation graph explicit.

---
## [6][TEMPLATES]
>**Dictum:** *Scaffolds enforce structural compliance from first line.*

<br>

- **Pure domain module** (`pure-module.template.md`) -- types, smart constructors via `Fin<T>`, sealed DU hierarchies with exhaustive `Switch`/`Map`, C# 14 extension blocks.
- **Effect service module** (`effect-module.template.md`) -- `Eff<RT,T>` ROP pipelines, `Has<RT,Trait>` environmental DI, LINQ comprehension with `guard`/`from..in..select`, `@catch` error recovery.
- **Algebraic abstraction module** (`algebra-module.template.md`) -- query algebras as sealed DUs, `K<F,A>` higher-kinded bridge with `.As()` downcast, `Foldable`/`Traversable` trait constraints.
- **Observable service module** (`observable-module.template.md`) -- `Eff<RT,T>` ROP pipelines with `ActivitySource` tracing, `Meter` metrics, `[LoggerMessage]` logging, and `Observe` tap combinators.

---
## [7][LANGEXT_V5_BETA77_CONVENTIONS]
>**Dictum:** *LanguageExt v5-beta-77 idioms supersede v4 patterns.*

<br>

- **`.As()` downcast** -- `K<F,A>` results must be downcast to concrete types: `ParseInt<Fin>("123").As()` yields `Fin<int>`. Without `.As()`, consumers receive the unusable `K<Fin, int>`.
- **`@catch` operator** -- declarative error recovery: `CallApi(request) | @catch(Errors.TimedOut, static error => Retry(request))`.
- **`|` fallback** -- `LoadFromFile(path) | LoadFromEnvironment() | Pure(Config.Default)`. Works across `Eff`, `IO`, `Fin`, `Option`. Composes with `@catch` for typed fallback chains.
- **Prefer LanguageExt collections** -- `Seq<T>` (array-backed, faster iteration/indexing than `Lst<T>`; trait-integrated via `K<Seq, A>`), `HashMap<K,V>` (CHAMP), `HashSet<T>`. BCL `ImmutableDictionary` does not implement `K<F,A>` traits.
- **`Validation<Error,T>`** standardized -- `Error` implements `Monoid` in v5, so `Validation<Error,T>` is valid. Use this form over `Validation<Seq<Error>,T>`.
- **Memoization boundary** -- `Atom<HashMap<K,V>>` for lock-free memoize combinators with CAS semantics: `Atom(HashMap<CacheKey, Result>.Empty)`. `ConcurrentDictionary` is an infrastructure escape hatch in boundary adapters only.
