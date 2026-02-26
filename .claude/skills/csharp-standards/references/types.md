# [H1][TYPES]
>**Dictum:** *Types are executable contracts: invariants at construction, explicit capabilities, exhaustive state spaces.*

Baseline used for this reference:
- `.NET 10`, `C# 14`
- `LanguageExt.Core 5.0.0-beta-77`
- `Thinktecture.Runtime.Extensions 10.0.0`
- `Scrutor 7.0.0`
- `NodaTime 3.3.0`
- `Microsoft.Extensions.DependencyInjection.Abstractions` from the .NET shared framework
- Last verified: `2026-02-26`

Verification anchors:
- `LanguageExt.Core 5.0.0-beta-77`: `https://api.nuget.org/v3/registration5-semver1/languageext.core/page/5.0.0-beta-58/5.0.0-beta-77.json`
- `Thinktecture.Runtime.Extensions 10.0.0`: `https://api.nuget.org/v3/registration5-semver1/thinktecture.runtime.extensions/page/8.7.0-beta01/10.0.0.json`
- `Scrutor 7.0.0`: `https://api.nuget.org/v3/registration5-semver1/scrutor/index.json`
This file is self-contained and implementation-oriented. Each rule is written as an executable constraint, not a preference.

---
## [1][DOMAIN_PRIMITIVES]
>**Dictum:** *Validated primitives expose total factories; invalid values never escape construction.*

Design rules:
- Use private constructors on validated primitives.
- Keep construction in `Fin<T>` factories.
- Keep normalization-only transport shapes separate from validated domain types.
- Use `NodaTime.Instant` + injected `IClock` for temporal primitives.

```csharp
namespace Domain.Types;

using System;
using LanguageExt;
using LanguageExt.Common;
using NodaTime;

// --- [VALIDATED_PRIMITIVES] ---

public readonly record struct DomainIdentity {
    public Guid Value { get; }
    private DomainIdentity(Guid value) => Value = value;
    public static Fin<DomainIdentity> Create(Guid candidate) =>
        candidate == Guid.Empty
            ? Fin.Fail<DomainIdentity>(Error.New(message: "Identity must not be empty."))
            : Fin.Succ(new DomainIdentity(candidate));
}

public readonly record struct TransactionAmount {
    public decimal Value { get; }
    private TransactionAmount(decimal value) => Value = value;
    public static Fin<TransactionAmount> Create(decimal candidate) =>
        candidate > 0m
            ? Fin.Succ(new TransactionAmount(decimal.Round(d: candidate, decimals: 4)))
            : Fin.Fail<TransactionAmount>(Error.New(message: "Amount must be strictly positive."));
}

public readonly record struct OccurredAt {
    public Instant Value { get; }
    private OccurredAt(Instant value) => Value = value;
    public static Fin<OccurredAt> Create(Instant value) => Fin.Succ(new OccurredAt(value));
    public static Fin<OccurredAt> FromClock(IClock clock) => Fin.Succ(new OccurredAt(clock.GetCurrentInstant()));
}

// --- [NORMALIZATION_SURFACE] ---
// Non-validated shape for boundary/view normalization only.

public sealed class CustomerSnapshot {
    public string DisplayName { get; private set => field = (value ?? string.Empty).Trim(); } = string.Empty;
    public CustomerSnapshot(string displayName) => DisplayName = displayName;
}
```

```csharp
using System;
using Thinktecture;

// --- [SOURCE_GENERATED_PRIMITIVE] ---
// Attribute is metadata; Thinktecture generators/analyzers consume it.

[ValueObject<Guid>(KeyMemberName = "Value")]
public readonly partial struct OrderId {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref Guid value) =>
        validationError = value == Guid.Empty
            ? new ValidationError("OrderId must not be empty.")
            : null;
}
```

---
## [2][TYPE_LEVEL_DISTINCTION]
>**Dictum:** *Semantic tags and compile-time states encode intent without runtime branching.*

Use newtypes for semantic separation and phantom-state types for compile-time workflow gates.

Alias precision:
- Using alias directives must precede namespace members in their scope.
- Global using directives must appear before nonglobal using directives in the file.
- Closed generic aliases are valid.
- Open generic aliases are invalid.
- Alias-of-alias in another using-alias declaration is invalid.

```csharp
using System;
using LanguageExt;
using LanguageExt.Common;
using UserId = Domain.Types.Newtype<Domain.Types.UserIdTag, System.Guid>;
using Email = Domain.Types.Newtype<Domain.Types.EmailTag, string>;

namespace Domain.Types;

// --- [NEWTYPE_AND_PHANTOM_STATE] ---

public readonly record struct Newtype<TTag, TRepr>(TRepr Value)
    where TRepr : notnull;

public sealed class UserIdTag;
public sealed class EmailTag;

public readonly struct Unvalidated;
public readonly struct Validated;

public readonly record struct TypedUserId<TState> {
    public Guid Value { get; }
    private TypedUserId(Guid value) => Value = value;
    internal static TypedUserId<TState> UnsafeWrap(Guid value) => new(value);
}

public static class TypedUserIdOps {
    public static TypedUserId<Unvalidated> FromRaw(Guid raw) => TypedUserId<Unvalidated>.UnsafeWrap(raw);
    public static Fin<TypedUserId<Validated>> Validate(TypedUserId<Unvalidated> raw) =>
        raw.Value != Guid.Empty
            ? Fin.Succ(TypedUserId<Validated>.UnsafeWrap(raw.Value))
            : Fin.Fail<TypedUserId<Validated>>(Error.New(message: "UserId cannot be empty."));
}

// Invalid alias chaining:
// using A = System.Collections.Generic.List<int>;
// using B = System.Collections.Generic.Dictionary<string, A>;
```

---
## [3][SMART_CONSTRUCTORS_AND_SERVICE_TOPOLOGY]
>**Dictum:** *Construction logic stays pure; object-level cross-cutting is composition-root decoration.*

Service-level cross-cutting policy:
- Required wrappers use `Decorate`.
- Optional wrappers use `TryDecorate`.
- Optional wrappers require their own dependencies to be registered and their `TryDecorate` result to be observed.
- Idempotency wrapper should be inner to telemetry/audit wrappers.
- Cancellation should remain in typed channels (`Fin.Fail`), not thrown exceptions.
- Callback dependencies should be total (`Fin.Fail` on fault), not throw-based delegates.

```csharp
using System;
using System.Threading;
using LanguageExt;
using LanguageExt.Common;
using Microsoft.Extensions.DependencyInjection;
using Scrutor;

// --- [CONSTRUCTION_PRIMITIVES] ---

public static class Domain {
    public static Fin<A> Require<A>(bool predicate, Func<Error> onFalse, Func<A> onTrue) =>
        predicate ? Fin.Succ(onTrue()) : Fin.Fail<A>(onFalse());

    public static Fin<Newtype<TTag, TRepr>> Make<TTag, TRepr>(
        TRepr value,
        Func<TRepr, Fin<TRepr>> validate)
        where TRepr : notnull =>
        validate(value).Map(static ok => new Newtype<TTag, TRepr>(ok));
}

// --- [IDEMPOTENCY_CONTRACT] ---

public abstract record IdempotencyAcquireResult {
    private IdempotencyAcquireResult() { }
    public sealed record Acquired : IdempotencyAcquireResult;
    public sealed record CompletedReplay : IdempotencyAcquireResult;
    public sealed record InFlightConflict : IdempotencyAcquireResult;
    public sealed record PayloadMismatch : IdempotencyAcquireResult;
}

public interface IIdempotencyGate {
    Fin<IdempotencyAcquireResult> TryAcquire(string key, CancellationToken ct);
}

public interface ITraceWriter {
    Fin<Unit> Write(string message, CancellationToken ct);
}

public interface IUserIdCreationService {
    Fin<Newtype<UserIdTag, Guid>> Create(Guid candidate, string idempotencyKey, CancellationToken ct);
}

public sealed class UserIdCreationService : IUserIdCreationService {
    public Fin<Newtype<UserIdTag, Guid>> Create(Guid candidate, string idempotencyKey, CancellationToken ct) =>
        ct.IsCancellationRequested
            ? Fin.Fail<Newtype<UserIdTag, Guid>>(Error.New(message: "Operation cancelled."))
            : Domain.Make<UserIdTag, Guid>(
                value: candidate,
                validate: value => value == Guid.Empty
                    ? Fin.Fail<Guid>(Error.New(message: "UserId must not be empty."))
                    : Fin.Succ(value));
}

public sealed class IdempotentUserIdCreationDecorator(
    IUserIdCreationService inner,
    IIdempotencyGate gate) : IUserIdCreationService {
    public Fin<Newtype<UserIdTag, Guid>> Create(Guid candidate, string idempotencyKey, CancellationToken ct) =>
        ct.IsCancellationRequested
            ? Fin.Fail<Newtype<UserIdTag, Guid>>(Error.New(message: "Operation cancelled."))
            : gate.TryAcquire(idempotencyKey, ct).Bind(result =>
                result switch {
                    IdempotencyAcquireResult.Acquired => inner.Create(candidate, idempotencyKey, ct),
                    IdempotencyAcquireResult.CompletedReplay => Fin.Fail<Newtype<UserIdTag, Guid>>(Error.New(message: "Completed replay should return prior result at boundary level.")),
                    IdempotencyAcquireResult.InFlightConflict => Fin.Fail<Newtype<UserIdTag, Guid>>(Error.New(message: "Request already in-flight.")),
                    IdempotencyAcquireResult.PayloadMismatch => Fin.Fail<Newtype<UserIdTag, Guid>>(Error.New(message: "Idempotency key reused with mismatched payload.")),
                    _ => Fin.Fail<Newtype<UserIdTag, Guid>>(Error.New(message: "Unknown idempotency result."))
                });
}

public sealed class TracingUserIdCreationDecorator(
    IUserIdCreationService inner,
    ITraceWriter traceWriter) : IUserIdCreationService {
    public Fin<Newtype<UserIdTag, Guid>> Create(Guid candidate, string idempotencyKey, CancellationToken ct) =>
        ct.IsCancellationRequested
            ? Fin.Fail<Newtype<UserIdTag, Guid>>(Error.New(message: "Operation cancelled."))
            : inner.Create(candidate, idempotencyKey, ct).Bind(value =>
                ct.IsCancellationRequested
                    ? Fin.Fail<Newtype<UserIdTag, Guid>>(Error.New(message: "Operation cancelled."))
                    : traceWriter.Write($"created-user-id:{value.Value}", ct).Map(_ => value));
}

public static class TypeServiceRegistration {
    public static IServiceCollection AddTypeFactories(this IServiceCollection services) {
        services.AddScoped<IUserIdCreationService, UserIdCreationService>();
        services.Decorate<IUserIdCreationService, IdempotentUserIdCreationDecorator>();

        bool optionalTracingApplied = services.TryDecorate<IUserIdCreationService, TracingUserIdCreationDecorator>();
        _ = optionalTracingApplied switch {
            true => 0,
            false => 0 // Optional path intentionally absent; track in startup diagnostics.
        };

        return services;
    }
}
```

---
## [4][DISCRIMINATED_UNIONS_AND_METHOD_WRAPPERS]
>**Dictum:** *Union closure is structural; method-level behavior is projection or explicit wrappers, never attribute magic.*

Method-level model:
- Projection: extension methods for pure view/shape behavior.
- Interception: typed wrappers/delegates or explicit AOP toolchains (`Metalama`/`PostSharp`).

```csharp
using System;
using System.Threading;
using LanguageExt;
using LanguageExt.Common;
using NodaTime;
using Thinktecture;

// --- [CLOSED_UNION] ---
// Attribute is metadata; Thinktecture generators/analyzers consume it.

[Union]
public abstract partial record TransactionState {
    private TransactionState() { }
    public sealed record Pending(DomainIdentity Id, TransactionAmount Amount, Instant InitiatedAt) : TransactionState;
    public sealed record Authorized(DomainIdentity Id, string AuthorizationToken) : TransactionState;
    public sealed record Settled(DomainIdentity Id, string ReceiptHash) : TransactionState;
    public sealed record Faulted(DomainIdentity Id, Error Reason) : TransactionState;
}

// --- [PROJECTION_EXTENSION] ---
// Prefer generated exhaustive APIs where available.

public static class TransactionStateProjection {
    public static bool IsTerminal(this TransactionState state) =>
        state.Switch(
            pending: static _ => false,
            authorized: static _ => false,
            settled: static _ => true,
            faulted: static _ => true);
}

// --- [TRANSITION_WRAPPER] ---

public interface IAuditWriter {
    Fin<Unit> Write(string message, CancellationToken ct);
}

public interface ITransactionTransitionService {
    Fin<TransactionState> Authorize(TransactionState current, string token, string idempotencyKey, CancellationToken ct);
}

public sealed class AuditTransitionWrapper(
    ITransactionTransitionService inner,
    IAuditWriter auditWriter) : ITransactionTransitionService {
    public Fin<TransactionState> Authorize(TransactionState current, string token, string idempotencyKey, CancellationToken ct) =>
        ct.IsCancellationRequested
            ? Fin.Fail<TransactionState>(Error.New(message: "Operation cancelled."))
            : inner.Authorize(current, token, idempotencyKey, ct).Bind(next =>
                ct.IsCancellationRequested
                    ? Fin.Fail<TransactionState>(Error.New(message: "Operation cancelled."))
                    : auditWriter.Write($"authorize:{idempotencyKey}:{next.GetType().Name}", ct).Map(_ => next));
}
```

---
## [5][GENERIC_MATH]
>**Dictum:** *Constrain algorithms to capabilities, not concrete types.*

Use narrow interfaces (`IAdditionOperators`, `IComparisonOperators`, `IMinMaxValue`) unless full `INumber<TSelf>` semantics are required.

```csharp
using System;
using System.Numerics;
using LanguageExt;
using LanguageExt.Common;

// --- [WEIGHTED_AVERAGE] ---

public static class NumericAggregates {
    public static Fin<double> WeightedAverage(Seq<(double Value, double Weight)> items) =>
        items.Fold(
            (sum: 0.0, weight: 0.0),
            static (acc, pair) => (acc.sum + pair.Value * pair.Weight, acc.weight + pair.Weight)) switch {
                (_, 0.0) => Fin.Fail<double>(Error.New(message: "WeightedAverage: total weight is zero.")),
                var (sum, weight) => Fin.Succ(sum / weight)
            };
}

// --- [CAPABILITY_TYPE] ---

public readonly record struct Percentage :
    IAdditionOperators<Percentage, Percentage, Percentage>,
    IComparisonOperators<Percentage, Percentage, bool>,
    IMinMaxValue<Percentage> {
    private readonly decimal _value;
    private Percentage(decimal value) => _value = value;

    public static Fin<Percentage> Create(decimal value) =>
        value is >= 0m and <= 100m
            ? Fin.Succ(new Percentage(value))
            : Fin.Fail<Percentage>(Error.New(message: "Percentage must be between 0 and 100."));

    public static Percentage operator +(Percentage left, Percentage right) =>
        new(Math.Clamp(value: left._value + right._value, min: 0m, max: 100m));

    public static Percentage MinValue => new(0m);
    public static Percentage MaxValue => new(100m);
    public static bool operator >(Percentage left, Percentage right) => left._value > right._value;
    public static bool operator >=(Percentage left, Percentage right) => left._value >= right._value;
    public static bool operator <(Percentage left, Percentage right) => left._value < right._value;
    public static bool operator <=(Percentage left, Percentage right) => left._value <= right._value;
}
```

---
## [6][LANGUAGEEXT_COLLECTIONS_AND_BOUNDARIES]
>**Dictum:** *Use trait-integrated collections in domain transforms; adapt at boundaries explicitly.*

Boundary discipline:
- Keep domain operations in `Seq<T>`, `HashMap<K,V>`, `HashSet<T>`.
- Materialize to BCL collections at adapters.
- Keep wrappers typed and cancellation-aware.
- Do not collapse `Fin.Fail` into success-like empty outputs.
- Treat `QueryAll<T>` and writer dependencies as total contracts (convert throws to `Fin.Fail` at boundaries).

```csharp
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using LanguageExt;
using LanguageExt.Common;

// --- [DOMAIN_COLLECTIONS] ---

public static class CollectionPatterns {
    public static Seq<int> EvenValues(Seq<int> values) => values.Filter(static x => x % 2 == 0);
    public static HashMap<string, decimal> MergeBalances(HashMap<string, decimal> left, HashMap<string, decimal> right) => left + right;
}

// --- [DELEGATE_WRAPPER] ---

public delegate Task<Fin<Seq<T>>> QueryAll<T>(CancellationToken ct);

public interface IMetricRecorder {
    Fin<Unit> RecordCount(int count, CancellationToken ct);
}

public static class QueryWrappers {
    public static QueryAll<T> WithMetrics<T>(QueryAll<T> next, IMetricRecorder recorder) =>
        async ct =>
            ct.IsCancellationRequested
                ? Fin.Fail<Seq<T>>(Error.New(message: "Operation cancelled."))
                : (await next(ct)).Bind(result =>
                    ct.IsCancellationRequested
                        ? Fin.Fail<Seq<T>>(Error.New(message: "Operation cancelled."))
                        : recorder.RecordCount(result.Count, ct).Map(_ => result));

    public static async Task<Fin<IReadOnlyList<T>>> MaterializeBoundary<T>(QueryAll<T> query, CancellationToken ct) =>
        (await query(ct)).Map(seq => (IReadOnlyList<T>)seq.ToList());
}
```

---
## [7][RULES]
>**Dictum:** *Rules are valid only when mechanism, scope, and failure behavior are explicit.*

Construction:
- [ALWAYS] Validate through `Fin<T>` factories.
- [ALWAYS] Keep validated constructors private.
- [ALWAYS] Keep source-generated value object attributes explicitly metadata-only in wording.
- [ALWAYS] Keep error messages stable and domain-specific for consistent telemetry aggregation.
- [ALWAYS] Keep factory signatures deterministic (`input -> Fin<T>`) to preserve composability under refactoring.
- [NEVER] Expose raw `string`/`Guid`/`decimal` where a domain type exists.

Type distinction:
- [ALWAYS] Use closed generic aliases for semantic clarity when appropriate.
- [ALWAYS] Keep `UnsafeWrap` internal and restricted to factory/test internals.
- [NEVER] Use open generic aliases.

Union and transition behavior:
- [ALWAYS] Keep union targets `abstract partial` class/record hierarchies with private base constructors.
- [ALWAYS] Treat extension methods as projection, not interception.
- [ALWAYS] Prefer generated exhaustive `Switch`/`Map` for unions where available.
- [ALWAYS] Use typed wrappers or explicit AOP toolchains (`Metalama`/`PostSharp`) for interception.
- [NEVER] Assume plain attributes intercept runtime behavior by themselves.

Decorator topology:
- [ALWAYS] Use `Decorate` for required wrappers.
- [ALWAYS] Use `TryDecorate` for optional wrappers.
- [ALWAYS] Put idempotency before outer telemetry/audit wrappers.
- [ALWAYS] Keep cancellation in typed failure channels (`Fin.Fail`) and propagate token intent (`CA2016` discipline).
- [ALWAYS] Document required vs optional decorators at registration sites to prevent topology drift.
- [NEVER] Inject throw-oriented side-effect delegates into `Fin` wrappers; use typed dependencies that return `Fin<Unit>`.

Collection boundaries:
- [ALWAYS] Keep domain transforms on LanguageExt collections.
- [ALWAYS] Materialize boundary shapes explicitly at adapters.
- [NEVER] Collapse `Fin.Fail` to empty “success-like” values at boundaries.
- [NEVER] Blur domain collection rules with persistence/transport adapter choreography.
