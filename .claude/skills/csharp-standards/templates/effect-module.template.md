# [H1][EFFECT_MODULE]
>**Dictum:** *Effect modules compose ROP pipelines, environmental DI, and boundary handling.*

<br>

Produces one effectful service module: domain primitives separating raw DTOs from validated commands, trait interfaces for DI via `Has<RT,Trait>`, `K<F,A>`-polymorphic applicative validation, `Eff<RT,T>` ROP pipelines via LINQ comprehension, `@catch` error recovery with `|` Alternative fallback, `Fin<T>` standalone sync pipelines, `Atom<T>` for thread-safe concurrent state, schedule-based retry, `Option<T>` absence-to-error conversion, `MapFail` error annotation, and double-Run boundary interpretation.

**Density:** ~400 LOC signals a refactoring opportunity. No file proliferation; helpers are always a code smell.
**References:** `effects.md` (Fin, Eff, Validation, IO, @catch, Schedule, STM), `types.md` (domain primitives, sealed DUs), `objects.md` (boundary adapter mapping), `composition.md` (Pipe, arity collapse, HKT encoding, extension members), `performance.md` (static lambdas, tuple threading), `algorithms.md` (Kleisli composition), `diagnostics.md` (pipeline probes, error chains, Probe.Span, EnrichDebug), `observability.md` (structured logging, tracing, metrics, ROP combinators).
**Workflow:** Fill placeholders, remove guidance blocks, verify compilation.

---
**Anti-Pattern Awareness** -- See `patterns.md` [1] for PREMATURE_MATCH_COLLAPSE, NULL_ARCHITECTURE, HELPER_SPAM, VARIABLE_REASSIGNMENT.

---
**Placeholders**

| [INDEX] | [PLACEHOLDER]            | [EXAMPLE]                                                |
| :-----: | ------------------------ | -------------------------------------------------------- |
|   [1]   | `${Namespace}`           | `Domain.Orchestration`                                   |
|   [2]   | `${ServiceName}`         | `OrderPipeline`                                          |
|   [3]   | `${TraitInterface}`      | `IGatewayProvider`                                       |
|   [4]   | `${TraitProperty}`       | `GatewayProvider`                                        |
|   [5]   | `${HasConstraint}`       | `HasGatewayProvider`                                     |
|   [6]   | `${trait-method}`        | `TransmitPayload(TransactionState.Pending pendingState)` |
|   [7]   | `${RequestType}`         | `InitializationRequest`                                  |
|   [8]   | `${ValidatedCommand}`    | `ValidatedInitialization`                                |
|   [9]   | `${ResponseType}`        | `OrderConfirmation`                                      |
|  [10]   | `${PrimitiveA}`          | `DomainIdentity`                                         |
|  [11]   | `${PrimitiveB}`          | `TransactionAmount`                                      |
|  [12]   | `${guard-predicate}`     | `command.Items.Count > 0`                                |
|  [13]   | `${guard-message}`       | `"Order must have items"`                                |
|  [14]   | `${schedule-policy}`     | `Schedule.exponential(baseDelay: 100 * ms)`              |
|  [15]   | `${StateType}`           | `ServiceMetrics`                                         |
|  [16]   | `${DiagnosticNamespace}` | `Domain.Diagnostics`                                     |

---
```csharp
namespace ${Namespace};

using System;
using LanguageExt;
using LanguageExt.Common;
using LanguageExt.Traits;
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
    DateTimeOffset LastProcessedAt);

// --- [ERRORS] ----------------------------------------------------------------

public static class ${ServiceName}Errors {
    public static readonly Error TimedOut =
        Error.New(code: 504, message: "${ServiceName} dependency timed out.");
    public static readonly Error NotFound =
        Error.New(message: "${ServiceName} resource not found.");
}

// --- [SERVICES] --------------------------------------------------------------

// Trait interface justified by Has<RT,Trait> DI seam -- not INTERFACE_POLLUTION.
public interface ${TraitInterface} {
    Eff<string> ${trait-method};
    Eff<Option<string>> LookupOptional(${PrimitiveA} id);
}
public interface ${HasConstraint}<RT> : Has<RT, ${TraitInterface}>
    where RT : ${HasConstraint}<RT>;

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
    private static Validation<Error, ${ValidatedCommand}> Validate(
        ${RequestType} request) =>
        ValidateGeneric<Validation<Error>>(request: request).As();
    // --- [FIN_PIPELINE] ------------------------------------------------------
    // Standalone sync pipeline: no DI required.
    public static Fin<${ValidatedCommand}> ValidateSync(
        ${RequestType} request) =>
        ValidateGeneric<Fin>(request: request).As()
            .MapFail((Error error) =>
                Error.New(message: "${ServiceName} sync validation failed.", inner: error));
    // --- [EFF_PIPELINE] ------------------------------------------------------
    // Main pipeline: LINQ comprehension with guard, @catch composed via |.
    // Guards operate on the validated command, not the raw DTO.
    // [DEBUG] Wrap with Probe.Span(pipeline: Execute<RT>(...), spanName: "${ServiceName}.Execute")
    //         for debug Activity; compiles away in Release -- see diagnostics.md [3][7].
    // [OBSERVE] Wrap boundary call in ObserveEff.Pipeline for prod span+log+metric -- see observability.md [4].
    public static Eff<RT, ${ResponseType}> Execute<RT>(
        ${RequestType} request) where RT : ${HasConstraint}<RT> =>
        from command  in Validate(request: request)
            .ToFin()
            .MapFail((Error error) =>
                Error.New(message: "${ServiceName} validation failed.", inner: error))
            .ToEff()
        from _        in guard(
            ${guard-predicate},
            Error.New(message: ${guard-message}))
        from token    in CallWithRecovery<RT>(command: command)
        select new ${ResponseType}(
            ConfirmedId: command.Id,
            Token: token);
    // --- [OPTION_HANDLING] ---------------------------------------------------
    // Option<T> from dependency: convert absence to typed error via .ToFin(Error).
    public static Eff<RT, string> RequireResource<RT>(
        ${PrimitiveA} id) where RT : ${HasConstraint}<RT> =>
        from optionalResult in default(RT).${TraitProperty}
            .LookupOptional(id: id)
        from resolved in optionalResult
            .ToFin(${ServiceName}Errors.NotFound)
            .ToEff()
        select resolved;
    // --- [MAPFAIL] -----------------------------------------------------------
    // MapFail annotates errors on every pipeline exported from a service module.
    // Use BiMap when BOTH channels need transformation simultaneously.
    // [DEBUG] Chain .MapFail(error => error.EnrichDebug(module: "${ServiceName}")) in #if DEBUG
    //         for module+timestamp annotation on the error chain -- see diagnostics.md [7].
    public static Eff<RT, ${ResponseType}> ExecuteAnnotated<RT>(
        ${RequestType} request) where RT : ${HasConstraint}<RT> =>
        Execute<RT>(request: request)
            .MapFail((Error error) =>
                Error.New(message: "${ServiceName} terminal failure.", inner: error));
    // --- [DEPENDENCY_ACCESS] -------------------------------------------------
    // Shared dependency accessor -- called from Execute AND RetryDependency.
    private static Eff<RT, string> CallDependency<RT>(
        ${ValidatedCommand} command) where RT : ${HasConstraint}<RT> =>
        default(RT).${TraitProperty}.${trait-method};
    // Named recovery method: extracts @catch + | composition from the LINQ
    // comprehension for cleaner pipeline hygiene.
    private static Eff<RT, string> CallWithRecovery<RT>(
        ${ValidatedCommand} command) where RT : ${HasConstraint}<RT> =>
        CallDependency<RT>(command: command)
        | @catch(${ServiceName}Errors.TimedOut,
            (Error _) => RetryDependency<RT>(command: command));
    // --- [RETRY] -------------------------------------------------------------
    // Schedule | union: combine strategies. Schedule & intersection: bound by BOTH.
    private static Eff<RT, string> RetryDependency<RT>(
        ${ValidatedCommand} command) where RT : ${HasConstraint}<RT> =>
        CallDependency<RT>(command: command)
            .Retry(schedule:
                (${schedule-policy}
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
    public static Atom<${StateType}> Metrics => Atom(
        new ${StateType}(ProcessedCount: 0, LastProcessedAt: DateTimeOffset.MinValue),
        (${StateType} state) => state.ProcessedCount >= 0);
    public static ${StateType} RecordProcessed(Atom<${StateType}> metrics) =>
        metrics.Swap((${StateType} current) => current with {
            ProcessedCount = current.ProcessedCount + 1,
            LastProcessedAt = DateTimeOffset.UtcNow
        });
}

// --- [LAYERS] ----------------------------------------------------------------

public static class ${ServiceName}Boundary {
    // Double-Run: .Run(runtime) resolves ReaderT<RT, IO, A> to IO<A>;
    // .Run() executes the IO effect. Match at boundary only.
    public static Fin<${ResponseType}> RunAtBoundary<RT>(
        ${RequestType} request,
        RT runtime) where RT : ${HasConstraint}<RT> =>
        ${ServiceName}.Execute<RT>(request: request)
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

`ValidateGeneric<F>` encodes validation as a `K<F,A>` algebra independent of the execution context. The caller selects `F` at the call site: `ValidateGeneric<Fin>` for fail-fast sync, `ValidateGeneric<Validation<Error>>` for applicative accumulation, `ValidateGeneric<Eff>` for lifting directly into an effect pipeline. Domain primitives must expose `CreateK<F>` alongside `Create` (returning `K<F,T>` with `Fallible<F>, Applicative<F>` constraints). This eliminates the duplicated Validate/ValidateSync paths that a monomorphic template would require -- one algebra serves all contexts. See `composition.md` [4] for HKT encoding and `.As()` downcast at consumption boundaries.

**Guidance: Eff Pipeline and Error Recovery**

The `from..in..select` LINQ syntax desugars to `.Bind(x => ...)`. `guard`/`guardnot` short-circuit with typed errors for business invariants; `Validation` with `.Apply()` handles user-input accumulation. Error recovery is extracted into `CallWithRecovery` as a named method composing `@catch` + `|` outside the LINQ comprehension -- cleaner than parenthesized recovery inline. `Validation -> Fin -> MapFail -> Eff` is the canonical v5 conversion path (`.ToFin()` is direct; avoid the `.ToEither().MapLeft().ToEff()` detour). See `effects.md` [2][3] for pipeline and recovery patterns. For development-time inspection, wrap `Execute<RT>` with `Probe.Span` (`diagnostics.md` [3]) or `ObserveEff.Pipeline` (`observability.md` [4]) at the boundary -- never inside the LINQ comprehension.

**Guidance: Boundary and Concurrent State**

Double-Run resolves `ReaderT<RT, IO, A>`: first `.Run(runtime)` strips the Reader layer to `IO<A>`, second `.Run()` interprets the IO. `Match` appears only here. `Atom<T>` provides lock-free state with optional validator; for multi-value transactions use `Ref<T>` + `atomic()`. On hot paths, mark lambdas `static` and thread state via `ValueTuple` per `performance.md` [7]. Schedule combinators compose algebraically: `|` unions (longer), `&` intersects (shorter). See `effects.md` [7][8] for STM and retry. At the boundary, wrap `RunAtBoundary` result with `Observe.Outcome` (`observability.md` [4]) for unified prod telemetry, or `result.PrettyPrint(...)` (`diagnostics.md` [2]) for debug display.

---
**Post-Scaffold Validation Checklist**

- [ ] Raw primitives absent from all signatures after DTO boundary -- domain primitives only
- [ ] `Fin<T>` uses `Bind`/`Map` chain; `Match` appears ONLY at `${ServiceName}Boundary`
- [ ] `Validation<Error,T>` uses applicative `.Apply()` tuple; zero short-circuiting
- [ ] No `try`/`catch`/`throw`, no `var`, no `if`/`else`/`while`/`for`/`foreach`
- [ ] Every private function called from 2+ sites -- no single-call helpers
- [ ] Named parameters at every domain call site
- [ ] `MapFail` annotates errors on every exported pipeline
- [ ] `Probe.Span` / `Probe.Tap` used for any mid-pipeline inspection -- never `Match` mid-pipeline (see `diagnostics.md` [3])
- [ ] `ObserveEff.Pipeline` or `Observe.Outcome` applied at boundary for prod telemetry -- not ad-hoc logging inside `${ServiceName}` class (see `observability.md` [4])
