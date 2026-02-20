using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Diagnostics;
using ParametricPortal.CSharp.Analyzers.Dispatch;
using ParametricPortal.CSharp.Analyzers.Kernel;

namespace ParametricPortal.CSharp.Analyzers;

// --- [ANALYZER] --------------------------------------------------------------

[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class DomainStandardsAnalyzer : DiagnosticAnalyzer {
    // --- [DIAGNOSTICS] --------------------------------------------------------

    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics => RuleCatalog.All;

    // --- [ENTRY_POINT] --------------------------------------------------------

    public override void Initialize(AnalysisContext context) {
        _ = context ?? throw new ArgumentNullException(paramName: nameof(context));
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();
        context.RegisterCompilationStartAction(startContext => {
            AnalyzerState state = AnalyzerState.Create(compilation: startContext.Compilation);
            startContext.RegisterSymbolAction(symbolContext => AnalyzerDispatcher.Run(symbolContext, state), SymbolKind.Method, SymbolKind.Property, SymbolKind.NamedType);
            startContext.RegisterOperationAction(
                operationContext => AnalyzerDispatcher.Run(operationContext, state),
                OperationKind.Invocation,
                OperationKind.PropertyReference,
                OperationKind.ObjectCreation,
                OperationKind.AnonymousFunction,
                OperationKind.Conditional,
                OperationKind.Loop,
                OperationKind.Try,
                OperationKind.Throw,
                OperationKind.Binary,
                OperationKind.IsPattern,
                OperationKind.SimpleAssignment,
                OperationKind.Literal,
                OperationKind.Await,
                OperationKind.Conversion);
            startContext.RegisterSyntaxTreeAction(AnalyzerDispatcher.Run);
            startContext.RegisterCompilationEndAction(compilationContext => AnalyzerDispatcher.Run(compilationContext, state));
        });
    }
}
