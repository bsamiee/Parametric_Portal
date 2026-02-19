# [H1][CONCURRENCY]
>**Dictum:** *Coordination is algebraic: bounded flow, explicit cancellation, guaranteed release, and observed joins.*

<br>

Concurrency in C# 14 / .NET 10 is boundary architecture, not domain mutation strategy. `Channel<T>` provides constrained flow, `Lock` and `SemaphoreSlim` provide boundary-only synchronization, and cancellation is environmental (`Has<RT, CancellationToken>`). All snippets assume `using static LanguageExt.Prelude;`.

---
## [1][COORDINATION_ALGEBRA]
>**Dictum:** *Acquire-use-release, cancellation, and bounded fan-out belong in one compositional surface.*

<br>

```csharp
namespace Domain.Concurrency;

using System.Threading.Channels;
using LanguageExt;
using LanguageExt.Common;
using LanguageExt.Traits;
using static LanguageExt.Prelude;

public interface HasCancel<RT> : Has<RT, CancellationToken>
    where RT : HasCancel<RT>;

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
        Func<CancellationToken, Eff<RT, T>> operation)
        where RT : HasCancel<RT> =>
        from parentToken in default(RT).CancellationToken
        from result in Bracketed(
            acquire: IO.lift(() => {
                CancellationTokenSource linked = CancellationTokenSource.CreateLinkedTokenSource(parentToken);
                linked.CancelAfter(timeout);
                return linked;
            }),
            use: (CancellationTokenSource linked) =>
                operation(linked.Token),
            release: (CancellationTokenSource linked) =>
                linked.Dispose())
        select result;
    public static Fin<T> WithLock<T>(
        Lock gate,
        Func<Fin<T>> criticalSection) {
        using Lock.Scope _ = gate.EnterScope();
        return criticalSection();
    }
    public static IO<Seq<TResult>> ParallelBounded<TInput, TResult>(
        Seq<TInput> inputs,
        int maxConcurrency,
        CancellationToken cancellationToken,
        Func<TInput, CancellationToken, Task<TResult>> operation) =>
        liftIO(async () => {
            SemaphoreSlim gate = new(
                initialCount: maxConcurrency,
                maxCount: maxConcurrency);
            try {
                Task<TResult>[] tasks = inputs.Map((TInput input) =>
                    ExecuteGated(
                        gate: gate,
                        input: input,
                        cancellationToken: cancellationToken,
                        operation: operation)).ToArray();
                TResult[] values = await Task.WhenAll(tasks).ConfigureAwait(false);
                return toSeq(values);
            } finally {
                gate.Dispose();
            }
        });
    private static async Task<TResult> ExecuteGated<TInput, TResult>(
        SemaphoreSlim gate,
        TInput input,
        CancellationToken cancellationToken,
        Func<TInput, CancellationToken, Task<TResult>> operation) {
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try {
            return await operation(input, cancellationToken).ConfigureAwait(false);
        } finally {
            gate.Release();
        }
    }
}
```

---
## [2][CHANNEL_TOPOLOGIES]
>**Dictum:** *Backpressure strategy is explicit at construction; error propagation is terminal semantics, not side effect.*

<br>

```csharp
namespace Domain.Concurrency;

using System.Threading.Channels;
using LanguageExt;
using static LanguageExt.Prelude;

public static class ChannelTopology {
    public static Channel<T> CreateBounded<T>(
        int capacity,
        BoundedChannelFullMode fullMode,
        bool singleWriter,
        bool singleReader) =>
        Channel.CreateBounded<T>(
            new BoundedChannelOptions(capacity: capacity) {
                FullMode = fullMode,
                SingleWriter = singleWriter,
                SingleReader = singleReader,
                AllowSynchronousContinuations = false
            });
    public static IO<Unit> RunStage<TIn, TOut>(
        ChannelReader<TIn> reader,
        ChannelWriter<TOut> writer,
        CancellationToken cancellationToken,
        Func<TIn, Fin<TOut>> transform) =>
        liftIO(async () => {
            try {
                await foreach (TIn input in reader
                    .ReadAllAsync(cancellationToken)
                    .ConfigureAwait(false)) {
                    TOut output = transform(input)
                        .IfFail(static (Error error) => throw error.ToException());
                    await writer.WriteAsync(output, cancellationToken)
                        .ConfigureAwait(false);
                }
                writer.Complete();
            } catch (Exception ex) {
                writer.Complete(ex);
            }
            return unit;
        });
}
```

| [FULL_MODE] | [SEMANTICS] | [PRIMARY_USE] |
| ----------- | ----------- | ------------- |
| `Wait` | Producer awaits available capacity | lossless command/event pipelines |
| `DropOldest` | Oldest buffered item evicted | latest-state telemetry streams |
| `DropNewest` | Most recent buffered item evicted | preserve earliest causality |
| `DropWrite` | Incoming write discarded | best-effort non-critical signals |

`capacity` must remain positive for bounded channels; backpressure policy is declared once at topology construction.

---
## [3][ASYNC_STREAM_BOUNDARIES]
>**Dictum:** *`await foreach` is a sanctioned boundary primitive; token and continuation policy are explicit.*

<br>

```csharp
namespace Domain.Concurrency;

using System.Runtime.CompilerServices;
using LanguageExt;
using static LanguageExt.Prelude;

public static class AsyncStreams {
    extension<T>(IAsyncEnumerable<T> stream) {
        public async IAsyncEnumerable<Seq<T>> Batch(
            int batchSize,
            [EnumeratorCancellation] CancellationToken cancellationToken = default) {
            Seq<T> batch = Seq<T>.Empty;
            await foreach (T item in stream
                .WithCancellation(cancellationToken)
                .ConfigureAwait(false)) {
                batch = batch.Add(item);
                if (batch.Count >= batchSize) {
                    yield return batch;
                    batch = Seq<T>.Empty;
                }
            }
            if (!batch.IsEmpty) {
                yield return batch;
            }
        }
    }
    public static IO<Seq<T>> Collect<T>(
        IAsyncEnumerable<T> stream,
        CancellationToken cancellationToken) =>
        liftIO(async () => {
            Seq<T> acc = Seq<T>.Empty;
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

| [CONSTRAINT] | [MANDATE] | [ANALYZER_OR_REASON] |
| ------------ | --------- | -------------------- |
| `RESOURCE_LIFECYCLE` | acquisition and release are composed in bracket form | no orphaned disposables on failure channels |
| `TOKEN_THREADING` | async APIs must accept and forward `CancellationToken` | `MA0032`, `CA2016` |
| `ASYNC_OBSERVATION` | spawned work is always joined/observed (`Task.WhenAll`) | `VSTHRD110` |
| `AWAIT_INTENT` | library awaits are explicit with `ConfigureAwait(false)` | `VSTHRD111` |
| `LOCK_DISCIPLINE` | `Lock` for sync critical sections only; never across `await` | `MA0158` + lock semantics |
| `SEMAPHORE_DISCIPLINE` | `WaitAsync(token)` + guaranteed `Release()` in finally path | bounded async mutual exclusion |
| `CHANNEL_EXPLICITNESS` | bounded channels require explicit full mode and positive capacity | deterministic backpressure |
| `ERROR_PROPAGATION` | stage failures terminate writer with `Complete(exception)` | downstream completion semantics |
| `DOMAIN_STATE` | domain concurrency uses `Atom<T>` / `Ref<T>` transitions, not lock choreography | compositional state invariants |
| `ANTI_PATTERN` | no `Task.Run` fan-out as policy substitute for bounded topology | avoids unbounded scheduler pressure |
