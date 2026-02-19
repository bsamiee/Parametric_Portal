# [H1][DIAGNOSTICS]
>**Dictum:** *Diagnostics preserve algebraic structure: inspect without collapsing context, profile without guessing, and gate debug behavior at compile time.*

<br>

Diagnostics in C# 14 / .NET 10 should remain compositional with `Fin<T>` / `Validation<Error,T>` / `Eff<RT,T>` and never force procedural collapse. Centralized runtime surfaces own telemetry identities; probes remain identity-preserving taps.

---
## [1][DIAGNOSTIC_RUNTIME]
>**Dictum:** *One module owns diagnostic state and probes; debug enrichment is compile-time gated.*

<br>

```csharp
namespace Domain.Diagnostics;

using System.Diagnostics;
using System.Diagnostics.Metrics;
using LanguageExt;
using LanguageExt.Common;
using LanguageExt.Traits;
using Microsoft.Extensions.Logging;
using static LanguageExt.Prelude;

public static class Diagnostics {
    internal static readonly ActivitySource Source =
        new(name: "Domain.Service", version: "1.0.0");
    internal static readonly Meter ServiceMeter =
        new(name: "Domain.Service", version: "1.0.0");
    internal static ILoggerFactory LoggerFactory { get; set; } =
        Microsoft.Extensions.Logging.LoggerFactory.Create(
            configure: static (ILoggingBuilder b) => b.AddConsole());

    internal static readonly Counter<long> ProbeCount =
        ServiceMeter.CreateCounter<long>(
            name: "domain.diagnostics.probes",
            unit: "probes",
            description: "Probe invocations.");

    internal static ILogger Logger(string category) =>
        LoggerFactory.CreateLogger(category);
}

internal static partial class Log {
    [LoggerMessage(EventId = 9000, Level = LogLevel.Debug,
        Message = "Probe [{Label}] succeeded: {Value}")]
    internal static partial void ProbeSuccess(
        ILogger logger,
        string label,
        string value);

    [LoggerMessage(EventId = 9001, Level = LogLevel.Debug,
        Message = "Probe [{Label}] failed: {Error}")]
    internal static partial void ProbeFailure(
        ILogger logger,
        string label,
        string error);
}

public static class Probe {
    public static Eff<RT, T> Tap<RT, T>(
        Eff<RT, T> pipeline,
        Func<T, IO<Unit>> inspect) =>
        from value in pipeline
        from _ in inspect(value)
        select value;

    public static Fin<T> Trace<T>(
        Fin<T> value,
        ILogger logger,
        string label) =>
        value.BiMap(
            Succ: (T success) => {
                Diagnostics.ProbeCount.Add(delta: 1,
                    tags: new TagList { { "label", label }, { "outcome", "succ" } });
                Log.ProbeSuccess(logger, label, success?.ToString() ?? "null");
                return success;
            },
            Fail: (Error error) => {
                Diagnostics.ProbeCount.Add(delta: 1,
                    tags: new TagList { { "label", label }, { "outcome", "fail" } });
                Log.ProbeFailure(logger, label, error.Message);
                return error;
            });

    public static Eff<RT, T> Span<RT, T>(
        Eff<RT, T> pipeline,
        string spanName) =>
        from result in IO.lift(() =>
                Diagnostics.Source.StartActivity(
                    name: spanName,
                    kind: ActivityKind.Internal))
            .Bracket(
                Use: (Activity? activity) =>
                    pipeline.BiMap(
                        Succ: (T value) => {
                            activity?.SetStatus(ActivityStatusCode.Ok);
                            return value;
                        },
                        Fail: (Error error) => {
                            activity?.SetStatus(
                                ActivityStatusCode.Error,
                                error.Message);
                            return error;
                        }).As(),
                Fin: static (Activity? activity) =>
                    IO.lift(() => {
                        activity?.Dispose();
                        return unit;
                    }))
        select result;

#if DEBUG
    public static Eff<RT, T> DebugLayer<RT, T>(Eff<RT, T> pipeline, string module) =>
        Span(pipeline, $"debug.{module}");
#else
    public static Eff<RT, T> DebugLayer<RT, T>(Eff<RT, T> pipeline, string module) =>
        pipeline;
#endif
}
```

---
## [2][FAILURE_INTELLIGENCE]
>**Dictum:** *Failure analysis is projection: flatten once, summarize once, route by symptom class.*

<br>

```csharp
namespace Domain.Diagnostics;

using LanguageExt;
using LanguageExt.Common;
using static LanguageExt.Prelude;

public static class FailureIntelligence {
    extension(Error error) {
        public Seq<Error> Flatten() =>
            error.AsIterable().ToSeq().Bind(
                static (Error current) =>
                    current.Inner.Match(
                        Some: static (Error inner) => Seq(current).Append(inner.Flatten()),
                        None: static () => Seq(current)));

        public string ToChain(string separator = " -> ") =>
            error.Flatten().Map(static (Error e) => $"[{e.Code}] {e.Message}")
                .Fold(
                    state: string.Empty,
                    folder: (string acc, string next) =>
                        acc.Length == 0 ? next : $"{acc}{separator}{next}");
    }

    extension<T>(Validation<Error, T> validation) {
        public string Summary(string operation) =>
            validation.BiMap(
                Succ: static (T value) => value,
                Fail: static (Error error) => {
                    Seq<Error> flat = error.Flatten();
                    string joined = flat.Map(static (Error e) => e.Message)
                        .Fold(
                            state: string.Empty,
                            folder: static (string acc, string next) =>
                                acc.Length == 0 ? next : $"{acc}; {next}");
                    return Error.New(
                        message: $"{operation}: {flat.Count} error(s): {joined}",
                        inner: error);
                })
            .Match(
                Succ: static (T _) => $"{operation}: valid",
                Fail: static (Error error) => error.Message);
    }
}
```

**Compiler Diagnostic Symptoms** -- common type errors when working with LanguageExt HKT encoding:

| [SYMPTOM] | [CAUSE] | [FIX] |
| --------- | ------- | ----- |
| `Cannot convert K<F,A> to Concrete<A>` | downcast boundary omitted | add `.As()` at consumption boundary |
| `Type X does not satisfy Fallible<X>` | wrong effect algebra constraint | constrain to `Fin`/`Eff`/`Option`/`Either` capable type |
| `Operator '\|' cannot be applied` | fallback on HKT wrapper type | downcast first, then apply `|` |
| `Ambiguous pure/error overload` | effect type inference lost | specify `pure<F,A>` / `error<F,A>` explicitly |

---
## [3][PERF_DIAGNOSTICS]
>**Dictum:** *Profile from runtime signals first; use analyzers to prove non-capturing hot paths.*

<br>

```bash
# Cross-platform process discovery
dotnet-trace ps

# Collect runtime trace (GC + allocation + contention)
dotnet-trace collect --process-id <PID> \
  --providers Microsoft-DotNET-Runtime:0x1C000080018:5 \
  --duration 00:01:00 \
  --output trace.nettrace

# Monitor runtime + custom meter counters
dotnet-counters monitor --process-id <PID> \
  --counters System.Runtime,Domain.Service
```

```csharp
namespace Domain.Diagnostics;

using LanguageExt;
using static LanguageExt.Prelude;

public static class ClosureDiagnostics {
    // compile-time failure: static lambda cannot capture outer variable
    // Eff<RT, string> bad = Fetch().Bind(static (string v) => Use(id, v));

    public static Eff<RT, string> ZeroCapture<RT>(
        Eff<RT, string> source,
        string correlationId) =>
        source.Map((string value) =>
                (CorrelationId: correlationId, Value: value))
            .Bind(static ((string CorrelationId, string Value) state) =>
                pure<Eff<RT>, string>($"{state.CorrelationId}:{state.Value}").As());
}
```

---
## [4][DIAGNOSTIC_CANON]

| [CONSTRAINT] | [MANDATE] | [REASON] |
| ------------ | --------- | -------- |
| `CENTRALIZED_RUNTIME` | one diagnostics module owns `ActivitySource`, `Meter`, `LoggerFactory` | no split identity surfaces |
| `IDENTITY_PROBES` | probes are taps (`Map`/`Bind`/`BiMap`), never terminal matches mid-pipeline | preserve algebraic composition |
| `NO_INLINE_RUN` | no `.Run()` execution inside transformations | prevents hidden boundary collapse |
| `ERROR_CHAIN_SINGLE_PASS` | flatten and summarize errors once per projection | avoids duplicate traversal cost |
| `DEBUG_GATING` | debug enrichment only in `#if DEBUG` branches | zero release overhead |
| `LOGGER_SOURCE_GEN` | diagnostics logs use `[LoggerMessage]` | CA1848/CA2254 compliance |
| `OS_PORTABLE_CLI` | profiling commands avoid platform-specific process discovery assumptions | reproducible runbooks |
| `HOT_PATH_PROOF` | static lambda enforcement is preferred closure diagnostic | compile-time evidence |
| `TRACE_LIFECYCLE` | spans are bracket-disposed on all channels | deterministic cleanup |
| `BOUNDARY_MATCH_ONLY` | final pattern matching occurs only at API/program edge | no premature context collapse |
