# [H1][PATTERNS]
>**Dictum:** *Expert knowledge is knowing which landmines to avoid and which gates to enforce.*

<br>

Anti-pattern codex with corrective examples for C# 14 / .NET 10 functional modules. For operational review checklists and detection heuristics, see `validation.md`.

---
## [1][ANTI_PATTERN_CODEX]
>**Dictum:** *Each anti-pattern is a local decision that compounds into global drag.*

<br>

**VAR_INFERENCE**

ANTI-PATTERN: `var result = Process(data);`
CORRECT: `Fin<DomainState> result = Process(payload: data);`
`var` erases the codomain from the reader's mental model -- the reviewer cannot determine whether this pipeline carries `Fin`, `Option`, `Validation`, or a raw value without navigating to the callee. Explicit types are the inline proof that the error channel is correct.

**POSITIONAL_ARGS**

ANTI-PATTERN: `UpdateRecord(id, true, 42);`
CORRECT: `UpdateRecord(targetId: id, isForced: true, retryCount: 42);`
Positional arguments cause silent logic inversions when parameters of the same type are reordered during refactoring. Named parameters make call sites self-documenting and compiler-verified against the callee signature. Exception: single-argument lambda invocations and LINQ predicates may use positional syntax.

**IMPERATIVE_BRANCH**

ANTI-PATTERN: `if (x == null) throw new Exception(); else return x;`
CORRECT:
```csharp
state switch {
    null => FinFail<T>(Error.New(message: "Vacant state")),
    T value => FinSucc(value)
};
```
`if`/`else` chains are statements that produce side effects; switch expressions are total functions that return values. Every arm is visible, exhaustiveness is compiler-verified, and the result flows directly into the next pipeline stage.

**OVERLOAD_SPAM**

ANTI-PATTERN: `public void Compute(int a, int b)` + `public void Compute(int a, int b, int c)`
CORRECT: `public T Compute<T>(params ReadOnlySpan<T> targets) where T : IAlgebraicMonoid<T>`
Every overload is a separate compilation unit the JIT must specialize. One polymorphic entry point with a monoid constraint handles all arities through a single fold -- no VTable fragmentation, no combinatorial signature explosion. See `composition.md` [2].

**EXCEPTION_CONTROL_FLOW**

ANTI-PATTERN: `if (val < 0) throw new ArgumentException();`
CORRECT: `return FinFail<TransactionAmount>(Error.New(message: "Negative value"));`
`throw` exits the function's declared return type via an invisible channel the caller cannot statically verify. `Fin<T>` makes failure a first-class value in the codomain -- callers are forced to handle both paths via `Bind`/`Map`/`Match`. See `effects.md` [1].

**LINQ_HOT_PATH**

ANTI-PATTERN: `items.Where(x => x > 0).Sum();` (on hot path)
CORRECT: `TensorPrimitives.Sum(x: span);` over `ReadOnlySpan<T>`
Each LINQ operator allocates a state-machine object on the heap; chaining N operators means N allocations per invocation. `TensorPrimitives` operates on contiguous memory via SIMD intrinsics -- zero allocation, vectorized execution. See `performance.md` [1].

**MUTABLE_ACCUMULATOR**

ANTI-PATTERN:
```csharp
List<Record> filtered = new();
foreach (Record item in data) { filtered.Add(item); }
```
CORRECT: `Seq<Record> filtered = source.Choose(chooser: (Record item) => predicate(item) ? Some(item) : None);`
`List<T>.Add` mutates shared state, which breaks referential transparency and prevents safe parallelization. `Seq<T>.Choose` fuses filter+map into a single-pass immutable pipeline with no intermediate allocations. For hot paths, use `ReadOnlySpan<T>` with a tail-recursive fold. See `composition.md` [2].

**VARIABLE_REASSIGNMENT**

ANTI-PATTERN:
```csharp
decimal price = GetPrice(asset: id);
price = ApplyTax(value: price);
```
CORRECT: `GetPrice(asset: id).Pipe((decimal p) => ApplyTax(value: p))`
Reassignment ruins the directed computation graph; use `Pipe`/`Map`/`Bind` chains. See `composition.md` [1].

**CLOSURE_CAPTURE_HOT_PATH**

ANTI-PATTERN:
```csharp
public static Eff<Unit> Process(Guid id) => FetchData().Bind((string data) => Update(id, data));
```
CORRECT:
```csharp
public static Eff<Unit> Process(Guid id) =>
    FetchData()
        .Map(static (string data) => (Data: data))
        .Bind(static ((string Data) state) =>
            Update(data: state.Data));
```
Thread all needed values through the tuple at each stage; each `static` lambda receives only its own parameter and captures nothing.
Each non-static lambda capturing an outer variable triggers a compiler-generated display class allocation. On hot paths this means one heap allocation per pipeline invocation. `static` lambdas with explicit tuple threading are zero-allocation -- the compiler verifies no capture at compile time. See `performance.md` [7].

**EARLY_RETURN_GUARDS**

ANTI-PATTERN:
```csharp
if (payload == null) return Error;
if (payload.Length > 100) return Error;
```
CORRECT: Unify all guards into `Validation<Error,T>` applicative pipeline collecting all failures simultaneously.
Sequential guards short-circuit on the first failure, hiding subsequent validation errors from the caller. `Validation<Error,T>` with applicative `.Apply()` evaluates all rules in parallel and accumulates every failure into a single error collection -- total verification in one pass. See `effects.md` [4].

**PREMATURE_MATCH_COLLAPSE**

ANTI-PATTERN: Calling `.Match(Succ: ..., Fail: ...)` mid-pipeline to extract a value, then re-wrapping in `Fin<T>`.
CORRECT: Use `.Map`/`.Bind`/`.BiMap` to transform within the monadic context; reserve `.Match` for the final program boundary.
`Match` destroys the `Fin`/`Option`/`Either` context -- any subsequent operation must reconstruct it, which duplicates error handling and defeats composition. LanguageExt explicitly warns against premature `Match`. See `effects.md` [1].

**API_SURFACE_INFLATION**

ANTI-PATTERN: `Get(id)`, `GetMany(ids)`, `GetOrDefault(id)`, `TryGet(id)`
CORRECT: `Execute<R>(StoreQuery<K,V,R> query)` -- one method, typed queries as the extensibility seam.
Each sibling method duplicates authorization, logging, and error-handling logic. A query algebra DU with a single `Fold` method centralizes all cross-cutting concerns at the `Execute` site while new query shapes are added as DU variants without modifying existing code. See `composition.md` [5].

**NULL_ARCHITECTURE**

ANTI-PATTERN: Using `null` for "not found", "error", "uninitialized", and "default" interchangeably.
CORRECT: `Option<T>` for "might not exist"; `Fin<T>` for "might fail with a reason".
`null` collapses four distinct semantic states into one untyped value. The caller has no way to distinguish absence from error without inspecting surrounding context -- which is precisely the kind of implicit coupling that produces NullReferenceException at runtime. Typed absence (`Option`) and typed failure (`Fin`) make each state explicit in the type system. See `effects.md` [1].

**INTERFACE_POLLUTION**

ANTI-PATTERN: `IFooService` for every `FooService` with exactly one implementation.
CORRECT: Inject `Func<>` delegates for testable substitution; reserve interfaces for genuine polymorphism (2+ implementations or `Has<RT,Trait>` DI).
Single-implementation interfaces add a file, a navigation indirection, and a naming convention (`IFoo`/`Foo`) that carries zero semantic information. The `Has<RT,Trait>` pattern in LanguageExt provides environmental DI without interface proliferation.

**ANEMIC_DOMAIN**

ANTI-PATTERN: Entity with only `{ get; set; }` properties; logic scattered across service classes.
CORRECT: Entity owns state transitions via smart constructors returning `Fin<T>` and immutable records with `with`-expressions.
When invariants live in service classes rather than the entity itself, every consumer must independently remember and re-implement those checks. A smart constructor centralizes validation at the only point of construction -- `{ get; set; }` bags are data transfer objects, not domain entities. See `types.md` [1].

**GOD_FUNCTION**

ANTI-PATTERN: Single function handling all cases via a giant switch that violates OCP.
CORRECT: Polymorphic dispatch via DU + `Fold` catamorphism or trait-based `K<F,A>` abstraction.
Litmus test: if adding a new case requires modifying existing function bodies, the function is a god function. A DU with a `Fold` method turns each new case into a new variant -- the existing fold arguments remain untouched, existing interpretations continue to compile. See `composition.md` [5].

**HELPER_SPAM**

ANTI-PATTERN: `private static Fin<T> ValidateHelper(T value)` called from a single site.
CORRECT: Inline the logic at the call site, or if used from 2+ modules, promote to a domain-specific function on the owning type.
Single-call private helpers are the lowest-quality code in a module -- they fragment the reader's attention without providing reuse. Multi-call helpers shared across modules indicate the module boundary is wrong; the function belongs on the entity or algebra that owns the concept.

**DENSITY_OVER_VOLUME**

ANTI-PATTERN: 500-line module with repetitive `switch` arms containing near-identical bodies.
CORRECT: Extract the varying part into a fold algebra or `K<F,A>` generic function; the repetitive structure collapses to a single polymorphic pipeline.
Dense code is not short code -- it is code where every line carries unique semantic weight. ~400 LOC is a signal to evaluate whether the module contains multiple domain concerns or brute-force inlining that a better abstraction would eliminate. File proliferation and splitting into helper files are always code smells.

---
## [2][ERROR_SYMPTOMS]
>**Dictum:** *Symptoms point to structural causes; fixes are architectural.*

<br>

| [INDEX] | [SYMPTOM]                              | [CAUSE]                       | [FIX]                                              |
| :-----: | -------------------------------------- | ----------------------------- | -------------------------------------------------- |
|   [1]   | `var x = ...` in domain code           | Type inference hiding intent  | Replace with explicit `Fin<T>` / `Option<T>` type  |
|   [2]   | `if (x != null)` guard blocks          | Null-based architecture       | Use `Option<T>` + `Match` at boundary              |
|   [3]   | `try { } catch (Exception e) { }`      | Exception-driven control flow | Use `Fin<T>` / `Eff<RT,T>` error channel           |
|   [4]   | `foreach` + mutable accumulator        | Imperative iteration          | Tail-recursive fold over `ReadOnlySpan<T>`         |
|   [5]   | Multiple overloads for same concept    | Arity bloat                   | `params ReadOnlySpan<T>` + algebraic constraint    |
|   [6]   | `Match` called mid-pipeline            | Premature context collapse    | Use `Map`/`Bind`/`BiMap` instead                   |
|   [7]   | Lambda captures method parameter       | Hidden closure allocation     | `static` lambda + tuple threading                  |
|   [8]   | `IService` with single implementation  | Interface pollution           | Remove interface; inject `Func<>` or use directly  |
|   [9]   | Entity with only `{ get; set; }`       | Anemic domain model           | Smart constructors + `with`-expression transitions |
|  [10]   | `.Where().Sum()` on hot path           | LINQ heap allocation          | `TensorPrimitives` / span-based processing         |
|  [11]   | `null` used for 2+ semantic meanings   | Collapsed absence semantics   | `Option<T>` for absence, `Fin<T>` for failure      |
|  [12]   | 3+ sibling methods (`Get`/`TryGet`)    | API surface inflation         | One `Execute<R>(Query)` entry point                |
|  [13]   | `private` method with single caller    | Helper spam                   | Inline at call site or promote to domain type      |
|  [14]   | Repetitive switch arms, near-identical | Brute-force inlining          | Fold algebra or `K<F,A>` generic pipeline          |

---
## [3][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                | [WHEN]                                     | [KEY_TRAIT]                               |
| :-----: | ------------------------ | ------------------------------------------ | ----------------------------------------- |
|   [1]   | VAR_INFERENCE            | `var` hides codomain semantics             | Explicit `Fin<T>` / `Option<T>` types     |
|   [2]   | POSITIONAL_ARGS          | Unnamed arguments at call site             | Named parameters at every invocation      |
|   [3]   | IMPERATIVE_BRANCH        | `if`/`else`/`for`/`while` in domain code   | Switch expressions + monadic `Bind`       |
|   [4]   | OVERLOAD_SPAM            | Sibling method families                    | `params ReadOnlySpan<T>` + monoid         |
|   [5]   | EXCEPTION_CONTROL_FLOW   | `try`/`catch`/`throw` in domain code       | `Fin<T>` / `Eff<RT,T>` error channel      |
|   [6]   | LINQ_HOT_PATH            | IEnumerable LINQ on hot path               | `TensorPrimitives` / span processing      |
|   [7]   | MUTABLE_ACCUMULATOR      | `foreach` + mutable variable               | Tail-recursive fold / `Seq<T>` transducer |
|   [8]   | VARIABLE_REASSIGNMENT    | `value = Process(value)` re-binding        | `Pipe` / `Map` / `Bind` chains            |
|   [9]   | CLOSURE_CAPTURE_HOT_PATH | Lambda captures outer variable on hot path | `static` lambda + tuple threading         |
|  [10]   | EARLY_RETURN_GUARDS      | Sequential `if (!valid) return` guards     | `Validation<Error,T>` applicative         |
|  [11]   | PREMATURE_MATCH_COLLAPSE | `.Match` called mid-pipeline               | `Map`/`Bind`/`BiMap` within pipelines     |
|  [12]   | API_SURFACE_INFLATION    | `Get`/`GetMany`/`TryGet` sibling methods   | `Execute<R>(query)` algebra pattern       |
|  [13]   | NULL_ARCHITECTURE        | `null` for multiple semantic states        | `Option<T>` / `Fin<T>` typed absence      |
|  [14]   | INTERFACE_POLLUTION      | `IService` with single implementation      | `Func<>` delegates or direct use          |
|  [15]   | ANEMIC_DOMAIN            | Entity with only getters/setters           | Smart constructors + `with`-expressions   |
|  [16]   | GOD_FUNCTION             | Giant switch violating OCP                 | DU + `Fold` / `K<F,A>` abstraction        |
|  [17]   | HELPER_SPAM              | `private` function with single call site   | Inline at call site or promote to type    |
|  [18]   | DENSITY_OVER_VOLUME      | Repetitive switch arms, brute-force inline | Fold algebra / `K<F,A>` generic pipeline  |
