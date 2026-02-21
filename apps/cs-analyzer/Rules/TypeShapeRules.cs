using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Operations;
using ParametricPortal.CSharp.Analyzers.Kernel;

namespace ParametricPortal.CSharp.Analyzers.Rules;

// --- [TYPE_SHAPE_RULES] ------------------------------------------------------

internal static class TypeShapeRules {
    // --- [CONSTANTS] ----------------------------------------------------------

    private static readonly HashSet<string> DateTimeMetaNames = new(["DateTime", "DateTimeOffset"], StringComparer.Ordinal);

    // --- [PRIMITIVE_SHAPE] ----------------------------------------------------

    internal static void CheckDomainPrimitiveShape(SymbolAnalysisContext context, ScopeInfo scope, INamedTypeSymbol namedType) {
        bool candidate = namedType.TypeKind == TypeKind.Struct
            && namedType.GetMembers().OfType<IPropertySymbol>().Any(property => property.Name == "Value");
        bool hasPublicCtor = namedType.InstanceConstructors.Any(constructor => constructor.DeclaredAccessibility == Accessibility.Public);
        bool shapeValid = namedType.IsRecord && namedType.IsReadOnly && SymbolFacts.HasCreateFactory(namedType) && !hasPublicCtor;
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, candidate, shapeValid, namedType.Locations.Length) switch {
            (true, true, false, > 0) => Diagnostic.Create(RuleCatalog.CSP0701, namedType.Locations[0], namedType.Name),
            _ => null,
        });
    }

    // --- [CREATE_FACTORY_RETURN] ----------------------------------------------

    internal static void CheckCreateFactoryReturnType(SymbolAnalysisContext context, ScopeInfo scope, INamedTypeSymbol namedType) {
        IEnumerable<IMethodSymbol> factories = namedType.GetMembers().OfType<IMethodSymbol>()
            .Where(method => method.IsStatic && method.Name is "Create" or "CreateK");
        IEnumerable<Diagnostic> diagnostics = (scope.IsDomainOrApplication, namedType.Locations.Length) switch {
            (true, > 0) => factories
                .Where(factory => !SymbolFacts.IsFinOrKReturnType(factory))
                .Select(factory => Diagnostic.Create(RuleCatalog.CSP0713, namedType.Locations[0], namedType.Name)),
            _ => [],
        };
        AnalyzerState.ReportEach(context.ReportDiagnostic, diagnostics);
    }

    // --- [DU_SHAPE] -----------------------------------------------------------

    internal static void CheckDiscriminatedUnionShape(SymbolAnalysisContext context, ScopeInfo scope, INamedTypeSymbol namedType) {
        ImmutableArray<INamedTypeSymbol> unionCases = [
            .. namedType.GetTypeMembers().Where(caseType => SymbolEqualityComparer.Default.Equals(caseType.BaseType, namedType)),
        ];
        bool candidate = namedType.IsRecord && namedType.IsAbstract && unionCases.Length > 0;
        bool thinktectureUnion = SymbolFacts.HasAnyAttribute(namedType, "UnionAttribute", "Union");
        bool privateProtectedCtor = namedType.InstanceConstructors.Any(constructor => constructor.DeclaredAccessibility == Accessibility.ProtectedAndInternal);
        bool privateCtor = namedType.InstanceConstructors.Any(constructor => constructor.DeclaredAccessibility == Accessibility.Private);
        bool allCasesSealed = unionCases.All(caseType => caseType.IsSealed);
        bool hasUnreachableGuard = namedType.DeclaringSyntaxReferences
            .GroupBy(static (SyntaxReference reference) => reference.SyntaxTree)
            .Any((IGrouping<SyntaxTree, SyntaxReference> group) => {
                SemanticModel model = context.Compilation.GetSemanticModel(group.Key);
                return group.Any((SyntaxReference reference) => reference.GetSyntax(context.CancellationToken)
                    .DescendantNodesAndSelf()
                    .OfType<ThrowExpressionSyntax>()
                    .Select((ThrowExpressionSyntax node) => model.GetOperation(node, context.CancellationToken))
                    .Concat(reference.GetSyntax(context.CancellationToken).DescendantNodesAndSelf()
                        .OfType<ThrowStatementSyntax>()
                        .Select((ThrowStatementSyntax node) => model.GetOperation(node, context.CancellationToken)))
                    .OfType<IThrowOperation>()
                    .Any(SymbolFacts.IsUnreachableThrow));
            });
        bool valid = (thinktectureUnion, privateProtectedCtor, privateCtor, allCasesSealed, hasUnreachableGuard) switch {
            (true, _, true, true, _) => true,
            (true, true, _, true, _) => true,
            (false, true, _, true, true) => true,
            _ => false,
        };
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, candidate, valid, namedType.Locations.Length) switch {
            (true, true, false, > 0) => Diagnostic.Create(RuleCatalog.CSP0702, namedType.Locations[0], namedType.Name),
            _ => null,
        });
    }

    // --- [DATETIME_FIELD] -----------------------------------------------------

    internal static void CheckDateTimeFieldInDomain(SymbolAnalysisContext context, ScopeInfo scope, INamedTypeSymbol namedType) {
        IEnumerable<Diagnostic> diagnostics = scope.IsDomainOrApplication switch {
            true => namedType.GetMembers()
                .Where(member => member switch {
                    IFieldSymbol field => DateTimeMetaNames.Contains(UnwrapNullable(field.Type).OriginalDefinition.MetadataName),
                    IPropertySymbol property => DateTimeMetaNames.Contains(UnwrapNullable(property.Type).OriginalDefinition.MetadataName),
                    _ => false,
                })
                .Where(member => member.Locations.Length > 0)
                .Select(member => Diagnostic.Create(RuleCatalog.CSP0714, member.Locations[0], member.Name))
                .Concat(namedType.GetMembers().OfType<IMethodSymbol>()
                    .SelectMany(method => method.Parameters)
                    .Where(parameter => DateTimeMetaNames.Contains(UnwrapNullable(parameter.Type).OriginalDefinition.MetadataName))
                    .Where(parameter => parameter.Locations.Length > 0)
                    .Select(parameter => Diagnostic.Create(RuleCatalog.CSP0714, parameter.Locations[0], parameter.Name))),
            _ => [],
        };
        AnalyzerState.ReportEach(context.ReportDiagnostic, diagnostics);
    }

    // --- [ANEMIC_ENTITY] ------------------------------------------------------

    internal static void CheckAnemicEntity(SymbolAnalysisContext context, ScopeInfo scope, INamedTypeSymbol namedType) {
        // TypeKind.Class covers both class and record declarations in Roslyn
        bool isConcreteClass = namedType.TypeKind == TypeKind.Class && !namedType.IsAbstract && !namedType.IsStatic;
        ImmutableArray<IPropertySymbol> publicProperties = [
            .. namedType.GetMembers().OfType<IPropertySymbol>()
                .Where(property => property.DeclaredAccessibility == Accessibility.Public),
        ];
        bool allGetSet = publicProperties.Length > 0
            && publicProperties.All(property => property.GetMethod is not null && property.SetMethod is not null && !property.SetMethod.IsInitOnly);
        bool hasFactory = SymbolFacts.HasCreateFactory(namedType);
        bool hasDomainMethods = namedType.GetMembers().OfType<IMethodSymbol>()
            .Any(method => method.MethodKind == MethodKind.Ordinary
                && method.DeclaredAccessibility == Accessibility.Public
                && !method.IsStatic
                && method.Name is not "ToString" and not "Equals" and not "GetHashCode");
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, isConcreteClass, allGetSet, hasFactory, hasDomainMethods, namedType.Locations.Length) switch {
            (true, true, true, false, false, > 0) => Diagnostic.Create(RuleCatalog.CSP0715, namedType.Locations[0], namedType.Name),
            _ => null,
        });
    }

    // --- [ATOM_REF_PROPERTY] --------------------------------------------------

    internal static void CheckAtomRefAsProperty(SymbolAnalysisContext context, ScopeInfo scope, IPropertySymbol property) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, SymbolFacts.IsAtomOrRefType(UnwrapNullable(property.Type)), property.Locations.Length) switch {
            (true, true, > 0) => Diagnostic.Create(RuleCatalog.CSP0712, property.Locations[0], property.Name),
            _ => null,
        });

    // --- [WITH_EXPRESSION_BYPASS] ---------------------------------------------

    internal static void CheckWithExpressionBypass(OperationAnalysisContext context, ScopeInfo scope, IObjectCreationOperation objectCreation) {
        INamedTypeSymbol? createdType = objectCreation.Type as INamedTypeSymbol;
        string typeName = createdType?.Name ?? string.Empty;
        bool hasPrivateCtor = createdType?.InstanceConstructors.Any(constructor => constructor.DeclaredAccessibility is Accessibility.Private or Accessibility.ProtectedAndInternal) == true;
        bool hasFactory = createdType is not null && SymbolFacts.HasCreateFactory(createdType);
        bool externalCaller = createdType is not null
            && !SymbolEqualityComparer.Default.Equals(
                context.ContainingSymbol?.ContainingType,
                createdType);
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, createdType?.IsRecord, hasPrivateCtor, hasFactory, externalCaller) switch {
            (true, true, true, true, true) => Diagnostic.Create(RuleCatalog.CSP0717, context.Operation.Syntax.GetLocation(), typeName),
            _ => null,
        });
    }

    // --- [INIT_ONLY_BYPASS] ---------------------------------------------------

    internal static void CheckInitOnlyBypassOnValidated(SymbolAnalysisContext context, ScopeInfo scope, INamedTypeSymbol namedType) {
        bool hasValidatedFactory = SymbolFacts.HasCreateFactory(namedType)
            && namedType.GetMembers().OfType<IMethodSymbol>()
                .Where(method => method.IsStatic && method.Name is "Create" or "CreateK")
                .Any(SymbolFacts.IsFinOrKReturnType);
        IEnumerable<Diagnostic> diagnostics = (scope.IsDomainOrApplication, hasValidatedFactory, namedType.Locations.Length) switch {
            (true, true, > 0) => namedType.GetMembers().OfType<IPropertySymbol>()
                .Where(property => property.SetMethod is IMethodSymbol setter && setter.IsInitOnly)
                .Where(property => property.Locations.Length > 0)
                .Select(property => Diagnostic.Create(RuleCatalog.CSP0720, property.Locations[0], property.Name)),
            _ => [],
        };
        AnalyzerState.ReportEach(context.ReportDiagnostic, diagnostics);
    }

    // --- [PRIVATE_FUNCTIONS] --------------------------------------------------

    private static ITypeSymbol UnwrapNullable(ITypeSymbol type) => SymbolFacts.UnwrapNullable(type);
}
