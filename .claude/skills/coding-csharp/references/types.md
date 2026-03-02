# Types

## Canonical Type Anchors and Ownership

LanguageExt's algebraic chain (`Identifier`→`Amount`→`Locus`) inherits `DomainType<SELF>` — a marker with no members — but never `DomainType<SELF, REPR>`, the branch carrying `From`/`To`. A constraint on `Amount<T, TScalar>` grants arithmetic through `VectorSpace`; a constraint on `DomainType<T, TScalar>` grants validated construction. Neither implies the other. Every transform-consumable anchor declares both branches at its interface list.

```csharp
namespace Domain.Storage;

[ValueObject<long>(SkipFactoryMethods = true)]
public readonly partial struct ByteLength :
    Amount<ByteLength, long>, DomainType<ByteLength, long>, IAdditiveIdentity<ByteLength, ByteLength> {
    public static Fin<ByteLength> From(long repr) => FinSucc(new ByteLength(repr));
    public long To() => _value;
    public static ByteLength AdditiveIdentity => new(0L);
    public static ByteLength operator -(ByteLength d) => new(-d._value);
    public static ByteLength operator +(ByteLength a, ByteLength b) => new(a._value + b._value);
    public static ByteLength operator -(ByteLength a, ByteLength b) => new(a._value - b._value);
    public static ByteLength operator *(ByteLength d, long s) => new(d._value * s);
    public static ByteLength operator /(ByteLength d, long s) => new(d._value / s);
    public static ByteLength AlignToPow2(ByteLength len) =>
        new((long)BitOperations.RoundUpToPowerOf2((ulong)len._value));
}

[ValueObject<long>(SkipFactoryMethods = true)]
public readonly partial struct ByteOffset :
    Locus<ByteOffset, ByteLength, long>, DomainType<ByteOffset, long>, IAdditiveIdentity<ByteOffset, ByteOffset> {
    public static Fin<ByteOffset> From(long repr) => FinSucc(new ByteOffset(repr));
    public long To() => _value;
    public static ByteOffset AdditiveIdentity => new(0L);
    public static ByteOffset operator +(ByteOffset p, ByteLength d) => new(p._value + d.To());
    public static ByteLength operator -(ByteOffset a, ByteOffset b) => new(a._value - b._value);
    public static ByteOffset operator -(ByteOffset p) => new(-p._value);
}

static Fin<T> ScaleValidated<T, TScalar>(TScalar raw, TScalar factor)
    where T : Amount<T, TScalar>, DomainType<T, TScalar>
    where TScalar : INumber<TScalar> =>
    from t in T.From(raw)
    select t * factor;
```

- `Amount<ByteLength, long>` chains `VectorSpace → Identifier → DomainType<ByteLength>` (marker, no members) — the two-parameter `DomainType<ByteLength, long>` with `From`/`To` forks at the hierarchy root and must be declared separately; `ScaleValidated` makes the gap concrete: drop `DomainType<T, TScalar>` and `T.From` vanishes, drop `Amount<T, TScalar>` and `t * factor` vanishes.
- `Locus<ByteOffset, ByteLength, long>` branches from `Identifier` parallel to `VectorSpace`/`Amount` — subtraction returns the distance type (`ByteLength`), not the position type, enforcing that position deltas yield magnitudes; `AlignToPow2` on `ByteLength` normalizes lengths before use as alignment operands for the elided `ByteOffset.AlignUp`/`AlignDown`, a semantic coupling the parameter types alone cannot encode.
- `SkipFactoryMethods = true` suppresses Thinktecture's `Create`/`TryCreate`; the interface list owns algebraic shape (`Amount`, `Locus`, `DomainType`), the source generator owns ordinal infrastructure (equality, comparison, `ToString`) — §2's `WorkerCount` inherits the same split with `DomainType` alone, without `Amount`, because construction is its sole external obligation.

## Smart Constructors and Refined Scalar Boundaries

Construction failure that escapes the return type distributes the rejection obligation as caller convention — `TraverseM(T.From)` cannot route those failures through `BindFail`, and every binding site discovers invalidity as an unhandled exception rather than a structural obligation encoded in the type. `Fin<SELF>` internalizes the boundary: the rejection codomain is structural, and every call site binding `From`'s result is statically obligated to account for failure before value extraction. Bypass routes — implicit scalar coercion, Thinktecture's generated `Create` path, `default(T)` construction — breach the guarantee independently; closure requires all three sealed simultaneously.

```csharp
namespace Domain.Engine;

[Union]
public partial record BoundaryFault(string Message, int Code, Option<Error> Inner = default)
    : Expected(Message, Code, Inner) {
    public partial record NonPositive(string Message, int Code) : BoundaryFault(Message, Code);
    public partial record Overflow(string Message, int Code, int Ceiling) : BoundaryFault(Message, Code);
    public partial record Inverted(string Message, int Code) : BoundaryFault(Message, Code);
}

[ValueObject<int>(SkipFactoryMethods = true)]
public readonly partial struct WorkerCount : DomainType<WorkerCount, int> {
    static readonly int MaxWorkers = Environment.ProcessorCount * 16;
    public static Fin<WorkerCount> From(int repr) =>
        from _  in guard(repr > 0,           new BoundaryFault.NonPositive("non-positive", code: 5001))
        from __ in guard(repr <= MaxWorkers, new BoundaryFault.Overflow("exceeds ceiling", code: 5002, Ceiling: MaxWorkers))
        select new WorkerCount((int)BitOperations.RoundUpToPowerOf2((uint)repr));
    public int To() => _value;
    public static WorkerCount SaturatingDouble(WorkerCount w) =>
        new((int)Math.Min((long)w._value << 1, MaxWorkers));
}

public readonly record struct ConcurrencyBounds : DomainType<ConcurrencyBounds, (int Min, int Max)> {
    WorkerCount _min;
    WorkerCount _max;
    private ConcurrencyBounds(WorkerCount min, WorkerCount max) { _min = min; _max = max; }
    public static Fin<ConcurrencyBounds> From((int Min, int Max) repr) =>
        (WorkerCount.From(repr.Min).ToValidation() & WorkerCount.From(repr.Max).ToValidation())
            .Match(
                Succ: static (WorkerCount min, WorkerCount max) =>
                    from _ in guard(min.To() < max.To(), (Error)new BoundaryFault.Inverted("min ≥ max", code: 5003))
                    select new ConcurrencyBounds(min, max),
                Fail: static err => FinFail<ConcurrencyBounds>(err));
    public (int Min, int Max) To() => (_min.To(), _max.To());
}
```

- `guard(repr > 0, ...)` is a structural precondition for the normalization: `BitOperations.RoundUpToPowerOf2(0u)` returns 0, so the guard's rejection of zero renders that degenerate input unreachable in the `select` arm.
- `SaturatingDouble` constructs via `new(...)`, bypassing `From`; invariants are preserved structurally — `From`'s postcondition (`_value >= 1`) guarantees `(long)_value << 1 >= 2`, so re-traversing the guard chain would be redundant validation.
- `BoundaryFault.Overflow` captures `Ceiling: MaxWorkers` at construction time, where `MaxWorkers = Environment.ProcessorCount * 16` is machine-specific; a `BindFail` handler routing `Overflow` can recover via `f.Switch(ceiling, overflow: static (c, _) => FinSucc(c))`, receiving the actual runtime bound rather than a compile-time constant.

## Union Types and Exhaustive Dispatch Contracts

C# switch expressions on non-`[Union]` hierarchies emit warnings on missing branches — suppressible, non-breaking. Thinktecture's `[Union]` enforces closed-world evolution through generated parameter lists: `Switch<TResult>` carries one required `Func` parameter per variant, so adding a variant regenerates the signature with an additional required parameter, breaking every call site at compile time. Generic type parameters on the union propagate through both generated `Switch` overloads — constraints declared on the union (`where TScalar : INumber<TScalar>`) are available inside dispatch lambdas without re-declaration at the call site. `internal [Union]` closes the world within the assembly; `public [Union]` closes it across consumer assemblies.

```csharp
namespace Domain.Pipeline;

[Union]
internal partial record Ruling<TScalar> where TScalar : INumber<TScalar> {
    internal sealed record Accept(TScalar Value) : Ruling<TScalar>;
    internal sealed record Clamp(TScalar Value, TScalar Bound) : Ruling<TScalar>;
    internal sealed record Reject(Error Cause) : Ruling<TScalar>;
}

internal static class RulingDispatch {
    internal static Fin<TScalar> Resolve<TScalar>(Ruling<TScalar> ruling)
        where TScalar : INumber<TScalar> =>
        ruling.Switch(
            accept: static (Ruling<TScalar>.Accept a) => FinSucc(a.Value),
            clamp:  static (Ruling<TScalar>.Clamp c)  => FinSucc(TScalar.Min(c.Value, c.Bound)),
            reject: static (Ruling<TScalar>.Reject r) => FinFail<TScalar>(r.Cause));
    internal static Fin<TScalar> ResolveBiased<TScalar>(Ruling<TScalar> ruling, TScalar bias)
        where TScalar : INumber<TScalar> =>
        ruling.Switch(bias,
            accept: static (TScalar b, Ruling<TScalar>.Accept a) => FinSucc(a.Value + b),
            clamp:  static (TScalar b, Ruling<TScalar>.Clamp c)  => FinSucc(TScalar.Min(c.Value + b, c.Bound)),
            reject: static (TScalar _, Ruling<TScalar>.Reject r) => FinFail<TScalar>(r.Cause));
    internal static Fin<TScalar> Compose<TScalar>(Seq<Ruling<TScalar>> rulings, TScalar seed)
        where TScalar : INumber<TScalar> =>
        rulings.Fold(FinSucc(seed),
            static (Fin<TScalar> acc, Ruling<TScalar> ruling) =>
                from a in acc from n in Resolve(ruling) select a + n);
}
```

- `INumber<TScalar>` on `Ruling<TScalar>` propagates into both generated `Switch` overloads — `TScalar.Min` and `+` compile inside `static` lambda bodies without re-constraining at the dispatch site.
- `Compose` folds directly over rulings, invoking `Resolve` inside the LINQ comprehension — monadic short-circuit in `from a in acc` avoids evaluating remaining elements once `acc` is `FinFail`; `ResolveBiased` threads `bias` as `TState` through the state-threaded `Switch<TState, TResult>` overload.

## Type Parameter Contracts: Generic Math and Phantom State

A flat `INumber<TScalar>` constraint admits every static abstract member from `INumberBase` through `IComparisonOperators` — the function body can call `Min`, `Clamp`, `Abs`, and arithmetic indiscriminately. Stratifying constraints to the narrowest sufficient interface set makes the available operation surface a compile-time contract: a function constrained on `IAdditiveIdentity + IComparisonOperators` structurally cannot invoke `TScalar.Min` or `TScalar.Clamp` — those resolve only through `INumber`. Phantom state markers enforce pipeline stage ordering orthogonally, without a single byte of runtime representation.

```csharp
namespace Infra.Telemetry;

public readonly struct Unsampled;
public readonly struct Sampled;

public readonly struct Frame<TStage, TScalar>
    where TScalar : INumber<TScalar>, IMinMaxValue<TScalar> {
    public NonEmpty<TScalar> Readings { get; }
    private Frame(NonEmpty<TScalar> readings) => Readings = readings;
    internal static Frame<TStage, TScalar> Unsafe(NonEmpty<TScalar> rs) => new(rs);
}

public static class FrameOps {
    public static Fin<NonEmpty<TScalar>> ValidatePositive<TScalar>(NonEmpty<TScalar> readings)
        where TScalar : IAdditiveIdentity<TScalar, TScalar>,
                        IComparisonOperators<TScalar, TScalar, bool> =>
        from _ in guard(readings.Fold(true,
                static (bool acc, TScalar v) => acc & v > TScalar.AdditiveIdentity),
            Error.New("non-positive reading"))
        select readings;
    public static Fin<Frame<Sampled, TScalar>> Qualify<TScalar>(Frame<Unsampled, TScalar> raw)
        where TScalar : INumber<TScalar>, IMinMaxValue<TScalar> =>
        ValidatePositive(raw.Readings)
            .Map(static (NonEmpty<TScalar> ne) => Frame<Sampled, TScalar>.Unsafe(ne));
    public static (TScalar Min, TScalar Max, TScalar Mean) Stats<TScalar>(
        Frame<Sampled, TScalar> frame)
        where TScalar : INumber<TScalar>, IMinMaxValue<TScalar> =>
        frame.Readings.Fold(
            (Min: TScalar.MaxValue, Max: TScalar.MinValue, Sum: TScalar.Zero, N: TScalar.Zero),
            static ((TScalar Min, TScalar Max, TScalar Sum, TScalar N) a, TScalar v) =>
                (TScalar.Min(a.Min, v), TScalar.Max(a.Max, v), a.Sum + v, a.N + TScalar.One),
            static a => (a.Min, a.Max, a.Sum / a.N));
}
```

- `ValidatePositive` constrains `IAdditiveIdentity + IComparisonOperators` — the narrowest stratum that admits zero-comparison; `TScalar.Min` and `TScalar.Clamp` are compile errors inside that body because they resolve only through `INumber`; `Qualify` calls `ValidatePositive` at the wider `INumber` constraint level, which transitively satisfies both narrow interfaces.
- `Qualify` is the sole gate from `Unsampled` to `Sampled`, concentrating the validation obligation at a single assembly-internal construction point; stage violations are structurally unrepresentable without adding a field or branch.
- `IMinMaxValue<TScalar>` is standalone in the .NET generic math hierarchy — `BigInteger` implements `INumber<BigInteger>` but not `IMinMaxValue<BigInteger>` (unbounded); the conjunction `where TScalar : INumber<TScalar>, IMinMaxValue<TScalar>` is a deliberate design choice that excludes unbounded numeric types from `Stats`'s fold seed; drop `IMinMaxValue` and `TScalar.MaxValue` / `TScalar.MinValue` vanish from the available static abstract members, making the min/max identity seed a compile error — the constraint is not redundant with `INumber`, it is an orthogonal capability gate.

## Collection Invariants and Boundary Projection Types

A `Seq<T>` encodes no cardinality guarantee — `Head` and zero-identity fold are exceptional paths waiting to be triggered at runtime. Moving the non-emptiness obligation into the constructor return type makes both operations unconditionally total; at EF boundaries where exception-free failure is structurally impossible, the same obligation transfers to the `ValueConverter` factory at a single isolated site.

```csharp
namespace Domain.Collections;

public readonly record struct NonEmpty<T> {
    readonly Seq<T> _items;
    private NonEmpty(Seq<T> items) { _items = items; }
    public static Fin<NonEmpty<T>> Create(Seq<T> items) =>
        items.IsEmpty
            ? FinFail<NonEmpty<T>>(Error.New("collection must be non-empty"))
            : FinSucc(new NonEmpty<T>(items));
    public T       Head    => _items[0];
    public Seq<T>  Tail    => _items.Tail;
    public int     Count   => _items.Count;
    public Seq<T>  ToSeq() => _items;
    public NonEmpty<R> Map<R>(Func<T, R> f)   => new(_items.Map(f));
    public R Fold<R>(R seed, Func<R, T, R> f) => _items.Fold(seed, f);
    public TResult Fold<TAcc, TResult>(TAcc seed, Func<TAcc, T, TAcc> f, Func<TAcc, TResult> project) => project(_items.Fold(seed, f));
}

public sealed class DomainConverter<TDomain, TScalar> : ValueConverter<TDomain, TScalar>
    where TDomain : DomainType<TDomain, TScalar>
    where TScalar : notnull {
    public DomainConverter() : base(
        d => d.To(),
        s => TDomain.From(s).Match(
            Succ: identity,
            // BOUNDARY ADAPTER — EF Core ValueConverter requires synchronous Func; failure throws
            Fail: static e => throw new InvalidOperationException(e.Message))) { }
}
```

- `Map` returns `NonEmpty<R>` without re-validation — `_items.Map(f)` cannot produce an empty sequence from a non-empty input; `Frame<Sampled, TScalar>` in §4 holds `NonEmpty<TScalar>`, making `Stats` a total function with the `IsEmpty` guard structurally eliminated.
- The three-arg `Fold<TAcc, TResult>` projects the accumulator inline, keeping §4's `Stats` expression-bodied without a post-fold block.
- `DomainConverter` dispatches `TDomain.From(s)` via static abstract member resolution; `BOUNDARY ADAPTER` marks the sole `throw` site in the codebase — `DomainType<TDomain, TScalar>` makes the converter generic across every anchor implementing `From`/`To`.

## Decorator and Key Contract Types

Without structural enforcement at the registration site, capability resolution is late-bound — a misspelled string key silently resolves to null at the injection site, and a Scrutor `Decorate` call silently skips every non-string-keyed descriptor because `GetDecoratorKey` returns null for enum keys, neither of which surfaces until the first exercised call path.

```csharp
namespace Infra.Storage;

public enum StorageRegion { Primary, Replica }

public interface IObjectStore {
    Fin<Option<ReadOnlyMemory<byte>>> Get(string key, CancellationToken ct);
    Fin<Unit> Put(string key, ReadOnlyMemory<byte> data, CancellationToken ct);
}

public sealed class AuditStoreDecorator(IObjectStore inner, ITraceWriter traceWriter) : IObjectStore {
    static readonly Func<CancellationToken, Fin<Unit>> Live =
        static ct => guard(!ct.IsCancellationRequested, Error.New("cancelled"));
    public Fin<Option<ReadOnlyMemory<byte>>> Get(string key, CancellationToken ct) =>
        Live(ct).Bind(_ => inner.Get(key, ct))
                .Bind(result => traceWriter.Write($"get:{key}", ct).Map(_ => result));
    public Fin<Unit> Put(string key, ReadOnlyMemory<byte> data, CancellationToken ct) =>
        Live(ct).Bind(_ => inner.Put(key, data, ct))
                .Bind(_ => traceWriter.Write($"put:{key}:{data.Length}", ct));
}
```

- `[FromKeyedServices(StorageRegion.Primary)]` accepts `object?` — the compiler cannot verify alignment with the registered key type, but enum keys close the vocabulary: substituting `[FromKeyedServices("primary")]` admits typos that resolve to null silently at runtime.
- Scrutor v7's `GetDecoratorKey` returns `null` for any non-`string` service key — `TryDecorate<IObjectStore, AuditStoreDecorator>()` silently skips all `StorageRegion`-keyed descriptors (no exception, no diagnostic), while `Decorate` throws `InvalidOperationException` only if zero undecorated descriptors remain; a `(StorageRegion, "raw")` composite sentinel at the composition root replicates Scrutor's two-descriptor delegation contract without the string-key constraint.
- `Live` hoists the cancellation guard into a `static readonly` field, keeping both `Get` and `Put` expression-bodied on a single `Bind` chain without duplicating the guard.
