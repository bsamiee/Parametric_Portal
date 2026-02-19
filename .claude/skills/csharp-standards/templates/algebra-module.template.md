# [H1][ALGEBRA_MODULE]
>**Dictum:** *Algebraic modules encode concepts as types; one method owns the interface; interpreters vary the algebra.*

<br>

Produces one algebraic abstraction module: query union as a sealed DU with `Fold` catamorphism, a single-method interface dispatching through the fold, an `Atom<HashMap<K,V>>`-backed pure interpreter, a `K<F,A>`-polymorphic interpreter that eliminates `(TResult)(object)` double-casts, an effectful `Eff<RT,T>` interpreter composing with the polymorphic path, a decorator composing cross-cutting behavior via fold wrapping, C# 14 extension members on the algebra, `params ReadOnlySpan<T>` batch execution, and applicative boundary validation.

**Density:** ~400 LOC signals a refactoring opportunity. No file proliferation; helpers are always a code smell.
**References:** `composition.md` ([4] HKT encoding, [2] arity collapse, [5] algebraic compression), `effects.md` ([2] Eff pipelines, [7] STM/Atom, [3] @catch), `types.md` ([1] domain primitives, [4] DUs), `objects.md` ([7] boundary adapters), `performance.md` ([7] static lambdas), `validation.md` ([1]-[6] post-scaffold checklist), `algorithms.md` ([1] recursion schemes, [6] Kleisli).
**Workflow:** Fill placeholders, remove guidance blocks, run post-scaffold checklist, verify compilation.

---
**Placeholders**

| [INDEX] | [PLACEHOLDER]        | [EXAMPLE]                   |
| :-----: | -------------------- | --------------------------- |
|   [1]   | `${Namespace}`       | `Domain.Storage`            |
|   [2]   | `${AlgebraName}`     | `Store`                     |
|   [3]   | `${KeyType}`         | `K`                         |
|   [4]   | `${ValueType}`       | `V`                         |
|   [5]   | `${InterfaceName}`   | `IStore`                    |
|   [6]   | `${ImplName}`        | `InMemoryStore`             |
|   [7]   | `${DecoratorName}`   | `Logging${AlgebraName}`     |
|   [8]   | `${ConfigReprType}`  | `string`                    |
|   [9]   | `${config-valid}`    | `candidate.Length > 0`      |
|  [10]   | `${config-message}`  | `"Name must be non-empty."` |
|  [11]   | `${DiagnosticLabel}` | `"store.execute"`           |

---
```csharp
namespace ${Namespace};

using System;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using LanguageExt;
using LanguageExt.Common;
using LanguageExt.Traits;
using static LanguageExt.Prelude;

// --- [TYPES] -----------------------------------------------------------------

// Prevents ANEMIC_DOMAIN -- see patterns.md [1]
public readonly record struct ${AlgebraName}Config {
    public ${ConfigReprType} Value { get; }
    private ${AlgebraName}Config(${ConfigReprType} value) { Value = value; }
    public static Fin<${AlgebraName}Config> Create(${ConfigReprType} candidate) =>
        (${config-valid}) switch {
            true => FinSucc(new ${AlgebraName}Config(value: candidate)),
            false => FinFail<${AlgebraName}Config>(
                Error.New(message: ${config-message}))
        };
}

// --- [SCHEMA] ----------------------------------------------------------------

// Query algebra: sealed DU + Fold catamorphism. Prevents GOD_FUNCTION,
// API_SURFACE_INFLATION, and OVERLOAD_SPAM -- see patterns.md [1],
// composition.md [5].
public abstract record ${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>
    where ${KeyType} : notnull {
    private protected ${AlgebraName}Query() { }
    public sealed record Get(${KeyType} Key)
        : ${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>;
    public sealed record Upsert(${KeyType} Key, ${ValueType} Value)
        : ${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>;
    public sealed record Delete(${KeyType} Key)
        : ${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>;
    // Fold catamorphism: one method, infinite interpretations.
    // Adding a variant adds one parameter -- compile-time exhaustiveness.
    // For recursive algebras see composition.md [5], algorithms.md [1].
    public TResult Fold(
        Func<Get, TResult> onGet,
        Func<Upsert, TResult> onUpsert,
        Func<Delete, TResult> onDelete) =>
        this switch {
            Get getQuery => onGet(getQuery),
            Upsert upsertQuery => onUpsert(upsertQuery),
            Delete deleteQuery => onDelete(deleteQuery),
            _ => throw new UnreachableException(
                message: "Exhaustive: all ${AlgebraName}Query variants handled")
        };
}

// C# 14 extension members -- pure projections via Fold.
public static class ${AlgebraName}QueryRole {
    extension<${KeyType}, ${ValueType}, TResult>(
        ${AlgebraName}Query<${KeyType}, ${ValueType}, TResult> query)
        where ${KeyType} : notnull {
        public bool IsMutation =>
            query.Fold(
                onGet: static (${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>.Get _) => false,
                onUpsert: static (${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>.Upsert _) => true,
                onDelete: static (${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>.Delete _) => true);
    }
}

// --- [ERRORS] ----------------------------------------------------------------

// Error codes as int constants enable stable dashboard identifiers --
// see observability.md [6] for span annotation and metric dimension patterns.
public static class ${AlgebraName}Errors {
    public static readonly Error NotFound =
        Error.New(code: 1001, message: "${AlgebraName} key not found.");
    public static readonly Error OperationFailed =
        Error.New(code: 1002, message: "${AlgebraName} operation failed.");
    public static readonly Error InvalidQuery =
        Error.New(code: 1003, message: "${AlgebraName} query validation failed.");
}

// --- [SERVICES] --------------------------------------------------------------

// Single-method interface: the query type is the extensibility seam.
// Variation lives in data, not in growing method families.
public interface ${InterfaceName}<${KeyType}, ${ValueType}>
    where ${KeyType} : notnull {
    Fin<TResult> Execute<TResult>(
        ${AlgebraName}Query<${KeyType}, ${ValueType}, TResult> query);
}

// --- [FUNCTIONS] -------------------------------------------------------------

// Pure interpreter backed by Atom<HashMap<K,V>> -- lock-free atomic state
// with persistent CHAMP trie. See effects.md [7] for Atom/Ref STM patterns.
public sealed class ${ImplName}<${KeyType}, ${ValueType}>(
    HashMap<${KeyType}, ${ValueType}> seed)
    : ${InterfaceName}<${KeyType}, ${ValueType}>
    where ${KeyType} : notnull {
    private readonly Atom<HashMap<${KeyType}, ${ValueType}>> _state = Atom(seed);
    public Fin<TResult> Execute<TResult>(
        ${AlgebraName}Query<${KeyType}, ${ValueType}, TResult> query) =>
        query.Fold(
            onGet: (${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>.Get getQuery) =>
                FinSucc((TResult)(object)_state.Value.Find(key: getQuery.Key)),
            onUpsert: (${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>.Upsert upsertQuery) =>
                _state.Swap((HashMap<${KeyType}, ${ValueType}> current) =>
                    current.AddOrUpdate(key: upsertQuery.Key, value: upsertQuery.Value))
                    .Pipe(static (HashMap<${KeyType}, ${ValueType}> _) =>
                        FinSucc((TResult)(object)unit)),
            onDelete: (${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>.Delete deleteQuery) =>
                _state.Swap((HashMap<${KeyType}, ${ValueType}> current) =>
                    current.Remove(key: deleteQuery.Key))
                    .Pipe(static (HashMap<${KeyType}, ${ValueType}> _) =>
                        FinSucc((TResult)(object)unit)));
    // Batch: params ReadOnlySpan<T> collapses all arities -- see composition.md [2].
    public Seq<Fin<TResult>> ExecuteBatch<TResult>(
        params ReadOnlySpan<${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>> queries) =>
        toSeq(queries.ToArray()).Map(
            (${AlgebraName}Query<${KeyType}, ${ValueType}, TResult> query) =>
                Execute(query: query));
}

// --- [DECORATORS] ------------------------------------------------------------

// Wraps Execute with cross-cutting behavior via fold inspection.
// Logging, caching, metrics, dry-run all follow this shape.
// Compose by nesting: new Logging(new Caching(new InMemory(seed))).
// For ActivitySource-based span decorators, centralize the source in a
// Diagnostics static class rather than accepting ILogger -- see diagnostics.md [1].
// Replace Action<string> log with Observe.Outcome tap for unified log+trace+metrics
// in a single BiMap pass -- see observability.md [4].
public sealed class ${DecoratorName}<${KeyType}, ${ValueType}>(
    ${InterfaceName}<${KeyType}, ${ValueType}> inner,
    Action<string> log)
    : ${InterfaceName}<${KeyType}, ${ValueType}>
    where ${KeyType} : notnull {
    public Fin<TResult> Execute<TResult>(
        ${AlgebraName}Query<${KeyType}, ${ValueType}, TResult> query) =>
        query.Fold(
            onGet: (${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>.Get getQuery) =>
                LogAndDelegate(label: "Get", key: getQuery.Key.ToString()!, query: query),
            onUpsert: (${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>.Upsert upsertQuery) =>
                LogAndDelegate(label: "Upsert", key: upsertQuery.Key.ToString()!, query: query),
            onDelete: (${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>.Delete deleteQuery) =>
                LogAndDelegate(label: "Delete", key: deleteQuery.Key.ToString()!, query: query));
    private Fin<TResult> LogAndDelegate<TResult>(
        string label,
        string key,
        ${AlgebraName}Query<${KeyType}, ${ValueType}, TResult> query) {
        log($"[${AlgebraName}] {label} key={key}");
        return inner.Execute(query: query);
    }
}

// --- [POLYMORPHIC_INTERPRETER] -----------------------------------------------

// K<F,A>-polymorphic interpreter: eliminates (TResult)(object) double-cast
// by parameterizing the effect context. The caller selects F at the call site:
//   Interpret<Fin, K, V, Option<V>>(getQuery, lookup).As()
// See composition.md [4] for K<F,A> encoding; .As() required at boundaries.
public static class ${AlgebraName}Interpret {
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static K<F, TResult> Execute<F, ${KeyType}, ${ValueType}, TResult>(
        ${AlgebraName}Query<${KeyType}, ${ValueType}, TResult> query,
        Func<${KeyType}, K<F, TResult>> lookupGet,
        Func<${KeyType}, ${ValueType}, K<F, TResult>> handleUpsert,
        Func<${KeyType}, K<F, TResult>> handleDelete)
        where F : Fallible<F>, Applicative<F> =>
        query.Fold(
            onGet: (${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>.Get getQuery) =>
                lookupGet(getQuery.Key),
            onUpsert: (${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>.Upsert upsertQuery) =>
                handleUpsert(upsertQuery.Key, upsertQuery.Value),
            onDelete: (${AlgebraName}Query<${KeyType}, ${ValueType}, TResult>.Delete deleteQuery) =>
                handleDelete(deleteQuery.Key));
}

// --- [EFFECTFUL_INTERPRETER] -------------------------------------------------

// Lifts the pure interface into Eff<RT,T> via Has<RT,Trait> DI.
// Composes with the polymorphic interpreter when callers need K<F,A>
// generality; delegates to the monomorphic interface for Fin-only paths.
// See effects.md [2] for Eff pipelines, [3] for @catch.
public interface Has${AlgebraName}<RT, ${KeyType}, ${ValueType}>
    : Has<RT, ${InterfaceName}<${KeyType}, ${ValueType}>>
    where RT : Has${AlgebraName}<RT, ${KeyType}, ${ValueType}>
    where ${KeyType} : notnull;
public static class ${AlgebraName}Eff {
    public static Eff<RT, TResult> Execute<RT, ${KeyType}, ${ValueType}, TResult>(
        ${AlgebraName}Query<${KeyType}, ${ValueType}, TResult> query)
        where RT : Has${AlgebraName}<RT, ${KeyType}, ${ValueType}>
        where ${KeyType} : notnull =>
        default(RT).Trait.Execute(query: query).ToEff();
    // @catch / | Alternative: declarative error recovery.
    // Wrap pipeline in Probe.Span(pipeline: ..., spanName: ${DiagnosticLabel})
    // during development to capture debug Activity without collapsing Eff context
    // -- see diagnostics.md [3]. Remove probe before production; span overhead
    // is non-zero even when no listener is registered.
    public static Eff<RT, TResult> ExecuteWithFallback<RT, ${KeyType}, ${ValueType}, TResult>(
        ${AlgebraName}Query<${KeyType}, ${ValueType}, TResult> primary,
        ${AlgebraName}Query<${KeyType}, ${ValueType}, TResult> fallback)
        where RT : Has${AlgebraName}<RT, ${KeyType}, ${ValueType}>
        where ${KeyType} : notnull =>
        Execute<RT, ${KeyType}, ${ValueType}, TResult>(query: primary)
        | @catch(${AlgebraName}Errors.NotFound,
            (Error _) => Execute<RT, ${KeyType}, ${ValueType}, TResult>(query: fallback));
}

// --- [VALIDATION] ------------------------------------------------------------

// Boundary adapter: applicative validation for query construction from
// external input. See objects.md [7], validation.md [2].
public readonly record struct ${AlgebraName}Request(string RawKey, string RawValue);
public static class ${AlgebraName}Boundary {
    public static Validation<Error, ${AlgebraName}Query<string, string, TResult>>
        ValidateUpsert<TResult>(${AlgebraName}Request request) =>
        (
            ValidateKey(raw: request.RawKey),
            ValidateValue(raw: request.RawValue)
        ).Apply(
            (string key, string value) =>
                (${AlgebraName}Query<string, string, TResult>)
                new ${AlgebraName}Query<string, string, TResult>.Upsert(Key: key, Value: value));
    private static Validation<Error, string> ValidateKey(string raw) =>
        raw.Trim() switch {
            string trimmed when trimmed.Length > 0 =>
                Success<Error, string>(trimmed),
            _ => Fail<Error, string>(Error.New(message: "Key must be non-empty."))
        };
    private static Validation<Error, string> ValidateValue(string raw) =>
        (raw.Length <= 4096) switch {
            true => Success<Error, string>(raw),
            false => Fail<Error, string>(Error.New(message: "Value exceeds maximum length."))
        };
}

// --- [EXPORT] ----------------------------------------------------------------
// All types and static classes above use explicit accessibility.
// No barrel files or re-exports.
```

---
**Guidance**

*Query Union + Fold* -- The sealed DU with `Fold` catamorphism is the algebra's core. New operations add new variants and Fold parameters; existing interpretations compile unchanged. The `_` arm with `UnreachableException` guards until C# ships native DU exhaustiveness. For recursive algebras (expression trees), Fold recurses into sub-expressions per `composition.md` [5] and `algorithms.md` [1].

*Polymorphic Interpreter via K<F,A>* -- `${AlgebraName}Interpret.Execute` parameterizes the effect context via `F : Fallible<F>, Applicative<F>`, eliminating the `(TResult)(object)` double-cast from the monomorphic path. Callers select `F` at the call site and must call `.As()` to downcast `K<F,A>` to the concrete type -- see `composition.md` [4]. The `Eff` interpreter composes with this path when callers need generic effect selection; the monomorphic `${InterfaceName}.Execute` remains for `Fin`-only consumers.

*Atom State + Decorators* -- `Atom<HashMap<K,V>>` provides lock-free atomic state with pure `Swap` transitions (see `effects.md` [7]). Decorators compose by nesting and inspect queries via Fold for cross-cutting concerns. Static lambdas on Fold in hot-path interpreters prevent closure allocations (see `performance.md` [7]); non-static lambdas are acceptable when Fold arms reference instance state. To promote a decorator to full observability, replace `Action<string> log` with `Observe.Outcome` tap on the returned `Fin<TResult>` -- see `observability.md` [4]. For debug-only span wrapping, use `Probe.Span` from a centralized `Diagnostics` module rather than inlining `ActivitySource` -- see `diagnostics.md` [1] and `diagnostics.md` [3].

*Foldable/Traversable for Container-Generic Algorithms* -- When batch query results are wrapped in containers, use `Foldable<F>` for Sum/All/Count and `Traversable<F>` for effectful iteration -- see `composition.md` [4]. These are consumer-side concerns, not algebra-internal; constrain via LanguageExt traits.

---
**Post-Scaffold Checklist** (from `validation.md`)

- [ ] TYPE_INTEGRITY: Smart constructor + `Fin<T>` factory on `${AlgebraName}Config`; no `{ get; set; }` bags
- [ ] EFFECT_INTEGRITY: `Fin<T>` for sync Execute; `K<F,A>` for polymorphic; `Eff<RT,T>` for effectful; no `try`/`catch`
- [ ] CONTROL_FLOW: Zero `if`/`else`/`while`/`for`/`foreach`; all dispatch via Fold + switch expressions
- [ ] SURFACE_QUALITY: One `Execute` method; no sibling families; no single-call private helpers
- [ ] DENSITY: ~400 LOC target; zero `var`; static lambdas where possible; named parameters everywhere
- [ ] OBSERVABILITY: `${DecoratorName}` uses `Observe.Outcome` tap or delegates to a centralized `Diagnostics` module -- no inline `ActivitySource` creation; see `observability.md` [4], `diagnostics.md` [1]
- [ ] DIAGNOSTIC_CLEANUP: All `Probe.Span` / `Probe.Tap` calls removed before production; `${DiagnosticLabel}` placeholder resolved; error codes in `${AlgebraName}Errors` carry `int` codes for dashboard use -- see `diagnostics.md` [3], `observability.md` [6]
