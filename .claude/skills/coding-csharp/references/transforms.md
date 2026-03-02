# Transforms

Compositional logic substrate for C# 14 / .NET 10. Every code body across all reference files is written in this style — transforms.md defines what "algorithmic, functional, ROP-driven code" means at the logic level. All snippets assume `using static LanguageExt.Prelude;` and `using LanguageExt;`.

---

## Discriminant Projection

Push all branching into data shape; compute with invariant functions. A closed domain maps each discriminant to exactly one projection — generated dispatch enforces totality at compile time where pattern matching only warns. Project to functions, not values, when the discriminant selects a computation — same projections compose monadically (short-circuit) or applicatively (accumulation).

```csharp
namespace Domain.Billing;

[Union]
public partial record Adjustment<TScalar> where TScalar : INumber<TScalar> {
    public sealed record Percentage(TScalar Rate) : Adjustment<TScalar>;
    public sealed record Fixed(TScalar Amount) : Adjustment<TScalar>;
    public sealed record Capped(TScalar Rate, TScalar Ceiling) : Adjustment<TScalar>;
}

public static class AdjustmentProjection {
    public static Func<TScalar, Fin<TScalar>> Project<TScalar>(Adjustment<TScalar> adjustment)
        where TScalar : INumber<TScalar> =>
        (TScalar subtotal) => adjustment.Switch(subtotal,
            percentage: static (TScalar s, Adjustment<TScalar>.Percentage p) => FinSucc(s * p.Rate),
            @fixed: static (TScalar s, Adjustment<TScalar>.Fixed f) => (s >= f.Amount) switch {
                true => FinSucc(s - f.Amount),
                false => FinFail<TScalar>(Error.New(message: "Fixed discount exceeds subtotal"))
            },
            capped: static (TScalar s, Adjustment<TScalar>.Capped c) => FinSucc(TScalar.Min(s * c.Rate, c.Ceiling)));
    public static Fin<TScalar> ApplyAll<TScalar>(
        TScalar subtotal,
        Seq<Adjustment<TScalar>> adjustments)
        where TScalar : INumber<TScalar> =>
        adjustments
            .Map(Project)
            .Fold(
                initialState: FinSucc(subtotal),
                f: static (Fin<TScalar> acc, Func<TScalar, Fin<TScalar>> transform) => acc.Bind(transform));
    public static Validation<Error, Seq<TScalar>> ValidateAll<TScalar>(
        TScalar subtotal,
        Seq<Adjustment<TScalar>> adjustments)
        where TScalar : INumber<TScalar> =>
        adjustments
            .Map(Project)
            .Map((Func<TScalar, Fin<TScalar>> f) => f(subtotal).ToValidation())
            .Traverse(identity);
}
```

- `Project` dispatches at call time via `adjustment.Switch(subtotal, ...)` — `subtotal` threads as `TState`, making all three branch lambdas `static` with zero display-class allocation. `@fixed:` escapes the C# keyword in the generated named argument.
- `ApplyAll` composes through monadic `Bind` (short-circuits on failure); `ValidateAll` reuses the same `Project` under applicative `Traverse(identity)` — `.ToValidation()` bridges `Fin` to error accumulation.
- Fold lambda `static` — `acc` and `transform` are both parameters. Adding a fourth variant breaks all `Switch` call sites at compile time.

---

## Recursion Schemes

Pack expansion worklist and fold accumulator into one compound state — trampolining drives coalgebra and algebra simultaneously without materializing intermediate structure. Coalgebra returns zero or more successors per seed: singleton for linear recursion, multiple children for tree traversal, empty for leaf/prune. Both operate in the effect layer: coalgebra can fail mid-expansion, algebra can reject mid-accumulation, with short-circuit propagating through bind. Trampolining mechanism is effect-determined — synchronous loop or async state machine with cancellation per iteration.

```csharp
namespace Domain.Transforms;

public static class Schemes {
    public static K<TM, TResult> HyloM<TM, TSeed, TAccum, TResult>(
        TSeed seed,
        Func<TSeed, K<TM, Option<(TAccum Value, Seq<TSeed> Next)>>> coalgebra,
        TResult identity,
        Func<TResult, TAccum, K<TM, TResult>> algebra)
        where TM : Monad<TM> =>
        Monad.recur<TM, (Seq<TSeed>, TResult), TResult>(
            (Seq(seed), identity),
            ((Seq<TSeed> Pending, TResult Acc) state) =>
                state.Pending.Head.Match(
                    Some: (TSeed current) =>
                        from step in coalgebra(current)
                        from acc in step.Match(
                            Some: s => algebra(state.Acc, s.Value),
                            None: () => Monad.pure<TM, TResult>(state.Acc))
                        select Next.Loop<(Seq<TSeed>, TResult), TResult>(
                            (step.Map(s => s.Next + state.Pending.Tail).IfNone(state.Pending.Tail), acc)),
                    None: () =>
                        Monad.pure<TM, Next<(Seq<TSeed>, TResult), TResult>>(
                            Next.Done<(Seq<TSeed>, TResult), TResult>(state.Acc))));
}
```

- `(Seq(seed), identity)` compound worklist fuses pending seeds and fold accumulator — `Next.Loop`/`Next.Done` controls iteration via trampoline, not recursive calls, bypassing .NET's ~1,500-frame closure stack limit.
- `step` dual-use in LINQ: `Match` extracts monadic accumulation (algebra on `Some`, identity on leaf), `Map`/`IfNone` extracts worklist management (children prepended for DFS, tail on leaf) — single `Next.Loop` unifies both branches.
- Worklist empty (`Head → None`) is the sole structural termination via `Next.Done`. Inner `None` (leaf/prune) feeds through `IfNone(state.Pending.Tail)` and `Monad.pure` identity — no separate loop construction.

---

## Traversal Fusion

Splitting selection and measurement into separate filter and map passes forces the fold to rediscover what the filter already knew. Fusing selector, accumulator, termination, and projection into one parameterized pass eliminates that redundancy. Hoisting invariants into the fold seed widens the accumulator but makes every closure `static` — zero display-class allocation, provable at the keyword.

```csharp
namespace Domain.Transforms;

public static class Fusion {
    public static R FuseWhile<T, S, P, R>(
        Seq<T> source,
        Func<T, Option<P>> selector,
        S seed,
        Func<S, P, S> folder,
        Func<(S State, P Value), bool> keepGoing,
        Func<S, R> project) =>
        project(source.Choose(selector).FoldWhile(initialState: seed, f: folder, predicate: keepGoing));
    public static (Seq<R> Collected, M Total) CollectUnder<T, R, M>(
        Seq<T> source,
        Func<T, Option<(R Item, M Measure)>> selector,
        M cap)
        where M : INumber<M> =>
        FuseWhile(
            source: source,
            selector: selector,
            seed: (Collected: Seq<R>(), Total: M.AdditiveIdentity, Cap: cap),
            folder: static ((Seq<R> Collected, M Total, M Cap) acc, (R Item, M Measure) entry) =>
                (entry.Item.Cons(acc.Collected), acc.Total + entry.Measure, acc.Cap),
            keepGoing: static (((Seq<R> Collected, M Total, M Cap) State, (R Item, M Measure) Value) pair) =>
                pair.State.Total + pair.Value.Measure <= pair.State.Cap,
            project: static ((Seq<R> Collected, M Total, M Cap) state) => (state.Collected.Rev(), state.Total));
}
```

- `FuseWhile` signature captures the five decisions any fused traversal must make — the body is a single `Choose` → `FoldWhile` → `project` expression.
- `CollectUnder` hoists `cap` into the seed tuple, making all three lambdas `static` — the predicate reads `Cap` from `State` instead of closing over it.
- `.Cons` accumulates in reverse; `.Rev()` in the projection restores insertion order — `.Add` (Snoc) forces evaluation on every element.

---

## Static Resolution

When all arithmetic lives in a single flat interface, the compiler cannot distinguish `TPos + TPos` (category error) from `TPos + TDist` (valid displacement). Stratifying operators across a trait hierarchy — validated construction, vector arithmetic, cross-type displacement — lets each constraint admit exactly the operations its algorithm requires. The compiler rejects operations at the wrong stratum.

```csharp
namespace Domain.Transforms;

public interface IMeasurable<TSelf, TScalar> :
    Amount<TSelf, TScalar>, DomainType<TSelf, TScalar>, IAdditiveIdentity<TSelf, TSelf>
    where TSelf : IMeasurable<TSelf, TScalar>
    where TScalar : INumber<TScalar>;

public static class Resolution {
    public static Fin<TPos> AffineCentroid<TPos, TDist, TScalar>(
        Seq<TScalar> raw, TDist maxDeviation)
        where TPos : Locus<TPos, TDist, TScalar>, DomainType<TPos, TScalar>
        where TDist : IMeasurable<TDist, TScalar>
        where TScalar : INumber<TScalar>
        => from positions in raw.TraverseM(TPos.From).As()
           from origin in positions.Head.ToFin(Error.New(message: "empty sequence"))
           from __ in guard(maxDeviation > TDist.AdditiveIdentity, Error.New(message: "non-positive maxDeviation"))
           let count = TScalar.CreateChecked(positions.Count)
           let gross = positions.Tail.Fold(
               initialState: (Disp: TDist.AdditiveIdentity, Ref: origin),
               f: static ((TDist Disp, TPos Ref) acc, TPos p) => (acc.Disp + (p - acc.Ref), acc.Ref))
           let center = origin + (gross.Disp / count)
           let stats = positions.Fold(
               initialState: (Disp: TDist.AdditiveIdentity, W: TScalar.Zero, Center: center, MaxDev: maxDeviation),
               f: static ((TDist Disp, TScalar W, TPos Center, TDist MaxDev) acc, TPos p) =>
                   (p - acc.Center) switch {
                       TDist dev when dev >= -acc.MaxDev && dev <= acc.MaxDev =>
                           (TScalar.One - (TScalar.Abs(dev.To()) / acc.MaxDev.To())) switch {
                               TScalar w => (acc.Disp + (dev * w), acc.W + w, acc.Center, acc.MaxDev)
                           },
                       _ => acc
                   })
           from _ in guard(stats.W > TScalar.Zero, Error.New(message: "All positions rejected as outliers"))
           select center + (stats.Disp / stats.W);
}
```

- `IMeasurable` closes two gaps in `Amount`: `DomainType` for validated `From`/`To` (not inherited through the Amount chain) and `IAdditiveIdentity` for the zero element (absent from `VectorSpace`).
- `Locus` forbids `TPos + TPos` — the gross fold accumulates `TDist` offsets from an arbitrary origin, then translates by mean displacement. `CreateChecked` over `CreateSaturating`: a silently clamped divisor corrupts arithmetic.
- `guard(maxDeviation > TDist.AdditiveIdentity)` precedes both folds — `/ acc.MaxDev.To()` in the outlier weight divides by zero without it.
- Outlier fold nests four type-class ops in one switch binding: `dev.To()` (`DomainType`), `TScalar.Abs` (`INumberBase`), `/ acc.MaxDev.To()` (`INumber`), `dev * w` (`VectorSpace`). Both fold seeds hoist invariants → both lambdas `static`.

---

## Expression Scoping

`var` demands a statement block, forfeiting expression form and the guarantee that every path produces a value. Only a nested switch binding scopes an intermediate as both predicate and computation input within a single expression. LINQ `let` scopes intermediates sequentially within one monadic path (§2, §4); switch scoping handles mutually exclusive paths whose intermediates inhabit different type-class strata.

```csharp
namespace Domain.Transforms;

[Union]
public partial record Metric<T, TScalar>
    where T : Amount<T, TScalar>, DomainType<T, TScalar>
    where TScalar : INumber<TScalar> {
    public sealed record Deviation(T Center, TScalar Threshold) : Metric<T, TScalar>;
    public sealed record Ratio(T Reference, TScalar MaxRatio) : Metric<T, TScalar>;
    public sealed record Normalized(T Floor, T Ceiling) : Metric<T, TScalar>;
}

public static class Scoping {
    public static Fin<TScalar> Measure<T, TScalar>(
        Seq<T> readings, Metric<T, TScalar> metric)
        where T : Amount<T, TScalar>, DomainType<T, TScalar>
        where TScalar : INumber<TScalar> =>
        readings
            .Choose((T v) => metric switch {
                Metric<T, TScalar>.Deviation(T center, TScalar threshold) =>
                    (v - center).To() switch {
                        TScalar delta => TScalar.Abs(delta) switch {
                            TScalar mag when mag >= threshold => Some(mag / threshold),
                            _ => None
                        }
                    },
                Metric<T, TScalar>.Ratio(T reference, TScalar maxRatio) =>
                    reference.To() switch {
                        TScalar denom when !TScalar.IsZero(denom) =>
                            TScalar.Abs(v.To() / denom) switch {
                                TScalar ratio when ratio <= maxRatio => Some(ratio),
                                _ => None
                            },
                        _ => None
                    },
                Metric<T, TScalar>.Normalized(T floor, T ceiling) when v >= floor && v <= ceiling =>
                    (ceiling - floor).To() switch {
                        TScalar range when range > TScalar.Zero =>
                            (v - floor).To() switch { TScalar offset => Some(TScalar.Clamp(offset / range, TScalar.Zero, TScalar.One)) },
                        _ => None
                    },
                _ => None
            })
            .Fold(
                initialState: (Sum: TScalar.AdditiveIdentity, Count: TScalar.Zero),
                f: static ((TScalar Sum, TScalar Count) acc, TScalar v) =>
                    (acc.Sum + v, acc.Count + TScalar.One)) switch {
                (TScalar sum, TScalar count) when count > TScalar.Zero => FinSucc(sum / count),
                _ => FinFail<TScalar>(Error.New(message: "No valid readings"))
            };
}
```

- `[Union]` generates exhaustive `Switch`/`Map` with generic parameters propagated — Choose selector retains C# `switch` because expression-scoped bindings are the thesis, not exhaustive dispatch.
- Each arm's scoped binding serves dual use: `mag` as guard and `Some` value (Deviation), `ratio` as bound check and `Some` value (Ratio), `range` as degenerate guard before `offset` computes (Normalized). All three arms depth 3.
- Post-fold switch `(TScalar sum, TScalar count) when count > TScalar.Zero` scopes both values simultaneously — guard and named bindings stay in expression form.
- Choose selector captures `metric` (single allocation per call, not per element); Fold lambda `static` with `Sum` and `Count` in the seed.

---

## Effectful Composition

When each stage hardcodes a concrete effect, swapping effects rewrites every arrow signature — the composition was never polymorphic. Kleisli composition over an abstract monad constraint defers effect choice to the instantiation site: same arrows compose for any monad, dynamic sequences collapse through Kleisli identity. Fail-channel routing at the composition boundary dispatches errors per variant without plumbing inside each step.

```csharp
namespace Domain.Transforms;

[Union]
public partial record Fault(string Message, int Code) : Expected(Message, Code, None) {
    public sealed record Malformed(string Field) : Fault("malformed", 1);
    public sealed record Saturated(string Bound) : Fault("saturated", 2);
    public sealed record Conflicting(string Detail) : Fault("conflicting", 3);
}

public static class Composition {
    public static Func<A, K<M, C>> ComposeK<M, A, B, C>(
        Func<A, K<M, B>> first, Func<B, K<M, C>> second) where M : Monad<M> =>
        (A a) => first(a).Bind(second);
    public static Func<A, K<M, A>> FoldArrows<M, A>(
        Seq<Func<A, K<M, A>>> arrows) where M : Monad<M> =>
        arrows.Fold(
            initialState: (Func<A, K<M, A>>)(static (A a) => Monad.pure<M, A>(a)),
            f: static (Func<A, K<M, A>> acc, Func<A, K<M, A>> step) =>
                ComposeK<M, A, A, A>(first: acc, second: step));
    public static Func<A, K<M, A>> ChooseArrow<M, A>(
        Func<A, K<M, A>> primary, Func<A, K<M, A>> fallback)
        where M : Monad<M>, SemigroupK<M> =>
        (A a) => SemigroupK.combine(primary(a), fallback(a));
    public static Func<A, K<M, (B, C)>> FanoutK<M, A, B, C>(
        Func<A, K<M, B>> f, Func<A, K<M, C>> g) where M : Monad<M> =>
        (A a) => from b in f(a) from c in g(a) select (b, c);
    public static Fin<TScalar> Calibrate<TVal, TScalar>(
        Seq<TVal> readings, Seq<Func<TScalar, K<Fin, TScalar>>> stages, TScalar ceiling)
        where TVal : DomainType<TVal, TScalar>
        where TScalar : INumber<TScalar> =>
        (from values in readings.TraverseM(
            ComposeK<Fin, TVal, TScalar, TScalar>(
                first: static (TVal v) => FinSucc(v.To()),
                second: FoldArrows<Fin, TScalar>(stages))).As()
         from _ in guard(values.Count > 0, new Fault.Malformed("readings"))
         let naive = values.Fold(
             initialState: TScalar.AdditiveIdentity,
             f: static (TScalar sum, TScalar v) => sum + v) / TScalar.CreateChecked(values.Count)
         let stats = values.Fold(
             initialState: (WSum: TScalar.AdditiveIdentity, W: TScalar.AdditiveIdentity, Center: naive, Ceil: ceiling),
             f: static ((TScalar WSum, TScalar W, TScalar Center, TScalar Ceil) acc, TScalar v) =>
                 TScalar.Clamp(TScalar.One - TScalar.Abs(v - acc.Center) / TScalar.Max(acc.Ceil, TScalar.One), TScalar.AdditiveIdentity, TScalar.One) switch {
                     TScalar w => (acc.WSum + v * w, acc.W + w, acc.Center, acc.Ceil)
                 })
         from __ in guard(stats.W > TScalar.Zero, new Fault.Conflicting("weights"))
         let result = stats.WSum / stats.W
         from ___ in guard(result <= ceiling, new Fault.Saturated("result"))
         select result)
        .BindFail((Error err) => err switch {
            Fault f => f.Switch(ceiling,
                malformed: static (TScalar _, Fault.Malformed m) => FinFail<TScalar>(m),
                saturated: static (TScalar c, Fault.Saturated _) => FinSucc(c),
                conflicting: static (TScalar _, Fault.Conflicting _) => FinSucc(TScalar.AdditiveIdentity)),
            _ => FinFail<TScalar>(err)
        });
}
```

- Arrow algebra quartet: `ComposeK` sequences (`.Bind`), `FoldArrows` collapses via Kleisli identity seed (`Monad.pure`), `ChooseArrow` selects (sum via `SemigroupK.Combine`), `FanoutK` pairs (product via parallel `Bind`) — `ChooseArrow` alone requires `SemigroupK<M>` additional constraint.
- `TraverseM(ComposeK(extract, FoldArrows(stages)))` nests three composition levels — `.As()` downcasts `K<Fin, Seq<TScalar>>` to concrete. Weighted fold: six `INumber` ops in one switch binding, `Center` and `Ceil` hoisted into seed → `static`.
- Error routing: outer C# `switch` narrows `Error → Fault` (necessary type test); inner `f.Switch(ceiling, ...)` threads `ceiling` as `TState` → all three branch lambdas `static`. `FinFail(m)` passes typed `Malformed` instead of generic `err`.
- `Fault : Expected` — `[Union]` on `partial record` generates `Switch`/`Map` alongside base class inheritance. Adding a fourth variant breaks the inner `Switch` at compile time; the wildcard catches non-`Fault` errors.

---

## Rules

- Discriminant values (DU tags, SmartEnum, sealed cases) project behavior — never branch over conditions when a closed domain exists.
- K<F,A> with Monad<F> constraint is the default form for computation-generic transforms — pure variants are Identity instantiation.
- Choose over `.Filter(...).Map(...)` — single pass, zero intermediate sequences.
- FoldWhile for early-exit aggregation — predicate checked before folding next element.
- Static abstract interfaces for compile-time dispatch — no runtime dictionary, no class hierarchies.
- Nested switch + tuple for scoped let-bindings — each arm seals its own variables.
- ComposeK / FoldArrows / FanoutK for `A → K<M, B>` composition — Kleisli arrows, effect-polymorphic via `Monad<M>`, `static` fold.
- `BindFail` at composition boundary — sealed DU switch routes errors per variant, success identity implicit.
- `[Union]` on `partial record` + `Switch<TState, TResult>` for exhaustive dispatch — state threading makes branch lambdas `static`, adding a variant breaks all call sites at compile time.
- LINQ comprehension (`from..in..select`) for multi-step monadic composition — expression medium, not alternative syntax.
- `static` lambdas on fold/Choose closures — prove zero capture.
- `.Cons` + `.Rev()` in fold accumulators — never `.Add` (O(N) copy).
