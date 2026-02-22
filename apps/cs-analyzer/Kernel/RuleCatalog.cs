using System.Collections.Immutable;
using Microsoft.CodeAnalysis;

namespace ParametricPortal.CSharp.Analyzers.Kernel;

// --- [RULE_CATALOG] ----------------------------------------------------------

internal static class RuleCatalog {
    // --- [CONSTANTS] ----------------------------------------------------------

    private static readonly string[] ErrorTag = [WellKnownDiagnosticTags.NotConfigurable];

    // --- [FACTORIES] ----------------------------------------------------------

    private static DiagnosticDescriptor Err(string id, string title, string message, string category) =>
        new(id: id, title: title, messageFormat: message, category: category, defaultSeverity: DiagnosticSeverity.Error, isEnabledByDefault: true, helpLinkUri: $"https://docs.parametricportal.dev/analyzers/{id}", customTags: ErrorTag);
    private static DiagnosticDescriptor Warn(string id, string title, string message, string category) =>
        new(id: id, title: title, messageFormat: message, category: category, defaultSeverity: DiagnosticSeverity.Warning, isEnabledByDefault: true, helpLinkUri: $"https://docs.parametricportal.dev/analyzers/{id}");

    // --- [FOUNDATION_RULES] ---------------------------------------------------

    internal static readonly DiagnosticDescriptor CSP0001 = Err("CSP0001", "ImperativeControlFlow", "Imperative control flow '{0}' is forbidden; use switch expressions and monadic Bind/Map", "FunctionalDiscipline");
    internal static readonly DiagnosticDescriptor CSP0002 = Err("CSP0002", "MatchCollapse", "'Match' is boundary-only; use Map/Bind/BiMap in domain pipelines", "FunctionalDiscipline");
    internal static readonly DiagnosticDescriptor CSP0003 = Err("CSP0003", "PrimitiveSignature", "Raw primitive '{0}' leaked in public domain signature; wrap in a branded type", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0004 = Err("CSP0004", "CollectionSignature", "BCL collection '{0}' leaked in public domain signature; use LanguageExt Seq<T>/HashMap<K,V>/HashSet<T>", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0005 = Err("CSP0005", "OverloadSpam", "Method family '{0}' has {1} overloads; collapse to params ReadOnlySpan<T> or query algebra", "SurfaceArea");
    internal static readonly DiagnosticDescriptor CSP0006 = Err("CSP0006", "AsyncBlocking", "Blocking sync-over-async call '{0}' will deadlock in async contexts; use await", "AsyncDiscipline");
    internal static readonly DiagnosticDescriptor CSP0007 = Err("CSP0007", "WallClock", "Direct wall-clock access '{0}' is forbidden; inject IClock or TimeProvider", "TimeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0008 = Err("CSP0008", "HttpClientConstruction", "Direct 'new HttpClient()' is forbidden; use IHttpClientFactory", "ResourceManagement");
    internal static readonly DiagnosticDescriptor CSP0009 = Err("CSP0009", "ExceptionControlFlow", "Exception-based control flow '{0}' is forbidden; use Fin<T>, Validation<Error,T>, or Eff<RT,T>", "FunctionalDiscipline");
    internal static readonly DiagnosticDescriptor CSP0010 = Err("CSP0010", "AsyncVoid", "Method '{0}' is async void; use async Task or async Task<T>", "AsyncDiscipline");
    internal static readonly DiagnosticDescriptor CSP0011 = Err("CSP0011", "MutableCollection", "Mutable BCL collection '{0}' instantiated in domain code; use LanguageExt Seq<T>/HashMap<K,V>", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0012 = Err("CSP0012", "MutableAutoProperty", "Auto-property '{0}' has a mutable setter; make init-only or remove setter", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0013 = Err("CSP0013", "ClosureCapture", "Lambda captures outer variable(s) causing display-class allocation; prefix with 'static' or tuple threading", "PerformanceDiscipline");
    internal static readonly DiagnosticDescriptor CSP0014 = Err("CSP0014", "TaskRunFanOut", "Task.Run() fan-out is forbidden; use bounded Channel<T> topology or Eff<RT,T> fork", "AsyncDiscipline");

    // --- [BOUNDARY_RULES] -----------------------------------------------------

    internal static readonly DiagnosticDescriptor CSP0101 = Err("CSP0101", "BoundaryImperativeMissingExemption", "Boundary construct '{0}' requires [BoundaryImperativeExemption] metadata", "FunctionalDiscipline");
    internal static readonly DiagnosticDescriptor CSP0102 = Err("CSP0102", "BoundaryImperativeInvalidReason", "Boundary exemption reason '{0}' is invalid for construct '{1}'", "FunctionalDiscipline");
    internal static readonly DiagnosticDescriptor CSP0103 = Err("CSP0103", "BoundaryImperativeExpiredExemption", "Boundary exemption for '{0}' expired at '{1}' (ticket: '{2}')", "FunctionalDiscipline");
    internal static readonly DiagnosticDescriptor CSP0104 = Err("CSP0104", "NullSentinel", "Null sentinel comparison in domain/application flow is forbidden; use Option<T>/Fin<T>", "FunctionalDiscipline");

    // --- [SHAPE_RULES] --------------------------------------------------------

    internal static readonly DiagnosticDescriptor CSP0201 = Err("CSP0201", "ArraySignature", "Array type '{0}' leaked in public domain signature; use Seq<T>/ReadOnlySpan<T>", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0202 = Err("CSP0202", "MutableField", "Field '{0}' is mutable in domain/application type; make readonly or remove mutation", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0203 = Err("CSP0203", "PublicCtorOnValidatedPrimitive", "Validated primitive '{0}' exposes public constructor; keep constructor private and use Create/CreateK", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0204 = Err("CSP0204", "ConcurrentCollectionInDomain", "Concurrent collection '{0}' is forbidden in domain/application code; isolate in boundary adapters", "TypeDiscipline");

    // --- [ASYNC_RULES] --------------------------------------------------------

    internal static readonly DiagnosticDescriptor CSP0301 = Err("CSP0301", "FireAndForgetTask", "Fire-and-forget task invocation '{0}' is forbidden; await or compose in Eff", "AsyncDiscipline");
    internal static readonly DiagnosticDescriptor CSP0302 = Err("CSP0302", "UnboundedWhenAll", "Task.WhenAll over unbounded enumerable is forbidden; use bounded channel topology", "AsyncDiscipline");
    internal static readonly DiagnosticDescriptor CSP0303 = Err("CSP0303", "RunInTransform", "Effect collapse '{0}' inside domain/application transform is forbidden; collapse at boundary", "AsyncDiscipline");

    // --- [RESOURCE_RULES] -----------------------------------------------------

    internal static readonly DiagnosticDescriptor CSP0401 = Err("CSP0401", "TimerConstruction", "Timer construction '{0}' is forbidden in domain/application scope", "ResourceManagement");
    internal static readonly DiagnosticDescriptor CSP0402 = Err("CSP0402", "FluentValidationInDomain", "FluentValidation usage is boundary-only; keep validators out of domain/application pipelines", "ResourceManagement");
    internal static readonly DiagnosticDescriptor CSP0403 = Err("CSP0403", "FluentValidationValidateSync", "Synchronous Validate() detected; use ValidateAsync() for FluentValidation boundary flow", "ResourceManagement");
    internal static readonly DiagnosticDescriptor CSP0404 = Err("CSP0404", "ChannelUnboundedTopology", "Channel.CreateUnbounded is forbidden in domain/application flow; use bounded channel topology", "ResourceManagement");
    internal static readonly DiagnosticDescriptor CSP0405 = Err("CSP0405", "ChannelFullModeRequired", "Channel.CreateBounded must use BoundedChannelOptions with explicit FullMode", "ResourceManagement");
    internal static readonly DiagnosticDescriptor CSP0406 = Err("CSP0406", "ScrutorScanRegistrationStrategy", "Scrutor .Scan(...) in boundary/composition-root flow must include .UsingRegistrationStrategy(...)", "ResourceManagement");

    // --- [SURFACE_RULES] ------------------------------------------------------

    internal static readonly DiagnosticDescriptor CSP0501 = Err("CSP0501", "InterfacePollution", "Interface '{0}' has a single implementation '{1}'; remove interface indirection", "SurfaceArea");
    internal static readonly DiagnosticDescriptor CSP0502 = Err("CSP0502", "PositionalDomainArguments", "Positional argument at domain/application call site is forbidden; use named arguments", "SurfaceArea");
    internal static readonly DiagnosticDescriptor CSP0503 = Err("CSP0503", "SingleUsePrivateHelper", "Private method '{0}' has a single call site; inline it into caller", "SurfaceArea");
    internal static readonly DiagnosticDescriptor CSP0504 = Err("CSP0504", "EffectReturnPolicy", "Method '{0}' returns '{1}' in domain/application flow; use Fin<T>, Validation<Error,T>, Eff<RT,T>, K<F,T>, or IO<A>", "FunctionalDiscipline");
    internal static readonly DiagnosticDescriptor CSP0505 = Err("CSP0505", "TypeClassStaticAbstractPolicy", "Type-class interface '{0}' must declare at least one static abstract member", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0506 = Err("CSP0506", "ExtensionProjectionRequired", "Static projection method '{0}' over receiver '{1}' must be an extension method", "SurfaceArea");

    // --- [PERFORMANCE_RULES] --------------------------------------------------

    internal static readonly DiagnosticDescriptor CSP0601 = Err("CSP0601", "HotPathLinq", "LINQ invocation '{0}' in performance-critical scope is forbidden; use span/simd pipeline", "PerformanceDiscipline");
    internal static readonly DiagnosticDescriptor CSP0602 = Err("CSP0602", "HotPathNonStaticLambda", "Non-static lambda in performance-critical scope is forbidden; use static lambda and tuple threading", "PerformanceDiscipline");
    internal static readonly DiagnosticDescriptor CSP0603 = Err("CSP0603", "LibraryImportRequired", "DllImport usage on '{0}' is forbidden; use LibraryImport source-generated marshalling", "PerformanceDiscipline");
    internal static readonly DiagnosticDescriptor CSP0604 = Err("CSP0604", "TelemetryIdentityConstruction", "Telemetry identity construction '{0}' outside observability surface is forbidden", "PerformanceDiscipline");
    internal static readonly DiagnosticDescriptor CSP0605 = Err("CSP0605", "HardcodedOtlpEndpoint", "Hardcoded telemetry endpoint literal '{0}' is forbidden outside composition root", "PerformanceDiscipline");
    internal static readonly DiagnosticDescriptor CSP0606 = Err("CSP0606", "RegexStaticMethodCall", "Static Regex.{0}() recompiles the pattern on every call; use [GeneratedRegex] source generator", "PerformanceDiscipline");
    internal static readonly DiagnosticDescriptor CSP0607 = Err("CSP0607", "GeneratedRegexCharsetValidation", "[GeneratedRegex] method '{0}' encodes fixed length + allowed chars validation; prefer SearchValues<char> with ContainsAnyExcept/IndexOfAnyExcept", "PerformanceDiscipline");
    internal static readonly DiagnosticDescriptor CSP0608 = Err("CSP0608", "EnumeratorCancellationMissing", "CancellationToken parameter on async enumerable method '{0}' must have [EnumeratorCancellation] attribute", "AsyncDiscipline");

    // --- [MODEL_RULES] --------------------------------------------------------

    internal static readonly DiagnosticDescriptor CSP0701 = Err("CSP0701", "PrimitiveShape", "Primitive type '{0}' must be a readonly record struct with non-public constructors and Create/CreateK factories", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0702 = Err("CSP0702", "DuShape", "Discriminated union '{0}' must remain closed: private-protected base constructor, sealed cases, and defensive unreachable arm", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0703 = Err("CSP0703", "ValidationType", "Validation type '{0}' is forbidden; use Validation<Error,T> and avoid Seq<Error> wrappers", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0704 = Err("CSP0704", "RegexRuntimeConstruction", "Runtime regex construction '{0}' is forbidden in domain/application flow; use GeneratedRegex", "PerformanceDiscipline");
    internal static readonly DiagnosticDescriptor CSP0705 = Err("CSP0705", "MatchBoundaryOnlyStrict", "'Match' must terminate at method boundary return; avoid mid-pipeline context collapse", "FunctionalDiscipline");
    internal static readonly DiagnosticDescriptor CSP0706 = Err("CSP0706", "EarlyReturnGuardChain", "Early-return guard chain detected; compose validation as Validation<Error,T> applicative pipeline", "FunctionalDiscipline");
    internal static readonly DiagnosticDescriptor CSP0707 = Err("CSP0707", "VariableReassignment", "Reassignment-driven pipeline on '{0}' is forbidden; use Map/Bind composition", "FunctionalDiscipline");
    internal static readonly DiagnosticDescriptor CSP0708 = Err("CSP0708", "ApiSurfaceInflationByPrefix", "Method family prefix inflation detected on '{0}'; collapse Get/TryGet/GetOr variants into query algebra", "SurfaceArea");
    internal static readonly DiagnosticDescriptor CSP0709 = Err("CSP0709", "NullPatternSentinel", "Null sentinel pattern '{0}' in domain/application flow is forbidden; use Option<T>/Fin<T>", "FunctionalDiscipline");
    internal static readonly DiagnosticDescriptor CSP0710 = Err("CSP0710", "FilterMapChainOnSeq", ".Filter(...).Map(...) on Seq<T> allocates an intermediate collection; use Choose for single-pass filter+map", "FunctionalDiscipline");
    internal static readonly DiagnosticDescriptor CSP0711 = Err("CSP0711", "AsyncAwaitInEff", "await inside Eff<RT,T>-returning method '{0}' mixes paradigms; use .ToEff() or liftAsync for interop", "FunctionalDiscipline");
    internal static readonly DiagnosticDescriptor CSP0712 = Err("CSP0712", "AtomRefAsProperty", "Atom<T>/Ref<T> declared as property '{0}' creates a new instance per access; use static readonly field", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0713 = Err("CSP0713", "CreateFactoryReturnType", "Create/CreateK factory on '{0}' must return Fin<T>, Validation<Error,T>, or K<F,T> -- not raw T", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0714 = Err("CSP0714", "DateTimeFieldInDomain", "DateTime/DateTimeOffset field/property/parameter '{0}' in domain code is forbidden; use NodaTime.Instant", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0715 = Err("CSP0715", "AnemicEntityDetection", "Entity '{0}' has only {{ get; set; }} properties with no smart constructor; add Fin<T> factory and remove mutable setters", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0716 = Warn("CSP0716", "MissingPreludeUsing", "Domain/application file '{0}' must include 'using static LanguageExt.Prelude;'", "Convention");
    internal static readonly DiagnosticDescriptor CSP0717 = Err("CSP0717", "WithExpressionBypass", "Direct 'new {0}(...)' bypasses smart constructor validation; use Create/CreateK factory", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0718 = Err("CSP0718", "MutableAccumulatorInLoop", "Mutable collection '{0}.Add' inside loop body is forbidden; use Fold/Choose on Seq<T>", "FunctionalDiscipline");
    internal static readonly DiagnosticDescriptor CSP0719 = Err("CSP0719", "UnsafeNumericConversion", "Unsafe numeric conversion '{0}' in domain code is forbidden; use checked arithmetic or SafeConvert", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0720 = Err("CSP0720", "InitOnlyBypassOnValidated", "Init-only property '{0}' on validated type enables with-expression bypass; use {{ get; }} only", "TypeDiscipline");

    // --- [GAP_ANALYSIS_STUBS] -------------------------------------------------

    internal static readonly DiagnosticDescriptor CSP0015 = Err("CSP0015", "VarInference", "Explicit 'var' usage in domain/application code is forbidden; declare explicit type for '{0}'", "TypeDiscipline");
    internal static readonly DiagnosticDescriptor CSP0017 = Err("CSP0017", "NonStaticHotPathClosure", "Non-static lambda capturing '{0}' in performance namespace is forbidden; use static lambda and tuple threading", "PerformanceDiscipline");

    // --- [GOVERNANCE_RULES] ---------------------------------------------------

    internal static readonly DiagnosticDescriptor CSP0901 = Err("CSP0901", "ExemptionMetadataInvalid", "BoundaryImperativeExemption metadata is invalid for symbol '{0}' (ticket: '{1}')", "Governance");
    internal static readonly DiagnosticDescriptor CSP0902 = Err("CSP0902", "ExemptionMetadataExpired", "BoundaryImperativeExemption expired for symbol '{0}' at '{1}' (ticket: '{2}')", "Governance");

    // --- [ENTRY_POINT] --------------------------------------------------------

    internal static ImmutableArray<DiagnosticDescriptor> All { get; } = ImmutableArray.Create(
        CSP0001, CSP0002, CSP0003, CSP0004, CSP0005, CSP0006, CSP0007, CSP0008, CSP0009, CSP0010, CSP0011, CSP0012, CSP0013, CSP0014,
        CSP0015, CSP0017,
        CSP0101, CSP0102, CSP0103, CSP0104,
        CSP0201, CSP0202, CSP0203, CSP0204,
        CSP0301, CSP0302, CSP0303,
        CSP0401, CSP0402, CSP0403, CSP0404, CSP0405, CSP0406,
        CSP0501, CSP0502, CSP0503, CSP0504, CSP0505, CSP0506,
        CSP0601, CSP0602, CSP0603, CSP0604, CSP0605, CSP0606, CSP0607, CSP0608,
        CSP0701, CSP0702, CSP0703, CSP0704, CSP0705, CSP0706, CSP0707, CSP0708, CSP0709,
        CSP0710, CSP0711, CSP0712, CSP0713, CSP0714, CSP0715, CSP0716, CSP0717, CSP0718, CSP0719, CSP0720,
        CSP0901, CSP0902);
}
