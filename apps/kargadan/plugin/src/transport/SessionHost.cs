// Lock-gated mutable session state machine tracking lifecycle phase from Connected through Active to terminal states.
// Mutability is confined here — all transitions return Fin<SessionSnapshot> and are serialized under _gate; no state escapes the lock.
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
            _ => Fin.Fail<SessionSnapshot>(
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
            SessionPhase.Terminal terminal => Fin.Fail<SessionSnapshot>(
                Error.New(message: $"Cannot {operation}; session is already terminal in state '{terminal.StateTag.Key}'.")),
            _ => Fin.Fail<SessionSnapshot>(UnexpectedSessionPhase(operation: operation, phase: snapshot.Phase)),
        };
    private Fin<SessionSnapshot> UpdateActiveHeartbeat(SessionSnapshot snapshot, Instant now) =>
        snapshot.Phase switch {
            SessionPhase.Active => ApplyState(snapshot with {
                LastHeartbeatAt = now,
            }),
            SessionPhase.Connected => Fin.Fail<SessionSnapshot>(
                Error.New(message: "Cannot process heartbeat before handshake activation.")),
            SessionPhase.Terminal terminal => Fin.Fail<SessionSnapshot>(
                Error.New(message: $"Cannot process heartbeat for terminal state '{terminal.StateTag.Key}'.")),
            _ => Fin.Fail<SessionSnapshot>(UnexpectedSessionPhase(operation: "process heartbeat", phase: snapshot.Phase)),
        };
    private Fin<SessionSnapshot> TimeoutIfNeeded(SessionSnapshot snapshot, Instant now) =>
        snapshot.Phase switch {
            SessionPhase.Terminal => Fin.Succ(snapshot),
            SessionPhase.Connected or SessionPhase.Active => EvaluateTimeout(snapshot: snapshot, now: now),
            _ => Fin.Fail<SessionSnapshot>(UnexpectedSessionPhase(operation: "evaluate timeout", phase: snapshot.Phase)),
        };
    private Fin<SessionSnapshot> EvaluateTimeout(SessionSnapshot snapshot, Instant now) =>
        ((now - snapshot.LastHeartbeatAt) > snapshot.HeartbeatTimeout) switch {
            true => ApplyState(snapshot: snapshot with {
                TerminatedAt = Some(now),
                Phase = new SessionPhase.Terminal(
                    StateTag: SessionLifecycleState.TimedOut,
                    Failure: None),
            }),
            false => Fin.Succ(snapshot),
        };
    private Fin<SessionSnapshot> ApplyState(SessionSnapshot snapshot) {
        _current = Some(snapshot);
        return Fin.Succ(snapshot);
    }
    private static Error UnexpectedSessionPhase(string operation, SessionPhase phase) =>
        Error.New(message: $"Unexpected session phase '{phase.GetType().FullName}' during '{operation}'.");
}
