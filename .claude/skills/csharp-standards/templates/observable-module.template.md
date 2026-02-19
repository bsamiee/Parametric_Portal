# [H1][OBSERVABLE_MODULE]
>**Dictum:** *A single module owns business flow and fused telemetry projection without monadic collapse.*

<br>

Produces one observable service module: applicative validation, `Eff<RT,T>` runtime DI, bracketed span lifecycle, structured logging, and metrics with retry projection.

**Density:** ~400 LOC signals a refactoring opportunity. No file proliferation; helpers are always a code smell.
**References:** `effects.md` (Fin, Eff, Validation, @catch, Schedule), `types.md` (domain primitives), `objects.md` (boundary adapters), `composition.md` (HKT encoding, extension members), `performance.md` (static lambdas), `observability.md` (structured logging, tracing, metrics, ROP combinators).
**Anti-Pattern Awareness:** See `patterns.md` [1] for PREMATURE_MATCH_COLLAPSE, NULL_ARCHITECTURE, OVERLOAD_SPAM, VARIABLE_REASSIGNMENT.
**Workflow:** Fill placeholders, remove guidance blocks, verify compilation.

---
**Placeholders**

| [INDEX] | [PLACEHOLDER] | [EXAMPLE] |
| :-----: | ------------- | --------- |
| [1] | `${Namespace}` | `Domain.Orders` |
| [2] | `${ServiceName}` | `OrderPipeline` |
| [3] | `${Operation}` | `order.submit` |
| [4] | `${RequestType}` | `SubmitOrderRequest` |
| [5] | `${CommandType}` | `ValidatedOrder` |
| [6] | `${ResponseType}` | `OrderConfirmation` |
| [7] | `${PrimitiveId}` | `OrderId` |
| [8] | `${PrimitiveAmount}` | `OrderAmount` |
| [9] | `${DependencyTrait}` | `IGatewayProvider` |
| [10] | `${DependencyMethod}` | `Transmit` |
| [11] | `${DependencyProperty}` | `GatewayProvider` |
| [12] | `${RetrySchedule}` | `Schedule.exponential(100 * ms) \| Schedule.jitter(0.1) \| Schedule.recurs(5)` |
| [13] | `${GuardMessage}` | `"Order must contain at least one line."` |

---
```csharp
namespace ${Namespace};

using System.Diagnostics;
using System.Diagnostics.Metrics;
using LanguageExt;
using LanguageExt.Common;
using LanguageExt.Traits;
using Microsoft.Extensions.Logging;
using Serilog.Context;
using static LanguageExt.Prelude;

public readonly record struct ${RequestType}(Guid CandidateId, decimal CandidateAmount, int ItemCount);
public readonly record struct ${CommandType}(${PrimitiveId} Id, ${PrimitiveAmount} Amount, int ItemCount);
public readonly record struct ${ResponseType}(${PrimitiveId} Id, string Token);

public static class ${ServiceName}Errors {
    public const int ValidationFault = 1000;
    public const int TimeoutFault = 2000;
    public const int DependencyFault = 4000;
}

internal static class Signals {
    internal static readonly ActivitySource Source = new("${Namespace}", "1.0.0");
    internal static readonly Meter Meter = new("${Namespace}", "1.0.0");
    internal static readonly Counter<long> Requests = Meter.CreateCounter<long>("${Operation}.total", "requests");
    internal static readonly Histogram<double> Duration = Meter.CreateHistogram<double>("${Operation}.duration", "s");
    internal static readonly UpDownCounter<int> Active = Meter.CreateUpDownCounter<int>("${Operation}.active", "requests");
    internal static readonly Counter<long> Retries = Meter.CreateCounter<long>("${Operation}.retries.total", "retries");
    internal static readonly Counter<long> ValidationFailures = Meter.CreateCounter<long>("${Operation}.validation.failures", "failures");
}

internal static partial class Log {
    [LoggerMessage(EventId = 1100, Level = LogLevel.Information, Message = "{Operation} started for {CorrelationId}")]
    internal static partial void Started(ILogger logger, string operation, string correlationId);

    [LoggerMessage(EventId = 1101, Level = LogLevel.Information, Message = "{Operation} succeeded in {ElapsedMs}ms")]
    internal static partial void Succeeded(ILogger logger, string operation, double elapsedMs);

    [LoggerMessage(EventId = 1102, Level = LogLevel.Error, Message = "{Operation} failed with {ErrorCode}: {ErrorMessage}")]
    internal static partial void Failed(ILogger logger, string operation, int errorCode, string errorMessage);

    [LoggerMessage(EventId = 1103, Level = LogLevel.Warning, Message = "{Operation} retry {Attempt} after {ErrorCode}")]
    internal static partial void Retry(ILogger logger, string operation, int attempt, int errorCode);
}

public interface IObservabilityProvider { ILogger Logger { get; } }
public interface ${DependencyTrait} {
    Eff<string> ${DependencyMethod}(${CommandType} command, CancellationToken cancellationToken);
}
public interface ${ServiceName}Runtime<RT>
    : Has<RT, IObservabilityProvider>, Has<RT, ${DependencyTrait}>, Has<RT, CancellationToken>
    where RT : ${ServiceName}Runtime<RT>;

public static class Observe {
    public static Validation<Error, T> Validation<T>(Validation<Error, T> validation, string operation) =>
        validation.BiMap(
            Succ: (T value) => value,
            Fail: (Error error) => {
                Signals.ValidationFailures.Add(
                    delta: toSeq(error.AsIterable()).Count,
                    tags: new TagList { { "operation", operation } });
                return error;
            });

    public static Fin<T> Outcome<T>(
        Fin<T> result,
        ILogger logger,
        string operation,
        TagList dimensions,
        long startTimestamp) {
        using Activity? activity = Signals.Source.StartActivity(operation, ActivityKind.Internal);
        TimeSpan elapsed = TimeProvider.System.GetElapsedTime(startTimestamp);
        return result.BiMap(
            Succ: (T value) => {
                TagList tags = new() { { "operation", operation }, { "outcome", "success" } };
                Merge(tags, dimensions);
                Signals.Requests.Add(delta: 1, tags: tags);
                Signals.Duration.Record(value: elapsed.TotalSeconds, tags: tags);
                activity?.SetStatus(ActivityStatusCode.Ok);
                Log.Succeeded(logger, operation, elapsed.TotalMilliseconds);
                return value;
            },
            Fail: (Error error) => {
                TagList tags = new() {
                    { "operation", operation },
                    { "outcome", "failure" },
                    { "error.code", error.Code }
                };
                Merge(tags, dimensions);
                Signals.Requests.Add(delta: 1, tags: tags);
                Signals.Duration.Record(value: elapsed.TotalSeconds, tags: tags);
                activity?.SetStatus(ActivityStatusCode.Error, error.Message);
                activity?.AddEvent(new ActivityEvent("error", new ActivityTagsCollection {
                    ["error.code"] = error.Code,
                    ["error.message"] = error.Message
                }));
                Log.Failed(logger, operation, error.Code, error.Message);
                return error;
            });
    }

    public static Eff<RT, T> Pipeline<RT, T>(Eff<RT, T> pipeline, string operation, string correlationId)
        where RT : ${ServiceName}Runtime<RT> =>
        from observability in default(RT).ObservabilityProvider
        from result in IO.lift(() => Signals.Source.StartActivity(operation, ActivityKind.Internal))
            .Bracket(
                Use: (Activity? activity) => {
                    Signals.Active.Add(delta: 1);
                    using IDisposable _ = LogContext.PushProperty("correlation_id", correlationId);
                    Log.Started(observability.Logger, operation, correlationId);
                    return pipeline.BiMap(
                        Succ: (T value) => {
                            Signals.Active.Add(delta: -1);
                            activity?.SetStatus(ActivityStatusCode.Ok);
                            return value;
                        },
                        Fail: (Error error) => {
                            Signals.Active.Add(delta: -1);
                            activity?.SetStatus(ActivityStatusCode.Error, error.Message);
                            return error;
                        }).As();
                },
                Fin: static (Activity? activity) => IO.lift(() => {
                    activity?.Dispose();
                    return unit;
                }))
        select result;

    private static void Merge(TagList target, TagList source) =>
        toSeq(source).Iter(item => target.Add(item.Key, item.Value));
}

public static class ${ServiceName} {
    public static K<F, ${CommandType}> ValidateGeneric<F>(${RequestType} request)
        where F : Fallible<F>, Applicative<F> =>
        (
            ${PrimitiveId}.CreateK<F>(request.CandidateId),
            ${PrimitiveAmount}.CreateK<F>(request.CandidateAmount)
        ).Apply((${PrimitiveId} id, ${PrimitiveAmount} amount) => new ${CommandType}(id, amount, request.ItemCount));

    private static Validation<Error, ${CommandType}> Validate(${RequestType} request) =>
        Observe.Validation(
            ValidateGeneric<Validation<Error>>(request).As()
                .Bind(command =>
                    command.ItemCount > 0
                        ? Validation<Error, ${CommandType}>.Success(command)
                        : Validation<Error, ${CommandType}>.Fail(
                            Error.New(code: ${ServiceName}Errors.ValidationFault, message: ${GuardMessage}))),
            "${Operation}.validate");

    private static Eff<RT, string> CallDependency<RT>(${CommandType} command)
        where RT : ${ServiceName}Runtime<RT> =>
        from dependency in default(RT).${DependencyProperty}
        from cancellationToken in default(RT).CancellationToken
        from token in dependency.${DependencyMethod}(command, cancellationToken)
        select token;

    private static Eff<RT, string> CallWithRetry<RT>(${CommandType} command)
        where RT : ${ServiceName}Runtime<RT> =>
        from observability in default(RT).ObservabilityProvider
        from token in CallDependency<RT>(command)
            .MapFail(error => {
                Signals.Retries.Add(delta: 1, tags: new TagList {
                    { "operation", "${Operation}.dependency" },
                    { "error.code", error.Code }
                });
                Log.Retry(observability.Logger, "${Operation}.dependency", 1, error.Code);
                return error;
            })
            .Retry(schedule: (${RetrySchedule}) & Schedule.upto(60 * sec))
        select token;

    public static Eff<RT, ${ResponseType}> Execute<RT>(${RequestType} request)
        where RT : ${ServiceName}Runtime<RT> =>
        from command in Validate(request)
            .ToFin()
            .MapFail(error => Error.New(code: ${ServiceName}Errors.ValidationFault,
                message: "${ServiceName} validation failed.", inner: error))
            .ToEff()
        from token in Observe.Pipeline(
            pipeline: CallWithRetry<RT>(command),
            operation: "${Operation}.dependency",
            correlationId: command.Id.ToString())
        select new ${ResponseType}(command.Id, token);
}

public static class ${ServiceName}Boundary {
    public static Fin<${ResponseType}> Run<RT>(${RequestType} request, RT runtime, ILogger logger)
        where RT : ${ServiceName}Runtime<RT> {
        long start = TimeProvider.System.GetTimestamp();
        Fin<${ResponseType}> result = ${ServiceName}.Execute<RT>(request).Run(runtime).Run();
        return Observe.Outcome(
            result: result,
            logger: logger,
            operation: "${Operation}",
            dimensions: new TagList { { "service", "${ServiceName}" } },
            startTimestamp: start);
    }
}
```
