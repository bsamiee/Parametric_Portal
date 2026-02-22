using System.Collections.Immutable;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Operations;
using ParametricPortal.CSharp.Analyzers.Kernel;

namespace ParametricPortal.CSharp.Analyzers.Rules;

// --- [RUNTIME_RULES] ---------------------------------------------------------

internal static class RuntimeRules {
    // --- [CONSTANTS] ----------------------------------------------------------

    private static readonly HashSet<string> RegexStaticMethods = new(["Match", "IsMatch", "Replace", "Split"], StringComparer.Ordinal);
    private static readonly HashSet<string> ConvertNumericMethods = new([
        "ToInt16", "ToInt32", "ToInt64", "ToUInt16", "ToUInt32", "ToUInt64",
        "ToByte", "ToSByte", "ToSingle", "ToDouble", "ToDecimal"], StringComparer.Ordinal);

    // --- [LAMBDA_RULES] -------------------------------------------------------

    internal static void CheckClosureCapture(OperationAnalysisContext context, ScopeInfo scope, IAnonymousFunctionOperation anonymousFunction) {
        ImmutableArray<string> capturedSymbols = CapturedOuterSymbols(anonymousFunction);
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, IsStaticLambda(anonymousFunction), capturedSymbols.Length > 0) switch {
            (true, false, true) => Diagnostic.Create(RuleCatalog.CSP0013, context.Operation.Syntax.GetLocation()),
            _ => null,
        });
    }
    internal static void CheckHotPathNonStaticLambda(OperationAnalysisContext context, ScopeInfo scope, IAnonymousFunctionOperation anonymousFunction) {
        ImmutableArray<string> capturedSymbols = CapturedOuterSymbols(anonymousFunction);
        string captureList = string.Join(separator: ", ", values: capturedSymbols);
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsHotPath, IsStaticLambda(anonymousFunction), capturedSymbols.Length > 0) switch {
            (true, false, true) => Diagnostic.Create(RuleCatalog.CSP0017, context.Operation.Syntax.GetLocation(), captureList),
            (true, false, false) => Diagnostic.Create(RuleCatalog.CSP0602, context.Operation.Syntax.GetLocation()),
            _ => null,
        });
    }

    // --- [RESOURCE_RULES] -----------------------------------------------------

    internal static void CheckHotPathLinq(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsHotPath, invocation.TargetMethod.ContainingNamespace?.ToDisplayString()?.StartsWith(value: "System.Linq", comparisonType: StringComparison.Ordinal) == true) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0601, context.Operation.Syntax.GetLocation(), invocation.TargetMethod.Name),
            _ => null,
        });
    internal static void CheckWallClock(OperationAnalysisContext context, ScopeInfo scope, IPropertyReferenceOperation propertyReference) {
        bool wallClock = SymbolFacts.IsDateTimeType(propertyReference.Property.ContainingType.OriginalDefinition)
            && (propertyReference.Property.Name is "Now" or "UtcNow" or "Today");
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, wallClock) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0007, context.Operation.Syntax.GetLocation(), $"{propertyReference.Property.ContainingType.Name}.{propertyReference.Property.Name}"),
            _ => null,
        });
    }
    internal static void CheckHttpClient(OperationAnalysisContext context, ScopeInfo scope, IObjectCreationOperation objectCreation) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, objectCreation.Type?.OriginalDefinition.ToDisplayString() == "System.Net.Http.HttpClient") switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0008, context.Operation.Syntax.GetLocation()),
            _ => null,
        });
    internal static void CheckTimerCreation(OperationAnalysisContext context, ScopeInfo scope, IObjectCreationOperation objectCreation) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, objectCreation.Type?.OriginalDefinition.ToDisplayString() is "System.Threading.Timer" or "System.Threading.PeriodicTimer") switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0401, context.Operation.Syntax.GetLocation(), objectCreation.Type?.Name ?? string.Empty),
            _ => null,
        });
    internal static void CheckRegexRuntimeConstruction(OperationAnalysisContext context, ScopeInfo scope, IObjectCreationOperation objectCreation) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, objectCreation.Type?.OriginalDefinition.ToDisplayString() == "System.Text.RegularExpressions.Regex") switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0704, context.Operation.Syntax.GetLocation(), objectCreation.Type?.Name ?? string.Empty),
            _ => null,
        });

    // --- [REGEX_RULES] --------------------------------------------------------

    internal static void CheckRegexStaticMethod(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) {
        bool regexStatic = invocation.TargetMethod.IsStatic
            && invocation.TargetMethod.ContainingType.OriginalDefinition.ToDisplayString() == "System.Text.RegularExpressions.Regex"
            && RegexStaticMethods.Contains(invocation.TargetMethod.Name);
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, regexStatic) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0606, context.Operation.Syntax.GetLocation(), invocation.TargetMethod.Name),
            _ => null,
        });
    }
    internal static void CheckGeneratedRegexCharsetValidation(SymbolAnalysisContext context, ScopeInfo scope, IMethodSymbol method) {
        bool hasGeneratedRegex = SymbolFacts.TryGetGeneratedRegexPattern(method, out string pattern, out RegexOptions options);
        bool simpleCharsetValidation = hasGeneratedRegex
            && SymbolFacts.IsSearchValuesFriendlyRegexOptions(options)
            && SymbolFacts.IsSimpleCharsetLengthRegex(pattern);
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, simpleCharsetValidation, method.Locations.Length) switch {
            (true, true, > 0) => Diagnostic.Create(RuleCatalog.CSP0607, method.Locations[0], method.Name),
            _ => null,
        });
    }

    // --- [ASYNC_ENUMERABLE_RULES] ---------------------------------------------

    internal static void CheckEnumeratorCancellation(SymbolAnalysisContext context, ScopeInfo scope, IMethodSymbol method) {
        bool asyncEnumerable = method.IsAsync
            && method.ReturnType is INamedTypeSymbol returnType
            && returnType.OriginalDefinition.ToDisplayString() == "System.Collections.Generic.IAsyncEnumerable<T>";
        bool hasCancellationTokenWithoutAttribute = method.Parameters.Any(parameter =>
            parameter.Type.OriginalDefinition.ToDisplayString() == "System.Threading.CancellationToken"
            && !parameter.GetAttributes().Any(attribute => attribute.AttributeClass?.Name is "EnumeratorCancellationAttribute" or "EnumeratorCancellation"));
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, asyncEnumerable, hasCancellationTokenWithoutAttribute, method.Locations.Length) switch {
            (true, true, true, > 0) => Diagnostic.Create(RuleCatalog.CSP0608, method.Locations[0], method.Name),
            _ => null,
        });
    }

    // --- [NUMERIC_RULES] ------------------------------------------------------

    internal static void CheckUnsafeNumericConversion(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) {
        bool convertCall = invocation.TargetMethod.ContainingType.OriginalDefinition.ToDisplayString() == "System.Convert"
            && ConvertNumericMethods.Contains(invocation.TargetMethod.Name);
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, convertCall) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0719, context.Operation.Syntax.GetLocation(), $"Convert.{invocation.TargetMethod.Name}"),
            _ => null,
        });
    }
    internal static void CheckUnsafeNarrowingCast(OperationAnalysisContext context, ScopeInfo scope, IConversionOperation conversion) {
        bool narrowing = !conversion.Conversion.IsImplicit
            && conversion.Operand.Type is ITypeSymbol fromType
            && conversion.Type is ITypeSymbol toType
            && SymbolFacts.IsNarrowingNumericCast(fromType: fromType, toType: toType);
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, narrowing, conversion.Operand.Type, conversion.Type) switch {
            (true, true, ITypeSymbol from, ITypeSymbol to) => Diagnostic.Create(RuleCatalog.CSP0719, context.Operation.Syntax.GetLocation(), $"({to.Name}){from.Name}"),
            _ => null,
        });
    }

    // --- [VALIDATION_RULES] ---------------------------------------------------

    internal static void CheckFluentValidation(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) {
        bool fluentValidation = invocation.TargetMethod.ContainingNamespace?.ToDisplayString()?.StartsWith(value: "FluentValidation", comparisonType: StringComparison.Ordinal) == true;
        bool syncValidate = invocation.TargetMethod.Name == "Validate"
            && invocation.TargetMethod.ContainingType?.AllInterfaces.Any(interfaceSymbol => interfaceSymbol.Name.StartsWith(value: "IValidator", comparisonType: StringComparison.Ordinal)) == true;
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, fluentValidation) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0402, context.Operation.Syntax.GetLocation()),
            _ => null,
        });
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsBoundary, fluentValidation, syncValidate) switch {
            (true, true, true) => Diagnostic.Create(RuleCatalog.CSP0403, context.Operation.Syntax.GetLocation()),
            _ => null,
        });
    }
    internal static void CheckScrutorScanRegistrationStrategy(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) {
        bool compositionRootOrBoundary = scope.IsBoundary || IsCompositionRootScope(scope);
        bool scanCall = invocation.TargetMethod.Name == "Scan" && invocation.TargetMethod.Parameters.Any(IsScrutorTypeSourceSelectorParameter);
        bool hasRegistrationStrategy = invocation.Arguments.Select(argument => argument.Value)
            .Any(value => value.DescendantsAndSelf().OfType<IInvocationOperation>().Any(inner => inner.TargetMethod.Name == "UsingRegistrationStrategy"));
        AnalyzerState.Report(context.ReportDiagnostic, (compositionRootOrBoundary, scanCall, hasRegistrationStrategy) switch {
            (true, true, false) => Diagnostic.Create(RuleCatalog.CSP0406, context.Operation.Syntax.GetLocation()),
            _ => null,
        });
    }

    // --- [P_INVOKE_RULES] -----------------------------------------------------

    internal static void CheckLibraryImport(SymbolAnalysisContext context, ScopeInfo scope, IMethodSymbol method) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, method.GetAttributes().Any(attribute => attribute.AttributeClass?.Name is "DllImportAttribute" or "DllImport"), method.Locations.Length) switch {
            (true, true, > 0) => Diagnostic.Create(RuleCatalog.CSP0603, method.Locations[0], method.Name),
            _ => null,
        });

    // --- [TELEMETRY_RULES] ----------------------------------------------------

    internal static void CheckTelemetryIdentityConstruction(OperationAnalysisContext context, ScopeInfo scope, IObjectCreationOperation objectCreation) {
        bool allowed = SymbolFacts.IsObservabilitySurface(context.ContainingSymbol, scope.NamespaceName);
        bool telemetryIdentity = objectCreation.Type?.OriginalDefinition.ToDisplayString() is "System.Diagnostics.ActivitySource" or "System.Diagnostics.Metrics.Meter";
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, telemetryIdentity, allowed) switch {
            (true, true, false) => Diagnostic.Create(RuleCatalog.CSP0604, context.Operation.Syntax.GetLocation(), objectCreation.Type?.Name ?? string.Empty),
            _ => null,
        });
    }
    internal static void CheckHardcodedOtlp(OperationAnalysisContext context, ScopeInfo scope, ILiteralOperation literalOperation) {
        bool compositionRoot = scope.NamespaceName.Contains(value: ".Bootstrap", comparisonType: StringComparison.Ordinal)
            || SymbolFacts.IsObservabilitySurface(context.ContainingSymbol, scope.NamespaceName);
        string literalText = literalOperation.ConstantValue.Value as string ?? string.Empty;
        bool hardcoded = literalText.Length > 0
            && Uri.TryCreate(literalText, UriKind.Absolute, out Uri? uri)
            && !string.IsNullOrWhiteSpace(uri.Host)
            && ((uri.Port is 4317 or 4318)
                || ((literalText.Contains("/v1/traces") || literalText.Contains("/v1/metrics") || literalText.Contains("/v1/logs"))
                    && (literalText.Contains("otlp") || literalText.Contains("grpc"))));
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, hardcoded, compositionRoot) switch {
            (true, true, false) => Diagnostic.Create(RuleCatalog.CSP0605, context.Operation.Syntax.GetLocation(), literalOperation.ConstantValue.Value?.ToString() ?? string.Empty),
            _ => null,
        });
    }

    // --- [CHANNEL_RULES] ------------------------------------------------------

    internal static void CheckChannelTopology(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) {
        bool unbounded = IsChannelFactoryCall(invocation, methodName: "CreateUnbounded");
        bool bounded = IsChannelFactoryCall(invocation, methodName: "CreateBounded");
        IOperation? channelOptionsArgument = invocation.Arguments.Length switch {
            > 0 => invocation.Arguments[0].Value,
            _ => null,
        };
        bool boundedCapacityOverload = channelOptionsArgument switch {
            _ when invocation.Arguments.Length == 0 => false,
            _ => invocation.Arguments[0].Parameter?.Type.SpecialType == SpecialType.System_Int32,
        };
        IObjectCreationOperation? boundedOptionsCreation = channelOptionsArgument as IObjectCreationOperation;
        bool boundedOptionsObjectCreation = boundedOptionsCreation switch {
            {
                Type: INamedTypeSymbol { Name: "BoundedChannelOptions" },
            } => true,
            _ => false,
        };
        bool boundedHasFullMode = boundedOptionsCreation switch {
            {
                Type: INamedTypeSymbol { Name: "BoundedChannelOptions" },
                Initializer: IObjectOrCollectionInitializerOperation initializer,
            } => initializer.Initializers.Any(init => init is ISimpleAssignmentOperation { Target: IPropertyReferenceOperation { Property.Name: "FullMode" } }),
            _ => false,
        };
        bool boundedNonPositiveCapacity = boundedOptionsCreation switch {
            {
                Type: INamedTypeSymbol { Name: "BoundedChannelOptions" },
                Arguments: { Length: > 0 } ctorArgs,
            } => ctorArgs[0].Value.ConstantValue is { HasValue: true, Value: int capacity } && capacity <= 0,
            _ => false,
        };
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, unbounded) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0404, context.Operation.Syntax.GetLocation()),
            _ => null,
        });
        bool shouldReportBounded = bounded && (
            boundedNonPositiveCapacity
            || boundedCapacityOverload
            || (boundedOptionsObjectCreation && !boundedHasFullMode));
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, shouldReportBounded) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0405, context.Operation.Syntax.GetLocation()),
            _ => null,
        });
    }

    // --- [PRIVATE_FUNCTIONS] --------------------------------------------------

    private static bool IsStaticLambda(IAnonymousFunctionOperation lambda) =>
        lambda.Syntax switch {
            LambdaExpressionSyntax { Modifiers: { } modifiers } => modifiers.Any(modifier => modifier.IsKind(SyntaxKind.StaticKeyword)),
            _ => false,
        };
    private static ImmutableArray<string> CapturedOuterSymbols(IAnonymousFunctionOperation anonymousFunction) {
        IMethodSymbol lambdaSymbol = anonymousFunction.Symbol;
        IEnumerable<string> captured = anonymousFunction.Body.DescendantsAndSelf().SelectMany(operation =>
            operation switch {
                ILocalReferenceOperation localReference when !SymbolEqualityComparer.Default.Equals(localReference.Local.ContainingSymbol, lambdaSymbol)
                    => [localReference.Local.Name],
                IParameterReferenceOperation parameterReference when !SymbolEqualityComparer.Default.Equals(parameterReference.Parameter.ContainingSymbol, lambdaSymbol)
                    => [parameterReference.Parameter.Name],
                IInstanceReferenceOperation { ReferenceKind: InstanceReferenceKind.ContainingTypeInstance } => ["this"],
                _ => Array.Empty<string>(),
            });
        return [.. captured.Where(name => !string.IsNullOrWhiteSpace(name)).Distinct(StringComparer.Ordinal)];
    }
    private static bool IsScrutorTypeSourceSelectorParameter(IParameterSymbol parameter) =>
        parameter.Type is INamedTypeSymbol { OriginalDefinition.MetadataName: "Action`1", TypeArguments.Length: 1 } actionType
        && actionType.TypeArguments[0] is INamedTypeSymbol { Name: "ITypeSourceSelector" };
    private static bool IsCompositionRootScope(ScopeInfo scope) =>
        scope.NamespaceName.Contains(value: ".Bootstrap", comparisonType: StringComparison.Ordinal)
        || scope.NamespaceName.Contains(value: ".Composition", comparisonType: StringComparison.OrdinalIgnoreCase)
        || scope.NamespaceName.Contains(value: ".DependencyInjection", comparisonType: StringComparison.OrdinalIgnoreCase)
        || scope.FilePath.Contains(value: "Composition", comparisonType: StringComparison.OrdinalIgnoreCase);
    private static bool IsChannelFactoryCall(IInvocationOperation invocation, string methodName) =>
        (invocation.TargetMethod.Name, invocation.TargetMethod.ContainingType.ToDisplayString()) switch {
            (string name, "System.Threading.Channels.Channel") when string.Equals(name, methodName, StringComparison.Ordinal) => true,
            _ => false,
        };
}
