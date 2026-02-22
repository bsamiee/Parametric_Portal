using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Operations;
using ParametricPortal.CSharp.Analyzers.Kernel;

namespace ParametricPortal.CSharp.Analyzers.Rules;

// --- [SHAPE_RULES] -----------------------------------------------------------

internal static class ShapeRules {
    // --- [CONSTANTS] ----------------------------------------------------------

    private static readonly SpecialType[] PrimitiveSpecialTypes = [SpecialType.System_String, SpecialType.System_Int32, SpecialType.System_Int64, SpecialType.System_Boolean, SpecialType.System_Decimal];
    private static readonly HashSet<string> PrimitiveMetaNames = new(["Guid", "DateTime", "DateTimeOffset"], StringComparer.Ordinal);
    private static readonly HashSet<string> ConcurrentCollectionNames = new(["ConcurrentDictionary`2", "ConcurrentBag`1", "ConcurrentQueue`1", "ConcurrentStack`1"], StringComparer.Ordinal);
    private static readonly string[] InflationPrefixes = ["Get", "TryGet", "GetOr"];
    private static readonly HashSet<string> InterfaceExemptionAttributes = new(["UnionAttribute", "Union", "SmartEnumAttribute", "SmartEnum"], StringComparer.Ordinal);
    private static readonly HashSet<string> TypeClassHintAttributes = new(["TypeClassAttribute", "TypeClass", "TraitAttribute", "Trait"], StringComparer.Ordinal);

    // --- [SIGNATURE_RULES] ----------------------------------------------------

    internal static void CheckSignatures(SymbolAnalysisContext context, ScopeInfo scope, ISymbol symbol) {
        IEnumerable<ITypeSymbol> signatureTypes = symbol switch {
            IMethodSymbol method => method.Parameters.Select(parameter => UnwrapNullable(parameter.Type)).Append(UnwrapNullable(method.ReturnType)),
            IPropertySymbol property => [UnwrapNullable(property.Type)],
            _ => [],
        };
        IEnumerable<Diagnostic> diagnostics = (scope.IsDomainOrApplication, symbol.DeclaredAccessibility) switch {
            (true, Accessibility.Public) => signatureTypes.SelectMany(type => {
                ITypeSymbol original = type.OriginalDefinition;
                string namespaceName = type.ContainingNamespace?.ToDisplayString() ?? string.Empty;
                bool bclCollection = namespaceName == "System.Collections"
                    || namespaceName == "System.Collections.Generic"
                    || namespaceName.StartsWith(value: "System.Collections.", comparisonType: StringComparison.Ordinal);
                return (PrimitiveSpecialTypes.Contains(original.SpecialType), PrimitiveMetaNames.Contains(original.MetadataName), bclCollection, type.TypeKind == TypeKind.Array, symbol.Locations.Length) switch {
                    (true, _, _, _, > 0) => [Diagnostic.Create(RuleCatalog.CSP0003, symbol.Locations[0], original.MetadataName)],
                    (_, true, _, _, > 0) => [Diagnostic.Create(RuleCatalog.CSP0003, symbol.Locations[0], original.MetadataName)],
                    (_, _, true, _, > 0) => [Diagnostic.Create(RuleCatalog.CSP0004, symbol.Locations[0], original.MetadataName)],
                    (_, _, _, true, > 0) => [Diagnostic.Create(RuleCatalog.CSP0201, symbol.Locations[0], original.MetadataName)],
                    _ => Array.Empty<Diagnostic>(),
                };
            }),
            _ => [],
        };
        AnalyzerState.ReportEach(context.ReportDiagnostic, diagnostics);
    }

    // --- [MUTABILITY_RULES] ---------------------------------------------------

    internal static void CheckMutableAutoProperty(SymbolAnalysisContext context, ScopeInfo scope, IPropertySymbol property) =>
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, property.SetMethod, property.Locations.Length) switch {
            (true, IMethodSymbol setter, > 0) when !setter.IsInitOnly && setter.DeclaredAccessibility != Accessibility.Private
                => Diagnostic.Create(RuleCatalog.CSP0012, property.Locations[0], property.Name),
            _ => null,
        });
    internal static void CheckMutableCollections(OperationAnalysisContext context, ScopeInfo scope, IObjectCreationOperation objectCreation) {
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, objectCreation.Type is INamedTypeSymbol mutableType && SymbolFacts.MutableCollectionNames.Contains(mutableType.OriginalDefinition.MetadataName)) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0011, context.Operation.Syntax.GetLocation(), objectCreation.Type?.MetadataName ?? string.Empty),
            _ => null,
        });
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, objectCreation.Type is INamedTypeSymbol concurrentType && ConcurrentCollectionNames.Contains(concurrentType.OriginalDefinition.MetadataName)) switch {
            (true, true) => Diagnostic.Create(RuleCatalog.CSP0204, context.Operation.Syntax.GetLocation(), objectCreation.Type?.MetadataName ?? string.Empty),
            _ => null,
        });
    }
    internal static void CheckMutableFields(SymbolAnalysisContext context, ScopeInfo scope, INamedTypeSymbol namedType) {
        IEnumerable<Diagnostic> diagnostics = scope.IsDomainOrApplication switch {
            true => namedType.GetMembers()
                .OfType<IFieldSymbol>()
                .Where(field => !field.IsReadOnly && !field.IsConst)
                .Where(field => field.DeclaredAccessibility is not Accessibility.Private)
                .Where(field => field.Locations.Length > 0)
                .Select(field => Diagnostic.Create(RuleCatalog.CSP0202, field.Locations[0], field.Name)),
            _ => [],
        };
        AnalyzerState.ReportEach(context.ReportDiagnostic, diagnostics);
    }

    // --- [MODEL_RULES] --------------------------------------------------------

    internal static void CheckPublicCtorOnValidatedPrimitive(SymbolAnalysisContext context, ScopeInfo scope, INamedTypeSymbol namedType) {
        bool hasPublicInstanceCtor = namedType.InstanceConstructors.Any(constructor => constructor.DeclaredAccessibility == Accessibility.Public);
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, namedType.TypeKind, namedType.IsReadOnly, SymbolFacts.HasCreateFactory(namedType), hasPublicInstanceCtor, namedType.Locations.Length) switch {
            (true, TypeKind.Struct, true, true, true, > 0)
                => Diagnostic.Create(RuleCatalog.CSP0203, namedType.Locations[0], namedType.Name),
            _ => null,
        });
    }
    internal static void CheckValidationTypeUsage(SymbolAnalysisContext context, ScopeInfo scope, INamedTypeSymbol namedType) {
        IEnumerable<ITypeSymbol> publicTypes = namedType.GetMembers().OfType<IMethodSymbol>()
            .Where(method => method.DeclaredAccessibility == Accessibility.Public)
            .SelectMany(method => method.Parameters.Select(parameter => parameter.Type).Append(method.ReturnType))
            .Concat(namedType.GetMembers().OfType<IPropertySymbol>()
                .Where(property => property.DeclaredAccessibility == Accessibility.Public)
                .Select(property => property.Type))
            .Select(UnwrapNullable);
        IEnumerable<Diagnostic> diagnostics = (scope.IsDomainOrApplication, namedType.Locations.Length) switch {
            (true, > 0) => publicTypes
                .Where(type => type is INamedTypeSymbol { OriginalDefinition.MetadataName: "Validation`2", TypeArguments.Length: 2 } validation
                    && validation.TypeArguments[0] is INamedTypeSymbol { OriginalDefinition.MetadataName: "Seq`1", TypeArguments.Length: 1 } seqType
                    && seqType.TypeArguments[0] is INamedTypeSymbol { Name: "Error" } errorType
                    && validation.ContainingNamespace.ToDisplayString().StartsWith(value: Markers.LanguageExtNamespace, comparisonType: StringComparison.Ordinal)
                    && errorType.ContainingNamespace.ToDisplayString().StartsWith(value: "LanguageExt.Common", comparisonType: StringComparison.Ordinal))
                .Select(type => Diagnostic.Create(RuleCatalog.CSP0703, namedType.Locations[0], type.ToDisplayString())),
            _ => [],
        };
        AnalyzerState.ReportEach(context.ReportDiagnostic, diagnostics);
    }

    // --- [SURFACE_RULES] ------------------------------------------------------

    internal static void CheckOverloadSpam(SymbolAnalysisContext context, ScopeInfo scope, INamedTypeSymbol namedType) {
        IEnumerable<Diagnostic> diagnostics = scope.IsDomainOrApplication switch {
            true => namedType.GetMembers()
                .OfType<IMethodSymbol>()
                .Where(method => method.MethodKind == MethodKind.Ordinary)
                .GroupBy(method => method.Name)
                .Select(group => group.ToImmutableArray())
                .Where(ShouldReportOverloadCollapse)
                .Where(members => members[0].Locations.Length > 0)
                .Select(members => Diagnostic.Create(RuleCatalog.CSP0005, members[0].Locations[0], members[0].Name, members.Length)),
            _ => [],
        };
        AnalyzerState.ReportEach(context.ReportDiagnostic, diagnostics);
    }
    internal static void CheckApiSurfaceInflationByPrefix(SymbolAnalysisContext context, ScopeInfo scope, INamedTypeSymbol namedType) {
        ImmutableArray<IMethodSymbol> familyMethods = [
            .. namedType.GetMembers().OfType<IMethodSymbol>()
                .Where(method => method.MethodKind == MethodKind.Ordinary)
                .Where(method => method.DeclaredAccessibility == Accessibility.Public)
                .Where(method => InflationPrefixes.Any(prefix => method.Name.StartsWith(value: prefix, comparisonType: StringComparison.Ordinal))),
        ];
        int distinctNames = familyMethods.Select(method => method.Name).Distinct(StringComparer.Ordinal).Count();
        bool inflation = familyMethods.Length > 3 && distinctNames > 2;
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, inflation, namedType.Locations.Length) switch {
            (true, true, > 0) => Diagnostic.Create(RuleCatalog.CSP0708, namedType.Locations[0], namedType.Name),
            _ => null,
        });
    }
    internal static void CheckPositionalArguments(OperationAnalysisContext context, ScopeInfo scope, IInvocationOperation invocation) {
        ImmutableArray<ArgumentSyntax> positionalArguments = invocation.Syntax is InvocationExpressionSyntax { ArgumentList.Arguments: { Count: > 0 } arguments }
            ? [.. arguments.Where(argument => argument.NameColon is null)]
            : [];
        string targetNamespace = invocation.TargetMethod.ContainingNamespace?.ToDisplayString() ?? string.Empty;
        bool domainTarget = SymbolFacts.IsDomainOrApplicationNamespace(targetNamespace);
        IEnumerable<Diagnostic> diagnostics = (scope.IsDomainOrApplication, domainTarget) switch {
            (true, true) => positionalArguments.Select(argument => Diagnostic.Create(RuleCatalog.CSP0502, argument.GetLocation())),
            _ => [],
        };
        AnalyzerState.ReportEach(context.ReportDiagnostic, diagnostics);
    }
    internal static void CheckEffectReturnPolicy(SymbolAnalysisContext context, ScopeInfo scope, IMethodSymbol method) {
        bool ordinaryMethod = method.MethodKind == MethodKind.Ordinary;
        bool disallowedReturn = method.ReturnsVoid || SymbolFacts.IsTaskLikeType(method.ReturnType);
        bool interfaceContract = method.IsOverride || method.ExplicitInterfaceImplementations.Length > 0;
        string returnType = method.ReturnsVoid ? "void" : method.ReturnType.ToDisplayString();
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, ordinaryMethod, disallowedReturn, interfaceContract, method.Locations.Length) switch {
            (true, true, true, false, > 0) => Diagnostic.Create(RuleCatalog.CSP0504, method.Locations[0], method.Name, returnType),
            _ => null,
        });
    }
    internal static void CheckTypeClassStaticAbstractPolicy(SymbolAnalysisContext context, ScopeInfo scope, INamedTypeSymbol namedType) {
        bool candidate = namedType.TypeKind == TypeKind.Interface && IsTypeClassInterfaceCandidate(namedType);
        bool hasStaticAbstractMember = namedType.GetMembers().Any(member =>
            member switch {
                IMethodSymbol method => method.IsStatic && method.IsAbstract,
                IPropertySymbol property => property.IsStatic && property.IsAbstract,
                IEventSymbol @event => @event.IsStatic && @event.IsAbstract,
                _ => false,
            });
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, candidate, hasStaticAbstractMember, namedType.Locations.Length) switch {
            (true, true, false, > 0) => Diagnostic.Create(RuleCatalog.CSP0505, namedType.Locations[0], namedType.Name),
            _ => null,
        });
    }
    internal static void CheckExtensionProjectionPolicy(SymbolAnalysisContext context, ScopeInfo scope, IMethodSymbol method) {
        ITypeSymbol? receiverType = method.Parameters.Length > 0 ? UnwrapNullable(method.Parameters[0].Type) : null;
        string receiverName = receiverType?.ToDisplayString() ?? string.Empty;
        bool staticOrdinaryMethod = method.MethodKind == MethodKind.Ordinary && method.IsStatic;
        bool receiverDomainOrApplication = receiverType is ITypeSymbol type && SymbolFacts.IsDomainOrApplicationNamespace(type.ContainingNamespace?.ToDisplayString() ?? string.Empty);
        bool externalReceiver = receiverType switch {
            INamedTypeSymbol namedReceiver => !SymbolEqualityComparer.Default.Equals(namedReceiver, method.ContainingType),
            _ => true,
        };
        AnalyzerState.Report(context.ReportDiagnostic, (scope.IsDomainOrApplication, staticOrdinaryMethod, method.IsExtensionMethod, receiverDomainOrApplication, externalReceiver, method.Locations.Length) switch {
            (true, true, false, true, true, > 0) => Diagnostic.Create(RuleCatalog.CSP0506, method.Locations[0], method.Name, receiverName),
            _ => null,
        });
    }

    // --- [REPORTS] ------------------------------------------------------------

    internal static void ReportInterfacePollution(CompilationAnalysisContext context, AnalyzerState state) {
        IEnumerable<Diagnostic> diagnostics = state.SingleImplementationInterfaces()
            .Where(tuple => tuple.Interface.TypeKind == TypeKind.Interface)
            .Where(tuple => tuple.Interface.Name.StartsWith(value: "I", comparisonType: StringComparison.Ordinal))
            .Where(tuple => state.ScopeFor(tuple.Interface).IsDomainOrApplication)
            .Where(tuple => !IsExemptInterface(tuple.Interface))
            .Where(tuple => tuple.Interface.Locations.Length > 0)
            .Select(tuple => Diagnostic.Create(RuleCatalog.CSP0501, tuple.Interface.Locations[0], tuple.Interface.Name, tuple.Implementation.Name));
        AnalyzerState.ReportEach(context.ReportDiagnostic, diagnostics);
    }
    internal static void ReportSingleUseHelpers(CompilationAnalysisContext context, AnalyzerState state) {
        IEnumerable<Diagnostic> diagnostics = state.SingleUsePrivateMethods()
            .Where(method => state.ScopeFor(method).IsDomainOrApplication)
            .Where(method => method.Locations.Length > 0)
            .Select(method => Diagnostic.Create(RuleCatalog.CSP0503, method.Locations[0], method.Name));
        AnalyzerState.ReportEach(context.ReportDiagnostic, diagnostics);
    }

    // --- [CONVENTION_RULES] ---------------------------------------------------

    internal static void CheckVarInference(SyntaxTreeAnalysisContext context) {
        CompilationUnitSyntax? compilationUnit = context.Tree.GetRoot(context.CancellationToken) as CompilationUnitSyntax;
        bool isDomainOrApplication = compilationUnit?.Members.OfType<BaseNamespaceDeclarationSyntax>()
            .Any(namespaceDecl => {
                string namespaceName = namespaceDecl.Name.ToString();
                return SymbolFacts.IsDomainOrApplicationNamespace(namespaceName);
            }) ?? false;
        IEnumerable<(Location Location, string Name)> varUsages = (isDomainOrApplication, compilationUnit) switch {
            (true, CompilationUnitSyntax root) =>
                root.DescendantNodes().OfType<VariableDeclarationSyntax>()
                    .Where(static declaration => declaration.Type.IsVar)
                    .SelectMany(declaration => declaration.Variables.Select(variable => (Location: declaration.Type.GetLocation(), Name: variable.Identifier.ValueText)))
                    .Concat(root.DescendantNodes().OfType<ForEachStatementSyntax>()
                        .Where(static statement => statement.Type.IsVar)
                        .Select(statement => (Location: statement.Type.GetLocation(), Name: statement.Identifier.ValueText)))
                    .Concat(root.DescendantNodes().OfType<DeclarationExpressionSyntax>()
                        .Where(static declaration => declaration.Type is IdentifierNameSyntax { Identifier.ValueText: "var" })
                        .SelectMany(declaration => declaration.Designation switch {
                            SingleVariableDesignationSyntax single => [(Location: declaration.Type.GetLocation(), Name: single.Identifier.ValueText)],
                            _ => Array.Empty<(Location Location, string Name)>(),
                        })),
            _ => [],
        };
        AnalyzerState.ReportEach(context.ReportDiagnostic, varUsages.Select(usage =>
            Diagnostic.Create(RuleCatalog.CSP0015, usage.Location, usage.Name)));
    }
    internal static void CheckMissingPreludeUsing(SyntaxTreeAnalysisContext context) {
        CompilationUnitSyntax? compilationUnit = context.Tree.GetRoot(context.CancellationToken) as CompilationUnitSyntax;
        bool hasPreludeUsing = compilationUnit?.Usings.Any(directive =>
            directive.StaticKeyword.IsKind(SyntaxKind.StaticKeyword)
            && directive.Name?.ToString() == "LanguageExt.Prelude") ?? false;
        bool isDomainOrApplication = compilationUnit?.Members.OfType<BaseNamespaceDeclarationSyntax>()
            .Any(namespaceDecl => {
                string namespaceName = namespaceDecl.Name.ToString();
                return SymbolFacts.IsDomainOrApplicationNamespace(namespaceName);
            }) ?? false;
        string fileName = Path.GetFileName(context.Tree.FilePath);
        AnalyzerState.Report(context.ReportDiagnostic, (isDomainOrApplication, hasPreludeUsing) switch {
            (true, false) => Diagnostic.Create(RuleCatalog.CSP0716, compilationUnit?.GetLocation() ?? Location.None, fileName),
            _ => null,
        });
    }

    // --- [PRIVATE_FUNCTIONS] --------------------------------------------------

    private static bool IsExemptInterface(INamedTypeSymbol interfaceSymbol) {
        // Exempt Has<RT,Trait> pattern interfaces
        bool hasTraitPattern = interfaceSymbol.IsGenericType
            && interfaceSymbol.Name.StartsWith(value: "Has", comparisonType: StringComparison.Ordinal);
        // Exempt static abstract interfaces (type classes)
        bool hasStaticAbstract = interfaceSymbol.GetMembers().OfType<IMethodSymbol>()
            .Any(method => method.IsStatic && method.IsAbstract);
        // Exempt [Union]/[SmartEnum] attributed types
        bool hasExemptionAttribute = interfaceSymbol.GetAttributes()
            .Any(attribute => InterfaceExemptionAttributes.Contains(attribute.AttributeClass?.Name ?? string.Empty));
        return hasTraitPattern || hasStaticAbstract || hasExemptionAttribute;
    }
    private static bool IsTypeClassInterfaceCandidate(INamedTypeSymbol interfaceSymbol) {
        bool nameHint = interfaceSymbol.Name.Contains(value: "TypeClass", comparisonType: StringComparison.Ordinal)
            || interfaceSymbol.Name.EndsWith(value: "Trait", comparisonType: StringComparison.Ordinal);
        bool attributeHint = interfaceSymbol.GetAttributes()
            .Any(attribute => TypeClassHintAttributes.Contains(attribute.AttributeClass?.Name ?? string.Empty));
        bool selfTypeHint = interfaceSymbol.TypeParameters.Any(parameter =>
            parameter.Name.Equals(value: "TSelf", comparisonType: StringComparison.Ordinal)
            || parameter.Name.Equals(value: "TSelfType", comparisonType: StringComparison.Ordinal));
        return nameHint || attributeHint || selfTypeHint;
    }
    private static bool ShouldReportOverloadCollapse(ImmutableArray<IMethodSymbol> overloads) {
        bool hasReadOnlySpanCollapse = overloads.Any(IsParamsReadOnlySpanOverload);
        bool arityLadder = overloads.Select(overload => overload.Parameters.Length).Distinct().Count() > 1;
        bool overloadPressure = overloads.Length > 2 || (overloads.Length > 1 && arityLadder);
        return overloadPressure && !hasReadOnlySpanCollapse;
    }
    private static bool IsParamsReadOnlySpanOverload(IMethodSymbol overload) =>
        overload.Parameters switch {
            { Length: > 0 } parameters => parameters[parameters.Length - 1] switch {
                { IsParams: true, Type: INamedTypeSymbol { OriginalDefinition.MetadataName: "ReadOnlySpan`1", ContainingNamespace: { } ns } }
                    => ns.ToDisplayString() == "System",
                _ => false,
            },
            _ => false,
        };
    private static ITypeSymbol UnwrapNullable(ITypeSymbol type) => SymbolFacts.UnwrapNullable(type);
}
