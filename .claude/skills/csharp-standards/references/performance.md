# [H1][PERFORMANCE]
>**Dictum:** *Performance is structural; align types with the JIT; make allocation-freedom normal-form.*

Value-typed domain atoms align with JIT struct promotion, span-based APIs eliminate allocation, SIMD intrinsics replace branching, NativeAOT makes trimming a first-class constraint.

---
## [1][SIMD_TENSOR]
>**Dictum:** *TensorPrimitives map hardware math to functional wrappers.*

`TensorPrimitives` provides hardware-accelerated math over `ReadOnlySpan<T>`. Allocation-free computation; `Fin<T>` wraps the output boundary.

```csharp
namespace Domain.Performance;

public readonly struct VectorizedTransducer {
    public static Fin<ReadOnlyMemory<double>> ProjectVectorSpace(
        ReadOnlySpan<double> originSpace,
        Span<double> targetSpace,
        double scalarMultiplier) =>
        (originSpace.Length == targetSpace.Length) switch {
            false => FinFail<ReadOnlyMemory<double>>(
                         Error.New(message: "Spaces are misaligned.")),
            true => ExecuteProjection(
                         origin: originSpace,
                         target: targetSpace,
                         multiplier: scalarMultiplier)
        };
    private static Fin<ReadOnlyMemory<double>> ExecuteProjection(
        ReadOnlySpan<double> origin,
        Span<double> target,
        double multiplier) {
        TensorPrimitives.Multiply(x: origin, y: multiplier, destination: target);
        return FinSucc<ReadOnlyMemory<double>>(
            new ReadOnlyMemory<double>(array: target.ToArray()));
    }
}
```

[IMPORTANT]: `Multiply` dispatches to AVX-512/AVX2/SSE automatically. Zero heap during computation; allocation isolated to the capture boundary.

---
## [2][SPAN_PARSING]
>**Dictum:** *Span-based parsing is the default; allocation-free text processing is normal-form.*

`TryParseSpan<A>` matches the `TryParse(ReadOnlySpan<char>, out A)` pattern. `Parse<A>` lifts any conforming parser into `Fin<A>`. C# 14 implicit span conversions eliminate `.AsSpan()` ceremony.

```csharp
namespace Domain.Performance;

public delegate bool TryParseSpan<A>(ReadOnlySpan<char> text, out A value);
public static class SpanParsing {
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Fin<A> Parse<A>(
        ReadOnlySpan<char> text,
        TryParseSpan<A> parser,
        Func<Error> onError) =>
        parser(text, out A value) switch {
            true => value,
            false => onError()
        };
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Fin<Guid> ParseGuid(ReadOnlySpan<char> text) =>
        Parse<Guid>(
            text: text,
            parser: Guid.TryParse,
            onError: () => Error.New(message: "Invalid GUID format"));
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Fin<int> ParseInt(ReadOnlySpan<char> text) =>
        Parse<int>(
            text: text,
            parser: int.TryParse,
            onError: () => Error.New(message: "Invalid integer format"));
}
```

[CRITICAL]: `Guid.TryParse` and `int.TryParse` match `TryParseSpan<A>` as method group references. Zero allocation for the parse operation.

---
## [3][BRANCHLESS_VECTOR]
>**Dictum:** *SIMD masks replace conditional logic; CPU pipelines never stall.*

`Vector512<double>` processes 8 doubles per cycle. `GreaterThan` generates bit masks; `ConditionalSelect` merges without branching. Scalar fallback handles tail.

```csharp
namespace Domain.Performance;

public static class QuantitativeRiskEngine {
    public static double CalculateTotalExposure(
        ReadOnlySpan<double> prices, double threshold, double tax) =>
        ProcessSpan(prices, Vector512.Create(value: threshold),
            Vector512.Create(value: tax), accumulatedExposure: 0.0);
    private static double ProcessSpan(ReadOnlySpan<double> remaining,
        Vector512<double> threshVec, Vector512<double> taxVec, double accumulatedExposure) =>
        remaining.Length switch {
            0 => accumulatedExposure,
            < 8 => accumulatedExposure
                 + ((remaining[0] > threshVec[0]) switch { true => remaining[0] * taxVec[0], false => 0.0 })
                 + ProcessSpan(remaining.Slice(start: 1), threshVec, taxVec, accumulatedExposure: 0.0),
            _ => ProcessSpan(remaining.Slice(start: Vector512<double>.Count), threshVec, taxVec,
                     accumulatedExposure: accumulatedExposure + VectorChunk(
                         chunk: remaining.Slice(start: 0, length: Vector512<double>.Count),
                         threshVec: threshVec, taxVec: taxVec))
        };
    private static double VectorChunk(ReadOnlySpan<double> chunk,
        Vector512<double> threshVec, Vector512<double> taxVec) {
        Vector512<double> prices = Vector512.LoadUnsafe(
            source: ref MemoryMarshal.GetReference(span: chunk));
        Vector512<double> mask = Vector512.GreaterThan(left: prices, right: threshVec);
        Vector512<double> taxed = Vector512.Multiply(left: prices, right: taxVec);
        return Vector512.Sum(value: Vector512.ConditionalSelect(
            condition: mask, left: taxed, right: Vector512<double>.Zero));
    }
}
```

[CRITICAL]: Zero `if` statements. `GreaterThan` generates hardware masks; `ConditionalSelect` merges without branching. Tail-recursive vector/scalar dual path handles arbitrary lengths.

---
## [4][BUFFER_HYBRID]
>**Dictum:** *Stack for small buffers; pool for large; switch selects strategy.*

`stackalloc` for buffers under 256 bytes; `ArrayPool.Rent/Return` for larger. The `try/finally` is an intentional hardware-boundary exception -- pooled buffers must be returned even when downstream processing throws.

```csharp
namespace Domain.Performance;

public static class BufferProcessing {
    public static string ProcessBuffer(ReadOnlySpan<byte> input) {
        const int MaxStackSize = 256;
        byte[]? pooledBuffer = input.Length switch {
            > MaxStackSize => ArrayPool<byte>.Shared.Rent(minimumLength: input.Length),
            _ => null
        };
        try {
            Span<byte> workspace = pooledBuffer switch {
                not null => pooledBuffer.AsSpan(start: 0, length: input.Length),
                null => stackalloc byte[input.Length]
            };
            input.CopyTo(workspace);
            return Encoding.UTF8.GetString(workspace);
        } finally {
            pooledBuffer?.Pipe(
                (byte[] buffer) => ArrayPool<byte>.Shared.Return(
                    array: buffer, clearArray: true));
        }
    }
}
```

[IMPORTANT]: `try/finally` guarantees `ArrayPool.Return` regardless of exceptions -- the one justified exception to zero-try/catch.

---
## [5][VALUETASK]
>**Dictum:** *ValueTask avoids Task allocation on synchronous cache hits.*

`ValueTask<T>` returns synchronously via `FromResult` on cache hits. Async fallback allocates only when needed. Consume exactly once; never await concurrently.

```csharp
namespace Domain.Performance;

public interface ICacheProvider<TKey, TValue> where TKey : notnull {
    ValueTask<Option<TValue>> GetAsync(TKey key, CancellationToken ct = default);
}
public sealed class LayeredCache<TKey, TValue>(
    ConcurrentDictionary<TKey, TValue> l1,
    IDistributedCache l2) : ICacheProvider<TKey, TValue> where TKey : notnull {
    public ValueTask<Option<TValue>> GetAsync(TKey key, CancellationToken ct) =>
        l1.TryGetValue(key, out TValue? value) switch {
            true => ValueTask.FromResult(result: Some(value!)),
            false => new ValueTask<Option<TValue>>(task: FetchL2(key: key, ct: ct))
        };
    private async Task<Option<TValue>> FetchL2(TKey key, CancellationToken ct) =>
        await l2.GetStringAsync(key.ToString()!, ct) switch {
            string json => Some(JsonSerializer.Deserialize<TValue>(json: json)!),
            null => Option<TValue>.None
        };
}
```

---
## [6][NATIVEAOT]
>**Dictum:** *AOT is a first-class constraint; source generators replace reflection.*

NativeAOT in .NET 10 produces 1.05 MB binaries with 86% faster cold starts. `JsonSerializerContext` eliminates reflection. No `Reflection.Emit`, no dynamic assembly loading.

```csharp
namespace Domain.Performance;

public readonly record struct OrderDto(Guid Id);
public readonly record struct CustomerDto(Guid Id);
[JsonSerializable(typeof(OrderDto))]
[JsonSerializable(typeof(CustomerDto))]
public partial class AppJsonContext : JsonSerializerContext;
public static class Serialization {
    public static OrderDto RoundTrip(OrderDto order) {
        string json = JsonSerializer.Serialize(
            value: order, jsonTypeInfo: AppJsonContext.Default.OrderDto);
        return JsonSerializer.Deserialize(
            json: json, jsonTypeInfo: AppJsonContext.Default.OrderDto)!;
    }
}
```

[IMPORTANT]: Source generators produce serialization at compile time -- trimming-safe and AOT-safe by construction.

---
## [7][STATIC_LAMBDAS]
>**Dictum:** *Static lambdas prove zero capture; tuple threading replaces closures.*

`static` on lambdas prevents implicit variable capture. State threaded via `ValueTuple` through monadic `Bind`/`Map`. Zero closure bytes on hot paths.

```csharp
namespace Domain.Performance;

public static class ZeroClosurePipeline {
    public static Eff<ExecutionReceipt> Execute(
        IMarketGateway gateway, OrderParameters order) =>
        ValidateOrder(gateway: gateway, parameters: order)
            .ToEff()
            .Bind(f: static ((IMarketGateway Gateway, OrderParameters Command) state) =>
                state.Gateway.FetchLiquidity(assetId: state.Command.AssetId)
                    .Map(f: (MarketLiquidity liquidity) =>
                        (Gateway: state.Gateway, Command: state.Command, Market: liquidity)))
            .Bind(f: static ((IMarketGateway Gateway, OrderParameters Command, MarketLiquidity Market) state) =>
                (state.Market.CurrentPrice <= state.Command.MaxPrice) switch {
                    true => state.Gateway.CommitTransaction(
                                assetId: state.Command.AssetId,
                                quantity: state.Command.Quantity,
                                price: state.Market.CurrentPrice),
                    false => Eff<ExecutionReceipt>.Fail(
                                 error: Error.New(message: "Slippage tolerance exceeded."))
                });
}
```

[CRITICAL]: Outer `Bind` lambdas are `static` -- zero implicit captures. The inner `Map` references `state` from its enclosing `Bind` parameter (same frame), so it CANNOT be `static`. `ValueTuple` fields thread state explicitly through the chain.

**Hygienic Scoping** -- nested switch expressions emulate ML-family `let` bindings, sealing each intermediate value:
```csharp
public static Fin<RiskAssessment> EvaluatePortfolio(
    ReadOnlySpan<double> positions, double threshold) =>
    VectorizedTransducer.ProjectVectorSpace(
        originSpace: positions, targetSpace: positions, scalarMultiplier: threshold) switch {
        { IsSucc: true } projected => (
            exposure: projected.Value.Sum(),
            ratio: projected.Value.Sum() / positions.Length) switch {
            (double exposure, double ratio) => new RiskAssessment(
                TotalExposure: exposure, RiskRatio: ratio)
        },
        { IsFail: true } failure => FinFail<RiskAssessment>(failure.Error)
    };
```

[IMPORTANT]: Explicit types in tuple deconstruction -- zero `var`. Each cascading `switch` scope seals its bindings.

**Local Static Functions** -- tail-recursive folds inside the method body. `stackalloc` spans cannot be returned -- consume results before the frame unwinds:
```csharp
public static Fin<AggregatedPosition> ConsolidateOrderBook(
    ReadOnlySpan<OrderEntry> entries) {
    Span<decimal> workspace = stackalloc decimal[entries.Length];
    ExecuteSpanFold(entries: entries, output: workspace, index: 0);
    decimal total = TensorPrimitives.Sum<decimal>(workspace);
    return new AggregatedPosition(Total: total, Count: entries.Length);
    static void ExecuteSpanFold(
        ReadOnlySpan<OrderEntry> entries, Span<decimal> output, int index) =>
        _ = index >= entries.Length switch {
            true => output,
            false => ExecuteSpanFold(
                entries: entries,
                output: Project(entry: entries[index], target: output, index: index),
                index: index + 1)
        };
    static Span<decimal> Project(OrderEntry entry, Span<decimal> target, int index) {
        target[index] = entry.Price * entry.Quantity;
        return target;
    }
}
```

[IMPORTANT]: `static` on local functions guarantees zero closure capture. `TensorPrimitives.Sum` consumes the workspace before the frame unwinds -- `stackalloc` memory never escapes.

---
## [8][SPAN_ALGORITHMS]
>**Dictum:** *MemoryExtensions bring allocation-free sorting and search to span-based pipelines.*

`MemoryExtensions.Sort` + `BinarySearch` over `Span<T>` give ordered-set semantics without heap collections, eliminating `SortedSet<T>` on hot paths.

```csharp
namespace Domain.Performance;

public static class SpanAlgorithms {
    public static Fin<int> SortAndFind<T>(
        Span<T> span, T target) where T : IComparable<T> {
        MemoryExtensions.Sort(span: span);
        int index = MemoryExtensions.BinarySearch(
            span: (ReadOnlySpan<T>)span, comparable: target);
        return index switch {
            >= 0 => FinSucc(index),
            _ => FinFail<int>(
                     Error.New(message: "Element not found in sorted span"))
        };
    }
    public static int Partition<T>(
        Span<T> span, Func<T, bool> predicate, int index, int boundary) =>
        index >= span.Length switch {
            true => boundary,
            false => predicate(span[index]) switch {
                true => ((span[boundary], span[index]) = (span[index], span[boundary])) switch {
                    _ => Partition(span: span, predicate: predicate,
                             index: index + 1, boundary: boundary + 1)
                },
                false => Partition(span: span, predicate: predicate,
                             index: index + 1, boundary: boundary)
            }
        };
}
```

[IMPORTANT]: Partition uses tail-recursive swap-in-place decomposition -- zero intermediate collections.

---
## [9][JIT_ESCAPE]
>**Dictum:** *Profile first; the JIT may have already solved it.*

.NET 10 JIT auto stack-allocates delegates, small arrays, and span-backed buffers that do not escape (3x delegate speedup, 73% fewer allocations). Profile before manually converting LINQ to loops.

[IMPORTANT]: Escape analysis does NOT eliminate closure allocations -- a known frontier. Static lambda discipline (see [7]) remains necessary for zero-allocation hot paths.

---
## [10][RULES]
>**Dictum:** *Rules compress into constraints.*

- [ALWAYS] `ReadOnlySpan<T>` for hot-path input; `Span<T>` for output workspace.
- [ALWAYS] `static` on every lambda in hot paths -- zero closure bytes.
- [ALWAYS] `stackalloc` for small buffers; `ArrayPool` for large; `try/finally` for pool cleanup.
- [ALWAYS] `MemoryExtensions.Sort`/`BinarySearch` over heap-based `SortedSet<T>` on hot paths.
- [NEVER] Return `Span<T>` backed by `stackalloc` -- consume within the declaring method.
- [NEVER] `IEnumerable` LINQ on hot paths -- use span-based processing or TensorPrimitives.
- [NEVER] Micro-optimize before profiling -- .NET 10 JIT escape analysis handles many cases.

---
## [11][QUICK_REFERENCE]

| [INDEX] | [PATTERN]           | [WHEN]                                 | [KEY_TRAIT]                         |
| :-----: | ------------------- | -------------------------------------- | ----------------------------------- |
|   [1]   | TensorPrimitives    | Hardware-accelerated numeric math      | `Multiply`/`Sum` over `Span<T>`     |
|   [2]   | Span parsing        | Allocation-free text parsing           | `TryParseSpan<A>` + method groups   |
|   [3]   | Vector512 SIMD      | Branchless conditional logic           | Mask + `ConditionalSelect` + `Sum`  |
|   [4]   | Buffer hybrid       | Stack/pool strategy selection          | `stackalloc` + `ArrayPool`          |
|   [5]   | ValueTask           | Sync cache hit avoidance of Task alloc | `FromResult` fast path              |
|   [6]   | NativeAOT           | Trimmed 1 MB binaries, 86% faster cold | `JsonSerializerContext` source-gen  |
|   [7]   | Static lambdas      | Zero closure bytes on hot paths        | `static` keyword + tuple threading  |
|   [8]   | Span algorithms     | Allocation-free sort/search/partition  | `MemoryExtensions` + tail recursion |
|   [9]   | JIT escape analysis | Automatic stack alloc for non-escaping | Profile first; .NET 10 handles it   |
