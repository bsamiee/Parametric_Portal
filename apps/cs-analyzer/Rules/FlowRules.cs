using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Operations;
using ParametricPortal.CSharp.Analyzers.Contracts;
using ParametricPortal.CSharp.Analyzers.Kernel;

namespace ParametricPortal.CSharp.Analyzers.Rules;

// --- [FLOW_RULES] ------------------------------------------------------------

internal static class FlowRules {
    // --- [CONTROL_RULES] ------------------------------------------------------

    internal static void CheckImperativeConditional(OperationAnalysisContext context, AnalyzerState state, ScopeInfo scope, IConditionalOperation conditional) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.Kind, conditional.Syntax is IfStatementSyntax) switch {
            (ScopeKind.Domain, true) => Diagnostic.Create(RuleCatalog.CSP0001, context.Operation.Syntax.GetLocation(), "conditional"),
            (ScopeKind.Application, true) => Diagnostic.Create(RuleCatalog.CSP0001, context.Operation.Syntax.GetLocation(), "conditional"),
            (ScopeKind.Boundary, true) => BoundaryDiagnostic(
                context, state, construct: "if",
                reason: (SymbolFacts.IsBoundaryIfCancellationGuard(conditional), SymbolFacts.IsAsyncIteratorYieldGate(conditional)) switch {
                    (true, _) => BoundaryImperativeReason.CancellationGuard,
                    (_, true) => BoundaryImperativeReason.AsyncIteratorYieldGate,
                    _ => BoundaryImperativeReason.ProtocolRequired,
                },
                ruleId: "CSP0001"),
            _ => null,
        });
    internal static void CheckImperativeLoop(OperationAnalysisContext context, AnalyzerState state, ScopeInfo scope, ILoopOperation loopOperation) =>
        AnalyzerState.Report(context.ReportDiagnostic, scope.Kind switch {
            ScopeKind.Domain => Diagnostic.Create(RuleCatalog.CSP0001, context.Operation.Syntax.GetLocation(), "loop"),
            ScopeKind.Application => Diagnostic.Create(RuleCatalog.CSP0001, context.Operation.Syntax.GetLocation(), "loop"),
            ScopeKind.Boundary => BoundaryDiagnostic(
                context, state, construct: "loop",
                reason: loopOperation.Syntax is ForEachStatementSyntax { AwaitKeyword.RawKind: > 0 }
                    ? BoundaryImperativeReason.AsyncIteratorYieldGate
                    : BoundaryImperativeReason.ProtocolRequired,
                ruleId: "CSP0001"),
            _ => null,
        });
    internal static void CheckExceptionTry(OperationAnalysisContext context, AnalyzerState state, ScopeInfo scope, ITryOperation tryOperation) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.Kind, tryOperation.Catches.Length > 0, tryOperation.Catches.Length == 0 && tryOperation.Finally is not null) switch {
            (ScopeKind.Domain, true, _) => Diagnostic.Create(RuleCatalog.CSP0009, context.Operation.Syntax.GetLocation(), "try/catch"),
            (ScopeKind.Application, true, _) => Diagnostic.Create(RuleCatalog.CSP0009, context.Operation.Syntax.GetLocation(), "try/catch"),
            (ScopeKind.Boundary, true, _) => BoundaryDiagnostic(context, state, construct: "try/catch", reason: BoundaryImperativeReason.ProtocolRequired, ruleId: "CSP0009"),
            (ScopeKind.Boundary, _, true) => BoundaryDiagnostic(context, state, construct: "try/finally", reason: BoundaryImperativeReason.CleanupFinally, ruleId: "CSP0009"),
            _ => null,
        });
    internal static void CheckExceptionThrow(OperationAnalysisContext context, AnalyzerState state, ScopeInfo scope, IThrowOperation throwOperation) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.Kind, SymbolFacts.IsUnreachableThrow(throwOperation)) switch {
            (_, true) => null,
            (ScopeKind.Domain, false) => Diagnostic.Create(RuleCatalog.CSP0009, context.Operation.Syntax.GetLocation(), "throw"),
            (ScopeKind.Application, false) => Diagnostic.Create(RuleCatalog.CSP0009, context.Operation.Syntax.GetLocation(), "throw"),
            (ScopeKind.Boundary, false) => BoundaryDiagnostic(context, state, construct: "throw", reason: BoundaryImperativeReason.ProtocolRequired, ruleId: "CSP0009"),
            _ => null,
        });

    // --- [MATCH_RULES] --------------------------------------------------------

    internal static void CheckMatchCollapse(OperationAnalysisContext context, AnalyzerState state, ScopeInfo scope, IInvocationOperation invocation) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, SymbolFacts.IsLanguageExtMatch(invocation, state.LanguageExtNamespace), SymbolFacts.IsBoundaryMatchUsage(invocation), SymbolFacts.IsRegexMatchCall(invocation)) switch {
            (true, true, false, false) => Diagnostic.Create(RuleCatalog.CSP0002, context.Operation.Syntax.GetLocation()),
            _ => null,
        });
    internal static void CheckMatchBoundaryStrict(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) {
        bool anyMatchCall = invocation.TargetMethod.Name == Markers.MatchMethodName;
        bool boundaryUsage = SymbolFacts.IsBoundaryMatchUsage(invocation);
        bool regexMatch = SymbolFacts.IsRegexMatchCall(invocation);
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, anyMatchCall, boundaryUsage, regexMatch) switch {
            (true, true, false, false) => Diagnostic.Create(RuleCatalog.CSP0705, context.Operation.Syntax.GetLocation()),
            _ => null,
        });
    }
    internal static void CheckRunInTransform(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, SymbolFacts.IsLanguageExtRunCollapse(invocation), invocation.TargetMethod.Name) switch {
            (true, true, string method) => Diagnostic.Create(RuleCatalog.CSP0303, context.Operation.Syntax.GetLocation(), method),
            _ => null,
        });

    // --- [NULL_RULES] ---------------------------------------------------------

    internal static void CheckNullSentinel(OperationAnalysisContext context, ScopeInfo scope, IBinaryOperation binaryOperation) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, SymbolFacts.IsNullComparison(binaryOperation)) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0104, context.Operation.Syntax.GetLocation()),
            _ => null,
        });
    internal static void CheckNullPatternSentinel(OperationAnalysisContext context, ScopeInfo scope, IIsPatternOperation isPatternOperation) {
        bool negated = isPatternOperation.Pattern is INegatedPatternOperation;
        string sentinel = negated ? "is not null" : "is null";
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, SymbolFacts.IsNullPattern(isPatternOperation)) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0709, context.Operation.Syntax.GetLocation(), sentinel),
            _ => null,
        });
    }
    internal static void CheckReferenceEqualsNull(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, SymbolFacts.IsReferenceEqualsNull(invocation)) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0709, context.Operation.Syntax.GetLocation(), "ReferenceEquals"),
            _ => null,
        });
    internal static void CheckEarlyReturnGuardChain(OperationAnalysisContext context, ScopeInfo scope, IConditionalOperation conditional) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, SymbolFacts.IsEarlyReturnGuard(conditional)) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0706, context.Operation.Syntax.GetLocation()),
            _ => null,
        });
    internal static void CheckVariableReassignment(OperationAnalysisContext context, ScopeInfo scope, ISimpleAssignmentOperation assignment) {
        string targetName = assignment.Target is ILocalReferenceOperation local ? local.Local.Name : string.Empty;
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, SymbolFacts.IsSelfReassignment(assignment), targetName.Length > 0) switch {
            (true, true, true) => Diagnostic.Create(RuleCatalog.CSP0707, context.Operation.Syntax.GetLocation(), targetName),
            _ => null,
        });
    }

    // --- [METADATA_RULES] -----------------------------------------------------

    internal static void CheckExemptionMetadata(SymbolAnalysisContext context, AnalyzerState state, ISymbol symbol) {
        ImmutableArray<AnalyzerState.BoundaryExemptionInfo> exemptions = state.ExemptionsFor(symbol);
        IEnumerable<Diagnostic> diagnostics = exemptions.SelectMany(exemption =>
            (exemption.IsMetadataValid, exemption.IsExpired(state.AnalysisUtcNow), symbol.Locations.Length) switch {
                (false, _, > 0) => [Diagnostic.Create(RuleCatalog.CSP0901, symbol.Locations[0], symbol.Name)],
                (true, true, > 0) => [Diagnostic.Create(RuleCatalog.CSP0902, symbol.Locations[0], symbol.Name, exemption.ExpiresOnUtc)],
                _ => Array.Empty<Diagnostic>(),
            });
        AnalyzerState.ReportEach(context.ReportDiagnostic, diagnostics);
    }

    // --- [ASYNC_RULES] --------------------------------------------------------

    internal static void CheckAsyncVoid(SymbolAnalysisContext context, ScopeInfo scope, IMethodSymbol method) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, method.IsAsync, method.ReturnsVoid, method.Locations.Length) switch {
            (true, true, true, > 0) => Diagnostic.Create(RuleCatalog.CSP0010, method.Locations[0], method.Name),
            _ => null,
        });
    internal static void CheckAsyncBlocking(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, SymbolFacts.IsBlockingInvocation(invocation)) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0006, context.Operation.Syntax.GetLocation(), invocation.TargetMethod.Name),
            _ => null,
        });
    internal static void CheckAsyncBlockingProperty(OperationAnalysisContext context, ScopeInfo scope, IPropertyReferenceOperation propertyReference) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, propertyReference.Property.Name == "Result" && (propertyReference.Property.ContainingType.Name is "Task" or "Task`1") && propertyReference.Property.ContainingType.ContainingNamespace.ToDisplayString() == "System.Threading.Tasks") switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0006, context.Operation.Syntax.GetLocation(), ".Result"),
            _ => null,
        });
    internal static void CheckTaskRunFanOut(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, SymbolFacts.IsTaskRun(invocation)) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0014, context.Operation.Syntax.GetLocation()),
            _ => null,
        });
    internal static void CheckFireAndForget(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) {
        bool taskLike = SymbolFacts.IsTaskLikeType(invocation.TargetMethod.ReturnType);
        bool expressionStatement = invocation.Parent is IExpressionStatementOperation;
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, taskLike, expressionStatement) switch {
            (true, true, true) => Diagnostic.Create(RuleCatalog.CSP0301, context.Operation.Syntax.GetLocation(), invocation.TargetMethod.Name),
            _ => null,
        });
    }
    internal static void CheckUnboundedWhenAll(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, SymbolFacts.IsTaskWhenAllUnbounded(invocation)) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0302, context.Operation.Syntax.GetLocation()),
            _ => null,
        });

    // --- [FUNCTIONAL_RULES] ---------------------------------------------------

    internal static void CheckFilterMapChain(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) {
        bool filterMapChain = invocation.TargetMethod.Name == "Map"
            && invocation.Instance is IInvocationOperation receiver
            && receiver.TargetMethod.Name == "Filter"
            && (receiver.TargetMethod.ContainingType?.ContainingNamespace?.ToDisplayString() ?? string.Empty)
                .StartsWith(value: Markers.LanguageExtNamespace, comparisonType: StringComparison.Ordinal);
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, filterMapChain) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0710, context.Operation.Syntax.GetLocation()),
            _ => null,
        });
    }
    internal static void CheckAsyncAwaitInEff(OperationAnalysisContext context, ScopeInfo scope, IAwaitOperation awaitOperation) {
        bool effReturning = context.ContainingSymbol is IMethodSymbol method
            && method.ReturnType.OriginalDefinition.MetadataName is "Eff`1" or "Eff`2"
            && (method.ReturnType.ContainingNamespace?.ToDisplayString() ?? string.Empty)
                .StartsWith(value: Markers.LanguageExtNamespace, comparisonType: StringComparison.Ordinal);
        string methodName = context.ContainingSymbol?.Name ?? string.Empty;
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, effReturning) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0711, context.Operation.Syntax.GetLocation(), methodName),
            _ => null,
        });
    }
    internal static void CheckMutableAccumulatorInLoop(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) {
        string? typeName = invocation.TargetMethod.ContainingType?.OriginalDefinition?.MetadataName;
        bool mutableAdd = invocation.TargetMethod.Name == "Add"
            && typeName is not null
            && SymbolFacts.MutableCollectionNames.Contains(typeName);
        bool insideLoop = SymbolFacts.IsInsideLoop(context.Operation);
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, mutableAdd, insideLoop) switch {
            (true, true, true) => Diagnostic.Create(RuleCatalog.CSP0718, context.Operation.Syntax.GetLocation(), invocation.TargetMethod.ContainingType?.Name ?? string.Empty),
            _ => null,
        });
    }

    // --- [PRIVATE_FUNCTIONS] --------------------------------------------------

    private static Diagnostic? BoundaryDiagnostic(OperationAnalysisContext context, AnalyzerState state, string construct, BoundaryImperativeReason reason, string ruleId) {
        BoundaryExemptionStatus status = state.ExemptionStatus(symbol: context.ContainingSymbol, ruleId: ruleId, expectedReason: reason);
        string expectedReason = reason.ToString();
        string expiry = state.ExemptionsFor(context.ContainingSymbol)
            .Where(exemption => string.Equals(exemption.RuleId, ruleId, StringComparison.Ordinal) && exemption.Reason == reason)
            .Select(exemption => exemption.ExpiresOnUtc)
            .FirstOrDefault() ?? "unknown";
        return status switch {
            BoundaryExemptionStatus.Missing => Diagnostic.Create(RuleCatalog.CSP0101, context.Operation.Syntax.GetLocation(), construct),
            BoundaryExemptionStatus.Invalid => Diagnostic.Create(RuleCatalog.CSP0102, context.Operation.Syntax.GetLocation(), expectedReason, construct),
            BoundaryExemptionStatus.Expired => Diagnostic.Create(RuleCatalog.CSP0103, context.Operation.Syntax.GetLocation(), construct, expiry),
            _ => null,
        };
    }
}
