using System.Collections.Immutable;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using ParametricPortal.CSharp.Analyzers.Tests.Infrastructure;
using Xunit;

namespace ParametricPortal.CSharp.Analyzers.Tests;

public sealed partial class ReleaseDisciplineTests {
    private static readonly Regex ReleaseRowPattern = ReleaseRowRegex();
    private static readonly Regex DiagnosticEmissionPattern = DiagnosticEmissionRegex();
    [Fact]
    public void UnshippedReleaseMetadataMatchesActiveSupportedDiagnostics() {
        ImmutableArray<DiagnosticDescriptor> supportedDiagnostics = AnalyzerTestHarness.SupportedDiagnostics();
        ImmutableDictionary<string, ReleaseEntry> unshippedEntries = ParseReleaseEntries(AnalyzerTestHarness.UnshippedReleasePath);
        ImmutableHashSet<string> activeIds = supportedDiagnostics
            .Select(static descriptor => descriptor.Id)
            .ToImmutableHashSet(StringComparer.Ordinal);
        ImmutableHashSet<string> releaseIds = unshippedEntries.Keys.ToImmutableHashSet(StringComparer.Ordinal);
        Assert.Equal(expected: activeIds, actual: releaseIds);
        foreach (DiagnosticDescriptor descriptor in supportedDiagnostics) {
            ReleaseEntry releaseEntry = unshippedEntries[descriptor.Id];
            Assert.Equal(expected: descriptor.Category, actual: releaseEntry.Category);
            Assert.Equal(expected: descriptor.DefaultSeverity.ToString(), actual: releaseEntry.Severity);
        }
    }
    [Fact]
    public void ShippedAndUnshippedReleaseIdsDoNotOverlap() {
        ImmutableDictionary<string, ReleaseEntry> unshippedEntries = ParseReleaseEntries(AnalyzerTestHarness.UnshippedReleasePath);
        ImmutableDictionary<string, ReleaseEntry> shippedEntries = ParseReleaseEntries(AnalyzerTestHarness.ShippedReleasePath);
        ImmutableArray<string> overlap = [
            .. unshippedEntries.Keys
                .Intersect(second: shippedEntries.Keys, comparer: StringComparer.Ordinal)
                .OrderBy(static id => id, StringComparer.Ordinal),
        ];
        Assert.Empty(overlap);
    }
    [Fact]
    public void ActiveDiagnosticsHaveExplicitEmissionReferences() {
        ImmutableArray<string> activeIds = [
            .. AnalyzerTestHarness.SupportedDiagnostics()
                .Select(static descriptor => descriptor.Id)
                .OrderBy(static id => id, StringComparer.Ordinal),
        ];
        ImmutableHashSet<string> emittedIds = CollectDiagnosticEmissionReferences();
        ImmutableArray<string> missing = [
            .. activeIds
                .Where(id => !emittedIds.Contains(id))
                .OrderBy(static id => id, StringComparer.Ordinal),
        ];
        Assert.True(
            condition: missing.IsEmpty,
            userMessage: $"Active diagnostics without emission references: {string.Join(", ", missing)}");
    }
    private static ImmutableHashSet<string> CollectDiagnosticEmissionReferences() {
        IEnumerable<string> analyzerSourceFiles = Directory
            .EnumerateFiles(
                path: AnalyzerTestHarness.AnalyzerDirectory,
                searchPattern: "*.cs",
                searchOption: SearchOption.AllDirectories)
            .Where(static path => !string.Equals(Path.GetFileName(path), "RuleCatalog.cs", StringComparison.Ordinal))
            .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}tests{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase));
        IEnumerable<string> emissionRuleIds = analyzerSourceFiles
            .SelectMany(path => DiagnosticEmissionPattern
                .Matches(File.ReadAllText(path))
                .Select(static match => match.Groups[1].Value));
        return emissionRuleIds.ToImmutableHashSet(StringComparer.Ordinal);
    }
    private static ImmutableDictionary<string, ReleaseEntry> ParseReleaseEntries(string releasePath) {
        ImmutableArray<ReleaseEntry> entries = [
            .. File.ReadLines(releasePath)
                .Select(TryParseReleaseEntry)
                .Where(static entry => entry is not null)
                .Select(static entry => entry!),
        ];
        ImmutableArray<string> duplicates = [
            .. entries
                .GroupBy(static entry => entry.Id, StringComparer.Ordinal)
                .Where(static group => group.Count() > 1)
                .Select(static group => group.Key)
                .OrderBy(static id => id, StringComparer.Ordinal),
        ];
        Assert.True(
            condition: duplicates.IsEmpty,
            userMessage: $"Duplicate release entries found in '{releasePath}': {string.Join(", ", duplicates)}");
        return entries.ToImmutableDictionary(
            keySelector: static entry => entry.Id,
            elementSelector: static entry => entry,
            keyComparer: StringComparer.Ordinal);
    }
    private static ReleaseEntry? TryParseReleaseEntry(string line) {
        Match match = ReleaseRowPattern.Match(line);
        return match.Success switch {
            true => new ReleaseEntry(
                Id: match.Groups[1].Value.Trim(),
                Category: match.Groups[2].Value.Trim(),
                Severity: match.Groups[3].Value.Trim()),
            false => null,
        };
    }
    [GeneratedRegex(
        pattern: @"^(CSP\d{4})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|",
        options: RegexOptions.CultureInvariant)]
    private static partial Regex ReleaseRowRegex();
    [GeneratedRegex(
        pattern: @"Diagnostic\.Create\(\s*RuleCatalog\.(CSP\d{4})\b",
        options: RegexOptions.CultureInvariant)]
    private static partial Regex DiagnosticEmissionRegex();

    private sealed record ReleaseEntry(string Id, string Category, string Severity);
}
