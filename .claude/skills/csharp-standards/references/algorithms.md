# [H1][ALGORITHMS]
>**Dictum:** *Algorithmic density collapses N bespoke implementations into one polymorphic scheme; each section earns its place by covering patterns absent from sibling references.*

Cross-cutting algorithmic patterns for C# 14 / .NET 10 that span composition and performance boundaries. Patterns absorbed into sibling files are cross-referenced, not duplicated. All snippets assume `using static LanguageExt.Prelude;` and `using LanguageExt;`.

---
## [0][IMPORTS]
>**Dictum:** *A functional algorithm author commands these namespaces.*

Snippets in this file assume or demonstrate patterns from the following advanced namespaces. This is the toolkit for algorithm-dense C# 14 / .NET 10 code.

| [NAMESPACE]                       | [KEY_SURFACE]                                                                | [SECTION] |
| --------------------------------- | ---------------------------------------------------------------------------- | --------- |
| `System.Numerics`                 | `INumber<T>`, `INumberBase<T>`, `IAdditiveIdentity<T,T>`, `ISpanParsable<T>` | [4]       |
| `System.Numerics.Tensors`         | `TensorPrimitives.Sum`, `Multiply`, `Dot`, `CosineSimilarity`                | [4]       |
| `System.Runtime.CompilerServices` | `[MethodImpl(AggressiveInlining)]`                                           | [3], [6]  |
| `System.Runtime.InteropServices`  | `MemoryMarshal.GetReference` for `Vector512.LoadUnsafe`                      | perf [3]  |
| `System.Globalization`            | `CultureInfo.InvariantCulture` for deterministic `ISpanParsable`             | [4]       |
| `LanguageExt`                     | `Seq<T>`, `Fin<T>`, `Option<T>`, `HashMap<K,V>`, `K<F,A>`                    | [1]-[6]   |
| `LanguageExt.Traits`              | `Fallible<F>`, `Monad<F>` for Kleisli generalization                         | [6]       |

---
## [1][RECURSION_SCHEMES]
>**Dictum:** *Factor out the recursion; vary only the algebra.*

Anamorphism (unfold) builds structure from a seed via coalgebra returning `Option<(TValue, TSeed)>` -- `None` terminates. Hylomorphism fuses unfold-then-fold in a single recursive descent so the intermediate structure never materializes (deforestation). Paramorphism folds with access to the unconsumed tail, enabling lookahead decisions impossible with a standard fold.

```csharp
namespace Domain.Algorithms;

public static class Unfold {
    public static Seq<TValue> Execute<TSeed, TValue>(
        TSeed seed,
        Func<TSeed, Option<(TValue Value, TSeed Next)>> coalgebra) =>
        coalgebra(seed).Match(
            Some: ((TValue Value, TSeed Next) pair) => pair.Value.Cons(Execute(seed: pair.Next, coalgebra: coalgebra)),
            None: () => Seq<TValue>.Empty);
}
public static class Hylo {
    public static TResult Execute<TSeed, TIntermediate, TResult>(
        TSeed seed,
        Func<TSeed, Option<(TIntermediate Value, TSeed Next)>> coalgebra,
        TResult identity,
        Func<TResult, TIntermediate, TResult> algebra) =>
        coalgebra(seed).Match(
            Some: ((TIntermediate Value, TSeed Next) pair) => algebra(
                arg1: Execute(
                    seed: pair.Next,
                    coalgebra: coalgebra,
                    identity: identity,
                    algebra: algebra),
                arg2: pair.Value),
            None: () => identity);
}
public static class Para {
    extension<T>(ReadOnlySpan<T> span) {
        public TResult FoldWithTail<TResult>(
            TResult seed,
            Func<TResult, T, ReadOnlySpan<T>, TResult> folder) =>
            span.Length switch {
                0 => seed,
                _ => span.Slice(start: 1).FoldWithTail(
                    seed: folder(seed, span[0], span.Slice(start: 1)),
                    folder: folder)
            };
    }
}
```

[IMPORTANT]: `Hylo.Execute` eliminates one full traversal and one intermediate `Seq` allocation versus piping `Unfold` into `Fold` -- deforestation. Use `Hylo` when the seed-to-result path is linear and the intermediate structure is consumed immediately; use `Unfold` when the materialized sequence itself is the return value. `FoldWithTail` enables paramorphic patterns like run-length encoding where each step inspects the remainder. Termination: all three terminate because `coalgebra` produces `None` for a base case (anamorphism/hylomorphism) and `span.Length` decreases monotonically by one per call (paramorphism).

[CRITICAL]: All three schemes use `Option<(TValue, TSeed)>` as the termination signal rather than a boolean flag -- this makes the coalgebra total and composable with `Bind`/`Map` on `Option`.

---
## [2][SINGLE_PASS_TRANSFORMS]
>**Dictum:** *One traversal; zero intermediate collections.*

`Seq.Choose` fuses map+filter into a single pass -- `Option.None` skips, `Some` includes. `FoldWhile` short-circuits a fold when a predicate signals completion, avoiding full-sequence traversal on ordered data. See `composition.md` [3] for extension block mechanics; `types.md` [7] for `Seq<T>` collection semantics.

```csharp
namespace Domain.Algorithms;

public static class SinglePass {
    extension<T>(Seq<T> source) {
        public TAccumulate FoldWhile<TAccumulate>(
            TAccumulate seed,
            Func<TAccumulate, T, TAccumulate> folder,
            Func<TAccumulate, bool> keepGoing) =>
            source.IsEmpty switch {
                true => seed,
                false => keepGoing(seed) switch {
                    false => seed,
                    true => source.Tail.FoldWhile(
                        seed: folder(arg1: seed, arg2: source.Head),
                        folder: folder,
                        keepGoing: keepGoing)
                }
            };
    }
    public static Fin<decimal> SumUntilBudget(
        Seq<(string Label, decimal Cost)> items,
        decimal budget) =>
        items.Choose(
            ((string Label, decimal Cost) item) => (item.Cost > 0m) switch {
                true => Some(item.Cost),
                false => Option<decimal>.None
            }).FoldWhile(
                seed: 0m,
                folder: static (decimal acc, decimal cost) => acc + cost,
                keepGoing: (decimal acc) => acc < budget) switch {
            decimal total when total > 0m => FinSucc(total),
            _ => FinFail<decimal>(Error.New(message: "No positive-cost items or zero sum"))
        };
}
```

[CRITICAL]: `Choose` replaces `.Filter(...).Map(...)` chains that allocate intermediate `Seq` instances. `FoldWhile` checks the predicate on the current accumulator BEFORE folding the next element -- semantically "stop accepting when the budget is already met." The `static` on the folder lambda proves zero capture. The outer `switch` uses a `when` guard to distinguish genuine positive accumulation from degenerate zero-sum.

---
## [3][COMPILE_TIME_DISPATCH]
>**Dictum:** *Static abstract interfaces resolve strategy at compile time; zero virtual calls, zero DI.*

Beyond `IAlgebraicMonoid` (see `composition.md` [2]), static abstract members encode type-class style dispatch: factory methods, serialization codecs, and default values resolved entirely by the JIT. Each generic function constrained to a static abstract interface eliminates one strategy-pattern class hierarchy. The JIT monomorphizes per instantiation -- performance equals hand-written specialization.

```csharp
namespace Domain.Algorithms;

public interface ICodec<TSelf> where TSelf : ICodec<TSelf> {
    static abstract string ContentType { get; }
    static abstract Fin<byte[]> Encode<T>(T value);
    static abstract Fin<T> Decode<T>(ReadOnlySpan<byte> data);
}
public interface IDefault<TSelf> where TSelf : IDefault<TSelf> {
    static abstract TSelf Default { get; }
}
public interface IFactory<TSelf, TInput>
    where TSelf : IFactory<TSelf, TInput> {
    static abstract Fin<TSelf> Create(TInput input);
}

public readonly struct JsonCodec : ICodec<JsonCodec> {
    public static string ContentType => "application/json";
    public static Fin<byte[]> Encode<T>(T value) => FinSucc(JsonSerializer.SerializeToUtf8Bytes(value: value));
    public static Fin<T> Decode<T>(ReadOnlySpan<byte> data) =>
        JsonSerializer.Deserialize<T>(utf8Json: data) switch {
            T result => FinSucc(result),
            null => FinFail<T>(Error.New(message: "Null deserialization result"))
        };
}
public static class CodecDispatch {
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Fin<byte[]> EncodeWith<TCodec, T>(T value)
        where TCodec : ICodec<TCodec> =>
        TCodec.Encode(value: value);
}
public static class TypeClassComposition {
    public static TSelf CreateOrDefault<TSelf, TInput>(TInput input)
        where TSelf : IFactory<TSelf, TInput>, IDefault<TSelf> =>
        TSelf.Create(input: input).Match(
            Succ: (TSelf value) => value,
            Fail: (Error _) => TSelf.Default);
}
```

[IMPORTANT]: Composing multiple static abstract interfaces (`IFactory` + `IDefault`) on a single type parameter gives compile-time ad-hoc polymorphism -- the C# equivalent of Haskell multi-constraint type classes. `CreateOrDefault` works for any type satisfying both contracts without runtime reflection or DI registration.

---
## [4][GENERIC_MATH_ADVANCED]
>**Dictum:** *Narrow constraints widen applicability; bridge algebraic and numeric worlds.*

Extends `types.md` [6] with `SafeConvert` via `INumberBase<T>.TryCreate` for overflow-safe numeric narrowing, `ISpanParsable<TSelf>` for generic allocation-free parsing, a bridging pattern that makes a domain type participate in both `Aggregate` (via `IAlgebraicMonoid`) and generic numeric algorithms (via `IAdditiveIdentity`), and `TensorPrimitives` for hardware-accelerated span-level math.

```csharp
namespace Domain.Algorithms;

public static class SafeConvert {
    public static Fin<TTarget> Execute<TSource, TTarget>(TSource value)
        where TSource : INumberBase<TSource>
        where TTarget : INumberBase<TTarget> =>
        TTarget.TryCreate(value: value, result: out TTarget? result) switch {
            true => FinSucc(result!),
            false => FinFail<TTarget>(
                Error.New(message: "Numeric overflow on conversion"))
        };
}
public static class ParseHelpers {
    public static Fin<T> ParseSpannable<T>(ReadOnlySpan<char> text)
        where T : ISpanParsable<T> =>
        T.TryParse(
            s: text,
            provider: CultureInfo.InvariantCulture,
            result: out T? parsed) switch {
            true => FinSucc(parsed!),
            false => FinFail<T>(
                Error.New(message: "Failed to parse from span"))
        };
}
public readonly record struct MoneyAmount :
    IAlgebraicMonoid<MoneyAmount>,
    IAdditiveIdentity<MoneyAmount, MoneyAmount> {
    public long Cents { get; init; }
    private MoneyAmount(long cents) => Cents = cents;
    public static MoneyAmount Identity => new(cents: 0L);
    public static MoneyAmount AdditiveIdentity => Identity;
    public static MoneyAmount Combine(
        MoneyAmount leftOperand, MoneyAmount rightOperand) =>
        new(cents: leftOperand.Cents + rightOperand.Cents);
    public static Fin<MoneyAmount> Create(long cents) =>
        (cents >= 0L) switch {
            true => FinSucc(new MoneyAmount(cents: cents)),
            false => FinFail<MoneyAmount>(
                Error.New(message: "Negative amount"))
        };
}
public static class TensorAlgorithms {
    public static Fin<T> DotProduct<T>(
        ReadOnlySpan<T> left, ReadOnlySpan<T> right)
        where T : INumber<T> =>
        (left.Length == right.Length) switch {
            true => FinSucc(TensorPrimitives.Dot(x: left, y: right)),
            false => FinFail<T>(
                Error.New(message: "Span length mismatch for dot product"))
        };
}
```

[CRITICAL]: `SafeConvert.Execute` uses `TryCreate` -- the .NET generic math cross-type conversion that handles overflow without exceptions. Constraint requires only `INumberBase<T>`, not the heavier `INumber<T>`, because `TryCreate` is defined on `INumberBase`. `MoneyAmount` bridges algebraic composition (`Aggregate` from `composition.md` [2]) and generic numeric contexts. `TensorPrimitives.Dot` dispatches to AVX-512/AVX2/SSE automatically -- zero heap during computation; `Fin<T>` wraps the boundary.

---
## [5][BRANCHING_SCOPED_COMPUTATION]
>**Dictum:** *Nested switch expressions seal each binding to its exact scope; different arms introduce different bindings, then unify through `Fin<T>`.*

Extends `performance.md` [7] sequential hygienic scoping with multi-path branching: each `when` arm opens its own tuple-binding scope, and bindings from one arm cannot leak to siblings. This is the C# encoding of ML-family `match ... with | pattern -> let x = ... in ...`.

```csharp
namespace Domain.Algorithms;

public static class BranchingScope {
    public static Fin<decimal> ComputeTieredDiscount(
        Seq<decimal> lineItems,
        decimal loyaltyMultiplier) =>
        lineItems.IsEmpty switch {
            true => FinFail<decimal>(
                Error.New(message: "Empty order")),
            false => lineItems.Fold(
                state: 0m,
                folder: static (decimal acc, decimal item) => acc + item) switch {
                decimal total when total > 1000m => (
                    baseRate: total * 0.10m,
                    loyaltyBonus: loyaltyMultiplier * 0.05m * total) switch {
                    (decimal baseRate, decimal loyaltyBonus) =>
                        FinSucc(baseRate + loyaltyBonus)
                },
                decimal total when total > 500m =>
                    FinSucc(total * 0.05m),
                _ => FinSucc(0m)
            }
        };
}
```

[IMPORTANT]: The inner `(baseRate, loyaltyBonus) switch` seals both variables to the `> 1000m` arm exclusively -- they cannot leak to the `> 500m` arm or the default. The `static` on the fold lambda proves zero capture of `loyaltyMultiplier` (the fold receives only `acc` and `item`; `loyaltyMultiplier` is referenced only in the outer switch arm, which is a method-scope value, not a closure). Use this pattern when different computation paths require different intermediate bindings that must not escape their branch.

---
## [6][KLEISLI_COMPOSITION]
>**Dictum:** *Kleisli arrows compose effectful functions as naturally as pure functions compose.*

Kleisli composition chains functions of shape `A -> K<F, B>` into pipelines without manual `Bind` threading. `ComposeK` produces a new Kleisli arrow; `PipeK` applies one immediately. This is the effectful counterpart to `Compose` in `composition.md` [1].

```csharp
namespace Domain.Algorithms;

public static class Kleisli {
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Func<TInput, Fin<TOutput>> ComposeK<TInput, TMiddle, TOutput>(
        Func<TInput, Fin<TMiddle>> first,
        Func<TMiddle, Fin<TOutput>> second) =>
        (TInput input) => first(input).Bind(second);
    extension<TInput>(TInput value) {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public Fin<TOutput> PipeK<TOutput>(
            Func<TInput, Fin<TOutput>> arrow) =>
            arrow(value);
    }
}
```

[IMPORTANT]: `ComposeK` is to `Bind` what `Compose` is to function application -- it lifts composition to the effectful level. A pipeline `ComposeK(validateAge, ComposeK(validateName, persist))` short-circuits on the first `Fin.Fail`. The encoding here is specialized to `Fin<T>`; generalizing to `K<F, B>` requires the `Monad<F>` constraint -- see `composition.md` [4] for the HKT encoding. `PipeK` as a C# 14 extension member enables `rawInput.PipeK(validateAndPersist)` syntax.

---
## [7][CROSS_REFERENCES]

Patterns fully covered in sibling files -- consult directly:

- **Algebraic compression** (DU + Fold catamorphism) -- `composition.md` [5] for `Expr.Fold`, `StoreQuery`, multiple interpretations from a single sealed hierarchy.
- **Foldable / Traversable traits** -- `composition.md` [4] for `Sum<F,T>`, `All<F,T>`, `TraverseGeneric`, `Sequence`, and `IUniversalStateElevator`.
- **Span algorithms** (sort, binary search, partition) -- `performance.md` [8] for `MemoryExtensions.Sort`, `BinarySearch`, tail-recursive `Partition`.
- **Functional collections** (Seq, HashMap, HashSet, Map) -- `types.md` [7] for collection taxonomy, CHAMP backing, and usage matrix.
- **Sequential hygienic scoping** (nested switch let-bindings) -- `performance.md` [7] for static lambda tuple threading and `EvaluatePortfolio` pattern.
- **SIMD branchless vectorization** -- `performance.md` [3] for `Vector512`, `GreaterThan`, `ConditionalSelect`, `MemoryMarshal.GetReference`.
- **Lens / Optics** for deep immutable updates -- planned for `composition.md`; LanguageExt v5 provides `Lens<A,B>` with `|` composition and `Update` for nested record mutation.

---
## [8][RULES]
>**Dictum:** *Rules compress into constraints.*

- [ALWAYS] `Unfold.Execute` for seed-to-sequence generation; `Hylo.Execute` for fused unfold+fold without intermediate allocation.
- [ALWAYS] `FoldWhile` for early-exit aggregation on ordered data -- never process past the threshold.
- [ALWAYS] `Choose` over `.Filter(...).Map(...)` chains -- single pass, zero intermediate sequences.
- [ALWAYS] Static abstract interfaces for compile-time strategy dispatch -- no runtime dictionary, no DI for pure strategies.
- [ALWAYS] `SafeConvert.Execute` for cross-type numeric narrowing -- never cast without `TryCreate`.
- [ALWAYS] `ISpanParsable<TSelf>` constraint for generic parsing pipelines -- one function parses any conforming type.
- [ALWAYS] `TensorPrimitives` for span-level numeric reductions (`Sum`, `Dot`, `Multiply`) -- hardware-accelerated, zero heap.
- [ALWAYS] Branching nested switch for scoped let-bindings -- each arm seals its own variables.
- [ALWAYS] `ComposeK` for chaining `A -> Fin<B>` functions -- Kleisli composition reads left-to-right.
- [NEVER] Bespoke recursive functions when a recursion scheme (`Unfold`, `Hylo`, `Para`) captures the pattern.
- [NEVER] Strategy/factory class hierarchies when static abstract interfaces suffice.
- [NEVER] `Convert.ToInt32` or unchecked casts for numeric narrowing -- use `SafeConvert.Execute`.
- [NEVER] `.Filter(...).Map(...)` chains on `Seq<T>` -- use `Choose` for fused single-pass map+filter.
- [NEVER] Full-sequence traversal when a threshold terminates early -- use `FoldWhile`.
- [NEVER] `INumber<T>` when `INumberBase<T>` or finer-grained interfaces suffice -- narrow constraints widen applicability.

---
## [9][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                | [WHEN]                                          | [KEY_TRAIT]                                |
| :-----: | ------------------------ | ----------------------------------------------- | ------------------------------------------ |
|   [1]   | Anamorphism (Unfold)     | Generate structure from seed                    | `Option<(V, TSeed)>` coalgebra             |
|   [2]   | Hylomorphism             | Fused unfold+fold, zero intermediate allocation | Deforestation via single recursive descent |
|   [3]   | Paramorphism             | Fold needing lookahead into remaining structure | `FoldWithTail` on `ReadOnlySpan<T>`        |
|   [4]   | FoldWhile                | Early-exit aggregation on ordered data          | Predicate-gated tail recursion on `Seq<T>` |
|   [5]   | Choose                   | Single-pass map+filter                          | `Seq.Choose` with `Option<T>` selector     |
|   [6]   | Compile-time dispatch    | Strategy/factory without runtime polymorphism   | Static abstract interface + JIT monomorph  |
|   [7]   | SafeConvert              | Overflow-safe numeric narrowing                 | `INumberBase.TryCreate`                    |
|   [8]   | ISpanParsable            | Generic allocation-free parsing                 | `T.TryParse(ReadOnlySpan<char>, ...)`      |
|   [9]   | Algebraic+numeric bridge | Monoid that participates in generic math        | `IAlgebraicMonoid` + `IAdditiveIdentity`   |
|  [10]   | TensorPrimitives         | Hardware-accelerated span-level math            | `Dot`, `Sum`, `Multiply` over `Span<T>`    |
|  [11]   | Branching scope          | Different bindings per switch arm               | Nested switch + tuple deconstruction       |
|  [12]   | Kleisli composition      | Chain effectful `A -> Fin<B>` functions         | `ComposeK` + `Bind` short-circuit          |
