# [H1][EFFECTS]
>**Dictum:** *Effects are typed; failures are values; pipelines replace procedures.*

<br>

Effect types in LanguageExt v5 make the codomain honest: `Fin<T>` for sync failures, `Validation<Error,T>` for parallel accumulation, `Eff<RT,T>` for environmental DI pipelines, `IO<A>` for boundary side effects, and `K<F,A>` for computation-generic algorithms. All snippets assume `using static LanguageExt.Prelude;` -- Prelude functions (`Some`, `None`, `unit`, `pure`, `guard`, `liftIO`, `Ref`, `Atom`, `ms`, `sec`) are unqualified throughout.

---
## [1][FIN]
>**Dictum:** *Fin is the honest codomain for synchronous fallible operations.*

<br>

`Fin<T>` is isomorphic to `Either<Error,T>`. Construct via `FinSucc(value)` / `FinFail<T>(error)` (Prelude). Chain via `Bind`/`Map`. Convert to `Validation` via `.ToValidation()` or to `Eff` via `.ToEff()`. Reserve `Match` for boundaries only.

```csharp
namespace Domain.Effects;

public static class TotalParsing {
    public static Fin<decimal> SafeDivide(decimal numerator, decimal denominator) =>
        denominator switch {
            0m => FinFail<decimal>(Error.New(message: "Division by zero")),
            _ => FinSucc(numerator / denominator)
        };
}
public static class TotalDictionary {
    extension<TKey, TValue>(IReadOnlyDictionary<TKey, TValue> dict) {
        public Option<TValue> Find(TKey key) =>
            dict.TryGetValue(key, out TValue? value) switch {
                true => Some(value!),
                false => None
            };
    }
}
```

[CRITICAL]: `Fin<T>` replaces every `try`/`catch` pattern. Switch expressions on the discriminant replace `if`/`else`. `Match` is a boundary tool -- prefer `Bind`/`Map` in pipelines. C# pattern matching works directly on `Fin` variants:

```csharp
Fin<decimal> result = TotalParsing.SafeDivide(numerator: 100m, denominator: 3m);
string output = result switch {
    Fin.Succ<decimal>(decimal value) => value.ToString(provider: CultureInfo.InvariantCulture),
    Fin.Fail<decimal>(Error error) => error.Message,
};
```

See `types.md` [3] for `Fin` factories in smart constructors.

---
## [2][EFF_PIPELINE]
>**Dictum:** *Eff pipelines orchestrate DI environmentally; zero procedural branches.*

<br>

`Eff<RT,T>` combines monadic sequencing with environmental dependency injection via `Has<RT,Trait>`. Trait interfaces declare capabilities. LINQ query syntax (`from..in..select`) provides comprehension. `Bind` chains effects; `MapFail` transforms errors.

```csharp
namespace Domain.Effects;

public interface IGatewayProvider {
    Eff<string> TransmitPayload(TransactionState.Pending pendingState);
}
public interface HasGatewayProvider<RT> : Has<RT, IGatewayProvider>
    where RT : HasGatewayProvider<RT>;

public static class OrchestrationPipeline {
    public static Eff<RT, TransactionState> ExecuteWorkflow<RT>(
        InitializationRequest request) where RT : HasGatewayProvider<RT> =>
        TransactionValidator.ValidateRequest(request: request)
            .ToEither()
            .MapLeft(f: (Seq<Error> errors) => Error.New(message: "Validation fault", inner: errors.Head))
            .ToEff()
            .Bind(f: (TransactionState.Pending pending) =>
                TransmitToGateway<RT>(pendingState: pending)
                    .Map(f: (string token) => MapToAuthorized(pendingState: pending, authorizationToken: token)))
            .MapFail(f: (Error err) => TransformFault(source: err));
    private static Eff<RT, string> TransmitToGateway<RT>(
        TransactionState.Pending pendingState) where RT : HasGatewayProvider<RT> =>
        default(RT).GatewayProvider.TransmitPayload(pendingState: pendingState);
    private static TransactionState MapToAuthorized(
        TransactionState.Pending pendingState, string authorizationToken) =>
        new TransactionState.Authorized(Id: pendingState.Id, AuthorizationToken: authorizationToken);
    private static Error TransformFault(Error source) =>
        Error.New(message: "Workflow terminal failure.", inner: source);
}
```

[IMPORTANT]: `Has<RT,Trait>` is the DI seam -- no constructor injection. In v5, access the trait via `default(RT).PropertyName` (the `Has` interface defines the property). `MapFail` annotates errors without losing the original cause. See `types.md` [4] for the `TransactionState` DU used here.

**LINQ Comprehension with guard** -- the `from...in...select` syntax provides multi-step Eff composition; `guard` short-circuits with a typed error when the condition is false:

```csharp
public static Eff<RT, OrderConfirmation> ProcessOrder<RT>(
    OrderRequest request) where RT : Has<RT, IOrderService> =>
    from _         in guard(request.Items.Count > 0, Error.New(message: "Order must have items"))
    from __        in guardnot(request.IsExpired, Error.New(message: "Order has expired"))
    from validated in ValidateOrder(request: request)
    from enriched  in EnrichWithPricing(order: validated)
    from persisted in PersistOrder(order: enriched)
    from ___       in NotifyCustomer(order: persisted)
    select new OrderConfirmation(OrderId: persisted.Id);
```

**Boundary Execution** -- collapse `Eff` at HTTP boundaries via double-`Run` + `Match`. The first `.Run(runtime)` resolves the Reader environment (unwraps `ReaderT<RT, IO, A>` to `IO<A>`); the second `.Run()` executes the IO effect:

```csharp
Fin<OrderConfirmation> result = ProcessOrder(request: request).Run(runtime).Run();
return result.Match(
    Succ: (OrderConfirmation confirmation) => Ok(value: confirmation),
    Fail: (Error error) => Problem(detail: error.Message));
```

---
## [3][ERROR_RECOVERY]
>**Dictum:** *Errors recover declaratively; catch composes with choice.*

<br>

`@catch` enables pattern-matched error recovery in pipelines. The `|` operator (Alternative/Choice trait) provides declarative fallback chains. Both compose without `Match`:

```csharp
// @catch -- recover from specific errors in Eff pipelines
Eff<RT, HttpResponse> resilientCall = CallApi(request: request)
    | @catch(Errors.TimedOut, (Error _) => RetryWithFallback(request: request))
    | @catch(Errors.NotFound, (Error error) => Eff<RT, HttpResponse>.Pure(DefaultResponse));
// | Alternative -- try first, fall through to next on failure
Eff<RT, Config> loadConfig =
    LoadFromFile(path: "config.json")
    | LoadFromEnvironment()
    | Pure(Config.Default);
// Works across Fin, Option, Either, Eff, IO
Option<User> user = FindByEmail(email: email) | FindByUsername(username: username) | None;
```

[IMPORTANT]: `@catch` takes an error value or predicate for selective recovery. The `|` operator is the Alternative/Choice combinator -- it tries the left operand and falls back to the right on failure. Compose both for layered resilience without procedural branching.

---
## [4][VALIDATION]
>**Dictum:** *Validation collects all errors; short-circuit is not acceptable for user-facing boundaries.*

<br>

`Validation<Error,T>` is applicative: independent checks run in parallel and accumulate all failures. `Error` implements `Monoid` in v5, so `Validation<Error,T>` is valid -- errors combine via `Error.Combine`. Tuple `.Apply()` syntax combines validated fields. `.ToValidation()` converts `Fin` to the applicative context.

```csharp
namespace Domain.Effects;

public static class TransactionValidator {
    public static Validation<Error, TransactionState.Pending> ValidateRequest(
        InitializationRequest request) =>
        (
            DomainIdentity.Create(candidate: request.CandidateId).ToValidation(),
            TransactionAmount.Create(candidate: request.CandidateAmount).ToValidation(),
            CurrencyStandard.Create(candidate: request.ISO4217CurrencyCode).ToValidation()
        ).Apply(
            f: (DomainIdentity id, TransactionAmount amount, CurrencyStandard currency) =>
                new TransactionState.Pending(
                    Id: id,
                    Amount: amount,
                    InitiatedAt: DateTimeOffset.UtcNow));
}
```

[CRITICAL]: Each `.ToValidation()` call lifts `Fin<T>` into the applicative. `.Apply()` on the tuple runs all three validations independently. Zero short-circuit means the user sees every error at once. See `types.md` [1] for `DomainIdentity.Create` and `TransactionAmount.Create`.

---
## [5][IO_FREE_MONAD]
>**Dictum:** *IO separates description from execution; interpretation happens at the boundary.*

<br>

`IO<A>` has four internal variants: `IOPure<A>`, `IOFail<A>`, `IOSync<A>`, `IOAsync<A>`. `IO.lift()` wraps side-effecting lambdas. LINQ comprehension sequences effects. `Run()` / `RunAsync()` interprets at the program boundary.

```csharp
namespace Domain.Effects;

public static class ConsoleIO {
    public static IO<string> ReadLine => IO.lift(() => Console.ReadLine()!);
    public static IO<Unit> WriteLine(string message) => IO.lift(() => { Console.WriteLine(message); return unit; });
    public static IO<Unit> Program =>
        from _ in WriteLine(message: "Enter name:")
        from name in ReadLine
        from __ in WriteLine(message: $"Hello, {name}")
        select unit;
}
// Boundary: Program.Run() or await Program.RunAsync()
```

[IMPORTANT]: `IO<A>` is a free monad -- constructing it performs no effects. `Run` / `RunAsync` collapses the description into execution. Use `IO` at system boundaries; use `Eff<RT,T>` for pipelines requiring DI.

---
## [6][MONAD_TRANSFORMERS]
>**Dictum:** *Transformers compose effect stacks; each layer adds one concern.*

<br>

`OptionT<M,A>` threads optionality through any monad. `EitherT<L,M,A>` threads error handling. `StateT<S,M,A>` threads state. Compose by nesting: `StateT<GameState, IO, Unit>` gives stateful IO.

```csharp
namespace Domain.Effects;

public static class GameLoop {
    public static StateT<GameState, IO, Unit> Step =>
        from state in StateT<GameState, IO>.get
        from _ in liftIO(ConsoleIO.WriteLine(message: $"Score: {state.Score}"))
        from input in liftIO(ConsoleIO.ReadLine)
        from __ in StateT<GameState, IO>.modify((GameState s) => s with { Score = s.Score + input.Length })
        select unit;
}
public readonly record struct GameState(int Score);
```

---
## [7][STM_CONCURRENCY]
>**Dictum:** *Atoms are lock-free; Refs are transactional; atomic blocks compose.*

<br>

`Atom<T>` provides lock-free atomic state with optional validators that reject invalid transitions. `Ref<T>` participates in STM transactions. `atomic()` blocks compose multi-ref operations that commit or rollback atomically. `Swap` applies pure transitions.

```csharp
namespace Domain.Effects;

public static class AccountTransfers {
    // Atom with validator -- rejects transitions that produce negative balance
    public static Atom<HashMap<string, decimal>> Balances => Atom(
        HashMap(("alice", 1000m), ("bob", 500m)),
        (HashMap<string, decimal> state) => state.ForAll(
            (string _, decimal value) => value >= 0m));
    public static Ref<Account> AccountA => Ref(new Account(Balance: 1000m));
    public static Ref<Account> AccountB => Ref(new Account(Balance: 500m));
    public static Unit Transfer(decimal amount) =>
        atomic(() => {
            AccountA.Swap((Account a) => a with { Balance = a.Balance - amount });
            AccountB.Swap((Account b) => b with { Balance = b.Balance + amount });
        });
}
public readonly record struct Account(decimal Balance);
```

[IMPORTANT]: `Atom` for single-value concurrent state -- the optional validator function rejects `Swap` calls that would produce invalid state. `Ref` + `atomic` for multi-ref transactional consistency. STM also provides `snapshot()` (snapshot isolation) and `serial()` (serializable isolation) as alternatives to `atomic()`. `Swap` takes a pure `A -> A` function -- no mutation, no locks.

---
## [8][SCHEDULE]
>**Dictum:** *Retry policies are algebraic; compose via `|` union and `&` intersect operators.*

<br>

`Schedule` combinators build retry/repeat policies from algebraic primitives. The `|` operator composes (union -- take both). The `&` operator intersects (take shorter). `.Retry()` applies a schedule to any `Eff`.

```csharp
namespace Domain.Effects;

public static class ResiliencePolicy {
    // exponential backoff + jitter + cap at 5 retries + max 30s delay
    public static Schedule RetryPolicy =>
        Schedule.exponential(baseDelay: 100 * ms)
        | Schedule.jitter(factor: 0.1)
        | Schedule.recurs(times: 5)
        | Schedule.maxDelay(delay: 30 * sec);
    // spaced: fixed delay; linear: linear backoff; fibonacci: fib-based
    public static Schedule FixedPolicy => Schedule.spaced(spacing: 1 * sec) | Schedule.recurs(times: 3);
    public static Schedule LinearPolicy => Schedule.linear(seed: 100 * ms, factor: 2.0);
    // & intersection: bounded by BOTH time AND count
    public static Schedule BoundedPolicy =>
        Schedule.exponential(baseDelay: 200 * ms) & Schedule.upto(duration: 60 * sec);
    public static Eff<AppRuntime, HttpResponse> ResilientCall(
        HttpRequest request) =>
        CallExternalApi(request: request).Retry(schedule: RetryPolicy);
}
```

---
## [9][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] `Fin<T>` for synchronous failures -- `Bind`/`Map` chain, `Match` at boundary.
- [ALWAYS] `Validation<Error,T>` for parallel field validation -- applicative `.Apply()` tuple.
- [ALWAYS] `Eff<RT,T>` for effectful pipelines -- `Has<RT,Trait>` environmental DI.
- [ALWAYS] `IO<A>` for boundary side effects -- `Run`/`RunAsync` interpretation.
- [ALWAYS] `K<F,A>` for computation-generic algorithms -- see `composition.md` [4].
- [ALWAYS] `@catch` for selective error recovery -- pattern-matched catch without `Match`.
- [ALWAYS] `|` Alternative for fallback chains -- declarative try-then-fallback composition.
- [NEVER] `try`/`catch`/`throw` in domain code -- effects are typed.
- [NEVER] Early `Match` in mid-pipeline -- prefer `Map`/`Bind`/`BiMap`.
- [IMPORTANT] Encode cancellation boundaries explicitly via `Eff` -- delimit uninterruptible regions rather than scattering `CancellationToken` checks. The effect boundary owns cancellation observation, not the business logic.

---
## [10][QUICK_REFERENCE]

| [INDEX] | [PATTERN]             | [WHEN]                              | [KEY_TRAIT]                          |
| :-----: | --------------------- | ----------------------------------- | ------------------------------------ |
|   [1]   | `Fin<T>`              | Synchronous fallible operation      | `Bind`/`Map`/`Match` + switch        |
|   [2]   | `Eff<RT,T>`           | Effectful pipeline with DI          | `Has<RT,Trait>` + LINQ comprehension |
|   [3]   | `@catch`              | Selective error recovery            | Pattern-matched catch + `\|` compose |
|   [4]   | `\| Alternative`      | Declarative fallback chain          | Choice trait on Fin/Eff/Option       |
|   [5]   | `Validation<Error,T>` | Parallel multi-field validation     | Applicative `.Apply()` tuple         |
|   [6]   | `IO<A>`               | Boundary side effect description    | Pure/Fail/Sync/Async + `Run`         |
|   [7]   | `OptionT<M,A>`        | Optionality threaded through monad  | Transformer stacking                 |
|   [8]   | `Atom<T>`             | Lock-free concurrent single value   | `Swap` + optional validator          |
|   [9]   | `Ref<T>` + `atomic`   | Multi-ref transactional consistency | STM commit/rollback                  |
|  [10]   | `Schedule`            | Algebraic retry/repeat policy       | `\|` union + `&` intersect + `Retry` |
