# [H1][DIAGNOSTICS]
>**Dictum:** *Diagnostics preserve algebraic structure; inspect without collapsing context.*

<br>

Diagnostics in C# 14 / .NET 10 remain compositional with `Fin<T>` / `Validation<Error,T>` / `Eff<RT,T>` and never force procedural collapse. Centralized runtime surfaces own telemetry identities; probes remain identity-preserving taps.

---
## [1][DIAGNOSTIC_RUNTIME]
>**Dictum:** *One module owns diagnostic state and probes; debug enrichment is compile-time gated.*

<br>

Centralizing `ActivitySource`, `Meter`, `ILoggerFactory`, and `Counter<long>` in a single `internal static` class enforces a single telemetry identity surface -- multiple `ActivitySource` instances with distinct names fragment distributed traces because the OTel collector correlates spans by source name, not by class hierarchy. `Probe.Tap` and `Probe.Trace` are identity-preserving by construction: `Tap` re-yields the pipeline value via `from..in..select` without entering the error channel, and `Trace` reproduces the original `Fin<T>` discriminant on both arms of `.Match()`, so neither combinator can short-circuit or alter the functor's shape. `DebugLayer` is zero-cost in release builds because the `#if DEBUG` conditional compilation directive eliminates the `Span` call entirely at the IL level -- the release overload is a direct return of `pipeline`, not a no-op wrapper that still allocates a delegate.

```csharp
// --- [RUNTIME] ---------------------------------------------------------------

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
            configure: static (ILoggingBuilder builder) =>
                builder.AddConsole());
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
        ILogger logger, string label, string value);
    [LoggerMessage(EventId = 9001, Level = LogLevel.Debug,
        Message = "Probe [{Label}] failed: {Error}")]
    internal static partial void ProbeFailure(
        ILogger logger, string label, string error);
}
public static class Probe {
    public static Eff<RT, T> Tap<RT, T>(
        Eff<RT, T> pipeline,
        Func<T, IO<Unit>> inspect) =>
        from value in pipeline
        from _ in inspect(value)
        select value;
    public static Fin<T> Trace<T>(
        Fin<T> value, ILogger logger, string label) =>
        value.Match(
            Succ: (T success) => {
                Diagnostics.ProbeCount.Add(1,
                    new TagList { { "label", label }, { "outcome", "succ" } });
                Log.ProbeSuccess(logger, label, success?.ToString() ?? "null");
                return Fin.Succ(success);
            },
            Fail: (Error error) => {
                Diagnostics.ProbeCount.Add(1,
                    new TagList { { "label", label }, { "outcome", "fail" } });
                Log.ProbeFailure(logger, label, error.Message);
                return Fin.Fail<T>(error);
            });
    public static Eff<RT, T> Span<RT, T>(
        Eff<RT, T> pipeline, string spanName) =>
        from result in IO.lift(() =>
                Diagnostics.Source.StartActivity(
                    name: spanName, kind: ActivityKind.Internal))
            .Bracket(
                Use: (Activity? activity) =>
                    pipeline
                        .Map((T value) => {
                            activity?.SetStatus(ActivityStatusCode.Ok);
                            return value;
                        })
                        .MapFail((Error error) => {
                            activity?.SetStatus(
                                ActivityStatusCode.Error, error.Message);
                            return error;
                        }).As(),
                Fin: static (Activity? activity) =>
                    IO.lift(() => { activity?.Dispose(); return unit; }))
        select result;
#if DEBUG
    public static Eff<RT, T> DebugLayer<RT, T>(
        Eff<RT, T> pipeline, string module) =>
        Span(pipeline, $"debug.{module}");
#else
    public static Eff<RT, T> DebugLayer<RT, T>(
        Eff<RT, T> pipeline, string module) => pipeline;
#endif
}
```

---
## [2][FAILURE_INTELLIGENCE]
>**Dictum:** *Failure analysis is projection: flatten once, summarize once.*

<br>

LanguageExt `Error` is a recursive tree where `Inner` is `Option<Error>` -- errors from nested `@catch` handlers and composed `Eff` pipelines accumulate as chains that must be explicitly traversed via `.AsIterable()` + `.Inner.Match()` to surface root causes; there is no implicit flattening on `.Message` or `.Code`. `Validation<Error,T>` in v5 has no `BiMap` overload -- the `Error` `Monoid` instance changed the type parameter contract, so `.Match()` with both arms returning the same output type is the only projection path available. Materializing the flat `Seq<Error>` once in `Flatten` then reusing it for both `.Count` and `.Map(e => e.Message)` in `Summary` keeps the traversal O(n) -- calling `Flatten` separately per consumer would re-traverse the full chain for each projection site, producing O(n²) work in error reporting paths.

```csharp
// --- [FAILURE_INTELLIGENCE] --------------------------------------------------

namespace Domain.Diagnostics;

using LanguageExt;
using LanguageExt.Common;
using static LanguageExt.Prelude;

file static class ErrorExtensions {
    public static Seq<Error> Flatten(this Error error) =>
        error.AsIterable().ToSeq().Bind(
            (Error current) =>
                current.Inner.Match(
                    Some: (Error inner) =>
                        Seq(current).Append(inner.Flatten()),
                    None: () => Seq(current)));
    public static string ToChain(
        this Error error, string separator = " -> ") =>
        string.Join(separator,
            error.Flatten()
                .Map(static (Error e) => $"[{e.Code}] {e.Message}"));
}
// Validation<Error,T>.Match — no BiMap on Validation in v5
file static class ValidationExtensions {
    public static string Summary<T>(
        this Validation<Error, T> validation,
        string operation) =>
        validation.Match(
            Fail: (Error error) => {
                Seq<Error> flat = error.Flatten();
                string joined = string.Join("; ",
                    flat.Map(static (Error e) => e.Message));
                return $"{operation}: {flat.Count} error(s): {joined}";
            },
            Succ: (T _) => $"{operation}: valid");
}
```

**Compiler Diagnostic Symptoms** -- common type errors with LanguageExt HKT encoding:

| [INDEX] | [SYMPTOM]                              | [CAUSE]                    | [FIX]                               |
| :-----: | -------------------------------------- | -------------------------- | ----------------------------------- |
|   [1]   | `Cannot convert K<F,A> to Concrete<A>` | downcast boundary omitted  | add `.As()` at consumption boundary |
|   [2]   | `Type X !satisfy Fallible<X>`          | wrong effect algebra       | constrain to `Fin`/`Eff`/`Option`   |
|   [3]   | `Operator '\|' cannot be applied`      | fallback on HKT wrapper    | downcast first, then apply `\|`     |
|   [4]   | `Ambiguous pure/error overload`        | effect type inference lost | specify `pure<F,A>` / `error<F,A>`  |

**Source Generator Diagnostic Symptoms** -- `[LoggerMessage]` enforces EventId uniqueness, method partiality, and template-to-parameter name matching at compile time; `[GeneratedRegex]` enforces partial method form and validates regex syntax before the build completes.

| [INDEX] | [DIAGNOSTIC] | [SYMPTOM]                                | [FIX]                              |
| :-----: | :----------: | ---------------------------------------- | ---------------------------------- |
|   [5]   | `SYSLIB1006` | Multiple `[LoggerMessage]` share EventId | unique EventId per method          |
|   [6]   | `SYSLIB1015` | Template `{Foo}` has no matching param   | add param named matching `{Foo}`   |
|   [7]   | `SYSLIB1025` | `[LoggerMessage]` method not `partial`   | mark method + class `partial`      |
|   [8]   | `SYSLIB1040` | `[GeneratedRegex]` method not `partial`  | `static partial Regex Pattern();`  |
|   [9]   | `SYSLIB1042` | Invalid pattern in `[GeneratedRegex]`    | fix regex; validated at build time |

---
## [3][PERF_DIAGNOSTICS]
>**Dictum:** *Profile from runtime signals first; prove minimal-capture hot paths.*

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
// --- [CLOSURE_DIAGNOSTICS] ---------------------------------------------------

namespace Domain.Diagnostics;
using LanguageExt;
using static LanguageExt.Prelude;

public static class ClosureDiagnostics {
    // Outer Map captures correlationId into value tuple;
    // inner Bind is static — enables JIT devirtualization.
    public static Eff<RT, string> StaticBindPattern<RT>(
        Eff<RT, string> source, string correlationId) =>
        source.Map((string value) =>
                (CorrelationId: correlationId, Value: value))
            .Bind(
                static ((string CorrelationId, string Value) state) =>
                    pure<Eff<RT>, string>(
                        $"{state.CorrelationId}:{state.Value}")
                    .As());
}
```

---
## [4][DIAGNOSTIC_CANON]
>**Dictum:** *Diagnostic constraints enforce compositional observability.*

<br>

| [INDEX] | [CONSTRAINT]                  | [MANDATE]                                                    | [ENFORCEMENT_SURFACE]          |
| :-----: | ----------------------------- | ------------------------------------------------------------ | ------------------------------ |
|   [1]   | **`CENTRALIZED_RUNTIME`**     | one module owns `ActivitySource`, `Meter`, `LoggerFactory`   | single identity surface        |
|   [2]   | **`IDENTITY_PROBES`**         | probes are taps (`Map`/`Match`), never terminal mid-pipeline | algebraic composition law      |
|   [3]   | **`NO_INLINE_RUN`**           | no `.Run()` execution inside transformations                 | referential transparency       |
|   [4]   | **`ERROR_CHAIN_SINGLE_PASS`** | flatten and summarize errors once per projection             | `O(n)` traversal guarantee     |
|   [5]   | **`DEBUG_GATING`**            | debug enrichment only in `#if DEBUG` branches                | zero release overhead          |
|   [6]   | **`LOGGER_SOURCE_GEN`**       | diagnostics logs use `[LoggerMessage]`                       | `CA1848`, `CA2254`             |
|   [7]   | **`OS_PORTABLE_CLI`**         | profiling commands avoid platform-specific assumptions       | cross-platform runbooks        |
|   [8]   | **`HOT_PATH_PROOF`**          | static lambda enforcement for closure diagnostics            | `IDE0320`, `CS8820`            |
|   [9]   | **`TRACE_LIFECYCLE`**         | spans are bracket-disposed on all channels                   | `CA2000` deterministic cleanup |
|  [10]   | **`BOUNDARY_MATCH_ONLY`**     | final pattern matching occurs only at API/program edge       | no premature context collapse  |
