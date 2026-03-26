using System.Runtime.InteropServices;
using LanguageExt;
using LanguageExt.Common;
using NodaTime;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.contracts;

// --- [STRUCTS] ---------------------------------------------------------------

[StructLayout(LayoutKind.Auto)]
public readonly record struct ProtocolVersion {
    public int Major { get; }
    public int Minor { get; }
    private ProtocolVersion(int major, int minor) {
        Major = major;
        Minor = minor;
    }
    public static Validation<Error, ProtocolVersion> Create(int major, int minor) =>
        (Require.NonNegative(value: major, field: "Major"),
         Require.NonNegative(value: minor, field: "Minor"))
            .Apply(static (int validMajor, int validMinor) =>
                new ProtocolVersion(major: validMajor, minor: validMinor));
}
[StructLayout(LayoutKind.Auto)]
public readonly record struct TelemetryContext {
    public TraceId TraceId { get; }
    public SpanId SpanId { get; }
    public OperationTag OperationTag { get; }
    public int Attempt { get; }
    private TelemetryContext(TraceId traceId, SpanId spanId, OperationTag operationTag, int attempt) {
        TraceId = traceId;
        SpanId = spanId;
        OperationTag = operationTag;
        Attempt = attempt;
    }
    public static Fin<TelemetryContext> Create(TraceId traceId, SpanId spanId, OperationTag operationTag, int attempt) =>
        attempt switch {
            < 1 => FinFail<TelemetryContext>(Error.New(message: "Attempt must be >= 1.")),
            _ => FinSucc(new TelemetryContext(
                traceId: traceId,
                spanId: spanId,
                operationTag: operationTag,
                attempt: attempt))
        };
}
[StructLayout(LayoutKind.Auto)]
public readonly record struct ServerInfo(VersionString RhinoVersion, VersionString PluginRevision);

// --- [RECORDS] ---------------------------------------------------------------

public sealed record EnvelopeIdentity(
    AppId AppId,
    RunId RunId,
    SessionId SessionId,
    RequestId RequestId,
    Instant IssuedAt,
    ProtocolVersion ProtocolVersion);
public sealed record CapabilitySet(Seq<string> Required, Seq<string> Optional);
public sealed record AuthToken {
    public TokenValue Token { get; }
    private AuthToken(TokenValue token) => Token = token;
    public static Fin<AuthToken> Create(TokenValue token) =>
        FinSucc(new AuthToken(token: token));
}
public sealed record FailureReason(ErrorCode Code, string Message) {
    public FailureClass FailureClass => Code.FailureClass;
}
public sealed record SceneObjectRef {
    public ObjectId ObjectId { get; }
    public SceneObjectType TypeTag { get; }
    private SceneObjectRef(ObjectId objectId, SceneObjectType typeTag) {
        ObjectId = objectId;
        TypeTag = typeTag;
    }
    public static Fin<SceneObjectRef> Create(ObjectId objectId, SceneObjectType typeTag) =>
        FinSucc(new SceneObjectRef(objectId: objectId, typeTag: typeTag));
}

// --- [STRUCTS_EXTENDED] ------------------------------------------------------

[StructLayout(LayoutKind.Auto)]
public readonly record struct IdempotencyToken(IdempotencyKey Key, PayloadHash PayloadHash);
[StructLayout(LayoutKind.Auto)]
public readonly record struct ExecutionMetadata {
    public int DurationMs { get; }
    public VersionString PluginRevision { get; }
    private ExecutionMetadata(int durationMs, VersionString pluginRevision) {
        DurationMs = durationMs;
        PluginRevision = pluginRevision;
    }
    public static Validation<Error, ExecutionMetadata> Create(
        int durationMs,
        VersionString pluginRevision) =>
        (Require.NonNegative(value: durationMs, field: "DurationMs"),
         Success<Error, VersionString>(pluginRevision))
            .Apply(static (int durationMs, VersionString pluginRevision) =>
                new ExecutionMetadata(
                    durationMs: durationMs,
                    pluginRevision: pluginRevision));
}

// --- [RECORDS_EXTENDED] ------------------------------------------------------

public sealed record DedupeMetadata(DedupeDecision Decision, RequestId OriginalRequestId);

// --- [COMMAND_CATALOG] -------------------------------------------------------

public sealed record CommandCatalogExample(
    string Input,
    string Description);
public sealed record CommandCatalogParameter(
    string Name,
    string Type,
    bool Required,
    string Description);
public sealed record CommandDispatchMetadata(CommandDispatchMode Mode);
public sealed record CommandEnvelopeRequirements(
    bool RequiresTelemetryContext,
    bool RequiresObjectRefs,
    int MinimumObjectRefCount);
public sealed record CommandCatalogEntry(
    string Id,
    string Name,
    string Description,
    string Category,
    bool IsDestructive,
    Seq<string> Aliases,
    CommandDispatchMetadata Dispatch,
    CommandEnvelopeRequirements Requirements,
    Seq<CommandCatalogParameter> Params,
    Seq<CommandCatalogExample> Examples);
[StructLayout(LayoutKind.Auto)]
public readonly record struct RawDocEvent(
    EventType Type,
    EventSubtype Subtype,
    Option<Guid> ObjectId,
    Option<Guid> OldObjectId,
    Option<string> ObjectType,
    bool IsUndoRedo);
[StructLayout(LayoutKind.Auto)]
public readonly record struct EventBatchSummary(
    int TotalCount,
    Seq<CategoryCount> Categories,
    bool ContainsUndoRedo,
    int BatchWindowMs);
[StructLayout(LayoutKind.Auto)]
public readonly record struct CategoryCount(
    EventType Category,
    int Count,
    Seq<SubtypeCount> Subtypes);
[StructLayout(LayoutKind.Auto)]
public readonly record struct SubtypeCount(
    EventSubtype Subtype,
    int Count);
[StructLayout(LayoutKind.Auto)]
public readonly record struct AgentUndoState(
    RequestId RequestId,
    uint UndoSerial);
