# [H1][CONCURRENCY]
>**Dictum:** *Coordination is algebraic: bounded flow, cancellation, release, observed joins.*

<br>

Concurrency in C# 14 / .NET 10 (`using static LanguageExt.Prelude;` assumed) is boundary architecture -- domain transforms stay pure; coordination belongs at the effectful shell. `Channel<T>` replaces queue-plus-lock patterns with bounded, backpressure-native fan-out; `Lock` (.NET 9+) and `SemaphoreSlim` gate synchronization at boundary sites exclusively. Cancellation threads explicitly as `CancellationToken` at adapter entry points, or implicitly via `HasCancellationToken<RT>` inside `Eff` chains; resource lifecycle is always `Bracket`/`IO.bracket` -- `try/finally` is a boundary-adapter exemption only.

---
## [1][COORDINATION_ALGEBRA]
>**Dictum:** *Acquire-use-release, cancellation, and bounded fan-out belong in one compositional surface.*

<br>

`Bracket` encodes acquire/use/release as a first-class effect -- `Fin` is guaranteed on every exit path including cancellation, replacing `try/finally` in domain code. `WithTimeout` composes a deadline into any `Eff` pipeline by scoping a linked `CancellationTokenSource` inside `Bracket`, ensuring the CTS is disposed even when the timeout fires. `ParallelBounded` is the approved boundary adapter for ad-hoc fan-out when a full `Channel<T>` topology is disproportionate -- it caps concurrency via `SemaphoreSlim` while preserving `IO<A>` composability.

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
                    IO.lift(() => { release(resource); return unit; }))
        select result;
    public static Eff<RT, T> WithTimeout<RT, T>(
        TimeSpan timeout, CancellationToken parentToken,
        Func<CancellationToken, Eff<RT, T>> operation) =>
        from result in Bracketed(
            acquire: IO.lift(() => {
                CancellationTokenSource linked =
                    CancellationTokenSource.CreateLinkedTokenSource(parentToken);
                linked.CancelAfter(timeout);
                return linked;
            }),
            use: (CancellationTokenSource linked) => operation(linked.Token),
            release: (CancellationTokenSource linked) => linked.Dispose())
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
            using SemaphoreSlim gate = new(maxConcurrency, maxConcurrency);
            Task<TResult>[] tasks = inputs
                .Map((TInput input) => ExecuteGated(input)).ToArray();
            TResult[] values = await Task.WhenAll(tasks).ConfigureAwait(false);
            return toSeq(values);
            async Task<TResult> ExecuteGated(TInput input) {
                await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
                try {
                    return await operation(input, cancellationToken)
                        .ConfigureAwait(false);
                }
                finally { gate.Release(); }
            }
        });
}
```

---
## [2][CHANNEL_TOPOLOGIES]
>**Dictum:** *Backpressure is explicit at construction; error propagation is terminal.*

<br>

`BoundedChannelOptions` locks topology at construction -- capacity, `FullMode`, and reader/writer cardinality are structural decisions, not runtime tuning. `RunStage` is the canonical pipeline primitive: a `Fin<TOut>` failure calls `writer.Complete(error.ToException())`, terminating the downstream stage immediately rather than leaving the writer open. Setting `AllowSynchronousContinuations = false` prevents reader callbacks from executing on the writer's thread, avoiding unpredictable latency spikes in producer-critical paths.

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
                .ReadAllAsync(cancellationToken).ConfigureAwait(false)) {
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

---
## [3][ASYNC_STREAM_BOUNDARIES]
>**Dictum:** *`await foreach` is a sanctioned boundary primitive; token and continuation policy are explicit.*

<br>

`[EnumeratorCancellation]` on the token parameter makes cancellation cooperative at call sites via `WithCancellation`; `ConfigureAwait(false)` is mandatory throughout. The C# async iterator spec requires statement-form `if` + `yield return` -- these are the only permitted imperative constructs at this boundary, each annotated with `[BOUNDARY ADAPTER]`. Batching via `Seq<T>` preserves immutability: the binding evolves through `Add` on each iteration, keeping the body as close to pure accumulation as the spec allows.

```csharp
namespace Domain.Concurrency;

using System.Runtime.CompilerServices;
using LanguageExt;
using static LanguageExt.Prelude;

// --- [FUNCTIONS] -------------------------------------------------------------
public static class AsyncStreams {
    extension<T>(IAsyncEnumerable<T> stream) {
        // [BOUNDARY ADAPTER -- yield-based accumulation; Seq<T> immutable binding evolves]
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
            // [BOUNDARY ADAPTER -- terminal flush]
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

Every row maps to a Roslyn analyzer or architectural invariant -- enforcement is compile-time, not review-time. `RESOURCE_LIFECYCLE` and `TOKEN_THREADING` catch the highest-severity bugs: leaked handles exhaust OS resources, lost tokens make graceful shutdown impossible. `DOMAIN_STATE` and `IMMUTABLE_ACCUM` enforce the boundary between coordination (shell) and pure computation (domain).

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

---
## [5][ATOMIC_COORDINATION]
>**Dictum:** *Race conditions are structural defects; Atom CAS makes them algebraically impossible.*

<br>

`Atom<T>` eliminates race conditions via Compare-And-Swap: every `Swap` applies a pure `A -> A` function -- if the underlying value changed between read and write, the runtime retries automatically. The optional validator rejects transitions violating domain invariants; a spike in rejections indicates a contention hotspot requiring partition or promotion to `Ref<T>` + `atomic`. `Swap` functions execute potentially multiple times under contention -- they MUST be side-effect-free. The same CAS primitive scales from in-process session tracking to distributed leader election and idempotent deduplication; only the boundary transport changes. See `effects.md` [7] for `Atom`/`Ref`/`atomic`/`snapshot`/`serial` foundations.

```csharp
namespace Domain.Concurrency;

using LanguageExt;
using NodaTime;
using static LanguageExt.Prelude;

// --- [TYPES] -----------------------------------------------------------------
public readonly record struct NodeId(string Value);
public readonly record struct EventId(string Value);
public readonly record struct SessionId(string Value);
public readonly record struct SessionState(
    SessionId Id, Instant ConnectedAt, bool IsActive);

// --- [FUNCTIONS] -------------------------------------------------------------
public static class AtomicCoordination {
    // --- [SESSION_TRACKING] --------------------------------------------------
    public static readonly Atom<HashMap<SessionId, SessionState>> Sessions = Atom(
        HashMap<SessionId, SessionState>(),
        (HashMap<SessionId, SessionState> state) => state.ForAll(
            (SessionId _, SessionState session) => session.IsActive));
    public static Unit Register(SessionState session) =>
        Sessions.Swap(
            (HashMap<SessionId, SessionState> current) =>
                current.AddOrUpdate(session.Id, session));
    // --- [LEADER_ELECTION] ---------------------------------------------------
    public static readonly Atom<Option<NodeId>> Leader = Atom(Option<NodeId>.None);
    public static bool Claim(NodeId candidate) =>
        Leader.Swap(
            (Option<NodeId> current) => current.Match(
                Some: (NodeId _) => current,
                None: () => Some(candidate)))
        .Match(
            Some: (NodeId elected) => elected.Value == candidate.Value,
            None: () => false);
    // --- [IDEMPOTENT_DEDUP] --------------------------------------------------
    // Two-phase CAS: Swap atomically checks + reserves in one operation,
    // eliminating the TOCTOU race of a separate ContainsKey/Swap sequence.
    // On process failure the reservation is rolled back so retries can succeed.
    public static readonly Atom<HashMap<EventId, Instant>> Processed = Atom(
        HashMap<EventId, Instant>());
    public static Eff<RT, Option<TResult>> TryProcess<RT, TResult>(
        EventId eventId, IClock clock, Eff<RT, TResult> process) =>
        liftEff(() => {
            Instant now = clock.GetCurrentInstant();
            bool reserved = false;
            Processed.Swap((HashMap<EventId, Instant> current) =>
                current.ContainsKey(eventId)
                    ? current
                    : current.AddOrUpdate(eventId, now).Map(_ => { reserved = true; return _; }));
            return reserved;
        }).Bind((bool isNew) => isNew
            ? (from result in process
                   | @catch(static (Error _) => true, liftEff<RT, TResult>(() => {
                         Processed.Swap((HashMap<EventId, Instant> current) =>
                             current.Remove(eventId));
                         return Prelude.raise<TResult>(Error.New("TryProcess: rolled back reservation"));
                     }))
               select Some(result))
            : Eff<RT, Option<TResult>>.Pure(Option<TResult>.None));
    public static Unit Purge(IClock clock, Duration retention) =>
        Processed.Swap((HashMap<EventId, Instant> current) => {
            Instant cutoff = clock.GetCurrentInstant() - retention;
            return current.Filter((Instant processedAt) => processedAt > cutoff);
        });
}
```

[CRITICAL]: Leader CAS is local-only -- for cross-node election, wrap `Claim`/`Abdicate` in `Eff<RT, T>` that syncs with an external distributed lock (Redis `SET NX`, PostgreSQL advisory lock). Without periodic `Purge`, the idempotency `HashMap` grows unbounded -- compose with `Schedule`-based repeating effect (see `effects.md` [8]).

| [INDEX] | [PATTERN]        | [DISTRIBUTED_USE]                       | [LOCAL_PRIMITIVE]               |
| :-----: | :--------------- | --------------------------------------- | ------------------------------- |
|   [1]   | Message queue    | Cross-node `Channel<T>` + transport     | `Channel<T>` ([2])             |
|   [2]   | Leader election  | CAS + external lock at boundary         | `Atom<Option<NodeId>>`         |
|   [3]   | Idempotent dedup | CAS + external unique constraint        | `Atom<HashMap<EventId, _>>`   |
|   [4]   | Retry / backoff  | `Schedule` algebra across network calls | `Schedule` (`effects.md` [8]) |

---
## [6][HAZARDS]
>**Dictum:** *Thread pool starvation is a distributed deadlock; detect structurally, not symptomatically.*

<br>

Sync-over-async (`.Result`, `.Wait()`, `.GetAwaiter().GetResult()`) blocks a thread-pool thread waiting for a continuation that itself needs a thread-pool thread. Under load, all threads deadlock -- the CLR injects ~1-2 threads/second, far too slow for burst recovery. The only sanctioned escape hatch is `IO.Run()` at the outermost boundary. Monitor starvation by exposing `ThreadPool.PendingWorkItemCount` via `ObservableGauge` wrapped in `IO<ThreadPoolSnapshot>`; alert when pending items exceed `ThreadCount * 2` sustained over 5 seconds.

```csharp
// [ANTI-PATTERN -- .Result blocks thread pool thread, causing starvation]
public string GetData() {
    var result = httpClient.GetStringAsync("https://api.example.com/data").Result;
    return result;
}
```

```csharp
namespace Domain.Concurrency;

using LanguageExt;
using static LanguageExt.Prelude;

// --- [FUNCTIONS] -------------------------------------------------------------
public static class AsyncBoundary {
    public static IO<string> FetchData(HttpClient client, string url) =>
        IO.liftAsync(async () =>
            await client.GetStringAsync(url).ConfigureAwait(false));
}
```

[CRITICAL]: `.Result` / `.Wait()` / `.GetAwaiter().GetResult()` are FORBIDDEN in any code reachable from a thread-pool context. `ConfigureAwait(false)` is mandatory in all library code. Combine `Schedule`-based polling (see `effects.md` [8]) with thread pool metrics for periodic health checks.

---
## [7][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] `Bracket` for resource acquire/use/release -- `try/finally` only at `[BOUNDARY ADAPTER]` sites.
- [ALWAYS] `Channel<T>` with `BoundedChannelOptions` -- capacity and `FullMode` declared at construction.
- [ALWAYS] `Atom<T>` for lock-free concurrent state -- `Swap` functions must be side-effect-free.
- [ALWAYS] `Ref<T>` + `atomic` for multi-value transactional consistency.
- [ALWAYS] `CancellationToken` forwarded through every async API -- `[EnumeratorCancellation]` on iterators.
- [ALWAYS] `ConfigureAwait(false)` on every `await` in library code.
- [ALWAYS] `static readonly` for shared `Atom`/`Ref` -- expression-bodied properties create new instances.
- [ALWAYS] `IO.liftAsync` for wrapping async boundary operations.
- [NEVER] `.Result` / `.Wait()` / `.GetAwaiter().GetResult()` -- sync-over-async starvation.
- [NEVER] `Lock` or `Monitor` around `await` -- use `SemaphoreSlim.WaitAsync(token)`.
- [NEVER] `Task.Run` for fan-out -- use `ParallelBounded` or `Channel<T>` topology.
- [NEVER] `ConcurrentDictionary` in domain code -- use `Atom<HashMap<K,V>>`.
- [NEVER] Unbounded channels -- always specify capacity and `FullMode`.
- [IMPORTANT] Stage failures MUST call `writer.Complete(exception)` -- silent swallow hangs downstream.
- [IMPORTANT] Periodic `Purge` on idempotency atoms -- unbounded growth is a slow memory leak.

---
## [8][QUICK_REFERENCE]

| [INDEX] | [PATTERN]              | [WHEN]                              | [KEY_TRAIT]                          |
| :-----: | :--------------------- | :---------------------------------- | ------------------------------------ |
|   [1]   | `Bracket`              | Resource acquire/use/release        | `IO.Bracket` + guaranteed `Fin`      |
|   [2]   | `WithTimeout`          | Deadline-scoped `Eff` pipeline      | Linked CTS inside `Bracket`          |
|   [3]   | `Channel<T>` bounded   | Backpressure-native fan-out         | `BoundedChannelOptions` + `FullMode` |
|   [4]   | `RunStage`             | Channel pipeline stage              | `Fin<TOut>` failure completes writer |
|   [5]   | `await foreach` + batch | Async stream consumption           | `[EnumeratorCancellation]` + `Seq`   |
|   [6]   | `Atom<T>` CAS          | Lock-free state / leader election   | `Swap` + optional validator          |
|   [7]   | `Atom<HashMap<K,V>>`   | Concurrent map / idempotent dedup   | CAS retry + immutable inner          |
|   [8]   | `Ref<T>` + `atomic`    | Multi-ref transactional consistency | STM commit/rollback                  |
|   [9]   | `ParallelBounded`      | Ad-hoc bounded fan-out              | `SemaphoreSlim` + `IO<Seq<T>>`       |
|  [10]   | `IO.liftAsync`         | Async boundary wrapping             | Avoids sync-over-async starvation    |
