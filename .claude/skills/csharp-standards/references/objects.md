# [H1][OBJECTS]
>**Dictum:** *Object topology is a proof surface; one canonical shape per concept.*

<br>

Object-focused reference for C# 14 / .NET 10 with LanguageExt v5 and Thinktecture Runtime Extensions v10.
This document standardizes object-family selection, invariant construction, variant modeling, and aggregate transitions.
Effect orchestration lives in `effects.md`; polymorphic compression lives in `composition.md`; low-level tuning lives in `performance.md`.

---
## [1][TOPOLOGY_SELECTION]
>**Dictum:** *Choose by semantic contract, then commit to one canonical form.*

<br>

| [INDEX] | [DOMAIN_SHAPE]                                   | [CANONICAL_FORM]          |
| :-----: | ------------------------------------------------ | ------------------------- |
|   [1]   | **Constrained scalar (Email, Amount, Id)**       | `[ValueObject<T>]`        |
|   [2]   | **Closed behavioral set (status/type/strategy)** | `[SmartEnum<T>]`          |
|   [3]   | **Closed variant payload space**                 | `[Union]`                 |
|   [4]   | **Identity-bearing lifecycle object**            | `sealed record` aggregate |
|   [5]   | **Stack-confined parser/workspace**              | `readonly ref struct`     |

[IMPORTANT]:
- [1] Use generated `TryCreate` as the external ingress gate.
- [2] Use generated exhaustive `Switch`/`Map`; keep behavior co-located with the enum.
- [3] Use generated exhaustive `Switch`/`Map`; avoid nullable/flag choreography.
- [4] Aggregate transitions return typed codomains (`Fin<T>` / `Validation<Error,T>`) via `with`-expressions.
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
Use `TryCreate` for untrusted input and project to `Fin<T>` / `Validation<Error,T>` via DomainBridge.
Boundary adapters register integration once: `UseThinktectureValueConverters()`, `ThinktectureModelBinderProvider`, and `ThinktectureJsonConverterFactory`.

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

[CRITICAL]:
- `Create` is for trusted internal construction; `TryCreate` is the boundary gate.
- Never expose primitives in public domain signatures once a value object exists.

---
## [3][DOMAIN_BRIDGE]
>**Dictum:** *One generic bridge projects Thinktecture construction into `Fin<T>`; derive `Validation` at call site.*

<br>

Single bridge unifies value object and smart enum parsing into the `Fin<T>` error channel.
Callers needing `Validation<Error,T>` compose via `.ToValidation()` -- no separate `Validate` wrapper.

```csharp
namespace Domain.Objects;

using LanguageExt; using LanguageExt.Common; using Thinktecture;
using static LanguageExt.Prelude;

public static class DomainBridge {
    // --- [PARSE_VALUE_OBJECT] ------------------------------------------------
    public static Fin<TValueObject> ParseValueObject<TValueObject, TKey>(TKey candidate)
        where TValueObject : IValueObjectFactory<TValueObject, TKey, ValidationError> =>
        TValueObject.TryCreate(candidate, out TValueObject value, out ValidationError? validationError) switch {
            true => Fin.Succ(value),
            false => Fin.Fail<TValueObject>(
                Error.New(validationError?.Message ?? $"{typeof(TValueObject).Name} validation failed for '{candidate}'."))
        };
    // --- [PARSE_SMART_ENUM] --------------------------------------------------
    public static Fin<TEnum> ParseSmartEnum<TEnum, TKey>(TKey candidate)
        where TEnum : class, ISmartEnum<TEnum, TKey> =>
        TEnum.TryGet(candidate, out TEnum? enumValue) switch {
            true when enumValue is not null => Fin.Succ(enumValue),
            _ => Fin.Fail<TEnum>(Error.New($"Unknown {typeof(TEnum).Name} '{candidate}'."))
        };
}
```

[CRITICAL]:
- `ParseValueObject` for `[ValueObject<T>]` types; `ParseSmartEnum` for `[SmartEnum<T>]` types.
- Never create separate `Validate` wrappers -- compose `.ToValidation()` at call site.

---
## [4][SMART_ENUM_CANONICAL]
>**Dictum:** *Closed behavioral sets belong in SmartEnums, not primitive enums plus detached switch maps.*

<br>

Thinktecture SmartEnums provide typed lookup (`Get`/`TryGet`), validation, and exhaustive `Switch`/`Map`.
Prefer context overloads + `static` lambdas on hot paths to avoid closure allocation.

```csharp
namespace Domain.Objects;

using LanguageExt; using LanguageExt.Common; using Thinktecture;
using static LanguageExt.Prelude;

// --- [ENUM] ------------------------------------------------------------------
[SmartEnum<string>]
public sealed partial class OrderState {
    public static readonly OrderState Draft = new("DRAFT");
    public static readonly OrderState Confirmed = new("CONFIRMED");
    public static readonly OrderState Cancelled = new("CANCELLED");
    static partial void ValidateConstructorArguments(ref string key) =>
        key = key.Trim().ToUpperInvariant();
}

// --- [EXTENSIONS] ------------------------------------------------------------

public static class OrderStateRole {
    extension(OrderState state) {
        public bool IsTerminal =>
            state.Map(
                draft: false,
                confirmed: false,
                cancelled: true);
        public Fin<OrderState> EnsureProgressable() =>
            // state threaded as parameter to enable static lambda (zero closure allocation)
            state.Switch(state,
                draft: static current => Fin.Succ(current),
                confirmed: static current => Fin.Succ(current),
                cancelled: static _ => Fin.Fail<OrderState>(Error.New("Cancelled state is terminal.")));
    }
}
```

[CRITICAL]:
- Never model SmartEnum behavior in external switch tables.
- Boundary parse uses `TryGet` via DomainBridge; reserve throwing `Get` for trusted paths.

---
## [5][UNION_CANONICAL]
>**Dictum:** *Variant payloads require unions, not nullable field choreography.*

<br>

Use union modeling for outcomes where each case owns distinct payload semantics.
Generated `Switch`/`Map` methods enforce exhaustiveness at compile time.

```csharp
namespace Domain.Objects;

using LanguageExt; using LanguageExt.Common; using Thinktecture;
using static LanguageExt.Prelude;

// --- [UNION] -----------------------------------------------------------------
// [Union] source-generates private constructor -- external derivation is prevented by codegen.
[Union]
public abstract partial record PaymentResult {
    public sealed record Authorized(string AuthorizationCode) : PaymentResult;
    public sealed record Declined(string Reason) : PaymentResult;
    public sealed record ProviderFailure(string Code, string Message) : PaymentResult;
}

// --- [EXTENSIONS] ------------------------------------------------------------

public static class PaymentResultRole {
    extension(PaymentResult result) {
        public string Category =>
            result.Map(
                authorized: "SUCCESS",
                declined: "BUSINESS_FAILURE",
                providerFailure: "TECHNICAL_FAILURE");
        public Fin<string> RequireAuthorizationCode() =>
            result.Switch(
                authorized: static authorized => Fin.Succ(authorized.AuthorizationCode),
                declined: static declined => Fin.Fail<string>(Error.New($"Declined: {declined.Reason}")),
                providerFailure: static failure => Fin.Fail<string>(
                    Error.New($"ProviderFailure {failure.Code}: {failure.Message}")));
    }
}
```

Thinktecture `Switch`/`Map` returns `Fin<T>` -- compose directly into LanguageExt `Bind`/`Map` chains or `Eff` pipelines.<br>
Every case branch **must** return the same `Fin<T>` instantiation (identical `T` type parameter) so the overall expression unifies to a single `Fin<T>`.<br>
Mixing return types across branches (e.g., `Fin<string>` in one arm and `Fin<Unit>` in another) prevents composition and produces compilation errors.

```csharp
// --- [COMPOSITION_BRIDGE] -- Thinktecture dispatch into Eff pipeline ---------

public sealed record PaymentRuntime(IPaymentGateway Gateway, IAuditLog Audit);

public static class PaymentWorkflow {
    public static Eff<PaymentRuntime, ReceiptId> ProcessPayment(PaymentResult result) =>
        result.RequireAuthorizationCode()                          // Fin<string> via Switch
            .ToEff<PaymentRuntime>()                               // lift into Eff<RT, string>
            .Bind((string code) =>
                Eff<PaymentRuntime, IPaymentGateway>.Asks(static (PaymentRuntime rt) => rt.Gateway)
                    .Bind((IPaymentGateway gw) => gw.Issue(authorizationCode: code)))
            .Bind((ReceiptId receipt) =>
                Eff<PaymentRuntime, IAuditLog>.Asks(static (PaymentRuntime rt) => rt.Audit)
                    .Bind((IAuditLog log) => log.Record(receiptId: receipt))
                    .Map((_) => receipt));
}
```

Ad-hoc `Union<T1,...>` models boundary adapter DTOs where variant payloads arrive as raw JSON.
Use `[ObjectFactory<T>]` to project external representations into the union.

```csharp
// --- [AD_HOC_UNION] -- boundary adapter with ObjectFactory projection --------

[Union<PaymentResult.Authorized, PaymentResult.Declined, PaymentResult.ProviderFailure>]
[ObjectFactory<string>(UseForSerialization = SerializationFrameworks.SystemTextJson)]
public readonly partial struct PaymentOutcome {
    // generated: Value property, Switch/Map exhaustive dispatch, implicit conversions
    // ObjectFactory<string> generates JsonConverter for boundary serialization
}

// --- [BOUNDARY_ADAPTER] -- ad-hoc union projects into domain union -----------

public static class PaymentAdapter {
    public static PaymentResult ToDomain(PaymentOutcome outcome) =>
        outcome.Map(
            authorized: static (PaymentResult.Authorized a) => (PaymentResult)a,
            declined: static (PaymentResult.Declined d) => (PaymentResult)d,
            providerFailure: static (PaymentResult.ProviderFailure f) => (PaymentResult)f);
}
```

[IMPORTANT]:
- In v10, nested union case type names were simplified; bind to generated case names, not hand-authored aliases.
- Regular unions are best serialized with polymorphic metadata (`JsonDerivedType`); ad-hoc unions use `[ObjectFactory<T>]` projection.
- `Fin<T>.ToEff<RT>()` lifts Thinktecture dispatch results into effectful pipelines; `Bind`/`Map` compose downstream.
- Ad-hoc `Union<T1,...>` is for boundary adapter scenarios; regular `[Union]` is for domain variant hierarchies.

---
## [6][AGGREGATE_OBJECT_SHAPE]
>**Dictum:** *Aggregates own transitions; callers consume typed constructors and `with`-expression codomains.*

Aggregate state is immutable; transitions use `with`-expression mutation and return typed codomains (`Fin<T>` / `Validation<Error,T>`).
No external mutation channels; no primitive re-validation in downstream code.

```csharp
namespace Domain.Objects;

using LanguageExt; using LanguageExt.Common;
using static LanguageExt.Prelude;

public sealed record PurchaseOrder(
    OrderId Id,
    EmailAddress CustomerEmail,
    MoneyAmount Total,
    OrderState State
) {
    public static Validation<Error, PurchaseOrder> Create(
        Guid idCandidate,
        string emailCandidate,
        decimal totalCandidate
    ) =>
        (DomainBridge.ParseValueObject<OrderId, Guid>(idCandidate).ToValidation(),
         DomainBridge.ParseValueObject<EmailAddress, string>(emailCandidate).ToValidation(),
         DomainBridge.ParseValueObject<MoneyAmount, decimal>(totalCandidate).ToValidation())
        .Apply(static (id, email, total) =>
            new PurchaseOrder(id, email, total, State: OrderState.Draft));
    public Fin<PurchaseOrder> Confirm() =>
        State.EnsureProgressable().Map(_ => this with { State = OrderState.Confirmed });
    public Fin<PurchaseOrder> Cancel() =>
        State.EnsureProgressable().Map(_ => this with { State = OrderState.Cancelled });
}
```

[CRITICAL]:
- Transitions produce new state via `with`-expressions -- never reconstruct manually.
- Applicative tuple gathers all validation errors; `Apply` runs only when all succeed.

---
## [7][STACK_ONLY_OBJECT_BOUNDARY]
>**Dictum:** *`ref struct` belongs to parsing/workspace layers, then exits into durable canonical objects.*

`readonly ref struct` is infrastructure-local for span workflows.
Project to canonical value objects before crossing boundaries.
Full span-based parsing patterns live in `performance.md`.

```csharp
namespace Domain.Objects;

using LanguageExt; using static LanguageExt.Prelude;

public readonly ref struct Utf8Window(ReadOnlySpan<byte> source) {
    public ReadOnlySpan<byte> Source { get; } = source;
    public int Length => Source.Length;
    public Fin<Utf8Window> Slice(int start, int length) =>
        (start >= 0 && length >= 0 && (start + length) <= Length) switch {
            true => new Utf8Window(Source.Slice(start, length)),
            false => Fin.Fail<Utf8Window>(LanguageExt.Common.Error.New("Invalid Utf8Window slice."))
        };
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
- Context overloads + `static` lambdas are default on hot paths.
- `ref struct` remains infrastructure-local.
- `with`-expressions are the sole mechanism for record state transitions.

---
## [9][QUICK_REFERENCE]

| [INDEX] | [SYMPTOM]                                     | [PRIMARY_FIX]                                 | [SECTION] |
| :-----: | :-------------------------------------------- | --------------------------------------------- | :-------- |
|   [1]   | Primitive obsession in signatures             | Value object canonicalization + DomainBridge  | [2], [3]  |
|   [2]   | Enum/switch sprawl                            | SmartEnum + exhaustive generated behavior     | [4]       |
|   [3]   | Variant ambiguity via nullable fields         | Union + exhaustive `Switch`/`Map`             | [5]       |
|   [4]   | Mutable aggregate drift                       | Sealed record + `with`-expression transitions | [6]       |
|   [5]   | Stack-only type leaking into domain contracts | `ref struct` isolation + conversion bridge    | [7]       |
|   [6]   | Dual object representations per concept       | Collapse to one canonical shape               | [1], [8]  |
