# [H1][TYPES]
>**Dictum:** *Types are closed proofs; domain primitives eradicate primitive obsession; DUs exhaust state space.*

<br>

Domain types in C# 14 / .NET 10 encode invariants at construction time via `Fin<T>` factories, prevent invalid states via sealed hierarchies, and align with JIT struct promotion for zero-heap value carriers. All snippets assume `using static LanguageExt.Prelude;` and `using LanguageExt;`.
For class/record/struct/ref-struct object-shape selection and Thinktecture object-model routing, load `objects.md` first.

---
## [1][DOMAIN_PRIMITIVES]
>**Dictum:** *Primitives validate inline; construction is total.*

<br>

`readonly record struct` + `field` keyword + `private` constructor + `static Fin<T>` factory. Invalid construction is unrepresentable.

```csharp
namespace Domain.Types;

using static LanguageExt.Prelude;

public readonly record struct DomainIdentity {
    public Guid Value { get; init => field = value; }
    private DomainIdentity(Guid value) { Value = value; }
    public static Fin<DomainIdentity> Create(Guid candidate) =>
        candidate.Equals(obj: Guid.Empty) switch {
            true => FinFail<DomainIdentity>(Error.New(message: "Identity must not be empty.")),
            false => FinSucc(new DomainIdentity(value: candidate))
        };
}
public readonly record struct TransactionAmount {
    public decimal Value { get; init => field = decimal.Round(d: value, decimals: 4); }
    private TransactionAmount(decimal value) { Value = value; }
    public static Fin<TransactionAmount> Create(decimal candidate) =>
        (candidate > 0.0m) switch {
            true => FinSucc(new TransactionAmount(value: candidate)),
            false => FinFail<TransactionAmount>(Error.New(message: "Amount must be strictly positive."))
        };
}
```

[CRITICAL]: Every domain primitive follows this shape. No public constructors on validated types.

[IMPORTANT]: For high-volume primitives with simple constraints, Thinktecture Runtime Extensions (`[ValueObject<T>]`) source-generates wrappers with validation and framework integration. Use manual `Fin<T>` factory when validation logic is custom.

---
## [2][NEWTYPE_GENERIC]
>**Dictum:** *One wrapper serves many domain atoms.*

<br>

`Newtype<TTag, TRepr>` is a zero-alloc generic wrapper. Sealed tag classes act as phantom discriminators. `using` aliases provide ergonomic naming without structural duplication.

```csharp
namespace Domain.Types;

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

[IMPORTANT]: Tag types are `sealed class` with no members. The `using` alias is the public API; consumers never reference `Newtype<TTag,TRepr>` directly.

---
## [3][SMART_CONSTRUCTORS]
>**Dictum:** *Construction is validated composition; no `if`/`else`, no exceptions.*

<br>

`Domain.Make` validates and wraps in one step. `Domain.Require` converts `bool` to `Fin<A>` via switch. `Domain.Parse` lifts any `TryParseSpan` delegate into `Fin<A>`.

```csharp
namespace Domain.Types;

using static LanguageExt.Prelude;

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
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Fin<NonEmptyText> NonEmpty(string text) =>
        Make<NonEmptyTextTag, string>(value: text, validate: ValidateNonEmpty);
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Fin<Email> Email(string text) =>
        Make<EmailTag, string>(value: text, validate: (string candidate) =>
            Require(predicate: candidate.Length > 0,
                onFalse: () => Errors.InvalidEmail,
                onTrue: () => candidate).Bind(ValidateEmailShape));
    public delegate bool TryParseSpan<A>(ReadOnlySpan<char> text, out A value);
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Fin<A> Parse<A>(
        ReadOnlySpan<char> text,
        TryParseSpan<A> parser,
        Func<Error> onError) =>
        parser(text, out A value) switch {
            true => value,
            false => onError()
        };
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Fin<UserId> UserId(Guid value) =>
        value == Guid.Empty switch {
            true => FinFail<UserId>(Errors.InvalidGuid),
            false => FinSucc(new UserId(Value: value))
        };
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Fin<UserId> ParseUserId(ReadOnlySpan<char> text) =>
        Parse<Guid>(text: text, parser: Guid.TryParse, onError: () => Errors.InvalidGuid)
            .Bind(UserId);
}
```

[CRITICAL]: Smart constructors chain `Make` -> `Require` -> `Fin` without `if`/`else`. `Parse<A>` accepts any `TryParseSpan` delegate for span-based parsing aligned with C# 14 implicit span conversions.

---
## [4][DISCRIMINATED_UNIONS]
>**Dictum:** *Sealed hierarchies exhaust state space; the compiler enforces totality.*

<br>

Sealed abstract record with `private protected` constructor closes the hierarchy. C# 14 extension members project behavior without inheritance. Because C# does not yet ship first-class DU exhaustiveness checking (targeted for C# 15), include a `_ => throw new UnreachableException()` arm defensively on pure-query matches.

```csharp
namespace Domain.Types;

using static LanguageExt.Prelude;

public abstract record TransactionState {
    private protected TransactionState() { }
    public sealed record Pending(
        DomainIdentity Id,
        TransactionAmount Amount,
        DateTimeOffset InitiatedAt) : TransactionState;
    public sealed record Authorized(
        DomainIdentity Id,
        string AuthorizationToken) : TransactionState;
    public sealed record Settled(
        DomainIdentity Id,
        string ReceiptHash) : TransactionState;
    public sealed record Faulted(
        DomainIdentity Id,
        Error Reason) : TransactionState;
}
public static class TransactionLifecycleRole {
    extension(TransactionState state) {
        public bool IsTerminal =>
            state switch {
                TransactionState.Settled => true,
                TransactionState.Faulted => true,
                TransactionState.Pending => false,
                TransactionState.Authorized => false,
                _ => throw new UnreachableException(message: "Exhaustive: all TransactionState variants handled")
            };
        public Fin<TransactionState> Authorize(string token) =>
            state switch {
                TransactionState.Pending pending =>
                    FinSucc<TransactionState>(
                        new TransactionState.Authorized(
                            Id: pending.Id, AuthorizationToken: token)),
                TransactionState.Authorized authorized =>
                    FinSucc<TransactionState>(authorized),
                _ => FinFail<TransactionState>(
                    Error.New(message: "Only pending transactions can be authorized."))
            };
    }
}
```

[IMPORTANT]: `private protected` guarantees no external derivation. The `_` arm with `UnreachableException` is defensive until C# ships first-class DU exhaustiveness -- remove it when the compiler enforces totality natively. Extension members project pure transformations; see `effects.md` [2] for `Eff` pipelines over DU transitions.

---
## [5][PHANTOM_TYPES]
>**Dictum:** *Compile-time state is zero-cost; runtime enforcement is unnecessary.*

<br>

Empty `readonly struct` markers parameterize a generic record. Method signatures accept only the validated variant -- compile-time enforcement with zero runtime overhead.

```csharp
namespace Domain.Types;

using static LanguageExt.Prelude;

public readonly struct Unvalidated;
public readonly struct Validated;
public readonly record struct UserId<TState>(Guid Value);
public static class UserIdOps {
    public static Fin<UserId<Validated>> Validate(UserId<Unvalidated> raw) =>
        raw.Value switch {
            Guid guid when guid != Guid.Empty =>
                FinSucc(new UserId<Validated>(Value: guid)),
            _ => FinFail<UserId<Validated>>(
                Error.New(message: "UserId cannot be empty"))
        };
}
```

[CRITICAL]: `LoadUser(UserId<Validated> id)` rejects `UserId<Unvalidated>` at compile time. The phantom parameter carries no runtime data.

---
## [6][GENERIC_MATH]
>**Dictum:** *Algorithms constrain to capabilities, not concrete types.*

<br>

`INumber<T>` / `IFloatingPoint<T>` enable generic numeric algorithms. Prefer fine-grained constraints (`IAdditiveIdentity`, `IAdditionOperators`) when the algorithm does not need the full `INumber<T>` surface. Use manual folds over `ReadOnlySpan<T>` -- LINQ `Aggregate` requires heap allocation via `ToArray()`.

```csharp
namespace Domain.Types;

using static LanguageExt.Prelude;

public static class NumericAggregates {
    public static T WeightedAverage<T>(
        ReadOnlySpan<T> values,
        ReadOnlySpan<T> weights) where T : IFloatingPoint<T> {
        // Manual fold avoids .ToArray() heap allocation on span input
        T weightedSum = T.Zero;
        T totalWeight = T.Zero;
        for (int i = 0; i < values.Length; i++) {
            weightedSum += values[i] * weights[i];
            totalWeight += weights[i];
        }
        return weightedSum / totalWeight;
    }
}
```

**Domain Type with Generic Math** -- implement the specific numeric interfaces your type needs. `INumber<T>` requires ~50 members; most delegate to the underlying representation. Shown here is the construction + key operators:

```csharp
public readonly record struct Percentage :
    IAdditionOperators<Percentage, Percentage, Percentage>,
    IComparisonOperators<Percentage, Percentage, bool>,
    IMinMaxValue<Percentage> {
    private readonly decimal _value;
    private Percentage(decimal value) => _value = value;
    public static Fin<Percentage> Create(decimal value) =>
        value switch {
            >= 0m and <= 100m => FinSucc(new Percentage(value: value)),
            _ => FinFail<Percentage>(Error.New(message: "Percentage must be 0-100."))
        };
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

[IMPORTANT]: Implement only the interfaces you need. Full `INumber<Percentage>` is justified when the type participates in generic numeric algorithms (`WeightedAverage<Percentage>`). For domain types that only need construction + comparison, narrower interfaces suffice.

---
## [7][LANGUAGEEXT_COLLECTIONS]
>**Dictum:** *Prefer trait-integrated collections over BCL immutable types.*

<br>

LanguageExt provides CHAMP-based `HashMap<K,V>`, `HashSet<T>`, and array-backed `Seq<T>` that implement `K<F,A>` traits (`Foldable`, `Traversable`, `Monad`). BCL `ImmutableDictionary`/`ImmutableList` do not integrate with the HKT trait system.

| [COLLECTION]   | [BACKING]   | [USE_WHEN]                                         |
| -------------- | ----------- | -------------------------------------------------- |
| `Seq<T>`       | Array, lazy | Default ordered sequence; 10x faster than `Lst<T>` |
| `HashMap<K,V>` | CHAMP trie  | Key-value lookup; fastest .NET immutable dict      |
| `HashSet<T>`   | CHAMP trie  | Membership testing; unsorted                       |
| `Map<K,V>`     | AVL tree    | Only when sorted key order is required             |

```csharp
// Seq: fold, choose, traverse -- all native
Seq<int> numbers = Seq(1, 2, 3, 4, 5);
Seq<int> evens = numbers.Filter((int n) => n % 2 == 0);
int total = numbers.Fold(state: 0, folder: (int acc, int n) => acc + n);

// HashMap: allocation-efficient lookup returning Option
HashMap<string, decimal> balances = HashMap(("alice", 1000m), ("bob", 500m));
Option<decimal> alice = balances.Find(key: "alice");
```

[CRITICAL]: Use `Seq<T>` over `List<T>` / `IEnumerable<T>` in domain code. Use `HashMap<K,V>` over `Dictionary` / `ImmutableDictionary`. LanguageExt collections compose with `Traverse`, `Sequence`, `Bind` via the trait system.

---
## [8][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] One canonical type per concept -- derive variants at call site via composition.
- [ALWAYS] `readonly` on every field and record -- immutability is default.
- [ALWAYS] `Fin<T>` factory for every validated type -- construction is typed.
- [ALWAYS] `field` keyword for inline property validation -- no separate setter logic.
- [ALWAYS] `using static LanguageExt.Prelude;` in every domain file -- `FinSucc`, `FinFail`, `Some`, `None`, `Seq`, `HashMap` available without qualification.
- [ALWAYS] LanguageExt collections (`Seq`, `HashMap`, `HashSet`) over BCL immutable types in domain code.
- [NEVER] Public constructors on validated domain primitives.
- [NEVER] `string`/`int`/`Guid` as method parameters where a domain primitive exists.
- [NEVER] Full `INumber<T>` when narrower interfaces (`IAdditionOperators`, `IComparisonOperators`) suffice.

---
## [9][QUICK_REFERENCE]

| [INDEX] | [PATTERN]               | [WHEN]                        | [KEY_TRAIT]                                          |
| :-----: | ----------------------- | ----------------------------- | ---------------------------------------------------- |
|   [1]   | Domain primitive        | Validated scalar (ID, amount) | `readonly record struct` + `Fin`                     |
|   [2]   | Newtype wrapper         | Semantic alias, zero-alloc    | `Newtype<TTag,TRepr>` + `using`                      |
|   [3]   | Smart constructor       | Validated newtype creation    | `Domain.Make` + `Domain.Require`                     |
|   [4]   | Discriminated union     | Exhaustive state space        | Sealed abstract record + `_ => UnreachableException` |
|   [5]   | Phantom type            | Compile-time state tracking   | Empty `readonly struct` marker                       |
|   [6]   | Generic math            | Numeric algorithm over any T  | `INumber<T>` / fine-grained interfaces               |
|   [7]   | LanguageExt collections | Domain sequences and maps     | `Seq<T>` / `HashMap<K,V>`                            |
|   [8]   | Span parsing            | Allocation-free text parsing  | `TryParseSpan<A>` + `Domain.Parse`                   |
