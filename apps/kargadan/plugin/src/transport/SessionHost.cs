// Lock-gated mutable session state machine tracking lifecycle phase from Connected through Active to terminal states.
// Mutability is confined here — all transitions return Fin<SessionSnapshot> and are serialized under _gate; no state escapes the lock.
using System.Diagnostics;
using LanguageExt;
using LanguageExt.Common;
using NodaTime;
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
    Duration HeartbeatTimeout) {
    public SessionLifecycleState State => Phase switch {
        SessionPhase.Connected => SessionLifecycleState.Connected,
        SessionPhase.Active => SessionLifecycleState.Active,
        SessionPhase.Terminal terminal => terminal.StateTag,
        _ => throw new UnreachableException(),
    };
    public Option<HandshakeEnvelope.Ack> Handshake => Phase switch {
        SessionPhase.Active active => Some(active.Ack),
        _ => None,
    };
    public Option<FailureReason> FailureReason => Phase switch {
        SessionPhase.Terminal terminal => terminal.Failure,
        _ => None,
    };
}
[Union]
public abstract partial record SessionPhase {
    private SessionPhase() { }
    public sealed record Connected : SessionPhase;
    public sealed record Active(HandshakeEnvelope.Ack Ack) : SessionPhase;
    public sealed record Terminal(SessionLifecycleState StateTag, Option<FailureReason> Failure) : SessionPhase;
}

// --- [ADAPTER] ---------------------------------------------------------------

public sealed class SessionHost {
    // --- [CONSTANTS] ---------------------------------------------------------
    private static readonly Error SessionNotOpen = Error.New(message: "Session is not open.");
    // --- [STATE] -------------------------------------------------------------
    private readonly Lock _gate = new();
    private Option<SessionSnapshot> _current = None;
    // --- [INTERFACE] ---------------------------------------------------------
    public Fin<SessionSnapshot> Activate(HandshakeEnvelope.Ack ack, Instant now) =>
        WithinGate(() =>
            UpdateCurrent(
                transition: snapshot =>
                    TransitionFromMutablePhase(
                        snapshot: snapshot,
                        now: now,
                        nextPhase: new SessionPhase.Active(Ack: ack),
                        operation: "activate"),
                missingError: SessionNotOpen));
    public Fin<SessionSnapshot> Beat(HeartbeatEnvelope envelope) =>
        WithinGate(() =>
            UpdateCurrent(
                transition: snapshot =>
                    UpdateActiveHeartbeat(
                        snapshot: snapshot,
                        now: envelope.ServerTime),
                missingError: SessionNotOpen));
    public Fin<SessionSnapshot> Close(string reason, Instant now) =>
        WithinGate(() =>
            UpdateCurrent(
                transition: snapshot =>
                    TransitionFromMutablePhase(
                        snapshot: snapshot,
                        now: now,
                        nextPhase: new SessionPhase.Terminal(
                            StateTag: SessionLifecycleState.Closed,
                            Failure: None),
                        operation: "close"),
                missingError: Error.New(message: $"Session close failed: {reason}")));
    public Fin<Option<SessionSnapshot>> Current() =>
        WithinGate(() => Fin.Succ(_current));
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
                    HeartbeatTimeout: heartbeatTimeout)),
                _ => Fin.Fail<SessionSnapshot>(
                    Error.New(
                        message: "Heartbeat interval/timeout must be positive.")),
            });
    public Fin<SessionSnapshot> Reject(FailureReason reason, Instant now) =>
        WithinGate(() =>
            UpdateCurrent(
                transition: snapshot =>
                    TransitionFromMutablePhase(
                        snapshot: snapshot,
                        now: now,
                        nextPhase: new SessionPhase.Terminal(
                            StateTag: SessionLifecycleState.Rejected,
                            Failure: Some(reason)),
                        operation: "reject"),
                missingError: FailureMapping.ToError(reason)));
    public Fin<SessionSnapshot> Reap(Instant now) =>
        WithinGate(() =>
            UpdateCurrent(
                transition: snapshot =>
                    TransitionFromMutablePhase(
                        snapshot: snapshot,
                        now: now,
                        nextPhase: new SessionPhase.Terminal(
                            StateTag: SessionLifecycleState.Reaped,
                            Failure: None),
                        operation: "reap"),
                missingError: Error.New(message: "Session reap requested while no session is active.")));
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
    private Fin<SessionSnapshot> UpdateCurrent(
        Func<SessionSnapshot, Fin<SessionSnapshot>> transition,
        Error missingError) =>
        BindCurrent(
            project: transition,
            missingError: missingError);
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
            SessionPhase.Connected or SessionPhase.Active => ApplyHeartbeatTransition(snapshot: snapshot, now: now, nextPhase: nextPhase),
            SessionPhase.Terminal terminal => Fin.Fail<SessionSnapshot>(
                Error.New(message: $"Cannot {operation}; session is already terminal in state '{terminal.StateTag.Key}'.")),
            _ => Fin.Fail<SessionSnapshot>(
                Error.New(message: $"Unsupported session phase while attempting {operation}.")),
        };
    private Fin<SessionSnapshot> UpdateActiveHeartbeat(SessionSnapshot snapshot, Instant now) =>
        snapshot.Phase switch {
            SessionPhase.Active active => ApplyHeartbeatTransition(snapshot: snapshot, now: now, nextPhase: active),
            SessionPhase.Connected => Fin.Fail<SessionSnapshot>(
                Error.New(message: "Cannot process heartbeat before handshake activation.")),
            SessionPhase.Terminal terminal => Fin.Fail<SessionSnapshot>(
                Error.New(message: $"Cannot process heartbeat for terminal state '{terminal.StateTag.Key}'.")),
            _ => Fin.Fail<SessionSnapshot>(Error.New(message: "Unsupported session phase.")),
        };
    private Fin<SessionSnapshot> TimeoutIfNeeded(SessionSnapshot snapshot, Instant now) =>
        snapshot.Phase switch {
            SessionPhase.Terminal => Fin.Succ(snapshot),
            SessionPhase.Connected or SessionPhase.Active => EvaluateTimeout(snapshot: snapshot, now: now),
            _ => Fin.Fail<SessionSnapshot>(Error.New(message: "Unsupported session phase.")),
        };
    private Fin<SessionSnapshot> EvaluateTimeout(SessionSnapshot snapshot, Instant now) =>
        Heartbeat.IsTimedOut(
            now: now,
            lastHeartbeatAt: snapshot.LastHeartbeatAt,
            timeout: snapshot.HeartbeatTimeout) switch {
                true => ApplyState(snapshot: snapshot with {
                    LastHeartbeatAt = now,
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
    private Fin<SessionSnapshot> ApplyHeartbeatTransition(
        SessionSnapshot snapshot,
        Instant now,
        SessionPhase nextPhase) =>
        ApplyState(snapshot with {
            LastHeartbeatAt = now,
            Phase = nextPhase,
        });
}
