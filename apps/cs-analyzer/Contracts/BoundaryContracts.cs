namespace ParametricPortal.CSharp.Analyzers.Contracts;

// --- [ENUMS] -----------------------------------------------------------------

public enum BoundaryImperativeReason {
    CancellationGuard = 0,
    AsyncIteratorYieldGate = 1,
    CleanupFinally = 2,
    ProtocolRequired = 3,
}
public static class BoundaryImperativeReasonFacts {
    public static bool TryParse(object? raw, out BoundaryImperativeReason reason) {
        (bool valid, BoundaryImperativeReason parsed) = raw switch {
            BoundaryImperativeReason parsedReason when Enum.IsDefined(enumType: typeof(BoundaryImperativeReason), value: parsedReason) => (true, parsedReason),
            int value when Enum.IsDefined(enumType: typeof(BoundaryImperativeReason), value: value) => (true, (BoundaryImperativeReason)value),
            _ => (false, BoundaryImperativeReason.ProtocolRequired),
        };
        reason = parsed;
        return valid;
    }
}

// --- [ATTRIBUTES] ------------------------------------------------------------

[AttributeUsage(validOn: AttributeTargets.Class | AttributeTargets.Struct | AttributeTargets.Method | AttributeTargets.Property, AllowMultiple = true, Inherited = false)]
public sealed class BoundaryImperativeExemptionAttribute(string ruleId, BoundaryImperativeReason reason, string ticket, string expiresOnUtc) : Attribute {
    public string RuleId { get; } = ruleId;
    public BoundaryImperativeReason Reason { get; } = reason;
    public string Ticket { get; } = ticket;
    public string ExpiresOnUtc { get; } = expiresOnUtc;
}
[AttributeUsage(validOn: AttributeTargets.Class | AttributeTargets.Struct | AttributeTargets.Method, AllowMultiple = false, Inherited = false)]
public sealed class BoundaryAdapterAttribute : Attribute;
[AttributeUsage(validOn: AttributeTargets.Class | AttributeTargets.Struct | AttributeTargets.Method, AllowMultiple = false, Inherited = false)]
public sealed class DomainScopeAttribute : Attribute;
