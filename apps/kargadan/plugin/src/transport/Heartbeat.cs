// Pure heartbeat logic: timeout detection against Instant values and Ping/Pong envelope construction.
// Stateless — no fields or dependencies; all temporal context is caller-supplied, making every operation independently testable.
using NodaTime;
using ParametricPortal.Kargadan.Plugin.src.contracts;

namespace ParametricPortal.Kargadan.Plugin.src.transport;

// --- [FUNCTIONS] -------------------------------------------------------------

internal static class Heartbeat {
    internal static bool IsTimedOut(Instant now, Instant lastHeartbeatAt, NodaTime.Duration timeout) =>
        (now - lastHeartbeatAt) > timeout;
    internal static HeartbeatEnvelope Ping(
        EnvelopeIdentity identity,
        TelemetryContext telemetryContext,
        Instant now) =>
        new(
            Identity: identity,
            Mode: HeartbeatMode.Ping,
            ServerTime: now,
            TelemetryContext: telemetryContext);
    internal static HeartbeatEnvelope Pong(
        HeartbeatEnvelope ping,
        TelemetryContext telemetryContext,
        Instant now) =>
        new(
            Identity: ping.Identity,
            Mode: HeartbeatMode.Pong,
            ServerTime: now,
            TelemetryContext: telemetryContext);
}
