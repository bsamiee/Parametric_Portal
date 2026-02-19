# [H1][COMPOSITION]
>**Dictum:** *Composition compresses surface; one abstraction owns the concept.*

Composition in C# 14 / .NET 10 collapses method families into single polymorphic abstractions, threads data through transformation chains, and encodes concepts as types via higher-kinded encodings and algebraic interfaces. Prefer LanguageExt collections (`HashMap`, `Seq`, `HashSet`) over BCL `System.Collections.Immutable` -- they integrate with `K<F,A>` trait machinery (`Foldable`, `Traversable`, `Monad`).

---
## [1][PIPE_COMPOSE]
>**Dictum:** *Data flows left-to-right; composition is the universal operator.*

C# 14 extension members provide `Pipe` for left-to-right application and `Compose` for function chaining. `ComposeAll` owns unbounded arity for endomorphic chains. All are `AggressiveInlining` for zero overhead.

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
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Func<A, A> ComposeAll<A>(Seq<Func<A, A>> functions) =>
        functions.Fold(
            state: (Func<A, A>)((A input) => input),
            folder: (Func<A, A> acc, Func<A, A> next) =>
                (A input) => next(arg: acc(arg: input)));
}
```

[IMPORTANT]: `Pipe` works with any codomain -- `Fin<T>`, `Option<T>`, `K<F,T>`, `Validation<..>`. `ComposeAll` accepts `Seq` (not `IEnumerable`) for trait integration. See `performance.md` [7] for `static` lambda guidance in hot paths.

---
## [2][ARITY_COLLAPSE]
>**Dictum:** *One method owns all arities; variation is typed, not overloaded.*

`IAlgebraicMonoid<TSelf>` provides `Combine` and `Identity`. `params ReadOnlySpan<T>` collapses all arities into a single stack-allocated call. Tail-recursive `Fold` over `ReadOnlySpan<T>` replaces `foreach`.

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
                folder: (T accumulator, T current) =>
                    T.Combine(leftOperand: accumulator, rightOperand: current));
    }
}
public static class UniversalComputeEngine {
    public static TElement Aggregate<TElement>(
        params ReadOnlySpan<TElement> elements)
        where TElement : IAlgebraicMonoid<TElement> =>
        elements.ConcatAll();
}
```

[CRITICAL]: `Aggregate(a)`, `Aggregate(a, b)`, `Aggregate(a, b, c, ...)` are all one method. .NET 10 promotes discrete arguments to stack-allocated spans implicitly. See `types.md` [6] for generic math constraints that pair with algebraic monoid.

---
## [3][EXTENSION_MEMBERS]
>**Dictum:** *Behavior projects onto data without inheritance.*

C# 14 extension blocks group properties, methods, and operators by receiver type. This replaces singleton service classes with static, allocation-free behavior projection. Prefer LanguageExt `HashMap<K,V>` over `IDictionary` -- `Find` returns `Option<V>` natively without extension adapters.

```csharp
namespace Domain.Composition;
public static class DomainExtensions {
    extension<TSource>(Seq<TSource> source) {
        public bool IsEmpty => source.Count == 0;
        public Seq<TSource> WhereNot(Func<TSource, bool> predicate) =>
            source.Filter(f: (TSource item) => !predicate(arg: item));
    }
    // HashMap.Find returns Option<V> natively -- no adapter needed
    // Seq.Choose combines Map+Filter in a single pass
    // Seq.Fold replaces Aggregate with explicit state threading
}
```

[IMPORTANT]: Extension blocks replace legacy `this`-parameter convention. Properties, operators, and static members group under one receiver. See `types.md` [4] for extension members on DU hierarchies.

---
## [4][HKT_ENCODING]
>**Dictum:** *Algorithms generic over computation eliminate adapter code.*

`K<F,A>` via LanguageExt.Traits encodes higher-kinded types. Constraints like `Fallible<F>`, `Applicative<F>`, `Monad<F>` specify required capabilities. `pure<F,A>` and `error<F,A>` construct values generically. `.As()` downcasts `K<F,A>` back to concrete types at consumption boundaries.

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
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static implicit operator int(Digit digit) => digit.Value;
}
public static class Parsing {
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static K<F, int> ParseInt<F>(string text)
        where F : Fallible<F>, Monad<F> =>
        ParseDigits<F>(text: text)
            .Bind((Seq<Digit> digits) => MakeNumberFromDigits<F>(digits: digits));
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static K<F, Seq<Digit>> ParseDigits<F>(string text)
        where F : Fallible<F>, Applicative<F> =>
        toSeq(text).Traverse((char ch) => ParseDigit<F>(ch: ch));
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static K<F, Digit> ParseDigit<F>(char ch)
        where F : Fallible<F>, Applicative<F> =>
        ch switch {
            >= '0' and <= '9' => Digit.Make<F>(value: ch - '0'),
            _ => error<F, Digit>(Error.New(message: "Not a digit"))
        };
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static K<F, int> MakeNumberFromDigits<F>(Seq<Digit> digits)
        where F : Fallible<F>, Applicative<F> =>
        digits.IsEmpty switch {
            true => error<F, int>(Error.New(message: "Empty digit sequence")),
            false => pure<F, int>(
                digits.FoldBack(
                    state: (Total: 0, Scalar: 1),
                    folder: ((int Total, int Scalar) state, Digit digit) =>
                        (Total: state.Total + digit.Value * state.Scalar,
                         Scalar: state.Scalar * 10)).Total)
        };
}
```

[CRITICAL]: `ParseInt<F>` returns `K<F, int>` -- the caller selects the effect context. One algorithm, many execution semantics. `Traverse` is applicative: independent parsing with multi-error reports.

**`.As()` Downcast** -- consumers MUST call `.As()` to convert `K<F, A>` to a concrete type:

```csharp
// .As() bridges K<F, A> back to concrete types at consumption boundaries
Fin<int> finResult = Parsing.ParseInt<Fin>(text: "42").As();
Option<int> optResult = Parsing.ParseInt<Option>(text: "42").As();
Eff<int> effResult = Parsing.ParseInt<Eff>(text: "42").As();
// Without .As(), the consumer gets K<Fin, int> which is not usable as Fin<int>
```

**Sequence** -- inverts container nesting via identity-Traverse:
```csharp
// Sequence: Seq<Option<A>> -> Option<Seq<A>> (inverts container nesting)
Seq<Option<int>> items = Seq(Some(1), Some(2), Some(3));
Option<Seq<int>> allPresent = items.Sequence().As();     // Some(Seq(1, 2, 3))
Seq<Option<int>> withNone = Seq(Some(1), None, Some(3));
Option<Seq<int>> shortCircuited = withNone.Sequence().As(); // None
```

**Foldable/Traversable Traits** -- write once, run across all containers:

```csharp
// Foldable<F>: Sum/All/Count written ONCE -- works for Seq, Option, Either, List
public static T Sum<F, T>(K<F, T> structure)
    where F : Foldable<F> where T : INumber<T> =>
    Foldable.fold(f: (T acc, T item) => acc + item, initialState: T.Zero, ta: structure);
public static bool All<F, T>(K<F, T> structure, Func<T, bool> predicate)
    where F : Foldable<F> =>
    Foldable.fold(f: (bool acc, T item) => acc && predicate(arg: item), initialState: true, ta: structure);
// Traversable<F>: generic effectful iteration across any Applicative
public static K<G, K<F, B>> TraverseGeneric<F, G, A, B>(
    K<F, A> structure, Func<A, K<G, B>> transform)
    where F : Traversable<F> where G : Applicative<G> =>
    Traversable.traverse(f: transform, ta: structure);
```

**Middleware Generic Over Monad** -- HKT applied to orchestration patterns. `Functor<TMonad>` suffices because `MapState` applies a pure transform without monadic bind:

```csharp
public interface IUniversalStateElevator<TMonad, TState>
    where TMonad : Functor<TMonad> {
    K<TMonad, TState> Elevate(TState state);
    K<TMonad, TState> MapState(
        K<TMonad, TState> source, Func<TState, TState> transform);
}
```

---
## [5][ALGEBRAIC_COMPRESSION]
>**Dictum:** *One DU + Fold replaces N interpreter classes.*

A discriminated union with a `Fold` catamorphism encodes an algebra. Every new interpretation is a new set of fold arguments -- no new classes, no visitor pattern. `StoreQuery` is the minimal case; expression trees demonstrate the full pattern.

```csharp
namespace Domain.Composition;
// Expression algebra: one Fold method, infinite interpretations
public abstract record Expr {
    private protected Expr() { }
    public sealed record Literal(double Value) : Expr;
    public sealed record Add(Expr Left, Expr Right) : Expr;
    public sealed record Multiply(Expr Left, Expr Right) : Expr;
    public sealed record Negate(Expr Inner) : Expr;
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
            _ => throw new UnreachableException()
        };
}
// Interpretation: Evaluate (PrettyPrint, Optimize, TypeCheck use same Fold, different algebra)
public static double Evaluate(Expr expression) =>
    expression.Fold<double>(
        onLiteral: (double value) => value,
        onAdd: (double left, double right) => left + right,
        onMultiply: (double left, double right) => left * right,
        onNegate: (double inner) => -inner);
// StoreQuery: minimal fold algebra for one-method interfaces
public abstract record StoreQuery<TResult> {
    public abstract TResult Fold(
        Func<GetById, TResult> onGetById,
        Func<Search, TResult> onSearch);
    public sealed record GetById(Guid Id) : StoreQuery<TResult>;
    public sealed record Search(string Term) : StoreQuery<TResult>;
}
```

[IMPORTANT]: Each new interpretation adds zero types -- only fold arguments change. The `_` arm with `UnreachableException` guards until C# ships first-class exhaustive DU matching.

---
## [6][CURRYING_PARTIAL]
>**Dictum:** *Partial application eliminates parameter repetition.*

`Curry` transforms a multi-argument function into a chain of single-argument functions. `Partial` fixes the first argument, producing a specialized function.

```csharp
public static Func<T1, Func<T2, TResult>> Curry<T1, T2, TResult>(
    Func<T1, T2, TResult> func) =>
    (T1 first) => (T2 second) => func(arg1: first, arg2: second);
public static Func<T2, TResult> Partial<T1, T2, TResult>(
    Func<T1, T2, TResult> func, T1 fixedArg) =>
    (T2 remaining) => func(arg1: fixedArg, arg2: remaining);
```

---
## [7][MEMOIZATION]
>**Dictum:** *Pure functions memoize safely; Lazy guarantees single invocation.*

`ConcurrentDictionary<TKey, Lazy<TResult>>` ensures thread-safe caching with single-invocation semantics. This is an intentional controlled-mutation boundary -- the mutable dictionary is an implementation detail invisible to consumers, preserving referential transparency at the API surface.

```csharp
namespace Domain.Composition;
public static class Memoization {
    public static Func<TKey, TResult> Memoize<TKey, TResult>(
        Func<TKey, TResult> func) where TKey : notnull {
        ConcurrentDictionary<TKey, Lazy<TResult>> cache = new();
        return (TKey key) => cache.GetOrAdd(
            key: key,
            valueFactory: (TKey cacheKey) =>
                new Lazy<TResult>(() => func(arg: cacheKey))).Value;
    }
    // Multi-arity: tuple-pack for composite key hashing
    public static Func<T1, T2, TResult> Memoize<T1, T2, TResult>(
        Func<T1, T2, TResult> func) where T1 : notnull where T2 : notnull {
        Func<(T1, T2), TResult> memoized = Memoize<(T1, T2), TResult>(
            func: ((T1, T2) args) => func(arg1: args.Item1, arg2: args.Item2));
        return (T1 first, T2 second) => memoized(key: (first, second));
    }
}
```

[IMPORTANT]: `GetOrAdd` with `Lazy<T>` guarantees the factory runs exactly once even under contention. `ConcurrentDictionary.GetOrAdd` alone permits concurrent factory execution.

---
## [8][LINQ_EXTENSIONS]
>**Dictum:** *LINQ vocabulary extends via C# 14 extension blocks.*

.NET 10 ships `CountBy`, `AggregateBy`, `LeftJoin`, and built-in `IAsyncEnumerable` LINQ. Custom operators like `Window` and `Scan` extend the vocabulary. For hot paths, prefer `Seq.Fold` / `Seq.Choose` over LINQ chains to avoid intermediate `IEnumerable` state machines.

```csharp
namespace Domain.Composition;
public static class LinqExtensions {
    extension<T>(IEnumerable<T> source) {
        public IEnumerable<IReadOnlyList<T>> Window(int size) =>
            source.Select((T item, int index) => (item, index))
                  .GroupBy(pair => pair.index / size)
                  .Select(group => group.Select(pair => pair.item).ToList());
        public IEnumerable<TAccumulate> Scan<TAccumulate>(
            TAccumulate seed,
            Func<TAccumulate, T, TAccumulate> func) =>
            source.Aggregate(
                seed: Seq(seed),
                func: (Seq<TAccumulate> acc, T item) =>
                    acc.Add(func(arg1: acc.Last, arg2: item)));
    }
}
// .NET 10 built-in: CountBy, AggregateBy, LeftJoin, WhereAwait (IAsyncEnumerable)
```

---
## [9][RULES]
>**Dictum:** *Rules compress into constraints.*

- [ALWAYS] `Pipe` for left-to-right application; `Compose` for function chaining.
- [ALWAYS] `params ReadOnlySpan<T>` for arity collapse -- one method, all arities.
- [ALWAYS] `K<F,A>` with `.As()` downcast at consumption boundaries.
- [ALWAYS] `Foldable<F>` / `Traversable<F>` constraints for container-generic algorithms.
- [ALWAYS] Extension blocks for behavior projection -- no singleton service classes.
- [ALWAYS] LanguageExt `HashMap`/`Seq`/`HashSet` over BCL immutable collections.
- [ALWAYS] DU + `Fold` catamorphism for algebras -- not visitor classes.
- [NEVER] Sibling method families (`Get`/`GetMany`/`GetOrDefault`) -- use typed queries.
- [NEVER] Manual overloads when `params ReadOnlySpan<T>` + algebraic constraints suffice.
- [NEVER] Consuming `K<F,A>` without `.As()` -- the concrete type is not accessible otherwise.

---
## [10][QUICK_REFERENCE]

| [INDEX] | [PATTERN]              | [WHEN]                                     | [KEY_TRAIT]                            |
| :-----: | ---------------------- | ------------------------------------------ | -------------------------------------- |
|   [1]   | `Pipe`/`Compose`       | Left-to-right data threading               | C# 14 extension + `AggressiveInlining` |
|   [2]   | Arity collapse         | Replace overload families                  | `params ReadOnlySpan<T>` + monoid      |
|   [3]   | Extension members      | Behavior projection onto data              | C# 14 `extension` block                |
|   [4]   | `K<F,A>` HKT + `.As()` | Algorithm generic over effect/container    | `Fallible`/`Applicative`/`Monad`       |
|   [5]   | Foldable/Traversable   | Container-generic fold, traverse, sequence | `Foldable<F>` / `Traversable<F>`       |
|   [6]   | Algebraic compression  | DU + Fold replaces N interpreters          | Catamorphism on sealed DU hierarchy    |
|   [7]   | Currying/Partial       | Fix arguments, build specialized functions | `Func<T1, Func<T2, R>>`                |
|   [8]   | Memoization            | Thread-safe pure function caching          | `ConcurrentDictionary` + `Lazy<T>`     |
|   [9]   | Custom LINQ            | Extend query vocabulary                    | `Window`/`Scan` via extension blocks   |
|  [10]   | Algebraic interface    | One method owns the concept                | `StoreQuery.Fold` dispatch             |
