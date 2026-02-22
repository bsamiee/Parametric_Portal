using System.Collections.Concurrent;
using System.Collections.Immutable;
using System.Globalization;
using Microsoft.CodeAnalysis;
using ParametricPortal.CSharp.Analyzers.Contracts;

namespace ParametricPortal.CSharp.Analyzers.Kernel;

// --- [ENUMS] -----------------------------------------------------------------

internal enum BoundaryExemptionStatus {
    Missing = 0,
    Invalid = 1,
    Expired = 2,
    Valid = 3,
}

// --- [STATE] -----------------------------------------------------------------

internal sealed class AnalyzerState {
    // --- [CONSTANTS] ----------------------------------------------------------

    private static readonly IEqualityComparer<ISymbol> SymbolComparer = SymbolEqualityComparer.Default;
    private static readonly IEqualityComparer<INamedTypeSymbol> NamedTypeComparer = SymbolEqualityComparer.Default;

    // --- [FIELDS] -------------------------------------------------------------

    private readonly ConcurrentDictionary<ISymbol, ScopeInfo> _scopeCache = new(comparer: SymbolComparer);
    private readonly ConcurrentDictionary<ISymbol, ImmutableArray<BoundaryExemptionInfo>> _exemptionCache = new(comparer: SymbolComparer);
    private readonly ConcurrentDictionary<IMethodSymbol, int> _methodInvocationCounts = new(comparer: SymbolComparer);
    private readonly ConcurrentDictionary<IMethodSymbol, byte> _privateMethods = new(comparer: SymbolComparer);
    private readonly ConcurrentDictionary<INamedTypeSymbol, ImmutableHashSet<INamedTypeSymbol>> _interfaceImplementations = new(comparer: NamedTypeComparer);

    // --- [CONSTRUCTORS] -------------------------------------------------------

    private AnalyzerState(Compilation compilation, INamespaceSymbol? languageExtNamespace, DateTimeOffset analysisUtcNow) {
        Compilation = compilation;
        LanguageExtNamespace = languageExtNamespace;
        AnalysisUtcNow = analysisUtcNow;
    }

    // --- [PROPERTIES] ---------------------------------------------------------

    internal Compilation Compilation { get; }
    internal INamespaceSymbol? LanguageExtNamespace { get; }
    internal DateTimeOffset AnalysisUtcNow { get; }

    // --- [FACTORIES] ----------------------------------------------------------

    internal static AnalyzerState Create(Compilation compilation) {
        INamespaceSymbol? languageExtNamespace = compilation.GetTypeByMetadataName("LanguageExt.Option`1")?.ContainingNamespace;
        DateTimeOffset analysisUtcNow = DateTimeOffset.UtcNow;
        return new AnalyzerState(compilation: compilation, languageExtNamespace: languageExtNamespace, analysisUtcNow: analysisUtcNow);
    }

    // --- [QUERIES] ------------------------------------------------------------

    internal ScopeInfo ScopeFor(ISymbol symbol) =>
        _scopeCache.GetOrAdd(key: symbol, valueFactory: ScopeModel.Classify);
    internal ImmutableArray<BoundaryExemptionInfo> ExemptionsFor(ISymbol symbol) =>
        _exemptionCache.GetOrAdd(key: symbol, valueFactory: static targetSymbol =>
            [
                .. SymbolFacts.AllAttributes(targetSymbol)
                    .Where(attribute => attribute.AttributeClass?.Name is nameof(BoundaryImperativeExemptionAttribute) or "BoundaryImperativeExemption")
                    .Select(BoundaryExemptionInfo.Parse),
            ]);
    internal (BoundaryExemptionStatus Status, BoundaryExemptionInfo? MatchingExemption) ExemptionStatus(ISymbol symbol, DiagnosticDescriptor domainRule, BoundaryImperativeReason expectedReason) {
        string ruleId = domainRule.Id;
        (bool hasAny, bool hasValid, bool hasExpired, bool hasInvalid, BoundaryExemptionInfo? matchingExemption) result =
            ExemptionsFor(symbol)
                .Where(exemption => string.Equals(exemption.RuleId, ruleId, StringComparison.Ordinal))
                .Aggregate(
                    seed: (hasAny: false, hasValid: false, hasExpired: false, hasInvalid: false, matchingExemption: (BoundaryExemptionInfo?)null),
                    func: (acc, exemption) => {
                        bool reasonMatch = exemption.Reason == expectedReason;
                        bool validUnexpired = exemption.IsMetadataValid && reasonMatch && !exemption.IsExpired(AnalysisUtcNow);
                        bool expired = exemption.IsMetadataValid && reasonMatch && exemption.IsExpired(AnalysisUtcNow);
                        bool invalid = !exemption.IsMetadataValid || !reasonMatch;
                        BoundaryExemptionInfo? matchingExemption = acc.matchingExemption is null && reasonMatch ? exemption : acc.matchingExemption;
                        return (
                            hasAny: true,
                            hasValid: acc.hasValid || validUnexpired,
                            hasExpired: acc.hasExpired || expired,
                            hasInvalid: acc.hasInvalid || invalid,
                            matchingExemption);
                    });
        BoundaryExemptionStatus status = result switch {
            (false, _, _, _, _) => BoundaryExemptionStatus.Missing,
            (_, true, _, _, _) => BoundaryExemptionStatus.Valid,
            (_, false, true, _, _) => BoundaryExemptionStatus.Expired,
            _ => BoundaryExemptionStatus.Invalid,
        };
        return (status, result.matchingExemption);
    }

    // --- [TRACKING] -----------------------------------------------------------

    internal void TrackPrivateMethod(IMethodSymbol method) =>
        _ = (method.DeclaredAccessibility, method.MethodKind) switch {
            (Accessibility.Private, MethodKind.Ordinary) => _privateMethods.TryAdd(key: method, value: 0),
            _ => false,
        };
    internal void TrackMethodInvocation(IMethodSymbol? method) =>
        _ = method switch {
            IMethodSymbol calledMethod
                when calledMethod.DeclaredAccessibility == Accessibility.Private
                     && calledMethod.MethodKind == MethodKind.Ordinary
                     && SymbolEqualityComparer.Default.Equals(calledMethod.ContainingAssembly, Compilation.Assembly)
                => _methodInvocationCounts.AddOrUpdate(key: calledMethod, addValueFactory: static _ => 1, updateValueFactory: static (_, current) => current + 1),
            _ => 0,
        };
    internal void TrackInterfaceImplementations(INamedTypeSymbol namedType) {
        // Roslyn API enumeration -- not domain code
        foreach (INamedTypeSymbol interfaceSymbol in (namedType.TypeKind, namedType.IsAbstract, namedType.IsStatic) switch {
            (TypeKind.Class, false, false) or (TypeKind.Struct, false, _) => namedType.AllInterfaces,
            _ => [],
        }) {
            _ = _interfaceImplementations.AddOrUpdate(
                key: interfaceSymbol,
                addValueFactory: _ => ImmutableHashSet.Create<INamedTypeSymbol>(SymbolEqualityComparer.Default, namedType),
                updateValueFactory: (_, current) => current.Add(namedType));
        }
    }

    // --- [REPORTS] ------------------------------------------------------------

    internal ImmutableArray<(INamedTypeSymbol Interface, INamedTypeSymbol Implementation)> SingleImplementationInterfaces() =>
        [
            .. _interfaceImplementations
                .Where(entry => entry.Value.Count == 1)
                .Select(entry => (Interface: entry.Key, Implementation: entry.Value.Single())),
        ];
    internal ImmutableArray<IMethodSymbol> SingleUsePrivateMethods() =>
        [
            .. _privateMethods.Keys
                .Where(method => _methodInvocationCounts.TryGetValue(key: method, value: out int count) && count == 1),
        ];

    // --- [DIAGNOSTICS] --------------------------------------------------------

    internal static void Report(Action<Diagnostic> report, Diagnostic? diagnostic) {
        switch (diagnostic) {
            case Diagnostic d:
                report(d);
                break;
        }
    }
    internal static void ReportEach(Action<Diagnostic> report, IEnumerable<Diagnostic> diagnostics) {
        foreach (Diagnostic d in diagnostics) {
            report(d);
        }
    }

    // --- [NESTED_TYPES] -------------------------------------------------------

    internal sealed class BoundaryExemptionInfo {
        // --- [CONSTANTS] ------------------------------------------------------

        private static readonly string[] UtcFormats = [
            "O",
            "yyyy-MM-ddTHH:mm:ssZ",
            "yyyy-MM-ddTHH:mm:ss.fffffffZ",
        ];

        // --- [CONSTRUCTORS] ---------------------------------------------------

        private BoundaryExemptionInfo(string ruleId, BoundaryImperativeReason reason, string ticket, string expiresOnUtc, bool isMetadataValid, bool hasExpiry, DateTimeOffset expiryUtc) {
            RuleId = ruleId;
            Reason = reason;
            Ticket = ticket;
            ExpiresOnUtc = expiresOnUtc;
            IsMetadataValid = isMetadataValid;
            HasExpiry = hasExpiry;
            ExpiryUtc = expiryUtc;
        }

        // --- [PROPERTIES] -----------------------------------------------------

        internal string RuleId { get; }
        internal BoundaryImperativeReason Reason { get; }
        internal string Ticket { get; }
        internal string ExpiresOnUtc { get; }
        internal bool IsMetadataValid { get; }
        internal bool HasExpiry { get; }
        internal DateTimeOffset ExpiryUtc { get; }

        // --- [QUERIES] --------------------------------------------------------

        internal bool IsExpired(DateTimeOffset utcNow) =>
            (IsMetadataValid, HasExpiry) switch {
                (true, true) => ExpiryUtc <= utcNow,
                _ => false,
            };

        // --- [FACTORIES] ------------------------------------------------------

        internal static BoundaryExemptionInfo Parse(AttributeData attribute) {
            ImmutableArray<TypedConstant> args = attribute.ConstructorArguments;
            string ruleId = args.Length > 0 ? args[0].Value?.ToString() ?? string.Empty : string.Empty;
            object? reasonRaw = args.Length > 1 ? args[1].Value : null;
            string ticket = args.Length > 2 ? args[2].Value?.ToString() ?? string.Empty : string.Empty;
            string expiresOnUtc = args.Length > 3 ? args[3].Value?.ToString() ?? string.Empty : string.Empty;
            bool reasonValid = BoundaryImperativeReasonFacts.TryParse(raw: reasonRaw, reason: out BoundaryImperativeReason reason);
            bool hasExpiry = DateTimeOffset.TryParseExact(
                expiresOnUtc,
                UtcFormats,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out DateTimeOffset expiryOffset);
            bool hasRuleId = !string.IsNullOrWhiteSpace(value: ruleId);
            bool hasTicket = !string.IsNullOrWhiteSpace(value: ticket);
            bool metadataValid = hasRuleId && hasTicket && hasExpiry && reasonValid;
            return new BoundaryExemptionInfo(
                ruleId: ruleId,
                reason: reason,
                ticket: ticket,
                expiresOnUtc: expiresOnUtc,
                isMetadataValid: metadataValid,
                hasExpiry: hasExpiry,
                expiryUtc: hasExpiry ? expiryOffset : DateTimeOffset.MinValue);
        }
    }
}
