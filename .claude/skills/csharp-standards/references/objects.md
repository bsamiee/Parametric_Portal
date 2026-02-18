# [H1][OBJECTS]
>**Dictum:** *Object topology is a proof surface: pick one canonical shape per concept and encode invariants at construction.*

<br>

Object-focused reference for C# 14 / .NET 10 with LanguageExt v5 and Thinktecture Runtime Extensions v10.
This document standardizes object-family selection, invariant construction, variant modeling, and boundary mapping without representational drift.
Effect orchestration lives in `effects.md`; polymorphic compression lives in `composition.md`; low-level tuning lives in `performance.md`.

---
## [1][TOPOLOGY_SELECTION]
>**Dictum:** *Choose by semantic contract, then commit to one canonical form.*

<br>

| [INDEX] | [DOMAIN_SHAPE]                               | [CANONICAL_FORM]         |
| :-----: | -------------------------------------------- | ------------------------ |
|   [1]   | Constrained scalar (Email, Amount, Id)       | `[ValueObject<T>]`       |
|   [2]   | Closed behavioral set (status/type/strategy) | `[SmartEnum<T>]`         |
|   [3]   | Closed variant payload space                 | `[Union]`                |
|   [4]   | Identity-bearing lifecycle object            | `sealed class` aggregate |
|   [5]   | Stack-confined parser/workspace              | `readonly ref struct`    |

[IMPORTANT]:
- [1] Use generated `TryCreate` as the external ingress gate.
- [2] Use generated exhaustive `Switch`/`Map`; keep behavior co-located with the enum.
- [3] Use generated exhaustive `Switch`/`Map`; avoid nullable/flag choreography.
- [4] Aggregate transitions return typed codomains (`Fin<T>` / `Validation<Error,T>`).
- [5] Convert stack-only buffers into canonical objects before crossing boundaries.

[CRITICAL]:
- One concept gets one canonical shape.
- Raw primitives terminate at adapters.
- If a second "canonical" shape appears, the model has already drifted.

---
## [2][VALUE_OBJECT_CANONICAL]
>**Dictum:** *Value objects terminate primitive obsession at ingestion boundaries.*

<br>

Thinktecture v10 source-generates construction APIs; LanguageExt provides typed error channels.
Use `TryCreate` for untrusted input and project to `Fin<T>` / `Validation<Error,T>`.

```csharp
namespace Domain.Objects;

using Thinktecture;

[ValueObject<string>(KeyMemberName = "Value")]
public readonly partial struct EmailAddress {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) {
        value = value.Trim();
        validationError = value.Length switch {
            0 => new ValidationError("EmailAddress must not be empty."),
            _ => value.Contains('@') switch {
                true => null,
                false => new ValidationError("EmailAddress must contain '@'.")
            }
        };
    }
}
[ValueObject<decimal>(KeyMemberName = "Value")]
public readonly partial struct MoneyAmount {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref decimal value) {
        value = decimal.Round(value, decimals: 2, mode: MidpointRounding.ToEven);
        validationError = value switch {
            <= 0m => new ValidationError("MoneyAmount must be > 0."),
            _ => null
        };
    }
}
[ValueObject<Guid>(KeyMemberName = "Value")]
public readonly partial struct OrderId {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref Guid value) =>
        validationError = value switch {
            var candidate when candidate == Guid.Empty => new ValidationError("OrderId must not be empty."),
            _ => null
        };
}
```

```csharp
namespace Domain.Objects;

using LanguageExt;
using LanguageExt.Common;
using Thinktecture;
using static LanguageExt.Prelude;

public static class ValueObjectBridge {
    public static Fin<TValueObject> Parse<TValueObject, TKey>(TKey candidate)
        where TValueObject : IValueObjectFactory<TValueObject, TKey, ValidationError> =>
        TValueObject.TryCreate(candidate, out TValueObject value, out ValidationError? validationError) switch {
            true => FinSucc(value),
            false => FinFail<TValueObject>(Error.New(validationError?.Message ?? $"{typeof(TValueObject).Name} validation failed."))
        };
    public static Validation<Error, TValueObject> Validate<TValueObject, TKey>(TKey candidate)
        where TValueObject : IValueObjectFactory<TValueObject, TKey, ValidationError> =>
        Parse<TValueObject, TKey>(candidate).ToValidation();
}
```

[CRITICAL]:
- `Create` is for trusted internal construction; `TryCreate` is the boundary gate.
- Never expose primitives in public domain signatures once a value object exists.

---
## [3][SMART_ENUM_CANONICAL]
>**Dictum:** *Closed behavioral sets belong in SmartEnums, not primitive enums plus detached switch maps.*

<br>

Thinktecture SmartEnums provide typed lookup (`Get`/`TryGet`), validation, and exhaustive `Switch`/`Map`.
Prefer context overloads + `static` lambdas on hot paths to avoid closure allocation.

```csharp
namespace Domain.Objects;

using LanguageExt;
using LanguageExt.Common;
using Thinktecture;
using static LanguageExt.Prelude;

[SmartEnum<string>]
public partial class OrderState {
    public static readonly OrderState Draft = new("DRAFT");
    public static readonly OrderState Confirmed = new("CONFIRMED");
    public static readonly OrderState Cancelled = new("CANCELLED");
    static partial void ValidateConstructorArguments(ref string key) =>
        key = key.Trim().ToUpperInvariant();
}
public static class OrderStateRole {
    extension(OrderState state) {
        public bool IsTerminal =>
            state.Map(
                draft: false,
                confirmed: false,
                cancelled: true);
        public Fin<OrderState> EnsureProgressable() =>
            state.Switch(state,
                draft: static current => FinSucc(current),
                confirmed: static current => FinSucc(current),
                cancelled: static _ => FinFail<OrderState>(Error.New("Cancelled state is terminal.")));
    }
}
```

```csharp
namespace Domain.Objects;

using LanguageExt;
using LanguageExt.Common;
using Thinktecture;
using static LanguageExt.Prelude;

public static class SmartEnumBridge {
    public static Fin<TEnum> Parse<TEnum, TKey>(TKey candidate)
        where TEnum : class, ISmartEnum<TEnum, TKey> =>
        TEnum.TryGet(candidate, out TEnum? value) switch {
            true when value is not null => FinSucc(value),
            _ => FinFail<TEnum>(Error.New($"Unknown {typeof(TEnum).Name} '{candidate}'."))
        };
    public static Validation<Error, TEnum> Validate<TEnum, TKey>(TKey candidate)
        where TEnum : class, ISmartEnum<TEnum, TKey> =>
        Parse<TEnum, TKey>(candidate).ToValidation();
}
```

[CRITICAL]:
- Never model SmartEnum behavior in external switch tables.
- Boundary parse uses `TryGet`; reserve throwing `Get` for trusted paths.

---
## [4][UNION_CANONICAL]
>**Dictum:** *Variant payloads require unions, not nullable field choreography.*

<br>

Use union modeling for outcomes where each case owns distinct payload semantics.
Generated `Switch`/`Map` methods enforce exhaustiveness at compile time.

```csharp
namespace Domain.Objects;

using LanguageExt;
using LanguageExt.Common;
using Thinktecture;
using static LanguageExt.Prelude;

[Union]
public abstract partial record PaymentResult {
    public sealed record Authorized(string AuthorizationCode) : PaymentResult;
    public sealed record Declined(string Reason) : PaymentResult;
    public sealed record ProviderFailure(string Code, string Message) : PaymentResult;
}
public static class PaymentResultRole {
    extension(PaymentResult result) {
        public string Category =>
            result.Map(
                authorized: "SUCCESS",
                declined: "BUSINESS_FAILURE",
                providerFailure: "TECHNICAL_FAILURE");
        public Fin<string> RequireAuthorizationCode() =>
            result.Switch(
                authorized: static authorized => FinSucc(authorized.AuthorizationCode),
                declined: static declined => FinFail<string>(Error.New($"Declined: {declined.Reason}")),
                providerFailure: static failure => FinFail<string>(Error.New($"ProviderFailure {failure.Code}: {failure.Message}")));
    }
}
```

[IMPORTANT]:
- In v10, nested union case type names were simplified; bind to generated case names, not hand-authored aliases.

---
## [5][AGGREGATE_OBJECT_SHAPE]
>**Dictum:** *Aggregates own transitions; callers consume typed constructors and transition codomains.*

Aggregate state is immutable; transitions are typed and explicit.
No external mutation channels; no primitive re-validation in downstream code.

```csharp
namespace Domain.Objects;

using LanguageExt;
using LanguageExt.Common;
using static LanguageExt.Prelude;

public sealed class PurchaseOrder(
    OrderId id,
    EmailAddress customerEmail,
    MoneyAmount total,
    OrderState state
) {
    public OrderId Id { get; } = id;
    public EmailAddress CustomerEmail { get; } = customerEmail;
    public MoneyAmount Total { get; } = total;
    public OrderState State { get; } = state;
    public static Validation<Error, PurchaseOrder> Create(
        Guid idCandidate,
        string emailCandidate,
        decimal totalCandidate
    ) =>
        (ValueObjectBridge.Validate<OrderId, Guid>(idCandidate),
         ValueObjectBridge.Validate<EmailAddress, string>(emailCandidate),
         ValueObjectBridge.Validate<MoneyAmount, decimal>(totalCandidate))
        .Apply(static (id, email, total) => new PurchaseOrder(id, email, total, OrderState.Draft));
    public Fin<PurchaseOrder> Confirm() =>
        State.EnsureProgressable().Map(_ => new PurchaseOrder(Id, CustomerEmail, Total, OrderState.Confirmed));
    public Fin<PurchaseOrder> Cancel() =>
        State.EnsureProgressable().Map(_ => new PurchaseOrder(Id, CustomerEmail, Total, OrderState.Cancelled));
}
```

---
## [6][STACK_ONLY_OBJECT_BOUNDARY]
>**Dictum:** *`ref struct` belongs to parsing/workspace layers, then exits into durable canonical objects.*

`readonly ref struct` is infrastructure-local for span workflows.
Project to canonical value objects before crossing boundaries.

```csharp
namespace Domain.Objects;

using System.Text;
using LanguageExt;
using Thinktecture;

public readonly ref struct Utf8Window(ReadOnlySpan<byte> source) {
    public ReadOnlySpan<byte> Source { get; } = source;
    public int Length => Source.Length;
    public Fin<Utf8Window> Slice(int start, int length) =>
        (start >= 0, length >= 0, (start + length) <= Length) switch {
            (true, true, true) => new Utf8Window(Source.Slice(start, length)),
            _ => FinFail<Utf8Window>(LanguageExt.Common.Error.New("Invalid Utf8Window slice."))
        };
}
public static class Utf8Bridge {
    public static Fin<TValueObject> ParseUtf8<TValueObject>(ReadOnlySpan<byte> utf8)
        where TValueObject : IValueObjectFactory<TValueObject, string, ValidationError> =>
        Encoding.UTF8.GetString(utf8) switch {
            string text => ValueObjectBridge.Parse<TValueObject, string>(text)
        };
}
```

---
## [7][BOUNDARY_ADAPTER_CANONICAL]
>**Dictum:** *Boundary payloads map once into canonical objects through applicative validation.*

```csharp
namespace Domain.Objects;

using LanguageExt;
using LanguageExt.Common;

public readonly record struct CreateOrderRequest(Guid Id, string Email, decimal Total, string State);
public readonly record struct CreateOrderCommand(OrderId Id, EmailAddress Email, MoneyAmount Total, OrderState State);
public static class CreateOrderMapper {
    public static Validation<Error, CreateOrderCommand> ToDomain(CreateOrderRequest dto) =>
        (ValueObjectBridge.Validate<OrderId, Guid>(dto.Id),
         ValueObjectBridge.Validate<EmailAddress, string>(dto.Email),
         ValueObjectBridge.Validate<MoneyAmount, decimal>(dto.Total),
         SmartEnumBridge.Validate<OrderState, string>(dto.State))
        .Apply(static (id, email, total, state) => new CreateOrderCommand(id, email, total, state));
}
```

---
## [8][RULES]
>**Dictum:** *Rules are optimization constraints for correctness and density.*

- One concept, one canonical object form.
- Construction paths are typed (`Fin`/`Validation`) and exception-free for expected invalid input.
- Behavioral closed sets use SmartEnum; variant payload sets use Union.
- Domain primitives are strong types; raw primitives terminate at boundary adapters.
- Generated exhaustive `Switch`/`Map` is preferred over ad-hoc branching.
- Closure-free overloads + `static` lambdas are default on hot paths.
- `ref struct` remains infrastructure-local.

---
## [9][QUICK_REFERENCE]

| [INDEX] | [SYMPTOM]                                     | [PRIMARY_FIX]                                      | [SECTION] |
| :-----: | --------------------------------------------- | -------------------------------------------------- | --------- |
|   [1]   | Primitive obsession in signatures             | Value object canonicalization + generic bridge     | [2]       |
|   [2]   | Enum/switch sprawl                            | SmartEnum + exhaustive generated behavior          | [3]       |
|   [3]   | Variant ambiguity via nullable fields         | Union + exhaustive `Switch`/`Map`                  | [4]       |
|   [4]   | Mutable aggregate drift                       | Immutable aggregate transitions returning `Fin<T>` | [5]       |
|   [5]   | Stack-only type leaking into domain contracts | `ref struct` isolation + conversion bridge         | [6]       |
|   [6]   | Boundary payload directly used in domain      | Applicative adapter mapping to command             | [7]       |
|   [7]   | Dual object representations per concept       | Collapse to one canonical shape                    | [1], [8]  |
