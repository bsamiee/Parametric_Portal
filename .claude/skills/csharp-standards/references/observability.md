# [H1][OBSERVABILITY]
>**Dictum:** *Signals are one algebra: logs, traces, and metrics execute as a fused tap over typed outcomes.*

<br>

Observability in C# 14 / .NET 10 must preserve computational context: `Fin<T>` and `Eff<RT,T>` remain primary carriers while telemetry is projected through `BiMap` and bracketed resource lifecycles. Canonical surfaces are `[LoggerMessage]`, `ActivitySource`, `Meter`, `TagList`, `LogContext`, and OTel exporters. All snippets assume `using static LanguageExt.Prelude;`.

---
## [1][SIGNAL_FUSION]
>**Dictum:** *One combinator owns outcome projection; no split logging/tracing/metrics pipelines.*

<br>

```csharp
namespace Domain.Observability;

using System.Diagnostics;
using System.Diagnostics.Metrics;
using LanguageExt;
using LanguageExt.Common;
using LanguageExt.Traits;
using Microsoft.Extensions.Logging;
using Serilog.Context;
using static LanguageExt.Prelude;

public interface IObservabilityProvider {
    ILogger Logger { get; }
}
public interface HasObservability<RT> : Has<RT, IObservabilityProvider>
    where RT : HasObservability<RT>;

internal static class Signals {
    internal static readonly ActivitySource Source =
        new(name: "Domain.Service", version: "1.0.0");
    internal static readonly Meter ServiceMeter =
        new(name: "Domain.Service", version: "1.0.0");

    internal static readonly Counter<long> Requests =
        ServiceMeter.CreateCounter<long>(
            name: "domain.requests.total",
            unit: "requests",
            description: "Total request outcomes.");

    internal static readonly Histogram<double> Duration =
        ServiceMeter.CreateHistogram<double>(
            name: "domain.request.duration",
            unit: "s",
            description: "End-to-end request duration in seconds.",
            tags: null,
            advice: new InstrumentAdvice<double> {
                HistogramBucketBoundaries = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
            });

    internal static readonly UpDownCounter<int> Active =
        ServiceMeter.CreateUpDownCounter<int>(
            name: "domain.requests.active",
            unit: "requests",
            description: "In-flight requests.");

    internal static readonly Counter<long> ValidationFailures =
        ServiceMeter.CreateCounter<long>(
            name: "domain.validation.failures",
            unit: "failures",
            description: "Validation failures grouped by operation.");

    internal static readonly Counter<long> Retries =
        ServiceMeter.CreateCounter<long>(
            name: "domain.retries.total",
            unit: "retries",
            description: "Retry attempts grouped by operation.");
}

internal static partial class Log {
    [LoggerMessage(
        EventId = 1000,
        Level = LogLevel.Information,
        Message = "{Operation} started")]
    internal static partial void Started(ILogger logger, string operation);

    [LoggerMessage(
        EventId = 1001,
        Level = LogLevel.Information,
        Message = "{Operation} succeeded in {ElapsedMs}ms")]
    internal static partial void Succeeded(
        ILogger logger,
        string operation,
        double elapsedMs);

    [LoggerMessage(
        EventId = 1002,
        Level = LogLevel.Error,
        Message = "{Operation} failed with {ErrorCode}: {ErrorMessage}")]
    internal static partial void Failed(
        ILogger logger,
        string operation,
        int errorCode,
        string errorMessage);

    [LoggerMessage(
        EventId = 1003,
        Level = LogLevel.Warning,
        Message = "{Operation} retry attempt {Attempt} after {ErrorCode}")]
    internal static partial void Retry(
        ILogger logger,
        string operation,
        int attempt,
        int errorCode);
}

public static class Observe {
    public static Fin<T> Outcome<T>(
        Fin<T> result,
        ILogger logger,
        string operation,
        TagList dimensions,
        long startTimestamp) {
        using Activity? activity = Signals.Source.StartActivity(
            name: operation,
            kind: ActivityKind.Internal);
        TimeSpan elapsed = TimeProvider.System.GetElapsedTime(
            startingTimestamp: startTimestamp);

        return result.BiMap(
            Succ: (T value) => {
                TagList tags = new() {
                    { "operation", operation },
                    { "outcome", "success" }
                };
                Merge(target: tags, source: dimensions);
                Signals.Requests.Add(delta: 1, tags: tags);
                Signals.Duration.Record(value: elapsed.TotalSeconds, tags: tags);
                activity?.SetStatus(code: ActivityStatusCode.Ok);
                Log.Succeeded(
                    logger: logger,
                    operation: operation,
                    elapsedMs: elapsed.TotalMilliseconds);
                return value;
            },
            Fail: (Error error) => {
                TagList tags = new() {
                    { "operation", operation },
                    { "outcome", "failure" },
                    { "error.code", error.Code }
                };
                Merge(target: tags, source: dimensions);
                Signals.Requests.Add(delta: 1, tags: tags);
                Signals.Duration.Record(value: elapsed.TotalSeconds, tags: tags);
                activity?.SetStatus(
                    code: ActivityStatusCode.Error,
                    description: error.Message);
                activity?.AddEvent(new ActivityEvent(
                    name: "error",
                    tags: new ActivityTagsCollection {
                        ["error.code"] = error.Code,
                        ["error.message"] = error.Message
                    }));
                Log.Failed(
                    logger: logger,
                    operation: operation,
                    errorCode: error.Code,
                    errorMessage: error.Message);
                return error;
            });
    }

    public static Eff<RT, T> Pipeline<RT, T>(
        Eff<RT, T> pipeline,
        string operation,
        TagList dimensions)
        where RT : HasObservability<RT> =>
        from provider in default(RT).ObservabilityProvider
        from result in
            IO.lift(() => Signals.Source.StartActivity(
                name: operation,
                kind: ActivityKind.Internal))
            .Bracket(
                Use: (Activity? activity) => {
                    Signals.Active.Add(delta: 1, tags: dimensions);
                    using IDisposable _ = LogContext.PushProperty(
                        name: "operation",
                        value: operation);
                    Log.Started(logger: provider.Logger, operation: operation);
                    return pipeline.BiMap(
                        Succ: (T value) => {
                            Signals.Active.Add(delta: -1, tags: dimensions);
                            activity?.SetStatus(code: ActivityStatusCode.Ok);
                            return value;
                        },
                        Fail: (Error error) => {
                            Signals.Active.Add(delta: -1, tags: dimensions);
                            activity?.SetStatus(
                                code: ActivityStatusCode.Error,
                                description: error.Message);
                            return error;
                        }).As();
                },
                Fin: (Activity? activity) =>
                    IO.lift(() => {
                        activity?.Dispose();
                        return unit;
                    }))
        select result;

    public static Validation<Error, T> Validation<T>(
        Validation<Error, T> validation,
        string operation) =>
        validation.BiMap(
            Succ: (T value) => value,
            Fail: (Error error) => {
                Signals.ValidationFailures.Add(
                    delta: toSeq(error.AsIterable()).Count,
                    tags: new TagList { { "operation", operation } });
                return error;
            });

    public static Error RetryProjection(
        Error error,
        ILogger logger,
        string operation,
        int attempt) {
        Signals.Retries.Add(
            delta: 1,
            tags: new TagList {
                { "operation", operation },
                { "error.code", error.Code }
            });
        Log.Retry(
            logger: logger,
            operation: operation,
            attempt: attempt,
            errorCode: error.Code);
        return error;
    }

    private static void Merge(TagList target, TagList source) =>
        toSeq(source).Iter(item => target.Add(item.Key, item.Value));
}
```

---
## [2][COMPOSITION_ROOT_RUNTIME]
>**Dictum:** *Composition root wires providers; modules own singleton signal identities.*

<br>

```csharp
namespace App.Bootstrap;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Http.Resilience;
using OpenTelemetry.Exporter;
using OpenTelemetry.Resources;
using Serilog;
using Serilog.Events;
using Serilog.Exceptions;
using Serilog.Expressions;
using Serilog.Sinks.OpenTelemetry;

public static class TelemetryBootstrap {
    public static IHostApplicationBuilder AddTelemetry(
        IHostApplicationBuilder builder) {
        builder.Host.UseSerilog((HostBuilderContext context,
                                 IServiceProvider services,
                                 LoggerConfiguration cfg) =>
            cfg.MinimumLevel.Information()
                .MinimumLevel.Override(source: "Microsoft", level: LogEventLevel.Warning)
                .ReadFrom.Configuration(configuration: context.Configuration)
                .ReadFrom.Services(services: services)
                .Enrich.FromLogContext()
                .Enrich.WithExceptionDetails()
                .Filter.ByExcluding(expression: "RequestPath like '/health%'")
                .WriteTo.Console()
                // Endpoint resolved from configuration; never hardcoded
                .WriteTo.OpenTelemetry(options: new OpenTelemetrySinkOptions {
                    Endpoint = context.Configuration["OpenTelemetry:Endpoint"]
                               ?? "http://localhost:4317",
                    Protocol = OtlpProtocol.Grpc
                }));

        builder.Services.AddOpenTelemetry()
            .ConfigureResource(resource =>
                resource.AddService(serviceName: "Domain.Service"))
            .WithTracing(tracing => tracing
                .AddSource("Domain.Service")
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddNpgsql()
                .AddOtlpExporter())
            .WithMetrics(metrics => metrics
                .AddMeter("Domain.Service")
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddRuntimeInstrumentation()
                .AddOtlpExporter());

        builder.Services.AddHttpClient(name: "upstream")
            .AddStandardResilienceHandler(options => {
                options.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(10);
                options.Retry.MaxRetryAttempts = 5;
                options.Retry.UseJitter = true;
            });

        return builder;
    }

    public static Func<string, bool> ValidateSerilogExpression =
        static (string expression) =>
            SerilogExpression.TryCompile(
                expression: expression,
                result: out _);
}
```

---
## [3][OBSERVABILITY_CANON]

| [CONSTRAINT] | [MANDATE] | [SURFACE] |
| ------------ | --------- | --------- |
| `LOGGING_PATH` | `[LoggerMessage]` for all hot-path structured logs | `CA1848`, `CA2254`, `CA2017`, `CA2023` |
| `TRACE_LIFECYCLE` | `ActivitySource` span lifecycle owned by bracket/tap combinators | `Observe.Pipeline`, `Observe.Outcome` |
| `METRIC_DIMENSIONS` | `TagList` dimensions and operation taxonomy are explicit and stable | `Counter`, `Histogram`, `UpDownCounter` |
| `SINGLETON_IDS` | `ActivitySource` / `Meter` names must exactly match OTel `AddSource` / `AddMeter` | `OpenTelemetry.Extensions.Hosting` |
| `AMBIENT_SCOPE` | domain context enters logs via `LogContext.PushProperty` at boundary scope | `Serilog.Context` |
| `RETRY_TELEMETRY` | retries record count + error code, never implicit counters | `Observe.RetryProjection` + `Microsoft.Extensions.Http.Resilience` |
| `VALIDATION_TELEMETRY` | validation error accumulation emits one metric from `Validation<Error,T>` fail channel | `Observe.Validation` |
| `NO_SPLIT_PIPELINES` | no separate logging/tracing/metrics branches in business flow; one fused observability tap | `BiMap` + `Bracket` |
| `EXPORTER_DISCIPLINE` | logs and traces must emit through OTLP with explicit protocol/endpoint settings | `Serilog.Sinks.OpenTelemetry`, `OpenTelemetry.Exporter.OpenTelemetryProtocol` |
| `DB_CORRELATION` | database spans and metrics are first-class runtime signals | `Npgsql.OpenTelemetry` + `AddNpgsql()` |
| `EXPRESSION_GATING` | dynamic log filtering expressions must be validated before runtime use | `SerilogExpression.TryCompile` |
