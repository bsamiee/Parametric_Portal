# [H1][OBSERVABILITY]
>**Dictum:** *Observability is one algebra; typed outcomes remain primary.*

Observability in C# 14 / .NET 10 keeps `Fin<T>`, `Validation<Error,T>`, and `Eff<RT,T>` intact while projecting telemetry through one compositional surface. Canonical surfaces: `[LoggerMessage]`, `ActivitySource`, `Meter`, `TagList`, `LogContext`, Serilog OTLP sink, OpenTelemetry exporters.

---
## [1][SIGNAL_ALGEBRA]
>**Dictum:** *One module owns identities, tag algebra, and fused channel emission.*

```csharp
namespace Domain.Observability;

// --- [IMPORTS] ---------------------------------------------------------------

using System.Collections.Generic;
using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Runtime.CompilerServices;
using LanguageExt;
using LanguageExt.Common;
using LanguageExt.Traits;
using Microsoft.Extensions.Logging;
using Serilog.Context;
using static LanguageExt.Prelude;

public interface IObservabilityProvider { ILogger Logger { get; } }
public interface IObservabilityRuntime { IObservabilityProvider ObservabilityProvider { get; } }

public readonly record struct ObserveSpec(string Operation, TagList Dimensions);

// --- [SIGNALS] ---------------------------------------------------------------

internal static class Signals {
    private const string ServiceName = "Domain.Service";
    private const string ServiceVersion = "1.0.0";
    internal static readonly ActivitySource Source = new(ServiceName, ServiceVersion);
    internal static readonly Meter ServiceMeter = new(ServiceName, ServiceVersion);
    internal static readonly Counter<long> Requests = ServiceMeter.CreateCounter<long>(
        "domain.requests.total", "requests", "Total request outcomes.");
    internal static readonly Histogram<double> Duration = ServiceMeter.CreateHistogram<double>(
        "domain.request.duration", "s", "Request duration (seconds).", null,
        new InstrumentAdvice<double> {
            HistogramBucketBoundaries = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
        });
    internal static readonly UpDownCounter<int> Active = ServiceMeter.CreateUpDownCounter<int>(
        "domain.requests.active", "requests", "In-flight request count.");
    internal static readonly Counter<long> ValidationFailures = ServiceMeter.CreateCounter<long>(
        "domain.validation.failures", "failures", "Validation failures by operation.");
    internal static readonly Counter<long> Retries = ServiceMeter.CreateCounter<long>(
        "domain.retries.total", "retries", "Retry attempts by operation and error code.");
    // ObservableGauge: callback-based instrument for point-in-time system metrics.
    // The callback executes on each scrape interval -- no manual recording needed.
    // Thread pool pending count is a USE-method saturation signal for diagnosing
    // thread starvation under high concurrency (see concurrency.md).
    internal static readonly ObservableGauge<int> ThreadPoolPending =
        ServiceMeter.CreateObservableGauge<int>(
            "runtime.threadpool.pending",
            static () => ThreadPool.PendingWorkItemCount,
            "items", "Thread pool pending work items.");
    internal static readonly ObservableGauge<int> ThreadPoolThreadCount =
        ServiceMeter.CreateObservableGauge<int>(
            "runtime.threadpool.count",
            static () => ThreadPool.ThreadCount,
            "threads", "Thread pool active thread count.");
}

// --- [LOG] -------------------------------------------------------------------

internal static partial class Log {
    [LoggerMessage(1000, LogLevel.Information, "{Operation} started")]
    internal static partial void Started(ILogger logger, string operation);
    [LoggerMessage(1001, LogLevel.Information, "{Operation} succeeded in {ElapsedMs}ms")]
    internal static partial void Succeeded(ILogger logger, string operation, double elapsedMs);
    [LoggerMessage(1002, LogLevel.Error, "{Operation} failed with {ErrorCode}: {ErrorMessage}")]
    internal static partial void Failed(ILogger logger, string operation, int errorCode, string errorMessage);
    [LoggerMessage(1003, LogLevel.Warning, "{Operation} retry attempt {Attempt} after {ErrorCode}")]
    internal static partial void Retry(ILogger logger, string operation, int attempt, int errorCode);
}

// --- [TAG_POLICY] ------------------------------------------------------------

public static class TagPolicy {
    public static TagList Outcome(ObserveSpec spec, string outcome, Option<int> errorCode) =>
        Merge(
            seed: errorCode.Match(
                Some: (int code) => new TagList {
                    { "operation", spec.Operation }, { "outcome", outcome }, { "error.code", code }
                },
                None: () => new TagList {
                    { "operation", spec.Operation }, { "outcome", outcome }
                }),
            dimensions: spec.Dimensions);
    public static void AnnotateFailure(Activity? activity, Error error) {
        activity?.SetStatus(ActivityStatusCode.Error, error.Message);
        activity?.AddEvent(new ActivityEvent("error",
            tags: new ActivityTagsCollection {
                ["error.code"] = error.Code, ["error.message"] = error.Message
            }));
    }
    // Span-level filterable dimensions via Activity.SetTag.
    // OTel .NET distinguishes metric TagList (value-type, stack-allocated)
    // from trace Activity.SetTag (per-span attributes visible to samplers).
    // Provide tags at StartActivity time via ActivityTagsCollection for
    // sampler visibility; gate expensive computation behind IsAllDataRequested.
    public static void AnnotateSpan(Activity? activity, TagList dimensions) {
        foreach (KeyValuePair<string, object?> tag in dimensions)
            activity?.SetTag(tag.Key, tag.Value);
    }
    // Enriched span start: pass initial tags to StartActivity so head-based
    // samplers can inspect dimensions before recording the full span.
    public static Activity? StartAnnotatedActivity(
        string operation, ActivityKind kind, TagList dimensions) {
        ActivityTagsCollection initialTags = new();
        foreach (KeyValuePair<string, object?> tag in dimensions)
            initialTags[tag.Key] = tag.Value;
        return Signals.Source.StartActivity(operation, kind, default, initialTags);
    }
    // Conditional enrichment: check IsAllDataRequested before computing
    // expensive tag values to avoid overhead on unsampled spans.
    public static void AnnotateSpanWhenRecording(
        Activity? activity, Func<TagList> computeDimensions) {
        if (activity is { IsAllDataRequested: true })
            AnnotateSpan(activity, computeDimensions());
    }
    public static TagList Merge(TagList seed, TagList dimensions) =>
        toSeq(dimensions).Fold(seed,
            static (TagList acc, KeyValuePair<string, object?> next) => {
                acc.Add(next.Key, next.Value);
                return acc;
            });
    // Pre-compiled property-to-tag extractors: compile Expression<Func<T, object>>
    // once at startup; cache the delegate. Zero reflection on hot paths.
    // Use for domain entities where tag dimensions map to entity properties.
    public static Func<T, object?> CompileTagExtractor<T>(
        Expression<Func<T, object?>> accessor) =>
        accessor.Compile();
    // Build a TagList from an entity using pre-compiled extractors.
    // Extractors are compiled once via CompileTagExtractor and stored in a
    // static readonly Seq -- zero per-call reflection or allocation.
    public static TagList FromEntity<T>(
        T entity,
        Seq<(string Dimension, Func<T, object?> Extract)> extractors) =>
        extractors.Fold(
            new TagList(),
            (TagList tags, (string Dimension, Func<T, object?> Extract) pair) => {
                tags.Add(pair.Dimension, pair.Extract(entity));
                return tags;
            });
}

// --- [PROJECTIONS] -----------------------------------------------------------

public static class Observe {
    /// Caller owns Activity lifecycle — annotates span, does not start or dispose.
    public static Fin<T> Outcome<T>(
        Fin<T> result, ILogger logger, ObserveSpec spec,
        long startTimestamp, Activity? activity) =>
        Emit(result, logger, spec,
            TimeProvider.System.GetElapsedTime(startTimestamp), activity);
    public static Validation<Error, T> Validation<T>(
        Validation<Error, T> validation, string operation) =>
        validation.BiMap(
            Succ: (T value) => value,
            Fail: (Error error) => {
                Signals.ValidationFailures.Add(error.Count,
                    new TagList { { "operation", operation } });
                return error;
            });
    /// Tap-style — returns error unchanged after emitting retry metric + log.
    /// Designed for Polly OnRetry delegates.
    public static Error RetryProjection(
        Error error, ILogger logger, string operation, int attempt) {
        Signals.Retries.Add(1,
            new TagList { { "operation", operation }, { "error.code", error.Code } });
        Log.Retry(logger, operation, attempt, error.Code);
        return error;
    }
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static Fin<T> Emit<T>(
        Fin<T> result, ILogger logger, ObserveSpec spec,
        TimeSpan elapsed, Activity? activity) =>
        result.BiMap(
            Fail: (Error error) => {
                TagList tags = TagPolicy.Outcome(spec, "failure", Some(error.Code));
                Signals.Requests.Add(1, tags);
                Signals.Duration.Record(elapsed.TotalSeconds, tags);
                TagPolicy.AnnotateFailure(activity, error);
                Log.Failed(logger, spec.Operation, error.Code, error.Message);
                return error;
            },
            Succ: (T value) => {
                TagList tags = TagPolicy.Outcome(spec, "success", None);
                Signals.Requests.Add(1, tags);
                Signals.Duration.Record(elapsed.TotalSeconds, tags);
                activity?.SetStatus(ActivityStatusCode.Ok);
                Log.Succeeded(logger, spec.Operation, elapsed.TotalMilliseconds);
                return value;
            });
}
```

---
## [2][OBSERVABILITY_CANON]
>**Dictum:** *Observability constraints are architecture contracts, not optional style.*

| [INDEX] | [CONSTRAINT]               | [MANDATE]                                                                        | [SURFACE]                           |
| :-----: | :------------------------- | -------------------------------------------------------------------------------- | ----------------------------------- |
|   [1]   | **`LOGGING_PATH`**         | structured logs via `[LoggerMessage]` only                                       | CA1848, CA2254                      |
|   [2]   | **`TRACE_LIFECYCLE`**      | span lifecycle bracket-owned, never leaked                                       | Pipeline bracket                    |
|   [3]   | **`METRIC_DIMENSIONS`**    | tags include `operation` + `outcome` taxonomy                                    | TagPolicy.Outcome                   |
|   [4]   | **`ERROR_CODE_STABILITY`** | numeric `Error.Code` as canonical failure dim                                    | span/metric/log fields              |
|   [5]   | **`NO_SPLIT_PIPELINES`**   | no parallel telemetry branches in logic                                          | fused BiMap projection              |
|   [6]   | **`BOUNDARY_ONLY_MATCH`**  | no mid-pipeline `.Match()` for observability                                     | Fin/Eff/Val BiMap                   |
|   [7]   | **`SINGLETON_IDS`**        | ActivitySource/Meter match OTel registration                                     | Signals statics                     |
|   [8]   | **`AMBIENT_SCOPE`**        | contextual props boundary-scoped via ambient ctx                                 | LogContext                          |
|   [9]   | **`RETRY_TELEMETRY`**      | every retry emits count + error code                                             | RetryProjection                     |
|  [10]   | **`VALIDATION_TELEMETRY`** | validation fail emits accumulation-aware metric                                  | Observe.Validation                  |
|  [11]   | **`EXPRESSION_GATING`**    | dynamic Serilog filters compile-validated                                        | TryCompile gate                     |
|  [12]   | **`DB_CORRELATION`**       | DB instrumentation mandatory for e2e traces                                      | Npgsql.OpenTelemetry                |
|  [13]   | **`ANTI_PATTERN`**         | no ad-hoc ILogger.Log* or inline ActivitySource                                  | centralized surfaces                |
|  [14]   | **`COMPILED_EXTRACTORS`**  | entity-to-tag via pre-compiled expressions                                       | TagPolicy.FromEntity                |
|  [15]   | **`TRACE_DIMENSIONS`**     | span attributes via SetTag; initial tags at StartActivity for sampler visibility | TagPolicy.AnnotateSpan              |
|  [16]   | **`RECORDING_GATE`**       | gate expensive tag computation behind IsAllDataRequested                         | TagPolicy.AnnotateSpanWhenRecording |

---

**Tag taxonomy** — canonical dimensions from TagPolicy.Outcome and AnnotateFailure:

| [INDEX] | [DIMENSION]      | [REQUIRED]      | [SEMANTICS]                                       |
| :-----: | :--------------- | :-------------- | ------------------------------------------------- |
|   [1]   | **`operation`**  | **yes**         | stable taxonomy key (`orders.submit`, `db.query`) |
|   [2]   | **`outcome`**    | **yes**         | `success`, `failure`, `active`                    |
|   [3]   | **`error.code`** | **on failure**  | stable numeric domain/system error code           |
|   [4]   | **`service`**    | **recommended** | service identity for shared dashboards            |
|   [5]   | **`component`**  | **recommended** | adapter boundary (`gateway`, `repo`, `scheduler`) |

---
## [3][EFF_PIPELINE]
>**Dictum:** *`Eff` instrumentation composes as one wrapper; no business-flow forks.*

```csharp
// (imports from section [1])
public static class ObserveEff {
    public static Eff<RT, T> Pipeline<RT, T>(
        Eff<RT, T> pipeline, string operation, TagList dimensions)
        where RT : IObservabilityRuntime =>
        from provider in Eff<RT, IObservabilityProvider>.Asks(static (RT runtime) => runtime.ObservabilityProvider)
        from result in IO.lift(() => Signals.Source.StartActivity(operation, ActivityKind.Internal))
            .Bracket(
                Use: (Activity? activity) => {
                    ObserveSpec spec = new(operation, dimensions);
                    long startTimestamp = TimeProvider.System.GetTimestamp();
                    using IDisposable _ = LogContext.PushProperty("operation", operation);
                    Signals.Active.Add(1, TagPolicy.Outcome(spec, "active", None));
                    Log.Started(provider.Logger, operation);
                    return pipeline
                        .Map((T value) => {
                            Observe.Outcome(Fin.Succ(value), provider.Logger,
                                spec, startTimestamp, activity);
                            return value;
                        })
                        .MapFail((Error error) => {
                            Observe.Outcome(Fin.Fail<Unit>(error), provider.Logger,
                                spec, startTimestamp, activity);
                            return error;
                        }).As();
                },
                Fin: (Activity? activity) => IO.lift(() => {
                    Signals.Active.Add(-1, new TagList { { "operation", operation } });
                    activity?.Dispose();
                    return unit;
                }))
        select result;
}
```

---
## [4][COMPOSITION_ROOT]
>**Dictum:** *Composition root wires exporters and resilience; domain modules emit canonical signals only.*

```csharp
namespace App.Bootstrap;

using Domain.Observability;
using LanguageExt.Common;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Http.Resilience;
using OpenTelemetry.Exporter;
using OpenTelemetry.Resources;
using Scrutor;
using Serilog;
using Serilog.Events;
using Serilog.Exceptions;
using Serilog.Expressions;
using Serilog.Sinks.OpenTelemetry;

public static class TelemetryBootstrap {
    public static IHostApplicationBuilder AddTelemetry(
        IHostApplicationBuilder builder) {
        builder.Host.UseSerilog(
            (HostBuilderContext ctx, IServiceProvider svc, LoggerConfiguration cfg) =>
                cfg.MinimumLevel.Information()
                    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
                    .ReadFrom.Configuration(ctx.Configuration)
                    .ReadFrom.Services(svc)
                    .Enrich.FromLogContext()
                    .Enrich.WithExceptionDetails()
                    .Filter.ByExcluding("RequestPath like '/health%'")
                    .WriteTo.Console()
                    .WriteTo.OpenTelemetry(new OpenTelemetrySinkOptions {
                        Endpoint = ctx.Configuration["OpenTelemetry:Endpoint"]
                            ?? "http://localhost:4317",
                        Protocol = OtlpProtocol.Grpc
                    }));
        builder.Services.AddOpenTelemetry()
            .ConfigureResource(static r => r.AddService("Domain.Service"))
            .WithTracing(static t => t.AddSource("Domain.Service")
                .AddAspNetCoreInstrumentation().AddHttpClientInstrumentation()
                .AddNpgsql().AddOtlpExporter())
            .WithMetrics(static m => m.AddMeter("Domain.Service")
                .AddAspNetCoreInstrumentation().AddHttpClientInstrumentation()
                .AddRuntimeInstrumentation().AddOtlpExporter());
        // ResilienceContext property setup: typed key for logger propagation.
        // Callers must set the logger on every ResilienceContext before pipeline
        // execution -- without this, OnRetry delegates receive null from GetValue.
        // Usage: ResilienceContextSetup.Attach(context, logger) before Execute().
        // RetryProjection + Polly composition
        builder.Services.Scan(scan => scan
            .FromAssembliesOf(typeof(Signals), typeof(Observe))
            .AddClasses(classes => classes.InNamespaces("Domain.Observability"))
            .UsingRegistrationStrategy(RegistrationStrategy.Throw)
            .AsSelfWithInterfaces()
            // Singleton: ActivitySource and Meter are process-global identities
            // registered once with the OTel SDK. Creating per-request instances
            // would orphan metric streams and trace sources from exporters.
            .WithSingletonLifetime());
        builder.Services.AddHttpClient("upstream")
            .AddStandardResilienceHandler(options => {
                options.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(10);
                options.Retry.MaxRetryAttempts = 5;
                options.Retry.UseJitter = true;
                options.Retry.OnRetry = static args => {
                    Error error = args.Outcome.Exception is { } ex
                        ? Error.New(ex)
                        : Error.New(
                            (int)(args.Outcome.Result?.StatusCode ?? 0),
                            args.Outcome.Result?.ReasonPhrase ?? "upstream");
                    Observe.RetryProjection(
                        error,
                        args.Context.Properties.GetValue(ResilienceContextSetup.LoggerKey, default!)!,
                        "upstream.request", args.AttemptNumber);
                    return ValueTask.CompletedTask;
                };
            });
        return builder;
    }
    public static bool ValidateSerilogExpression(string expression) =>
        SerilogExpression.TryCompile(expression, out _, out _);
}

// --- [RESILIENCE_CONTEXT] ----------------------------------------------------

// Typed property key for Polly ResilienceContext logger propagation.
// Callers must invoke Attach() on every ResilienceContext before executing
// the resilience pipeline -- without this, OnRetry delegates receive null.
public static class ResilienceContextSetup {
    public static readonly ResiliencePropertyKey<ILogger> LoggerKey = new("logger");
    public static void Attach(ResilienceContext context, ILogger logger) =>
        context.Properties.Set(LoggerKey, logger);
}
```

---
## [5][RULES]
>**Dictum:** *Observability quality is consistency under composition pressure.*

- [ALWAYS] Emit via Observe.Outcome, Observe.Validation, and ObserveEff.Pipeline.
- [ALWAYS] Keep ActivitySource/Meter identities centralized in Signals.
- [ALWAYS] Use `[LoggerMessage]` on structured logging paths.
- [ALWAYS] Record retry attempts with operation + error code.
- [ALWAYS] Configure OTLP protocol/endpoint in composition root only.
- [ALWAYS] Validate dynamic Serilog expressions before runtime use.
- [NEVER] Split telemetry into separate procedural branches.
- [NEVER] Collapse context early via mid-pipeline `.Match()` just for logging.
- [NEVER] Instantiate telemetry identities inside handlers/services.
- [NEVER] Hardcode exporter endpoints in domain modules.
- [ALWAYS] Register observability surfaces as singleton (ActivitySource/Meter are process-global identities); register domain services as scoped (hold per-request state and DI dependencies).
