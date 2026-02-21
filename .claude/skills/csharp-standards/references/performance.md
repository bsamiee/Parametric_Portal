# [H1][PERFORMANCE]
>**Dictum:** *Performance is structural; align types with the JIT; make allocation-freedom normal-form.*

Value-typed domain atoms align with JIT struct promotion, span-based APIs eliminate allocation, SIMD intrinsics replace branching, NativeAOT makes trimming a first-class constraint. Span-based parsing (`TryParseSpan<A>`, `Parse<A>`) is canonicalized in `types.md` [3] -- see there for delegate shape and smart-constructor integration. Performance characteristics: zero allocation via method-group delegate binding.

---
## [1][SIMD_TENSOR]
>**Dictum:** *TensorPrimitives map hardware math to functional wrappers.*

`TensorPrimitives` provides hardware-accelerated math over `ReadOnlySpan<T>`. The caller owns the `Memory<double>` buffer; the function writes in-place and returns the same memory -- zero intermediate allocation.

```csharp
namespace Domain.Performance;

public readonly struct VectorizedTransducer {
    public static Fin<ReadOnlyMemory<double>> ProjectVectorSpace(
        ReadOnlySpan<double> originSpace,
        Memory<double> targetSpace,
        double scalarMultiplier) =>
        (originSpace.Length == targetSpace.Length) switch {
            false => Fin.Fail<ReadOnlyMemory<double>>(
                         Error.New(message: "Spaces are misaligned.")),
            true => ExecuteProjection(
                         origin: originSpace,
                         target: targetSpace,
                         multiplier: scalarMultiplier)
        };
    private static Fin<ReadOnlyMemory<double>> ExecuteProjection(
        ReadOnlySpan<double> origin,
        Memory<double> target,
        double multiplier) {
        TensorPrimitives.Multiply(x: origin, y: multiplier, destination: target.Span);
        // Allocation isolated to capture boundary -- caller-provided Memory<T> avoids copy
        return Fin.Succ<ReadOnlyMemory<double>>(target);
    }
}
```

[IMPORTANT]: `Multiply` dispatches to AVX-512/AVX2/SSE automatically. Computation is zero-heap; `Memory<double>` input avoids the span-to-array copy at the capture boundary.

---
## [2][BRANCHLESS_VECTOR]
>**Dictum:** *SIMD masks replace conditional logic; CPU pipelines never stall.*

`Vector<double>` auto-sizes to the widest available SIMD register (AVX-512/AVX2/SSE). `GreaterThan` generates bit masks; `ConditionalSelect` merges without branching. Iterative loop handles arbitrary lengths with bounded stack depth.

```csharp
namespace Domain.Performance;

public static class QuantitativeRiskEngine {
    // NOTE: .NET JIT does not guarantee TCO -- iterative loop for stack safety
    // [BOUNDARY EXCEPTION -- imperative loop for stack safety]
    public static double CalculateTotalExposure(
        ReadOnlySpan<double> prices, double threshold, double tax) {
        Vector<double> thresholdVector = new(value: threshold);
        Vector<double> taxVector = new(value: tax);
        double accumulated = 0.0;
        int vectorLength = Vector<double>.Count;
        int offset = 0;
        // Vectorized pass -- process full SIMD-width chunks
        while (offset <= prices.Length - vectorLength) {
            Vector<double> chunk = new(values: prices.Slice(start: offset, length: vectorLength));
            Vector<long> mask = Vector.GreaterThan(left: chunk, right: thresholdVector);
            Vector<double> taxed = Vector.Multiply(left: chunk, right: taxVector);
            accumulated += Vector.Sum(value: Vector.ConditionalSelect(
                condition: mask, left: taxed, right: Vector<double>.Zero));
            offset += vectorLength;
        }
        // Scalar tail -- remaining elements below SIMD width
        while (offset < prices.Length) {
            accumulated += (prices[offset] > threshold) switch {
                true => prices[offset] * tax,
                false => 0.0
            };
            offset++;
        }
        return accumulated;
    }
}
```

[CRITICAL]: Zero branching in the vectorized pass. `Vector<double>` auto-selects hardware width -- no hard-coded `Vector512` dependency. Scalar tail handles arbitrary alignment.

---
## [2A][ZERO_COPY_REINTERPRET]
>**Dictum:** *`MemoryMarshal.Cast` reinterprets memory without copying.*

`MemoryMarshal.Cast<TFrom, TTo>` performs zero-copy reinterpretation over `ReadOnlySpan<T>` -- the functional equivalent of C++ `reinterpret_cast` within safe managed code. `AsBytes` projects any unmanaged struct span as raw bytes. Neither allocates; both return a view over the same memory.

```csharp
namespace Domain.Performance;

public static class ZeroCopyProjection {
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ReadOnlySpan<byte> AsBytes(ReadOnlySpan<double> source) =>
        MemoryMarshal.AsBytes(source);
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ReadOnlySpan<float> NarrowPrecision(ReadOnlySpan<double> source,
        Span<float> destination) {
        TensorPrimitives.ConvertTruncating(source, destination);
        return destination;
    }
    // Cast between unmanaged value types sharing the same byte width
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ReadOnlySpan<int> ReinterpretAsInt32(ReadOnlySpan<float> source) =>
        MemoryMarshal.Cast<float, int>(source);
}
```

[CRITICAL]: `Cast` bypasses constructors -- the target type receives raw bit patterns, not validated values. Use only between unmanaged primitives of compatible layout. Neither `TFrom` nor `TTo` may contain managed references.

---
## [3][BUFFER_HYBRID]
>**Dictum:** *Stack for small buffers; pool for large; switch selects allocation path.*

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
            Optional(pooledBuffer).Iter(
                (byte[] buffer) => ArrayPool<byte>.Shared.Return(
                    array: buffer, clearArray: true));
        }
    }
}
```

[IMPORTANT]: `try/finally` guarantees `ArrayPool.Return` regardless of exceptions -- the one justified exception to zero-try/catch.

---
## [4][VALUETASK]
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
            // TryGetValue guarantees non-null on true branch
            true => ValueTask.FromResult(result: Some(value!)),
            false => new ValueTask<Option<TValue>>(task: FetchL2(key: key, ct: ct))
        };
    private async Task<Option<TValue>> FetchL2(TKey key, CancellationToken ct) =>
        await l2.GetStringAsync(key.ToString()!, ct) switch {
            string json => JsonSerializer.Deserialize<TValue>(json: json) switch {
                TValue result when result != null => Some(result),
                _ => Option<TValue>.None
            },
            null => Option<TValue>.None
        };
}
```

[IMPORTANT]: `IDistributedCache` dependency is illustrative -- substitute your caching abstraction. `Deserialize` null handled via pattern match, not `!` operator.

---
## [5][NATIVEAOT]
>**Dictum:** *AOT is a first-class constraint; source generators replace reflection.*

NativeAOT in .NET 10 produces trimmed binaries with faster cold starts (target: measured with `PublishAot`; results vary by feature usage). `JsonSerializerContext` eliminates reflection. No `Reflection.Emit`, no dynamic assembly loading.

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

**P/Invoke AOT migration** -- `[LibraryImport]` replaces `[DllImport]` for AOT-safe native interop. Source generator produces marshalling at compile time (no runtime IL stub). `[DllImport]` generates IL stubs at runtime -- incompatible with NativeAOT trimming.

---
## [5A][LIBRARY_IMPORT]
>**Dictum:** *Source-generated marshalling replaces runtime IL stubs.*

Key migration differences: `CharSet` becomes `StringMarshalling`, `CallingConvention` becomes `[UnmanagedCallConv]`, ANSI removed (UTF-8 first-class).

---
## [6][STATIC_LAMBDAS]
>**Dictum:** *Static lambdas prove zero capture; tuple threading replaces closures.*

`static` on lambdas prevents implicit variable capture. State threaded via `ValueTuple` through monadic `Bind`/`Map`. Zero closure bytes on hot paths. The inner `Map` references `state` from its enclosing `Bind` parameter (same frame), so it CANNOT be `static`.

```csharp
namespace Domain.Performance;

public static class HotPath<T> where T : notnull {
    // Unified pipeline: parse -> validate -> transform -> serialize
    // static lambdas on Bind; inner Map captures Bind parameter (same frame)
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

[CRITICAL]: Outer `Bind` lambdas are `static` -- zero implicit captures. `ValueTuple` fields thread state explicitly through the chain. Local static functions inside method bodies guarantee zero closure capture for recursive helpers.

---
## [7][SPAN_ALGORITHMS]
>**Dictum:** *MemoryExtensions bring allocation-free sorting and search to span-based pipelines.*

`MemoryExtensions.Sort` + `BinarySearch` over `Span<T>` give ordered-set semantics without heap collections, eliminating `SortedSet<T>` on hot paths. `SeparateEither` uses a fold over `Either` -- no meaningless switch arms.

```csharp
namespace Domain.Performance;

public static class SpanAlgorithms {
    public static Fin<int> SortAndFind<T>(
        Span<T> span, T target) where T : IComparable<T> {
        MemoryExtensions.Sort(span: span);
        int index = MemoryExtensions.BinarySearch(
            span: (ReadOnlySpan<T>)span, comparable: target);
        return index switch {
            >= 0 => Fin.Succ(index),
            _ => Fin.Fail<int>(
                     Error.New(message: "Element not found in sorted span"))
        };
    }
    public static (Seq<A>, Seq<B>) SeparateEither<A, B>(Seq<Either<A, B>> items) =>
        items.Fold(
            (LanguageExt.Seq<A>.Empty, LanguageExt.Seq<B>.Empty),
            static (acc, item) => item.Match(
                Left: (A left) => (acc.Item1.Add(left), acc.Item2),
                Right: (B right) => (acc.Item1, acc.Item2.Add(right))
            )
        );
}
```

[IMPORTANT]: `SeparateEither` folds via `Either.Match` -- each arm appends to the correct accumulator. Static lambda on the fold body prevents closure capture.

**Zero-copy reinterpretation** -- `MemoryMarshal.Cast<TFrom, TTo>` reinterprets a `Span<TFrom>` as `Span<TTo>` without copying. Useful for treating `byte[]` payloads as numeric spans for SIMD processing:

```csharp
// Zero-copy byte→double reinterpretation for TensorPrimitives input
ReadOnlySpan<double> doubles = MemoryMarshal.Cast<byte, double>(byteSpan);
```

[CRITICAL]: Both types must be unmanaged value types. Alignment is caller's responsibility. No allocation, no copy -- pointer reinterpretation only.

---
## [7A][CHARSET_VALIDATION]
>**Dictum:** *For `length + allowed-chars` constraints, `SearchValues<char>` beats regex state machines.*

When a validator is strictly `length + allowed chars`, cache `SearchValues<char>` once, then validate the candidate span with a length gate plus `ContainsAnyExcept` (or `IndexOfAnyExcept` when index is required). This path is vectorized, allocation-free, and avoids regex state-machine overhead.

```csharp
namespace Domain.Performance;

public static class PayloadHashValidation {
    private static readonly SearchValues<char> Hex = SearchValues.Create("0123456789abcdef".AsSpan());
    public static bool IsValid(ReadOnlySpan<char> candidate) => candidate.Length == 64 && !candidate.ContainsAnyExcept(Hex);
    public static int FirstInvalidIndex(ReadOnlySpan<char> candidate) => candidate.IndexOfAnyExcept(Hex);
}
```

```csharp
namespace Domain.Performance;

using System.Text.RegularExpressions;

public static partial class SemVerValidation {
    [GeneratedRegex(
        @"^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+(?<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$",
        RegexOptions.NonBacktracking | RegexOptions.CultureInvariant,
        matchTimeoutMilliseconds: 250)]
    private static partial Regex SemVerRegex();
    public static bool IsValid(ReadOnlySpan<char> candidate) => SemVerRegex().IsMatch(candidate);
}
```

```csharp
namespace Domain.Performance;

using System.Collections.Immutable;
using System.Text.RegularExpressions;

public static partial class LogfmtTokenizer {
    [GeneratedRegex(
        @"[A-Za-z_][A-Za-z0-9_]*=(?:""[^""]*""|[^\s""]+)",
        RegexOptions.NonBacktracking | RegexOptions.CultureInvariant,
        matchTimeoutMilliseconds: 250)]
    private static partial Regex PairRegex();

    public static ImmutableArray<(int Start, int Length)> Pairs(ReadOnlySpan<char> line) {
        ImmutableArray<(int Start, int Length)>.Builder pairs = ImmutableArray.CreateBuilder<(int Start, int Length)>();
        foreach (ValueMatch match in PairRegex().EnumerateMatches(line)) {pairs.Add((Start: match.Index, Length: match.Length));}
        return pairs.MoveToImmutable();
    }
}
```

[IMPORTANT]: Prefer `ContainsAnyExcept` for pass/fail checks; use `IndexOfAnyExcept` only when callers need the failing position. For structural grammar (groups/alternation/anchors/multi-segment tokenization), use `[GeneratedRegex(..., RegexOptions.NonBacktracking)]`.

---
## [8][BENCHMARK_GATE]
>**Dictum:** *Performance claims require evidence; benchmark before codifying.*

.NET 10 JIT auto stack-allocates delegates, small arrays, and span-backed buffers that do not escape (target: delegate throughput over virtual dispatch for hot paths; validate via `[MemoryDiagnoser]`). Escape analysis does NOT eliminate closure allocations -- static lambda discipline (see [6]) remains necessary. Profile before manually converting LINQ to loops.

```csharp
using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Running;

[MemoryDiagnoser]
public sealed class SpanVsHeapBenchmarks {
    private readonly string _input = "12345";
    [Benchmark(Baseline = true)]
    public int ParseHeap() => int.Parse(_input);
    [Benchmark]
    public int ParseSpan() => int.Parse(_input.AsSpan());
    // Expected output (validate per environment):
    // |     Method |     Mean | Allocated |
    // |----------- |---------:|----------:|
    // |  ParseHeap | ~18.5 ns |       0 B |
    // |  ParseSpan | ~17.2 ns |       0 B |
}

public static class PerfGate {
    public static void Run() => BenchmarkRunner.Run<SpanVsHeapBenchmarks>();
}
```

[CRITICAL]: Every performance claim in this file uses "target:" framing. Validate with BenchmarkDotNet before standardizing micro-optimizations. Pin runtime version + hardware in benchmark reports.

[IMPORTANT]: .NET 10 escape analysis now reasons about struct fields -- including `Span<T>`'s internal `ref T` + `int` length. Delegates, small arrays, and span-backed buffers that provably do not escape are stack-allocated by the JIT. Example: `BitConverter.GetBytes(...).AsSpan().CopyTo(dest)` chains achieve zero allocation in .NET 10 (was 32B in .NET 9). Validate escape behavior with `[MemoryDiagnoser]` when upgrading -- patterns that previously required manual `stackalloc` may now be JIT-optimized automatically.

---
## [9][RULES]
>**Dictum:** *Rules compress into constraints.*

- [ALWAYS] `ReadOnlySpan<T>` for hot-path input; `Span<T>` for output workspace.
- [ALWAYS] `static` on every lambda in hot paths -- zero closure bytes.
- [ALWAYS] `stackalloc` for small buffers; `ArrayPool` for large; `try/finally` for pool cleanup.
- [ALWAYS] `MemoryExtensions.Sort`/`BinarySearch` over heap-based `SortedSet<T>` on hot paths.
- [ALWAYS] `SearchValues<char>` + `ContainsAnyExcept`/`IndexOfAnyExcept` for fixed char-set validation hot paths (`length + allowed chars`).
- [ALWAYS] Validate hot-path claims with BenchmarkDotNet before standardizing micro-optimizations.
- [ALWAYS] Use `unchecked { }` blocks around hot-path integer arithmetic when overflow semantics are intentional; project-wide `CheckForOverflowUnderflow` is enabled.
- [NEVER] Return `Span<T>` backed by `stackalloc` -- consume within the declaring method.
- [NEVER] `MemoryMarshal.Cast` on spans containing managed references -- runtime throws `ArgumentException`.
- [NEVER] `IEnumerable` LINQ on hot paths -- use span-based processing or TensorPrimitives.
- [NEVER] Micro-optimize before profiling -- .NET 10 JIT escape analysis handles many cases.
- [PREFER] Let JIT decide inlining; use `AggressiveInlining` only on proven bottleneck trampolines.
- [PREFER] `Vector<T>` (auto-width) over `Vector512<T>` unless hardware is guaranteed.
- [PREFER] `[GeneratedRegex]` for structural pattern validation; avoid runtime-constructed `Regex` on hot paths.
- [ALLOW] `bool switch { true => ..., false => ... }` as functional conditional -- preferred over `if/else` per project constraints.
- [ALWAYS] `[LibraryImport]` over `[DllImport]` for native interop -- source-generated marshalling is AOT-safe and inlineable; `[DllImport]` generates IL stubs at runtime (incompatible with NativeAOT).

---
## [10][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                 | [WHEN]                                       | [KEY_TRAIT]                                |
| :-----: | ------------------------- | -------------------------------------------- | ------------------------------------------ |
|   [1]   | **TensorPrimitives**      | Hardware-accelerated numeric math            | `Multiply`/`Sum` over `Span<T>`            |
|   [2]   | **Vector SIMD**           | Branchless conditional logic                 | Mask + `ConditionalSelect` + loop          |
|  [2A]   | **Zero-copy reinterpret** | Bit-level span projection                    | `MemoryMarshal.Cast`/`AsBytes`             |
|   [3]   | **Buffer hybrid**         | Stack/pool strategy selection                | `stackalloc` + `ArrayPool`                 |
|   [4]   | **ValueTask**             | Synchronous cache-hit fast path              | `FromResult` fast path                     |
|   [5]   | **NativeAOT**             | Trimmed AOT binaries, source-gen             | `JsonSerializerContext` source-gen         |
|  [5A]   | **LibraryImport**         | AOT-safe native interop                      | Source-gen marshalling, no IL stub         |
|   [6]   | **Static lambdas**        | Zero closure bytes on hot paths              | `static` keyword + tuple threading         |
|   [7]   | **Span algorithms**       | Allocation-free sort/search/`SeparateEither` | `MemoryExtensions` + fold                  |
|  [7A]   | **Charset validation**    | Fixed `length + allowed chars` checks        | `SearchValues<char>` + `ContainsAnyExcept` |
|   [8]   | **Benchmark gate**        | Evidence-backed perf claims                  | `[MemoryDiagnoser]` + baseline             |
