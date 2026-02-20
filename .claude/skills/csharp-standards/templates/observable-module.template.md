# [H1][OBSERVABLE_MODULE]
>**Dictum:** *A single module owns reactive stream lifecycle, backpressure, error propagation, and fused telemetry projection.*

<br>

Produces one observable service module: `BoundedChannel<Fin<T>>` for backpressure-aware streaming, `Eff<RT,T>` producer/consumer lifecycle via bracketed `use`, `Fin<T>` error propagation through the stream without channel collapse, `IAsyncDisposable` resource cleanup, `ObserveSpec`-driven telemetry projection on stream events, and `K<F,A>`-polymorphic message validation.

**Density:** ~400 LOC signals a refactoring opportunity. No file proliferation; helpers are always a code smell.
**References:** `effects.md` (Fin, Eff, IO, @catch, Schedule), `types.md` (domain primitives, sealed DUs), `composition.md` (HKT encoding, extension members), `performance.md` (static lambdas), `observability.md` (structured logging, tracing, metrics, ObserveSpec, TagPolicy), `concurrency.md` (channel patterns, backpressure).
**Anti-Pattern Awareness:** See `patterns.md` [1] for PREMATURE_MATCH_COLLAPSE, NULL_ARCHITECTURE, OVERLOAD_SPAM, VARIABLE_REASSIGNMENT.
**Workflow:** Fill placeholders, remove guidance blocks, verify compilation.

---
**Placeholders**

| [INDEX] | [PLACEHOLDER]         | [EXAMPLE]                                              |
| :-----: | --------------------- | ------------------------------------------------------ |
|   [1]   | `${Namespace}`        | `Domain.Streaming`                                     |
|   [2]   | `${ServiceName}`      | `EventStream`                                          |
|   [3]   | `${Operation}`        | `stream.process`                                       |
|   [4]   | `${MessageType}`      | `StreamMessage`                                        |
|   [5]   | `${ValidatedMessage}` | `ValidatedEvent`                                       |
|   [6]   | `${ResultType}`       | `ProcessedEvent`                                       |
|   [7]   | `${PrimitiveId}`      | `EventId`                                              |
|   [8]   | `${PrimitivePayload}` | `EventPayload`                                         |
|   [9]   | `${DependencyTrait}`  | `IEventSink`                                           |
|  [10]   | `${DependencyMethod}` | `Persist`                                              |
|  [11]   | `${ChannelCapacity}`  | `256`                                                  |
|  [12]   | `${RetrySchedule}`    | `Schedule.exponential(100 * ms) \| Schedule.recurs(3)` |

---
```csharp
namespace ${Namespace};

using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using LanguageExt;
using LanguageExt.Common;
using LanguageExt.Traits;
using Microsoft.Extensions.Logging;
using Serilog.Context;
using static LanguageExt.Prelude;

// --- [TYPES] -----------------------------------------------------------------

public readonly record struct ${MessageType}(Guid CandidateId, string CandidatePayload);
public readonly record struct ${ValidatedMessage}(${PrimitiveId} Id, ${PrimitivePayload} Payload);
public readonly record struct ${ResultType}(${PrimitiveId} Id, string Confirmation);

// --- [SCHEMA] ----------------------------------------------------------------

// Stream outcome: sealed DU with Fold catamorphism for exhaustive dispatch.

public abstract record StreamOutcome<T> {
    private protected StreamOutcome() { }
    public sealed record Yielded(T Value) : StreamOutcome<T>;
    public sealed record Faulted(Error Reason) : StreamOutcome<T>;
    public sealed record Completed : StreamOutcome<T>;
    public TResult Fold<TResult>(
        Func<Yielded, TResult> onYielded,
        Func<Faulted, TResult> onFaulted,
        Func<Completed, TResult> onCompleted) =>
        this switch {
            Yielded yielded => onYielded(yielded),
            Faulted faulted => onFaulted(faulted),
            Completed completed => onCompleted(completed),
            _ => throw new UnreachableException(
                message: "Exhaustive: all StreamOutcome variants handled")
        };
}

// --- [ERRORS] ----------------------------------------------------------------

public static class ${ServiceName}Errors {
    public static readonly Error ChannelClosed =
        Error.New(code: 5001, message: "${ServiceName} channel closed.");
    public static readonly Error BackpressureExceeded =
        Error.New(code: 5002, message: "${ServiceName} backpressure capacity exceeded.");
    public static readonly Error ValidationFailed =
        Error.New(code: 5003, message: "${ServiceName} validation failed.");
}

// --- [SIGNALS] ---------------------------------------------------------------

internal static class Signals {
    internal static readonly ActivitySource Source = new("${Namespace}", "1.0.0");
    internal static readonly Meter ServiceMeter = new("${Namespace}", "1.0.0");
    internal static readonly Counter<long> Produced = ServiceMeter.CreateCounter<long>("${Operation}.produced.total", "messages");
    internal static readonly Counter<long> Consumed = ServiceMeter.CreateCounter<long>("${Operation}.consumed.total", "messages");
    internal static readonly Counter<long> Faults = ServiceMeter.CreateCounter<long>("${Operation}.faults.total", "faults");
    internal static readonly UpDownCounter<int> Inflight = ServiceMeter.CreateUpDownCounter<int>("${Operation}.inflight", "messages");
    internal static readonly Histogram<double> ProcessDuration = ServiceMeter.CreateHistogram<double>("${Operation}.process.duration", "s");
    internal static readonly Counter<long> ValidationFailures = ServiceMeter.CreateCounter<long>("${Operation}.validation.failures", "failures");
}

// --- [LOG] -------------------------------------------------------------------

internal static partial class Log {
    [LoggerMessage(2000, LogLevel.Information, "{Operation} producer started capacity={Capacity}")]
    internal static partial void ProducerStarted(ILogger logger, string operation, int capacity);
    [LoggerMessage(2001, LogLevel.Information, "{Operation} consumed in {ElapsedMs}ms")]
    internal static partial void MessageConsumed(ILogger logger, string operation, double elapsedMs);
    [LoggerMessage(2002, LogLevel.Error, "{Operation} fault {ErrorCode}: {ErrorMessage}")]
    internal static partial void StreamFault(ILogger logger, string operation, int errorCode, string errorMessage);
    [LoggerMessage(2003, LogLevel.Information, "{Operation} completed total={TotalMessages}")]
    internal static partial void StreamCompleted(ILogger logger, string operation, long totalMessages);
}

// --- [SERVICES] --------------------------------------------------------------

public interface IObservabilityProvider { ILogger Logger { get; } }
public interface ${DependencyTrait} {
    Eff<string> ${DependencyMethod}(${ValidatedMessage} message);
}
public interface ${ServiceName}Runtime<RT>
    : Has<RT, IObservabilityProvider>, Has<RT, ${DependencyTrait}>
    where RT : ${ServiceName}Runtime<RT>;

// --- [FUNCTIONS] -------------------------------------------------------------

// Fused telemetry projection on StreamOutcome<T>. Single surface for
// counters, histogram, structured logs, and span status.
public static class Observe {
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static StreamOutcome<T> Outcome<T>(
        StreamOutcome<T> outcome, ILogger logger,
        string operation, long startTimestamp) =>
        outcome.Fold(
            onYielded: (StreamOutcome<T>.Yielded yielded) => {
                TimeSpan elapsed = TimeProvider.System.GetElapsedTime(startTimestamp);
                TagList tags = new() { { "operation", operation }, { "outcome", "success" } };
                Signals.Consumed.Add(1, tags);
                Signals.ProcessDuration.Record(elapsed.TotalSeconds, tags);
                Log.MessageConsumed(logger, operation, elapsed.TotalMilliseconds);
                return yielded;
            },
            onFaulted: (StreamOutcome<T>.Faulted faulted) => {
                TagList tags = new() {
                    { "operation", operation }, { "outcome", "failure" },
                    { "error.code", faulted.Reason.Code }
                };
                Signals.Faults.Add(1, tags);
                Log.StreamFault(logger, operation, faulted.Reason.Code, faulted.Reason.Message);
                return faulted;
            },
            onCompleted: static (StreamOutcome<T>.Completed completed) => completed);
    public static Validation<Error, T> Validation<T>(
        Validation<Error, T> validation, string operation) =>
        validation.BiMap(
            Succ: (T value) => value,
            Fail: (Error error) => {
                Signals.ValidationFailures.Add(
                    toSeq(error.AsIterable()).Count,
                    new TagList { { "operation", operation } });
                return error;
            });
}
// Channel-based reactive pipeline. BoundedChannel<Fin<T>> provides
// backpressure; Fin<T> flows through preserving error context.
public static class ${ServiceName} {
    public static K<F, ${ValidatedMessage}> ValidateGeneric<F>(
        ${MessageType} message) where F : Fallible<F>, Applicative<F> =>
        (
            ${PrimitiveId}.CreateK<F>(candidate: message.CandidateId),
            ${PrimitivePayload}.CreateK<F>(candidate: message.CandidatePayload)
        ).Apply(
            (${PrimitiveId} validId, ${PrimitivePayload} validPayload) =>
                new ${ValidatedMessage}(Id: validId, Payload: validPayload));
    public static Channel<Fin<${ValidatedMessage}>> CreateChannel() =>
        Channel.CreateBounded<Fin<${ValidatedMessage}>>(
            new BoundedChannelOptions(capacity: ${ChannelCapacity}) {
                FullMode = BoundedChannelFullMode.Wait,
                SingleWriter = false, SingleReader = true
            });
    // Produce: validate, write to channel. Backpressure via TryWrite gate.
    public static Eff<RT, Unit> Produce<RT>(
        ChannelWriter<Fin<${ValidatedMessage}>> writer, ${MessageType} message)
        where RT : ${ServiceName}Runtime<RT> =>
        from validated in Observe.Validation(
                ValidateGeneric<Validation<Error>>(message: message).As(),
                "${Operation}.validate")
            .ToFin()
            .MapFail((Error error) =>
                Error.New(message: "${ServiceName} validation failed.", inner: error))
            .ToEff()
        from _ in guard(
            writer.TryWrite(item: FinSucc(validated)),
            ${ServiceName}Errors.BackpressureExceeded)
        from __ in liftEff(static () => {
            Signals.Produced.Add(1, new TagList { { "operation", "${Operation}" } });
            return unit;
        })
        select unit;
    // Consume: read one item, process via dependency, emit telemetry.
    // Bracket owns Activity span lifecycle; Inflight gauge tracks depth.
    public static Eff<RT, StreamOutcome<${ResultType}>> Consume<RT>(
        ChannelReader<Fin<${ValidatedMessage}>> reader)
        where RT : ${ServiceName}Runtime<RT> =>
        from observability in default(RT).ObservabilityProvider
        from dependency in default(RT).${DependencyTrait}
        from outcome in IO.lift(
            () => Signals.Source.StartActivity("${Operation}.consume", ActivityKind.Internal))
            .Bracket(
                Use: (Activity? activity) => {
                    long start = TimeProvider.System.GetTimestamp();
                    Signals.Inflight.Add(1);
                    return reader.TryRead(out Fin<${ValidatedMessage}>? item) switch {
                        false => liftEff(static () => {
                            Signals.Inflight.Add(-1);
                            return (StreamOutcome<${ResultType}>)
                                new StreamOutcome<${ResultType}>.Completed();
                        }),
                        true => item!.Match(
                            Succ: (${ValidatedMessage} validated) =>
                                dependency.${DependencyMethod}(message: validated)
                                    .Retry(schedule: ${RetrySchedule} & Schedule.upto(30 * sec))
                                    .Map((string confirmation) => {
                                        Signals.Inflight.Add(-1);
                                        return (StreamOutcome<${ResultType}>)
                                            new StreamOutcome<${ResultType}>.Yielded(
                                                new ${ResultType}(
                                                    Id: validated.Id,
                                                    Confirmation: confirmation));
                                    }),
                            Fail: (Error error) => liftEff(() => {
                                Signals.Inflight.Add(-1);
                                return (StreamOutcome<${ResultType}>)
                                    new StreamOutcome<${ResultType}>.Faulted(error);
                            }))
                    }.Map((StreamOutcome<${ResultType}> result) =>
                        Observe.Outcome(result, observability.Logger,
                            "${Operation}.consume", start)).As();
                },
                Fin: static (Activity? activity) => IO.lift(() => {
                    activity?.Dispose();
                    return unit;
                }))
        select outcome;
}

// --- [LAYERS] ----------------------------------------------------------------

public static class ${ServiceName}Boundary {
    public static Fin<long> RunStream<RT>(
        Seq<${MessageType}> messages, RT runtime, ILogger logger)
        where RT : ${ServiceName}Runtime<RT> {
        using Activity? activity = Signals.Source.StartActivity(
            "${Operation}", ActivityKind.Internal);
        Channel<Fin<${ValidatedMessage}>> channel = ${ServiceName}.CreateChannel();
        Log.ProducerStarted(logger, "${Operation}", ${ChannelCapacity});
        long produced = messages.Fold(0L,
            (long count, ${MessageType} message) =>
                ${ServiceName}.Produce<RT>(writer: channel.Writer, message: message)
                    .Run(runtime).Run()
                    .Match(Succ: static (Unit _, long current) => current + 1,
                           Fail: static (Error _, long current) => current, count));
        channel.Writer.Complete();
        Log.StreamCompleted(logger, "${Operation}", produced);
        activity?.SetStatus(ActivityStatusCode.Ok);
        return FinSucc(produced);
    }
}

// --- [EXPORT] ----------------------------------------------------------------

// All types and static classes above use explicit accessibility.
// No barrel files or re-exports.
```

---
**Guidance: Channel-Based Reactive Streams**

`System.Threading.Channels` provides the reactive substrate: `BoundedChannel<Fin<T>>` enforces backpressure via `BoundedChannelFullMode.Wait`, the writer blocks cooperatively when the buffer is full. Wrapping items in `Fin<T>` propagates errors through the channel without collapsing the stream -- a faulted message is one item, not a terminal signal. The `StreamOutcome<T>` sealed DU with `Fold` catamorphism classifies consumer results exhaustively: `Yielded` for successful processing, `Faulted` for per-message errors, `Completed` for stream termination. This avoids `if`/`switch` in consumer logic.

**Guidance: Producer/Consumer Lifecycle**

`Produce` validates via `K<F,A>`-polymorphic `ValidateGeneric`, writes to the bounded channel via `guard` + `TryWrite`, and emits `Signals.Produced` metrics. `Consume` reads from `ChannelReader`, brackets each message in an `Activity` span, delegates to the dependency trait with retry schedule, and projects telemetry through `Observe.Outcome`. The bracket pattern (`IO.lift(...).Bracket(Use:..., Fin:...)`) ensures the `Activity` is disposed regardless of success or failure -- no leaked spans. `Signals.Inflight` tracks concurrent processing depth.

**Guidance: Telemetry Projection**

`Observe.Outcome` on `StreamOutcome<T>` is the single fused projection surface. The `Fold` catamorphism dispatches to success/failure/completion telemetry paths: counters (`Produced`, `Consumed`, `Faults`), histogram (`ProcessDuration`), gauge (`Inflight`), structured logs via `[LoggerMessage]`, and `Activity` span status. `Observe.Validation` handles validation failure counting independently. All metric dimensions follow the `operation` + `outcome` taxonomy from `observability.md` `TagPolicy.Outcome`.

---
## [POST_SCAFFOLD]

- [ ] Replace all `${...}` placeholders with domain-specific names
- [ ] Verify all records are `sealed`; all value types are `readonly record struct`
- [ ] Add `[MethodImpl(AggressiveInlining)]` to all pure hot-path functions
- [ ] Confirm no `if`/`switch` statements in domain logic; `Fold` at boundary only
- [ ] Add `Telemetry.span` to all public service operations
- [ ] Wire `Layer` into `ServicesLayer` in composition root
- [ ] Write at least one property-based test per pure function
- [ ] Run `dotnet build` and verify zero warnings/errors
