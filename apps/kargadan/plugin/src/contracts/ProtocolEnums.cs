using System;
using LanguageExt;
using LanguageExt.Common;
using Thinktecture;
using static LanguageExt.Prelude;
namespace ParametricPortal.Kargadan.Plugin.src.contracts;

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
    public FailureClass FailureClass =>
        Map(
            protocolIncompatible: FailureClass.Fatal,
            tokenInvalid: FailureClass.Fatal,
            tokenExpired: FailureClass.Fatal,
            capabilityUnsupported: FailureClass.Correctable,
            transientIo: FailureClass.Retryable,
            idempotencyInvalid: FailureClass.Correctable,
            payloadMalformed: FailureClass.Correctable,
            unexpectedRuntime: FailureClass.Fatal);
    public Error ToError() =>
        Error.New(message: $"{Key}: {FailureClass.Key}");
}
[SmartEnum<string>]
public sealed partial class FailureClass {
    public static readonly FailureClass Fatal = new("fatal");
    public static readonly FailureClass Retryable = new("retryable");
    public static readonly FailureClass Correctable = new("correctable");
    public static readonly FailureClass Compensatable = new("compensatable");
}
[SmartEnum<string>]
public sealed partial class TransportMessageTag {
    public static readonly TransportMessageTag HandshakeInit = new("handshake.init");
    public static readonly TransportMessageTag Command = new("command");
    public static readonly TransportMessageTag Heartbeat = new("heartbeat");
    public static readonly TransportMessageTag Error = new("error");
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
    public static readonly CommandOperation ViewCapture = new("view.capture");
    public static readonly CommandOperation ObjectCreate = new("write.object.create");
    public static readonly CommandOperation ObjectUpdate = new("write.object.update");
    public static readonly CommandOperation ObjectDelete = new("write.object.delete");
    public static readonly CommandOperation ScriptRun = new("script.run");
    public static readonly CommandOperation CatalogRhinoCommands = new("catalog.rhino.commands");
    public static readonly CommandOperation ObjectList = new("read.object.list");
    public static readonly CommandOperation SelectionManage = new("write.selection");
    public CommandExecutionMode ExecutionMode =>
        Map(
            sceneSummary: CommandExecutionMode.DirectApi,
            objectMetadata: CommandExecutionMode.DirectApi,
            objectGeometry: CommandExecutionMode.DirectApi,
            layerState: CommandExecutionMode.DirectApi,
            viewState: CommandExecutionMode.DirectApi,
            toleranceUnits: CommandExecutionMode.DirectApi,
            viewCapture: CommandExecutionMode.DirectApi,
            objectCreate: CommandExecutionMode.DirectApi,
            objectUpdate: CommandExecutionMode.DirectApi,
            objectDelete: CommandExecutionMode.DirectApi,
            scriptRun: CommandExecutionMode.Script,
            catalogRhinoCommands: CommandExecutionMode.DirectApi,
            objectList: CommandExecutionMode.DirectApi,
            selectionManage: CommandExecutionMode.DirectApi);
    public CommandCategory Category =>
        Map(
            sceneSummary: CommandCategory.Read,
            objectMetadata: CommandCategory.Read,
            objectGeometry: CommandCategory.Read,
            layerState: CommandCategory.Read,
            viewState: CommandCategory.Read,
            toleranceUnits: CommandCategory.Read,
            viewCapture: CommandCategory.Read,
            objectCreate: CommandCategory.Write,
            objectUpdate: CommandCategory.Write,
            objectDelete: CommandCategory.Write,
            scriptRun: CommandCategory.Geometric,
            catalogRhinoCommands: CommandCategory.Read,
            objectList: CommandCategory.Read,
            selectionManage: CommandCategory.Write);
    public static bool SupportsCapability(string capability) =>
        TryGet((capability ?? string.Empty).Trim(), out CommandOperation? _);
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
public sealed partial class CommandResultStatus {
    public static readonly CommandResultStatus Ok = new("ok");
    public static readonly CommandResultStatus Error = new("error");
}
[SmartEnum<string>]
public sealed partial class EventType {
    public static readonly EventType ObjectsChanged = new("objects.changed");
    public static readonly EventType LayersChanged = new("layers.changed");
    public static readonly EventType ViewChanged = new("view.changed");
    public static readonly EventType UndoRedo = new("undo.redo");
    public static readonly EventType SessionLifecycle = new("session.lifecycle");
    public static readonly EventType StreamCompacted = new("stream.compacted");
    public static readonly EventType SelectionChanged = new("selection.changed");
    public static readonly EventType MaterialChanged = new("material.changed");
    public static readonly EventType PropertiesChanged = new("properties.changed");
    public static readonly EventType TablesChanged = new("tables.changed");
}
[SmartEnum<string>]
public sealed partial class CommandExecutionMode {
    public static readonly CommandExecutionMode DirectApi = new("direct_api");
    public static readonly CommandExecutionMode Script = new("script");
}
[SmartEnum<string>]
public sealed partial class CommandDispatchMode {
    public static readonly CommandDispatchMode Direct = new("direct");
    public static readonly CommandDispatchMode Script = new("script");
}
[SmartEnum<string>]
public sealed partial class CommandCategory {
    public static readonly CommandCategory Read = new("read");
    public static readonly CommandCategory Write = new("write");
    public static readonly CommandCategory Geometric = new("geometric");
    public int DefaultDeadlineMs =>
        Map(
            read: 5_000,
            write: 30_000,
            geometric: 120_000);
}
[SmartEnum<string>]
public sealed partial class EventSubtype {
    public static readonly EventSubtype Added = new("added");
    public static readonly EventSubtype Deleted = new("deleted");
    public static readonly EventSubtype Replaced = new("replaced");
    public static readonly EventSubtype Modified = new("modified");
    public static readonly EventSubtype Undeleted = new("undeleted");
    public static readonly EventSubtype Selected = new("selected");
    public static readonly EventSubtype Deselected = new("deselected");
    public static readonly EventSubtype DeselectAll = new("deselect_all");
    public static readonly EventSubtype PropertiesChanged = new("properties_changed");
}
