using System;
using LanguageExt;
using LanguageExt.Common;
using Thinktecture;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.contracts;

// --- [ENUMS] -----------------------------------------------------------------

[SmartEnum<string>]
public sealed partial class ErrorCode {
    public static readonly ErrorCode ProtocolIncompatible = new("PROTOCOL_INCOMPATIBLE");
    public static readonly ErrorCode TokenInvalid = new("TOKEN_INVALID");
    public static readonly ErrorCode TokenExpired = new("TOKEN_EXPIRED");
    public static readonly ErrorCode CapabilityUnsupported = new("CAPABILITY_UNSUPPORTED");
    public static readonly ErrorCode TransientIo = new("TRANSIENT_IO");
    public static readonly ErrorCode IdempotencyInvalid = new("IDEMPOTENCY_INVALID");
    public static readonly ErrorCode PayloadMalformed = new("PAYLOAD_MALFORMED");
    public static readonly ErrorCode UnexpectedRuntime = new("UNEXPECTED_RUNTIME");

    public string FailureClass =>
        Map(
            protocolIncompatible: "fatal",
            tokenInvalid: "fatal",
            tokenExpired: "fatal",
            capabilityUnsupported: "correctable",
            transientIo: "retryable",
            idempotencyInvalid: "correctable",
            payloadMalformed: "correctable",
            unexpectedRuntime: "fatal");

    public Error ToError() =>
        Error.New(message: $"{Key}: {FailureClass}");
}

[SmartEnum<string>]
public sealed partial class HeartbeatMode {
    public static readonly HeartbeatMode Ping = new("ping");
    public static readonly HeartbeatMode Pong = new("pong");
}

[SmartEnum<string>]
public sealed partial class SessionLifecycleState {
    public static readonly SessionLifecycleState Connected = new("connected");
    public static readonly SessionLifecycleState Authenticated = new("authenticated");
    public static readonly SessionLifecycleState Active = new("active");
    public static readonly SessionLifecycleState Closing = new("closing");
    public static readonly SessionLifecycleState Closed = new("closed");
    public static readonly SessionLifecycleState TimedOut = new("timed_out");
    public static readonly SessionLifecycleState Reaped = new("reaped");
    public static readonly SessionLifecycleState Rejected = new("rejected");
}

[SmartEnum<string>]
public sealed partial class CommandOperation {
    public static readonly CommandOperation SceneSummary = new("read.scene.summary");
    public static readonly CommandOperation ObjectMetadata = new("read.object.metadata");
    public static readonly CommandOperation ObjectGeometry = new("read.object.geometry");
    public static readonly CommandOperation LayerState = new("read.layer.state");
    public static readonly CommandOperation ViewState = new("read.view.state");
    public static readonly CommandOperation ToleranceUnits = new("read.tolerance.units");
    public static readonly CommandOperation ObjectCreate = new("write.object.create");
    public static readonly CommandOperation ObjectUpdate = new("write.object.update");
    public static readonly CommandOperation ObjectDelete = new("write.object.delete");
    public static readonly CommandOperation LayerUpdate = new("write.layer.update");
    public static readonly CommandOperation ViewportUpdate = new("write.viewport.update");
    public static readonly CommandOperation AnnotationUpdate = new("write.annotation.update");

    public bool IsRead =>
        Key.StartsWith(value: "read.", comparisonType: StringComparison.Ordinal);

    public bool IsWrite => !IsRead;

    // --- [CAPABILITIES] -------------------------------------------------------

    private static readonly Lazy<System.Collections.Generic.HashSet<string>> SupportedCapabilityLookup = new(
        valueFactory: static () => SupportedCapabilities.ToHashSet(comparer: StringComparer.Ordinal));

    public static Seq<string> SupportedCapabilities =>
        Seq(
            SceneSummary,
            ObjectMetadata,
            ObjectGeometry,
            LayerState,
            ViewState,
            ToleranceUnits,
            ObjectCreate,
            ObjectUpdate,
            ObjectDelete,
            LayerUpdate,
            ViewportUpdate,
            AnnotationUpdate).Map(static (CommandOperation operation) => operation.Key);

    public static bool SupportsCapability(string capability) =>
        SupportedCapabilityLookup.Value.Contains(item: capability);
}

[SmartEnum<string>]
public sealed partial class SceneObjectType {
    public static readonly SceneObjectType Brep = new("Brep");
    public static readonly SceneObjectType Mesh = new("Mesh");
    public static readonly SceneObjectType Curve = new("Curve");
    public static readonly SceneObjectType Surface = new("Surface");
    public static readonly SceneObjectType Annotation = new("Annotation");
    public static readonly SceneObjectType Instance = new("Instance");
    public static readonly SceneObjectType LayoutDetail = new("LayoutDetail");
}

[SmartEnum<string>]
public sealed partial class DedupeDecision {
    public static readonly DedupeDecision Executed = new("executed");
    public static readonly DedupeDecision Duplicate = new("duplicate");
    public static readonly DedupeDecision Rejected = new("rejected");
}

[SmartEnum<string>]
public sealed partial class EventType {
    public static readonly EventType ObjectsChanged = new("objects.changed");
    public static readonly EventType LayersChanged = new("layers.changed");
    public static readonly EventType ViewChanged = new("view.changed");
    public static readonly EventType UndoRedo = new("undo.redo");
    public static readonly EventType SessionLifecycle = new("session.lifecycle");
    public static readonly EventType StreamCompacted = new("stream.compacted");
}
