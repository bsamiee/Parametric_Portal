// Pure handshake negotiation: evaluates token expiry, protocol version compatibility, and capability coverage → Ack or Reject.
// No side effects or I/O — all temporal state is passed in as Instant; deterministic under test without mocking.
using LanguageExt;
using NodaTime;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using ParametricPortal.Kargadan.Plugin.src.protocol;

namespace ParametricPortal.Kargadan.Plugin.src.transport;

// --- [FUNCTIONS] -------------------------------------------------------------

internal static class Handshake {
    internal static HandshakeEnvelope Negotiate(
        HandshakeEnvelope.Init init,
        int supportedMajor,
        int supportedMinor,
        ServerInfo server,
        Instant now) {
        bool tokenExpired = init.Auth.ExpiresAt <= now;
        bool majorCompatible = init.Identity.ProtocolVersion.Major == supportedMajor;
        bool minorCompatible = init.Identity.ProtocolVersion.Minor <= supportedMinor;
        Seq<string> requiredCapabilities = init.Capabilities.Required;
        Seq<string> optionalCapabilities = init.Capabilities.Optional;
        Seq<string> missingCapabilities =
            requiredCapabilities.Filter(
                static (required) =>
                    !CommandOperation.SupportsCapability(required));
        Seq<string> acceptedCapabilities =
            requiredCapabilities
                .Append(optionalCapabilities)
                .Distinct()
                .Filter(static capability => CommandOperation.SupportsCapability(capability));
        return (tokenExpired, majorCompatible, minorCompatible, missingCapabilities.IsEmpty) switch {
            (true, _, _, _) => new HandshakeEnvelope.Reject(
                Identity: init.Identity,
                Reason: FailureMapping.FromCode(
                    code: ErrorCode.TokenExpired,
                    message: "Handshake token is expired."),
                TelemetryContext: init.TelemetryContext),
            (false, false, _, _) => new HandshakeEnvelope.Reject(
                Identity: init.Identity,
                Reason: FailureMapping.FromCode(
                    code: ErrorCode.ProtocolIncompatible,
                    message: "Protocol major version mismatch."),
                TelemetryContext: init.TelemetryContext),
            (false, true, false, _) => new HandshakeEnvelope.Reject(
                Identity: init.Identity,
                Reason: FailureMapping.FromCode(
                    code: ErrorCode.ProtocolIncompatible,
                    message: $"Protocol minor version {init.Identity.ProtocolVersion.Minor} exceeds supported {supportedMinor}."),
                TelemetryContext: init.TelemetryContext),
            (false, true, true, false) => new HandshakeEnvelope.Reject(
                Identity: init.Identity,
                Reason: FailureMapping.FromCode(
                    code: ErrorCode.CapabilityUnsupported,
                    message: $"Missing required capabilities: {string.Join(',', missingCapabilities)}"),
                TelemetryContext: init.TelemetryContext),
            (false, true, true, true) => new HandshakeEnvelope.Ack(
                Identity: init.Identity,
                AcceptedCapabilities: acceptedCapabilities,
                Server: server,
                TelemetryContext: init.TelemetryContext),
        };
    }
}
