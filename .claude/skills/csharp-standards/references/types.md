# [H1][TYPES]
>**Dictum:** *Types are closed proofs; primitives eradicate obsession; DUs exhaust state space.*

Domain types in C# 14 / .NET 10 encode invariants at construction time via `Fin<T>` factories, prevent invalid states via sealed hierarchies, and align with JIT struct promotion for zero-heap value carriers. All snippets assume `using static LanguageExt.Prelude;` and `using LanguageExt;`.
For object-shape selection and Thinktecture routing, load `objects.md` first.

---
## [1][DOMAIN_PRIMITIVES]
>**Dictum:** *Primitives validate inline; construction is total.*

`readonly record struct` + `field` keyword + `private` constructor + `static Fin<T>` factory. Invalid construction is unrepresentable.

```csharp
namespace Domain.Types;

using static LanguageExt.Prelude;

public readonly record struct DomainIdentity {
    // { get; } only -- no init accessor. Prevents with-expression bypass
    // of smart constructor validation (CSP0720).
    public Guid Value { get; }
    private DomainIdentity(Guid value) { Value = value; }
    public static Fin<DomainIdentity> Create(Guid candidate) =>
        candidate.Equals(g: Guid.Empty) switch {
            true => Fin.Fail<DomainIdentity>(Error.New(message: "Identity must not be empty.")),
            false => Fin.Succ(new DomainIdentity(value: candidate))
        };
}
public readonly record struct TransactionAmount {
    // { get; } only -- normalization runs in factory, not property accessor.
    // Prevents with-expression bypass of validation (CSP0720).
    public decimal Value { get; }
    private TransactionAmount(decimal value) { Value = value; }
    public static Fin<TransactionAmount> Create(decimal candidate) =>
        (candidate > 0.0m) switch {
            true => Fin.Succ(new TransactionAmount(
                value: decimal.Round(d: candidate, decimals: 4))),
            false => Fin.Fail<TransactionAmount>(Error.New(message: "Amount must be strictly positive."))
        };
}
```

[CRITICAL]: Every domain primitive follows this shape. No public constructors on validated types.

[IMPORTANT]: For high-volume primitives with simple constraints, Thinktecture Runtime Extensions (`[ValueObject<T>]`) source-generates wrappers. Use manual `Fin<T>` factory when validation logic is custom.

---
## [1A][TEMPORAL_PRIMITIVES]
>**Dictum:** *Time is a typed dependency; wall-clock reads are boundary concerns.*

```csharp
using NodaTime;

public readonly record struct OccurredAt {
    public Instant Value { get; }
    private OccurredAt(Instant value) => Value = value;
    public static Fin<OccurredAt> Create(Instant value) => Fin.Succ(new OccurredAt(value));
    // FromClock wraps in Fin<OccurredAt> for API uniformity with Create -- clock reads are
    // infallible, but a consistent Fin<T> return surface lets callers compose both factories
    // via the same Bind/Map pipeline without special-casing the clock acquisition path.
    public static Fin<OccurredAt> FromClock(IClock clock) => Fin.Succ(new OccurredAt(clock.GetCurrentInstant()));
}
```

[CRITICAL]: Domain types use `Instant` + injected `IClock`; avoid direct `DateTime*`/`DateTimeOffset*` in domain flows.

---
## [2][NEWTYPE_GENERIC]
>**Dictum:** *One wrapper serves many domain atoms.*

`Newtype<TTag, TRepr>` is a zero-alloc generic wrapper. The `TTag` phantom type parameter exists solely for compile-time differentiation -- never instantiated. Sealed tag classes act as phantom discriminators.

[IMPORTANT]: LanguageExt v5 ships `NewType<SELF, A>` (CRTP inheritance) requiring a `class` inheritor (heap allocation). This codebase uses a zero-alloc `readonly record struct` alternative with phantom tag discrimination. Do not mix the two in the same bounded context.
[IMPORTANT]: `using` aliases are file-scoped in C# 14. Each consuming file must redeclare them. `global using` aliases cannot reference generic types -- prefer `readonly record struct` with source generator for cross-file usage.

```csharp
public readonly record struct Newtype<TTag, TRepr>(TRepr Value)
    where TRepr : notnull {
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public override string ToString() => Value.ToString() ?? string.Empty;
}
public sealed class UserIdTag;
public sealed class EmailTag;
public sealed class NonEmptyTextTag;
public sealed class MoneyCentsTag;
using UserId = Domain.Types.Newtype<Domain.Types.UserIdTag, System.Guid>;
using Email = Domain.Types.Newtype<Domain.Types.EmailTag, string>;
using NonEmptyText = Domain.Types.Newtype<Domain.Types.NonEmptyTextTag, string>;
using MoneyCents = Domain.Types.Newtype<Domain.Types.MoneyCentsTag, long>;
```

---
## [3][SMART_CONSTRUCTORS]
>**Dictum:** *Construction is validated composition; two primitives compose all factories.*

`Domain.Make` validates and wraps in one step. `Domain.Require` converts `bool` to `Fin<A>` via pattern match. Typed factories compose these two primitives at call site -- no per-type wrapper functions.

```csharp
public static class Domain {
    public static class Errors {
        public static readonly Error EmptyText = Error.New(message: "text must be non-empty");
        public static readonly Error InvalidEmail = Error.New(message: "email is invalid");
        public static readonly Error InvalidGuid = Error.New(message: "guid is invalid");
    }
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Fin<A> Require<A>(bool predicate, Func<Error> onFalse, Func<A> onTrue) =>
        predicate switch {
            true => onTrue(),
            false => onFalse()
        };
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Fin<Newtype<TTag, TRepr>> Make<TTag, TRepr>(
        TRepr value,
        Func<TRepr, Fin<TRepr>> validate) where TRepr : notnull =>
        validate(value).Map((TRepr ok) => new Newtype<TTag, TRepr>(Value: ok));
}
```

**Call-site composition** -- typed factories compose `Make` + `Require` at the entity level:

```csharp
Fin<UserId> userId = Domain.Make<UserIdTag, Guid>(
    value: rawGuid,
    validate: (Guid candidate) => Domain.Require(
        predicate: candidate != Guid.Empty,
        onFalse: () => Domain.Errors.InvalidGuid,
        onTrue: () => candidate));
Fin<NonEmptyText> name = Domain.Make<NonEmptyTextTag, string>(
    value: raw,
    validate: (string candidate) => Domain.Require(
        predicate: candidate.Length > 0,
        onFalse: () => Domain.Errors.EmptyText,
        onTrue: () => candidate));
```

[REF]: Span-based parsing via `TryParseSpan<A>` + `Parse<A>` is canonicalized in `performance.md` [2][SPAN_PARSING]. Import from there; do not redefine.

---
## [4][DISCRIMINATED_UNIONS]
>**Dictum:** *Sealed hierarchies exhaust state space; the compiler enforces totality.*

Sealed abstract record with `private protected` constructor closes the hierarchy. C# 14 extension members project behavior without inheritance. Until C# ships first-class DU exhaustiveness (targeted C# 15), include `_ => throw new UnreachableException()` defensively.

```csharp
using NodaTime;
using static LanguageExt.Prelude;

public abstract record TransactionState {
    private protected TransactionState() { }
    public sealed record Pending(
        DomainIdentity Id, TransactionAmount Amount, Instant InitiatedAt) : TransactionState;
    public sealed record Authorized(
        DomainIdentity Id, string AuthorizationToken) : TransactionState;
    public sealed record Settled(
        DomainIdentity Id, string ReceiptHash) : TransactionState;
    public sealed record Faulted(
        DomainIdentity Id, Error Reason) : TransactionState;
}
// Extension members require C# 14 (<LangVersion>preview</LangVersion> with .NET 10 SDK).
public static class TransactionLifecycleRole {
    extension(TransactionState state) {
        public bool IsTerminal =>
            state switch {
                TransactionState.Settled => true,
                TransactionState.Faulted => true,
                TransactionState.Pending => false,
                TransactionState.Authorized => false,
                _ => throw new UnreachableException(message: "Exhaustive: all variants handled")
            };
        public Fin<TransactionState> Authorize(string token) =>
            state switch {
                TransactionState.Pending pending =>
                    Fin.Succ<TransactionState>(
                        new TransactionState.Authorized(Id: pending.Id, AuthorizationToken: token)),
                TransactionState.Authorized authorized =>
                    Fin.Succ<TransactionState>(authorized),
                _ => Fin.Fail<TransactionState>(
                    Error.New(message: "Only pending transactions can be authorized."))
            };
    }
}
```

[IMPORTANT]: `private protected` guarantees no external derivation. The `_` arm is defensive until C# ships DU exhaustiveness -- remove when the compiler enforces totality. See `effects.md` [2] for `Eff` pipelines over DU transitions.

---
## [5][PHANTOM_TYPES]
>**Dictum:** *Compile-time state is zero-cost; runtime enforcement is unnecessary.*

Empty `readonly struct` markers parameterize a generic record. Method signatures accept only the validated variant -- compile-time enforcement with zero runtime overhead.

```csharp
public readonly struct Unvalidated;
public readonly struct Validated;
public readonly record struct UserId<TState>(Guid Value);
public static class UserIdOps {
    public static Fin<UserId<Validated>> Validate(UserId<Unvalidated> raw) =>
        (raw.Value != Guid.Empty) switch {
            true => Fin.Succ(new UserId<Validated>(Value: raw.Value)),
            false => Fin.Fail<UserId<Validated>>(
                Error.New(message: "UserId cannot be empty"))
        };
}
```

[CRITICAL]: `LoadUser(UserId<Validated> id)` rejects `UserId<Unvalidated>` at compile time. The phantom parameter carries no runtime data.

---
## [6][GENERIC_MATH]
>**Dictum:** *Algorithms constrain to capabilities, not concrete types.*


`INumber<T>` / `IFloatingPoint<T>` enable generic numeric algorithms. Prefer fine-grained constraints (`IAdditiveIdentity`, `IAdditionOperators`) when the full `INumber<T>` surface is unnecessary.

[CONDITIONAL]: `for` is permitted over `ReadOnlySpan<T>` -- spans have no `IEnumerable<T>` and no fold surface. Use `Seq<T>.Fold` for all non-span collections.

```csharp
// Requires: using static LanguageExt.Prelude; -- Fail and Pure in WeightedAverage resolve from Prelude.
public static class NumericAggregates {
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Fin<double> WeightedAverage(Seq<(double Value, double Weight)> items) =>
        items.Fold(
            (sum: 0.0, weight: 0.0),
            static (acc, pair) => (acc.sum + pair.Value * pair.Weight, acc.weight + pair.Weight)
        ) switch
        {
            (_, 0.0) => Fail(Error.New("WeightedAverage: zero total weight")),
            var (sum, weight) => Pure(sum / weight)
        };
}
```

**Domain Type with Generic Math** -- implement only the interfaces your type needs:

```csharp
public readonly record struct Percentage :
    IAdditionOperators<Percentage, Percentage, Percentage>,
    IComparisonOperators<Percentage, Percentage, bool>,
    IComparable<Percentage>,
    IMinMaxValue<Percentage> {
    private readonly decimal _value;
    private Percentage(decimal value) => _value = value;
    public static Fin<Percentage> Create(decimal value) =>
        value switch {
            >= 0m and <= 100m => Fin.Succ(new Percentage(value: value)),
            _ => Fin.Fail<Percentage>(Error.New(message: "Percentage must be 0-100."))
        };
    public int CompareTo(Percentage other) => _value.CompareTo(other._value);
    public static Percentage operator +(Percentage left, Percentage right) =>
        new(Math.Clamp(value: left._value + right._value, min: 0m, max: 100m));
    public static Percentage MinValue => new(value: 0m);
    public static Percentage MaxValue => new(value: 100m);
    public static bool operator >(Percentage left, Percentage right) => left._value > right._value;
    public static bool operator >=(Percentage left, Percentage right) => left._value >= right._value;
    public static bool operator <(Percentage left, Percentage right) => left._value < right._value;
    public static bool operator <=(Percentage left, Percentage right) => left._value <= right._value;
}
```

[IMPORTANT]: Full `INumber<Percentage>` only when the type participates in generic numeric algorithms. Target: O(log n) persistent operations; benchmark via BenchmarkDotNet before claiming specific ratios.

**Typeclass Encoding via Static Abstract** -- `static abstract` members encode Haskell-style typeclasses in C#. The CRTP constraint `TSelf : ITypeclass<TSelf>` enables generic algorithms to call static members on the implementing type without boxing. This is how `INumber<T>`, `IParsable<T>`, and `ISpanParsable<T>` work internally.

```csharp
// Custom typeclass: domain primitives that can create themselves from a validated raw value.
public interface IValidatedFactory<TSelf, TRaw>
    where TSelf : IValidatedFactory<TSelf, TRaw> {
    static abstract Fin<TSelf> Create(TRaw candidate);
    static abstract TRaw Extract(TSelf value);
}
public readonly record struct OrderQuantity : IValidatedFactory<OrderQuantity, int> {
    private readonly int _value;
    private OrderQuantity(int value) => _value = value;
    public static Fin<OrderQuantity> Create(int candidate) =>
        (candidate > 0 && candidate <= 10_000) switch {
            true => Fin.Succ(new OrderQuantity(value: candidate)),
            false => Fin.Fail<OrderQuantity>(Error.New(message: "Quantity must be 1-10000."))
        };
    public static int Extract(OrderQuantity value) => value._value;
}
// Generic algorithm dispatches via typeclass constraint -- zero boxing.
public static class ValidatedOps {
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Fin<TSelf> ClampAndCreate<TSelf, TRaw>(
        TRaw candidate, Func<TRaw, TRaw> clamp)
        where TSelf : IValidatedFactory<TSelf, TRaw> =>
        TSelf.Create(clamp(candidate));
}
```

[IMPORTANT]: Use `static abstract` typeclass encoding when 3+ domain primitives share a creation/extraction protocol. For fewer types, direct `Fin<T>` factories (section [1]) are simpler.

---
## [7][LANGUAGEEXT_COLLECTIONS]
>**Dictum:** *Prefer trait-integrated collections over BCL immutable types.*

LanguageExt provides CHAMP-based `HashMap<K,V>`, `HashSet<T>`, and array-backed `Seq<T>` implementing `K<F,A>` traits (`Foldable`, `Traversable`, `Monad`). BCL immutable types lack HKT trait integration.

| [INDEX] | [COLLECTION]       | [BACKING]   | [USE_WHEN]                                                   |
| :-----: | :----------------- | :---------- | ------------------------------------------------------------ |
|   [1]   | **`Seq<T>`**       | Array, lazy | Default ordered sequence; array-backed, faster than `Lst<T>` |
|   [2]   | **`HashMap<K,V>`** | CHAMP trie  | Key-value lookup; competitive immutable perf via CHAMP trie  |
|   [3]   | **`HashSet<T>`**   | CHAMP trie  | Membership testing; unsorted                                 |
|   [4]   | **`Map<K,V>`**     | AVL tree    | Only when sorted key order is required                       |

```csharp
Seq<int> numbers = Seq(1, 2, 3, 4, 5);
Seq<int> evens = numbers.Filter((int n) => n % 2 == 0);
int total = numbers.Fold(0, (int acc, int n) => acc + n);
HashMap<string, decimal> balances = HashMap(("alice", 1000m), ("bob", 500m));
Option<decimal> alice = balances.Find(key: "alice");
```

[CRITICAL]: `Seq<T>` over `List<T>` / `IEnumerable<T>`; `HashMap<K,V>` over `Dictionary` / `ImmutableDictionary`. LanguageExt collections compose with `Traverse`, `Sequence`, `Bind` via the trait system.

---
## [8][RULES]
>**Dictum:** *Rules compress into constraints.*

- [ALWAYS] One canonical type per concept -- derive variants at call site.
- [ALWAYS] `readonly` on every field and record -- immutability is default.
- [ALWAYS] `Fin<T>` factory for every validated type -- construction is typed.
- [ALWAYS] `field` keyword for inline property normalization on non-validated types only (CSP0720: `init` accessor on `Fin<T>` types enables `with`-expression bypass; use `{ get; }` only and normalize in factory).
- [ALWAYS] `using static LanguageExt.Prelude;` in every domain file.
- [ALWAYS] LanguageExt collections (`Seq`, `HashMap`, `HashSet`) over BCL immutable types.
- [ALWAYS] Temporal primitives use `NodaTime.Instant` with injected `IClock`/`TimeProvider`.
- [NEVER] Public constructors on validated domain primitives.
- [NEVER] `string`/`int`/`Guid` as parameters where a domain primitive exists.
- [NEVER] `DateTime.Now`/`DateTime.UtcNow`/`DateTimeOffset.Now`/`DateTimeOffset.UtcNow` in domain code.
- [NEVER] Full `INumber<T>` when narrower interfaces suffice.

---
## [9][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                   | [WHEN]                        | [KEY_TRAIT]                                          |
| :-----: | :-------------------------- | ----------------------------- | ---------------------------------------------------- |
|   [1]   | **Domain primitive**        | Validated scalar (ID, amount) | `readonly record struct` + `Fin`                     |
|   [2]   | **Newtype wrapper**         | Semantic alias, zero-alloc    | `Newtype<TTag,TRepr>` + `Make`/`Require`             |
|   [3]   | **Discriminated union**     | Exhaustive state space        | Sealed abstract record + `_ => UnreachableException` |
|   [4]   | **Phantom type**            | Compile-time state tracking   | Empty `readonly struct` marker                       |
|   [5]   | **Generic math**            | Numeric algorithm over any T  | `INumber<T>` / fine-grained interfaces               |
|  [5A]   | **Typeclass encoding**      | Shared protocol across types  | `static abstract` + CRTP constraint                  |
|   [6]   | **LanguageExt collections** | Domain sequences and maps     | `Seq<T>` / `HashMap<K,V>`                            |
