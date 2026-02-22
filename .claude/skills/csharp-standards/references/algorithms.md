# [H1][ALGORITHMS]
>**Dictum:** *One polymorphic scheme replaces N bespoke implementations.*

<br>

Cross-cutting algorithmic patterns for C# 14 / .NET 10. Patterns absorbed into sibling files are cross-referenced, not duplicated. All snippets assume `using static LanguageExt.Prelude;` and `using LanguageExt;`.

---
## [0][IMPORTS]
>**Dictum:** *Declare imports once; reference across all sections.*

| [INDEX] | [NAMESPACE]                           | [KEY_SURFACE]                                                                | [SECTION] |
| :-----: | ------------------------------------- | ---------------------------------------------------------------------------- | :-------- |
|   [1]   | **`System.Numerics`**                 | `INumber<T>`, `INumberBase<T>`, `IAdditiveIdentity<T,T>`, `ISpanParsable<T>` | [4]       |
|   [2]   | **`System.Runtime.CompilerServices`** | `[MethodImpl(AggressiveInlining)]`                                           | [3], [6]  |
|   [3]   | **`System.Globalization`**            | `CultureInfo.InvariantCulture` for deterministic `ISpanParsable`             | [4]       |
|   [4]   | **`LanguageExt`**                     | `Seq<T>`, `Fin<T>`, `Option<T>`, `HashMap<K,V>`, `K<F,A>`                    | [1]-[6]   |
|   [5]   | **`LanguageExt.Traits`**              | `Fallible<F>`, `Monad<F>` for Kleisli generalization                         | [6]       |

---
## [1][RECURSION_SCHEMES]
>**Dictum:** *Factor out the recursion; vary only the algebra.*

<br>

Anamorphism (unfold) builds structure from a seed via coalgebra returning `Option<(TValue, TSeed)>` -- `None` terminates. Hylomorphism fuses unfold-then-fold in a single recursive descent (deforestation). Paramorphism folds with access to the unconsumed tail.

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
// K<F,A>-polymorphic variants -- generalize to Fin, Eff, Validation, any Monad<F>
// Coalgebra returns K<F, Option<(TValue, TSeed)>> for effectful seed expansion
// See composition.md [4] for the K<F,A> encoding mandate
public static class UnfoldK {
    public static K<F, Seq<TValue>> Execute<F, TSeed, TValue>(
        TSeed seed,
        Func<TSeed, K<F, Option<(TValue Value, TSeed Next)>>> coalgebra)
        where F : Monad<F> =>
        Monad.bind(coalgebra(seed), (Option<(TValue Value, TSeed Next)> step) =>
            step.Match(
                Some: ((TValue Value, TSeed Next) pair) =>
                    Monad.map(
                        Execute<F, TSeed, TValue>(seed: pair.Next, coalgebra: coalgebra),
                        (Seq<TValue> tail) => pair.Value.Cons(tail)),
                None: () => Monad.pure<F, Seq<TValue>>(Seq<TValue>.Empty)));
}
public static class HyloK {
    public static K<F, TResult> Execute<F, TSeed, TIntermediate, TResult>(
        TSeed seed,
        Func<TSeed, K<F, Option<(TIntermediate Value, TSeed Next)>>> coalgebra,
        TResult identity,
        Func<TResult, TIntermediate, TResult> algebra)
        where F : Monad<F> =>
        Monad.bind(coalgebra(seed), (Option<(TIntermediate Value, TSeed Next)> step) =>
            step.Match(
                Some: ((TIntermediate Value, TSeed Next) pair) =>
                    Monad.map(
                        Execute<F, TSeed, TIntermediate, TResult>(
                            seed: pair.Next, coalgebra: coalgebra,
                            identity: identity, algebra: algebra),
                        (TResult accumulated) => algebra(arg1: accumulated, arg2: pair.Value)),
                None: () => Monad.pure<F, TResult>(identity)));
}
```

[CRITICAL]: None of these schemes are tail-recursive. `Unfold`/`Hylo`: `Cons`/`algebra` wrap the recursive call, preventing TCO. `Para.FoldWithTail`: `span.Slice(start: 1)` holds previous `ReadOnlySpan<T>` on each stack frame -- for large spans (>1000 elements), prefer iterative `Seq.Fold` or a `while` loop with `[BoundaryImperativeExemption]` (see `performance.md` [2]). `UnfoldK`/`HyloK` inherit the same caveat. Keep depth bounded by coalgebra termination; for deep sequences prefer iterative `Seq.Unfold`. All use `Option<(TValue, TSeed)>` as termination signal. Use `.As()` to downcast HKT results: `UnfoldK.Execute<Fin, ...>(...).As()` yields `Fin<Seq<TValue>>`.

---
## [2][SINGLE_PASS_TRANSFORMS]
>**Dictum:** *One traversal; zero intermediate collections.*

<br>

`Seq.Choose` fuses map+filter in a single pass. `FoldWhile` short-circuits a fold when a predicate signals completion. See `composition.md` [3] for extension blocks; `types.md` [7] for `Seq<T>` semantics.

```csharp
// Domain.Algorithms (continued)
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
            static ((string Label, decimal Cost) item) => (item.Cost > 0m) switch {
                true => Some(item.Cost),
                false => Option<decimal>.None
            }).FoldWhile(
                seed: 0m,
                folder: static (decimal acc, decimal cost) => acc + cost,
                keepGoing: (decimal acc) => acc < budget) switch {
            decimal total => (total > 0m) switch {
                true => Fin.Succ(total),
                false => Fin.Fail<decimal>(Error.New(message: "No positive-cost items or zero sum"))
            }
        };
}
```

[CRITICAL]: `Choose` replaces `.Filter(...).Map(...)` chains that allocate intermediate `Seq` instances. `FoldWhile` checks the predicate on the current accumulator BEFORE folding the next element -- semantically "stop before the budget is exceeded." Both lambdas are `static` proving zero capture.

---
## [3][COMPILE_TIME_DISPATCH]
>**Dictum:** *Static abstract resolves strategy at compile time; zero virtual dispatch.*

<br>

Static abstract members encode type-class dispatch: factory methods, codecs, and defaults resolved by the JIT. Each constrained generic eliminates one strategy-pattern class hierarchy.

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
public interface IFactory<TSelf, TInput> where TSelf : IFactory<TSelf, TInput> {
    static abstract Fin<TSelf> Create(TInput input);
}
public readonly record struct JsonCodec : ICodec<JsonCodec> {
    public static string ContentType => "application/json";
    public static Fin<byte[]> Encode<T>(T value) =>
        Prelude.Try(() => JsonSerializer.SerializeToUtf8Bytes(value: value)).Run();
    public static Fin<T> Decode<T>(ReadOnlySpan<byte> data) =>
        JsonSerializer.Deserialize<T>(utf8Json: data) switch {
            { } result => Fin.Succ(result),
            null => Fin.Fail<T>(Error.New(message: "Null deserialization result"))
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

[IMPORTANT]: Multi-constraint type parameters (`IFactory` + `IDefault`) give compile-time ad-hoc polymorphism. `JsonCodec.Encode` wraps serialization in `Prelude.Try` to capture `JsonException` into `Fin`. The `{ }` pattern in `Decode` guarantees non-null without `!`.

---
## [4][GENERIC_MATH_ADVANCED]
>**Dictum:** *Narrow constraints widen applicability; bridge monoid and numeric.*

<br>

Extends `types.md` [6] with overflow-safe narrowing via `TryCreate`, allocation-free parsing via `ISpanParsable`, and a bridging pattern for dual `IAlgebraicMonoid` + `IAdditiveIdentity` participation. For `TensorPrimitives`, see `performance.md` [1].

```csharp
// Domain.Algorithms (continued)
public static class SafeConvert {
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Fin<TTarget> Execute<TSource, TTarget>(TSource value)
        where TSource : INumberBase<TSource>
        where TTarget : INumberBase<TTarget> =>
        TTarget.TryCreate(value: value, result: out TTarget? result) switch {
            true => Fin.Succ(result!),
            false => Fin.Fail<TTarget>(
                Error.New(message: "Numeric overflow on conversion"))
        };
}
public static class SpanParsing {
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Fin<T> ParseSpannable<T>(ReadOnlySpan<char> text)
        where T : ISpanParsable<T> =>
        T.TryParse(
            s: text,
            provider: CultureInfo.InvariantCulture,
            result: out T? parsed) switch {
            true => Fin.Succ(parsed!),
            false => Fin.Fail<T>(
                Error.New(message: "Failed to parse from span"))
        };
}
public sealed record MoneyAmount :
    IAlgebraicMonoid<MoneyAmount>,
    IAdditiveIdentity<MoneyAmount, MoneyAmount> {
    public long Cents { get; }
    private MoneyAmount(long cents) => Cents = cents;
    public static MoneyAmount Identity => new(cents: 0L);
    public static MoneyAmount AdditiveIdentity => Identity;
    public static MoneyAmount Combine(
        MoneyAmount leftOperand, MoneyAmount rightOperand) =>
        new(cents: leftOperand.Cents + rightOperand.Cents);
    public static Fin<MoneyAmount> Create(long cents) =>
        (cents >= 0L) switch {
            true => Fin.Succ(new MoneyAmount(cents: cents)),
            false => Fin.Fail<MoneyAmount>(
                Error.New(message: "Negative amount"))
        };
}
```

[CRITICAL]: `SafeConvert.Execute` constrains to `INumberBase<T>` (not heavier `INumber<T>`) for `TryCreate` overflow safety. `MoneyAmount` uses `{ get; }` only (no `init`) to prevent `with`-expression bypass of the smart constructor invariant.

---
## [5][BRANCHING_SCOPED_COMPUTATION]
>**Dictum:** *Nested switch seals bindings per arm; unify through `Fin<T>`.*

<br>

Extends `performance.md` [7] with multi-path branching: each `when` arm opens its own tuple-binding scope, bindings cannot leak to siblings. C# encoding of ML `match ... with | pattern -> let x = ... in ...`.

```csharp
// Domain.Algorithms (continued)
public static class BranchingScope {
    public static Fin<decimal> ComputeTieredDiscount(
        Seq<decimal> lineItems,
        decimal loyaltyMultiplier) =>
        lineItems.IsEmpty switch {
            true => Fin.Fail<decimal>(
                Error.New(message: "Empty order")),
            false => lineItems.Fold(
                state: 0m,
                folder: static (decimal acc, decimal item) => acc + item) switch {
                decimal total when total > 1000m => (
                    baseRate: total * 0.10m,
                    loyaltyBonus: loyaltyMultiplier * 0.05m * total) switch {
                    (decimal baseRate, decimal loyaltyBonus) =>
                        Fin.Succ(baseRate + loyaltyBonus)
                },
                decimal total when total > 500m =>
                    Fin.Succ(total * 0.05m),
                _ => Fin.Succ(0m)
            }
        };
}
```

[IMPORTANT]: The inner `(baseRate, loyaltyBonus) switch` seals both variables to the `> 1000m` arm exclusively. The `static` on the fold lambda proves zero capture of `loyaltyMultiplier` (referenced only in the outer switch arm scope, not inside the closure).

---
## [6][KLEISLI_COMPOSITION]
>**Dictum:** *Kleisli arrows compose effectful functions as naturally as pure ones.*

<br>

Kleisli composition chains `A -> K<F, B>` functions without manual `Bind` threading. `ComposeK` produces a new arrow; `PipeK` applies immediately. Effectful counterpart to `Compose` in `composition.md` [1].

```csharp
// Domain.Algorithms (continued)
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

[IMPORTANT]: `ComposeK` lifts composition to the effectful level -- `ComposeK(validate, persist)` short-circuits on first `Fin.Fail`. Generalizing to `K<F, B>` requires `Monad<F>` -- see `composition.md` [4], which generalizes Kleisli to `K<F,A>` with `Monad<F>` constraint.

---
## [7][CROSS_REFERENCES]
Patterns fully covered in sibling files -- consult directly:
- **Algebraic compression** -- `composition.md` [5] for DU + Fold catamorphism.
- **Span algorithms** -- `performance.md` [7] for `BinarySearch`, `Sort`, Either-splitting `SeparateEither` (note: `SeparateEither` uses `.Cons` + `.Rev()` for O(1) prepend in fold accumulators -- never `.Add`).
- **SIMD / TensorPrimitives** -- `performance.md` [1],[2] for Vector SIMD (including Vector512 gating) and numeric aggregation.

---
## [8][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] `Unfold.Execute` / `Hylo.Execute` for seed-to-sequence / fused unfold+fold -- same coalgebra pattern family.
- [ALWAYS] `FoldWhile` for early-exit aggregation on ordered data -- never process past the threshold.
- [ALWAYS] `Choose` over `.Filter(...).Map(...)` chains -- single pass, zero intermediate sequences.
- [ALWAYS] Static abstract interfaces for compile-time dispatch -- no runtime dictionary, no class hierarchies.
- [ALWAYS] `SafeConvert.Execute` for numeric narrowing -- never `Convert.ToInt32` or unchecked casts.
- [ALWAYS] `ISpanParsable<TSelf>` for generic parsing; `ComposeK` for `A -> Fin<B>` chains.
- [ALWAYS] Branching nested switch for scoped let-bindings -- each arm seals its own variables.
- [NEVER] Bespoke recursive functions when a recursion scheme (`Unfold`, `Hylo`, `Para`) suffices.
- [NEVER] `.Filter(...).Map(...)` chains on `Seq<T>` -- use `Choose` for fused single-pass.
- [NEVER] `Seq<T>.Add` inside fold accumulators -- `.Add` is O(N) array-double-and-copy. Use `.Cons` (O(1) prepend) + `.Rev()` at fold boundary. See `performance.md` [7] `SeparateEither` for corrected pattern.

---
## [9][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                | [WHEN]                                          | [KEY_TRAIT]                                |
| :-----: | ------------------------ | ----------------------------------------------- | ------------------------------------------ |
|   [1]   | Recursion schemes        | Unfold/Hylo/Para + HKT variants (UnfoldK/HyloK) | `Option<(V, TSeed)>` coalgebra; `Monad<F>` |
|   [2]   | FoldWhile                | Early-exit aggregation on ordered data          | Predicate-gated tail recursion             |
|   [3]   | Choose                   | Single-pass map+filter                          | `Seq.Choose` with `Option<T>` selector     |
|   [4]   | Compile-time dispatch    | Strategy/factory without runtime polymorphism   | Static abstract + JIT monomorph            |
|   [5]   | SafeConvert              | Overflow-safe numeric narrowing                 | `INumberBase.TryCreate`                    |
|   [6]   | ISpanParsable            | Generic allocation-free parsing                 | `T.TryParse(ReadOnlySpan<char>, ...)`      |
|   [7]   | Algebraic+numeric bridge | Monoid that participates in generic math        | `IAlgebraicMonoid` + `IAdditiveIdentity`   |
|   [8]   | Branching scope          | Different bindings per switch arm               | Nested switch + tuple deconstruction       |
|   [9]   | Kleisli composition      | Chain effectful `A -> Fin<B>` functions         | `ComposeK` + `Bind` short-circuit          |
