# [H1][PURE_MODULE]
>**Dictum:** *Pure modules unify types, validators, transforms, and extensions without effect overhead.*

<br>

Produces one self-contained domain module: domain primitives via `readonly record struct` + `K<F,A>`-polymorphic factory, `Newtype<TTag,TRepr>` for zero-alloc semantic wrappers, sealed DU hierarchies with `Fold` catamorphism, applicative aggregate construction, `Fin<T>` pipeline composition via `Bind`/`Map`, `Choose` for single-pass map+filter, `with`-expression state transitions, and C# 14 extension members.

**Density:** ~400 LOC signals a refactoring opportunity. No file proliferation; helpers are always a code smell.
**References:** `effects.md` ([1][4] Fin, Validation), `composition.md` ([1][2][3][4] Pipe, arity collapse, extensions, HKT encoding), `objects.md` ([1][7] topology, boundary adapters), `algorithms.md` ([6] Kleisli), `types.md` ([1][2][7] domain primitives, Newtype, collections), `validation.md` (compliance checklist), `diagnostics.md` ([2] error chain navigation, [3] Fin pipeline probes).
**Anti-Pattern Awareness:** See `patterns.md` [1] for VAR_INFERENCE, ANEMIC_DOMAIN, PREMATURE_MATCH_COLLAPSE, POSITIONAL_ARGS, HELPER_SPAM.
**Workflow:** Fill placeholders, remove guidance blocks, verify compilation.

---
**Placeholders**

| [INDEX] | [PLACEHOLDER]             | [EXAMPLE]                                           |
| :-----: | ------------------------- | --------------------------------------------------- |
|   [1]   | `${Namespace}`            | `Domain.Payments`                                   |
|   [2]   | `${PrimitiveName}`        | `TransactionAmount`                                 |
|   [3]   | `${ReprType}`             | `decimal`                                           |
|   [4]   | `${normalize-expr}`       | `decimal.Round(d: value, decimals: 4)`              |
|   [5]   | `${validation-predicate}` | `candidate > 0.0m`                                  |
|   [6]   | `${validation-message}`   | `"Amount must be strictly positive."`               |
|   [7]   | `${NewtypeTag}`           | `CorrelationIdTag`                                  |
|   [8]   | `${NewtypeRepr}`          | `Guid`                                              |
|   [9]   | `${DUName}`               | `TransactionState`                                  |
|  [10]   | `${VariantA}`             | `Pending(DomainIdentity Id, TransactionAmount Amt)` |
|  [11]   | `${VariantB}`             | `Authorized(DomainIdentity Id, string Token)`       |
|  [12]   | `${VariantC}`             | `Settled(DomainIdentity Id, string ReceiptHash)`    |
|  [13]   | `${VariantD}`             | `Faulted(DomainIdentity Id, Error Reason)`          |
|  [14]   | `${ExtensionClass}`       | `TransactionLifecycleRole`                          |
|  [15]   | `${extension-property}`   | `IsTerminal`                                        |
|  [16]   | `${transition-method}`    | `Authorize(string token)`                           |
|  [17]   | `${AggregateRecord}`      | `TransactionRequest`                                |

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

// Domain primitive: readonly record struct + field keyword + private constructor
// + K<F,A>-polymorphic factory. Invalid construction is unrepresentable.
public readonly record struct ${PrimitiveName} {
    public ${ReprType} Value {
        get;
        init => field = ${normalize-expr};
    }
    private ${PrimitiveName}(${ReprType} value) { Value = value; }
    // Polymorphic factory: caller selects F at the call site.
    // Fin for fail-fast, Validation<Error> for accumulation, Eff for lifting.
    // See composition.md [4] for K<F,A> encoding.
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static K<F, ${PrimitiveName}> CreateK<F>(${ReprType} candidate)
        where F : Fallible<F>, Applicative<F> =>
        (${validation-predicate}) switch {
            true => pure<F, ${PrimitiveName}>(
                new ${PrimitiveName}(value: candidate)),
            false => error<F, ${PrimitiveName}>(
                ${PrimitiveName}Errors.InvalidValue)
        };
    // Monomorphic convenience: delegates to CreateK<Fin>.
    public static Fin<${PrimitiveName}> Create(${ReprType} candidate) =>
        CreateK<Fin>(candidate: candidate).As();
}
// Newtype: zero-alloc semantic wrapper via sealed tag class + using alias.
// Use when the primitive needs no custom validation beyond type distinction.
public sealed class ${NewtypeTag};
public readonly record struct Newtype<TTag, TRepr>(TRepr Value)
    where TRepr : notnull {
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public override string ToString() => Value.ToString() ?? string.Empty;
}
// Consumers reference the alias, never Newtype<TTag,TRepr> directly:
// using ${NewtypeTag}Id = ${Namespace}.Newtype<${Namespace}.${NewtypeTag}, ${NewtypeRepr}>;

// --- [UNIONS] ----------------------------------------------------------------

// Sealed abstract record: closed hierarchy via private protected constructor.
public abstract record ${DUName} {
    private protected ${DUName}() { }
    public sealed record ${VariantA} : ${DUName};
    public sealed record ${VariantB} : ${DUName};
    public sealed record ${VariantC} : ${DUName};
    public sealed record ${VariantD} : ${DUName};
    // Fold catamorphism: one method, infinite interpretations.
    // Adding a variant adds one parameter -- compile-time exhaustiveness.
    public TResult Fold<TResult>(
        Func<${VariantA}, TResult> on${VariantA},
        Func<${VariantB}, TResult> on${VariantB},
        Func<${VariantC}, TResult> on${VariantC},
        Func<${VariantD}, TResult> on${VariantD}) =>
        this switch {
            ${VariantA} variant => on${VariantA}(variant),
            ${VariantB} variant => on${VariantB}(variant),
            ${VariantC} variant => on${VariantC}(variant),
            ${VariantD} variant => on${VariantD}(variant),
            _ => throw new UnreachableException(
                message: "Exhaustive: all ${DUName} variants handled")
        };
}

// --- [ERRORS] ----------------------------------------------------------------

public static class ${PrimitiveName}Errors {
    public static readonly Error InvalidValue =
        Error.New(message: ${validation-message});
    public static readonly Error InvalidTransition =
        Error.New(message: "Invalid state transition from current variant.");
    // Inspect error chains at boundaries via Error.Flatten() -- see diagnostics.md [2].
}

// --- [FUNCTIONS] -------------------------------------------------------------

// Applicative validation: polymorphic via K<F,A>. Caller selects F:
//   CreateAggregate<Fin>(...).As()           -- fail-fast
//   CreateAggregate<Validation<Error>>(...).As() -- accumulate all errors
// See effects.md [4] for applicative patterns.
public static class ${PrimitiveName}Validation {
    public static K<F, ${AggregateRecord}> CreateAggregate<F>(
        ${ReprType} candidateA,
        ${ReprType} candidateB)
        where F : Fallible<F>, Applicative<F> =>
        (
            ${PrimitiveName}.CreateK<F>(candidate: candidateA),
            ${PrimitiveName}.CreateK<F>(candidate: candidateB)
        ).Apply(
            (${PrimitiveName} fieldA, ${PrimitiveName} fieldB) =>
                new ${AggregateRecord}(
                    FieldA: fieldA,
                    FieldB: fieldB));
}
public readonly record struct ${AggregateRecord}(
    ${PrimitiveName} FieldA,
    ${PrimitiveName} FieldB);
// Fin<T> pipeline: multi-step transform via Bind/Map. Short-circuits on failure.
// Probe.Trace wraps any step for dual-channel logging without collapsing context -- see diagnostics.md [3].
// Reserve Match for the final program boundary only.
public static class ${PrimitiveName}Pipeline {
    public static Fin<${PrimitiveName}> ValidateAndNormalize(
        ${ReprType} candidate) =>
        ${PrimitiveName}.Create(candidate: candidate)
            .Map((${PrimitiveName} validated) => validated.Value)
            .Map((${ReprType} raw) => ${normalize-expr})
            .Bind((${ReprType} normalized) =>
                ${PrimitiveName}.Create(candidate: normalized));
}
// Choose: single-pass map+filter via CreateK for polymorphic validation.
public static class ${PrimitiveName}Filters {
    public static Seq<${PrimitiveName}> SelectValid(
        Seq<${ReprType}> candidates) =>
        candidates.Choose(
            (${ReprType} candidate) =>
                ${PrimitiveName}.CreateK<Option>(candidate: candidate).As());
}

// --- [EXTENSIONS] ------------------------------------------------------------

public static class ${ExtensionClass} {
    extension(${DUName} state) {
        // Projection via Fold: exhaustive, composable, no external switch.
        public bool ${extension-property} =>
            state.Fold<bool>(
                on${VariantA}: (${DUName}.${VariantA} _) => false,
                on${VariantB}: (${DUName}.${VariantB} _) => false,
                on${VariantC}: (${DUName}.${VariantC} _) => true,
                on${VariantD}: (${DUName}.${VariantD} _) => true);
        // State transition: valid transitions produce FinSucc;
        // invalid transitions produce FinFail with typed error.
        public Fin<${DUName}> ${transition-method} =>
            state switch {
                ${DUName}.${VariantA} pending =>
                    FinSucc<${DUName}>(
                        pending with { /* updated fields */ }),
                _ => FinFail<${DUName}>(
                    ${PrimitiveName}Errors.InvalidTransition)
            };
    }
    extension(Seq<${DUName}> items) {
        public Seq<${DUName}> ActiveOnly =>
            items.Filter((${DUName} item) => !item.${extension-property});
        // Polymorphic grouping via Fold -- each variant resolves its own
        // key through the catamorphism; the accumulator body is uniform.
        public HashMap<string, Seq<${DUName}>> GroupByVariant =>
            items.Fold(
                state: HashMap<string, Seq<${DUName}>>(),
                folder: (HashMap<string, Seq<${DUName}>> acc, ${DUName} item) =>
                    acc.AddOrUpdate(
                        key: item.Fold<string>(
                            on${VariantA}: (${DUName}.${VariantA} _) => nameof(${DUName}.${VariantA}),
                            on${VariantB}: (${DUName}.${VariantB} _) => nameof(${DUName}.${VariantB}),
                            on${VariantC}: (${DUName}.${VariantC} _) => nameof(${DUName}.${VariantC}),
                            on${VariantD}: (${DUName}.${VariantD} _) => nameof(${DUName}.${VariantD})),
                        Some: (Seq<${DUName}> existing) => existing.Add(item),
                        None: () => Seq(item)));
    }
}

// --- [EXPORT] ----------------------------------------------------------------
// All types and static classes above use explicit accessibility.
// No barrel files or re-exports.
```

---
**Guidance**

*Domain Primitive + K<F,A> Polymorphism* -- `CreateK<F>` returns `K<F, ${PrimitiveName}>` with `Fallible<F>, Applicative<F>` constraints, making the factory generic over computation context. `Create` is the monomorphic convenience delegating to `CreateK<Fin>(...).As()`. Consumers wanting `Validation` use `CreateK<Validation<Error>>(...).As()`; consumers wanting `Option` use `CreateK<Option>(...).As()`. See `composition.md` [4] for HKT encoding and `.As()` downcast.

*Applicative Validation + Fold Catamorphism* -- `CreateAggregate<F>` is polymorphic: `Validation<Error>` accumulates all errors, `Fin` short-circuits. The `Fold` method on the sealed DU is a catamorphism -- each interpretation is a new set of fold arguments, no new interpreter types. Extension members route through `Fold` for exhaustive queries; direct `switch` only for transitions needing pattern-bound variables. The `_` arm with `UnreachableException` is defensive until C# ships native DU exhaustiveness. See `effects.md` [4], `composition.md` [5].

*Collections and Pipeline Composition* -- `Seq<T>` over `List<T>`/`IEnumerable<T>`; `HashMap<K,V>` over `Dictionary`/`ImmutableDictionary` -- both implement LanguageExt traits. `Choose` fuses map+filter in a single pass. `Bind`/`Map` chain `Fin<T>` pipelines; reserve `Match` for boundaries only (PREMATURE_MATCH_COLLAPSE). For chaining `A -> Fin<B>` arrows, use `ComposeK` per `algorithms.md` [6]. When a pipeline step fails unexpectedly, insert `Probe.Trace` at the boundary step to surface the dual-channel log without collapsing context (`diagnostics.md` [3]). See `types.md` [7], `composition.md` [1][3].

---
**Post-Scaffold Checklist** (from `validation.md`)

- [ ] TYPE_INTEGRITY: Domain primitives use `readonly record struct` + `Fin<T>` factory + `CreateK<F>` polymorphic path; no `{ get; set; }` bags
- [ ] EFFECT_INTEGRITY: `Fin<T>` chains use `Bind`/`Map`; `Match` appears ONLY at boundaries
- [ ] CONTROL_FLOW: Zero `if`/`else`/`while`/`for`/`foreach`; all dispatch via Fold + switch expressions
- [ ] SURFACE_QUALITY: No single-call private helpers; no arity spam; named parameters everywhere
- [ ] DENSITY: ~400 LOC target; algebraic composition compresses logic via polymorphism
- [ ] DIAGNOSTICS: Unexpected `Fin<T>` failures inspected via `Probe.Trace` (not `Match`); error chains navigated via `Error.Flatten()` (not manual `Inner` walks) -- see `diagnostics.md` [2][3]
