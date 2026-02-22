using System.Collections.Immutable;
using ParametricPortal.CSharp.Analyzers.Tests.Infrastructure;
using Xunit;

namespace ParametricPortal.CSharp.Analyzers.Tests;

public sealed class RuleBehaviorTests {
    [Theory]
    [MemberData(nameof(RuleCases))]
    public void NewlyAddedOrChangedRulesEmitExpectedDiagnostic(string expectedRuleId, string filePath, string source) {
        ImmutableArray<string> diagnosticIds = [
            .. AnalyzerTestHarness.Analyze(source: source, filePath: filePath)
                .Select(static diagnostic => diagnostic.Id)
                .Distinct(StringComparer.Ordinal)
                .OrderBy(static id => id, StringComparer.Ordinal),
        ];
        Assert.True(
            condition: diagnosticIds.Contains(expectedRuleId, StringComparer.Ordinal),
            userMessage: $"Expected diagnostic '{expectedRuleId}'. Actual diagnostics: {string.Join(", ", diagnosticIds)}");
    }
    public static IEnumerable<object[]> RuleCases() =>
        [
            Case(
                ruleId: "CSP0017",
                filePath: "/workspace/src/Domain/Performance/HotPathClosure.cs",
                source: """
                    namespace Domain.Performance;

                    public sealed class HotPathClosure {
                        public int Run(int input) {
                            int offset = 3;
                            System.Func<int, int> projector = value => value + offset;
                            return projector(input);
                        }
                    }
                    """),
            Case(
                ruleId: "CSP0101",
                filePath: "/workspace/src/Integration/BoundaryAdapterUsage.cs",
                source: """
                    using ParametricPortal.CSharp.Analyzers.Contracts;

                    namespace Integration;

                    [BoundaryAdapter]
                    public sealed class BoundaryAdapterUsage {
                        public int Clamp(int value) {
                            if (value > 0) {
                                return value;
                            }
                            return 0;
                        }
                    }
                    """),
            Case(
                ruleId: "CSP0901",
                filePath: "/workspace/src/Integration/InvalidBoundaryExemption.cs",
                source: """
                    using ParametricPortal.CSharp.Analyzers.Contracts;

                    namespace Integration;

                    [BoundaryAdapter]
                    [BoundaryImperativeExemption(
                        ruleId: "",
                        reason: (BoundaryImperativeReason)999,
                        ticket: "",
                        expiresOnUtc: "not-a-utc-date")]
                    public sealed class InvalidBoundaryExemption {
                        public void Handle() { }
                    }
                    """),
            Case(
                ruleId: "CSP0902",
                filePath: "/workspace/src/Integration/ExpiredBoundaryExemption.cs",
                source: """
                    using ParametricPortal.CSharp.Analyzers.Contracts;

                    namespace Integration;

                    [BoundaryAdapter]
                    [BoundaryImperativeExemption(
                        ruleId: "CSP0009",
                        reason: BoundaryImperativeReason.ProtocolRequired,
                        ticket: "KARG-EXPIRED-001",
                        expiresOnUtc: "2000-01-01T00:00:00Z")]
                    public sealed class ExpiredBoundaryExemption {
                        public void Handle() { }
                    }
                    """),
            Case(
                ruleId: "CSP0504",
                filePath: "/workspace/src/Integration/DomainScopeAttributeUsage.cs",
                source: """
                    using ParametricPortal.CSharp.Analyzers.Contracts;

                    namespace Integration;

                    [DomainScope]
                    public sealed class DomainScopeAttributeUsage {
                        public void Execute() { }
                    }
                    """),
            Case(
                ruleId: "CSP0406",
                filePath: "/workspace/src/Application/Bootstrap/CompositionRoot.cs",
                source: """
                    namespace Application.Bootstrap;

                    public sealed class CompositionRoot {
                        public ServiceCollection Configure(ServiceCollection services) {
                            _ = services.Scan(selector => selector.FromAssemblies());
                            return services;
                        }
                    }

                    public sealed class ServiceCollection {
                        public ServiceCollection Scan(System.Action<ITypeSourceSelector> configure) {
                            ITypeSourceSelector builder = new TypeSourceSelector();
                            configure(builder);
                            return this;
                        }
                    }

                    public interface ITypeSourceSelector {
                        ITypeSourceSelector FromAssemblies();
                        ITypeSourceSelector UsingRegistrationStrategy();
                    }

                    public sealed class TypeSourceSelector : ITypeSourceSelector {
                        public ITypeSourceSelector FromAssemblies() => this;
                        public ITypeSourceSelector UsingRegistrationStrategy() => this;
                    }
                    """),
            Case(
                ruleId: "CSP0504",
                filePath: "/workspace/src/Domain/Services/ReturnPolicy.cs",
                source: """
                    namespace Domain.Services;

                    public sealed class ReturnPolicy {
                        public void Compute() { }
                    }
                    """),
            Case(
                ruleId: "CSP0505",
                filePath: "/workspace/src/Domain/Traits/TypeClassPolicy.cs",
                source: """
                    namespace Domain.Traits;

                    public interface ITypeClassPolicy {
                        int Compute(int value);
                    }
                    """),
            Case(
                ruleId: "CSP0506",
                filePath: "/workspace/src/Domain/Projection/ProjectionPolicy.cs",
                source: """
                    namespace Domain.Projection;

                    public sealed class Customer {
                        public string Name { get; }

                        public Customer(string name) {
                            Name = name;
                        }
                    }

                    public static class CustomerProjection {
                        public static string AsDisplayName(Customer customer) => customer.Name;
                    }
                    """),
            Case(
                ruleId: "CSP0715",
                filePath: "/workspace/src/Domain/Entities/AnemicEntity.cs",
                source: """
                    namespace Domain.Entities;

                    public sealed class AnemicEntity {
                        public int Id { get; set; }
                        public string Name { get; set; } = string.Empty;
                    }
                    """),
        ];
    private static object[] Case(string ruleId, string filePath, string source) => [ruleId, filePath, source];
}
