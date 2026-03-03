# Effects

Effect type system for C# 14 / .NET 10. LanguageExt v5 stratifies effects across four types: `Fin<T>` for synchronous failure, `Validation<Error,T>` for applicative accumulation, `Eff<RT,T>` for environmental DI pipelines via `ReaderT<RT, IO, A>`, and `IO<A>` for boundary-level effect description. All snippets assume `using static LanguageExt.Prelude;` and `using LanguageExt;`.

---

## Sync Pipelines and Applicative Bridging

Stratify validation into monadic refinement per field and applicative accumulation across fields. `Fin<T>` short-circuits guard chains within `Refine`; `.ToValidation()` lifts each result into the applicative functor where tuple `.Apply()` runs all fields independently, combining failures through `Error`'s Monoid. `[Union]` on the error DU generates `Switch<TResult>` with one required `Func` per variant, propagating `TScalar` through generated dispatch for compile-time totality.

```csharp
namespace Domain.Effects;

[Union]
public partial record FieldFault<TScalar>(string Message, int Code, Option<Error> Inner = default)
    : Expected(Message, Code, Inner) where TScalar : INumber<TScalar> {
    public partial record BelowFloor(string Field, TScalar Actual, TScalar Floor)
        : FieldFault<TScalar>($"{Field}: {Actual} < {Floor}", 4001);
    public partial record AboveCeiling(string Field, TScalar Actual, TScalar Ceiling)
        : FieldFault<TScalar>($"{Field}: {Actual} > {Ceiling}", 4002);
    public partial record NonFinite(string Field, TScalar Actual)
        : FieldFault<TScalar>($"{Field}: non-finite {Actual}", 4003);
}

public static class SyncPipeline {
    public static Fin<T> Refine<T, TScalar>(TScalar raw, TScalar floor, TScalar ceiling, string field)
        where T : DomainType<T, TScalar>
        where TScalar : INumber<TScalar> =>
        from _ in guard(TScalar.IsFinite(raw), new FieldFault<TScalar>.NonFinite(Field: field, Actual: raw))
        from __ in guard(raw >= floor, new FieldFault<TScalar>.BelowFloor(Field: field, Actual: raw, Floor: floor))
        from ___ in guard(raw <= ceiling, new FieldFault<TScalar>.AboveCeiling(Field: field, Actual: raw, Ceiling: ceiling))
        from t in T.From(raw)
        select t;
    public static Validation<Error, (TA First, TB Second, TC Third)> Consolidate<TA, TB, TC, TScalar>(
        (TScalar Raw, TScalar Floor, TScalar Ceiling, string Field) a,
        (TScalar Raw, TScalar Floor, TScalar Ceiling, string Field) b,
        (TScalar Raw, TScalar Floor, TScalar Ceiling, string Field) c)
        where TA : DomainType<TA, TScalar>
        where TB : DomainType<TB, TScalar>
        where TC : DomainType<TC, TScalar>
        where TScalar : INumber<TScalar> =>
        (Refine<TA, TScalar>(a.Raw, a.Floor, a.Ceiling, a.Field).ToValidation(),
         Refine<TB, TScalar>(b.Raw, b.Floor, b.Ceiling, b.Field).ToValidation(),
         Refine<TC, TScalar>(c.Raw, c.Floor, c.Ceiling, c.Field).ToValidation()
        ).Apply(static (TA x, TB y, TC z) => (First: x, Second: y, Third: z));
}
```

- `guard` calls desugar to `Bind` chains — first failure makes subsequent guards and `T.From(raw)` structurally unreachable. `TScalar.IsFinite(raw)` resolves via static abstract dispatch: vacuous for integrals, rejects `NaN`/`Infinity` for floats.
- `.ToValidation()` lifts each `Fin` into the applicative functor; tuple `.Apply()` runs all `Refine` pipelines independently, accumulating failures through `Error.Combine`. `Consolidate` is necessarily per-arity — tuple `.Apply()` requires heterogeneous type parameters, so a `Seq`-based alternative collapses to homogeneous `Validation<Error, Seq<T>>`, losing distinct domain types.
- `[Union]` generates `Switch<TResult>` with one required `Func` per variant — adding a fourth variant breaks all call sites at compile time. `TScalar` propagates through generated dispatch without re-constraining; `Expected` base carries `Code` for machine-routable error dispatch at serialization boundaries.

---

## Environmental Pipelines and Scoped Execution

`Eff<RT,T>` — `ReaderT<RT, IO, A>` over a `sealed record` runtime — defers service resolution to the reader environment, making LINQ pipeline composition structurally independent of DI wiring topology. Collapsing the pipeline peels three layers at a single boundary site: the reader resolves environment, `IO` executes effects, `Fin` captures failure without exceptions.

```csharp
namespace Domain.Effects;

using NodaTime;

public interface IEnricher<RT> {
    Eff<RT, T> Enrich<T>(T raw) where T : notnull;
}
public interface IDispatcher<RT> {
    Eff<RT, T> Dispatch<T>(T enriched) where T : notnull;
}

public sealed record PipelineRuntime(
    IEnricher<PipelineRuntime> Enricher,
    IDispatcher<PipelineRuntime> Dispatcher,
    IClock Clock);

public static class Pipeline {
    public static Eff<PipelineRuntime, (T Dispatched, Instant Timestamp)> Orchestrate<T>(
        T payload, Func<T, bool> invariant) where T : notnull =>
        from enricher in Eff<PipelineRuntime, IEnricher<PipelineRuntime>>.Asks(static (PipelineRuntime rt) => rt.Enricher)
        from dispatcher in Eff<PipelineRuntime, IDispatcher<PipelineRuntime>>.Asks(static (PipelineRuntime rt) => rt.Dispatcher)
        from clock in Eff<PipelineRuntime, IClock>.Asks(static (PipelineRuntime rt) => rt.Clock)
        from _ in guard(invariant(payload), Error.New(message: "Invariant violation"))
        from enriched in enricher.Enrich(raw: payload)
        from __ in guardnot(enriched.Equals(payload),
            Error.New(message: "Enrichment idempotency fault"))
        from dispatched in dispatcher.Dispatch(enriched: enriched)
        let timestamp = clock.GetCurrentInstant()
        select (Dispatched: dispatched, Timestamp: timestamp);
    public static Fin<T> Collapse<T>(
        Eff<PipelineRuntime, T> pipeline, PipelineRuntime runtime) =>
        pipeline.Run(runtime).Run();
}
```

- `Eff<RT,T>.Asks(static rt => rt.Property)` lifts a runtime field into the reader monad — `static` proves zero closure, confining the DI surface to the runtime record. Scrutor decorates concrete `IDispatcher<PipelineRuntime>` at the composition root, transparent to the pipeline's interface-only view.
- `Collapse` is intentionally minimal — `.Run(runtime)` resolves the reader yielding `IO<A>`, `.Run()` executes the `IO` yielding `Fin<A>`. `guard`/`guardnot` short-circuit via `Fin.Fail`, propagating through every remaining `SelectMany` binding without explicit error plumbing.
- `let timestamp` desugars to `Select` (functor map), not `SelectMany` (monadic bind) — zero effect allocation for pure-value bindings within the same comprehension that sequences effectful `from` bindings via monadic `Bind`.

---

## Recovery Algebra and Resilience Injection

Decorator injection via Scrutor interposes `@catch` selective recovery and `Schedule` algebraic retry between caller and capability interface — resilience is a composition-root concern, not a pipeline concern. Each method declares its own recovery topology: `Acquire` degrades through an alternate retry cadence into a typed sentinel, `List` collapses expected failures to `Seq.Empty`; both share the same `static readonly` schedule algebra without per-instance allocation.

```csharp
namespace Infra.Resilience;

public interface IResourceProvider<RT> {
    Eff<RT, Resource> Acquire(ResourceKey key);
    Eff<RT, Seq<Resource>> List(ResourceFilter filter);
}

public sealed class ResilientResourceProvider<RT>(
    IResourceProvider<RT> inner) : IResourceProvider<RT>
{
    private static readonly Schedule RetryPolicy =
        (Schedule.exponential(baseDelay: 200 * ms)
            | Schedule.jitter(factor: 0.15)
            | Schedule.recurs(times: 5))
        & Schedule.upto(duration: 60 * sec);
    public Eff<RT, Resource> Acquire(ResourceKey key) =>
        inner.Acquire(key: key)
            .Retry(schedule: RetryPolicy)
        | @catch(static (Error err) => err.Code == 503,
            inner.Acquire(key: key)
                .Retry(schedule: Schedule.spaced(spacing: 5 * sec)
                    | Schedule.recurs(times: 2)))
        | Eff<RT, Resource>.Pure(Resource.Unavailable(key: key));
    public Eff<RT, Seq<Resource>> List(ResourceFilter filter) =>
        inner.List(filter: filter)
            .Retry(schedule: RetryPolicy)
        | @catch(static (Error err) => err.IsExpected,
            Eff<RT, Seq<Resource>>.Pure(Seq<Resource>.Empty))
        | Eff<RT, Seq<Resource>>.Pure(Seq<Resource>.Empty);
}
```

- `|` (union) on `Schedule` applies transformers — `jitter`, `recurs` — to the base `exponential`; `&` (intersect) bounds the composite against an independent `upto` constraint, enforcing retry-count AND wall-clock limits simultaneously. The policy is a `static readonly` first-class value: zero per-instance allocation, algebraically composable without builder APIs.
- `@catch` fires only after `.Retry` exhaustion, discriminating on the terminal `Error` via a `static` predicate; `Acquire` selects `err.Code == 503` for a degraded retry cadence then falls through `|` Alternative to a typed `Unavailable` sentinel, while `List` collapses any expected error to `Seq.Empty` — polymorphic recovery per method over a shared schedule algebra.
- `services.Decorate<IResourceProvider<RT>, ResilientResourceProvider<RT>>()` replaces the registration transparently at the composition root — primary constructor parameter `inner` is the Scrutor-resolved decorated instance (non-static capture, structurally required); all `Schedule` fields and `@catch` lambdas remain `static`, confining allocation to the policy constants.

---

## Transactional State and Effect Description

`Atom<T>` provides lock-free single-value CAS with validator-enforced invariants on every swap; `Ref<T>` + `atomic` blocks compose reads and writes across multiple refs as a single STM transaction with automatic retry on conflict. Both bridge into `IO<A>` effect descriptions that separate construction from execution, and `StateT<S, IO, A>` stacks state threading over IO as a single describable computation collapsed at the boundary.

```csharp
namespace Domain.Effects;

using NodaTime;

[ValueObject<string>(SkipFactoryMethods = true)]
public readonly partial struct AccountId : DomainType<AccountId, string> {
    public static Fin<AccountId> From(string repr) =>
        from _ in guard(!string.IsNullOrWhiteSpace(repr), Error.New(message: "blank account id"))
        select new AccountId(repr);
    public string To() => _value;
}

public readonly record struct Ledger(decimal Assets, decimal Liabilities, Instant Settled);

public static class AtomicLedger {
    public static readonly Atom<HashMap<AccountId, Ledger>> Accounts = Atom(
        HashMap<AccountId, Ledger>(),
        static (HashMap<AccountId, Ledger> s) => s.ForAll(
            static (AccountId _, Ledger l) => l.Assets >= 0m && l.Liabilities >= 0m));
    public static Unit Rebalance(
        Ref<Ledger> source, Ref<Ledger> target, decimal amount, Instant now) =>
        atomic(() => {
            source.Swap((Ledger s) => s with { Assets = s.Assets - amount, Settled = now });
            target.Swap((Ledger t) => t with { Assets = t.Assets + amount, Settled = now });
        });
    public static IO<Unit> SettlementWorkflow(
        Ref<Ledger> source, Ref<Ledger> target, decimal amount, IClock clock) =>
        from now in IO.lift(() => clock.GetCurrentInstant())
        from _   in IO.lift(() => Rebalance(source: source, target: target, amount: amount, now: now))
        from __  in IO.lift(() => Accounts.Swap((HashMap<AccountId, Ledger> a) => a.Map(
            (AccountId _, Ledger l) => l with { Settled = now })))
        select unit;
    public static StateT<Ledger, IO, decimal> NetPosition(IClock clock) =>
        from state in StateT<Ledger, IO>.get
        from now   in liftIO(IO.lift(() => clock.GetCurrentInstant()))
        from _     in StateT<Ledger, IO>.modify((Ledger l) => l with { Settled = now })
        select state.Assets - state.Liabilities;
}
```

- `Atom` validator fires on every `Swap` — rejection preserves the previous value, making invariant violations structurally impossible. `static readonly` field (not expression-bodied property) ensures a single shared instance; an expression-bodied property silently constructs a new `Atom` per access, breaking shared-state semantics.
- `atomic()` composes reads and writes across multiple `Ref<T>` instances as a single transaction — if any ref was modified externally between snapshot and commit, the entire block retries with fresh values.
- `IO.lift(() => ...)` wraps a synchronous lambda as an effect description — constructing the pipeline performs no work until `.Run()` collapses it. `StateT<Ledger, IO, decimal>` describes a stateful computation as a first-class value, collapsed via `.Run(initialState).Run()` which resolves `StateT` yielding `IO<(S, A)>`, then executes the `IO` yielding `Fin<(S, A)>`.

---

## Rules

- [ALWAYS] `Fin<T>` for synchronous failures — monadic `Bind`/`Map`, `Match` at boundary only.
- [ALWAYS] `Validation<Error,T>` for parallel accumulation — `.Apply()` on tuple, `.ToValidation()` bridges `Fin`.
- [ALWAYS] `Eff<RT,T>` for environmental pipelines — `sealed record` runtime, `Asks(static rt => ...)` reader-lift.
- [ALWAYS] `IO<A>` for boundary effect description — `Run`/`RunAsync` collapses description to execution.
- [ALWAYS] `@catch` with `static` predicate for selective recovery — fires after retry exhaustion, `|` Alternative for fallback.
- [ALWAYS] `Schedule` algebra — `|` applies transformers, `&` intersects bounds, `.Retry(schedule)` applies to `Eff`.
- [ALWAYS] `static readonly` for shared `Atom`/`Ref` state — expression-bodied properties create new instances.
- [ALWAYS] `Ref<T>` + `atomic()` for multi-ref STM — pure `Swap`, automatic retry on conflict.
- [ALWAYS] Resilience as Scrutor decorator — pipeline owns effect composition, composition root owns wiring.
- [ALWAYS] Boundary collapse `Eff → IO → Fin` at single site — `.Run(runtime).Run()`.
- [NEVER] `try`/`catch`/`throw` in domain code — effects are typed.
- [NEVER] `await` inside `Eff<RT,T>` — bridge via `liftIO(IO.liftAsync(...))`.
- [NEVER] v4 `Has<RT, Trait>` / `default(RT)` — v5 uses `Eff<RT, T>.Asks` with runtime record.
- [NEVER] Early `Match` mid-pipeline — `Map`/`Bind`/`BiMap`; `Match` at boundaries.
- [OVERLAP: composition.md] Scrutor decorator wiring at composition root — effects.md owns resilience pipeline definition, composition.md owns decorator registration topology.
- [OVERLAP: transforms.md] Kleisli composition via `ComposeK`/`FoldArrows` operates over effect types — transforms.md owns arrow algebra, effects.md owns effect type stratification.
