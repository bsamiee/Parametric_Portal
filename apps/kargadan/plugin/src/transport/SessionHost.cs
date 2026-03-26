// Lock-gated mutable session state machine tracking lifecycle phase from Connected through Active to terminal states.
// Mutability is confined here — all transitions return Fin<SessionSnapshot> and are serialized under _gate; no state escapes the lock.
using System;
using System.Collections.Generic;
using System.Linq;
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

internal sealed record SessionSnapshot(
    EnvelopeIdentity Identity,
    SessionPhase Phase,
    Instant OpenedAt,
    Instant LastHeartbeatAt,
    Duration HeartbeatInterval,
    Duration HeartbeatTimeout,
    Option<Instant> TerminatedAt);

[Union]
internal abstract partial record SessionPhase {
    private SessionPhase() { }
    internal sealed record Connected : SessionPhase;
    internal sealed record Active(HandshakeEnvelope.Ack Ack) : SessionPhase;
    internal sealed record Terminal(SessionLifecycleState StateTag, Option<FailureReason> Failure) : SessionPhase;
}

internal readonly record struct IdempotencyCompositeKey(
    string TokenKey,
    string PayloadHash,
    string CommandId);

internal readonly record struct NegotiationContext(
    HandshakeEnvelope.Init Init,
    int SupportedMajor,
    int SupportedMinor,
    ServerInfo Server,
    Seq<string> SupportedCapabilities,
    Seq<CommandCatalogEntry> Catalog);

// --- [ADAPTER] ---------------------------------------------------------------

[BoundaryAdapter]
internal sealed class SessionHost {
    // --- [CONSTANTS] ---------------------------------------------------------
    private static readonly Error SessionNotOpen = Error.New(message: "Session is not open.");
    private const int IdempotencyCapacity = 1024;
    // --- [STATE] -------------------------------------------------------------
    private readonly Lock _gate = new();
    private readonly TokenValue _transportToken;
    private Option<SessionSnapshot> _current = None;
    private readonly Dictionary<IdempotencyCompositeKey, RequestId> _idempotency =
        new(capacity: IdempotencyCapacity);
    private readonly Queue<IdempotencyCompositeKey> _idempotencyOrder =
        new(capacity: IdempotencyCapacity);
    internal SessionHost(TokenValue transportToken) => _transportToken = transportToken;
    // --- [INTERFACE] ---------------------------------------------------------
    internal Fin<SessionSnapshot> Activate(HandshakeEnvelope.Ack ack, Instant now) {
        using Lock.Scope _ = _gate.EnterScope();
        return _current.ToFin(SessionNotOpen).Bind(snapshot =>
            TransitionFromMutablePhase(
                snapshot: snapshot,
                now: now,
                nextPhase: new SessionPhase.Active(Ack: ack),
                operation: "activate"));
    }
    internal Fin<SessionSnapshot> Beat(Instant now) {
        using Lock.Scope _ = _gate.EnterScope();
        return _current.ToFin(SessionNotOpen).Bind(snapshot =>
            UpdateActiveHeartbeat(
                snapshot: snapshot,
                now: now));
    }
    internal Fin<SessionSnapshot> Close(string reason, Instant now) {
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
    internal Fin<SessionSnapshot> Open(
        EnvelopeIdentity identity,
        TokenValue token,
        Duration heartbeatInterval,
        Duration heartbeatTimeout,
        Instant now) {
        using Lock.Scope _ = _gate.EnterScope();
        _idempotency.Clear();
        _idempotencyOrder.Clear();
        bool durationsValid = heartbeatInterval > Duration.Zero && heartbeatTimeout > Duration.Zero;
        return _current.Match(
            Some: snapshot => durationsValid switch {
                true => (_transportToken == token) switch {
                    true => ApplyState(snapshot with {
                        Identity = identity,
                        Phase = new SessionPhase.Connected(),
                        LastHeartbeatAt = now,
                        HeartbeatInterval = heartbeatInterval,
                        HeartbeatTimeout = heartbeatTimeout,
                        TerminatedAt = None,
                    }),
                    false => FinFail<SessionSnapshot>(FailureMapping.ToError(FailureMapping.FromCode(
                        code: ErrorCode.TokenInvalid,
                        message: "Handshake token does not match the active session token."))),
                },
                false => FinFail<SessionSnapshot>(Error.New(message: "Heartbeat interval/timeout must be positive.")),
            },
            None: () => durationsValid switch {
                true => (_transportToken == token) switch {
                    true => ApplyState(snapshot: new SessionSnapshot(
                    Identity: identity,
                    Phase: new SessionPhase.Connected(),
                    OpenedAt: now,
                    LastHeartbeatAt: now,
                    HeartbeatInterval: heartbeatInterval,
                    HeartbeatTimeout: heartbeatTimeout,
                    TerminatedAt: None)),
                    false => FinFail<SessionSnapshot>(FailureMapping.ToError(FailureMapping.FromCode(
                        code: ErrorCode.TokenInvalid,
                        message: "Handshake token does not match the active transport token."))),
                },
                false => FinFail<SessionSnapshot>(Error.New(message: "Heartbeat interval/timeout must be positive.")),
            });
    }
    internal Fin<Option<RequestId>> RegisterIdempotency(CommandEnvelope envelope) {
        using Lock.Scope _ = _gate.EnterScope();
        return envelope.Idempotency.Match(
            Some: token => {
                IdempotencyCompositeKey key = new(
                    TokenKey: (string)token.Key,
                    PayloadHash: (string)token.PayloadHash,
                    CommandId: envelope.CommandId.Key);
                return _idempotency.TryGetValue(key, out RequestId originalRequestId) switch {
                    true => FinSucc<Option<RequestId>>(Some(originalRequestId)),
                    _ => FinSucc<Option<RequestId>>(RememberIdempotency(
                        key: key,
                        requestId: envelope.Identity.RequestId)),
                };
            },
            None: () => envelope.CommandId.Category.Equals(CommandCategory.Write) switch {
                true => FinFail<Option<RequestId>>(FailureMapping.ToError(FailureMapping.FromCode(
                    code: ErrorCode.IdempotencyInvalid,
                    message: $"CommandId '{envelope.CommandId.Key}' requires idempotency token."))),
                _ => FinSucc<Option<RequestId>>(None),
            });
    }
    internal Fin<SessionSnapshot> Reject(FailureReason reason, Instant now) {
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
    internal Fin<SessionSnapshot> Timeout(Instant now) {
        using Lock.Scope _ = _gate.EnterScope();
        return _current.ToFin(Error.New(message: "Session timeout requested while no session is active.")).Bind(snapshot =>
            TimeoutIfNeeded(
                snapshot: snapshot,
                now: now));
    }
    internal Fin<SessionSnapshot> Snapshot() {
        using Lock.Scope _ = _gate.EnterScope();
        return _current.ToFin(SessionNotOpen).Bind(snapshot =>
            snapshot.Phase switch {
                SessionPhase.Terminal terminal => FinFail<SessionSnapshot>(
                    Error.New(message: $"Session is terminal in state '{terminal.StateTag.Key}'.")),
                _ => FinSucc(snapshot),
            });
    }

    // --- [HANDSHAKE] ---------------------------------------------------------
    internal static HandshakeEnvelope Negotiate(NegotiationContext ctx) {
        bool majorCompatible = ctx.Init.Identity.ProtocolVersion.Major == ctx.SupportedMajor;
        bool minorCompatible = ctx.Init.Identity.ProtocolVersion.Minor <= ctx.SupportedMinor;
        Seq<string> requiredCapabilities = ctx.Init.Capabilities.Required;
        Seq<string> requestedCapabilities =
            ctx.Init.Capabilities.Required
                .Concat(ctx.Init.Capabilities.Optional)
                .ToSeq()
                .Distinct();
        Seq<string> missingCapabilities =
            requiredCapabilities.Filter(
                required =>
                    !ctx.SupportedCapabilities.Contains(required));
        Seq<string> acceptedCapabilities =
            requestedCapabilities
                .Filter(capability => ctx.SupportedCapabilities.Contains(capability))
                .Distinct();
        Seq<CommandCatalogEntry> acceptedCatalog =
            ctx.Catalog.Filter(entry => acceptedCapabilities.Contains(entry.Id));
        return (majorCompatible, minorCompatible, missingCapabilities.IsEmpty) switch {
            (false, _, _) => new HandshakeEnvelope.Reject(
                Identity: ctx.Init.Identity,
                Reason: FailureMapping.FromCode(
                    code: ErrorCode.ProtocolIncompatible,
                    message: "Protocol major version mismatch."),
                TelemetryContext: ctx.Init.TelemetryContext),
            (true, false, _) => new HandshakeEnvelope.Reject(
                Identity: ctx.Init.Identity,
                Reason: FailureMapping.FromCode(
                    code: ErrorCode.ProtocolIncompatible,
                    message: $"Protocol minor version {ctx.Init.Identity.ProtocolVersion.Minor} exceeds supported {ctx.SupportedMinor}."),
                TelemetryContext: ctx.Init.TelemetryContext),
            (true, true, false) => new HandshakeEnvelope.Reject(
                Identity: ctx.Init.Identity,
                Reason: FailureMapping.FromCode(
                    code: ErrorCode.CapabilityUnsupported,
                    message: $"Missing required capabilities: {string.Join(',', missingCapabilities)}"),
                TelemetryContext: ctx.Init.TelemetryContext),
            (true, true, true) => new HandshakeEnvelope.Ack(
                Identity: ctx.Init.Identity,
                AcceptedCapabilities: acceptedCapabilities,
                Server: ctx.Server,
                Catalog: acceptedCatalog,
                TelemetryContext: ctx.Init.TelemetryContext),
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
    private Option<RequestId> RememberIdempotency(
        IdempotencyCompositeKey key,
        RequestId requestId) {
        // BOUNDARY ADAPTER — imperative eviction required for ring-buffer LRU invariant
        _ = _idempotency.Count < IdempotencyCapacity
            || _idempotency.Remove(_idempotencyOrder.Dequeue());
        _idempotency[key] = requestId;
        _idempotencyOrder.Enqueue(key);
        return None;
    }
    private static Error UnexpectedSessionPhase(string operation, SessionPhase phase) =>
        Error.New(message: $"Unexpected session phase '{phase.GetType().FullName}' during '{operation}'.");
}
