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
    public Fin<SessionSnapshot> Activate(HandshakeEnvelope.Ack ack, Instant now) =>
        WithinGate(() =>
            BindCurrent(
                project: snapshot =>
                    TransitionFromMutablePhase(
                        snapshot: snapshot,
                        now: now,
                        nextPhase: new SessionPhase.Active(Ack: ack),
                        operation: "activate"),
                missingError: SessionNotOpen));
    public Fin<SessionSnapshot> Beat(Instant now) =>
        WithinGate(() =>
            BindCurrent(
                project: snapshot =>
                    UpdateActiveHeartbeat(
                        snapshot: snapshot,
                        now: now),
                missingError: SessionNotOpen));
    public Fin<SessionSnapshot> Close(string reason, Instant now) =>
        WithinGate(() =>
            BindCurrent(
                project: snapshot =>
                    TransitionFromMutablePhase(
                        snapshot: snapshot,
                        now: now,
                        nextPhase: new SessionPhase.Terminal(
                            StateTag: SessionLifecycleState.Closed,
                            Failure: None),
                        operation: "close"),
                missingError: Error.New(message: $"Session close failed: {reason}")));
    public Fin<SessionSnapshot> Open(
        EnvelopeIdentity identity,
        Duration heartbeatInterval,
        Duration heartbeatTimeout,
        Instant now) =>
        WithinGate(() =>
            (heartbeatInterval > Duration.Zero, heartbeatTimeout > Duration.Zero) switch {
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
            });
    public Fin<SessionSnapshot> Reject(FailureReason reason, Instant now) =>
        WithinGate(() =>
            BindCurrent(
                project: snapshot =>
                    TransitionFromMutablePhase(
                        snapshot: snapshot,
                        now: now,
                        nextPhase: new SessionPhase.Terminal(
                            StateTag: SessionLifecycleState.Rejected,
                            Failure: Some(reason)),
                        operation: "reject"),
                missingError: FailureMapping.ToError(reason)));
    public Fin<SessionSnapshot> Timeout(Instant now) =>
        WithinGate(() =>
            BindCurrent(
                project: snapshot =>
                    TimeoutIfNeeded(
                        snapshot: snapshot,
                        now: now),
                missingError: Error.New(message: "Session timeout requested while no session is active.")));
    // --- [INTERNAL] ----------------------------------------------------------
    private Fin<TValue> WithinGate<TValue>(Func<Fin<TValue>> operation) {
        using Lock.Scope _ = _gate.EnterScope();
        return operation();
    }
    private Fin<SessionSnapshot> BindCurrent(
        Func<SessionSnapshot, Fin<SessionSnapshot>> project,
        Error missingError) =>
        _current.ToFin(missingError).Bind(project);
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
