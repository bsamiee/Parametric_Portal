# [H1][CONCURRENCY]
>**Dictum:** *Coordination is algebraic: bounded flow, cancellation, release, observed joins.*

<br>

Concurrency in C# 14 / .NET 10 (`using static LanguageExt.Prelude;` assumed) is boundary architecture -- domain transforms stay pure; coordination belongs at the effectful shell where I/O is already acknowledged. `Channel<T>` replaces queue-plus-lock patterns with bounded, backpressure-native fan-out; `Lock` (.NET 9+) and `SemaphoreSlim` gate synchronization at boundary sites exclusively -- never inside `Eff<RT,T>` pipelines. Cancellation threads explicitly as `CancellationToken` at adapter entry points, or implicitly via the `HasCancellationToken<RT>` trait deep inside `Eff` chains; resource lifecycle is always `Bracket`/`IO.bracket` -- `try/finally` is a boundary-adapter exemption only.

---
## [1][COORDINATION_ALGEBRA]
>**Dictum:** *Acquire-use-release, cancellation, and bounded fan-out belong in one compositional surface.*

<br>

`Bracket` encodes acquire/use/release as a first-class effect -- `Fin` is guaranteed regardless of success, failure, or cancellation, replacing `try/finally` entirely in domain code. `WithTimeout` composes a deadline into any `Eff` pipeline by scoping a linked `CancellationTokenSource` inside `Bracket`; `ParallelBounded` is the approved boundary adapter for ad-hoc fan-out when a full `Channel<T>` pipeline topology is disproportionate.

```csharp
namespace Domain.Concurrency;

using System.Threading.Channels;
using LanguageExt;
using LanguageExt.Common;
using LanguageExt.Traits;
using static LanguageExt.Prelude;

// --- [FUNCTIONS] -------------------------------------------------------------

public static class Coordination {
    public static Eff<RT, T> Bracketed<RT, TResource, T>(
        IO<TResource> acquire,
        Func<TResource, Eff<RT, T>> use,
        Action<TResource> release) =>
        from result in acquire
            .Bracket(
                Use: (TResource resource) => use(resource),
                Fin: (TResource resource) =>
                    IO.lift(() => {
                        release(resource);
                        return unit;
                    }))
        select result;
    public static Eff<RT, T> WithTimeout<RT, T>(
        TimeSpan timeout,
        CancellationToken parentToken,
        Func<CancellationToken, Eff<RT, T>> operation) =>
        from result in Bracketed(
            acquire: IO.lift(() => {
                CancellationTokenSource linked =
                    CancellationTokenSource
                        .CreateLinkedTokenSource(parentToken);
                linked.CancelAfter(timeout);
                return linked;
            }),
            use: (CancellationTokenSource linked) =>
                operation(linked.Token),
            release: (CancellationTokenSource linked) =>
                linked.Dispose())
        select result;
    // [BOUNDARY ADAPTER -- sync lock acquire is imperative]
    public static Fin<T> WithLock<T>(
        Lock gate, Func<Fin<T>> criticalSection) {
        using Lock.Scope _ = gate.EnterScope();
        return criticalSection();
    }
    public static IO<Seq<TResult>> ParallelBounded<TInput, TResult>(
        Seq<TInput> inputs, int maxConcurrency,
        CancellationToken cancellationToken,
        Func<TInput, CancellationToken, Task<TResult>> operation) =>
        IO.lift(async () => {
            // [BOUNDARY ADAPTER -- semaphore lifecycle + try/finally
            //  for deterministic release on success, fault, cancel]
            using SemaphoreSlim gate = new(
                maxConcurrency, maxConcurrency);
            Task<TResult>[] tasks = inputs
                .Map((TInput input) => ExecuteGated(input))
                .ToArray();
            TResult[] values = await Task
                .WhenAll(tasks).ConfigureAwait(false);
            return toSeq(values);
            async Task<TResult> ExecuteGated(TInput input) {
                await gate.WaitAsync(cancellationToken)
                    .ConfigureAwait(false);
                try {
                    return await operation(input, cancellationToken)
                        .ConfigureAwait(false);
                }
                finally {
                    gate.Release();
                }
            }
        });
}
```

---
## [2][CHANNEL_TOPOLOGIES]
>**Dictum:** *Backpressure is explicit at construction; error propagation is terminal.*

<br>

`BoundedChannelOptions` locks topology at construction -- capacity, `FullMode`, and reader/writer cardinality are structural decisions, not runtime tuning. `RunStage` is the canonical pipeline primitive: a `Fin<TOut>` failure calls `writer.Complete(error.ToException())`, terminating the downstream stage immediately rather than swallowing the error or leaving the writer open.

```csharp
namespace Domain.Concurrency;

using System.Threading.Channels;
using LanguageExt;
using LanguageExt.Common;
using static LanguageExt.Prelude;

// --- [FUNCTIONS] -------------------------------------------------------------

public static class ChannelTopology {
    public static Channel<T> CreateBounded<T>(
        int capacity, BoundedChannelFullMode fullMode,
        bool singleWriter, bool singleReader) =>
        Channel.CreateBounded<T>(
            new BoundedChannelOptions(capacity) {
                FullMode = fullMode,
                SingleWriter = singleWriter,
                SingleReader = singleReader,
                AllowSynchronousContinuations = false
            });
    public static IO<Unit> RunStage<TIn, TOut>(
        ChannelReader<TIn> reader, ChannelWriter<TOut> writer,
        CancellationToken cancellationToken,
        Func<TIn, Fin<TOut>> transform) =>
        liftIO(async () => {
            // [BOUNDARY ADAPTER -- async enumeration + writer lifecycle]
            await foreach (TIn input in reader
                .ReadAllAsync(cancellationToken)
                .ConfigureAwait(false)) {
                await transform(input).Match(
                    Succ: (TOut output) =>
                        writer.WriteAsync(output, cancellationToken),
                    Fail: (Error error) => {
                        writer.Complete(error.ToException());
                        return default(ValueTask);
                    }).ConfigureAwait(false);
            }
            writer.Complete();
            return unit;
        });
}
```

| [INDEX] | [FULL_MODE]      | [SEMANTICS]              | [PRIMARY_USE]          |
| :-----: | :--------------- | ------------------------ | ---------------------- |
|   [1]   | **`Wait`**       | Awaits available space   | Lossless event pipes   |
|   [2]   | **`DropOldest`** | Oldest item evicted      | Latest-state telemetry |
|   [3]   | **`DropNewest`** | Newest item evicted      | Earliest causality     |
|   [4]   | **`DropWrite`**  | Incoming write discarded | Best-effort signals    |

Bounded channels require positive `capacity`; backpressure declared once at construction.

---
## [3][ASYNC_STREAM_BOUNDARIES]
>**Dictum:** *`await foreach` is a sanctioned boundary primitive; token and continuation policy are explicit.*

<br>

`[EnumeratorCancellation]` on the token parameter makes cancellation cooperative at call sites via `WithCancellation`; `ConfigureAwait(false)` is mandatory throughout. The C# async iterator spec requires statement-form `if` + `yield return` -- these are the only permitted imperative constructs at this boundary, each annotated with a `[BOUNDARY ADAPTER]` comment explaining the spec constraint.

```csharp
namespace Domain.Concurrency;

// [EnumeratorCancellation] requires this import
using System.Runtime.CompilerServices;
using LanguageExt;
using static LanguageExt.Prelude;

// --- [FUNCTIONS] -------------------------------------------------------------

public static class AsyncStreams {
    extension<T>(IAsyncEnumerable<T> stream) {
        // [BOUNDARY ADAPTER -- yield-based accumulation;
        //  async iterator protocol mandates mutable binding +
        //  conditional yield. Seq<T> is immutable; binding evolves.]
        public async IAsyncEnumerable<Seq<T>> Batch(
            int batchSize,
            [EnumeratorCancellation]
            CancellationToken cancellationToken = default) {
            Seq<T> batch = Empty;
            await foreach (T item in stream
                .WithCancellation(cancellationToken)
                .ConfigureAwait(false)) {
                batch = batch.Add(item);
                // [BOUNDARY ADAPTER -- conditional yield; yield
                //  cannot appear in expression-bodied constructs]
                if (batch.Count >= batchSize) {
                    yield return batch;
                    batch = Empty;
                }
            }
            // [BOUNDARY ADAPTER -- terminal flush; yield cannot appear in switch/ternary arm]
            if (!batch.IsEmpty) { yield return batch; }
        }
    }
    // [BOUNDARY ADAPTER -- async enumeration materialization]
    public static IO<Seq<T>> Collect<T>(
        IAsyncEnumerable<T> stream,
        CancellationToken cancellationToken) =>
        liftIO(async () => {
            Seq<T> acc = Empty;
            await foreach (T item in stream
                .WithCancellation(cancellationToken)
                .ConfigureAwait(false)) {
                acc = acc.Add(item);
            }
            return acc;
        });
}
```

---
## [4][CONCURRENCY_CANON]
>**Dictum:** *Canon constraints codify non-negotiable concurrency guarantees.*

<br>

Every row maps to a Roslyn analyzer or architectural invariant -- enforcement is compile-time, not review-time. `RESOURCE_LIFECYCLE` and `TOKEN_THREADING` catch the highest-severity bugs (leaked handles, silent cancellation loss); `DOMAIN_STATE` and `IMMUTABLE_ACCUM` enforce the hard boundary between coordination (shell) and pure computation (domain).

| [INDEX] | [CONSTRAINT]             | [MANDATE]                        | [ENFORCER]              |
| :-----: | :----------------------- | -------------------------------- | ----------------------- |
|   [1]   | **`RESOURCE_LIFECYCLE`** | Bracket-form acquire/use/release | CA2000                  |
|   [2]   | **`TOKEN_THREADING`**    | Async APIs forward cancel tokens | MA0032 (strict), CA2016 |
|   [3]   | **`ASYNC_OBSERVATION`**  | Spawned work joined via WhenAll  | VSTHRD110               |
|   [4]   | **`AWAIT_INTENT`**       | ConfigureAwait(false) on lib     | VSTHRD111               |
|   [5]   | **`LOCK_DISCIPLINE`**    | Lock for sync only; never await  | MA0158                  |
|   [6]   | **`SEMAPHORE_SCOPE`**    | WaitAsync(token) + Release       | Bounded exclusion       |
|   [7]   | **`CHANNEL_EXPLICIT`**   | Bounded + explicit full mode     | Deterministic BP        |
|   [8]   | **`ERROR_PROPAGATION`**  | Stage failure completes writer   | Downstream signal       |
|   [9]   | **`DOMAIN_STATE`**       | Atom/Ref, not lock choreography  | Compositional inv.      |
|  [10]   | **`IMMUTABLE_ACCUM`**    | Fold/aggregate, not reassignment | Referential transp.     |
|  [11]   | **`NO_TASKRUN_FANOUT`**  | No Task.Run fan-out as policy    | Bounded topology        |