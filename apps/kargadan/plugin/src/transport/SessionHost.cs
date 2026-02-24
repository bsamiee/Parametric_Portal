// Lock-gated mutable session state machine tracking lifecycle phase from Connected through Active to terminal states.
// Mutability is confined here — all transitions return Fin<SessionSnapshot> and are serialized under _gate; no state escapes the lock.
using System;
using LanguageExt;
using LanguageExt.Common;
using NodaTime;
using ParametricPortal.CSharp.Analyzers.Contracts;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using ParametricPortal.Kargadan.Plugin.src.protocol;
using Thinktecture;
using static LanguageExt.Prelude;
using Duration = NodaTime.Duration;

namespace ParametricPortal.Kargadan.Plugin.src.transport;

// --- [TYPES] -----------------------------------------------------------------

public sealed record SessionSnapshot(
    EnvelopeIdentity Identity,
    SessionPhase Phase,
    Instant OpenedAt,
    Instant LastHeartbeatAt,
    Duration HeartbeatInterval,
    Duration HeartbeatTimeout,
    Option<Instant> TerminatedAt);
[Union]
public abstract partial record SessionPhase {
    private SessionPhase() { }
    public sealed record Connected : SessionPhase;
    public sealed record Active(HandshakeEnvelope.Ack Ack) : SessionPhase;
    public sealed record Terminal(SessionLifecycleState StateTag, Option<FailureReason> Failure) : SessionPhase;
}

// --- [ADAPTER] ---------------------------------------------------------------

[BoundaryAdapter]
public sealed class SessionHost {
    // --- [CONSTANTS] ---------------------------------------------------------
    private static readonly Error SessionNotOpen = Error.New(message: "Session is not open.");
    // --- [STATE] -------------------------------------------------------------
    private readonly Lock _gate = new();
    private Option<SessionSnapshot> _current = None;
    // --- [INTERFACE] ---------------------------------------------------------
    public Fin<SessionSnapshot> Activate(HandshakeEnvelope.Ack ack, Instant now) {
        using Lock.Scope _ = _gate.EnterScope();
        return _current.ToFin(SessionNotOpen).Bind(snapshot =>
            TransitionFromMutablePhase(
                snapshot: snapshot,
                now: now,
                nextPhase: new SessionPhase.Active(Ack: ack),
                operation: "activate"));
    }
    public Fin<SessionSnapshot> Beat(Instant now) {
        using Lock.Scope _ = _gate.EnterScope();
        return _current.ToFin(SessionNotOpen).Bind(snapshot =>
            UpdateActiveHeartbeat(
                snapshot: snapshot,
                now: now));
    }
    public Fin<SessionSnapshot> Close(string reason, Instant now) {
        using Lock.Scope _ = _gate.EnterScope();
        return _current.ToFin(Error.New(message: $"Session close failed: {reason}")).Bind(snapshot =>
            TransitionFromMutablePhase(
                snapshot: snapshot,
                now: now,
                nextPhase: new SessionPhase.Terminal(
                    StateTag: SessionLifecycleState.Closed,
                    Failure: None),
                operation: "close"));
    }
    public Fin<SessionSnapshot> Open(
        EnvelopeIdentity identity,
        Duration heartbeatInterval,
        Duration heartbeatTimeout,
        Instant now) {
        using Lock.Scope _ = _gate.EnterScope();
        return (heartbeatInterval > Duration.Zero, heartbeatTimeout > Duration.Zero) switch {
            (true, true) => ApplyState(snapshot: new SessionSnapshot(
                Identity: identity,
                Phase: new SessionPhase.Connected(),
                OpenedAt: now,
                LastHeartbeatAt: now,
                HeartbeatInterval: heartbeatInterval,
                HeartbeatTimeout: heartbeatTimeout,
                TerminatedAt: None)),
            _ => FinFail<SessionSnapshot>(
                Error.New(
                    message: "Heartbeat interval/timeout must be positive.")),
        };
    }
    public Fin<SessionSnapshot> Reject(FailureReason reason, Instant now) {
        using Lock.Scope _ = _gate.EnterScope();
        return Optional(reason)
            .ToFin(Error.New(message: "Session reject reason is required."))
            .Bind(reasonValue =>
                _current.ToFin(FailureMapping.ToError(reasonValue)).Bind(snapshot =>
                    TransitionFromMutablePhase(
                        snapshot: snapshot,
                        now: now,
                        nextPhase: new SessionPhase.Terminal(
                            StateTag: SessionLifecycleState.Rejected,
                            Failure: Some(reasonValue)),
                        operation: "reject")));
    }
    public Fin<SessionSnapshot> Timeout(Instant now) {
        using Lock.Scope _ = _gate.EnterScope();
        return _current.ToFin(Error.New(message: "Session timeout requested while no session is active.")).Bind(snapshot =>
            TimeoutIfNeeded(
                snapshot: snapshot,
                now: now));
    }
    public Fin<SessionSnapshot> Snapshot() {
        using Lock.Scope _ = _gate.EnterScope();
        return _current.ToFin(SessionNotOpen);
    }

    // --- [HANDSHAKE] ---------------------------------------------------------
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
                static required =>
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
    // --- [TRANSITIONS] -------------------------------------------------------
    private Fin<SessionSnapshot> TransitionFromMutablePhase(
        SessionSnapshot snapshot,
        Instant now,
        SessionPhase nextPhase,
        string operation) =>
        snapshot.Phase switch {
            SessionPhase.Connected or SessionPhase.Active => ApplyState(snapshot with {
                LastHeartbeatAt = now,
                Phase = nextPhase,
                TerminatedAt = nextPhase is SessionPhase.Terminal ? Some(now) : snapshot.TerminatedAt,
            }),
            SessionPhase.Terminal terminal => FinFail<SessionSnapshot>(
                Error.New(message: $"Cannot {operation}; session is already terminal in state '{terminal.StateTag.Key}'.")),
            _ => FinFail<SessionSnapshot>(UnexpectedSessionPhase(operation: operation, phase: snapshot.Phase)),
        };
    private Fin<SessionSnapshot> UpdateActiveHeartbeat(SessionSnapshot snapshot, Instant now) =>
        snapshot.Phase switch {
            SessionPhase.Active => ApplyState(snapshot with {
                LastHeartbeatAt = now,
            }),
            SessionPhase.Connected => FinFail<SessionSnapshot>(
                Error.New(message: "Cannot process heartbeat before handshake activation.")),
            SessionPhase.Terminal terminal => FinFail<SessionSnapshot>(
                Error.New(message: $"Cannot process heartbeat for terminal state '{terminal.StateTag.Key}'.")),
            _ => FinFail<SessionSnapshot>(UnexpectedSessionPhase(operation: "process heartbeat", phase: snapshot.Phase)),
        };
    private Fin<SessionSnapshot> TimeoutIfNeeded(SessionSnapshot snapshot, Instant now) =>
        snapshot.Phase switch {
            SessionPhase.Terminal => FinSucc(snapshot),
            SessionPhase.Connected or SessionPhase.Active => EvaluateTimeout(snapshot: snapshot, now: now),
            _ => FinFail<SessionSnapshot>(UnexpectedSessionPhase(operation: "evaluate timeout", phase: snapshot.Phase)),
        };
    private Fin<SessionSnapshot> EvaluateTimeout(SessionSnapshot snapshot, Instant now) =>
        ((now - snapshot.LastHeartbeatAt) > snapshot.HeartbeatTimeout) switch {
            true => ApplyState(snapshot: snapshot with {
                TerminatedAt = Some(now),
                Phase = new SessionPhase.Terminal(
                    StateTag: SessionLifecycleState.TimedOut,
                    Failure: None),
            }),
            false => FinSucc(snapshot),
        };
    private Fin<SessionSnapshot> ApplyState(SessionSnapshot snapshot) {
        _current = Some(snapshot);
        return FinSucc(snapshot);
    }
    private static Error UnexpectedSessionPhase(string operation, SessionPhase phase) =>
        Error.New(message: $"Unexpected session phase '{phase.GetType().FullName}' during '{operation}'.");
}
