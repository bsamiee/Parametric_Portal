# [H1][EFFECTS]
>**Dictum:** *Effects are typed; failures are values; pipelines replace procedures.*

<br>

Effect types in LanguageExt v5 make the codomain honest: `Fin<T>` for sync failures, `Validation<Error,T>` for parallel accumulation, `Eff<RT,T>` for environmental DI pipelines via `ReaderT<RT, IO, A>`, and `IO<A>` for boundary side effects. All snippets assume `using static LanguageExt.Prelude;` -- Prelude functions (`Some`, `None`, `unit`, `pure`, `guard`, `liftIO`, `Ref`, `Atom`, `ms`, `sec`) are unqualified throughout. Switch *expressions* (pattern matching) are permitted; imperative `switch` *statements* are forbidden.

---
## [1][FIN]
>**Dictum:** *Fin is the honest codomain for synchronous fallible operations.*

<br>

`Fin<T>` is isomorphic to `Either<Error,T>`. Construct via `Fin.Succ(value)` / `Fin.Fail<T>(error)` (static class). Chain via `Bind`/`Map`. Convert to `Validation` via `.ToValidation()` or to `Eff` via `.ToEff()`. Reserve `Match` for boundaries only.

```csharp
namespace Domain.Effects;

public static class TotalParsing {
    public static Fin<decimal> SafeDivide(decimal numerator, decimal denominator) =>
        denominator switch {
            0m => Fin.Fail<decimal>(Error.New(message: "Division by zero")),
            _ => Fin.Succ(numerator / denominator)
        };
}
```

[CRITICAL]: `Fin<T>` replaces every `try`/`catch` pattern. Switch expressions on the discriminant replace imperative branching. `Match` is a boundary tool -- prefer `Bind`/`Map` in pipelines:

```csharp
Fin<decimal> result = TotalParsing.SafeDivide(numerator: 100m, denominator: 3m);
string output = result.Match(
    Succ: (decimal value) => value.ToString(),
    Fail: (Error error) => error.Message);
```

See `types.md` [3] for `Fin` factories in smart constructors.

---
## [2][EFF_PIPELINE]
>**Dictum:** *Eff pipelines orchestrate DI environmentally; zero procedural branches.*

<br>

`Eff<RT,T>` wraps `ReaderT<RT, IO, A>` -- a reader-transformer over `IO`. The runtime `RT` is a plain record providing dependencies via properties. Access services via `Eff<RT, T>.Asks(rt => rt.Property)` or LINQ `from svc in asks<RT, T>(rt => rt.Property)`. No `Has<RT, Trait>` interfaces -- v5 uses direct property access on the runtime record.

```csharp
namespace Domain.Effects;

using NodaTime;

// --- [CONTRACTS] -------------------------------------------------------------

public interface IGatewayProvider {
    Eff<string> TransmitPayload(TransactionState.Pending pendingState);
}
public interface IOrderService {
    Eff<OrderRequest> ValidateOrder(OrderRequest request);
    Eff<OrderRequest> EnrichWithPricing(OrderRequest order);
    Eff<OrderRequest> PersistOrder(OrderRequest order);
    Eff<Unit> NotifyCustomer(OrderRequest order);
}
public sealed record AppRuntime(IGatewayProvider Gateway, IClock Clock, IOrderService OrderService);

// --- [PIPELINE] --------------------------------------------------------------

public static class OrchestrationPipeline {
    public static Eff<AppRuntime, TransactionState> ExecuteWorkflow(
        InitializationRequest request) =>
        TransactionValidator.ValidateRequest(request: request)
            .ToEither()
            .MapLeft(f: (Seq<Error> errors) => Error.New(message: "Validation fault", inner: errors.Head))
            .ToEff()
            .Bind(f: (TransactionState.Pending pending) =>
                Eff<AppRuntime, IGatewayProvider>.Asks(static (AppRuntime rt) => rt.Gateway)
                    .Bind(f: (IGatewayProvider gw) => gw.TransmitPayload(pendingState: pending))
                    .Map(f: (string token) =>
                        (TransactionState)new TransactionState.Authorized(
                            Id: pending.Id, AuthorizationToken: token)))
            .MapFail(f: (Error err) => Error.New(message: "Workflow terminal failure.", inner: err));
}
```

[IMPORTANT]: Runtime `RT` is a plain `sealed record` -- no interface indirection. `Eff<RT, T>.Asks` lifts a property accessor into the effect. `MapFail` annotates errors without losing the original cause. See `types.md` [4] for the `TransactionState` DU used here.

**LINQ Comprehension with guard** -- `from...in...select` syntax provides multi-step Eff composition; `guard` short-circuits with a typed error when the condition is false:

```csharp
public static Eff<AppRuntime, OrderConfirmation> ProcessOrder(
    OrderRequest request) =>
    from _         in guard(request.Items.Count > 0, Error.New(message: "Order must have items"))
    from __        in guardnot(request.IsExpired, Error.New(message: "Order has expired"))
    from svc       in Eff<AppRuntime, IOrderService>.Asks(static (AppRuntime rt) => rt.OrderService)
    from validated in svc.ValidateOrder(request: request)
    from enriched  in svc.EnrichWithPricing(order: validated)
    from persisted in svc.PersistOrder(order: enriched)
    from ___       in svc.NotifyCustomer(order: persisted)
    select new OrderConfirmation(OrderId: persisted.Id);
```

**Boundary Execution** -- collapse `Eff` at HTTP boundaries via double-`Run` + `Match`. The first `.Run(runtime)` resolves the `ReaderT` environment yielding `IO<A>`; the second `.Run()` executes the `IO` effect yielding `Fin<A>`:

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
namespace Domain.Effects;

// --- [ERRORS] ----------------------------------------------------------------

public static class Errors {
    public static readonly Error TimedOut = Error.New(message: "Request timed out");
    public static readonly Error NotFound = Error.New(message: "Resource not found");
}

// --- [CATCH] -----------------------------------------------------------------

// @catch -- predicate overload: recover from specific errors in Eff pipelines
Eff<AppRuntime, HttpResponse> resilientCall = CallApi(request: request)
    | @catch((Error err) => err == Errors.TimedOut, RetryWithFallback(request: request))
    | @catch((Error err) => err == Errors.NotFound,
        Eff<AppRuntime, HttpResponse>.Pure(new HttpResponse(Status: 404)));

// --- [ALTERNATIVE] -----------------------------------------------------------

// | Alternative -- try first, fall through to next on failure
Eff<AppRuntime, Config> loadConfig =
    LoadFromFile(path: "config.json")
    | LoadFromEnvironment()
    | Pure(Config.Default);
// Works across Fin, Option, Either, Eff, IO
Option<User> user = FindByEmail(email: email) | FindByUsername(username: username) | None;
```

[IMPORTANT]: `@catch` takes a predicate `Func<Error, bool>` for selective recovery paired with the fallback `Eff`. The `|` operator is the Alternative/Choice combinator -- it tries the left operand and falls back to the right on failure. Compose both for layered resilience without procedural branching.

---
## [4][VALIDATION]
>**Dictum:** *Validation collects all errors; short-circuit is not acceptable for user-facing boundaries.*

<br>

`Validation<Error,T>` is applicative: independent checks run in parallel and accumulate all failures. `Error` implements `Monoid` in v5, so `Validation<Error,T>` is valid -- errors combine via `Error.Combine`. Tuple `.Apply()` syntax combines validated fields. `.ToValidation()` converts `Fin` to the applicative context.

```csharp
namespace Domain.Effects;

using NodaTime;

public static class TransactionValidator {
    public static Eff<AppRuntime, Validation<Error, TransactionState.Pending>> ValidateRequest(
        InitializationRequest request) =>
        Eff<AppRuntime, IClock>.Asks(static (AppRuntime rt) => rt.Clock)
            .Map(clock => (
                DomainIdentity.Create(candidate: request.CandidateId).ToValidation(),
                TransactionAmount.Create(candidate: request.CandidateAmount).ToValidation()
            ).Apply(
                f: (DomainIdentity id, TransactionAmount amount) =>
                    new TransactionState.Pending(
                        Id: id,
                        Amount: amount,
                        InitiatedAt: clock.GetCurrentInstant())));
}
```

[CRITICAL]: Each `.ToValidation()` call lifts `Fin<T>` into the applicative. `.Apply()` on the tuple runs all validations independently. Zero short-circuit means the user sees every error at once. See `types.md` [1] for `DomainIdentity.Create` and `TransactionAmount.Create`. `IClock` is resolved from `AppRuntime` via `Eff.Asks` -- never passed as a direct parameter; no `DateTimeOffset.UtcNow` in domain code.

---
## [5][IO_FREE_MONAD]
>**Dictum:** *IO separates description from execution; interpretation happens at the boundary.*

<br>

`IO<A>` is a free-monad DSL -- constructing it describes effects without executing them. `IO.lift()` wraps synchronous lambdas; `IO.liftAsync()` wraps async. `Run()` / `RunAsync()` interpret the description at the boundary. No four-variant decomposition in v5 -- `IO<A>` is an opaque effect description interpreted by the runtime.

```csharp
namespace Domain.Effects;

public static class ConsoleIO {
    public static IO<string> ReadLine => IO.lift(static () => Console.ReadLine()!);
    public static IO<Unit> WriteLine(string message) =>
        IO.lift(() => { Console.WriteLine(message); return unit; });
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
        from __ in StateT<GameState, IO>.modify(
            (GameState s) => s with { Score = s.Score + input.Length })
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
    // --- [ATOM] --------------------------------------------------------------
    // static readonly -- single shared instance; expression-bodied would create new Atom per access
    public static readonly Atom<HashMap<string, decimal>> Balances = Atom(
        HashMap(("alice", 1000m), ("bob", 500m)),
        (HashMap<string, decimal> state) => state.ForAll(
            (string _, decimal value) => value >= 0m));
    // --- [REFS] --------------------------------------------------------------
    public static readonly Ref<Account> AccountA = Ref(new Account(Balance: 1000m));
    public static readonly Ref<Account> AccountB = Ref(new Account(Balance: 500m));
    // --- [OPERATIONS] --------------------------------------------------------
    public static Unit Transfer(decimal amount) =>
        atomic(() => {
            AccountA.Swap((Account a) => a with { Balance = a.Balance - amount });
            AccountB.Swap((Account b) => b with { Balance = b.Balance + amount });
        });
}
public readonly record struct Account(decimal Balance);
```

[IMPORTANT]: `Atom` for single-value concurrent state -- the optional validator function rejects `Swap` calls that would produce invalid state. `Ref` + `atomic` for multi-ref transactional consistency. STM also provides `snapshot()` (snapshot isolation) and `serial()` (serializable isolation) as alternatives to `atomic()`. `Swap` takes a pure `A -> A` function -- no mutation, no locks. Use `static readonly` fields (not expression-bodied properties) to ensure a single shared instance.

---
## [8][SCHEDULE]
>**Dictum:** *Retry policies are algebraic; compose via `|` union and `&` intersect operators.*

<br>

`Schedule` combinators build retry/repeat policies from algebraic primitives. The `|` operator composes (union -- take both). The `&` operator intersects (take shorter). `.Retry()` applies a schedule to any `Eff`. Note: `jitter`, `recurs`, and `maxDelay` return `ScheduleTransformer` (not `Schedule`) -- the `|` operator applies transformers to the base schedule via implicit composition.

```csharp
namespace Domain.Effects;

public static class ResiliencePolicy {
    // --- [SCHEDULES] ---------------------------------------------------------
    // exponential backoff + jitter + cap at 5 retries + max 30s delay
    // Schedule | ScheduleTransformer applies transformation to base schedule
    public static Schedule RetryPolicy =>
        Schedule.exponential(baseDelay: 100 * ms)
        | Schedule.jitter(factor: 0.1)
        | Schedule.recurs(times: 5)
        | Schedule.maxDelay(delay: 30 * sec);
    public static Schedule FixedPolicy =>
        Schedule.spaced(spacing: 1 * sec) | Schedule.recurs(times: 3);
    public static Schedule LinearPolicy =>
        Schedule.linear(seed: 100 * ms, factor: 2.0);
    // & intersection: bounded by BOTH time AND count
    public static Schedule BoundedPolicy =>
        Schedule.exponential(baseDelay: 200 * ms) & Schedule.upto(duration: 60 * sec);
    // --- [EFFECTS] -----------------------------------------------------------
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
- [ALWAYS] `Eff<RT,T>` for effectful pipelines -- `ReaderT<RT, IO, A>` environmental DI via runtime record.
- [ALWAYS] `IO<A>` for boundary side effects -- `Run`/`RunAsync` interpretation.
- [ALWAYS] `@catch` with predicate for selective error recovery -- no `Match` mid-pipeline.
- [ALWAYS] `|` Alternative for fallback chains -- declarative try-then-fallback composition.
- [ALWAYS] `static readonly` for `Atom`/`Ref` shared state -- expression-bodied properties create new instances.
- [NEVER] `try`/`catch`/`throw` in domain code -- effects are typed.
- [NEVER] Early `Match` in mid-pipeline -- prefer `Map`/`Bind`/`BiMap`.
- [NEVER] v4 `Has<RT, Trait>` / `default(RT)` pattern -- use v5 `Eff<RT, T>.Asks` with runtime record.
- [IMPORTANT] Encode cancellation boundaries explicitly via `Eff` -- delimit uninterruptible regions rather than scattering `CancellationToken` checks.

---
## [10][QUICK_REFERENCE]

| [INDEX] | [PATTERN]             | [WHEN]                              | [KEY_TRAIT]                             |
| :-----: | :-------------------- | :---------------------------------- | --------------------------------------- |
|   [1]   | `Fin<T>`              | Synchronous fallible operation      | `Bind`/`Map`/`Match` + switch expr      |
|   [2]   | `Eff<RT,T>`           | Effectful pipeline with DI          | `ReaderT` + `Asks` + LINQ comprehension |
|   [3]   | `@catch`              | Selective error recovery            | Predicate catch + `\|` compose          |
|   [4]   | `\| Alternative`      | Declarative fallback chain          | Choice trait on Fin/Eff/Option          |
|   [5]   | `Validation<Error,T>` | Parallel multi-field validation     | Applicative `.Apply()` tuple            |
|   [6]   | `IO<A>`               | Boundary side effect description    | Free-monad DSL + `Run`                  |
|   [7]   | `OptionT<M,A>`        | Optionality threaded through monad  | Transformer stacking                    |
|   [8]   | `Atom<T>`             | Lock-free concurrent single value   | `Swap` + optional validator             |
|   [9]   | `Ref<T>` + `atomic`   | Multi-ref transactional consistency | STM commit/rollback                     |
|  [10]   | `Schedule`            | Algebraic retry/repeat policy       | `\|` union + `&` intersect + `Retry`    |
