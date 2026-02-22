# [H1][COMPOSITION]
>**Dictum:** *Composition compresses surface; one abstraction owns the concept.*

<br>

Collapses method families into polymorphic abstractions via higher-kinded encodings. Prefer LanguageExt collections (`HashMap`, `Seq`, `HashSet`) -- they integrate with `K<F,A>` trait machinery.

---
## [1][EFF_COMPOSITION]
>**Dictum:** *Monadic pipelines compose via LINQ, applicative via tuple, errors via @catch.*

<br>

`Eff<RT,A>` composition: (a) sequential via LINQ `from`/`select`, (b) independent via applicative tuple, (c) `Fin<A>` lifting via `.ToEff()`, (d) error recovery via `@catch` | alternation. See `effects.md` [3] for the full `@catch` overload list (`CatchM<Error, M, A>`).

```csharp
namespace Domain.Composition;

// --- [SEQUENTIAL] ------------------------------------------------------------

public static Eff<AppRuntime, OrderSummary> ProcessOrder(OrderId orderId) =>
    from order in OrderRepo.Get(orderId: orderId)
    from inventory in InventoryService.Reserve(items: order.Items)
    from payment in PaymentGateway.Charge(
        amount: order.Total, reservationId: inventory.ReservationId)
    select new OrderSummary(
        OrderId: orderId, PaymentRef: payment.Reference, Reserved: inventory.Count);

// --- [INDEPENDENT] -----------------------------------------------------------

public static Eff<AppRuntime, DashboardData> LoadDashboard(TenantId tenantId) =>
    (StatsService.GetMetrics(tenantId: tenantId),
     AlertService.GetActive(tenantId: tenantId),
     AuditService.GetRecent(tenantId: tenantId, limit: 50))
        .Apply(static (MetricsSnapshot metrics, Seq<Alert> alerts, Seq<AuditEntry> audit) =>
            new DashboardData(Metrics: metrics, Alerts: alerts, RecentAudit: audit));

// --- [LIFTING] ---------------------------------------------------------------

public static Eff<AppRuntime, ValidatedEmail> ValidateAndStore(string raw) =>
    from validated in Email.Parse(input: raw).ToEff()
    from stored in EmailRepo.Upsert(email: validated)
    select stored;

// --- [RECOVERY] --------------------------------------------------------------

public static Eff<AppRuntime, Config> LoadConfig(ConfigKey key) =>
    ConfigCache.Get(key: key)
      | @catch(Errors.CacheMiss, (Error _) => ConfigDb.Get(key: key))
      | @catch(Errors.NotFound, (Error _) => eff(Config.Default));
```

---
## [2][PIPE_COMPOSE]
>**Dictum:** *Data flows left-to-right; composition is the universal operator.*

<br>

`Pipe` for left-to-right application, `Compose` for chaining, `ComposeAll` for unbounded endomorphic chains.

```csharp
namespace Domain.Composition;
public static class Flow {
    extension<A>(A value) {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public B Pipe<B>(Func<A, B> func) => func(arg: value);
    }
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Func<A, C> Compose<A, B, C>(
        Func<A, B> first, Func<B, C> second) =>
        (A input) => second(arg: first(arg: input));
    // ComposeAll: composition-time overhead is N closures; acceptable for pipeline assembly
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Func<A, A> ComposeAll<A>(Seq<Func<A, A>> functions) =>
        functions.Fold(
            state: (Func<A, A>)((A input) => input),
            folder: (Func<A, A> acc, Func<A, A> next) =>
                (A input) => next(arg: acc(arg: input)));
}
```

---
## [3][ARITY_COLLAPSE]
>**Dictum:** *One method owns all arities; variation is typed, not overloaded.*

<br>

`params ReadOnlySpan<T>` collapses all arities into a single stack-allocated call via `IAlgebraicMonoid<TSelf>`. For Generic Math interfaces (`IAdditionOperators`, `INumber<T>`) on domain types, see `types.md` [6] -- same foundation, type-specific operator constraints.

```csharp
namespace Domain.Composition;
public interface IAlgebraicMonoid<TSelf>
    where TSelf : IAlgebraicMonoid<TSelf> {
    static abstract TSelf Combine(TSelf leftOperand, TSelf rightOperand);
    static abstract TSelf Identity { get; }
}
public static class SpanPolymorphism {
    extension<T>(ReadOnlySpan<T> span) where T : IAlgebraicMonoid<T> {
        public TAccumulate Fold<TAccumulate>(
            TAccumulate seed,
            Func<TAccumulate, T, TAccumulate> folder) =>
            span.Length switch {
                0 => seed,
                _ => span.Slice(start: 1).Fold(
                    seed: folder(arg1: seed, arg2: span[index: 0]),
                    folder: folder)
            };
        public T ConcatAll() =>
            span.Fold(
                seed: T.Identity,
                folder: static (T accumulator, T current) =>
                    T.Combine(leftOperand: accumulator, rightOperand: current));
    }
    public static TElement Aggregate<TElement>(
        params ReadOnlySpan<TElement> elements)
        where TElement : IAlgebraicMonoid<TElement> =>
        elements.ConcatAll();
}
```

---
## [4][HKT_ENCODING]
>**Dictum:** *Algorithms generic over computation eliminate adapter code.*

<br>

`K<F,A>` encodes higher-kinded types. Constraints (`Fallible<F>`, `Applicative<F>`, `Monad<F>`) specify capabilities. `.As()` downcasts at boundaries.

```csharp
namespace Domain.Composition;
public readonly record struct Digit(int Value) {
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static K<F, Digit> Make<F>(int value)
        where F : Fallible<F>, Applicative<F> =>
        value switch {
            >= 0 and <= 9 => pure<F, Digit>(new Digit(Value: value)),
            _ => error<F, Digit>(Error.New(message: "Not a digit"))
        };
}
public static class Parsing {
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    // Monad<F> implies Applicative<F>; Traverse requires Applicative<F> for sequencing.
    public static K<F, int> ParseInt<F>(string text)
        where F : Fallible<F>, Monad<F> =>
        toSeq(text)
            .Traverse(static (char ch) => ch switch {
                >= '0' and <= '9' => Digit.Make<F>(value: ch - '0'),
                _ => error<F, Digit>(Error.New(message: "Not a digit"))
            })
            .Bind(static (Seq<Digit> digits) => digits.IsEmpty switch {
                true => error<F, int>(Error.New(message: "Empty digit sequence")),
                false => pure<F, int>(
                    digits.FoldBack(
                        state: (Total: 0, Scalar: 1),
                        folder: static ((int Total, int Scalar) state, Digit digit) =>
                            (Total: state.Total + digit.Value * state.Scalar,
                             Scalar: state.Scalar * 10)).Total)
            });
}
```

`.As()` downcasts at consumption boundary: `Parsing.ParseInt<Fin>(text: "42").As()` yields `Fin<int>`.

`Foldable<F>` / `Traversable<F>` -- write once, run across all containers:
```csharp
public static T Sum<F, T>(K<F, T> structure)
    where F : Foldable<F> where T : INumber<T> =>
    Foldable.fold(f: static (T acc, T item) => acc + item, initialState: T.Zero, ta: structure);
```

`Fallible<F>` -- HKT-level error recovery via `@catch` on any fallible functor:

```csharp
// K<F,A>-level recovery: works for Fin, Eff, Option, Validation, etc.
public static K<F, T> WithDefault<F, T>(K<F, T> primary, K<F, T> fallback)
    where F : Fallible<F>, Applicative<F> =>
    primary | @catch(static (Error _) => fallback);
```

`algorithms.md` [6] provides concrete `Fin<T>` Kleisli composition (`ComposeK`/`PipeK`) -- same pattern specialized to synchronous fallible arrows.

---
## [5][ALGEBRAIC_COMPRESSION]
>**Dictum:** *One DU + Fold replaces N interpreter classes.*

<br>

DU + `Fold` catamorphism encodes an algebra. New interpretations are fold arguments -- no classes, no visitors.
```csharp
namespace Domain.Composition;
public abstract record Expr {
    private protected Expr() { }
    public sealed record Literal(double Value) : Expr;
    public sealed record Add(Expr Left, Expr Right) : Expr;
    public sealed record Multiply(Expr Left, Expr Right) : Expr;
    public sealed record Negate(Expr Inner) : Expr;
    // SAFETY: _ arm unreachable -- sealed hierarchy exhaustive; pending C# first-class DU matching
    public TResult Fold<TResult>(
        Func<double, TResult> onLiteral,
        Func<TResult, TResult, TResult> onAdd,
        Func<TResult, TResult, TResult> onMultiply,
        Func<TResult, TResult> onNegate) =>
        this switch {
            Literal l => onLiteral(arg: l.Value),
            Add a => onAdd(
                arg1: a.Left.Fold(onLiteral, onAdd, onMultiply, onNegate),
                arg2: a.Right.Fold(onLiteral, onAdd, onMultiply, onNegate)),
            Multiply m => onMultiply(
                arg1: m.Left.Fold(onLiteral, onAdd, onMultiply, onNegate),
                arg2: m.Right.Fold(onLiteral, onAdd, onMultiply, onNegate)),
            Negate n => onNegate(
                arg: n.Inner.Fold(onLiteral, onAdd, onMultiply, onNegate)),
            _ => throw new System.Diagnostics.UnreachableException()
        };
}
public static double Evaluate(Expr expression) =>
    expression.Fold<double>(
        onLiteral: static (double value) => value,
        onAdd: static (double left, double right) => left + right,
        onMultiply: static (double left, double right) => left * right,
        onNegate: static (double inner) => -inner);
```

---
## [6][LAYER_COMPOSITION]
>**Dictum:** *Runtime wires traits without inheritance; tests swap implementations.*

<br>

Runtime records encode capabilities. Access dependencies via `Eff<RT,T>.Asks` + static lambdas. Test runtimes substitute stubs -- no mocks.
```csharp
namespace Domain.Composition;
public sealed record AppRuntime(DbClient Db, GatewayClient Gateway);
public static class RuntimeAccess {
    public static Eff<AppRuntime, DbClient> AskDb =>
        Eff<AppRuntime, DbClient>.Asks(static (AppRuntime runtime) => runtime.Db);
    public static Eff<AppRuntime, GatewayClient> AskGateway =>
        Eff<AppRuntime, GatewayClient>.Asks(static (AppRuntime runtime) => runtime.Gateway);
}
// TestRuntime: same property shape with stub implementations -- zero mocks
// Services constrain on runtime capability shape, never concrete infrastructure types
// Composition root: wire runtime seams via Scrutor, not repetitive AddScoped chains.
services.Scan(scan => scan
    .FromAssemblyOf<AppRuntime>()
    .AddClasses(classes => classes.InNamespaces("Domain.Composition"))
    .UsingRegistrationStrategy(Scrutor.RegistrationStrategy.Throw)
    .AsSelfWithInterfaces()
    .WithScopedLifetime());
```

---
## [7][CURRYING_PARTIAL]
>**Dictum:** *LanguageExt Prelude owns curry/partial -- do not hand-roll.*

<br>

```csharp
// curry: Func<A,B,R> -> Func<A, Func<B, R>>
Func<int, Func<int, int>> curriedAdd = curry<int, int, int>(static (int first, int second) => first + second);
Func<int, int> addTen = curriedAdd(arg: 10);
// par: fix first argument -> specialized function
Func<string, string> greetAlice = par<string, string, string>(
    static (string greeting, string name) => $"{greeting}, {name}!",
    arg1: "Hello");
```

---
## [8][MEMOIZATION]
>**Dictum:** *Pure functions memoize safely; Atom + HashMap for lock-free CAS.*

<br>

`Atom<HashMap<K,V>>` provides lock-free memoization via CAS. `Swap` accepts state for `static` lambda. `ConcurrentDictionary` is boundary-adapter escape hatch only.

```csharp
namespace Domain.Composition;
public static class Memoization {
    public static Func<TKey, TResult> Memoize<TKey, TResult>(
        Func<TKey, TResult> func) where TKey : notnull {
        Atom<HashMap<TKey, TResult>> cache = Atom(HashMap<TKey, TResult>());
        return (TKey key) => cache.Value.Find(key: key).Match(
            Some: static (TResult cached) => cached,
            None: () => {
                TResult result = func(arg: key);
                cache.Swap(static (HashMap<TKey, TResult> current, (TKey key, TResult result) ctx) =>
                    current.AddOrUpdate(key: ctx.key, value: ctx.result), (key, result));
                return result;
            });
    }
}
```

---
## [9][SEQ_EXTENSIONS]
>**Dictum:** *Seq-native operations avoid IEnumerable state machines.*

<br>

Extend `Seq<T>` directly. `Scan` uses `.Cons` (O(1) prepend) + `.Rev()`, avoiding O(n^2) `.Add`. .NET 10 ships `CountBy`/`AggregateBy`/`LeftJoin` built-in.

```csharp
namespace Domain.Composition;
public static class SeqExtensions {
    extension<T>(Seq<T> source) {
        public Seq<Seq<T>> Window(int size) =>
            source.Select(static (T item, int index) => (item, index))
                  .GroupBy(pair => pair.index / size)
                  .Map(static (IGrouping<int, (T item, int index)> group) =>
                      toSeq(group.Map(static ((T item, int index) pair) => pair.item)));
        public Seq<TAccumulate> Scan<TAccumulate>(
            TAccumulate seed,
            Func<TAccumulate, T, TAccumulate> folder) =>
            source.Fold(
                state: Seq1(seed),
                folder: (Seq<TAccumulate> acc, T item) =>
                    folder(arg1: acc.Last, arg2: item).Cons(acc))
                .Rev();
    }
}
```

---
## [10][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] Eff composition: LINQ comprehension for sequential, applicative tuple for independent.
- [ALWAYS] `Pipe` for left-to-right application; `Compose` for function chaining.
- [ALWAYS] `params ReadOnlySpan<T>` for arity collapse -- one method, all arities.
- [ALWAYS] `K<F,A>` with `.As()` downcast at consumption boundaries.
- [ALWAYS] Runtime-record DI via `Eff<RT,T>.Asks` -- services never know concrete infrastructure types.
- [ALWAYS] LanguageExt `HashMap`/`Seq`/`HashSet` over BCL immutable collections.
- [ALWAYS] DU + `Fold` catamorphism for algebras -- not visitor classes.
- [ALWAYS] `Atom<HashMap<K,V>>` for memoization -- `ConcurrentDictionary` for boundary adapters only.
- [ALWAYS] Prelude `curry`/`par` -- never hand-roll currying or partial application.
- [NEVER] `async/await` mixed with `Eff` -- use `.ToEff()`, `Eff.liftAsync` for interop.
- [NEVER] Single-call private helpers -- inline into the single caller.
- [NEVER] Sibling method families (`Get`/`GetMany`/`GetOrDefault`) -- use typed queries.

---
## [11][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                  | [WHEN]                                     | [KEY_TRAIT]                          |
| :-----: | -------------------------- | ------------------------------------------ | ------------------------------------ |
|   [1]   | **Eff LINQ comprehension** | Sequential monadic pipeline composition    | from/select = Bind/Map               |
|   [2]   | **Eff applicative tuple**  | Independent pipeline composition           | Apply on tuple of Eff values         |
|   [3]   | **Pipe/Compose**           | Left-to-right data threading               | C# 14 extension + AggressiveInlining |
|   [4]   | **Arity collapse**         | Replace overload families                  | params ReadOnlySpan + monoid         |
|   [5]   | **K<F,A> HKT + .As()**     | Algorithm generic over effect/container    | Fallible/Applicative/Monad           |
|   [6]   | **Foldable/Traversable**   | Container-generic fold, traverse, sequence | Foldable<F> / Traversable<F>         |
|   [7]   | **Algebraic compression**  | DU + Fold replaces N interpreters          | Catamorphism on sealed DU hierarchy  |
|   [8]   | **Layer composition**      | Runtime wiring + test substitution         | Runtime records + `Asks` accessors   |
|   [9]   | **Atom memoization**       | Thread-safe pure function caching          | Atom<HashMap> + CAS Swap             |
|  [10]   | **Seq extensions**         | Windowing, scanning on LanguageExt Seq     | Seq.Fold + .Cons for O(1) prepend    |
