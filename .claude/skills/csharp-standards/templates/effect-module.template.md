# [H1][EFFECT_MODULE]
>**Dictum:** *Effect modules compose ROP pipelines, environmental DI, and boundary handling.*

<br>

Produces one effectful service module: domain primitives replacing raw DTOs with validated commands, runtime-record DI via `Eff<RT,T>.Asks(...)`, `K<F,A>`-polymorphic applicative validation, `Eff<RT,T>` ROP pipelines via LINQ comprehension, `@catch` error recovery with `|` Alternative fallback, `Fin<T>` standalone sync pipelines, `Atom<T>` for thread-safe concurrent state, schedule-based retry, `Option<T>` absence-to-error conversion, `MapFail` error annotation, and double-Run boundary interpretation.

**Density:** ~400 LOC signals a refactoring opportunity. No file proliferation; helpers are always a code smell.
**References:** `effects.md` (Fin, Eff, Validation, IO, @catch, Schedule, STM), `types.md` (domain primitives, sealed DUs), `objects.md` (boundary adapter mapping), `composition.md` (Pipe, arity collapse, HKT encoding, extension members), `performance.md` (static lambdas, tuple threading), `algorithms.md` (Kleisli composition), `diagnostics.md` (pipeline probes, error chains, Probe.Span, EnrichDebug), `observability.md` (structured logging, tracing, metrics, ROP combinators).
**Workflow:** Fill placeholders, remove guidance blocks, verify compilation.
**Anti-Pattern Awareness** -- See `patterns.md` [1] for PREMATURE_MATCH_COLLAPSE, NULL_ARCHITECTURE, OVERLOAD_SPAM, VARIABLE_REASSIGNMENT.

---
**Placeholders**

| [INDEX] | [PLACEHOLDER]            | [EXAMPLE]                                   |
| :-----: | ------------------------ | ------------------------------------------- |
|   [1]   | `${Namespace}`           | `Domain.Orchestration`                      |
|   [2]   | `${ServiceName}`         | `OrderPipeline`                             |
|   [3]   | `${TraitInterface}`      | `IGatewayProvider`                          |
|   [4]   | `${TraitProperty}`       | `GatewayProvider`                           |
|   [5]   | `${HasConstraint}`       | `HasGatewayProvider`                        |
|   [6]   | `${TraitMethod}`         | `TransmitPayload`                           |
|   [7]   | `${RequestType}`         | `InitializationRequest`                     |
|   [8]   | `${ValidatedCommand}`    | `ValidatedInitialization`                   |
|   [9]   | `${ResponseType}`        | `OrderConfirmation`                         |
|  [10]   | `${PrimitiveA}`          | `DomainIdentity`                            |
|  [11]   | `${PrimitiveB}`          | `TransactionAmount`                         |
|  [12]   | `${GuardPredicate}`      | `command.Items.Count > 0`                   |
|  [13]   | `${GuardMessage}`        | `"Order must have items"`                   |
|  [14]   | `${SchedulePolicy}`      | `Schedule.exponential(baseDelay: 100 * ms)` |
|  [15]   | `${StateType}`           | `ServiceMetrics`                            |
|  [16]   | `${DiagnosticNamespace}` | `Domain.Diagnostics`                        |

---
```csharp
namespace ${Namespace};

using System;
using System.Runtime.CompilerServices;
using NodaTime;
using LanguageExt;
using LanguageExt.Common;
using LanguageExt.Traits;
using Microsoft.Extensions.DependencyInjection;
using Scrutor;
using static LanguageExt.Prelude;
// Diagnostics: Probe.Span / Probe.Tap / EnrichDebug live in ${DiagnosticNamespace} -- see diagnostics.md [3][7].

// --- [TYPES] -----------------------------------------------------------------

// Raw DTO: external input with primitive fields. Treated as untrusted.
public readonly record struct ${RequestType}(
    Guid CandidateId,
    decimal CandidateAmount);
// Validated command: domain primitives replace raw scalars after validation.
public readonly record struct ${ValidatedCommand}(
    ${PrimitiveA} Id,
    ${PrimitiveB} Amount);
public readonly record struct ${ResponseType}(
    ${PrimitiveA} ConfirmedId,
    string Token);
// Concurrent state record for Atom<T>.
public readonly record struct ${StateType}(
    int ProcessedCount,
    Instant LastProcessedAt);

// --- [ERRORS] ----------------------------------------------------------------

public static class ${ServiceName}Errors {
    public static readonly Error TimedOut =
        Error.New(code: 504, message: "${ServiceName} dependency timed out.");
    public static readonly Error NotFound =
        Error.New(message: "${ServiceName} resource not found.");
}

// --- [SERVICES] --------------------------------------------------------------

// Trait interface justified by runtime DI seam -- not INTERFACE_POLLUTION.
public interface ${TraitInterface} {
    Eff<string> ${TraitMethod}(${ValidatedCommand} command);
    Eff<Option<string>> LookupOptional(${PrimitiveA} id);
}
public interface ${HasConstraint}<RT> where RT : ${HasConstraint}<RT> {
    ${TraitInterface} ${TraitProperty} { get; }
}

// --- [FUNCTIONS] -------------------------------------------------------------

public static class ${ServiceName} {
    // --- [VALIDATION] --------------------------------------------------------
    // Polymorphic validation: works across Fin, Option, Eff, Validation.
    // The validation algebra is independent of execution context -- the caller
    // selects F at the call site. See composition.md [4] for K<F,A> encoding.
    public static K<F, ${ValidatedCommand}> ValidateGeneric<F>(
        ${RequestType} request) where F : Fallible<F>, Applicative<F> =>
        (
            ${PrimitiveA}.CreateK<F>(candidate: request.CandidateId),
            ${PrimitiveB}.CreateK<F>(candidate: request.CandidateAmount)
        ).Apply(
            (${PrimitiveA} validId, ${PrimitiveB} validAmount) =>
                new ${ValidatedCommand}(
                    Id: validId,
                    Amount: validAmount));
    // Applicative instantiation: collects all errors via Error Monoid.
    // Convenience over Validation<Error,T> -- use ValidateGeneric<F> directly
    // when callers need Fin (fail-fast) contexts:
    //   ValidateGeneric<Fin>(request).As()
    // Note: .As() downcast required to convert K<F,A> to concrete type.
    // Example: ValidateGeneric<Fin>(request).As() => Fin<${ValidatedCommand}>
    private static Validation<Error, ${ValidatedCommand}> Validate(
        ${RequestType} request) =>
        ValidateGeneric<Validation<Error>>(request: request).As();
    // --- [EFF_PIPELINE] ------------------------------------------------------
    // Main pipeline: LINQ comprehension with guard, @catch composed via |.
    // Guards operate on the validated command, not the raw DTO.
    // Wrap with Probe.Span for debug Activity or ObserveEff.Pipeline for prod telemetry.
    public static Eff<RT, ${ResponseType}> Execute<RT>(
        ${RequestType} request) where RT : ${HasConstraint}<RT> =>
        from command  in Validate(request: request)
            .ToFin()
            .MapFail((Error error) =>
                Error.New(message: "${ServiceName} validation failed.", inner: error))
            .ToEff()
        from _        in guard(
            ${GuardPredicate},
            Error.New(message: ${GuardMessage}))
        from token    in CallWithRecovery<RT>(command: command)
        select new ${ResponseType}(
            ConfirmedId: command.Id,
            Token: token);
    // --- [OPTION_HANDLING] ---------------------------------------------------
    // RequireResource ordering: Option<T> → Fin<T> → Eff<T>.
    // Convert absence to typed error BEFORE Eff lift. Direct Option → Eff
    // produces BottomError; .ToFin(Error) preserves domain error identity.
    public static Eff<RT, string> RequireResource<RT>(
        ${PrimitiveA} id) where RT : ${HasConstraint}<RT> =>
        from trait in Eff<RT, ${TraitInterface}>.Asks(static (RT runtime) => runtime.${TraitProperty})
        from optionalResult in trait.LookupOptional(id: id)
        from resolved in optionalResult
            .ToFin(${ServiceName}Errors.NotFound)
            .ToEff()
        select resolved;
    // --- [DEPENDENCY_ACCESS] -------------------------------------------------
    // Shared dependency accessor -- called from Execute AND RetryDependency.
    private static Eff<RT, string> CallDependency<RT>(
        ${ValidatedCommand} command) where RT : ${HasConstraint}<RT> =>
        from trait in Eff<RT, ${TraitInterface}>.Asks(static (RT runtime) => runtime.${TraitProperty})
        from response in trait.${TraitMethod}(command: command)
        select response;
    // Named recovery method: extracts @catch + | composition from the LINQ
    // comprehension for cleaner pipeline hygiene.
    private static Eff<RT, string> CallWithRecovery<RT>(
        ${ValidatedCommand} command) where RT : ${HasConstraint}<RT> =>
        CallDependency<RT>(command: command)
        | @catch(${ServiceName}Errors.TimedOut,
            (Error _) => RetryDependency<RT>(command: command));
    // --- [RETRY] -------------------------------------------------------------
    // Schedule composition:
    //   | = union: continues until ALL sub-schedules complete (longer overall).
    //   & = intersection: stops when ANY sub-schedule completes (shorter overall).
    // Below: jitter | recurs(5) | maxDelay(30s) unions into one schedule;
    //        & upto(60s) hard-caps total elapsed time.
    private static Eff<RT, string> RetryDependency<RT>(
        ${ValidatedCommand} command) where RT : ${HasConstraint}<RT> =>
        CallDependency<RT>(command: command)
            .Retry(schedule:
                (${SchedulePolicy}
                | Schedule.jitter(factor: 0.1)
                | Schedule.recurs(times: 5)
                | Schedule.maxDelay(delay: 30 * sec))
                & Schedule.upto(duration: 60 * sec));
    // --- [DIAGNOSTICS] -------------------------------------------------------
    // Probe.Tap: identity-preserving side-effect tap on Eff<RT,T> -- see diagnostics.md [3].
    // Probe.Trace: BiMap tap on Fin<T> logging both channels -- see diagnostics.md [3].
    // Error.Flatten() / FormatChain(): recursive unfold for chain display -- see diagnostics.md [2].
    // Observe.Outcome / ObserveEff.Pipeline: prod tap unifying log+trace+metric -- see observability.md [4].
}

// --- [CONCURRENT_STATE] ------------------------------------------------------

// Atom<T>: lock-free atomic state. Swap applies pure A -> A transitions.
// See effects.md [7] for Ref<T> + atomic() multi-value transactional patterns.
public static class ${ServiceName}State {
    public static readonly Atom<${StateType}> Metrics = Atom(
        new ${StateType}(ProcessedCount: 0, LastProcessedAt: Instant.MinValue),
        (${StateType} state) => state.ProcessedCount >= 0);
    // Static lambda: state threaded via ValueTuple to prevent closure capture.
    // See performance.md [7] for tuple threading on hot-path Swap.
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ${StateType} RecordProcessed(
        Atom<${StateType}> metrics,
        IClock clock) =>
        metrics.Swap(
            static (${StateType} current, IClock capturedClock) => current with {
                ProcessedCount = current.ProcessedCount + 1,
                LastProcessedAt = capturedClock.GetCurrentInstant()
            }, clock);
}

// --- [LAYERS] ----------------------------------------------------------------

public static class ${ServiceName}Composition {
    public static IServiceCollection Add${ServiceName}Module(IServiceCollection services) =>
        services.Scan(scan => scan
            .FromAssemblyOf<${ServiceName}>()
            .AddClasses(classes => classes.InNamespaces("${Namespace}"))
            .UsingRegistrationStrategy(RegistrationStrategy.Throw)
            .AsSelfWithInterfaces()
            .WithScopedLifetime());
}

public static class ${ServiceName}Boundary {
    // Double-Run: .Run(runtime) resolves ReaderT<RT, IO, A> to IO<A>;
    // .Run() executes the IO effect. Match at boundary only.
    // MapFail at boundary annotates errors for the caller -- inline, not a separate method.
    public static Fin<${ResponseType}> RunAtBoundary<RT>(
        ${RequestType} request,
        RT runtime) where RT : ${HasConstraint}<RT> =>
        ${ServiceName}.Execute<RT>(request: request)
            .MapFail((Error error) =>
                Error.New(message: "${ServiceName} terminal failure.", inner: error))
            .Run(runtime)
            .Run();
    // IO<A> comprehension: see effects.md [5]
}

// --- [EXPORT] ----------------------------------------------------------------

// All types and static classes above use explicit accessibility.
// No barrel files or re-exports.
```

---
**Guidance: Polymorphic Validation**

`ValidateGeneric<F>` encodes validation as a `K<F,A>` algebra independent of execution context. The caller selects `F` at the call site: `ValidateGeneric<Fin>` for fail-fast sync and `ValidateGeneric<Validation<Error>>` for applicative accumulation. Domain primitives must expose `CreateK<F>` alongside `Create` (returning `K<F,T>` with `Fallible<F>, Applicative<F>` constraints). This eliminates duplicated validate paths -- one algebra serves all contexts. See `composition.md` [4] for HKT encoding and `.As()` downcast at consumption boundaries.

**Guidance: Eff Pipeline and Error Recovery**

The `from..in..select` LINQ syntax desugars to `.Bind(x => ...)`. `guard`/`guardnot` short-circuit with typed errors for business invariants; `Validation` with `.Apply()` handles user-input accumulation. Error recovery is extracted into `CallWithRecovery` as a named method composing `@catch` + `|` outside the LINQ comprehension -- cleaner than inlining parenthesized recovery. `Validation -> Fin -> MapFail -> Eff` is the canonical v5 conversion path (`.ToFin()` is direct; avoid the `.ToEither().MapLeft().ToEff()` detour). See `effects.md` [2][3] for pipeline and recovery patterns. For development-time inspection, wrap `Execute<RT>` with `Probe.Span` (`diagnostics.md` [3]) or `ObserveEff.Pipeline` (`observability.md` [4]) at the boundary -- never inside the LINQ comprehension. `MapFail` for error annotation belongs inline at the call site (see `${ServiceName}Boundary.RunAtBoundary`) -- not as a separate wrapper method.

**Guidance: Boundary and Concurrent State**

Double-Run resolves `ReaderT<RT, IO, A>`: first `.Run(runtime)` strips the Reader layer to `IO<A>`, second `.Run()` interprets the IO. `Atom<T>` provides lock-free state with optional validator; for multi-value transactions use `Ref<T>` + `atomic()`. On hot paths, mark lambdas `static` and thread state via `ValueTuple` per `performance.md` [7] -- see `RecordProcessed` for the canonical pattern. Schedule combinators compose algebraically: `|` unions sub-schedules (continues until ALL complete -- longer overall), `&` intersects (stops when ANY completes -- shorter overall). See `effects.md` [7][8] for STM and retry. At the boundary, wrap `RunAtBoundary` result with `Observe.Outcome` (`observability.md` [4]) for unified prod telemetry, or `result.PrettyPrint(...)` (`diagnostics.md` [2]) for debug display.

---
## [POST_SCAFFOLD]

- [ ] Replace all `${...}` placeholders with domain-specific names
- [ ] Verify all records are `sealed`; all value types are `readonly record struct`
- [ ] Add `[MethodImpl(AggressiveInlining)]` to all pure hot-path functions
- [ ] Confirm no `if`/`switch` statements in domain logic; `Match` at boundary only
- [ ] Add `Telemetry.span` to all public service operations
- [ ] Wire `${ServiceName}Composition.Add${ServiceName}Module` into composition root
- [ ] Write at least one property-based test per pure function
- [ ] Run `dotnet build` and verify zero warnings/errors
