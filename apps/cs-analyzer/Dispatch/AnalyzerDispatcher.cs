using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Operations;
using ParametricPortal.CSharp.Analyzers.Kernel;
using ParametricPortal.CSharp.Analyzers.Rules;

namespace ParametricPortal.CSharp.Analyzers.Dispatch;

// --- [DISPATCH] --------------------------------------------------------------

internal static class AnalyzerDispatcher {

    // --- [SYMBOL_DISPATCH] ----------------------------------------------------
    internal static void Run(SymbolAnalysisContext context, AnalyzerState state) {
        ScopeInfo scope = state.ScopeFor(symbol: context.Symbol);
        switch ((scope.IsAnalyzable, context.Symbol)) {
            case (false, _):
                return;
            case (_, IMethodSymbol method):
                state.TrackPrivateMethod(method: method);
                ShapeRules.CheckSignatures(context, scope, method);
                FlowRules.CheckAsyncVoid(context, scope, method);
                RuntimeRules.CheckLibraryImport(context, scope, method);
                RuntimeRules.CheckEnumeratorCancellation(context, scope, method);
                FlowRules.CheckExemptionMetadata(context, state, method);
                return;
            case (_, IPropertySymbol property):
                ShapeRules.CheckSignatures(context, scope, property);
                ShapeRules.CheckMutableAutoProperty(context, scope, property);
                TypeShapeRules.CheckAtomRefAsProperty(context, scope, property);
                FlowRules.CheckExemptionMetadata(context, state, property);
                return;
            case (_, INamedTypeSymbol namedType):
                state.TrackInterfaceImplementations(namedType: namedType);
                ShapeRules.CheckSignatures(context, scope, namedType);
                ShapeRules.CheckOverloadSpam(context, scope, namedType);
                ShapeRules.CheckApiSurfaceInflationByPrefix(context, scope, namedType);
                ShapeRules.CheckMutableFields(context, scope, namedType);
                ShapeRules.CheckPublicCtorOnValidatedPrimitive(context, scope, namedType);
                TypeShapeRules.CheckDomainPrimitiveShape(context, scope, namedType);
                TypeShapeRules.CheckCreateFactoryReturnType(context, scope, namedType);
                TypeShapeRules.CheckDiscriminatedUnionShape(context, scope, namedType);
                TypeShapeRules.CheckDateTimeFieldInDomain(context, scope, namedType);
                TypeShapeRules.CheckAnemicEntity(context, scope, namedType);
                TypeShapeRules.CheckInitOnlyBypassOnValidated(context, scope, namedType);
                ShapeRules.CheckValidationTypeUsage(context, scope, namedType);
                FlowRules.CheckExemptionMetadata(context, state, namedType);
                return;
        }
    }

    // --- [OPERATION_DISPATCH] -------------------------------------------------

    internal static void Run(OperationAnalysisContext context, AnalyzerState state) {
        ScopeInfo scope = state.ScopeFor(symbol: context.ContainingSymbol);
        switch ((scope.IsAnalyzable, context.Operation)) {
            case (false, _):
                return;
            case (_, IInvocationOperation invocation):
                state.TrackMethodInvocation(method: invocation.TargetMethod);
                FlowRules.CheckMatchCollapse(context, state, scope, invocation);
                FlowRules.CheckMatchBoundaryStrict(context, scope, invocation);
                FlowRules.CheckRunInTransform(context, scope, invocation);
                FlowRules.CheckReferenceEqualsNull(context, scope, invocation);
                FlowRules.CheckAsyncBlocking(context, scope, invocation);
                FlowRules.CheckTaskRunFanOut(context, scope, invocation);
                FlowRules.CheckFireAndForget(context, scope, invocation);
                FlowRules.CheckUnboundedWhenAll(context, scope, invocation);
                FlowRules.CheckFilterMapChain(context, scope, invocation);
                FlowRules.CheckMutableAccumulatorInLoop(context, scope, invocation);
                ShapeRules.CheckPositionalArguments(context, scope, invocation);
                RuntimeRules.CheckHotPathLinq(context, scope, invocation);
                RuntimeRules.CheckFluentValidation(context, scope, invocation);
                RuntimeRules.CheckChannelTopology(context, scope, invocation);
                RuntimeRules.CheckRegexStaticMethod(context, scope, invocation);
                RuntimeRules.CheckUnsafeNumericConversion(context, scope, invocation);
                return;
            case (_, IPropertyReferenceOperation propertyReference):
                FlowRules.CheckAsyncBlockingProperty(context, scope, propertyReference);
                RuntimeRules.CheckWallClock(context, scope, propertyReference);
                return;
            case (_, IObjectCreationOperation objectCreation):
                ShapeRules.CheckMutableCollections(context, scope, objectCreation);
                TypeShapeRules.CheckWithExpressionBypass(context, scope, objectCreation);
                RuntimeRules.CheckHttpClient(context, scope, objectCreation);
                RuntimeRules.CheckTimerCreation(context, scope, objectCreation);
                RuntimeRules.CheckTelemetryIdentityConstruction(context, scope, objectCreation);
                RuntimeRules.CheckRegexRuntimeConstruction(context, scope, objectCreation);
                return;
            case (_, IAnonymousFunctionOperation anonymousFunction):
                RuntimeRules.CheckClosureCapture(context, scope, anonymousFunction);
                RuntimeRules.CheckHotPathNonStaticLambda(context, scope, anonymousFunction);
                return;
            case (_, IConditionalOperation conditional):
                FlowRules.CheckImperativeConditional(context, state, scope, conditional);
                FlowRules.CheckEarlyReturnGuardChain(context, scope, conditional);
                return;
            case (_, ILoopOperation loop):
                FlowRules.CheckImperativeLoop(context, state, scope, loop);
                return;
            case (_, ITryOperation tryOperation):
                FlowRules.CheckExceptionTry(context, state, scope, tryOperation);
                return;
            case (_, IThrowOperation throwOperation):
                FlowRules.CheckExceptionThrow(context, state, scope, throwOperation);
                return;
            case (_, IBinaryOperation binary):
                FlowRules.CheckNullSentinel(context, scope, binary);
                return;
            case (_, IIsPatternOperation isPattern):
                FlowRules.CheckNullPatternSentinel(context, scope, isPattern);
                return;
            case (_, ISimpleAssignmentOperation simpleAssignment):
                FlowRules.CheckVariableReassignment(context, scope, simpleAssignment);
                return;
            case (_, ILiteralOperation literal):
                RuntimeRules.CheckHardcodedOtlp(context, scope, literal);
                return;
            case (_, IAwaitOperation awaitOperation):
                FlowRules.CheckAsyncAwaitInEff(context, scope, awaitOperation);
                return;
            case (_, IConversionOperation conversion):
                RuntimeRules.CheckUnsafeNarrowingCast(context, scope, conversion);
                return;
        }
    }

    // --- [SYNTAX_TREE_DISPATCH] -----------------------------------------------

    internal static void Run(SyntaxTreeAnalysisContext context) =>
        ShapeRules.CheckMissingPreludeUsing(context);

    // --- [COMPILATION_DISPATCH] ----------------------------------------------

    internal static void Run(CompilationAnalysisContext context, AnalyzerState state) {
        ShapeRules.ReportInterfacePollution(context, state);
        ShapeRules.ReportSingleUseHelpers(context, state);
    }
}
