# [H1][PATTERNS]
>**Dictum:** *Expert knowledge: which landmines to avoid, which gates to enforce.*

Anti-pattern codex with corrective examples for C# 14 / .NET 10 functional modules. All examples assume `using static LanguageExt.Prelude;`. For detection heuristics, see `validation.md`.

---
## [1][ANTI_PATTERN_CODEX]
>**Dictum:** *Each anti-pattern is a local decision that compounds into global drag.*

**VAR_INFERENCE**

[ANTI-PATTERN]: `var result = Process(data);`
[CORRECT]: `Fin<DomainState> result = Process(payload: data);`
`var` erases the codomain from the reader's mental model -- the reviewer cannot determine whether this pipeline carries `Fin`, `Option`, `Validation`, or a raw value without navigating to the callee. Explicit types are the inline proof that the error channel is correct.

**POSITIONAL_ARGS**

[ANTI-PATTERN]: `UpdateRecord(id, true, 42);`
[CORRECT]: `UpdateRecord(targetId: id, isForced: true, retryCount: 42);`
Positional arguments cause silent logic inversions when parameters of the same type are reordered during refactoring. Named parameters make call sites self-documenting and compiler-verified. Exception: single-argument lambda invocations and LINQ predicates may use positional syntax.

**IMPERATIVE_BRANCH**

[ANTI-PATTERN]: `if (x == null) throw new Exception(); else return x;`
[CORRECT]:
```csharp
// [CORRECT]
Optional(state).ToFin(Error.New(message: "Vacant state"));
```
`if`/`else` chains are statements that produce side effects; `Option<T>` with `ToFin` is a total function that returns a value. The result flows directly into the next pipeline stage via `Bind`/`Map`.

**OVERLOAD_SPAM**

[ANTI-PATTERN]: `public void Compute(int a, int b)` + `public void Compute(int a, int b, int c)`
[CORRECT]: `public T Compute<T>(params ReadOnlySpan<T> targets) where T : IAlgebraicMonoid<T>`
Every overload is a separate compilation unit the JIT must specialize. One polymorphic entry point with a monoid constraint handles all arities through a single fold -- single JIT specialization path, no combinatorial signature explosion. See `composition.md [3]`.

**EXCEPTION_CONTROL_FLOW**

[ANTI-PATTERN]: `if (val < 0) throw new ArgumentException();`
[CORRECT]: `return Fin.Fail<TransactionAmount>(Error.New(message: "Negative value"));`
`throw` exits the function's declared return type via an invisible channel the caller cannot statically verify. `Fin<T>` makes failure a first-class value in the codomain -- callers handle both paths via `Bind`/`Map`/`Match`. See `effects.md [1]`.

**LINQ_HOT_PATH**

[ANTI-PATTERN]: `items.Where(x => x > 0).Sum();` (on hot path)
[CORRECT]: `TensorPrimitives.Sum(x: span);` over `ReadOnlySpan<T>`
Each LINQ operator allocates a state-machine object on the heap; chaining N operators means N allocations per invocation. `TensorPrimitives` operates on contiguous memory via SIMD intrinsics -- zero allocation, vectorized execution. See `performance.md [1]`.

**MUTABLE_ACCUMULATOR**

[ANTI-PATTERN]: `List<Record> filtered = new(); foreach (Record item in data) { filtered.Add(item); }`
[CORRECT]: `Seq<Record> filtered = source.Choose((Record item) => predicate(item) ? Some(item) : None);`
`List<T>.Add` mutates shared state, breaking referential transparency. `Seq<T>.Choose` fuses filter+map into a single-pass immutable pipeline. For hot paths, use `ReadOnlySpan<T>` with a tail-recursive fold. See `composition.md [3]`.

**VARIABLE_REASSIGNMENT**

[ANTI-PATTERN]: `decimal price = GetPrice(asset: id); price = ApplyTax(value: price);`
[CORRECT]: `GetPrice(asset: id).Map((decimal price) => ApplyTax(value: price))`
Reassignment ruins the directed computation graph. When the source returns `Fin<T>`, use `Map`/`Bind` to transform within the monadic context; for raw values, use `Pipe`. See `composition.md [1]`.

**CLOSURE_CAPTURE_HOT_PATH**

[ANTI-PATTERN]: `public static Eff<Unit> Process(Guid id) => FetchData().Bind((string data) => Update(id, data));`
[CORRECT]:
```csharp
// [CORRECT]
public static Eff<Unit> Process(Guid id) =>
    FetchData()
        .Map((string data) => (Id: id, Data: data))
        .Bind(static ((Guid Id, string Data) state) =>
            Update(id: state.Id, data: state.Data));
```
Each non-static lambda capturing an outer variable triggers a display class allocation. `static` lambdas with tuple threading are zero-allocation -- the compiler verifies no capture at compile time. See `performance.md [7]`.

**EARLY_RETURN_GUARDS**

[ANTI-PATTERN]: `if (payload == null) return Error; if (payload.Length > 100) return Error;`
[CORRECT]:
```csharp
// [CORRECT]
(ValidateNotNull(payload), ValidateLength(payload, maxLength: 100))
    .Apply(static (validated, _) => validated)
    .ToFin();
```
Sequential guards short-circuit on the first failure, hiding subsequent errors. `Validation<Error,T>` with applicative `.Apply()` evaluates all rules and accumulates every failure into a single error collection. See `effects.md [4]`.

**PREMATURE_MATCH_COLLAPSE**

[ANTI-PATTERN]: Calling `.Match(Succ: ..., Fail: ...)` mid-pipeline to extract a value, then re-wrapping in `Fin<T>`.
[CORRECT]: Use `.Map`/`.Bind`/`.BiMap` to transform within the monadic context; reserve `.Match` for the final program boundary.
`Match` destroys the `Fin`/`Option`/`Either` context -- subsequent operations must reconstruct it, duplicating error handling and defeating composition. See `effects.md [1]`.

**API_SURFACE_INFLATION**

[ANTI-PATTERN]: `Get(id)`, `GetMany(ids)`, `GetOrDefault(id)`, `TryGet(id)`
[CORRECT]: `Execute<R>(StoreQuery<K,V,R> query)` -- one method, typed queries as the extensibility seam.
Each sibling method duplicates authorization, logging, and error-handling logic. A query algebra DU with a single `Fold` method centralizes cross-cutting concerns while new query shapes are added as DU variants without modifying existing code. See `composition.md [5]`.

**NULL_ARCHITECTURE**

[ANTI-PATTERN]: Using `null` for "not found", "error", "uninitialized", and "default" interchangeably.
[CORRECT]: `Option<T>` for "might not exist"; `Fin<T>` for "might fail with a reason".
`null` collapses four distinct semantic states into one untyped value. Typed absence (`Option`) and typed failure (`Fin`) make each state explicit in the type system. See `effects.md [1]`.

**INTERFACE_POLLUTION**

[ANTI-PATTERN]: `IFooService` for every `FooService` with exactly one implementation.
[CORRECT]: Use runtime-record DI with `Eff<RT,T>.Asks(...)` for effectful services; `Func<>` delegates for pure-module testable substitution. Reserve interfaces for genuine polymorphism (2+ implementations). Composition roots should prefer constrained Scrutor scans plus `RegistrationStrategy.Throw` over hand-maintained `AddScoped` lists.
Single-implementation interfaces add a file, a navigation indirection, and a naming convention (`IFoo`/`Foo`) that carries zero semantic information.

**ANEMIC_DOMAIN**

[ANTI-PATTERN]: Entity with only `{ get; set; }` properties; logic scattered across service classes.
[CORRECT]: `sealed record` entity owns state transitions via smart constructors returning `Fin<T>` and immutable `with`-expressions.
When invariants live in service classes rather than the entity itself, every consumer must independently re-implement those checks.

**GOD_FUNCTION**

[ANTI-PATTERN]: Single function handling all cases via a giant switch that violates OCP.
[CORRECT]: Polymorphic dispatch via `sealed abstract record` DU + `Fold` catamorphism or trait-based `K<F,A>` abstraction.
Litmus test: adding a new case requires modifying existing function bodies. A DU with a `Fold` method turns each new case into a variant -- existing fold arguments remain untouched. See `composition.md` [5] `Expr.Fold` catamorphism for a full inline example of DU + recursive fold replacing interpreter classes.

**HELPER_SPAM**

[ANTI-PATTERN]: `private static Fin<T> ValidateHelper(T value)` called from a single site.
[CORRECT]: Inline the logic at the call site, or if used from 2+ modules, promote to a domain-specific function on the owning type.

**PHANTOM_BYPASS**

[ANTI-PATTERN]: Public constructor on phantom-parameterized type allows skipping the `Fin<T>` validation factory.
```csharp
// [ANTI-PATTERN] -- positional syntax exposes public constructor
public readonly record struct UserId<TState>(Guid Value);
UserId<Validated> fake = new(Value: Guid.Empty); // compiles, skips Validate()
```
[CORRECT]: Private constructor + `internal static UnsafeWrap` factory. All external construction routes through the `Fin<T>` validation pipeline.
```csharp
// [CORRECT] -- private ctor + internal factory gated by Validate()
public readonly record struct UserId<TState> {
    public Guid Value { get; }
    private UserId(Guid value) => Value = value;
    internal static UserId<TState> UnsafeWrap(Guid value) => new(value);
}
```

**DUAL_CANONICAL_SHAPE**

[ANTI-PATTERN]: Two encoding strategies (`Newtype<Tag,T>` and `[ValueObject<T>]`) for the same domain concept in the same bounded context.
[CORRECT]: Choose one per concept. `[ValueObject<T>]` when JSON/EF/ModelBinding integration is needed and `ValidateFactoryArguments` suffices. `Newtype<TTag,TRepr>` when zero-alloc is critical and no boundary serialization is required. `readonly record struct` + `Fin<T>` factory when custom multi-step validation logic is needed. Never mix encodings for the same primitive within a bounded context.

**DENSITY_OVER_VOLUME**

[ANTI-PATTERN]: 500-line module with repetitive switch arms containing near-identical bodies.
[CORRECT]: Extract the varying part into a fold algebra or `K<F,A>` generic function; the repetitive structure collapses to a single polymorphic pipeline. File proliferation and helper extraction are always code smells.

---
## [2][QUICK_REFERENCE]
>**Dictum:** *Symptoms point to structural causes; fixes are architectural.*

| [INDEX] | [PATTERN]                | [SYMPTOM]                              | [FIX]                                                        |
| :-----: | :----------------------- | :------------------------------------- | ------------------------------------------------------------ |
|   [1]   | VAR_INFERENCE            | `var` hides codomain semantics         | Explicit `Fin<T>` / `Option<T>` type                         |
|   [2]   | POSITIONAL_ARGS          | Unnamed arguments at call site         | Named parameters at every invocation                         |
|   [3]   | IMPERATIVE_BRANCH        | `if`/`else`/`for`/`while` in domain    | `Option`/`ToFin` + monadic `Bind`                            |
|   [4]   | OVERLOAD_SPAM            | Sibling method families                | `params ReadOnlySpan<T>` + monoid constraint                 |
|   [5]   | EXCEPTION_CONTROL_FLOW   | `try`/`catch`/`throw` in domain code   | `Fin<T>` / `Eff<RT,T>` error channel                         |
|   [6]   | LINQ_HOT_PATH            | IEnumerable LINQ on hot path           | `TensorPrimitives` / span processing                         |
|   [7]   | MUTABLE_ACCUMULATOR      | `foreach` + mutable accumulator        | Tail-recursive fold / `Seq<T>.Choose`                        |
|   [8]   | VARIABLE_REASSIGNMENT    | `value = Process(value)` re-binding    | `Map` / `Bind` / `Pipe` chains                               |
|   [9]   | CLOSURE_CAPTURE_HOT_PATH | Lambda captures outer variable         | `static` lambda + tuple threading                            |
|  [10]   | EARLY_RETURN_GUARDS      | Sequential `if (!valid) return` guards | `Validation<Error,T>` applicative `.Apply()`                 |
|  [11]   | PREMATURE_MATCH_COLLAPSE | `.Match` called mid-pipeline           | `Map`/`Bind`/`BiMap` within context                          |
|  [12]   | API_SURFACE_INFLATION    | `Get`/`GetMany`/`TryGet` siblings      | `Execute<R>(query)` algebra pattern                          |
|  [13]   | NULL_ARCHITECTURE        | `null` for multiple semantic states    | `Option<T>` / `Fin<T>` typed absence                         |
|  [14]   | INTERFACE_POLLUTION      | `IService` single implementation       | Runtime-record DI (`Asks`) + constrained Scrutor scan policy |
|  [15]   | ANEMIC_DOMAIN            | Entity with only getters/setters       | Smart constructors + `with`-expressions                      |
|  [16]   | GOD_FUNCTION             | Giant switch violating OCP             | `sealed abstract record` DU + `Fold` / `K<F,A>`              |
|  [17]   | HELPER_SPAM              | `private` function, single call site   | Inline at call site or promote to owning type                |
|  [18]   | DENSITY_OVER_VOLUME      | Repetitive arms, brute-force inline    | Fold algebra / `K<F,A>` generic pipeline                     |
|  [19]   | PHANTOM_BYPASS           | Public ctor on phantom-parameterized   | Private ctor + `internal UnsafeWrap` factory                 |
|  [20]   | DUAL_CANONICAL_SHAPE     | Two encodings for same domain concept  | One encoding per concept per bounded context                 |
