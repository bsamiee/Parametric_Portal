# [H1][PURE_MODULE]
>**Dictum:** *Pure modules unify types, validators, transforms, and extensions without effect overhead.*

<br>

Produces one self-contained domain module: domain primitives via `readonly record struct` + `K<F,A>`-polymorphic factory, `Newtype<TTag,TRepr>` for value-type semantic wrappers, sealed DU hierarchies with `Fold` catamorphism, applicative aggregate construction, `Fin<T>` pipeline composition via `Bind`/`Map`, `Choose` for single-pass map+filter, `with`-expression state transitions, and C# 14 extension members.

**Density:** ~400 LOC signals a refactoring opportunity. No file proliferation; helpers are always a code smell.<br>
**References:** `effects.md` ([1][4] Fin, Validation), `composition.md` ([1][2][3][4] Pipe, arity collapse, extensions, HKT encoding), `objects.md` ([1][7] topology, boundary adapters), `algorithms.md` ([6] Kleisli), `types.md` ([1][2][7] domain primitives, Newtype, collections), `validation.md` (compliance checklist), `diagnostics.md` ([2] error chain navigation, [3] Fin pipeline probes).<br>
**Anti-Pattern Awareness:** See `patterns.md` [1] for VAR_INFERENCE, ANEMIC_DOMAIN, PREMATURE_MATCH_COLLAPSE, POSITIONAL_ARGS, HELPER_SPAM.<br>
**Workflow:** Fill placeholders, remove guidance blocks, verify compilation.

---
**Placeholders**

| [INDEX] | [PLACEHOLDER]            | [EXAMPLE]                                        |
| :-----: | ------------------------ | ------------------------------------------------ |
|   [1]   | `${Namespace}`           | `Domain.Payments`                                |
|   [2]   | `${PrimitiveName}`       | `TransactionAmount`                              |
|   [3]   | `${ReprType}`            | `decimal`                                        |
|   [4]   | `${NormalizeExpr}`       | `decimal.Round(d: candidate, decimals: 4)`       |
|   [5]   | `${ValidationPredicate}` | `candidate > 0.0m`                               |
|   [6]   | `${ValidationMessage}`   | `"Amount must be strictly positive."`            |
|   [7]   | `${NewtypeTag}`          | `CorrelationIdTag`                               |
|   [8]   | `${NewtypeRepr}`         | `Guid`                                           |
|   [9]   | `${DUName}`              | `TransactionState`                               |
|  [10]   | `${VariantA}`            | `Pending`                                        |
|  [11]   | `${VariantB}`            | `Authorized(DomainIdentity Id, string Token)`    |
|  [12]   | `${VariantC}`            | `Settled(DomainIdentity Id, string ReceiptHash)` |
|  [13]   | `${VariantD}`            | `Faulted(DomainIdentity Id, Error Reason)`       |
|  [14]   | `${ExtensionClass}`      | `TransactionLifecycleRole`                       |
|  [15]   | `${ExtensionProperty}`   | `IsTerminal`                                     |
|  [16]   | `${TransitionMethod}`    | `Activate`                                       |
|  [17]   | `${AggregateRecord}`     | `TransactionRequest`                             |
|  [18]   | `${DiagnosticNamespace}` | `Domain.Diagnostics`                             |

---
```csharp
namespace ${Namespace};

using System;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using LanguageExt;
using LanguageExt.Common;
using LanguageExt.Traits;
using NodaTime;
using static LanguageExt.Prelude;
// Diagnostics: Probe.Trace lives in ${DiagnosticNamespace} -- see diagnostics.md [3].

// --- [TYPES] -----------------------------------------------------------------

// Domain primitive: readonly record struct + private constructor
// + K<F,A>-polymorphic factory. Invalid construction is unrepresentable.
// Uses { get; } only -- no init accessor. Prevents with-expression bypass
// of smart constructor validation (CSP0720). Normalization runs in factory.
public readonly record struct ${PrimitiveName} {
    public ${ReprType} Value { get; }
    private ${PrimitiveName}(${ReprType} value) { Value = value; }
    // Polymorphic factory: caller selects F at the call site.
    // Fin for fail-fast, Validation<Error> for accumulation, Eff for lifting.
    // See composition.md [4] for K<F,A> encoding.
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static K<F, ${PrimitiveName}> CreateK<F>(${ReprType} candidate)
        where F : Fallible<F>, Applicative<F> {
        ${ReprType} normalized = ${NormalizeExpr};
        return (${ValidationPredicate}) switch {
            true => pure<F, ${PrimitiveName}>(
                new ${PrimitiveName}(value: normalized)),
            false => error<F, ${PrimitiveName}>(
                ${PrimitiveName}Errors.InvalidValue)
        };
    }
    // Monomorphic convenience: delegates to CreateK<Fin>.
    public static Fin<${PrimitiveName}> Create(${ReprType} candidate) =>
        CreateK<Fin>(candidate: candidate).As();
}
// Newtype: value-type semantic wrapper via sealed tag class + using alias.
// Stack-allocated when unboxed; boxing occurs at interface/object boundaries.
// Use when the primitive needs no custom validation beyond type distinction.
// NOTE: Newtype<TTag, TRepr> lives in the shared infrastructure assembly.
// Import, do not redeclare -- multiple scaffolded modules in the same project
// will produce CS0101 duplicate type errors if each declares its own copy.
// Reference: using Newtype = SharedInfrastructure.Newtype<,>;
public sealed class ${NewtypeTag};
// Consumers reference the alias, never Newtype<TTag,TRepr> directly:
// using ${NewtypeTag}Id = ${Namespace}.Newtype<${Namespace}.${NewtypeTag}, ${NewtypeRepr}>;

// --- [UNIONS] ----------------------------------------------------------------
// Status enum: plain enum lives alongside the DU it describes.
// Variants map 1:1 to valid lifecycle states -- no "Unknown" escape hatch.
public enum ${DUName}Status { Inactive, Active }

// Closed hierarchy: private protected ctor prevents external subclassing (CA1852 N/A for abstract record).
public abstract record ${DUName} {
    private protected ${DUName}() { }
    // ${VariantA} carries Status + ActivatedAt so with-expression transitions
    // can set them without phantom field errors. IClock injected at call site;
    // CSP0007 prohibits SystemClock.Instance / DateTime.Now in domain code.
    public sealed record ${VariantA}(
        ${PrimitiveName} Id,
        ${DUName}Status Status,
        Instant? ActivatedAt) : ${DUName};
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
        Error.New(message: ${ValidationMessage});
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
            .Map((${ReprType} raw) => ${NormalizeExpr})
            .Bind((${ReprType} normalized) =>
                ${PrimitiveName}.Create(candidate: normalized));
}
// Choose: single-pass map+filter via CreateK<Option> with explicit downcast.
// The cast to Option<T> documents intent and fails at compile time
// if As() returns an incompatible type -- see composition.md [4].
public static class ${PrimitiveName}Filters {
    public static Seq<${PrimitiveName}> SelectValid(
        Seq<${ReprType}> candidates) =>
        candidates.Choose(
            (${ReprType} candidate) =>
                (Option<${PrimitiveName}>)
                ${PrimitiveName}.CreateK<Option>(candidate: candidate).As());
}

// --- [EXTENSIONS] ------------------------------------------------------------

public static class ${ExtensionClass} {
    extension(${DUName} state) {
        // Projection via Fold: exhaustive, composable, no external switch.
        public bool ${ExtensionProperty} =>
            state.Fold<bool>(
                on${VariantA}: static (${DUName}.${VariantA} _) => false,
                on${VariantB}: static (${DUName}.${VariantB} _) => false,
                on${VariantC}: static (${DUName}.${VariantC} _) => true,
                on${VariantD}: static (${DUName}.${VariantD} _) => true);
        // State transition via Fold: valid transitions produce Fin.Succ;
        // invalid transitions produce Fin.Fail with typed error.
        // IClock injected -- CSP0007 prohibits SystemClock.Instance in domain code.
        // Routes through Fold for compile-time exhaustiveness on all variants.
        public Fin<${DUName}> ${TransitionMethod}(IClock clock) =>
            state.Fold<Fin<${DUName}>>(
                on${VariantA}: (${DUName}.${VariantA} pending) =>
                    Fin.Succ<${DUName}>(
                        pending with {
                            Status = ${DUName}Status.Active,
                            ActivatedAt = clock.GetCurrentInstant()
                        }),
                on${VariantB}: static (${DUName}.${VariantB} _) =>
                    Fin.Fail<${DUName}>(${PrimitiveName}Errors.InvalidTransition),
                on${VariantC}: static (${DUName}.${VariantC} _) =>
                    Fin.Fail<${DUName}>(${PrimitiveName}Errors.InvalidTransition),
                on${VariantD}: static (${DUName}.${VariantD} _) =>
                    Fin.Fail<${DUName}>(${PrimitiveName}Errors.InvalidTransition));
    }
    extension(Seq<${DUName}> items) {
        public Seq<${DUName}> ActiveOnly =>
            items.Filter((${DUName} item) => !item.${ExtensionProperty});
        // Fold for key extraction is intentionally verbose: adding a variant
        // produces a compile error here, unlike GetType().Name which silently succeeds.
        public HashMap<string, Seq<${DUName}>> GroupByVariant =>
            items.Fold(
                state: HashMap<string, Seq<${DUName}>>(),
                folder: (HashMap<string, Seq<${DUName}>> acc, ${DUName} item) =>
                    acc.AddOrUpdate(
                        key: item.Fold<string>(
                            on${VariantA}: static (${DUName}.${VariantA} _) => nameof(${DUName}.${VariantA}),
                            on${VariantB}: static (${DUName}.${VariantB} _) => nameof(${DUName}.${VariantB}),
                            on${VariantC}: static (${DUName}.${VariantC} _) => nameof(${DUName}.${VariantC}),
                            on${VariantD}: static (${DUName}.${VariantD} _) => nameof(${DUName}.${VariantD})),
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

*Domain Primitive + K<F,A> Polymorphism* -- `CreateK<F>` returns `K<F, ${PrimitiveName}>` with `Fallible<F>, Applicative<F>` constraints, making the factory generic over computation context. `Create` is the monomorphic convenience delegating to `CreateK<Fin>(...).As()`. Consumers wanting `Validation` use `CreateK<Validation<Error>>(...).As()`; consumers wanting `Option` use `CreateK<Option>(...).As()` with an explicit cast to `Option<T>` to make the downcast visible and type-safe at compile time. The property uses `{ get; }` only -- no `init` accessor -- because `init` enables `with`-expression bypass of factory validation (CSP0720). Normalization runs inside the factory before the validation predicate. See `composition.md` [4] for HKT encoding and `.As()` downcast.<br>
*Applicative Validation + Fold Catamorphism* -- `CreateAggregate<F>` is polymorphic: `Validation<Error>` accumulates all errors, `Fin` short-circuits. The `Fold` method on the sealed DU is a catamorphism -- each interpretation is a new set of fold arguments, no new interpreter types. Extension members route through `Fold` for exhaustive queries and state transitions alike; direct `switch` is confined to the Fold implementation only (defensive `_` arm with `UnreachableException` until C# ships native DU exhaustiveness). See `effects.md` [4], `composition.md` [5].<br>
*Collections and Pipeline Composition* -- `Seq<T>` over `List<T>`/`IEnumerable<T>`; `HashMap<K,V>` over `Dictionary`/`ImmutableDictionary` -- both implement LanguageExt traits. `Choose` fuses map+filter in a single pass. `Bind`/`Map` chain `Fin<T>` pipelines; reserve `Match` for boundaries only (PREMATURE_MATCH_COLLAPSE). For chaining `A -> Fin<B>` arrows, use `ComposeK` per `algorithms.md` [6]. When a pipeline step fails unexpectedly, insert `Probe.Trace` at the boundary step to surface the dual-channel log without collapsing context (`diagnostics.md` [3]). See `types.md` [7], `composition.md` [1][3].

---
**Post-Scaffold Checklist**

- [ ] Replace all `${...}` placeholders with domain-specific names
- [ ] Verify all records are `sealed`
- [ ] Add `[MethodImpl(AggressiveInlining)]` to all pure hot-path functions
- [ ] Confirm no `if`/`switch` statements in domain logic
- [ ] Add `Telemetry.span` to all public service operations
- [ ] Wire module registration via constrained Scrutor `Scan(...).UsingRegistrationStrategy(...)` in composition root
- [ ] Write at least one property-based test per pure function
- [ ] Run `dotnet build` and verify zero warnings/errors
